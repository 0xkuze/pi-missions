import { tmpdir } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type ToolResult = { content: Array<{ type: string; text: string }>; details?: unknown };
type RegisteredTool = {
	name: string;
	label: string;
	description: string;
	parameters: unknown;
	promptSnippet?: string;
	promptGuidelines?: string[];
	execute: (
		toolCallId: string,
		params: unknown,
		signal: AbortSignal | undefined,
		onUpdate: unknown,
		ctx: ExtensionContext,
	) => Promise<ToolResult>;
};

type EventHandler = (event: unknown, ctx: ExtensionContext) => unknown;
type CommandHandler = (args: string, ctx: ExtensionContext) => Promise<void>;

interface MockPi {
	pi: ExtensionAPI;
	tools: Map<string, RegisteredTool>;
	handlers: Map<string, EventHandler>;
	commands: Map<string, { description?: string; handler: CommandHandler }>;
	shortcuts: Map<string, { description?: string; handler: (ctx: ExtensionContext) => Promise<void> | void }>;
	appendedEntries: Array<{ type: string; data: unknown }>;
	sentUserMessages: string[];
	sessionNames: string[];
	getRegisteredTool(name: string): RegisteredTool | undefined;
	getRegisteredTools(): RegisteredTool[];
}

function createMockPi(overrides: Partial<Record<keyof ExtensionAPI, unknown>> = {}): MockPi {
	const tools = new Map<string, RegisteredTool>();
	const handlers = new Map<string, EventHandler>();
	const commands = new Map<string, { description?: string; handler: CommandHandler }>();
	const shortcuts = new Map<
		string,
		{ description?: string; handler: (ctx: ExtensionContext) => Promise<void> | void }
	>();
	const appendedEntries: Array<{ type: string; data: unknown }> = [];
	const sentUserMessages: string[] = [];
	const sessionNames: string[] = [];

	const pi = {
		on: (event: string, handler: EventHandler) => {
			handlers.set(event, handler);
		},
		registerTool: (tool: RegisteredTool) => {
			tools.set(tool.name, tool);
		},
		registerCommand: (name: string, opts: { description?: string; handler: CommandHandler }) => {
			commands.set(name, opts);
		},
		registerShortcut: (
			shortcut: string,
			opts: { description?: string; handler: (ctx: ExtensionContext) => Promise<void> | void },
		) => {
			shortcuts.set(shortcut, opts);
		},
		appendEntry: (type: string, data: unknown) => {
			appendedEntries.push({ type, data });
		},
		sendUserMessage: (content: string) => {
			sentUserMessages.push(content);
		},
		setSessionName: (name: string) => {
			sessionNames.push(name);
		},
		registerFlag: () => {},
		getFlag: () => undefined,
		registerMessageRenderer: () => {},
		sendMessage: () => {},
		getSessionName: () => undefined,
		setLabel: () => {},
		exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
		getActiveTools: () => [],
		getAllTools: () => [],
		setActiveTools: () => {},
		getCommands: () => [],
		setModel: async () => true,
		getThinkingLevel: () => "off" as const,
		setThinkingLevel: () => {},
		events: { on: () => {}, off: () => {}, emit: () => {} },
		...overrides,
	} as unknown as ExtensionAPI;

	return {
		pi,
		tools,
		handlers,
		commands,
		shortcuts,
		appendedEntries,
		sentUserMessages,
		sessionNames,
		getRegisteredTool: (name: string) => tools.get(name),
		getRegisteredTools: () => [...tools.values()],
	};
}

type SessionCacheEntry = { type: "custom"; customType: string; data?: unknown };

interface MockContextOptions {
	cacheEntries?: SessionCacheEntry[];
	sessionId?: string;
	cwd?: string;
	confirmResult?: boolean;
	widgetCalls?: Array<[string, unknown]>;
	notifyCalls?: string[];
	customCalls?: Array<{ options?: { overlay?: boolean } }>;
}

function createMockContext(options: MockContextOptions = {}): ExtensionContext {
	const {
		cacheEntries = [],
		sessionId = "test-session-id",
		cwd = tmpdir(),
		confirmResult = false,
		widgetCalls = [],
		notifyCalls = [],
		customCalls = [],
	} = options;

	return {
		ui: {
			setWidget: (key: string, content: unknown) => {
				widgetCalls.push([key, content]);
			},
			notify: (msg: string) => {
				notifyCalls.push(msg);
			},
			confirm: async () => confirmResult,
			input: async () => undefined,
			select: async () => undefined,
			setStatus: () => {},
			setWorkingMessage: () => {},
			setHiddenThinkingLabel: () => {},
			onTerminalInput: () => () => {},
			setFooter: () => {},
			setHeader: () => {},
			setTitle: () => {},
			custom: async (_factory: unknown, options?: { overlay?: boolean }) => {
				customCalls.push({ options });
				return undefined;
			},
			pasteToEditor: () => {},
			setEditorText: () => {},
			getEditorText: () => "",
			editor: async () => undefined,
			setEditorComponent: () => {},
			getTheme: () => undefined,
			getAllThemes: () => [],
			setTheme: () => ({ success: true }),
			getToolsExpanded: () => false,
			setToolsExpanded: () => {},
			theme: {} as never,
		},
		hasUI: true,
		cwd,
		sessionManager: {
			getEntries: () => cacheEntries as never[],
			getSessionId: () => sessionId,
			getCwd: () => cwd,
			getSessionDir: () => cwd,
			getSessionFile: () => undefined,
			getLeafId: () => null,
			getLeafEntry: () => undefined,
			getEntry: () => undefined,
			getLabel: () => undefined,
			getBranch: () => [],
			getHeader: () => ({}),
			getTree: () => [],
			getSessionName: () => undefined,
		} as never,
		modelRegistry: {
			getAll: () => [],
		} as never,
		model: undefined,
		isIdle: () => true,
		signal: undefined,
		abort: () => {},
		hasPendingMessages: () => false,
		shutdown: () => {},
		getContextUsage: () => undefined,
		compact: () => {},
		getSystemPrompt: () => "",
	} as unknown as ExtensionContext;
}

export type { CommandHandler, EventHandler, MockContextOptions, MockPi, RegisteredTool, SessionCacheEntry, ToolResult };
export { createMockContext, createMockPi };
