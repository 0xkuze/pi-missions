import { describe, expect, it } from "bun:test";
import type { Feature, Milestone, MissionPlan } from "../../extensions/types.js";
import { handleDraftReviewKey, renderDraftReview } from "../../extensions/ui/draft-review.js";
import { nowISO } from "../../extensions/utils.js";
import { makeFeature as _sf, makeMilestone as _sm, makePlan as _sp, makeState as _ss } from "../helpers/index.js";

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
