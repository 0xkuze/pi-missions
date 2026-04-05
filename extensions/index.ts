import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerCommands } from "./commands.js";

export default function (pi: ExtensionAPI): void {
	registerCommands(pi);
}
