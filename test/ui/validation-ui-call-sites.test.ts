import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateReport, type ReportValidationInfo } from "../../extensions/report.js";
import { saveContract } from "../../extensions/state/manager.js";
import type {
	AssertionResultData,
	Feature,
	Milestone,
	MissionPlan,
	MissionState,
	ValidationContract,
} from "../../extensions/types.js";
import { renderValidationView } from "../../extensions/ui/validation-view.js";
import { buildWidgetLines, type WidgetAssertionInfo } from "../../extensions/ui/widget.js";
import { makeFeature, makeMilestone, makePlan, makeState } from "../helpers/index.js";

function makeAssertionResult(overrides: Partial<AssertionResultData> = {}): AssertionResultData {
	return {
		assertionId: "a1",
		status: "pass",
		exitCode: 0,
		stdout: "ok",
		stderr: "",
		timedOut: false,
		durationMs: 1000,
		timestamp: "2025-01-01T00:00:00.000Z",
		command: "bun test",
		...overrides,
	};
}

function makeContract(overrides: Partial<ValidationContract> = {}): ValidationContract {
	return {
		assertions: [
			{
				id: "a1",
				featureId: "f1",
				type: "command",
				command: "bun test",
				expect: { exitCode: 0 },
				description: "tests pass",
				status: "pass",
			},
			{
				id: "a2",
				featureId: "f1",
				type: "command",
				command: "bun run lint",
				expect: { exitCode: 0 },
				description: "lint passes",
				status: "pass",
			},
		],
		...overrides,
	};
}

function makeScrutinyReportJson(
	milestoneId: string,
	issues: Array<{ severity: string; description: string; location: string }> = [],
) {
	return JSON.stringify({
		status: "clean",
		milestoneId,
		timestamp: "2025-01-01T00:00:00.000Z",
		reviewerModel: "test-model",
		durationMs: 5000,
		issues,
	});
}

