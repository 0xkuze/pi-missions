import { afterEach, describe, expect, it } from "bun:test";
import { buildOrchestratorProtocol, clearProtocolCache } from "../../extensions/orchestrator/protocol.js";
import type { MissionConfig, MissionState } from "../../extensions/types.js";
import { makeFeature, makeMilestone, makePlan, makeState } from "../helpers/index.js";

const VERBOSE: MissionConfig = { promptingMode: "default" };

function verboseProtocol(
	state: MissionState | null,
	plan?: Parameters<typeof buildOrchestratorProtocol>[1],
	config?: MissionConfig,
	compact?: boolean,
): string | null {
	return buildOrchestratorProtocol(state, plan, { ...VERBOSE, ...config }, compact);
}

function makeProtocolPlan(overrides: Parameters<typeof makePlan>[0] = {}) {
	return makePlan({
		description: "Build a CRM",
		milestones: [
			makeMilestone({
				id: "m1",
				name: "Foundation",
				description: "Core data models",
				features: [
					makeFeature({
						id: "f1",
						name: "user-model",
						description: "Create user entity",
						acceptanceCriteria: ["User model exists"],
						status: "done",
					}),
					makeFeature({
						id: "f2",
						name: "auth-endpoint",
						description: "Create auth endpoint",
						acceptanceCriteria: ["Login endpoint works"],
						estimatedComplexity: "medium",
						status: "active",
					}),
					makeFeature({
						id: "f3",
						name: "refresh-tokens",
						description: "JWT refresh token rotation",
						acceptanceCriteria: ["Tokens refresh correctly"],
						estimatedComplexity: "medium",
						status: "pending",
					}),
				],
				validationCommands: ["npm test"],
				status: "active",
			}),
			makeMilestone({
				id: "m2",
				name: "Validation",
				description: "Validation milestone",
				features: [
					makeFeature({
						id: "f4",
						name: "audit-logs",
						description: "Audit log feature",
						acceptanceCriteria: ["Logs exist"],
					}),
				],
			}),
		],
		validationCommands: ["npm test"],
		...overrides,
	});
}

