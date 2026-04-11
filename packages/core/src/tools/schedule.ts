import { createLogger } from "@openmantis/common/logger";
import { formatSchedule, type Schedule } from "@openmantis/common/types/scheduler";
import type { SchedulerService } from "@openmantis/scheduler/service";
import { tool } from "ai";
import { z } from "zod";

const logger = createLogger("core/tools");

export interface ScheduleToolsContext {
	scheduler: SchedulerService;
	channelType: string;
	channelId: string;
}

const DEFAULT_TIMEZONE = "Asia/Shanghai";

function buildSchedule(
	scheduleType: "every" | "cron" | "at",
	intervalMinutes: number | undefined,
	cronExpression: string | undefined,
	datetime: string | undefined,
	timezone: string | undefined,
): Schedule {
	const tz = timezone ?? DEFAULT_TIMEZONE;
	switch (scheduleType) {
		case "every": {
			if (!intervalMinutes) throw new Error("every 模式需要提供 intervalMinutes");
			return { type: "every", intervalMs: intervalMinutes * 60 * 1000 };
		}
		case "cron": {
			if (!cronExpression) throw new Error("cron 模式需要提供 cronExpression");
			return { type: "cron", expression: cronExpression, timezone: tz };
		}
		case "at": {
			if (!datetime) throw new Error("at 模式需要提供 datetime");
			const ts = new Date(datetime).getTime();
			if (Number.isNaN(ts)) throw new Error(`无效的日期时间: ${datetime}`);
			return { type: "at", datetime: ts, timezone: tz };
		}
	}
}

function createCreateTool(
	scheduler: SchedulerService,
	channelType: string,
	channelId: string,
	contextInfo: string,
) {
	return tool({
		description:
			"创建定时/计划任务。支持三种调度模式：\n" +
			"1. every — 固定间隔重复执行（如每30分钟）\n" +
			"2. cron — 标准5字段 cron 表达式（如每天早上7点 = '0 7 * * *'，每周一三五9点 = '0 9 * * 1,3,5'）\n" +
			"3. at — 一次性定时执行（指定具体时间点）\n" +
			"根据用户的自然语言描述选择合适的模式和参数。\n" +
			contextInfo,
		inputSchema: z.object({
			prompt: z.string().describe("每次执行时应该做什么"),
			scheduleType: z
				.enum(["every", "cron", "at"])
				.describe("调度模式: every=固定间隔, cron=cron表达式, at=一次性定时"),
			intervalMinutes: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe("执行间隔（分钟），仅 every 模式需要"),
			cronExpression: z
				.string()
				.optional()
				.describe("标准5字段cron表达式（分 时 日 月 周），仅 cron 模式需要"),
			datetime: z
				.string()
				.optional()
				.describe("执行时间，ISO 8601 格式（如 2026-04-02T07:00:00），仅 at 模式需要"),
			timezone: z.string().optional().describe("时区（默认 Asia/Shanghai）"),
			description: z.string().optional().describe("任务描述（人类可读）"),
			maxExecutions: z
				.number()
				.int()
				.optional()
				.describe("最大执行次数（可选，不设置则无限重复；at 模式默认为1）"),
			targetChannelType: z.string().optional().describe("渠道类型，如 feishu:main, wecom"),
			targetChannelId: z
				.string()
				.optional()
				.describe("目标渠道ID（不填则投递到当前渠道，通常无需指定）"),
		}),
		execute: async (input) => {
			logger.debug("[tool:schedule] create_schedule called", input);

			try {
				const schedule = buildSchedule(
					input.scheduleType,
					input.intervalMinutes,
					input.cronExpression,
					input.datetime,
					input.timezone,
				);

				const task = await scheduler.addTask({
					prompt: input.prompt,
					schedule,
					originChannelType: channelType,
					originChannelId: channelId,
					targetChannelType: input.targetChannelType,
					targetChannelId: input.targetChannelId,
					description: input.description,
					maxExecutions: input.maxExecutions,
				});

				const nextRun = new Date(task.nextExecutionAt).toLocaleString("zh-CN");
				return (
					`已创建定时任务 ${task.id}\n` +
					`描述: ${input.description || input.prompt.slice(0, 50)}\n` +
					`调度: ${formatSchedule(task.schedule)}\n` +
					`下次执行: ${nextRun}` +
					(task.maxExecutions ? `\n最多执行${task.maxExecutions}次` : "")
				);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				logger.error("[tool:schedule] create_schedule failed:", err);
				return `创建定时任务失败: ${message}`;
			}
		},
	});
}

