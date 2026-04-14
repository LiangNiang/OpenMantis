const BASE_URL = ""

interface ApiResponse<T = unknown> {
	success: boolean
	data?: T
	error?: string
}

export type ReasoningEffort =
	| "off"
	| "auto"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "max"

export interface ModelConfig {
	id: string
	reasoningEffort?: ReasoningEffort
	temperature?: number
	topP?: number
	providerOptions?: Record<string, unknown>
}

export interface ProviderConfig {
	name: string
	provider: string
	model: ModelConfig
	apiKey: string
	baseUrl?: string
	webSearch?: {
		enabled: boolean
		forceSearch?: boolean
		maxKeyword?: number
	}
}

export class ApiError extends Error {
	status: number
	constructor(message: string, status: number) {
		super(message)
		this.status = status
	}
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
	const res = await fetch(`${BASE_URL}${path}`, {
		...options,
		headers: {
			"Content-Type": "application/json",
			...options?.headers,
		},
	})
	const body: ApiResponse<T> = await res.json()
	if (!res.ok || !body.success) {
		throw new ApiError(body.error ?? `Request failed: ${res.status}`, res.status)
	}
	return body.data as T
}

export const api = {
	getConfig: () => request<Record<string, any>>("/api/config"),
	getConfigRaw: () => request<Record<string, any>>("/api/config/raw"),
	updateConfig: (partial: Record<string, any>) =>
		request<{ updated: boolean; restartRequired: boolean }>("/api/config", {
			method: "PUT",
			body: JSON.stringify(partial),
		}),
	resetConfig: (keys?: string[]) =>
		request<{ reset: boolean; restartRequired: boolean }>("/api/config/reset", {
			method: "POST",
			body: JSON.stringify({ keys }),
		}),
	testProvider: (params: {
		provider: string
		apiKey: string
		model: string
		baseUrl?: string
	}) =>
		request<{ connected: boolean; error?: string }>("/api/config/test-provider", {
			method: "POST",
			body: JSON.stringify(params),
		}),
	hasConfig: () => request<{ hasConfig: boolean }>("/api/config/has-config"),
	getRestartRequired: () =>
		request<{ restartRequired: boolean }>("/api/config/restart-required"),
	getStatus: () =>
		request<{
			startTime: number
			uptime: number
			defaultProvider: string
			provider: string
			model: string
			providers: { name: string; provider: string; model: string }[]
			channels: string[]
			hasConfig: boolean
		}>("/api/status"),
	restart: () =>
		request<{ restarting: boolean; devMode: boolean }>("/api/restart", {
			method: "POST",
		}),
}
