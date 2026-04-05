import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadPlan, loadState, savePlan, saveState } from "../../extensions/state/manager.js";
import type { Feature, Milestone, MissionPlan, MissionState } from "../../extensions/types.js";
import { nowISO } from "../../extensions/utils.js";
import { registerUpdateStateTool } from "../../extensions/tools/update-state.js";

function makeExecutingState(): MissionState {
	return {
		missionId: "test-mission",
		status: "executing",
		progressLog: [],
		startedAt: nowISO(),
		totalFeaturesCompleted: 0,
		totalFeaturesFailed: 0,
		totalFeaturesSkipped: 0,
		totalFixFeaturesCreated: 0,
	};
}

function makeFeature(overrides: Partial<Feature> = {}): Feature {
	return {
		id: "feature-1",
		name: "Feature One",
		description: "First feature",
		acceptanceCriteria: ["works"],
		relevantFiles: [],
		dependencies: [],
		estimatedComplexity: "low",
		status: "pending",
		attempts: [],
		...overrides,
	};
}

function makeMilestone(overrides: Partial<Milestone> = {}): Milestone {
	return {
		id: "milestone-1",
		name: "Milestone One",
		description: "First milestone",
		features: [makeFeature()],
		status: "pending",
		...overrides,
	};
}

function makePlan(overrides: Partial<MissionPlan> = {}): MissionPlan {
	return {
		id: "plan-1",
		description: "Test plan",
		planVersion: 1,
		milestones: [makeMilestone()],
		validationCommands: [],
		modelAssignment: {},
		createdAt: nowISO(),
		...overrides,
	};
}

type ToolResult = { content: Array<{ type: string; text: string }>; details: unknown };
type ExecutableTool = { execute: (...args: unknown[]) => Promise<ToolResult> };

function makeMockPi(): { pi: ExtensionAPI; getLastRegisteredTool: () => ExecutableTool | null } {
	let registeredTool: ExecutableTool | null = null;
	const pi = {
		registerTool: (tool: ExecutableTool) => {
			registeredTool = tool;
		},
	} as unknown as ExtensionAPI;
	return {
		pi,
		getLastRegisteredTool: () => registeredTool,
	};
}

async function callTool(
	basePath: string,
	params: { action: string; targetId: string; reason?: string },
	state: MissionState,
	plan: MissionPlan | null,
	updateWidget?: (state: MissionState, plan?: MissionPlan) => void,
): Promise<ToolResult> {
	const { pi, getLastRegisteredTool } = makeMockPi();
	saveState(basePath, state);
	if (plan) savePlan(basePath, plan);
	registerUpdateStateTool(pi, { basePath, updateWidget: updateWidget ?? (() => {}) });
	const tool = getLastRegisteredTool()!;
	return tool.execute("tool-call-id", params, undefined, undefined, undefined) as Promise<ToolResult>;
}

