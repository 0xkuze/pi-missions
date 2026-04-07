import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { loadMissionConfig, resolveModel } from "../config.js";
import { readLibraryTopic } from "../state/library.js";
import { loadContract, loadPlan, loadState } from "../state/manager.js";
import type { Milestone, MissionPlan, MissionState, WorkerResult } from "../types.js";
import { getPiInvocation, nowISO } from "../utils.js";

export interface ScrutinyIssue {
	severity: "info" | "warning" | "error";
	description: string;
	location: string;
	suggestedFix?: string;
}

export interface ScrutinyReport {
	status: "clean" | "error" | "timeout";
	milestoneId: string;
	timestamp: string;
	reviewerModel: string;
	durationMs: number;
	issues: ScrutinyIssue[];
}

interface StreamLike {
	on(event: string, handler: (data: Buffer) => void): unknown;
}

interface ProcLike {
	stdout: StreamLike | null;
	stderr: StreamLike | null;
	on(event: string, handler: (...args: unknown[]) => void): unknown;
}

type SpawnFn = (command: string, args: string[], options: Record<string, unknown>) => ProcLike;

const DEFAULT_SCRUTINY_TIMEOUT_MS = 600_000;

export interface RunScrutinyDeps {
	basePath: string;
	projectDir: string;
	updateWidget: (state: MissionState, plan?: MissionPlan) => void;
	spawnFn: SpawnFn;
	_timeoutMs?: number;
}

function findMilestone(plan: MissionPlan, milestoneId: string): Milestone | undefined {
	return plan.milestones.find((m) => m.id === milestoneId);
}

function collectChangedFiles(milestone: Milestone): string[] {
	const files = new Set<string>();
	for (const feature of milestone.features) {
		for (const f of feature.relevantFiles) {
			files.add(f);
		}
	}
	return [...files];
}

function buildCriteriaSection(milestone: Milestone): string {
	const lines: string[] = [];
	lines.push(`## Features and Acceptance Criteria`);
	for (const feature of milestone.features) {
		lines.push(`### ${feature.name} (${feature.id}) — ${feature.status}`);
		lines.push(feature.description);
		if (feature.acceptanceCriteria.length > 0) {
			for (const c of feature.acceptanceCriteria) {
				lines.push(`- ${c}`);
			}
		}
	}
	return lines.join("\n");
}

function buildContractSection(milestoneId: string, basePath: string): string {
	const contract = loadContract(basePath);
	if (!contract || contract.assertions.length === 0) return "";

	const milestone = loadPlan(basePath)?.milestones.find((m) => m.id === milestoneId);
	const featureIds = new Set(milestone?.features.map((f) => f.id) ?? []);
	const relevant = contract.assertions.filter((a) => featureIds.has(a.featureId));

	if (relevant.length === 0) return "";

	const lines: string[] = [];
	lines.push("## Validation Contract Assertions");
	for (const a of relevant) {
		lines.push(`- ${a.id}: ${a.description} (status: ${a.status})`);
	}
	return lines.join("\n");
}

function buildLibrarySection(basePath: string): string {
	const sections: string[] = [];
	const pitfalls = readLibraryTopic(basePath, "pitfalls");
	if (pitfalls && pitfalls.trim().length > 0) {
		sections.push(`## Known Pitfalls\n${pitfalls}`);
	}
	const conventions = readLibraryTopic(basePath, "conventions");
	if (conventions && conventions.trim().length > 0) {
		sections.push(`## Project Conventions\n${conventions}`);
	}
	return sections.join("\n\n");
}

