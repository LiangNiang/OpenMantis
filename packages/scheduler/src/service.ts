// src/scheduler/service.ts

import { MESSAGE_SOURCE, type GatewayResponse, type IncomingMessage } from "@openmantis/common/types/channels";
import type { Schedule, ScheduledTask } from "@openmantis/common/types/scheduler";
import { createLogger } from "@openmantis/common/logger";
import { calcInitialNextExecution, calcNextExecution, realignToFuture } from "./next-execution";
import type { ScheduleStore } from "./store";

const logger = createLogger("scheduler");

/**
 * Structural interface for the gateway. The scheduler only calls these two methods.
 * Using a structural interface avoids a circular dependency (core → scheduler → core).
 */
interface GatewayLike {
	handleMessage(incoming: IncomingMessage): Promise<GatewayResponse>;
	pushMessage(channelType: string, channelId: string, content: string): Promise<void>;
}

export class SchedulerService {
	private gateway: GatewayLike;
	private store: ScheduleStore;
	private tickInterval: Timer | null = null;
	/** Transient execution lock — not data, purely runtime state */
	private runningTasks = new Set<string>();

	constructor(gateway: GatewayLike, store: ScheduleStore) {
		this.gateway = gateway;
		this.store = store;
	}

	async start(): Promise<void> {
		logger.info("[scheduler] starting...");

		// Realign stale tasks to next future execution time
		const tasks = await this.store.listFull();
		const now = Date.now();
		let realigned = 0;

		for (const task of tasks) {
			if (task.status === "active" && task.nextExecutionAt <= now) {
				task.nextExecutionAt = realignToFuture(task.schedule, task.nextExecutionAt, now);
				await this.store.save(task);
				realigned++;
				logger.info(
					`[scheduler] realigned task ${task.id}, next: ${new Date(task.nextExecutionAt).toISOString()}`,
				);
			}
		}

		// Start timer loop (10 second resolution) — after realignment to avoid race
		this.tickInterval = setInterval(() => {
			this.tick().catch((err) => logger.error("[scheduler] tick error:", err));
		}, 10000);

		logger.info(`[scheduler] started, ${tasks.length} tasks loaded (${realigned} realigned)`);
	}

	async stop(): Promise<void> {
		logger.info("[scheduler] stopping...");
		if (this.tickInterval) {
			clearInterval(this.tickInterval);
			this.tickInterval = null;
		}
		// No need to persist — filesystem is already the single source of truth
		logger.info("[scheduler] stopped");
	}

	async addTask(
		opts: Omit<ScheduledTask, "id" | "status" | "executionCount" | "nextExecutionAt" | "createdAt">,
	): Promise<ScheduledTask> {
		const id = await this.store.generateId();
		const now = Date.now();
		const task: ScheduledTask = {
			id,
			prompt: opts.prompt,
			schedule: opts.schedule,
			originChannelType: opts.originChannelType,
			originChannelId: opts.originChannelId,
			targetChannelType: opts.targetChannelType,
			targetChannelId: opts.targetChannelId,
			status: "active",
			maxExecutions: opts.maxExecutions ?? (opts.schedule.type === "at" ? 1 : undefined),
			executionCount: 0,
			nextExecutionAt: calcInitialNextExecution(opts.schedule, now),
			createdAt: now,
			description: opts.description,
		};
		await this.store.save(task);
		logger.info(`[scheduler] created task: ${id}`);
		return task;
	}

	async updateTask(
		id: string,
		update: {
			prompt?: string;
			description?: string;
			schedule?: Schedule;
			targetChannelType?: string;
			targetChannelId?: string;
			maxExecutions?: number | null;
		},
	): Promise<ScheduledTask | undefined> {
		const task = await this.store.get(id);
		if (!task) return undefined;

		let scheduleChanged = false;
		let revived = false;

		// Merge fields
		if (update.prompt !== undefined) task.prompt = update.prompt;
		if (update.description !== undefined) task.description = update.description;
		if (update.schedule !== undefined) {
			scheduleChanged = true;
			task.schedule = update.schedule;
		}
		if (update.targetChannelType !== undefined) task.targetChannelType = update.targetChannelType;
		if (update.targetChannelId !== undefined) task.targetChannelId = update.targetChannelId;
		// Handle maxExecutions — null means remove limit
		if (update.maxExecutions !== undefined) {
			task.maxExecutions = update.maxExecutions === null ? undefined : update.maxExecutions;
		}

		// Revival: completed task with room to execute more
		if (
			task.status === "completed" &&
			(task.maxExecutions === undefined || task.executionCount < task.maxExecutions)
		) {
			task.status = "active";
			revived = true;
		}

		// Recalculate nextExecutionAt when schedule changed or task revived
		if (scheduleChanged || revived) {
			const now = Date.now();
			task.nextExecutionAt = calcInitialNextExecution(task.schedule, now);
		}

		await this.store.save(task);
		logger.info(`[scheduler] updated task: ${id}`);
		return task;
	}

