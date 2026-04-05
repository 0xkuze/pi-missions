import { describe, expect, it, mock } from "bun:test";
import type { TUI } from "@mariozechner/pi-tui";
import type { MissionPlan, MissionState } from "../../extensions/types.js";
import {
	StatusOverlayComponent,
	handleStatusOverlayKey,
	renderStatusOverlay,
} from "../../extensions/ui/status-overlay.js";
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
			const lines = renderStatusOverlay(makeState(), null, 80, 40, 0);
			expect(lines).toBeArray();
			expect(lines.length).toBeGreaterThan(0);
		});

		it("shows heading", () => {
			const lines = renderStatusOverlay(makeState(), null, 80, 40, 0);
			const text = lines.join(" ");
			expect(text).toMatch(/Mission Status/i);
		});

		it("shows state", () => {
			const lines = renderStatusOverlay(makeState({ status: "planning" }), null, 80, 40, 0);
			const text = lines.join(" ");
			expect(text).toContain("planning");
		});

		it("shows duration", () => {
			const lines = renderStatusOverlay(makeState(), null, 80, 40, 0);
			const text = lines.join(" ");
			expect(text).toMatch(/Duration/i);
		});

		it("shows progress counts section", () => {
			const lines = renderStatusOverlay(makeState(), null, 80, 40, 0);
			const text = lines.join(" ");
			expect(text).toMatch(/Progress/i);
			expect(text).toMatch(/Completed/i);
			expect(text).toMatch(/Failed/i);
			expect(text).toMatch(/Skipped/i);
		});

		it("shows Esc keyboard hint", () => {
			const lines = renderStatusOverlay(makeState(), null, 80, 40, 0);
			const text = lines.join(" ");
			expect(text).toContain("Esc");
		});
	});

	describe("progress counts", () => {
		it("shows completed count", () => {
			const state = makeState({ totalFeaturesCompleted: 5 });
			const lines = renderStatusOverlay(state, null, 80, 40, 0);
			const text = lines.join(" ");
			expect(text).toContain("5");
		});

		it("shows failed count", () => {
			const state = makeState({ totalFeaturesFailed: 2 });
			const lines = renderStatusOverlay(state, null, 80, 40, 0);
			const text = lines.join(" ");
			expect(text).toContain("2");
		});

		it("shows skipped count", () => {
			const state = makeState({ totalFeaturesSkipped: 3 });
			const lines = renderStatusOverlay(state, null, 80, 40, 0);
			const text = lines.join(" ");
			expect(text).toContain("3");
		});

		it("shows fix tasks count", () => {
			const state = makeState({ totalFixFeaturesCreated: 1 });
			const lines = renderStatusOverlay(state, null, 80, 40, 0);
			const text = lines.join(" ");
			expect(text).toMatch(/Fix/i);
		});
	});

	describe("milestone and feature display", () => {
		it("shows current milestone when executing", () => {
			const state = makeState({ status: "executing", currentMilestoneId: "m1" });
			const plan = makePlan();
			const lines = renderStatusOverlay(state, plan, 80, 40, 0);
			const text = lines.join(" ");
			expect(text).toContain("Milestone 1");
		});

		it("shows current feature when executing", () => {
			const state = makeState({ status: "executing", currentMilestoneId: "m1", currentFeatureId: "f1" });
			const plan = makePlan();
			const lines = renderStatusOverlay(state, plan, 80, 40, 0);
			const text = lines.join(" ");
			expect(text).toContain("Feature 1");
		});

		it("omits milestone when not set", () => {
			const state = makeState({ status: "planning" });
			const lines = renderStatusOverlay(state, null, 80, 40, 0);
			const text = lines.join(" ");
			expect(text).not.toContain("Milestone:");
		});
	});

	describe("paused state", () => {
		it("shows pause info when paused with resume target", () => {
			const state = makeState({ status: "paused", resumeTargetState: "executing" });
			const lines = renderStatusOverlay(state, null, 80, 40, 0);
			const text = lines.join(" ");
			expect(text).toMatch(/Paused/i);
			expect(text).toContain("executing");
		});

		it("omits pause info when not paused", () => {
			const state = makeState({ status: "planning" });
			const lines = renderStatusOverlay(state, null, 80, 40, 0);
			const text = lines.join(" ");
			expect(text).not.toMatch(/will resume/i);
		});
	});

	describe("various states", () => {
		for (const status of ["planning", "draft_review", "executing", "validating", "completed", "failed"] as const) {
			it(`renders without error for status ${status}`, () => {
				const state = makeState({ status });
				const lines = renderStatusOverlay(state, null, 80, 40, 0);
				expect(lines).toBeArray();
				expect(lines.length).toBeGreaterThan(0);
			});
		}
	});
});

