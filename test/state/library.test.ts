import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	appendLibraryTopic,
	initLibrary,
	readLibraryTopic,
	writeLibraryTopic,
} from "../../extensions/state/library.js";
import type { TempDir } from "../helpers/index.js";
import { createTempDir } from "../helpers/index.js";

const DEFAULT_TOPICS = ["architecture", "environment", "pitfalls", "conventions", "research"] as const;

let tmp: TempDir;

function makeBasePath(): string {
	const dir = join(tmp.path, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

beforeEach(() => {
	tmp = createTempDir("pi-missions-library-");
});

afterEach(() => {
	tmp.cleanup();
});

describe("initLibrary", () => {
	it("creates library directory", () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		expect(existsSync(join(basePath, "library"))).toBe(true);
	});

	it("creates all default topic files with H1 headers", () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		for (const topic of DEFAULT_TOPICS) {
			const filePath = join(basePath, "library", `${topic}.md`);
			expect(existsSync(filePath)).toBe(true);
			const content = readFileSync(filePath, "utf8");
			const header = `# ${topic.charAt(0).toUpperCase() + topic.slice(1)}`;
			expect(content.startsWith(header)).toBe(true);
		}
	});

	it("is idempotent — does not overwrite existing files", () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		const architecturePath = join(basePath, "library", "architecture.md");
		writeFileSync(architecturePath, "# Architecture\n\nCustom content here");
		initLibrary(basePath);
		const content = readFileSync(architecturePath, "utf8");
		expect(content).toContain("Custom content here");
	});

	it("is idempotent — does not throw when directory already exists", () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		expect(() => initLibrary(basePath)).not.toThrow();
	});
});

describe("readLibraryTopic", () => {
	it("returns file content for existing topic", () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		writeFileSync(join(basePath, "library", "pitfalls.md"), "# Pitfalls\n\nAvoid global state");
		const content = readLibraryTopic(basePath, "pitfalls");
		expect(content).toBe("# Pitfalls\n\nAvoid global state");
	});

	it("returns null for non-existent topic", () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		const content = readLibraryTopic(basePath, "nonexistent");
		expect(content).toBeNull();
	});

	it("truncates content exceeding 2000 characters with marker", () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		const longContent = "# Pitfalls\n\n" + "x".repeat(2001);
		writeFileSync(join(basePath, "library", "pitfalls.md"), longContent);
		const content = readLibraryTopic(basePath, "pitfalls");
		expect(content).not.toBeNull();
		expect(content!.length).toBeLessThan(longContent.length);
		expect(content!.endsWith("...truncated")).toBe(true);
	});

	it("does not truncate content at exactly 2000 characters", () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		const exactContent = "# Pitfalls\n\n" + "x".repeat(1988);
		writeFileSync(join(basePath, "library", "pitfalls.md"), exactContent);
		const content = readLibraryTopic(basePath, "pitfalls");
		expect(content).toBe(exactContent);
	});

	it("reads content exactly at 2000 chars without truncation", () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		const header = "# Pitfalls\n\n";
		const body = "a".repeat(2000 - header.length);
		const exactContent = header + body;
		writeFileSync(join(basePath, "library", "pitfalls.md"), exactContent);
		const content = readLibraryTopic(basePath, "pitfalls");
		expect(content).toBe(exactContent);
	});
});

describe("writeLibraryTopic", () => {
	it("replaces entire file content", () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		writeFileSync(join(basePath, "library", "architecture.md"), "# Architecture\n\nOld content");
		writeLibraryTopic(basePath, "architecture", "# Architecture\n\nNew content");
		const content = readFileSync(join(basePath, "library", "architecture.md"), "utf8");
		expect(content).toBe("# Architecture\n\nNew content");
		expect(content).not.toContain("Old content");
	});

	it("creates file for non-existent topic", () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		writeLibraryTopic(basePath, "custom-topic", "# Custom Topic\n\nSome content");
		expect(existsSync(join(basePath, "library", "custom-topic.md"))).toBe(true);
		const content = readFileSync(join(basePath, "library", "custom-topic.md"), "utf8");
		expect(content).toBe("# Custom Topic\n\nSome content");
	});
});

