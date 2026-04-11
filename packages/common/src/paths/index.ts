import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const OPENMANTIS_DIR = ".openmantis";

export const LOG_FILE = `${OPENMANTIS_DIR}/openmantis.log`;
export const PID_FILE = `${OPENMANTIS_DIR}/openmantis.pid`;
export const CONFIG_FILE = `${OPENMANTIS_DIR}/config.json`;
export const ROUTES_DIR = `${OPENMANTIS_DIR}/routes`;
export const SCHEDULES_DIR = `${OPENMANTIS_DIR}/schedules`;
export const CHANNEL_BINDINGS_FILE = `${OPENMANTIS_DIR}/channel-bindings.json`;
export const TTS_DIR = `${OPENMANTIS_DIR}/tts`;
export const UPLOADS_DIR = `${OPENMANTIS_DIR}/uploads`;
export const TMP_DIR = `${OPENMANTIS_DIR}/tmp`;
export const MEMORIES_DIR = `${OPENMANTIS_DIR}/memories`;
export const WORKSPACE_DIR = `${OPENMANTIS_DIR}/workspace`;

export const BROWSER_PROFILES_DIR = `${OPENMANTIS_DIR}/browser-profiles`;

export function browserProfileDir(routeId: string): string {
	return `${BROWSER_PROFILES_DIR}/${routeId}`;
}

export function routeFile(id: string): string {
	return `${ROUTES_DIR}/${id}.json`;
}

export function scheduleFile(id: string): string {
	return `${SCHEDULES_DIR}/${id}.json`;
}

/** Ensure the directory containing `path` exists (recursive). */
export function ensureParentDir(path: string): void {
	mkdirSync(dirname(path), { recursive: true });
}

/** Ensure `path` itself exists as a directory (recursive). */
export function ensureDir(path: string): void {
	mkdirSync(path, { recursive: true });
}