function makeMockTui(requestRender?: () => void): TUI {
	return { terminal: { rows: 40 }, requestRender: requestRender ?? (() => {}) } as any;
}

function makeStatusComponent(
	opts: { state?: MissionState; plan?: MissionPlan | null; theme?: any; requestRender?: () => void } = {},
): StatusOverlayComponent {
	const state = opts.state ?? makeState();
	const plan = opts.plan !== undefined ? opts.plan : makePlan();
	const tui = makeMockTui(opts.requestRender);
	return new StatusOverlayComponent(tui, () => {}, state, plan, opts.theme);
}

describe("StatusOverlayComponent (VAL-NEWUI-004)", () => {
	describe("focused property", () => {
		it("has focused property defaulting to false", () => {
			const comp = makeStatusComponent();
			expect(comp.focused).toBe(false);
		});

		it("can set focused to true", () => {
			const comp = makeStatusComponent();
			comp.focused = true;
			expect(comp.focused).toBe(true);
		});
	});

	describe("render caching", () => {
		it("returns same array ref for same width and version", () => {
			const comp = makeStatusComponent();
			const first = comp.render(80);
			const second = comp.render(80);
			expect(second).toBe(first);
		});

		it("returns different array ref for different width", () => {
			const comp = makeStatusComponent();
			const first = comp.render(80);
			const second = comp.render(100);
			expect(second).not.toBe(first);
		});

		it("returns different array ref after scroll changes version", () => {
			const comp = makeStatusComponent();
			const first = comp.render(80);
			comp.handleInput("\x1B[B");
			const second = comp.render(80);
			expect(second).not.toBe(first);
		});
	});

	describe("requestRender on scroll", () => {
		it("calls requestRender when scrolling", () => {
			const mockFn = mock(() => {});
			const comp = makeStatusComponent({ requestRender: mockFn });
			comp.handleInput("\x1B[B");
			expect(mockFn).toHaveBeenCalledTimes(1);
		});

		it("does not call requestRender for non-scroll keys", () => {
			const mockFn = mock(() => {});
			const comp = makeStatusComponent({ requestRender: mockFn });
			comp.handleInput("a");
			expect(mockFn).not.toHaveBeenCalled();
		});
	});

	describe("invalidate", () => {
		it("resets cache so next render returns new array ref", () => {
			const comp = makeStatusComponent();
			const first = comp.render(80);
			comp.invalidate();
			const second = comp.render(80);
			expect(second).not.toBe(first);
		});

		it("rebuilds style when theme was provided", () => {
			const theme = {
				fg: (t: string) => `\x1b[37m${t}\x1b[0m`,
				bg: (t: string) => `\x1b[40m${t}\x1b[0m`,
				bold: (t: string) => `\x1b[1m${t}\x1b[0m`,
			};
			const comp = makeStatusComponent({ theme });
			const before = comp.render(80);
			comp.invalidate();
			const after = comp.render(80);
			expect(after).not.toBe(before);
			expect(after.length).toBeGreaterThan(0);
		});

		it("does not throw when no theme was provided", () => {
			const comp = makeStatusComponent();
			expect(() => comp.invalidate()).not.toThrow();
		});
	});
});

describe("handleStatusOverlayKey (VAL-NEWUI-004)", () => {
	it("returns close for Esc key", () => {
		const action = handleStatusOverlayKey("\x1B");
		expect(action.kind).toBe("close");
	});

	it("returns scroll -1 for up arrow", () => {
		const action = handleStatusOverlayKey("\x1B[A");
		expect(action).toEqual({ kind: "scroll", delta: -1 });
	});

	it("returns scroll +1 for down arrow", () => {
		const action = handleStatusOverlayKey("\x1B[B");
		expect(action).toEqual({ kind: "scroll", delta: 1 });
	});

	it("returns scroll -10 for page up", () => {
		const action = handleStatusOverlayKey("\x1B[5~");
		expect(action).toEqual({ kind: "scroll", delta: -10 });
	});

	it("returns scroll +10 for page down", () => {
		const action = handleStatusOverlayKey("\x1B[6~");
		expect(action).toEqual({ kind: "scroll", delta: 10 });
	});

	it("returns noop for other keys", () => {
		for (const key of ["a", "b", "enter", " "]) {
			expect(handleStatusOverlayKey(key).kind).toBe("noop");
		}
	});
});
