import type { ConfigStore } from "@openmantis/core/config/store";
import type { Gateway } from "@openmantis/core/gateway/gateway";
import type { SchedulerService } from "@openmantis/scheduler/service";

export interface WebServerContext {
	configStore: ConfigStore;
	gateway?: Gateway;
	scheduler?: SchedulerService;
	authToken?: string;
}

export interface ApiResponse<T = unknown> {
	success: boolean;
	data?: T;
	error?: string;
}

export function ok<T>(data: T): ApiResponse<T> {
	return { success: true, data };
}

export function err(error: string): ApiResponse {
	return { success: false, error };
}
