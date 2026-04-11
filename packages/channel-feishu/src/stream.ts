import type * as Lark from "@larksuiteoapi/node-sdk";
import { createLogger } from "@openmantis/common/logger";
import { buildFinalCard, buildStoppedCard, buildStreamingCard, buildToolPanel } from "./cards";
import type { ToolEntry } from "./tool-summary";
import { renderToolEntries } from "./tool-summary";

const logger = createLogger("channel-feishu");

// StreamEvent matches the core gateway/stream-events.StreamEvent type.
// Defined here to avoid a runtime dep on @openmantis/core.
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

export async function streamReply(
	client: Lark.Client,
	chatId: string,
	eventStream: AsyncIterable<StreamEvent>,
	routeId?: string,
): Promise<string> {
	// --- Card state (single card) ---
	let cardId: string | null = null;
	let sequence = 1;
	let textContent = "";
	let lastTextFlush = 0;
	const THROTTLE_MS = 300;

	// --- Tool panel state ---
	let toolPanelInserted = false;
	let toolPanelFailed = false;
	const toolEntries: ToolEntry[] = [];
	let toolLastFlush = 0;

	// --- Helper: create and send the streaming card ---
	const ensureCard = async () => {
		if (cardId) return;
		const cardRes = await client.cardkit.v1.card.create({
			data: { type: "card_json", data: buildStreamingCard(routeId) },
		});
		if (!cardRes.data?.card_id) {
			throw new Error(`Failed to create card: code=${cardRes.code}, msg=${cardRes.msg}`);
		}
		cardId = cardRes.data.card_id;
		await client.im.v1.message.create({
			params: { receive_id_type: "chat_id" },
			data: {
				receive_id: chatId,
				msg_type: "interactive",
				content: JSON.stringify({ type: "card", data: { card_id: cardId } }),
			},
		});
		logger.debug(`[feishu] streaming card created: cardId=${cardId}, chatId=${chatId}`);
	};

	// --- Helper: insert tool panel before md_1 ---
	const ensureToolPanel = async () => {
		if (toolPanelInserted || toolPanelFailed || !cardId) return;
		try {
			await client.cardkit.v1.cardElement.create({
				path: { card_id: cardId },
				data: {
					type: "insert_before",
					target_element_id: "md_1",
					elements: JSON.stringify([buildToolPanel()]),
					sequence,
				},
			});
			sequence++;
			toolPanelInserted = true;
			logger.debug(`[feishu] tool panel inserted: cardId=${cardId}`);
		} catch (err) {
			toolPanelFailed = true;
			logger.warn(`[feishu] failed to insert tool panel: ${err}`);
		}
	};

	// --- Helper: flush tool panel content ---
	const flushToolPanel = async () => {
		if (!cardId || !toolPanelInserted || toolEntries.length === 0) return;
		try {
			const content = renderToolEntries(toolEntries);
			await client.cardkit.v1.cardElement.content({
				path: { card_id: cardId, element_id: "tool_md" },
				data: { content, sequence },
			});
			sequence++;
			toolLastFlush = Date.now();
		} catch (err) {
			logger.warn(`[feishu] failed to flush tool panel: ${err}`);
		}
	};

	// --- Helper: flush reply text ---
	const flushText = async (content: string) => {
		if (!cardId) return;
		await client.cardkit.v1.cardElement.content({
			path: { card_id: cardId, element_id: "md_1" },
			data: { content, sequence },
		});
		sequence++;
		lastTextFlush = Date.now();
	};

	// --- Cleanup helper ---
	const cleanupCard = async () => {
		if (cardId) {
			await closeStreamingMode(client, cardId, sequence);
		}
	};

	// --- Stream processing ---
	let aborted = false;
	try {
		for await (const event of eventStream) {
			switch (event.type) {
				case "tool-start": {
					await ensureCard();
					await ensureToolPanel();
					toolEntries.push({
						toolName: event.toolName,
						status: "running",
						startTime: Date.now(),
					});
					await flushToolPanel();
					break;
				}
				case "tool-call": {
					const entry = findToolEntry(toolEntries, event.toolName, ["running"]);
					if (entry) {
						entry.status = "called";
						entry.args = event.args;
					}
					// Force flush so args are visible before tool executes
					await flushToolPanel();
					break;
				}
				case "tool-end": {
					const entry = findToolEntry(toolEntries, event.toolName, ["running", "called"]);
					if (entry) {
						entry.status = event.error ? "error" : "done";
						if (event.args) entry.args = event.args;
						entry.result = event.result;
						entry.error = event.error;
						entry.duration = Date.now() - entry.startTime;
					}
					await flushToolPanel();
					break;
				}
				case "text-delta": {
					await ensureCard();
					textContent += event.text;
					const now = Date.now();
					if (now - lastTextFlush >= THROTTLE_MS) {
						await flushText(textContent);
					}
					break;
				}
				case "aborted":
					aborted = true;
					break;
				default:
					continue;
			}
			if (aborted) break;
		}

		// --- Abort handling ---
		if (aborted) {
			logger.info(`[feishu] stream aborted`);
			if (cardId) {
				const toolContent = toolPanelInserted ? renderToolEntries(toolEntries) : undefined;
				try {
					await closeStreamingMode(client, cardId, sequence);
					sequence++;
					await client.cardkit.v1.card.update({
						path: { card_id: cardId },
						data: {
							card: {
								type: "card_json",
								data: buildStoppedCard(textContent, toolContent),
							},
							sequence,
						},
					});
				} catch (err) {
					logger.warn(`[feishu] failed to swap to stopped card: ${err}`);
				}
			}
			return textContent;
		}

		// --- Finalize ---
		if (!cardId) {
			await ensureCard();
		}

		// Final text flush
		await flushText(textContent || "(empty response)");
		logger.debug(
			`[feishu] stream finished: cardId=${cardId}, totalLen=${textContent.length}`,
		);

		// Close streaming mode and swap to final card
		await closeStreamingMode(client, cardId!, sequence);
		sequence++;

		const toolContent = toolPanelInserted ? renderToolEntries(toolEntries) : undefined;
		try {
			await client.cardkit.v1.card.update({
				path: { card_id: cardId! },
				data: {
					card: {
						type: "card_json",
						data: buildFinalCard(textContent || "(empty response)", toolContent),
					},
					sequence,
				},
			});
		} catch (err) {
			logger.warn(`[feishu] failed to swap to final card: ${err}`);
		}

		return textContent;
	} catch (err) {
		await cleanupCard();
		throw err;
	}
}

/** Find the last matching tool entry by name and status. */
function findToolEntry(
	entries: ToolEntry[],
	toolName: string,
	statuses: string[],
): ToolEntry | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i]!;
		if (e.toolName === toolName && statuses.includes(e.status)) return e;
	}
	return undefined;
}

/** Close streaming mode on a card. */
async function closeStreamingMode(
	client: Lark.Client,
	cardId: string,
	sequence: number,
): Promise<void> {
	try {
		await client.cardkit.v1.card.settings({
			path: { card_id: cardId },
			data: {
				settings: JSON.stringify({ config: { streaming_mode: false } }),
				sequence,
			},
		});
	} catch (err) {
		logger.warn(`[feishu] failed to close streaming mode for card ${cardId}: ${err}`);
	}
}
