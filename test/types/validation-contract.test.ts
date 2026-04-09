import { describe, expect, it } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import { ValidationContractSchema } from "../../extensions/types.js";

describe("ValidationContractSchema", () => {
	const validAssertion = {
		id: "assert-1",
		featureId: "feature-1",
		type: "command",
		command: "bun test",
		expect: {
			exitCode: 0,
			stdoutContains: "pass",
			stdoutNotContains: "fail",
			stderrContains: "",
		},
		description: "Tests pass",
		status: "pending",
	};

	const validContract = {
		assertions: [validAssertion],
	};

	describe("VAL-CONTRACT-001: validates conforming contract objects", () => {
		it("accepts a fully-populated contract with all assertion fields", () => {
			expect(Value.Check(ValidationContractSchema, validContract)).toBe(true);
		});

		it("accepts contract with multiple assertions", () => {
			const contract = {
				assertions: [
					validAssertion,
					{
						id: "assert-2",
						featureId: "feature-2",
						type: "script",
						command: "node -e 'console.log(42)'",
						expect: { exitCode: 0 },
						description: "Script runs",
						status: "pending",
					},
				],
			};
			expect(Value.Check(ValidationContractSchema, contract)).toBe(true);
		});

		it("accepts assertion with minimal expect object (no optional fields)", () => {
			const contract = {
				assertions: [
					{
						id: "a1",
						featureId: "f1",
						type: "command",
						command: "echo hi",
						expect: {},
						description: "Minimal",
						status: "pending",
					},
				],
			};
			expect(Value.Check(ValidationContractSchema, contract)).toBe(true);
		});

		it("accepts all valid status values", () => {
			for (const status of ["pending", "pass", "fail", "error"] as const) {
				const contract = {
					assertions: [{ ...validAssertion, status }],
				};
				expect(Value.Check(ValidationContractSchema, contract)).toBe(true);
			}
		});

		it("accepts both command and script types", () => {
			for (const type of ["command", "script"] as const) {
				const contract = {
					assertions: [{ ...validAssertion, type }],
				};
				expect(Value.Check(ValidationContractSchema, contract)).toBe(true);
			}
		});

		it("accepts empty assertions array", () => {
			expect(Value.Check(ValidationContractSchema, { assertions: [] })).toBe(true);
		});
	});

	describe("VAL-CONTRACT-001: rejects non-conforming objects", () => {
		it("rejects object missing assertions", () => {
			expect(Value.Check(ValidationContractSchema, {})).toBe(false);
		});

		it("rejects assertion missing id", () => {
			const { id: _, ...noId } = validAssertion;
			expect(Value.Check(ValidationContractSchema, { assertions: [noId] })).toBe(false);
		});

		it("rejects assertion missing featureId", () => {
			const { featureId: _, ...noFeatureId } = validAssertion;
			expect(Value.Check(ValidationContractSchema, { assertions: [noFeatureId] })).toBe(false);
		});

		it("rejects assertion missing type", () => {
			const { type: _, ...noType } = validAssertion;
			expect(Value.Check(ValidationContractSchema, { assertions: [noType] })).toBe(false);
		});

		it("rejects assertion missing command", () => {
			const { command: _, ...noCommand } = validAssertion;
			expect(Value.Check(ValidationContractSchema, { assertions: [noCommand] })).toBe(false);
		});

		it("rejects assertion missing expect", () => {
			const { expect: _, ...noExpect } = validAssertion;
			expect(Value.Check(ValidationContractSchema, { assertions: [noExpect] })).toBe(false);
		});

		it("rejects assertion missing description", () => {
			const { description: _, ...noDesc } = validAssertion;
			expect(Value.Check(ValidationContractSchema, { assertions: [noDesc] })).toBe(false);
		});

		it("rejects assertion missing status", () => {
			const { status: _, ...noStatus } = validAssertion;
			expect(Value.Check(ValidationContractSchema, { assertions: [noStatus] })).toBe(false);
		});

		it("rejects invalid type value", () => {
			const contract = {
				assertions: [{ ...validAssertion, type: "invalid" }],
			};
			expect(Value.Check(ValidationContractSchema, contract)).toBe(false);
		});

		it("rejects invalid status value", () => {
			const contract = {
				assertions: [{ ...validAssertion, status: "running" }],
			};
			expect(Value.Check(ValidationContractSchema, contract)).toBe(false);
		});

		it("rejects non-string id", () => {
			const contract = {
				assertions: [{ ...validAssertion, id: 123 }],
			};
			expect(Value.Check(ValidationContractSchema, contract)).toBe(false);
		});

		it("rejects non-number exitCode in expect", () => {
			const contract = {
				assertions: [{ ...validAssertion, expect: { exitCode: "0" } }],
			};
			expect(Value.Check(ValidationContractSchema, contract)).toBe(false);
		});
	});
});