describe("appendLibraryTopic", () => {
	it("appends entry with double newline separator", () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		const filePath = join(basePath, "library", "pitfalls.md");
		writeFileSync(filePath, "# Pitfalls\n\nFirst entry");
		appendLibraryTopic(basePath, "pitfalls", "Second entry");
		const content = readFileSync(filePath, "utf8");
		expect(content).toBe("# Pitfalls\n\nFirst entry\n\nSecond entry");
	});

	it("appends to header-only file (empty body)", () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		const filePath = join(basePath, "library", "pitfalls.md");
		const header = readFileSync(filePath, "utf8");
		appendLibraryTopic(basePath, "pitfalls", "First pitfall");
		const content = readFileSync(filePath, "utf8");
		expect(content).toBe(`${header}\n\nFirst pitfall`);
	});

	it("appends multiple entries sequentially", () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		const filePath = join(basePath, "library", "pitfalls.md");
		writeFileSync(filePath, "# Pitfalls\n\nBase");
		appendLibraryTopic(basePath, "pitfalls", "Entry A");
		appendLibraryTopic(basePath, "pitfalls", "Entry B");
		const content = readFileSync(filePath, "utf8");
		expect(content).toBe("# Pitfalls\n\nBase\n\nEntry A\n\nEntry B");
	});
});

describe("topic name validation", () => {
	it("rejects path traversal with ..", () => {
		const basePath = makeBasePath();
		expect(() => readLibraryTopic(basePath, "../../../etc/passwd")).toThrow(/invalid topic name/i);
	});

	it("rejects path traversal with slash", () => {
		const basePath = makeBasePath();
		expect(() => readLibraryTopic(basePath, "foo/bar")).toThrow(/invalid topic name/i);
	});

	it("rejects path traversal with backslash", () => {
		const basePath = makeBasePath();
		expect(() => readLibraryTopic(basePath, "foo\\bar")).toThrow(/invalid topic name/i);
	});

	it("rejects topic name with spaces", () => {
		const basePath = makeBasePath();
		expect(() => writeLibraryTopic(basePath, "my topic", "content")).toThrow(/invalid topic name/i);
	});

	it("rejects topic name with special characters", () => {
		const basePath = makeBasePath();
		expect(() => writeLibraryTopic(basePath, "topic!@#", "content")).toThrow(/invalid topic name/i);
	});

	it("accepts alphanumeric topic names", () => {
		const basePath = makeBasePath();
		expect(() => writeLibraryTopic(basePath, "mypitfalls", "content")).not.toThrow();
	});

	it("accepts hyphenated topic names", () => {
		const basePath = makeBasePath();
		expect(() => writeLibraryTopic(basePath, "my-pitfalls", "content")).not.toThrow();
	});

	it("validates topic name on readLibraryTopic", () => {
		const basePath = makeBasePath();
		expect(() => readLibraryTopic(basePath, "../secret")).toThrow(/invalid topic name/i);
	});

	it("validates topic name on writeLibraryTopic", () => {
		const basePath = makeBasePath();
		expect(() => writeLibraryTopic(basePath, "../../etc/passwd", "content")).toThrow(/invalid topic name/i);
	});

	it("validates topic name on appendLibraryTopic", () => {
		const basePath = makeBasePath();
		expect(() => appendLibraryTopic(basePath, "../../../etc/passwd", "entry")).toThrow(/invalid topic name/i);
	});
});

describe("library content persistence", () => {
	it("content persists across simulated sessions", () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		writeLibraryTopic(basePath, "pitfalls", "# Pitfalls\n\nAlways run migrations before seeding");
		const content = readLibraryTopic(basePath, "pitfalls");
		expect(content).toBe("# Pitfalls\n\nAlways run migrations before seeding");
	});
});

describe("library files are valid markdown", () => {
	it("default topic files contain valid UTF-8 with H1 header", () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		for (const topic of DEFAULT_TOPICS) {
			const content = readFileSync(join(basePath, "library", `${topic}.md`), "utf8");
			expect(content).not.toContain("\0");
			const header = `# ${topic.charAt(0).toUpperCase() + topic.slice(1)}`;
			expect(content.startsWith(header)).toBe(true);
		}
	});

	it("written content produces valid markdown", () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		writeLibraryTopic(basePath, "architecture", "# Architecture\n\n## Section\n\nContent here");
		const content = readFileSync(join(basePath, "library", "architecture.md"), "utf8");
		expect(content).not.toContain("\0");
		expect(content.startsWith("# Architecture")).toBe(true);
	});

	it("appended content produces valid markdown", () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		appendLibraryTopic(basePath, "pitfalls", "- Never use global state");
		const content = readFileSync(join(basePath, "library", "pitfalls.md"), "utf8");
		expect(content).not.toContain("\0");
		expect(content.startsWith("# Pitfalls")).toBe(true);
		expect(content).toContain("- Never use global state");
	});
});
