import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { saveState } from "../../extensions/state/manager.js";
import type { Feature, MissionPlan, MissionState } from "../../extensions/types.js";
import { nowISO } from "../../extensions/utils.js";
import { registerCommitChangesTool } from "../../extensions/tools/commit-changes.js";

type ToolResult = { content: Array<{ type: string; text: string }>; details: unknown };
type ExecutableTool = { execute: (...args: unknown[]) => Promise<ToolResult> };

function makeMockPi(): { pi: ExtensionAPI; getLastRegisteredTool: () => ExecutableTool | null } {
	let registeredTool: ExecutableTool | null = null;
	const pi = {
		registerTool: (tool: ExecutableTool) => {
			registeredTool = tool;
		},
	} as unknown as ExtensionAPI;
	return {
		pi,
		getLastRegisteredTool: () => registeredTool,
	};
}

function makeState(overrides: Partial<MissionState> = {}): MissionState {
	return {
		missionId: "test-mission",
		status: "executing",
		progressLog: [],
		startedAt: nowISO(),
		totalFeaturesCompleted: 0,
		totalFeaturesFailed: 0,
		totalFeaturesSkipped: 0,
		totalFixFeaturesCreated: 0,
		gitSnapshot: {
			headCommit: "abc123",
			dirtyFiles: [],
			autoCommitEnabled: true,
		},
		...overrides,
	};
}

function makeFeature(overrides: Partial<Feature> = {}): Feature {
	return {
		id: "feature-1",
		name: "user-model",
		description: "Create user entity",
		acceptanceCriteria: ["User entity created"],
		relevantFiles: ["src/models/user.ts"],
		dependencies: [],
		estimatedComplexity: "low",
		status: "done",
		attempts: [],
		...overrides,
	};
}

function makePlan(features: Feature[] = [makeFeature()]): MissionPlan {
	return {
		id: "plan-1",
		description: "Test mission",
		planVersion: 1,
		milestones: [
			{
				id: "milestone-1",
				name: "Foundation",
				description: "Core",
				features,
				status: "active",
			},
		],
		validationCommands: ["bun test"],
		modelAssignment: {},
		createdAt: nowISO(),
	};
}

interface CallToolOptions {
	isGitAvailable?: (cwd: string) => boolean;
	getChangedFiles?: (cwd: string, baseCommit?: string) => string[];
	stageAndCommit?: (cwd: string, files: string[], message: string) => string;
	updateWidget?: (state: MissionState, plan?: MissionPlan) => void;
	state?: MissionState;
	plan?: MissionPlan;
}

async function callTool(
	basePath: string,
	params: { featureId: string; message?: string },
	options: CallToolOptions = {},
): Promise<ToolResult> {
	const {
		isGitAvailable = () => true,
		getChangedFiles = () => ["src/models/user.ts"],
		stageAndCommit = () => "deadbeef1234567890123456789012345678901234",
		updateWidget = () => {},
		state = makeState(),
		plan = makePlan(),
	} = options;

	saveState(basePath, state);

	const { writeFileSync } = await import("node:fs");
	const { join: pathJoin } = await import("node:path");
	writeFileSync(pathJoin(basePath, "plan.json"), JSON.stringify(plan, null, 2), "utf8");

	const { pi, getLastRegisteredTool } = makeMockPi();
	registerCommitChangesTool(pi, {
		basePath,
		projectDir: basePath,
		updateWidget,
		_isGitAvailableOverride: isGitAvailable,
		_getChangedFilesOverride: getChangedFiles,
		_stageAndCommitOverride: stageAndCommit,
	});
	const tool = getLastRegisteredTool()!;
	return tool.execute("tool-call-id", params, undefined, undefined, undefined) as Promise<ToolResult>;
}