describe("buildOrchestratorProtocol", () => {
	afterEach(() => {
		clearProtocolCache();
	});

	describe("null and terminal states return null", () => {
		it("returns null when state is null", () => {
			expect(verboseProtocol(null)).toBeNull();
		});

		it("returns null for completed state", () => {
			expect(verboseProtocol(makeState({ status: "completed" }))).toBeNull();
		});

		it("returns null for failed state", () => {
			expect(verboseProtocol(makeState({ status: "failed" }))).toBeNull();
		});

		it("returns null for aborted state", () => {
			expect(verboseProtocol(makeState({ status: "aborted" }))).toBeNull();
		});

		it("returns null for idle status", () => {
			const idleState = { ...makeState({ status: "planning" }), status: "idle" } as unknown as MissionState;
			expect(verboseProtocol(idleState)).toBeNull();
		});

		it("returns a falsy value for null (VAL-PROTO-005)", () => {
			expect(verboseProtocol(null)).toBeFalsy();
		});

		it("returns a falsy value for completed (VAL-PROTO-005)", () => {
			expect(verboseProtocol(makeState({ status: "completed" }))).toBeFalsy();
		});

		it("returns a falsy value for failed (VAL-PROTO-005)", () => {
			expect(verboseProtocol(makeState({ status: "failed" }))).toBeFalsy();
		});

		it("returns a falsy value for aborted (VAL-PROTO-005)", () => {
			expect(verboseProtocol(makeState({ status: "aborted" }))).toBeFalsy();
		});
	});

	describe("planning state (VAL-PROTO-001)", () => {
		it("returns a non-null string for planning state", () => {
			const result = verboseProtocol(makeState({ status: "planning" }));
			expect(result).not.toBeNull();
			expect(typeof result).toBe("string");
		});

		it("contains reference to submit_plan", () => {
			const result = verboseProtocol(makeState({ status: "planning" })) as string;
			expect(result).toContain("submit_plan");
		});

		it("does NOT contain execution-phase instructions (spawn_worker)", () => {
			const result = verboseProtocol(makeState({ status: "planning" })) as string;
			expect(result).not.toContain("spawn_worker");
		});

		it("does NOT contain execution-phase instructions (run_validation)", () => {
			const result = verboseProtocol(makeState({ status: "planning" })) as string;
			expect(result).not.toContain("run_validation");
		});

		it("does NOT contain execution-phase instructions (commit_changes)", () => {
			const result = verboseProtocol(makeState({ status: "planning" })) as string;
			expect(result).not.toContain("commit_changes");
		});

		it("is approximately ~500 tokens (under 2500 chars)", () => {
			const result = verboseProtocol(makeState({ status: "planning" })) as string;
			expect(result.length).toBeLessThan(2500);
		});

		it("mentions planning phase", () => {
			const result = verboseProtocol(makeState({ status: "planning" })) as string;
			expect(result.toLowerCase()).toContain("planning");
		});

		it("mentions both codebase analysis and ask_questions", () => {
			const result = verboseProtocol(makeState({ status: "planning" })) as string;
			expect(result).toContain("ask_questions");
			expect(result.toLowerCase()).toContain("codebase");
		});

		it("instructs targeted scan (package.json, README, directory structure)", () => {
			const result = verboseProtocol(makeState({ status: "planning" })) as string;
			expect(result).toContain("package.json");
			expect(result).toContain("README");
			expect(result.toLowerCase()).toContain("directory");
		});

		it("instructs NOT to read implementation files", () => {
			const result = verboseProtocol(makeState({ status: "planning" })) as string;
			expect(result.toLowerCase()).toMatch(/do not.*read.*implementation|never.*read.*implementation/i);
		});

		it("encourages iterative conversation about scope", () => {
			const result = verboseProtocol(makeState({ status: "planning" })) as string;
			expect(result.toLowerCase()).toContain("conversation");
		});

		it("instructs to challenge vague goals", () => {
			const result = verboseProtocol(makeState({ status: "planning" })) as string;
			expect(result.toLowerCase()).toContain("vague");
		});

		it("mentions testable acceptance criteria", () => {
			const result = verboseProtocol(makeState({ status: "planning" })) as string;
			expect(result.toLowerCase()).toContain("acceptance criteria");
		});

		it("instructs to push back on oversized features", () => {
			const result = verboseProtocol(makeState({ status: "planning" })) as string;
			expect(result.toLowerCase()).toContain("split");
		});

		it("emphasizes plan quality", () => {
			const result = verboseProtocol(makeState({ status: "planning" })) as string;
			expect(result.toLowerCase()).toContain("most important");
		});

		it("combines bash commands guidance", () => {
			const result = verboseProtocol(makeState({ status: "planning" })) as string;
			expect(result.toLowerCase()).toContain("combine");
		});

		it("allows read and bash during planning", () => {
			const result = verboseProtocol(makeState({ status: "planning" })) as string;
			expect(result).not.toContain("do NOT use edit");
		});
	});

	describe("draft_review state (VAL-PROTO-002)", () => {
		it("returns a non-null string for draft_review state", () => {
			const result = verboseProtocol(makeState({ status: "draft_review" }));
			expect(result).not.toBeNull();
			expect(typeof result).toBe("string");
		});

		it("instructs waiting for approval", () => {
			const result = verboseProtocol(makeState({ status: "draft_review" })) as string;
			expect(result.toLowerCase()).toContain("approval");
		});

		it("explicitly forbids calling spawn_worker", () => {
			const result = verboseProtocol(makeState({ status: "draft_review" })) as string;
			expect(result).toContain("Do NOT call");
			expect(result).toContain("spawn_worker");
		});

		it("prohibits starting execution (no run_validation)", () => {
			const result = verboseProtocol(makeState({ status: "draft_review" })) as string;
			expect(result).not.toContain("run_validation");
		});

		it("explicitly prohibits executing features", () => {
			const result = verboseProtocol(makeState({ status: "draft_review" })) as string;
			expect(result.toLowerCase()).toMatch(/do not|don't|must not|prohibited|prohibit/);
		});

		it("states that a session resume does NOT mean approval", () => {
			const result = verboseProtocol(makeState({ status: "draft_review" })) as string;
			expect(result).toContain("does NOT mean approval");
		});

		it("prohibits calling start_milestone", () => {
			const result = verboseProtocol(makeState({ status: "draft_review" })) as string;
			expect(result).toContain("start_milestone");
		});

		it("prohibits calling spawn_worker", () => {
			const result = verboseProtocol(makeState({ status: "draft_review" })) as string;
			expect(result).toContain("Do NOT call");
		});

		it("mentions Mission Control UI for approval", () => {
			const result = verboseProtocol(makeState({ status: "draft_review" })) as string;
			expect(result).toContain("Ctrl+Shift+M");
		});
	});

	describe("approved state (VAL-PROTO-003)", () => {
		it("returns a non-null string for approved state", () => {
			const result = verboseProtocol(makeState({ status: "approved" }));
			expect(result).not.toBeNull();
			expect(typeof result).toBe("string");
		});

		it("indicates the plan is approved", () => {
			const result = verboseProtocol(makeState({ status: "approved" })) as string;
			expect(result.toLowerCase()).toContain("approved");
		});

		it("directs to begin with spawn_worker", () => {
			const result = verboseProtocol(makeState({ status: "approved" })) as string;
			expect(result).toContain("spawn_worker");
		});

		it("includes mission description when plan is provided", () => {
			const plan = makeProtocolPlan({ description: "Build an e-commerce platform" });
			const result = verboseProtocol(makeState({ status: "approved" }), plan) as string;
			expect(result).toContain("Build an e-commerce platform");
		});

		it("includes milestone and feature counts when plan is provided", () => {
			const plan = makeProtocolPlan();
			const result = verboseProtocol(makeState({ status: "approved" }), plan) as string;
			expect(result).toContain("2 milestones");
			expect(result).toContain("4 features");
		});

		it("handles absent plan gracefully", () => {
			const result = verboseProtocol(makeState({ status: "approved" }), undefined);
			expect(result).not.toBeNull();
			expect(typeof result).toBe("string");
		});

		it("mentions worker failure policy", () => {
			const result = verboseProtocol(makeState({ status: "approved" }), makeProtocolPlan()) as string;
			expect(result).toContain("create_fix_feature");
		});

		it("is concise (under 300 tokens / 1500 chars)", () => {
			const plan = makeProtocolPlan();
			const result = verboseProtocol(makeState({ status: "approved" }), plan) as string;
			expect(result.length).toBeLessThan(1500);
		});
	});

	describe("executing state (VAL-PROTO-003)", () => {
		const stateWithFeature = makeState({
			status: "executing",
			currentMilestoneId: "m1",
			currentFeatureId: "f2",
			totalFeaturesCompleted: 1,
		});

		it("returns a non-null string for executing state", () => {
			const result = verboseProtocol(stateWithFeature, makeProtocolPlan());
			expect(result).not.toBeNull();
			expect(typeof result).toBe("string");
		});

		it("includes current milestone name", () => {
			const result = verboseProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result).toContain("Foundation");
		});

		it("includes current feature name", () => {
			const result = verboseProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result).toContain("auth-endpoint");
		});

		it("includes next feature name", () => {
			const result = verboseProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result).toContain("refresh-tokens");
		});

		it("includes milestone progress (milestone N/M)", () => {
			const result = verboseProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result).toContain("1/2");
		});

		it("includes feature progress (feature N/M)", () => {
			const result = verboseProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result).toMatch(/\d+\/4/);
		});

		it("does not contain explicit tool list", () => {
			const result = verboseProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result).not.toMatch(/^TOOLS:/m);
		});

		it("contains progress summary", () => {
			const result = verboseProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result).toContain("Foundation");
			expect(result).toContain("auth-endpoint");
		});

		it("is under 400 tokens (char count < 2000)", () => {
			const result = verboseProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result.length).toBeLessThan(2000);
			expect(result.length).toBeGreaterThan(200);
		});

		it("contains delegation boundary (project manager)", () => {
			const result = verboseProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result.toLowerCase()).toContain("project manager");
		});

		it("contains 'Never read implementation files'", () => {
			const result = verboseProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result.toLowerCase()).toContain("never read implementation files");
		});

		it("includes dirty repo warning when autoCommitEnabled is false", () => {
			const dirtyState = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f2",
				gitSnapshot: { headCommit: "abc", dirtyFiles: ["file.ts"], autoCommitEnabled: false },
			});
			const result = verboseProtocol(dirtyState, makeProtocolPlan()) as string;
			expect(result.toLowerCase()).toContain("dirty");
		});

		it("does not include dirty repo warning when autoCommitEnabled is true", () => {
			const cleanState = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f2",
				gitSnapshot: { headCommit: "abc", dirtyFiles: [], autoCommitEnabled: true },
			});
			const result = verboseProtocol(cleanState, makeProtocolPlan()) as string;
			expect(result.toLowerCase()).not.toContain("dirty");
		});

		it("handles absent plan gracefully without crashing", () => {
			const result = verboseProtocol(stateWithFeature, undefined);
			expect(result).not.toBeNull();
			expect(typeof result).toBe("string");
		});

		it("includes concise worker failure handling", () => {
			const result = verboseProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result).toContain("create_fix_feature");
		});

		it("instructs to call complete_mission when all features are done", () => {
			const result = verboseProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result).toContain("complete_mission");
		});

		it("prohibits using edit and write during execution", () => {
			const result = verboseProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result.toLowerCase()).toMatch(/do not.*edit.*write|never.*edit.*write/i);
		});

		it("prohibits reading .pi/missions files", () => {
			const result = verboseProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result).toContain(".pi/missions");
		});

		it("contains intervention patterns for failure handling", () => {
			const result = verboseProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result.toLowerCase()).toContain("blocked");
		});

		it("contains guidance for user redirects", () => {
			const result = verboseProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result.toLowerCase()).toContain("redirect");
		});
	});

	describe("validating state (VAL-PROTO-007)", () => {
		it("returns a non-null string for validating state", () => {
			const result = verboseProtocol(makeState({ status: "validating" }));
			expect(result).not.toBeNull();
			expect(typeof result).toBe("string");
		});

		it("instructs waiting for validation results", () => {
			const result = verboseProtocol(makeState({ status: "validating" })) as string;
			expect(result.toLowerCase()).toContain("wait");
		});

		it("prohibits spawning workers", () => {
			const result = verboseProtocol(makeState({ status: "validating" })) as string;
			expect(result.toLowerCase()).toMatch(/do not|don't|must not|prohibited|prohibit/);
			expect(result).not.toContain("spawn_worker");
		});

		it("is distinct from executing protocol", () => {
			const validating = verboseProtocol(makeState({ status: "validating" })) as string;
			const executing = verboseProtocol(
				makeState({ status: "executing", currentMilestoneId: "m1", currentFeatureId: "f2" }),
				makeProtocolPlan(),
			) as string;
			expect(validating).not.toBe(executing);
			expect(validating.toLowerCase()).toContain("validat");
		});
	});

	describe("paused state (VAL-PROTO-004)", () => {
		it("returns a non-null string for paused state", () => {
			const result = verboseProtocol(makeState({ status: "paused" }));
			expect(result).not.toBeNull();
			expect(typeof result).toBe("string");
		});

		it("is concise (approximately ~50-100 tokens, under 500 chars)", () => {
			const result = verboseProtocol(makeState({ status: "paused" })) as string;
			expect(result.length).toBeLessThan(500);
		});

		it("instructs the orchestrator to stop all work", () => {
			const result = verboseProtocol(makeState({ status: "paused" })) as string;
			expect(result.toLowerCase()).toContain("paused");
		});

		it("instructs waiting for user to resume", () => {
			const result = verboseProtocol(makeState({ status: "paused" })) as string;
			expect(result.toLowerCase()).toContain("wait");
		});
	});

	describe("autonomy levels (VAL-CROSS-008)", () => {
		it("low autonomy includes pause-after-every-feature instruction", () => {
			const result = verboseProtocol(
				makeState({ status: "executing", currentMilestoneId: "m1", currentFeatureId: "f2" }),
				makeProtocolPlan(),
				{ autonomy: "low" } satisfies MissionConfig,
			) as string;
			expect(result.toLowerCase()).toContain("low");
			expect(result.toLowerCase()).toMatch(/after each feature|after every feature|each feature completes/);
		});

		it("medium autonomy includes pause-at-milestone-boundaries instruction", () => {
			const result = verboseProtocol(
				makeState({ status: "executing", currentMilestoneId: "m1", currentFeatureId: "f2" }),
				makeProtocolPlan(),
				{ autonomy: "medium" } satisfies MissionConfig,
			) as string;
			expect(result.toLowerCase()).toContain("medium");
			expect(result.toLowerCase()).toMatch(/milestone boundaries|milestone boundary/);
		});

		it("high autonomy includes run-to-completion instruction", () => {
			const result = verboseProtocol(
				makeState({ status: "executing", currentMilestoneId: "m1", currentFeatureId: "f2" }),
				makeProtocolPlan(),
				{ autonomy: "high" } satisfies MissionConfig,
			) as string;
			expect(result.toLowerCase()).toContain("high");
			expect(result.toLowerCase()).toMatch(/run.*(to|the).*completion|completion without pausing/);
		});

		it("three autonomy levels produce distinct content", () => {
			const executingState = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f2",
			});
			const plan = makeProtocolPlan();
			const low = verboseProtocol(executingState, plan, { autonomy: "low" }) as string;
			const medium = verboseProtocol(executingState, plan, { autonomy: "medium" }) as string;
			const high = verboseProtocol(executingState, plan, { autonomy: "high" }) as string;
			expect(low).not.toBe(medium);
			expect(medium).not.toBe(high);
			expect(low).not.toBe(high);
		});

		it("missing autonomy config defaults to medium without error", () => {
			const result = verboseProtocol(
				makeState({ status: "executing", currentMilestoneId: "m1", currentFeatureId: "f2" }),
				makeProtocolPlan(),
				undefined,
			) as string;
			expect(result).not.toBeNull();
			expect(result.toLowerCase()).toContain("medium");
		});

		it("autonomy also applies to planning state", () => {
			const low = verboseProtocol(makeState({ status: "planning" }), undefined, {
				autonomy: "low",
			} satisfies MissionConfig) as string;
			const high = verboseProtocol(makeState({ status: "planning" }), undefined, {
				autonomy: "high",
			} satisfies MissionConfig) as string;
			expect(low).not.toBe(high);
			expect(low.toLowerCase()).toContain("low");
			expect(high.toLowerCase()).toContain("high");
		});
	});

	describe("protocol injection wired via before_agent_start (VAL-PROTO-006)", () => {
		it("returns non-null for all active states", () => {
			const activeStatuses: MissionState["status"][] = [
				"planning",
				"draft_review",
				"approved",
				"executing",
				"validating",
				"paused",
			];
			for (const status of activeStatuses) {
				const result = verboseProtocol(makeState({ status }));
				expect(result).not.toBeNull();
			}
		});

		it("returns null for all terminal/idle states", () => {
			const terminalStatuses = ["completed", "failed", "aborted"] as const;
			for (const status of terminalStatuses) {
				const result = verboseProtocol(makeState({ status }));
				expect(result).toBeNull();
			}
		});
	});

	describe("progress summary accuracy (executing state)", () => {
		it("shows correct milestone index (1-based)", () => {
			const state = makeState({
				status: "executing",
				currentMilestoneId: "m2",
				currentFeatureId: "f4",
				totalFeaturesCompleted: 3,
			});
			const result = verboseProtocol(state, makeProtocolPlan()) as string;
			expect(result).toContain("2/2");
		});

		it("shows correct feature counts using skipped+completed", () => {
			const state = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f2",
				totalFeaturesCompleted: 1,
				totalFeaturesSkipped: 1,
			});
			const result = verboseProtocol(state, makeProtocolPlan()) as string;
			expect(result).toContain("2/4");
		});

		it("shows (no more features) when all remaining features are done", () => {
			const planAllDone = makeProtocolPlan();
			planAllDone.milestones[0].features[2].status = "done";
			planAllDone.milestones[1].features[0].status = "done";
			const state = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f2",
			});
			const result = verboseProtocol(state, planAllDone) as string;
			expect(result).toContain("no more features");
		});
	});

	describe("edge cases", () => {
		it("all active states return non-empty strings", () => {
			const activeStatuses: MissionState["status"][] = [
				"planning",
				"draft_review",
				"approved",
				"executing",
				"validating",
				"paused",
			];
			for (const status of activeStatuses) {
				const result = verboseProtocol(makeState({ status }));
				expect(result).toBeTruthy();
				expect((result as string).length).toBeGreaterThan(10);
			}
		});

		it("state with no currentMilestoneId in executing does not crash", () => {
			const state = makeState({ status: "executing" });
			const result = verboseProtocol(state, makeProtocolPlan());
			expect(result).not.toBeNull();
			expect(typeof result).toBe("string");
		});

		it("executing state without a plan produces valid output", () => {
			const state = makeState({ status: "executing", currentMilestoneId: "m1", currentFeatureId: "f1" });
			const result = verboseProtocol(state);
			expect(result).not.toBeNull();
			expect(typeof result).toBe("string");
		});
	});

	describe("protocol cache", () => {
		it("returns same string reference for same cache key inputs", () => {
			const state = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f2",
				totalFeaturesCompleted: 1,
			});
			const plan = makeProtocolPlan();
			const config: MissionConfig = { autonomy: "medium" };
			const first = verboseProtocol(state, plan, config);
			const second = verboseProtocol(state, plan, config);
			expect(first).toBe(second);
		});

		it("returns different string when status changes", () => {
			const state1 = makeState({ status: "planning" });
			const state2 = makeState({ status: "paused" });
			const first = verboseProtocol(state1);
			const second = verboseProtocol(state2);
			expect(first).not.toBe(second);
		});

		it("returns different string when currentFeatureId changes", () => {
			const plan = makeProtocolPlan();
			const state1 = makeState({ status: "executing", currentMilestoneId: "m1", currentFeatureId: "f1" });
			const state2 = makeState({ status: "executing", currentMilestoneId: "m1", currentFeatureId: "f2" });
			const first = verboseProtocol(state1, plan);
			const second = verboseProtocol(state2, plan);
			expect(first).not.toBe(second);
		});

		it("clearProtocolCache forces rebuild (returns equal content)", () => {
			const state = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f2",
				totalFeaturesCompleted: 1,
			});
			const plan = makeProtocolPlan();
			const first = verboseProtocol(state, plan);
			clearProtocolCache();
			const second = verboseProtocol(state, plan);
			expect(first).toEqual(second);
		});

		it("returns different string when totalFeaturesCompleted changes", () => {
			const plan = makeProtocolPlan();
			const state1 = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f2",
				totalFeaturesCompleted: 0,
			});
			const state2 = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f2",
				totalFeaturesCompleted: 1,
			});
			const first = verboseProtocol(state1, plan);
			clearProtocolCache();
			const second = verboseProtocol(state2, plan);
			expect(first).not.toBe(second);
		});

		it("returns different string when totalFeaturesSkipped changes", () => {
			const plan = makeProtocolPlan();
			const state1 = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f2",
				totalFeaturesSkipped: 0,
			});
			const state2 = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f2",
				totalFeaturesSkipped: 1,
			});
			const first = verboseProtocol(state1, plan);
			clearProtocolCache();
			const second = verboseProtocol(state2, plan);
			expect(first).not.toBe(second);
		});

		it("returns different string when autonomy config changes", () => {
			const state = makeState({ status: "executing", currentMilestoneId: "m1", currentFeatureId: "f2" });
			const plan = makeProtocolPlan();
			const first = verboseProtocol(state, plan, { autonomy: "low" });
			clearProtocolCache();
			const second = verboseProtocol(state, plan, { autonomy: "high" });
			expect(first).not.toBe(second);
		});

		it("cache key includes planVersion so different versions get different entries", () => {
			const state = makeState({ status: "approved" });
			const plan1 = makeProtocolPlan({ planVersion: 1, description: "Plan v1" });
			const plan2 = makeProtocolPlan({ planVersion: 2, description: "Plan v2" });
			const first = verboseProtocol(state, plan1);
			const second = verboseProtocol(state, plan2);
			expect(first).not.toEqual(second);
		});
	});
});
