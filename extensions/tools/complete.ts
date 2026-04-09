import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { countPendingFeatures, hasPendingFeatures } from "../plan-helpers.js";
import { generateReport, type ReportValidationInfo } from "../report.js";
import { loadContract, loadPlan, loadState, saveState } from "../state/manager.js";
import { transitionState } from "../state/transitions.js";
import type { MissionPlan, MissionState } from "../types.js";

interface Deps {
	basePath: string;
	updateWidget: (state: MissionState, plan?: MissionPlan) => void;
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
			force: Type.Optional(Type.Boolean({ description: "Force completion even with failing assertions" })),
		}),
		// why: pi Theme uses branded ThemeColor types; we accept `any` at this API boundary
		renderCall(_args: any, theme: any) {
			return new Text(theme.fg("toolTitle", theme.bold("complete_mission")), 0, 0);
		},
		renderResult(result: any, _options: any, theme: any) {
			const text = result.content?.[0];
			const output = text?.type === "text" ? text.text : "(no output)";
			const icon = output.includes("completed") ? theme.fg("success", "\u2713") : theme.fg("error", "\u2717");
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

			const hasAnyFeatures = plan ? plan.milestones.some((m) => m.features.length > 0) : false;
			const allSkipped =
				state.totalFeaturesCompleted === 0 && state.totalFeaturesSkipped > 0 && !hasPendingFeatures(plan!);
			if (hasAnyFeatures && state.totalFeaturesCompleted === 0 && !allSkipped) {
				return {
					content: [
						{
							type: "text",
							text: "Error: cannot complete mission — no features have been completed by workers. Fix failing features or skip them before completing.",
						},
					],
					details: {},
				};
			}

			if (state.totalFeaturesFailed > 0 && !params.force) {
				const milestoneIds = plan ? plan.milestones.map((m) => m.id) : [];
				const milestonesWithPassingValidation = new Set(
					state.progressLog
						.filter((e) => e.type === "validation_pass" && e.metadata?.milestoneId)
						.map((e) => e.metadata!.milestoneId as string),
				);
				const milestonesWithFeatures = milestoneIds.filter(
					(id) => plan!.milestones.find((m) => m.id === id)!.features.length > 0,
				);
				const allMilestonesValidated = milestonesWithFeatures.every((id) =>
					milestonesWithPassingValidation.has(id),
				);
				if (!allMilestonesValidated) {
					const unvalidated = milestonesWithFeatures.filter((id) => !milestonesWithPassingValidation.has(id));
					return {
						content: [
							{
								type: "text",
								text: `Error: ${state.totalFeaturesFailed} feature(s) failed and milestone(s) ${unvalidated.join(", ")} have not passed validation. Run run_validation first, or pass force=true to override.`,
							},
						],
						details: {},
					};
				}
			}

			const contract = loadContract(deps.basePath);
			if (contract) {
				const failedAssertions = contract.assertions.filter((a) => a.status === "fail" || a.status === "error");
				if (failedAssertions.length > 0 && !params.force) {
					const ids = failedAssertions.map((a) => a.id);
					const shown =
						ids.length > 5 ? `${ids.slice(0, 5).join(", ")} and ${ids.length - 5} more` : ids.join(", ");
					return {
						content: [
							{
								type: "text",
								text: `Error: ${failedAssertions.length} assertion(s) still failing: ${shown}. Fix and re-validate first, or pass force=true to override.`,
							},
						],
						details: {},
					};
				}
			}

			const warnings: string[] = [];
			if (plan && hasPendingFeatures(plan)) {
				const pendingCount = countPendingFeatures(plan);
				warnings.push(
					`Warning: ${pendingCount} feature(s) are still pending or active and have not been completed.`,
				);
			}

			let completedState = transitionState(state, "completed");
			if (params.force) {
				completedState = {
					...completedState,
					progressLog: [
						...completedState.progressLog,
						{
							timestamp: new Date().toISOString(),
							type: "plan_mutated" as const,
							detail: "Force override: complete_mission",
							metadata: { action: "complete_mission", force: true },
						},
					],
				};
			}
			saveState(deps.basePath, completedState);

			if (plan) {
				const reportPath = join(deps.basePath, "report.md");
				const reportDir = dirname(reportPath);
				mkdirSync(reportDir, { recursive: true });
				const validationInfo = buildValidationInfo(deps.basePath, plan);
				const reportContent = generateReport(
					completedState,
					plan,
					{
						filesChanged: [],
						commits: [],
						summary,
						remainingNotes: remainingNotes ?? [],
					},
					validationInfo,
				);
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

function buildValidationInfo(basePath: string, plan: MissionPlan): ReportValidationInfo | undefined {
	const contract = loadContract(basePath);
	if (!contract) return undefined;
	const assertionResults = contract.assertions.filter(
		(a) => a.status === "pass" || a.status === "fail" || a.status === "error",
	);
	if (assertionResults.length === 0) return undefined;
	const assertions = assertionResults.map((a) => ({
		assertionId: a.id,
		status: a.status as "pass" | "fail" | "error",
		exitCode: null as number | null,
		stdout: "",
		stderr: "",
		timedOut: false,
		durationMs: 0,
		timestamp: "",
		command: a.command,
	}));
	const milestoneIds = plan.milestones.map((m) => m.id);
	return {
		assertions,
		evidenceDir: milestoneIds.length > 0 ? join(basePath, "runtime", "validation", milestoneIds[0]!) : undefined,
	};
}
