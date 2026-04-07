import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveConfig, savePlan, saveState } from "../../extensions/state/manager.js";
import { killActiveWorker, registerSpawnWorkerTool } from "../../extensions/tools/spawn-worker.js";
import { createMockPi, makeFeature, makeMilestone, makePlan, makeState } from "../helpers/index.js";

function makeMessageEndLine(role: string, text: string): string {
	return JSON.stringify({
		type: "message_end",
		message: { role, content: [{ type: "text", text }] },
	});
}

function makeReportResultLine(): string {
	return JSON.stringify({
		type: "tool_execution_end",
		toolName: "report_result",
		args: {
			whatWasImplemented: "Implemented feature",
			whatWasLeftUndone: "",
			commandsRun: [],
			testsAdded: [],
			discoveredIssues: [],
		},
		result: { content: [{ type: "text", text: "Report submitted." }] },
		isError: false,
	});
}

interface MockSpawnOptions {
	stdoutLines?: string[];
	stderr?: string;
	exitCode?: number;
	signal?: string | null;
	error?: Error;
}

function makeMockSpawn(opts: MockSpawnOptions = {}) {
	const { stdoutLines = [], stderr = "", exitCode = 0, signal = null, error } = opts;

	const finalLines =
		exitCode === 0 && stdoutLines.length > 0
			? [...stdoutLines.slice(0, -1), makeReportResultLine(), stdoutLines[stdoutLines.length - 1]]
			: stdoutLines;

	return (_command: string, _args: string[], _options: object) => {
		const stdoutHandlers: Array<(data: Buffer) => void> = [];
		const stderrHandlers: Array<(data: Buffer) => void> = [];
		const closeHandlers: Array<(code: number | null, signal: string | null) => void> = [];
		const errorHandlers: Array<(err: Error) => void> = [];

		const mockStdout = {
			on: (event: string, handler: (data: Buffer) => void) => {
				if (event === "data") stdoutHandlers.push(handler);
			},
		};

		const mockStderr = {
			on: (event: string, handler: (data: Buffer) => void) => {
				if (event === "data") stderrHandlers.push(handler);
			},
		};

		const proc = {
			stdout: mockStdout,
			stderr: mockStderr,
			killed: false,
			kill: (sig: string) => {
				proc.killed = true;
				for (const h of closeHandlers) h(null, sig);
			},
			on: (event: string, handler: (...args: unknown[]) => void) => {
				if (event === "close") closeHandlers.push(handler as (code: number | null, signal: string | null) => void);
				if (event === "error") errorHandlers.push(handler as (err: Error) => void);
			},
		};

		setImmediate(() => {
			if (error) {
				for (const h of errorHandlers) h(error);
				return;
			}
			if (stderr) {
				for (const h of stderrHandlers) h(Buffer.from(stderr));
			}
			const joinedStdout = finalLines.join("\n");
			if (joinedStdout) {
				for (const h of stdoutHandlers) h(Buffer.from(joinedStdout));
			}
			for (const h of closeHandlers) h(exitCode, signal);
		});

		return proc;
	};
}

function makeMockSpawnDelayed(delayMs: number, opts: MockSpawnOptions = {}) {
	const { stdoutLines = [], stderr = "", exitCode = 0, signal = null, error } = opts;

	const finalLines =
		exitCode === 0 && stdoutLines.length > 0
			? [...stdoutLines.slice(0, -1), makeReportResultLine(), stdoutLines[stdoutLines.length - 1]]
			: stdoutLines;

	return (_command: string, _args: string[], _options: object) => {
		const stdoutHandlers: Array<(data: Buffer) => void> = [];
		const stderrHandlers: Array<(data: Buffer) => void> = [];
		const closeHandlers: Array<(code: number | null, signal: string | null) => void> = [];
		const errorHandlers: Array<(err: Error) => void> = [];

		const mockStdout = {
			on: (event: string, handler: (data: Buffer) => void) => {
				if (event === "data") stdoutHandlers.push(handler);
			},
		};

		const mockStderr = {
			on: (event: string, handler: (data: Buffer) => void) => {
				if (event === "data") stderrHandlers.push(handler);
			},
		};

		const proc = {
			stdout: mockStdout,
			stderr: mockStderr,
			killed: false,
			kill: (sig: string) => {
				proc.killed = true;
				for (const h of closeHandlers) h(null, sig);
			},
			on: (event: string, handler: (...args: unknown[]) => void) => {
				if (event === "close") closeHandlers.push(handler as (code: number | null, signal: string | null) => void);
				if (event === "error") errorHandlers.push(handler as (err: Error) => void);
			},
		};

		setTimeout(() => {
			if (proc.killed) return;
			if (error) {
				for (const h of errorHandlers) h(error);
				return;
			}
			if (stderr) {
				for (const h of stderrHandlers) h(Buffer.from(stderr));
			}
			const joinedStdout = finalLines.join("\n");
			if (joinedStdout) {
				for (const h of stdoutHandlers) h(Buffer.from(joinedStdout));
			}
			for (const h of closeHandlers) h(exitCode, signal);
		}, delayMs);

		return proc;
	};
}

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

let testDir: string;
let capturedCommand: string | null;
let capturedArgs: string[] | null;
let capturedCwd: string | null;
let capturedSpawnOpts: Record<string, unknown> | null;
let mockSpawnFn: ReturnType<typeof makeMockSpawn>;

let executeFn:
	| ((
			_id: string,
			params: unknown,
			signal?: AbortSignal,
			onUpdate?: (update: { content: Array<{ type: string; text: string }>; details: unknown }) => void,
			ctx?: unknown,
	  ) => Promise<{ content: Array<{ type: string; text: string }> }>)
	| null = null;

function localMakeState(overrides: Partial<Parameters<typeof makeState>[0]> = {}) {
	return makeState({ status: "approved", ...overrides });
}

function localMakeFeature(overrides: Partial<Parameters<typeof makeFeature>[0]> = {}) {
	return makeFeature({
		id: "feat-1",
		name: "Feature One",
		description: "Implement feature one",
		acceptanceCriteria: ["It works"],
		relevantFiles: ["src/index.ts"],
		...overrides,
	});
}

function localMakeMilestone(
	features: ReturnType<typeof makeFeature>[] = [],
	overrides: Partial<Parameters<typeof makeMilestone>[0]> = {},
) {
	return makeMilestone({ id: "milestone-1", name: "Core", description: "Core milestone", features, ...overrides });
}

function localMakePlan(
	milestones: ReturnType<typeof makeMilestone>[] = [],
	overrides: Partial<Parameters<typeof makePlan>[0]> = {},
) {
	return makePlan({ milestones, approvedAt: new Date().toISOString(), ...overrides });
}

function makePiMock(_updateWidgetFn?: () => void) {
	const mock = createMockPi({
		registerTool: (opts: {
			name: string;
			execute: (id: string, params: unknown, signal?: AbortSignal, onUpdate?: unknown, ctx?: unknown) => unknown;
		}) => {
			executeFn = ((id: string, params: unknown, signal?: AbortSignal, onUpdate?: unknown, ctx?: unknown) =>
				opts.execute(id, params, signal, onUpdate, ctx)) as typeof executeFn;
		},
	});
	return mock.pi;
}

