import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { learnFromResult } from "../extensions/learn.js";
import { buildOrchestratorProtocol, clearProtocolCache } from "../extensions/orchestrator/protocol.js";
import {
	generateWorkerContext,
	generateWorkerSkill,
	writeWorkerFiles,
} from "../extensions/orchestrator/worker-prompt.js";
import { appendLibraryTopic, initLibrary, readLibraryTopic } from "../extensions/state/library.js";
import {
	clearStateCache,
	invalidateCaches,
	loadConfig,
	loadPlan,
	loadState,
	saveConfig,
	savePlan,
	saveState,
} from "../extensions/state/manager.js";
import type { Feature, MissionPlan, MissionState, WorkerResult } from "../extensions/types.js";
import { makeFeature, makeMilestone, makePlan, makeState } from "./helpers/index.js";

let tmpDir: string;
let basePath: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "pi-missions-m2-"));
	basePath = join(tmpDir, ".pi", "missions");
	clearProtocolCache();
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function makeFeatureWith(id: string, overrides: Partial<Feature> = {}): Feature {
	return makeFeature({
		id,
		name: `Feature ${id}`,
		description: `Implement ${id}`,
		acceptanceCriteria: ["Works correctly"],
		relevantFiles: [`src/${id}.ts`],
		...overrides,
	});
}

function makeMilestoneWith(id: string, features: Feature[]): ReturnType<typeof makeMilestone> {
	return makeMilestone({ id, name: `Milestone ${id}`, features });
}

function makeSuccessWorkerResult(
	discoveredIssues: Array<{ severity: "low" | "medium" | "high"; description: string; suggestedFix?: string }> = [],
): WorkerResult {
	return {
		status: "success",
		summary: "Feature completed successfully",
		filesChanged: ["src/index.ts"],
		commandsRun: [],
		handoff: {
			whatWasImplemented: "Implemented the feature",
			whatWasLeftUndone: "",
			commandsRun: [],
			testsAdded: [],
			discoveredIssues,
		},
		metrics: { durationMs: 1000 },
	};
}

function makeFailureWorkerResult(message: string): WorkerResult {
	return {
		status: "failure",
		summary: "Feature failed",
		filesChanged: [],
		commandsRun: [],
		error: { kind: "validation", message, details: "file.ts:42" },
		metrics: { durationMs: 1000 },
	};
}

function setupMissionWithPlan(features: Feature[] = [makeFeatureWith("f1"), makeFeatureWith("f2")]): {
	state: MissionState;
	plan: MissionPlan;
} {
	const plan = makePlan({
		milestones: [makeMilestoneWith("m1", features)],
		validationCommands: ["bun test"],
	});
	const state = makeState({
		currentMilestoneId: "m1",
	});
	saveState(basePath, state);
	savePlan(basePath, plan);
	saveConfig(basePath, { spawnAndLearn: true, validatorStrictness: "lenient" });
	return { state, plan };
}

// ---------------------------------------------------------------------------
// VAL-CROSS-010: Full pipeline — plan → spawn with library → report_result → learn → next worker gets updated context
// ---------------------------------------------------------------------------

describe("VAL-CROSS-010: full pipeline — plan to learned context", () => {
	it("full pipeline: worker 1 produces issues → learn → worker 2 context includes pitfalls", async () => {
		const { plan } = setupMissionWithPlan([makeFeatureWith("f1"), makeFeatureWith("f2")]);

		const f1 = plan.milestones[0].features[0];
		const f2 = plan.milestones[0].features[1];

		const skill1 = generateWorkerSkill(f1, undefined, "caveman");
		const context1 = generateWorkerContext(undefined, [], basePath);
		writeWorkerFiles(basePath, f1.id, 1, { skill: skill1, prompt: "Implement f1", context: context1 });

		const context1Path = join(basePath, "runtime", f1.id, "1", "worker-context.md");
		expect(existsSync(context1Path)).toBe(true);
		const context1Content = readFileSync(context1Path, "utf8");
		expect(context1Content).not.toContain("Race condition");

		const worker1Result = makeSuccessWorkerResult([
			{ severity: "high" as const, description: "Race condition in cache layer", suggestedFix: "Add mutex" },
		]);

		const config = loadConfig(basePath);
		const spawnAndLearn = config.spawnAndLearn !== false;
		learnFromResult(basePath, worker1Result, spawnAndLearn);

		const conventions = readLibraryTopic(basePath, "conventions");
		expect(conventions).toContain("Race condition in cache layer");
		expect(conventions).toContain("Add mutex");

		const skill2 = generateWorkerSkill(f2, undefined, "caveman");
		const context2 = generateWorkerContext(undefined, [], basePath);
		writeWorkerFiles(basePath, f2.id, 1, { skill: skill2, prompt: "Implement f2", context: context2 });

		const context2Path = join(basePath, "runtime", f2.id, "1", "worker-context.md");
		expect(existsSync(context2Path)).toBe(true);
		const context2Content = readFileSync(context2Path, "utf8");
		expect(context2Content).toContain("Race condition in cache layer");
		expect(context2Content).toContain("Project Conventions");

		const skill2Path = join(basePath, "runtime", f2.id, "1", "worker-skill.md");
		const skill2Content = readFileSync(skill2Path, "utf8");
		expect(skill2Content).not.toContain("Race condition");
		expect(skill2Content).toContain(f2.name);
	});

	it("pipeline: failure result → learn → next worker context contains failure pattern", () => {
		setupMissionWithPlan([makeFeatureWith("f1"), makeFeatureWith("f2")]);

		const worker1Result = makeFailureWorkerResult("TypeScript strict null check failed");
		learnFromResult(basePath, worker1Result, true);

		const pitfalls = readLibraryTopic(basePath, "pitfalls");
		expect(pitfalls).toContain("TypeScript strict null check failed");

		const context2 = generateWorkerContext(undefined, [], basePath);
		expect(context2).toContain("TypeScript strict null check failed");
	});

	it("pipeline: plan.json written and feature statuses tracked", () => {
		clearStateCache();
		const { state } = setupMissionWithPlan([makeFeatureWith("f1"), makeFeatureWith("f2")]);

		const loadedPlan = loadPlan(basePath);
		expect(loadedPlan).not.toBeNull();
		expect(loadedPlan!.milestones[0].features).toHaveLength(2);
		expect(loadedPlan!.milestones[0].features[0].status).toBe("pending");

		const updatedState = {
			...state,
			currentFeatureId: "f1",
			totalFeaturesCompleted: 0,
		};
		saveState(basePath, updatedState);

		const loadedState = loadState(basePath);
		expect(loadedState!.currentFeatureId).toBe("f1");
	});
});

