import { describe, expect, it } from "bun:test";
import { buildOrchestratorProtocol } from "../../extensions/orchestrator/protocol.js";
import type { MissionConfig, MissionState } from "../../extensions/types.js";
import { makeFeature, makeMilestone, makePlan, makeState } from "../helpers/index.js";

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
	describe("null and terminal states return null", () => {
		it("returns null when state is null", () => {
			expect(buildOrchestratorProtocol(null)).toBeNull();
		});

		it("returns null for completed state", () => {
			expect(buildOrchestratorProtocol(makeState({ status: "completed" }))).toBeNull();
		});

		it("returns null for failed state", () => {
			expect(buildOrchestratorProtocol(makeState({ status: "failed" }))).toBeNull();
		});

		it("returns null for aborted state", () => {
			expect(buildOrchestratorProtocol(makeState({ status: "aborted" }))).toBeNull();
		});

		it("returns null for idle status", () => {
			const idleState = { ...makeState({ status: "planning" }), status: "idle" } as unknown as MissionState;
			expect(buildOrchestratorProtocol(idleState)).toBeNull();
		});

		it("returns a falsy value for null (VAL-PROTO-005)", () => {
			expect(buildOrchestratorProtocol(null)).toBeFalsy();
		});

		it("returns a falsy value for completed (VAL-PROTO-005)", () => {
			expect(buildOrchestratorProtocol(makeState({ status: "completed" }))).toBeFalsy();
		});

		it("returns a falsy value for failed (VAL-PROTO-005)", () => {
			expect(buildOrchestratorProtocol(makeState({ status: "failed" }))).toBeFalsy();
		});

		it("returns a falsy value for aborted (VAL-PROTO-005)", () => {
			expect(buildOrchestratorProtocol(makeState({ status: "aborted" }))).toBeFalsy();
		});
	});

	describe("planning state (VAL-PROTO-001)", () => {
		it("returns a non-null string for planning state", () => {
			const result = buildOrchestratorProtocol(makeState({ status: "planning" }));
			expect(result).not.toBeNull();
			expect(typeof result).toBe("string");
		});

		it("contains codebase analysis instructions", () => {
			const result = buildOrchestratorProtocol(makeState({ status: "planning" })) as string;
			expect(result.toLowerCase()).toContain("analyze");
		});

		it("contains reference to submit_plan", () => {
			const result = buildOrchestratorProtocol(makeState({ status: "planning" })) as string;
			expect(result).toContain("submit_plan");
		});

		it("does NOT contain execution-phase instructions (spawn_worker)", () => {
			const result = buildOrchestratorProtocol(makeState({ status: "planning" })) as string;
			expect(result).not.toContain("spawn_worker");
		});

		it("does NOT contain execution-phase instructions (run_validation)", () => {
			const result = buildOrchestratorProtocol(makeState({ status: "planning" })) as string;
			expect(result).not.toContain("run_validation");
		});

		it("does NOT contain execution-phase instructions (commit_changes)", () => {
			const result = buildOrchestratorProtocol(makeState({ status: "planning" })) as string;
			expect(result).not.toContain("commit_changes");
		});

		it("is approximately ~500 tokens (under 2500 chars)", () => {
			const result = buildOrchestratorProtocol(makeState({ status: "planning" })) as string;
			expect(result.length).toBeLessThan(2500);
		});

		it("mentions planning phase", () => {
			const result = buildOrchestratorProtocol(makeState({ status: "planning" })) as string;
			expect(result.toLowerCase()).toContain("planning");
		});
	});

	describe("draft_review state (VAL-PROTO-002)", () => {
		it("returns a non-null string for draft_review state", () => {
			const result = buildOrchestratorProtocol(makeState({ status: "draft_review" }));
			expect(result).not.toBeNull();
			expect(typeof result).toBe("string");
		});

		it("instructs waiting for approval", () => {
			const result = buildOrchestratorProtocol(makeState({ status: "draft_review" })) as string;
			expect(result.toLowerCase()).toContain("approval");
		});

		it("prohibits starting execution (no spawn_worker)", () => {
			const result = buildOrchestratorProtocol(makeState({ status: "draft_review" })) as string;
			expect(result).not.toContain("spawn_worker");
		});

		it("prohibits starting execution (no run_validation)", () => {
			const result = buildOrchestratorProtocol(makeState({ status: "draft_review" })) as string;
			expect(result).not.toContain("run_validation");
		});

		it("explicitly prohibits executing features", () => {
			const result = buildOrchestratorProtocol(makeState({ status: "draft_review" })) as string;
			expect(result.toLowerCase()).toMatch(/do not|don't|must not|prohibited|prohibit/);
		});
	});

	describe("approved state (VAL-PROTO-003)", () => {
		it("returns a non-null string for approved state", () => {
			const result = buildOrchestratorProtocol(makeState({ status: "approved" }));
			expect(result).not.toBeNull();
			expect(typeof result).toBe("string");
		});

		it("indicates the plan is approved", () => {
			const result = buildOrchestratorProtocol(makeState({ status: "approved" })) as string;
			expect(result.toLowerCase()).toContain("approved");
		});

		it("directs to begin with spawn_worker", () => {
			const result = buildOrchestratorProtocol(makeState({ status: "approved" })) as string;
			expect(result).toContain("spawn_worker");
		});

		it("includes mission description when plan is provided", () => {
			const plan = makeProtocolPlan({ description: "Build an e-commerce platform" });
			const result = buildOrchestratorProtocol(makeState({ status: "approved" }), plan) as string;
			expect(result).toContain("Build an e-commerce platform");
		});

		it("includes milestone and feature counts when plan is provided", () => {
			const plan = makeProtocolPlan();
			const result = buildOrchestratorProtocol(makeState({ status: "approved" }), plan) as string;
			expect(result).toContain("2 milestones");
			expect(result).toContain("4 features");
		});

		it("handles absent plan gracefully", () => {
			const result = buildOrchestratorProtocol(makeState({ status: "approved" }), undefined);
			expect(result).not.toBeNull();
			expect(typeof result).toBe("string");
		});

		it("mentions worker failure policy", () => {
			const result = buildOrchestratorProtocol(makeState({ status: "approved" }), makeProtocolPlan()) as string;
			expect(result).toContain("create_fix_feature");
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
			const result = buildOrchestratorProtocol(stateWithFeature, makeProtocolPlan());
			expect(result).not.toBeNull();
			expect(typeof result).toBe("string");
		});

		it("includes current milestone name", () => {
			const result = buildOrchestratorProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result).toContain("Foundation");
		});

		it("includes current feature name", () => {
			const result = buildOrchestratorProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result).toContain("auth-endpoint");
		});

		it("includes next feature name", () => {
			const result = buildOrchestratorProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result).toContain("refresh-tokens");
		});

		it("includes milestone progress (milestone N/M)", () => {
			const result = buildOrchestratorProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result).toContain("1/2");
		});

		it("includes feature progress (feature N/M)", () => {
			const result = buildOrchestratorProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result).toMatch(/\d+\/4/);
		});

		it("references available tools", () => {
			const result = buildOrchestratorProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result).toContain("spawn_worker");
			expect(result).toContain("run_validation");
			expect(result).toContain("commit_changes");
		});

		it("fits within ~300-500 tokens (~1200-2500 chars)", () => {
			const result = buildOrchestratorProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result.length).toBeLessThan(2500);
			expect(result.length).toBeGreaterThan(200);
		});

		it("includes dirty repo warning when autoCommitEnabled is false", () => {
			const dirtyState = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f2",
				gitSnapshot: { headCommit: "abc", dirtyFiles: ["file.ts"], autoCommitEnabled: false },
			});
			const result = buildOrchestratorProtocol(dirtyState, makeProtocolPlan()) as string;
			expect(result.toLowerCase()).toContain("dirty");
		});

		it("does not include dirty repo warning when autoCommitEnabled is true", () => {
			const cleanState = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f2",
				gitSnapshot: { headCommit: "abc", dirtyFiles: [], autoCommitEnabled: true },
			});
			const result = buildOrchestratorProtocol(cleanState, makeProtocolPlan()) as string;
			expect(result.toLowerCase()).not.toContain("dirty");
		});

		it("handles absent plan gracefully without crashing", () => {
			const result = buildOrchestratorProtocol(stateWithFeature, undefined);
			expect(result).not.toBeNull();
			expect(typeof result).toBe("string");
		});

		it("includes worker failure handling instructions", () => {
			const result = buildOrchestratorProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result).toContain("WORKER FAILURE HANDLING");
			expect(result).toContain("create_fix_feature");
			expect(result.toLowerCase()).toContain("do not");
		});

		it("instructs orchestrator not to debug failures itself", () => {
			const result = buildOrchestratorProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result).toContain("You are the orchestrator, not a worker");
		});
	});

	describe("validating state (VAL-PROTO-007)", () => {
		it("returns a non-null string for validating state", () => {
			const result = buildOrchestratorProtocol(makeState({ status: "validating" }));
			expect(result).not.toBeNull();
			expect(typeof result).toBe("string");
		});

		it("instructs waiting for validation results", () => {
			const result = buildOrchestratorProtocol(makeState({ status: "validating" })) as string;
			expect(result.toLowerCase()).toContain("wait");
		});

		it("prohibits spawning workers", () => {
			const result = buildOrchestratorProtocol(makeState({ status: "validating" })) as string;
			expect(result.toLowerCase()).toMatch(/do not|don't|must not|prohibited|prohibit/);
			expect(result).not.toContain("spawn_worker");
		});

		it("is distinct from executing protocol", () => {
			const validating = buildOrchestratorProtocol(makeState({ status: "validating" })) as string;
			const executing = buildOrchestratorProtocol(
				makeState({ status: "executing", currentMilestoneId: "m1", currentFeatureId: "f2" }),
				makeProtocolPlan(),
			) as string;
			expect(validating).not.toBe(executing);
			expect(validating.toLowerCase()).toContain("validat");
		});
	});

	describe("paused state (VAL-PROTO-004)", () => {
		it("returns a non-null string for paused state", () => {
			const result = buildOrchestratorProtocol(makeState({ status: "paused" }));
			expect(result).not.toBeNull();
			expect(typeof result).toBe("string");
		});

		it("is concise (approximately ~50-100 tokens, under 500 chars)", () => {
			const result = buildOrchestratorProtocol(makeState({ status: "paused" })) as string;
			expect(result.length).toBeLessThan(500);
		});

		it("instructs the orchestrator to stop all work", () => {
			const result = buildOrchestratorProtocol(makeState({ status: "paused" })) as string;
			expect(result.toLowerCase()).toContain("paused");
		});

		it("instructs waiting for user to resume", () => {
			const result = buildOrchestratorProtocol(makeState({ status: "paused" })) as string;
			expect(result.toLowerCase()).toContain("wait");
		});
	});

	describe("autonomy levels (VAL-CROSS-008)", () => {
		it("low autonomy includes pause-after-every-feature instruction", () => {
			const result = buildOrchestratorProtocol(
				makeState({ status: "executing", currentMilestoneId: "m1", currentFeatureId: "f2" }),
				makeProtocolPlan(),
				{ autonomy: "low" } satisfies MissionConfig,
			) as string;
			expect(result.toLowerCase()).toContain("low");
			expect(result.toLowerCase()).toMatch(/after each feature|after every feature|each feature completes/);
		});

		it("medium autonomy includes pause-at-milestone-boundaries instruction", () => {
			const result = buildOrchestratorProtocol(
				makeState({ status: "executing", currentMilestoneId: "m1", currentFeatureId: "f2" }),
				makeProtocolPlan(),
				{ autonomy: "medium" } satisfies MissionConfig,
			) as string;
			expect(result.toLowerCase()).toContain("medium");
			expect(result.toLowerCase()).toMatch(/milestone boundaries|milestone boundary/);
		});

		it("high autonomy includes run-to-completion instruction", () => {
			const result = buildOrchestratorProtocol(
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
			const low = buildOrchestratorProtocol(executingState, plan, { autonomy: "low" }) as string;
			const medium = buildOrchestratorProtocol(executingState, plan, { autonomy: "medium" }) as string;
			const high = buildOrchestratorProtocol(executingState, plan, { autonomy: "high" }) as string;
			expect(low).not.toBe(medium);
			expect(medium).not.toBe(high);
			expect(low).not.toBe(high);
		});

		it("missing autonomy config defaults to medium without error", () => {
			const result = buildOrchestratorProtocol(
				makeState({ status: "executing", currentMilestoneId: "m1", currentFeatureId: "f2" }),
				makeProtocolPlan(),
				undefined,
			) as string;
			expect(result).not.toBeNull();
			expect(result.toLowerCase()).toContain("medium");
		});

		it("autonomy also applies to planning state", () => {
			const low = buildOrchestratorProtocol(makeState({ status: "planning" }), undefined, {
				autonomy: "low",
			} satisfies MissionConfig) as string;
			const high = buildOrchestratorProtocol(makeState({ status: "planning" }), undefined, {
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
				const result = buildOrchestratorProtocol(makeState({ status }));
				expect(result).not.toBeNull();
			}
		});

		it("returns null for all terminal/idle states", () => {
			const terminalStatuses = ["completed", "failed", "aborted"] as const;
			for (const status of terminalStatuses) {
				const result = buildOrchestratorProtocol(makeState({ status }));
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
			const result = buildOrchestratorProtocol(state, makeProtocolPlan()) as string;
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
			const result = buildOrchestratorProtocol(state, makeProtocolPlan()) as string;
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
			const result = buildOrchestratorProtocol(state, planAllDone) as string;
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
				const result = buildOrchestratorProtocol(makeState({ status }));
				expect(result).toBeTruthy();
				expect((result as string).length).toBeGreaterThan(10);
			}
		});

		it("state with no currentMilestoneId in executing does not crash", () => {
			const state = makeState({ status: "executing" });
			const result = buildOrchestratorProtocol(state, makeProtocolPlan());
			expect(result).not.toBeNull();
			expect(typeof result).toBe("string");
		});

		it("executing state without a plan produces valid output", () => {
			const state = makeState({ status: "executing", currentMilestoneId: "m1", currentFeatureId: "f1" });
			const result = buildOrchestratorProtocol(state);
			expect(result).not.toBeNull();
			expect(typeof result).toBe("string");
		});
	});
});
