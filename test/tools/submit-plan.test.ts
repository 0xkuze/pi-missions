import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPlan, loadState, saveState } from "../../extensions/state/manager.js";
import { readHistory } from "../../extensions/state/plan-history.js";
import { registerSubmitPlanTool } from "../../extensions/tools/submit-plan.js";
import type { MissionPlan, MissionState } from "../../extensions/types.js";
import { createMockContext, createMockPi, makeState, type ToolResult } from "../helpers/index.js";

function makePlanningState(): MissionState {
	return makeState({ status: "planning" });
}

interface PlanFeatureParam {
	id: string;
	name: string;
	description: string;
	acceptanceCriteria: string[];
	relevantFiles: string[];
	dependencies: string[];
	estimatedComplexity: "low" | "medium" | "high";
}

interface PlanMilestoneParam {
	id: string;
	name: string;
	description: string;
	features: PlanFeatureParam[];
	validationCommands?: string[];
}

interface PlanParams {
	description: string;
	milestones: PlanMilestoneParam[];
	validationCommands: string[];
	modelSuggestions?: { orchestrator?: string; worker?: string; validator?: string };
}

function makeMinimalPlanParams(): PlanParams {
	return {
		description: "Build an auth system",
		milestones: [
			{
				id: "milestone-1",
				name: "Foundation",
				description: "Core auth components",
				features: [
					{
						id: "feature-1",
						name: "User model",
						description: "Create user entity",
						acceptanceCriteria: ["User entity created", "Migration written"],
						relevantFiles: ["src/models/user.ts"],
						dependencies: [],
						estimatedComplexity: "low",
					},
				],
			},
		],
		validationCommands: ["npm test"],
	};
}

async function callTool(
	basePath: string,
	params: unknown,
	state: MissionState,
	updateWidget?: (state: MissionState, plan?: MissionPlan) => void,
	showDraftReview?: (plan: MissionPlan) => void,
): Promise<ToolResult> {
	const { pi, getRegisteredTool } = createMockPi();
	saveState(basePath, state);
	registerSubmitPlanTool(pi, { basePath, updateWidget: updateWidget ?? (() => {}), showDraftReview });
	const tool = getRegisteredTool("submit_plan")!;
	return tool.execute("tool-call-id", params, undefined, undefined, undefined as never) as Promise<ToolResult>;
}

