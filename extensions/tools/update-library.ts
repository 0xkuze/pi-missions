import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { clearProtocolCache } from "../orchestrator/protocol.js";
import { appendLibraryTopic } from "../state/library.js";
import { loadState } from "../state/manager.js";

const TOPIC_NAME_RE = /^[a-zA-Z0-9-]+$/;

const TERMINAL_STATUSES = new Set(["completed", "failed", "aborted"]);

interface Deps {
	basePath: string;
}

export function registerUpdateLibraryTool(pi: ExtensionAPI, deps: Deps): void {
	pi.registerTool({
		name: "update_library",
		label: "Update Library",
		description:
			"Append a learning entry to a library topic file. Used by the orchestrator to persist learnings from worker handoffs, such as pitfalls, conventions, and research notes.",
		promptSnippet: "Append a learning to a library topic (e.g., pitfalls, conventions, research).",
		parameters: Type.Object({
			topic: Type.String({ description: "Library topic name (e.g., pitfalls, conventions, research, or custom)" }),
			content: Type.String({ description: "Non-empty content to append to the topic" }),
		}),
		async execute(_toolCallId, params) {
			const state = loadState(deps.basePath);
			if (!state) {
				return {
					content: [{ type: "text", text: "Error: no active mission state. Start a mission first." }],
					details: {},
				};
			}

			if (TERMINAL_STATUSES.has(state.status)) {
				return {
					content: [
						{
							type: "text",
							text: `Error: mission is in terminal state '${state.status}'. Cannot update library.`,
						},
					],
					details: {},
				};
			}

			if (!params.topic || params.topic.trim() === "") {
				return {
					content: [{ type: "text", text: "Error: topic must not be empty." }],
					details: {},
				};
			}

			if (!TOPIC_NAME_RE.test(params.topic)) {
				return {
					content: [
						{
							type: "text",
							text: `Error: invalid topic name '${params.topic}'. Only alphanumeric characters and hyphens are allowed.`,
						},
					],
					details: {},
				};
			}

			if (!params.content || params.content.trim() === "") {
				return {
					content: [{ type: "text", text: "Error: content must not be empty." }],
					details: {},
				};
			}

			try {
				appendLibraryTopic(deps.basePath, params.topic, params.content);
				clearProtocolCache();
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: `Error: failed to update library: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
					details: {},
				};
			}

			return {
				content: [
					{
						type: "text",
						text: `Successfully appended to '${params.topic}' in the knowledge library.`,
					},
				],
				details: {},
			};
		},
	});
}
