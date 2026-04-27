import { appendFileSync } from "node:fs";
import {
	type ConsolaInstance,
	type ConsolaOptions,
	createConsola,
	type LogObject,
} from "consola";
import { ensureParentDir, LOG_FILE } from "../paths";

export { LOG_FILE };

function formatArg(a: unknown): string {
	if (typeof a === "string") return a;
	// Native Error has non-enumerable `message`/`stack`, so JSON.stringify
	// would render it as "{}". Format explicitly to preserve the message.
	if (a instanceof Error) {
		const head = `${a.name}: ${a.message}`;
		return a.stack ? `${head}\n${a.stack}` : head;
	}
	return JSON.stringify(a);
}

function formatLogLine(logObj: LogObject): string {
	const date = logObj.date.toISOString();
	const level = logObj.type.toUpperCase().padEnd(5);
	const tag = logObj.tag ? `[${logObj.tag}] ` : "";
	const message = logObj.args.map(formatArg).join(" ");
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
