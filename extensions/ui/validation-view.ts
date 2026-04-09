import { matchesKey } from "@mariozechner/pi-tui";
import type { ScrutinyIssue, ScrutinyReport } from "../tools/run-scrutiny.js";
import type { AssertionResultData } from "../types.js";
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

function styledAssertionStatusIcon(status: AssertionResultData["status"], style?: FrameStyle): string {
	switch (status) {
		case "pass":
			return (style?.successFn ?? ((t: string) => t))("\u2713");
		case "fail":
			return (style?.errorFn ?? ((t: string) => t))("\u2717");
		case "error":
			return (style?.errorFn ?? ((t: string) => t))("\u2717");
	}
}

function styledSeverityIcon(severity: ScrutinyIssue["severity"], style?: FrameStyle): string {
	switch (severity) {
		case "error":
			return (style?.errorFn ?? ((t: string) => t))("\u2717");
		case "warning":
			return (style?.warningFn ?? ((t: string) => t))("\u26A0");
		case "info":
			return (style?.accentFn ?? ((t: string) => t))("i");
	}
}

function buildAssertionLines(assertions: AssertionResultData[], style?: FrameStyle): string[] {
	const tf = style?.textFn ?? ((t: string) => t);
	const mf = style?.mutedFn ?? ((t: string) => t);
	const ef = style?.errorFn ?? ((t: string) => t);
	const lines: string[] = [];

	for (const assertion of assertions) {
		const icon = styledAssertionStatusIcon(assertion.status, style);
		const duration = mf(`(${formatDuration(assertion.durationMs)})`);
		lines.push(`${icon} ${tf(assertion.assertionId)} ${mf(assertion.command)} ${duration}`);
		if (assertion.status === "fail") {
			const output = assertion.stdout.length > 0 ? assertion.stdout : assertion.stderr;
			const summary = output.length > 80 ? `${output.slice(0, 77)}...` : output;
			if (summary.length > 0) {
				lines.push(`  ${ef(summary)}`);
			}
		}
	}

	return lines;
}

function buildScrutinyLines(report: ScrutinyReport, style?: FrameStyle): string[] {
	const tf = style?.textFn ?? ((t: string) => t);
	const mf = style?.mutedFn ?? ((t: string) => t);
	const sf = style?.successFn ?? ((t: string) => t);
	const lines: string[] = [];

	if (report.issues.length === 0) {
		lines.push(sf("\u2713 No issues found"));
		return lines;
	}

	const counts = { error: 0, warning: 0, info: 0 };
	for (const issue of report.issues) {
		counts[issue.severity]++;
	}
	const parts: string[] = [];
	if (counts.error > 0) parts.push(`${counts.error} error${counts.error !== 1 ? "s" : ""}`);
	if (counts.warning > 0) parts.push(`${counts.warning} warning${counts.warning !== 1 ? "s" : ""}`);
	if (counts.info > 0) parts.push(`${counts.info} info`);

	lines.push(
		`${tf(report.issues.length.toString())} issue${report.issues.length !== 1 ? "s" : ""}: ${mf(parts.join(", "))}`,
	);
	lines.push("");

	for (const issue of report.issues) {
		const icon = styledSeverityIcon(issue.severity, style);
		lines.push(`${icon} ${tf(issue.description)} ${mf(`(${issue.location})`)}`);
	}

	return lines;
}

export function renderValidationView(
	milestoneName: string,
	commands: CommandDisplayEntry[],
	hasFailed: boolean,
	width: number,
	style: FrameStyle | undefined,
	height: number,
	scrollOffset = 0,
	assertions?: AssertionResultData[],
	scrutinyReport?: ScrutinyReport,
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

	const hasAssertions = assertions && assertions.length > 0;
	const hasScrutiny = scrutinyReport !== undefined;

	const panelsCount = 1 + (hasAssertions ? 1 : 0) + (hasScrutiny ? 1 : 0);
	const panelHeight = Math.max(5, Math.floor((height - 7) / panelsCount));

	const output: string[] = [titleBar("Milestone Validation", width, style)];
	output.push(...panel("Commands", lines, width, panelHeight, scrollOffset, style));

	if (hasAssertions) {
		const assertionLines = buildAssertionLines(assertions, style);
		output.push(...panel("Assertions", assertionLines, width, panelHeight, scrollOffset, style));
	}

	if (hasScrutiny) {
		const scrutinyLines = buildScrutinyLines(scrutinyReport, style);
		output.push(...panel("Scrutiny", scrutinyLines, width, panelHeight, scrollOffset, style));
	}

	output.push(...footerBar("Esc: close", width, style));
	return output;
}

export function handleValidationViewKey(key: string): ValidationViewAction {
	if (matchesKey(key, "escape")) return { kind: "close" };
	return { kind: "noop" };
}
