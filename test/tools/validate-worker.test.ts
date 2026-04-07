import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { savePlan, saveState } from "../../extensions/state/manager.js";
import { parseValidatorVerdict, parseVerdictFromText, runValidator } from "../../extensions/tools/validate-worker.js";
import type { WorkerResult } from "../../extensions/types.js";
import { makeFeature, makeMilestone, makePlan, makeState } from "../helpers/index.js";

function makeMessageEnd(role: string, text: string): string {
	return JSON.stringify({
		type: "message_end",
		message: { role, content: [{ type: "text", text }] },
	});
}

function makeStdout(lines: string[]): string {
	return lines.join("\n");
}

function makeWorkerResult(overrides: Partial<WorkerResult> = {}): WorkerResult {
	return {
		status: "success",
		summary: "Feature implemented successfully.",
		filesChanged: ["src/index.ts"],
		commandsRun: [],
		metrics: { durationMs: 5000 },
		...overrides,
	};
}

describe("parseVerdictFromText", () => {
	it("parses PASS verdict", () => {
		const result = parseVerdictFromText("Everything looks good.\n\nVERDICT: PASS\nFEEDBACK: All criteria met.");
		expect(result.verdict).toBe("pass");
		expect(result.feedback).toBe("All criteria met.");
	});

	it("parses FIX verdict with detailed feedback", () => {
		const result = parseVerdictFromText(
			"Issues found.\n\nVERDICT: FIX\nFEEDBACK: src/index.ts line 5 missing null check for empty input.",
		);
		expect(result.verdict).toBe("fix");
		expect(result.feedback).toContain("missing null check");
	});

	it("parses REJECT verdict", () => {
		const result = parseVerdictFromText(
			"Wrong approach.\n\nVERDICT: REJECT\nFEEDBACK: Should use a database instead of file storage.",
		);
		expect(result.verdict).toBe("reject");
		expect(result.feedback).toContain("database");
	});

	it("case-insensitive verdict parsing", () => {
		expect(parseVerdictFromText("verdict: pass\nfeedback: ok").verdict).toBe("pass");
		expect(parseVerdictFromText("VERDICT: fix\nFEEDBACK: fix it").verdict).toBe("fix");
		expect(parseVerdictFromText("Verdict: REJECT\nFeedback: bad").verdict).toBe("reject");
	});

	it("defaults to reject when no VERDICT found in strict mode", () => {
		const result = parseVerdictFromText("Some review text without a structured verdict.", "strict");
		expect(result.verdict).toBe("reject");
		expect(result.feedback).toContain("structured verdict");
	});

	it("defaults to pass when no VERDICT found in lenient mode", () => {
		const result = parseVerdictFromText("Some review text without a structured verdict.", "lenient");
		expect(result.verdict).toBe("pass");
		expect(result.feedback).toContain("assuming pass");
	});

	it("defaults to reject when no VERDICT found with no strictness specified (default is strict)", () => {
		const result = parseVerdictFromText("Some review text without a structured verdict.");
		expect(result.verdict).toBe("reject");
		expect(result.feedback).toContain("VERDICT");
	});

	it("handles empty text in strict mode", () => {
		const result = parseVerdictFromText("", "strict");
		expect(result.verdict).toBe("reject");
	});

	it("handles empty text in lenient mode", () => {
		const result = parseVerdictFromText("", "lenient");
		expect(result.verdict).toBe("pass");
	});

	it("handles multiline feedback", () => {
		const result = parseVerdictFromText("VERDICT: FIX\nFEEDBACK: Line 1 is wrong.\nLine 2 also bad.");
		expect(result.verdict).toBe("fix");
		expect(result.feedback).toContain("Line 1 is wrong");
	});
});

