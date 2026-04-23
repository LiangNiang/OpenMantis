import { getWecomClient } from "@openmantis/channel-wecom";
import type { OpenMantisConfig } from "@openmantis/common/config/schema";
import { createLogger } from "@openmantis/common/logger";
import { synthesize, synthesizeStream, uploadToChannel } from "@openmantis/tts";
import { tool } from "ai";
import { z } from "zod";

const logger = createLogger("core/tools");

import type { ChannelContext } from "./index";

const MAX_TEXT_LEN = 2000;

export function createTtsTools(config: OpenMantisConfig, channel?: ChannelContext) {
	return {
		tts_speak: tool({
			description:
				'使用小米 MiMo v2.5-TTS 合成语音。生成的 WAV 保存到 .openmantis/tts/，飞书/企微会话会自动作为语音消息发送。\n\n三种风格控制方式（可组合）：\n- style：短风格标签，会拼成 `(xx)` 前缀。例：开心、慵懒、东北话、夹子音、孙悟空。多个用空格分隔。用户要求唱歌/演唱/唱儿歌/播歌词时 **必须** 传 `style="唱歌"`——这是 v2.5 的专属唱歌模式（中文歌词效果最佳）；不传就是让模型朗读歌词。\n- direction（可选）：自然语言表演指导，适合段落级情感刻画和"角色/场景/指导"导演模式。\n- 文本内细粒度标签：在 text 任意位置插入中文括号标签，如（紧张，深呼吸）、（咳嗽）、（语速加快）、（苦笑）、（小声）。可与 style 组合。\n\n示例：style="开心" text="（小声）告诉你一个秘密哦……（语速加快）我中奖啦！"',
			inputSchema: z.object({
				text: z.string().describe("要合成的文本，最长 2000 字符"),
				voice: z
					.string()
					.optional()
					.describe(
						"音色名：mimo_default（集群默认，中国→冰糖、海外→Mia）/ 冰糖 / 茉莉 / 苏打 / 白桦（中文）/ Mia / Chloe / Milo / Dean（英文）。不填使用配置默认。",
					),
				style: z
					.string()
					.optional()
					.describe(
						"短风格标签（如 开心、东北话、唱歌），会拼成 (风格) 前缀插到文本开头。多个标签用空格分隔。",
					),
				direction: z
					.string()
					.optional()
					.describe(
						"自然语言表演指导（可选），会以 user message 传给模型。例：用轻快上扬的语调、语速稍快。支持'角色/场景/指导'三段式导演模式。",
					),
				stream: z
					.boolean()
					.optional()
					.describe("是否使用流式合成，默认 false。注意 v2.5 流式目前为兼容模式，无首字延迟收益。"),
			}),
			execute: async ({ text, voice, style, direction, stream }) => {
				logger.debug(
					`[tool:tts] called: textLen=${text.length}, voice=${voice ?? "(default)"}, style=${style || "(none)"}, direction=${direction ? "(set)" : "(none)"}, stream=${stream ?? false}, text=${JSON.stringify(text)}`,
				);
				const trimmed = text.trim();
				if (!trimmed) return { error: "text 不能为空" };
				if (trimmed.length > MAX_TEXT_LEN) {
					return { error: `text 长度 ${trimmed.length} 超过上限 ${MAX_TEXT_LEN}` };
				}

				try {
					const opts = { text: trimmed, voice, style, direction };
					const result = stream
						? await synthesizeStream(opts, config)
						: await synthesize(opts, config);

					let uploaded = false;
					let channelMsgId: string | undefined;
					let mode: string | undefined;
					if (
						channel &&
						(channel.channelType.startsWith("feishu") || channel.channelType === "wecom")
					) {
						const up = await uploadToChannel(
							channel,
							{ filePath: result.filePath, durationMs: result.durationMs },
							config,
							channel.channelType === "wecom" ? getWecomClient() : undefined,
						);
						uploaded = up.ok;
						channelMsgId = up.channelMsgId;
						mode = up.mode;
						if (!up.ok) logger.warn(`[tool:tts] upload failed: ${up.error}`);
					}

					logger.info(
						`[tool:tts] done: bytes=${result.bytes}, durationMs=${result.durationMs}, uploaded=${uploaded}${mode ? `, mode=${mode}` : ""}`,
					);
					return {
						path: result.filePath,
						bytes: result.bytes,
						uploaded,
						mode,
						channelMsgId,
					};
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					logger.error(`[tool:tts] synthesize failed: ${message}`);
					return { error: message };
				}
			},
		}),
	};
}
