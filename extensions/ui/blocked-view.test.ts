import { describe, expect, it } from "bun:test";
import type { Feature } from "../types.js";
import { nowISO } from "../utils.js";
import type { LastFailureDetails } from "./blocked-view.js";
import { handleBlockedViewKey, renderBlockedView } from "./blocked-view.js";

function makeFeature(id: string, name: string, overrides: Partial<Feature> = {}): Feature {
	return {
		id,
		name,
		description: "A feature",
		acceptanceCriteria: ["criterion 1"],
		relevantFiles: [],
		dependencies: [],
		estimatedComplexity: "low",
		status: "blocked",
		attempts: [],
		...overrides,
	};
}

function makeAttempt(n: number): Feature["attempts"][0] {
	return {
		attemptNumber: n,
		startedAt: nowISO(),
		completedAt: nowISO(),
		exitCode: 1,
		resultPath: `.pi/missions/runtime/feat/${n}/result.json`,
		stdoutPath: `.pi/missions/runtime/feat/${n}/stdout.log`,
		stderrPath: `.pi/missions/runtime/feat/${n}/stderr.log`,
		durationMs: 30000,
		status: "failure",
	};
}

describe("renderBlockedView (VAL-UI-009)", () => {
	describe("blocked feature name", () => {
		it("shows blocked feature name", () => {
			const feature = makeFeature("f1", "jwt-tokens");
			const lines = renderBlockedView(feature, 3, undefined);
			const text = lines.join("\n");
			expect(text).toContain("jwt-tokens");
		});

		it("shows different feature names correctly", () => {
			const feature = makeFeature("f2", "user-profile-update");
			const lines = renderBlockedView(feature, 3, undefined);
			const text = lines.join("\n");
			expect(text).toContain("user-profile-update");
		});
	});

	describe("attempt count", () => {
		it("shows attempt count X/Y failed", () => {
			const feature = makeFeature("f1", "feature", {
				attempts: [makeAttempt(1), makeAttempt(2), makeAttempt(3)],
			});
			const lines = renderBlockedView(feature, 3, undefined);
			const text = lines.join("\n");
			expect(text).toMatch(/3\/3/);
		});

		it("shows attempt count for 1/3 failed", () => {
			const feature = makeFeature("f1", "feature", {
				attempts: [makeAttempt(1)],
			});
			const lines = renderBlockedView(feature, 3, undefined);
			const text = lines.join("\n");
			expect(text).toMatch(/1\/3/);
		});

		it("shows attempt count for different maxRetries", () => {
			const feature = makeFeature("f1", "feature", {
				attempts: [makeAttempt(1), makeAttempt(2)],
			});
			const lines = renderBlockedView(feature, 5, undefined);
			const text = lines.join("\n");
			expect(text).toMatch(/2\/5/);
		});
	});

	describe("last failure details", () => {
		it("shows error message from last failure", () => {
			const feature = makeFeature("f1", "feature", { attempts: [makeAttempt(1)] });
			const lastFailure: LastFailureDetails = {
				errorMessage: "TypeScript compilation failed: 5 errors",
			};
			const lines = renderBlockedView(feature, 3, lastFailure);
			const text = lines.join("\n");
			expect(text).toContain("TypeScript compilation failed: 5 errors");
		});

		it("shows failure details when present", () => {
			const feature = makeFeature("f1", "feature", { attempts: [makeAttempt(1)] });
			const lastFailure: LastFailureDetails = {
				errorMessage: "Tests failed",
				details: "expect(result).toBe(42) → received 0",
			};
			const lines = renderBlockedView(feature, 3, lastFailure);
			const text = lines.join("\n");
			expect(text).toContain("Tests failed");
			expect(text).toContain("expect(result).toBe(42)");
		});

		it("handles multi-line details", () => {
			const feature = makeFeature("f1", "feature", { attempts: [makeAttempt(1)] });
			const lastFailure: LastFailureDetails = {
				errorMessage: "Multiple failures",
				details: "line 1\nline 2\nline 3",
			};
			const lines = renderBlockedView(feature, 3, lastFailure);
			const text = lines.join("\n");
			expect(text).toContain("line 1");
			expect(text).toContain("line 2");
			expect(text).toContain("line 3");
		});

		it("handles missing last failure gracefully", () => {
			const feature = makeFeature("f1", "feature");
			const lines = renderBlockedView(feature, 3, undefined);
			expect(lines.length).toBeGreaterThan(0);
		});

		it("shows last failure section header when failure present", () => {
			const feature = makeFeature("f1", "feature", { attempts: [makeAttempt(1)] });
			const lastFailure: LastFailureDetails = { errorMessage: "build error" };
			const lines = renderBlockedView(feature, 3, lastFailure);
			const text = lines.join("\n");
			expect(text.toLowerCase()).toMatch(/last failure|failure/);
		});
	});

	describe("guidance text", () => {
		it("shows guidance text about options", () => {
			const feature = makeFeature("f1", "feature");
			const lines = renderBlockedView(feature, 3, undefined);
			const text = lines.join("\n");
			expect(text.toLowerCase()).toMatch(/retry|skip|return/);
		});

		it("shows exhausted retries message", () => {
			const feature = makeFeature("f1", "feature", {
				attempts: [makeAttempt(1), makeAttempt(2), makeAttempt(3)],
			});
			const lines = renderBlockedView(feature, 3, undefined);
			const text = lines.join("\n");
			expect(text.toLowerCase()).toMatch(/exhausted|attempts/);
		});
	});

	describe("keyboard hints", () => {
		it("shows R key hint for retry", () => {
			const feature = makeFeature("f1", "feature");
			const lines = renderBlockedView(feature, 3, undefined);
			const text = lines.join("\n");
			expect(text).toContain("R");
			expect(text.toLowerCase()).toContain("retry");
		});

		it("shows S key hint for skip", () => {
			const feature = makeFeature("f1", "feature");
			const lines = renderBlockedView(feature, 3, undefined);
			const text = lines.join("\n");
			expect(text).toContain("S");
			expect(text.toLowerCase()).toContain("skip");
		});

		it("shows Esc hint for back to chat", () => {
			const feature = makeFeature("f1", "feature");
			const lines = renderBlockedView(feature, 3, undefined);
			const text = lines.join("\n");
			expect(text).toContain("Esc");
		});
	});

	describe("general rendering", () => {
		it("returns non-empty array of lines", () => {
			const feature = makeFeature("f1", "feature");
			const lines = renderBlockedView(feature, 3, undefined);
			expect(lines.length).toBeGreaterThan(3);
		});
	});
});

