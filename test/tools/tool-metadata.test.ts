import { describe, expect, it } from "bun:test";
import { registerAskQuestionsTool } from "../../extensions/tools/ask-questions.js";
import { registerCommitChangesTool } from "../../extensions/tools/commit-changes.js";
import { registerCompleteMissionTool } from "../../extensions/tools/complete.js";
import { registerCreateFixTool } from "../../extensions/tools/create-fix.js";
import { registerRunValidationTool } from "../../extensions/tools/run-validation.js";
import { registerSpawnWorkerTool } from "../../extensions/tools/spawn-worker.js";
import { registerSubmitPlanTool } from "../../extensions/tools/submit-plan.js";
import { registerUpdateStateTool } from "../../extensions/tools/update-state.js";
import { createMockPi } from "../helpers/index.js";

function registerAllTools() {
	const mock = createMockPi();
	const basePath = "/tmp/test-metadata";
	const projectDir = "/tmp/test-project";
	const noop = () => {};

	registerSpawnWorkerTool(mock.pi, {
		basePath,
		projectDir,
		updateWidget: noop,
	});
	registerRunValidationTool(mock.pi, {
		basePath,
		projectDir,
		updateWidget: noop,
		exec: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
	});
	registerCommitChangesTool(mock.pi, {
		basePath,
		projectDir,
		updateWidget: noop,
	});
	registerAskQuestionsTool(mock.pi, {
		basePath,
		showQuestions: async () => [],
	});
	registerSubmitPlanTool(mock.pi, {
		basePath,
		updateWidget: noop,
	});
	registerUpdateStateTool(mock.pi, {
		basePath,
		updateWidget: noop,
	});
	registerCompleteMissionTool(mock.pi, {
		basePath,
		updateWidget: noop,
	});
	registerCreateFixTool(mock.pi, {
		basePath,
		updateWidget: noop,
	});

	return mock;
}

describe("tool metadata (promptSnippet and promptGuidelines)", () => {
	const mock = registerAllTools();

	it("spawn_worker has promptSnippet defined", () => {
		const tool = mock.getRegisteredTool("spawn_worker");
		expect(tool).toBeDefined();
		expect(tool!.promptSnippet).toBeDefined();
		expect(typeof tool!.promptSnippet).toBe("string");
		expect(tool!.promptSnippet!.length).toBeGreaterThan(0);
	});

	it("spawn_worker has promptGuidelines array with at least 1 entry", () => {
		const tool = mock.getRegisteredTool("spawn_worker");
		expect(tool).toBeDefined();
		expect(Array.isArray(tool!.promptGuidelines)).toBe(true);
		expect(tool!.promptGuidelines!.length).toBeGreaterThanOrEqual(1);
	});

	it("run_validation has promptSnippet defined", () => {
		const tool = mock.getRegisteredTool("run_validation");
		expect(tool).toBeDefined();
		expect(tool!.promptSnippet).toBeDefined();
		expect(typeof tool!.promptSnippet).toBe("string");
	});

	it("commit_changes has promptSnippet defined", () => {
		const tool = mock.getRegisteredTool("commit_changes");
		expect(tool).toBeDefined();
		expect(tool!.promptSnippet).toBeDefined();
		expect(typeof tool!.promptSnippet).toBe("string");
	});

	it("all 8 tools have promptSnippet defined", () => {
		const toolNames = [
			"spawn_worker",
			"run_validation",
			"commit_changes",
			"ask_questions",
			"submit_plan",
			"update_mission_state",
			"complete_mission",
			"create_fix_feature",
		];
		for (const name of toolNames) {
			const tool = mock.getRegisteredTool(name);
			expect(tool).toBeDefined();
			expect(tool!.promptSnippet).toBeDefined();
			expect(typeof tool!.promptSnippet).toBe("string");
			expect(tool!.promptSnippet!.length).toBeGreaterThan(0);
		}
	});
});
