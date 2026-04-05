import { describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { MockPi, RegisteredTool, SessionCacheEntry } from "./mock-pi.js";
import { createMockContext, createMockPi } from "./mock-pi.js";

describe("createMockPi", () => {
	it("returns a pi object that satisfies ExtensionAPI", () => {
		const mock = createMockPi();
		const pi: ExtensionAPI = mock.pi;
		expect(pi).toBeDefined();
	});

	it("captures registered tools by name", () => {
		const mock = createMockPi();
		const fakeTool = {
			name: "test_tool",
			label: "Test Tool",
			description: "A test tool",
			parameters: {},
			execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
		};
		mock.pi.registerTool(fakeTool as never);
		expect(mock.getRegisteredTool("test_tool")).toBeDefined();
		expect(mock.getRegisteredTool("test_tool")!.name).toBe("test_tool");
	});

	it("returns undefined for unregistered tool names", () => {
		const mock = createMockPi();
		expect(mock.getRegisteredTool("nonexistent")).toBeUndefined();
	});

	it("getRegisteredTools returns all registered tools", () => {
		const mock = createMockPi();
		const tool1 = {
			name: "tool_a",
			label: "A",
			description: "a",
			parameters: {},
			execute: async () => ({ content: [] }),
		};
		const tool2 = {
			name: "tool_b",
			label: "B",
			description: "b",
			parameters: {},
			execute: async () => ({ content: [] }),
		};
		mock.pi.registerTool(tool1 as never);
		mock.pi.registerTool(tool2 as never);
		const all = mock.getRegisteredTools();
		expect(all).toHaveLength(2);
		expect(all.map((t) => t.name).sort()).toEqual(["tool_a", "tool_b"]);
	});

	it("captures event handlers via on()", () => {
		const mock = createMockPi();
		const handler = () => {};
		mock.pi.on("session_start", handler as never);
		expect(mock.handlers.get("session_start")).toBe(handler);
	});

	it("captures commands via registerCommand()", () => {
		const mock = createMockPi();
		const handler = async () => {};
		mock.pi.registerCommand("test", { handler } as never);
		expect(mock.commands.has("test")).toBe(true);
		expect(mock.commands.get("test")!.handler).toBe(handler);
	});

	it("captures shortcuts via registerShortcut()", () => {
		const mock = createMockPi();
		const handler = async () => {};
		mock.pi.registerShortcut("ctrl+shift+m" as never, { handler });
		expect(mock.shortcuts.has("ctrl+shift+m")).toBe(true);
	});

	it("tracks appended entries", () => {
		const mock = createMockPi();
		mock.pi.appendEntry("cache-key", { foo: 1 });
		mock.pi.appendEntry("cache-key", { foo: 2 });
		expect(mock.appendedEntries).toHaveLength(2);
		expect(mock.appendedEntries[0]).toEqual({ type: "cache-key", data: { foo: 1 } });
		expect(mock.appendedEntries[1]).toEqual({ type: "cache-key", data: { foo: 2 } });
	});

	it("tracks sent user messages", () => {
		const mock = createMockPi();
		mock.pi.sendUserMessage("hello");
		mock.pi.sendUserMessage("world");
		expect(mock.sentUserMessages).toEqual(["hello", "world"]);
	});

	it("tracks session names", () => {
		const mock = createMockPi();
		mock.pi.setSessionName("My Mission");
		expect(mock.sessionNames).toEqual(["My Mission"]);
	});

	it("accepts overrides for specific methods", () => {
		const customExec = async () => ({ stdout: "custom", stderr: "", exitCode: 42, signal: null });
		const mock = createMockPi({ exec: customExec });
		expect(mock.pi.exec).toBe(customExec);
	});

	it("registered tool execute is callable", async () => {
		const mock = createMockPi();
		const tool = {
			name: "callable_tool",
			label: "Callable",
			description: "Can be called",
			parameters: {},
			execute: async (_id: string, params: { value: number }) => ({
				content: [{ type: "text", text: `result: ${params.value}` }],
			}),
		};
		mock.pi.registerTool(tool as never);
		const registered = mock.getRegisteredTool("callable_tool")!;
		const result = await registered.execute("call-1", { value: 42 }, undefined, undefined, {} as ExtensionContext);
		expect(result.content[0]!.text).toBe("result: 42");
	});

	it("tools map is directly accessible", () => {
		const mock = createMockPi();
		expect(mock.tools.size).toBe(0);
		mock.pi.registerTool({
			name: "x",
			label: "X",
			description: "x",
			parameters: {},
			execute: async () => ({ content: [] }),
		} as never);
		expect(mock.tools.size).toBe(1);
		expect(mock.tools.has("x")).toBe(true);
	});

	it("provides stub implementations for remaining API methods", () => {
		const mock = createMockPi();
		expect(mock.pi.getFlag("any")).toBeUndefined();
		expect(mock.pi.getSessionName()).toBeUndefined();
		expect(mock.pi.getActiveTools()).toEqual([]);
		expect(mock.pi.getAllTools()).toEqual([]);
		expect(mock.pi.getCommands()).toEqual([]);
		expect(mock.pi.getThinkingLevel()).toBe("none");
	});
});

describe("createMockContext", () => {
	it("returns an object satisfying ExtensionContext", () => {
		const ctx: ExtensionContext = createMockContext();
		expect(ctx).toBeDefined();
		expect(ctx.hasUI).toBe(true);
	});

	it("defaults cwd to tmpdir", () => {
		const ctx = createMockContext();
		expect(ctx.cwd).toBe(tmpdir());
	});

	it("accepts custom cwd", () => {
		const ctx = createMockContext({ cwd: "/custom/dir" });
		expect(ctx.cwd).toBe("/custom/dir");
	});

	it("provides sessionManager with custom sessionId", () => {
		const ctx = createMockContext({ sessionId: "custom-session" });
		expect(ctx.sessionManager.getSessionId()).toBe("custom-session");
	});

	it("defaults sessionId to test-session-id", () => {
		const ctx = createMockContext();
		expect(ctx.sessionManager.getSessionId()).toBe("test-session-id");
	});

	it("returns cache entries from sessionManager.getEntries()", () => {
		const entries: SessionCacheEntry[] = [
			{ type: "custom", customType: "mission-state-cache", data: { status: "executing" } },
		];
		const ctx = createMockContext({ cacheEntries: entries });
		const result = ctx.sessionManager.getEntries();
		expect(result).toHaveLength(1);
	});

	it("confirm returns the configured result", async () => {
		const ctxTrue = createMockContext({ confirmResult: true });
		expect(await ctxTrue.ui.confirm("title", "msg")).toBe(true);

		const ctxFalse = createMockContext({ confirmResult: false });
		expect(await ctxFalse.ui.confirm("title", "msg")).toBe(false);
	});

	it("tracks widget calls when array is provided", () => {
		const widgetCalls: Array<[string, unknown]> = [];
		const ctx = createMockContext({ widgetCalls });
		ctx.ui.setWidget("mission", ["line1"]);
		expect(widgetCalls).toHaveLength(1);
		expect(widgetCalls[0]![0]).toBe("mission");
		expect(widgetCalls[0]![1]).toEqual(["line1"]);
	});

	it("tracks notify calls when array is provided", () => {
		const notifyCalls: string[] = [];
		const ctx = createMockContext({ notifyCalls });
		ctx.ui.notify("hello");
		ctx.ui.notify("world");
		expect(notifyCalls).toEqual(["hello", "world"]);
	});

	it("tracks custom overlay calls when array is provided", async () => {
		const customCalls: Array<{ options?: { overlay?: boolean } }> = [];
		const ctx = createMockContext({ customCalls });
		await ctx.ui.custom(() => ({}) as never, { overlay: true });
		expect(customCalls).toHaveLength(1);
		expect(customCalls[0]!.options).toEqual({ overlay: true });
	});

	it("provides sensible defaults for all ui methods", async () => {
		const ctx = createMockContext();
		expect(await ctx.ui.input("title")).toBeUndefined();
		expect(await ctx.ui.select("title", [])).toBeUndefined();
		expect(await ctx.ui.editor("title")).toBeUndefined();
		expect(ctx.ui.getEditorText()).toBe("");
		expect(ctx.ui.getToolsExpanded()).toBe(false);
		expect(ctx.ui.getTheme()).toBeUndefined();
		expect(ctx.ui.getAllThemes()).toEqual([]);
	});

	it("provides sensible defaults for context-level methods", () => {
		const ctx = createMockContext();
		expect(ctx.isIdle()).toBe(true);
		expect(ctx.hasPendingMessages()).toBe(false);
		expect(ctx.getContextUsage()).toBeUndefined();
		expect(ctx.getSystemPrompt()).toBe("");
		expect(ctx.signal).toBeUndefined();
		expect(ctx.model).toBeUndefined();
	});

	it("creates independent tracking arrays by default", () => {
		const ctx1 = createMockContext();
		const ctx2 = createMockContext();
		ctx1.ui.notify("only-ctx1");
		ctx2.ui.notify("only-ctx2");
	});
});

describe("integration: createMockPi + tool registration", () => {
	it("works with register pattern used by tool modules", () => {
		const mock = createMockPi();

		mock.pi.registerTool({
			name: "submit_plan",
			label: "Submit Plan",
			description: "Submit a mission plan",
			parameters: {},
			execute: async () => ({ content: [{ type: "text", text: "Plan submitted" }] }),
		} as never);

		mock.pi.registerTool({
			name: "spawn_worker",
			label: "Spawn Worker",
			description: "Spawn a worker",
			parameters: {},
			execute: async () => ({ content: [{ type: "text", text: "Worker spawned" }] }),
		} as never);

		expect(mock.getRegisteredTools()).toHaveLength(2);
		expect(mock.getRegisteredTool("submit_plan")).toBeDefined();
		expect(mock.getRegisteredTool("spawn_worker")).toBeDefined();
	});

	it("tools can be called with mock context", async () => {
		const mock = createMockPi();

		mock.pi.registerTool({
			name: "test_tool",
			label: "Test",
			description: "test",
			parameters: {},
			execute: async (_id: string, _params: unknown, _signal: unknown, _update: unknown, ctx: ExtensionContext) => {
				ctx.ui.notify("tool executed");
				return { content: [{ type: "text", text: "done" }] };
			},
		} as never);

		const tool = mock.getRegisteredTool("test_tool")!;
		const notifyCalls: string[] = [];
		const toolCtx = createMockContext({ notifyCalls });
		const result = await tool.execute("call-1", {}, undefined, undefined, toolCtx);
		expect(result.content[0]!.text).toBe("done");
		expect(notifyCalls).toEqual(["tool executed"]);
	});
});

describe("type safety", () => {
	it("MockPi fields are properly typed", () => {
		const mock: MockPi = createMockPi();
		const _pi: ExtensionAPI = mock.pi;
		const _tools: Map<string, RegisteredTool> = mock.tools;
		const _entries: Array<{ type: string; data: unknown }> = mock.appendedEntries;
		const _messages: string[] = mock.sentUserMessages;
		const _names: string[] = mock.sessionNames;
		expect(mock).toBeDefined();
	});

	it("createMockContext returns ExtensionContext without cast", () => {
		const ctx: ExtensionContext = createMockContext();
		expect(ctx.hasUI).toBe(true);
	});
});
