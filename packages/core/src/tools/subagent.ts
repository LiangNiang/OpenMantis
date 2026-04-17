import { AsyncLocalStorage } from "node:async_hooks";
import type { OpenMantisConfig } from "@openmantis/common/config/schema";
import { createLogger } from "@openmantis/common/logger";
import { type Tool, tool } from "ai";
import { z } from "zod";
import { AgentFactory } from "../agent/factory";

const logger = createLogger("core/tools");

const MAX_DEPTH = 2;
const MAX_CONCURRENCY = 8;
const TIMEOUT_MS = 300_000;

const DEFAULT_ALLOWED_TOOL_GROUPS = [
	"bash",
	"file",
	"search",
	"tavily",
	"exa",
	"rss",
	"skills",
	"subagent",
];

const DEFAULT_SUBAGENT_PROMPT = `You are a subagent dispatched by another agent.
Your response will be returned as a tool result.
Be direct and concise. No chitchat, no clarifying questions, no meta-commentary.
If the task is unclear, make the most reasonable interpretation and proceed.
Return only the final answer.`;

class Semaphore {
	private permits: number;
	private queue: Array<() => void> = [];

	constructor(permits: number) {
		this.permits = permits;
	}

	async acquire(): Promise<void> {
		if (this.permits > 0) {
			this.permits--;
			return;
		}
		return new Promise<void>((resolve) => {
			this.queue.push(resolve);
		});
	}

	release(): void {
		const next = this.queue.shift();
		if (next) {
			next();
		} else {
			this.permits++;
		}
	}
}

const semaphore = new Semaphore(MAX_CONCURRENCY);

const depthStorage = new AsyncLocalStorage<{ depth: number }>();

export const SUBAGENT_TOOL_GUIDE =
	"- **subagent**: Dispatch a fresh, context-isolated child agent to execute an independent task. " +
	"Use for (a) long/complex subtasks you don't want polluting your own context, " +
	"(b) parallel fan-out — invoking multiple subagent calls in the same response runs them concurrently. " +
	"Input: `prompt` (required task description), optional `systemPrompt` (override default), optional `provider`. " +
	"Child has a reduced toolset (no memory/message/schedule/TTS). " +
	"Returns `{ success, text }` or `{ success: false, error }`. Depth cap: 2; concurrency cap: 8; timeout: 5 min.";

export function createSubagentTools(config: OpenMantisConfig): Record<string, Tool> {
	const inputSchema = z.object({
		prompt: z.string().min(1).describe("The task for the subagent to execute. Single-turn."),
		systemPrompt: z
			.string()
			.optional()
			.describe("Override the default subagent system prompt. Caller fully owns the string."),
		provider: z
			.string()
			.optional()
			.describe("Provider name from config.providers[]. Defaults to config.defaultProvider."),
	});

	const subagentTool = tool({
		description:
			"Dispatch a fresh, isolated child agent. Context is NOT inherited from the parent. " +
			"Multiple calls in one response run in parallel. Max depth 2, max 8 concurrent, 5 min timeout.",
		inputSchema,
		execute: async (
			{ prompt, systemPrompt, provider }: z.infer<typeof inputSchema>,
			options?: { abortSignal?: AbortSignal },
		) => {
			const parentSignal = options?.abortSignal;

			const current = depthStorage.getStore();
			const depth = current?.depth ?? 0;
			if (depth >= MAX_DEPTH) {
				return {
					success: false,
					error: `Max subagent depth (${MAX_DEPTH}) exceeded. Cannot dispatch from a grandchild agent.`,
				};
			}

			await semaphore.acquire();
			const started = Date.now();
			const timeoutCtrl = new AbortController();
			const linkedSignal = parentSignal
				? AbortSignal.any([parentSignal, timeoutCtrl.signal])
				: timeoutCtrl.signal;
			const timer = setTimeout(() => timeoutCtrl.abort(), TIMEOUT_MS);

			try {
				const factory = new AgentFactory(config);
				const { agent } = await factory.createHeadless({
					systemPrompt: systemPrompt ?? DEFAULT_SUBAGENT_PROMPT,
					provider,
					allowedToolGroups: DEFAULT_ALLOWED_TOOL_GROUPS,
				});

				const result = await depthStorage.run({ depth: depth + 1 }, () =>
					agent.generate({
						messages: [{ role: "user", content: prompt }],
						abortSignal: linkedSignal,
					}),
				);

				logger.debug(
					`[subagent] depth=${depth + 1} provider=${provider ?? "default"} ` +
						`prompt="${prompt.slice(0, 100).replace(/\s+/g, " ")}" ` +
						`duration=${Date.now() - started}ms steps=${result.steps.length} success=true`,
				);
				return { success: true, text: result.text };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);

				if (parentSignal?.aborted) {
					throw err;
				}

				if (timeoutCtrl.signal.aborted) {
					logger.warn(`[subagent] timeout after ${TIMEOUT_MS}ms`);
					return {
						success: false,
						error: `Subagent timed out after ${TIMEOUT_MS / 1000}s`,
					};
				}

				logger.warn(`[subagent] failed: ${message}`);
				return { success: false, error: `Subagent failed: ${message}` };
			} finally {
				clearTimeout(timer);
				semaphore.release();
			}
		},
	});

	return { subagent: subagentTool };
}