function loadWorkerResults(milestone: Milestone): string[] {
	const summaries: string[] = [];
	for (const feature of milestone.features) {
		if (feature.status !== "done" && feature.status !== "failed") continue;
		const lastAttempt = feature.attempts[feature.attempts.length - 1];
		if (!lastAttempt?.resultPath) continue;
		try {
			const raw = readFileSync(lastAttempt.resultPath, "utf8");
			const result = JSON.parse(raw) as WorkerResult;
			const lines: string[] = [];
			lines.push(`### ${feature.name} (${feature.id}) — ${result.status}`);
			lines.push(`Summary: ${result.summary}`);
			if (result.filesChanged.length > 0) {
				lines.push(`Files changed: ${result.filesChanged.join(", ")}`);
			}
			if (result.handoff) {
				if (result.handoff.discoveredIssues.length > 0) {
					lines.push("Discovered issues:");
					for (const issue of result.handoff.discoveredIssues) {
						lines.push(`  - [${issue.severity}] ${issue.description}`);
					}
				}
				if (result.handoff.whatWasLeftUndone) {
					lines.push(`Left undone: ${result.handoff.whatWasLeftUndone}`);
				}
			}
			summaries.push(lines.join("\n"));
		} catch {
			// why: result file may not exist or be malformed — skip gracefully
		}
	}
	return summaries;
}

function generateScrutinySkill(milestone: Milestone, basePath: string): string {
	const parts: string[] = [];

	parts.push("# Scrutiny Review");
	parts.push(`Review the following milestone for issues: **${milestone.name}**`);
	parts.push(milestone.description);

	const changedFiles = collectChangedFiles(milestone);
	if (changedFiles.length > 0) {
		parts.push("\n## Changed Files");
		for (const f of changedFiles) {
			parts.push(`- ${f}`);
		}
	}

	parts.push("");
	parts.push(buildCriteriaSection(milestone));

	const contractSection = buildContractSection(milestone.id, basePath);
	if (contractSection) {
		parts.push("");
		parts.push(contractSection);
	}

	const workerSummaries = loadWorkerResults(milestone);
	if (workerSummaries.length > 0) {
		parts.push("");
		parts.push("## Worker Results");
		for (const s of workerSummaries) {
			parts.push(s);
		}
	}

	const librarySection = buildLibrarySection(basePath);
	if (librarySection) {
		parts.push("");
		parts.push(librarySection);
	}

	parts.push("");
	parts.push("## Output Format");
	parts.push(
		'Produce a JSON object with an "issues" array. Each issue: { severity: "info"|"warning"|"error", description: string, location: string, suggestedFix?: string }',
	);

	return parts.join("\n");
}

export function parseScrutinyOutput(stdout: string): {
	issues: ScrutinyIssue[];
	status: "clean" | "error";
} {
	const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
	let messageEndText: string | undefined;

	for (const line of [...lines].reverse()) {
		try {
			const parsed = JSON.parse(line) as { type?: string; text?: string };
			if (parsed.type === "message_end" && typeof parsed.text === "string") {
				messageEndText = parsed.text;
				break;
			}
		} catch {}
	}

	if (messageEndText === undefined) {
		return { issues: [], status: "error" };
	}

	let data: unknown;
	try {
		data = JSON.parse(messageEndText);
	} catch {
		return { issues: [], status: "error" };
	}

	if (typeof data !== "object" || data === null) {
		return { issues: [], status: "error" };
	}

	const obj = data as Record<string, unknown>;
	if (!Array.isArray(obj.issues)) {
		return { issues: [], status: "error" };
	}

	const issues: ScrutinyIssue[] = [];
	for (const item of obj.issues) {
		if (typeof item !== "object" || item === null) continue;
		const issue = item as Record<string, unknown>;
		if (
			typeof issue.severity === "string" &&
			typeof issue.description === "string" &&
			typeof issue.location === "string"
		) {
			const validSeverities = new Set(["info", "warning", "error"]);
			issues.push({
				severity: validSeverities.has(issue.severity) ? (issue.severity as ScrutinyIssue["severity"]) : "info",
				description: issue.description,
				location: issue.location,
				suggestedFix: typeof issue.suggestedFix === "string" ? issue.suggestedFix : undefined,
			});
		}
	}

	return { issues, status: issues.length === 0 ? "clean" : "clean" };
}

