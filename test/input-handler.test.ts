import { describe, expect, it } from "bun:test";
import { handleMissionInput } from "../extensions/input-handler.js";
import { makeState } from "./helpers/index.js";

describe("handleMissionInput", () => {
	it("returns continue when mission mode is not active", () => {
		const state = makeState({ status: "executing", currentFeatureId: "feat-1" });
		const result = handleMissionInput("do something", false, state);
		expect(result).toEqual({ action: "continue" });
	});

	it("returns continue when state is null", () => {
		const result = handleMissionInput("do something", true, null);
		expect(result).toEqual({ action: "continue" });
	});

	it("returns continue when status is not executing", () => {
		const state = makeState({ status: "planning" });
		const result = handleMissionInput("do something", true, state);
		expect(result).toEqual({ action: "continue" });
	});

	it("returns continue for completed status", () => {
		const state = makeState({ status: "completed" });
		const result = handleMissionInput("do something", true, state);
		expect(result).toEqual({ action: "continue" });
	});

	it("returns continue for draft_review status", () => {
		const state = makeState({ status: "draft_review" });
		const result = handleMissionInput("do something", true, state);
		expect(result).toEqual({ action: "continue" });
	});

	it("transforms text during executing with currentFeatureId", () => {
		const state = makeState({ status: "executing", currentFeatureId: "feat-1" });
		const result = handleMissionInput("please fix the bug", true, state);
		expect(result).toEqual({
			action: "transform",
			text: "[User instruction during mission execution] please fix the bug",
		});
	});

	it("returns continue during executing without currentFeatureId", () => {
		const state = makeState({ status: "executing", currentFeatureId: undefined });
		const result = handleMissionInput("do something", true, state);
		expect(result).toEqual({ action: "continue" });
	});

	it("preserves original text content in transform", () => {
		const state = makeState({ status: "executing", currentFeatureId: "feat-2" });
		const input = "multi\nline\ninput";
		const result = handleMissionInput(input, true, state);
		expect(result.action).toBe("transform");
		if (result.action === "transform") {
			expect(result.text).toContain(input);
		}
	});
});
