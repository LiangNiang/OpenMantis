import { FeishuChannel, feishuToolsProvider } from "@openmantis/channel-feishu";
import { QQChannel, qqToolsProvider } from "@openmantis/channel-qq";
import { WeComChannel, wecomToolsProvider } from "@openmantis/channel-wecom";
import { isBrowserCdpActive } from "@openmantis/common/config/schema";
import { createLogger } from "@openmantis/common/logger";
import {
	CHANNEL_BINDINGS_FILE,
	CONFIG_FILE,
	PID_FILE,
	SCHEDULES_DIR,
} from "@openmantis/common/paths";
import type { ChannelAdapter } from "@openmantis/core/channels/types";
import {
	botOpenIdCommand,
	channelCommand,
	clearCommand,
	deleteCommand,
	helpCommand,
	historyCommand,
	listCommand,
	newCommand,
	resumeCommand,
	stopCommand,
} from "@openmantis/core/commands/handlers";
import { forgetCommand, memoriesCommand, rememberCommand } from "@openmantis/core/commands/memory";
import { openIdCommand } from "@openmantis/core/commands/open-id";
import { CommandRouter } from "@openmantis/core/commands/router";
import { scheduleCommand } from "@openmantis/core/commands/schedule";
import { voiceCommand } from "@openmantis/core/commands/voice";
import { ConfigStore } from "@openmantis/core/config/store";
import { setGateway } from "@openmantis/core/context/gateway-context";
import { setSchedulerService } from "@openmantis/core/context/scheduler-context";
import { ChannelBindings } from "@openmantis/core/gateway/channel-bindings";
import { Gateway } from "@openmantis/core/gateway/gateway";
import { registerRestartDeps } from "@openmantis/core/lifecycle";
import type { ChannelToolProviders } from "@openmantis/core/tools/index";

const logger = createLogger("core");

import { SchedulerService } from "@openmantis/scheduler/service";
import { ScheduleStore } from "@openmantis/scheduler/store";
import { startWebServer } from "@openmantis/web-server";

