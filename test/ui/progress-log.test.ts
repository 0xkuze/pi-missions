import { describe, expect, it } from "bun:test";
import type { ProgressEvent } from "../../extensions/types.js";
import { handleProgressLogKey, renderProgressLog } from "../../extensions/ui/progress-log.js";

function makeEvent(type: ProgressEvent["type"], detail: string, tsOffsetMs = 0): ProgressEvent {
	return {
		timestamp: new Date(Date.now() - tsOffsetMs).toISOString(),
		type,
		detail,
	};
}

describe("renderProgressLog (VAL-NEWUI-002)", () => {
	describe("empty log", () => {
		it("shows placeholder when no events", () => {
			const lines = renderProgressLog([]);
			const text = lines.join(" ");
			expect(text.length).toBeGreaterThan(0);
			expect(text).toMatch(/no events|empty|placeholder/i);
		});

		it("returns non-empty array for empty log", () => {
			const lines = renderProgressLog([]);
			expect(lines).toBeArray();
			expect(lines.length).toBeGreaterThan(0);
		});
	});

	describe("events rendering", () => {
		it("shows detail text for each event", () => {
			const events = [makeEvent("feature_complete", "jwt-tokens completed")];
			const lines = renderProgressLog(events);
			const text = lines.join(" ");
			expect(text).toContain("jwt-tokens completed");
		});

		it("shows relative timestamps", () => {
			const events = [makeEvent("feature_start", "feature started", 2 * 60_000)];
			const lines = renderProgressLog(events);
			const text = lines.join(" ");
			expect(text).toMatch(/\d+[smh]/);
		});

		it("shows events newest-to-oldest (descending timestamp order)", () => {
			const events: ProgressEvent[] = [
				makeEvent("feature_start", "feature 1 started", 300_000),
				makeEvent("feature_complete", "feature 1 done", 120_000),
				makeEvent("feature_start", "feature 2 started", 60_000),
			];
			const lines = renderProgressLog(events);
			const text = lines.join("\n");
			const idx1 = text.indexOf("feature 1 started");
			const idx2 = text.indexOf("feature 1 done");
			const idx3 = text.indexOf("feature 2 started");
			expect(idx3).toBeLessThan(idx2);
			expect(idx2).toBeLessThan(idx1);
		});

		it("shows status icons for completed events", () => {
			const events = [makeEvent("feature_complete", "done")];
			const lines = renderProgressLog(events);
			const text = lines.join(" ");
			expect(text).toContain("\u2713");
		});

		it("shows status icons for failed events", () => {
			const events = [makeEvent("feature_failed", "failed")];
			const lines = renderProgressLog(events);
			const text = lines.join(" ");
			expect(text).toContain("\u2717");
		});

		it("shows status icons for active/start events", () => {
			const events = [makeEvent("feature_start", "started")];
			const lines = renderProgressLog(events);
			const text = lines.join(" ");
			expect(text).toContain("\u25cf");
		});

		it("shows status icons for skipped events", () => {
			const events = [makeEvent("feature_skipped", "skipped")];
			const lines = renderProgressLog(events);
			const text = lines.join(" ");
			expect(text).toContain("\u2013");
		});

		it("shows multiple events", () => {
			const events = [
				makeEvent("feature_start", "started-feature", 10_000),
				makeEvent("feature_complete", "completed-feature", 5_000),
			];
			const lines = renderProgressLog(events);
			const text = lines.join(" ");
			expect(text).toContain("started-feature");
			expect(text).toContain("completed-feature");
		});

		it("shows Esc keyboard hint", () => {
			const events = [makeEvent("feature_complete", "done")];
			const lines = renderProgressLog(events);
			const text = lines.join(" ");
			expect(text).toContain("Esc");
		});

		it("shows heading", () => {
			const lines = renderProgressLog([]);
			const text = lines.join(" ");
			expect(text).toMatch(/progress|log/i);
		});
	});

	describe("event type icons coverage", () => {
		const completedTypes: ProgressEvent["type"][] = [
			"feature_complete",
			"milestone_complete",
			"validation_pass",
			"mission_complete",
		];
		for (const type of completedTypes) {
			it(`uses ✓ icon for ${type}`, () => {
				const lines = renderProgressLog([makeEvent(type, "detail")]);
				expect(lines.join(" ")).toContain("\u2713");
			});
		}

		const failedTypes: ProgressEvent["type"][] = ["feature_failed", "validation_fail", "mission_failed"];
		for (const type of failedTypes) {
			it(`uses ✗ icon for ${type}`, () => {
				const lines = renderProgressLog([makeEvent(type, "detail")]);
				expect(lines.join(" ")).toContain("\u2717");
			});
		}
	});
});

describe("handleProgressLogKey (VAL-NEWUI-002)", () => {
	it("returns close action for Esc key", () => {
		const action = handleProgressLogKey("\x1B");
		expect(action.kind).toBe("close");
	});

	it("returns noop for other keys", () => {
		const action = handleProgressLogKey("x");
		expect(action.kind).toBe("noop");
	});

	it("returns noop for letter keys", () => {
		for (const key of ["a", "b", "c", "l", "q"]) {
			expect(handleProgressLogKey(key).kind).toBe("noop");
		}
	});

	it("returns noop for numeric keys", () => {
		expect(handleProgressLogKey("1").kind).toBe("noop");
		expect(handleProgressLogKey("9").kind).toBe("noop");
	});
});