describe("registerUpdateStateTool", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "update-state-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("no state", () => {
		it("returns error when no state exists", async () => {
			const { pi, getLastRegisteredTool } = makeMockPi();
			registerUpdateStateTool(pi, { basePath: tmpDir, updateWidget: () => {} });
			const tool = getLastRegisteredTool()!;
			const result = await tool.execute(
				"id",
				{ action: "start_milestone", targetId: "milestone-1" },
				undefined,
				undefined,
				undefined,
			);
			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("no active mission");
		});
	});

	describe("VAL-TOOL-015: start_milestone", () => {
		it("sets milestone to active and updates currentMilestoneId", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			await callTool(tmpDir, { action: "start_milestone", targetId: "milestone-1" }, state, plan);

			const savedState = loadState(tmpDir)!;
			const savedPlan = loadPlan(tmpDir)!;
			expect(savedState.currentMilestoneId).toBe("milestone-1");
			expect(savedPlan.milestones[0]!.status).toBe("active");
		});

		it("sets startedAt on the milestone", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			await callTool(tmpDir, { action: "start_milestone", targetId: "milestone-1" }, state, plan);

			const savedPlan = loadPlan(tmpDir)!;
			expect(savedPlan.milestones[0]!.startedAt).toBeTruthy();
		});

		it("appends milestone_start progress event", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			await callTool(tmpDir, { action: "start_milestone", targetId: "milestone-1" }, state, plan);

			const savedState = loadState(tmpDir)!;
			const events = savedState.progressLog.filter((e) => e.type === "milestone_start");
			expect(events).toHaveLength(1);
			expect(events[0]!.detail).toContain("Milestone One");
		});

		it("records reason in event metadata when provided", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			await callTool(
				tmpDir,
				{ action: "start_milestone", targetId: "milestone-1", reason: "ready to go" },
				state,
				plan,
			);

			const savedState = loadState(tmpDir)!;
			const event = savedState.progressLog.find((e) => e.type === "milestone_start")!;
			expect(event.metadata?.reason).toBe("ready to go");
		});

		it("persists plan.json and state.json", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			await callTool(tmpDir, { action: "start_milestone", targetId: "milestone-1" }, state, plan);

			const savedPlan = loadPlan(tmpDir);
			const savedState = loadState(tmpDir);
			expect(savedPlan).not.toBeNull();
			expect(savedState).not.toBeNull();
		});

		it("calls updateWidget", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			const updateWidget = mock((_s: MissionState, _p?: MissionPlan) => {});
			await callTool(tmpDir, { action: "start_milestone", targetId: "milestone-1" }, state, plan, updateWidget);

			expect(updateWidget).toHaveBeenCalledTimes(1);
		});
	});

	describe("VAL-TOOL-015: complete_milestone", () => {
		it("sets milestone to done and sets completedAt", async () => {
			const state = makeExecutingState();
			const plan = makePlan({ milestones: [makeMilestone({ status: "active" })] });
			await callTool(tmpDir, { action: "complete_milestone", targetId: "milestone-1" }, state, plan);

			const savedPlan = loadPlan(tmpDir)!;
			expect(savedPlan.milestones[0]!.status).toBe("done");
			expect(savedPlan.milestones[0]!.completedAt).toBeTruthy();
		});

		it("appends milestone_complete progress event", async () => {
			const state = makeExecutingState();
			const plan = makePlan({ milestones: [makeMilestone({ status: "active" })] });
			await callTool(tmpDir, { action: "complete_milestone", targetId: "milestone-1" }, state, plan);

			const savedState = loadState(tmpDir)!;
			const events = savedState.progressLog.filter((e) => e.type === "milestone_complete");
			expect(events).toHaveLength(1);
			expect(events[0]!.detail).toContain("Milestone One");
		});

		it("records reason in event metadata", async () => {
			const state = makeExecutingState();
			const plan = makePlan({ milestones: [makeMilestone({ status: "active" })] });
			await callTool(
				tmpDir,
				{ action: "complete_milestone", targetId: "milestone-1", reason: "all done" },
				state,
				plan,
			);

			const savedState = loadState(tmpDir)!;
			const event = savedState.progressLog.find((e) => e.type === "milestone_complete")!;
			expect(event.metadata?.reason).toBe("all done");
		});

		it("calls updateWidget", async () => {
			const state = makeExecutingState();
			const plan = makePlan({ milestones: [makeMilestone({ status: "active" })] });
			const updateWidget = mock((_s: MissionState, _p?: MissionPlan) => {});
			await callTool(tmpDir, { action: "complete_milestone", targetId: "milestone-1" }, state, plan, updateWidget);

			expect(updateWidget).toHaveBeenCalledTimes(1);
		});
	});

	describe("VAL-TOOL-015: skip_feature", () => {
		it("sets feature to skipped", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			await callTool(tmpDir, { action: "skip_feature", targetId: "feature-1" }, state, plan);

			const savedPlan = loadPlan(tmpDir)!;
			expect(savedPlan.milestones[0]!.features[0]!.status).toBe("skipped");
		});

		it("increments totalFeaturesSkipped", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			await callTool(tmpDir, { action: "skip_feature", targetId: "feature-1" }, state, plan);

			const savedState = loadState(tmpDir)!;
			expect(savedState.totalFeaturesSkipped).toBe(1);
		});

		it("appends feature_skipped progress event", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			await callTool(tmpDir, { action: "skip_feature", targetId: "feature-1" }, state, plan);

			const savedState = loadState(tmpDir)!;
			const events = savedState.progressLog.filter((e) => e.type === "feature_skipped");
			expect(events).toHaveLength(1);
			expect(events[0]!.detail).toContain("Feature One");
		});

		it("records reason in event metadata when provided", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			await callTool(tmpDir, { action: "skip_feature", targetId: "feature-1", reason: "not needed" }, state, plan);

			const savedState = loadState(tmpDir)!;
			const event = savedState.progressLog.find((e) => e.type === "feature_skipped")!;
			expect(event.metadata?.reason).toBe("not needed");
		});

		it("calls updateWidget", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			const updateWidget = mock((_s: MissionState, _p?: MissionPlan) => {});
			await callTool(tmpDir, { action: "skip_feature", targetId: "feature-1" }, state, plan, updateWidget);

			expect(updateWidget).toHaveBeenCalledTimes(1);
		});
	});

	describe("VAL-TOOL-015 / VAL-CROSS-018: block_feature", () => {
		it("sets feature to blocked", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			await callTool(tmpDir, { action: "block_feature", targetId: "feature-1" }, state, plan);

			const savedPlan = loadPlan(tmpDir)!;
			expect(savedPlan.milestones[0]!.features[0]!.status).toBe("blocked");
		});

		it("appends feature_blocked progress event", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			await callTool(tmpDir, { action: "block_feature", targetId: "feature-1" }, state, plan);

			const savedState = loadState(tmpDir)!;
			const events = savedState.progressLog.filter((e) => e.type === "feature_blocked");
			expect(events).toHaveLength(1);
			expect(events[0]!.detail).toContain("Feature One");
		});

		it("records reason in event metadata when provided", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
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
			const plan = makePlan();
			await callTool(tmpDir, { action: "block_feature", targetId: "feature-1" }, state, plan);

			const savedPlan = loadPlan(tmpDir);
			const savedState = loadState(tmpDir);
			expect(savedPlan).not.toBeNull();
			expect(savedState).not.toBeNull();
		});

		it("calls updateWidget", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			const updateWidget = mock((_s: MissionState, _p?: MissionPlan) => {});
			await callTool(tmpDir, { action: "block_feature", targetId: "feature-1" }, state, plan, updateWidget);

			expect(updateWidget).toHaveBeenCalledTimes(1);
		});
	});

	describe("VAL-TOOL-015: note", () => {
		it("appends a plan_mutated progress event with the reason as detail", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			await callTool(tmpDir, { action: "note", targetId: "anything", reason: "Important note here" }, state, plan);

			const savedState = loadState(tmpDir)!;
			const events = savedState.progressLog.filter((e) => e.type === "plan_mutated");
			expect(events).toHaveLength(1);
			expect(events[0]!.detail).toBe("Important note here");
		});

		it("uses targetId as detail when reason is absent", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			await callTool(tmpDir, { action: "note", targetId: "note text here" }, state, plan);

			const savedState = loadState(tmpDir)!;
			const events = savedState.progressLog.filter((e) => e.type === "plan_mutated");
			expect(events).toHaveLength(1);
			expect(events[0]!.detail).toBe("note text here");
		});

		it("persists state.json after note", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			await callTool(tmpDir, { action: "note", targetId: "note", reason: "hello" }, state, plan);

			const savedState = loadState(tmpDir);
			expect(savedState).not.toBeNull();
		});

		it("calls updateWidget for note action", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			const updateWidget = mock((_s: MissionState, _p?: MissionPlan) => {});
			await callTool(tmpDir, { action: "note", targetId: "note", reason: "test" }, state, plan, updateWidget);

			expect(updateWidget).toHaveBeenCalledTimes(1);
		});
	});

	describe("VAL-TOOL-016: validation of unknown targetId", () => {
		it("returns error for unknown milestoneId in start_milestone", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			const result = await callTool(tmpDir, { action: "start_milestone", targetId: "does-not-exist" }, state, plan);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("does-not-exist");
		});

		it("returns error for unknown milestoneId in complete_milestone", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			const result = await callTool(
				tmpDir,
				{ action: "complete_milestone", targetId: "no-such-milestone" },
				state,
				plan,
			);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("no-such-milestone");
		});

		it("returns error for unknown featureId in skip_feature", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			const result = await callTool(tmpDir, { action: "skip_feature", targetId: "missing-feature" }, state, plan);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("missing-feature");
		});

		it("returns error for unknown featureId in block_feature", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			const result = await callTool(tmpDir, { action: "block_feature", targetId: "unknown-feature" }, state, plan);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("unknown-feature");
		});
	});

	describe("VAL-TOOL-016: invalid state preconditions", () => {
		it("rejects completing a non-active milestone (pending status)", async () => {
			const state = makeExecutingState();
			const plan = makePlan({ milestones: [makeMilestone({ status: "pending" })] });
			const result = await callTool(tmpDir, { action: "complete_milestone", targetId: "milestone-1" }, state, plan);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("not active");
		});

		it("rejects completing a non-active milestone (done status)", async () => {
			const state = makeExecutingState();
			const plan = makePlan({ milestones: [makeMilestone({ status: "done" })] });
			const result = await callTool(tmpDir, { action: "complete_milestone", targetId: "milestone-1" }, state, plan);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("not active");
		});

		it("rejects completing a non-active milestone (failed status)", async () => {
			const state = makeExecutingState();
			const plan = makePlan({ milestones: [makeMilestone({ status: "failed" })] });
			const result = await callTool(tmpDir, { action: "complete_milestone", targetId: "milestone-1" }, state, plan);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("not active");
		});

		it("rejects starting an already-active milestone", async () => {
			const state = makeExecutingState();
			const plan = makePlan({ milestones: [makeMilestone({ status: "active" })] });
			const result = await callTool(tmpDir, { action: "start_milestone", targetId: "milestone-1" }, state, plan);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("already active");
		});

		it("rejects skipping a completed (done) feature", async () => {
			const state = makeExecutingState();
			const plan = makePlan({
				milestones: [makeMilestone({ features: [makeFeature({ status: "done" })] })],
			});
			const result = await callTool(tmpDir, { action: "skip_feature", targetId: "feature-1" }, state, plan);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("already completed");
		});

		it("does not modify state.json or plan.json when returning an error", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			await callTool(tmpDir, { action: "start_milestone", targetId: "nonexistent" }, state, plan);

			const savedState = loadState(tmpDir)!;
			const savedPlan = loadPlan(tmpDir)!;
			expect(savedState.currentMilestoneId).toBeUndefined();
			expect(savedPlan.milestones[0]!.status).toBe("pending");
		});
	});

	describe("no plan for plan-required actions", () => {
		it("returns error when no plan exists for start_milestone", async () => {
			const state = makeExecutingState();
			const result = await callTool(tmpDir, { action: "start_milestone", targetId: "milestone-1" }, state, null);

			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("no plan");
		});

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
			const plan = makePlan({
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
			const plan = makePlan({
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
			const plan = makePlan();
			const fn = () => callTool(tmpDir, { action: "start_milestone", targetId: "ghost" }, state, plan);
			const result = await fn();
			expect(result.content[0].text).toContain("Error");
		});

		it("returns error in content for invalid precondition (not throws)", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			const fn = () => callTool(tmpDir, { action: "complete_milestone", targetId: "milestone-1" }, state, plan);
			const result = await fn();
			expect(result.content[0].text).toContain("Error");
		});
	});
});
