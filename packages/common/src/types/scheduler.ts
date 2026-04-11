export type Schedule =
	| { type: "every"; intervalMs: number }
	| { type: "cron"; expression: string; timezone: string }
	| { type: "at"; datetime: number; timezone: string };

export interface ScheduledTask {
	id: string;
	prompt: string;
	schedule: Schedule;
	originChannelType: string;
	originChannelId: string;
	targetChannelType?: string;
	targetChannelId?: string;
	status: "active" | "paused" | "completed";
	maxExecutions?: number;
	executionCount: number;
	lastExecutedAt?: number;
	nextExecutionAt: number;
	createdAt: number;
	description?: string;
}

export function formatSchedule(schedule: Schedule): string {
	switch (schedule.type) {
		case "every": {
			const minutes = Math.round(schedule.intervalMs / 60000);
			if (minutes < 60) return `每${minutes}分钟`;
			const hours = Math.round(minutes / 60);
			return `每${hours}小时`;
		}
		case "cron":
			return `cron: ${schedule.expression} (${schedule.timezone})`;
		case "at":
			return `定时: ${new Date(schedule.datetime).toLocaleString("zh-CN", { timeZone: schedule.timezone })} (${schedule.timezone})`;
	}
}