describe("handleBlockedViewKey (VAL-UI-009)", () => {
	it("returns retry for R key", () => {
		const action = handleBlockedViewKey("r");
		expect(action.kind).toBe("retry");
	});

	it("returns retry for uppercase R key", () => {
		const action = handleBlockedViewKey("R");
		expect(action.kind).toBe("retry");
	});

	it("returns skip for S key", () => {
		const action = handleBlockedViewKey("s");
		expect(action.kind).toBe("skip");
	});

	it("returns skip for uppercase S key", () => {
		const action = handleBlockedViewKey("S");
		expect(action.kind).toBe("skip");
	});

	it("returns close for Esc key", () => {
		const action = handleBlockedViewKey("\x1B");
		expect(action.kind).toBe("close");
	});

	it("returns noop for other keys", () => {
		const action = handleBlockedViewKey("x");
		expect(action.kind).toBe("noop");
	});

	it("returns noop for numeric keys", () => {
		const action = handleBlockedViewKey("1");
		expect(action.kind).toBe("noop");
	});

	it("returns noop for enter key", () => {
		const action = handleBlockedViewKey("\r");
		expect(action.kind).toBe("noop");
	});

	it("returns noop for D key (no done action in blocked view)", () => {
		const action = handleBlockedViewKey("d");
		expect(action.kind).toBe("noop");
	});
});
