import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { generateReport } from "../report.js";
import { loadPlan, loadState, saveState } from "../state/manager.js";
import { transitionState } from "../state/transitions.js";
import type { MissionPlan, MissionState } from "../types.js";

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

export function registerCompleteMissionTool(pi: ExtensionAPI, deps: Deps): void {
	pi.registerTool({
		name: "complete_mission",
		label: "Complete Mission",
		description: "Mark the mission as complete. Generates a report and transitions state to completed.",
		promptSnippet: "Complete the mission and generate the final report.",
		parameters: Type.Object({
			summary: Type.String({ description: "Summary of what was accomplished in this mission" }),
			remainingNotes: Type.Optional(
				Type.Array(Type.String(), { description: "Any remaining notes or observations" }),
			),
		}),
		renderCall(_args: unknown, theme: { fg: (...a: unknown[]) => string; bold: (t: string) => string }) {
			return new Text(theme.fg("toolTitle", theme.bold("complete_mission")), 0, 0);
		},
		renderResult(
			result: { content?: Array<{ type: string; text: string }> },
			_options: unknown,
			theme: { fg: (...a: unknown[]) => string },
		) {
			const text = result.content?.[0];
			const output = text?.type === "text" ? text.text : "(no output)";
			const icon = output.includes("completed")
				? (theme.fg("success", "\u2713") as string)
				: (theme.fg("error", "\u2717") as string);
			const firstLine = output.split("\n")[0];
			return new Text(`${icon} ${firstLine}`, 0, 0);
		},
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
				const reportContent = generateReport(completedState, plan, {
					filesChanged: [],
					commits: [],
					summary,
					remainingNotes: remainingNotes ?? [],
				});
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
