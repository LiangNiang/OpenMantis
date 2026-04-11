import type { WSClient, WsFrameHeaders } from "@wecom/aibot-node-sdk";
import type { OutgoingMessage, ToolCallInfo } from "@openmantis/common/types/channels";
import { createLogger } from "@openmantis/common/logger";

const logger = createLogger("channel-wecom");

export type StreamEvent =
	| { type: "text-delta"; text: string }
	| { type: "tool-start"; toolName: string; args: string }
	| { type: "tool-end"; toolName: string }
	| { type: "step-start" }
	| { type: "step-end" }
	| { type: "error"; message: string }
	| { type: "aborted" };

/**
 * Consume a Gateway stream and send streaming replies via WeCom long connection.
 *
 * Uses WSClient.replyStream() with a consistent streamId to create and update
 * a streaming message. All replies for the same callback must share the same req_id.
 *
 * 6-minute timeout: WeCom auto-closes streaming messages after 6 minutes.
 */
export async function streamWeComResponse(
	client: WSClient,
	frame: WsFrameHeaders,
	eventStream: AsyncIterable<StreamEvent>,
): Promise<OutgoingMessage> {
	const streamId = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	let textContent = "";
	const toolCalls: ToolCallInfo[] = [];
	const toolHistory: string[] = [];
	const MAX_TOOL_HISTORY = 3;
	let lastFlush = 0;
	const THROTTLE_MS = 300;
	const TIMEOUT_MS = 5.5 * 60 * 1000; // 5.5 min (safety margin before 6 min)
	const startTime = Date.now();

	const buildDisplay = (): string => {
		const statusBlock = toolHistory.length > 0 ? `\n\n---\n${toolHistory.join("\n")}` : "";
		return (textContent || "...") + statusBlock;
	};

	const flush = async (finish: boolean) => {
		const content = finish ? textContent || "(empty response)" : buildDisplay();
		await client.replyStream(frame, streamId, content, finish);
		lastFlush = Date.now();
	};

	for await (const event of eventStream) {
		// Safety timeout
		if (Date.now() - startTime > TIMEOUT_MS) {
			logger.warn("[wecom] stream approaching 6-min timeout, finishing early");
			break;
		}

		switch (event.type) {
			case "text-delta":
				textContent += event.text;
				break;
			case "aborted":
				logger.info("[wecom] received aborted event, appending stopped marker");
				textContent += "\n\n⏹ 已停止";
				break;
			case "tool-start":
				toolHistory.push(`⚙️ ${event.toolName}...`);
				if (toolHistory.length > MAX_TOOL_HISTORY) toolHistory.shift();
				break;
			case "tool-end": {
				const idx = toolHistory.findLastIndex(
					(s) => s.includes(event.toolName) && s.endsWith("..."),
				);
				if (idx >= 0) {
					toolHistory[idx] = `✓ ${event.toolName}`;
				}
				toolCalls.push({
					name: event.toolName,
					args: {},
					result: "completed",
				});
				break;
			}
			default:
				continue;
		}

		const now = Date.now();
		if (now - lastFlush >= THROTTLE_MS) {
			await flush(false);
		}
	}

	// Final flush — send text only, remove tool status
	await flush(true);

	logger.debug(`[wecom] stream finished: streamId=${streamId}, totalLen=${textContent.length}`);

	return {
		content: textContent,
		toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
	};
}
