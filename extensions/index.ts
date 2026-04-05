import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerCommands } from "./commands.js";
import type { MissionPlan, MissionState } from "./types.js";

export default function (pi: ExtensionAPI): void {
	const basePath = join(process.cwd(), ".pi", "missions");

	function updateWidget(_state: MissionState, _plan?: MissionPlan): void {
		// widget implementation delegated to widget feature
	}

	function clearWidget(): void {
		// widget clear implementation delegated to widget feature
	}

	registerCommands(pi, { basePath, updateWidget, clearWidget });
}
