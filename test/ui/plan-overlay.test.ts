import { describe, expect, it } from "bun:test";
import type { MissionPlan } from "../../extensions/types.js";
import { handlePlanOverlayKey, renderPlanOverlay } from "../../extensions/ui/plan-overlay.js";
import { nowISO } from "../../extensions/utils.js";

function makePlan(overrides: Partial<MissionPlan> = {}): MissionPlan {
	return {
		id: "plan-1",
		description: "Test mission",
		planVersion: 1,
		milestones: [
			{
				id: "m1",
				name: "Milestone 1",
				description: "First milestone",
				status: "active",
				features: [
					{
						id: "f1",
						name: "Feature 1",
						description: "First feature",
						acceptanceCriteria: [],
						relevantFiles: [],
						dependencies: [],
						estimatedComplexity: "low",
						status: "pending",
						attempts: [],
					},
					{
						id: "f2",
						name: "Feature 2",
						description: "Second feature",
						acceptanceCriteria: [],
						relevantFiles: [],
						dependencies: [],
						estimatedComplexity: "medium",
						status: "done",
						attempts: [],
					},
				],
			},
		],
		validationCommands: [],
		modelAssignment: {},
		createdAt: nowISO(),
		...overrides,
	};
}

describe("renderPlanOverlay (VAL-NEWUI-005)", () => {
	describe("basic rendering", () => {
		it("returns array of strings", () => {
			const lines = renderPlanOverlay(makePlan());
			expect(lines).toBeArray();
			expect(lines.length).toBeGreaterThan(0);
		});

		it("shows mission description in heading", () => {
			const lines = renderPlanOverlay(makePlan());
			const text = lines.join(" ");
			expect(text).toContain("Test mission");
		});

		it("shows milestone name", () => {
			const lines = renderPlanOverlay(makePlan());
			const text = lines.join(" ");
			expect(text).toContain("Milestone 1");
		});

		it("shows feature names", () => {
			const lines = renderPlanOverlay(makePlan());
			const text = lines.join(" ");
			expect(text).toContain("Feature 1");
			expect(text).toContain("Feature 2");
		});

		it("shows milestone status", () => {
			const lines = renderPlanOverlay(makePlan());
			const text = lines.join(" ");
			expect(text).toContain("active");
		});

		it("shows feature statuses", () => {
			const lines = renderPlanOverlay(makePlan());
			const text = lines.join(" ");
			expect(text).toContain("pending");
			expect(text).toContain("done");
		});

		it("shows Esc keyboard hint", () => {
			const lines = renderPlanOverlay(makePlan());
			const text = lines.join(" ");
			expect(text).toContain("Esc");
		});
	});

	describe("status icons", () => {
		it("renders done icon for done features", () => {
			const plan = makePlan();
			plan.milestones[0]!.features[1]!.status = "done";
			const lines = renderPlanOverlay(plan);
			const text = lines.join(" ");
			expect(text).toContain("\u2713");
		});

		it("renders failed icon for failed features", () => {
			const plan = makePlan();
			plan.milestones[0]!.features[0]!.status = "failed";
			const lines = renderPlanOverlay(plan);
			const text = lines.join(" ");
			expect(text).toContain("\u2717");
		});

		it("renders skipped icon for skipped features", () => {
			const plan = makePlan();
			plan.milestones[0]!.features[0]!.status = "skipped";
			const lines = renderPlanOverlay(plan);
			const text = lines.join(" ");
			expect(text).toContain("\u2013");
		});
	});

	describe("multiple milestones", () => {
		it("renders all milestones", () => {
			const plan = makePlan({
				milestones: [
					{
						id: "m1",
						name: "Alpha",
						description: "First",
						status: "done",
						features: [],
					},
					{
						id: "m2",
						name: "Beta",
						description: "Second",
						status: "pending",
						features: [],
					},
				],
			});
			const lines = renderPlanOverlay(plan);
			const text = lines.join(" ");
			expect(text).toContain("Alpha");
			expect(text).toContain("Beta");
		});
	});

	describe("fix features", () => {
		it("renders fix marker for features with fixOrigin", () => {
			const plan = makePlan();
			plan.milestones[0]!.features[0]!.fixOrigin = { sourceKind: "worker-failure" };
			const lines = renderPlanOverlay(plan);
			const text = lines.join(" ");
			expect(text).toContain("\u27a1");
		});
	});
});

describe("handlePlanOverlayKey (VAL-NEWUI-005)", () => {
	it("returns close for Esc key", () => {
		const action = handlePlanOverlayKey("\x1B");
		expect(action.kind).toBe("close");
	});

	it("returns noop for other keys", () => {
		for (const key of ["a", "b", "enter", " "]) {
			expect(handlePlanOverlayKey(key).kind).toBe("noop");
		}
	});
});
