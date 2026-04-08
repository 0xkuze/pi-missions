import { describe, expect, it } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import {
	MissionConfigSchema,
	MissionStateSchema,
	ReportResultSchema,
	type WorkerHandoff,
	WorkerResultSchema,
} from "../../extensions/types.js";

const VALID_REPORT_RESULT = {
	whatWasImplemented: "Added retry logic to the data fetcher",
	whatWasLeftUndone: "Error logging for failed retries",
	commandsRun: [
		{ command: "bun test", exitCode: 0, observation: "47 tests pass" },
		{ command: "bun run lint", exitCode: 1, observation: "2 lint errors in utils.ts" },
	],
	testsAdded: [
		{ file: "retry.test.ts", cases: ["retries 3 times", "exponential backoff"] },
		{ file: "fetcher.test.ts", cases: ["handles network timeout"] },
	],
	discoveredIssues: [
		{ severity: "high", description: "Race condition in cache", suggestedFix: "Add mutex" },
		{ severity: "low", description: "Minor typo in log" },
	],
};

describe("ReportResultSchema", () => {
	describe("VAL-HANDOFF-001: schema validation", () => {
		it("validates a fully-populated conforming object", () => {
			expect(Value.Check(ReportResultSchema, VALID_REPORT_RESULT)).toBe(true);
		});

		it("rejects object missing whatWasImplemented", () => {
			const { whatWasImplemented: _, ...missing } = VALID_REPORT_RESULT;
			expect(Value.Check(ReportResultSchema, missing)).toBe(false);
		});

		it("rejects object missing whatWasLeftUndone", () => {
			const { whatWasLeftUndone: _, ...missing } = VALID_REPORT_RESULT;
			expect(Value.Check(ReportResultSchema, missing)).toBe(false);
		});

		it("accepts object missing commandsRun (optional field)", () => {
			const { commandsRun: _, ...missing } = VALID_REPORT_RESULT;
			expect(Value.Check(ReportResultSchema, missing)).toBe(true);
		});

		it("accepts object missing testsAdded (optional field)", () => {
			const { testsAdded: _, ...missing } = VALID_REPORT_RESULT;
			expect(Value.Check(ReportResultSchema, missing)).toBe(true);
		});

		it("accepts object missing discoveredIssues (optional field)", () => {
			const { discoveredIssues: _, ...missing } = VALID_REPORT_RESULT;
			expect(Value.Check(ReportResultSchema, missing)).toBe(true);
		});

		it("rejects object with wrong whatWasImplemented type", () => {
			expect(Value.Check(ReportResultSchema, { ...VALID_REPORT_RESULT, whatWasImplemented: 123 })).toBe(false);
		});

		it("rejects object with wrong commandsRun entry type", () => {
			expect(
				Value.Check(ReportResultSchema, {
					...VALID_REPORT_RESULT,
					commandsRun: [{ command: "bun test", exitCode: "zero", observation: "pass" }],
				}),
			).toBe(false);
		});

		it("rejects object with invalid severity", () => {
			expect(
				Value.Check(ReportResultSchema, {
					...VALID_REPORT_RESULT,
					discoveredIssues: [{ severity: "critical", description: "bad" }],
				}),
			).toBe(false);
		});
	});

	describe("discoveredIssues severity levels", () => {
		it("accepts severity 'low'", () => {
			expect(
				Value.Check(ReportResultSchema, {
					...VALID_REPORT_RESULT,
					discoveredIssues: [{ severity: "low", description: "minor" }],
				}),
			).toBe(true);
		});

		it("accepts severity 'medium'", () => {
			expect(
				Value.Check(ReportResultSchema, {
					...VALID_REPORT_RESULT,
					discoveredIssues: [{ severity: "medium", description: "moderate" }],
				}),
			).toBe(true);
		});

		it("accepts severity 'high'", () => {
			expect(
				Value.Check(ReportResultSchema, {
					...VALID_REPORT_RESULT,
					discoveredIssues: [{ severity: "high", description: "severe" }],
				}),
			).toBe(true);
		});

		it("accepts discoveredIssue with optional suggestedFix", () => {
			expect(
				Value.Check(ReportResultSchema, {
					...VALID_REPORT_RESULT,
					discoveredIssues: [{ severity: "high", description: "bad", suggestedFix: "Fix it" }],
				}),
			).toBe(true);
		});

		it("accepts discoveredIssue without suggestedFix", () => {
			expect(
				Value.Check(ReportResultSchema, {
					...VALID_REPORT_RESULT,
					discoveredIssues: [{ severity: "low", description: "minor" }],
				}),
			).toBe(true);
		});
	});

	describe("commandsRun entries", () => {
		it("requires command string", () => {
			expect(
				Value.Check(ReportResultSchema, {
					...VALID_REPORT_RESULT,
					commandsRun: [{ exitCode: 0, observation: "pass" }],
				}),
			).toBe(false);
		});

		it("requires exitCode number", () => {
			expect(
				Value.Check(ReportResultSchema, {
					...VALID_REPORT_RESULT,
					commandsRun: [{ command: "bun test", observation: "pass" }],
				}),
			).toBe(false);
		});

		it("requires observation string", () => {
			expect(
				Value.Check(ReportResultSchema, {
					...VALID_REPORT_RESULT,
					commandsRun: [{ command: "bun test", exitCode: 0 }],
				}),
			).toBe(false);
		});
	});

	describe("testsAdded entries", () => {
		it("requires file string", () => {
			expect(
				Value.Check(ReportResultSchema, {
					...VALID_REPORT_RESULT,
					testsAdded: [{ cases: ["test1"] }],
				}),
			).toBe(false);
		});

		it("requires cases array of strings", () => {
			expect(
				Value.Check(ReportResultSchema, {
					...VALID_REPORT_RESULT,
					testsAdded: [{ file: "test.ts", cases: [123] }],
				}),
			).toBe(false);
		});
	});

	describe("empty arrays", () => {
		it("accepts empty commandsRun", () => {
			expect(Value.Check(ReportResultSchema, { ...VALID_REPORT_RESULT, commandsRun: [] })).toBe(true);
		});

		it("accepts empty testsAdded", () => {
			expect(Value.Check(ReportResultSchema, { ...VALID_REPORT_RESULT, testsAdded: [] })).toBe(true);
		});

		it("accepts empty discoveredIssues", () => {
			expect(Value.Check(ReportResultSchema, { ...VALID_REPORT_RESULT, discoveredIssues: [] })).toBe(true);
		});

		it("accepts empty whatWasLeftUndone", () => {
			expect(Value.Check(ReportResultSchema, { ...VALID_REPORT_RESULT, whatWasLeftUndone: "" })).toBe(true);
		});
	});
});

