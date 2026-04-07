import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { loadPlan, loadState, savePlan, saveState } from "../state/manager.js";
import { appendMutation } from "../state/plan-history.js";
import type { Feature, MissionPlan, MissionState, MissionStatus } from "../types.js";
import { nowISO } from "../utils.js";

const VALID_STATES_FOR_ACTION: Record<string, ReadonlySet<MissionStatus>> = {
	skip_feature: new Set(["executing"]),
	block_feature: new Set(["executing"]),
	add_feature: new Set(["planning", "draft_review", "executing"]),
	remove_feature: new Set(["planning", "draft_review", "executing"]),
};

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
	if (milestone.status === "active" || milestone.status === "done") {
		return { plan, state, idempotent: `Milestone '${milestoneId}' already ${milestone.status}. No action needed.` };
	}

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
	if (milestone.status === "done") {
		return { plan, state, idempotent: `Milestone '${milestoneId}' already done. No action needed.` };
	}
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

function addFeature(
	basePath: string,
	plan: MissionPlan,
	milestoneId: string,
	params: { name: string; description: string; acceptanceCriteria: string[]; relevantFiles: string[] },
): string | { plan: MissionPlan; feature: Feature } {
	const milestone = findMilestone(plan, milestoneId);
	if (!milestone) return `Milestone '${milestoneId}' not found in plan.`;
	if (milestone.status === "done" || milestone.status === "failed") {
		return `Cannot add feature to milestone '${milestoneId}': milestone is already ${milestone.status}.`;
	}

	const featureId = `${milestoneId}-${params.name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "")}-${Date.now()}`;
	const newFeature: Feature = {
		id: featureId,
		name: params.name,
		description: params.description,
		acceptanceCriteria: params.acceptanceCriteria,
		relevantFiles: params.relevantFiles,
		dependencies: [],
		estimatedComplexity: "medium",
		status: "pending",
		attempts: [],
	};
	const newPlanVersion = plan.planVersion + 1;
	const updatedPlan: MissionPlan = {
		...plan,
		planVersion: newPlanVersion,
		milestones: plan.milestones.map((m) =>
			m.id === milestoneId ? { ...m, features: [...m.features, newFeature] } : m,
		),
	};
	appendMutation(basePath, {
		planVersion: newPlanVersion,
		timestamp: nowISO(),
		actor: "orchestrator",
		kind: "add-feature",
		summary: `Added feature '${params.name}' to milestone '${milestone.name}'`,
		payload: { milestoneId, featureId, name: params.name },
	});
	return { plan: updatedPlan, feature: newFeature };
}

function removeFeature(basePath: string, plan: MissionPlan, featureId: string): string | { plan: MissionPlan } {
	const found = findFeatureInPlan(plan, featureId);
	if (!found) return `Feature '${featureId}' not found in plan.`;
	if (found.feature.status === "done") {
		return `Cannot remove feature '${featureId}': feature is already completed.`;
	}
	if (found.feature.status === "active") {
		return `Cannot remove feature '${featureId}': feature is currently active.`;
	}

	const newPlanVersion = plan.planVersion + 1;
	const updatedPlan: MissionPlan = {
		...plan,
		planVersion: newPlanVersion,
		milestones: plan.milestones.map((m) => ({
			...m,
			features: m.features.filter((f) => f.id !== featureId),
		})),
	};
	appendMutation(basePath, {
		planVersion: newPlanVersion,
		timestamp: nowISO(),
		actor: "orchestrator",
		kind: "remove-feature",
		summary: `Removed feature '${found.feature.name}' from milestone '${found.milestone.name}'`,
		payload: { featureId, milestoneId: found.milestone.id },
	});
	return { plan: updatedPlan };
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
			"Update feature status or manage plan. Actions: skip_feature, block_feature, note, add_feature, remove_feature. Milestones are auto-managed.",
		promptSnippet: "Update mission state: skip/block features, add/remove features, notes.",
		parameters: Type.Object({
			action: Type.Union(
				[
					Type.Literal("skip_feature"),
					Type.Literal("block_feature"),
					Type.Literal("note"),
					Type.Literal("add_feature"),
					Type.Literal("remove_feature"),
				],
				{ description: "Action to perform" },
			),
			targetId: Type.String({
				description:
					"Milestone ID (for add_feature) or feature ID (for remove_feature/skip_feature/block_feature) or milestone ID (for start/complete_milestone)",
			}),
			reason: Type.Optional(Type.String({ description: "Optional reason or note text" })),
			name: Type.Optional(Type.String({ description: "Feature name (required for add_feature)" })),
			description: Type.Optional(Type.String({ description: "Feature description (required for add_feature)" })),
			acceptanceCriteria: Type.Optional(
				Type.Array(Type.String(), { description: "Acceptance criteria (required for add_feature)" }),
			),
			relevantFiles: Type.Optional(Type.Array(Type.String(), { description: "Relevant files (for add_feature)" })),
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

			const validStates = VALID_STATES_FOR_ACTION[action];
			if (validStates && !validStates.has(state.status)) {
				return {
					content: [
						{
							type: "text",
							text: `Error: '${action}' is not allowed in '${state.status}' state. Allowed states: ${[...validStates].join(", ")}.`,
						},
					],
					details: {},
				};
			}

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

			if (action === "start_milestone" || action === "complete_milestone") {
				return {
					content: [{ type: "text", text: "Milestones are auto-managed. No action needed." }],
					details: {},
				};
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

			if (action === "add_feature") {
				const { name, description, acceptanceCriteria, relevantFiles } = params;
				if (!name || !description || !acceptanceCriteria) {
					return {
						content: [
							{ type: "text", text: "Error: add_feature requires name, description, and acceptanceCriteria." },
						],
						details: {},
					};
				}
				const result = addFeature(deps.basePath, plan, targetId, {
					name,
					description,
					acceptanceCriteria,
					relevantFiles: relevantFiles ?? [],
				});
				if (typeof result === "string") {
					return { content: [{ type: "text", text: `Error: ${result}` }], details: {} };
				}
				savePlan(deps.basePath, result.plan);
				deps.updateWidget(state, result.plan);
				return {
					content: [
						{
							type: "text",
							text: `Feature '${result.feature.name}' added to milestone '${targetId}' with id '${result.feature.id}'.`,
						},
					],
					details: {},
				};
			}

			if (action === "remove_feature") {
				const result = removeFeature(deps.basePath, plan, targetId);
				if (typeof result === "string") {
					return { content: [{ type: "text", text: `Error: ${result}` }], details: {} };
				}
				savePlan(deps.basePath, result.plan);
				deps.updateWidget(state, result.plan);
				return { content: [{ type: "text", text: `Feature '${targetId}' removed.` }], details: {} };
			}

			return {
				content: [{ type: "text", text: `Error: unknown action '${action}'.` }],
				details: {},
			};
		},
	});
}
