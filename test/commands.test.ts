import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { type CommandDeps, registerCommands } from "../extensions/commands.js";
import { saveState } from "../extensions/state/manager.js";
import type { MissionState } from "../extensions/types.js";

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

function makeCompletedState(): MissionState {
	return { ...makePlanningState(), status: "completed", completedAt: new Date().toISOString() };
}

function buildMockPi(): {
	pi: ExtensionAPI;
	notifications: Array<{ message: string; type?: string }>;
	commands: Map<string, (args: string, ctx: unknown) => Promise<void>>;
	confirmResult: boolean;
} {
	const notifications: Array<{ message: string; type?: string }> = [];
	const commands = new Map<string, (args: string, ctx: unknown) => Promise<void>>();
	let confirmResult = false;

	const pi = {
		sendUserMessage: () => {},
		setSessionName: () => {},
		appendEntry: () => {},
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
		notifications,
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
	let onActivate: ReturnType<typeof mock>;
	let onDeactivate: ReturnType<typeof mock>;
	let missionModeActive: boolean;
	let deps: CommandDeps;
	let mockPi: ReturnType<typeof buildMockPi>;
	let ctx: unknown;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "pi-missions-test-"));
		basePath = join(tmpDir, ".pi", "missions");
		updateWidget = mock();
		clearWidget = mock();
		onActivate = mock();
		onDeactivate = mock();
		missionModeActive = false;
		deps = {
			basePath,
			updateWidget,
			clearWidget,
			isMissionModeActive: () => missionModeActive,
			setMissionModeActive: (active: boolean) => {
				missionModeActive = active;
			},
			onActivate,
			onDeactivate,
		};
		mockPi = buildMockPi();
		registerCommands(mockPi.pi, deps);
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
				custom: async () => {},
			},
			cwd: tmpdir(),
			hasUI: true,
		};
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("registers only mission-mode command", () => {
		expect(mockPi.commands.has("mission-mode")).toBe(true);
		expect(mockPi.commands.size).toBe(1);
	});

	describe("/mission-mode", () => {
		it("activates mission mode when inactive", async () => {
			await runCommand(mockPi.commands, "mission-mode", "", ctx);
			expect(missionModeActive).toBe(true);
			expect(onActivate).toHaveBeenCalled();
			expect(mockPi.notifications[0]!.message).toContain("activated");
		});

		it("deactivates mission mode when active and no mission running", async () => {
			missionModeActive = true;
			await runCommand(mockPi.commands, "mission-mode", "", ctx);
			expect(missionModeActive).toBe(false);
			expect(onDeactivate).toHaveBeenCalled();
			expect(mockPi.notifications[0]!.message).toContain("deactivated");
		});

		it("prompts confirmation when deactivating with active mission", async () => {
			missionModeActive = true;
			saveState(basePath, makePlanningState());
			mockPi.confirmResult = false;
			await runCommand(mockPi.commands, "mission-mode", "", ctx);
			expect(missionModeActive).toBe(true);
			expect(onDeactivate).not.toHaveBeenCalled();
		});

		it("deactivates when user confirms with active mission", async () => {
			missionModeActive = true;
			saveState(basePath, makePlanningState());
			mockPi.confirmResult = true;
			await runCommand(mockPi.commands, "mission-mode", "", ctx);
			expect(missionModeActive).toBe(false);
			expect(onDeactivate).toHaveBeenCalled();
		});

		it("does not prompt confirmation for completed missions", async () => {
			missionModeActive = true;
			saveState(basePath, makeCompletedState());
			await runCommand(mockPi.commands, "mission-mode", "", ctx);
			expect(missionModeActive).toBe(false);
			expect(onDeactivate).toHaveBeenCalled();
		});

		it("toggles on then off", async () => {
			await runCommand(mockPi.commands, "mission-mode", "", ctx);
			expect(missionModeActive).toBe(true);
			await runCommand(mockPi.commands, "mission-mode", "", ctx);
			expect(missionModeActive).toBe(false);
		});
	});
});
