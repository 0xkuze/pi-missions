import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { appendLibraryTopic, initLibrary } from "../../extensions/state/library.js";
import { loadState, saveState } from "../../extensions/state/manager.js";
import { registerUpdateLibraryTool } from "../../extensions/tools/update-library.js";
import type { MissionState } from "../../extensions/types.js";
import type { MockPi, TempDir } from "../helpers/index.js";
import { createMockPi, createTempDir, makeState } from "../helpers/index.js";

let tmp: TempDir;

function makeBasePath(): string {
	const dir = join(tmp.path, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function makeActiveState(basePath: string, overrides: Partial<MissionState> = {}): MissionState {
	const state = makeState({ status: "executing", ...overrides });
	saveState(basePath, state);
	return state;
}

beforeEach(() => {
	tmp = createTempDir("pi-missions-update-lib-");
});

afterEach(() => {
	tmp.cleanup();
});

async function callTool(mockPi: MockPi, params: { topic: string; content: string }) {
	const tool = mockPi.getRegisteredTool("update_library");
	if (!tool) throw new Error("update_library tool not registered");
	return tool.execute("tc-1", params, undefined, undefined, undefined as never);
}

describe("update_library tool registration", () => {
	it("registers update_library tool via registerTool", () => {
		const mockPi = createMockPi();
		registerUpdateLibraryTool(mockPi.pi, { basePath: makeBasePath() });
		const tool = mockPi.getRegisteredTool("update_library");
		expect(tool).toBeDefined();
		expect(tool!.name).toBe("update_library");
	});

	it("has correct TypeBox parameter schema with topic and content", () => {
		const mockPi = createMockPi();
		registerUpdateLibraryTool(mockPi.pi, { basePath: makeBasePath() });
		const tool = mockPi.getRegisteredTool("update_library");
		expect(tool).toBeDefined();

		const schema = tool!.parameters as ReturnType<typeof Type.Object>;

		const validInput = { topic: "pitfalls", content: "some entry" };
		expect(Value.Check(schema, validInput)).toBe(true);

		const missingTopic = { content: "some entry" };
		expect(Value.Check(schema, missingTopic)).toBe(false);

		const missingContent = { topic: "pitfalls" };
		expect(Value.Check(schema, missingContent)).toBe(false);

		const emptyObj = {};
		expect(Value.Check(schema, emptyObj)).toBe(false);
	});

	it("is only available when mission is active (not idle)", () => {
		const basePath = makeBasePath();
		const mockPi = createMockPi();
		registerUpdateLibraryTool(mockPi.pi, { basePath });

		makeActiveState(basePath);
		const state = loadState(basePath);
		expect(state).not.toBeNull();
		expect(state!.status).not.toBe("idle");
	});
});

describe("update_library tool input validation", () => {
	it("rejects empty topic", async () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		makeActiveState(basePath);
		const mockPi = createMockPi();
		registerUpdateLibraryTool(mockPi.pi, { basePath });

		const result = await callTool(mockPi, { topic: "", content: "valid content" });
		expect(result.content[0].text).toContain("Error");
		expect(result.content[0].text).toMatch(/topic/i);
	});

	it("rejects empty content", async () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		makeActiveState(basePath);
		const mockPi = createMockPi();
		registerUpdateLibraryTool(mockPi.pi, { basePath });

		const result = await callTool(mockPi, { topic: "pitfalls", content: "" });
		expect(result.content[0].text).toContain("Error");
		expect(result.content[0].text).toMatch(/content/i);
	});

	it("rejects path traversal in topic name", async () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		makeActiveState(basePath);
		const mockPi = createMockPi();
		registerUpdateLibraryTool(mockPi.pi, { basePath });

		const result = await callTool(mockPi, { topic: "../etc/passwd", content: "valid content" });
		expect(result.content[0].text).toContain("Error");
		expect(result.content[0].text).toMatch(/invalid topic/i);
	});

	it("rejects topic with slashes", async () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		makeActiveState(basePath);
		const mockPi = createMockPi();
		registerUpdateLibraryTool(mockPi.pi, { basePath });

		const result = await callTool(mockPi, { topic: "foo/bar", content: "valid content" });
		expect(result.content[0].text).toContain("Error");
		expect(result.content[0].text).toMatch(/invalid topic/i);
	});

	it("accepts valid known topic name", async () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		makeActiveState(basePath);
		const mockPi = createMockPi();
		registerUpdateLibraryTool(mockPi.pi, { basePath });

		const result = await callTool(mockPi, { topic: "pitfalls", content: "Avoid global state" });
		expect(result.content[0].text).not.toContain("Error");
	});

	it("accepts valid custom topic name", async () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		makeActiveState(basePath);
		const mockPi = createMockPi();
		registerUpdateLibraryTool(mockPi.pi, { basePath });

		const result = await callTool(mockPi, { topic: "custom-learning", content: "Some learning" });
		expect(result.content[0].text).not.toContain("Error");
	});
});

