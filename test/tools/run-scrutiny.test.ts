import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initLibrary, writeLibraryTopic } from "../../extensions/state/library.js";
import { saveConfig, saveContract, savePlan, saveState } from "../../extensions/state/manager.js";
import {
	parseScrutinyOutput,
	registerRunScrutinyTool,
	type ScrutinyIssue,
	type ScrutinyReport,
} from "../../extensions/tools/run-scrutiny.js";
import type { MissionPlan, MissionState, ValidationContract } from "../../extensions/types.js";
import {
	createMockContext,
	createMockPi,
	makeFeature,
	makeMilestone,
	makePlan,
	makeState,
	makeWorkerAttempt,
	type ToolResult,
} from "../helpers/index.js";
import { createMockSpawn, type SpawnFn } from "../helpers/utils.js";

function localMakePlan(overrides: Partial<MissionPlan> = {}): MissionPlan {
	return makePlan({
		milestones: [
			makeMilestone({
				id: "ms-1",
				name: "Foundation",
				description: "Core milestone",
				features: [
					makeFeature({
						id: "feat-1",
						name: "Feature One",
						description: "Implement feature one",
						acceptanceCriteria: ["Works correctly", "Tests pass"],
						status: "done",
						attempts: [
							makeWorkerAttempt({
								status: "success",
								resultPath: "",
							}),
						],
					}),
					makeFeature({
						id: "feat-2",
						name: "Feature Two",
						description: "Implement feature two",
						acceptanceCriteria: ["Handles errors"],
						status: "done",
						attempts: [
							makeWorkerAttempt({
								status: "success",
								resultPath: "",
							}),
						],
					}),
				],
				status: "active",
			}),
		],
		validationCommands: ["echo test"],
		...overrides,
	});
}

function makeContract(assertions: ValidationContract["assertions"] = []): ValidationContract {
	return { assertions };
}

function makeScrutinyNdjson(issues: ScrutinyIssue[]): string {
	const lines = [
		JSON.stringify({ type: "message_start" }),
		JSON.stringify({ type: "tool_execution_start", toolName: "bash" }),
		JSON.stringify({ type: "tool_execution_end", toolName: "bash" }),
		JSON.stringify({
			type: "message_end",
			text: JSON.stringify({ issues }),
		}),
	];
	return lines.join("\n");
}

interface CallToolOptions {
	state?: MissionState;
	plan?: MissionPlan;
	contract?: ValidationContract;
	spawnFn?: SpawnFn;
	updateWidget?: (state: MissionState, plan?: MissionPlan) => void;
	reviewerModel?: string;
}

async function callTool(
	basePath: string,
	params: { milestoneId: string },
	options: CallToolOptions = {},
): Promise<ToolResult> {
	const {
		state = makeState(),
		plan = localMakePlan(),
		contract,
		spawnFn,
		updateWidget = () => {},
		reviewerModel,
	} = options;

	saveState(basePath, state);
	savePlan(basePath, plan);
	if (contract) saveContract(basePath, contract);
	if (reviewerModel) {
		saveConfig(basePath, { models: { validator: reviewerModel } });
	}

	const { pi, getRegisteredTool } = createMockPi();
	registerRunScrutinyTool(pi, {
		basePath,
		projectDir: basePath,
		updateWidget,
		spawnFn: spawnFn ?? createMockSpawn({ stdoutLines: [makeScrutinyNdjson([])] }),
	});
	const tool = getRegisteredTool("run_scrutiny")!;
	return tool.execute("tool-call-id", params, undefined, undefined, createMockContext()) as Promise<ToolResult>;
}

