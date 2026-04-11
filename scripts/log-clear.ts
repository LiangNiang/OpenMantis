import { mkdirSync, rmSync, writeFileSync } from "node:fs";

rmSync(".openmantis/routes", { recursive: true, force: true });
rmSync(".openmantis/openmantis.log", { recursive: true, force: true });