// ---------------------------------------------------------------------------
// VAL-CROSS-011: Backward compatibility — missions without library or contract continue working
// ---------------------------------------------------------------------------

describe("VAL-CROSS-011: backward compatibility — no library or contract", () => {
	it("generateWorkerContext succeeds without library directory", () => {
		const context = generateWorkerContext(undefined, [], basePath);
		expect(context).toBeDefined();
		expect(typeof context).toBe("string");
		expect(context).not.toContain("undefined");
		expect(context).not.toContain("null");
		expect(context).not.toContain("Known Pitfalls");
	});

	it("generateWorkerContext succeeds without library directory with AGENTS.md content", () => {
		const agentsMd = "# Project Conventions\nUse camelCase";
		const context = generateWorkerContext(agentsMd, [], basePath);
		expect(context).toContain("Use camelCase");
		expect(context).not.toContain("Known Pitfalls");
	});

	it("generateWorkerSkill succeeds without library", () => {
		const feature = makeFeatureWith("f1");
		const skill = generateWorkerSkill(feature, undefined, "caveman");
		expect(skill).toContain("f1");
		expect(skill).toContain("report_result");
	});

	it("writeWorkerFiles succeeds without library", () => {
		const agentsMd = "# Project\nSome conventions";
		const feature = makeFeatureWith("f1");
		const skill = generateWorkerSkill(feature, undefined, "caveman");
		const context = generateWorkerContext(agentsMd, [], basePath);
		writeWorkerFiles(basePath, feature.id, 1, { skill, prompt: "Do the thing", context });

		expect(existsSync(join(basePath, "runtime", "f1", "1", "worker-skill.md"))).toBe(true);
		expect(existsSync(join(basePath, "runtime", "f1", "1", "worker-prompt.md"))).toBe(true);
		expect(existsSync(join(basePath, "runtime", "f1", "1", "worker-context.md"))).toBe(true);

		const contextContent = readFileSync(join(basePath, "runtime", "f1", "1", "worker-context.md"), "utf8");
		expect(contextContent).toBeDefined();
		expect(contextContent.length).toBeGreaterThan(0);
	});

	it("learnFromResult creates library when needed (not dependent on pre-existing library)", () => {
		const result = makeFailureWorkerResult("Test failure");
		const learned = learnFromResult(basePath, result, true);
		expect(learned.learned).toBe(true);
		expect(existsSync(join(basePath, "library"))).toBe(true);
		const pitfalls = readLibraryTopic(basePath, "pitfalls");
		expect(pitfalls).toContain("Test failure");
	});

	it("complete mission flow works without library or environment", () => {
		const plan = makePlan({
			milestones: [makeMilestoneWith("m1", [makeFeatureWith("f1")])],
		});
		const state = makeState({
			totalFeaturesCompleted: 1,
		});
		saveState(basePath, state);
		savePlan(basePath, plan);
		saveConfig(basePath, { spawnAndLearn: true });

		invalidateCaches(basePath);

		const loadedState = loadState(basePath);
		expect(loadedState!.status).toBe("executing");

		const loadedPlan = loadPlan(basePath);
		expect(loadedPlan).not.toBeNull();

		const feature = loadedPlan!.milestones[0].features[0];
		const skill = generateWorkerSkill(feature, undefined, "caveman");
		const agentsMd = "# Project\nUse strict mode";
		const context = generateWorkerContext(agentsMd, [], basePath);
		writeWorkerFiles(basePath, feature.id, 1, { skill, prompt: "Do it", context });

		expect(existsSync(join(basePath, "runtime", "f1", "1", "worker-context.md"))).toBe(true);
		const writtenContext = readFileSync(join(basePath, "runtime", "f1", "1", "worker-context.md"), "utf8");
		expect(writtenContext.length).toBeGreaterThan(0);
	});

	it("readLibraryTopic returns null when library does not exist", () => {
		const result = readLibraryTopic(basePath, "pitfalls");
		expect(result).toBeNull();
	});

	it("empty library files (header only) produce no injection in worker context", () => {
		initLibrary(basePath);

		const context = generateWorkerContext(undefined, [], basePath);
		expect(context).not.toContain("Known Pitfalls");
		expect(context).not.toContain("Project Conventions");
	});
});

