import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { loadState, saveEnvironment } from "../state/manager.js";

const PLANNING_STATUSES = new Set(["planning", "draft_review"]);

interface Deps {
	basePath: string;
}

export function registerConfigureEnvironmentTool(pi: ExtensionAPI, deps: Deps): void {
	pi.registerTool({
		name: "configure_environment",
		label: "Configure Environment",
		description:
			"Create or update the mission environment descriptor. Defines services, environment variables, and setup commands that run before workers. Only available during planning state.",
		promptSnippet: "Configure services, env vars, and setup commands for the mission environment.",
		parameters: Type.Object({
			services: Type.Optional(
				Type.Array(
					Type.Object({
						name: Type.String({ description: "Service name" }),
						type: Type.String({ description: "Service type (e.g., database, cache)" }),
						config: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
					}),
				),
			),
			envVars: Type.Optional(
				Type.Array(
					Type.Object({
						key: Type.String({ description: "Environment variable name" }),
						value: Type.String({ description: "Environment variable value" }),
						secret: Type.Optional(Type.Boolean({ description: "Mark as secret to mask in worker context" })),
					}),
				),
			),
			setupCommands: Type.Optional(
				Type.Array(Type.String({ description: "Commands to run before first worker spawn" })),
			),
		}),
		async execute(_toolCallId, params) {
			const state = loadState(deps.basePath);
			if (!state) {
				return {
					content: [{ type: "text", text: "Error: no active mission state. Start a mission first." }],
					details: {},
				};
			}

			if (!PLANNING_STATUSES.has(state.status)) {
				return {
					content: [
						{
							type: "text",
							text: `Error: configure_environment is only available during planning state. Current state: '${state.status}'.`,
						},
					],
					details: {},
				};
			}

			saveEnvironment(deps.basePath, {
				services: params.services,
				envVars: params.envVars,
				setupCommands: params.setupCommands,
			});

			const parts: string[] = [];
			if (params.services && params.services.length > 0) {
				parts.push(`${params.services.length} service(s)`);
			}
			if (params.envVars && params.envVars.length > 0) {
				parts.push(`${params.envVars.length} env var(s)`);
			}
			if (params.setupCommands && params.setupCommands.length > 0) {
				parts.push(`${params.setupCommands.length} setup command(s)`);
			}
			const summary = parts.length > 0 ? parts.join(", ") : "empty descriptor";

			return {
				content: [{ type: "text", text: `Environment configured: ${summary}.` }],
				details: {},
			};
		},
	});
}
