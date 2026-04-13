import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SKILLS_DIR } from "@openmantis/common/paths";
import { createLogger } from "@openmantis/common/logger";

const logger = createLogger("init");

/**
 * Extract embedded builtin skills to ~/.openmantis/skills/builtin/.
 * Skips if the directory already exists unless force=true.
 */
export async function initBuiltinSkills(force = false): Promise<void> {
	const builtinDir = join(SKILLS_DIR, "builtin");

	if (existsSync(builtinDir) && !force) {
		logger.debug("[init] builtin skills already exist, skipping extraction");
		return;
	}

	const embeddedSkills = Bun.embeddedFiles.filter((f) =>
		(f as Blob & { name: string }).name.includes("skills/builtin/"),
	);

	if (embeddedSkills.length === 0) {
		logger.debug("[init] no embedded builtin skills found");
		return;
	}

	logger.info(`[init] extracting ${embeddedSkills.length} builtin skill files...`);

	for (const file of embeddedSkills) {
		const name = (file as Blob & { name: string }).name;
		const skillIdx = name.indexOf("skills/builtin/");
		if (skillIdx === -1) continue;

		const relativePath = name.slice(skillIdx + "skills/builtin/".length);
		const targetPath = join(builtinDir, relativePath);

		await mkdir(dirname(targetPath), { recursive: true });
		const content = await file.arrayBuffer();
		await writeFile(targetPath, new Uint8Array(content));
	}

	logger.info("[init] builtin skills extracted successfully");
}
