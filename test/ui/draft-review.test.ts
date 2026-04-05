import { describe, expect, it, mock } from "bun:test";
import type { TUI } from "@mariozechner/pi-tui";
import type { Feature, Milestone, MissionPlan } from "../../extensions/types.js";
import { DraftReviewComponent, handleDraftReviewKey, renderDraftReview } from "../../extensions/ui/draft-review.js";
import { makeFeature as _sf, makeMilestone as _sm, makePlan as _sp } from "../helpers/index.js";

function makeFeature(id: string, name: string, description = "A feature"): Feature {
	return _sf({ id, name, description });
}

function makeMilestone(id: string, name: string, features: Feature[]): Milestone {
	return _sm({ id, name, features });
}

function makePlan(overrides: Partial<MissionPlan> = {}): MissionPlan {
	return _sp({
		description: "Build multi-tenant auth system",
		milestones: [
			makeMilestone("m1", "Foundation", [
				makeFeature("f1", "user-model", "Create User entity and migration"),
				makeFeature("f2", "tenant-model", "Create Tenant entity with relations"),
			]),
			makeMilestone("m2", "Auth Flows", [makeFeature("f3", "login-endpoint", "Email/password login")]),
		],
		validationCommands: ["npm run typecheck", "npm test", "npm run lint"],
		modelAssignment: { worker: "claude-sonnet-4" },
		...overrides,
	});
}

describe("renderDraftReview (VAL-UI-007)", () => {
	it("shows mission description", () => {
		const plan = makePlan({ description: "Build multi-tenant auth system" });
		const lines = renderDraftReview(plan, 80, undefined, 40);
		const text = lines.join("\n");
		expect(text).toContain("Build multi-tenant auth system");
	});

	it("shows all milestone names", () => {
		const plan = makePlan();
		const lines = renderDraftReview(plan, 80, undefined, 40);
		const text = lines.join("\n");
		expect(text).toContain("Foundation");
		expect(text).toContain("Auth Flows");
	});

	it("shows feature count per milestone", () => {
		const plan = makePlan();
		const lines = renderDraftReview(plan, 80, undefined, 40);
		const text = lines.join("\n");
		expect(text).toContain("2");
		expect(text).toContain("1");
	});

	it("shows feature names", () => {
		const plan = makePlan();
		const lines = renderDraftReview(plan, 80, undefined, 40);
		const text = lines.join("\n");
		expect(text).toContain("user-model");
		expect(text).toContain("tenant-model");
		expect(text).toContain("login-endpoint");
	});

	it("shows feature descriptions", () => {
		const plan = makePlan();
		const lines = renderDraftReview(plan, 80, undefined, 40);
		const text = lines.join("\n");
		expect(text).toContain("Create User entity and migration");
		expect(text).toContain("Email/password login");
	});

	it("shows validation commands", () => {
		const plan = makePlan();
		const lines = renderDraftReview(plan, 80, undefined, 40);
		const text = lines.join("\n");
		expect(text).toContain("npm run typecheck");
		expect(text).toContain("npm test");
		expect(text).toContain("npm run lint");
	});

	it("shows model assignments when present", () => {
		const plan = makePlan({ modelAssignment: { worker: "claude-sonnet-4" } });
		const lines = renderDraftReview(plan, 80, undefined, 40);
		const text = lines.join("\n");
		expect(text).toContain("claude-sonnet-4");
	});

	it("shows estimated runs based on feature and milestone counts", () => {
		const plan = makePlan();
		const lines = renderDraftReview(plan, 80, undefined, 40);
		const text = lines.join("\n");
		expect(text.toLowerCase()).toMatch(/estimated|runs/i);
		expect(text).toMatch(/\d+/);
	});

	it("shows approval hint (A key)", () => {
		const plan = makePlan();
		const lines = renderDraftReview(plan, 80, undefined, 40);
		const text = lines.join("\n");
		expect(text).toContain("A");
		expect(text.toLowerCase()).toMatch(/approve/i);
	});

	it("shows Esc hint for returning to chat", () => {
		const plan = makePlan();
		const lines = renderDraftReview(plan, 80, undefined, 40);
		const text = lines.join("\n");
		expect(text).toContain("Esc");
	});

	it("handles empty validation commands gracefully", () => {
		const plan = makePlan({ validationCommands: [] });
		const lines = renderDraftReview(plan, 80, undefined, 40);
		expect(lines.length).toBeGreaterThan(0);
	});

	it("handles empty model assignment gracefully", () => {
		const plan = makePlan({ modelAssignment: {} });
		const lines = renderDraftReview(plan, 80, undefined, 40);
		expect(lines.length).toBeGreaterThan(0);
	});

	it("shows milestones in order", () => {
		const plan = makePlan();
		const lines = renderDraftReview(plan, 80, undefined, 40);
		const text = lines.join("\n");
		const foundIdx = text.indexOf("Foundation");
		const authIdx = text.indexOf("Auth Flows");
		expect(foundIdx).toBeLessThan(authIdx);
	});

	it("features appear under their milestone", () => {
		const plan = makePlan();
		const lines = renderDraftReview(plan, 80, undefined, 40);
		const text = lines.join("\n");
		const m1Idx = text.indexOf("Foundation");
		const f1Idx = text.indexOf("user-model");
		const m2Idx = text.indexOf("Auth Flows");
		const f3Idx = text.indexOf("login-endpoint");
		expect(f1Idx).toBeGreaterThan(m1Idx);
		expect(f3Idx).toBeGreaterThan(m2Idx);
	});

	it("shows header for the draft plan", () => {
		const plan = makePlan();
		const lines = renderDraftReview(plan, 80, undefined, 40);
		const text = lines.join("\n");
		expect(text.toLowerCase()).toMatch(/draft|plan|mission/i);
	});

	it("returns a non-empty array of lines", () => {
		const plan = makePlan();
		const lines = renderDraftReview(plan, 80, undefined, 40);
		expect(lines.length).toBeGreaterThan(5);
	});
});

