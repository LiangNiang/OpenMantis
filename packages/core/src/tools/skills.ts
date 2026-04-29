import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { OpenMantisConfig } from "@openmantis/common/config/schema";
import { createLogger } from "@openmantis/common/logger";
import { SKILLS_DIR, WORKSPACE_DIR } from "@openmantis/common/paths";
import { isCompiledBinary } from "@openmantis/common/runtime";
import { type Tool, tool } from "ai";
import matter from "gray-matter";
import { z } from "zod";

const logger = createLogger("core/tools");

function resolveSkillsRoot(): string {
	if (isCompiledBinary()) return SKILLS_DIR;
	return path.resolve(import.meta.dir, "../../../../skills");
}

interface Skill {
	name: string;
	description: string;
	localPath: string;
	relativePath: string;
	files: string[];
}

async function listFiles(dir: string, prefix = ""): Promise<string[]> {
	const results: string[] = [];
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		return results;
	}
	for (const entry of entries) {
		const full = path.join(dir, entry);
		const rel = prefix ? `${prefix}/${entry}` : entry;
		const s = await stat(full);
		if (s.isDirectory()) {
			results.push(...(await listFiles(full, rel)));
		} else {
			results.push(rel);
		}
	}
	return results;
}

/**
 * Parse a `.env` file and merge entries into `process.env`.
 *
 * - Existing `process.env` values are NOT overridden (so user-set env wins).
 * - Supports `KEY=value`, `KEY="value"`, `KEY='value'`, comments (`#`), blank lines.
 * - No interpolation, no `export` keyword stripping needed (we tolerate it).
 */
async function loadSkillEnv(skillDir: string): Promise<string[]> {
	const envPath = path.join(skillDir, ".env");
	if (!existsSync(envPath)) return [];
	const loaded: string[] = [];
	try {
		const content = await readFile(envPath, "utf-8");
		for (const rawLine of content.split(/\r?\n/)) {
			const line = rawLine.trim();
			if (!line || line.startsWith("#")) continue;
			const stripped = line.startsWith("export ") ? line.slice(7).trimStart() : line;
			const eq = stripped.indexOf("=");
			if (eq <= 0) continue;
			const key = stripped.slice(0, eq).trim();
			let value = stripped.slice(eq + 1).trim();
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}
			if (!key) continue;
			if (process.env[key] !== undefined && process.env[key] !== "") continue;
			process.env[key] = value;
			loaded.push(key);
		}
	} catch (err) {
		logger.warn(`[skills] failed to load ${envPath}: ${err}`);
	}
	return loaded;
}

async function discoverSkills(dir: string, destination: string): Promise<Skill[]> {
	const skills: Skill[] = [];
	const absoluteDir = path.resolve(dir);
	let entries: string[];
	try {
		entries = await readdir(absoluteDir);
	} catch {
		return skills;
	}

	for (const entry of entries) {
		const skillDir = path.join(absoluteDir, entry);
		try {
			const s = await stat(skillDir);
			if (!s.isDirectory()) continue;
		} catch {
			continue;
		}

		const skillMdPath = path.join(skillDir, "SKILL.md");
		try {
			const content = await readFile(skillMdPath, "utf-8");
			const { data } = matter(content);
			if (
				typeof data.name !== "string" ||
				typeof data.description !== "string" ||
				!data.name ||
				!data.description
			) {
				continue;
			}
			const loadedEnv = await loadSkillEnv(skillDir);
			if (loadedEnv.length > 0) {
				logger.debug(`[skills] loaded .env from ${data.name}: ${loadedEnv.join(", ")}`);
			}
			const allFiles = await listFiles(skillDir);
			skills.push({
				name: data.name,
				description: data.description,
				localPath: skillDir,
				relativePath: `./${destination}/${entry}`,
				files: allFiles.filter((f) => f !== "SKILL.md"),
			});
		} catch {
			// No SKILL.md or unreadable — skip
		}
	}
	return skills;
}

function createSkillLoaderTool(skills: Skill[]): Tool {
	const skillMap = new Map<string, Skill>();
	for (const s of skills) {
		skillMap.set(s.name, s);
	}

	const descLines = [
		"Load a skill's instructions to learn how to use it.",
		"You can load multiple skills - each call returns that skill's instructions. Treat the returned instructions as authoritative.",
		"",
		"Available skills:",
	];
	if (skills.length === 0) {
		descLines.push("  (no skills found)");
	} else {
		for (const s of skills) {
			descLines.push(`  - skill(${JSON.stringify(s.name)}): ${s.description}`);
		}
	}
	descLines.push("");
	descLines.push(
		"After loading a skill, use the bash tool to run its scripts using absolute paths.",
	);
	descLines.push(
		`IMPORTANT: ALL output files MUST end up in \`${WORKSPACE_DIR}/\`. ` +
			"If the script supports an output directory flag, use it. " +
			`If not, run the script then MOVE the output files to \`${WORKSPACE_DIR}/\`. ` +
			"NEVER leave output files inside the skill directory.",
	);

	const inputSchema = z.object({
		skillName: z
			.string()
			.optional()
			.describe(
				"Optional. The skill name is already encoded in the tool name (skill_<name>); leave this empty unless you intentionally want to load a different skill.",
			),
	});

	return tool({
		description: descLines.join("\n"),
		inputSchema,
		execute: async ({ skillName }: z.infer<typeof inputSchema>) => {
			if (!skillName) {
				return {
					success: false,
					error: "skillName is missing and no default could be inferred from the tool name.",
				};
			}
			const skill = skillMap.get(skillName);
			if (!skill) {
				const available = skills.map((s) => s.name).join(", ");
				return {
					success: false,
					error: `Skill "${skillName}" not found. Available: ${available || "none"}`,
				};
			}
			try {
				const content = await readFile(path.join(skill.localPath, "SKILL.md"), "utf-8");
				const { content: body } = matter(content);
				return {
					success: true,
					skill: { name: skill.name, description: skill.description, path: skill.localPath },
					instructions: body.trim(),
					files: skill.files,
				};
			} catch (error) {
				return {
					success: false,
					error: `Failed to read skill "${skillName}": ${error instanceof Error ? error.message : String(error)}`,
				};
			}
		},
	});
}

