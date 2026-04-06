import { describe, expect, it } from "bun:test";
import { parseStructuredSummary, synthesizeWorkerResult } from "../../extensions/tools/result-synthesis.js";

function makeMessageEnd(role: string, textContent?: string, usage?: object): string {
	const content = textContent ? [{ type: "text", text: textContent }] : [];
	const message: Record<string, unknown> = { role, content };
	if (usage) message.usage = usage;
	return JSON.stringify({ type: "message_end", message });
}

function makeToolExecutionEnd(toolName: string, args: object, result: object = {}, isError = false): string {
	return JSON.stringify({ type: "tool_execution_end", toolName, args, result, isError });
}

function makeStdout(lines: string[]): string {
	return lines.join("\n");
}

describe("synthesizeWorkerResult", () => {
	describe("VAL-WORKER-006: status determination", () => {
		it("returns success when exit code 0, no fatal tool errors, and valid output", () => {
			const stdout = makeStdout([makeMessageEnd("assistant", "Task completed successfully.")]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.status).toBe("success");
		});

		it("returns failure when exit code is non-zero", () => {
			const stdout = makeStdout([makeMessageEnd("assistant", "Worker encountered an error.")]);
			const result = synthesizeWorkerResult(stdout, "", 1, null, Date.now() - 100);
			expect(result.status).toBe("failure");
		});

		it("returns failure when exit code is non-zero (code 2)", () => {
			const stdout = makeStdout([makeMessageEnd("assistant", "Something went wrong.")]);
			const result = synthesizeWorkerResult(stdout, "", 2, null, Date.now() - 100);
			expect(result.status).toBe("failure");
		});

		it("returns failure with error.kind='environment' and null exitCode when signal kill", () => {
			const stdout = makeStdout([makeMessageEnd("assistant", "Some progress...")]);
			const result = synthesizeWorkerResult(stdout, "", null, "SIGKILL", Date.now() - 100);
			expect(result.status).toBe("failure");
			expect(result.error?.kind).toBe("environment");
		});

		it("returns failure with error.kind='environment' for SIGTERM signal", () => {
			const stdout = makeStdout([makeMessageEnd("assistant", "Running...")]);
			const result = synthesizeWorkerResult(stdout, "", null, "SIGTERM", Date.now() - 100);
			expect(result.status).toBe("failure");
			expect(result.error?.kind).toBe("environment");
		});

		it("returns failure with empty stdout (fallback summary)", () => {
			const result = synthesizeWorkerResult("", "", 0, null, Date.now() - 100);
			expect(result.status).toBe("failure");
			expect(result.summary).toBeTruthy();
			expect(result.summary.length).toBeGreaterThan(0);
		});

		it("returns failure with whitespace-only stdout", () => {
			const result = synthesizeWorkerResult("   \n  \t  ", "", 0, null, Date.now() - 100);
			expect(result.status).toBe("failure");
		});

		it("returns failure with error.kind='tool' when fatal tool error with exit code 0", () => {
			const stdout = makeStdout([
				makeToolExecutionEnd("bash", { command: "rm -rf /" }, { exitCode: 1 }, true),
				makeMessageEnd("assistant", "Task done."),
			]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.status).toBe("failure");
			expect(result.error?.kind).toBe("tool");
		});

		it("treats commit_changes tool errors as non-fatal", () => {
			const stdout = makeStdout([
				makeToolExecutionEnd("write", { path: "/project/src/feature.ts", content: "code" }),
				makeToolExecutionEnd("bash", { command: "npm test" }, { exitCode: 0 }),
				makeToolExecutionEnd("commit_changes", { message: "feat: add feature" }, {}, true),
				makeMessageEnd("assistant", "Feature implemented, commit failed."),
			]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.status).toBe("success");
			expect(result.error).toBeUndefined();
		});

		it("treats git_commit tool errors as non-fatal", () => {
			const stdout = makeStdout([
				makeToolExecutionEnd("write", { path: "/project/src/feature.ts", content: "code" }),
				makeToolExecutionEnd("git_commit", { message: "feat: add feature" }, {}, true),
				makeMessageEnd("assistant", "Feature implemented, git commit failed."),
			]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.status).toBe("success");
			expect(result.error).toBeUndefined();
		});

		it("fatal tool error (isError=true) does not affect status when exit code is non-zero (non-zero exit takes precedence in result)", () => {
			const stdout = makeStdout([
				makeToolExecutionEnd("bash", { command: "failing" }, {}, true),
				makeMessageEnd("assistant", "Error."),
			]);
			const result = synthesizeWorkerResult(stdout, "", 1, null, Date.now() - 100);
			expect(result.status).toBe("failure");
		});

		it("non-error tool calls do not trigger failure", () => {
			const stdout = makeStdout([
				makeToolExecutionEnd("bash", { command: "echo hi" }, { exitCode: 0 }, false),
				makeMessageEnd("assistant", "Done."),
			]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.status).toBe("success");
		});

		it("stderr alone does not affect status determination", () => {
			const stdout = makeStdout([makeMessageEnd("assistant", "Done.")]);
			const result = synthesizeWorkerResult(stdout, "some stderr output", 0, null, Date.now() - 100);
			expect(result.status).toBe("success");
		});
	});

	describe("VAL-WORKER-005: JSON event stream parsing", () => {
		it("skips malformed lines without crashing", () => {
			const stdout = makeStdout(["not valid json {", makeMessageEnd("assistant", "Task completed."), "}broken["]);
			expect(() => synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100)).not.toThrow();
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.summary).toBe("Task completed.");
		});

		it("skips empty lines without crashing", () => {
			const stdout = `\n\n${makeMessageEnd("assistant", "Done.")}\n\n`;
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.status).toBe("success");
			expect(result.summary).toBe("Done.");
		});

		it("skips non-object JSON values (strings, numbers) without crashing", () => {
			const stdout = makeStdout(['"just a string"', "42", "null", makeMessageEnd("assistant", "Done.")]);
			expect(() => synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100)).not.toThrow();
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.summary).toBe("Done.");
		});

		it("processes session header event without crashing", () => {
			const header = JSON.stringify({
				type: "session",
				version: 1,
				id: "abc123",
				timestamp: new Date().toISOString(),
				cwd: "/project",
			});
			const stdout = makeStdout([header, makeMessageEnd("assistant", "Done.")]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.status).toBe("success");
		});

		it("handles stdout with only malformed lines", () => {
			const stdout = makeStdout(["bad json", "{ broken", "]]invalid"]);
			// all lines malformed -> effectively empty events -> treat as no summary
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			// non-empty stdout but all malformed -> should still handle gracefully
			expect(result).toBeDefined();
			expect(result.summary).toBeTruthy();
		});
	});

	describe("VAL-WORKER-005: filesChanged extraction", () => {
		it("extracts files from write tool calls", () => {
			const stdout = makeStdout([
				makeToolExecutionEnd("write", { path: "/project/src/foo.ts", content: "..." }),
				makeMessageEnd("assistant", "Done."),
			]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.filesChanged).toContain("/project/src/foo.ts");
		});

		it("extracts files from edit tool calls", () => {
			const stdout = makeStdout([
				makeToolExecutionEnd("edit", { path: "/project/src/bar.ts", edits: [] }),
				makeMessageEnd("assistant", "Done."),
			]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.filesChanged).toContain("/project/src/bar.ts");
		});

		it("does NOT extract files from read tool calls (reads excluded)", () => {
			const stdout = makeStdout([
				makeToolExecutionEnd("read", { path: "/project/src/secret.ts" }),
				makeMessageEnd("assistant", "Done."),
			]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.filesChanged).not.toContain("/project/src/secret.ts");
			expect(result.filesChanged).toHaveLength(0);
		});

		it("does NOT extract files from bash tool calls", () => {
			const stdout = makeStdout([
				makeToolExecutionEnd("bash", { command: "cat /project/src/file.ts" }, { exitCode: 0 }),
				makeMessageEnd("assistant", "Done."),
			]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.filesChanged).toHaveLength(0);
		});

		it("extracts files from both write and edit calls", () => {
			const stdout = makeStdout([
				makeToolExecutionEnd("write", { path: "/project/a.ts" }),
				makeToolExecutionEnd("edit", { path: "/project/b.ts" }),
				makeToolExecutionEnd("read", { path: "/project/c.ts" }),
				makeMessageEnd("assistant", "Done."),
			]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.filesChanged).toContain("/project/a.ts");
			expect(result.filesChanged).toContain("/project/b.ts");
			expect(result.filesChanged).not.toContain("/project/c.ts");
			expect(result.filesChanged).toHaveLength(2);
		});

		it("deduplicates repeated writes to the same file", () => {
			const stdout = makeStdout([
				makeToolExecutionEnd("write", { path: "/project/a.ts" }),
				makeToolExecutionEnd("edit", { path: "/project/a.ts" }),
				makeMessageEnd("assistant", "Done."),
			]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.filesChanged.filter((f) => f === "/project/a.ts")).toHaveLength(1);
		});

		it("returns empty array when no file changes occurred", () => {
			const stdout = makeStdout([makeMessageEnd("assistant", "Analyzed the code, no changes needed.")]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.filesChanged).toHaveLength(0);
		});

		it("ignores write tool calls with missing path field", () => {
			const stdout = makeStdout([
				makeToolExecutionEnd("write", { content: "no path here" }),
				makeMessageEnd("assistant", "Done."),
			]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.filesChanged).toHaveLength(0);
		});
	});

	describe("VAL-WORKER-005: commandsRun extraction", () => {
		it("extracts commands from bash tool calls with exit codes", () => {
			const stdout = makeStdout([
				makeToolExecutionEnd("bash", { command: "npm test" }, { exitCode: 0 }),
				makeMessageEnd("assistant", "Tests passed."),
			]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.commandsRun).toHaveLength(1);
			expect(result.commandsRun[0]).toEqual({ command: "npm test", exitCode: 0 });
		});

		it("extracts multiple bash commands in order", () => {
			const stdout = makeStdout([
				makeToolExecutionEnd("bash", { command: "npm install" }, { exitCode: 0 }),
				makeToolExecutionEnd("bash", { command: "npm run build" }, { exitCode: 0 }),
				makeToolExecutionEnd("bash", { command: "npm test" }, { exitCode: 1 }),
				makeMessageEnd("assistant", "Done."),
			]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.commandsRun).toHaveLength(3);
			expect(result.commandsRun[0].command).toBe("npm install");
			expect(result.commandsRun[1].command).toBe("npm run build");
			expect(result.commandsRun[2].command).toBe("npm test");
			expect(result.commandsRun[2].exitCode).toBe(1);
		});

		it("uses null exitCode when result has no exitCode field", () => {
			const stdout = makeStdout([
				makeToolExecutionEnd("bash", { command: "some-cmd" }, {}),
				makeMessageEnd("assistant", "Done."),
			]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.commandsRun[0].exitCode).toBeNull();
		});

		it("returns empty array when no bash calls occurred", () => {
			const stdout = makeStdout([
				makeToolExecutionEnd("write", { path: "/a.ts" }),
				makeMessageEnd("assistant", "Done."),
			]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.commandsRun).toHaveLength(0);
		});

		it("ignores bash calls with missing command field", () => {
			const stdout = makeStdout([
				makeToolExecutionEnd("bash", { timeout: 30 }, { exitCode: 0 }),
				makeMessageEnd("assistant", "Done."),
			]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.commandsRun).toHaveLength(0);
		});
	});

	describe("VAL-WORKER-005: summary extraction", () => {
		it("last assistant message becomes summary", () => {
			const stdout = makeStdout([
				makeMessageEnd("assistant", "First message."),
				makeMessageEnd("assistant", "Final summary."),
			]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.summary).toBe("Final summary.");
		});

		it("uses fallback summary when no assistant messages exist", () => {
			const stdout = makeStdout([makeToolExecutionEnd("write", { path: "/a.ts" })]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.summary).toBeTruthy();
			expect(result.summary.length).toBeGreaterThan(0);
		});

		it("ignores user messages when extracting summary", () => {
			const stdout = makeStdout([
				makeMessageEnd("user", "What should I do?"),
				makeMessageEnd("assistant", "Assistant answer."),
			]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.summary).toBe("Assistant answer.");
		});

		it("concatenates multiple text blocks from last assistant message", () => {
			const event = {
				type: "message_end",
				message: {
					role: "assistant",
					content: [
						{ type: "text", text: "Part one. " },
						{ type: "thinking", thinking: "some thinking" },
						{ type: "text", text: "Part two." },
					],
				},
			};
			const stdout = JSON.stringify(event);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.summary).toBe("Part one. Part two.");
		});

		it("ignores non-text content blocks (tool calls, thinking)", () => {
			const event = {
				type: "message_end",
				message: {
					role: "assistant",
					content: [
						{ type: "toolCall", id: "tc1", name: "bash", arguments: {} },
						{ type: "text", text: "Done." },
					],
				},
			};
			const stdout = JSON.stringify(event);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.summary).toBe("Done.");
		});
	});

	describe("VAL-WORKER-007: metrics", () => {
		it("durationMs is always positive", () => {
			const stdout = makeStdout([makeMessageEnd("assistant", "Done.")]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 500);
			expect(result.metrics.durationMs).toBeGreaterThan(0);
		});

		it("durationMs is always positive even when startTime is in the future", () => {
			const stdout = makeStdout([makeMessageEnd("assistant", "Done.")]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() + 10000);
			expect(result.metrics.durationMs).toBeGreaterThan(0);
		});

		it("tokensUsed and estimatedCost populated when available in events", () => {
			const usage = {
				totalTokens: 1500,
				cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0 },
			};
			const stdout = makeStdout([makeMessageEnd("assistant", "Done.", usage)]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.metrics.tokensUsed).toBe(1500);
			expect(result.metrics.estimatedCost).toBeCloseTo(0.003);
		});

		it("tokensUsed undefined (not zero) when no usage data in events", () => {
			const stdout = makeStdout([makeMessageEnd("assistant", "Done.")]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.metrics.tokensUsed).toBeUndefined();
		});

		it("estimatedCost undefined (not zero) when no usage data in events", () => {
			const stdout = makeStdout([makeMessageEnd("assistant", "Done.")]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.metrics.estimatedCost).toBeUndefined();
		});

		it("accumulates tokens and cost from multiple assistant messages", () => {
			const usage1 = { totalTokens: 500, cost: { input: 0.001, output: 0, cacheRead: 0, cacheWrite: 0 } };
			const usage2 = { totalTokens: 1000, cost: { input: 0, output: 0.002, cacheRead: 0, cacheWrite: 0 } };
			const stdout = makeStdout([
				makeMessageEnd("assistant", "First.", usage1),
				makeMessageEnd("assistant", "Second.", usage2),
			]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.metrics.tokensUsed).toBe(1500);
			expect(result.metrics.estimatedCost).toBeCloseTo(0.003);
		});

		describe("VAL-METRICS-001/002: token and cost extraction from pi event format", () => {
			it("extracts tokensUsed as inputTokens + outputTokens from pi usage fields", () => {
				const usage = {
					input: 500,
					output: 300,
					cacheRead: 100,
					cacheWrite: 50,
					totalTokens: 950,
					cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
				};
				const stdout = makeStdout([makeMessageEnd("assistant", "Done.", usage)]);
				const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
				expect(result.metrics.tokensUsed).toBe(800);
			});

			it("uses cost.total for estimatedCost when present in pi usage format", () => {
				const usage = {
					input: 500,
					output: 300,
					cacheRead: 100,
					cacheWrite: 50,
					totalTokens: 950,
					cost: { input: 0.001, output: 0.002, cacheRead: 0.0005, cacheWrite: 0.0001, total: 0.0036 },
				};
				const stdout = makeStdout([makeMessageEnd("assistant", "Done.", usage)]);
				const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
				expect(result.metrics.estimatedCost).toBeCloseTo(0.0036);
			});

			it("accumulates inputTokens + outputTokens across multiple pi-format events", () => {
				const usage1 = {
					input: 200,
					output: 100,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 300,
					cost: { input: 0.001, output: 0.001, cacheRead: 0, cacheWrite: 0, total: 0.002 },
				};
				const usage2 = {
					input: 400,
					output: 150,
					cacheRead: 50,
					cacheWrite: 10,
					totalTokens: 610,
					cost: { input: 0.002, output: 0.003, cacheRead: 0, cacheWrite: 0, total: 0.005 },
				};
				const stdout = makeStdout([
					makeMessageEnd("assistant", "First turn.", usage1),
					makeMessageEnd("assistant", "Second turn.", usage2),
				]);
				const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
				expect(result.metrics.tokensUsed).toBe(850);
				expect(result.metrics.estimatedCost).toBeCloseTo(0.007);
			});

			it("falls back to totalTokens when input/output fields absent", () => {
				const usage = {
					totalTokens: 750,
					cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0 },
				};
				const stdout = makeStdout([makeMessageEnd("assistant", "Done.", usage)]);
				const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
				expect(result.metrics.tokensUsed).toBe(750);
			});

			it("tokensUsed undefined when message_end has no usage field", () => {
				const stdout = makeStdout([makeMessageEnd("assistant", "Done.")]);
				const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
				expect(result.metrics.tokensUsed).toBeUndefined();
			});

			it("estimatedCost is zero (not undefined) when usage present but cost absent", () => {
				const usage = { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150 };
				const stdout = makeStdout([makeMessageEnd("assistant", "Done.", usage)]);
				const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
				expect(result.metrics.tokensUsed).toBe(150);
				expect(result.metrics.estimatedCost).toBe(0);
			});

			it("ignores usage from non-assistant message_end events", () => {
				const usage = { input: 100, output: 50, totalTokens: 150, cost: { total: 0.005 } };
				const userEvent = makeMessageEnd("user", "Hello.", usage);
				const assistantEvent = makeMessageEnd("assistant", "Done.");
				const stdout = makeStdout([userEvent, assistantEvent]);
				const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
				expect(result.metrics.tokensUsed).toBeUndefined();
				expect(result.metrics.estimatedCost).toBeUndefined();
			});
		});

		it("durationMs populated on all failure cases", () => {
			// signal kill
			const r1 = synthesizeWorkerResult("", "", null, "SIGKILL", Date.now() - 200);
			expect(r1.metrics.durationMs).toBeGreaterThan(0);

			// empty stdout
			const r2 = synthesizeWorkerResult("", "", 0, null, Date.now() - 200);
			expect(r2.metrics.durationMs).toBeGreaterThan(0);

			// non-zero exit
			const stdout = makeStdout([makeMessageEnd("assistant", "Err.")]);
			const r3 = synthesizeWorkerResult(stdout, "", 1, null, Date.now() - 200);
			expect(r3.metrics.durationMs).toBeGreaterThan(0);
		});
	});

	describe("VAL-WORKER-007: required fields", () => {
		it("success result has all required fields", () => {
			const stdout = makeStdout([
				makeToolExecutionEnd("write", { path: "/a.ts" }),
				makeToolExecutionEnd("bash", { command: "npm test" }, { exitCode: 0 }),
				makeMessageEnd("assistant", "Everything done."),
			]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.status).toBe("success");
			expect(typeof result.summary).toBe("string");
			expect(Array.isArray(result.filesChanged)).toBe(true);
			expect(Array.isArray(result.commandsRun)).toBe(true);
			expect(typeof result.metrics).toBe("object");
			expect(typeof result.metrics.durationMs).toBe("number");
		});

		it("failure result has all required fields", () => {
			const stdout = makeStdout([makeMessageEnd("assistant", "Error.")]);
			const result = synthesizeWorkerResult(stdout, "", 1, null, Date.now() - 100);
			expect(result.status).toBe("failure");
			expect(typeof result.summary).toBe("string");
			expect(Array.isArray(result.filesChanged)).toBe(true);
			expect(Array.isArray(result.commandsRun)).toBe(true);
			expect(typeof result.metrics).toBe("object");
			expect(typeof result.metrics.durationMs).toBe("number");
		});

		it("signal kill result has null exitCode in error context", () => {
			const result = synthesizeWorkerResult("", "", null, "SIGKILL", Date.now() - 100);
			expect(result.error?.kind).toBe("environment");
			expect(result.error?.message).toBeTruthy();
		});

		it("status is one of the valid string union values", () => {
			const successStdout = makeStdout([makeMessageEnd("assistant", "Done.")]);
			const s = synthesizeWorkerResult(successStdout, "", 0, null, Date.now() - 100);
			expect(["success", "failure", "blocked"]).toContain(s.status);

			const failStdout = makeStdout([makeMessageEnd("assistant", "Err.")]);
			const f = synthesizeWorkerResult(failStdout, "", 1, null, Date.now() - 100);
			expect(["success", "failure", "blocked"]).toContain(f.status);
		});
	});

	describe("signal handling edge cases", () => {
		it("signal takes priority over empty stdout", () => {
			const result = synthesizeWorkerResult("", "", null, "SIGKILL", Date.now() - 100);
			expect(result.error?.kind).toBe("environment");
		});

		it("signal takes priority over non-zero exit code", () => {
			const stdout = makeStdout([makeMessageEnd("assistant", "Partial work.")]);
			const result = synthesizeWorkerResult(stdout, "", 1, "SIGTERM", Date.now() - 100);
			expect(result.error?.kind).toBe("environment");
		});

		it("includes signal name in error message", () => {
			const result = synthesizeWorkerResult("", "", null, "SIGUSR1", Date.now() - 100);
			expect(result.error?.message).toContain("SIGUSR1");
		});
	});

	describe("complex integration scenarios", () => {
		it("full successful run with file edits and bash commands", () => {
			const usage = { totalTokens: 2000, cost: { input: 0.005, output: 0.01, cacheRead: 0, cacheWrite: 0 } };
			const stdout = makeStdout([
				JSON.stringify({ type: "agent_start" }),
				makeToolExecutionEnd("read", { path: "/project/package.json" }),
				makeToolExecutionEnd("bash", { command: "npm install" }, { exitCode: 0 }),
				makeToolExecutionEnd("write", { path: "/project/src/index.ts", content: "code" }),
				makeToolExecutionEnd("edit", { path: "/project/src/utils.ts", edits: [] }),
				makeToolExecutionEnd("bash", { command: "npm test" }, { exitCode: 0 }),
				makeMessageEnd("assistant", "Implementation complete. Added index.ts and updated utils.ts.", usage),
			]);
			const result = synthesizeWorkerResult(stdout, "some stderr", 0, null, Date.now() - 5000);
			expect(result.status).toBe("success");
			expect(result.filesChanged).toContain("/project/src/index.ts");
			expect(result.filesChanged).toContain("/project/src/utils.ts");
			expect(result.filesChanged).not.toContain("/project/package.json");
			expect(result.filesChanged).toHaveLength(2);
			expect(result.commandsRun).toHaveLength(2);
			expect(result.commandsRun[0]).toEqual({ command: "npm install", exitCode: 0 });
			expect(result.commandsRun[1]).toEqual({ command: "npm test", exitCode: 0 });
			expect(result.summary).toBe("Implementation complete. Added index.ts and updated utils.ts.");
			expect(result.metrics.tokensUsed).toBe(2000);
			expect(result.metrics.durationMs).toBeGreaterThan(0);
		});

		it("run with tool error but non-zero exit code", () => {
			const stdout = makeStdout([
				makeToolExecutionEnd("bash", { command: "failing-cmd" }, {}, true),
				makeMessageEnd("assistant", "Encountered errors."),
			]);
			const result = synthesizeWorkerResult(stdout, "", 1, null, Date.now() - 100);
			expect(result.status).toBe("failure");
			expect(result.summary).toBe("Encountered errors.");
		});

		it("handles mixed valid and malformed lines with real content", () => {
			const stdout = makeStdout([
				"INVALID LINE",
				makeToolExecutionEnd("write", { path: "/a.ts" }),
				"{ broken json",
				makeToolExecutionEnd("bash", { command: "echo test" }, { exitCode: 0 }),
				"not json at all",
				makeMessageEnd("assistant", "Done despite noise."),
			]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.status).toBe("success");
			expect(result.filesChanged).toContain("/a.ts");
			expect(result.commandsRun).toHaveLength(1);
			expect(result.summary).toBe("Done despite noise.");
		});

		it("empty stdout returns proper failure with filesChanged and commandsRun as empty arrays", () => {
			const result = synthesizeWorkerResult("", "", 0, null, Date.now() - 100);
			expect(result.status).toBe("failure");
			expect(result.filesChanged).toEqual([]);
			expect(result.commandsRun).toEqual([]);
		});
	});

	describe("structured summary integration", () => {
		it("returns failure when exit code 0 but structured summary says tests failed", () => {
			const summaryText =
				"Done.\n- Files changed: src/index.ts\n- Tests: failed\n- Lint: clean\n- Remaining issues: test failures";
			const stdout = makeStdout([makeMessageEnd("assistant", summaryText)]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.status).toBe("failure");
			expect(result.error?.kind).toBe("validation");
		});

		it("returns success when exit code 0 and structured summary says tests passed", () => {
			const summaryText =
				"Done.\n- Files changed: src/index.ts\n- Tests: passed\n- Lint: clean\n- Remaining issues: none";
			const stdout = makeStdout([makeMessageEnd("assistant", summaryText)]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.status).toBe("success");
		});

		it("returns success when no structured summary in output", () => {
			const stdout = makeStdout([makeMessageEnd("assistant", "Task completed successfully.")]);
			const result = synthesizeWorkerResult(stdout, "", 0, null, Date.now() - 100);
			expect(result.status).toBe("success");
		});
	});
});

