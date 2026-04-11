// src/scheduler/next-execution.ts

import { CronExpressionParser } from "cron-parser";
import type { Schedule } from "@openmantis/common/types/scheduler";

/**
 * Calculate the first nextExecutionAt for a newly created task.
 */
export function calcInitialNextExecution(schedule: Schedule, now: number): number {
	switch (schedule.type) {
		case "every":
			return now + schedule.intervalMs;
		case "cron": {
			const interval = CronExpressionParser.parse(schedule.expression, {
				currentDate: new Date(now),
				tz: schedule.timezone,
			});
			return interval.next().getTime();
		}
		case "at":
			return schedule.datetime;
	}
}

/**
 * Calculate the next execution time after a task has just executed.
 * `previousNextExecutionAt` is the planned execution time (not actual),
 * used for "every" mode to prevent drift.
 */
export function calcNextExecution(
	schedule: Schedule,
	previousNextExecutionAt: number,
): number | null {
	switch (schedule.type) {
		case "every":
			return previousNextExecutionAt + schedule.intervalMs;
		case "cron": {
			const interval = CronExpressionParser.parse(schedule.expression, {
				currentDate: new Date(previousNextExecutionAt),
				tz: schedule.timezone,
			});
			return interval.next().getTime();
		}
		case "at":
			// One-time task, no next execution
			return null;
	}
}

/**
 * Realign a stale task (nextExecutionAt is in the past) to the next future time.
 */
export function realignToFuture(
	schedule: Schedule,
	staleNextExecutionAt: number,
	now: number,
): number {
	switch (schedule.type) {
		case "every": {
			const missed = Math.ceil((now - staleNextExecutionAt) / schedule.intervalMs);
			return staleNextExecutionAt + missed * schedule.intervalMs;
		}
		case "cron": {
			const interval = CronExpressionParser.parse(schedule.expression, {
				currentDate: new Date(now),
				tz: schedule.timezone,
			});
			return interval.next().getTime();
		}
		case "at":
			// If in the past but never executed, keep as-is (will be executed immediately)
			return staleNextExecutionAt;
	}
}