describe("parseValidatorVerdict", () => {
	it("extracts verdict from JSON stdout events", () => {
		const stdout = makeStdout([
			makeMessageEnd("assistant", "Reviewing code...\n\nVERDICT: PASS\nFEEDBACK: All acceptance criteria met."),
		]);
		const result = parseValidatorVerdict(stdout);
		expect(result.verdict).toBe("pass");
		expect(result.feedback).toContain("All acceptance criteria met");
	});

	it("uses last assistant message for verdict", () => {
		const stdout = makeStdout([
			makeMessageEnd("assistant", "Let me check the files first."),
			makeMessageEnd("assistant", "Done reviewing.\n\nVERDICT: FIX\nFEEDBACK: Missing error handling."),
		]);
		const result = parseValidatorVerdict(stdout);
		expect(result.verdict).toBe("fix");
		expect(result.feedback).toContain("Missing error handling");
	});

	it("defaults to reject on empty stdout in strict mode", () => {
		const result = parseValidatorVerdict("", "strict");
		expect(result.verdict).toBe("reject");
	});

	it("defaults to pass on empty stdout in lenient mode", () => {
		const result = parseValidatorVerdict("", "lenient");
		expect(result.verdict).toBe("pass");
	});

	it("defaults to reject when assistant message has no verdict in strict mode", () => {
		const stdout = makeStdout([makeMessageEnd("assistant", "Code looks fine to me.")]);
		const result = parseValidatorVerdict(stdout, "strict");
		expect(result.verdict).toBe("reject");
	});

	it("defaults to pass when assistant message has no verdict in lenient mode", () => {
		const stdout = makeStdout([makeMessageEnd("assistant", "Code looks fine to me.")]);
		const result = parseValidatorVerdict(stdout, "lenient");
		expect(result.verdict).toBe("pass");
	});

	it("explicit VERDICT overrides strictness mode", () => {
		const stdout = makeStdout([makeMessageEnd("assistant", "VERDICT: PASS\nFEEDBACK: Good.")]);
		const strictResult = parseValidatorVerdict(stdout, "strict");
		expect(strictResult.verdict).toBe("pass");
	});
});

