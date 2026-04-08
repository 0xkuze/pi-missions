import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPlan, loadState, savePlan, saveState } from "../../extensions/state/manager.js";
import { readHistory } from "../../extensions/state/plan-history.js";
import { addFixFeatureToPlan, registerCreateFixTool } from "../../extensions/tools/create-fix.js";
import type { MissionPlan, MissionState } from "../../extensions/types.js";
import { nowISO } from "../../extensions/utils.js";
import {
	createMockContext,
	createMockPi,
	makeFeature,
	makeMilestone,
	makePlan,
	makeState,
	type ToolResult,
} from "../helpers/index.js";

const EXISTING_FEATURE = {
	id: "feature-1",
	name: "existing-feature",
	description: "An existing feature",
	acceptanceCriteria: ["Feature works"],
	relevantFiles: ["src/feature.ts"],
	status: "done" as const,
};

function localMakePlan(overrides: Partial<MissionPlan> = {}) {
	return makePlan({
		milestones: [
			makeMilestone({
				id: "milestone-1",
				name: "Foundation",
				description: "Core foundation",
				features: [makeFeature(EXISTING_FEATURE)],
				status: "active",
			}),
			makeMilestone({ id: "milestone-2", name: "Validation", description: "Validation milestone" }),
		],
		validationCommands: ["bun test"],
		...overrides,
	});
}

interface CallToolOptions {
	state?: MissionState;
	plan?: MissionPlan;
	updateWidget?: (state: MissionState, plan?: MissionPlan) => void;
	saveStateToo?: boolean;
}

async function callTool(
	basePath: string,
	params: {
		milestoneId: string;
		name: string;
		description: string;
		acceptanceCriteria: string[];
		relevantFiles: string[];
		sourceKind: string;
		sourceFeatureId?: string;
	},
	options: CallToolOptions = {},
): Promise<ToolResult> {
	const { state = makeState(), plan = localMakePlan(), updateWidget = () => {}, saveStateToo = true } = options;

	savePlan(basePath, plan);
	if (saveStateToo) {
		saveState(basePath, state);
	}

	// Also write plan-history.jsonl with initial entry to allow appending
	// (plan history requires planVersion to be monotonically increasing)
	// We write the plan-created entry first so plan version 1 is recorded
	const { appendMutation } = await import("../../extensions/state/plan-history.js");
	const historyPath = join(basePath, "plan-history.jsonl");
	const { existsSync } = await import("node:fs");
	if (!existsSync(historyPath)) {
		appendMutation(basePath, {
			planVersion: 1,
			timestamp: nowISO(),
			actor: "orchestrator",
			kind: "plan-created",
			summary: "Plan created",
			payload: {},
		});
	}

	const { pi, getRegisteredTool } = createMockPi();
	registerCreateFixTool(pi, { basePath, updateWidget });
	const tool = getRegisteredTool("create_fix_feature")!;
	return tool.execute("tool-call-id", params, undefined, undefined, undefined as never) as Promise<ToolResult>;
}

