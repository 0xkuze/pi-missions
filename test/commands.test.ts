import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { type CommandDeps, registerCommands } from "../extensions/commands.js";
import { savePlan, saveState } from "../extensions/state/manager.js";
import { readHistory } from "../extensions/state/plan-history.js";
import type { MissionPlan, MissionState } from "../extensions/types.js";
import { nowISO } from "../extensions/utils.js";

function makePlanningState(): MissionState {
	return {
		missionId: "test-mission",
		status: "planning",
		progressLog: [],
		startedAt: new Date(Date.now() - 60_000).toISOString(),
		totalFeaturesCompleted: 0,
		totalFeaturesFailed: 0,
		totalFeaturesSkipped: 0,
		totalFixFeaturesCreated: 0,
	};
}

function makeDraftReviewState(): MissionState {
	return { ...makePlanningState(), status: "draft_review" };
}

function makeApprovedState(): MissionState {
	return { ...makePlanningState(), status: "approved" };
}

function makeExecutingState(currentFeatureId?: string): MissionState {
	return {
		...makePlanningState(),
		status: "executing",
		currentMilestoneId: "m1",
		currentFeatureId,
	};
}

function makeValidatingState(): MissionState {
	return { ...makePlanningState(), status: "validating" };
}

function makePausedState(resumeTarget: "executing" | "planning" | "draft_review" | "validating"): MissionState {
	return {
		...makePlanningState(),
		status: "paused",
		resumeTargetState: resumeTarget,
	};
}

function makeCompletedState(): MissionState {
	return { ...makePlanningState(), status: "completed", completedAt: nowISO() };
}

function makeFailedState(): MissionState {
	return { ...makePlanningState(), status: "failed", completedAt: nowISO() };
}

function makeMinimalPlan(): MissionPlan {
	return {
		id: "plan-1",
		description: "Test mission",
		planVersion: 1,
		milestones: [
			{
				id: "m1",
				name: "Milestone 1",
				description: "First milestone",
				status: "active",
				features: [
					{
						id: "f1",
						name: "Feature 1",
						description: "First feature",
						acceptanceCriteria: ["does stuff"],
						relevantFiles: [],
						dependencies: [],
						estimatedComplexity: "low",
						status: "active",
						attempts: [],
					},
				],
			},
		],
		validationCommands: [],
		modelAssignment: {},
		createdAt: nowISO(),
	};
}

function buildMockPi(): {
	pi: ExtensionAPI;
	sentUserMessages: string[];
	sessionNames: string[];
	appendedEntries: Array<{ type: string; data: unknown }>;
	notifications: Array<{ message: string; type?: string }>;
	customCalls: Array<{ options?: { overlay?: boolean } }>;
	commands: Map<string, (args: string, ctx: unknown) => Promise<void>>;
	confirmResult: boolean;
} {
	const sentUserMessages: string[] = [];
	const sessionNames: string[] = [];
	const appendedEntries: Array<{ type: string; data: unknown }> = [];
	const notifications: Array<{ message: string; type?: string }> = [];
	const customCalls: Array<{ options?: { overlay?: boolean } }> = [];
	const commands = new Map<string, (args: string, ctx: unknown) => Promise<void>>();
	let confirmResult = false;

	const pi = {
		sendUserMessage: (content: string) => sentUserMessages.push(content),
		setSessionName: (name: string) => sessionNames.push(name),
		appendEntry: (type: string, data: unknown) => appendedEntries.push({ type, data }),
		registerCommand: (name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
			commands.set(name, options.handler);
		},
		registerTool: () => {},
		registerShortcut: () => {},
		registerFlag: () => {},
		getFlag: () => undefined,
		registerMessageRenderer: () => {},
		sendMessage: () => {},
		getSessionName: () => undefined,
		setLabel: () => {},
		exec: async () => ({ stdout: "", stderr: "", exitCode: 0, signal: null }),
		getActiveTools: () => [],
		getAllTools: () => [],
		setActiveTools: () => {},
		getCommands: () => [],
		setModel: async () => true,
		getThinkingLevel: () => "none",
		setThinkingLevel: () => {},
		on: () => {},
	} as unknown as ExtensionAPI;

	return {
		pi,
		sentUserMessages,
		sessionNames,
		appendedEntries,
		notifications,
		customCalls,
		commands,
		get confirmResult() {
			return confirmResult;
		},
		set confirmResult(v: boolean) {
			confirmResult = v;
		},
	};
}

