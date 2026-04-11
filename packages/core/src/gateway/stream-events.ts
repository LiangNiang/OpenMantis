import { createLogger } from "@openmantis/common/logger";

const logger = createLogger("core/gateway");

export type StreamEvent =
	| { type: "text-delta"; text: string }
	| { type: "tool-start"; toolName: string; args: string }
	| { type: "tool-call"; toolName: string; args: Record<string, unknown> }
	| {
			type: "tool-end";
			toolName: string;
			args?: Record<string, unknown>;
			result?: string;
			error?: string;
	  }
	| { type: "step-start" }
	| { type: "step-end" }
	| { type: "error"; message: string }
	| { type: "aborted" };

/**
 * Convert AI SDK fullStream events into OpenMantis StreamEvents.
 */
export async function* toStreamEvents(
	fullStream: AsyncIterable<{ type: string; [key: string]: any }>,
): AsyncGenerator<StreamEvent> {
	for await (const part of fullStream) {
		switch (part.type) {
			case "text-delta":
				yield { type: "text-delta", text: part.text };
				break;
			case "tool-input-start": {
				yield { type: "tool-start", toolName: part.toolName, args: "" };
				break;
			}
			case "tool-call": {
				yield { type: "tool-call", toolName: part.toolName, args: part.input ?? part.args ?? {} };
				break;
			}
			case "tool-result": {
				const toolId = part.toolCallId ?? part.id;
				logger.debug(`[stream] tool-result: toolName=${part.toolName}, toolCallId=${toolId}`);
				const raw = part.output ?? part.result;
				let result: string | undefined;
				try {
					result = typeof raw === "string" ? raw : JSON.stringify(raw);
				} catch {
					result = String(raw);
				}
				const args = part.input ?? part.args;
				yield {
					type: "tool-end",
					toolName: part.toolName,
					args: typeof args === "object" && args !== null ? args : undefined,
					result,
				};
				break;
			}
			case "tool-error": {
				const toolId = part.toolCallId ?? part.id;
				const errorMsg =
					part.error instanceof Error ? part.error.message : String(part.error ?? "unknown");
				logger.error(
					`[stream] tool-error: toolName=${part.toolName}, toolCallId=${toolId}, error=${errorMsg}`,
				);
				yield { type: "tool-end", toolName: part.toolName, error: errorMsg };
				break;
			}
			case "start-step":
				yield { type: "step-start" };
				break;
			case "finish-step":
				yield { type: "step-end" };
				break;
		}
	}
}
