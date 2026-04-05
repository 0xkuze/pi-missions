import { describe, expect, it } from "bun:test";
import type { MissionPlan, MissionState } from "../../extensions/types.js";
import { handleStatusOverlayKey, renderStatusOverlay } from "../../extensions/ui/status-overlay.js";
import { nowISO } from "../../extensions/utils.js";
import { makeFeature as _sf, makeMilestone as _sm, makePlan as _sp, makeState as _ss } from "../helpers/index.js";

function makeState(overrides: Partial<MissionState> = {}): MissionState {
	return _ss({ status: "planning", startedAt: new Date(Date.now() - 60_000).toISOString(), ...overrides });
}

function makePlan(overrides: Partial<MissionPlan> = {}): MissionPlan {
	return _sp({
		milestones: [
			_sm({
				id: "m1",
				name: "Milestone 1",
				features: [_sf({ id: "f1", name: "Feature 1", status: "active" })],
				status: "active",
			}),
		],
		...overrides,
	});
}

describe("renderStatusOverlay (VAL-NEWUI-004)", () => {
	describe("basic rendering", () => {
		it("returns array of strings", () => {
			const lines = renderStatusOverlay(makeState(), null);
			expect(lines).toBeArray();
			expect(lines.length).toBeGreaterThan(0);
		});

		it("shows heading", () => {
			const lines = renderStatusOverlay(makeState(), null);
			const text = lines.join(" ");
			expect(text).toMatch(/Mission Status/i);
		});

		it("shows state", () => {
			const lines = renderStatusOverlay(makeState({ status: "planning" }), null);
			const text = lines.join(" ");
			expect(text).toContain("planning");
		});

		it("shows duration", () => {
			const lines = renderStatusOverlay(makeState(), null);
			const text = lines.join(" ");
			expect(text).toMatch(/Duration/i);
		});

		it("shows progress counts section", () => {
			const lines = renderStatusOverlay(makeState(), null);
			const text = lines.join(" ");
			expect(text).toMatch(/Progress/i);
			expect(text).toMatch(/Completed/i);
			expect(text).toMatch(/Failed/i);
			expect(text).toMatch(/Skipped/i);
		});

		it("shows Esc keyboard hint", () => {
			const lines = renderStatusOverlay(makeState(), null);
			const text = lines.join(" ");
			expect(text).toContain("Esc");
		});
	});

	describe("progress counts", () => {
		it("shows completed count", () => {
			const state = makeState({ totalFeaturesCompleted: 5 });
			const lines = renderStatusOverlay(state, null);
			const text = lines.join(" ");
			expect(text).toContain("5");
		});

		it("shows failed count", () => {
			const state = makeState({ totalFeaturesFailed: 2 });
			const lines = renderStatusOverlay(state, null);
			const text = lines.join(" ");
			expect(text).toContain("2");
		});

		it("shows skipped count", () => {
			const state = makeState({ totalFeaturesSkipped: 3 });
			const lines = renderStatusOverlay(state, null);
			const text = lines.join(" ");
			expect(text).toContain("3");
		});

		it("shows fix tasks count", () => {
			const state = makeState({ totalFixFeaturesCreated: 1 });
			const lines = renderStatusOverlay(state, null);
			const text = lines.join(" ");
			expect(text).toMatch(/Fix/i);
		});
	});

	describe("milestone and feature display", () => {
		it("shows current milestone when executing", () => {
			const state = makeState({ status: "executing", currentMilestoneId: "m1" });
			const plan = makePlan();
			const lines = renderStatusOverlay(state, plan);
			const text = lines.join(" ");
			expect(text).toContain("Milestone 1");
		});

		it("shows current feature when executing", () => {
			const state = makeState({ status: "executing", currentMilestoneId: "m1", currentFeatureId: "f1" });
			const plan = makePlan();
			const lines = renderStatusOverlay(state, plan);
			const text = lines.join(" ");
			expect(text).toContain("Feature 1");
		});

		it("omits milestone when not set", () => {
			const state = makeState({ status: "planning" });
			const lines = renderStatusOverlay(state, null);
			const text = lines.join(" ");
			expect(text).not.toContain("Milestone:");
		});
	});

	describe("paused state", () => {
		it("shows pause info when paused with resume target", () => {
			const state = makeState({ status: "paused", resumeTargetState: "executing" });
			const lines = renderStatusOverlay(state, null);
			const text = lines.join(" ");
			expect(text).toMatch(/Paused/i);
			expect(text).toContain("executing");
		});

		it("omits pause info when not paused", () => {
			const state = makeState({ status: "planning" });
			const lines = renderStatusOverlay(state, null);
			const text = lines.join(" ");
			expect(text).not.toMatch(/will resume/i);
		});
	});

	describe("various states", () => {
		for (const status of ["planning", "draft_review", "executing", "validating", "completed", "failed"] as const) {
			it(`renders without error for status ${status}`, () => {
				const state = makeState({ status });
				const lines = renderStatusOverlay(state, null);
				expect(lines).toBeArray();
				expect(lines.length).toBeGreaterThan(0);
			});
		}
	});
});

describe("handleStatusOverlayKey (VAL-NEWUI-004)", () => {
	it("returns close for Esc key", () => {
		const action = handleStatusOverlayKey("\x1B");
		expect(action.kind).toBe("close");
	});

	it("returns noop for other keys", () => {
		for (const key of ["a", "b", "enter", " "]) {
			expect(handleStatusOverlayKey(key).kind).toBe("noop");
		}
	});
});