describe("registerCreateFixTool", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "create-fix-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("VAL-TOOL-013: create_fix_feature adds validated feature with fixOrigin", () => {
		it("creates fix feature with pending status in the correct milestone", async () => {
			const result = await callTool(tmpDir, {
				milestoneId: "milestone-1",
				name: "fix-auth-bug",
				description: "Fix the auth bug",
				acceptanceCriteria: ["Auth works correctly"],
				relevantFiles: ["src/auth.ts"],
				sourceKind: "worker-failure",
				sourceFeatureId: "feature-1",
			});

			expect(result.content[0]!.text).toContain("Fix feature created successfully");

			const plan = loadPlan(tmpDir)!;
			const milestone = plan.milestones.find((m) => m.id === "milestone-1")!;
			const fixFeature = milestone.features.find((f) => f.name === "fix-auth-bug")!;
			expect(fixFeature).toBeDefined();
			expect(fixFeature.status).toBe("pending");
		});

		it("sets fixOrigin with sourceKind, sourceFeatureId, sourceMilestoneId", async () => {
			await callTool(tmpDir, {
				milestoneId: "milestone-1",
				name: "fix-auth-bug",
				description: "Fix the auth bug",
				acceptanceCriteria: ["Auth works"],
				relevantFiles: ["src/auth.ts"],
				sourceKind: "worker-failure",
				sourceFeatureId: "feature-1",
			});

			const plan = loadPlan(tmpDir)!;
			const milestone = plan.milestones.find((m) => m.id === "milestone-1")!;
			const fixFeature = milestone.features.find((f) => f.name === "fix-auth-bug")!;
			expect(fixFeature.fixOrigin).toBeDefined();
			expect(fixFeature.fixOrigin!.sourceKind).toBe("worker-failure");
			expect(fixFeature.fixOrigin!.sourceFeatureId).toBe("feature-1");
			expect(fixFeature.fixOrigin!.sourceMilestoneId).toBe("milestone-1");
		});

		it("sets fixOrigin.sourceMilestoneId to the target milestone id", async () => {
			await callTool(tmpDir, {
				milestoneId: "milestone-2",
				name: "fix-validation",
				description: "Fix validation failure",
				acceptanceCriteria: ["Validation passes"],
				relevantFiles: [],
				sourceKind: "validation-failure",
			});

			const plan = loadPlan(tmpDir)!;
			const milestone = plan.milestones.find((m) => m.id === "milestone-2")!;
			const fixFeature = milestone.features.find((f) => f.name === "fix-validation")!;
			expect(fixFeature.fixOrigin!.sourceMilestoneId).toBe("milestone-2");
		});

		it("generates a unique ID for the new feature", async () => {
			await callTool(tmpDir, {
				milestoneId: "milestone-1",
				name: "fix-auth-bug",
				description: "Fix the auth bug",
				acceptanceCriteria: ["Auth works"],
				relevantFiles: [],
				sourceKind: "worker-failure",
			});

			const plan = loadPlan(tmpDir)!;
			const milestone = plan.milestones.find((m) => m.id === "milestone-1")!;
			const fixFeature = milestone.features.find((f) => f.name === "fix-auth-bug")!;
			expect(fixFeature.id).toBeDefined();
			expect(fixFeature.id).not.toBe("feature-1");
			expect(typeof fixFeature.id).toBe("string");
			expect(fixFeature.id.length).toBeGreaterThan(0);
		});

		it("appends add-fix-feature mutation to plan history", async () => {
			await callTool(tmpDir, {
				milestoneId: "milestone-1",
				name: "fix-auth-bug",
				description: "Fix the auth bug",
				acceptanceCriteria: ["Auth works"],
				relevantFiles: [],
				sourceKind: "worker-failure",
			});

			const history = readHistory(tmpDir);
			const mutation = history.find((m) => m.kind === "add-fix-feature");
			expect(mutation).toBeDefined();
			expect(mutation!.kind).toBe("add-fix-feature");
			expect(mutation!.actor).toBe("orchestrator");
		});

		it("increments planVersion in plan.json", async () => {
			const originalPlan = localMakePlan();
			await callTool(tmpDir, {
				milestoneId: "milestone-1",
				name: "fix-auth-bug",
				description: "Fix the auth bug",
				acceptanceCriteria: ["Auth works"],
				relevantFiles: [],
				sourceKind: "worker-failure",
			});

			const updatedPlan = loadPlan(tmpDir)!;
			expect(updatedPlan.planVersion).toBe(originalPlan.planVersion + 1);
		});

		it("increments totalFixFeaturesCreated in state.json", async () => {
			const { loadState } = await import("../../extensions/state/manager.js");
			await callTool(tmpDir, {
				milestoneId: "milestone-1",
				name: "fix-auth-bug",
				description: "Fix",
				acceptanceCriteria: ["Works"],
				relevantFiles: [],
				sourceKind: "worker-failure",
			});

			const state = loadState(tmpDir)!;
			expect(state.totalFixFeaturesCreated).toBe(1);
		});

		it("appends fix_feature_created progress event to state", async () => {
			const { loadState } = await import("../../extensions/state/manager.js");
			await callTool(tmpDir, {
				milestoneId: "milestone-1",
				name: "fix-auth-bug",
				description: "Fix",
				acceptanceCriteria: ["Works"],
				relevantFiles: [],
				sourceKind: "worker-failure",
			});

			const state = loadState(tmpDir)!;
			const events = state.progressLog.filter((e) => e.type === "fix_feature_created");
			expect(events).toHaveLength(1);
			expect(events[0]!.detail).toContain("fix-auth-bug");
		});

		it("returns the complete feature definition in the result text", async () => {
			const result = await callTool(tmpDir, {
				milestoneId: "milestone-1",
				name: "fix-auth-bug",
				description: "Fix the auth bug",
				acceptanceCriteria: ["Auth works"],
				relevantFiles: ["src/auth.ts"],
				sourceKind: "worker-failure",
			});

			const plan = loadPlan(tmpDir)!;
			const milestone = plan.milestones.find((m) => m.id === "milestone-1")!;
			const fixFeature = milestone.features.find((f) => f.name === "fix-auth-bug")!;
			expect(result.content[0]!.text).toContain(fixFeature.id);
			expect(result.content[0]!.text).toContain("fix-auth-bug");
			expect(fixFeature.status).toBe("pending");
			expect(fixFeature.fixOrigin).toBeDefined();
		});

		it("calls updateWidget with updated state and plan", async () => {
			const updateWidget = mock(() => {});
			await callTool(
				tmpDir,
				{
					milestoneId: "milestone-1",
					name: "fix",
					description: "Fix",
					acceptanceCriteria: ["Works"],
					relevantFiles: [],
					sourceKind: "worker-failure",
				},
				{ updateWidget },
			);
			expect(updateWidget).toHaveBeenCalledTimes(1);
		});

		it("mutation planVersion matches the new plan.planVersion", async () => {
			await callTool(tmpDir, {
				milestoneId: "milestone-1",
				name: "fix-auth-bug",
				description: "Fix",
				acceptanceCriteria: ["Works"],
				relevantFiles: [],
				sourceKind: "worker-failure",
			});

			const plan = loadPlan(tmpDir)!;
			const history = readHistory(tmpDir);
			const mutation = history.find((m) => m.kind === "add-fix-feature")!;
			expect(mutation.planVersion).toBe(plan.planVersion);
		});
	});

	describe("VAL-TOOL-014: create_fix_feature validates inputs", () => {
		it("returns error for unknown milestoneId", async () => {
			const result = await callTool(tmpDir, {
				milestoneId: "nonexistent-milestone",
				name: "fix",
				description: "Fix",
				acceptanceCriteria: ["Works"],
				relevantFiles: [],
				sourceKind: "worker-failure",
			});

			expect(result.content[0]!.text).toContain("Error");
			expect(result.content[0]!.text).toContain("nonexistent-milestone");
		});

		it("does not modify plan on unknown milestoneId", async () => {
			const planBefore = localMakePlan();
			await callTool(tmpDir, {
				milestoneId: "nonexistent-milestone",
				name: "fix",
				description: "Fix",
				acceptanceCriteria: ["Works"],
				relevantFiles: [],
				sourceKind: "worker-failure",
			});

			const planAfter = loadPlan(tmpDir)!;
			expect(planAfter.planVersion).toBe(planBefore.planVersion);
		});

		it("returns error for empty name", async () => {
			const result = await callTool(tmpDir, {
				milestoneId: "milestone-1",
				name: "",
				description: "Fix",
				acceptanceCriteria: ["Works"],
				relevantFiles: [],
				sourceKind: "worker-failure",
			});

			expect(result.content[0]!.text).toContain("Error");
			expect(result.content[0]!.text.toLowerCase()).toContain("name");
		});

		it("returns error for whitespace-only name", async () => {
			const result = await callTool(tmpDir, {
				milestoneId: "milestone-1",
				name: "   ",
				description: "Fix",
				acceptanceCriteria: ["Works"],
				relevantFiles: [],
				sourceKind: "worker-failure",
			});

			expect(result.content[0]!.text).toContain("Error");
		});

		it("returns error for empty acceptanceCriteria array", async () => {
			const result = await callTool(tmpDir, {
				milestoneId: "milestone-1",
				name: "fix",
				description: "Fix",
				acceptanceCriteria: [],
				relevantFiles: [],
				sourceKind: "worker-failure",
			});

			expect(result.content[0]!.text).toContain("Error");
			expect(result.content[0]!.text.toLowerCase()).toContain("acceptance");
		});

		it("returns error when sourceFeatureId references nonexistent feature", async () => {
			const result = await callTool(tmpDir, {
				milestoneId: "milestone-1",
				name: "fix",
				description: "Fix",
				acceptanceCriteria: ["Works"],
				relevantFiles: [],
				sourceKind: "worker-failure",
				sourceFeatureId: "nonexistent-feature",
			});

			expect(result.content[0]!.text).toContain("Error");
			expect(result.content[0]!.text).toContain("nonexistent-feature");
		});

		it("succeeds when sourceFeatureId references an existing feature", async () => {
			const result = await callTool(tmpDir, {
				milestoneId: "milestone-1",
				name: "fix",
				description: "Fix",
				acceptanceCriteria: ["Works"],
				relevantFiles: [],
				sourceKind: "worker-failure",
				sourceFeatureId: "feature-1",
			});

			expect(result.content[0]!.text).toContain("Fix feature created successfully");
		});

		it("does not return error when sourceFeatureId is omitted", async () => {
			const result = await callTool(tmpDir, {
				milestoneId: "milestone-1",
				name: "fix",
				description: "Fix",
				acceptanceCriteria: ["Works"],
				relevantFiles: [],
				sourceKind: "validation-failure",
			});

			expect(result.content[0]!.text).toContain("Fix feature created successfully");
		});

		it("returns error when no plan exists", async () => {
			const emptyDir = mkdtempSync(join(tmpdir(), "no-plan-"));
			try {
				const { pi, getRegisteredTool } = createMockPi();
				registerCreateFixTool(pi, { basePath: emptyDir, updateWidget: () => {} });
				const tool = getRegisteredTool("create_fix_feature")!;
				const result = (await tool.execute(
					"tool-call-id",
					{
						milestoneId: "milestone-1",
						name: "fix",
						description: "Fix",
						acceptanceCriteria: ["Works"],
						relevantFiles: [],
						sourceKind: "worker-failure",
					},
					undefined,
					undefined,
					createMockContext(),
				)) as ToolResult;
				expect(result.content[0]!.text).toContain("Error");
			} finally {
				rmSync(emptyDir, { recursive: true, force: true });
			}
		});
	});

	describe("adds feature to correct milestone", () => {
		it("adds to milestone-1 when milestoneId is milestone-1", async () => {
			await callTool(tmpDir, {
				milestoneId: "milestone-1",
				name: "fix-for-milestone-1",
				description: "Fix",
				acceptanceCriteria: ["Works"],
				relevantFiles: [],
				sourceKind: "worker-failure",
			});

			const plan = loadPlan(tmpDir)!;
			const m1 = plan.milestones.find((m) => m.id === "milestone-1")!;
			const m2 = plan.milestones.find((m) => m.id === "milestone-2")!;
			expect(m1.features.some((f) => f.name === "fix-for-milestone-1")).toBe(true);
			expect(m2.features.some((f) => f.name === "fix-for-milestone-1")).toBe(false);
		});

		it("adds to milestone-2 when milestoneId is milestone-2", async () => {
			await callTool(tmpDir, {
				milestoneId: "milestone-2",
				name: "fix-for-milestone-2",
				description: "Fix",
				acceptanceCriteria: ["Works"],
				relevantFiles: [],
				sourceKind: "validation-failure",
			});

			const plan = loadPlan(tmpDir)!;
			const m1 = plan.milestones.find((m) => m.id === "milestone-1")!;
			const m2 = plan.milestones.find((m) => m.id === "milestone-2")!;
			expect(m2.features.some((f) => f.name === "fix-for-milestone-2")).toBe(true);
			expect(m1.features.some((f) => f.name === "fix-for-milestone-2")).toBe(false);
		});

		it("does not alter other milestones features", async () => {
			const originalPlan = localMakePlan();
			const m1FeatureCount = originalPlan.milestones.find((m) => m.id === "milestone-1")!.features.length;

			await callTool(tmpDir, {
				milestoneId: "milestone-2",
				name: "fix-val",
				description: "Fix",
				acceptanceCriteria: ["Works"],
				relevantFiles: [],
				sourceKind: "validation-failure",
			});

			const plan = loadPlan(tmpDir)!;
			const m1 = plan.milestones.find((m) => m.id === "milestone-1")!;
			expect(m1.features.length).toBe(m1FeatureCount);
		});
	});

	describe("VAL-STATE-006: totalFixFeaturesCreated increments correctly", () => {
		it("starts at 0 and increments to 1 after one fix feature", async () => {
			const { loadState } = await import("../../extensions/state/manager.js");
			await callTool(tmpDir, {
				milestoneId: "milestone-1",
				name: "fix",
				description: "Fix",
				acceptanceCriteria: ["Works"],
				relevantFiles: [],
				sourceKind: "worker-failure",
			});

			const state = loadState(tmpDir)!;
			expect(state.totalFixFeaturesCreated).toBe(1);
		});
	});

	describe("validation-failure sourceKind", () => {
		it("creates feature with validation-failure sourceKind", async () => {
			await callTool(tmpDir, {
				milestoneId: "milestone-1",
				name: "fix-validation",
				description: "Fix failing validation",
				acceptanceCriteria: ["All tests pass"],
				relevantFiles: ["src/test.ts"],
				sourceKind: "validation-failure",
			});

			const plan = loadPlan(tmpDir)!;
			const milestone = plan.milestones.find((m) => m.id === "milestone-1")!;
			const fixFeature = milestone.features.find((f) => f.name === "fix-validation")!;
			expect(fixFeature.fixOrigin!.sourceKind).toBe("validation-failure");
		});
	});

	describe("result text includes feature ID, name, milestone, and planVersion", () => {
		it("result text includes the generated feature ID", async () => {
			const result = await callTool(tmpDir, {
				milestoneId: "milestone-1",
				name: "fix-auth",
				description: "Fix",
				acceptanceCriteria: ["Works"],
				relevantFiles: [],
				sourceKind: "worker-failure",
			});

			const plan = loadPlan(tmpDir)!;
			const milestone = plan.milestones.find((m) => m.id === "milestone-1")!;
			const fixFeature = milestone.features.find((f) => f.name === "fix-auth")!;
			expect(result.content[0]!.text).toContain(fixFeature.id);
		});

		it("result text includes the new planVersion", async () => {
			const result = await callTool(tmpDir, {
				milestoneId: "milestone-1",
				name: "fix-auth",
				description: "Fix",
				acceptanceCriteria: ["Works"],
				relevantFiles: [],
				sourceKind: "worker-failure",
			});

			expect(result.content[0]!.text).toContain("planVersion: 2");
		});
	});
});

