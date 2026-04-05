import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { loadState } from "../state/manager.js";

export interface Question {
	question: string;
	options: string[];
	recommended?: number;
}

export interface QuestionAnswer {
	question: string;
	answer: string;
	isCustom: boolean;
}

interface Deps {
	basePath: string;
	showQuestions: (questions: Question[]) => Promise<QuestionAnswer[]>;
}

export function registerAskQuestionsTool(pi: ExtensionAPI, deps: Deps): void {
	pi.registerTool({
		name: "ask_questions",
		label: "Ask Questions",
		description:
			"Present structured questions to the user with pre-defined answer options. Opens an interactive overlay where the user can select from options or provide custom answers. Use during planning to gather requirements and preferences efficiently.",
		parameters: Type.Object({
			questions: Type.Array(
				Type.Object({
					question: Type.String({ description: "The question text" }),
					options: Type.Array(Type.String(), {
						description: "Pre-defined answer options (2-6 options)",
					}),
					recommended: Type.Optional(Type.Number({ description: "0-based index of the recommended option" })),
				}),
				{ description: "Questions to ask (1-6 questions)" },
			),
		}),
		async execute(_toolCallId, params) {
			const state = loadState(deps.basePath);
			if (!state) {
				return {
					content: [{ type: "text", text: "Error: no active mission state." }],
					details: {},
				};
			}

			if (state.status !== "planning") {
				return {
					content: [
						{
							type: "text",
							text: `Error: ask_questions is only available during planning. Current: '${state.status}'.`,
						},
					],
					details: {},
				};
			}

			if (params.questions.length === 0 || params.questions.length > 6) {
				return {
					content: [{ type: "text", text: "Error: provide 1-6 questions." }],
					details: {},
				};
			}

			const answers = await deps.showQuestions(params.questions);

			const formatted = answers
				.map((a, i) => `Q${i + 1}: ${a.question}\nA: ${a.answer}${a.isCustom ? " (custom)" : ""}`)
				.join("\n\n");

			return {
				content: [{ type: "text", text: `User answers:\n\n${formatted}` }],
				details: {},
			};
		},
	});
}
