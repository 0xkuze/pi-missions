import { matchesKey } from "@mariozechner/pi-tui";
import { formatDuration } from "../utils.js";
import { frame } from "./frame.js";

export type ValidationViewAction = { kind: "close" } | { kind: "noop" };

export type CommandStatus = "passed" | "failed" | "running" | "pending";

export interface CommandDisplayEntry {
	label: string;
	status: CommandStatus;
	durationMs?: number;
}

function commandStatusIcon(status: CommandStatus): string {
	switch (status) {
		case "passed":
			return "\u2713";
		case "failed":
			return "\u2717";
		case "running":
			return "\u25cf";
		case "pending":
			return "\u25cb";
	}
}

export function renderValidationView(
	milestoneName: string,
	commands: CommandDisplayEntry[],
	hasFailed: boolean,
	width = 80,
): string[] {
	const lines: string[] = [];

	lines.push(`Validating: ${milestoneName}`);
	lines.push("");

	if (commands.length === 0) {
		lines.push("(no validation commands)");
	} else {
		for (const cmd of commands) {
			const icon = commandStatusIcon(cmd.status);
			const duration =
				cmd.status === "passed" || cmd.status === "failed"
					? cmd.durationMs !== undefined
						? ` (${formatDuration(cmd.durationMs)})`
						: ""
					: "";
			lines.push(`${icon} ${cmd.label}${duration}`);
		}
	}

	if (hasFailed) {
		lines.push("");
		lines.push("One or more checks failed. A fix feature will be generated to address the failures.");
	}

	return frame("Milestone Validation", lines, width, "Esc: close");
}

export function handleValidationViewKey(key: string): ValidationViewAction {
	if (matchesKey(key, "escape")) return { kind: "close" };
	return { kind: "noop" };
}
