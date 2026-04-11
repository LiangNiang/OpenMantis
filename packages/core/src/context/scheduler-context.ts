// src/context/scheduler-context.ts
import type { SchedulerService } from "@openmantis/scheduler/service";

let currentScheduler: SchedulerService | null = null;

export function setSchedulerService(scheduler: SchedulerService): void {
	currentScheduler = scheduler;
}

export function getSchedulerService(): SchedulerService | null {
	return currentScheduler;
}