describe("registerRunScrutinyTool", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "run-scrutiny-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("VAL-SCRUTINY-001: tool spawns reviewer pi process", () => {
		it("spawns pi process with correct arguments", async () => {
			const capturedArgs: { command: string; args: string[] }[] = [];
			const mockSpawn: SpawnFn = (_command, args, _opts) => {
				capturedArgs.push({ command: _command, args });
				return createMockSpawn({
					stdoutLines: [makeScrutinyNdjson([])],
				})(_command, args, _opts);
			};

			await callTool(tmpDir, { milestoneId: "ms-1" }, { spawnFn: mockSpawn });

			expect(capturedArgs.length).toBe(1);
			const callArgs = capturedArgs[0].args;
			expect(callArgs).toContain("--mode");
			expect(callArgs).toContain("json");
			expect(callArgs).toContain("-p");
			expect(callArgs).toContain("--no-session");
			const skillIdx = callArgs.indexOf("--skill");
			expect(skillIdx).toBeGreaterThanOrEqual(0);
			expect(callArgs[skillIdx + 1]).toMatch(/scrutiny-skill\.md$/);
		});

		it("uses reviewer model from config", async () => {
			const capturedArgs: { command: string; args: string[] }[] = [];
			const mockSpawn: SpawnFn = (_command, args, _opts) => {
				capturedArgs.push({ command: _command, args });
				return createMockSpawn({
					stdoutLines: [makeScrutinyNdjson([])],
				})(_command, args, _opts);
			};

			await callTool(tmpDir, { milestoneId: "ms-1" }, { spawnFn: mockSpawn, reviewerModel: "custom-reviewer" });

			const callArgs = capturedArgs[0].args;
			const modelIdx = callArgs.indexOf("--model");
			expect(modelIdx).toBeGreaterThanOrEqual(0);
			expect(callArgs[modelIdx + 1]).toBe("custom-reviewer");
		});
	});

	describe("VAL-SCRUTINY-002: reviewer receives changed files list", () => {
		it("includes changed files from all features in milestone", async () => {
			const plan = localMakePlan({
				milestones: [
					makeMilestone({
						id: "ms-1",
						name: "Foundation",
						features: [
							makeFeature({
								id: "feat-1",
								relevantFiles: ["a.ts", "b.ts"],
								status: "done",
							}),
							makeFeature({
								id: "feat-2",
								relevantFiles: ["c.ts"],
								status: "done",
							}),
						],
						status: "active",
					}),
				],
			});

			let capturedSkillContent = "";
			const mockSpawn: SpawnFn = (_command, args, _opts) => {
				const skillIdx = args.indexOf("--skill");
				if (skillIdx >= 0) {
					const skillPath = args[skillIdx + 1];
					try {
						capturedSkillContent = readFileSync(skillPath, "utf8");
					} catch {
						// skill file may not exist in test
					}
				}
				return createMockSpawn({
					stdoutLines: [makeScrutinyNdjson([])],
				})(_command, args, _opts);
			};

			await callTool(tmpDir, { milestoneId: "ms-1" }, { plan, spawnFn: mockSpawn });

			expect(capturedSkillContent).toContain("a.ts");
			expect(capturedSkillContent).toContain("b.ts");
			expect(capturedSkillContent).toContain("c.ts");
		});
	})

	describe("VAL-SCRUTINY-003: reviewer receives plan with criteria and validation contract", () => {
		it("includes milestone description, feature criteria, and contract assertions", async () => {
			const plan = localMakePlan({
				milestones: [
					makeMilestone({
						id: "ms-1",
						name: "Foundation",
						description: "Core foundation milestone",
						features: [
							makeFeature({
								id: "feat-1",
								name: "Feature One",
								acceptanceCriteria: ["Works correctly", "Tests pass"],
								status: "done",
							}),
						],
						status: "active",
					}),
				],
			});

			const contract = makeContract([
				{
					id: "VAL-TEST-001",
					featureId: "feat-1",
					type: "command",
					command: "bun test",
					expect: { exitCode: 0 },
					description: "All tests pass",
					status: "pending",
				},
			]);

			let capturedSkillContent = "";
			const mockSpawn: SpawnFn = (_command, args, _opts) => {
				const skillIdx = args.indexOf("--skill");
				if (skillIdx >= 0) {
					const skillPath = args[skillIdx + 1];
					try {
						capturedSkillContent = readFileSync(skillPath, "utf8");
					} catch {
						// skill file may not exist in test
					}
				}
				return createMockSpawn({
					stdoutLines: [makeScrutinyNdjson([])],
				})(_command, args, _opts);
			};

			await callTool(tmpDir, { milestoneId: "ms-1" }, { plan, contract, spawnFn: mockSpawn });

			expect(capturedSkillContent).toContain("Core foundation milestone");
			expect(capturedSkillContent).toContain("Works correctly");
			expect(capturedSkillContent).toContain("Tests pass");
			expect(capturedSkillContent).toContain("VAL-TEST-001");
			expect(capturedSkillContent).toContain("All tests pass");
		});
	})

	describe("VAL-SCRUTINY-004: reviewer receives library context", () => {
		it("includes pitfalls and conventions from library", async () => {
			initLibrary(tmpDir);
			writeLibraryTopic(tmpDir, "pitfalls", "# Pitfalls\n\nNever use global state");
			writeLibraryTopic(tmpDir, "conventions", "# Conventions\n\nUse camelCase");

			let capturedSkillContent = "";
			const mockSpawn: SpawnFn = (_command, args, _opts) => {
				const skillIdx = args.indexOf("--skill");
				if (skillIdx >= 0) {
					const skillPath = args[skillIdx + 1];
					try {
						capturedSkillContent = readFileSync(skillPath, "utf8");
					} catch {
						// skill file may not exist in test
					}
				}
				return createMockSpawn({
					stdoutLines: [makeScrutinyNdjson([])],
				})(_command, args, _opts);
			};

			await callTool(tmpDir, { milestoneId: "ms-1" }, { spawnFn: mockSpawn });

			expect(capturedSkillContent).toContain("Never use global state");
			expect(capturedSkillContent).toContain("Use camelCase");
		});
	})

	describe("VAL-SCRUTINY-005: reviewer produces structured report", () => {
		it("parses issues with severity, description, location, suggestedFix", async () => {
			const issues: ScrutinyIssue[] = [
				{
					severity: "error",
					description: "Missing error handling in utils",
					location: "extensions/utils.ts:42",
					suggestedFix: "Add try-catch wrapper",
				},
				{
					severity: "warning",
					description: "Duplicate logic in two modules",
					location: "extensions/state/manager.ts:100",
				},
			];

			const mockSpawn = createMockSpawn({
				stdoutLines: [makeScrutinyNdjson(issues)],
			});

			const result = await callTool(tmpDir, { milestoneId: "ms-1" }, { spawnFn: mockSpawn });
			const parsed = JSON.parse(result.content[0].text) as ScrutinyReport;

			expect(parsed.issues.length).toBe(2);
			expect(parsed.issues[0].severity).toBe("error");
			expect(parsed.issues[0].description).toBe("Missing error handling in utils");
			expect(parsed.issues[0].location).toBe("extensions/utils.ts:42");
			expect(parsed.issues[0].suggestedFix).toBe("Add try-catch wrapper");
			expect(parsed.issues[1].severity).toBe("warning");
			expect(parsed.issues[1].suggestedFix).toBeUndefined();
		});
	})

	describe("VAL-SCRUTINY-006: scrutiny report written to runtime directory", () => {
		it("writes report.json and stdout.log to runtime/validation/{milestoneId}/scrutiny/", async () => {
			const issues: ScrutinyIssue[] = [
				{ severity: "info", description: "Consider refactoring", location: "a.ts" },
			];

			const mockSpawn = createMockSpawn({
				stdoutLines: [makeScrutinyNdjson(issues)],
			});

			await callTool(tmpDir, { milestoneId: "ms-1" }, { spawnFn: mockSpawn });

			const reportPath = join(tmpDir, "runtime", "validation", "ms-1", "scrutiny", "report.json");
			const stdoutPath = join(tmpDir, "runtime", "validation", "ms-1", "scrutiny", "stdout.log");

			expect(existsSync(reportPath)).toBe(true);
			expect(existsSync(stdoutPath)).toBe(true);

			const report = JSON.parse(readFileSync(reportPath, "utf8")) as ScrutinyReport;
			expect(report.issues.length).toBe(1);
			expect(report.issues[0].severity).toBe("info");
			expect(report.milestoneId).toBe("ms-1");
			expect(typeof report.timestamp).toBe("string");
			expect(typeof report.durationMs).toBe("number");
		});
	})

	describe("VAL-SCRUTINY-009: handles reviewer timeout gracefully", () => {
		it("returns warning result on timeout without crashing", async () => {
			const mockSpawn: SpawnFn = () => {
				const stdoutHandlers: Array<(data: Buffer) => void> = [];
				const stderrHandlers: Array<(data: Buffer) => void> = [];
				const closeHandlers: Array<(code: number | null, signal: string | null) => void> = [];

				const proc = {
					stdout: {
						on: (event: string, handler: (data: Buffer) => void) => {
							if (event === "data") stdoutHandlers.push(handler);
						},
					},
					stderr: {
						on: (event: string, handler: (data: Buffer) => void) => {
							if (event === "data") stderrHandlers.push(handler);
						},
					},
					on: (event: string, handler: (...args: unknown[]) => void) => {
						if (event === "close") closeHandlers.push(handler as (code: number | null, signal: string | null) => void);
					},
				};

				return proc as unknown as ReturnType<SpawnFn>;
			};

			const state = makeState();
			const plan = localMakePlan();
			saveState(tmpDir, state);
			savePlan(tmpDir, plan);

			const { pi, getRegisteredTool } = createMockPi();
			registerRunScrutinyTool(pi, {
				basePath: tmpDir,
				projectDir: tmpDir,
				updateWidget: () => {},
				spawnFn: mockSpawn,
				_timeoutMs: 50,
			});
			const tool = getRegisteredTool("run_scrutiny")!;
			const result = (await tool.execute(
				"tool-call-id",
				{ milestoneId: "ms-1" },
				undefined,
				undefined,
				createMockContext(),
			)) as ToolResult;

			const text = result.content[0].text;
			expect(text).toMatch(/timeout|timed out/i);
		});

		it("calls proc.kill('SIGTERM') on timeout to prevent orphaned processes", async () => {
			const killCalls: string[] = [];

			const mockSpawn: SpawnFn = () => {
				const proc = {
					stdout: {
						on: () => {},
					},
					stderr: {
						on: () => {},
					},
					killed: false,
					kill: (signal: string) => {
						proc.killed = true;
						killCalls.push(signal);
					},
					on: () => {},
				};

				return proc as unknown as ReturnType<SpawnFn>;
			};

			const state = makeState();
			const plan = localMakePlan();
			saveState(tmpDir, state);
			savePlan(tmpDir, plan);

			const { pi, getRegisteredTool } = createMockPi();
			registerRunScrutinyTool(pi, {
				basePath: tmpDir,
				projectDir: tmpDir,
				updateWidget: () => {},
				spawnFn: mockSpawn,
				_timeoutMs: 50,
			});
			const tool = getRegisteredTool("run_scrutiny")!;
			await tool.execute("tool-call-id", { milestoneId: "ms-1" }, undefined, undefined, createMockContext());

			expect(killCalls.length).toBeGreaterThanOrEqual(1);
			expect(killCalls[0]).toBe("SIGTERM");
		});
	})

	describe("VAL-SCRUTINY-010: parses empty/no-issues output", () => {
		it("returns clean status with empty issues array", async () => {
			const mockSpawn = createMockSpawn({
				stdoutLines: [makeScrutinyNdjson([])],
			});

			const result = await callTool(tmpDir, { milestoneId: "ms-1" }, { spawnFn: mockSpawn });
			const parsed = JSON.parse(result.content[0].text) as ScrutinyReport;

			expect(parsed.issues.length).toBe(0);
			expect(parsed.status).toBe("clean");
		});
	})

	describe("VAL-RUNNER-014: handles malformed output", () => {
		it("returns graceful error with empty issues for unparseable output", async () => {
			const mockSpawn = createMockSpawn({
				stdoutLines: ["this is not valid json at all!!!{{{"],
			});

			const result = await callTool(tmpDir, { milestoneId: "ms-1" }, { spawnFn: mockSpawn });
			const parsed = JSON.parse(result.content[0].text) as ScrutinyReport;

			expect(parsed.issues.length).toBe(0);
			expect(parsed.status).toBe("error");
		});

		it("handles binary/truncated data", async () => {
			const mockSpawn = createMockSpawn({
				stdoutLines: ["\x00\x01\x02\x03binary garbage"],
			});

			const result = await callTool(tmpDir, { milestoneId: "ms-1" }, { spawnFn: mockSpawn });
			const parsed = JSON.parse(result.content[0].text) as ScrutinyReport;

			expect(parsed.issues.length).toBe(0);
			expect(parsed.status).toBe("error");
		});
	})

	describe("VAL-TOOLREG-003: tool registered via registerTool", () => {
		it("is registered with correct schema requiring milestoneId", () => {
			const { pi, getRegisteredTool } = createMockPi();
			registerRunScrutinyTool(pi, {
				basePath: tmpDir,
				projectDir: tmpDir,
				updateWidget: () => {},
				spawnFn: createMockSpawn(),
			});

			const tool = getRegisteredTool("run_scrutiny");
			expect(tool).toBeDefined();
			expect(tool!.name).toBe("run_scrutiny");
			expect(tool!.parameters).toBeDefined();
		});
	})

	describe("VAL-TOOLREG-004: rejects invalid milestone ID", () => {
		it("returns error for nonexistent milestone ID", async () => {
			const result = await callTool(tmpDir, { milestoneId: "nonexistent" });

			expect(result.content[0].text).toMatch(/error|not found/i);
		});
	})

	describe("precondition checks", () => {
		it("returns error when no state exists", async () => {
			const { pi, getRegisteredTool } = createMockPi();
			registerRunScrutinyTool(pi, {
				basePath: tmpDir,
				projectDir: tmpDir,
				updateWidget: () => {},
				spawnFn: createMockSpawn(),
			});
			const tool = getRegisteredTool("run_scrutiny")!;
			const result = (await tool.execute(
				"id",
				{ milestoneId: "ms-1" },
				undefined,
				undefined,
				createMockContext(),
			)) as ToolResult;

			expect(result.content[0].text).toContain("Error");
		});

		it("returns error when state is not executing", async () => {
			saveState(tmpDir, makeState({ status: "planning" }));
			savePlan(tmpDir, localMakePlan());

			const result = await callTool(tmpDir, { milestoneId: "ms-1" }, {
				state: makeState({ status: "planning" }),
			});

			expect(result.content[0].text).toMatch(/error|executing/i);
		});

		it("returns error when no plan found", async () => {
			saveState(tmpDir, makeState());

			const { pi, getRegisteredTool } = createMockPi();
			registerRunScrutinyTool(pi, {
				basePath: tmpDir,
				projectDir: tmpDir,
				updateWidget: () => {},
				spawnFn: createMockSpawn(),
			});
			const tool = getRegisteredTool("run_scrutiny")!;
			const result = (await tool.execute(
				"id",
				{ milestoneId: "ms-1" },
				undefined,
				undefined,
				createMockContext(),
			)) as ToolResult;

			expect(result.content[0].text).toMatch(/error|no plan/i);
		});
	});

	describe("VAL-CROSS-006: reviewer has access to validation contract assertions", () => {
		it("receives contract assertions for current milestone", async () => {
			const contract = makeContract([
				{
					id: "VAL-CROSS-001",
					featureId: "feat-1",
					type: "command",
					command: "bun test",
					expect: { exitCode: 0 },
					description: "All tests pass",
					status: "pending",
				},
				{
					id: "VAL-CROSS-002",
					featureId: "feat-2",
					type: "command",
					command: "echo ok",
					expect: { stdoutContains: "ok" },
					description: "Echo works",
					status: "pending",
				},
			]);

			let capturedSkillContent = "";
			const mockSpawn: SpawnFn = (_command, args, _opts) => {
				const skillIdx = args.indexOf("--skill");
				if (skillIdx >= 0) {
					const skillPath = args[skillIdx + 1];
					try {
						capturedSkillContent = readFileSync(skillPath, "utf8");
					} catch {
						// skill file may not exist in test
					}
				}
				return createMockSpawn({
					stdoutLines: [makeScrutinyNdjson([])],
				})(_command, args, _opts);
			};

			await callTool(tmpDir, { milestoneId: "ms-1" }, { contract, spawnFn: mockSpawn });

			expect(capturedSkillContent).toContain("VAL-CROSS-001");
			expect(capturedSkillContent).toContain("All tests pass");
			expect(capturedSkillContent).toContain("VAL-CROSS-002");
			expect(capturedSkillContent).toContain("Echo works");
		});

		it("proceeds without error when no contract file exists", async () => {
			const mockSpawn = createMockSpawn({
				stdoutLines: [makeScrutinyNdjson([])],
			});

			const result = await callTool(tmpDir, { milestoneId: "ms-1" }, { spawnFn: mockSpawn });
			const parsed = JSON.parse(result.content[0].text) as ScrutinyReport;

			expect(parsed.issues.length).toBe(0);
			expect(parsed.status).toBe("clean");
		});
	})

	describe("VAL-CROSS-009: worker handoff data available in scrutiny review", () => {
		it("includes worker summaries from completed features", async () => {
			const plan = localMakePlan({
				milestones: [
					makeMilestone({
						id: "ms-1",
						name: "Foundation",
						features: [
							makeFeature({
								id: "feat-1",
								name: "Feature One",
								description: "Implement feature one",
								status: "done",
								attempts: [
									makeWorkerAttempt({
										status: "success",
										resultPath: join(tmpDir, "runtime", "feat-1", "1", "result.json"),
									}),
								],
							}),
						],
						status: "active",
					}),
				],
			});

			mkdirSync(join(tmpDir, "runtime", "feat-1", "1"), { recursive: true });
			writeFileSync(
				join(tmpDir, "runtime", "feat-1", "1", "result.json"),
				JSON.stringify({
					status: "success",
					summary: "Added retry logic",
					filesChanged: ["retry.ts"],
					handoff: {
						whatWasImplemented: "Retry logic",
						discoveredIssues: [{ severity: "low", description: "Minor log noise" }],
					},
				}),
				"utf8",
			);

			let capturedSkillContent = "";
			const mockSpawn: SpawnFn = (_command, args, _opts) => {
				const skillIdx = args.indexOf("--skill");
				if (skillIdx >= 0) {
					const skillPath = args[skillIdx + 1];
					try {
						capturedSkillContent = readFileSync(skillPath, "utf8");
					} catch {
						// skill file may not exist in test
					}
				}
				return createMockSpawn({
					stdoutLines: [makeScrutinyNdjson([])],
				})(_command, args, _opts);
			};

			await callTool(tmpDir, { milestoneId: "ms-1" }, { plan, spawnFn: mockSpawn });

			expect(capturedSkillContent).toContain("Added retry logic");
			expect(capturedSkillContent).toContain("retry.ts");
		});
	})

	describe("VAL-EVIDENCE-004: scrutiny report stored as evidence", () => {
		it("report.json contains milestoneId, timestamp, issues, reviewerModel, durationMs", async () => {
			const mockSpawn = createMockSpawn({
				stdoutLines: [makeScrutinyNdjson([])],
			});

			await callTool(
				tmpDir,
				{ milestoneId: "ms-1" },
				{ spawnFn: mockSpawn, reviewerModel: "test-reviewer-model" },
			);

			const reportPath = join(tmpDir, "runtime", "validation", "ms-1", "scrutiny", "report.json");
			expect(existsSync(reportPath)).toBe(true);

			const report = JSON.parse(readFileSync(reportPath, "utf8")) as ScrutinyReport;
			expect(report.milestoneId).toBe("ms-1");
			expect(typeof report.timestamp).toBe("string");
			expect(Array.isArray(report.issues)).toBe(true);
			expect(report.reviewerModel).toBe("test-reviewer-model");
			expect(typeof report.durationMs).toBe("number");
		});
	})
})