describe("registerSubmitPlanTool", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "submit-plan-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("VAL-TOOL-001: valid plan persists to plan.json with ID, version 1, createdAt", () => {
		it("writes plan.json with generated ID, planVersion:1, and createdAt", async () => {
			const state = makePlanningState();
			const params = makeMinimalPlanParams();
			const result = await callTool(tmpDir, params, state);

			expect(result.content[0].text).toContain("submitted successfully");

			const plan = loadPlan(tmpDir);
			expect(plan).not.toBeNull();
			expect(plan!.id).toBeTruthy();
			expect(plan!.planVersion).toBe(1);
			expect(plan!.createdAt).toBeTruthy();
			expect(plan!.description).toBe("Build an auth system");
		});

		it("stores milestones and features with pending status", async () => {
			const state = makePlanningState();
			const result = await callTool(tmpDir, makeMinimalPlanParams(), state);

			expect(result.content[0].text).toContain("submitted");

			const plan = loadPlan(tmpDir)!;
			expect(plan.milestones).toHaveLength(1);
			expect(plan.milestones[0]!.status).toBe("pending");
			expect(plan.milestones[0]!.features).toHaveLength(1);
			expect(plan.milestones[0]!.features[0]!.status).toBe("pending");
			expect(plan.milestones[0]!.features[0]!.attempts).toHaveLength(0);
		});

		it("stores modelAssignment from modelSuggestions", async () => {
			const state = makePlanningState();
			const params = {
				...makeMinimalPlanParams(),
				modelSuggestions: { worker: "claude-3-5-sonnet", orchestrator: "claude-3-opus" },
			};
			await callTool(tmpDir, params, state);

			const plan = loadPlan(tmpDir)!;
			expect(plan.modelAssignment.worker).toBe("claude-3-5-sonnet");
			expect(plan.modelAssignment.orchestrator).toBe("claude-3-opus");
		});
	});

	describe("VAL-TOOL-001: state transitions to draft_review", () => {
		it("transitions state from planning to draft_review", async () => {
			const state = makePlanningState();
			await callTool(tmpDir, makeMinimalPlanParams(), state);

			const savedState = loadState(tmpDir)!;
			expect(savedState.status).toBe("draft_review");
		});

		it("appends plan_submitted progress event", async () => {
			const state = makePlanningState();
			await callTool(tmpDir, makeMinimalPlanParams(), state);

			const savedState = loadState(tmpDir)!;
			const submittedEvents = savedState.progressLog.filter((e) => e.type === "plan_submitted");
			expect(submittedEvents).toHaveLength(1);
		});
	});

	describe("VAL-TOOL-001: plan-created mutation appended to history", () => {
		it("appends plan-created mutation to plan-history.jsonl", async () => {
			const state = makePlanningState();
			await callTool(tmpDir, makeMinimalPlanParams(), state);

			const history = readHistory(tmpDir);
			expect(history).toHaveLength(1);
			expect(history[0]!.kind).toBe("plan-created");
			expect(history[0]!.planVersion).toBe(1);
			expect(history[0]!.actor).toBe("orchestrator");
		});
	});

	describe("VAL-TOOL-001: widget is updated", () => {
		it("calls updateWidget with the new state and plan", async () => {
			const state = makePlanningState();
			const updateWidget = mock((_s: MissionState, _p?: MissionPlan) => {});
			await callTool(tmpDir, makeMinimalPlanParams(), state, updateWidget);

			expect(updateWidget).toHaveBeenCalledTimes(1);
			const [calledState, calledPlan] = updateWidget.mock.calls[0] as [MissionState, MissionPlan];
			expect(calledState.status).toBe("draft_review");
			expect(calledPlan).not.toBeNull();
			expect(calledPlan.description).toBe("Build an auth system");
		});
	});

	describe("VAL-TOOL-002: invalid plans return descriptive errors", () => {
		it("rejects empty description", async () => {
			const state = makePlanningState();
			const params = { ...makeMinimalPlanParams(), description: "" };
			const result = await callTool(tmpDir, params, state);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("description");
			expect(loadPlan(tmpDir)).toBeNull();
		});

		it("rejects empty milestones array", async () => {
			const state = makePlanningState();
			const params = { ...makeMinimalPlanParams(), milestones: [] };
			const result = await callTool(tmpDir, params, state);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("milestone");
			expect(loadPlan(tmpDir)).toBeNull();
		});

		it("rejects milestone with no features", async () => {
			const state = makePlanningState();
			const params = {
				...makeMinimalPlanParams(),
				milestones: [{ id: "m1", name: "M1", description: "desc", features: [], validationCommands: undefined }],
			};
			const result = await callTool(tmpDir, params, state);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("feature");
			expect(loadPlan(tmpDir)).toBeNull();
		});

		it("rejects feature with empty acceptanceCriteria", async () => {
			const state = makePlanningState();
			const params = makeMinimalPlanParams();
			params.milestones[0]!.features[0]!.acceptanceCriteria = [];
			const result = await callTool(tmpDir, params, state);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("acceptance");
			expect(loadPlan(tmpDir)).toBeNull();
		});

		it("rejects feature with blank acceptance criterion", async () => {
			const state = makePlanningState();
			const params = makeMinimalPlanParams();
			params.milestones[0]!.features[0]!.acceptanceCriteria = ["  "];
			const result = await callTool(tmpDir, params, state);

			expect(result.content[0].text).toContain("Error");
			expect(loadPlan(tmpDir)).toBeNull();
		});

		it("rejects duplicate milestone IDs", async () => {
			const state = makePlanningState();
			const params = makeMinimalPlanParams();
			params.milestones.push({
				id: "milestone-1",
				name: "Dupe",
				description: "Duplicate",
				features: [
					{
						id: "feature-2",
						name: "Feature 2",
						description: "desc",
						acceptanceCriteria: ["crit"],
						relevantFiles: [],
						dependencies: [],
						estimatedComplexity: "low" as const,
					},
				],
			});
			const result = await callTool(tmpDir, params, state);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("Duplicate milestone ID");
			expect(loadPlan(tmpDir)).toBeNull();
		});

		it("rejects duplicate feature IDs", async () => {
			const state = makePlanningState();
			const params = makeMinimalPlanParams();
			params.milestones[0]!.features.push({
				id: "feature-1",
				name: "Dupe Feature",
				description: "desc",
				acceptanceCriteria: ["crit"],
				relevantFiles: [],
				dependencies: [],
				estimatedComplexity: "low" as const,
			});
			const result = await callTool(tmpDir, params, state);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("Duplicate feature ID");
			expect(loadPlan(tmpDir)).toBeNull();
		});

		it("rejects invalid estimatedComplexity", async () => {
			const state = makePlanningState();
			const params: Record<string, unknown> = {
				description: "Build an auth system",
				milestones: [
					{
						id: "milestone-1",
						name: "Foundation",
						description: "Core auth components",
						features: [
							{
								id: "feature-1",
								name: "User model",
								description: "Create user entity",
								acceptanceCriteria: ["User entity created"],
								relevantFiles: [],
								dependencies: [],
								estimatedComplexity: "extreme",
							},
						],
					},
				],
				validationCommands: [],
			};
			const result = await callTool(tmpDir, params, state);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("estimatedComplexity");
			expect(loadPlan(tmpDir)).toBeNull();
		});

		it("rejects dependency referencing non-existent feature ID", async () => {
			const state = makePlanningState();
			const params = makeMinimalPlanParams();
			params.milestones[0]!.features[0]!.dependencies = ["does-not-exist"];
			const result = await callTool(tmpDir, params, state);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("dependency");
			expect(result.content[0].text).toContain("does-not-exist");
			expect(loadPlan(tmpDir)).toBeNull();
		});

		it("does not write state.json on invalid plan", async () => {
			const state = makePlanningState();
			const params = { ...makeMinimalPlanParams(), description: "" };
			await callTool(tmpDir, params, state);

			const savedState = loadState(tmpDir);
			expect(savedState!.status).toBe("planning");
		});
	});

	describe("VAL-TOOL-003: state precondition enforcement", () => {
		it("returns error when called in executing state", async () => {
			const state: MissionState = { ...makePlanningState(), status: "executing" };
			const result = await callTool(tmpDir, makeMinimalPlanParams(), state);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("executing");
		});

		it("returns error when called in approved state", async () => {
			const state: MissionState = { ...makePlanningState(), status: "approved" };
			const result = await callTool(tmpDir, makeMinimalPlanParams(), state);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("approved");
		});

		it("returns error when called in completed state", async () => {
			const state: MissionState = { ...makePlanningState(), status: "completed" };
			const result = await callTool(tmpDir, makeMinimalPlanParams(), state);

			expect(result.content[0].text).toContain("Error");
		});

		it("returns error when no state exists", async () => {
			const { pi, getRegisteredTool: getTool } = createMockPi();
			registerSubmitPlanTool(pi, { basePath: tmpDir, updateWidget: mock(() => {}) });
			const tool = getTool("submit_plan")!;
			const result = await tool.execute("id", makeMinimalPlanParams(), undefined, undefined, createMockContext());

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("no active mission");
		});
	});

	describe("VAL-TOOL-023: re-submission from draft_review", () => {
		it("replaces existing plan and increments planVersion", async () => {
			const state = makePlanningState();
			const params = makeMinimalPlanParams();

			await callTool(tmpDir, params, state);

			const firstPlan = loadPlan(tmpDir)!;
			expect(firstPlan.planVersion).toBe(1);

			const draftState = loadState(tmpDir)!;
			const newParams = {
				...makeMinimalPlanParams(),
				description: "Updated description",
			};
			const result2 = await callTool(tmpDir, newParams, draftState);

			expect(result2.content[0].text).toContain("revised");

			const revisedPlan = loadPlan(tmpDir)!;
			expect(revisedPlan.planVersion).toBe(2);
			expect(revisedPlan.description).toBe("Updated description");
			expect(revisedPlan.id).toBe(firstPlan.id);
			expect(revisedPlan.createdAt).toBe(firstPlan.createdAt);
		});

		it("appends plan-revised mutation on re-submission", async () => {
			const state = makePlanningState();
			await callTool(tmpDir, makeMinimalPlanParams(), state);

			const draftState = loadState(tmpDir)!;
			await callTool(tmpDir, makeMinimalPlanParams(), draftState);

			const history = readHistory(tmpDir);
			expect(history).toHaveLength(2);
			expect(history[0]!.kind).toBe("plan-created");
			expect(history[1]!.kind).toBe("plan-revised");
			expect(history[1]!.planVersion).toBe(2);
		});

		it("keeps state in draft_review on re-submission", async () => {
			const state = makePlanningState();
			await callTool(tmpDir, makeMinimalPlanParams(), state);

			const draftState = loadState(tmpDir)!;
			await callTool(tmpDir, makeMinimalPlanParams(), draftState);

			const finalState = loadState(tmpDir)!;
			expect(finalState.status).toBe("draft_review");
		});
	});

	describe("dependencies can reference features in other milestones", () => {
		it("allows cross-milestone dependencies to valid feature IDs", async () => {
			const state = makePlanningState();
			const params = {
				...makeMinimalPlanParams(),
				milestones: [
					{
						id: "m1",
						name: "M1",
						description: "First",
						features: [
							{
								id: "f1",
								name: "Feature 1",
								description: "desc",
								acceptanceCriteria: ["crit"],
								relevantFiles: [],
								dependencies: [],
								estimatedComplexity: "low" as const,
							},
						],
					},
					{
						id: "m2",
						name: "M2",
						description: "Second",
						features: [
							{
								id: "f2",
								name: "Feature 2",
								description: "desc",
								acceptanceCriteria: ["crit"],
								relevantFiles: [],
								dependencies: ["f1"],
								estimatedComplexity: "medium" as const,
							},
						],
					},
				],
			};
			const result = await callTool(tmpDir, params, state);

			expect(result.content[0].text).toContain("submitted");
			expect(loadPlan(tmpDir)).not.toBeNull();
		});
	});

	describe("tool never throws for runtime errors", () => {
		it("returns error in content instead of throwing for invalid state", async () => {
			const state: MissionState = { ...makePlanningState(), status: "validating" };
			const fn = async () => callTool(tmpDir, makeMinimalPlanParams(), state);
			// must not throw
			const result = await fn();
			expect(result.content[0].text).toContain("Error");
		});
	});

	describe("showDraftReview callback", () => {
		it("calls showDraftReview with the plan after successful submission", async () => {
			const state = makePlanningState();
			const showDraftReview = mock((_plan: MissionPlan) => {});
			await callTool(tmpDir, makeMinimalPlanParams(), state, undefined, showDraftReview);

			expect(showDraftReview).toHaveBeenCalledTimes(1);
			const [calledPlan] = showDraftReview.mock.calls[0] as [MissionPlan];
			expect(calledPlan.description).toBe("Build an auth system");
			expect(calledPlan.milestones).toHaveLength(1);
		});

		it("calls showDraftReview after resubmission", async () => {
			const state = makePlanningState();
			await callTool(tmpDir, makeMinimalPlanParams(), state);

			const draftState = loadState(tmpDir)!;
			const showDraftReview = mock((_plan: MissionPlan) => {});
			const newParams = { ...makeMinimalPlanParams(), description: "Updated plan" };
			await callTool(tmpDir, newParams, draftState, undefined, showDraftReview);

			expect(showDraftReview).toHaveBeenCalledTimes(1);
			const [calledPlan] = showDraftReview.mock.calls[0] as [MissionPlan];
			expect(calledPlan.description).toBe("Updated plan");
		});

		it("does not call showDraftReview when validation fails", async () => {
			const state = makePlanningState();
			const showDraftReview = mock((_plan: MissionPlan) => {});
			const params = { ...makeMinimalPlanParams(), description: "" };
			await callTool(tmpDir, params, state, undefined, showDraftReview);

			expect(showDraftReview).not.toHaveBeenCalled();
		});
	});
});
