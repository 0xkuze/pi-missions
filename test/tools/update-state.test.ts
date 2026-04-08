import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPlan, loadState, savePlan, saveState } from "../../extensions/state/manager.js";
import { readHistory } from "../../extensions/state/plan-history.js";
import { registerUpdateStateTool } from "../../extensions/tools/update-state.js";
import type { MissionPlan, MissionState } from "../../extensions/types.js";
import {
	createMockContext,
	createMockPi,
	makeFeature,
	makeMilestone,
	makePlan,
	makeState,
	type ToolResult,
} from "../helpers/index.js";

function makeExecutingState() {
	return makeState();
}

function localMakePlan(overrides: Partial<MissionPlan> = {}) {
	return makePlan({
		milestones: [
			makeMilestone({
				id: "milestone-1",
				name: "Milestone One",
				description: "First milestone",
				features: [
					makeFeature({
						id: "feature-1",
						name: "Feature One",
						description: "First feature",
						acceptanceCriteria: ["works"],
					}),
				],
			}),
		],
		...overrides,
	});
}

async function callTool(
	basePath: string,
	params: {
		action: string;
		targetId: string;
		reason?: string;
		name?: string;
		description?: string;
		acceptanceCriteria?: string[];
		relevantFiles?: string[];
	},
	state: MissionState,
	plan: MissionPlan | null,
	updateWidget?: (state: MissionState, plan?: MissionPlan) => void,
): Promise<ToolResult> {
	const { pi, getRegisteredTool } = createMockPi();
	saveState(basePath, state);
	if (plan) savePlan(basePath, plan);
	registerUpdateStateTool(pi, { basePath, updateWidget: updateWidget ?? (() => {}) });
	const tool = getRegisteredTool("update_mission_state")!;
	return tool.execute("tool-call-id", params, undefined, undefined, undefined as never) as Promise<ToolResult>;
}

