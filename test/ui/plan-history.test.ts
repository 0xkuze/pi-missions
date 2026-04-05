import { describe, expect, it } from "bun:test";
import type { PlanMutation } from "../../extensions/types.js";
import { handlePlanHistoryKey, renderPlanHistoryView } from "../../extensions/ui/plan-history.js";

function makeMutation(overrides: Partial<PlanMutation> = {}): PlanMutation {
	return {
		planVersion: 1,
		timestamp: new Date(Date.now() - 60_000).toISOString(),
		actor: "orchestrator",
		kind: "plan-created",
		summary: "Plan created",
		payload: {},
		...overrides,
	};
}

describe("renderPlanHistoryView (VAL-NEWUI-003)", () => {
	describe("empty mutations", () => {
		it("shows placeholder when no mutations", () => {
			const lines = renderPlanHistoryView([], 80, undefined, 40);
			const text = lines.join(" ");
			expect(text.length).toBeGreaterThan(0);
			expect(text).toMatch(/no history|empty|no mutations/i);
		});

		it("returns non-empty array for empty mutations", () => {
			const lines = renderPlanHistoryView([], 80, undefined, 40);
			expect(lines).toBeArray();
			expect(lines.length).toBeGreaterThan(0);
		});
	});

	describe("mutation rendering", () => {
		it("shows mutation summary text", () => {
			const mutation = makeMutation({ summary: "Plan was created with 3 milestones" });
			const lines = renderPlanHistoryView([mutation], 80, undefined, 40);
			const text = lines.join(" ");
			expect(text).toContain("Plan was created with 3 milestones");
		});

		it("shows actor for user mutations", () => {
			const mutation = makeMutation({ actor: "user" });
			const lines = renderPlanHistoryView([mutation], 80, undefined, 40);
			const text = lines.join(" ");
			expect(text).toContain("user");
		});

		it("shows actor for orchestrator mutations", () => {
			const mutation = makeMutation({ actor: "orchestrator" });
			const lines = renderPlanHistoryView([mutation], 80, undefined, 40);
			const text = lines.join(" ");
			expect(text).toContain("orchestrator");
		});

		it("shows mutation kind", () => {
			const mutation = makeMutation({ kind: "add-feature" });
			const lines = renderPlanHistoryView([mutation], 80, undefined, 40);
			const text = lines.join(" ");
			expect(text).toContain("add-feature");
		});

		it("shows timestamp in relative format", () => {
			const mutation = makeMutation({
				timestamp: new Date(Date.now() - 2 * 60_000).toISOString(),
			});
			const lines = renderPlanHistoryView([mutation], 80, undefined, 40);
			const text = lines.join(" ");
			expect(text).toMatch(/\d+[smh]/);
		});

		it("shows planVersion number", () => {
			const mutation = makeMutation({ planVersion: 5 });
			const lines = renderPlanHistoryView([mutation], 80, undefined, 40);
			const text = lines.join(" ");
			expect(text).toContain("5");
		});
	});

	describe("ordering", () => {
		it("shows mutations ordered by planVersion ascending", () => {
			const mutations: PlanMutation[] = [
				makeMutation({ planVersion: 3, summary: "third mutation" }),
				makeMutation({ planVersion: 1, summary: "first mutation" }),
				makeMutation({ planVersion: 2, summary: "second mutation" }),
			];
			const lines = renderPlanHistoryView(mutations, 80, undefined, 40);
			const text = lines.join("\n");
			const idx1 = text.indexOf("first mutation");
			const idx2 = text.indexOf("second mutation");
			const idx3 = text.indexOf("third mutation");
			expect(idx1).toBeLessThan(idx2);
			expect(idx2).toBeLessThan(idx3);
		});

		it("shows multiple mutations", () => {
			const mutations: PlanMutation[] = [
				makeMutation({ planVersion: 1, summary: "plan created" }),
				makeMutation({ planVersion: 2, summary: "feature added" }),
			];
			const lines = renderPlanHistoryView(mutations, 80, undefined, 40);
			const text = lines.join(" ");
			expect(text).toContain("plan created");
			expect(text).toContain("feature added");
		});
	});

	describe("heading and footer", () => {
		it("shows a heading related to plan history", () => {
			const lines = renderPlanHistoryView([], 80, undefined, 40);
			const text = lines.join(" ");
			expect(text).toMatch(/plan.*(history|mutations)|history/i);
		});

		it("shows Esc keyboard hint", () => {
			const lines = renderPlanHistoryView([], 80, undefined, 40);
			const text = lines.join(" ");
			expect(text).toContain("Esc");
		});
	});

	describe("various mutation kinds", () => {
		const kinds: PlanMutation["kind"][] = [
			"plan-created",
			"plan-approved",
			"add-feature",
			"remove-feature",
			"add-fix-feature",
			"feature-status-change",
			"milestone-status-change",
			"edit-validation",
		];

		for (const kind of kinds) {
			it(`renders ${kind} mutation`, () => {
				const mutation = makeMutation({ kind, summary: `${kind} summary` });
				const lines = renderPlanHistoryView([mutation], 80, undefined, 40);
				const text = lines.join(" ");
				expect(text).toContain(kind);
			});
		}
	});
});

describe("handlePlanHistoryKey (VAL-NEWUI-003)", () => {
	it("returns close action for Esc key", () => {
		const action = handlePlanHistoryKey("\x1B");
		expect(action.kind).toBe("close");
	});

	it("returns noop for other keys", () => {
		const action = handlePlanHistoryKey("x");
		expect(action.kind).toBe("noop");
	});

	it("returns noop for letter keys", () => {
		for (const key of ["a", "b", "c", "h", "q"]) {
			expect(handlePlanHistoryKey(key).kind).toBe("noop");
		}
	});

	it("returns noop for numeric keys", () => {
		expect(handlePlanHistoryKey("1").kind).toBe("noop");
		expect(handlePlanHistoryKey("9").kind).toBe("noop");
	});

	it("returns noop for uppercase letters", () => {
		expect(handlePlanHistoryKey("H").kind).toBe("noop");
		expect(handlePlanHistoryKey("A").kind).toBe("noop");
	});
});