describe("registerCommitChangesTool", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "commit-changes-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("VAL-GIT-007: git precondition checks run first", () => {
		it("returns skip when git is unavailable (checked before anything else)", async () => {
			const result = await callTool(tmpDir, { featureId: "feature-1" }, { isGitAvailable: () => false });
			expect(result.content[0].text.toLowerCase()).toContain("skip");
			expect(result.content[0].text.toLowerCase()).toContain("git");
		});

		it("returns skip when auto-commit is disabled via snapshot (dirty repo)", async () => {
			const state = makeState({
				gitSnapshot: { headCommit: "abc", dirtyFiles: ["dirty.ts"], autoCommitEnabled: false },
			});
			const result = await callTool(tmpDir, { featureId: "feature-1" }, { state });
			expect(result.content[0].text.toLowerCase()).toContain("skip");
		});

		it("returns skip when autoCommit explicitly false in config", async () => {
			const { writeFileSync } = await import("node:fs");
			const { join: pathJoin } = await import("node:path");
			const config = { git: { autoCommit: false } };
			writeFileSync(pathJoin(tmpDir, "config.json"), JSON.stringify(config), "utf8");

			const result = await callTool(tmpDir, { featureId: "feature-1" });
			expect(result.content[0].text.toLowerCase()).toContain("skip");
		});
	});

	describe("VAL-TOOL-011: commit_changes stages only feature-changed files and commits", () => {
		it("commits changed files and returns SHA on success", async () => {
			const sha = "deadbeef1234567890123456789012345678901234";
			const stageAndCommit = mock(() => sha);
			const result = await callTool(tmpDir, { featureId: "feature-1" }, { stageAndCommit });
			expect(result.content[0].text).toContain(sha);
			expect(stageAndCommit).toHaveBeenCalledTimes(1);
		});

		it("uses default message 'mission: <feature-name>' for normal features", async () => {
			const stageAndCommit = mock(() => "abc123");
			await callTool(tmpDir, { featureId: "feature-1" }, { stageAndCommit });
			const [, , message] = stageAndCommit.mock.calls[0] as unknown as [string, string[], string];
			expect(message).toBe("mission: user-model");
		});

		it("uses 'mission: fix <name>' for fix features", async () => {
			const fixFeature = makeFeature({
				fixOrigin: { sourceKind: "worker-failure", sourceFeatureId: "other-feature" },
			});
			const plan = makePlan([fixFeature]);
			const stageAndCommit = mock(() => "abc123");
			await callTool(tmpDir, { featureId: "feature-1" }, { plan, stageAndCommit });
			const [, , message] = stageAndCommit.mock.calls[0] as unknown as [string, string[], string];
			expect(message).toBe("mission: fix user-model");
		});

		it("uses custom message when provided", async () => {
			const stageAndCommit = mock(() => "abc123");
			await callTool(tmpDir, { featureId: "feature-1", message: "feat: custom commit message" }, { stageAndCommit });
			const [, , message] = stageAndCommit.mock.calls[0] as unknown as [string, string[], string];
			expect(message).toBe("feat: custom commit message");
		});

		it("stages only the feature-changed files (never all files)", async () => {
			const changedFiles = ["src/models/user.ts", "src/routes/auth.ts"];
			const stageAndCommit = mock(() => "abc123");
			await callTool(
				tmpDir,
				{ featureId: "feature-1" },
				{
					getChangedFiles: () => changedFiles,
					stageAndCommit,
				},
			);
			const [, stagedFiles] = stageAndCommit.mock.calls[0] as unknown as [string, string[], string];
			expect(stagedFiles).toEqual(changedFiles);
		});

		it("appends commit_created progress event to state", async () => {
			const { loadState } = await import("../../extensions/state/manager.js");
			await callTool(tmpDir, { featureId: "feature-1" });
			const state = loadState(tmpDir)!;
			const commitEvents = state.progressLog.filter((e) => e.type === "commit_created");
			expect(commitEvents).toHaveLength(1);
			expect(commitEvents[0]!.detail).toContain("user-model");
		});

		it("commit_created event includes sha, featureId, filesChanged in metadata", async () => {
			const sha = "feedbabe1234567890123456789012345678901234";
			const { loadState } = await import("../../extensions/state/manager.js");
			await callTool(tmpDir, { featureId: "feature-1" }, { stageAndCommit: () => sha });
			const state = loadState(tmpDir)!;
			const event = state.progressLog.find((e) => e.type === "commit_created")!;
			expect(event.metadata?.sha).toBe(sha);
			expect(event.metadata?.featureId).toBe("feature-1");
			expect(Array.isArray(event.metadata?.filesChanged)).toBe(true);
		});
	});

	describe("VAL-TOOL-011: warns about out-of-scope changes without blocking", () => {
		it("warns when changed files are outside relevantFiles but still commits", async () => {
			const changedFiles = ["src/models/user.ts", "src/unrelated/other.ts"];
			const result = await callTool(tmpDir, { featureId: "feature-1" }, { getChangedFiles: () => changedFiles });
			expect(result.content[0].text.toLowerCase()).toContain("warning");
			expect(result.content[0].text).toContain("src/unrelated/other.ts");
			expect(result.content[0].text).toContain("SHA");
		});

		it("does not warn when all changes are in relevantFiles", async () => {
			const changedFiles = ["src/models/user.ts"];
			const result = await callTool(tmpDir, { featureId: "feature-1" }, { getChangedFiles: () => changedFiles });
			expect(result.content[0].text.toLowerCase()).not.toContain("warning");
		});
	});

	describe("VAL-TOOL-012: skips gracefully when conditions aren't met", () => {
		it("returns skip when git is unavailable", async () => {
			const result = await callTool(tmpDir, { featureId: "feature-1" }, { isGitAvailable: () => false });
			expect(result.content[0].text.toLowerCase()).toContain("skip");
		});

		it("returns skip when featureId is unknown", async () => {
			const result = await callTool(tmpDir, { featureId: "nonexistent-feature" });
			expect(result.content[0].text.toLowerCase()).toContain("skip");
			expect(result.content[0].text).toContain("nonexistent-feature");
		});

		it("returns skip when no files changed", async () => {
			const result = await callTool(tmpDir, { featureId: "feature-1" }, { getChangedFiles: () => [] });
			expect(result.content[0].text.toLowerCase()).toContain("skip");
		});

		it("returns skip when autoCommit is explicitly false in config", async () => {
			const { writeFileSync } = await import("node:fs");
			const { join: pathJoin } = await import("node:path");
			const config = { git: { autoCommit: false } };
			writeFileSync(pathJoin(tmpDir, "config.json"), JSON.stringify(config), "utf8");

			const result = await callTool(tmpDir, { featureId: "feature-1" });
			expect(result.content[0].text.toLowerCase()).toContain("skip");
		});

		it("returns skip when repo was dirty and autoCommit not enabled via snapshot", async () => {
			const state = makeState({
				gitSnapshot: { headCommit: "abc", dirtyFiles: ["file.ts"], autoCommitEnabled: false },
			});
			const result = await callTool(tmpDir, { featureId: "feature-1" }, { state });
			expect(result.content[0].text.toLowerCase()).toContain("skip");
		});

		it("does not return an Error: prefix in skip messages", async () => {
			const result = await callTool(tmpDir, { featureId: "feature-1" }, { getChangedFiles: () => [] });
			expect(result.content[0].text).not.toContain("Error:");
		});
	});

	describe("VAL-GIT-004: selective staging, never git add -A", () => {
		it("calls stageAndCommit with exactly the changed files (not all files)", async () => {
			const changedFiles = ["src/models/user.ts"];
			const stageAndCommit = mock(() => "abc123");
			await callTool(
				tmpDir,
				{ featureId: "feature-1" },
				{
					getChangedFiles: () => changedFiles,
					stageAndCommit,
				},
			);
			const [, stagedFiles] = stageAndCommit.mock.calls[0] as unknown as [string, string[], string];
			expect(stagedFiles).toEqual(["src/models/user.ts"]);
		});
	});

	describe("VAL-GIT-005: dirty repo policy with config override", () => {
		it("skips when snapshot says dirty repo (autoCommitEnabled: false)", async () => {
			const state = makeState({
				gitSnapshot: { headCommit: "abc", dirtyFiles: ["file.ts"], autoCommitEnabled: false },
			});
			const result = await callTool(tmpDir, { featureId: "feature-1" }, { state });
			expect(result.content[0].text.toLowerCase()).toContain("skip");
		});

		it("commits when config.git.autoCommit=true overrides dirty repo snapshot", async () => {
			const { writeFileSync } = await import("node:fs");
			const { join: pathJoin } = await import("node:path");
			const config = { git: { autoCommit: true } };
			writeFileSync(pathJoin(tmpDir, "config.json"), JSON.stringify(config), "utf8");

			const state = makeState({
				gitSnapshot: { headCommit: "abc", dirtyFiles: ["file.ts"], autoCommitEnabled: false },
			});
			const sha = "feedbabe1234567890123456789012345678901234";
			const result = await callTool(tmpDir, { featureId: "feature-1" }, { state, stageAndCommit: () => sha });
			expect(result.content[0].text).toContain(sha);
		});
	});

	describe("updateWidget is called on success", () => {
		it("calls updateWidget after committing", async () => {
			const updateWidget = mock(() => {});
			await callTool(tmpDir, { featureId: "feature-1" }, { updateWidget });
			expect(updateWidget).toHaveBeenCalledTimes(1);
		});

		it("does not call updateWidget when skipping", async () => {
			const updateWidget = mock(() => {});
			await callTool(tmpDir, { featureId: "feature-1" }, { getChangedFiles: () => [], updateWidget });
			expect(updateWidget).not.toHaveBeenCalled();
		});
	});

	describe("passes baseCommit from snapshot to getChangedFiles", () => {
		it("calls getChangedFiles with the snapshot headCommit", async () => {
			const state = makeState({
				gitSnapshot: { headCommit: "snapshotsha123", dirtyFiles: [], autoCommitEnabled: true },
			});
			const getChangedFiles = mock(() => ["src/models/user.ts"]);
			await callTool(tmpDir, { featureId: "feature-1" }, { state, getChangedFiles });
			const [, baseCommit] = getChangedFiles.mock.calls[0] as unknown as [string, string | undefined];
			expect(baseCommit).toBe("snapshotsha123");
		});

		it("uses undefined baseCommit when no snapshot exists", async () => {
			const state = makeState({ gitSnapshot: undefined });
			const getChangedFiles = mock(() => ["src/models/user.ts"]);
			await callTool(tmpDir, { featureId: "feature-1" }, { state, getChangedFiles });
			const [, baseCommit] = getChangedFiles.mock.calls[0] as unknown as [string, string | undefined];
			expect(baseCommit).toBeUndefined();
		});
	});
});