async function main() {
	const configStore = new ConfigStore(CONFIG_FILE);
	await configStore.load();

	if (!configStore.hasConfig()) {
		const config = configStore.get();
		const host = config.web?.host ?? "127.0.0.1";
		const port = config.web?.port ?? 7777;

		await startWebServer({ configStore });

		const displayHost = host === "0.0.0.0" ? "localhost" : host;
		const url = `http://${displayHost}:${port}`;

		console.log("");
		console.log("╔══════════════════════════════════════════════════════════════╗");
		console.log("║                                                              ║");
		console.log("║   OpenMantis - 首次配置 / First-Time Setup                   ║");
		console.log("║                                                              ║");
		console.log("║   未检测到配置文件，请打开以下链接完成设置：                 ║");
		console.log("║   No config found. Open the URL below to get started:        ║");
		console.log("║                                                              ║");
		console.log(`║   → ${url.padEnd(57)}║`);
		console.log("║                                                              ║");
		console.log("║   配置完成后，请重新启动 OpenMantis。                        ║");
		console.log("║   After setup, restart OpenMantis.                           ║");
		console.log("║                                                              ║");
		console.log("╚══════════════════════════════════════════════════════════════╝");
		console.log("");

		return;
	}

	const config = configStore.get();

	if (config.volcengine?.arkApiKey) {
		process.env.ARK_API_KEY = config.volcengine.arkApiKey;
	}

	if (config.browser?.enabled) {
		const bin = config.browser.binPath ?? "agent-browser";
		try {
			const result = await Bun.$`${bin} --version`.quiet();
			logger.success(`agent-browser detected: ${result.stdout.toString().trim()}`);
		} catch (_err) {
			logger.error(
				`agent-browser CLI not found or not executable (binPath=${bin}).\n` +
					`Install with: npm i -g agent-browser && agent-browser install\n` +
					`Or disable the browser feature in config.`,
			);
			process.exit(1);
		}
	}

	const channelBindings = new ChannelBindings(CHANNEL_BINDINGS_FILE);
	await channelBindings.load();

	const channels: ChannelAdapter[] = [];

	let abortInflightRef: ((id: string) => boolean) | undefined;

	const channelFactory: Record<string, () => ChannelAdapter | ChannelAdapter[] | null> = {
		feishu: () => {
			if (!config.feishu?.length) {
				logger.error("Feishu channel requires feishu config array with at least one app");
				process.exit(1);
			}
			return config.feishu.map(
				(app) =>
					new FeishuChannel(app, channelBindings, {
						abortInflight: (id: string) => (abortInflightRef ? abortInflightRef(id) : false),
					}),
			);
		},
		wecom: () => {
			if (!config.wecom) {
				logger.error("WeCom channel requires wecom config (botId, secret)");
				process.exit(1);
			}
			return new WeComChannel(config.wecom, channelBindings);
		},
		qq: () => {
			if (!config.qq) {
				logger.error("QQ channel requires qq config (appId, clientSecret)");
				process.exit(1);
			}
			return new QQChannel(config.qq, channelBindings);
		},
	};

	for (const ch of config.channels) {
		const create = channelFactory[ch];
		if (!create) {
			logger.warn(`Unknown channel: ${ch}, skipping`);
			continue;
		}
		const result = create();
		if (result) {
			if (Array.isArray(result)) {
				channels.push(...result);
			} else {
				channels.push(result);
			}
		}
	}

	const channelToolProviders: ChannelToolProviders = {
		feishu: feishuToolsProvider,
		qq: qqToolsProvider,
		wecom: wecomToolsProvider,
	};

	const gateway = new Gateway(config, channels, { channelBindings, channelToolProviders });
	abortInflightRef = (id: string) => gateway.abortRoute(id);
	setGateway(gateway);

	// Initialize scheduler
	const scheduleStore = new ScheduleStore(SCHEDULES_DIR);
	const scheduler = new SchedulerService(gateway, scheduleStore);
	setSchedulerService(scheduler);

	await startWebServer({ configStore, gateway, scheduler });
	await Bun.write(PID_FILE, String(process.pid));

	{
		const host = config.web?.host ?? "127.0.0.1";
		const port = config.web?.port ?? 7777;
		const displayHost = host === "0.0.0.0" ? "localhost" : host;
		const url = `http://${displayHost}:${port}`;

		console.log("");
		console.log(`  OpenMantis is running → ${url}`);
		console.log("");
	}

	if (channels.length === 0) {
		logger.warn("No channels configured. Web UI available for setup.");
	}

	const router = new CommandRouter({
		routeStore: gateway.routeStore,
		channelBindings,
		config: gateway.getConfig(),
		abortInflight: (id) => gateway.abortRoute(id),
	});

	router.register(helpCommand(router));
	router.register(newCommand);
	router.register(clearCommand);
	router.register(stopCommand);
	router.register(deleteCommand);
	router.register(listCommand);
	router.register(historyCommand);
	router.register(channelCommand);
	router.register(resumeCommand);
	router.register(voiceCommand);
	router.register(scheduleCommand);
	router.register(rememberCommand);
	router.register(forgetCommand);
	router.register(memoriesCommand);
	router.register(botOpenIdCommand);
	router.register(openIdCommand);

	for (const channel of channels) {
		if ("setCommandRouter" in channel) {
			(channel as any).setCommandRouter(router);
		}
	}

	const shutdown = async () => {
		await scheduler.stop();
		await gateway.stop();
		if (config.browser?.enabled && !isBrowserCdpActive(config)) {
			const bin = config.browser.binPath ?? "agent-browser";
			try {
				await Bun.$`${bin} close --all`.quiet();
				logger.debug("[browser] daemon closed");
			} catch (err) {
				logger.warn("[browser] failed to close agent-browser daemon:", err);
			}
		}
	};

	registerRestartDeps({ shutdown });

	process.on("SIGINT", async () => {
		await shutdown();
		process.exit(0);
	});
	process.on("SIGTERM", async () => {
		await shutdown();
		process.exit(0);
	});

	await scheduler.start();
	if (channels.length > 0) {
		await gateway.start();
	}
}

main().catch((err) => {
	logger.error("Failed to start OpenMantis:", err);
	process.exit(1);
});