	async removeTask(id: string): Promise<boolean> {
		const deleted = await this.store.delete(id);
		if (deleted) {
			this.runningTasks.delete(id);
			logger.info(`[scheduler] removed task: ${id}`);
		} else {
			logger.warn(`[scheduler] task not found: ${id}`);
		}
		return deleted;
	}

	async pauseTask(id: string): Promise<boolean> {
		const task = await this.store.get(id);
		if (!task) return false;
		task.status = "paused";
		await this.store.save(task);
		logger.debug(`[scheduler] paused task: ${id}`);
		return true;
	}

	async resumeTask(id: string): Promise<boolean> {
		const task = await this.store.get(id);
		if (!task) return false;
		task.status = "active";
		await this.store.save(task);
		logger.debug(`[scheduler] resumed task: ${id}`);
		return true;
	}

	async listTasks(): Promise<ScheduledTask[]> {
		return this.store.listFull();
	}

	async getTask(id: string): Promise<ScheduledTask | undefined> {
		return this.store.get(id);
	}

	private async tick(): Promise<void> {
		const now = Date.now();
		const tasks = await this.store.listFull();
		const dueTasks = tasks.filter(
			(task) =>
				task.status === "active" && task.nextExecutionAt <= now && !this.runningTasks.has(task.id),
		);

		// Execute due tasks concurrently
		await Promise.all(
			dueTasks.map((task) =>
				this.executeTask(task).catch((err) =>
					logger.error(`[scheduler] task ${task.id} execution failed:`, err),
				),
			),
		);
	}

	private async finalizeTask(taskId: string): Promise<void> {
		const current = await this.store.get(taskId);
		if (!current) {
			logger.warn(`[scheduler] task ${taskId} was deleted during execution`);
			return;
		}

		current.executionCount++;
		current.lastExecutedAt = Date.now();

		const next = calcNextExecution(current.schedule, current.nextExecutionAt);
		if (next === null) {
			current.status = "completed";
			logger.info(`[scheduler] task completed (one-time): ${current.id}`);
		} else {
			current.nextExecutionAt = next;
		}

		if (current.maxExecutions && current.executionCount >= current.maxExecutions) {
			current.status = "completed";
			logger.info(`[scheduler] task completed (max executions): ${current.id}`);
		}

		await this.store.save(current);
	}

	private async executeTask(task: ScheduledTask): Promise<void> {
		this.runningTasks.add(task.id);
		const startTime = Date.now();

		try {
			logger.debug(`[scheduler] executing task: ${task.id}`);

			// Create incoming message with task prompt
			// Always use a fresh route to avoid carrying over history from previous executions
			const freshRouteId = `sched-${task.id}-${Date.now()}`;
			const incoming: IncomingMessage = {
				channelType: task.originChannelType,
				channelId: task.originChannelId,
				routeId: freshRouteId,
				content: task.prompt,
				metadata: { source: MESSAGE_SOURCE.SCHEDULER },
			};

			// Execute through gateway (full agent pipeline)
			const gw = await this.gateway.handleMessage(incoming);
			const response = await gw.response;

			// Push result to target channel
			const targetType = task.targetChannelType ?? task.originChannelType;
			const targetId = task.targetChannelId ?? task.originChannelId;

			const prefix = task.description ? `[Scheduled: ${task.description}]` : `[Scheduled Task]`;
			const message = `${prefix}\n${response.content}`;

			await this.gateway.pushMessage(targetType, targetId, message);
		} catch (err) {
			logger.error(`[scheduler] task ${task.id} failed:`, err);
		} finally {
			await this.finalizeTask(task.id);
			this.runningTasks.delete(task.id);
			const elapsed = Date.now() - startTime;
			logger.debug(`[scheduler] task ${task.id} finished in ${elapsed}ms`);
		}
	}
}