describe("runValidator", () => {
	let tmpDir: string;

	function makeMockSpawn(stdoutLines: string[], exitCode = 0) {
		return (_command: string, _args: string[], _options: object) => {
			const stdoutHandlers: Array<(data: Buffer) => void> = [];
			const closeHandlers: Array<(code: number | null, signal: string | null) => void> = [];

			const proc = {
				stdout: {
					on: (event: string, handler: (data: Buffer) => void) => {
						if (event === "data") stdoutHandlers.push(handler);
					},
				},
				stderr: { on: (_event: string, _handler: (data: Buffer) => void) => {} },
				killed: false,
				kill: () => {
					proc.killed = true;
				},
				on: (event: string, handler: (...args: unknown[]) => void) => {
					if (event === "close")
						closeHandlers.push(handler as (code: number | null, signal: string | null) => void);
				},
			};

			setImmediate(() => {
				const joined = stdoutLines.join("\n");
				if (joined) for (const h of stdoutHandlers) h(Buffer.from(joined));
				for (const h of closeHandlers) h(exitCode, null);
			});

			return proc;
		};
	}

	function makeTimeoutSpawn() {
		return (_command: string, _args: string[], _options: object) => {
			let closeHandler: ((code: number | null, signal: string | null) => void) | null = null;

			const proc = {
				stdout: { on: () => {} },
				stderr: { on: () => {} },
				killed: false,
				pid: 99999,
				kill: (_signal?: string) => {
					proc.killed = true;
					if (closeHandler) setImmediate(() => closeHandler!(null, "SIGTERM"));
				},
				on: (event: string, handler: (...args: unknown[]) => void) => {
					if (event === "close") closeHandler = handler as (code: number | null, signal: string | null) => void;
				},
			};

			return proc;
		};
	}

	function makeNoVerdictSpawn() {
		return makeMockSpawn([makeMessageEnd("assistant", "Code looks fine but I could not determine a verdict.")]);
	}

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "validate-worker-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns pass when validator says PASS", async () => {
		const feature = makeFeature({ id: "f1", acceptanceCriteria: ["Works"] });
		const plan = makePlan({ milestones: [makeMilestone({ features: [feature] })] });
		saveState(tmpDir, makeState());
		savePlan(tmpDir, plan);

		const spawnFn = makeMockSpawn([
			makeMessageEnd("assistant", "All good.\n\nVERDICT: PASS\nFEEDBACK: Criteria satisfied."),
		]);

		const result = await runValidator(feature, makeWorkerResult(), {
			basePath: tmpDir,
			projectDir: tmpDir,
			spawnFn: spawnFn as any,
			plan,
			config: { models: { validator: "test-model" } },
		});

		expect(result.verdict).toBe("pass");
	});

	it("returns fix with feedback when validator says FIX", async () => {
		const feature = makeFeature({ id: "f1", acceptanceCriteria: ["Has tests"] });
		const plan = makePlan({ milestones: [makeMilestone({ features: [feature] })] });
		saveState(tmpDir, makeState());
		savePlan(tmpDir, plan);

		const spawnFn = makeMockSpawn([
			makeMessageEnd("assistant", "Missing tests.\n\nVERDICT: FIX\nFEEDBACK: No test file found for fizzbuzz."),
		]);

		const result = await runValidator(feature, makeWorkerResult(), {
			basePath: tmpDir,
			projectDir: tmpDir,
			spawnFn: spawnFn as any,
			plan,
			config: { models: { validator: "test-model" } },
		});

		expect(result.verdict).toBe("fix");
		expect(result.feedback).toContain("No test file found");
	});

	it("returns reject when validator says REJECT", async () => {
		const feature = makeFeature({ id: "f1" });
		const plan = makePlan({ milestones: [makeMilestone({ features: [feature] })] });
		saveState(tmpDir, makeState());
		savePlan(tmpDir, plan);

		const spawnFn = makeMockSpawn([makeMessageEnd("assistant", "VERDICT: REJECT\nFEEDBACK: Wrong architecture.")]);

		const result = await runValidator(feature, makeWorkerResult(), {
			basePath: tmpDir,
			projectDir: tmpDir,
			spawnFn: spawnFn as any,
			plan,
			config: { models: { validator: "test-model" } },
		});

		expect(result.verdict).toBe("reject");
	});

	it("uses configured validator model to spawn the review process", async () => {
		const feature = makeFeature({ id: "f1", acceptanceCriteria: ["Works"] });
		const plan = makePlan({ milestones: [makeMilestone({ features: [feature] })] });
		saveState(tmpDir, makeState());
		savePlan(tmpDir, plan);

		let capturedArgs: string[] = [];
		const spawnFn = makeMockSpawn([makeMessageEnd("assistant", "VERDICT: PASS\nFEEDBACK: Good.")]);
		const wrappedSpawn = (cmd: string, args: string[], opts: object) => {
			capturedArgs = args;
			return spawnFn(cmd, args, opts);
		};

		await runValidator(feature, makeWorkerResult(), {
			basePath: tmpDir,
			projectDir: tmpDir,
			spawnFn: wrappedSpawn as any,
			plan,
			config: { models: { validator: "my-validator-model" } },
		});

		expect(capturedArgs).toContain("--model");
		const modelIdx = capturedArgs.indexOf("--model");
		expect(capturedArgs[modelIdx + 1]).toBe("my-validator-model");
	});

	describe("strict mode (default)", () => {
		it("returns reject on timeout when validatorStrictness is strict", async () => {
			const feature = makeFeature({ id: "f1" });
			const plan = makePlan({ milestones: [makeMilestone({ features: [feature] })] });
			saveState(tmpDir, makeState());
			savePlan(tmpDir, plan);

			const spawnFn = makeTimeoutSpawn();

			const result = await runValidator(feature, makeWorkerResult(), {
				basePath: tmpDir,
				projectDir: tmpDir,
				spawnFn: spawnFn as any,
				plan,
				config: { models: { validator: "test-model" }, validatorStrictness: "strict", workerTimeoutMs: 100 },
				signal: AbortSignal.timeout(10),
			});

			expect(result.verdict).toBe("reject");
			expect(result.feedback).toMatch(/timed out|aborted/);
		});

		it("returns reject on timeout when validatorStrictness is undefined (default is strict)", async () => {
			const feature = makeFeature({ id: "f1" });
			const plan = makePlan({ milestones: [makeMilestone({ features: [feature] })] });
			saveState(tmpDir, makeState());
			savePlan(tmpDir, plan);

			const spawnFn = makeTimeoutSpawn();

			const result = await runValidator(feature, makeWorkerResult(), {
				basePath: tmpDir,
				projectDir: tmpDir,
				spawnFn: spawnFn as any,
				plan,
				config: { models: { validator: "test-model" }, workerTimeoutMs: 100 },
				signal: AbortSignal.timeout(10),
			});

			expect(result.verdict).toBe("reject");
		});

		it("returns reject on abort when validatorStrictness is strict", async () => {
			const feature = makeFeature({ id: "f1" });
			const plan = makePlan({ milestones: [makeMilestone({ features: [feature] })] });
			saveState(tmpDir, makeState());
			savePlan(tmpDir, plan);

			const controller = new AbortController();
			controller.abort();

			const spawnFn = makeTimeoutSpawn();

			const result = await runValidator(feature, makeWorkerResult(), {
				basePath: tmpDir,
				projectDir: tmpDir,
				spawnFn: spawnFn as any,
				plan,
				config: { models: { validator: "test-model" }, validatorStrictness: "strict" },
				signal: controller.signal,
			});

			expect(result.verdict).toBe("reject");
			expect(result.feedback).toMatch(/aborted|timed out/);
		});

		it("returns reject on missing verdict when validatorStrictness is strict", async () => {
			const feature = makeFeature({ id: "f1" });
			const plan = makePlan({ milestones: [makeMilestone({ features: [feature] })] });
			saveState(tmpDir, makeState());
			savePlan(tmpDir, plan);

			const spawnFn = makeNoVerdictSpawn();

			const result = await runValidator(feature, makeWorkerResult(), {
				basePath: tmpDir,
				projectDir: tmpDir,
				spawnFn: spawnFn as any,
				plan,
				config: { models: { validator: "test-model" }, validatorStrictness: "strict" },
			});

			expect(result.verdict).toBe("reject");
			expect(result.feedback).toContain("VERDICT");
		});

		it("returns reject on missing verdict when config has no validatorStrictness (default strict)", async () => {
			const feature = makeFeature({ id: "f1" });
			const plan = makePlan({ milestones: [makeMilestone({ features: [feature] })] });
			saveState(tmpDir, makeState());
			savePlan(tmpDir, plan);

			const spawnFn = makeNoVerdictSpawn();

			const result = await runValidator(feature, makeWorkerResult(), {
				basePath: tmpDir,
				projectDir: tmpDir,
				spawnFn: spawnFn as any,
				plan,
				config: { models: { validator: "test-model" } },
			});

			expect(result.verdict).toBe("reject");
		});
	});

	describe("lenient mode", () => {
		it("returns pass on timeout when validatorStrictness is lenient", async () => {
			const feature = makeFeature({ id: "f1" });
			const plan = makePlan({ milestones: [makeMilestone({ features: [feature] })] });
			saveState(tmpDir, makeState());
			savePlan(tmpDir, plan);

			const spawnFn = makeTimeoutSpawn();

			const result = await runValidator(feature, makeWorkerResult(), {
				basePath: tmpDir,
				projectDir: tmpDir,
				spawnFn: spawnFn as any,
				plan,
				config: { models: { validator: "test-model" }, validatorStrictness: "lenient", workerTimeoutMs: 100 },
				signal: AbortSignal.timeout(10),
			});

			expect(result.verdict).toBe("pass");
			expect(result.feedback).toContain("assuming pass");
		});

		it("returns pass on abort when validatorStrictness is lenient", async () => {
			const feature = makeFeature({ id: "f1" });
			const plan = makePlan({ milestones: [makeMilestone({ features: [feature] })] });
			saveState(tmpDir, makeState());
			savePlan(tmpDir, plan);

			const controller = new AbortController();
			controller.abort();

			const spawnFn = makeTimeoutSpawn();

			const result = await runValidator(feature, makeWorkerResult(), {
				basePath: tmpDir,
				projectDir: tmpDir,
				spawnFn: spawnFn as any,
				plan,
				config: { models: { validator: "test-model" }, validatorStrictness: "lenient" },
				signal: controller.signal,
			});

			expect(result.verdict).toBe("pass");
		});

		it("returns pass on missing verdict when validatorStrictness is lenient", async () => {
			const feature = makeFeature({ id: "f1" });
			const plan = makePlan({ milestones: [makeMilestone({ features: [feature] })] });
			saveState(tmpDir, makeState());
			savePlan(tmpDir, plan);

			const spawnFn = makeNoVerdictSpawn();

			const result = await runValidator(feature, makeWorkerResult(), {
				basePath: tmpDir,
				projectDir: tmpDir,
				spawnFn: spawnFn as any,
				plan,
				config: { models: { validator: "test-model" }, validatorStrictness: "lenient" },
			});

			expect(result.verdict).toBe("pass");
			expect(result.feedback).toContain("assuming pass");
		});
	});
});