describe("update_library tool appends content to library topic", () => {
	it("appends content to existing topic file", async () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		makeActiveState(basePath);
		const mockPi = createMockPi();
		registerUpdateLibraryTool(mockPi.pi, { basePath });

		const result = await callTool(mockPi, { topic: "pitfalls", content: "Always run migrations first" });
		expect(result.content[0].text).not.toContain("Error");

		const fileContent = readFileSync(join(basePath, "library", "pitfalls.md"), "utf8");
		expect(fileContent).toContain("Always run migrations first");
	});

	it("creates topic file if it does not exist", async () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		makeActiveState(basePath);
		const mockPi = createMockPi();
		registerUpdateLibraryTool(mockPi.pi, { basePath });

		const result = await callTool(mockPi, { topic: "new-topic", content: "Fresh entry" });
		expect(result.content[0].text).not.toContain("Error");

		const filePath = join(basePath, "library", "new-topic.md");
		expect(existsSync(filePath)).toBe(true);
		const fileContent = readFileSync(filePath, "utf8");
		expect(fileContent).toContain("Fresh entry");
	});

	it("preserves existing content when appending", async () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		writeFileSync(join(basePath, "library", "pitfalls.md"), "# Pitfalls\n\nFirst entry");
		makeActiveState(basePath);
		const mockPi = createMockPi();
		registerUpdateLibraryTool(mockPi.pi, { basePath });

		await callTool(mockPi, { topic: "pitfalls", content: "Second entry" });

		const fileContent = readFileSync(join(basePath, "library", "pitfalls.md"), "utf8");
		expect(fileContent).toContain("First entry");
		expect(fileContent).toContain("Second entry");
	});

	it("returns success message with topic name", async () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		makeActiveState(basePath);
		const mockPi = createMockPi();
		registerUpdateLibraryTool(mockPi.pi, { basePath });

		const result = await callTool(mockPi, { topic: "conventions", content: "Use camelCase" });
		expect(result.content[0].text).toMatch(/success/i);
		expect(result.content[0].text).toContain("conventions");
	});
});

describe("update_library tool state gating", () => {
	it("returns error when no active mission state exists", async () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		const mockPi = createMockPi();
		registerUpdateLibraryTool(mockPi.pi, { basePath });

		const result = await callTool(mockPi, { topic: "pitfalls", content: "Valid content" });
		expect(result.content[0].text).toContain("Error");
		expect(result.content[0].text).toMatch(/no active mission/i);
	});

	it("returns error when mission is in idle-like state", async () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		makeActiveState(basePath, { status: "completed" });
		const mockPi = createMockPi();
		registerUpdateLibraryTool(mockPi.pi, { basePath });

		const result = await callTool(mockPi, { topic: "pitfalls", content: "Valid content" });
		expect(result.content[0].text).toContain("Error");
	});
});

describe("skills directory creation", () => {
	it("creates .pi/missions/skills/ directory during mission init", () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		expect(existsSync(join(basePath, "skills"))).toBe(true);
	});

	it("is idempotent — existing skills directory is preserved", () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		const skillsDir = join(basePath, "skills");
		writeFileSync(join(skillsDir, "existing-skill.md"), "# Existing Skill\n\nContent");
		initLibrary(basePath);
		expect(existsSync(join(skillsDir, "existing-skill.md"))).toBe(true);
		const content = readFileSync(join(skillsDir, "existing-skill.md"), "utf8");
		expect(content).toContain("Existing Skill");
	});
});

describe("skills stored as markdown", () => {
	it("skill files are stored as .md files in skills directory", () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		const skillsDir = join(basePath, "skills");

		const skillName = "testing-patterns";
		const skillContent = `# Testing Patterns\n\nUse bun:test with describe/it/expect.`;
		writeFileSync(join(skillsDir, `${skillName}.md`), skillContent);

		expect(existsSync(join(skillsDir, `${skillName}.md`))).toBe(true);
		const content = readFileSync(join(skillsDir, `${skillName}.md`), "utf8");
		expect(content).toContain("# Testing Patterns");
		expect(content).toContain("bun:test");
	});

	it("skill file contains valid markdown with header", () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		const skillsDir = join(basePath, "skills");

		const skillContent = `# My Skill\n\nSome instructions here.`;
		writeFileSync(join(skillsDir, "my-skill.md"), skillContent);

		const content = readFileSync(join(skillsDir, "my-skill.md"), "utf8");
		expect(content.startsWith("# ")).toBe(true);
		expect(content).not.toContain("\0");
	});
});
