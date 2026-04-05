import { describe, expect, it } from "bun:test";
import { visibleWidth } from "@mariozechner/pi-tui";
import { frame, section, sectionWithCount, styledFeatureIcon, styledFeatureName } from "../../extensions/ui/frame.js";

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

	it("starts with \u2500\u2500 characters", () => {
		const line = section("Title", 40);
		expect(line.startsWith("\u2500\u2500")).toBe(true);
	});

	it("has trailing \u2500 fill", () => {
		const line = section("T", 40);
		expect(line.endsWith("\u2500")).toBe(true);
	});
});

describe("sectionWithCount", () => {
	it("contains both title and count", () => {
		const line = sectionWithCount("Features", "16/20", 40);
		expect(line).toContain("Features");
		expect(line).toContain("16/20");
	});

	it("starts with \u2500\u2500 characters", () => {
		const line = sectionWithCount("Features", "5/10", 40);
		expect(line.startsWith("\u2500\u2500")).toBe(true);
	});

	it("has \u2500 fill between title and count", () => {
		const line = sectionWithCount("A", "1", 40);
		expect(line).toContain("\u2500");
	});

	it("applies style functions when provided", () => {
		const style = {
			borderFn: (t: string) => `[B${t}B]`,
			titleFn: (t: string) => `[T${t}T]`,
			mutedFn: (t: string) => `[M${t}M]`,
		};
		const line = sectionWithCount("Feat", "3/5", 60, style);
		expect(line).toContain("[TFeatT]");
		expect(line).toContain("[M3/5M]");
	});
});

describe("styledFeatureIcon", () => {
	it("returns \u2713 for done status", () => {
		expect(styledFeatureIcon("done")).toBe("\u2713");
	});

	it("returns \u25cf for active status", () => {
		expect(styledFeatureIcon("active")).toBe("\u25cf");
	});

	it("returns \u00b7 for pending status", () => {
		expect(styledFeatureIcon("pending")).toBe("\u00b7");
	});

	it("returns \u2717 for failed status", () => {
		expect(styledFeatureIcon("failed")).toBe("\u2717");
	});

	it("returns \u2717 for blocked status", () => {
		expect(styledFeatureIcon("blocked")).toBe("\u2717");
	});

	it("returns \u2013 for skipped status", () => {
		expect(styledFeatureIcon("skipped")).toBe("\u2013");
	});

	it("returns \u00b7 for unknown status", () => {
		expect(styledFeatureIcon("unknown")).toBe("\u00b7");
	});

	it("applies successFn for done status", () => {
		const style = { successFn: (t: string) => `[S${t}S]` };
		expect(styledFeatureIcon("done", style)).toBe("[S\u2713S]");
	});

	it("applies accentFn for active status", () => {
		const style = { accentFn: (t: string) => `[A${t}A]` };
		expect(styledFeatureIcon("active", style)).toBe("[A\u25cfA]");
	});

	it("applies errorFn for failed status", () => {
		const style = { errorFn: (t: string) => `[E${t}E]` };
		expect(styledFeatureIcon("failed", style)).toBe("[E\u2717E]");
	});
});

describe("styledFeatureName", () => {
	it("returns plain name when no style", () => {
		expect(styledFeatureName("my-feature", "done")).toBe("my-feature");
	});

	it("applies mutedFn for done status", () => {
		const style = { mutedFn: (t: string) => `[M${t}M]` };
		expect(styledFeatureName("feat", "done", style)).toBe("[MfeatM]");
	});

	it("applies accentFn for active status", () => {
		const style = { accentFn: (t: string) => `[A${t}A]` };
		expect(styledFeatureName("feat", "active", style)).toBe("[AfeatA]");
	});

	it("applies errorFn for failed status", () => {
		const style = { errorFn: (t: string) => `[E${t}E]` };
		expect(styledFeatureName("feat", "failed", style)).toBe("[EfeatE]");
	});

	it("applies errorFn for blocked status", () => {
		const style = { errorFn: (t: string) => `[E${t}E]` };
		expect(styledFeatureName("feat", "blocked", style)).toBe("[EfeatE]");
	});

	it("applies textFn for pending status", () => {
		const style = { textFn: (t: string) => `[T${t}T]` };
		expect(styledFeatureName("feat", "pending", style)).toBe("[TfeatT]");
	});
});
