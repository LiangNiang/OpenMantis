import { basename, extname } from "node:path";
import { createLogger } from "@openmantis/common/logger";
import { tool } from "ai";
import { z } from "zod";
import { getFeishuClient } from "./context";

const logger = createLogger("channel-feishu/tools");

// ─── Helpers ────────────────────────────────────────────────────────────────

const FILE_TYPE_MAP: Record<string, string> = {
	pdf: "pdf",
	doc: "doc",
	docx: "doc",
	xls: "xls",
	xlsx: "xls",
	ppt: "ppt",
	pptx: "ppt",
	mp4: "mp4",
	opus: "opus",
};

type LarkFileType = "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream";

export function inferFileType(filename: string): string {
	const ext = extname(filename).replace(/^\./, "").toLowerCase();
	return FILE_TYPE_MAP[ext] ?? "stream";
}

export function isImageMimeType(mimeType: string | undefined): boolean {
	return typeof mimeType === "string" && mimeType.startsWith("image/");
}

const IMAGE_SIZE_LIMIT = 10 * 1024 * 1024; // 10 MB
const FILE_SIZE_LIMIT = 30 * 1024 * 1024; // 30 MB

function formatLarkError(err: any): string {
	const larkError = Array.isArray(err) ? err[1] : err;
	const code = larkError?.code;
	const msg = larkError?.msg ?? (err instanceof Error ? err.message : String(err));
	if (code === 99991672) {
		return "飞书应用缺少权限。请到飞书开发者后台为该应用开通所需权限并发布新版本。";
	}
	return msg;
}

// ─── Tool guide ─────────────────────────────────────────────────────────────

export const FEISHU_TOOL_GUIDE = `### 飞书专属工具

#### @mention（at 用户）
你的回复会以飞书卡片发送，卡片 markdown 原生支持 \`<at>\` 标签：
- **@ 指定用户**：\`<at id="ou_xxx"></at>\`（使用 open_id）
- **@ 指定用户（邮箱）**：\`<at email="xxx@example.com"></at>\`
- **@ 所有人**：\`<at id="all"></at>\`

你可以在回复文本中直接使用以上标签来 at 用户，无需调用额外工具。
如果你需要知道群成员的 open_id，请调用 feishu_get_chat_members 工具。

#### 发送文件/图片
使用 feishu_send_file 工具可以向当前对话发送本地文件或图片。工具会自动识别图片类型，图片默认以独立消息发送（支持点击放大），非图片文件以文件消息发送。`;

// ─── Tool factory ───────────────────────────────────────────────────────────

