import { describe, expect, it } from "bun:test";
import type { MissionState, ProgressEvent } from "../../extensions/types.js";
import { handlePlanningSetupKey, renderPlanningSetupView } from "../../extensions/ui/planning-setup.js";
import { makeFeature as _sf, makeMilestone as _sm, makePlan as _sp, makeState as _ss } from "../helpers/index.js";

function makeState(overrides: Partial<MissionState> = {}): MissionState {
	return _ss({ status: "planning", startedAt: new Date(Date.now() - 60_000).toISOString(), ...overrides });
}

function makePlanningEvent(context?: string[]): ProgressEvent {
	return {
		timestamp: new Date().toISOString(),
		type: "planning_started",
		detail: "Planning started",
		metadata: context ? { context } : undefined,
	};
}

describe("renderPlanningSetupView (VAL-NEWUI-001)", () => {
	describe("basic rendering", () => {
		it("returns an array of strings", () => {
			const lines = renderPlanningSetupView(makeState());
			expect(lines).toBeArray();
			expect(lines.length).toBeGreaterThan(0);
		});

		it("renders a heading", () => {
			const lines = renderPlanningSetupView(makeState());
			const text = lines.join(" ");
			expect(text).toMatch(/mission|setup/i);
		});

		it("renders analyzing codebase message", () => {
			const lines = renderPlanningSetupView(makeState());
			const text = lines.join(" ");
			expect(text).toMatch(/analyz/i);
		});

		it("renders hint about questions in chat", () => {
			const lines = renderPlanningSetupView(makeState());
			const text = lines.join(" ");
			expect(text).toMatch(/question/i);
			expect(text).toMatch(/chat/i);
		});

		it("shows Esc keyboard hint", () => {
			const lines = renderPlanningSetupView(makeState());
			const text = lines.join(" ");
			expect(text).toContain("Esc");
		});
	});

	describe("goal rendering", () => {
		it("renders goal when provided", () => {
			const lines = renderPlanningSetupView(makeState(), "Build a multi-tenant auth system");
			const text = lines.join(" ");
			expect(text).toContain("Build a multi-tenant auth system");
		});

		it("renders goal label when goal is provided", () => {
			const lines = renderPlanningSetupView(makeState(), "My goal");
			const text = lines.join(" ");
			expect(text).toMatch(/goal/i);
		});

		it("does not render goal section when no goal", () => {
			const lines = renderPlanningSetupView(makeState());
			const text = lines.join(" ");
			expect(text).not.toMatch(/^Goal:/im);
		});
	});

	describe("context bullets", () => {
		it("renders context bullets from planning_started event metadata", () => {
			const state = makeState({
				progressLog: [makePlanningEvent(["Next.js app", "Prisma schema present"])],
			});
			const lines = renderPlanningSetupView(state);
			const text = lines.join(" ");
			expect(text).toContain("Next.js app");
			expect(text).toContain("Prisma schema present");
		});

		it("renders context section header when bullets are present", () => {
			const state = makeState({
				progressLog: [makePlanningEvent(["Some context"])],
			});
			const lines = renderPlanningSetupView(state);
			const text = lines.join(" ");
			expect(text).toMatch(/context/i);
		});

		it("does not render context section when no planning_started event", () => {
			const state = makeState({ progressLog: [] });
			const lines = renderPlanningSetupView(state);
			const text = lines.join(" ");
			expect(text).not.toMatch(/Context discovered/i);
		});

		it("does not render context section when planning_started has no context metadata", () => {
			const state = makeState({
				progressLog: [makePlanningEvent()],
			});
			const lines = renderPlanningSetupView(state);
			const text = lines.join(" ");
			expect(text).not.toMatch(/Context discovered/i);
		});

		it("renders bullet markers for context items", () => {
			const state = makeState({
				progressLog: [makePlanningEvent(["item one"])],
			});
			const lines = renderPlanningSetupView(state);
			const text = lines.join(" ");
			expect(text).toContain("\u2022");
		});

		it("renders multiple context bullets", () => {
			const state = makeState({
				progressLog: [
					makePlanningEvent(["Next.js app", "Prisma schema present", "Existing auth middleware found"]),
				],
			});
			const lines = renderPlanningSetupView(state);
			const text = lines.join(" ");
			expect(text).toContain("Next.js app");
			expect(text).toContain("Prisma schema present");
			expect(text).toContain("Existing auth middleware found");
		});
	});

	describe("combined rendering (VAL-NEWUI-001, VAL-XFLOW-002)", () => {
		it("renders goal and codebase analysis message together", () => {
			const lines = renderPlanningSetupView(makeState(), "Build a CRM");
			const text = lines.join(" ");
			expect(text).toContain("Build a CRM");
			expect(text).toMatch(/analyz/i);
		});

		it("renders all elements: goal, analyzing message, chat hint, context", () => {
			const state = makeState({
				progressLog: [makePlanningEvent(["React app"])],
			});
			const lines = renderPlanningSetupView(state, "Build something great");
			const text = lines.join(" ");
			expect(text).toContain("Build something great");
			expect(text).toMatch(/analyz/i);
			expect(text).toMatch(/question/i);
			expect(text).toContain("React app");
		});
	});
});

describe("handlePlanningSetupKey (VAL-NEWUI-001)", () => {
	it("returns close action for Esc key", () => {
		const action = handlePlanningSetupKey("\x1B");
		expect(action.kind).toBe("close");
	});

	it("returns noop for other keys", () => {
		const action = handlePlanningSetupKey("x");
		expect(action.kind).toBe("noop");
	});

	it("returns noop for letter keys", () => {
		for (const key of ["a", "b", "c", "q"]) {
			expect(handlePlanningSetupKey(key).kind).toBe("noop");
		}
	});

	it("returns noop for numeric keys", () => {
		expect(handlePlanningSetupKey("1").kind).toBe("noop");
		expect(handlePlanningSetupKey("9").kind).toBe("noop");
	});
});
