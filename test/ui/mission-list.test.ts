import { describe, expect, it } from "bun:test";
import type { MissionRegistryEntry } from "../../extensions/state/registry.js";
import { handleMissionListKey, initialMissionListState, renderMissionList } from "../../extensions/ui/mission-list.js";

function makeEntry(overrides: Partial<MissionRegistryEntry> = {}): MissionRegistryEntry {
	return {
		missionId: "m1",
		status: "completed",
		description: "Test mission",
		projectPath: "/test/project",
		startedAt: new Date(Date.now() - 3600_000).toISOString(),
		updatedAt: new Date(Date.now() - 1800_000).toISOString(),
		featuresTotal: 10,
		featuresCompleted: 8,
		...overrides,
	};
}

describe("renderMissionList", () => {
	it("renders with no entries", () => {
		const state = initialMissionListState();
		const lines = renderMissionList([], "/test", state, 80, 20);
		expect(lines.length).toBeGreaterThan(0);
		const joined = lines.join("\n");
		expect(joined).toContain("Begin new mission");
		expect(joined).toContain("No missions yet");
	});

	it("renders with entries", () => {
		const entries = [makeEntry(), makeEntry({ missionId: "m2", description: "Another mission" })];
		const state = initialMissionListState();
		const lines = renderMissionList(entries, "/test", state, 120, 20);
		const joined = lines.join("\n");
		expect(joined).toContain("Begin new mission");
		expect(joined).toContain("Test mission");
		expect(joined).toContain("Another mission");
	});

	it("highlights current project entry with dot", () => {
		const entries = [makeEntry({ projectPath: "/current" })];
		const state = initialMissionListState();
		const lines = renderMissionList(entries, "/current", state, 120, 20);
		const joined = lines.join("\n");
		expect(joined).toContain("●");
	});

	it("does not show dot for other project entries", () => {
		const entries = [makeEntry({ projectPath: "/other" })];
		const state = initialMissionListState();
		const lines = renderMissionList(entries, "/current", state, 120, 20);
		const joined = lines.join("\n");
		expect(joined).not.toContain("●");
	});

	it("uses panel with bordered structure", () => {
		const state = initialMissionListState();
		const lines = renderMissionList([], "/test", state, 80, 20);
		const joined = lines.join("\n");
		expect(joined).toContain("Missions");
		expect(joined).toContain("Mission List");
		expect(joined).toContain("\u2502");
	});

	it("uses section header for mission count", () => {
		const entries = [makeEntry(), makeEntry({ missionId: "m2" })];
		const state = initialMissionListState();
		const lines = renderMissionList(entries, "/test", state, 120, 20);
		const joined = lines.join("\n");
		expect(joined).toContain("2 missions");
	});

	it("uses column separators in table", () => {
		const entries = [makeEntry()];
		const state = initialMissionListState();
		const lines = renderMissionList(entries, "/test", state, 120, 20);
		const joined = lines.join("\n");
		expect(joined).toContain("\u253c");
	});

	it("shortens home directory paths", () => {
		const home = require("node:os").homedir();
		const entries = [makeEntry({ projectPath: `${home}/projects/test` })];
		const state = initialMissionListState();
		const lines = renderMissionList(entries, "/test", state, 120, 20);
		const joined = lines.join("\n");
		expect(joined).toContain("~/projects/test");
		expect(joined).not.toContain(home);
	});
});

describe("handleMissionListKey", () => {
	it("escape returns close action", () => {
		const state = initialMissionListState();
		const { action } = handleMissionListKey("\x1B", state, 3);
		expect(action.kind).toBe("close");
	});

	it("enter on index 0 returns new_mission", () => {
		const state = initialMissionListState();
		const { action } = handleMissionListKey("\r", state, 3);
		expect(action.kind).toBe("new_mission");
	});

	it("arrow down moves highlight", () => {
		const state = initialMissionListState();
		const { nextState } = handleMissionListKey("\x1B[B", state, 3);
		expect(nextState.highlightedIndex).toBe(1);
	});

	it("arrow up does not go below 0", () => {
		const state = initialMissionListState();
		const { nextState } = handleMissionListKey("\x1B[A", state, 3);
		expect(nextState.highlightedIndex).toBe(0);
	});

	it("typing updates search query", () => {
		const state = initialMissionListState();
		const { nextState: s1 } = handleMissionListKey("t", state, 3);
		expect(s1.searchQuery).toBe("t");
		const { nextState: s2 } = handleMissionListKey("e", s1, 3);
		expect(s2.searchQuery).toBe("te");
	});

	it("backspace removes from search query", () => {
		const state = { ...initialMissionListState(), searchQuery: "test" };
		const { nextState } = handleMissionListKey("\x7F", state, 3);
		expect(nextState.searchQuery).toBe("tes");
	});
});
