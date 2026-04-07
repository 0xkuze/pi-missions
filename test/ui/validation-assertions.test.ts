import { describe, expect, it } from "bun:test";
import type { AssertionResultData, ValidationAssertion } from "../../extensions/types.js";
import type { CommandDisplayEntry } from "../../extensions/ui/validation-view.js";
import { renderValidationView } from "../../extensions/ui/validation-view.js";
import type { ScrutinyIssue, ScrutinyReport } from "../../extensions/tools/run-scrutiny.js";

function makeAssertionResult(overrides: Partial<AssertionResultData> = {}): AssertionResultData {
	return {
		assertionId: "a1",
		status: "pass",
		exitCode: 0,
		stdout: "all tests pass",
		stderr: "",
		timedOut: false,
		durationMs: 1000,
		timestamp: "2025-01-01T00:00:00.000Z",
		command: "bun test",
		...overrides,
	};
}

describe("renderValidationView — assertion results (VAL-VALUI-001)", () => {
	describe("per-assertion pass/fail icons", () => {
		it("shows ✓ for passed assertions (VAL-VALUI-001)", () => {
			const assertions = [
				makeAssertionResult({ assertionId: "a1", status: "pass" }),
				makeAssertionResult({ assertionId: "a2", status: "fail" }),
				makeAssertionResult({ assertionId: "a3", status: "error" }),
			];
			const lines = renderValidationView("Auth", [], false, 80, undefined, 40, 0, assertions);
			const text = lines.join("\n");
			expect(text).toContain("\u2713");
		});

		it("shows ✗ for failed assertions (VAL-VALUI-001)", () => {
			const assertions = [
				makeAssertionResult({ assertionId: "a1", status: "pass" }),
				makeAssertionResult({ assertionId: "a2", status: "fail" }),
			];
			const lines = renderValidationView("Auth", [], false, 80, undefined, 40, 0, assertions);
			const text = lines.join("\n");
			expect(text).toContain("\u2717");
		});

		it("shows assertion IDs in rendered output (VAL-VALUI-001)", () => {
			const assertions = [
				makeAssertionResult({ assertionId: "VAL-001" }),
				makeAssertionResult({ assertionId: "VAL-002" }),
			];
			const lines = renderValidationView("Auth", [], false, 80, undefined, 40, 0, assertions);
			const text = lines.join("\n");
			expect(text).toContain("VAL-001");
			expect(text).toContain("VAL-002");
		});
	});

	describe("empty contract handling (VAL-VALUI-006)", () => {
		it("renders without errors when assertions is undefined", () => {
			const lines = renderValidationView("Auth", [], false, 80, undefined, 40, 0, undefined);
			expect(lines.length).toBeGreaterThan(0);
		});

		it("renders without errors when assertions is empty array", () => {
			const lines = renderValidationView("Auth", [], false, 80, undefined, 40, 0, []);
			expect(lines.length).toBeGreaterThan(0);
		});

		it("does not show assertion section header when assertions empty", () => {
			const lines = renderValidationView("Auth", [], false, 80, undefined, 40, 0, []);
			const text = lines.join("\n");
			expect(text).not.toMatch(/assertions/i);
		});
	});

	describe("assertion count matches (VAL-VALUI-005)", () => {
		it("renders all assertions in the view", () => {
			const assertions = [
				makeAssertionResult({ assertionId: "a1", status: "pass" }),
				makeAssertionResult({ assertionId: "a2", status: "fail" }),
				makeAssertionResult({ assertionId: "a3", status: "pass" }),
			];
			const lines = renderValidationView("Auth", [], false, 80, undefined, 40, 0, assertions);
			const text = lines.join("\n");
			expect(text).toContain("a1");
			expect(text).toContain("a2");
			expect(text).toContain("a3");
		});
	});

	describe("scrutiny findings display (VAL-VALUI-007)", () => {
		it("shows scrutiny issues when provided", () => {
			const scrutinyReport: ScrutinyReport = {
				status: "clean",
				milestoneId: "m1",
				timestamp: "2025-01-01T00:00:00.000Z",
				reviewerModel: "test-model",
				durationMs: 5000,
				issues: [
					{ severity: "error", description: "Race condition detected", location: "src/cache.ts:42" },
					{ severity: "warning", description: "Unused import", location: "src/utils.ts:10" },
				],
			};
			const lines = renderValidationView("Auth", [], false, 80, undefined, 40, 0, undefined, scrutinyReport);
			const text = lines.join("\n");
			expect(text).toContain("2");
			expect(text).toContain("Race condition detected");
			expect(text).toContain("error");
			expect(text).toContain("warning");
		});

		it("highlights error severity distinctly from warnings (VAL-VALUI-007)", () => {
			const scrutinyReport: ScrutinyReport = {
				status: "clean",
				milestoneId: "m1",
				timestamp: "2025-01-01T00:00:00.000Z",
				reviewerModel: "test-model",
				durationMs: 5000,
				issues: [
					{ severity: "error", description: "Critical issue", location: "src/main.ts:1" },
					{ severity: "warning", description: "Minor warning", location: "src/util.ts:5" },
				],
			};
			const lines = renderValidationView("Auth", [], false, 80, undefined, 40, 0, undefined, scrutinyReport);
			const text = lines.join("\n");
			expect(text).toContain("\u2717");
			expect(text).toContain("\u26A0");
		});

		it("handles clean scrutiny report gracefully", () => {
			const scrutinyReport: ScrutinyReport = {
				status: "clean",
				milestoneId: "m1",
				timestamp: "2025-01-01T00:00:00.000Z",
				reviewerModel: "test-model",
				durationMs: 5000,
				issues: [],
			};
			const lines = renderValidationView("Auth", [], false, 80, undefined, 40, 0, undefined, scrutinyReport);
			expect(lines.length).toBeGreaterThan(0);
		});
	});
});