describe("registerUpdateStateTool", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "update-state-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("state guards — reject actions from invalid mission statuses", () => {
		const INVALID_STATUSES_FOR = {
			skip_feature: [
				"planning",
				"draft_review",
				"approved",
				"validating",
				"paused",
				"completed",
				"failed",
				"aborted",
			],
			block_feature: [
				"planning",
				"draft_review",
				"approved",
				"validating",
				"paused",
				"completed",
				"failed",
				"aborted",
			],
			add_feature: ["approved", "validating", "paused", "completed", "failed", "aborted"],
			remove_feature: ["approved", "validating", "paused", "completed", "failed", "aborted"],
		} as const;

		for (const [action, invalidStatuses] of Object.entries(INVALID_STATUSES_FOR)) {
			for (const status of invalidStatuses) {
				it(`rejects ${action} from '${status}' state`, async () => {
					const state = makeState({ status: status as any });
					const plan = localMakePlan();
					const params: any = { action, targetId: "milestone-1" };
					if (action === "add_feature") {
						params.name = "F";
						params.description = "d";
						params.acceptanceCriteria = ["x"];
					}
					if (action === "skip_feature" || action === "block_feature" || action === "remove_feature") {
						params.targetId = "feature-1";
					}
					const result = await callTool(tmpDir, params, state, plan);
					expect(result.content[0].text).toContain("Error");
					expect(result.content[0].text).toContain(status);
				});
			}
		}

		it("start_milestone returns auto-managed from any state", async () => {
			const state = makeState({ status: "executing" });
			const plan = localMakePlan();
			const result = await callTool(tmpDir, { action: "start_milestone", targetId: "milestone-1" }, state, plan);
			expect(result.content[0].text).toContain("auto-managed");
		});

		it("complete_milestone returns auto-managed from any state", async () => {
			const state = makeState({ status: "executing" });
			const plan = localMakePlan();
			const result = await callTool(tmpDir, { action: "complete_milestone", targetId: "milestone-1" }, state, plan);
			expect(result.content[0].text).toContain("auto-managed");
		});

		it("allows add_feature from 'planning' state", async () => {
			const state = makeState({ status: "planning" });
			const plan = localMakePlan();
			const result = await callTool(
				tmpDir,
				{ action: "add_feature", targetId: "milestone-1", name: "F", description: "d", acceptanceCriteria: ["x"] },
				state,
				plan,
			);
			expect(result.content[0].text).not.toContain("Error");
		});

		it("allows add_feature from 'draft_review' state", async () => {
			const state = makeState({ status: "draft_review" });
			const plan = localMakePlan();
			const result = await callTool(
				tmpDir,
				{ action: "add_feature", targetId: "milestone-1", name: "F", description: "d", acceptanceCriteria: ["x"] },
				state,
				plan,
			);
			expect(result.content[0].text).not.toContain("Error");
		});

		it("note action is allowed from any non-terminal state", async () => {
			for (const status of ["planning", "draft_review", "approved", "executing", "validating", "paused"] as const) {
				const state = makeState({ status });
				const plan = localMakePlan();
				const result = await callTool(tmpDir, { action: "note", targetId: "test", reason: "note" }, state, plan);
				expect(result.content[0].text).toContain("Note recorded");
			}
		});
	});

	describe("no state", () => {
		it("returns error when no state exists", async () => {
			const { pi, getRegisteredTool: getTool } = createMockPi();
			registerUpdateStateTool(pi, { basePath: tmpDir, updateWidget: () => {} });
			const tool = getTool("update_mission_state")!;
			const result = await tool.execute(
				"id",
				{ action: "start_milestone", targetId: "milestone-1" },
				undefined,
				undefined,
				createMockContext(),
			);
			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("no active mission");
		});
	});

	describe("VAL-TOOL-015: skip_feature", () => {
		it("sets feature to skipped", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan();
			await callTool(tmpDir, { action: "skip_feature", targetId: "feature-1" }, state, plan);

			const savedPlan = loadPlan(tmpDir)!;
			expect(savedPlan.milestones[0]!.features[0]!.status).toBe("skipped");
		});

		it("increments totalFeaturesSkipped", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan();
			await callTool(tmpDir, { action: "skip_feature", targetId: "feature-1" }, state, plan);

			const savedState = loadState(tmpDir)!;
			expect(savedState.totalFeaturesSkipped).toBe(1);
		});

		it("appends feature_skipped progress event", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan();
			await callTool(tmpDir, { action: "skip_feature", targetId: "feature-1" }, state, plan);

			const savedState = loadState(tmpDir)!;
			const events = savedState.progressLog.filter((e) => e.type === "feature_skipped");
			expect(events).toHaveLength(1);
			expect(events[0]!.detail).toContain("Feature One");
		});

		it("records reason in event metadata when provided", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan();
			await callTool(tmpDir, { action: "skip_feature", targetId: "feature-1", reason: "not needed" }, state, plan);

			const savedState = loadState(tmpDir)!;
			const event = savedState.progressLog.find((e) => e.type === "feature_skipped")!;
			expect(event.metadata?.reason).toBe("not needed");
		});

		it("calls updateWidget", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan();
			const updateWidget = mock((_s: MissionState, _p?: MissionPlan) => {});
			await callTool(tmpDir, { action: "skip_feature", targetId: "feature-1" }, state, plan, updateWidget);

			expect(updateWidget).toHaveBeenCalledTimes(1);
		});
	});

	describe("VAL-TOOL-015 / VAL-CROSS-018: block_feature", () => {
		it("sets feature to blocked", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan();
			await callTool(tmpDir, { action: "block_feature", targetId: "feature-1" }, state, plan);

			const savedPlan = loadPlan(tmpDir)!;
			expect(savedPlan.milestones[0]!.features[0]!.status).toBe("blocked");
		});

		it("appends feature_blocked progress event", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan();
			await callTool(tmpDir, { action: "block_feature", targetId: "feature-1" }, state, plan);

			const savedState = loadState(tmpDir)!;
			const events = savedState.progressLog.filter((e) => e.type === "feature_blocked");
			expect(events).toHaveLength(1);
			expect(events[0]!.detail).toContain("Feature One");
		});

		it("records reason in event metadata when provided", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan();
			await callTool(
				tmpDir,
				{ action: "block_feature", targetId: "feature-1", reason: "external dependency missing" },
				state,
				plan,
			);

			const savedState = loadState(tmpDir)!;
			const event = savedState.progressLog.find((e) => e.type === "feature_blocked")!;
			expect(event.metadata?.reason).toBe("external dependency missing");
		});

		it("persists plan.json and state.json", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan();
			await callTool(tmpDir, { action: "block_feature", targetId: "feature-1" }, state, plan);

			const savedPlan = loadPlan(tmpDir);
			const savedState = loadState(tmpDir);
			expect(savedPlan).not.toBeNull();
			expect(savedState).not.toBeNull();
		});

		it("calls updateWidget", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan();
			const updateWidget = mock((_s: MissionState, _p?: MissionPlan) => {});
			await callTool(tmpDir, { action: "block_feature", targetId: "feature-1" }, state, plan, updateWidget);

			expect(updateWidget).toHaveBeenCalledTimes(1);
		});
	});

	describe("VAL-TOOL-015: note", () => {
		it("appends a plan_mutated progress event with the reason as detail", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan();
			await callTool(tmpDir, { action: "note", targetId: "anything", reason: "Important note here" }, state, plan);

			const savedState = loadState(tmpDir)!;
			const events = savedState.progressLog.filter((e) => e.type === "plan_mutated");
			expect(events).toHaveLength(1);
			expect(events[0]!.detail).toBe("Important note here");
		});

		it("uses targetId as detail when reason is absent", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan();
			await callTool(tmpDir, { action: "note", targetId: "note text here" }, state, plan);

			const savedState = loadState(tmpDir)!;
			const events = savedState.progressLog.filter((e) => e.type === "plan_mutated");
			expect(events).toHaveLength(1);
			expect(events[0]!.detail).toBe("note text here");
		});

		it("persists state.json after note", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan();
			await callTool(tmpDir, { action: "note", targetId: "note", reason: "hello" }, state, plan);

			const savedState = loadState(tmpDir);
			expect(savedState).not.toBeNull();
		});

		it("calls updateWidget for note action", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan();
			const updateWidget = mock((_s: MissionState, _p?: MissionPlan) => {});
			await callTool(tmpDir, { action: "note", targetId: "note", reason: "test" }, state, plan, updateWidget);

			expect(updateWidget).toHaveBeenCalledTimes(1);
		});
	});

	describe("VAL-TOOL-016: validation of unknown targetId", () => {
		it("returns error for unknown featureId in skip_feature", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan();
			const result = await callTool(tmpDir, { action: "skip_feature", targetId: "missing-feature" }, state, plan);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("missing-feature");
		});

		it("returns error for unknown featureId in block_feature", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan();
			const result = await callTool(tmpDir, { action: "block_feature", targetId: "unknown-feature" }, state, plan);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("unknown-feature");
		});
	});

	describe("VAL-TOOL-016: invalid state preconditions", () => {
		it("rejects start_milestone as auto-managed", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan({ milestones: [makeMilestone({ status: "pending" })] });
			const result = await callTool(tmpDir, { action: "start_milestone", targetId: "milestone-1" }, state, plan);

			expect(result.content[0].text).toContain("auto-managed");
		});

		it("rejects complete_milestone as auto-managed", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan({ milestones: [makeMilestone({ status: "active" })] });
			const result = await callTool(tmpDir, { action: "complete_milestone", targetId: "milestone-1" }, state, plan);

			expect(result.content[0].text).toContain("auto-managed");
		});

		it("rejects skipping a completed (done) feature", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan({
				milestones: [makeMilestone({ features: [makeFeature({ id: "feature-1", status: "done" })] })],
			});
			const result = await callTool(tmpDir, { action: "skip_feature", targetId: "feature-1" }, state, plan);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("already completed");
		});

		it("does not modify state.json or plan.json when returning an error", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan();
			await callTool(tmpDir, { action: "skip_feature", targetId: "nonexistent" }, state, plan);

			const savedState = loadState(tmpDir)!;
			const savedPlan = loadPlan(tmpDir)!;
			expect(savedState.currentMilestoneId).toBeUndefined();
			expect(savedPlan.milestones[0]!.status).toBe("pending");
		});
	});

	describe("no plan for plan-required actions", () => {
		it("returns error when no plan exists for block_feature", async () => {
			const state = makeExecutingState();
			const result = await callTool(tmpDir, { action: "block_feature", targetId: "feature-1" }, state, null);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("no plan");
		});
	});

	describe("multi-feature plan handling", () => {
		it("correctly targets the right feature when multiple features exist", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan({
				milestones: [
					{
						...makeMilestone(),
						features: [
							makeFeature({ id: "feature-1", name: "One" }),
							makeFeature({ id: "feature-2", name: "Two" }),
						],
					},
				],
			});
			await callTool(tmpDir, { action: "skip_feature", targetId: "feature-2" }, state, plan);

			const savedPlan = loadPlan(tmpDir)!;
			const features = savedPlan.milestones[0]!.features;
			expect(features[0]!.status).toBe("pending");
			expect(features[1]!.status).toBe("skipped");
		});

		it("correctly targets feature across multiple milestones", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan({
				milestones: [
					makeMilestone({ id: "milestone-1", features: [makeFeature({ id: "feature-1" })] }),
					makeMilestone({ id: "milestone-2", features: [makeFeature({ id: "feature-2" })] }),
				],
			});
			await callTool(tmpDir, { action: "block_feature", targetId: "feature-2" }, state, plan);

			const savedPlan = loadPlan(tmpDir)!;
			expect(savedPlan.milestones[0]!.features[0]!.status).toBe("pending");
			expect(savedPlan.milestones[1]!.features[0]!.status).toBe("blocked");
		});
	});

	describe("VAL-CROSS-017: tool errors return structured content, never throw", () => {
		it("returns error in content for unknown targetId (not throws)", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan();
			const fn = () => callTool(tmpDir, { action: "skip_feature", targetId: "ghost" }, state, plan);
			const result = await fn();
			expect(result.content[0].text).toContain("Error");
		});

		it("returns error in content for invalid precondition (not throws)", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan({ milestones: [makeMilestone({ features: [makeFeature({ status: "done" })] })] });
			const fn = () => callTool(tmpDir, { action: "skip_feature", targetId: "feat-1" }, state, plan);
			const result = await fn();
			expect(result.content[0].text).toContain("Error");
		});
	});

	describe("VAL-SCOPE-001: add_feature", () => {
		it("adds a new pending feature to the specified milestone", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan();
			await callTool(
				tmpDir,
				{
					action: "add_feature",
					targetId: "milestone-1",
					name: "New Feature",
					description: "A new feature to add",
					acceptanceCriteria: ["works"],
					relevantFiles: ["src/index.ts"],
				},
				state,
				plan,
			);

			const savedPlan = loadPlan(tmpDir)!;
			const features = savedPlan.milestones[0]!.features;
			expect(features).toHaveLength(2);
			const added = features.find((f) => f.name === "New Feature")!;
			expect(added).toBeDefined();
			expect(added.status).toBe("pending");
			expect(added.description).toBe("A new feature to add");
			expect(added.acceptanceCriteria).toEqual(["works"]);
			expect(added.relevantFiles).toEqual(["src/index.ts"]);
		});

		it("increments planVersion", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan({ planVersion: 3 });
			await callTool(
				tmpDir,
				{
					action: "add_feature",
					targetId: "milestone-1",
					name: "Another Feature",
					description: "desc",
					acceptanceCriteria: ["passes"],
				},
				state,
				plan,
			);

			const savedPlan = loadPlan(tmpDir)!;
			expect(savedPlan.planVersion).toBe(4);
		});

		it("appends an add-feature mutation to plan history", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan();
			await callTool(
				tmpDir,
				{
					action: "add_feature",
					targetId: "milestone-1",
					name: "Feature X",
					description: "desc",
					acceptanceCriteria: ["criterion"],
				},
				state,
				plan,
			);

			const history = readHistory(tmpDir);
			expect(history).toHaveLength(1);
			expect(history[0]!.kind).toBe("add-feature");
			expect(history[0]!.actor).toBe("orchestrator");
			expect(history[0]!.planVersion).toBe(2);
		});

		it("calls updateWidget with the updated plan", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan();
			const updateWidget = mock((_s: MissionState, _p?: MissionPlan) => {});
			await callTool(
				tmpDir,
				{
					action: "add_feature",
					targetId: "milestone-1",
					name: "Widget Feature",
					description: "desc",
					acceptanceCriteria: ["ok"],
				},
				state,
				plan,
				updateWidget,
			);

			expect(updateWidget).toHaveBeenCalledTimes(1);
		});

		it("returns error for unknown milestoneId", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan();
			const result = await callTool(
				tmpDir,
				{
					action: "add_feature",
					targetId: "no-such-milestone",
					name: "F",
					description: "d",
					acceptanceCriteria: ["x"],
				},
				state,
				plan,
			);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("no-such-milestone");
		});

		it("returns error when name is missing", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan();
			const result = await callTool(
				tmpDir,
				{ action: "add_feature", targetId: "milestone-1", description: "d", acceptanceCriteria: ["x"] },
				state,
				plan,
			);

			expect(result.content[0].text).toContain("Error");
		});

		it("returns error when adding to a done milestone", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan({ milestones: [makeMilestone({ status: "done" })] });
			const result = await callTool(
				tmpDir,
				{
					action: "add_feature",
					targetId: "milestone-1",
					name: "F",
					description: "d",
					acceptanceCriteria: ["x"],
				},
				state,
				plan,
			);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("done");
		});
	});

	describe("complete_feature action", () => {
		it("sets feature status to done", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan({
				milestones: [
					makeMilestone({
						features: [makeFeature({ id: "feature-1", name: "Feature One", status: "active" })],
					}),
				],
			});
			await callTool(
				tmpDir,
				{ action: "complete_feature", targetId: "feature-1", reason: "work verified" },
				state,
				plan,
			);

			const savedPlan = loadPlan(tmpDir)!;
			expect(savedPlan.milestones[0]!.features[0]!.status).toBe("done");
		});

		it("increments totalFeaturesCompleted", async () => {
			const state = makeState({ totalFeaturesCompleted: 2 });
			const plan = localMakePlan({
				milestones: [
					makeMilestone({
						features: [makeFeature({ id: "feature-1", status: "active" })],
					}),
				],
			});
			await callTool(tmpDir, { action: "complete_feature", targetId: "feature-1" }, state, plan);

			const savedState = loadState(tmpDir)!;
			expect(savedState.totalFeaturesCompleted).toBe(3);
		});

		it("does NOT increment totalFeaturesSkipped", async () => {
			const state = makeState({ totalFeaturesSkipped: 0 });
			const plan = localMakePlan({
				milestones: [
					makeMilestone({
						features: [makeFeature({ id: "feature-1", status: "active" })],
					}),
				],
			});
			await callTool(tmpDir, { action: "complete_feature", targetId: "feature-1" }, state, plan);

			const savedState = loadState(tmpDir)!;
			expect(savedState.totalFeaturesSkipped).toBe(0);
		});

		it("appends feature_complete progress event with reason", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan({
				milestones: [
					makeMilestone({
						features: [makeFeature({ id: "feature-1", name: "Feature One", status: "active" })],
					}),
				],
			});
			await callTool(
				tmpDir,
				{ action: "complete_feature", targetId: "feature-1", reason: "work verified via bash" },
				state,
				plan,
			);

			const savedState = loadState(tmpDir)!;
			const events = savedState.progressLog.filter((e) => e.type === "feature_complete");
			expect(events).toHaveLength(1);
			expect(events[0]!.detail).toContain("Feature One");
			expect(events[0]!.metadata?.reason).toBe("work verified via bash");
		});

		it("calls updateWidget", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan({
				milestones: [
					makeMilestone({
						features: [makeFeature({ id: "feature-1", status: "active" })],
					}),
				],
			});
			const updateWidget = mock((_s: MissionState, _p?: MissionPlan) => {});
			await callTool(tmpDir, { action: "complete_feature", targetId: "feature-1" }, state, plan, updateWidget);

			expect(updateWidget).toHaveBeenCalledTimes(1);
		});

		it("returns error for unknown featureId", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan();
			const result = await callTool(tmpDir, { action: "complete_feature", targetId: "nonexistent" }, state, plan);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("nonexistent");
		});

		it("returns error if feature is already done", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan({
				milestones: [
					makeMilestone({
						features: [makeFeature({ id: "feature-1", status: "done" })],
					}),
				],
			});
			const result = await callTool(tmpDir, { action: "complete_feature", targetId: "feature-1" }, state, plan);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("already completed");
		});

		it("returns success message", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan({
				milestones: [
					makeMilestone({
						features: [makeFeature({ id: "feature-1", name: "My Feature", status: "active" })],
					}),
				],
			});
			const result = await callTool(
				tmpDir,
				{ action: "complete_feature", targetId: "feature-1", reason: "verified" },
				state,
				plan,
			);

			expect(result.content[0].text).toContain("completed");
			expect(result.content[0].text).toContain("feature-1");
		});

		it("is allowed only in executing state", async () => {
			const invalidStatuses = [
				"planning",
				"draft_review",
				"approved",
				"validating",
				"paused",
				"completed",
				"failed",
				"aborted",
			];
			for (const status of invalidStatuses) {
				const state = makeState({ status: status as any });
				const plan = localMakePlan({
					milestones: [
						makeMilestone({
							features: [makeFeature({ id: "feature-1", status: "active" })],
						}),
					],
				});
				const result = await callTool(tmpDir, { action: "complete_feature", targetId: "feature-1" }, state, plan);
				expect(result.content[0].text).toContain("Error");
				expect(result.content[0].text).toContain(status);
			}
		});

		it("sets completedAt timestamp on the feature", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan({
				milestones: [
					makeMilestone({
						features: [makeFeature({ id: "feature-1", status: "active" })],
					}),
				],
			});
			await callTool(tmpDir, { action: "complete_feature", targetId: "feature-1" }, state, plan);

			const savedPlan = loadPlan(tmpDir)!;
			const feature = savedPlan.milestones[0]!.features[0]!;
			expect(feature.completedAt).toBeDefined();
			expect(feature.completedAt).not.toBe("");
		});
	});

	describe("VAL-SCOPE-002: remove_feature", () => {
		it("removes a pending feature from the plan", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan({
				milestones: [
					makeMilestone({
						features: [
							makeFeature({ id: "feature-1", status: "pending" }),
							makeFeature({ id: "feature-2", name: "Feature Two", status: "pending" }),
						],
					}),
				],
			});
			await callTool(tmpDir, { action: "remove_feature", targetId: "feature-1" }, state, plan);

			const savedPlan = loadPlan(tmpDir)!;
			const features = savedPlan.milestones[0]!.features;
			expect(features).toHaveLength(1);
			expect(features[0]!.id).toBe("feature-2");
		});

		it("increments planVersion", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan({ planVersion: 5 });
			await callTool(tmpDir, { action: "remove_feature", targetId: "feature-1" }, state, plan);

			const savedPlan = loadPlan(tmpDir)!;
			expect(savedPlan.planVersion).toBe(6);
		});

		it("appends a remove-feature mutation to plan history", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan();
			await callTool(tmpDir, { action: "remove_feature", targetId: "feature-1" }, state, plan);

			const history = readHistory(tmpDir);
			expect(history).toHaveLength(1);
			expect(history[0]!.kind).toBe("remove-feature");
			expect(history[0]!.actor).toBe("orchestrator");
			expect(history[0]!.planVersion).toBe(2);
		});

		it("calls updateWidget with the updated plan", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan();
			const updateWidget = mock((_s: MissionState, _p?: MissionPlan) => {});
			await callTool(tmpDir, { action: "remove_feature", targetId: "feature-1" }, state, plan, updateWidget);

			expect(updateWidget).toHaveBeenCalledTimes(1);
		});

		it("rejects removing a completed (done) feature", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan({
				milestones: [makeMilestone({ features: [makeFeature({ id: "feature-1", status: "done" })] })],
			});
			const result = await callTool(tmpDir, { action: "remove_feature", targetId: "feature-1" }, state, plan);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("completed");
		});

		it("rejects removing an active feature", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan({
				milestones: [makeMilestone({ features: [makeFeature({ id: "feature-1", status: "active" })] })],
			});
			const result = await callTool(tmpDir, { action: "remove_feature", targetId: "feature-1" }, state, plan);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("active");
		});

		it("returns error for unknown featureId", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan();
			const result = await callTool(tmpDir, { action: "remove_feature", targetId: "does-not-exist" }, state, plan);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("does-not-exist");
		});

		it("does not modify plan.json when returning an error", async () => {
			const state = makeExecutingState();
			const plan = localMakePlan({
				milestones: [makeMilestone({ features: [makeFeature({ status: "done" })] })],
			});
			await callTool(tmpDir, { action: "remove_feature", targetId: "feature-1" }, state, plan);

			const savedPlan = loadPlan(tmpDir)!;
			expect(savedPlan.planVersion).toBe(1);
			expect(savedPlan.milestones[0]!.features).toHaveLength(1);
		});
	});
});
