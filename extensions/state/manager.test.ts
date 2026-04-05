import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MissionConfig, MissionPlan, MissionState } from "../types.js";
import { loadConfig, loadPlan, loadState, saveConfig, savePlan, saveState } from "./manager.js";

const TMP_DIR = join(import.meta.dir, "../../.test-tmp-manager");

function makeTmpDir(): string {
	const dir = join(TMP_DIR, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

const minimalState: MissionState = {
	missionId: "test-mission-1",
	status: "planning",
	progressLog: [],
	startedAt: "2024-01-01T00:00:00.000Z",
	totalFeaturesCompleted: 0,
	totalFeaturesFailed: 0,
	totalFeaturesSkipped: 0,
	totalFixFeaturesCreated: 0,
};

const minimalPlan: MissionPlan = {
	id: "plan-1",
	description: "Test plan",
	planVersion: 1,
	milestones: [],
	validationCommands: [],
	modelAssignment: {},
	createdAt: "2024-01-01T00:00:00.000Z",
};

beforeEach(() => {
	mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
	rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("saveState / loadState", () => {
	it("saves and loads state correctly", () => {
		const dir = makeTmpDir();
		saveState(dir, minimalState);
		const loaded = loadState(dir);
		expect(loaded).toEqual(minimalState);
	});

	it("writes pretty-printed JSON", () => {
		const dir = makeTmpDir();
		saveState(dir, minimalState);
		const raw = readFileSync(join(dir, "state.json"), "utf8");
		expect(raw).toContain("\n");
		expect(JSON.parse(raw)).toEqual(minimalState);
	});

	it("creates directories on demand", () => {
		const dir = join(TMP_DIR, "deeply", "nested", "dir");
		saveState(dir, minimalState);
		expect(existsSync(join(dir, "state.json"))).toBe(true);
	});

	it("uses temp-file-then-rename for atomicity", () => {
		const dir = makeTmpDir();
		saveState(dir, minimalState);
		expect(existsSync(join(dir, "state.json.tmp"))).toBe(false);
		expect(existsSync(join(dir, "state.json"))).toBe(true);
	});

	it("returns null when file does not exist", () => {
		const dir = makeTmpDir();
		expect(loadState(dir)).toBeNull();
	});

	it("throws on corrupted JSON", () => {
		const dir = makeTmpDir();
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "state.json"), "not json at all");
		expect(() => loadState(dir)).toThrow(/invalid JSON/);
	});

	it("throws on valid JSON failing TypeBox schema (wrong status value)", () => {
		const dir = makeTmpDir();
		const invalid = { ...minimalState, status: "not-a-valid-status" };
		writeFileSync(join(dir, "state.json"), JSON.stringify(invalid));
		expect(() => loadState(dir)).toThrow(/schema validation/);
	});

	it("throws on valid JSON failing TypeBox schema (missing required fields)", () => {
		const dir = makeTmpDir();
		const invalid = { missionId: "x", status: "planning" };
		writeFileSync(join(dir, "state.json"), JSON.stringify(invalid));
		expect(() => loadState(dir)).toThrow(/schema validation/);
	});

	it("throws on valid JSON failing TypeBox schema (wrong field type)", () => {
		const dir = makeTmpDir();
		const invalid = { ...minimalState, totalFeaturesCompleted: "not-a-number" };
		writeFileSync(join(dir, "state.json"), JSON.stringify(invalid));
		expect(() => loadState(dir)).toThrow(/schema validation/);
	});

	it("preserves all optional fields when present", () => {
		const dir = makeTmpDir();
		const stateWithOptionals: MissionState = {
			...minimalState,
			resumeTargetState: "executing",
			currentMilestoneId: "m1",
			currentFeatureId: "f1",
			completedAt: "2024-01-02T00:00:00.000Z",
			progressLog: [
				{
					timestamp: "2024-01-01T00:00:00.000Z",
					type: "mission_started",
					detail: "Mission started",
					metadata: { key: "value" },
				},
			],
			gitSnapshot: {
				headCommit: "abc123",
				dirtyFiles: ["file.ts"],
				autoCommitEnabled: true,
			},
		};
		saveState(dir, stateWithOptionals);
		expect(loadState(dir)).toEqual(stateWithOptionals);
	});
});

describe("savePlan / loadPlan", () => {
	it("saves and loads plan correctly", () => {
		const dir = makeTmpDir();
		savePlan(dir, minimalPlan);
		expect(loadPlan(dir)).toEqual(minimalPlan);
	});

	it("writes pretty-printed JSON", () => {
		const dir = makeTmpDir();
		savePlan(dir, minimalPlan);
		const raw = readFileSync(join(dir, "plan.json"), "utf8");
		expect(raw).toContain("\n");
		expect(JSON.parse(raw)).toEqual(minimalPlan);
	});

	it("creates directories on demand", () => {
		const dir = join(TMP_DIR, "deep", "plan", "dir");
		savePlan(dir, minimalPlan);
		expect(existsSync(join(dir, "plan.json"))).toBe(true);
	});

	it("uses temp-file-then-rename for atomicity", () => {
		const dir = makeTmpDir();
		savePlan(dir, minimalPlan);
		expect(existsSync(join(dir, "plan.json.tmp"))).toBe(false);
		expect(existsSync(join(dir, "plan.json"))).toBe(true);
	});

	it("returns null when file does not exist", () => {
		const dir = makeTmpDir();
		expect(loadPlan(dir)).toBeNull();
	});

	it("throws on corrupted JSON", () => {
		const dir = makeTmpDir();
		writeFileSync(join(dir, "plan.json"), "{ broken");
		expect(() => loadPlan(dir)).toThrow(/invalid JSON/);
	});

	it("throws on valid JSON failing schema (missing required fields)", () => {
		const dir = makeTmpDir();
		const invalid = { id: "p1", description: "x" };
		writeFileSync(join(dir, "plan.json"), JSON.stringify(invalid));
		expect(() => loadPlan(dir)).toThrow(/schema validation/);
	});

	it("throws on valid JSON failing schema (wrong field type)", () => {
		const dir = makeTmpDir();
		const invalid = { ...minimalPlan, planVersion: "not-a-number" };
		writeFileSync(join(dir, "plan.json"), JSON.stringify(invalid));
		expect(() => loadPlan(dir)).toThrow(/schema validation/);
	});

	it("preserves a full plan with milestones and features", () => {
		const dir = makeTmpDir();
		const fullPlan: MissionPlan = {
			...minimalPlan,
			approvedAt: "2024-01-01T01:00:00.000Z",
			milestones: [
				{
					id: "m1",
					name: "Foundation",
					description: "Foundation milestone",
					status: "active",
					features: [
						{
							id: "f1",
							name: "User model",
							description: "Create user model",
							acceptanceCriteria: ["User table exists"],
							relevantFiles: ["src/models/user.ts"],
							dependencies: [],
							estimatedComplexity: "low",
							status: "done",
							attempts: [],
						},
					],
				},
			],
		};
		savePlan(dir, fullPlan);
		expect(loadPlan(dir)).toEqual(fullPlan);
	});
});

describe("saveConfig / loadConfig", () => {
	it("returns defaults when no config file exists", () => {
		const dir = makeTmpDir();
		const config = loadConfig(dir);
		expect(config.maxRetries).toBe(3);
		expect(config.validation?.timeoutMs).toBe(120000);
		expect(config.autonomy).toBe("medium");
		expect(config.git?.autoCommit).toBe(true);
	});

	it("saves and loads config correctly", () => {
		const dir = makeTmpDir();
		const cfg: MissionConfig = {
			maxRetries: 5,
			autonomy: "high",
			git: { autoCommit: false },
			validation: { timeoutMs: 60000 },
		};
		saveConfig(dir, cfg);
		const loaded = loadConfig(dir);
		expect(loaded.maxRetries).toBe(5);
		expect(loaded.autonomy).toBe("high");
		expect(loaded.git?.autoCommit).toBe(false);
		expect(loaded.validation?.timeoutMs).toBe(60000);
	});

	it("writes pretty-printed JSON", () => {
		const dir = makeTmpDir();
		const cfg: MissionConfig = { maxRetries: 2 };
		saveConfig(dir, cfg);
		const raw = readFileSync(join(dir, "config.json"), "utf8");
		expect(raw).toContain("\n");
		expect(JSON.parse(raw)).toEqual(cfg);
	});

	it("creates directories on demand", () => {
		const dir = join(TMP_DIR, "deep", "config", "dir");
		saveConfig(dir, {});
		expect(existsSync(join(dir, "config.json"))).toBe(true);
	});

	it("throws on corrupted JSON", () => {
		const dir = makeTmpDir();
		writeFileSync(join(dir, "config.json"), ":::not json:::");
		expect(() => loadConfig(dir)).toThrow(/invalid JSON/);
	});

	it("throws on valid JSON failing schema (wrong autonomy value)", () => {
		const dir = makeTmpDir();
		writeFileSync(join(dir, "config.json"), JSON.stringify({ autonomy: "ultra" }));
		expect(() => loadConfig(dir)).toThrow(/schema validation/);
	});

	it("merges file values with defaults (file values take priority)", () => {
		const dir = makeTmpDir();
		const partial: MissionConfig = { maxRetries: 7 };
		saveConfig(dir, partial);
		const loaded = loadConfig(dir);
		expect(loaded.maxRetries).toBe(7);
		expect(loaded.autonomy).toBe("medium");
		expect(loaded.validation?.timeoutMs).toBe(120000);
	});

	it("merges validation overrides with defaults", () => {
		const dir = makeTmpDir();
		const partial: MissionConfig = { validation: { timeoutMs: 30000 } };
		saveConfig(dir, partial);
		const loaded = loadConfig(dir);
		expect(loaded.validation?.timeoutMs).toBe(30000);
		expect(loaded.validation?.commands).toEqual([]);
	});

	it("merges git overrides with defaults", () => {
		const dir = makeTmpDir();
		const partial: MissionConfig = { git: { autoCommit: false } };
		saveConfig(dir, partial);
		const loaded = loadConfig(dir);
		expect(loaded.git?.autoCommit).toBe(false);
	});

	it("uses temp-file-then-rename for atomicity", () => {
		const dir = makeTmpDir();
		saveConfig(dir, {});
		expect(existsSync(join(dir, "config.json.tmp"))).toBe(false);
		expect(existsSync(join(dir, "config.json"))).toBe(true);
	});
});
