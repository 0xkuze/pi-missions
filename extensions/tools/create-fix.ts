import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { loadPlan, loadState, savePlan, saveState } from "../state/manager.js";
import { appendMutation } from "../state/plan-history.js";
import type { Feature, MissionPlan, MissionState } from "../types.js";
import { generateId, nowISO } from "../utils.js";

const VALID_SOURCE_KINDS = new Set(["worker-failure", "validation-failure"]);

interface Deps {
	basePath: string;
	updateWidget: (state: MissionState, plan?: MissionPlan) => void;
}

function findMilestoneIndex(plan: MissionPlan, milestoneId: string): number {
	return plan.milestones.findIndex((m) => m.id === milestoneId);
}

function findFeatureInPlan(plan: MissionPlan, featureId: string): boolean {
	return plan.milestones.some((m) => m.features.some((f) => f.id === featureId));
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

			if (!VALID_SOURCE_KINDS.has(params.sourceKind)) {
				return {
					content: [
						{
							type: "text",
							text: `Error: invalid sourceKind '${params.sourceKind}'. Must be 'worker-failure' or 'validation-failure'.`,
						},
					],
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

			const milestoneIndex = findMilestoneIndex(plan, params.milestoneId);
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

			if (params.sourceFeatureId !== undefined && !findFeatureInPlan(plan, params.sourceFeatureId)) {
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

			const featureId = generateId();
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
			const updatedMilestone = {
				...milestone,
				features: [...milestone.features, newFeature],
			};
			const updatedPlan: MissionPlan = {
				...plan,
				planVersion: newPlanVersion,
				milestones: plan.milestones.map((m, i) => (i === milestoneIndex ? updatedMilestone : m)),
			};
			savePlan(deps.basePath, updatedPlan);

			appendMutation(deps.basePath, {
				planVersion: newPlanVersion,
				timestamp: nowISO(),
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

			const state = loadState(deps.basePath);
			if (state) {
				const updatedState: MissionState = {
					...state,
					totalFixFeaturesCreated: state.totalFixFeaturesCreated + 1,
					progressLog: [
						...state.progressLog,
						{
							timestamp: nowISO(),
							type: "fix_feature_created" as const,
							detail: `Fix feature '${params.name}' created in milestone '${milestone.name}'`,
							metadata: { featureId, milestoneId: params.milestoneId, sourceKind: params.sourceKind },
						},
					],
				};
				saveState(deps.basePath, updatedState);
				deps.updateWidget(updatedState, updatedPlan);
			}

			return {
				content: [
					{
						type: "text",
						text: `Fix feature created successfully. ID: ${featureId}, Name: '${params.name}', Milestone: '${milestone.name}', planVersion: ${newPlanVersion}. Feature: ${JSON.stringify(newFeature)}`,
					},
				],
				details: {},
			};
		},
	});
}
