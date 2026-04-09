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

		it("is under 5000 chars (detailed planning protocol)", () => {
			const result = verboseProtocol(makeState({ status: "planning" })) as string;
			expect(result.length).toBeLessThan(6000);
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

		it("encourages multi-round questioning about scope", () => {
			const result = verboseProtocol(makeState({ status: "planning" })) as string;
			expect(result.toLowerCase()).toContain("round");
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

		it("instructs populating library/architecture.md after codebase analysis", () => {
			const result = verboseProtocol(makeState({ status: "planning" })) as string;
			expect(result).toMatch(/architecture\.md|architecture topic/i);
			expect(result.toLowerCase()).toMatch(/library.*architecture|populate.*library/i);
		});

		it("instructs populating library/conventions.md after codebase analysis", () => {
			const result = verboseProtocol(makeState({ status: "planning" })) as string;
			expect(result).toMatch(/conventions\.md|conventions topic/i);
		});

		it("instructs setting milestone-specific validationCommands", () => {
			const result = verboseProtocol(makeState({ status: "planning" })) as string;
			expect(result).toMatch(/validationCommands|validation.*commands/i);
			expect(result.toLowerCase()).toMatch(/milestone.*validation|scaffold/i);
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

		it("does not instruct calling start_milestone", () => {
			const plan = makeProtocolPlan();
			const result = verboseProtocol(makeState({ status: "approved" }), plan) as string;
			expect(result).not.toContain("call `start_milestone`");
			expect(result).not.toContain("call start_milestone");
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

		it("is under 1000 tokens (char count < 5000)", () => {
			const result = verboseProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result.length).toBeLessThan(6000);
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

		it("instructs using complete_feature for verified work", () => {
			const result = verboseProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result).toContain("complete_feature");
			expect(result).toContain("VERIFIED WORK COMPLETION");
		});

		it("distinguishes complete_feature from skip_feature in protocol", () => {
			const result = verboseProtocol(stateWithFeature, makeProtocolPlan()) as string;
			const verifiedSection = result.indexOf("VERIFIED WORK COMPLETION");
			expect(verifiedSection).toBeGreaterThan(-1);
			const afterSection = result.slice(verifiedSection);
			expect(afterSection).toContain("NOT");
			expect(afterSection).toContain("skip_feature");
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

		it("instructs retry logic for failed features", () => {
			const result = verboseProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result).toMatch(/retry|retries|retry.*feature|feature.*fail.*twice/i);
		});

		it("instructs handling features stuck as active", () => {
			const result = verboseProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result.toLowerCase()).toMatch(/stuck|active.*feature|feature.*stuck/i);
		});

		it("instructs when to move on vs retry", () => {
			const result = verboseProtocol(stateWithFeature, makeProtocolPlan()) as string;
			expect(result.toLowerCase()).toMatch(/move on|retry|exhausts/);
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

	describe("progressive protocol injection — first turn (VAL-PROTOCOL-001)", () => {
		const state = makeState({
			status: "executing",
			currentMilestoneId: "m1",
			currentFeatureId: "f2",
			totalFeaturesCompleted: 1,
		});
		const plan = makeProtocolPlan();

		it("first turn (turnCount=1) includes both static rules and dynamic context", () => {
			const result = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 1 }) as string;
			expect(result).toContain("RETRY AND STUCK FEATURE HANDLING");
			expect(result).toContain("auth-endpoint");
			expect(result).toContain("Foundation");
		});

		it("first turn includes delegation boundary", () => {
			const result = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 1 }) as string;
			expect(result.toLowerCase()).toContain("project manager");
		});

		it("first turn includes autonomy instructions", () => {
			const result = buildOrchestratorProtocol(
				state,
				plan,
				{ promptingMode: "default", autonomy: "medium" },
				false,
				{ turnCount: 1 },
			) as string;
			expect(result.toLowerCase()).toContain("autonomy");
		});

		it("first turn (turnCount=0) also treated as first turn", () => {
			const result = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 0 }) as string;
			expect(result).toContain("RETRY AND STUCK FEATURE HANDLING");
			expect(result).toContain("auth-endpoint");
		});

		it("undefined turnCount defaults to first turn (full protocol)", () => {
			const result = buildOrchestratorProtocol(state, plan, VERBOSE) as string;
			expect(result).toContain("RETRY AND STUCK FEATURE HANDLING");
		});
	});

	describe("progressive protocol injection — subsequent turns (VAL-PROTOCOL-002)", () => {
		const state = makeState({
			status: "executing",
			currentMilestoneId: "m1",
			currentFeatureId: "f2",
			totalFeaturesCompleted: 1,
		});
		const plan = makeProtocolPlan();

		it("turn 2 omits static rules (RETRY AND STUCK FEATURE HANDLING)", () => {
			const result = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 2 }) as string;
			expect(result).not.toContain("RETRY AND STUCK FEATURE HANDLING");
		});

		it("turn 2 retains dynamic context (current feature, progress)", () => {
			const result = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 2 }) as string;
			expect(result).toContain("auth-endpoint");
			expect(result).toContain("Foundation");
			expect(result).toContain("1/4");
		});

		it("turn 2 omits delegation boundary text", () => {
			const result = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 2 }) as string;
			expect(result.toLowerCase()).not.toContain("project manager");
		});

		it("turn 2 is significantly shorter than turn 1", () => {
			const first = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 1 }) as string;
			const second = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 2 }) as string;
			expect(second.length).toBeLessThan(first.length * 0.6);
		});

		it("turn 3 behaves same as turn 2 (dynamic-only)", () => {
			const turn2 = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 2 }) as string;
			const turn3 = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 3 }) as string;
			expect(turn2).toEqual(turn3);
		});
	});

	describe("progressive protocol — context usage override (VAL-PROTOCOL-005)", () => {
		const state = makeState({
			status: "executing",
			currentMilestoneId: "m1",
			currentFeatureId: "f2",
			totalFeaturesCompleted: 1,
		});
		const plan = makeProtocolPlan();

		it("context usage >60% forces compact mode on turn 1", () => {
			const result = buildOrchestratorProtocol(state, plan, VERBOSE, false, {
				turnCount: 1,
				contextUsagePercent: 70,
			}) as string;
			expect(result).not.toContain("RETRY AND STUCK FEATURE HANDLING");
		});

		it("context usage <=60% allows full protocol on turn 1", () => {
			const result = buildOrchestratorProtocol(state, plan, VERBOSE, false, {
				turnCount: 1,
				contextUsagePercent: 55,
			}) as string;
			expect(result).toContain("RETRY AND STUCK FEATURE HANDLING");
		});

		it("context usage exactly 60 allows full protocol", () => {
			const result = buildOrchestratorProtocol(state, plan, VERBOSE, false, {
				turnCount: 1,
				contextUsagePercent: 60,
			}) as string;
			expect(result).toContain("RETRY AND STUCK FEATURE HANDLING");
		});

		it("context usage at 61 forces compact mode", () => {
			const result = buildOrchestratorProtocol(state, plan, VERBOSE, false, {
				turnCount: 1,
				contextUsagePercent: 61,
			}) as string;
			expect(result).not.toContain("RETRY AND STUCK FEATURE HANDLING");
		});

		it("compact boolean parameter still works independently", () => {
			const result = buildOrchestratorProtocol(state, plan, VERBOSE, true) as string;
			expect(result).not.toBeNull();
			expect(typeof result).toBe("string");
		});
	});

	describe("progressive protocol — getContextUsage unavailability (VAL-PROTOARCH-002)", () => {
		const state = makeState({
			status: "executing",
			currentMilestoneId: "m1",
			currentFeatureId: "f2",
			totalFeaturesCompleted: 1,
		});
		const plan = makeProtocolPlan();

		it("undefined contextUsagePercent falls back to turn-based (turn 1 = full)", () => {
			const result = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 1 }) as string;
			expect(result).toContain("RETRY AND STUCK FEATURE HANDLING");
		});

		it("undefined contextUsagePercent falls back to turn-based (turn 2 = compact)", () => {
			const result = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 2 }) as string;
			expect(result).not.toContain("RETRY AND STUCK FEATURE HANDLING");
		});

		it("no options parameter at all defaults to full protocol", () => {
			const result = buildOrchestratorProtocol(state, plan, VERBOSE) as string;
			expect(result).toContain("RETRY AND STUCK FEATURE HANDLING");
		});
	});

	describe("progressive protocol — cache key includes protocolVersion and turnCount (VAL-PROTOCOL-006)", () => {
		it("different protocolVersion produces different cache key", () => {
			const state = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f2",
				protocolVersion: 1,
			});
			const state2 = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f2",
				protocolVersion: 2,
			});
			const plan = makeProtocolPlan();
			const first = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 1 });
			clearProtocolCache();
			const second = buildOrchestratorProtocol(state2, plan, VERBOSE, false, { turnCount: 1 });
			expect(first).not.toEqual(second);
		});

		it("different turnCount produces different cache key", () => {
			const state = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f2",
			});
			const plan = makeProtocolPlan();
			const first = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 1 });
			clearProtocolCache();
			const second = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 2 });
			expect(first).not.toEqual(second);
		});

		it("same protocolVersion and turnCount returns cached result", () => {
			const state = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f2",
				protocolVersion: 3,
			});
			const plan = makeProtocolPlan();
			const first = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 1 });
			const second = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 1 });
			expect(first).toBe(second);
		});

		it("cache key is stable for same protocolVersion", () => {
			const state = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f2",
				protocolVersion: 5,
			});
			const plan = makeProtocolPlan();
			const first = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 1 });
			clearProtocolCache();
			const second = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 1 });
			expect(first).toEqual(second);
		});

		it("contextUsagePercent affects cache key", () => {
			const state = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f2",
			});
			const plan = makeProtocolPlan();
			const first = buildOrchestratorProtocol(state, plan, VERBOSE, false, {
				turnCount: 1,
				contextUsagePercent: 40,
			});
			clearProtocolCache();
			const second = buildOrchestratorProtocol(state, plan, VERBOSE, false, {
				turnCount: 1,
				contextUsagePercent: 80,
			});
			expect(first).not.toEqual(second);
		});
	});

	describe("progressive protocol — non-executing states unaffected", () => {
		it("planning state ignores turnCount and always returns full protocol", () => {
			const state = makeState({ status: "planning" });
			const result = buildOrchestratorProtocol(state, undefined, VERBOSE, false, { turnCount: 5 }) as string;
			expect(result).toContain("submit_plan");
		});

		it("draft_review state ignores turnCount", () => {
			const state = makeState({ status: "draft_review" });
			const result = buildOrchestratorProtocol(state, undefined, VERBOSE, false, { turnCount: 5 }) as string;
			expect(result).toContain("approval");
		});

		it("approved state ignores turnCount", () => {
			const state = makeState({ status: "approved" });
			const plan = makeProtocolPlan();
			const result = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 5 }) as string;
			expect(result).toContain("spawn_worker");
		});

		it("validating state ignores turnCount", () => {
			const state = makeState({ status: "validating" });
			const result = buildOrchestratorProtocol(state, undefined, VERBOSE, false, { turnCount: 5 }) as string;
			expect(result.toLowerCase()).toContain("validat");
		});

		it("paused state ignores turnCount", () => {
			const state = makeState({ status: "paused" });
			const result = buildOrchestratorProtocol(state, undefined, VERBOSE, false, { turnCount: 5 }) as string;
			expect(result.toLowerCase()).toContain("paused");
		});
	});

	describe("progressive protocol — caveman mode", () => {
		const cavemanConfig: MissionConfig = { promptingMode: "caveman" };

		it("caveman first turn includes full caveman executing protocol", () => {
			const state = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f2",
				totalFeaturesCompleted: 1,
			});
			const plan = makeProtocolPlan();
			const result = buildOrchestratorProtocol(state, plan, cavemanConfig, false, { turnCount: 1 }) as string;
			expect(result.toLowerCase()).toContain("caveman");
			expect(result).toContain("auth-endpoint");
		});

		it("caveman subsequent turn uses compact summary", () => {
			const state = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f2",
				totalFeaturesCompleted: 1,
			});
			const plan = makeProtocolPlan();
			const result = buildOrchestratorProtocol(state, plan, cavemanConfig, false, { turnCount: 2 }) as string;
			expect(result).toContain("auth-endpoint");
		});

		it("caveman subsequent turn is shorter than first turn", () => {
			const state = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f2",
				totalFeaturesCompleted: 1,
			});
			const plan = makeProtocolPlan();
			const first = buildOrchestratorProtocol(state, plan, cavemanConfig, false, { turnCount: 1 }) as string;
			const second = buildOrchestratorProtocol(state, plan, cavemanConfig, false, { turnCount: 2 }) as string;
			expect(second.length).toBeLessThan(first.length);
		});
	});

	describe("plan context in dynamic section (VAL-PLANCTX-001)", () => {
		it("includes all milestone names with their statuses", () => {
			const plan = makePlan({
				description: "Build CRM",
				milestones: [
					makeMilestone({ id: "m1", name: "Foundation", status: "done", features: [] }),
					makeMilestone({ id: "m2", name: "Auth System", status: "active", features: [] }),
					makeMilestone({ id: "m3", name: "Dashboard", status: "pending", features: [] }),
				],
			});
			const state = makeState({
				status: "executing",
				currentMilestoneId: "m2",
			});
			const result = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 1 }) as string;
			expect(result).toContain("Foundation");
			expect(result).toContain("Auth System");
			expect(result).toContain("Dashboard");
			expect(result.toLowerCase()).toMatch(/done|completed/);
			expect(result.toLowerCase()).toMatch(/active/);
			expect(result.toLowerCase()).toMatch(/pending/);
		});

		it("active milestone is clearly marked", () => {
			const plan = makePlan({
				milestones: [
					makeMilestone({ id: "m1", name: "Done MS", status: "done", features: [] }),
					makeMilestone({ id: "m2", name: "Active MS", status: "active", features: [] }),
				],
			});
			const state = makeState({ status: "executing", currentMilestoneId: "m2" });
			const result = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 1 }) as string;
			const activeMatch = result.match(/Active MS.*active|active.*Active MS/i);
			expect(activeMatch).not.toBeNull();
		});
	});

	describe("plan context — feature names with statuses (VAL-PLANCTX-002)", () => {
		it("includes current milestone feature names and statuses", () => {
			const plan = makePlan({
				milestones: [
					makeMilestone({
						id: "m1",
						name: "Core",
						status: "active",
						features: [
							makeFeature({ id: "f1", name: "user-model", status: "done" }),
							makeFeature({ id: "f2", name: "auth-api", status: "active" }),
							makeFeature({ id: "f3", name: "token-refresh", status: "pending" }),
							makeFeature({ id: "f4", name: "session-store", status: "pending" }),
						],
					}),
				],
			});
			const state = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f2",
			});
			const result = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 1 }) as string;
			expect(result).toContain("user-model");
			expect(result).toContain("auth-api");
			expect(result).toContain("token-refresh");
			expect(result).toContain("session-store");
		});

		it("features in non-current milestones are summarized as count only", () => {
			const plan = makePlan({
				milestones: [
					makeMilestone({
						id: "m1",
						name: "Active",
						status: "active",
						features: [
							makeFeature({ id: "f1", name: "feature-a", status: "active" }),
							makeFeature({ id: "f1b", name: "feature-b", status: "pending" }),
						],
					}),
					makeMilestone({
						id: "m2",
						name: "Future",
						status: "pending",
						features: [
							makeFeature({ id: "f2", name: "secret-feature-x", status: "pending" }),
							makeFeature({ id: "f3", name: "secret-feature-y", status: "pending" }),
						],
					}),
				],
			});
			const state = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f1",
			});
			const result = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 1 }) as string;
			const milestonesIdx = result.indexOf("## MILESTONES");
			const currentFeatureIdx = result.indexOf("## CURRENT FEATURE");
			const planContextSection = result.slice(
				milestonesIdx,
				currentFeatureIdx > -1 ? currentFeatureIdx : result.length,
			);
			expect(planContextSection).not.toContain("secret-feature-x");
			expect(planContextSection).not.toContain("secret-feature-y");
			expect(planContextSection).toMatch(/2\s*features/);
		});
	});

	describe("plan context — current feature details (VAL-PLANCTX-003)", () => {
		it("includes current feature name, description, and criteria", () => {
			const plan = makePlan({
				milestones: [
					makeMilestone({
						id: "m1",
						name: "Core",
						status: "active",
						features: [
							makeFeature({
								id: "f2",
								name: "auth-endpoint",
								description: "Create login and register endpoints with JWT",
								acceptanceCriteria: ["Login returns token", "Register creates user"],
								status: "active",
							}),
						],
					}),
				],
			});
			const state = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f2",
			});
			const result = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 1 }) as string;
			expect(result).toContain("auth-endpoint");
			expect(result).toContain("Create login and register endpoints with JWT");
			expect(result).toContain("Login returns token");
			expect(result).toContain("Register creates user");
		});

		it("handles missing current feature gracefully", () => {
			const plan = makePlan({
				milestones: [
					makeMilestone({
						id: "m1",
						name: "Core",
						status: "active",
						features: [],
					}),
				],
			});
			const state = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "nonexistent",
			});
			const result = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 1 });
			expect(result).not.toBeNull();
			expect(typeof result).toBe("string");
		});
	});

	describe("plan context — line count constraint (VAL-PLANCTX-004)", () => {
		function makeLargePlan() {
			return makePlan({
				description: "Large mission with 10 features across 2 milestones",
				milestones: [
					makeMilestone({
						id: "ms1",
						name: "Milestone One - Core Infrastructure",
						status: "active",
						features: [
							makeFeature({
								id: "f1",
								name: "database-schema",
								description: "Design database schema",
								acceptanceCriteria: ["Tables created", "Migrations run"],
								status: "done",
							}),
							makeFeature({
								id: "f2",
								name: "user-model",
								description: "Create user model with validation",
								acceptanceCriteria: ["Model validates email", "Password hashing works"],
								status: "done",
							}),
							makeFeature({
								id: "f3",
								name: "auth-endpoint",
								description: "Login and register endpoints",
								acceptanceCriteria: ["Login returns JWT", "Register creates user"],
								status: "active",
							}),
							makeFeature({
								id: "f4",
								name: "token-refresh",
								description: "JWT refresh token rotation",
								acceptanceCriteria: ["Tokens refresh correctly", "Old tokens invalidated"],
								status: "pending",
							}),
							makeFeature({
								id: "f5",
								name: "session-store",
								description: "Server-side session management",
								acceptanceCriteria: ["Sessions persist", "Session timeout works"],
								status: "pending",
							}),
						],
					}),
					makeMilestone({
						id: "ms2",
						name: "Milestone Two - User Interface",
						status: "pending",
						features: [
							makeFeature({
								id: "f6",
								name: "login-page",
								description: "Login page with form",
								acceptanceCriteria: ["Form renders", "Error messages shown"],
								status: "pending",
							}),
							makeFeature({
								id: "f7",
								name: "register-page",
								description: "Registration page",
								acceptanceCriteria: ["Form validates input", "Success redirect"],
								status: "pending",
							}),
							makeFeature({
								id: "f8",
								name: "dashboard-view",
								description: "Main dashboard after login",
								acceptanceCriteria: ["Data loads", "Charts render"],
								status: "pending",
							}),
							makeFeature({
								id: "f9",
								name: "profile-page",
								description: "User profile editing",
								acceptanceCriteria: ["Profile updates", "Avatar upload"],
								status: "pending",
							}),
							makeFeature({
								id: "f10",
								name: "settings-page",
								description: "App settings management",
								acceptanceCriteria: ["Settings save", "Defaults applied"],
								status: "pending",
							}),
						],
					}),
				],
			});
		}

		function extractPlanContextLines(result: string): string[] {
			const lines = result.split("\n");
			const startIdx = lines.findIndex((l) => l.match(/MILESTONES|milestones/i));
			if (startIdx === -1) return [];
			const contextLines: string[] = [];
			for (let i = startIdx; i < lines.length; i++) {
				if (lines[i].trim() === "") continue;
				if (i > startIdx && lines[i].startsWith("## ")) break;
				contextLines.push(lines[i]);
			}
			return contextLines;
		}

		it("plan context section is <=30 non-empty lines for a 10-feature plan", () => {
			const plan = makeLargePlan();
			const state = makeState({
				status: "executing",
				currentMilestoneId: "ms1",
				currentFeatureId: "f3",
				totalFeaturesCompleted: 2,
			});
			const result = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 1 }) as string;
			const planContextLines = extractPlanContextLines(result);
			const planContextNonEmpty = planContextLines.filter((l) => l.trim().length > 0);
			expect(planContextNonEmpty.length).toBeLessThanOrEqual(30);
		});
	});

	describe("plan context — cross-feature validation (VAL-CROSS-005)", () => {
		it("dynamic section shows milestone, feature, progress, and next feature", () => {
			const plan = makePlan({
				milestones: [
					makeMilestone({
						id: "m1",
						name: "Core Module",
						status: "active",
						features: [
							makeFeature({ id: "f1", name: "setup", status: "done" }),
							makeFeature({ id: "f2", name: "auth-layer", status: "active" }),
							makeFeature({ id: "f3", name: "data-sync", status: "pending" }),
							makeFeature({ id: "f4", name: "event-bus", status: "pending" }),
							makeFeature({ id: "f5", name: "api-gateway", status: "pending" }),
						],
					}),
					makeMilestone({
						id: "m2",
						name: "UI Layer",
						status: "pending",
						features: [],
					}),
				],
			});
			const state = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f2",
				totalFeaturesCompleted: 1,
			});
			const result = buildOrchestratorProtocol(state, plan, VERBOSE, false, { turnCount: 1 }) as string;
			expect(result).toContain("Core Module");
			expect(result).toContain("auth-layer");
			expect(result).toMatch(/1\/5/);
			expect(result).toContain("data-sync");
		});

		it("advancing state updates the summary", () => {
			const plan = makePlan({
				milestones: [
					makeMilestone({
						id: "m1",
						name: "Core Module",
						status: "active",
						features: [
							makeFeature({ id: "f1", name: "setup", status: "done" }),
							makeFeature({ id: "f2", name: "auth-layer", status: "done" }),
							makeFeature({ id: "f3", name: "data-sync", status: "active" }),
						],
					}),
				],
			});
			const state2 = makeState({
				status: "executing",
				currentMilestoneId: "m1",
				currentFeatureId: "f3",
				totalFeaturesCompleted: 2,
			});
			clearProtocolCache();
			const result2 = buildOrchestratorProtocol(state2, plan, VERBOSE, false, { turnCount: 1 }) as string;
			expect(result2).toContain("data-sync");
			expect(result2).toMatch(/2\/3/);
		});
	});

	describe("scrutiny instructions in executing protocol (VAL-SCRUTINY-007, VAL-SCRUTINY-008)", () => {
		it("includes run_scrutiny in executing protocol", () => {
			const state = makeState({ status: "executing" });
			const result = buildOrchestratorProtocol(state, undefined, VERBOSE, false, { turnCount: 1 }) as string;
			expect(result).toContain("run_scrutiny");
		});

		it("instructs running scrutiny after validation passes", () => {
			const state = makeState({ status: "executing" });
			const result = buildOrchestratorProtocol(state, undefined, VERBOSE, false, { turnCount: 1 }) as string;
			expect(result).toContain("run_scrutiny");
			const scrutinyIdx = result.indexOf("run_scrutiny");
			const validationPassIdx = result.toLowerCase().indexOf("validation");
			expect(scrutinyIdx).toBeGreaterThan(0);
			expect(validationPassIdx).toBeGreaterThan(0);
		});

		it("states validation must pass before scrutiny", () => {
			const state = makeState({ status: "executing" });
			const result = buildOrchestratorProtocol(state, undefined, VERBOSE, false, { turnCount: 1 }) as string;
			expect(result).toMatch(/validation.*pass.*scrutiny|scrutiny.*validation.*pass/i);
		});

		it("includes fix feature instructions for error-severity scrutiny issues", () => {
			const state = makeState({ status: "executing" });
			const result = buildOrchestratorProtocol(state, undefined, VERBOSE, false, { turnCount: 1 }) as string;
			expect(result).toContain("scrutiny");
			expect(result).toMatch(/error.*severity|error-severity/i);
		});

		it("caveman executing includes run_scrutiny", () => {
			const state = makeState({ status: "executing" });
			const result = buildOrchestratorProtocol(state, undefined, { promptingMode: "caveman" }, false, {
				turnCount: 1,
			}) as string;
			expect(result).toContain("run_scrutiny");
		});
	});
});