describe("WorkerResultSchema with handoff", () => {
	it("accepts WorkerResult without handoff (backward compat)", () => {
		const result = {
			status: "success",
			summary: "Done",
			filesChanged: [],
			commandsRun: [],
			metrics: { durationMs: 100 },
		};
		expect(Value.Check(WorkerResultSchema, result)).toBe(true);
	});

	it("accepts WorkerResult with handoff field", () => {
		const result = {
			status: "success",
			summary: "Done",
			filesChanged: [],
			commandsRun: [],
			metrics: { durationMs: 100 },
			handoff: VALID_REPORT_RESULT,
		};
		expect(Value.Check(WorkerResultSchema, result)).toBe(true);
	});

	it("rejects WorkerResult with malformed handoff", () => {
		const result = {
			status: "success",
			summary: "Done",
			filesChanged: [],
			commandsRun: [],
			metrics: { durationMs: 100 },
			handoff: { whatWasImplemented: 123 },
		};
		expect(Value.Check(WorkerResultSchema, result)).toBe(false);
	});
});

describe("VAL-VALIDATOR-004/007: MissionConfigSchema validatorStrictness", () => {
	it("accepts validatorStrictness: 'strict'", () => {
		expect(Value.Check(MissionConfigSchema, { validatorStrictness: "strict" })).toBe(true);
	});

	it("accepts validatorStrictness: 'lenient'", () => {
		expect(Value.Check(MissionConfigSchema, { validatorStrictness: "lenient" })).toBe(true);
	});

	it("rejects validatorStrictness: 'invalid'", () => {
		expect(Value.Check(MissionConfigSchema, { validatorStrictness: "invalid" })).toBe(false);
	});

	it("accepts missing validatorStrictness (optional)", () => {
		expect(Value.Check(MissionConfigSchema, {})).toBe(true);
	});

	it("accepts full config with validatorStrictness alongside other fields", () => {
		const config = {
			models: { orchestrator: "model-a" },
			promptingMode: "default",
			spawnAndLearn: true,
			validation: { timeoutMs: 60000 },
			autonomy: "high",
			maxRetries: 3,
			validatorStrictness: "strict",
		};
		expect(Value.Check(MissionConfigSchema, config)).toBe(true);
	});
});

