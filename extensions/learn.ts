import { appendLibraryTopic, initLibrary } from "./state/library.js";
import type { WorkerResult } from "./types.js";

export interface LearnResult {
	learned: boolean;
	topic?: string;
	entry?: string;
}

export interface FeatureContext {
	name: string;
	description: string;
}

function formatFailureEntry(result: WorkerResult, feature?: FeatureContext): string {
	const error = result.error;
	const parts: string[] = [];
	parts.push(`## Failure Pattern (${error?.kind ?? "unknown"})`);
	if (feature) {
		parts.push(`Feature: ${feature.name} — ${feature.description}`);
	}
	parts.push(`Message: ${error?.message ?? "Unknown error"}`);
	if (error?.details) {
		parts.push(`Details: ${error.details}`);
	}
	return parts.join("\n");
}

function formatWorkaroundEntry(description: string, suggestedFix?: string): string {
	const parts: string[] = [];
	parts.push(`- ${description}`);
	if (suggestedFix) {
		parts.push(`  Workaround: ${suggestedFix}`);
	}
	return parts.join("\n");
}

const SYSTEM_NOTE_PATTERNS = ["report_result", "structured handoff", "did not call", "malformed or incomplete"];

function isSystemDiagnostic(note: string): boolean {
	const lower = note.toLowerCase();
	return SYSTEM_NOTE_PATTERNS.some((p) => lower.includes(p));
}

function formatNotesEntry(note: string): string {
	return `- ${note}`;
}

export function learnFromResult(
	basePath: string,
	result: WorkerResult,
	spawnAndLearn: boolean,
	feature?: FeatureContext,
): LearnResult {
	if (!spawnAndLearn) {
		return { learned: false };
	}

	if (result.status === "failure") {
		initLibrary(basePath);
		const entry = formatFailureEntry(result, feature);
		appendLibraryTopic(basePath, "pitfalls", entry);
		return { learned: true, topic: "pitfalls", entry };
	}

	if (result.status === "success") {
		const issues = result.handoff?.discoveredIssues ?? [];
		const notes = (result.notes ?? []).filter((n) => !isSystemDiagnostic(n));
		const failedCmds = result.handoff?.commandsRun?.filter((c) => c.exitCode !== 0) ?? [];

		if (issues.length === 0 && notes.length === 0 && failedCmds.length === 0) {
			return { learned: false };
		}

		initLibrary(basePath);
		const parts: string[] = [];

		for (const issue of issues) {
			parts.push(formatWorkaroundEntry(issue.description, issue.suggestedFix));
		}

		for (const cmd of failedCmds) {
			parts.push(`- Command \`${cmd.command}\` failed (exit ${cmd.exitCode}): ${cmd.observation}`);
		}

		for (const note of notes) {
			parts.push(formatNotesEntry(note));
		}

		const entry = parts.join("\n");
		appendLibraryTopic(basePath, "conventions", entry);
		return { learned: true, topic: "conventions", entry };
	}

	return { learned: false };
}