async function runCommand(
	commands: Map<string, (args: string, ctx: unknown) => Promise<void>>,
	name: string,
	args: string,
	ctx: unknown,
): Promise<void> {
	const handler = commands.get(name);
	if (!handler) throw new Error(`Command '${name}' not registered`);
	await handler(args, ctx);
}

describe("registerCommands", () => {
	let tmpDir: string;
	let basePath: string;
	let updateWidget: ReturnType<typeof mock>;
	let clearWidget: ReturnType<typeof mock>;
	let deps: CommandDeps;
	let mockPi: ReturnType<typeof buildMockPi>;
	let ctx: unknown;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "pi-missions-test-"));
		basePath = join(tmpDir, ".pi", "missions");
		updateWidget = mock();
		clearWidget = mock();
		deps = { basePath, updateWidget, clearWidget };
		mockPi = buildMockPi();
		registerCommands(mockPi.pi, deps);
		ctx = {
			ui: mockPi.pi,
			...buildMockPi().pi,
		};
		// rebuild ctx to use the mockCtx we created inside buildMockPi
		ctx = {
			ui: {
				notify: (message: string, type?: string) => mockPi.notifications.push({ message, type }),
				confirm: async (_title: string, _message: string) => mockPi.confirmResult,
				input: async () => undefined,
				select: async () => undefined,
				setWidget: () => {},
				setStatus: () => {},
				setWorkingMessage: () => {},
				setHiddenThinkingLabel: () => {},
				onTerminalInput: () => () => {},
				setFooter: () => {},
				custom: async (_factory: unknown, options?: { overlay?: boolean }) => {
					mockPi.customCalls.push({ options });
				},
			},
			cwd: tmpdir(),
			hasUI: true,
		};
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("/mission", () => {
		it("shows idle status when no mission and no description (VAL-CMD-011)", async () => {
			await runCommand(mockPi.commands, "mission", "", ctx);
			expect(mockPi.notifications.length).toBe(1);
			expect(mockPi.notifications[0]!.message).toContain("No active mission");
			expect(mockPi.sentUserMessages.length).toBe(0);
		});

		it("shows status when mission is active and no description (VAL-CMD-011)", async () => {
			saveState(basePath, makePlanningState());
			await runCommand(mockPi.commands, "mission", "", ctx);
			expect(mockPi.notifications.length).toBe(1);
			expect(mockPi.notifications[0]!.message).toContain("planning");
			expect(mockPi.sentUserMessages.length).toBe(0);
		});

		it("shows status when whitespace-only description given (VAL-CMD-011)", async () => {
			saveState(basePath, makePlanningState());
			await runCommand(mockPi.commands, "mission", "   ", ctx);
			expect(mockPi.notifications.length).toBe(1);
			expect(mockPi.sentUserMessages.length).toBe(0);
		});

		it("starts a new mission when no mission exists (VAL-CMD-001)", async () => {
			await runCommand(mockPi.commands, "mission", "Build a CRM", ctx);

			expect(mockPi.sentUserMessages).toEqual(["Build a CRM"]);
			expect(mockPi.sessionNames).toContain("Build a CRM");
			expect(updateWidget).toHaveBeenCalled();
		});

		it("starts new mission when previous terminal mission exists (VAL-CMD-001)", async () => {
			saveState(basePath, makeCompletedState());
			await runCommand(mockPi.commands, "mission", "Build v2", ctx);
			expect(mockPi.sentUserMessages).toEqual(["Build v2"]);
		});

		it("starts new mission when failed mission exists (VAL-CMD-001)", async () => {
			saveState(basePath, makeFailedState());
			await runCommand(mockPi.commands, "mission", "Build v2", ctx);
			expect(mockPi.sentUserMessages).toEqual(["Build v2"]);
		});

		it("shows status when active mission exists (VAL-CMD-001)", async () => {
			saveState(basePath, makePlanningState());
			await runCommand(mockPi.commands, "mission", "Build a CRM", ctx);
			expect(mockPi.sentUserMessages.length).toBe(0);
			expect(mockPi.notifications[0]!.message).toContain("Mission already active");
		});

		it("sets session name on new mission start (VAL-CROSS-016)", async () => {
			await runCommand(mockPi.commands, "mission", "My Mission", ctx);
			expect(mockPi.sessionNames).toContain("My Mission");
		});

		it("persists state to filesystem on new mission start", async () => {
			await runCommand(mockPi.commands, "mission", "Build a CRM", ctx);
			const { loadState } = await import("../extensions/state/manager.js");
			const state = loadState(basePath);
			expect(state).toBeTruthy();
			expect(state?.status).toBe("planning");
		});
	});

	describe("/mission-approve", () => {
		it("transitions draft_review to approved (VAL-CMD-002)", async () => {
			saveState(basePath, makeDraftReviewState());
			savePlan(basePath, makeMinimalPlan());

			await runCommand(mockPi.commands, "mission-approve", "", ctx);

			const { loadState, loadPlan } = await import("../extensions/state/manager.js");
			const state = loadState(basePath);
			const plan = loadPlan(basePath);
			expect(state?.status).toBe("approved");
			expect(plan?.approvedAt).toBeTruthy();
		});

		it("logs plan-approved mutation (VAL-CMD-002)", async () => {
			saveState(basePath, makeDraftReviewState());
			savePlan(basePath, makeMinimalPlan());

			await runCommand(mockPi.commands, "mission-approve", "", ctx);

			const history = readHistory(basePath);
			const approvedMutation = history.find((m) => m.kind === "plan-approved");
			expect(approvedMutation).toBeTruthy();
			expect(approvedMutation?.actor).toBe("user");
		});

		it("sends approval message to orchestrator (VAL-CMD-002)", async () => {
			saveState(basePath, makeDraftReviewState());
			savePlan(basePath, makeMinimalPlan());

			await runCommand(mockPi.commands, "mission-approve", "", ctx);

			expect(mockPi.sentUserMessages.length).toBeGreaterThan(0);
			expect(mockPi.sentUserMessages[0]).toContain("approved");
		});

		it("rejects when not in draft_review state (VAL-CMD-002, VAL-CMD-009)", async () => {
			saveState(basePath, makePlanningState());
			await runCommand(mockPi.commands, "mission-approve", "", ctx);
			expect(mockPi.notifications[0]!.type).toBe("error");
			expect(mockPi.sentUserMessages.length).toBe(0);
		});

		it("rejects when executing (VAL-CMD-009)", async () => {
			saveState(basePath, makeExecutingState());
			await runCommand(mockPi.commands, "mission-approve", "", ctx);
			expect(mockPi.notifications[0]!.type).toBe("error");
		});

		it("returns error when no state", async () => {
			await runCommand(mockPi.commands, "mission-approve", "", ctx);
			expect(mockPi.notifications[0]!.type).toBe("error");
		});

		it("updates widget on success", async () => {
			saveState(basePath, makeDraftReviewState());
			savePlan(basePath, makeMinimalPlan());
			await runCommand(mockPi.commands, "mission-approve", "", ctx);
			expect(updateWidget).toHaveBeenCalled();
		});
	});

	describe("/mission-pause", () => {
		it("pauses from executing state (VAL-CMD-003)", async () => {
			saveState(basePath, makeExecutingState());
			await runCommand(mockPi.commands, "mission-pause", "", ctx);

			const { loadState } = await import("../extensions/state/manager.js");
			const state = loadState(basePath);
			expect(state?.status).toBe("paused");
			expect(state?.resumeTargetState).toBe("executing");
		});

		it("pauses from planning state (VAL-CMD-003)", async () => {
			saveState(basePath, makePlanningState());
			await runCommand(mockPi.commands, "mission-pause", "", ctx);

			const { loadState } = await import("../extensions/state/manager.js");
			const state = loadState(basePath);
			expect(state?.status).toBe("paused");
			expect(state?.resumeTargetState).toBe("planning");
		});

		it("pauses from draft_review state (VAL-CMD-003)", async () => {
			saveState(basePath, makeDraftReviewState());
			await runCommand(mockPi.commands, "mission-pause", "", ctx);

			const { loadState } = await import("../extensions/state/manager.js");
			const state = loadState(basePath);
			expect(state?.status).toBe("paused");
			expect(state?.resumeTargetState).toBe("draft_review");
		});

		it("pauses from validating state (VAL-CMD-003)", async () => {
			saveState(basePath, makeValidatingState());
			await runCommand(mockPi.commands, "mission-pause", "", ctx);

			const { loadState } = await import("../extensions/state/manager.js");
			const state = loadState(basePath);
			expect(state?.status).toBe("paused");
			expect(state?.resumeTargetState).toBe("validating");
		});

		it("rejects from idle (no state) (VAL-CMD-003)", async () => {
			await runCommand(mockPi.commands, "mission-pause", "", ctx);
			expect(mockPi.notifications[0]!.type).toBe("error");
		});

		it("rejects from completed state (VAL-CMD-003, VAL-CMD-009)", async () => {
			saveState(basePath, makeCompletedState());
			await runCommand(mockPi.commands, "mission-pause", "", ctx);
			expect(mockPi.notifications[0]!.type).toBe("error");

			const { loadState } = await import("../extensions/state/manager.js");
			const state = loadState(basePath);
			expect(state?.status).toBe("completed");
		});

		it("rejects from already paused state (VAL-CMD-003)", async () => {
			saveState(basePath, makePausedState("executing"));
			await runCommand(mockPi.commands, "mission-pause", "", ctx);
			expect(mockPi.notifications[0]!.type).toBe("error");
		});

		it("updates widget on success", async () => {
			saveState(basePath, makeExecutingState());
			await runCommand(mockPi.commands, "mission-pause", "", ctx);
			expect(updateWidget).toHaveBeenCalled();
		});
	});

	describe("/mission-resume", () => {
		it("resumes from paused to executing (VAL-CMD-004)", async () => {
			saveState(basePath, makePausedState("executing"));
			await runCommand(mockPi.commands, "mission-resume", "", ctx);

			const { loadState } = await import("../extensions/state/manager.js");
			const state = loadState(basePath);
			expect(state?.status).toBe("executing");
			expect(state?.resumeTargetState).toBeUndefined();
		});

		it("resumes from paused to planning (VAL-CMD-004)", async () => {
			saveState(basePath, makePausedState("planning"));
			await runCommand(mockPi.commands, "mission-resume", "", ctx);

			const { loadState } = await import("../extensions/state/manager.js");
			const state = loadState(basePath);
			expect(state?.status).toBe("planning");
		});

		it("sends resume message to orchestrator (VAL-CMD-004)", async () => {
			saveState(basePath, makePausedState("executing"));
			await runCommand(mockPi.commands, "mission-resume", "", ctx);
			expect(mockPi.sentUserMessages.length).toBeGreaterThan(0);
			expect(mockPi.sentUserMessages[0]).toContain("resumed");
		});

		it("rejects from non-paused state (VAL-CMD-004)", async () => {
			saveState(basePath, makeExecutingState());
			await runCommand(mockPi.commands, "mission-resume", "", ctx);
			expect(mockPi.notifications[0]!.type).toBe("error");
			expect(mockPi.sentUserMessages.length).toBe(0);
		});

		it("rejects when no state", async () => {
			await runCommand(mockPi.commands, "mission-resume", "", ctx);
			expect(mockPi.notifications[0]!.type).toBe("error");
		});

		it("updates widget on success", async () => {
			saveState(basePath, makePausedState("executing"));
			await runCommand(mockPi.commands, "mission-resume", "", ctx);
			expect(updateWidget).toHaveBeenCalled();
		});
	});

	describe("/mission-skip", () => {
		it("skips current feature in executing state (VAL-CMD-005)", async () => {
			saveState(basePath, makeExecutingState("f1"));
			savePlan(basePath, makeMinimalPlan());

			await runCommand(mockPi.commands, "mission-skip", "", ctx);

			const { loadState, loadPlan } = await import("../extensions/state/manager.js");
			const state = loadState(basePath);
			const plan = loadPlan(basePath);
			expect(state?.totalFeaturesSkipped).toBe(1);
			expect(state?.currentFeatureId).toBeUndefined();
			const feature = plan?.milestones[0]?.features[0];
			expect(feature?.status).toBe("skipped");
		});

		it("appends feature_skipped progress event (VAL-CMD-005)", async () => {
			saveState(basePath, makeExecutingState("f1"));
			savePlan(basePath, makeMinimalPlan());

			await runCommand(mockPi.commands, "mission-skip", "", ctx);

			const { loadState } = await import("../extensions/state/manager.js");
			const state = loadState(basePath);
			const event = state?.progressLog.find((e) => e.type === "feature_skipped");
			expect(event).toBeTruthy();
		});

		it("informs orchestrator of skip (VAL-CMD-005)", async () => {
			saveState(basePath, makeExecutingState("f1"));
			savePlan(basePath, makeMinimalPlan());

			await runCommand(mockPi.commands, "mission-skip", "", ctx);

			expect(mockPi.sentUserMessages.length).toBeGreaterThan(0);
			expect(mockPi.sentUserMessages[0]).toContain("skipped");
		});

		it("rejects when no currentFeatureId (VAL-CMD-005)", async () => {
			saveState(basePath, makeExecutingState());
			await runCommand(mockPi.commands, "mission-skip", "", ctx);
			expect(mockPi.notifications[0]!.type).toBe("error");
		});

		it("rejects in non-executing state (VAL-CMD-009)", async () => {
			saveState(basePath, makePlanningState());
			await runCommand(mockPi.commands, "mission-skip", "", ctx);
			expect(mockPi.notifications[0]!.type).toBe("error");
		});

		it("rejects when no state", async () => {
			await runCommand(mockPi.commands, "mission-skip", "", ctx);
			expect(mockPi.notifications[0]!.type).toBe("error");
		});

		it("updates widget on success", async () => {
			saveState(basePath, makeExecutingState("f1"));
			savePlan(basePath, makeMinimalPlan());
			await runCommand(mockPi.commands, "mission-skip", "", ctx);
			expect(updateWidget).toHaveBeenCalled();
		});
	});

	describe("/mission-reset", () => {
		it("requires confirmation before resetting (VAL-CMD-010)", async () => {
			mockPi.confirmResult = false;
			saveState(basePath, makeExecutingState());

			await runCommand(mockPi.commands, "mission-reset", "", ctx);

			const { loadState } = await import("../extensions/state/manager.js");
			const state = loadState(basePath);
			expect(state).toBeTruthy();
		});

		it("clears mission state when confirmed (VAL-CMD-006)", async () => {
			mockPi.confirmResult = true;
			saveState(basePath, makeExecutingState());

			await runCommand(mockPi.commands, "mission-reset", "", ctx);

			const { loadState } = await import("../extensions/state/manager.js");
			const state = loadState(basePath);
			expect(state).toBeNull();
		});

		it("appends null session entry to prevent stale restore (VAL-CMD-006)", async () => {
			mockPi.confirmResult = true;
			await runCommand(mockPi.commands, "mission-reset", "", ctx);
			const nullEntry = mockPi.appendedEntries.find((e) => e.type === "mission-state-cache" && e.data === null);
			expect(nullEntry).toBeTruthy();
		});

		it("clears session name on reset (VAL-CROSS-016)", async () => {
			mockPi.confirmResult = true;
			await runCommand(mockPi.commands, "mission-reset", "", ctx);
			expect(mockPi.sessionNames).toContain("");
		});

		it("calls clearWidget on reset (VAL-CMD-006)", async () => {
			mockPi.confirmResult = true;
			await runCommand(mockPi.commands, "mission-reset", "", ctx);
			expect(clearWidget).toHaveBeenCalled();
		});

		it("works from any state without error (VAL-CMD-006)", async () => {
			mockPi.confirmResult = true;
			saveState(basePath, makeCompletedState());
			const act = () => runCommand(mockPi.commands, "mission-reset", "", ctx);
			await expect(act()).resolves.toBeUndefined();
		});

		it("works when .pi/missions does not exist (VAL-CMD-006)", async () => {
			mockPi.confirmResult = true;
			const act = () => runCommand(mockPi.commands, "mission-reset", "", ctx);
			await expect(act()).resolves.toBeUndefined();
		});
	});

	describe("/mission-status", () => {
		it("shows no mission message when idle (VAL-CMD-007)", async () => {
			await runCommand(mockPi.commands, "mission-status", "", ctx);
			expect(mockPi.notifications[0]!.message).toContain("No active mission");
			expect(mockPi.customCalls.length).toBe(0);
		});

		it("opens TUI overlay when mission exists (VAL-CMD-007, VAL-NEWUI-004)", async () => {
			saveState(basePath, makePlanningState());
			await runCommand(mockPi.commands, "mission-status", "", ctx);
			expect(mockPi.customCalls.length).toBe(1);
			expect(mockPi.customCalls[0]!.options?.overlay).toBe(true);
			expect(mockPi.notifications.length).toBe(0);
		});

		it("opens overlay for executing state (VAL-CMD-007, VAL-NEWUI-004)", async () => {
			saveState(basePath, makeExecutingState("f1"));
			savePlan(basePath, makeMinimalPlan());
			await runCommand(mockPi.commands, "mission-status", "", ctx);
			expect(mockPi.customCalls.length).toBe(1);
			expect(mockPi.customCalls[0]!.options?.overlay).toBe(true);
		});

		it("opens overlay for paused state (VAL-CMD-007, VAL-NEWUI-004)", async () => {
			saveState(basePath, makePausedState("executing"));
			await runCommand(mockPi.commands, "mission-status", "", ctx);
			expect(mockPi.customCalls.length).toBe(1);
			expect(mockPi.customCalls[0]!.options?.overlay).toBe(true);
		});

		it("opens overlay for completed state (VAL-CMD-007, VAL-NEWUI-004)", async () => {
			const state = makeCompletedState();
			state.totalFeaturesCompleted = 5;
			state.totalFeaturesSkipped = 1;
			state.totalFeaturesFailed = 0;
			saveState(basePath, state);
			await runCommand(mockPi.commands, "mission-status", "", ctx);
			expect(mockPi.customCalls.length).toBe(1);
			expect(mockPi.customCalls[0]!.options?.overlay).toBe(true);
		});
	});

	describe("/mission-plan", () => {
		it("shows no plan message when no plan exists (VAL-CMD-008)", async () => {
			saveState(basePath, makeDraftReviewState());
			await runCommand(mockPi.commands, "mission-plan", "", ctx);
			expect(mockPi.notifications[0]!.message).toContain("No plan");
			expect(mockPi.customCalls.length).toBe(0);
		});

		it("opens TUI overlay when plan exists (VAL-CMD-008, VAL-NEWUI-005)", async () => {
			saveState(basePath, makeDraftReviewState());
			savePlan(basePath, makeMinimalPlan());
			await runCommand(mockPi.commands, "mission-plan", "", ctx);
			expect(mockPi.customCalls.length).toBe(1);
			expect(mockPi.customCalls[0]!.options?.overlay).toBe(true);
			expect(mockPi.notifications.length).toBe(0);
		});

		it("accessible from draft_review state (VAL-CMD-008, VAL-CMD-009)", async () => {
			saveState(basePath, makeDraftReviewState());
			savePlan(basePath, makeMinimalPlan());
			await runCommand(mockPi.commands, "mission-plan", "", ctx);
			expect(mockPi.customCalls.length).toBe(1);
			expect(mockPi.notifications.filter((n) => n.type === "error").length).toBe(0);
		});

		it("accessible from approved state (VAL-CMD-009)", async () => {
			saveState(basePath, makeApprovedState());
			savePlan(basePath, makeMinimalPlan());
			await runCommand(mockPi.commands, "mission-plan", "", ctx);
			expect(mockPi.customCalls.length).toBe(1);
			expect(mockPi.notifications.filter((n) => n.type === "error").length).toBe(0);
		});

		it("accessible from executing state (VAL-CMD-009)", async () => {
			saveState(basePath, makeExecutingState());
			savePlan(basePath, makeMinimalPlan());
			await runCommand(mockPi.commands, "mission-plan", "", ctx);
			expect(mockPi.customCalls.length).toBe(1);
			expect(mockPi.notifications.filter((n) => n.type === "error").length).toBe(0);
		});

		it("accessible from paused state (VAL-CMD-009)", async () => {
			saveState(basePath, makePausedState("executing"));
			savePlan(basePath, makeMinimalPlan());
			await runCommand(mockPi.commands, "mission-plan", "", ctx);
			expect(mockPi.customCalls.length).toBe(1);
			expect(mockPi.notifications.filter((n) => n.type === "error").length).toBe(0);
		});

		it("rejects from planning state (VAL-CMD-009)", async () => {
			saveState(basePath, makePlanningState());
			await runCommand(mockPi.commands, "mission-plan", "", ctx);
			expect(mockPi.notifications[0]!.type).toBe("error");
			expect(mockPi.customCalls.length).toBe(0);
		});

		it("rejects when no mission state", async () => {
			await runCommand(mockPi.commands, "mission-plan", "", ctx);
			expect(mockPi.notifications[0]!.message).toContain("No active mission");
			expect(mockPi.customCalls.length).toBe(0);
		});
	});

	describe("command state gating (VAL-CMD-009)", () => {
		it("idle: only /mission allowed", async () => {
			for (const cmd of ["mission-approve", "mission-pause", "mission-resume", "mission-skip"]) {
				mockPi.notifications.length = 0;
				await runCommand(mockPi.commands, cmd, "", ctx);
				expect(mockPi.notifications[0]!.type).toBe("error");
			}
		});

		it("planning: mission-approve not allowed", async () => {
			saveState(basePath, makePlanningState());
			await runCommand(mockPi.commands, "mission-approve", "", ctx);
			expect(mockPi.notifications[0]!.type).toBe("error");
		});

		it("planning: mission-resume not allowed", async () => {
			saveState(basePath, makePlanningState());
			await runCommand(mockPi.commands, "mission-resume", "", ctx);
			expect(mockPi.notifications[0]!.type).toBe("error");
		});

		it("planning: mission-skip not allowed", async () => {
			saveState(basePath, makePlanningState());
			await runCommand(mockPi.commands, "mission-skip", "", ctx);
			expect(mockPi.notifications[0]!.type).toBe("error");
		});

		it("executing: mission-approve not allowed", async () => {
			saveState(basePath, makeExecutingState());
			await runCommand(mockPi.commands, "mission-approve", "", ctx);
			expect(mockPi.notifications[0]!.type).toBe("error");
		});

		it("executing: mission-resume not allowed", async () => {
			saveState(basePath, makeExecutingState());
			await runCommand(mockPi.commands, "mission-resume", "", ctx);
			expect(mockPi.notifications[0]!.type).toBe("error");
		});

		it("completed: mission-skip not allowed", async () => {
			saveState(basePath, makeCompletedState());
			await runCommand(mockPi.commands, "mission-skip", "", ctx);
			expect(mockPi.notifications[0]!.type).toBe("error");
		});

		it("validating: mission-skip not allowed", async () => {
			saveState(basePath, makeValidatingState());
			await runCommand(mockPi.commands, "mission-skip", "", ctx);
			expect(mockPi.notifications[0]!.type).toBe("error");
		});

		it("paused: mission-approve not allowed", async () => {
			saveState(basePath, makePausedState("executing"));
			await runCommand(mockPi.commands, "mission-approve", "", ctx);
			expect(mockPi.notifications[0]!.type).toBe("error");
		});

		it("paused: mission-skip not allowed", async () => {
			saveState(basePath, makePausedState("executing"));
			await runCommand(mockPi.commands, "mission-skip", "", ctx);
			expect(mockPi.notifications[0]!.type).toBe("error");
		});
	});

	describe("pause/resume round-trip", () => {
		it("pause from executing then resume restores executing state", async () => {
			saveState(basePath, makeExecutingState());

			await runCommand(mockPi.commands, "mission-pause", "", ctx);
			await runCommand(mockPi.commands, "mission-resume", "", ctx);

			const { loadState } = await import("../extensions/state/manager.js");
			const state = loadState(basePath);
			expect(state?.status).toBe("executing");
			expect(state?.resumeTargetState).toBeUndefined();
		});

		it("pause/resume appends both progress events", async () => {
			saveState(basePath, makeExecutingState());

			await runCommand(mockPi.commands, "mission-pause", "", ctx);
			await runCommand(mockPi.commands, "mission-resume", "", ctx);

			const { loadState } = await import("../extensions/state/manager.js");
			const state = loadState(basePath);
			const pauseEvent = state?.progressLog.find((e) => e.type === "pause");
			const resumeEvent = state?.progressLog.find((e) => e.type === "resume");
			expect(pauseEvent).toBeTruthy();
			expect(resumeEvent).toBeTruthy();
		});
	});
});
