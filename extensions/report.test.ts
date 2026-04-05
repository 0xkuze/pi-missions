import { describe, expect, it } from "bun:test";
import { generateReport } from "./report.js";
import type { Feature, Milestone, MissionPlan, MissionState, WorkerAttempt } from "./types.js";

const now = new Date("2025-01-15T10:00:00.000Z");
const later = new Date("2025-01-15T11:24:00.000Z");

function makeAttempt(overrides: Partial<WorkerAttempt> = {}): WorkerAttempt {
	return {
		attemptNumber: 1,
		startedAt: now.toISOString(),
		completedAt: later.toISOString(),
		exitCode: 0,
		resultPath: ".pi/missions/runtime/feat1/1/result.json",
		stdoutPath: ".pi/missions/runtime/feat1/1/stdout.log",
		stderrPath: ".pi/missions/runtime/feat1/1/stderr.log",
		durationMs: 84000,
		model: "claude-sonnet-4",
		status: "success",
		...overrides,
	};
}

function makeFeature(overrides: Partial<Feature> = {}): Feature {
	return {
		id: "feat1",
		name: "user-model",
		description: "Create user model",
		acceptanceCriteria: ["User entity created"],
		relevantFiles: ["src/models/user.ts"],
		dependencies: [],
		estimatedComplexity: "low",
		status: "done",
		attempts: [makeAttempt()],
		startedAt: now.toISOString(),
		completedAt: later.toISOString(),
		...overrides,
	};
}

function makeMilestone(overrides: Partial<Milestone> = {}): Milestone {
	return {
		id: "ms1",
		name: "Foundation",
		description: "Core entities",
		features: [makeFeature()],
		status: "done",
		startedAt: now.toISOString(),
		completedAt: later.toISOString(),
		...overrides,
	};
}

function makePlan(overrides: Partial<MissionPlan> = {}): MissionPlan {
	return {
		id: "plan1",
		description: "Build a multi-tenant auth system",
		planVersion: 1,
		milestones: [makeMilestone()],
		validationCommands: ["bun test", "bun run typecheck"],
		modelAssignment: { worker: "claude-sonnet-4" },
		createdAt: now.toISOString(),
		approvedAt: now.toISOString(),
		...overrides,
	};
}

function makeState(overrides: Partial<MissionState> = {}): MissionState {
	return {
		missionId: "mission1",
		status: "completed",
		progressLog: [],
		startedAt: now.toISOString(),
		completedAt: later.toISOString(),
		totalFeaturesCompleted: 1,
		totalFeaturesFailed: 0,
		totalFeaturesSkipped: 0,
		totalFixFeaturesCreated: 0,
		...overrides,
	};
}

