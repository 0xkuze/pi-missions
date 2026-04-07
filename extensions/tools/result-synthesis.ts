import type { WorkerHandoff, WorkerResult } from "../types.js";

export type TestsStatus = "passed" | "failed" | "not_run" | "unknown";
export type LintStatus = "clean" | "issues" | "not_run" | "unknown";

export interface StructuredSummary {
	testsStatus: TestsStatus;
	lintStatus: LintStatus;
}

export interface SynthesisOptions {
	legacyMode?: boolean;
}

type ParsedEvent = Record<string, unknown>;

function parseEvents(stdout: string): ParsedEvent[] {
	const events: ParsedEvent[] = [];
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			if (parsed !== null && typeof parsed === "object") {
				events.push(parsed as ParsedEvent);
			}
		} catch {
			// skip malformed lines
		}
	}
	return events;
}

function extractPathFromResult(event: ParsedEvent): string | null {
	const result = event.result as Record<string, unknown> | undefined;
	if (!result) return null;
	const content = result.content as Array<Record<string, unknown>> | undefined;
	if (!Array.isArray(content)) return null;
	for (const block of content) {
		if (block.type !== "text" || typeof block.text !== "string") continue;
		const match = /(?:wrote \d+ bytes to|replaced \d+ block|in) (\S+\.\w+)/.exec(block.text);
		if (match?.[1]) return match[1];
	}
	return null;
}

function extractFilesChanged(events: ParsedEvent[]): string[] {
	const files = new Set<string>();
	for (const event of events) {
		if (event.type !== "tool_execution_end") continue;
		const toolName = event.toolName as string | undefined;
		if (toolName !== "write" && toolName !== "edit") continue;
		const args = event.args as Record<string, unknown> | undefined;
		if (typeof args?.path === "string") {
			files.add(args.path);
			continue;
		}
		const pathFromResult = extractPathFromResult(event);
		if (pathFromResult) files.add(pathFromResult);
	}
	return Array.from(files);
}

function extractCommandFromResult(event: ParsedEvent): { command: string; exitCode: number | null } | null {
	const result = event.result as Record<string, unknown> | undefined;
	if (!result) return null;
	const content = result.content as Array<Record<string, unknown>> | undefined;
	if (!Array.isArray(content)) return null;
	for (const block of content) {
		if (block.type !== "text" || typeof block.text !== "string") continue;
		const text = block.text;
		const exitMatch = /Command exited with code (\d+)/.exec(text);
		const exitCode = exitMatch ? Number.parseInt(exitMatch[1], 10) : null;
		return { command: "(unknown)", exitCode };
	}
	return null;
}

function buildStartArgsMap(events: ParsedEvent[]): Map<string, Record<string, unknown>> {
	const map = new Map<string, Record<string, unknown>>();
	for (const event of events) {
		if (event.type !== "tool_execution_start") continue;
		const id = event.toolCallId as string | undefined;
		const args = event.args as Record<string, unknown> | undefined;
		if (id && args) map.set(id, args);
	}
	return map;
}

function extractCommandsRun(events: ParsedEvent[]): Array<{ command: string; exitCode: number | null }> {
	const startArgs = buildStartArgsMap(events);
	const commands: Array<{ command: string; exitCode: number | null }> = [];
	for (const event of events) {
		if (event.type !== "tool_execution_end") continue;
		if (event.toolName !== "bash") continue;
		const endArgs = event.args as Record<string, unknown> | undefined;
		const callId = event.toolCallId as string | undefined;
		const args = (typeof endArgs?.command === "string" ? endArgs : callId ? startArgs.get(callId) : undefined) as
			| Record<string, unknown>
			| undefined;
		if (typeof args?.command === "string") {
			const result = event.result as Record<string, unknown> | undefined;
			const exitCode = typeof result?.exitCode === "number" ? result.exitCode : null;
			commands.push({ command: args.command, exitCode });
			continue;
		}
		const fromResult = extractCommandFromResult(event);
		if (fromResult) commands.push(fromResult);
	}
	return commands;
}

function extractSummary(events: ParsedEvent[]): string {
	let lastAssistantText = "";
	for (const event of events) {
		if (event.type !== "message_end") continue;
		const message = event.message as Record<string, unknown> | undefined;
		if (message?.role !== "assistant") continue;
		const content = message.content as Array<Record<string, unknown>> | undefined;
		if (!Array.isArray(content)) continue;
		const textParts = content
			.filter((block) => block.type === "text" && typeof block.text === "string")
			.map((block) => block.text as string);
		if (textParts.length > 0) {
			lastAssistantText = textParts.join("");
		}
	}
	return lastAssistantText;
}

const NON_FATAL_TOOLS = new Set(["commit_changes", "git_commit", "git", "bash", "read", "grep", "find", "ls"]);

