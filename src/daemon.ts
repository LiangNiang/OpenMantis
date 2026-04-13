import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { ensureDir, LOG_FILE, OPENMANTIS_HOME, PID_FILE } from "@openmantis/common/paths";

async function readPid(): Promise<number | null> {
	try {
		if (!existsSync(PID_FILE)) return null;
		const content = await readFile(PID_FILE, "utf-8");
		const pid = Number.parseInt(content.trim(), 10);
		return Number.isNaN(pid) ? null : pid;
	} catch {
		return null;
	}
}

function isRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export async function daemonStart(): Promise<void> {
	ensureDir(OPENMANTIS_HOME);

	const existingPid = await readPid();
	if (existingPid && isRunning(existingPid)) {
		console.log(`OpenMantis is already running (PID ${existingPid})`);
		process.exit(1);
	}

	console.log("Starting OpenMantis...");

	const child = Bun.spawn([process.execPath, "__daemon__"], {
		stdio: ["ignore", "ignore", "ignore"],
		env: process.env,
	});
	child.unref();

	const pid = child.pid;
	await Bun.write(PID_FILE, String(pid));

	// Wait a moment to check if the process started successfully
	await Bun.sleep(1000);

	if (isRunning(pid)) {
		console.log(`OpenMantis started (PID ${pid})`);
	} else {
		try {
			await unlink(PID_FILE);
		} catch {}
		console.error(`Error: OpenMantis failed to start. Check log: ${LOG_FILE}`);
		process.exit(1);
	}
}

export async function daemonStop(): Promise<void> {
	const pid = await readPid();
	if (!pid || !isRunning(pid)) {
		console.log("OpenMantis is not running");
		try {
			await unlink(PID_FILE);
		} catch {}
		return;
	}

	console.log(`Stopping OpenMantis (PID ${pid})...`);
	try {
		process.kill(pid, "SIGTERM");
	} catch {
		console.error(`Error: could not send SIGTERM to PID ${pid}`);
		try {
			await unlink(PID_FILE);
		} catch {}
		return;
	}

	// Wait up to 5 seconds for graceful shutdown
	for (let i = 0; i < 5; i++) {
		if (!isRunning(pid)) break;
		await Bun.sleep(1000);
	}

	if (isRunning(pid)) {
		console.log("Force killing...");
		try {
			process.kill(pid, "SIGKILL");
		} catch {}
		await Bun.sleep(1000);
	}

	try {
		await unlink(PID_FILE);
	} catch {}
	console.log("OpenMantis stopped");
}

export async function daemonRestart(): Promise<void> {
	await daemonStop();
	await daemonStart();
}

export async function daemonStatus(): Promise<void> {
	const pid = await readPid();
	if (pid && isRunning(pid)) {
		console.log(`OpenMantis is running (PID ${pid})`);
	} else {
		console.log("OpenMantis is not running");
		if (pid) {
			try {
				await unlink(PID_FILE);
			} catch {}
		}
	}
}

export async function daemonLog(): Promise<void> {
	if (!existsSync(LOG_FILE)) {
		console.log(`No log file found at ${LOG_FILE}`);
		process.exit(1);
	}

	// Tail the log file
	const proc = Bun.spawn(["tail", "-f", LOG_FILE], {
		stdio: ["inherit", "inherit", "inherit"],
	});
	await proc.exited;
}
