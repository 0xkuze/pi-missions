import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveContract } from "../../extensions/state/manager.js";
import { type AssertionResult, runContractAssertions } from "../../extensions/tools/contract-runner.js";
import type { ExecFn } from "../../extensions/tools/run-validation.js";
import type { Feature, MissionPlan, ValidationAssertion, ValidationContract } from "../../extensions/types.js";

function makeAssertion(overrides: Partial<ValidationAssertion> = {}): ValidationAssertion {
	return {
		id: "a1",
		featureId: "f1",
		type: "command",
		command: "echo hello",
		expect: { exitCode: 0 },
		description: "echo hello exits 0",
		status: "pending",
		...overrides,
	};
}

function makeMockExec(
	responses: Array<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }>,
): { exec: ExecFn; calls: Array<{ cmd: string; cwd: string; timeoutMs: number }> } {
	const calls: Array<{ cmd: string; cwd: string; timeoutMs: number }> = [];
	let index = 0;
	const exec: ExecFn = async (cmd: string, cwd: string, timeoutMs: number) => {
		calls.push({ cmd, cwd, timeoutMs });
		const response = responses[index] ?? responses[responses.length - 1];
		index++;
		return response;
	};
	return { exec, calls };
}

describe("runContractAssertions", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "contract-runner-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("VAL-RUNNER-001: command-type assertions executed via exec", () => {
		it("executes command-type assertion and captures stdout/stderr/exitCode", async () => {
			const { exec, calls } = makeMockExec([{ exitCode: 0, stdout: "hello\n", stderr: "", timedOut: false }]);

			const assertions = [makeAssertion({ type: "command", command: "echo hello" })];
			const results = await runContractAssertions(assertions, exec, {
				basePath: tmpDir,
				milestoneId: "m1",
				projectDir: tmpDir,
			});

			expect(calls.length).toBe(1);
			expect(calls[0].cmd).toBe("echo hello");
			expect(results.length).toBe(1);
			expect(results[0].exitCode).toBe(0);
			expect(results[0].stdout).toBe("hello\n");
			expect(results[0].assertionId).toBe("a1");
		});
	});

	describe("VAL-RUNNER-002: script-type assertions executed identically", () => {
		it("executes script-type assertion via exec with same interface", async () => {
			const { exec, calls } = makeMockExec([{ exitCode: 0, stdout: "42\n", stderr: "", timedOut: false }]);

			const assertions = [makeAssertion({ type: "script", command: "node -e 'console.log(42)'" })];
			await runContractAssertions(assertions, exec, {
				basePath: tmpDir,
				milestoneId: "m1",
				projectDir: tmpDir,
			});

			expect(calls.length).toBe(1);
			expect(calls[0].cmd).toBe("node -e 'console.log(42)'");
		});
	});

	describe("VAL-RUNNER-003: exit code checked against expect.exitCode", () => {
		it("passes when exit code matches", async () => {
			const { exec } = makeMockExec([{ exitCode: 0, stdout: "", stderr: "", timedOut: false }]);

			const assertions = [makeAssertion({ expect: { exitCode: 0 } })];
			const results = await runContractAssertions(assertions, exec, {
				basePath: tmpDir,
				milestoneId: "m1",
				projectDir: tmpDir,
			});

			expect(results[0].status).toBe("pass");
		});

		it("fails when exit code does not match", async () => {
			const { exec } = makeMockExec([{ exitCode: 1, stdout: "", stderr: "", timedOut: false }]);

			const assertions = [makeAssertion({ expect: { exitCode: 0 } })];
			const results = await runContractAssertions(assertions, exec, {
				basePath: tmpDir,
				milestoneId: "m1",
				projectDir: tmpDir,
			});

			expect(results[0].status).toBe("fail");
		});

		it("passes when expecting non-zero exit code", async () => {
			const { exec } = makeMockExec([{ exitCode: 1, stdout: "", stderr: "", timedOut: false }]);

			const assertions = [makeAssertion({ expect: { exitCode: 1 } })];
			const results = await runContractAssertions(assertions, exec, {
				basePath: tmpDir,
				milestoneId: "m1",
				projectDir: tmpDir,
			});

			expect(results[0].status).toBe("pass");
		});
	});

	describe("VAL-RUNNER-004: stdout checked against expect.stdoutContains", () => {
		it("passes when stdout contains expected substring", async () => {
			const { exec } = makeMockExec([{ exitCode: 0, stdout: "build success in 2s", stderr: "", timedOut: false }]);

			const assertions = [makeAssertion({ expect: { exitCode: 0, stdoutContains: "success" } })];
			const results = await runContractAssertions(assertions, exec, {
				basePath: tmpDir,
				milestoneId: "m1",
				projectDir: tmpDir,
			});

			expect(results[0].status).toBe("pass");
		});

		it("fails when stdout does not contain expected substring", async () => {
			const { exec } = makeMockExec([{ exitCode: 0, stdout: "build failed", stderr: "", timedOut: false }]);

			const assertions = [makeAssertion({ expect: { exitCode: 0, stdoutContains: "success" } })];
			const results = await runContractAssertions(assertions, exec, {
				basePath: tmpDir,
				milestoneId: "m1",
				projectDir: tmpDir,
			});

			expect(results[0].status).toBe("fail");
		});

		it("passes when expected substring is only in stderr (npm/npx output)", async () => {
			const { exec } = makeMockExec([
				{ exitCode: 0, stdout: "", stderr: "Tests: 5 passed, 5 total", timedOut: false },
			]);

			const assertions = [makeAssertion({ expect: { exitCode: 0, stdoutContains: "passed" } })];
			const results = await runContractAssertions(assertions, exec, {
				basePath: tmpDir,
				milestoneId: "m1",
				projectDir: tmpDir,
			});

			expect(results[0].status).toBe("pass");
		});

		it("passes when expected substring spans both stdout and stderr", async () => {
			const { exec } = makeMockExec([
				{ exitCode: 0, stdout: "building...", stderr: "FizzBuzz output here", timedOut: false },
			]);

			const assertions = [makeAssertion({ expect: { exitCode: 0, stdoutContains: "FizzBuzz" } })];
			const results = await runContractAssertions(assertions, exec, {
				basePath: tmpDir,
				milestoneId: "m1",
				projectDir: tmpDir,
			});

			expect(results[0].status).toBe("pass");
		});
	});

	describe("VAL-RUNNER-005: stdout checked against expect.stdoutNotContains", () => {
		it("passes when stdout does not contain the excluded substring", async () => {
			const { exec } = makeMockExec([{ exitCode: 0, stdout: "all tests passed", stderr: "", timedOut: false }]);

			const assertions = [makeAssertion({ expect: { exitCode: 0, stdoutNotContains: "error" } })];
			const results = await runContractAssertions(assertions, exec, {
				basePath: tmpDir,
				milestoneId: "m1",
				projectDir: tmpDir,
			});

			expect(results[0].status).toBe("pass");
		});

		it("fails when stdout contains the excluded substring", async () => {
			const { exec } = makeMockExec([{ exitCode: 0, stdout: "found error in module", stderr: "", timedOut: false }]);

			const assertions = [makeAssertion({ expect: { exitCode: 0, stdoutNotContains: "error" } })];
			const results = await runContractAssertions(assertions, exec, {
				basePath: tmpDir,
				milestoneId: "m1",
				projectDir: tmpDir,
			});

			expect(results[0].status).toBe("fail");
		});

		it("fails when excluded substring is only in stderr", async () => {
			const { exec } = makeMockExec([
				{ exitCode: 0, stdout: "clean output", stderr: "found error in stderr", timedOut: false },
			]);

			const assertions = [makeAssertion({ expect: { exitCode: 0, stdoutNotContains: "error" } })];
			const results = await runContractAssertions(assertions, exec, {
				basePath: tmpDir,
				milestoneId: "m1",
				projectDir: tmpDir,
			});

			expect(results[0].status).toBe("fail");
		});
	});

	describe("VAL-RUNNER-006: stderr checked against expect.stderrContains", () => {
		it("passes when stderr contains expected substring", async () => {
			const { exec } = makeMockExec([
				{ exitCode: 0, stdout: "", stderr: "deprecation warning issued", timedOut: false },
			]);

			const assertions = [makeAssertion({ expect: { exitCode: 0, stderrContains: "warning" } })];
			const results = await runContractAssertions(assertions, exec, {
				basePath: tmpDir,
				milestoneId: "m1",
				projectDir: tmpDir,
			});

			expect(results[0].status).toBe("pass");
		});

		it("fails when stderr does not contain expected substring", async () => {
			const { exec } = makeMockExec([{ exitCode: 0, stdout: "", stderr: "", timedOut: false }]);

			const assertions = [makeAssertion({ expect: { exitCode: 0, stderrContains: "warning" } })];
			const results = await runContractAssertions(assertions, exec, {
				basePath: tmpDir,
				milestoneId: "m1",
				projectDir: tmpDir,
			});

			expect(results[0].status).toBe("fail");
		});
	});

	describe("VAL-RUNNER-007: individual assertion pass/fail tracked, all run regardless of failures", () => {
		it("runs all assertions even when one fails", async () => {
			const { exec } = makeMockExec([
				{ exitCode: 0, stdout: "ok", stderr: "", timedOut: false },
				{ exitCode: 1, stdout: "fail", stderr: "", timedOut: false },
				{ exitCode: 0, stdout: "ok", stderr: "", timedOut: false },
			]);

			const assertions = [
				makeAssertion({ id: "a1", expect: { exitCode: 0 } }),
				makeAssertion({ id: "a2", expect: { exitCode: 0 } }),
				makeAssertion({ id: "a3", expect: { exitCode: 0 } }),
			];
			const results = await runContractAssertions(assertions, exec, {
				basePath: tmpDir,
				milestoneId: "m1",
				projectDir: tmpDir,
			});

			expect(results.length).toBe(3);
			expect(results[0].assertionId).toBe("a1");
			expect(results[0].status).toBe("pass");
			expect(results[1].assertionId).toBe("a2");
			expect(results[1].status).toBe("fail");
			expect(results[2].assertionId).toBe("a3");
			expect(results[2].status).toBe("pass");
		});
	});

	describe("VAL-RUNNER-008: timeout handling per assertion", () => {
		it("returns error status with timedOut=true on timeout", async () => {
			const { exec } = makeMockExec([
				{ exitCode: null, stdout: "", stderr: "", timedOut: true },
				{ exitCode: 0, stdout: "ok", stderr: "", timedOut: false },
			]);

			const assertions = [makeAssertion({ id: "a1" }), makeAssertion({ id: "a2" })];
			const results = await runContractAssertions(assertions, exec, {
				basePath: tmpDir,
				milestoneId: "m1",
				projectDir: tmpDir,
			});

			expect(results[0].status).toBe("error");
			expect(results[0].timedOut).toBe(true);
			expect(results[1].status).toBe("pass");
		});
	});

	describe("VAL-RUNNER-011: contract assertions filtered by milestone features", () => {
		it("only runs assertions whose featureIds are in the provided milestoneFeatures list", async () => {
			const { exec, calls } = makeMockExec([{ exitCode: 0, stdout: "ok", stderr: "", timedOut: false }]);

			const assertions = [
				makeAssertion({ id: "a1", featureId: "f1" }),
				makeAssertion({ id: "a2", featureId: "f2" }),
			];
			const results = await runContractAssertions(assertions, exec, {
				basePath: tmpDir,
				milestoneId: "m1",
				projectDir: tmpDir,
				milestoneFeatureIds: ["f1"],
			});

			expect(calls.length).toBe(1);
			expect(results.length).toBe(1);
			expect(results[0].assertionId).toBe("a1");
		});
	});

	describe("VAL-RUNNER-012: contract updates assertion status after run", () => {
		it("updates contract file on disk with pass/fail statuses", async () => {
			const { exec } = makeMockExec([
				{ exitCode: 0, stdout: "ok", stderr: "", timedOut: false },
				{ exitCode: 1, stdout: "fail", stderr: "", timedOut: false },
			]);

			const contract: ValidationContract = {
				assertions: [
					makeAssertion({ id: "a1", expect: { exitCode: 0 } }),
					makeAssertion({ id: "a2", expect: { exitCode: 0 } }),
				],
			};
			saveContract(tmpDir, contract);

			await runContractAssertions(contract.assertions, exec, {
				basePath: tmpDir,
				milestoneId: "m1",
				projectDir: tmpDir,
				updateContract: true,
			});

			const raw = readFileSync(join(tmpDir, "validation-contract.json"), "utf8");
			const updated = JSON.parse(raw) as ValidationContract;
			expect(updated.assertions[0].status).toBe("pass");
			expect(updated.assertions[1].status).toBe("fail");
		});
	});

	describe("VAL-RUNNER-013: assertions for skipped/blocked features not executed", () => {
		it("skips assertions for features in the skippedFeatures set", async () => {
			const { exec, calls } = makeMockExec([{ exitCode: 0, stdout: "ok", stderr: "", timedOut: false }]);

			const assertions = [
				makeAssertion({ id: "a1", featureId: "f1" }),
				makeAssertion({ id: "a2", featureId: "f2" }),
				makeAssertion({ id: "a3", featureId: "f3" }),
			];
			const results = await runContractAssertions(assertions, exec, {
				basePath: tmpDir,
				milestoneId: "m1",
				projectDir: tmpDir,
				milestoneFeatureIds: ["f1", "f2", "f3"],
				skippedFeatureIds: new Set(["f2", "f3"]),
			});

			expect(calls.length).toBe(1);
			expect(results.length).toBe(1);
			expect(results[0].assertionId).toBe("a1");
		});

		it("skips assertions for features in the blockedFeatures set", async () => {
			const { exec, calls } = makeMockExec([{ exitCode: 0, stdout: "ok", stderr: "", timedOut: false }]);

			const assertions = [
				makeAssertion({ id: "a1", featureId: "f1" }),
				makeAssertion({ id: "a2", featureId: "f2" }),
			];
			const results = await runContractAssertions(assertions, exec, {
				basePath: tmpDir,
				milestoneId: "m1",
				projectDir: tmpDir,
				milestoneFeatureIds: ["f1", "f2"],
				blockedFeatureIds: new Set(["f2"]),
			});

			expect(calls.length).toBe(1);
			expect(results.length).toBe(1);
			expect(results[0].assertionId).toBe("a1");
		});
	});

	describe("VAL-EVIDENCE-001: evidence files written per assertion", () => {
		it("writes stdout.log, stderr.log per assertion", async () => {
			const { exec } = makeMockExec([
				{ exitCode: 0, stdout: "hello output", stderr: "no error", timedOut: false },
				{ exitCode: 0, stdout: "world output", stderr: "", timedOut: false },
			]);

			const assertions = [makeAssertion({ id: "a1" }), makeAssertion({ id: "a2" })];
			await runContractAssertions(assertions, exec, {
				basePath: tmpDir,
				milestoneId: "m1",
				projectDir: tmpDir,
			});

			const evidenceDir = join(tmpDir, "runtime", "validation", "m1", "assertions");
			expect(existsSync(join(evidenceDir, "a1-stdout.log"))).toBe(true);
			expect(existsSync(join(evidenceDir, "a1-stderr.log"))).toBe(true);
			expect(existsSync(join(evidenceDir, "a2-stdout.log"))).toBe(true);
			expect(existsSync(join(evidenceDir, "a2-stderr.log"))).toBe(true);

			expect(readFileSync(join(evidenceDir, "a1-stdout.log"), "utf8")).toBe("hello output");
			expect(readFileSync(join(evidenceDir, "a1-stderr.log"), "utf8")).toBe("no error");
			expect(readFileSync(join(evidenceDir, "a2-stdout.log"), "utf8")).toBe("world output");
		});
	});

	describe("VAL-EVIDENCE-003: result.json includes all required fields", () => {
		it("writes result.json with assertionId, command, exitCode, timestamp, status, durationMs", async () => {
			const { exec } = makeMockExec([{ exitCode: 0, stdout: "ok", stderr: "", timedOut: false }]);

			const assertions = [makeAssertion({ id: "a1", command: "echo hello" })];
			const results = await runContractAssertions(assertions, exec, {
				basePath: tmpDir,
				milestoneId: "m1",
				projectDir: tmpDir,
			});

			const evidenceDir = join(tmpDir, "runtime", "validation", "m1", "assertions");
			expect(existsSync(join(evidenceDir, "a1-result.json"))).toBe(true);

			const resultJson = JSON.parse(readFileSync(join(evidenceDir, "a1-result.json"), "utf8"));
			expect(resultJson.assertionId).toBe("a1");
			expect(resultJson.command).toBe("echo hello");
			expect(typeof resultJson.exitCode).toBe("number");
			expect(resultJson.exitCode).toBe(0);
			expect(typeof resultJson.timestamp).toBe("string");
			expect(new Date(resultJson.timestamp).toISOString()).toBe(resultJson.timestamp);
			expect(resultJson.status).toBe("pass");
			expect(typeof resultJson.durationMs).toBe("number");
			expect(resultJson.durationMs).toBeGreaterThanOrEqual(0);
			expect(typeof resultJson.stdout).toBe("string");
			expect(typeof resultJson.stderr).toBe("string");
		});
	});

	describe("combined expect checks", () => {
		it("passes only when all expect conditions are satisfied", async () => {
			const { exec } = makeMockExec([
				{
					exitCode: 0,
					stdout: "build success",
					stderr: "warning: deprecated",
					timedOut: false,
				},
			]);

			const assertions = [
				makeAssertion({
					expect: {
						exitCode: 0,
						stdoutContains: "success",
						stdoutNotContains: "error",
						stderrContains: "warning",
					},
				}),
			];
			const results = await runContractAssertions(assertions, exec, {
				basePath: tmpDir,
				milestoneId: "m1",
				projectDir: tmpDir,
			});

			expect(results[0].status).toBe("pass");
		});

		it("fails when any single expect condition fails", async () => {
			const { exec } = makeMockExec([
				{
					exitCode: 0,
					stdout: "build success with error",
					stderr: "warning: deprecated",
					timedOut: false,
				},
			]);

			const assertions = [
				makeAssertion({
					expect: {
						exitCode: 0,
						stdoutContains: "success",
						stdoutNotContains: "error",
					},
				}),
			];
			const results = await runContractAssertions(assertions, exec, {
				basePath: tmpDir,
				milestoneId: "m1",
				projectDir: tmpDir,
			});

			expect(results[0].status).toBe("fail");
		});
	});

	describe("no assertions", () => {
		it("returns empty results when assertions array is empty", async () => {
			const { exec } = makeMockExec([]);
			const results = await runContractAssertions([], exec, {
				basePath: tmpDir,
				milestoneId: "m1",
				projectDir: tmpDir,
			});

			expect(results.length).toBe(0);
		});
	});

	describe("default timeout", () => {
		it("uses default timeout of 120000ms when not specified", async () => {
			const { exec, calls } = makeMockExec([{ exitCode: 0, stdout: "", stderr: "", timedOut: false }]);

			await runContractAssertions([makeAssertion()], exec, {
				basePath: tmpDir,
				milestoneId: "m1",
				projectDir: tmpDir,
			});

			expect(calls[0].timeoutMs).toBe(120000);
		});

		it("uses custom timeout when specified", async () => {
			const { exec, calls } = makeMockExec([{ exitCode: 0, stdout: "", stderr: "", timedOut: false }]);

			await runContractAssertions([makeAssertion()], exec, {
				basePath: tmpDir,
				milestoneId: "m1",
				projectDir: tmpDir,
				timeoutMs: 30000,
			});

			expect(calls[0].timeoutMs).toBe(30000);
		});
	});
});