describe("validation UI call sites integration", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "val-ui-call-sites-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("call site 1: renderValidationView receives assertions and scrutinyReport", () => {
		it("renders assertion section when contract has completed assertions", () => {
			const contract = makeContract({
				assertions: [
					{
						id: "a1",
						featureId: "f1",
						type: "command",
						command: "bun test",
						expect: { exitCode: 0 },
						description: "tests",
						status: "pass",
					},
					{
						id: "a2",
						featureId: "f1",
						type: "command",
						command: "lint",
						expect: { exitCode: 0 },
						description: "lint",
						status: "fail",
					},
				],
			});
			saveContract(tmpDir, contract);

			const loadedContract = makeContract();
			const assertions: AssertionResultData[] = loadedContract.assertions
				.filter((a) => a.status === "pass" || a.status === "fail" || a.status === "error")
				.map((a) =>
					makeAssertionResult({
						assertionId: a.id,
						status: a.status as AssertionResultData["status"],
						command: a.command,
					}),
				);

			const lines = renderValidationView("Auth", [], false, 80, undefined, 40, 0, assertions);
			const text = lines.join("\n");
			expect(text).toContain("a1");
			expect(text).toContain("a2");
			expect(text).toContain("Assertions");
		});

		it("renders scrutiny section when scrutiny report exists", () => {
			const milestoneId = "m1";
			const scrutinyDir = join(tmpDir, "runtime", "validation", milestoneId, "scrutiny");
			mkdirSync(scrutinyDir, { recursive: true });
			writeFileSync(
				join(scrutinyDir, "report.json"),
				makeScrutinyReportJson(milestoneId, [
					{ severity: "warning", description: "Unused import", location: "src/utils.ts:10" },
				]),
			);

			const reportJson = JSON.parse(readFileSync(join(scrutinyDir, "report.json"), "utf8"));
			const lines = renderValidationView("Auth", [], false, 80, undefined, 40, 0, undefined, reportJson);
			const text = lines.join("\n");
			expect(text).toContain("Unused import");
			expect(text).toContain("Scrutiny");
		});

		it("renders both assertions and scrutiny when both are available", () => {
			const assertions = [makeAssertionResult({ assertionId: "a1", status: "pass" })];
			const reportJson = {
				status: "clean" as const,
				milestoneId: "m1",
				timestamp: "2025-01-01T00:00:00.000Z",
				reviewerModel: "test",
				durationMs: 1000,
				issues: [{ severity: "info" as const, description: "Minor style note", location: "src/main.ts:5" }],
			};

			const lines = renderValidationView("Auth", [], false, 80, undefined, 40, 0, assertions, reportJson);
			const text = lines.join("\n");
			expect(text).toContain("a1");
			expect(text).toContain("Assertions");
			expect(text).toContain("Minor style note");
			expect(text).toContain("Scrutiny");
		});

		it("handles empty contract gracefully (no assertions section)", () => {
			const lines = renderValidationView("Auth", [], false, 80, undefined, 40, 0, undefined, undefined);
			const text = lines.join("\n");
			expect(text).not.toContain("Assertions");
			expect(text).not.toContain("Scrutiny");
		});
	});

	describe("call site 2: buildWidgetLines receives assertionInfo", () => {
		it("shows assertion counts in validating state when assertionInfo provided", () => {
			const feature = makeFeature({ id: "f1", status: "done" });
			const milestone = makeMilestone({ id: "m1", features: [feature], status: "active" });
			milestone.name = "Auth";
			const plan = makePlan({ milestones: [milestone] });
			const state = makeState({
				status: "validating",
				currentMilestoneId: "m1",
				totalFeaturesCompleted: 1,
			});

			const assertionInfo: WidgetAssertionInfo = { assertionsPassed: 3, assertionsTotal: 5 };
			const lines = buildWidgetLines(state, plan, undefined, undefined, assertionInfo);
			const text = lines.join(" ");
			expect(text).toMatch(/3\/5/);
			expect(text).toMatch(/assertions/i);
		});

		it("shows assertion counts in executing state when assertionInfo provided", () => {
			const feature1 = makeFeature({ id: "f1", status: "done" });
			const feature2 = makeFeature({ id: "f2", status: "active" });
			const milestone = makeMilestone({ id: "m1", features: [feature1, feature2], status: "active" });
			const plan = makePlan({ milestones: [milestone] });
			const state = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f2",
				totalFeaturesCompleted: 1,
			});

			const assertionInfo: WidgetAssertionInfo = { assertionsPassed: 5, assertionsTotal: 5 };
			const lines = buildWidgetLines(state, plan, undefined, undefined, assertionInfo);
			const text = lines.join(" ");
			expect(text).toMatch(/5\/5/);
			expect(text).toMatch(/assertions/i);
		});

		it("omits assertion counts when assertionInfo is undefined", () => {
			const feature = makeFeature({ id: "f1", status: "done" });
			const milestone = makeMilestone({ id: "m1", features: [feature], status: "active" });
			const plan = makePlan({ milestones: [milestone] });
			const state = makeState({
				status: "validating",
				currentMilestoneId: "m1",
				totalFeaturesCompleted: 1,
			});

			const lines = buildWidgetLines(state, plan, undefined, undefined, undefined);
			const text = lines.join(" ");
			expect(text).not.toMatch(/\d+\/\d+ assertions/);
		});
	});

	describe("call site 3: generateReport receives validationInfo", () => {
		it("includes Validation Assertions section when validationInfo has assertions", () => {
			const state = makeState({
				status: "completed",
				startedAt: new Date(Date.now() - 60_000).toISOString(),
				completedAt: new Date().toISOString(),
				totalFeaturesCompleted: 1,
			});
			const plan = makePlan({ description: "Test mission" });

			const validationInfo: ReportValidationInfo = {
				assertions: [
					makeAssertionResult({ assertionId: "VAL-001", status: "pass", command: "bun test" }),
					makeAssertionResult({ assertionId: "VAL-002", status: "fail", command: "bun run lint" }),
				],
			};

			const report = generateReport(state, plan, undefined, validationInfo);
			expect(report).toMatch(/## Validation Assertions/i);
			expect(report).toContain("VAL-001");
			expect(report).toContain("VAL-002");
		});

		it("includes evidence directory when provided", () => {
			const state = makeState({
				status: "completed",
				startedAt: new Date(Date.now() - 60_000).toISOString(),
				completedAt: new Date().toISOString(),
				totalFeaturesCompleted: 1,
			});
			const plan = makePlan({ description: "Test mission" });

			const validationInfo: ReportValidationInfo = {
				assertions: [makeAssertionResult({ assertionId: "VAL-001" })],
				evidenceDir: "runtime/validation/m1",
			};

			const report = generateReport(state, plan, undefined, validationInfo);
			expect(report).toMatch(/evidence/i);
			expect(report).toContain("runtime/validation/m1");
		});

		it("omits assertion section when validationInfo is undefined", () => {
			const state = makeState({
				status: "completed",
				startedAt: new Date(Date.now() - 60_000).toISOString(),
				completedAt: new Date().toISOString(),
				totalFeaturesCompleted: 1,
			});
			const plan = makePlan({ description: "Test mission" });

			const report = generateReport(state, plan, undefined, undefined);
			expect(report).not.toMatch(/## Validation Assertions/i);
		});
	});

	describe("end-to-end: contract data flows through to UI and report", () => {
		it("contract assertions appear in validation view, widget, and report", () => {
			const contract = makeContract({
				assertions: [
					{
						id: "a1",
						featureId: "f1",
						type: "command",
						command: "bun test",
						expect: { exitCode: 0 },
						description: "tests pass",
						status: "pass",
					},
					{
						id: "a2",
						featureId: "f1",
						type: "command",
						command: "bun lint",
						expect: { exitCode: 0 },
						description: "lint passes",
						status: "fail",
					},
				],
			});
			saveContract(tmpDir, contract);

			const assertions: AssertionResultData[] = contract.assertions
				.filter((a) => a.status === "pass" || a.status === "fail" || a.status === "error")
				.map((a) =>
					makeAssertionResult({
						assertionId: a.id,
						status: a.status as AssertionResultData["status"],
						command: a.command,
					}),
				);

			const validationLines = renderValidationView("Auth", [], false, 80, undefined, 40, 0, assertions);
			expect(validationLines.join("\n")).toContain("a1");
			expect(validationLines.join("\n")).toContain("a2");

			const plan = makePlan({
				milestones: [
					makeMilestone({ id: "m1", features: [makeFeature({ id: "f1", status: "done" })], status: "active" }),
				],
			});
			const widgetState = makeState({
				status: "validating",
				currentMilestoneId: "m1",
				totalFeaturesCompleted: 1,
			});
			const assertionInfo: WidgetAssertionInfo = { assertionsPassed: 1, assertionsTotal: 2 };
			const widgetLines = buildWidgetLines(widgetState, plan, undefined, undefined, assertionInfo);
			expect(widgetLines.join(" ")).toMatch(/1\/2/);

			const reportState = makeState({
				status: "completed",
				startedAt: new Date(Date.now() - 60_000).toISOString(),
				completedAt: new Date().toISOString(),
				totalFeaturesCompleted: 1,
			});
			const report = generateReport(reportState, plan, undefined, {
				assertions,
				evidenceDir: join(tmpDir, "runtime", "validation", "m1"),
			});
			expect(report).toContain("a1");
			expect(report).toContain("a2");
			expect(report).toMatch(/## Validation Assertions/i);
			expect(report).toMatch(/evidence/i);
		});
	});
});