describe("parseStructuredSummary", () => {
	it("extracts tests: passed", () => {
		const text = "- Files changed: a.ts\n- Tests: passed\n- Lint: clean\n- Remaining issues: none";
		const result = parseStructuredSummary(text);
		expect(result.testsStatus).toBe("passed");
	});

	it("extracts lint: clean", () => {
		const text = "- Files changed: a.ts\n- Tests: passed\n- Lint: clean\n- Remaining issues: none";
		const result = parseStructuredSummary(text);
		expect(result.lintStatus).toBe("clean");
	});

	it("extracts tests: failed", () => {
		const text = "- Files changed: a.ts\n- Tests: failed\n- Lint: issues\n- Remaining issues: test failures";
		const result = parseStructuredSummary(text);
		expect(result.testsStatus).toBe("failed");
	});

	it("extracts lint: issues", () => {
		const text = "- Files changed: a.ts\n- Tests: passed\n- Lint: issues\n- Remaining issues: lint errors";
		const result = parseStructuredSummary(text);
		expect(result.lintStatus).toBe("issues");
	});

	it("extracts tests: not run", () => {
		const text = "- Files changed: a.ts\n- Tests: not run\n- Lint: not run\n- Remaining issues: none";
		const result = parseStructuredSummary(text);
		expect(result.testsStatus).toBe("not_run");
	});

	it("extracts lint: not run", () => {
		const text = "- Files changed: a.ts\n- Tests: passed\n- Lint: not run\n- Remaining issues: none";
		const result = parseStructuredSummary(text);
		expect(result.lintStatus).toBe("not_run");
	});

	it("returns unknown when no structured summary found", () => {
		const text = "Task completed successfully. All files updated.";
		const result = parseStructuredSummary(text);
		expect(result.testsStatus).toBe("unknown");
		expect(result.lintStatus).toBe("unknown");
	});

	it("is case-insensitive", () => {
		const text = "- tests: PASSED\n- lint: CLEAN";
		const result = parseStructuredSummary(text);
		expect(result.testsStatus).toBe("passed");
		expect(result.lintStatus).toBe("clean");
	});
});
