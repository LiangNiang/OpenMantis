import path from "node:path";
import type { OpenMantisConfig } from "@openmantis/common/config/schema";
import { browserProfileDir } from "@openmantis/common/paths";

function buildBrowserIsolationSection(routeId: string): string {
	const absProfile = path.resolve(browserProfileDir(routeId));
	return `## Browser automation isolation (MANDATORY)

This conversation owns an isolated browser profile. Every agent-browser CLI invocation in this conversation MUST satisfy ALL of the following requirements without exception:

REQUIREMENTS — all must be met on every call:
1. MUST pass \`--session route-${routeId}\` exactly as written. No other session name is permitted.
2. MUST pass \`--profile ${absProfile}\` exactly as written. No other profile path is permitted.
3. MUST NOT reuse, share, or substitute another session or profile, even temporarily.
4. MUST NOT omit either flag, even for "quick" or "read-only" commands.

Constants for this conversation (do not change):
    ROUTE_ID              = ${routeId}
    ABSOLUTE_PROFILE_PATH = ${absProfile}

Required invocation shape:
    agent-browser --session route-${routeId} --profile ${absProfile} <subcommand> [args...]

Concrete example:
    agent-browser --session route-${routeId} --profile ${absProfile} open https://example.com

Failure to meet these requirements will leak state between conversations and is considered a hard error. The profile directory is created automatically on first use — you do not need to create it yourself.`;
}

function buildBrowserCdpSection(routeId: string, cdpFlag: string): string {
	return `## Browser automation — CDP mode (MANDATORY)

This OpenMantis instance is attached to the user's real Chrome via CDP. Every agent-browser CLI invocation in this conversation MUST satisfy ALL of the following requirements without exception:

REQUIREMENTS — all must be met on every call:
1. MUST pass \`${cdpFlag}\` exactly as written, on every single invocation.
2. MUST pass \`--session route-${routeId}\` exactly as written. No other session name is permitted.
3. MUST NOT pass \`--profile\` under any circumstances — CDP mode forbids it.
4. MUST NOT omit \`--session\`, even for "quick" or "read-only" commands.

Constants for this conversation (do not change):
    CDP_FLAG = ${cdpFlag}
    ROUTE_ID = ${routeId}

Required invocation shape:
    agent-browser ${cdpFlag} --session route-${routeId} <subcommand> [args...]

Concrete example:
    agent-browser ${cdpFlag} --session route-${routeId} open https://example.com

CRITICAL SAFETY REQUIREMENTS — cookies, sessions, and login state are SHARED with the user's real browsing session:
- MUST NOT perform destructive or irreversible actions without explicit user confirmation. This includes (non-exhaustive): logging out, deleting data, sending messages, posting content, submitting forms, making purchases, changing account settings, revoking access.
- MUST ask the user first whenever an action could affect real account state and you are not certain it is safe.
- When in doubt: stop and ask. Do not guess.`;
}

export function buildBrowserPromptSection(
	config: OpenMantisConfig,
	routeId: string | undefined,
): string | null {
	if (!config.browser?.enabled || !routeId) {
		return null;
	}
	const cdp = config.browser.cdp;
	if (cdp && (cdp.autoConnect === true || typeof cdp.port === "number")) {
		const cdpFlag = cdp.autoConnect ? "--auto-connect" : `--cdp ${cdp.port}`;
		return buildBrowserCdpSection(routeId, cdpFlag);
	}
	return buildBrowserIsolationSection(routeId);
}
