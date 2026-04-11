import { basename, extname } from "node:path";
import type { WSClient } from "@wecom/aibot-node-sdk";
import { tool } from "ai";
import { z } from "zod";

// ── WeComDoc MCP helpers ──

const WECOM_DOC_TIMEOUT = 20000;

async function callWecomDocMcp(
	mcpUrl: string,
	toolName: string,
	args: Record<string, unknown>,
): Promise<string> {
	const response = await fetch(mcpUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			method: "tools/call",
			params: { name: toolName, arguments: args },
			id: 1,
		}),
		signal: AbortSignal.timeout(WECOM_DOC_TIMEOUT),
	});

	if (!response.ok) {
		return `WeComDoc API error: HTTP ${response.status} ${response.statusText}`;
	}

	const data = await response.json();

	if (data.error) {
		return `WeComDoc API error: ${data.error.message ?? JSON.stringify(data.error)}`;
	}

	const result = data.result;
	if (result?.content) {
		return result.content
			.map((c: { type: string; text?: string }) => (c.type === "text" ? c.text : JSON.stringify(c)))
			.join("\n");
	}

	return JSON.stringify(result);
}

function wrapExecute(mcpUrl: string, toolName: string) {
	return async (input: Record<string, unknown>) => {
		try {
			return await callWecomDocMcp(mcpUrl, toolName, input);
		} catch (error) {
			if (error instanceof DOMException && error.name === "TimeoutError") {
				return "WeComDoc API error: request timed out (20s)";
			}
			return `WeComDoc API error: ${error instanceof Error ? error.message : String(error)}`;
		}
	};
}

const fieldTypeEnum = z.enum([
	"FIELD_TYPE_TEXT",
	"FIELD_TYPE_NUMBER",
	"FIELD_TYPE_CHECKBOX",
	"FIELD_TYPE_DATE_TIME",
	"FIELD_TYPE_IMAGE",
	"FIELD_TYPE_USER",
	"FIELD_TYPE_URL",
	"FIELD_TYPE_SELECT",
	"FIELD_TYPE_PROGRESS",
	"FIELD_TYPE_PHONE_NUMBER",
	"FIELD_TYPE_EMAIL",
	"FIELD_TYPE_SINGLE_SELECT",
	"FIELD_TYPE_LOCATION",
	"FIELD_TYPE_CURRENCY",
	"FIELD_TYPE_PERCENTAGE",
	"FIELD_TYPE_BARCODE",
]);

// ── WeComDoc tools ──

