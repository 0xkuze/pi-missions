import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadState, savePlan, saveState } from "../../extensions/state/manager.js";
import { transitionState } from "../../extensions/state/transitions.js";
import { registerCompleteMissionTool } from "../../extensions/tools/complete.js";
import type { Feature, Milestone, MissionPlan, MissionState } from "../../extensions/types.js";
import { nowISO } from "../../extensions/utils.js";

function makeExecutingState(overrides: Partial<MissionState> = {}): MissionState {
	return {
		missionId: "test-mission",
		status: "executing",
		progressLog: [],
		startedAt: new Date(Date.now() - 60_000).toISOString(),
		totalFeaturesCompleted: 0,
		totalFeaturesFailed: 0,
		totalFeaturesSkipped: 0,
		totalFixFeaturesCreated: 0,
		...overrides,
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
		status: "done",
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
		status: "done",
		...overrides,
	};
}

function makePlan(overrides: Partial<MissionPlan> = {}): MissionPlan {
	return {
		id: "plan-1",
		description: "Build a test system",
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
	params: { summary: string; remainingNotes?: string[] },
	state: MissionState,
	plan: MissionPlan | null,
	updateWidget?: (state: MissionState, plan?: MissionPlan) => void,
): Promise<ToolResult> {
	const { pi, getLastRegisteredTool } = makeMockPi();
	saveState(basePath, state);
	if (plan) savePlan(basePath, plan);
	registerCompleteMissionTool(pi, { basePath, updateWidget: updateWidget ?? (() => {}) });
	const tool = getLastRegisteredTool()!;
	return tool.execute("tool-call-id", params, undefined, undefined, undefined) as Promise<ToolResult>;
}

describe("registerCompleteMissionTool", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "complete-mission-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("VAL-TOOL-018: precondition validation", () => {
		it("returns error when summary is empty string", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			const result = await callTool(tmpDir, { summary: "" }, state, plan);
			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("summary");
		});

		it("returns error when summary is whitespace-only", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			const result = await callTool(tmpDir, { summary: "   " }, state, plan);
			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("summary");
		});

		it("returns error when no state exists", async () => {
			const { pi, getLastRegisteredTool } = makeMockPi();
			registerCompleteMissionTool(pi, { basePath: tmpDir, updateWidget: () => {} });
			const tool = getLastRegisteredTool()!;
			const result = await tool.execute("id", { summary: "all done" }, undefined, undefined, undefined);
			expect((result as ToolResult).content[0].text).toContain("Error");
			expect((result as ToolResult).content[0].text).toContain("no active mission");
		});

		it("returns error when state is planning", async () => {
			const state = makeExecutingState({ status: "planning" });
			const plan = makePlan();
			const result = await callTool(tmpDir, { summary: "all done" }, state, plan);
			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("executing");
		});

		it("returns error when state is draft_review", async () => {
			const state = makeExecutingState({ status: "draft_review" });
			const plan = makePlan();
			const result = await callTool(tmpDir, { summary: "all done" }, state, plan);
			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("executing");
		});

		it("returns error when state is approved", async () => {
			const state = makeExecutingState({ status: "approved" });
			const plan = makePlan();
			const result = await callTool(tmpDir, { summary: "all done" }, state, plan);
			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("executing");
		});

		it("returns error when state is validating", async () => {
			const state = makeExecutingState({ status: "validating" });
			const plan = makePlan();
			const result = await callTool(tmpDir, { summary: "all done" }, state, plan);
			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("executing");
		});

		it("returns error when state is paused", async () => {
			const executing = makeExecutingState();
			const paused = transitionState(executing, "paused");
			const plan = makePlan();
			const result = await callTool(tmpDir, { summary: "all done" }, paused, plan);
			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("executing");
		});

		it("returns error when state is failed", async () => {
			const state = makeExecutingState({ status: "failed" });
			const plan = makePlan();
			const result = await callTool(tmpDir, { summary: "all done" }, state, plan);
			expect(result.content[0].text).toContain("Error");
		});
	});

	describe("VAL-TOOL-018: idempotent when already completed", () => {
		it("returns message (not error) when already completed", async () => {
			const executing = makeExecutingState();
			const completed = transitionState(executing, "completed");
			const plan = makePlan();
			const result = await callTool(tmpDir, { summary: "all done" }, completed, plan);
			expect(result.content[0].text).not.toContain("Error");
			expect(result.content[0].text).toContain("already completed");
		});

		it("does not modify state when already completed", async () => {
			const executing = makeExecutingState();
			const completed = transitionState(executing, "completed");
			const plan = makePlan();
			await callTool(tmpDir, { summary: "all done" }, completed, plan);

			const savedState = loadState(tmpDir)!;
			expect(savedState.status).toBe("completed");
			expect(savedState.progressLog).toHaveLength(completed.progressLog.length);
		});
	});

	describe("VAL-TOOL-017: successful completion", () => {
		it("transitions state to completed", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			await callTool(tmpDir, { summary: "all features done" }, state, plan);

			const savedState = loadState(tmpDir)!;
			expect(savedState.status).toBe("completed");
		});

		it("sets completedAt on the state", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			await callTool(tmpDir, { summary: "all features done" }, state, plan);

			const savedState = loadState(tmpDir)!;
			expect(savedState.completedAt).toBeTruthy();
		});

		it("appends mission_complete progress event", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			await callTool(tmpDir, { summary: "all features done" }, state, plan);

			const savedState = loadState(tmpDir)!;
			const events = savedState.progressLog.filter((e) => e.type === "mission_complete");
			expect(events).toHaveLength(1);
		});

		it("generates report.md at basePath/report.md", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			await callTool(tmpDir, { summary: "all features done" }, state, plan);

			const reportPath = join(tmpDir, "report.md");
			expect(existsSync(reportPath)).toBe(true);
		});

		it("report.md contains mission goal", async () => {
			const state = makeExecutingState();
			const plan = makePlan({ description: "Build an amazing system" });
			await callTool(tmpDir, { summary: "all features done" }, state, plan);

			const reportContent = readFileSync(join(tmpDir, "report.md"), "utf8");
			expect(reportContent).toContain("Build an amazing system");
		});

		it("report.md contains duration", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			await callTool(tmpDir, { summary: "all features done" }, state, plan);

			const reportContent = readFileSync(join(tmpDir, "report.md"), "utf8");
			expect(reportContent).toContain("Duration");
		});

		it("report.md contains feature counts", async () => {
			const state = makeExecutingState({ totalFeaturesCompleted: 3, totalFeaturesSkipped: 1 });
			const plan = makePlan();
			await callTool(tmpDir, { summary: "all features done" }, state, plan);

			const reportContent = readFileSync(join(tmpDir, "report.md"), "utf8");
			expect(reportContent).toContain("3");
		});

		it("report.md contains milestone information", async () => {
			const state = makeExecutingState();
			const plan = makePlan({ milestones: [makeMilestone({ name: "Foundation" })] });
			await callTool(tmpDir, { summary: "all features done" }, state, plan);

			const reportContent = readFileSync(join(tmpDir, "report.md"), "utf8");
			expect(reportContent).toContain("Foundation");
		});

		it("report.md contains the provided summary", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			await callTool(tmpDir, { summary: "Implemented all the requirements successfully" }, state, plan);

			const reportContent = readFileSync(join(tmpDir, "report.md"), "utf8");
			expect(reportContent).toContain("Implemented all the requirements successfully");
		});

		it("report.md contains remaining notes when provided", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			await callTool(
				tmpDir,
				{ summary: "done", remainingNotes: ["Follow up on auth", "Consider caching"] },
				state,
				plan,
			);

			const reportContent = readFileSync(join(tmpDir, "report.md"), "utf8");
			expect(reportContent).toContain("Follow up on auth");
			expect(reportContent).toContain("Consider caching");
		});

		it("calls updateWidget with completed state", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			const updateWidget = mock((_s: MissionState, _p?: MissionPlan) => {});
			await callTool(tmpDir, { summary: "done" }, state, plan, updateWidget);

			expect(updateWidget).toHaveBeenCalledTimes(1);
			const calledState = updateWidget.mock.calls[0]![0] as MissionState;
			expect(calledState.status).toBe("completed");
		});

		it("returns success message in result", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			const result = await callTool(tmpDir, { summary: "done" }, state, plan);
			expect(result.content[0].text).toContain("completed");
		});

		it("persists state.json after completion", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			await callTool(tmpDir, { summary: "done" }, state, plan);

			const savedState = loadState(tmpDir);
			expect(savedState).not.toBeNull();
			expect(savedState!.status).toBe("completed");
		});
	});

	describe("VAL-TOOL-017: report generation without plan", () => {
		it("does not generate report.md when no plan exists", async () => {
			const state = makeExecutingState();
			await callTool(tmpDir, { summary: "done" }, state, null);

			const reportPath = join(tmpDir, "report.md");
			expect(existsSync(reportPath)).toBe(false);
		});

		it("still transitions state to completed when no plan exists", async () => {
			const state = makeExecutingState();
			await callTool(tmpDir, { summary: "done" }, state, null);

			const savedState = loadState(tmpDir)!;
			expect(savedState.status).toBe("completed");
		});
	});

	describe("VAL-TOOL-022: warns about pending/active features", () => {
		it("includes warning when features are still pending", async () => {
			const state = makeExecutingState();
			const plan = makePlan({
				milestones: [makeMilestone({ features: [makeFeature({ status: "pending" })] })],
			});
			const result = await callTool(tmpDir, { summary: "done" }, state, plan);
			expect(result.content[0].text).toContain("Warning");
			expect(result.content[0].text).toContain("pending");
		});

		it("includes warning when features are active", async () => {
			const state = makeExecutingState();
			const plan = makePlan({
				milestones: [makeMilestone({ features: [makeFeature({ status: "active" })] })],
			});
			const result = await callTool(tmpDir, { summary: "done" }, state, plan);
			expect(result.content[0].text).toContain("Warning");
		});

		it("proceeds with completion despite pending features (warning only)", async () => {
			const state = makeExecutingState();
			const plan = makePlan({
				milestones: [makeMilestone({ features: [makeFeature({ status: "pending" })] })],
			});
			await callTool(tmpDir, { summary: "done" }, state, plan);

			const savedState = loadState(tmpDir)!;
			expect(savedState.status).toBe("completed");
		});

		it("does not warn when only skipped features remain", async () => {
			const state = makeExecutingState();
			const plan = makePlan({
				milestones: [makeMilestone({ features: [makeFeature({ status: "skipped" })] })],
			});
			const result = await callTool(tmpDir, { summary: "done" }, state, plan);
			expect(result.content[0].text).not.toContain("Warning");
		});

		it("does not warn when only done features remain", async () => {
			const state = makeExecutingState();
			const plan = makePlan({
				milestones: [makeMilestone({ features: [makeFeature({ status: "done" })] })],
			});
			const result = await callTool(tmpDir, { summary: "done" }, state, plan);
			expect(result.content[0].text).not.toContain("Warning");
		});

		it("counts multiple pending features in warning", async () => {
			const state = makeExecutingState();
			const plan = makePlan({
				milestones: [
					makeMilestone({
						features: [
							makeFeature({ id: "f1", status: "pending" }),
							makeFeature({ id: "f2", status: "active" }),
							makeFeature({ id: "f3", status: "done" }),
						],
					}),
				],
			});
			const result = await callTool(tmpDir, { summary: "done" }, state, plan);
			expect(result.content[0].text).toContain("2");
		});
	});

	describe("VAL-CROSS-017: tool errors return structured content, never throw", () => {
		it("returns error content for empty summary (not throws)", async () => {
			const state = makeExecutingState();
			const plan = makePlan();
			const fn = () => callTool(tmpDir, { summary: "" }, state, plan);
			const result = await fn();
			expect(result.content[0].text).toContain("Error");
		});

		it("returns error content for wrong state (not throws)", async () => {
			const state = makeExecutingState({ status: "planning" });
			const plan = makePlan();
			const fn = () => callTool(tmpDir, { summary: "done" }, state, plan);
			const result = await fn();
			expect(result.content[0].text).toContain("Error");
		});
	});
});
