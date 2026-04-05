import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { loadPlan, loadState, saveState } from "../state/manager.js";
import { transitionState } from "../state/transitions.js";
import type { MissionPlan, MissionState } from "../types.js";
import { formatDuration, nowISO } from "../utils.js";

interface Deps {
	basePath: string;
	updateWidget: (state: MissionState, plan?: MissionPlan) => void;
}

function hasPendingWork(plan: MissionPlan): boolean {
	for (const milestone of plan.milestones) {
		for (const feature of milestone.features) {
			if (feature.status === "pending" || feature.status === "active") {
				return true;
			}
		}
	}
	return false;
}

function countPendingFeatures(plan: MissionPlan): number {
	let count = 0;
	for (const milestone of plan.milestones) {
		for (const feature of milestone.features) {
			if (feature.status === "pending" || feature.status === "active") {
				count++;
			}
		}
	}
	return count;
}

function buildReport(state: MissionState, plan: MissionPlan, summary: string, remainingNotes?: string[]): string {
	const startedAt = new Date(state.startedAt);
	const completedAt = new Date(state.completedAt ?? nowISO());
	const durationMs = completedAt.getTime() - startedAt.getTime();

	const totalFeatures = plan.milestones.reduce((sum, m) => sum + m.features.length, 0);
	const lines: string[] = [];

	lines.push("# Mission Report");
	lines.push("");
	lines.push(`**Goal:** ${plan.description}`);
	lines.push("");
	lines.push("## Summary");
	lines.push("");
	lines.push(summary);
	lines.push("");
	lines.push("## Timeline");
	lines.push("");
	lines.push(`- **Started:** ${startedAt.toISOString()}`);
	lines.push(`- **Completed:** ${completedAt.toISOString()}`);
	lines.push(`- **Duration:** ${formatDuration(durationMs)}`);
	lines.push("");
	lines.push("## Progress");
	lines.push("");
	lines.push(`- **Features completed:** ${state.totalFeaturesCompleted}`);
	lines.push(`- **Features failed:** ${state.totalFeaturesFailed}`);
	lines.push(`- **Features skipped:** ${state.totalFeaturesSkipped}`);
	lines.push(`- **Fix features created:** ${state.totalFixFeaturesCreated}`);
	lines.push(`- **Total features:** ${totalFeatures}`);
	lines.push("");
	lines.push("## Milestones");
	lines.push("");

	for (const milestone of plan.milestones) {
		lines.push(`### ${milestone.name} (${milestone.status})`);
		lines.push("");
		for (const feature of milestone.features) {
			lines.push(`- **${feature.name}** — ${feature.status}`);
		}
		lines.push("");
	}

	if (remainingNotes && remainingNotes.length > 0) {
		lines.push("## Notes");
		lines.push("");
		for (const note of remainingNotes) {
			lines.push(`- ${note}`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

export function registerCompleteMissionTool(pi: ExtensionAPI, deps: Deps): void {
	pi.registerTool({
		name: "complete_mission",
		label: "Complete Mission",
		description: "Mark the mission as complete. Generates a report and transitions state to completed.",
		parameters: Type.Object({
			summary: Type.String({ description: "Summary of what was accomplished in this mission" }),
			remainingNotes: Type.Optional(
				Type.Array(Type.String(), { description: "Any remaining notes or observations" }),
			),
		}),
		async execute(_toolCallId, params) {
			const { summary, remainingNotes } = params;

			if (!summary || summary.trim() === "") {
				return {
					content: [{ type: "text", text: "Error: summary must not be empty." }],
					details: {},
				};
			}

			const state = loadState(deps.basePath);
			if (!state) {
				return {
					content: [{ type: "text", text: "Error: no active mission state." }],
					details: {},
				};
			}

			if (state.status === "completed") {
				return {
					content: [{ type: "text", text: "Mission is already completed." }],
					details: {},
				};
			}

			if (state.status !== "executing") {
				return {
					content: [
						{
							type: "text",
							text: `Error: complete_mission can only be called during 'executing' state. Current state: '${state.status}'.`,
						},
					],
					details: {},
				};
			}

			const plan = loadPlan(deps.basePath);

			const warnings: string[] = [];
			if (plan && hasPendingWork(plan)) {
				const pendingCount = countPendingFeatures(plan);
				warnings.push(
					`Warning: ${pendingCount} feature(s) are still pending or active and have not been completed.`,
				);
			}

			const completedState = transitionState(state, "completed");
			saveState(deps.basePath, completedState);

			if (plan) {
				const reportPath = join(deps.basePath, "report.md");
				const reportDir = dirname(reportPath);
				mkdirSync(reportDir, { recursive: true });
				const reportContent = buildReport(completedState, plan, summary, remainingNotes);
				writeFileSync(reportPath, reportContent, "utf8");
			}

			deps.updateWidget(completedState, plan ?? undefined);

			const resultParts: string[] = ["Mission completed successfully."];
			if (warnings.length > 0) {
				resultParts.push(...warnings);
			}
			if (plan) {
				resultParts.push(`Report written to ${join(deps.basePath, "report.md")}.`);
			}

			return {
				content: [{ type: "text", text: resultParts.join(" ") }],
				details: {},
			};
		},
	});
}