export function createWecomDocTools(mcpUrl: string) {
	return {
		create_doc: tool({
			description:
				'新建文档或智能表格。新建成功后返回文档访问链接和 docid（docid 仅在创建时返回，需妥善保存）。注意：创建智能表格（doc_type=10）时，文档会默认包含一个子表，可通过 smartsheet_get_sheet 查询其 sheet_id，无需额外调用 smartsheet_add_sheet。\nWARNING: 创建智能表格后，默认子表自带一个默认字段（标题"文本"）。你在添加字段前，必须按以下步骤处理：\n1. 调用 smartsheet_get_fields 获取默认字段的 field_id\n2. 调用 smartsheet_update_fields 将默认字段重命名为你需要的第一个字段\n3. 调用 smartsheet_add_fields 只添加剩余字段\n如果跳过步骤1-2直接 add_fields，会多出一个无用的默认列。',
			inputSchema: z.object({
				doc_type: z
					.preprocess(
						(v) => (typeof v === "string" ? Number(v) : v),
						z.union([z.literal(3), z.literal(10)]),
					)
					.describe("文档类型：3-文档，10-智能表格"),
				doc_name: z.string().describe("文档名字，最多 255 个字符，超过会被截断"),
			}),
			execute: wrapExecute(mcpUrl, "create_doc"),
		}),

		edit_doc_content: tool({
			description:
				'编辑文档内容。content 参数直接传入 Markdown 原文，例如 "# 标题\\n正文内容"，不要将 Markdown 文本再用引号包成 JSON 字符串。',
			inputSchema: z.object({
				docid: z.string().describe("文档 id"),
				content: z
					.string()
					.describe(
						"覆写的文档内容，直接传入原始 Markdown 文本，不要对内容做额外的 JSON 转义或用引号包裹",
					),
				content_type: z
					.preprocess((v) => (typeof v === "string" ? Number(v) : v), z.literal(1))
					.describe("内容类型格式。1:markdown"),
			}),
			execute: wrapExecute(mcpUrl, "edit_doc_content"),
		}),

		smartsheet_add_sheet: tool({
			description:
				'在指定文档中添加一个空的智能表（子表）。注意：新建的智能表格文档默认已包含一个子表，仅在需要多个子表时才需调用此接口。\nWARNING: 新建的子表自带一个默认字段（标题"智能表列"）。你在添加字段前，必须按以下步骤处理：\n1. 调用 smartsheet_get_fields 获取默认字段的 field_id\n2. 调用 smartsheet_update_fields 将默认字段重命名为你需要的第一个字段\n3. 调用 smartsheet_add_fields 只添加剩余字段\n如果跳过步骤1-2直接 add_fields，表格会多出一个无用的默认列。',
			inputSchema: z.object({
				docid: z.string().describe("文档的 docid"),
				properties: z
					.object({
						title: z.string().nullable().optional().describe("智能表标题"),
					})
					.nullable()
					.optional()
					.describe("智能表属性"),
			}),
			execute: wrapExecute(mcpUrl, "smartsheet_add_sheet"),
		}),

		smartsheet_get_sheet: tool({
			description:
				"查询指定文档中的智能表（子表）信息，返回 sheet_id 列表。\nIMPORTANT: 获取 sheet_id 后，下一步必须调用 smartsheet_get_fields 查看该子表的现有字段。子表默认自带一个文本字段，你需要先用 smartsheet_update_fields 重命名该默认字段，再用 smartsheet_add_fields 添加其余字段。",
			inputSchema: z.object({
				docid: z.string().describe("文档的 docid"),
			}),
			execute: wrapExecute(mcpUrl, "smartsheet_get_sheet"),
		}),

		smartsheet_add_fields: tool({
			description: "在智能表格的工作表内新增一列或多列字段。",
			inputSchema: z.object({
				docid: z.string().describe("文档的 docid"),
				sheet_id: z.string().describe("子表的 sheet ID"),
				fields: z
					.array(
						z.object({
							field_title: z.string().describe("字段标题"),
							field_type: fieldTypeEnum.describe(
								"字段类型。FIELD_TYPE_TEXT: 文本, FIELD_TYPE_NUMBER: 数字, FIELD_TYPE_CHECKBOX: 复选框, FIELD_TYPE_DATE_TIME: 日期时间, FIELD_TYPE_IMAGE: 图片, FIELD_TYPE_USER: 用户/成员, FIELD_TYPE_URL: 链接, FIELD_TYPE_SELECT: 多选, FIELD_TYPE_PROGRESS: 进度(0-100), FIELD_TYPE_PHONE_NUMBER: 手机号, FIELD_TYPE_EMAIL: 邮箱, FIELD_TYPE_SINGLE_SELECT: 单选, FIELD_TYPE_LOCATION: 位置, FIELD_TYPE_CURRENCY: 货币, FIELD_TYPE_PERCENTAGE: 百分比, FIELD_TYPE_BARCODE: 条码",
							),
						}),
					)
					.describe("要添加的字段列表"),
			}),
			execute: wrapExecute(mcpUrl, "smartsheet_add_fields"),
		}),

		smartsheet_update_fields: tool({
			description:
				"更新企业微信智能表格子表中一个或多个字段的标题。注意：该接口只能更新字段名，不能更新字段类型（field_type 必须为字段当前的原始类型）。",
			inputSchema: z.object({
				docid: z.string().describe("文档的 docid"),
				sheet_id: z.string().describe("子表的 sheet ID"),
				fields: z
					.array(
						z.object({
							field_id: z.string().describe("字段 ID，用于标识要更新的字段"),
							field_title: z.string().optional().describe("需要更新为的字段标题，不能更新为原值"),
							field_type: fieldTypeEnum.describe("字段类型，必须传该字段当前的原始类型，不能更改"),
						}),
					)
					.describe("要更新的字段列表"),
			}),
			execute: wrapExecute(mcpUrl, "smartsheet_update_fields"),
		}),

		smartsheet_get_fields: tool({
			description: "查询智能表格子表的字段信息（标题和类型）。",
			inputSchema: z.object({
				docid: z.string().describe("文档的 docid"),
				sheet_id: z.string().describe("子表的 sheet ID"),
			}),
			execute: wrapExecute(mcpUrl, "smartsheet_get_fields"),
		}),

		smartsheet_add_records: tool({
			description:
				'在智能表格的某个子表里添加一行或多行新记录。调用前需先了解目标表各列的类型（通过 smartsheet_get_fields）。单次添加建议 500 行内。\n\nvalues 的 key 必须是字段标题（field_title），不能使用 field_id。各字段类型值格式：\n- 文本(TEXT): [{"type":"text", "text":"内容"}]（必须数组格式）\n- 数字(NUMBER)/货币/百分比/进度: 直接传数字，如 100、0.6\n- 复选框(CHECKBOX): true/false\n- 单选(SINGLE_SELECT)/多选(SELECT): [{"text":"选项内容"}]\n- 日期时间(DATE_TIME): "YYYY-MM-DD HH:MM:SS" 或 "YYYY-MM-DD"\n- 手机号/邮箱/条码: 直接传字符串\n- 成员(USER): [{"user_id":"成员ID"}]\n- 超链接(URL): [{"type":"url", "text":"显示文本", "link":"https://..."}]\n- 图片(IMAGE): [{"image_url":"图片链接"}]\n- 位置(LOCATION): [{"source_type":1, "id":"地点ID", "latitude":"纬度", "longitude":"经度", "title":"地点名"}]',
			inputSchema: z.object({
				docid: z.string().describe("文档的 docid"),
				sheet_id: z.string().describe("Smartsheet 子表 ID"),
				records: z
					.array(
						z.object({
							values: z
								.record(z.string(), z.unknown())
								.describe("记录内容，key 为字段标题（field_title），value 格式取决于字段类型"),
						}),
					)
					.describe("需要添加的记录数组"),
			}),
			execute: wrapExecute(mcpUrl, "smartsheet_add_records"),
		}),
	};
}

