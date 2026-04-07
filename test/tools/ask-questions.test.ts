import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { saveState } from "../../extensions/state/manager.js";
import { type Question, type QuestionAnswer, registerAskQuestionsTool } from "../../extensions/tools/ask-questions.js";
import type { MissionState } from "../../extensions/types.js";
import { nowISO } from "../../extensions/utils.js";

function makePlanningState(): MissionState {
	return {
		missionId: "test-mission",
		status: "planning",
		progressLog: [],
		startedAt: nowISO(),
		totalFeaturesCompleted: 0,
		totalFeaturesFailed: 0,
		totalFeaturesSkipped: 0,
		totalFixFeaturesCreated: 0,
	};
}

type ToolResult = { content: Array<{ type: string; text: string }>; details: unknown };
type ExecutableTool = { execute: (...args: unknown[]) => Promise<ToolResult> };

function makeMockPi(): { pi: ExtensionAPI; getLastRegisteredTool: () => ExecutableTool | null } {
	let registeredTool: ExecutableTool | null = null;
	const pi = {
		registerTool: (tool: ExecutableTool) => {
			registeredTool = tool;
		},
	} as unknown as ExtensionAPI;
	return {
		pi,
		getLastRegisteredTool: () => registeredTool,
	};
}

function makeQuestions(count = 2): Question[] {
	const qs: Question[] = [];
	for (let i = 0; i < count; i++) {
		qs.push({
			question: `Question ${i + 1}?`,
			options: [`Option A${i}`, `Option B${i}`],
			recommended: 0,
		});
	}
	return qs;
}

function makeAnswers(questions: Question[]): QuestionAnswer[] {
	return questions.map((q) => ({ question: q.question, answer: q.options[0], isCustom: false }));
}

async function callTool(
	basePath: string,
	params: unknown,
	state: MissionState,
	showQuestions?: (questions: Question[]) => Promise<QuestionAnswer[]>,
): Promise<ToolResult> {
	const { pi, getLastRegisteredTool } = makeMockPi();
	saveState(basePath, state);
	registerAskQuestionsTool(pi, {
		basePath,
		showQuestions: showQuestions ?? ((qs) => Promise.resolve(makeAnswers(qs))),
	});
	const tool = getLastRegisteredTool()!;
	return tool.execute("tool-call-id", params, undefined, undefined, undefined) as Promise<ToolResult>;
}

describe("registerAskQuestionsTool", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "ask-questions-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("state gating", () => {
		it("returns error when no active mission state", async () => {
			const { pi, getLastRegisteredTool } = makeMockPi();
			registerAskQuestionsTool(pi, {
				basePath: tmpDir,
				showQuestions: () => Promise.resolve([]),
			});
			const tool = getLastRegisteredTool()!;
			const result = (await tool.execute(
				"id",
				{ questions: makeQuestions(1) },
				undefined,
				undefined,
				undefined,
			)) as ToolResult;
			expect(result.content[0].text).toContain("no active mission state");
		});

		it("returns error when not in planning state", async () => {
			const state = { ...makePlanningState(), status: "executing" as const };
			const result = await callTool(tmpDir, { questions: makeQuestions(1) }, state);
			expect(result.content[0].text).toContain("only available during planning");
			expect(result.content[0].text).toContain("executing");
		});

		it("returns error when in draft_review state", async () => {
			const state = { ...makePlanningState(), status: "draft_review" as const };
			const result = await callTool(tmpDir, { questions: makeQuestions(1) }, state);
			expect(result.content[0].text).toContain("only available during planning");
		});

		it("works in planning state", async () => {
			const state = makePlanningState();
			const result = await callTool(tmpDir, { questions: makeQuestions(1) }, state);
			expect(result.content[0].text).toContain("User answers");
		});
	});

	describe("parameter validation", () => {
		it("returns error for empty questions array", async () => {
			const result = await callTool(tmpDir, { questions: [] }, makePlanningState());
			expect(result.content[0].text).toContain("1-6 questions");
		});

		it("returns error for more than 6 questions", async () => {
			const result = await callTool(tmpDir, { questions: makeQuestions(7) }, makePlanningState());
			expect(result.content[0].text).toContain("1-6 questions");
		});

		it("accepts exactly 6 questions", async () => {
			const result = await callTool(tmpDir, { questions: makeQuestions(6) }, makePlanningState());
			expect(result.content[0].text).toContain("User answers");
		});

		it("accepts exactly 1 question", async () => {
			const result = await callTool(tmpDir, { questions: makeQuestions(1) }, makePlanningState());
			expect(result.content[0].text).toContain("User answers");
		});
	});

	describe("answer formatting", () => {
		it("formats pre-defined answers", async () => {
			const questions = makeQuestions(2);
			const result = await callTool(tmpDir, { questions }, makePlanningState());
			const text = result.content[0].text;
			expect(text).toContain("Q1: Question 1?");
			expect(text).toContain("A: Option A0");
			expect(text).toContain("Q2: Question 2?");
			expect(text).toContain("A: Option A1");
		});

		it("formats custom answers with marker", async () => {
			const questions = makeQuestions(1);
			const showQuestions = () =>
				Promise.resolve([{ question: questions[0].question, answer: "My custom answer", isCustom: true }]);
			const result = await callTool(tmpDir, { questions }, makePlanningState(), showQuestions);
			const text = result.content[0].text;
			expect(text).toContain("My custom answer");
			expect(text).toContain("(custom)");
		});

		it("does not mark pre-defined answers as custom", async () => {
			const questions = makeQuestions(1);
			const result = await callTool(tmpDir, { questions }, makePlanningState());
			const text = result.content[0].text;
			expect(text).not.toContain("(custom)");
		});
	});

	describe("declined handling", () => {
		it("returns declined message when all answers are skipped", async () => {
			const questions = makeQuestions(2);
			const showQuestions = () =>
				Promise.resolve(questions.map((q) => ({ question: q.question, answer: "(skipped)", isCustom: false })));
			const result = await callTool(tmpDir, { questions }, makePlanningState(), showQuestions);
			const text = result.content[0].text;
			expect(text).toContain("declined");
			expect(text).not.toContain("Q1:");
		});

		it("returns normal formatted answers when some are answered", async () => {
			const questions = makeQuestions(2);
			const showQuestions = () =>
				Promise.resolve([
					{ question: questions[0].question, answer: "Real answer", isCustom: false },
					{ question: questions[1].question, answer: "(skipped)", isCustom: false },
				]);
			const result = await callTool(tmpDir, { questions }, makePlanningState(), showQuestions);
			const text = result.content[0].text;
			expect(text).toContain("User answers");
			expect(text).toContain("Q1:");
			expect(text).toContain("Real answer");
		});

		it("returns normal formatted answers when none are skipped", async () => {
			const questions = makeQuestions(2);
			const result = await callTool(tmpDir, { questions }, makePlanningState());
			const text = result.content[0].text;
			expect(text).toContain("User answers");
			expect(text).toContain("Q1:");
			expect(text).toContain("Q2:");
		});
	});

	describe("showQuestions integration", () => {
		it("passes questions to showQuestions callback", async () => {
			const questions = makeQuestions(2);
			let receivedQuestions: Question[] = [];
			const showQuestions = (qs: Question[]) => {
				receivedQuestions = qs;
				return Promise.resolve(makeAnswers(qs));
			};
			await callTool(tmpDir, { questions }, makePlanningState(), showQuestions);
			expect(receivedQuestions).toHaveLength(2);
			expect(receivedQuestions[0].question).toBe("Question 1?");
			expect(receivedQuestions[1].question).toBe("Question 2?");
		});
	});
});
