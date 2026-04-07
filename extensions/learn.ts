import { appendLibraryTopic, initLibrary } from "./state/library.js";
import type { WorkerResult } from "./types.js";

export interface LearnResult {
	learned: boolean;
	topic?: string;
	entry?: string;
}

function formatFailureEntry(result: WorkerResult): string {
	const error = result.error;
	const parts: string[] = [];
	parts.push(`## Failure Pattern (${error?.kind ?? "unknown"})`);
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

function formatNotesEntry(note: string): string {
	return `- ${note}`;
}

export function learnFromResult(basePath: string, result: WorkerResult, spawnAndLearn: boolean): LearnResult {
	if (!spawnAndLearn) {
		return { learned: false };
	}

	if (result.status === "failure") {
		initLibrary(basePath);
		const entry = formatFailureEntry(result);
		appendLibraryTopic(basePath, "pitfalls", entry);
		return { learned: true, topic: "pitfalls", entry };
	}

	if (result.status === "success") {
		const issues = result.handoff?.discoveredIssues ?? [];
		const notes = result.notes ?? [];

		if (issues.length === 0 && notes.length === 0) {
			return { learned: false };
		}

		initLibrary(basePath);
		const parts: string[] = [];

		for (const issue of issues) {
			parts.push(formatWorkaroundEntry(issue.description, issue.suggestedFix));
		}

		for (const note of notes) {
			parts.push(formatNotesEntry(note));
		}

		const entry = parts.join("\n");
		appendLibraryTopic(basePath, "pitfalls", entry);
		return { learned: true, topic: "pitfalls", entry };
	}

	return { learned: false };
}
