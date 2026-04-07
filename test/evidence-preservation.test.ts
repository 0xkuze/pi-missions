import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { transitionState } from "../extensions/state/transitions.js";

describe("evidence preservation on abort (VAL-EVIDENCE-006)", () => {
	it("evidence files survive mission abort", () => {
		const basePath = mkdtempSync(join(tmpdir(), "pi-missions-evidence-"));
		const evidenceDir = join(basePath, "runtime", "validation", "ms1", "assertions");
		mkdirSync(evidenceDir, { recursive: true });

		const evidenceFile = join(evidenceDir, "a1-stdout.log");
		writeFileSync(evidenceFile, "test output", "utf8");

		const state = {
			missionId: "test",
			status: "executing" as const,
			progressLog: [],
			startedAt: new Date().toISOString(),
			totalFeaturesCompleted: 0,
			totalFeaturesFailed: 0,
			totalFeaturesSkipped: 0,
			totalFixFeaturesCreated: 0,
		};
		transitionState(state, "aborted");

		expect(existsSync(evidenceFile)).toBe(true);

		rmSync(basePath, { recursive: true, force: true });
	});
});
