import type { WorkerResult } from "../types.js";

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

function extractFilesChanged(events: ParsedEvent[]): string[] {
	const files = new Set<string>();
	for (const event of events) {
		if (event.type !== "tool_execution_end") continue;
		const toolName = event.toolName as string | undefined;
		if (toolName !== "write" && toolName !== "edit") continue;
		const args = event.args as Record<string, unknown> | undefined;
		if (typeof args?.path === "string") {
			files.add(args.path);
		}
	}
	return Array.from(files);
}

function extractCommandsRun(events: ParsedEvent[]): Array<{ command: string; exitCode: number | null }> {
	const commands: Array<{ command: string; exitCode: number | null }> = [];
	for (const event of events) {
		if (event.type !== "tool_execution_end") continue;
		if (event.toolName !== "bash") continue;
		const args = event.args as Record<string, unknown> | undefined;
		if (typeof args?.command !== "string") continue;
		const result = event.result as Record<string, unknown> | undefined;
		const exitCode = typeof result?.exitCode === "number" ? result.exitCode : null;
		commands.push({ command: args.command, exitCode });
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

function hasFatalToolError(events: ParsedEvent[]): boolean {
	for (const event of events) {
		if (event.type !== "tool_execution_end") continue;
		if (event.isError === true) return true;
	}
	return false;
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
		if (typeof usage.totalTokens === "number") {
			totalTokens += usage.totalTokens;
			found = true;
		}
		const cost = usage.cost as Record<string, unknown> | undefined;
		if (cost) {
			const inputCost = typeof cost.input === "number" ? cost.input : 0;
			const outputCost = typeof cost.output === "number" ? cost.output : 0;
			const cacheReadCost = typeof cost.cacheRead === "number" ? cost.cacheRead : 0;
			const cacheWriteCost = typeof cost.cacheWrite === "number" ? cost.cacheWrite : 0;
			totalCost += inputCost + outputCost + cacheReadCost + cacheWriteCost;
		}
	}
	if (!found) return {};
	return { tokensUsed: totalTokens, estimatedCost: totalCost };
}

export function synthesizeWorkerResult(
	stdout: string,
	_stderr: string,
	exitCode: number | null,
	signal: string | null,
	startTime: number,
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
			summary: "Worker produced no output",
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

	if (exitCode !== 0) {
		return {
			status: "failure",
			summary,
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
			summary,
			filesChanged,
			commandsRun,
			error: {
				kind: "tool",
				message: "Worker encountered a fatal tool error",
			},
			metrics: { durationMs, ...tokenMetrics },
		};
	}

	return {
		status: "success",
		summary,
		filesChanged,
		commandsRun,
		metrics: { durationMs, ...tokenMetrics },
	};
}
