import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { loadPlan, loadState, savePlan, saveState } from "../state/manager.js";
import type { MissionPlan, MissionState } from "../types.js";
import { nowISO } from "../utils.js";

interface Deps {
	basePath: string;
	updateWidget: (state: MissionState, plan?: MissionPlan) => void;
}

type MilestoneEntry = MissionPlan["milestones"][number];
type FeatureEntry = MilestoneEntry["features"][number];

function findMilestone(plan: MissionPlan, milestoneId: string): MilestoneEntry | null {
	return plan.milestones.find((m) => m.id === milestoneId) ?? null;
}

function findFeatureInPlan(
	plan: MissionPlan,
	featureId: string,
): { milestone: MilestoneEntry; feature: FeatureEntry } | null {
	for (const milestone of plan.milestones) {
		const feature = milestone.features.find((f) => f.id === featureId);
		if (feature) return { milestone, feature };
	}
	return null;
}

function startMilestone(
	plan: MissionPlan,
	state: MissionState,
	milestoneId: string,
	reason: string | undefined,
): string | { plan: MissionPlan; state: MissionState } {
	const milestone = findMilestone(plan, milestoneId);
	if (!milestone) return `Milestone '${milestoneId}' not found in plan.`;
	if (milestone.status === "active") return `Milestone '${milestoneId}' is already active.`;

	const now = nowISO();
	const updatedPlan: MissionPlan = {
		...plan,
		milestones: plan.milestones.map((m) =>
			m.id === milestoneId ? { ...m, status: "active" as const, startedAt: now } : m,
		),
	};
	const updatedState: MissionState = {
		...state,
		currentMilestoneId: milestoneId,
		progressLog: [
			...state.progressLog,
			{
				timestamp: now,
				type: "milestone_start" as const,
				detail: `Milestone '${milestone.name}' started`,
				metadata: reason ? { reason } : undefined,
			},
		],
	};
	return { plan: updatedPlan, state: updatedState };
}

function completeMilestone(
	plan: MissionPlan,
	state: MissionState,
	milestoneId: string,
	reason: string | undefined,
): string | { plan: MissionPlan; state: MissionState } {
	const milestone = findMilestone(plan, milestoneId);
	if (!milestone) return `Milestone '${milestoneId}' not found in plan.`;
	if (milestone.status !== "active") {
		return `Cannot complete milestone '${milestoneId}': milestone is not active (current status: '${milestone.status}').`;
	}

	const now = nowISO();
	const updatedPlan: MissionPlan = {
		...plan,
		milestones: plan.milestones.map((m) =>
			m.id === milestoneId ? { ...m, status: "done" as const, completedAt: now } : m,
		),
	};
	const updatedState: MissionState = {
		...state,
		progressLog: [
			...state.progressLog,
			{
				timestamp: now,
				type: "milestone_complete" as const,
				detail: `Milestone '${milestone.name}' completed`,
				metadata: reason ? { reason } : undefined,
			},
		],
	};
	return { plan: updatedPlan, state: updatedState };
}

function skipFeature(
	plan: MissionPlan,
	state: MissionState,
	featureId: string,
	reason: string | undefined,
): string | { plan: MissionPlan; state: MissionState } {
	const found = findFeatureInPlan(plan, featureId);
	if (!found) return `Feature '${featureId}' not found in plan.`;
	if (found.feature.status === "done") {
		return `Cannot skip feature '${featureId}': feature is already completed.`;
	}

	const now = nowISO();
	const updatedPlan: MissionPlan = {
		...plan,
		milestones: plan.milestones.map((m) => ({
			...m,
			features: m.features.map((f) => (f.id === featureId ? { ...f, status: "skipped" as const } : f)),
		})),
	};
	const updatedState: MissionState = {
		...state,
		totalFeaturesSkipped: state.totalFeaturesSkipped + 1,
		progressLog: [
			...state.progressLog,
			{
				timestamp: now,
				type: "feature_skipped" as const,
				detail: `Feature '${found.feature.name}' skipped`,
				metadata: reason ? { reason } : undefined,
			},
		],
	};
	return { plan: updatedPlan, state: updatedState };
}

