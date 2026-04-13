import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createLogger } from "@openmantis/common/logger";
import { SKILLS_DIR } from "@openmantis/common/paths";

const logger = createLogger("init");

/**
 * Extract embedded builtin skills to ~/.openmantis/skills/builtin/.
 * Skips if the directory already exists unless force=true.
 *
 * Embedded skill files are registered in globalThis.__EMBEDDED_SKILL_FILES__
 * by cli.ts from the generated import module.
 */
export async function initBuiltinSkills(force = false): Promise<void> {
	const builtinDir = join(SKILLS_DIR, "builtin");

	if (existsSync(builtinDir) && !force) {
		logger.debug("[init] builtin skills already exist, skipping extraction");
		return;
	}

	const skillFiles =
		((globalThis as any).__EMBEDDED_SKILL_FILES__ as Record<string, string> | undefined) ?? {};

	const entries = Object.entries(skillFiles);
	if (entries.length === 0) {
		logger.debug("[init] no embedded builtin skills found");
		return;
	}

	logger.info(`[init] extracting ${entries.length} builtin skill files...`);

	for (const [key, filePath] of entries) {
		// key is like "skills/builtin/docx/SKILL.md"
		const prefix = "skills/builtin/";
		if (!key.startsWith(prefix)) continue;

		const relativePath = key.slice(prefix.length);
		const targetPath = join(builtinDir, relativePath);

		await mkdir(dirname(targetPath), { recursive: true });
		const content = await Bun.file(filePath).arrayBuffer();
		await writeFile(targetPath, new Uint8Array(content));
	}

	logger.info("[init] builtin skills extracted successfully");
}