function makeMockTui(requestRender?: () => void): TUI {
	return { terminal: { rows: 40 }, requestRender: requestRender ?? (() => {}) } as any;
}

function makeDraftComponent(
	opts: { plan?: MissionPlan; theme?: any; requestRender?: () => void } = {},
): DraftReviewComponent {
	const plan = opts.plan ?? makePlan();
	const tui = makeMockTui(opts.requestRender);
	const deps = { onApprove: () => {} };
	return new DraftReviewComponent(tui, () => {}, plan, deps, opts.theme);
}

describe("DraftReviewComponent (VAL-NEWUI-007)", () => {
	describe("focused property", () => {
		it("has focused property defaulting to false", () => {
			const comp = makeDraftComponent();
			expect(comp.focused).toBe(false);
		});

		it("can set focused to true", () => {
			const comp = makeDraftComponent();
			comp.focused = true;
			expect(comp.focused).toBe(true);
		});
	});

	describe("render caching", () => {
		it("returns same array ref for same width and version", () => {
			const comp = makeDraftComponent();
			const first = comp.render(80);
			const second = comp.render(80);
			expect(second).toBe(first);
		});

		it("returns different array ref for different width", () => {
			const comp = makeDraftComponent();
			const first = comp.render(80);
			const second = comp.render(100);
			expect(second).not.toBe(first);
		});

		it("returns different array ref after scroll changes version", () => {
			const comp = makeDraftComponent();
			const first = comp.render(80);
			comp.handleInput("\x1B[B");
			const second = comp.render(80);
			expect(second).not.toBe(first);
		});
	});

	describe("requestRender on scroll", () => {
		it("calls requestRender when scrolling", () => {
			const mockFn = mock(() => {});
			const comp = makeDraftComponent({ requestRender: mockFn });
			comp.handleInput("\x1B[B");
			expect(mockFn).toHaveBeenCalledTimes(1);
		});

		it("does not call requestRender for non-scroll keys", () => {
			const mockFn = mock(() => {});
			const comp = makeDraftComponent({ requestRender: mockFn });
			comp.handleInput("x");
			expect(mockFn).not.toHaveBeenCalled();
		});
	});

	describe("invalidate", () => {
		it("resets cache so next render returns new array ref", () => {
			const comp = makeDraftComponent();
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
			const comp = makeDraftComponent({ theme });
			const before = comp.render(80);
			comp.invalidate();
			const after = comp.render(80);
			expect(after).not.toBe(before);
			expect(after.length).toBeGreaterThan(0);
		});

		it("does not throw when no theme was provided", () => {
			const comp = makeDraftComponent();
			expect(() => comp.invalidate()).not.toThrow();
		});
	});
});

describe("handleDraftReviewKey (VAL-UI-007)", () => {
	it("returns approve action for A key", () => {
		const action = handleDraftReviewKey("a");
		expect(action.kind).toBe("approve");
	});

	it("returns approve action for uppercase A key", () => {
		const action = handleDraftReviewKey("A");
		expect(action.kind).toBe("approve");
	});

	it("returns close action for Esc key", () => {
		const action = handleDraftReviewKey("\x1B");
		expect(action.kind).toBe("close");
	});

	it("returns noop for other keys", () => {
		const action = handleDraftReviewKey("x");
		expect(action.kind).toBe("noop");
	});

	it("returns noop for numeric keys", () => {
		const action = handleDraftReviewKey("1");
		expect(action.kind).toBe("noop");
	});

	it("returns noop for enter key", () => {
		const action = handleDraftReviewKey("\r");
		expect(action.kind).toBe("noop");
	});
});
