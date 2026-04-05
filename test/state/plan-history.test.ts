import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { savePlan } from "../../extensions/state/manager.js";
import { appendMutation, readHistory } from "../../extensions/state/plan-history.js";
import type { Feature, PlanMutation } from "../../extensions/types.js";
import type { TempDir } from "../helpers/index.js";
import { createTempDir, makeFeature, makeMilestone, makePlan } from "../helpers/index.js";

let tmp: TempDir;

function makeTmpDir(): string {
	const dir = join(tmp.path, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function makeMutation(planVersion: number, kind: PlanMutation["kind"] = "plan-created"): PlanMutation {
	return {
		planVersion,
		timestamp: `2024-01-01T00:0${planVersion}:00.000Z`,
		actor: "orchestrator",
		kind,
		summary: `mutation ${planVersion}`,
		payload: {},
	};
}

beforeEach(() => {
	tmp = createTempDir("pi-missions-plan-history-");
});

afterEach(() => {
	tmp.cleanup();
});

describe("readHistory", () => {
	it("returns empty array when no file exists", () => {
		const dir = makeTmpDir();
		expect(readHistory(dir)).toEqual([]);
	});

	it("returns mutations in order after appending", () => {
		const dir = makeTmpDir();
		const m1 = makeMutation(1);
		const m2 = makeMutation(2, "plan-approved");
		const m3 = makeMutation(3, "add-feature");
		appendMutation(dir, m1);
		appendMutation(dir, m2);
		appendMutation(dir, m3);
		const history = readHistory(dir);
		expect(history).toHaveLength(3);
		expect(history[0]).toEqual(m1);
		expect(history[1]).toEqual(m2);
		expect(history[2]).toEqual(m3);
	});

	it("returns single mutation correctly", () => {
		const dir = makeTmpDir();
		const m = makeMutation(1);
		appendMutation(dir, m);
		expect(readHistory(dir)).toEqual([m]);
	});

	it("skips corrupted trailing line without blocking new appends", () => {
		const dir = makeTmpDir();
		const m1 = makeMutation(1);
		appendMutation(dir, m1);

		appendFileSync(join(dir, "plan-history.jsonl"), "{ corrupted json\n", "utf8");

		const history = readHistory(dir);
		expect(history).toHaveLength(1);
		expect(history[0]).toEqual(m1);

		const m2 = makeMutation(2, "plan-approved");
		appendMutation(dir, m2);
		const updated = readHistory(dir);
		expect(updated).toHaveLength(2);
		expect(updated[1]).toEqual(m2);
	});

	it("skips corrupted lines and returns valid ones", () => {
		const dir = makeTmpDir();
		const file = join(dir, "plan-history.jsonl");
		mkdirSync(dir, { recursive: true });
		const m1 = makeMutation(1);
		writeFileSync(file, `${JSON.stringify(m1)}\n{ bad json\n`, "utf8");
		const history = readHistory(dir);
		expect(history).toHaveLength(1);
		expect(history[0]).toEqual(m1);
	});

	it("preserves all mutation fields", () => {
		const dir = makeTmpDir();
		const mutation: PlanMutation = {
			planVersion: 1,
			timestamp: "2024-06-15T12:34:56.789Z",
			actor: "user",
			kind: "add-milestone",
			summary: "Added milestone Foundation",
			payload: { milestoneId: "m1", name: "Foundation" },
		};
		appendMutation(dir, mutation);
		expect(readHistory(dir)[0]).toEqual(mutation);
	});
});

describe("appendMutation", () => {
	it("writes one JSON line per call", () => {
		const dir = makeTmpDir();
		appendMutation(dir, makeMutation(1));
		appendMutation(dir, makeMutation(2));
		appendMutation(dir, makeMutation(3));
		const history = readHistory(dir);
		expect(history).toHaveLength(3);
	});

	it("creates the file on first use", () => {
		const dir = makeTmpDir();
		expect(existsSync(join(dir, "plan-history.jsonl"))).toBe(false);
		appendMutation(dir, makeMutation(1));
		expect(existsSync(join(dir, "plan-history.jsonl"))).toBe(true);
	});

	it("creates parent directory on first use", () => {
		const dir = join(tmp.path, "deeply", "nested", "new-dir");
		expect(existsSync(dir)).toBe(false);
		appendMutation(dir, makeMutation(1));
		expect(existsSync(join(dir, "plan-history.jsonl"))).toBe(true);
	});

	it("throws when planVersion does not increment (same version)", () => {
		const dir = makeTmpDir();
		appendMutation(dir, makeMutation(1));
		expect(() => appendMutation(dir, makeMutation(1))).toThrow(/monotonically/);
	});

	it("throws when planVersion goes backwards", () => {
		const dir = makeTmpDir();
		appendMutation(dir, makeMutation(5));
		expect(() => appendMutation(dir, makeMutation(3))).toThrow(/monotonically/);
	});

	it("allows planVersion 1 as first mutation", () => {
		const dir = makeTmpDir();
		expect(() => appendMutation(dir, makeMutation(1))).not.toThrow();
	});

	it("allows non-consecutive planVersion increments", () => {
		const dir = makeTmpDir();
		appendMutation(dir, makeMutation(1));
		expect(() => appendMutation(dir, makeMutation(5))).not.toThrow();
	});

	it("mutation includes timestamp in ISO 8601 format", () => {
		const dir = makeTmpDir();
		const timestamp = "2024-06-15T12:34:56.789Z";
		const m = { ...makeMutation(1), timestamp };
		appendMutation(dir, m);
		expect(readHistory(dir)[0]?.timestamp).toBe(timestamp);
	});

	it("mutation includes actor field", () => {
		const dir = makeTmpDir();
		const m: PlanMutation = { ...makeMutation(1), actor: "user" };
		appendMutation(dir, m);
		expect(readHistory(dir)[0]?.actor).toBe("user");
	});

	it("mutation includes kind field", () => {
		const dir = makeTmpDir();
		const m = makeMutation(1, "plan-approved");
		appendMutation(dir, m);
		expect(readHistory(dir)[0]?.kind).toBe("plan-approved");
	});

	it("each line is valid JSON", () => {
		const dir = makeTmpDir();
		appendMutation(dir, makeMutation(1));
		appendMutation(dir, makeMutation(2));
		appendMutation(dir, makeMutation(3));
		const file = join(dir, "plan-history.jsonl");
		const lines = (require("node:fs").readFileSync(file, "utf8") as string)
			.split("\n")
			.filter((l: string) => l.trim());
		for (const line of lines) {
			expect(() => JSON.parse(line)).not.toThrow();
		}
	});
});

describe("completed feature protection", () => {
	function makePlanWithFeature(featureId: string, status: Feature["status"]) {
		return makePlan({
			milestones: [
				makeMilestone({
					id: "m1",
					status: "active",
					features: [makeFeature({ id: featureId, status })],
				}),
			],
		});
	}

	it("rejects remove-feature mutation for a done feature", () => {
		const dir = makeTmpDir();
		savePlan(dir, makePlanWithFeature("feat-1", "done"));

		const mutation: PlanMutation = {
			planVersion: 1,
			timestamp: "2024-01-01T00:00:00.000Z",
			actor: "orchestrator",
			kind: "remove-feature",
			summary: "Remove feature",
			payload: { featureId: "feat-1" },
		};
		expect(() => appendMutation(dir, mutation)).toThrow(/completed feature/);
	});

	it("rejects edit-feature mutation for a done feature", () => {
		const dir = makeTmpDir();
		savePlan(dir, makePlanWithFeature("feat-1", "done"));

		const mutation: PlanMutation = {
			planVersion: 1,
			timestamp: "2024-01-01T00:00:00.000Z",
			actor: "orchestrator",
			kind: "edit-feature",
			summary: "Edit acceptance criteria",
			payload: { featureId: "feat-1", acceptanceCriteria: ["New criterion"] },
		};
		expect(() => appendMutation(dir, mutation)).toThrow(/completed feature/);
	});

	it("allows remove-feature mutation for a pending feature", () => {
		const dir = makeTmpDir();
		savePlan(dir, makePlanWithFeature("feat-1", "pending"));

		const mutation: PlanMutation = {
			planVersion: 1,
			timestamp: "2024-01-01T00:00:00.000Z",
			actor: "orchestrator",
			kind: "remove-feature",
			summary: "Remove pending feature",
			payload: { featureId: "feat-1" },
		};
		expect(() => appendMutation(dir, mutation)).not.toThrow();
	});

	it("allows edit-feature mutation for an active feature", () => {
		const dir = makeTmpDir();
		savePlan(dir, makePlanWithFeature("feat-1", "active"));

		const mutation: PlanMutation = {
			planVersion: 1,
			timestamp: "2024-01-01T00:00:00.000Z",
			actor: "orchestrator",
			kind: "edit-feature",
			summary: "Edit active feature",
			payload: { featureId: "feat-1" },
		};
		expect(() => appendMutation(dir, mutation)).not.toThrow();
	});

	it("does not reject remove-feature when no plan exists", () => {
		const dir = makeTmpDir();

		const mutation: PlanMutation = {
			planVersion: 1,
			timestamp: "2024-01-01T00:00:00.000Z",
			actor: "orchestrator",
			kind: "remove-feature",
			summary: "Remove feature (no plan)",
			payload: { featureId: "feat-unknown" },
		};
		expect(() => appendMutation(dir, mutation)).not.toThrow();
	});

	it("does not reject remove-feature when featureId missing from payload", () => {
		const dir = makeTmpDir();
		savePlan(dir, makePlanWithFeature("feat-1", "done"));

		const mutation: PlanMutation = {
			planVersion: 1,
			timestamp: "2024-01-01T00:00:00.000Z",
			actor: "orchestrator",
			kind: "remove-feature",
			summary: "Remove with no featureId",
			payload: {},
		};
		expect(() => appendMutation(dir, mutation)).not.toThrow();
	});

	it("does not reject non-destructive mutations even for done features", () => {
		const dir = makeTmpDir();
		savePlan(dir, makePlanWithFeature("feat-1", "done"));

		const mutation: PlanMutation = {
			planVersion: 1,
			timestamp: "2024-01-01T00:00:00.000Z",
			actor: "orchestrator",
			kind: "feature-status-change",
			summary: "Status change",
			payload: { featureId: "feat-1" },
		};
		expect(() => appendMutation(dir, mutation)).not.toThrow();
	});

	it("rejected mutations write nothing to the file", () => {
		const dir = makeTmpDir();
		savePlan(dir, makePlanWithFeature("feat-1", "done"));

		const mutation: PlanMutation = {
			planVersion: 1,
			timestamp: "2024-01-01T00:00:00.000Z",
			actor: "orchestrator",
			kind: "remove-feature",
			summary: "Remove done feature",
			payload: { featureId: "feat-1" },
		};

		expect(() => appendMutation(dir, mutation)).toThrow();
		expect(existsSync(join(dir, "plan-history.jsonl"))).toBe(false);
	});
});
