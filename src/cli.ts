import { ensureDir, LOG_FILE, OPENMANTIS_HOME } from "@openmantis/common/paths";
import { daemonLog, daemonRestart, daemonStart, daemonStatus, daemonStop } from "./daemon";
import { initBuiltinSkills } from "./init";

// Register embedded assets (generated at build time, only available in compiled binary)
async function loadEmbeddedAssets() {
	try {
		// @ts-expect-error — generated at build time, not present during dev
		const webMod = await import("./_web-assets.generated");
		(globalThis as any).__EMBEDDED_WEB_ASSETS__ = webMod.WEB_ASSETS;
	} catch {
		// Dev mode — no generated file, web assets served from disk
	}
	try {
		// @ts-expect-error — generated at build time, not present during dev
		const skillMod = await import("./_skill-files.generated");
		(globalThis as any).__EMBEDDED_SKILL_FILES__ = skillMod.SKILL_FILES;
	} catch {
		// Dev mode — no generated file, skills loaded from disk
	}
}

const USAGE = `Usage: openmantis <command>

Commands:
  start     Start OpenMantis (daemon)
  stop      Stop OpenMantis
  restart   Restart OpenMantis
  status    Show running status
  log       Tail the log file
  run       Run in foreground (for Docker / development)
  init      Extract builtin skills (--force to overwrite)
`;

async function runForeground(): Promise<void> {
	ensureDir(OPENMANTIS_HOME);
	await loadEmbeddedAssets();
	await initBuiltinSkills();
	const { main } = await import("./index");
	await main();
}

async function runDaemon(): Promise<void> {
	ensureDir(OPENMANTIS_HOME);
	await loadEmbeddedAssets();
	await initBuiltinSkills();

	const logFile = Bun.file(LOG_FILE);
	const writer = logFile.writer();

	const writeToLog = (...args: unknown[]) => {
		const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
		writer.write(`${msg}\n`);
		writer.flush();
	};
	console.log = writeToLog;
	console.error = writeToLog;

	try {
		const { main } = await import("./index");
		await main();
	} catch (err) {
		writeToLog(`Failed to start OpenMantis: ${err}`);
		process.exit(1);
	}
}

async function cli(): Promise<void> {
	const command = process.argv[2];

	if (command === "__daemon__") {
		await runDaemon();
		return;
	}

	switch (command) {
		case "start":
			await daemonStart();
			break;
		case "stop":
			await daemonStop();
			break;
		case "restart":
			await daemonRestart();
			break;
		case "status":
			await daemonStatus();
			break;
		case "log":
			await daemonLog();
			break;
		case "run":
			await runForeground();
			break;
		case "init": {
			ensureDir(OPENMANTIS_HOME);
			await loadEmbeddedAssets();
			const force = process.argv.includes("--force");
			await initBuiltinSkills(force);
			console.log("Initialization complete");
			break;
		}
		default:
			console.log(USAGE);
			if (command && command !== "--help" && command !== "-h") {
				process.exit(1);
			}
			break;
	}
}

cli().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