// why: only edit/write errors are fatal — read/bash/grep/find/ls errors are
// normal workflow (file not found, command failed). Workers recover from these.
function hasFatalToolError(events: ParsedEvent[]): boolean {
	const toolEndEvents = events.filter((e) => e.type === "tool_execution_end");
	if (toolEndEvents.length === 0) return false;

	const lastToolEnd = toolEndEvents[toolEndEvents.length - 1];
	if (lastToolEnd.isError === true) {
		const toolName = lastToolEnd.toolName as string | undefined;
		if (toolName && NON_FATAL_TOOLS.has(toolName)) return false;
		return true;
	}

	for (const event of toolEndEvents) {
		if (event.isError !== true) continue;
		const toolName = event.toolName as string | undefined;
		if (toolName && NON_FATAL_TOOLS.has(toolName)) continue;
		return true;
	}
	return false;
}

function extractUsageTokens(usage: Record<string, unknown>): number | null {
	const input = typeof usage.input === "number" ? usage.input : null;
	const output = typeof usage.output === "number" ? usage.output : null;
	if (input !== null && output !== null) return input + output;
	if (typeof usage.totalTokens === "number") return usage.totalTokens;
	return null;
}

function extractUsageCost(usage: Record<string, unknown>): number | null {
	const cost = usage.cost as Record<string, unknown> | undefined;
	if (!cost) return null;
	if (typeof cost.total === "number") return cost.total;
	const inputCost = typeof cost.input === "number" ? cost.input : 0;
	const outputCost = typeof cost.output === "number" ? cost.output : 0;
	const cacheReadCost = typeof cost.cacheRead === "number" ? cost.cacheRead : 0;
	const cacheWriteCost = typeof cost.cacheWrite === "number" ? cost.cacheWrite : 0;
	return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

function extractMetrics(events: ParsedEvent[]): { tokensUsed?: number; estimatedCost?: number } {
	let totalTokens = 0;
	let totalCost = 0;
	let found = false;
	for (const event of events) {
		if (event.type !== "message_end") continue;
		const message = event.message as Record<string, unknown> | undefined;
		if (message?.role !== "assistant") continue;
		const usage = message.usage as Record<string, unknown> | undefined;
		if (!usage) continue;
		const tokens = extractUsageTokens(usage);
		if (tokens !== null) {
			totalTokens += tokens;
			found = true;
		}
		const cost = extractUsageCost(usage);
		if (cost !== null) {
			totalCost += cost;
		}
	}
	if (!found) return {};
	return { tokensUsed: totalTokens, estimatedCost: totalCost };
}

function parseTestsStatus(text: string): TestsStatus {
	const testsMatch = /- Tests:\s*(passed|failed|not run)/i.exec(text);
	if (!testsMatch) return "unknown";
	const value = testsMatch[1].toLowerCase();
	if (value === "passed") return "passed";
	if (value === "failed") return "failed";
	if (value === "not run") return "not_run";
	return "unknown";
}

function parseLintStatus(text: string): LintStatus {
	const lintMatch = /- Lint:\s*(clean|issues|not run)/i.exec(text);
	if (!lintMatch) return "unknown";
	const value = lintMatch[1].toLowerCase();
	if (value === "clean") return "clean";
	if (value === "issues") return "issues";
	if (value === "not run") return "not_run";
	return "unknown";
}

export function parseStructuredSummary(text: string): StructuredSummary {
	return {
		testsStatus: parseTestsStatus(text),
		lintStatus: parseLintStatus(text),
	};
}

const MAX_STDERR_LINES = 50;
const MAX_STDERR_BYTES = 4096;

function truncateStderr(stderr: string): string {
	const trimmed = stderr.trim();
	if (!trimmed) return "";
	const lines = trimmed.split("\n");
	if (lines.length <= MAX_STDERR_LINES && trimmed.length <= MAX_STDERR_BYTES) return trimmed;
	const truncated = lines.slice(0, MAX_STDERR_LINES).join("\n").slice(0, MAX_STDERR_BYTES);
	return `${truncated}\n... [truncated]`;
}

function appendStderrToSummary(summary: string, stderr: string): string {
	const truncated = truncateStderr(stderr);
	if (!truncated) return summary;
	return `${summary}\n\n--- Worker stderr ---\n${truncated}`;
}

function extractHandoffArgs(events: ParsedEvent[]): Record<string, unknown> | null {
	for (const event of events) {
		if (event.type !== "tool_execution_end") continue;
		if (event.toolName !== "report_result") continue;
		const args = event.args;
		if (args !== null && args !== undefined && typeof args === "object" && !Array.isArray(args)) {
			return args as Record<string, unknown>;
		}
		return null;
	}
	return null;
}

function validateHandoff(args: Record<string, unknown>): WorkerHandoff | null {
	if (typeof args.whatWasImplemented !== "string") return null;
	if (typeof args.whatWasLeftUndone !== "string") return null;
	if (!Array.isArray(args.commandsRun)) return null;
	if (!Array.isArray(args.testsAdded)) return null;
	if (!Array.isArray(args.discoveredIssues)) return null;

	const validSeverities = new Set(["low", "medium", "high"]);
	for (const cmd of args.commandsRun as Array<Record<string, unknown>>) {
		if (typeof cmd.command !== "string" || typeof cmd.exitCode !== "number" || typeof cmd.observation !== "string") {
			return null;
		}
	}
	for (const test of args.testsAdded as Array<Record<string, unknown>>) {
		if (typeof test.file !== "string" || !Array.isArray(test.cases)) return null;
		for (const c of test.cases as unknown[]) {
			if (typeof c !== "string") return null;
		}
	}
	for (const issue of args.discoveredIssues as Array<Record<string, unknown>>) {
		if (typeof issue.severity !== "string" || !validSeverities.has(issue.severity)) return null;
		if (typeof issue.description !== "string") return null;
		if (issue.suggestedFix !== undefined && typeof issue.suggestedFix !== "string") return null;
	}

	return {
		whatWasImplemented: args.whatWasImplemented,
		whatWasLeftUndone: args.whatWasLeftUndone,
		commandsRun: args.commandsRun as WorkerHandoff["commandsRun"],
		testsAdded: args.testsAdded as WorkerHandoff["testsAdded"],
		discoveredIssues: args.discoveredIssues as WorkerHandoff["discoveredIssues"],
	};
}

export function synthesizeWorkerResult(
	stdout: string,
	stderr: string,
	exitCode: number | null,
	signal: string | null,
	startTime: number,
	options?: SynthesisOptions,
): WorkerResult {
	const durationMs = Math.max(1, Date.now() - startTime);

	if (signal !== null) {
		return {
			status: "failure",
			summary: "Worker process was killed by signal",
			filesChanged: [],
			commandsRun: [],
			error: {
				kind: "environment",
				message: `Worker process killed by signal ${signal}`,
			},
			metrics: { durationMs },
		};
	}

	if (!stdout.trim()) {
		return {
			status: "failure",
			summary: appendStderrToSummary("Worker produced no output", stderr),
			filesChanged: [],
			commandsRun: [],
			error: {
				kind: "unknown",
				message: "Worker stdout was empty",
			},
			metrics: { durationMs },
		};
	}

	const events = parseEvents(stdout);
	const filesChanged = extractFilesChanged(events);
	const commandsRun = extractCommandsRun(events);
	const summary = extractSummary(events) || "Worker completed without producing a summary";
	const fatalToolError = hasFatalToolError(events);
	const tokenMetrics = extractMetrics(events);
	const handoffArgs = extractHandoffArgs(events);
	const hasReportResult = handoffArgs !== null;

	if (exitCode !== 0) {
		return {
			status: "failure",
			summary: appendStderrToSummary(summary, stderr),
			filesChanged,
			commandsRun,
			error: {
				kind: "unknown",
				message: `Worker exited with code ${exitCode}`,
			},
			metrics: { durationMs, ...tokenMetrics },
		};
	}

	if (fatalToolError) {
		return {
			status: "failure",
			summary: appendStderrToSummary(summary, stderr),
			filesChanged,
			commandsRun,
			error: {
				kind: "tool",
				message: "Worker encountered a fatal tool error",
			},
			metrics: { durationMs, ...tokenMetrics },
		};
	}

	const structuredSummary = parseStructuredSummary(summary);
	if (structuredSummary.testsStatus === "failed") {
		return {
			status: "failure",
			summary,
			filesChanged,
			commandsRun,
			error: {
				kind: "validation",
				message: "Worker reported failing tests in structured summary",
			},
			metrics: { durationMs, ...tokenMetrics },
		};
	}

	if (!hasReportResult) {
		if (options?.legacyMode || (exitCode === 0 && filesChanged.length > 0)) {
			return {
				status: "success",
				summary,
				filesChanged,
				commandsRun,
				notes: ["Worker did not call report_result — structured handoff is missing"],
				metrics: { durationMs, ...tokenMetrics },
			};
		}
		return {
			status: "failure",
			summary,
			filesChanged,
			commandsRun,
			error: {
				kind: "validation",
				message: "Worker did not call report_result — structured handoff is missing",
			},
			metrics: { durationMs, ...tokenMetrics },
		};
	}

	const handoff = validateHandoff(handoffArgs);
	if (!handoff) {
		return {
			status: "failure",
			summary,
			filesChanged,
			commandsRun,
			error: {
				kind: "validation",
				message: "Worker called report_result with malformed or incomplete data — structured handoff is invalid",
			},
			metrics: { durationMs, ...tokenMetrics },
		};
	}

	return {
		status: "success",
		summary,
		filesChanged,
		commandsRun,
		handoff,
		metrics: { durationMs, ...tokenMetrics },
	};
}