function writeScrutinyArtifacts(basePath: string, milestoneId: string, report: ScrutinyReport, stdout: string): void {
	const dir = join(basePath, "runtime", "validation", milestoneId, "scrutiny");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2), "utf8");
	writeFileSync(join(dir, "stdout.log"), stdout, "utf8");
}

export function loadScrutinyReport(basePath: string, milestoneId: string): ScrutinyReport | null {
	const filePath = join(basePath, "runtime", "validation", milestoneId, "scrutiny", "report.json");
	let raw: string;
	try {
		raw = readFileSync(filePath, "utf8");
	} catch {
		return null;
	}
	try {
		return JSON.parse(raw) as ScrutinyReport;
	} catch {
		return null;
	}
}

function spawnScrutinyProcess(
	spawnFn: SpawnFn,
	command: string,
	args: string[],
	cwd: string,
	timeoutMs: number,
): Promise<{
	stdout: string;
	stderr: string;
	exitCode: number | null;
	timedOut: boolean;
	aborted: boolean;
}> {
	return new Promise((resolve) => {
		const proc = spawnFn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });

		let stdoutBuf = "";
		let stderrBuf = "";
		let killed = false;
		let timedOut = false;
		let settled = false;
		let timeoutId: ReturnType<typeof setTimeout> | undefined;

		function doResolve(result: {
			stdout: string;
			stderr: string;
			exitCode: number | null;
			timedOut: boolean;
			aborted: boolean;
		}): void {
			if (settled) return;
			settled = true;
			if (timeoutId) clearTimeout(timeoutId);
			resolve(result);
		}

		proc.stdout?.on("data", (chunk: Buffer) => {
			stdoutBuf += chunk.toString();
		});

		proc.stderr?.on("data", (chunk: Buffer) => {
			stderrBuf += chunk.toString();
		});

		proc.on("close", (...closeArgs: unknown[]) => {
			const code = closeArgs[0] as number | null;
			doResolve({
				stdout: stdoutBuf,
				stderr: stderrBuf,
				exitCode: killed ? null : code,
				timedOut,
				aborted: false,
			});
		});

		proc.on("error", () => {
			doResolve({
				stdout: stdoutBuf,
				stderr: stderrBuf,
				exitCode: null,
				timedOut: false,
				aborted: false,
			});
		});

		if (timeoutMs > 0) {
			timeoutId = setTimeout(() => {
				timedOut = true;
				killed = true;
				doResolve({
					stdout: stdoutBuf,
					stderr: stderrBuf,
					exitCode: null,
					timedOut: true,
					aborted: false,
				});
			}, timeoutMs);
		}
	});
}

