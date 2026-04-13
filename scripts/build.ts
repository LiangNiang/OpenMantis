import { $ } from "bun";

const TARGETS = [
	{ target: "bun-linux-x64", output: "openmantis-linux-x64" },
	{ target: "bun-linux-arm64", output: "openmantis-linux-arm64" },
	{ target: "bun-darwin-x64", output: "openmantis-darwin-x64" },
	{ target: "bun-darwin-arm64", output: "openmantis-darwin-arm64" },
	{ target: "bun-windows-x64", output: "openmantis-windows-x64.exe" },
	{ target: "bun-windows-arm64", output: "openmantis-windows-arm64.exe" },
] as const;

async function buildWeb() {
	console.log("Building web frontend...");
	await $`bun run build:web`;
	console.log("Web frontend built.");
}

async function compile(target?: string) {
	const targets = target
		? TARGETS.filter((t) => t.target === target)
		: [undefined]; // current platform

	if (target && targets.length === 0) {
		console.error(`Unknown target: ${target}`);
		console.error(`Available: ${TARGETS.map((t) => t.target).join(", ")}`);
		process.exit(1);
	}

	for (const t of targets) {
		const outfile = t ? `dist/bin/${t.output}` : "dist/bin/openmantis";
		const targetArgs = t ? ["--target", t.target] : [];

		console.log(`Compiling${t ? ` for ${t.target}` : ""}...`);

		await $`bun build --compile \
			--minify \
			--sourcemap \
			--bytecode \
			${targetArgs} \
			--outfile ${outfile} \
			./src/cli.ts \
			./dist/web/**/* \
			./skills/builtin/**/*`;

		console.log(`Built: ${outfile}`);
	}
}

async function main() {
	const args = process.argv.slice(2);
	const targetFlag = args.indexOf("--target");
	const target = targetFlag !== -1 ? args[targetFlag + 1] : undefined;
	const all = args.includes("--all");

	await buildWeb();

	if (all) {
		for (const t of TARGETS) {
			await compile(t.target);
		}
	} else {
		await compile(target);
	}
}

main().catch((err) => {
	console.error("Build failed:", err);
	process.exit(1);
});
