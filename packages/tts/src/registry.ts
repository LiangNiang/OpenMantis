import type { TtsProvider } from "@openmantis/common/types/tts";
import { xiaomiProvider } from "./providers/xiaomi";
import type { TtsConfig } from "./types";

const REGISTRY: Record<string, TtsProvider<TtsConfig>> = {
	"xiaomi-mimo": xiaomiProvider,
};

export function getTtsProvider(name: string): TtsProvider<TtsConfig> | null {
	return REGISTRY[name] ?? null;
}
