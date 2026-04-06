import { describe, expect, it, mock } from "bun:test";
import type { TUI } from "@mariozechner/pi-tui";
import type { MissionPlan } from "../../extensions/types.js";
import { handlePlanOverlayKey, PlanOverlayComponent, renderPlanOverlay } from "../../extensions/ui/plan-overlay.js";
import { makeFeature as _sf, makeMilestone as _sm, makePlan as _sp } from "../helpers/index.js";

const DEFAULT_WIDTH = 80;
const DEFAULT_HEIGHT = 40;
const DEFAULT_SCROLL = 0;

function render(plan: MissionPlan): string[] {
	return renderPlanOverlay(plan, DEFAULT_WIDTH, DEFAULT_HEIGHT, DEFAULT_SCROLL);
}

function makePlan(overrides: Partial<MissionPlan> = {}): MissionPlan {
	return _sp({
		milestones: [
			_sm({
				id: "m1",
				name: "Milestone 1",
				features: [
					_sf({ id: "f1", name: "Feature 1" }),
					_sf({ id: "f2", name: "Feature 2", estimatedComplexity: "medium", status: "done" }),
				],
				status: "active",
			}),
		],
		...overrides,
	});
}

describe("renderPlanOverlay (VAL-NEWUI-005)", () => {
	describe("basic rendering", () => {
		it("returns array of strings", () => {
			const lines = render(makePlan());
			expect(lines).toBeArray();
			expect(lines.length).toBeGreaterThan(0);
		});

		it("shows mission description in heading", () => {
			const lines = render(makePlan());
			const text = lines.join(" ");
			expect(text).toContain("Test mission");
		});

		it("shows milestone name", () => {
			const lines = render(makePlan());
			const text = lines.join(" ");
			expect(text).toContain("Milestone 1");
		});

		it("shows feature names", () => {
			const lines = render(makePlan());
			const text = lines.join(" ");
			expect(text).toContain("Feature 1");
			expect(text).toContain("Feature 2");
		});

		it("shows milestone status", () => {
			const lines = render(makePlan());
			const text = lines.join(" ");
			expect(text).toContain("active");
		});

		it("shows feature statuses", () => {
			const lines = render(makePlan());
			const text = lines.join(" ");
			expect(text).toContain("pending");
			expect(text).toContain("done");
		});

		it("shows Esc keyboard hint", () => {
			const lines = render(makePlan());
			const text = lines.join(" ");
			expect(text).toContain("Esc");
		});
	});

	describe("status icons", () => {
		it("renders done icon for done features", () => {
			const plan = makePlan();
			plan.milestones[0]!.features[1]!.status = "done";
			const lines = render(plan);
			const text = lines.join(" ");
			expect(text).toContain("\u2713");
		});

		it("renders failed icon for failed features", () => {
			const plan = makePlan();
			plan.milestones[0]!.features[0]!.status = "failed";
			const lines = render(plan);
			const text = lines.join(" ");
			expect(text).toContain("\u2717");
		});

		it("renders skipped icon for skipped features", () => {
			const plan = makePlan();
			plan.milestones[0]!.features[0]!.status = "skipped";
			const lines = render(plan);
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
			const lines = render(plan);
			const text = lines.join(" ");
			expect(text).toContain("Alpha");
			expect(text).toContain("Beta");
		});
	});

	describe("fix features", () => {
		it("renders fix marker for features with fixOrigin", () => {
			const plan = makePlan();
			plan.milestones[0]!.features[0]!.fixOrigin = { sourceKind: "worker-failure" };
			const lines = render(plan);
			const text = lines.join(" ");
			expect(text).toContain("\u27a1");
		});
	});
});

function makeMockTui(requestRender?: () => void): TUI {
	return { terminal: { rows: 40 }, requestRender: requestRender ?? (() => {}) } as any;
}

function makeComponent(
	opts: { plan?: MissionPlan; theme?: any; requestRender?: () => void } = {},
): PlanOverlayComponent {
	const plan = opts.plan ?? makePlan();
	const tui = makeMockTui(opts.requestRender);
	return new PlanOverlayComponent(tui, () => {}, plan, opts.theme);
}

describe("PlanOverlayComponent (VAL-NEWUI-005)", () => {
	describe("focused property", () => {
		it("has focused property defaulting to false", () => {
			const comp = makeComponent();
			expect(comp.focused).toBe(false);
		});

		it("can set focused to true", () => {
			const comp = makeComponent();
			comp.focused = true;
			expect(comp.focused).toBe(true);
		});
	});

	describe("render caching", () => {
		it("returns same array ref for same width and version", () => {
			const comp = makeComponent();
			const first = comp.render(80);
			const second = comp.render(80);
			expect(second).toBe(first);
		});

		it("returns different array ref for different width", () => {
			const comp = makeComponent();
			const first = comp.render(80);
			const second = comp.render(100);
			expect(second).not.toBe(first);
		});

		it("returns different array ref after scroll changes version", () => {
			const comp = makeComponent();
			const first = comp.render(80);
			comp.handleInput("\x1B[B");
			const second = comp.render(80);
			expect(second).not.toBe(first);
		});
	});

	describe("requestRender on scroll", () => {
		it("calls requestRender when scrolling", () => {
			const mockFn = mock(() => {});
			const comp = makeComponent({ requestRender: mockFn });
			comp.handleInput("\x1B[B");
			expect(mockFn).toHaveBeenCalledTimes(1);
		});

		it("does not call requestRender for non-scroll keys", () => {
			const mockFn = mock(() => {});
			const comp = makeComponent({ requestRender: mockFn });
			comp.handleInput("a");
			expect(mockFn).not.toHaveBeenCalled();
		});
	});

	describe("invalidate", () => {
		it("resets cache so next render returns new array ref", () => {
			const comp = makeComponent();
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
			const comp = makeComponent({ theme });
			const before = comp.render(80);
			comp.invalidate();
			const after = comp.render(80);
			expect(after).not.toBe(before);
			expect(after.length).toBeGreaterThan(0);
		});

		it("does not throw when no theme was provided", () => {
			const comp = makeComponent();
			expect(() => comp.invalidate()).not.toThrow();
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

	it("returns scroll for arrow up", () => {
		const action = handlePlanOverlayKey("\x1B[A");
		expect(action.kind).toBe("scroll");
		if (action.kind === "scroll") expect(action.delta).toBe(-1);
	});

	it("returns scroll for arrow down", () => {
		const action = handlePlanOverlayKey("\x1B[B");
		expect(action.kind).toBe("scroll");
		if (action.kind === "scroll") expect(action.delta).toBe(1);
	});

	it("returns page scroll for pageUp", () => {
		const action = handlePlanOverlayKey("\x1B[5~");
		expect(action.kind).toBe("scroll");
		if (action.kind === "scroll") expect(action.delta).toBeLessThan(0);
	});

	it("returns page scroll for pageDown", () => {
		const action = handlePlanOverlayKey("\x1B[6~");
		expect(action.kind).toBe("scroll");
		if (action.kind === "scroll") expect(action.delta).toBeGreaterThan(0);
	});
});
