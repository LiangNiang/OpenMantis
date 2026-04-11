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
				"使用小米 MiMo TTS 合成语音。生成的 WAV 文件保存到 .openmantis/tts/，若当前会话来自飞书或企业微信会自动作为语音消息发送。\n\n文本支持两种富表达：\n1. 整体风格：在文本最开头放 <style>风格名</style>，如 <style>开心</style>、<style>东北话</style>、<style>唱歌</style>。多个风格可放在同一标签内空格分隔。\n2. 细粒度音频标签：在文本任意位置插入中文括号标签控制语气、动作、语速等，如：（紧张，深呼吸）、（小声）、（咳嗽）、（长叹一口气）、（语速加快）、（苦笑）、（提高音量喊话）、（沉默片刻）。可与 <style> 组合。\n\n示例：<style>开心</style>（小声）告诉你一个秘密哦……（语速加快）我中奖啦！",
			inputSchema: z.object({
				text: z.string().describe("要合成的文本，最长 2000 字符"),
				voice: z
					.string()
					.optional()
					.describe("音色名（mimo_default / default_zh / default_en），不填使用配置默认"),
				style: z
					.string()
					.optional()
					.describe("风格标签（如 开心、东北话、唱歌），会以 <style>...</style> 形式插入文本开头"),
				stream: z.boolean().optional().describe("是否使用流式 pcm16 合成，默认 false"),
			}),
			execute: async ({ text, voice, style, stream }) => {
				logger.debug(
					`[tool:tts] called: textLen=${text.length}, voice=${voice ?? "(default)"}, style=${style ?? "(none)"}, stream=${stream ?? false}, text=${JSON.stringify(text)}`,
				);
				const trimmed = text.trim();
				if (!trimmed) return { error: "text 不能为空" };
				if (trimmed.length > MAX_TEXT_LEN) {
					return { error: `text 长度 ${trimmed.length} 超过上限 ${MAX_TEXT_LEN}` };
				}

				const effectiveStyle = style ?? config.xiaomiTts?.style;
				const finalText = effectiveStyle ? `<style>${effectiveStyle}</style>${trimmed}` : trimmed;

				try {
					const result = stream
						? await synthesizeStream({ text: finalText, voice }, config)
						: await synthesize({ text: finalText, voice }, config);

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
