import { describe, expect, it } from "bun:test";
import { generateReport } from "../../extensions/report.js";
import type { AssertionResultData, Feature, Milestone, MissionPlan, MissionState } from "../../extensions/types.js";
import { makeFeature, makeMilestone, makePlan, makeState } from "../helpers/index.js";

const now = new Date("2025-01-15T10:00:00.000Z");
const later = new Date("2025-01-15T11:24:00.000Z");

function makeAssertionResult(overrides: Partial<AssertionResultData> = {}): AssertionResultData {
	return {
		assertionId: "VAL-001",
		status: "pass",
		exitCode: 0,
		stdout: "all tests pass",
		stderr: "",
		timedOut: false,
		durationMs: 1000,
		timestamp: now.toISOString(),
		command: "bun test",
		...overrides,
	};
}

function makeReportState(overrides: Partial<MissionState> = {}): MissionState {
	return makeState({
		status: "completed",
		startedAt: now.toISOString(),
		completedAt: later.toISOString(),
		totalFeaturesCompleted: 1,
		...overrides,
	});
}

function makeReportPlan(overrides: Partial<MissionPlan> = {}): MissionPlan {
	const feature = makeFeature({ id: "feat1", name: "user-model", status: "done" });
	const milestone = makeMilestone({ id: "ms1", name: "Foundation", features: [feature], status: "done" });
	return makePlan({ description: "Build auth system", milestones: [milestone], ...overrides });
}

describe("generateReport — validation assertions (VAL-VALUI-003, VAL-VALUI-004, VAL-EVIDENCE-005)", () => {
	describe("assertion outcomes section (VAL-VALUI-003)", () => {
		it("includes Validation Assertions section when assertions provided", () => {
			const state = makeReportState();
			const plan = makeReportPlan();
			const assertions = [
				makeAssertionResult({ assertionId: "VAL-001", status: "pass" }),
				makeAssertionResult({ assertionId: "VAL-002", status: "fail" }),
			];
			const report = generateReport(state, plan, undefined, { assertions });
			expect(report).toMatch(/## Validation Assertions/i);
		});

		it("lists each assertion description and outcome", () => {
			const state = makeReportState();
			const plan = makeReportPlan();
			const assertions = [
				makeAssertionResult({ assertionId: "VAL-001", status: "pass", command: "bun test" }),
				makeAssertionResult({ assertionId: "VAL-002", status: "fail", command: "bun run lint" }),
			];
			const report = generateReport(state, plan, undefined, { assertions });
			expect(report).toContain("VAL-001");
			expect(report).toContain("VAL-002");
			expect(report.toLowerCase()).toContain("pass");
			expect(report.toLowerCase()).toContain("fail");
		});

		it("includes output summary for failed assertions", () => {
			const state = makeReportState();
			const plan = makeReportPlan();
			const assertions = [
				makeAssertionResult({
					assertionId: "VAL-002",
					status: "fail",
					stdout: "2 tests failed",
					stderr: "TypeError in utils.ts",
				}),
			];
			const report = generateReport(state, plan, undefined, { assertions });
			expect(report).toContain("2 tests failed");
		});

		it("omits assertion section when no assertions provided", () => {
			const state = makeReportState();
			const plan = makeReportPlan();
			const report = generateReport(state, plan);
			expect(report).not.toMatch(/## Validation Assertions/i);
		});
	});

	describe("evidence summary (VAL-VALUI-004)", () => {
		it("includes pass rate in report", () => {
			const state = makeReportState();
			const plan = makeReportPlan();
			const assertions = [
				makeAssertionResult({ assertionId: "VAL-001", status: "pass" }),
				makeAssertionResult({ assertionId: "VAL-002", status: "pass" }),
				makeAssertionResult({ assertionId: "VAL-003", status: "fail" }),
			];
			const report = generateReport(state, plan, undefined, { assertions });
			expect(report).toMatch(/2\/3/);
		});

		it("includes evidence directory reference", () => {
			const state = makeReportState();
			const plan = makeReportPlan();
			const assertions = [makeAssertionResult()];
			const report = generateReport(state, plan, undefined, {
				assertions,
				evidenceDir: "runtime/validation/ms1",
			});
			expect(report).toMatch(/evidence/i);
			expect(report).toContain("runtime/validation/ms1");
		});

		it("includes evidence section header when assertions present", () => {
			const state = makeReportState();
			const plan = makeReportPlan();
			const assertions = [makeAssertionResult()];
			const report = generateReport(state, plan, undefined, { assertions });
			expect(report).toMatch(/evidence/i);
		});
	});
});