function createListTool(scheduler: SchedulerService) {
	return tool({
		description: "列出所有定时任务（包括活跃、已暂停和已完成的任务）",
		inputSchema: z.object({}),
		execute: async () => {
			logger.debug("[tool:schedule] list_schedules called");
			const tasks = await scheduler.listTasks();

			if (tasks.length === 0) {
				return "目前没有定时任务。";
			}

			const lines = ["定时任务列表:\n"];
			for (const task of tasks) {
				const nextRun =
					task.status === "completed"
						? "已完成"
						: new Date(task.nextExecutionAt).toLocaleString("zh-CN");
				const line =
					`- ${task.id} | ${task.description || task.prompt.slice(0, 40)}\n` +
					`  状态: ${task.status} | 调度: ${formatSchedule(task.schedule)} | 已执行: ${task.executionCount}次 | 下次: ${nextRun}`;
				lines.push(line);
			}

			return lines.join("\n");
		},
	});
}

function createGetTool(scheduler: SchedulerService) {
	return tool({
		description: "获取指定定时任务的详细信息",
		inputSchema: z.object({
			taskId: z.string().describe("任务ID"),
		}),
		execute: async (input) => {
			logger.debug("[tool:schedule] get_schedule called", input);

			const task = await scheduler.getTask(input.taskId);
			if (!task) {
				return `任务未找到: ${input.taskId}`;
			}

			const nextRun =
				task.status === "completed"
					? "已完成"
					: new Date(task.nextExecutionAt).toLocaleString("zh-CN");
			const lastRun = task.lastExecutedAt
				? new Date(task.lastExecutedAt).toLocaleString("zh-CN")
				: "尚未执行";
			const createdAt = new Date(task.createdAt).toLocaleString("zh-CN");
			const targetChannel =
				task.targetChannelType && task.targetChannelId
					? `${task.targetChannelType}/${task.targetChannelId}`
					: `${task.originChannelType}/${task.originChannelId}（默认）`;

			return (
				`定时任务详情:\n` +
				`  ID: ${task.id}\n` +
				`  描述: ${task.description || "无"}\n` +
				`  提示词: ${task.prompt}\n` +
				`  调度: ${formatSchedule(task.schedule)}\n` +
				`  状态: ${task.status}\n` +
				`  已执行: ${task.executionCount}次` +
				(task.maxExecutions ? `（上限 ${task.maxExecutions} 次）` : "") +
				`\n` +
				`  上次执行: ${lastRun}\n` +
				`  下次执行: ${nextRun}\n` +
				`  目标渠道: ${targetChannel}\n` +
				`  创建时间: ${createdAt}`
			);
		},
	});
}

