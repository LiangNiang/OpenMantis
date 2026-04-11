import { formatSchedule, type ScheduledTask } from "@openmantis/common/types/scheduler";
import { getSchedulerService } from "../context/scheduler-context";
import type { CommandContext, CommandDefinition, CommandResult, InteractiveAction } from "./types";

const USAGE = [
	"用法:",
	"  /schedule list                        列出所有定时任务",
	"  /schedule delete <id>                 删除定时任务",
	"  /schedule pause <id>                  暂停定时任务",
	"  /schedule resume <id>                 恢复定时任务",
	"",
	"创建定时任务请直接用自然语言告诉 Agent（支持固定间隔、cron 表达式、一次性定时）。",
].join("\n");

function getScheduler():
	| CommandResult
	| { scheduler: ReturnType<typeof getSchedulerService> & {} } {
	const scheduler = getSchedulerService();
	if (!scheduler) {
		return { type: "display", text: "定时任务服务未启用。" };
	}
	return { scheduler };
}

function formatTask(task: ScheduledTask): string {
	const desc = task.description || task.prompt.slice(0, 40);
	const schedule = formatSchedule(task.schedule);
	const nextRun =
		task.status === "completed" ? "已完成" : new Date(task.nextExecutionAt).toLocaleString("zh-CN");
	return `  ${task.id} | ${desc}\n    状态: ${task.status} | 调度: ${schedule} | 已执行: ${task.executionCount}次 | 下次: ${nextRun}`;
}

function buildScheduleListResult(tasks: ScheduledTask[]): CommandResult {
	if (tasks.length === 0) {
		return { type: "display", text: "暂无定时任务。" };
	}

	const lines = tasks.map(formatTask);
	const text = `定时任务列表:\n${lines.join("\n")}`;

	const actions: InteractiveAction[] = [];
	for (const task of tasks) {
		const label = task.description || task.prompt.slice(0, 20);
		if (task.status === "active") {
			actions.push({
				label: `暂停 ${label}`,
				value: { command: "schedule pause", taskId: task.id },
				buttonType: "default",
			});
		}
		if (task.status === "paused") {
			actions.push({
				label: `恢复 ${label}`,
				value: { command: "schedule resume", taskId: task.id },
				buttonType: "primary",
			});
		}
		actions.push({
			label: `删除 ${label}`,
			value: { command: "schedule delete", taskId: task.id },
			buttonType: "danger",
		});
	}
	return { type: "interactive", title: "Schedule", text, actions };
}

async function handleList(_ctx: CommandContext): Promise<CommandResult> {
	const result = getScheduler();
	if ("type" in result) return result;
	const { scheduler } = result;

	const tasks = await scheduler.listTasks();
	return buildScheduleListResult(tasks);
}

async function handleDelete(ctx: CommandContext): Promise<CommandResult> {
	const result = getScheduler();
	if ("type" in result) return result;
	const { scheduler } = result;

	const id = ctx.args[1];
	if (!id) {
		return { type: "display", text: "用法: /schedule delete <id>" };
	}

	const success = await scheduler.removeTask(id);
	if (!success) {
		return { type: "display", text: `任务未找到: ${id}` };
	}
	return buildScheduleListResult(await scheduler.listTasks());
}

async function handlePause(ctx: CommandContext): Promise<CommandResult> {
	const result = getScheduler();
	if ("type" in result) return result;
	const { scheduler } = result;

	const id = ctx.args[1];
	if (!id) {
		return { type: "display", text: "用法: /schedule pause <id>" };
	}

	const success = await scheduler.pauseTask(id);
	if (!success) {
		return { type: "display", text: `任务未找到: ${id}` };
	}
	return buildScheduleListResult(await scheduler.listTasks());
}

async function handleResume(ctx: CommandContext): Promise<CommandResult> {
	const result = getScheduler();
	if ("type" in result) return result;
	const { scheduler } = result;

	const id = ctx.args[1];
	if (!id) {
		return { type: "display", text: "用法: /schedule resume <id>" };
	}

	const success = await scheduler.resumeTask(id);
	if (!success) {
		return { type: "display", text: `任务未找到: ${id}` };
	}
	return buildScheduleListResult(await scheduler.listTasks());
}

export const scheduleCommand: CommandDefinition = {
	name: "schedule",
	description: "Manage scheduled tasks",
	usage: "/schedule <list|delete|pause|resume>",
	type: "local",
	async execute(ctx: CommandContext): Promise<CommandResult> {
		const sub = ctx.args[0];
		switch (sub) {
			case "list":
				return handleList(ctx);
			case "delete":
				return handleDelete(ctx);
			case "pause":
				return handlePause(ctx);
			case "resume":
				return handleResume(ctx);
			default:
				return { type: "display", text: USAGE };
		}
	},
};