describe("generateReport", () => {
	describe("VAL-RPT-001: mission context and timeline", () => {
		it("includes mission goal/description", () => {
			const report = generateReport(makeState(), makePlan());
			expect(report).toContain("Build a multi-tenant auth system");
		});

		it("includes start timestamp", () => {
			const report = generateReport(makeState(), makePlan());
			expect(report).toContain("2025-01-15T10:00:00.000Z");
		});

		it("includes completion timestamp", () => {
			const report = generateReport(makeState(), makePlan());
			expect(report).toContain("2025-01-15T11:24:00.000Z");
		});

		it("includes total duration in human-readable format", () => {
			const report = generateReport(makeState(), makePlan());
			expect(report).toContain("1h 24m");
		});

		it("handles missing completedAt gracefully", () => {
			const state = makeState({ completedAt: undefined });
			const report = generateReport(state, makePlan());
			expect(typeof report).toBe("string");
			expect(report.length).toBeGreaterThan(0);
		});
	});

	describe("VAL-RPT-002: milestone and feature outcomes", () => {
		it("lists each milestone with status", () => {
			const report = generateReport(makeState(), makePlan());
			expect(report).toContain("Foundation");
			expect(report).toContain("done");
		});

		it("lists each feature with status", () => {
			const report = generateReport(makeState(), makePlan());
			expect(report).toContain("user-model");
			expect(report).toContain("done");
		});

		it("includes attempt count for features", () => {
			const feature = makeFeature({
				attempts: [makeAttempt({ attemptNumber: 1, status: "failure" }), makeAttempt({ attemptNumber: 2 })],
			});
			const plan = makePlan({ milestones: [makeMilestone({ features: [feature] })] });
			const report = generateReport(makeState(), plan);
			expect(report).toMatch(/2.*attempt|attempt.*2/i);
		});

		it("includes feature duration when attempts have durationMs", () => {
			const report = generateReport(makeState(), makePlan());
			expect(report).toContain("1m 24s");
		});

		it("identifies fix features with origin info", () => {
			const fixFeature = makeFeature({
				id: "fix1",
				name: "fix-auth-tokens",
				fixOrigin: {
					sourceKind: "validation-failure",
					sourceFeatureId: "feat1",
					sourceMilestoneId: "ms1",
				},
			});
			const plan = makePlan({
				milestones: [makeMilestone({ features: [makeFeature(), fixFeature] })],
			});
			const state = makeState({ totalFixFeaturesCreated: 1 });
			const report = generateReport(state, plan);
			expect(report).toContain("fix-auth-tokens");
			expect(report).toContain("validation-failure");
		});

		it("shows skipped features clearly", () => {
			const feature = makeFeature({ status: "skipped" });
			const plan = makePlan({ milestones: [makeMilestone({ features: [feature] })] });
			const state = makeState({ totalFeaturesCompleted: 0, totalFeaturesSkipped: 1 });
			const report = generateReport(state, plan);
			expect(report).toContain("skipped");
		});

		it("includes milestone duration when start/complete timestamps present", () => {
			const ms = makeMilestone({
				startedAt: now.toISOString(),
				completedAt: later.toISOString(),
			});
			const plan = makePlan({ milestones: [ms] });
			const report = generateReport(makeState(), plan);
			expect(report).toContain("1h 24m");
		});
	});

	describe("VAL-RPT-003: file changes and git history", () => {
		it("includes deduplicated changed files", () => {
			const gitInfo = {
				filesChanged: ["src/auth.ts", "src/user.ts", "src/auth.ts"],
				commits: [] as Array<{ sha: string; message: string }>,
			};
			const report = generateReport(makeState(), makePlan(), gitInfo);
			expect(report).toContain("src/auth.ts");
			expect(report).toContain("src/user.ts");
			const authCount = (report.match(/src\/auth\.ts/g) ?? []).length;
			expect(authCount).toBe(1);
		});

		it("includes git commits with SHAs and messages when available", () => {
			const gitInfo = {
				filesChanged: ["src/auth.ts"],
				commits: [
					{ sha: "abc1234", message: "mission: user-model" },
					{ sha: "def5678", message: "mission: password-hashing" },
				],
			};
			const report = generateReport(makeState(), makePlan(), gitInfo);
			expect(report).toContain("abc1234");
			expect(report).toContain("mission: user-model");
			expect(report).toContain("def5678");
			expect(report).toContain("mission: password-hashing");
		});

		it("omits commit section when no gitInfo provided", () => {
			const report = generateReport(makeState(), makePlan());
			expect(report).not.toContain("abc1234");
		});

		it("handles empty commits array gracefully", () => {
			const gitInfo = {
				filesChanged: ["src/auth.ts"],
				commits: [] as Array<{ sha: string; message: string }>,
			};
			const report = generateReport(makeState(), makePlan(), gitInfo);
			expect(typeof report).toBe("string");
			expect(report).toContain("src/auth.ts");
		});

		it("handles empty filesChanged gracefully", () => {
			const gitInfo = {
				filesChanged: [] as string[],
				commits: [] as Array<{ sha: string; message: string }>,
			};
			const report = generateReport(makeState(), makePlan(), gitInfo);
			expect(typeof report).toBe("string");
		});
	});

	describe("VAL-RPT-004: per-feature metrics and optional cost", () => {
		it("includes feature duration from WorkerAttempt.metrics.durationMs", () => {
			const report = generateReport(makeState(), makePlan());
			expect(report).toContain("1m 24s");
		});

		it("includes token count when available", () => {
			const attempt = makeAttempt({ durationMs: 84000 });
			const feature = makeFeature({
				attempts: [attempt],
			});
			const gitInfo = {
				filesChanged: [] as string[],
				commits: [] as Array<{ sha: string; message: string }>,
				featureMetrics: new Map<string, { tokensUsed?: number; estimatedCost?: number }>([
					["feat1", { tokensUsed: 5000 }],
				]),
			};
			const plan = makePlan({ milestones: [makeMilestone({ features: [feature] })] });
			const report = generateReport(makeState(), plan, gitInfo);
			expect(report).toContain("5000");
		});

		it("includes cost estimate when available", () => {
			const attempt = makeAttempt();
			const feature = makeFeature({ attempts: [attempt] });
			const gitInfo = {
				filesChanged: [] as string[],
				commits: [] as Array<{ sha: string; message: string }>,
				featureMetrics: new Map<string, { tokensUsed?: number; estimatedCost?: number }>([
					["feat1", { estimatedCost: 0.05 }],
				]),
			};
			const plan = makePlan({ milestones: [makeMilestone({ features: [feature] })] });
			const report = generateReport(makeState(), plan, gitInfo);
			expect(report).toContain("0.05");
		});

		it("omits token/cost data when not available (no zeros)", () => {
			const attempt = makeAttempt({ durationMs: 84000 });
			const feature = makeFeature({ attempts: [attempt] });
			const plan = makePlan({ milestones: [makeMilestone({ features: [feature] })] });
			const report = generateReport(makeState(), plan);
			expect(report).not.toMatch(/tokens.*0[^.]/i);
			expect(report).not.toMatch(/cost.*\$0[^.]/i);
		});

		it("summary feature counts match state counters exactly", () => {
			const state = makeState({
				totalFeaturesCompleted: 3,
				totalFeaturesFailed: 1,
				totalFeaturesSkipped: 2,
				totalFixFeaturesCreated: 1,
			});
			const report = generateReport(state, makePlan());
			expect(report).toContain("3");
			expect(report).toContain("1");
			expect(report).toContain("2");
		});
	});

	describe("VAL-RPT-005: edge cases and warnings", () => {
		it("omits fix features section when zero fix features", () => {
			const state = makeState({ totalFixFeaturesCreated: 0 });
			const report = generateReport(state, makePlan());
			expect(report).not.toMatch(/^## Fix Features/m);
		});

		it("handles zero completed features gracefully (all skipped/failed)", () => {
			const feature1 = makeFeature({ id: "feat1", name: "skipped-feat", status: "skipped", attempts: [] });
			const feature2 = makeFeature({ id: "feat2", name: "failed-feat", status: "failed", attempts: [] });
			const plan = makePlan({
				milestones: [makeMilestone({ features: [feature1, feature2] })],
			});
			const state = makeState({
				totalFeaturesCompleted: 0,
				totalFeaturesFailed: 1,
				totalFeaturesSkipped: 1,
			});
			const report = generateReport(state, plan);
			expect(typeof report).toBe("string");
			expect(report).toContain("skipped");
			expect(report).toContain("failed");
		});

		it("includes dirty repo warning when gitSnapshot shows dirty files", () => {
			const state = makeState({
				gitSnapshot: {
					headCommit: "abc123",
					dirtyFiles: ["README.md"],
					autoCommitEnabled: false,
				},
			});
			const report = generateReport(state, makePlan());
			expect(report).toMatch(/dirty|pre-existing/i);
		});

		it("includes warnings section with provided warnings", () => {
			const gitInfo = {
				filesChanged: [] as string[],
				commits: [] as Array<{ sha: string; message: string }>,
				warnings: ["Out-of-scope changes detected in src/utils.ts"],
			};
			const report = generateReport(makeState(), makePlan(), gitInfo);
			expect(report).toContain("Out-of-scope changes detected in src/utils.ts");
		});

		it("includes remaining notes", () => {
			const gitInfo = {
				filesChanged: [] as string[],
				commits: [] as Array<{ sha: string; message: string }>,
				remainingNotes: ["Remember to update the docs", "Consider adding rate limiting"],
			};
			const report = generateReport(makeState(), makePlan(), gitInfo);
			expect(report).toContain("Remember to update the docs");
			expect(report).toContain("Consider adding rate limiting");
		});

		it("handles no milestones gracefully", () => {
			const plan = makePlan({ milestones: [] });
			const report = generateReport(makeState(), plan);
			expect(typeof report).toBe("string");
			expect(report.length).toBeGreaterThan(0);
		});

		it("is a valid markdown string with a header", () => {
			const report = generateReport(makeState(), makePlan());
			expect(report).toMatch(/^# /m);
		});
	});
});
