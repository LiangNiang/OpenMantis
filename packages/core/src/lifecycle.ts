// packages/core/src/lifecycle.ts
import { createLogger } from "@openmantis/common/logger";
import { PID_FILE } from "@openmantis/common/paths";

const logger = createLogger("lifecycle");

let isRestarting = false;

export function getIsRestarting(): boolean {
	return isRestarting;
}

interface RestartDeps {
	shutdown: () => Promise<void>;
}

let _deps: RestartDeps | undefined;

export function registerRestartDeps(deps: RestartDeps): void {
	_deps = deps;
}

export async function restartProcess(): Promise<void> {
	if (isRestarting) {
		throw new Error("Already restarting");
	}
	if (!_deps) {
		throw new Error("Restart deps not registered");
	}
	isRestarting = true;
	logger.info("[lifecycle] Restarting process...");

	try {
		await _deps.shutdown();
	} catch (err) {
		logger.error("[lifecycle] Error during shutdown:", err);
	}

	try {
		const args = process.argv.slice(1);
		const child = Bun.spawn(["bun", ...args], {
			stdio: ["inherit", "inherit", "inherit"],
			env: process.env,
		});
		child.unref();

		logger.info(`[lifecycle] New process spawned (pid=${child.pid})`);
		await Bun.write(PID_FILE, String(child.pid));

		setTimeout(() => process.exit(0), 500);
	} catch (err) {
		logger.error("[lifecycle] Failed to spawn new process:", err);
		isRestarting = false;
		throw err;
	}
}
