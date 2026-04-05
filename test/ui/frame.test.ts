import { describe, expect, it } from "bun:test";
import { visibleWidth } from "@mariozechner/pi-tui";
import { frame, section } from "../../extensions/ui/frame.js";

describe("frame", () => {
	it("produces correct border characters", () => {
		const lines = frame("Title", ["hello"], 40);
		const text = lines.join("\n");
		expect(text).toContain("\u250c");
		expect(text).toContain("\u2510");
		expect(text).toContain("\u2514");
		expect(text).toContain("\u2518");
		expect(text).toContain("\u2500");
		expect(text).toContain("\u2502");
	});

	it("title appears in top border", () => {
		const lines = frame("My Title", ["content"], 40);
		expect(lines[0]).toContain("My Title");
		expect(lines[0]!.startsWith("\u250c")).toBe(true);
		expect(lines[0]!.endsWith("\u2510")).toBe(true);
	});

	it("content is padded with 2 spaces inside borders", () => {
		const lines = frame("T", ["hello"], 40);
		const contentLine = lines.find((l) => l.includes("hello"));
		expect(contentLine).toBeDefined();
		expect(contentLine!.startsWith("\u2502  ")).toBe(true);
		expect(contentLine!.endsWith("\u2502")).toBe(true);
	});

	it("has empty lines for top and bottom padding", () => {
		const lines = frame("T", ["content"], 40);
		const emptyPadding = lines[1];
		expect(emptyPadding!.startsWith("\u2502")).toBe(true);
		expect(emptyPadding!.endsWith("\u2502")).toBe(true);
		const innerTop = emptyPadding!.slice(1, -1);
		expect(innerTop.trim()).toBe("");
		const bottomPadding = lines[lines.length - 2];
		const innerBottom = bottomPadding!.slice(1, -1);
		expect(innerBottom.trim()).toBe("");
	});

	it("footer appears in bottom border", () => {
		const lines = frame("T", ["content"], 40, "A: approve   Esc: close");
		const bottom = lines[lines.length - 1];
		expect(bottom).toContain("A: approve   Esc: close");
		expect(bottom!.startsWith("\u2514")).toBe(true);
		expect(bottom!.endsWith("\u2518")).toBe(true);
	});

	it("bottom border has no footer text when footer not provided", () => {
		const lines = frame("T", ["content"], 40);
		const bottom = lines[lines.length - 1];
		expect(bottom!.startsWith("\u2514")).toBe(true);
		expect(bottom!.endsWith("\u2518")).toBe(true);
		const inner = bottom!.slice(1, -1);
		expect(inner).toMatch(/^\u2500+$/);
	});

	it("long lines are truncated to fit width", () => {
		const longLine = "x".repeat(200);
		const lines = frame("T", [longLine], 40);
		const contentLine = lines.find((l) => l.includes("x"));
		expect(contentLine).toBeDefined();
		expect(visibleWidth(contentLine!)).toBeLessThanOrEqual(40);
	});

	it("empty content produces valid frame", () => {
		const lines = frame("T", [], 40);
		expect(lines.length).toBeGreaterThanOrEqual(4);
		expect(lines[0]!.startsWith("\u250c")).toBe(true);
		expect(lines[lines.length - 1]!.startsWith("\u2514")).toBe(true);
	});

	it("returns empty array for very small width", () => {
		const lines = frame("T", ["a"], 4);
		expect(lines.length).toBeGreaterThanOrEqual(0);
	});

	it("handles multiple content lines", () => {
		const lines = frame("T", ["line 1", "line 2", "line 3"], 40);
		const text = lines.join("\n");
		expect(text).toContain("line 1");
		expect(text).toContain("line 2");
		expect(text).toContain("line 3");
	});
});

describe("section", () => {
	it("produces correct separator with title", () => {
		const line = section("My Section", 40);
		expect(line).toContain("My Section");
		expect(line).toContain("\u2500");
	});

	it("starts with ── characters", () => {
		const line = section("Title", 40);
		expect(line.startsWith("\u2500\u2500")).toBe(true);
	});

	it("has trailing ─ fill", () => {
		const line = section("T", 40);
		expect(line.endsWith("\u2500")).toBe(true);
	});
});