export function createFeishuTools(channelType: string, chatId: string): Record<string, any> {
	return {
		feishu_get_chat_members: tool({
			description:
				"获取当前飞书群聊的成员列表（包含 open_id、名称等），用于获取群成员信息以便 @mention。",
			inputSchema: z.object({
				pageToken: z
					.string()
					.optional()
					.describe("分页标记，首次请求不填，后续请求使用上次返回的 page_token"),
				pageSize: z
					.number()
					.max(100)
					.optional()
					.default(20)
					.describe("每页数量，默认 20，最大 100"),
			}),
			execute: async (input) => {
				const client = getFeishuClient(channelType);
				if (!client) return "失败: 飞书客户端未初始化";
				try {
					const res = await client.im.v1.chatMembers.get({
						path: { chat_id: chatId },
						params: {
							member_id_type: "open_id",
							page_size: input.pageSize ?? 20,
							...(input.pageToken ? { page_token: input.pageToken } : {}),
						},
					});

					if (!res?.data?.items?.length) {
						return "当前群聊没有成员或无权限获取";
					}

					const members = res.data.items.map((m: any) => ({
						memberId: m.member_id,
						name: m.name,
						memberIdType: m.member_id_type,
					}));

					return {
						members,
						hasMore: res.data.has_more ?? false,
						pageToken: res.data.page_token ?? null,
						total: members.length,
					};
				} catch (err: any) {
					logger.error("[tool:feishu] get_chat_members failed:", err);
					return `获取群成员失败: ${formatLarkError(err)}`;
				}
			},
		}),

		feishu_send_file: tool({
			description:
				"将本地文件（图片、PDF、Excel、Word、PPT 等任意格式）上传到飞书并发送给当前用户。自动识别图片类型，图片默认以独立消息发送（支持点击放大），也可嵌入卡片。",
			inputSchema: z.object({
				path: z.string().describe("本地文件路径（绝对路径或相对项目根目录的路径）"),
				filename: z
					.string()
					.optional()
					.describe("覆盖显示名称，默认使用文件原始名"),
				sendImageAs: z
					.enum(["message", "card_embed"])
					.optional()
					.default("message")
					.describe(
						"仅图片有效。message: 独立图片气泡（支持点击放大）；card_embed: 嵌入卡片",
					),
				caption: z
					.string()
					.optional()
					.describe("仅图片且 sendImageAs=card_embed 时有效，显示在图片下方的文字说明"),
			}),
			execute: async ({ path, filename, sendImageAs, caption }) => {
				const client = getFeishuClient(channelType);
				if (!client) return { success: false, error: "飞书客户端未初始化" };

				const file = Bun.file(path);
				if (!(await file.exists())) {
					return { success: false, error: `文件不存在: ${path}` };
				}

				const displayName = filename ?? basename(path);
				const isImage = isImageMimeType(file.type);

				// ── Image path ──────────────────────────────────────────
				if (isImage) {
					if (file.size > IMAGE_SIZE_LIMIT) {
						return {
							success: false,
							error: `图片文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），飞书限制 10 MB。`,
						};
					}

					const buffer = Buffer.from(await file.arrayBuffer());

					let imageKey: string;
					try {
						const uploadRes = await client.im.v1.image.create({
							data: { image_type: "message", image: buffer },
						});
						if (!uploadRes?.image_key) {
							return { success: false, error: "上传图片失败: 未返回 image_key" };
						}
						imageKey = uploadRes.image_key;
					} catch (err: any) {
						logger.error("[tool:feishu] upload image failed:", err);
						return { success: false, error: `上传图片异常: ${formatLarkError(err)}` };
					}

					try {
						if (sendImageAs === "card_embed") {
							const elements: any[] = [
								{
									tag: "img",
									img_key: imageKey,
									alt: { tag: "plain_text", content: "" },
								},
							];
							if (caption) {
								elements.push({ tag: "markdown", content: caption });
							}
							const card = JSON.stringify({ schema: "2.0", body: { elements } });
							const res = await client.im.v1.message.create({
								params: { receive_id_type: "chat_id" },
								data: {
									receive_id: chatId,
									msg_type: "interactive",
									content: card,
								},
							});
							return {
								success: true,
								messageId: res.data?.message_id ?? "",
								note: "图片已以卡片形式发送",
							};
						}

						const res = await client.im.v1.message.create({
							params: { receive_id_type: "chat_id" },
							data: {
								receive_id: chatId,
								msg_type: "image",
								content: JSON.stringify({ image_key: imageKey }),
							},
						});
						return {
							success: true,
							messageId: res.data?.message_id ?? "",
							note: "图片已发送",
						};
					} catch (err: any) {
						logger.error("[tool:feishu] send image failed:", err);
						return {
							success: false,
							error: `发送图片消息异常: ${formatLarkError(err)}`,
						};
					}
				}

				// ── General file path ───────────────────────────────────
				if (file.size > FILE_SIZE_LIMIT) {
					return {
						success: false,
						error: `文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），飞书限制 30 MB。`,
					};
				}

				const fileType = inferFileType(displayName) as LarkFileType;
				const buffer = Buffer.from(await file.arrayBuffer());

				let fileKey: string;
				try {
					const uploadRes = await client.im.v1.file.create({
						data: {
							file_type: fileType,
							file_name: displayName,
							file: buffer,
						},
					});
					if (!uploadRes?.file_key) {
						return { success: false, error: "上传文件失败: 未返回 file_key" };
					}
					fileKey = uploadRes.file_key;
				} catch (err: any) {
					logger.error("[tool:feishu] upload file failed:", err);
					return { success: false, error: `上传文件异常: ${formatLarkError(err)}` };
				}

				try {
					const res = await client.im.v1.message.create({
						params: { receive_id_type: "chat_id" },
						data: {
							receive_id: chatId,
							msg_type: "file",
							content: JSON.stringify({ file_key: fileKey }),
						},
					});
					return {
						success: true,
						messageId: res.data?.message_id ?? "",
						note: `文件「${displayName}」已发送`,
					};
				} catch (err: any) {
					logger.error("[tool:feishu] send file failed:", err);
					return { success: false, error: `发送文件消息异常: ${formatLarkError(err)}` };
				}
			},
		}),
	};
}
