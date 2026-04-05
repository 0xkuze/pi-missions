import { describe, expect, it } from "bun:test";
import { formatDuration, generateId, nowISO } from "./utils.js";

describe("generateId", () => {
	it("returns a 12-character string", () => {
		const id = generateId();
		expect(id).toHaveLength(12);
	});

	it("returns unique values", () => {
		const ids = new Set(Array.from({ length: 100 }, () => generateId()));
		expect(ids.size).toBe(100);
	});
});

describe("formatDuration", () => {
	it("formats seconds", () => {
		expect(formatDuration(5000)).toBe("5s");
	});

	it("formats minutes and seconds", () => {
		expect(formatDuration(150000)).toBe("2m 30s");
	});

	it("formats minutes only when no remaining seconds", () => {
		expect(formatDuration(120000)).toBe("2m");
	});

	it("formats hours and minutes", () => {
		expect(formatDuration(5040000)).toBe("1h 24m");
	});

	it("formats hours only when no remaining minutes", () => {
		expect(formatDuration(3600000)).toBe("1h");
	});
});

describe("nowISO", () => {
	it("returns a valid ISO 8601 string", () => {
		const iso = nowISO();
		expect(() => new Date(iso)).not.toThrow();
		expect(new Date(iso).toISOString()).toBe(iso);
	});
});