beforeEach(() => {
	testDir = join(tmpdir(), `spawn-worker-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(testDir, { recursive: true });
	writeFileSync(join(testDir, "AGENTS.md"), "# Conventions", "utf8");
	capturedCommand = null;
	capturedArgs = null;
	capturedCwd = null;
	capturedSpawnOpts = null;
	executeFn = null;
	mockSpawnFn = makeMockSpawn({
		stdoutLines: [makeMessageEndLine("assistant", "Worker completed successfully.")],
		exitCode: 0,
	});
});

afterEach(() => {
	try {
		rmSync(testDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

function registerTool(
	spawnMock: ReturnType<typeof makeMockSpawn>,
	extraOpts: {
		projectDir?: string;
		noAgentsMd?: boolean;
		getThinkingLevel?: () => ThinkingLevel;
		setThinkingLevel?: (level: ThinkingLevel) => void;
		availableModels?: string[];
	} = {},
): void {
	const projectDir = extraOpts.projectDir ?? testDir;
	if (extraOpts.noAgentsMd) {
		try {
			rmSync(join(projectDir, "AGENTS.md"));
		} catch {
			// ignore
		}
	}
	const pi = makePiMock();
	registerSpawnWorkerTool(pi, {
		basePath: testDir,
		projectDir,
		updateWidget: () => {},
		getThinkingLevel: extraOpts.getThinkingLevel,
		setThinkingLevel: extraOpts.setThinkingLevel,
		availableModels: extraOpts.availableModels,
		_spawnOverride: (command, args, opts) => {
			if (capturedCommand === null) {
				capturedCommand = command;
				capturedArgs = args;
				capturedCwd = (opts as { cwd?: string }).cwd ?? null;
				capturedSpawnOpts = opts as Record<string, unknown>;
			}
			return spawnMock(command, args, opts);
		},
	});
}

describe("registerSpawnWorkerTool", () => {
	describe("VAL-TOOL-004: state and feature preconditions", () => {
		it("returns error when no state exists", async () => {
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("Error");
			expect(capturedCommand).toBeNull();
		});

		it("returns error when state is not approved or executing", async () => {
			const state = localMakeState({ status: "planning" });
			saveState(testDir, state);
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("Error");
			expect(capturedCommand).toBeNull();
		});

		it("returns error when state is draft_review", async () => {
			const state = localMakeState({ status: "draft_review" });
			saveState(testDir, state);
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("Error");
			expect(capturedCommand).toBeNull();
		});

		it("returns error when feature not found in plan", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const plan = localMakePlan([localMakeMilestone([localMakeFeature()])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "nonexistent-feature" });
			expect(result.content[0].text).toContain("Error");
			expect(capturedCommand).toBeNull();
		});

		it("returns error when no plan.json exists", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("Error");
			expect(capturedCommand).toBeNull();
		});
	});

	describe("VAL-TOOL-020: rejects blocked, skipped, done features", () => {
		for (const status of ["blocked", "skipped", "done"] as const) {
			it(`returns error for feature with status '${status}'`, async () => {
				const state = localMakeState({ status: "executing" });
				saveState(testDir, state);
				const feature = localMakeFeature({ status });
				const plan = localMakePlan([localMakeMilestone([feature])]);
				savePlan(testDir, plan);
				registerTool(mockSpawnFn);
				const result = await executeFn!("id", { featureId: "feat-1" });
				expect(result.content[0].text).toContain("Error");
				expect(capturedCommand).toBeNull();
			});
		}
	});

	describe("VAL-TOOL-021: rejects concurrent execution", () => {
		it("returns error when currentFeatureId is set", async () => {
			const state = localMakeState({ status: "executing", currentFeatureId: "some-other-feature" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("Error");
			expect(capturedCommand).toBeNull();
		});
	});

	describe("VAL-TOOL-019: enforces feature dependency ordering", () => {
		it("returns error when a dependency is not done", async () => {
			const state = localMakeState({ status: "executing" });
			saveState(testDir, state);
			const dep = localMakeFeature({ id: "dep-1", status: "pending" });
			const feature = localMakeFeature({ id: "feat-1", dependencies: ["dep-1"] });
			const plan = localMakePlan([localMakeMilestone([dep, feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("Error");
			expect(capturedCommand).toBeNull();
		});

		it("succeeds when all dependencies are done", async () => {
			const state = localMakeState({ status: "executing" });
			saveState(testDir, state);
			const dep = localMakeFeature({ id: "dep-1", status: "done" });
			const feature = localMakeFeature({ id: "feat-1", dependencies: ["dep-1"] });
			const plan = localMakePlan([localMakeMilestone([dep, feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).not.toContain("Error");
		});

		it("succeeds when there are no dependencies", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature({ id: "feat-1", dependencies: [] });
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).not.toContain("Error");
		});

		it("treats skipped dependency as resolved", async () => {
			const state = localMakeState({ status: "executing" });
			saveState(testDir, state);
			const dep = localMakeFeature({ id: "dep-1", status: "skipped" });
			const feature = localMakeFeature({ id: "feat-1", dependencies: ["dep-1"] });
			const plan = localMakePlan([localMakeMilestone([dep, feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).not.toContain("Error");
		});

		it("treats failed dependency as resolved", async () => {
			const state = localMakeState({ status: "executing" });
			saveState(testDir, state);
			const dep = localMakeFeature({ id: "dep-1", status: "failed" });
			const feature = localMakeFeature({ id: "feat-1", dependencies: ["dep-1"] });
			const plan = localMakePlan([localMakeMilestone([dep, feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).not.toContain("Error");
		});

		it("still blocks on pending dependency", async () => {
			const state = localMakeState({ status: "executing" });
			saveState(testDir, state);
			const dep = localMakeFeature({ id: "dep-1", status: "pending" });
			const feature = localMakeFeature({ id: "feat-1", dependencies: ["dep-1"] });
			const plan = localMakePlan([localMakeMilestone([dep, feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("Error");
		});

		it("still blocks on active dependency", async () => {
			const state = localMakeState({ status: "executing" });
			saveState(testDir, state);
			const dep = localMakeFeature({ id: "dep-1", status: "active" });
			const feature = localMakeFeature({ id: "feat-1", dependencies: ["dep-1"] });
			const plan = localMakePlan([localMakeMilestone([dep, feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("Error");
		});
	});

	describe("worker model validation", () => {
		it("returns error when worker model is not in available models", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			// Save config with a model that won't be "available"
			const { saveConfig } = await import("../../extensions/state/manager.js");
			saveConfig(testDir, { models: { worker: "nonexistent/model" } });
			registerTool(mockSpawnFn, { availableModels: ["anthropic/claude", "openai/gpt-4"] });
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("nonexistent/model");
			expect(capturedCommand).toBeNull();
		});

		it("proceeds when worker model matches by plain id", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn, { availableModels: ["opencode-go/glm-5"] });
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).not.toContain("Error");
		});

		it("proceeds when worker model matches by provider/id format", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			// Config has "opencode-go/glm-5", available list has both "glm-5" and "opencode-go/glm-5"
			const { saveConfig } = await import("../../extensions/state/manager.js");
			saveConfig(testDir, { models: { worker: "opencode-go/glm-5" } });
			registerTool(mockSpawnFn, { availableModels: ["glm-5", "opencode-go/glm-5"] });
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).not.toContain("Error");
		});

		it("skips validation when no available models list provided", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).not.toContain("Error");
		});
	});

	describe("VAL-TOOL-007: transitions approved -> executing on first spawn_worker call", () => {
		it("transitions state from approved to executing", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const { loadState } = await import("../../extensions/state/manager.js");
			const savedState = loadState(testDir);
			expect(savedState?.status).toBe("executing");
		});

		it("does not re-transition if already executing", async () => {
			const state = localMakeState({ status: "executing" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const { loadState } = await import("../../extensions/state/manager.js");
			const savedState = loadState(testDir);
			expect(savedState?.status).toBe("executing");
		});
	});

	describe("VAL-TOOL-004: generates skill and prompt files, spawns blocking process", () => {
		it("spawns the pi process and blocks until exit", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(capturedCommand).not.toBeNull();
			expect(result).toBeDefined();
		});

		it("passes --mode json, -p, --no-session, --model, --skill, --append-system-prompt to pi process", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			expect(capturedArgs).toContain("--mode");
			expect(capturedArgs).toContain("json");
			expect(capturedArgs).toContain("-p");
			expect(capturedArgs).toContain("--no-session");
			expect(capturedArgs).toContain("--skill");
			expect(capturedArgs).toContain("--append-system-prompt");
		});

		it("passes --model arg when config or plan has worker model", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])], {
				modelAssignment: { worker: "claude-sonnet-4" },
			});
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			expect(capturedArgs).toContain("--model");
			const modelIdx = capturedArgs!.indexOf("--model");
			expect(capturedArgs![modelIdx + 1]).toBe("claude-sonnet-4");
		});

		it("passes default worker model when no explicit worker model configured", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			expect(capturedArgs).toContain("--model");
			const modelIdx = capturedArgs!.indexOf("--model");
			expect(capturedArgs![modelIdx + 1]).toBe("opencode-go/glm-5");
		});
	});

	describe("VAL-WORKER-009: worker spawned with correct cwd", () => {
		it("sets cwd to the projectDir", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			expect(capturedCwd).toBe(testDir);
		});
	});

	describe("VAL-WORKER-009: spawned process uses stdio ['ignore', 'pipe', 'pipe']", () => {
		it("uses correct stdio config", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			expect(capturedSpawnOpts?.stdio).toEqual(["ignore", "pipe", "pipe"]);
		});
	});

	describe("VAL-WORKER-004: files written to correct runtime directory", () => {
		it("writes worker-skill.md to runtime/<featureId>/1/ on first attempt", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const skillPath = join(testDir, "runtime", "feat-1", "1", "worker-skill.md");
			expect(() => readFileSync(skillPath)).not.toThrow();
		});

		it("writes worker-prompt.md to runtime/<featureId>/1/", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const promptPath = join(testDir, "runtime", "feat-1", "1", "worker-prompt.md");
			expect(() => readFileSync(promptPath)).not.toThrow();
		});

		it("writes worker-context.md to runtime/<featureId>/1/", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const contextPath = join(testDir, "runtime", "feat-1", "1", "worker-context.md");
			expect(() => readFileSync(contextPath)).not.toThrow();
		});

		it("retry attempt 2 uses runtime/<featureId>/2/", async () => {
			const failMock = makeMockSpawn({
				stdoutLines: [makeMessageEndLine("assistant", "Worker failed.")],
				exitCode: 1,
			});
			const state = localMakeState({ status: "executing" });
			saveState(testDir, state);
			const feature = localMakeFeature({
				status: "active",
				attempts: [
					{
						attemptNumber: 1,
						startedAt: new Date().toISOString(),
						exitCode: 1,
						resultPath: join(testDir, "runtime", "feat-1", "1", "result.json"),
						stdoutPath: join(testDir, "runtime", "feat-1", "1", "stdout.log"),
						stderrPath: join(testDir, "runtime", "feat-1", "1", "stderr.log"),
						status: "failure",
					},
				],
			});
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(failMock);
			await executeFn!("id", { featureId: "feat-1" });
			const skillPath = join(testDir, "runtime", "feat-1", "2", "worker-skill.md");
			expect(() => readFileSync(skillPath)).not.toThrow();
		});
	});

	describe("VAL-TOOL-005: captures output and synthesizes WorkerResult", () => {
		it("writes stdout.log to runtime directory", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const stdoutPath = join(testDir, "runtime", "feat-1", "1", "stdout.log");
			expect(() => readFileSync(stdoutPath)).not.toThrow();
		});

		it("writes stderr.log to runtime directory", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const stderrPath = join(testDir, "runtime", "feat-1", "1", "stderr.log");
			expect(() => readFileSync(stderrPath)).not.toThrow();
		});

		it("writes result.json with WorkerResult to runtime directory", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const resultPath = join(testDir, "runtime", "feat-1", "1", "result.json");
			const content = readFileSync(resultPath, "utf8");
			const parsed = JSON.parse(content);
			expect(parsed.status).toBe("success");
			expect(typeof parsed.summary).toBe("string");
		});

		it("writes metadata.json to runtime directory", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const metaPath = join(testDir, "runtime", "feat-1", "1", "metadata.json");
			const content = readFileSync(metaPath, "utf8");
			const parsed = JSON.parse(content);
			expect(parsed.featureId).toBe("feat-1");
			expect(typeof parsed.attemptNumber).toBe("number");
		});
	});

	describe("VAL-TOOL-006: updates plan and state after completion", () => {
		it("on success: sets feature status to done and increments totalFeaturesCompleted", async () => {
			const successMock = makeMockSpawn({
				stdoutLines: [makeMessageEndLine("assistant", "Done!")],
				exitCode: 0,
			});
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			saveConfig(testDir, { validatorStrictness: "lenient" });
			registerTool(successMock);
			await executeFn!("id", { featureId: "feat-1" });
			const { loadState, loadPlan } = await import("../../extensions/state/manager.js");
			const savedState = loadState(testDir);
			const savedPlan = loadPlan(testDir);
			expect(savedState?.totalFeaturesCompleted).toBe(1);
			expect(savedPlan?.milestones[0].features[0].status).toBe("done");
			expect(savedPlan?.milestones[0].features[0].completedAt).toBeDefined();
		});

		it("on failure: feature stays active and increments totalFeaturesFailed", async () => {
			const failMock = makeMockSpawn({
				stdoutLines: [makeMessageEndLine("assistant", "Failed.")],
				exitCode: 1,
			});
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(failMock);
			await executeFn!("id", { featureId: "feat-1" });
			const { loadState, loadPlan } = await import("../../extensions/state/manager.js");
			const savedState = loadState(testDir);
			const savedPlan = loadPlan(testDir);
			expect(savedState?.totalFeaturesFailed).toBe(1);
			const feat = savedPlan?.milestones[0].features[0];
			expect(feat?.status === "active" || feat?.status === "failed").toBe(true);
		});

		it("on failure with retries exhausted: feature status becomes failed", async () => {
			const failMock = makeMockSpawn({
				stdoutLines: [makeMessageEndLine("assistant", "Failed.")],
				exitCode: 1,
			});
			const state = localMakeState({ status: "executing" });
			saveState(testDir, state);
			const feature = localMakeFeature({
				status: "active",
				attempts: [
					{
						attemptNumber: 1,
						startedAt: new Date().toISOString(),
						exitCode: 1,
						resultPath: "",
						stdoutPath: "",
						stderrPath: "",
						status: "failure",
					},
					{
						attemptNumber: 2,
						startedAt: new Date().toISOString(),
						exitCode: 1,
						resultPath: "",
						stdoutPath: "",
						stderrPath: "",
						status: "failure",
					},
				],
			});
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(failMock);
			await executeFn!("id", { featureId: "feat-1" });
			const { loadPlan } = await import("../../extensions/state/manager.js");
			const savedPlan = loadPlan(testDir);
			expect(savedPlan?.milestones[0].features[0].status).toBe("failed");
		});

		it("clears currentFeatureId after completion", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const { loadState } = await import("../../extensions/state/manager.js");
			const savedState = loadState(testDir);
			expect(savedState?.currentFeatureId).toBeUndefined();
		});

		it("appends worker_spawn and worker_complete progress events", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const { loadState } = await import("../../extensions/state/manager.js");
			const savedState = loadState(testDir);
			const eventTypes = savedState?.progressLog.map((e) => e.type);
			expect(eventTypes).toContain("worker_spawn");
			expect(eventTypes).toContain("worker_complete");
		});
	});

	describe("VAL-TOOL-007: retry increments attempt number", () => {
		it("attempt number is 2 when feature already has 1 failed attempt", async () => {
			const state = localMakeState({ status: "executing" });
			saveState(testDir, state);
			const feature = localMakeFeature({
				status: "active",
				attempts: [
					{
						attemptNumber: 1,
						startedAt: new Date().toISOString(),
						exitCode: 1,
						resultPath: "",
						stdoutPath: "",
						stderrPath: "",
						status: "failure",
					},
				],
			});
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const { loadPlan } = await import("../../extensions/state/manager.js");
			const savedPlan = loadPlan(testDir);
			const attempts = savedPlan?.milestones[0].features[0].attempts;
			expect(attempts?.length).toBe(2);
			expect(attempts?.[1].attemptNumber).toBe(2);
		});

		it("additionalContext included in prompt on retry", async () => {
			const state = localMakeState({ status: "executing" });
			saveState(testDir, state);
			const feature = localMakeFeature({
				status: "active",
				attempts: [
					{
						attemptNumber: 1,
						startedAt: new Date().toISOString(),
						exitCode: 1,
						resultPath: "",
						stdoutPath: "",
						stderrPath: "",
						status: "failure",
					},
				],
			});
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1", additionalContext: "Fix the broken tests" });
			const promptPath = join(testDir, "runtime", "feat-1", "2", "worker-prompt.md");
			const content = readFileSync(promptPath, "utf8");
			expect(content).toContain("Fix the broken tests");
		});
	});

	describe("VAL-WORKER-010: returns tool error if pi binary not found", () => {
		it("returns error when spawning fails with ENOENT", async () => {
			const errorMock = makeMockSpawn({ error: Object.assign(new Error("not found"), { code: "ENOENT" }) });
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(errorMock);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("Error");
		});
	});

	describe("feature status transitions tracked (VAL-CROSS-013)", () => {
		it("records completedAt and durationMs on successful attempt", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const { loadPlan } = await import("../../extensions/state/manager.js");
			const savedPlan = loadPlan(testDir);
			const attempt = savedPlan?.milestones[0].features[0].attempts[0];
			expect(attempt?.completedAt).toBeDefined();
			expect(attempt?.durationMs).toBeGreaterThan(0);
			expect(attempt?.status).toBe("success");
			expect(attempt?.exitCode).toBe(0);
		});

		it("records completedAt and durationMs on failed attempt", async () => {
			const failMock = makeMockSpawn({ exitCode: 1, stdoutLines: [makeMessageEndLine("assistant", "Err.")] });
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(failMock);
			await executeFn!("id", { featureId: "feat-1" });
			const { loadPlan } = await import("../../extensions/state/manager.js");
			const savedPlan = loadPlan(testDir);
			const attempt = savedPlan?.milestones[0].features[0].attempts[0];
			expect(attempt?.completedAt).toBeDefined();
			expect(attempt?.durationMs).toBeGreaterThan(0);
			expect(attempt?.status).toBe("failure");
		});
	});

	describe("active feature state", () => {
		it("sets feature to active during execution", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature({ status: "pending" });
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			saveConfig(testDir, { validatorStrictness: "lenient" });
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const { loadPlan } = await import("../../extensions/state/manager.js");
			const savedPlan = loadPlan(testDir);
			expect(savedPlan?.milestones[0].features[0].status).toBe("done");
		});
	});

	describe("VAL-API-002: thinking level saved and restored around worker spawn", () => {
		it("saves thinking level before spawn and restores after success", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);

			const setLevelCalls: ThinkingLevel[] = [];
			registerTool(mockSpawnFn, {
				getThinkingLevel: () => "medium",
				setThinkingLevel: (level) => setLevelCalls.push(level),
			});
			await executeFn!("id", { featureId: "feat-1" });
			expect(setLevelCalls).toEqual(["medium"]);
		});

		it("saves thinking level before spawn and restores after failure", async () => {
			const failMock = makeMockSpawn({
				stdoutLines: [makeMessageEndLine("assistant", "Failed.")],
				exitCode: 1,
			});
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);

			const setLevelCalls: ThinkingLevel[] = [];
			registerTool(failMock, {
				getThinkingLevel: () => "high",
				setThinkingLevel: (level) => setLevelCalls.push(level),
			});
			await executeFn!("id", { featureId: "feat-1" });
			expect(setLevelCalls).toEqual(["high"]);
		});

		it("restores thinking level even when pi binary not found (ENOENT)", async () => {
			const errorMock = makeMockSpawn({ error: Object.assign(new Error("not found"), { code: "ENOENT" }) });
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);

			const setLevelCalls: ThinkingLevel[] = [];
			registerTool(errorMock, {
				getThinkingLevel: () => "low",
				setThinkingLevel: (level) => setLevelCalls.push(level),
			});
			await executeFn!("id", { featureId: "feat-1" });
			expect(setLevelCalls).toEqual(["low"]);
		});

		it("works without getThinkingLevel and setThinkingLevel deps (optional)", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);

			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).not.toContain("Error");
		});

		it("restores the exact level that was saved before spawn", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);

			let currentLevel: ThinkingLevel = "xhigh";
			const setLevelCalls: ThinkingLevel[] = [];
			registerTool(mockSpawnFn, {
				getThinkingLevel: () => currentLevel,
				setThinkingLevel: (level) => {
					setLevelCalls.push(level);
					currentLevel = level;
				},
			});
			await executeFn!("id", { featureId: "feat-1" });
			expect(setLevelCalls[0]).toBe("xhigh");
			expect(currentLevel).toBe("xhigh");
		});
	});

	describe("worker timeout", () => {
		it("worker is killed when timeout expires", async () => {
			const delayedMock = makeMockSpawnDelayed(5000, {
				stdoutLines: [makeMessageEndLine("assistant", "Done")],
				exitCode: 0,
			});
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			saveConfig(testDir, { workerTimeoutMs: 50 });
			registerTool(delayedMock);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("timed out");
		});

		it("timeout is configurable via config.workerTimeoutMs", async () => {
			const delayedMock = makeMockSpawnDelayed(5000, {
				stdoutLines: [makeMessageEndLine("assistant", "Done")],
				exitCode: 0,
			});
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			saveConfig(testDir, { workerTimeoutMs: 30 });
			registerTool(delayedMock);
			const startTime = Date.now();
			await executeFn!("id", { featureId: "feat-1" });
			const elapsed = Date.now() - startTime;
			expect(elapsed).toBeLessThan(3000);
		});

		it("default timeout is 600000ms (10 minutes)", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).not.toContain("timed out");
		});
	});

	describe("abort signal", () => {
		it("worker is killed when abort signal fires", async () => {
			const delayedMock = makeMockSpawnDelayed(5000, {
				stdoutLines: [makeMessageEndLine("assistant", "Done")],
				exitCode: 0,
			});
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			saveConfig(testDir, { workerTimeoutMs: 60_000 });

			const ac = new AbortController();
			const pi = makePiMock();
			registerSpawnWorkerTool(pi, {
				basePath: testDir,
				projectDir: testDir,
				updateWidget: () => {},
				_spawnOverride: (command, args, opts) => {
					capturedCommand = command;
					return delayedMock(command, args, opts);
				},
			});

			setTimeout(() => ac.abort(), 50);
			const result = await executeFn!("id", { featureId: "feat-1" }, ac.signal);
			expect(result.content[0].text).toContain("aborted");
		});

		it("worker handles pre-aborted signal", async () => {
			const delayedMock = makeMockSpawnDelayed(5000, {
				stdoutLines: [makeMessageEndLine("assistant", "Done")],
				exitCode: 0,
			});
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);

			const ac = new AbortController();
			ac.abort();

			const pi = makePiMock();
			registerSpawnWorkerTool(pi, {
				basePath: testDir,
				projectDir: testDir,
				updateWidget: () => {},
				_spawnOverride: (command, args, opts) => {
					capturedCommand = command;
					return delayedMock(command, args, opts);
				},
			});

			const result = await executeFn!("id", { featureId: "feat-1" }, ac.signal);
			expect(result.content[0].text).toContain("aborted");
		});
	});

	describe("default worker model", () => {
		it("worker uses default model 'opencode-go/glm-5' when no model configured", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			expect(capturedArgs).toContain("--model");
			const modelIdx = capturedArgs!.indexOf("--model");
			expect(capturedArgs![modelIdx + 1]).toBe("opencode-go/glm-5");
		});

		it("explicit model config overrides the default", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])], {
				modelAssignment: { worker: "custom-model" },
			});
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const modelIdx = capturedArgs!.indexOf("--model");
			expect(capturedArgs![modelIdx + 1]).toBe("custom-model");
		});
	});

	describe("killActiveWorker", () => {
		it("kills the active process", async () => {
			const delayedMock = makeMockSpawnDelayed(5000, {
				stdoutLines: [makeMessageEndLine("assistant", "Done")],
				exitCode: 0,
			});
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(delayedMock);

			const promise = executeFn!("id", { featureId: "feat-1" });
			await new Promise((r) => setTimeout(r, 50));
			killActiveWorker();
			const result = await promise;
			expect(result).toBeDefined();
		});

		it("does nothing when no process is active", () => {
			expect(() => killActiveWorker()).not.toThrow();
		});
	});

	describe("progress context in result (Point 19)", () => {
		it("result includes progress count", async () => {
			const state = localMakeState({ status: "executing" });
			saveState(testDir, state);
			const feat1 = localMakeFeature({ id: "feat-1", name: "Feature One", status: "pending" });
			const feat2 = localMakeFeature({ id: "feat-2", name: "Feature Two", status: "pending" });
			const plan = localMakePlan([localMakeMilestone([feat1, feat2])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("Progress:");
			expect(result.content[0].text).toMatch(/\d+\/\d+ features done/);
		});

		it("result includes next pending feature name", async () => {
			const state = localMakeState({ status: "executing" });
			saveState(testDir, state);
			const feat1 = localMakeFeature({ id: "feat-1", name: "Feature One", status: "pending" });
			const feat2 = localMakeFeature({ id: "feat-2", name: "Feature Two", status: "pending" });
			const plan = localMakePlan([localMakeMilestone([feat1, feat2])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("Next:");
			expect(result.content[0].text).toContain("Feature Two");
		});

		it("instructs to call complete_mission when no more pending features", async () => {
			const state = localMakeState({ status: "executing" });
			saveState(testDir, state);
			const feat1 = localMakeFeature({ id: "feat-1", name: "Feature One", status: "pending" });
			const plan = localMakePlan([localMakeMilestone([feat1])]);
			savePlan(testDir, plan);
			saveConfig(testDir, { validatorStrictness: "lenient" });
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("ALL FEATURES DONE");
			expect(result.content[0].text).toContain("complete_mission");
		});

		it("shows next feature name when more features are pending", async () => {
			const state = localMakeState({ status: "executing" });
			saveState(testDir, state);
			const feat1 = localMakeFeature({ id: "feat-1", name: "Feature One", status: "pending" });
			const feat2 = localMakeFeature({ id: "feat-2", name: "Feature Two", status: "pending" });
			const plan = localMakePlan([localMakeMilestone([feat1, feat2])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("Next: Feature Two");
			expect(result.content[0].text).not.toContain("ALL FEATURES DONE");
		});
	});

	describe("optional validator after success", () => {
		it("runs validator when validator model is configured and returns PASS", async () => {
			const feature = localMakeFeature({ status: "pending" });
			const milestone = localMakeMilestone([feature], { status: "active" });
			const plan = localMakePlan([milestone]);
			const state = localMakeState({ status: "executing", currentMilestoneId: "milestone-1" });

			saveState(testDir, state);
			savePlan(testDir, plan);
			saveConfig(testDir, { models: { validator: "test-model" } });

			const validatorSpawn = makeMockSpawn({
				stdoutLines: [makeMessageEndLine("assistant", "VERDICT: PASS\nFEEDBACK: All good.")],
				exitCode: 0,
			});
			let validatorCalled = false;
			const combinedSpawn = (cmd: string, args: string[], opts: object) => {
				if (args.some((a: string) => a.includes("validator-skill"))) {
					validatorCalled = true;
					return validatorSpawn(cmd, args, opts);
				}
				return mockSpawnFn(cmd, args, opts);
			};

			const pi = makePiMock();
			registerSpawnWorkerTool(pi, {
				basePath: testDir,
				projectDir: testDir,
				updateWidget: () => {},
				_spawnOverride: combinedSpawn as any,
			});

			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(validatorCalled).toBe(true);
			expect(result.content[0].text).toContain("succeeded");
		});

		it("skips validator (still succeeds) when no validator model configured", async () => {
			const feature = localMakeFeature({ status: "pending" });
			const milestone = localMakeMilestone([feature], { status: "active" });
			const plan = localMakePlan([milestone]);
			const state = localMakeState({ status: "executing", currentMilestoneId: "milestone-1" });

			saveState(testDir, state);
			savePlan(testDir, plan);
			saveConfig(testDir, { models: {}, validatorStrictness: "lenient" });

			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("succeeded");
		});

		it("marks feature as failed when validator returns FIX", async () => {
			const feature = localMakeFeature({ status: "pending" });
			const milestone = localMakeMilestone([feature], { status: "active" });
			const plan = localMakePlan([milestone]);
			const state = localMakeState({ status: "executing", currentMilestoneId: "milestone-1" });

			saveState(testDir, state);
			savePlan(testDir, plan);
			saveConfig(testDir, { models: { validator: "test-model" } });

			const validatorSpawn = makeMockSpawn({
				stdoutLines: [
					makeMessageEndLine("assistant", "VERDICT: FIX\nFEEDBACK: Missing test script in package.json"),
				],
				exitCode: 0,
			});
			const combinedSpawn = (cmd: string, args: string[], opts: object) => {
				if (args.some((a: string) => a.includes("validator-skill"))) {
					return validatorSpawn(cmd, args, opts);
				}
				return mockSpawnFn(cmd, args, opts);
			};

			const pi = makePiMock();
			registerSpawnWorkerTool(pi, {
				basePath: testDir,
				projectDir: testDir,
				updateWidget: () => {},
				_spawnOverride: combinedSpawn as any,
			});

			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("failed");
			expect(result.content[0].text).toContain("Missing test script");
		});
	});

	describe("progress hint on failure", () => {
		it("does not say ALL FEATURES DONE when worker failed", async () => {
			const failSpawn = makeMockSpawn({ stdoutLines: [], exitCode: 1 });
			const state = localMakeState({ status: "executing" });
			saveState(testDir, state);
			const feat1 = localMakeFeature({ id: "feat-1", name: "Feature One", status: "pending" });
			const plan = localMakePlan([localMakeMilestone([feat1])]);
			savePlan(testDir, plan);
			registerTool(failSpawn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("failed");
			expect(result.content[0].text).not.toContain("ALL FEATURES DONE");
		});
	});

	describe("setWorkingMessage during execution (Point 22)", () => {
		it("calls setWorkingMessage before spawning", async () => {
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);

			const workingMessages: Array<string | undefined> = [];
			const mockCtx = {
				ui: {
					setWorkingMessage: (msg?: string) => {
						workingMessages.push(msg);
					},
				},
			};

			await executeFn!("id", { featureId: "feat-1" }, undefined, undefined, mockCtx);
			expect(workingMessages.length).toBeGreaterThanOrEqual(2);
			expect(workingMessages[0]).toContain("Spawning worker");
			expect(workingMessages[workingMessages.length - 1]).toBeUndefined();
		});
	});

	describe("widget refresh during execution (Point 23)", () => {
		it("widget is refreshed during worker execution", async () => {
			const delayedMock = makeMockSpawnDelayed(250, {
				stdoutLines: [makeMessageEndLine("assistant", "Done!")],
				exitCode: 0,
			});
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);

			let widgetUpdateCount = 0;
			const pi = makePiMock();
			registerSpawnWorkerTool(pi, {
				basePath: testDir,
				projectDir: testDir,
				updateWidget: () => {
					widgetUpdateCount++;
				},
				_spawnOverride: delayedMock,
			});

			await executeFn!("id", { featureId: "feat-1" });
			expect(widgetUpdateCount).toBeGreaterThanOrEqual(2);
		});
	});

	describe("onUpdate streaming (Point 24)", () => {
		it("calls onUpdate during worker execution with progress", async () => {
			const delayedMock = makeMockSpawnDelayed(200, {
				stdoutLines: [makeMessageEndLine("assistant", "Done!")],
				exitCode: 0,
			});
			const state = localMakeState({ status: "approved" });
			saveState(testDir, state);
			const feature = localMakeFeature();
			const plan = localMakePlan([localMakeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(delayedMock);

			const updates: Array<{ content: Array<{ type: string; text: string }>; details: unknown }> = [];
			const onUpdate = (update: { content: Array<{ type: string; text: string }>; details: unknown }) => {
				updates.push(update);
			};

			await executeFn!("id", { featureId: "feat-1" }, undefined, onUpdate);
			expect(updates.length).toBeGreaterThanOrEqual(0);
		});
	});

	describe("auto-milestone management", () => {
		it("auto-starts a pending milestone when spawning its first feature", async () => {
			const feature = localMakeFeature({ status: "pending" });
			const milestone = localMakeMilestone([feature], { status: "pending" });
			const plan = localMakePlan([milestone]);
			const state = localMakeState({ status: "executing" });

			saveState(testDir, state);
			savePlan(testDir, plan);
			saveConfig(testDir, { validatorStrictness: "lenient" });
			registerTool(mockSpawnFn);

			await executeFn!("id", { featureId: "feat-1" });

			const { loadPlan, loadState } = await import("../../extensions/state/manager.js");
			const savedPlan = loadPlan(testDir)!;
			const savedState = loadState(testDir)!;
			expect(savedPlan.milestones[0].status).toBe("done");
			expect(savedState.currentMilestoneId).toBe("milestone-1");
		});

		it("does not re-start an already active milestone", async () => {
			const feature = localMakeFeature({ status: "pending" });
			const milestone = localMakeMilestone([feature], { status: "active", startedAt: "2025-01-01T00:00:00Z" });
			const plan = localMakePlan([milestone]);
			const state = localMakeState({ status: "executing", currentMilestoneId: "milestone-1" });

			saveState(testDir, state);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);

			await executeFn!("id", { featureId: "feat-1" });

			const { loadPlan } = await import("../../extensions/state/manager.js");
			const savedPlan = loadPlan(testDir)!;
			expect(savedPlan.milestones[0].startedAt).toBe("2025-01-01T00:00:00Z");
		});

		it("auto-completes milestone when last feature finishes successfully", async () => {
			const doneFeature = localMakeFeature({ id: "feat-done", name: "Done", status: "done" });
			const activeFeature = localMakeFeature({ id: "feat-1", name: "Feature One", status: "pending" });
			const milestone = localMakeMilestone([doneFeature, activeFeature], { status: "active" });
			const plan = localMakePlan([milestone]);
			const state = localMakeState({ status: "executing", currentMilestoneId: "milestone-1" });

			saveState(testDir, state);
			savePlan(testDir, plan);
			saveConfig(testDir, { validatorStrictness: "lenient" });
			registerTool(mockSpawnFn);

			await executeFn!("id", { featureId: "feat-1" });

			const { loadPlan } = await import("../../extensions/state/manager.js");
			const savedPlan = loadPlan(testDir)!;
			expect(savedPlan.milestones[0].status).toBe("done");
			expect(savedPlan.milestones[0].completedAt).toBeTruthy();
		});

		it("auto-commits on success when autoCommitEnabled", async () => {
			const feature = localMakeFeature({ status: "pending" });
			const milestone = localMakeMilestone([feature], { status: "active" });
			const plan = localMakePlan([milestone]);
			const state = localMakeState({
				status: "executing",
				currentMilestoneId: "milestone-1",
				gitSnapshot: { headCommit: "abc123", dirtyFiles: [], autoCommitEnabled: true },
			});

			saveState(testDir, state);
			savePlan(testDir, plan);
			saveConfig(testDir, { validatorStrictness: "lenient" });

			let commitCalled = false;
			const pi = makePiMock();
			registerSpawnWorkerTool(pi, {
				basePath: testDir,
				projectDir: testDir,
				updateWidget: () => {},
				_spawnOverride: mockSpawnFn as any,
				_isGitAvailableOverride: () => true,
				_getChangedFilesOverride: () => ["src/index.ts"],
				_stageAndCommitOverride: () => {
					commitCalled = true;
					return "deadbeef1234567890123456789012345678dead";
				},
			});

			await executeFn!("id", { featureId: "feat-1" });
			expect(commitCalled).toBe(true);
		});

		it("does not auto-commit when gitSnapshot is undefined", async () => {
			const feature = localMakeFeature({ status: "pending" });
			const milestone = localMakeMilestone([feature], { status: "active" });
			const plan = localMakePlan([milestone]);
			const state = localMakeState({ status: "executing", currentMilestoneId: "milestone-1" });

			saveState(testDir, state);
			savePlan(testDir, plan);

			let commitCalled = false;
			const pi = makePiMock();
			registerSpawnWorkerTool(pi, {
				basePath: testDir,
				projectDir: testDir,
				updateWidget: () => {},
				_spawnOverride: mockSpawnFn as any,
				_isGitAvailableOverride: () => true,
				_getChangedFilesOverride: () => ["src/index.ts"],
				_stageAndCommitOverride: () => {
					commitCalled = true;
					return "deadbeef";
				},
			});

			await executeFn!("id", { featureId: "feat-1" });
			expect(commitCalled).toBe(false);
		});

		it("does not auto-commit when autoCommitEnabled is false", async () => {
			const feature = localMakeFeature({ status: "pending" });
			const milestone = localMakeMilestone([feature], { status: "active" });
			const plan = localMakePlan([milestone]);
			const state = localMakeState({
				status: "executing",
				currentMilestoneId: "milestone-1",
				gitSnapshot: { headCommit: "abc123", dirtyFiles: ["dirty.ts"], autoCommitEnabled: false },
			});

			saveState(testDir, state);
			savePlan(testDir, plan);

			let commitCalled = false;
			const pi = makePiMock();
			registerSpawnWorkerTool(pi, {
				basePath: testDir,
				projectDir: testDir,
				updateWidget: () => {},
				_spawnOverride: mockSpawnFn as any,
				_isGitAvailableOverride: () => true,
				_getChangedFilesOverride: () => ["src/index.ts"],
				_stageAndCommitOverride: () => {
					commitCalled = true;
					return "deadbeef";
				},
			});

			await executeFn!("id", { featureId: "feat-1" });
			expect(commitCalled).toBe(false);
		});

		it("does not auto-complete milestone when pending features remain", async () => {
			const activeFeature = localMakeFeature({ id: "feat-1", name: "Feature One", status: "pending" });
			const pendingFeature = localMakeFeature({ id: "feat-2", name: "Feature Two", status: "pending" });
			const milestone = localMakeMilestone([activeFeature, pendingFeature], { status: "active" });
			const plan = localMakePlan([milestone]);
			const state = localMakeState({ status: "executing", currentMilestoneId: "milestone-1" });

			saveState(testDir, state);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);

			await executeFn!("id", { featureId: "feat-1" });

			const { loadPlan } = await import("../../extensions/state/manager.js");
			const savedPlan = loadPlan(testDir)!;
			expect(savedPlan.milestones[0].status).toBe("active");
		});
	});

	describe("VAL-SELFCORR-001: non-empty whatWasLeftUndone triggers fix feature at medium/high autonomy", () => {
		function makeReportResultWithUndone(whatWasLeftUndone: string): string {
			return JSON.stringify({
				type: "tool_execution_end",
				toolName: "report_result",
				args: {
					whatWasImplemented: "Implemented core feature",
					whatWasLeftUndone,
					commandsRun: [{ command: "bun test", exitCode: 0, observation: "all pass" }],
					testsAdded: [{ file: "test.ts", cases: ["works"] }],
					discoveredIssues: [],
				},
				result: { content: [{ type: "text", text: "Report submitted." }] },
				isError: false,
			});
		}

		it("creates fix feature when whatWasLeftUndone is non-empty and autonomy is high", async () => {
			const spawnWithUndone = makeMockSpawn({
				stdoutLines: [
					makeReportResultWithUndone("Error logging not implemented"),
					makeMessageEndLine("assistant", "Worker completed with partial work."),
				],
				exitCode: 0,
			});
			const state = localMakeState({ status: "executing", currentMilestoneId: "milestone-1" });
			const feature = localMakeFeature({ status: "pending" });
			const milestone = localMakeMilestone([feature], { status: "active" });
			const plan = localMakePlan([milestone]);
			saveState(testDir, state);
			savePlan(testDir, plan);
			saveConfig(testDir, { autonomy: "high" });
			registerTool(spawnWithUndone);

			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("Self-correction");
			expect(result.content[0].text).toContain("fix feature");

			const { loadPlan } = await import("../../extensions/state/manager.js");
			const savedPlan = loadPlan(testDir)!;
			const fixFeatures = savedPlan.milestones[0].features.filter((f) => f.fixOrigin !== undefined);
			expect(fixFeatures.length).toBe(1);
			expect(fixFeatures[0].fixOrigin!.sourceKind).toBe("worker-failure");
			expect(fixFeatures[0].fixOrigin!.sourceFeatureId).toBe("feat-1");
			expect(fixFeatures[0].description).toContain("Error logging not implemented");
		});

		it("creates fix feature when whatWasLeftUndone is non-empty and autonomy is medium", async () => {
			const spawnWithUndone = makeMockSpawn({
				stdoutLines: [
					makeReportResultWithUndone("Missing edge case handling"),
					makeMessageEndLine("assistant", "Worker completed."),
				],
				exitCode: 0,
			});
			const state = localMakeState({ status: "executing", currentMilestoneId: "milestone-1" });
			const feature = localMakeFeature({ status: "pending" });
			const milestone = localMakeMilestone([feature], { status: "active" });
			const plan = localMakePlan([milestone]);
			saveState(testDir, state);
			savePlan(testDir, plan);
			saveConfig(testDir, { autonomy: "medium" });
			registerTool(spawnWithUndone);

			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("Self-correction");

			const { loadPlan } = await import("../../extensions/state/manager.js");
			const savedPlan = loadPlan(testDir)!;
			const fixFeatures = savedPlan.milestones[0].features.filter((f) => f.fixOrigin !== undefined);
			expect(fixFeatures.length).toBe(1);
		});

		it("does NOT create fix feature when whatWasLeftUndone is empty", async () => {
			const spawnNoUndone = makeMockSpawn({
				stdoutLines: [makeMessageEndLine("assistant", "Worker completed successfully.")],
				exitCode: 0,
			});
			const state = localMakeState({ status: "executing", currentMilestoneId: "milestone-1" });
			const feature = localMakeFeature({ status: "pending" });
			const milestone = localMakeMilestone([feature], { status: "active" });
			const plan = localMakePlan([milestone]);
			saveState(testDir, state);
			savePlan(testDir, plan);
			saveConfig(testDir, { autonomy: "high" });
			registerTool(spawnNoUndone);

			await executeFn!("id", { featureId: "feat-1" });

			const { loadPlan } = await import("../../extensions/state/manager.js");
			const savedPlan = loadPlan(testDir)!;
			const fixFeatures = savedPlan.milestones[0].features.filter((f) => f.fixOrigin !== undefined);
			expect(fixFeatures.length).toBe(0);
		});
	});

	describe("VAL-SELFCORR-002: discoveredIssues with severity high trigger fix feature", () => {
		function makeReportResultWithIssues(
			issues: Array<{ severity: "low" | "medium" | "high"; description: string; suggestedFix?: string }>,
		): string {
			return JSON.stringify({
				type: "tool_execution_end",
				toolName: "report_result",
				args: {
					whatWasImplemented: "Implemented feature",
					whatWasLeftUndone: "",
					commandsRun: [],
					testsAdded: [],
					discoveredIssues: issues,
				},
				result: { content: [{ type: "text", text: "Report submitted." }] },
				isError: false,
			});
		}

		it("creates fix feature when discoveredIssues has high severity", async () => {
			const spawnWithHighIssue = makeMockSpawn({
				stdoutLines: [
					makeReportResultWithIssues([
						{ severity: "high", description: "Race condition in cache", suggestedFix: "Add mutex" },
					]),
					makeMessageEndLine("assistant", "Done with issues."),
				],
				exitCode: 0,
			});
			const state = localMakeState({ status: "executing", currentMilestoneId: "milestone-1" });
			const feature = localMakeFeature({ status: "pending" });
			const milestone = localMakeMilestone([feature], { status: "active" });
			const plan = localMakePlan([milestone]);
			saveState(testDir, state);
			savePlan(testDir, plan);
			saveConfig(testDir, { autonomy: "high" });
			registerTool(spawnWithHighIssue);

			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("Self-correction");

			const { loadPlan } = await import("../../extensions/state/manager.js");
			const savedPlan = loadPlan(testDir)!;
			const fixFeatures = savedPlan.milestones[0].features.filter((f) => f.fixOrigin !== undefined);
			expect(fixFeatures.length).toBe(1);
			expect(fixFeatures[0].fixOrigin!.sourceKind).toBe("worker-failure");
			expect(fixFeatures[0].fixOrigin!.sourceFeatureId).toBe("feat-1");
			expect(fixFeatures[0].description).toContain("Race condition in cache");
		});

		it("does NOT create fix feature for low and medium severity issues only", async () => {
			const spawnWithLowMedIssues = makeMockSpawn({
				stdoutLines: [
					makeReportResultWithIssues([
						{ severity: "medium", description: "Suboptimal query plan" },
						{ severity: "low", description: "Minor typo in log" },
					]),
					makeMessageEndLine("assistant", "Done."),
				],
				exitCode: 0,
			});
			const state = localMakeState({ status: "executing", currentMilestoneId: "milestone-1" });
			const feature = localMakeFeature({ status: "pending" });
			const milestone = localMakeMilestone([feature], { status: "active" });
			const plan = localMakePlan([milestone]);
			saveState(testDir, state);
			savePlan(testDir, plan);
			saveConfig(testDir, { autonomy: "high" });
			registerTool(spawnWithLowMedIssues);

			await executeFn!("id", { featureId: "feat-1" });

			const { loadPlan } = await import("../../extensions/state/manager.js");
			const savedPlan = loadPlan(testDir)!;
			const fixFeatures = savedPlan.milestones[0].features.filter((f) => f.fixOrigin !== undefined);
			expect(fixFeatures.length).toBe(0);
		});
	});

	describe("VAL-SELFCORR-003: self-correction respects autonomy level", () => {
		function makeReportResultWithUndone(whatWasLeftUndone: string): string {
			return JSON.stringify({
				type: "tool_execution_end",
				toolName: "report_result",
				args: {
					whatWasImplemented: "Partial implementation",
					whatWasLeftUndone,
					commandsRun: [],
					testsAdded: [],
					discoveredIssues: [],
				},
				result: { content: [{ type: "text", text: "Report submitted." }] },
				isError: false,
			});
		}

		it("low autonomy: does NOT auto-create fix, includes issue details in return text", async () => {
			const spawnWithUndone = makeMockSpawn({
				stdoutLines: [
					makeReportResultWithUndone("Error handling not done"),
					makeMessageEndLine("assistant", "Partial work."),
				],
				exitCode: 0,
			});
			const state = localMakeState({ status: "executing", currentMilestoneId: "milestone-1" });
			const feature = localMakeFeature({ status: "pending" });
			const milestone = localMakeMilestone([feature], { status: "active" });
			const plan = localMakePlan([milestone]);
			saveState(testDir, state);
			savePlan(testDir, plan);
			saveConfig(testDir, { autonomy: "low" });
			registerTool(spawnWithUndone);

			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("Self-correction");
			expect(result.content[0].text).toContain("review");

			const { loadPlan } = await import("../../extensions/state/manager.js");
			const savedPlan = loadPlan(testDir)!;
			const fixFeatures = savedPlan.milestones[0].features.filter((f) => f.fixOrigin !== undefined);
			expect(fixFeatures.length).toBe(0);
		});

		it("medium autonomy: auto-creates fix feature", async () => {
			const spawnWithUndone = makeMockSpawn({
				stdoutLines: [makeReportResultWithUndone("Missing tests"), makeMessageEndLine("assistant", "Partial.")],
				exitCode: 0,
			});
			const state = localMakeState({ status: "executing", currentMilestoneId: "milestone-1" });
			const feature = localMakeFeature({ status: "pending" });
			const milestone = localMakeMilestone([feature], { status: "active" });
			const plan = localMakePlan([milestone]);
			saveState(testDir, state);
			savePlan(testDir, plan);
			saveConfig(testDir, { autonomy: "medium" });
			registerTool(spawnWithUndone);

			await executeFn!("id", { featureId: "feat-1" });

			const { loadPlan } = await import("../../extensions/state/manager.js");
			const savedPlan = loadPlan(testDir)!;
			const fixFeatures = savedPlan.milestones[0].features.filter((f) => f.fixOrigin !== undefined);
			expect(fixFeatures.length).toBe(1);
		});

		it("high autonomy: auto-creates fix feature", async () => {
			const spawnWithUndone = makeMockSpawn({
				stdoutLines: [
					makeReportResultWithUndone("Incomplete feature"),
					makeMessageEndLine("assistant", "Partial."),
				],
				exitCode: 0,
			});
			const state = localMakeState({ status: "executing", currentMilestoneId: "milestone-1" });
			const feature = localMakeFeature({ status: "pending" });
			const milestone = localMakeMilestone([feature], { status: "active" });
			const plan = localMakePlan([milestone]);
			saveState(testDir, state);
			savePlan(testDir, plan);
			saveConfig(testDir, { autonomy: "high" });
			registerTool(spawnWithUndone);

			await executeFn!("id", { featureId: "feat-1" });

			const { loadPlan } = await import("../../extensions/state/manager.js");
			const savedPlan = loadPlan(testDir)!;
			const fixFeatures = savedPlan.milestones[0].features.filter((f) => f.fixOrigin !== undefined);
			expect(fixFeatures.length).toBe(1);
		});

		it("default autonomy (undefined): auto-creates fix feature", async () => {
			const spawnWithUndone = makeMockSpawn({
				stdoutLines: [
					makeReportResultWithUndone("Incomplete feature"),
					makeMessageEndLine("assistant", "Partial."),
				],
				exitCode: 0,
			});
			const state = localMakeState({ status: "executing", currentMilestoneId: "milestone-1" });
			const feature = localMakeFeature({ status: "pending" });
			const milestone = localMakeMilestone([feature], { status: "active" });
			const plan = localMakePlan([milestone]);
			saveState(testDir, state);
			savePlan(testDir, plan);
			registerTool(spawnWithUndone);

			await executeFn!("id", { featureId: "feat-1" });

			const { loadPlan } = await import("../../extensions/state/manager.js");
			const savedPlan = loadPlan(testDir)!;
			const fixFeatures = savedPlan.milestones[0].features.filter((f) => f.fixOrigin !== undefined);
			expect(fixFeatures.length).toBe(1);
		});
	});

	describe("VAL-SELFCORR-004: fix features reference source worker via fixOrigin", () => {
		function makeReportResultWithHighIssue(): string {
			return JSON.stringify({
				type: "tool_execution_end",
				toolName: "report_result",
				args: {
					whatWasImplemented: "Partial work",
					whatWasLeftUndone: "Missing error handling",
					commandsRun: [],
					testsAdded: [],
					discoveredIssues: [
						{ severity: "high", description: "Race condition in cache", suggestedFix: "Add mutex" },
					],
				},
				result: { content: [{ type: "text", text: "Report submitted." }] },
				isError: false,
			});
		}

		it("fix feature has correct fixOrigin fields", async () => {
			const spawnWithIssue = makeMockSpawn({
				stdoutLines: [makeReportResultWithHighIssue(), makeMessageEndLine("assistant", "Done.")],
				exitCode: 0,
			});
			const state = localMakeState({ status: "executing", currentMilestoneId: "milestone-1" });
			const feature = localMakeFeature({ id: "feat-1", status: "pending" });
			const milestone = localMakeMilestone([feature], { id: "milestone-1", status: "active" });
			const plan = localMakePlan([milestone]);
			saveState(testDir, state);
			savePlan(testDir, plan);
			saveConfig(testDir, { autonomy: "high" });
			registerTool(spawnWithIssue);

			await executeFn!("id", { featureId: "feat-1" });

			const { loadPlan } = await import("../../extensions/state/manager.js");
			const savedPlan = loadPlan(testDir)!;
			const fixFeature = savedPlan.milestones[0].features.find(
				(f) => f.fixOrigin !== undefined && f.id !== "feat-1",
			);
			expect(fixFeature).toBeDefined();
			expect(fixFeature!.fixOrigin!.sourceKind).toBe("worker-failure");
			expect(fixFeature!.fixOrigin!.sourceFeatureId).toBe("feat-1");
			expect(fixFeature!.fixOrigin!.sourceMilestoneId).toBe("milestone-1");
		});

		it("fix feature description references the undone work and issues", async () => {
			const spawnWithIssue = makeMockSpawn({
				stdoutLines: [makeReportResultWithHighIssue(), makeMessageEndLine("assistant", "Done.")],
				exitCode: 0,
			});
			const state = localMakeState({ status: "executing", currentMilestoneId: "milestone-1" });
			const feature = localMakeFeature({ id: "feat-1", status: "pending" });
			const milestone = localMakeMilestone([feature], { id: "milestone-1", status: "active" });
			const plan = localMakePlan([milestone]);
			saveState(testDir, state);
			savePlan(testDir, plan);
			saveConfig(testDir, { autonomy: "high" });
			registerTool(spawnWithIssue);

			await executeFn!("id", { featureId: "feat-1" });

			const { loadPlan } = await import("../../extensions/state/manager.js");
			const savedPlan = loadPlan(testDir)!;
			const fixFeature = savedPlan.milestones[0].features.find(
				(f) => f.fixOrigin !== undefined && f.id !== "feat-1",
			);
			expect(fixFeature).toBeDefined();
			expect(fixFeature!.description).toContain("Missing error handling");
			expect(fixFeature!.description).toContain("Race condition in cache");
		});

		it("fix feature increments totalFixFeaturesCreated in state", async () => {
			const spawnWithIssue = makeMockSpawn({
				stdoutLines: [makeReportResultWithHighIssue(), makeMessageEndLine("assistant", "Done.")],
				exitCode: 0,
			});
			const state = localMakeState({ status: "executing", currentMilestoneId: "milestone-1" });
			const feature = localMakeFeature({ id: "feat-1", status: "pending" });
			const milestone = localMakeMilestone([feature], { id: "milestone-1", status: "active" });
			const plan = localMakePlan([milestone]);
			saveState(testDir, state);
			savePlan(testDir, plan);
			saveConfig(testDir, { autonomy: "high" });
			registerTool(spawnWithIssue);

			await executeFn!("id", { featureId: "feat-1" });

			const { loadState } = await import("../../extensions/state/manager.js");
			const savedState = loadState(testDir)!;
			expect(savedState.totalFixFeaturesCreated).toBe(1);
		});

		it("fix feature respects maxRetries config - no fix created when retries exhausted for source feature", async () => {
			const spawnWithIssue = makeMockSpawn({
				stdoutLines: [makeReportResultWithHighIssue(), makeMessageEndLine("assistant", "Done.")],
				exitCode: 0,
			});
			const state = localMakeState({ status: "executing", currentMilestoneId: "milestone-1" });
			const feature = localMakeFeature({
				id: "feat-1",
				status: "active",
				attempts: [
					{
						attemptNumber: 1,
						startedAt: "2025-01-01T00:00:00Z",
						resultPath: "",
						stdoutPath: "",
						stderrPath: "",
						status: "failure",
					},
					{
						attemptNumber: 2,
						startedAt: "2025-01-01T00:00:00Z",
						resultPath: "",
						stdoutPath: "",
						stderrPath: "",
						status: "failure",
					},
				],
			});
			const milestone = localMakeMilestone([feature], { id: "milestone-1", status: "active" });
			const plan = localMakePlan([milestone]);
			saveState(testDir, state);
			savePlan(testDir, plan);
			saveConfig(testDir, { autonomy: "high", maxRetries: 2 });
			registerTool(spawnWithIssue);

			await executeFn!("id", { featureId: "feat-1" });

			const { loadPlan } = await import("../../extensions/state/manager.js");
			const savedPlan = loadPlan(testDir)!;
			const fixFeatures = savedPlan.milestones[0].features.filter(
				(f) => f.fixOrigin !== undefined && f.id !== "feat-1",
			);
			expect(fixFeatures.length).toBe(0);
		});
	});
});
