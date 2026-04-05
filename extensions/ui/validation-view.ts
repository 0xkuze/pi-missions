import { matchesKey } from "@mariozechner/pi-tui";
import { formatDuration } from "../utils.js";
import type { FrameStyle } from "./frame.js";
import { footerBar, panel, titleBar } from "./frame.js";

export type ValidationViewAction = { kind: "close" } | { kind: "noop" };

export type CommandStatus = "passed" | "failed" | "running" | "pending";

export interface CommandDisplayEntry {
	label: string;
	status: CommandStatus;
	durationMs?: number;
}

function styledCommandStatusIcon(status: CommandStatus, style?: FrameStyle): string {
	switch (status) {
		case "passed":
			return (style?.successFn ?? ((t: string) => t))("\u2713");
		case "failed":
			return (style?.errorFn ?? ((t: string) => t))("\u2717");
		case "running":
			return (style?.accentFn ?? ((t: string) => t))("\u25cf");
		case "pending":
			return (style?.mutedFn ?? ((t: string) => t))("\u25cb");
	}
}

export function renderValidationView(
	milestoneName: string,
	commands: CommandDisplayEntry[],
	hasFailed: boolean,
	width = 80,
	style?: FrameStyle,
	height = 40,
): string[] {
	const af = style?.accentFn ?? ((t: string) => t);
	const tf = style?.textFn ?? ((t: string) => t);
	const mf = style?.mutedFn ?? ((t: string) => t);
	const ef = style?.errorFn ?? ((t: string) => t);
	const lines: string[] = [];

	lines.push(`${af("Validating:")} ${tf(milestoneName)}`);
	lines.push("");

	if (commands.length === 0) {
		lines.push(mf("(no validation commands)"));
	} else {
		for (const cmd of commands) {
			const icon = styledCommandStatusIcon(cmd.status, style);
			const duration =
				cmd.status === "passed" || cmd.status === "failed"
					? cmd.durationMs !== undefined
						? ` ${mf(`(${formatDuration(cmd.durationMs)})`)}`
						: ""
					: "";
			lines.push(`${icon} ${tf(cmd.label)}${duration}`);
		}
	}

	if (hasFailed) {
		lines.push("");
		lines.push(ef("One or more checks failed. A fix feature will be generated to address the failures."));
	}

	const panelHeight = Math.max(5, height - 7);
	return [
		titleBar("Milestone Validation", width, style),
		...panel("Commands", lines, width, panelHeight, 0, style),
		...footerBar("Esc: close", width, style),
	];
}

export function handleValidationViewKey(key: string): ValidationViewAction {
	if (matchesKey(key, "escape")) return { kind: "close" };
	return { kind: "noop" };
}
