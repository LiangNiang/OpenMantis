// packages/core/src/lifecycle.ts
import { createLogger } from "@openmantis/common/logger";
import { PID_FILE } from "@openmantis/common/paths";
import { isCompiledBinary } from "@openmantis/common/runtime";

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
		// In a compiled Bun binary, argv[1] is an internal /$bunfs/... path
		// that the runtime injects automatically on each launch. Forwarding
		// it to the child clobbers argv[2] (the real command) and the new
		// process exits immediately with USAGE.
		const args = isCompiledBinary() ? process.argv.slice(2) : process.argv.slice(1);
		const child = Bun.spawn([process.execPath, ...args], {
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
