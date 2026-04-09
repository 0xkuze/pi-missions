import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readLibraryTopic } from "../state/library.js";
import { loadPlan, loadState, saveContract, savePlan, saveState } from "../state/manager.js";
import { appendMutation, lastPlanVersion } from "../state/plan-history.js";
import { transitionState } from "../state/transitions.js";
import type { MissionPlan, MissionState, ValidationContract } from "../types.js";
import { generateId, nowISO } from "../utils.js";

const VALID_COMPLEXITIES = new Set(["low", "medium", "high"]);

interface Deps {
	basePath: string;
	updateWidget: (state: MissionState, plan?: MissionPlan) => void;
	showDraftReview?: (plan: MissionPlan) => void;
}

function collectAllFeatureIds(milestones: Array<{ id: string; features: Array<{ id: string }> }>): Set<string> {
	const ids = new Set<string>();
	for (const milestone of milestones) {
		for (const feature of milestone.features) {
			ids.add(feature.id);
		}
	}
	return ids;
}

function validatePlanParams(params: {
	description: string;
	milestones: Array<{
		id: string;
		name: string;
		description: string;
		features: Array<{
			id: string;
			name: string;
			description: string;
			acceptanceCriteria: string[];
			relevantFiles: string[];
			dependencies: string[];
			estimatedComplexity: string;
		}>;
		validationCommands?: string[];
	}>;
	validationCommands: string[];
	modelSuggestions?: { orchestrator?: string; worker?: string; validator?: string };
}): string | null {
	if (!params.description || params.description.trim() === "") {
		return "Plan description must not be empty";
	}

	if (!params.milestones || params.milestones.length === 0) {
		return "Plan must have at least one milestone";
	}

	const milestoneIds = new Set<string>();
	const featureIds = new Set<string>();

	for (const milestone of params.milestones) {
		if (milestoneIds.has(milestone.id)) {
			return `Duplicate milestone ID: '${milestone.id}'`;
		}
		milestoneIds.add(milestone.id);

		if (!milestone.features || milestone.features.length === 0) {
			return `Milestone '${milestone.id}' must have at least one feature`;
		}

		for (const feature of milestone.features) {
			if (featureIds.has(feature.id)) {
				return `Duplicate feature ID: '${feature.id}'`;
			}
			featureIds.add(feature.id);

			if (!feature.description || feature.description.trim().length < 20) {
				return `Feature '${feature.id}' description is too short (min 20 chars). Include file paths, functions, and test cases to create.`;
			}

			if (!feature.acceptanceCriteria || feature.acceptanceCriteria.length === 0) {
				return `Feature '${feature.id}' must have at least one acceptance criterion`;
			}

			for (const criterion of feature.acceptanceCriteria) {
				if (!criterion || criterion.trim() === "") {
					return `Feature '${feature.id}' has an empty acceptance criterion`;
				}
			}

			if (!VALID_COMPLEXITIES.has(feature.estimatedComplexity)) {
				return `Feature '${feature.id}' has invalid estimatedComplexity: '${feature.estimatedComplexity}'. Must be 'low', 'medium', or 'high'`;
			}
		}
	}

	const allFeatureIds = collectAllFeatureIds(params.milestones);
	for (const milestone of params.milestones) {
		for (const feature of milestone.features) {
			for (const dep of feature.dependencies) {
				if (!allFeatureIds.has(dep)) {
					return `Feature '${feature.id}' has dependency '${dep}' which does not reference an existing feature ID`;
				}
			}
		}
	}

	return null;
}

function validateAssertions(
	assertions:
		| Array<{ id: string; featureId: string; type: string; command: string; expect: unknown; description: string }>
		| undefined,
	planFeatureIds: Set<string>,
): string | null {
	if (!assertions || assertions.length === 0) return null;

	const assertionIds = new Set<string>();
	for (const assertion of assertions) {
		if (assertionIds.has(assertion.id)) {
			return `Duplicate assertion ID: '${assertion.id}'`;
		}
		assertionIds.add(assertion.id);

		if (!planFeatureIds.has(assertion.featureId)) {
			return `Assertion '${assertion.id}' references unknown featureId: '${assertion.featureId}'`;
		}
	}

	return null;
}