function blockFeature(
	plan: MissionPlan,
	state: MissionState,
	featureId: string,
	reason: string | undefined,
): string | { plan: MissionPlan; state: MissionState } {
	const found = findFeatureInPlan(plan, featureId);
	if (!found) return `Feature '${featureId}' not found in plan.`;

	const now = nowISO();
	const updatedPlan: MissionPlan = {
		...plan,
		milestones: plan.milestones.map((m) => ({
			...m,
			features: m.features.map((f) => (f.id === featureId ? { ...f, status: "blocked" as const } : f)),
		})),
	};
	const updatedState: MissionState = {
		...state,
		progressLog: [
			...state.progressLog,
			{
				timestamp: now,
				type: "feature_blocked" as const,
				detail: `Feature '${found.feature.name}' blocked`,
				metadata: reason ? { reason } : undefined,
			},
		],
	};
	return { plan: updatedPlan, state: updatedState };
}

function appendNote(state: MissionState, detail: string): MissionState {
	return {
		...state,
		progressLog: [
			...state.progressLog,
			{
				timestamp: nowISO(),
				type: "plan_mutated" as const,
				detail,
			},
		],
	};
}

export function registerUpdateStateTool(pi: ExtensionAPI, deps: Deps): void {
	pi.registerTool({
		name: "update_mission_state",
		label: "Update Mission State",
		description:
			"Update milestone or feature status. Actions: start_milestone, complete_milestone, skip_feature, block_feature, note.",
		parameters: Type.Object({
			action: Type.Union(
				[
					Type.Literal("start_milestone"),
					Type.Literal("complete_milestone"),
					Type.Literal("skip_feature"),
					Type.Literal("block_feature"),
					Type.Literal("note"),
				],
				{ description: "Action to perform" },
			),
			targetId: Type.String({ description: "Milestone or feature ID" }),
			reason: Type.Optional(Type.String({ description: "Optional reason or note text" })),
		}),
		async execute(_toolCallId, params) {
			const state = loadState(deps.basePath);
			if (!state) {
				return {
					content: [{ type: "text", text: "Error: no active mission state." }],
					details: {},
				};
			}

			const { action, targetId, reason } = params;

			if (action === "note") {
				const updatedState = appendNote(state, reason ?? targetId);
				saveState(deps.basePath, updatedState);
				deps.updateWidget(updatedState);
				return { content: [{ type: "text", text: "Note recorded." }], details: {} };
			}

			const plan = loadPlan(deps.basePath);
			if (!plan) {
				return {
					content: [{ type: "text", text: "Error: no plan found." }],
					details: {},
				};
			}

			if (action === "start_milestone") {
				const result = startMilestone(plan, state, targetId, reason);
				if (typeof result === "string") {
					return { content: [{ type: "text", text: `Error: ${result}` }], details: {} };
				}
				savePlan(deps.basePath, result.plan);
				saveState(deps.basePath, result.state);
				deps.updateWidget(result.state, result.plan);
				return { content: [{ type: "text", text: `Milestone '${targetId}' started.` }], details: {} };
			}

			if (action === "complete_milestone") {
				const result = completeMilestone(plan, state, targetId, reason);
				if (typeof result === "string") {
					return { content: [{ type: "text", text: `Error: ${result}` }], details: {} };
				}
				savePlan(deps.basePath, result.plan);
				saveState(deps.basePath, result.state);
				deps.updateWidget(result.state, result.plan);
				return { content: [{ type: "text", text: `Milestone '${targetId}' completed.` }], details: {} };
			}

			if (action === "skip_feature") {
				const result = skipFeature(plan, state, targetId, reason);
				if (typeof result === "string") {
					return { content: [{ type: "text", text: `Error: ${result}` }], details: {} };
				}
				savePlan(deps.basePath, result.plan);
				saveState(deps.basePath, result.state);
				deps.updateWidget(result.state, result.plan);
				return { content: [{ type: "text", text: `Feature '${targetId}' skipped.` }], details: {} };
			}

			if (action === "block_feature") {
				const result = blockFeature(plan, state, targetId, reason);
				if (typeof result === "string") {
					return { content: [{ type: "text", text: `Error: ${result}` }], details: {} };
				}
				savePlan(deps.basePath, result.plan);
				saveState(deps.basePath, result.state);
				deps.updateWidget(result.state, result.plan);
				return { content: [{ type: "text", text: `Feature '${targetId}' blocked.` }], details: {} };
			}

			return {
				content: [{ type: "text", text: `Error: unknown action '${action}'.` }],
				details: {},
			};
		},
	});
}