describe("VAL-PROTOCOL-003: MissionStateSchema protocolVersion and turnCount", () => {
	const BASE_STATE = {
		missionId: "test-mission",
		status: "executing",
		progressLog: [],
		startedAt: "2025-01-01T00:00:00.000Z",
		totalFeaturesCompleted: 0,
		totalFeaturesFailed: 0,
		totalFeaturesSkipped: 0,
		totalFixFeaturesCreated: 0,
	};

	it("accepts state with protocolVersion", () => {
		expect(Value.Check(MissionStateSchema, { ...BASE_STATE, protocolVersion: 1 })).toBe(true);
	});

	it("accepts state with turnCount", () => {
		expect(Value.Check(MissionStateSchema, { ...BASE_STATE, turnCount: 5 })).toBe(true);
	});

	it("accepts state with both protocolVersion and turnCount", () => {
		expect(Value.Check(MissionStateSchema, { ...BASE_STATE, protocolVersion: 2, turnCount: 10 })).toBe(true);
	});

	it("accepts state without either (optional, backward compat)", () => {
		expect(Value.Check(MissionStateSchema, BASE_STATE)).toBe(true);
	});

	it("rejects non-number protocolVersion", () => {
		expect(Value.Check(MissionStateSchema, { ...BASE_STATE, protocolVersion: "one" })).toBe(false);
	});

	it("rejects non-number turnCount", () => {
		expect(Value.Check(MissionStateSchema, { ...BASE_STATE, turnCount: "five" })).toBe(false);
	});
});

describe("VAL-MIGRATION-001: existing state without protocolVersion loads correctly", () => {
	it("state without protocolVersion or turnCount is valid", () => {
		const state = {
			missionId: "old-mission",
			status: "executing",
			progressLog: [],
			startedAt: "2024-01-01T00:00:00.000Z",
			totalFeaturesCompleted: 5,
			totalFeaturesFailed: 0,
			totalFeaturesSkipped: 0,
			totalFixFeaturesCreated: 0,
		};
		expect(Value.Check(MissionStateSchema, state)).toBe(true);
	});
});

describe("WorkerHandoff derived from ReportResultSchema", () => {
	it("WorkerHandoff type accepts valid ReportResult data", () => {
		const handoff: WorkerHandoff = {
			whatWasImplemented: VALID_REPORT_RESULT.whatWasImplemented,
			whatWasLeftUndone: VALID_REPORT_RESULT.whatWasLeftUndone,
			commandsRun: VALID_REPORT_RESULT.commandsRun,
			testsAdded: VALID_REPORT_RESULT.testsAdded,
			discoveredIssues: VALID_REPORT_RESULT.discoveredIssues as WorkerHandoff["discoveredIssues"],
		};
		expect(Value.Check(ReportResultSchema, handoff)).toBe(true);
	});

	it("WorkerHandoff type round-trips through ReportResultSchema validation", () => {
		const handoff: WorkerHandoff = {
			whatWasImplemented: "Built feature",
			whatWasLeftUndone: "",
			commandsRun: [{ command: "bun test", exitCode: 0, observation: "pass" }],
			testsAdded: [{ file: "test.ts", cases: ["works"] }],
			discoveredIssues: [],
		};
		expect(Value.Check(ReportResultSchema, handoff)).toBe(true);
	});
});