function buildPlan(
	params: {
		description: string;
		milestones: Array<{
			id: string;
			name: string;
			description: string;
			features: Array<{
				id: string;
				name: string;
				description: string;
				acceptanceCriteria: string[];
				relevantFiles: string[];
				dependencies: string[];
				estimatedComplexity: string;
			}>;
			validationCommands?: string[];
		}>;
		validationCommands: string[];
		modelSuggestions?: { orchestrator?: string; worker?: string; validator?: string };
	},
	planVersion: number,
	createdAt: string,
	planId: string,
): MissionPlan {
	return {
		id: planId,
		description: params.description,
		planVersion,
		milestones: params.milestones.map((m) => ({
			id: m.id,
			name: m.name,
			description: m.description,
			features: m.features.map((f) => ({
				id: f.id,
				name: f.name,
				description: f.description,
				acceptanceCriteria: f.acceptanceCriteria,
				relevantFiles: f.relevantFiles,
				dependencies: f.dependencies,
				estimatedComplexity: f.estimatedComplexity as "low" | "medium" | "high",
				status: "pending",
				attempts: [],
			})),
			validationCommands: m.validationCommands,
			status: "pending",
		})),
		validationCommands: params.validationCommands,
		modelAssignment: params.modelSuggestions ?? {},
		createdAt,
	};
}