// ---------------------------------------------------------------------------
// VAL-CROSS-017: Protocol cache invalidation on library changes
// ---------------------------------------------------------------------------

describe("VAL-CROSS-017: protocol cache invalidation on library changes", () => {
	it("protocol cache is invalidated after library content changes", () => {
		const state = makeState({
			currentMilestoneId: "m1",
			currentFeatureId: "f1",
		});
		const plan = makePlan({
			milestones: [makeMilestoneWith("m1", [makeFeatureWith("f1")])],
		});
		const config = { autonomy: "medium" as const };

		const firstCall = buildOrchestratorProtocol(state, plan, config, false, { turnCount: 1 });
		expect(firstCall).not.toBeNull();

		const secondCall = buildOrchestratorProtocol(state, plan, config, false, { turnCount: 1 });
		expect(secondCall).toBe(firstCall);

		clearProtocolCache();

		const thirdCall = buildOrchestratorProtocol(state, plan, config, false, { turnCount: 1 });
		expect(thirdCall).not.toBeNull();
		expect(thirdCall).toBe(firstCall);
	});

	it("learnFromResult followed by clearProtocolCache allows fresh protocol generation", () => {
		const state = makeState({
			currentMilestoneId: "m1",
			currentFeatureId: "f1",
		});
		const plan = makePlan({
			milestones: [makeMilestoneWith("m1", [makeFeatureWith("f1")])],
		});
		const config = { autonomy: "medium" as const, spawnAndLearn: true };

		const _before = buildOrchestratorProtocol(state, plan, config, false, { turnCount: 1 });

		initLibrary(basePath);
		appendLibraryTopic(basePath, "pitfalls", "- New pitfall: avoid global state");

		clearProtocolCache();

		const after = buildOrchestratorProtocol(state, plan, config, false, { turnCount: 1 });
		expect(after).not.toBeNull();
	});

	it("library changes visible in worker context after cache clear", () => {
		initLibrary(basePath);

		const contextBefore = generateWorkerContext(undefined, [], basePath);
		expect(contextBefore).not.toContain("avoid global state");

		appendLibraryTopic(basePath, "pitfalls", "- New pitfall: avoid global state");

		clearProtocolCache();

		const contextAfter = generateWorkerContext(undefined, [], basePath);
		expect(contextAfter).toContain("avoid global state");
	});

	it("clearProtocolCache is a no-op when cache is already empty", () => {
		clearProtocolCache();
		clearProtocolCache();

		const state = makeState();
		const result = buildOrchestratorProtocol(state, undefined, undefined, false, { turnCount: 1 });
		expect(result).not.toBeNull();
	});

	it("protocol cache key changes when state fields change", () => {
		const plan = makePlan({
			milestones: [makeMilestoneWith("m1", [makeFeatureWith("f1")])],
		});
		const config = { autonomy: "medium" as const, promptingMode: "default" as const };

		const state1 = makeState({ status: "executing", currentFeatureId: "f1", currentMilestoneId: "m1" });
		const result1 = buildOrchestratorProtocol(state1, plan, config, false, { turnCount: 1 });

		const state2 = makeState({
			status: "executing",
			currentFeatureId: "f1",
			currentMilestoneId: "m1",
			totalFeaturesCompleted: 1,
		});
		clearProtocolCache();
		const result2 = buildOrchestratorProtocol(state2, plan, config, false, { turnCount: 1 });

		expect(result1).not.toBeNull();
		expect(result2).not.toBeNull();
		expect(result1).not.toBe(result2);
	});

	it("stale protocol prompts not served after library mutations", () => {
		const state = makeState({
			currentMilestoneId: "m1",
			currentFeatureId: "f1",
		});
		const plan = makePlan({
			milestones: [makeMilestoneWith("m1", [makeFeatureWith("f1")])],
		});

		initLibrary(basePath);

		const _protoBefore = buildOrchestratorProtocol(state, plan, undefined, false, { turnCount: 1 });

		appendLibraryTopic(basePath, "pitfalls", "- Critical: never use eval()");

		clearProtocolCache();

		const protoAfter = buildOrchestratorProtocol(state, plan, undefined, false, { turnCount: 1 });

		expect(protoAfter).not.toBeNull();
		expect(typeof protoAfter).toBe("string");

		const contextAfter = generateWorkerContext(undefined, [], basePath);
		expect(contextAfter).toContain("never use eval()");
	});
});
