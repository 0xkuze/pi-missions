import type { Feature, MissionPlan, MissionState } from "./types.js";
import { formatDuration } from "./utils.js";

export interface GitInfo {
	filesChanged: string[];
	commits: Array<{ sha: string; message: string }>;
	summary?: string;
	warnings?: string[];
	remainingNotes?: string[];
	featureMetrics?: Map<string, { tokensUsed?: number; estimatedCost?: number }>;
}

function totalFeatureDurationMs(feature: Feature): number | undefined {
	const withDuration = feature.attempts.filter((a) => a.durationMs !== undefined);
	if (withDuration.length === 0) return undefined;
	return withDuration.reduce((sum, a) => sum + (a.durationMs ?? 0), 0);
}

function featureLabel(feature: Feature): string {
	return feature.fixOrigin ? `[fix] ${feature.name}` : feature.name;
}

function renderFeatureLines(feature: Feature, metrics?: { tokensUsed?: number; estimatedCost?: number }): string[] {
	const lines: string[] = [];
	const attemptCount = feature.attempts.length;
	const durationMs = totalFeatureDurationMs(feature);
	const durationStr = durationMs !== undefined ? ` · ${formatDuration(durationMs)}` : "";
	const attemptsStr = attemptCount > 0 ? ` · ${attemptCount} attempt${attemptCount !== 1 ? "s" : ""}` : "";
	lines.push(`  - **${featureLabel(feature)}** — ${feature.status}${durationStr}${attemptsStr}`);

	if (feature.fixOrigin) {
		const origin = feature.fixOrigin;
		const source = origin.sourceFeatureId ? ` (source: ${origin.sourceFeatureId})` : "";
		lines.push(`    - Fix origin: ${origin.sourceKind}${source}`);
	}

	if (metrics) {
		if (metrics.tokensUsed !== undefined) {
			lines.push(`    - Tokens: ${metrics.tokensUsed}`);
		}
		if (metrics.estimatedCost !== undefined) {
			lines.push(`    - Cost: $${metrics.estimatedCost}`);
		}
	}

	return lines;
}

function renderMilestoneSection(plan: MissionPlan, gitInfo?: GitInfo): string[] {
	const lines: string[] = [];
	lines.push("## Milestones");
	lines.push("");

	for (const milestone of plan.milestones) {
		const startedAt = milestone.startedAt ? new Date(milestone.startedAt) : undefined;
		const completedAt = milestone.completedAt ? new Date(milestone.completedAt) : undefined;
		const durationMs = startedAt && completedAt ? completedAt.getTime() - startedAt.getTime() : undefined;
		const durationStr = durationMs !== undefined ? ` · ${formatDuration(durationMs)}` : "";

		lines.push(`### ${milestone.name}`);
		lines.push("");
		lines.push(`- **Status:** ${milestone.status}${durationStr}`);
		lines.push("");

		if (milestone.features.length > 0) {
			lines.push("**Features:**");
			lines.push("");
			for (const feature of milestone.features) {
				const metrics = gitInfo?.featureMetrics?.get(feature.id);
				lines.push(...renderFeatureLines(feature, metrics));
			}
			lines.push("");
		}
	}

	return lines;
}

function renderFilesSection(gitInfo: GitInfo): string[] {
	const lines: string[] = [];
	const deduplicated = [...new Set(gitInfo.filesChanged)];

	if (deduplicated.length > 0) {
		lines.push("## Changed Files");
		lines.push("");
		for (const file of deduplicated) {
			lines.push(`- ${file}`);
		}
		lines.push("");
	}

	return lines;
}

function renderCommitsSection(commits: Array<{ sha: string; message: string }>): string[] {
	if (commits.length === 0) return [];

	const lines: string[] = [];
	lines.push("## Git Commits");
	lines.push("");
	for (const commit of commits) {
		lines.push(`- \`${commit.sha}\` ${commit.message}`);
	}
	lines.push("");
	return lines;
}

function renderFixFeaturesSection(plan: MissionPlan): string[] {
	const fixFeatures: Feature[] = [];
	for (const milestone of plan.milestones) {
		for (const feature of milestone.features) {
			if (feature.fixOrigin) {
				fixFeatures.push(feature);
			}
		}
	}

	if (fixFeatures.length === 0) return [];

	const lines: string[] = [];
	lines.push("## Fix Features");
	lines.push("");
	for (const feature of fixFeatures) {
		const origin = feature.fixOrigin;
		if (!origin) continue;
		const source = origin.sourceFeatureId ? ` (source feature: ${origin.sourceFeatureId})` : "";
		lines.push(`- **${feature.name}** — ${feature.status}`);
		lines.push(`  - Origin: ${origin.sourceKind}${source}`);
		if (origin.sourceMilestoneId) {
			lines.push(`  - Source milestone: ${origin.sourceMilestoneId}`);
		}
	}
	lines.push("");
	return lines;
}

function renderWarningsSection(state: MissionState, gitInfo?: GitInfo): string[] {
	const warnings: string[] = [];

	if (state.gitSnapshot && state.gitSnapshot.dirtyFiles.length > 0) {
		warnings.push(
			`Repository had ${state.gitSnapshot.dirtyFiles.length} pre-existing dirty file(s) at mission start. Auto-commit was disabled.`,
		);
	}

	if (gitInfo?.warnings) {
		warnings.push(...gitInfo.warnings);
	}

	if (warnings.length === 0) return [];

	const lines: string[] = [];
	lines.push("## Warnings");
	lines.push("");
	for (const warning of warnings) {
		lines.push(`- ${warning}`);
	}
	lines.push("");
	return lines;
}

function renderNotesSection(notes: string[]): string[] {
	if (notes.length === 0) return [];

	const lines: string[] = [];
	lines.push("## Notes");
	lines.push("");
	for (const note of notes) {
		lines.push(`- ${note}`);
	}
	lines.push("");
	return lines;
}

export function generateReport(state: MissionState, plan: MissionPlan, gitInfo?: GitInfo): string {
	const startedAt = new Date(state.startedAt);
	const completedAt = state.completedAt ? new Date(state.completedAt) : new Date();
	const durationMs = completedAt.getTime() - startedAt.getTime();

	const lines: string[] = [];

	lines.push("# Mission Report");
	lines.push("");
	lines.push(`**Goal:** ${plan.description}`);
	lines.push("");

	lines.push("## Timeline");
	lines.push("");
	lines.push(`- **Started:** ${startedAt.toISOString()}`);
	lines.push(`- **Completed:** ${completedAt.toISOString()}`);
	lines.push(`- **Duration:** ${formatDuration(durationMs)}`);
	lines.push("");

	lines.push("## Summary");
	lines.push("");
	if (gitInfo?.summary) {
		lines.push(gitInfo.summary);
		lines.push("");
	}
	lines.push(`- **Completed:** ${state.totalFeaturesCompleted}`);
	lines.push(`- **Failed:** ${state.totalFeaturesFailed}`);
	lines.push(`- **Skipped:** ${state.totalFeaturesSkipped}`);
	lines.push(`- **Fix features created:** ${state.totalFixFeaturesCreated}`);
	lines.push("");

	lines.push(...renderMilestoneSection(plan, gitInfo));
	lines.push(...renderFixFeaturesSection(plan));

	if (gitInfo) {
		lines.push(...renderFilesSection(gitInfo));
		lines.push(...renderCommitsSection(gitInfo.commits));
	}

	lines.push(...renderWarningsSection(state, gitInfo));

	const notes = gitInfo?.remainingNotes ?? [];
	lines.push(...renderNotesSection(notes));

	return lines.join("\n");
}
