import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	DEFAULT_WORKER_MODEL,
	getDefaultConfig,
	loadMissionConfig,
	resolveModel,
	resolveValidationCommands,
} from "../extensions/config.js";
import { saveConfig } from "../extensions/state/manager.js";
import type { Milestone, MissionConfig, MissionPlan } from "../extensions/types.js";
import { makeMilestone as _sm, makePlan as _sp } from "./helpers/index.js";

const TMP_BASE = join(import.meta.dir, "__config_test_tmp__");

function makeTmpDir(): string {
	const dir = join(TMP_BASE, Math.random().toString(36).slice(2));
	mkdirSync(dir, { recursive: true });
	return dir;
}

function makeProjectDir(): string {
	const dir = join(TMP_BASE, `project_${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function makePlan(overrides: Partial<MissionPlan> = {}): MissionPlan {
	return _sp({ milestones: [makeMilestone()], validationCommands: ["bun test"], ...overrides });
}

function makeMilestone(overrides: Partial<Milestone> = {}): Milestone {
	return _sm({ validationCommands: overrides.validationCommands, ...overrides });
}

beforeEach(() => mkdirSync(TMP_BASE, { recursive: true }));
afterEach(() => rmSync(TMP_BASE, { recursive: true, force: true }));

describe("getDefaultConfig", () => {
	it("returns correct defaults", () => {
		const config = getDefaultConfig();
		expect(config.maxRetries).toBe(3);
		expect(config.validation?.timeoutMs).toBe(120000);
		expect(config.autonomy).toBe("medium");
		expect(config.git?.autoCommit).toBe(true);
	});

	it("returns a fresh clone each call", () => {
		const a = getDefaultConfig();
		const b = getDefaultConfig();
		a.maxRetries = 99;
		expect(b.maxRetries).toBe(3);
	});
});

describe("loadMissionConfig", () => {
	it("returns defaults when no config file exists", () => {
		const basePath = makeTmpDir();
		const config = loadMissionConfig(basePath);
		expect(config.maxRetries).toBe(3);
		expect(config.validation?.timeoutMs).toBe(120000);
		expect(config.autonomy).toBe("medium");
		expect(config.git?.autoCommit).toBe(true);
	});

	it("returns file values when config exists", () => {
		const basePath = makeTmpDir();
		const stored: MissionConfig = { maxRetries: 5, autonomy: "high" };
		saveConfig(basePath, stored);
		const config = loadMissionConfig(basePath);
		expect(config.maxRetries).toBe(5);
		expect(config.autonomy).toBe("high");
	});

	it("merges partial config with defaults", () => {
		const basePath = makeTmpDir();
		const stored: MissionConfig = { maxRetries: 7 };
		saveConfig(basePath, stored);
		const config = loadMissionConfig(basePath);
		expect(config.maxRetries).toBe(7);
		expect(config.validation?.timeoutMs).toBe(120000);
		expect(config.autonomy).toBe("medium");
	});
});

describe("resolveValidationCommands", () => {
	describe("priority chain", () => {
		it("uses config commands when present (highest priority)", () => {
			const projectDir = makeProjectDir();
			const config: MissionConfig = { validation: { commands: ["npm run typecheck", "npm run test"] } };
			const plan = makePlan({ validationCommands: ["make test"] });
			const milestone = makeMilestone({ validationCommands: ["cargo test"] });
			const commands = resolveValidationCommands(config, plan, milestone, projectDir);
			expect(commands).toContain("npm run typecheck");
			expect(commands).toContain("npm run test");
			expect(commands).not.toContain("make test");
			expect(commands).not.toContain("cargo test");
		});

		it("uses milestone validationCommands when config has none", () => {
			const projectDir = makeProjectDir();
			const config: MissionConfig = {};
			const plan = makePlan({ validationCommands: ["make test"] });
			const milestone = makeMilestone({ validationCommands: ["cargo test"] });
			const commands = resolveValidationCommands(config, plan, milestone, projectDir);
			expect(commands).toContain("cargo test");
			expect(commands).not.toContain("make test");
		});

		it("uses plan-level commands when config and milestone have none", () => {
			const projectDir = makeProjectDir();
			const config: MissionConfig = {};
			const plan = makePlan({ validationCommands: ["npm run test"] });
			const milestone = makeMilestone();
			const commands = resolveValidationCommands(config, plan, milestone, projectDir);
			expect(commands).toContain("npm run test");
		});

		it("falls back to auto-detect when all explicit sources are empty", () => {
			const projectDir = makeProjectDir();
			writeFileSync(join(projectDir, "Cargo.toml"), "[package]");
			const config: MissionConfig = {};
			const commands = resolveValidationCommands(config, null, null, projectDir);
			expect(commands).toContain("cargo test");
		});

		it("returns empty array when auto-detect finds nothing", () => {
			const projectDir = makeProjectDir();
			const config: MissionConfig = {};
			const commands = resolveValidationCommands(config, null, null, projectDir);
			expect(commands).toEqual([]);
		});
	});

	describe("canonical order", () => {
		it("sorts commands as typecheck -> lint -> test -> build", () => {
			const projectDir = makeProjectDir();
			const config: MissionConfig = {
				validation: {
					commands: ["npm run build", "npm run test", "npm run lint", "npm run typecheck"],
				},
			};
			const commands = resolveValidationCommands(config, null, null, projectDir);
			expect(commands.indexOf("npm run typecheck")).toBeLessThan(commands.indexOf("npm run lint"));
			expect(commands.indexOf("npm run lint")).toBeLessThan(commands.indexOf("npm run test"));
			expect(commands.indexOf("npm run test")).toBeLessThan(commands.indexOf("npm run build"));
		});
	});
});

describe("auto-detection", () => {
	it("detects package.json typecheck script", () => {
		const projectDir = makeProjectDir();
		writeFileSync(join(projectDir, "package.json"), JSON.stringify({ scripts: { typecheck: "tsc --noEmit" } }));
		const commands = resolveValidationCommands({}, null, null, projectDir);
		expect(commands).toContain("npm run typecheck");
	});

	it("detects package.json lint script", () => {
		const projectDir = makeProjectDir();
		writeFileSync(join(projectDir, "package.json"), JSON.stringify({ scripts: { lint: "eslint ." } }));
		const commands = resolveValidationCommands({}, null, null, projectDir);
		expect(commands).toContain("npm run lint");
	});

	it("detects package.json test script", () => {
		const projectDir = makeProjectDir();
		writeFileSync(join(projectDir, "package.json"), JSON.stringify({ scripts: { test: "jest" } }));
		const commands = resolveValidationCommands({}, null, null, projectDir);
		expect(commands).toContain("npm run test");
	});

	it("detects package.json build script", () => {
		const projectDir = makeProjectDir();
		writeFileSync(join(projectDir, "package.json"), JSON.stringify({ scripts: { build: "webpack" } }));
		const commands = resolveValidationCommands({}, null, null, projectDir);
		expect(commands).toContain("npm run build");
	});

	it("detects partial package.json scripts", () => {
		const projectDir = makeProjectDir();
		writeFileSync(join(projectDir, "package.json"), JSON.stringify({ scripts: { test: "jest", lint: "eslint ." } }));
		const commands = resolveValidationCommands({}, null, null, projectDir);
		expect(commands).toContain("npm run test");
		expect(commands).toContain("npm run lint");
		expect(commands).not.toContain("npm run typecheck");
		expect(commands).not.toContain("npm run build");
	});

	it("detects Cargo.toml for Rust projects", () => {
		const projectDir = makeProjectDir();
		writeFileSync(join(projectDir, "Cargo.toml"), "[package]");
		const commands = resolveValidationCommands({}, null, null, projectDir);
		expect(commands).toContain("cargo test");
	});

	it("detects go.mod for Go projects", () => {
		const projectDir = makeProjectDir();
		writeFileSync(join(projectDir, "go.mod"), "module example.com");
		const commands = resolveValidationCommands({}, null, null, projectDir);
		expect(commands).toContain("go test ./...");
	});

	it("detects setup.py for Python projects", () => {
		const projectDir = makeProjectDir();
		writeFileSync(join(projectDir, "setup.py"), "from setuptools import setup");
		const commands = resolveValidationCommands({}, null, null, projectDir);
		expect(commands).toContain("pytest");
	});

	it("detects pyproject.toml for Python projects", () => {
		const projectDir = makeProjectDir();
		writeFileSync(join(projectDir, "pyproject.toml"), "[tool.pytest]");
		const commands = resolveValidationCommands({}, null, null, projectDir);
		expect(commands).toContain("pytest");
	});

	it("detects Makefile targets", () => {
		const projectDir = makeProjectDir();
		writeFileSync(
			join(projectDir, "Makefile"),
			"test:\n\tgo test ./...\n\nlint:\n\tgolangci-lint run\n\nbuild:\n\tgo build ./...\n",
		);
		const commands = resolveValidationCommands({}, null, null, projectDir);
		expect(commands).toContain("make test");
		expect(commands).toContain("make lint");
		expect(commands).toContain("make build");
	});

	it("detects bun.lock for bun projects (no package.json)", () => {
		const projectDir = makeProjectDir();
		writeFileSync(join(projectDir, "bun.lock"), "");
		const commands = resolveValidationCommands({}, null, null, projectDir);
		expect(commands).toContain("bun test");
	});

	it("returns empty array when no ecosystem markers found", () => {
		const projectDir = makeProjectDir();
		const commands = resolveValidationCommands({}, null, null, projectDir);
		expect(commands).toEqual([]);
	});
});

describe("resolveModel", () => {
	it("returns config model when present (highest priority)", () => {
		const config: MissionConfig = { models: { worker: "claude-sonnet-4" } };
		const plan = makePlan({ modelAssignment: { worker: "claude-haiku" } });
		expect(resolveModel("worker", config, plan)).toBe("claude-sonnet-4");
	});

	it("returns plan modelAssignment when config has no model", () => {
		const config: MissionConfig = {};
		const plan = makePlan({ modelAssignment: { worker: "claude-haiku" } });
		expect(resolveModel("worker", config, plan)).toBe("claude-haiku");
	});

	it("returns default worker model when neither config nor plan has a worker model", () => {
		const config: MissionConfig = {};
		const plan = makePlan({ modelAssignment: {} });
		expect(resolveModel("worker", config, plan)).toBe(DEFAULT_WORKER_MODEL);
	});

	it("returns default worker model when plan is null", () => {
		const config: MissionConfig = {};
		expect(resolveModel("worker", config, null)).toBe(DEFAULT_WORKER_MODEL);
	});

	it("returns undefined for non-worker roles when neither config nor plan has a model", () => {
		const config: MissionConfig = {};
		expect(resolveModel("orchestrator", config, null)).toBeUndefined();
		expect(resolveModel("validator", config, null)).toBeUndefined();
	});

	it("resolves orchestrator role correctly", () => {
		const config: MissionConfig = { models: { orchestrator: "o3" } };
		expect(resolveModel("orchestrator", config, null)).toBe("o3");
	});

	it("resolves validator role correctly", () => {
		const config: MissionConfig = {};
		const plan = makePlan({ modelAssignment: { validator: "gemini-pro" } });
		expect(resolveModel("validator", config, plan)).toBe("gemini-pro");
	});

	it("config takes precedence over plan for all roles", () => {
		const config: MissionConfig = {
			models: { orchestrator: "config-orch", worker: "config-worker", validator: "config-val" },
		};
		const plan = makePlan({
			modelAssignment: { orchestrator: "plan-orch", worker: "plan-worker", validator: "plan-val" },
		});
		expect(resolveModel("orchestrator", config, plan)).toBe("config-orch");
		expect(resolveModel("worker", config, plan)).toBe("config-worker");
		expect(resolveModel("validator", config, plan)).toBe("config-val");
	});
});