describe("parseScrutinyOutput", () => {
	it("extracts issues from message_end with JSON text", () => {
		const issues: ScrutinyIssue[] = [
			{ severity: "error", description: "Bug found", location: "file.ts:10" },
		];
		const output = makeScrutinyNdjson(issues);

		const result = parseScrutinyOutput(output);

		expect(result.issues.length).toBe(1);
		expect(result.issues[0].severity).toBe("error");
		expect(result.issues[0].description).toBe("Bug found");
	})

	it("returns clean for empty issues", () => {
		const output = makeScrutinyNdjson([]);
		const result = parseScrutinyOutput(output);

		expect(result.issues.length).toBe(0);
		expect(result.status).toBe("clean");
	})

	it("returns error for unparseable output", () => {
		const result = parseScrutinyOutput("not json {{{");

		expect(result.issues.length).toBe(0);
		expect(result.status).toBe("error");
	})

	it("returns error for message_end with invalid JSON text", () => {
		const output = [
			JSON.stringify({ type: "message_start" }),
			JSON.stringify({ type: "message_end", text: "not valid json" }),
		].join("\n");

		const result = parseScrutinyOutput(output);

		expect(result.issues.length).toBe(0);
		expect(result.status).toBe("error");
	})

	it("returns error for output with no message_end", () => {
		const output = [
			JSON.stringify({ type: "message_start" }),
			JSON.stringify({ type: "tool_execution_start", toolName: "bash" }),
		].join("\n");

		const result = parseScrutinyOutput(output);

		expect(result.issues.length).toBe(0);
		expect(result.status).toBe("error");
	})
})