describe("addFixFeatureToPlan", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "add-fix-helper-"));
		writeFileSync(join(tmpDir, "AGENTS.md"), "# Test", "utf8");
	});

	afterEach(() => {
		try {
			rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	});

	it("creates fix feature with correct fixOrigin fields", () => {
		const feature = makeFeature({ id: "src-feat", status: "done" });
		const plan = localMakePlan({
			milestones: [
				makeMilestone({
					id: "ms-1",
					name: "Core",
					description: "Core milestone",
					features: [feature],
					status: "active",
				}),
			],
		});
		const state = makeState();

		const result = addFixFeatureToPlan(tmpDir, plan, state, {
			milestoneId: "ms-1",
			name: "fix-src-feat",
			description: "Fix something",
			acceptanceCriteria: ["Fixed"],
			relevantFiles: ["src/a.ts"],
			sourceKind: "worker-failure",
			sourceFeatureId: "src-feat",
		});

		expect(result.featureId).toBeTruthy();
		expect(result.updatedPlan.planVersion).toBe(2);
		const ms = result.updatedPlan.milestones[0];
		expect(ms.features.length).toBe(2);
		const fixFeature = ms.features[1];
		expect(fixFeature!.name).toBe("fix-src-feat");
		expect(fixFeature!.fixOrigin!.sourceKind).toBe("worker-failure");
		expect(fixFeature!.fixOrigin!.sourceFeatureId).toBe("src-feat");
		expect(fixFeature!.fixOrigin!.sourceMilestoneId).toBe("ms-1");
	});

	it("increments totalFixFeaturesCreated in returned state", () => {
		const feature = makeFeature({ id: "src-feat", status: "done" });
		const plan = localMakePlan({
			milestones: [
				makeMilestone({
					id: "ms-1",
					features: [feature],
					status: "active",
				}),
			],
		});
		const state = makeState({ totalFixFeaturesCreated: 2 });

		const result = addFixFeatureToPlan(tmpDir, plan, state, {
			milestoneId: "ms-1",
			name: "fix-test",
			description: "Fix",
			acceptanceCriteria: ["Works"],
			relevantFiles: [],
			sourceKind: "validation-failure",
		});

		expect(result.updatedState.totalFixFeaturesCreated).toBe(3);
	});

	it("appends progress log entry", () => {
		const feature = makeFeature({ id: "src-feat", status: "done" });
		const plan = localMakePlan({
			milestones: [
				makeMilestone({
					id: "ms-1",
					features: [feature],
					status: "active",
				}),
			],
		});
		const state = makeState();

		const result = addFixFeatureToPlan(tmpDir, plan, state, {
			milestoneId: "ms-1",
			name: "fix-test",
			description: "Fix",
			acceptanceCriteria: ["Works"],
			relevantFiles: [],
			sourceKind: "worker-failure",
		});

		const log = result.updatedState.progressLog;
		const fixEvent = log.find((e) => e.type === "fix_feature_created");
		expect(fixEvent).toBeDefined();
		expect(fixEvent!.detail).toContain("fix-test");
	});

	it("appends plan history mutation", async () => {
		const feature = makeFeature({ id: "src-feat", status: "done" });
		const plan = localMakePlan({
			milestones: [
				makeMilestone({
					id: "ms-1",
					features: [feature],
					status: "active",
				}),
			],
		});
		const state = makeState();

		const { appendMutation } = await import("../../extensions/state/plan-history.js");
		if (!existsSync(join(tmpDir, "plan-history.jsonl"))) {
			appendMutation(tmpDir, {
				planVersion: 1,
				timestamp: nowISO(),
				actor: "orchestrator",
				kind: "plan-created",
				summary: "Plan created",
				payload: {},
			});
		}

		addFixFeatureToPlan(tmpDir, plan, state, {
			milestoneId: "ms-1",
			name: "fix-test",
			description: "Fix",
			acceptanceCriteria: ["Works"],
			relevantFiles: [],
			sourceKind: "worker-failure",
		});

		const history = readHistory(tmpDir);
		const fixMutation = history.find((m) => m.kind === "add-fix-feature");
		expect(fixMutation).toBeDefined();
		expect(fixMutation!.summary).toContain("fix-test");
	});

	it("does not modify original plan or state objects", () => {
		const feature = makeFeature({ id: "src-feat", status: "done" });
		const plan = localMakePlan({
			milestones: [
				makeMilestone({
					id: "ms-1",
					features: [feature],
					status: "active",
				}),
			],
		});
		const state = makeState();
		const originalPlanVersion = plan.planVersion;
		const originalFixCount = state.totalFixFeaturesCreated;

		addFixFeatureToPlan(tmpDir, plan, state, {
			milestoneId: "ms-1",
			name: "fix-test",
			description: "Fix",
			acceptanceCriteria: ["Works"],
			relevantFiles: [],
			sourceKind: "worker-failure",
		});

		expect(plan.planVersion).toBe(originalPlanVersion);
		expect(state.totalFixFeaturesCreated).toBe(originalFixCount);
	});
});
