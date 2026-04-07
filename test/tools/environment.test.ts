import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Value } from "@sinclair/typebox/value";
import { generateWorkerContext } from "../../extensions/orchestrator/worker-prompt.js";
import {
	clearStateCache,
	invalidateCaches,
	loadEnvironment,
	loadState,
	saveConfig,
	saveEnvironment,
	savePlan,
	saveState,
} from "../../extensions/state/manager.js";
import { registerConfigureEnvironmentTool } from "../../extensions/tools/configure-environment.js";
import { registerSpawnWorkerTool } from "../../extensions/tools/spawn-worker.js";
import { EnvironmentDescriptorSchema } from "../../extensions/types.js";
import type { TempDir } from "../helpers/index.js";
import { createMockSpawn, createTempDir, makeFeature, makeMilestone, makePlan, makeState } from "../helpers/index.js";
import { createMockPi } from "../helpers/mock-pi.js";

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

let tmp: TempDir;

function makeBasePath(): string {
	const dir = join(tmp.path, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

beforeEach(() => {
	clearStateCache();
	tmp = createTempDir("pi-missions-env-");
});

afterEach(() => {
	clearStateCache();
	tmp.cleanup();
});

describe("EnvironmentDescriptorSchema (VAL-ENV-001)", () => {
	it("accepts valid full environment descriptor", () => {
		const valid = {
			services: [{ name: "postgres", type: "database", config: { port: 5432 } }],
			envVars: [
				{ key: "DB_HOST", value: "localhost" },
				{ key: "DB_PASS", value: "secret123", secret: true },
			],
			setupCommands: ["docker compose up -d", "npm run db:migrate"],
		};
		expect(Value.Check(EnvironmentDescriptorSchema, valid)).toBe(true);
	});

	it("accepts empty object (all fields optional)", () => {
		expect(Value.Check(EnvironmentDescriptorSchema, {})).toBe(true);
	});

	it("accepts partial descriptor with only services", () => {
		expect(Value.Check(EnvironmentDescriptorSchema, { services: [{ name: "redis", type: "cache" }] })).toBe(true);
	});

	it("accepts partial descriptor with only envVars", () => {
		expect(Value.Check(EnvironmentDescriptorSchema, { envVars: [{ key: "API_KEY", value: "abc" }] })).toBe(true);
	});

	it("accepts partial descriptor with only setupCommands", () => {
		expect(Value.Check(EnvironmentDescriptorSchema, { setupCommands: ["echo hello"] })).toBe(true);
	});

	it("rejects invalid services (name not string)", () => {
		expect(
			Value.Check(EnvironmentDescriptorSchema, {
				services: [{ name: 123, type: "database" }],
			}),
		).toBe(false);
	});

	it("rejects invalid envVars (missing key)", () => {
		expect(
			Value.Check(EnvironmentDescriptorSchema, {
				envVars: [{ value: "abc" }],
			}),
		).toBe(false);
	});

	it("rejects invalid setupCommands (not array of strings)", () => {
		expect(Value.Check(EnvironmentDescriptorSchema, { setupCommands: [123] })).toBe(false);
	});

	it("accepts envVars without secret field", () => {
		expect(
			Value.Check(EnvironmentDescriptorSchema, {
				envVars: [{ key: "HOST", value: "localhost" }],
			}),
		).toBe(true);
	});

	it("accepts services without config", () => {
		expect(
			Value.Check(EnvironmentDescriptorSchema, {
				services: [{ name: "redis", type: "cache" }],
			}),
		).toBe(true);
	});
});

describe("saveEnvironment / loadEnvironment (state manager)", () => {
	it("saves and loads environment descriptor", () => {
		const basePath = makeBasePath();
		const descriptor = {
			services: [{ name: "postgres", type: "database" }],
			envVars: [{ key: "DB_HOST", value: "localhost" }],
			setupCommands: ["npm install"],
		};
		saveEnvironment(basePath, descriptor);
		const loaded = loadEnvironment(basePath);
		expect(loaded).toEqual(descriptor);
	});

	it("returns null when no environment.json exists", () => {
		const basePath = makeBasePath();
		expect(loadEnvironment(basePath)).toBeNull();
	});

	it("overwrites existing environment on save", () => {
		const basePath = makeBasePath();
		saveEnvironment(basePath, { services: [{ name: "redis", type: "cache" }] });
		saveEnvironment(basePath, { services: [{ name: "postgres", type: "database" }] });
		const loaded = loadEnvironment(basePath);
		expect(loaded?.services).toEqual([{ name: "postgres", type: "database" }]);
	});

	it("persists across cache invalidation", () => {
		const basePath = makeBasePath();
		const descriptor = { setupCommands: ["echo persisted"] };
		saveEnvironment(basePath, descriptor);
		invalidateCaches(basePath);
		const loaded = loadEnvironment(basePath);
		expect(loaded).toEqual(descriptor);
	});

	it("throws descriptive error for invalid JSON", () => {
		const basePath = makeBasePath();
		mkdirSync(basePath, { recursive: true });
		writeFileSync(join(basePath, "environment.json"), "not json{{{");
		expect(() => loadEnvironment(basePath)).toThrow("invalid JSON");
	});

	it("throws descriptive error for schema validation failure", () => {
		const basePath = makeBasePath();
		mkdirSync(basePath, { recursive: true });
		writeFileSync(join(basePath, "environment.json"), JSON.stringify({ services: [{ name: 123 }] }));
		expect(() => loadEnvironment(basePath)).toThrow("schema validation");
	});
});

describe("configure_environment tool", () => {
	it("creates environment.json with valid descriptor (VAL-ENV-002)", () => {
		const basePath = makeBasePath();
		const state = makeState({ status: "planning" });
		saveState(basePath, state);

		const { pi, getRegisteredTool } = createMockPi();
		registerConfigureEnvironmentTool(pi, { basePath });
		const tool = getRegisteredTool("configure_environment");
		expect(tool).toBeDefined();

		const result = tool!.execute(
			"tc-1",
			{
				services: [{ name: "postgres", type: "database" }],
				envVars: [],
				setupCommands: ["docker compose up -d"],
			},
			undefined,
			undefined,
			undefined as never,
		);

		return result.then((r) => {
			expect(r.content[0].type).toBe("text");
			expect((r.content[0] as { text: string }).text).not.toContain("Error");
			expect(existsSync(join(basePath, "environment.json"))).toBe(true);
			const loaded = loadEnvironment(basePath);
			expect(loaded?.services).toEqual([{ name: "postgres", type: "database" }]);
		});
	});

	it("updates existing environment.json (VAL-ENV-003)", () => {
		const basePath = makeBasePath();
		const state = makeState({ status: "planning" });
		saveState(basePath, state);

		const { pi, getRegisteredTool } = createMockPi();
		registerConfigureEnvironmentTool(pi, { basePath });
		const tool = getRegisteredTool("configure_environment");

		tool!.execute(
			"tc-1",
			{ services: [{ name: "old-service", type: "old" }] },
			undefined,
			undefined,
			undefined as never,
		);

		return tool!
			.execute(
				"tc-2",
				{ services: [{ name: "new-service", type: "new" }] },
				undefined,
				undefined,
				undefined as never,
			)
			.then((r) => {
				expect(r.content[0].type).toBe("text");
				expect((r.content[0] as { text: string }).text).not.toContain("Error");
				const loaded = loadEnvironment(basePath);
				expect(loaded?.services).toEqual([{ name: "new-service", type: "new" }]);
			});
	});

	it("rejects when mission state is not planning", () => {
		const basePath = makeBasePath();
		const state = makeState({ status: "executing" });
		saveState(basePath, state);

		const { pi, getRegisteredTool } = createMockPi();
		registerConfigureEnvironmentTool(pi, { basePath });
		const tool = getRegisteredTool("configure_environment");

		return tool!.execute("tc-1", { setupCommands: [] }, undefined, undefined, undefined as never).then((r) => {
			expect((r.content[0] as { text: string }).text).toContain("Error");
		});
	});

	it("rejects when no mission state exists", () => {
		const basePath = makeBasePath();

		const { pi, getRegisteredTool } = createMockPi();
		registerConfigureEnvironmentTool(pi, { basePath });
		const tool = getRegisteredTool("configure_environment");

		return tool!.execute("tc-1", { setupCommands: [] }, undefined, undefined, undefined as never).then((r) => {
			expect((r.content[0] as { text: string }).text).toContain("Error");
		});
	});

	it("handles all three field types (VAL-ENV-004)", () => {
		const basePath = makeBasePath();
		const state = makeState({ status: "planning" });
		saveState(basePath, state);

		const { pi, getRegisteredTool } = createMockPi();
		registerConfigureEnvironmentTool(pi, { basePath });
		const tool = getRegisteredTool("configure_environment");

		const descriptor = {
			services: [{ name: "redis", type: "cache" }],
			envVars: [{ key: "DATABASE_URL", value: "postgres://localhost/db" }],
			setupCommands: ["npm install", "npm run db:migrate"],
		};

		return tool!.execute("tc-1", descriptor, undefined, undefined, undefined as never).then(() => {
			const loaded = loadEnvironment(basePath);
			expect(loaded).toEqual(descriptor);
		});
	});
});

describe("generateWorkerContext with environment info (VAL-ENV-006)", () => {
	it("includes services and non-secret env vars in context", () => {
		const basePath = makeBasePath();
		mkdirSync(join(basePath, "library"), { recursive: true });
		saveEnvironment(basePath, {
			services: [{ name: "postgres", type: "database" }],
			envVars: [
				{ key: "DB_HOST", value: "localhost" },
				{ key: "DB_PASS", value: "secret123", secret: true },
			],
			setupCommands: [],
		});

		const context = generateWorkerContext(undefined, undefined, basePath);
		expect(context).toContain("postgres");
		expect(context).toContain("DB_HOST");
		expect(context).toContain("localhost");
	});

	it("masks secret env var values", () => {
		const basePath = makeBasePath();
		mkdirSync(join(basePath, "library"), { recursive: true });
		saveEnvironment(basePath, {
			services: [],
			envVars: [
				{ key: "API_KEY", value: "super-secret-key", secret: true },
				{ key: "HOST", value: "localhost" },
			],
			setupCommands: [],
		});

		const context = generateWorkerContext(undefined, undefined, basePath);
		expect(context).toContain("API_KEY");
		expect(context).toContain("<secret>");
		expect(context).not.toContain("super-secret-key");
		expect(context).toContain("HOST");
		expect(context).toContain("localhost");
	});

	it("omits environment section when no environment.json exists", () => {
		const basePath = makeBasePath();
		mkdirSync(join(basePath, "library"), { recursive: true });
		const context = generateWorkerContext(undefined, undefined, basePath);
		expect(context).not.toContain("Environment");
	});

	it("omits environment section when environment is empty", () => {
		const basePath = makeBasePath();
		mkdirSync(join(basePath, "library"), { recursive: true });
		saveEnvironment(basePath, {});
		const context = generateWorkerContext(undefined, undefined, basePath);
		expect(context).not.toContain("Environment");
	});
});

describe("Environment persistence across sessions (VAL-ENV-007)", () => {
	it("environment written in one session loads in another", () => {
		const basePath = makeBasePath();
		const descriptor = {
			services: [{ name: "redis", type: "cache" }],
			envVars: [{ key: "PORT", value: "6379" }],
			setupCommands: ["docker start redis"],
		};
		saveEnvironment(basePath, descriptor);
		invalidateCaches(basePath);
		const loaded = loadEnvironment(basePath);
		expect(loaded).toEqual(descriptor);
	});
});

describe("Setup commands run before first worker spawn (VAL-ENV-005)", () => {
	it("runs setup commands before first worker spawn", async () => {
		const basePath = makeBasePath();
		writeFileSync(join(basePath, "AGENTS.md"), "# Test", "utf8");
		const feature = makeFeature({ id: "feat-1", name: "Feature One", status: "pending" });
		const milestone = makeMilestone({ id: "m1", name: "M1", features: [feature] });
		const plan = makePlan({ milestones: [milestone], approvedAt: new Date().toISOString() });
		const state = makeState({ status: "approved" });

		saveState(basePath, state);
		savePlan(basePath, plan);
		saveEnvironment(basePath, {
			setupCommands: ["echo setup-ran"],
		});

		const setupCalls: string[] = [];
		const mockSetupRun = async (cmd: string) => {
			setupCalls.push(cmd);
			return { success: true, command: cmd, exitCode: 0, stdout: "", stderr: "" };
		};

		const msgEnd = JSON.stringify({
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
		});

		const mockSpawnFn = createMockSpawn({
			stdoutLines: [makeReportResultLine(), msgEnd],
			exitCode: 0,
		});

		let executeFn:
			| ((id: string, params: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>)
			| null = null;

		registerSpawnWorkerTool(
			{
				registerTool: (opts: { name: string; execute: (...args: unknown[]) => unknown }) => {
					executeFn = ((id: string, params: unknown) =>
						opts.execute(id, params, undefined, undefined, undefined)) as typeof executeFn;
				},
			} as unknown as ExtensionAPI,
			{
				basePath,
				projectDir: basePath,
				updateWidget: () => {},
				_spawnOverride: mockSpawnFn,
				_runSetupCommandOverride: mockSetupRun,
			},
		);

		const result = await executeFn!("tc-1", { featureId: "feat-1" });
		expect(setupCalls).toEqual(["echo setup-ran"]);
		expect(result.content[0].text).not.toContain("Error");

		const updatedState = loadState(basePath);
		expect(updatedState?.environmentSetupComplete).toBe(true);
	});

	it("does not re-run setup commands on subsequent spawns", async () => {
		const basePath = makeBasePath();
		writeFileSync(join(basePath, "AGENTS.md"), "# Test", "utf8");
		const feature1 = makeFeature({ id: "feat-1", name: "Feature One", status: "pending" });
		const feature2 = makeFeature({ id: "feat-2", name: "Feature Two", status: "pending" });
		const milestone = makeMilestone({ id: "m1", name: "M1", features: [feature1, feature2] });
		const plan = makePlan({ milestones: [milestone], approvedAt: new Date().toISOString() });
		const state = makeState({ status: "approved" });

		saveState(basePath, state);
		savePlan(basePath, plan);
		saveEnvironment(basePath, {
			setupCommands: ["echo setup-ran"],
		});

		const setupCalls: string[] = [];
		const mockSetupRun = async (cmd: string) => {
			setupCalls.push(cmd);
			return { success: true, command: cmd, exitCode: 0, stdout: "", stderr: "" };
		};

		const msgEnd = JSON.stringify({
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
		});

		const mockSpawnFn = createMockSpawn({
			stdoutLines: [makeReportResultLine(), msgEnd],
			exitCode: 0,
		});

		let executeFn:
			| ((id: string, params: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>)
			| null = null;

		const registerToolForTest = () => {
			executeFn = null;
			registerSpawnWorkerTool(
				{
					registerTool: (opts: { name: string; execute: (...args: unknown[]) => unknown }) => {
						executeFn = ((id: string, params: unknown) =>
							opts.execute(id, params, undefined, undefined, undefined)) as typeof executeFn;
					},
				} as unknown as ExtensionAPI,
				{
					basePath,
					projectDir: basePath,
					updateWidget: () => {},
					_spawnOverride: mockSpawnFn,
					_runSetupCommandOverride: mockSetupRun,
				},
			);
		};

		registerToolForTest();
		await executeFn!("tc-1", { featureId: "feat-1" });

		registerToolForTest();
		await executeFn!("tc-2", { featureId: "feat-2" });

		expect(setupCalls).toEqual(["echo setup-ran"]);
	});

	it("returns error when setup command fails", async () => {
		const basePath = makeBasePath();
		writeFileSync(join(basePath, "AGENTS.md"), "# Test", "utf8");
		const feature = makeFeature({ id: "feat-1", name: "Feature One", status: "pending" });
		const milestone = makeMilestone({ id: "m1", name: "M1", features: [feature] });
		const plan = makePlan({ milestones: [milestone], approvedAt: new Date().toISOString() });
		const state = makeState({ status: "approved" });

		saveState(basePath, state);
		savePlan(basePath, plan);
		saveEnvironment(basePath, {
			setupCommands: ["exit 1"],
		});

		const mockSetupRun = async (cmd: string) => ({
			success: false as const,
			command: cmd,
			exitCode: 1 as number | null,
			stdout: "",
			stderr: "setup failure",
		});

		let executeFn:
			| ((id: string, params: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>)
			| null = null;

		registerSpawnWorkerTool(
			{
				registerTool: (opts: { name: string; execute: (...args: unknown[]) => unknown }) => {
					executeFn = ((id: string, params: unknown) =>
						opts.execute(id, params, undefined, undefined, undefined)) as typeof executeFn;
				},
			} as unknown as ExtensionAPI,
			{
				basePath,
				projectDir: basePath,
				updateWidget: () => {},
				_spawnOverride: createMockSpawn({ exitCode: 0 }),
				_runSetupCommandOverride: mockSetupRun,
			},
		);

		const result = await executeFn!("tc-1", { featureId: "feat-1" });
		expect(result.content[0].text).toContain("Error");
		expect(result.content[0].text).toContain("environment setup failed");
	});

	it("skips setup when no environment.json exists", async () => {
		const basePath = makeBasePath();
		writeFileSync(join(basePath, "AGENTS.md"), "# Test", "utf8");
		const feature = makeFeature({ id: "feat-1", name: "Feature One", status: "pending" });
		const milestone = makeMilestone({ id: "m1", name: "M1", features: [feature] });
		const plan = makePlan({ milestones: [milestone], approvedAt: new Date().toISOString() });
		const state = makeState({ status: "approved" });

		saveState(basePath, state);
		savePlan(basePath, plan);
		saveConfig(basePath, { models: {}, validatorStrictness: "lenient" });

		const setupCalls: string[] = [];
		const mockSetupRun = async (cmd: string) => {
			setupCalls.push(cmd);
			return { success: true, command: cmd, exitCode: 0, stdout: "", stderr: "" };
		};

		const msgEnd = JSON.stringify({
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
		});

		const mockSpawnFn = createMockSpawn({
			stdoutLines: [makeReportResultLine(), msgEnd],
			exitCode: 0,
		});

		let executeFn:
			| ((id: string, params: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>)
			| null = null;

		registerSpawnWorkerTool(
			{
				registerTool: (opts: { name: string; execute: (...args: unknown[]) => unknown }) => {
					executeFn = ((id: string, params: unknown) =>
						opts.execute(id, params, undefined, undefined, undefined)) as typeof executeFn;
				},
			} as unknown as ExtensionAPI,
			{
				basePath,
				projectDir: basePath,
				updateWidget: () => {},
				_spawnOverride: mockSpawnFn,
				_runSetupCommandOverride: mockSetupRun,
			},
		);

		const result = await executeFn!("tc-1", { featureId: "feat-1" });
		expect(setupCalls).toEqual([]);
		expect(result.content[0].text).toContain("succeeded");
	});
});
