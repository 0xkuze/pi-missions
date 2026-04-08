import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { findFeature } from "../plan-helpers.js";
import { loadPlan, loadState, savePlan, saveState } from "../state/manager.js";
import { appendMutation } from "../state/plan-history.js";
import type { Feature, MissionPlan, MissionState } from "../types.js";
import { generateId, nowISO } from "../utils.js";

export interface AddFixFeatureParams {
	milestoneId: string;
	name: string;
	description: string;
	acceptanceCriteria: string[];
	relevantFiles: string[];
	sourceKind: "worker-failure" | "validation-failure";
	sourceFeatureId?: string;
}

export interface AddFixFeatureResult {
	featureId: string;
	updatedPlan: MissionPlan;
	updatedState: MissionState;
}

export function addFixFeatureToPlan(
	basePath: string,
	plan: MissionPlan,
	state: MissionState,
	params: AddFixFeatureParams,
): AddFixFeatureResult {
	const featureId = generateId();
	const milestoneIndex = plan.milestones.findIndex((m) => m.id === params.milestoneId);
	const milestone = plan.milestones[milestoneIndex]!;

	const newFeature: Feature = {
		id: featureId,
		name: params.name,
		description: params.description,
		acceptanceCriteria: params.acceptanceCriteria,
		relevantFiles: params.relevantFiles,
		dependencies: [],
		estimatedComplexity: "medium",
		status: "pending",
		fixOrigin: {
			sourceKind: params.sourceKind,
			sourceFeatureId: params.sourceFeatureId,
			sourceMilestoneId: milestone.id,
		},
		attempts: [],
	};

	const newPlanVersion = plan.planVersion + 1;
	const updatedPlan: MissionPlan = {
		...plan,
		planVersion: newPlanVersion,
		milestones: plan.milestones.map((m, i) =>
			i === milestoneIndex ? { ...m, features: [...m.features, newFeature] } : m,
		),
	};

	const now = nowISO();
	appendMutation(basePath, {
		planVersion: newPlanVersion,
		timestamp: now,
		actor: "orchestrator",
		kind: "add-fix-feature",
		summary: `Fix feature '${params.name}' added to milestone '${milestone.name}'`,
		payload: {
			featureId,
			milestoneId: params.milestoneId,
			sourceKind: params.sourceKind,
			sourceFeatureId: params.sourceFeatureId,
		},
	});

	const updatedState: MissionState = {
		...state,
		totalFixFeaturesCreated: state.totalFixFeaturesCreated + 1,
		progressLog: [
			...state.progressLog,
			{
				timestamp: now,
				type: "fix_feature_created" as const,
				detail: `Fix feature '${params.name}' created in milestone '${milestone.name}'`,
				metadata: { featureId, milestoneId: params.milestoneId, sourceKind: params.sourceKind },
			},
		],
	};

	return { featureId, updatedPlan, updatedState };
}

interface Deps {
	basePath: string;
	updateWidget: (state: MissionState, plan?: MissionPlan) => void;
}

export function registerCreateFixTool(pi: ExtensionAPI, deps: Deps): void {
	pi.registerTool({
		name: "create_fix_feature",
		label: "Create Fix Feature",
		description:
			"Add a fix feature to a milestone in response to a worker failure or validation failure. Tracks origin information for reporting.",
		promptSnippet: "Create a fix feature for worker or validation failures.",
		parameters: Type.Object({
			milestoneId: Type.String({ description: "ID of the milestone to add the fix feature to" }),
			name: Type.String({ description: "Name of the fix feature" }),
			description: Type.String({ description: "Description of what the fix feature implements" }),
			acceptanceCriteria: Type.Array(Type.String(), {
				description: "Acceptance criteria that must be met",
			}),
			relevantFiles: Type.Array(Type.String(), {
				description: "Files relevant to this fix feature",
			}),
			sourceKind: Type.Union([Type.Literal("worker-failure"), Type.Literal("validation-failure")], {
				description: "The kind of failure that triggered this fix feature",
			}),
			sourceFeatureId: Type.Optional(
				Type.String({ description: "ID of the feature that failed (for worker-failure)" }),
			),
		}),
		async execute(_toolCallId, params) {
			if (!params.name || params.name.trim() === "") {
				return {
					content: [{ type: "text", text: "Error: fix feature name must not be empty." }],
					details: {},
				};
			}

			if (!params.acceptanceCriteria || params.acceptanceCriteria.length === 0) {
				return {
					content: [{ type: "text", text: "Error: fix feature must have at least one acceptance criterion." }],
					details: {},
				};
			}

			const plan = loadPlan(deps.basePath);
			if (!plan) {
				return {
					content: [{ type: "text", text: "Error: no plan found. Start a mission and submit a plan first." }],
					details: {},
				};
			}

			const milestoneIndex = plan.milestones.findIndex((m) => m.id === params.milestoneId);
			if (milestoneIndex === -1) {
				return {
					content: [
						{
							type: "text",
							text: `Error: milestone '${params.milestoneId}' not found in plan.`,
						},
					],
					details: {},
				};
			}

			if (params.sourceFeatureId !== undefined && !findFeature(plan, params.sourceFeatureId)) {
				return {
					content: [
						{
							type: "text",
							text: `Error: sourceFeatureId '${params.sourceFeatureId}' not found in plan.`,
						},
					],
					details: {},
				};
			}

			const currentState = loadState(deps.basePath);
			if (!currentState) {
				return {
					content: [{ type: "text", text: "Error: no active mission state." }],
					details: {},
				};
			}

			const { featureId, updatedPlan, updatedState } = addFixFeatureToPlan(deps.basePath, plan, currentState, {
				milestoneId: params.milestoneId,
				name: params.name,
				description: params.description,
				acceptanceCriteria: params.acceptanceCriteria,
				relevantFiles: params.relevantFiles,
				sourceKind: params.sourceKind,
				sourceFeatureId: params.sourceFeatureId,
			});
			savePlan(deps.basePath, updatedPlan);
			saveState(deps.basePath, updatedState);
			deps.updateWidget(updatedState, updatedPlan);

			const milestoneName =
				updatedPlan.milestones.find((m) => m.id === params.milestoneId)?.name ?? params.milestoneId;

			return {
				content: [
					{
						type: "text",
						text: `Fix feature created successfully. ID: ${featureId}, Name: '${params.name}', Milestone: '${milestoneName}', planVersion: ${updatedPlan.planVersion}.`,
					},
				],
				details: {},
			};
		},
	});
}
