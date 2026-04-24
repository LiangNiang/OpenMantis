import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const OPENMANTIS_HOME =
	process.env.OPENMANTIS_DATA_DIR || join(homedir(), ".openmantis");

export const LOG_FILE = join(OPENMANTIS_HOME, "openmantis.log");
export const PID_FILE = join(OPENMANTIS_HOME, "openmantis.pid");
export const CONFIG_FILE = join(OPENMANTIS_HOME, "config.json");
export const ROUTES_DIR = join(OPENMANTIS_HOME, "routes");
export const SCHEDULES_DIR = join(OPENMANTIS_HOME, "schedules");
export const CHANNEL_BINDINGS_FILE = join(OPENMANTIS_HOME, "channel-bindings.json");
export const TTS_DIR = join(OPENMANTIS_HOME, "tts");
export const UPLOADS_DIR = join(OPENMANTIS_HOME, "uploads");
export const TMP_DIR = join(OPENMANTIS_HOME, "tmp");
export const MEMORIES_DIR = join(OPENMANTIS_HOME, "memories");
export const MEMORIES_GLOBAL_DIR = join(MEMORIES_DIR, "global");

/** 单 channel 作用域的目录。channelId 不做转义，与现有 routes/ 一致。 */
export function memoriesChannelDir(channelId: string): string {
	return join(MEMORIES_DIR, channelId);
}

/** scope 解析为绝对目录。channelId 在 scope === "global" 时被忽略。 */
export function memoriesScopeDir(scope: "global" | "channel", channelId?: string): string {
	if (scope === "global") return MEMORIES_GLOBAL_DIR;
	if (!channelId) {
		throw new Error("memoriesScopeDir: channelId is required when scope=channel");
	}
	return memoriesChannelDir(channelId);
}

export const WORKSPACE_DIR = join(OPENMANTIS_HOME, "workspace");
export const SKILLS_DIR = join(OPENMANTIS_HOME, "skills");

export const BROWSER_PROFILES_DIR = join(OPENMANTIS_HOME, "browser-profiles");

export function browserProfileDir(routeId: string): string {
	return join(BROWSER_PROFILES_DIR, routeId);
}

export function routeFile(id: string): string {
	return join(ROUTES_DIR, `${id}.json`);
}

export function scheduleFile(id: string): string {
	return join(SCHEDULES_DIR, `${id}.json`);
}

/** Ensure the directory containing `path` exists (recursive). */
export function ensureParentDir(path: string): void {
	mkdirSync(dirname(path), { recursive: true });
}

/** Ensure `path` itself exists as a directory (recursive). */
export function ensureDir(path: string): void {
	mkdirSync(path, { recursive: true });
}