function createCancelTool(scheduler: SchedulerService) {
	return tool({
		description: "取消（删除）一个定时任务",
		inputSchema: z.object({
			taskId: z.string().describe("要取消的任务ID"),
		}),
		execute: async (input) => {
			logger.debug("[tool:schedule] cancel_schedule called", input);

			try {
				const task = await scheduler.getTask(input.taskId);
				if (!task) {
					return `任务未找到: ${input.taskId}`;
				}

				const success = await scheduler.removeTask(input.taskId);
				if (success) {
					return `已取消定时任务 ${input.taskId}`;
				} else {
					return `取消任务失败: ${input.taskId}`;
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				logger.error("[tool:schedule] cancel_schedule failed:", err);
				return `取消任务失败: ${message}`;
			}
		},
	});
}

function createEditTool(scheduler: SchedulerService, contextInfo: string) {
	return tool({
		description:
			"编辑一个已有的定时任务。可以修改调度方式、提示词、推送渠道、最大执行次数、关联路由和描述等字段。只需提供要修改的字段。\n" +
			"修改调度方式时需同时提供 scheduleType 和对应参数。\n" +
			contextInfo,
		inputSchema: z.object({
			taskId: z.string().describe("要编辑的任务ID"),
			prompt: z.string().optional().describe("新的执行提示词"),
			description: z.string().optional().describe("新的任务描述"),
			scheduleType: z.enum(["every", "cron", "at"]).optional().describe("新的调度模式"),
			intervalMinutes: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe("新的执行间隔（分钟），仅 every 模式"),
			cronExpression: z.string().optional().describe("新的 cron 表达式，仅 cron 模式"),
			datetime: z.string().optional().describe("新的执行时间 ISO 8601，仅 at 模式"),
			timezone: z.string().optional().describe("新的时区"),
			targetChannelType: z.string().optional().describe("渠道类型，如 feishu:main, wecom"),
			targetChannelId: z.string().optional().describe("新的目标渠道ID（不填则不修改）"),
			maxExecutions: z
				.number()
				.int()
				.nullable()
				.optional()
				.describe("新的最大执行次数（null 表示取消上限）"),
		}),
		execute: async (input) => {
			logger.debug("[tool:schedule] edit_schedule called", input);

			try {
				const { taskId, ...fields } = input;

				const oldTask = await scheduler.getTask(taskId);
				if (!oldTask) {
					return `任务未找到: ${taskId}`;
				}

				const update: Parameters<typeof scheduler.updateTask>[1] = {};
				if (fields.prompt !== undefined) update.prompt = fields.prompt;
				if (fields.description !== undefined) update.description = fields.description;
				if (fields.targetChannelType !== undefined)
					update.targetChannelType = fields.targetChannelType;
				if (fields.targetChannelId !== undefined) update.targetChannelId = fields.targetChannelId;
				if (fields.maxExecutions !== undefined) update.maxExecutions = fields.maxExecutions;
				// Build new schedule if scheduleType is provided
				if (fields.scheduleType !== undefined) {
					update.schedule = buildSchedule(
						fields.scheduleType,
						fields.intervalMinutes,
						fields.cronExpression,
						fields.datetime,
						fields.timezone,
					);
				}

				if (Object.keys(update).length === 0) {
					return "未提供任何要修改的字段。";
				}

				const oldStatus = oldTask.status;
				const updated = await scheduler.updateTask(taskId, update);
				if (!updated) {
					return `任务未找到: ${taskId}`;
				}

				// Build change summary
				const changes: string[] = [];
				if (fields.prompt !== undefined) changes.push(`  提示词: ${updated.prompt.slice(0, 50)}`);
				if (fields.description !== undefined) changes.push(`  描述: ${updated.description}`);
				if (fields.scheduleType !== undefined)
					changes.push(`  调度: ${formatSchedule(updated.schedule)}`);
				if (fields.targetChannelType !== undefined || fields.targetChannelId !== undefined)
					changes.push(
						`  推送渠道: ${updated.targetChannelType ?? updated.originChannelType}/${updated.targetChannelId ?? updated.originChannelId}`,
					);
				if (fields.maxExecutions !== undefined)
					changes.push(
						`  最大执行次数: ${fields.maxExecutions === null ? "无限制" : fields.maxExecutions}`,
					);
				const nextRun = new Date(updated.nextExecutionAt).toLocaleString("zh-CN");
				changes.push(`  下次执行: ${nextRun}`);

				let result = `已更新定时任务 ${taskId}\n修改内容:\n${changes.join("\n")}`;

				if (oldStatus === "completed" && updated.status === "active") {
					result += `\n任务已从"已完成"状态恢复为"活跃"。`;
				}

				return result;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				logger.error("[tool:schedule] edit_schedule failed:", err);
				return `编辑定时任务失败: ${message}`;
			}
		},
	});
}

export const SCHEDULE_TOOL_GUIDE =
	'- **create_schedule / list_schedules / cancel_schedule**：用于定时任务管理。当用户要求定期执行某个操作时（如"每隔30分钟检查一下"、"每小时运行一次"、"每天早上提醒我"），使用 create_schedule 工具。可以用 list_schedules 查看所有定时任务，用 cancel_schedule 取消任务。';

export function createScheduleTools(context: ScheduleToolsContext): Record<string, any> {
	const { scheduler, channelType, channelId } = context;

	const contextInfo =
		`当前会话上下文: 渠道类型=${channelType}, 渠道ID=${channelId}。` +
		"默认将结果投递回当前渠道，通常无需指定 targetChannelType/targetChannelId。";

	return {
		create_schedule: createCreateTool(scheduler, channelType, channelId, contextInfo),
		list_schedules: createListTool(scheduler),
		get_schedule: createGetTool(scheduler),
		cancel_schedule: createCancelTool(scheduler),
		edit_schedule: createEditTool(scheduler, contextInfo),
	};
}