// ── WeComFile helpers ──

type WeComMediaType = "image" | "file" | "voice" | "video";

const SIZE_LIMITS: Record<WeComMediaType, number> = {
	image: 10 * 1024 * 1024,
	file: 20 * 1024 * 1024,
	voice: 2 * 1024 * 1024,
	video: 10 * 1024 * 1024,
};

const EXT_TO_MEDIA_TYPE: Record<string, WeComMediaType> = {
	jpg: "image",
	jpeg: "image",
	png: "image",
	gif: "image",
	bmp: "image",
	webp: "image",
	amr: "voice",
	mp3: "voice",
	wav: "voice",
	silk: "voice",
	mp4: "video",
	mov: "video",
	avi: "video",
};

function detectMediaType(filePath: string): WeComMediaType {
	const ext = extname(filePath).replace(/^\./, "").toLowerCase();
	return EXT_TO_MEDIA_TYPE[ext] ?? "file";
}

export function createWecomFileTools(client: WSClient, chatId: string) {
	const wecom_send_file = tool({
		description:
			"向当前企业微信会话发送文件。支持图片、文件、语音、视频四种类型，可自动检测或手动指定。",
		inputSchema: z.object({
			file_path: z.string().describe("本地文件的绝对路径"),
			media_type: z
				.enum(["image", "file", "voice", "video"])
				.optional()
				.describe("媒体类型，不填则按扩展名自动检测"),
		}),
		execute: async ({ file_path, media_type }) => {
			const file = Bun.file(file_path);
			const exists = await file.exists();
			if (!exists) {
				return { success: false, error: `文件不存在: ${file_path}` };
			}

			const mediaType: WeComMediaType = media_type ?? detectMediaType(file_path);
			const limit = SIZE_LIMITS[mediaType];
			if (file.size > limit) {
				const limitMB = (limit / 1024 / 1024).toFixed(0);
				const sizeMB = (file.size / 1024 / 1024).toFixed(1);
				return {
					success: false,
					error: `${mediaType} 类型文件大小限制为 ${limitMB}MB，当前文件 ${sizeMB}MB`,
				};
			}

			const filename = basename(file_path);
			const buffer = Buffer.from(await file.arrayBuffer());

			try {
				const uploadResult = await client.uploadMedia(buffer, {
					type: mediaType,
					filename,
				});
				const mediaId = uploadResult.media_id;

				await client.sendMediaMessage(chatId, mediaType, mediaId);

				return {
					success: true,
					note: `${mediaType === "image" ? "图片" : mediaType === "voice" ? "语音" : mediaType === "video" ? "视频" : "文件"}「${filename}」已发送`,
				};
			} catch (err: any) {
				return {
					success: false,
					error: `发送文件异常: ${err?.message ?? String(err)}`,
				};
			}
		},
	});

	return { wecom_send_file };
}
