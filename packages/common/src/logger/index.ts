import { appendFileSync } from "node:fs";
import {
	type ConsolaInstance,
	type ConsolaOptions,
	createConsola,
	type LogObject,
} from "consola";
import { ensureParentDir, LOG_FILE } from "../paths";

export { LOG_FILE };

function formatLogLine(logObj: LogObject): string {
	const date = logObj.date.toISOString();
	const level = logObj.type.toUpperCase().padEnd(5);
	const tag = logObj.tag ? `[${logObj.tag}] ` : "";
	const message = logObj.args
		.map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
		.join(" ");
	return `${date} ${level} ${tag}${message}\n`;
}

const fileReporter = {
	log(logObj: LogObject, _ctx: { options: ConsolaOptions }) {
		try {
			appendFileSync(LOG_FILE, formatLogLine(logObj));
		} catch {
			try {
				ensureParentDir(LOG_FILE);
				appendFileSync(LOG_FILE, formatLogLine(logObj));
			} catch {
				// Silently ignore — cannot log about logging failures
			}
		}
	},
};

const cache = new Map<string, ConsolaInstance>();

export function createLogger(tag: string): ConsolaInstance {
	const cached = cache.get(tag);
	if (cached) return cached;
	const instance = createConsola({
		level: process.env.LOG_LEVEL === "debug" ? 4 : 3,
		reporters: [fileReporter],
	}).withTag(tag);
	cache.set(tag, instance);
	return instance;
}