function wrapSkillTool(t: Tool, defaultSkillName: string): Tool {
	const originalExecute = t.execute;
	if (!originalExecute) return t;

	return {
		...t,
		execute: async (args: any, options: any) => {
			// The tool name (skill_<name>) already identifies which skill to load,
			// so models that send `{}` shouldn't trigger a tool-error round-trip.
			const incoming = args && typeof args === "object" ? args : {};
			const patchedArgs =
				typeof incoming.skillName === "string" && incoming.skillName
					? incoming
					: { ...incoming, skillName: defaultSkillName };
			const result = await originalExecute(patchedArgs, options);
			if (result?.success === true && result?.skill?.path) {
				const skillPath = result.skill.path;
				const fileList: string[] = Array.isArray(result.files) ? result.files : [];
				const filesSection =
					fileList.length > 0
						? `**Files** (no need to explore the directory):\n${fileList.map((f: string) => `- ${f}`).join("\n")}\n\n`
						: "";
				const workspace = WORKSPACE_DIR;
				const header =
					`**Skill directory**: \`${skillPath}\`\n` +
					`**Output directory**: \`${workspace}/\` (create subdirs as needed, e.g. \`${workspace}/reports/\`)\n\n` +
					`**CRITICAL — Output files MUST end up in \`${workspace}/\`**:\n` +
					`ALL generated files (reports, documents, images, audio, downloads, etc.) MUST be stored in \`${workspace}/\`. NEVER leave output inside the skill directory or the project root.\n` +
					`Follow this priority:\n` +
					`1. If the script supports an output directory flag (\`--outdir\`, \`--output-dir\`, \`-o\`, etc.), use it to write directly to \`${workspace}/\`.\n` +
					`2. If NO such flag exists, run the script normally, then MOVE the generated files to \`${workspace}/\` (e.g. \`mv <output_files> ${workspace}/\`).\n` +
					`3. If the task only requires streaming output (no files to persist), \`--no-save\` is acceptable.\n\n` +
					`**Path rules**:\n` +
					`- Use ABSOLUTE paths for all script references: \`python ${skillPath}/scripts/xxx.py\`\n` +
					`- Do NOT use \`cd\` to change directories before running scripts\n\n` +
					filesSection +
					`---\n\n`;
				return {
					...result,
					instructions: header + (result.instructions ?? ""),
				};
			}
			return result;
		},
	};
}

function generateSkillInstructions(skills: Skill[]): string {
	if (skills.length === 0) return "";
	const lines = ["SKILL DIRECTORIES:", "Skills are available at the following paths:"];
	for (const s of skills) {
		lines.push(`  ${s.localPath}/ - ${s.name}: ${s.description}`);
	}
	lines.push("");
	lines.push("To use a skill:");
	lines.push("  1. Call skill to get the skill's instructions");
	lines.push("  2. Run scripts using absolute paths with bash");
	return lines.join("\n");
}

export const SKILLS_TOOL_GUIDE =
	"- **skill_* (Skills)**: When the user's request matches a registered skill's capabilities, **prefer the skill tool** over generic web search (e.g. tavily/exa). For example, map/route/POI/navigation requests should use the map skill rather than searching the web.";

export async function createSkillTools(config?: OpenMantisConfig) {
	const skillsConfig = config?.skills;
	let instructions = "";
	const tools: Record<string, Tool> = {};
	const skillsRoot = resolveSkillsRoot();
	const binary = isCompiledBinary();
	logger.debug(`[skills] root=${skillsRoot} mode=${binary ? "binary" : "dev"}`);

	// Built-in skills
	if (skillsConfig?.builtinEnabled !== false) {
		const builtinDir = path.join(skillsRoot, "builtin");
		if (!existsSync(builtinDir)) {
			logger.warn(
				`[skills] builtin directory not found at ${builtinDir}. ` +
					(binary
						? "Embedded skill extraction may have failed; try `openmantis init --force`."
						: "Are you running from the repo root?"),
			);
		} else {
			try {
				const skills = await discoverSkills(builtinDir, "skills/builtin");
				if (skills.length > 0) {
					instructions += `${generateSkillInstructions(skills)}\n`;
					const loaderTool = createSkillLoaderTool(skills);
					for (const skill of skills) {
						tools[`skill_${skill.name}`] = wrapSkillTool(loaderTool, skill.name);
					}
					logger.debug(`[skills] loaded ${skills.length} builtin skills`);
				}
			} catch (err) {
				logger.error(`[skills] failed to load builtin skills: ${err}`);
			}
		}
	}

	// Custom skills (skills/custom directory)
	const customDir = path.join(skillsRoot, "custom");
	if (existsSync(customDir)) {
		try {
			const skills = await discoverSkills(customDir, "skills/custom");
			if (skills.length > 0) {
				instructions += `${generateSkillInstructions(skills)}\n`;
				const loaderTool = createSkillLoaderTool(skills);
				for (const skill of skills) {
					tools[`skill_${skill.name}`] = wrapSkillTool(loaderTool, skill.name);
				}
				logger.debug(`[skills] loaded ${skills.length} custom skills`);
			}
		} catch (err) {
			logger.error(`[skills] failed to load custom skills: ${err}`);
		}
	}

	return { instructions, tools };
}