export function registerSubmitPlanTool(pi: ExtensionAPI, deps: Deps): void {
	pi.registerTool({
		name: "submit_plan",
		label: "Submit Plan",
		description:
			"Submit a structured mission plan for review. Called during planning phase to persist the plan and transition to draft review.",
		promptSnippet: "Submit a structured mission plan with milestones, features, and acceptance criteria.",
		parameters: Type.Object({
			description: Type.String({ description: "High-level description of what this mission accomplishes" }),
			milestones: Type.Array(
				Type.Object({
					id: Type.String({ description: "Unique milestone identifier" }),
					name: Type.String({ description: "Milestone name" }),
					description: Type.String({ description: "What this milestone accomplishes" }),
					features: Type.Array(
						Type.Object({
							id: Type.String({ description: "Unique feature identifier" }),
							name: Type.String({ description: "Feature name" }),
							description: Type.String({ description: "What this feature implements" }),
							acceptanceCriteria: Type.Array(Type.String(), {
								description: "List of acceptance criteria that must be met",
							}),
							relevantFiles: Type.Array(Type.String(), {
								description: "Files relevant to this feature",
							}),
							dependencies: Type.Array(Type.String(), {
								description: "Feature IDs this feature depends on",
							}),
							estimatedComplexity: Type.Union(
								[Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")],
								{ description: "Estimated complexity of the feature" },
							),
						}),
						{ description: "Features within this milestone" },
					),
					validationCommands: Type.Optional(
						Type.Array(Type.String(), { description: "Per-milestone validation command overrides" }),
					),
				}),
				{ description: "Milestones in order of execution" },
			),
			validationCommands: Type.Array(Type.String(), {
				description: "Project-level default validation commands",
			}),
			modelSuggestions: Type.Optional(
				Type.Object({
					orchestrator: Type.Optional(Type.String()),
					worker: Type.Optional(Type.String()),
					validator: Type.Optional(Type.String()),
				}),
			),
			assertions: Type.Optional(
				Type.Array(
					Type.Object({
						id: Type.String({ description: "Unique assertion identifier" }),
						featureId: Type.String({ description: "Feature ID this assertion validates" }),
						type: Type.Union([Type.Literal("command"), Type.Literal("script")], {
							description: "Assertion execution type",
						}),
						command: Type.String({ description: "Command or script to execute" }),
						expect: Type.Object(
							{
								exitCode: Type.Optional(Type.Number()),
								stdoutContains: Type.Optional(Type.String()),
								stdoutNotContains: Type.Optional(Type.String()),
								stderrContains: Type.Optional(Type.String()),
							},
							{ description: "Expected outcomes" },
						),
						description: Type.String({ description: "What this assertion verifies" }),
					}),
					{ description: "Validation assertions for the plan" },
				),
			),
		}),
		async execute(_toolCallId, params) {
			const state = loadState(deps.basePath);

			if (!state) {
				return {
					content: [
						{ type: "text", text: "Error: no active mission state. Start a mission first with /mission." },
					],
					details: {},
				};
			}

			if (state.status !== "planning" && state.status !== "draft_review") {
				return {
					content: [
						{
							type: "text",
							text: `Error: submit_plan can only be called during 'planning' or 'draft_review' state. Current state: '${state.status}'.`,
						},
					],
					details: {},
				};
			}

			const validationError = validatePlanParams(params);
			if (validationError !== null) {
				return { content: [{ type: "text", text: `Error: ${validationError}` }], details: {} };
			}

			const planFeatureIds = collectAllFeatureIds(params.milestones);
			const assertionError = validateAssertions(params.assertions, planFeatureIds);
			if (assertionError !== null) {
				return { content: [{ type: "text", text: `Error: ${assertionError}` }], details: {} };
			}

			const existingPlan = loadPlan(deps.basePath);
			const isResubmission = state.status === "draft_review" && existingPlan !== null;

			if (!isResubmission && existsSync(join(deps.basePath, "library"))) {
				const HEADER_ONLY_RE = /^#\s+\w+\s*\n?$/;
				const archContent = readLibraryTopic(deps.basePath, "architecture");
				if (!archContent || HEADER_ONLY_RE.test(archContent.trim())) {
					return {
						content: [
							{
								type: "text",
								text: "Error: library/architecture.md is empty. Call update_library with topic 'architecture' to document the project structure before submitting the plan. Workers depend on this context.",
							},
						],
						details: {},
					};
				}
			}
			const historyVersion = lastPlanVersion(deps.basePath);
			const planVersion = isResubmission
				? Math.max(existingPlan.planVersion + 1, historyVersion + 1)
				: historyVersion + 1;
			const planId = isResubmission ? existingPlan.id : generateId();
			const createdAt = isResubmission ? existingPlan.createdAt : nowISO();

			const plan = buildPlan(params, planVersion, createdAt, planId);
			savePlan(deps.basePath, plan);

			const contractFilePath = join(deps.basePath, "validation-contract.json");
			if (params.assertions && params.assertions.length > 0) {
				const contract: ValidationContract = {
					assertions: params.assertions.map((a) => ({
						id: a.id,
						featureId: a.featureId,
						type: a.type,
						command: a.command,
						expect: a.expect,
						description: a.description,
						status: "pending" as const,
					})),
				};
				saveContract(deps.basePath, contract);
			} else {
				if (existsSync(contractFilePath)) {
					unlinkSync(contractFilePath);
				}
			}

			const mutationKind = isResubmission ? "plan-revised" : "plan-created";
			try {
				appendMutation(deps.basePath, {
					planVersion,
					timestamp: nowISO(),
					actor: "orchestrator",
					kind: mutationKind,
					summary: isResubmission ? `Plan revised to version ${planVersion}` : "Plan created",
					payload: { description: plan.description, milestoneCount: plan.milestones.length },
				});
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: `Error: failed to record plan mutation: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
					details: {},
				};
			}

			let newState = state;
			if (state.status === "planning") {
				newState = transitionState(state, "draft_review");
			}

			saveState(deps.basePath, newState);
			deps.updateWidget(newState, plan);
			deps.showDraftReview?.(plan);

			const featureCount = plan.milestones.reduce((sum, m) => sum + m.features.length, 0);
			const action = isResubmission ? "revised" : "submitted";
			return {
				content: [
					{
						type: "text",
						text: `Plan ${action} successfully. ${plan.milestones.length} milestone(s), ${featureCount} feature(s). Version: ${planVersion}. Awaiting user approval.`,
					},
				],
				details: {},
			};
		},
	});
}
