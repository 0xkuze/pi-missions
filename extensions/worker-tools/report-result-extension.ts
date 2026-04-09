import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const ReportResultSchema = Type.Object({
	whatWasImplemented: Type.String(),
	whatWasLeftUndone: Type.String(),
	commandsRun: Type.Array(
		Type.Object({
			command: Type.String(),
			exitCode: Type.Number(),
			observation: Type.String(),
		}),
	),
	testsAdded: Type.Array(
		Type.Object({
			file: Type.String(),
			cases: Type.Array(Type.String()),
		}),
	),
	discoveredIssues: Type.Array(
		Type.Object({
			severity: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
			description: Type.String(),
			suggestedFix: Type.Optional(Type.String()),
		}),
	),
});

export default function register(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "report_result",
		label: "Report Result",
		description:
			"Report your work results. You MUST call this tool when you are done with your task. Provide what you implemented, what was left undone, commands you ran, tests you added, and any issues you discovered.",
		parameters: ReportResultSchema,
		async execute(_toolCallId, params) {
			return {
				content: [
					{
						type: "text" as const,
						text: `Result reported successfully.\nImplemented: ${params.whatWasImplemented}\nUndone: ${params.whatWasLeftUndone || "(none)"}\nCommands: ${params.commandsRun.length}\nTests: ${params.testsAdded.length}\nIssues: ${params.discoveredIssues.length}`,
					},
				],
				details: {},
			};
		},
	});
}
