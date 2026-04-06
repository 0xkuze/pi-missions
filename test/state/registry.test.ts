import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	loadRegistry,
	removeFromRegistry,
	setRegistryPathForTesting,
	updateRegistry,
} from "../../extensions/state/registry.js";
import type { MissionState } from "../../extensions/types.js";

function makeState(overrides: Partial<MissionState> = {}): MissionState {
	return {
		missionId: "m1",
		status: "executing",
		progressLog: [],
		startedAt: "2024-01-01T00:00:00Z",
		totalFeaturesCompleted: 0,
		totalFeaturesFailed: 0,
		totalFeaturesSkipped: 0,
		totalFixFeaturesCreated: 0,
		...overrides,
	} as MissionState;
}

function makePlan() {
	return {
		id: "p1",
		description: "Test mission",
		planVersion: 1,
		milestones: [
			{
				id: "ms1",
				name: "M1",
				description: "",
				features: [
					{
						id: "f1",
						name: "F1",
						description: "",
						acceptanceCriteria: [],
						relevantFiles: [],
						dependencies: [],
						estimatedComplexity: "low" as const,
						status: "done" as const,
						attempts: [],
					},
					{
						id: "f2",
						name: "F2",
						description: "",
						acceptanceCriteria: [],
						relevantFiles: [],
						dependencies: [],
						estimatedComplexity: "low" as const,
						status: "pending" as const,
						attempts: [],
					},
				],
				status: "active" as const,
			},
		],
		validationCommands: [],
		modelAssignment: {},
		createdAt: "2024-01-01T00:00:00Z",
	};
}

describe("mission registry", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "pi-registry-test-"));
		setRegistryPathForTesting(join(tmpDir, "registry.json"));
	});

	afterEach(() => {
		setRegistryPathForTesting(null);
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("loadRegistry returns empty array when no file exists", () => {
		const entries = loadRegistry();
		expect(entries).toEqual([]);
	});

	it("updateRegistry creates entry and loadRegistry retrieves it", () => {
		const state = makeState({ totalFeaturesCompleted: 2 });
		const plan = makePlan();
		updateRegistry(state, "/test/project", plan);

		const entries = loadRegistry();
		expect(entries.length).toBe(1);
		expect(entries[0]!.missionId).toBe("m1");
		expect(entries[0]!.description).toBe("Test mission");
		expect(entries[0]!.projectPath).toBe("/test/project");
		expect(entries[0]!.featuresTotal).toBe(2);
		expect(entries[0]!.featuresCompleted).toBe(2);
	});

	it("updateRegistry updates existing entry by missionId", () => {
		updateRegistry(makeState(), "/test/project");
		updateRegistry(makeState({ status: "completed", totalFeaturesCompleted: 3 }), "/test/project");

		const entries = loadRegistry();
		expect(entries.length).toBe(1);
		expect(entries[0]!.status).toBe("completed");
		expect(entries[0]!.featuresCompleted).toBe(3);
	});

	it("updateRegistry adds multiple entries for different missions", () => {
		updateRegistry(makeState({ missionId: "m1" }), "/project1");
		updateRegistry(makeState({ missionId: "m2" }), "/project2");

		const entries = loadRegistry();
		expect(entries.length).toBe(2);
	});

	it("new entries are prepended", () => {
		updateRegistry(makeState({ missionId: "m1" }), "/project1");
		updateRegistry(makeState({ missionId: "m2" }), "/project2");

		const entries = loadRegistry();
		expect(entries[0]!.missionId).toBe("m2");
		expect(entries[1]!.missionId).toBe("m1");
	});

	it("removeFromRegistry removes entry by missionId", () => {
		updateRegistry(makeState(), "/test/project");
		expect(loadRegistry().length).toBe(1);

		removeFromRegistry("m1");
		expect(loadRegistry().length).toBe(0);
	});

	it("removeFromRegistry is no-op for unknown missionId", () => {
		updateRegistry(makeState(), "/test/project");
		removeFromRegistry("unknown");
		expect(loadRegistry().length).toBe(1);
	});

	it("updateRegistry without plan stores empty description", () => {
		updateRegistry(makeState(), "/test/project");
		const entries = loadRegistry();
		expect(entries[0]!.description).toBe("");
		expect(entries[0]!.featuresTotal).toBe(0);
	});
});