export function registerRunScrutinyTool(pi: ExtensionAPI, deps: RunScrutinyDeps): void {
	const spawnFn = deps.spawnFn;

	pi.registerTool({
		name: "run_scrutiny",
		label: "Run Scrutiny",
		description:
			"Spawn a scrutiny reviewer for a milestone. Generates a skill file with changed files, acceptance criteria, contract assertions, and library context. Returns a structured report with issues.",
		promptSnippet: "Run a scrutiny review for a milestone after validation passes.",
		parameters: Type.Object({
			milestoneId: Type.String({ description: "ID of the milestone to scrutinize" }),
		}),
		renderCall(args: any, theme: any) {
			return new Text(
				theme.fg("toolTitle", theme.bold("run_scrutiny ")) + theme.fg("accent", args.milestoneId || "..."),
				0,
				0,
			);
		},
		renderResult(result: any, { expanded }: any, theme: any) {
			const text = result.content?.[0];
			if (text?.type !== "text") return new Text("(no output)", 0, 0);
			try {
				const parsed = JSON.parse(text.text) as ScrutinyReport;
				const issueCount = parsed.issues.length;
				const statusIcon =
					parsed.status === "clean"
						? theme.fg("success", "\u2713")
						: parsed.status === "timeout"
							? theme.fg("warning", "\u26A0")
							: theme.fg("error", "\u2717");
				const summary = `${issueCount} issue${issueCount === 1 ? "" : "s"}`;
				if (!expanded) return new Text(`${statusIcon} Scrutiny: ${summary}`, 0, 0);
				const lines = [`${statusIcon} Scrutiny: ${summary}`];
				for (const issue of parsed.issues) {
					const severityIcon =
						issue.severity === "error"
							? theme.fg("error", "\u2717")
							: issue.severity === "warning"
								? theme.fg("warning", "\u26A0")
								: theme.fg("accent", "i");
					lines.push(`  ${severityIcon} ${issue.description} (${issue.location})`);
				}
				return new Text(lines.join("\n"), 0, 0);
			} catch {
				return new Text(text.text, 0, 0);
			}
		},
		async execute(_toolCallId, params) {
			const state = loadState(deps.basePath);
			if (!state) {
				return { content: [{ type: "text", text: "Error: no active mission state." }], details: {} };
			}

			if (state.status !== "executing") {
				return {
					content: [
						{
							type: "text",
							text: `Error: run_scrutiny requires 'executing' state. Current: '${state.status}'.`,
						},
					],
					details: {},
				};
			}

			const plan = loadPlan(deps.basePath);
			if (!plan) {
				return { content: [{ type: "text", text: "Error: no plan found." }], details: {} };
			}

			const milestone = findMilestone(plan, params.milestoneId);
			if (!milestone) {
				return {
					content: [
						{
							type: "text",
							text: `Error: milestone '${params.milestoneId}' not found in plan.`,
						},
					],
					details: {},
				};
			}

			const config = loadMissionConfig(deps.basePath);
			const reviewerModel = resolveModel("validator", config, plan);

			const skillContent = generateScrutinySkill(milestone, deps.basePath);

			const scrutinyDir = join(deps.basePath, "runtime", "validation", params.milestoneId, "scrutiny");
			mkdirSync(scrutinyDir, { recursive: true });
			const skillPath = join(scrutinyDir, "scrutiny-skill.md");
			writeFileSync(skillPath, skillContent, "utf8");

			const workerArgs = ["--mode", "json", "-p", "--no-session"];
			if (reviewerModel) {
				workerArgs.push("--model", reviewerModel);
			}
			workerArgs.push("--skill", skillPath, "Review the milestone code for issues. Output JSON as specified.");

			const { command, commandArgs } = getPiInvocation(workerArgs);

			const startTime = Date.now();
			const timeoutMs = deps._timeoutMs ?? DEFAULT_SCRUTINY_TIMEOUT_MS;

			const procResult = await spawnScrutinyProcess(spawnFn, command, commandArgs, deps.projectDir, timeoutMs);
			const durationMs = Date.now() - startTime;

			if (procResult.timedOut) {
				const report: ScrutinyReport = {
					status: "timeout",
					milestoneId: params.milestoneId,
					timestamp: nowISO(),
					reviewerModel: reviewerModel ?? "",
					durationMs,
					issues: [],
				};
				writeScrutinyArtifacts(deps.basePath, params.milestoneId, report, procResult.stdout);
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(report),
						},
					],
					details: {},
				};
			}

			const parsed = parseScrutinyOutput(procResult.stdout);
			const reportStatus = parsed.status;

			const report: ScrutinyReport = {
				status: reportStatus,
				milestoneId: params.milestoneId,
				timestamp: nowISO(),
				reviewerModel: reviewerModel ?? "",
				durationMs,
				issues: parsed.issues,
			};

			writeScrutinyArtifacts(deps.basePath, params.milestoneId, report, procResult.stdout);

			return {
				content: [{ type: "text", text: JSON.stringify(report) }],
				details: {},
			};
		},
	});
}
