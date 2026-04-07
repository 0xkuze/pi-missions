import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { initLibrary } from "../../extensions/state/library.js";
import type { MockPi } from "../helpers/index.js";
import { createMockPi } from "../helpers/index.js";
import type { TempDir } from "../helpers/index.js";
import { createTempDir } from "../helpers/index.js";
import {
	registerWebSearchTool,
	searchWeb,
	type SearchResult,
	type SearchResponse,
	parseSearchResults,
	formatResultsAsText,
	saveResultsToLibrary,
} from "../../extensions/tools/web-search.js";

let tmp: TempDir;

function makeBasePath(): string {
	const dir = join(tmp.path, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

beforeEach(() => {
	tmp = createTempDir("pi-missions-web-search-");
});

afterEach(() => {
	tmp.cleanup();
});

async function callTool(
	mockPi: MockPi,
	params: { query: string; maxResults?: number; saveToLibrary?: boolean },
	fetchOverride?: (url: string) => Promise<Response>,
) {
	const tool = mockPi.getRegisteredTool("web_search");
	if (!tool) throw new Error("web_search tool not registered");
	const deps = fetchOverride ? { basePath: makeBasePath(), fetchFn: fetchOverride } : { basePath: makeBasePath() };
	return tool.execute("tc-1", params, undefined, undefined, undefined as never);
}

function registerWithFetch(mockPi: MockPi, basePath: string, fetchFn?: (url: string) => Promise<Response>) {
	registerWebSearchTool(mockPi.pi, { basePath, fetchFn });
}

function mockFetchSuccess(results: SearchResult[]): (url: string) => Promise<Response> {
	return (_url: string) =>
		Promise.resolve(
			new Response(JSON.stringify({ results }), { status: 200, headers: { "Content-Type": "application/json" } }),
		);
}

function mockFetchEmpty(): (url: string) => Promise<Response> {
	return (_url: string) =>
		Promise.resolve(
			new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } }),
		);
}

function mockFetchError(status: number): (url: string) => Promise<Response> {
	return (_url: string) => Promise.resolve(new Response("Error", { status }));
}

function mockFetchThrow(error: Error): (url: string) => Promise<Response> {
	return (_url: string) => {
		throw error;
	};
}

describe("web_search tool registration (VAL-SEARCH-001)", () => {
	it("registers web_search tool via registerTool", () => {
		const mockPi = createMockPi();
		registerWebSearchTool(mockPi.pi, { basePath: makeBasePath() });
		const tool = mockPi.getRegisteredTool("web_search");
		expect(tool).toBeDefined();
		expect(tool!.name).toBe("web_search");
	});

	it("has correct TypeBox parameter schema with required query and optional fields", () => {
		const mockPi = createMockPi();
		registerWebSearchTool(mockPi.pi, { basePath: makeBasePath() });
		const tool = mockPi.getRegisteredTool("web_search");
		expect(tool).toBeDefined();

		const schema = tool!.parameters as ReturnType<typeof Type.Object>;

		const validMinimal = { query: "test" };
		expect(Value.Check(schema, validMinimal)).toBe(true);

		const validFull = { query: "test", maxResults: 10, saveToLibrary: true };
		expect(Value.Check(schema, validFull)).toBe(true);

		const missingQuery = {};
		expect(Value.Check(schema, missingQuery)).toBe(false);

		const wrongQueryType = { query: 123 };
		expect(Value.Check(schema, wrongQueryType)).toBe(false);

		const wrongMaxResultsType = { query: "test", maxResults: "five" };
		expect(Value.Check(schema, wrongMaxResultsType)).toBe(false);

		const wrongSaveType = { query: "test", saveToLibrary: "yes" };
		expect(Value.Check(schema, wrongSaveType)).toBe(false);
	});

	it("has promptSnippet property", () => {
		const mockPi = createMockPi();
		registerWebSearchTool(mockPi.pi, { basePath: makeBasePath() });
		const tool = mockPi.getRegisteredTool("web_search");
		expect(tool!.promptSnippet).toBeDefined();
	});
});

describe("searchWeb function (VAL-SEARCH-002)", () => {
	it("returns structured results with title, url, and snippet", async () => {
		const mockResults: SearchResult[] = [
			{ title: "Test Result", url: "https://example.com", snippet: "A test snippet" },
			{ title: "Another Result", url: "https://example.org", snippet: "Another snippet" },
		];
		const response = await searchWeb("test query", 5, mockFetchSuccess(mockResults));
		expect(response.results).toHaveLength(2);
		expect(response.results[0].title).toBe("Test Result");
		expect(response.results[0].url).toBe("https://example.com");
		expect(response.results[0].snippet).toBe("A test snippet");
		expect(response.results[1].title).toBe("Another Result");
	});

	it("uses default maxResults of 5 when not specified", async () => {
		const manyResults = Array.from({ length: 10 }, (_, i) => ({
			title: `Result ${i}`,
			url: `https://example.com/${i}`,
			snippet: `Snippet ${i}`,
		}));
		const response = await searchWeb("test", undefined, mockFetchSuccess(manyResults));
		expect(response.results).toHaveLength(5);
	});

	it("respects maxResults parameter", async () => {
		const manyResults = Array.from({ length: 10 }, (_, i) => ({
			title: `Result ${i}`,
			url: `https://example.com/${i}`,
			snippet: `Snippet ${i}`,
		}));
		const response = await searchWeb("test", 3, mockFetchSuccess(manyResults));
		expect(response.results).toHaveLength(3);
	});
});

describe("web_search tool returns formatted content (VAL-SEARCH-002)", () => {
	it("returns formatted results as tool content", async () => {
		const basePath = makeBasePath();
		const mockPi = createMockPi();
		const mockResults: SearchResult[] = [
			{ title: "Test Result", url: "https://example.com", snippet: "A test snippet" },
		];
		registerWebSearchTool(mockPi.pi, { basePath, fetchFn: mockFetchSuccess(mockResults) });

		const tool = mockPi.getRegisteredTool("web_search")!;
		const result = await tool.execute("tc-1", { query: "test query" }, undefined, undefined, undefined as never);

		expect(result.content[0].text).toContain("Test Result");
		expect(result.content[0].text).toContain("https://example.com");
		expect(result.content[0].text).toContain("A test snippet");
	});

	it("returns structured results array in details", async () => {
		const basePath = makeBasePath();
		const mockPi = createMockPi();
		const mockResults: SearchResult[] = [
			{ title: "Test Result", url: "https://example.com", snippet: "A test snippet" },
		];
		registerWebSearchTool(mockPi.pi, { basePath, fetchFn: mockFetchSuccess(mockResults) });

		const tool = mockPi.getRegisteredTool("web_search")!;
		const result = await tool.execute("tc-1", { query: "test query" }, undefined, undefined, undefined as never);

		expect(result.details).toBeDefined();
		const details = result.details as { results: SearchResult[] };
		expect(details.results).toHaveLength(1);
		expect(details.results[0].title).toBe("Test Result");
		expect(details.results[0].url).toBe("https://example.com");
		expect(details.results[0].snippet).toBe("A test snippet");
	});
});

describe("saveResultsToLibrary (VAL-SEARCH-003)", () => {
	it("saves results to library/research.md when saveToLibrary is true", async () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		const mockPi = createMockPi();
		const mockResults: SearchResult[] = [
			{ title: "TypeScript Best Practices", url: "https://example.com/ts", snippet: "Use strict mode" },
			{ title: "Node.js Tips", url: "https://example.com/node", snippet: "Use async/await" },
		];
		registerWebSearchTool(mockPi.pi, { basePath, fetchFn: mockFetchSuccess(mockResults) });

		const tool = mockPi.getRegisteredTool("web_search")!;
		await tool.execute(
			"tc-1",
			{ query: "typescript best practices", saveToLibrary: true },
			undefined,
			undefined,
			undefined as never,
		);

		const researchPath = join(basePath, "library", "research.md");
		expect(existsSync(researchPath)).toBe(true);
		const content = readFileSync(researchPath, "utf8");
		expect(content).toContain("typescript best practices");
		expect(content).toContain("TypeScript Best Practices");
		expect(content).toContain("https://example.com/ts");
		expect(content).toContain("Use strict mode");
		expect(content).toContain("Node.js Tips");
		expect(content).toContain("https://example.com/node");
	});

	it("does not modify research.md when saveToLibrary is false", async () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		const researchPath = join(basePath, "library", "research.md");
		const originalContent = readFileSync(researchPath, "utf8");

		const mockPi = createMockPi();
		const mockResults: SearchResult[] = [
			{ title: "Test Result", url: "https://example.com", snippet: "Test snippet" },
		];
		registerWebSearchTool(mockPi.pi, { basePath, fetchFn: mockFetchSuccess(mockResults) });

		const tool = mockPi.getRegisteredTool("web_search")!;
		await tool.execute("tc-1", { query: "test query" }, undefined, undefined, undefined as never);

		const contentAfter = readFileSync(researchPath, "utf8");
		expect(contentAfter).toBe(originalContent);
	});

	it("does not modify research.md when saveToLibrary is omitted", async () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		const researchPath = join(basePath, "library", "research.md");
		const originalContent = readFileSync(researchPath, "utf8");

		const mockPi = createMockPi();
		const mockResults: SearchResult[] = [
			{ title: "Test Result", url: "https://example.com", snippet: "Test snippet" },
		];
		registerWebSearchTool(mockPi.pi, { basePath, fetchFn: mockFetchSuccess(mockResults) });

		const tool = mockPi.getRegisteredTool("web_search")!;
		await tool.execute("tc-1", { query: "test query" }, undefined, undefined, undefined as never);

		const contentAfter = readFileSync(researchPath, "utf8");
		expect(contentAfter).toBe(originalContent);
	});

	it("appends to existing research.md content", async () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		const researchPath = join(basePath, "library", "research.md");
		writeFileSync(researchPath, "# Research\n\nExisting content");

		const mockPi = createMockPi();
		const mockResults: SearchResult[] = [
			{ title: "New Finding", url: "https://example.com/new", snippet: "New info" },
		];
		registerWebSearchTool(mockPi.pi, { basePath, fetchFn: mockFetchSuccess(mockResults) });

		const tool = mockPi.getRegisteredTool("web_search")!;
		await tool.execute(
			"tc-1",
			{ query: "new query", saveToLibrary: true },
			undefined,
			undefined,
			undefined as never,
		);

		const content = readFileSync(researchPath, "utf8");
		expect(content).toContain("Existing content");
		expect(content).toContain("New Finding");
		expect(content).toContain("https://example.com/new");
	});
});

describe("web_search handles network errors gracefully (VAL-SEARCH-005)", () => {
	it("returns error result on network failure (not thrown exception)", async () => {
		const basePath = makeBasePath();
		const mockPi = createMockPi();
		registerWebSearchTool(mockPi.pi, {
			basePath,
			fetchFn: mockFetchThrow(new Error("DNS lookup failed")),
		});

		const tool = mockPi.getRegisteredTool("web_search")!;
		const result = await tool.execute("tc-1", { query: "test" }, undefined, undefined, undefined as never);

		expect(result.content[0].text).toMatch(/search failed/i);
		expect(result.content[0].text).toContain("DNS lookup failed");
		expect(result.details).toBeDefined();
		const details = result.details as { error: boolean };
		expect(details.error).toBe(true);
	});

	it("returns error result on HTTP error status", async () => {
		const basePath = makeBasePath();
		const mockPi = createMockPi();
		registerWebSearchTool(mockPi.pi, {
			basePath,
			fetchFn: mockFetchError(500),
		});

		const tool = mockPi.getRegisteredTool("web_search")!;
		const result = await tool.execute("tc-1", { query: "test" }, undefined, undefined, undefined as never);

		expect(result.content[0].text).toMatch(/search failed/i);
		expect(result.content[0].text).toContain("500");
	});

	it("handles HTTP 429 rate limiting with descriptive error", async () => {
		const basePath = makeBasePath();
		const mockPi = createMockPi();
		registerWebSearchTool(mockPi.pi, {
			basePath,
			fetchFn: mockFetchError(429),
		});

		const tool = mockPi.getRegisteredTool("web_search")!;
		const result = await tool.execute("tc-1", { query: "test" }, undefined, undefined, undefined as never);

		expect(result.content[0].text).toMatch(/rate/i);
		expect(result.content[0].text).toMatch(/429/);
	});

	it("handles timeout errors gracefully", async () => {
		const basePath = makeBasePath();
		const mockPi = createMockPi();
		const timeoutFetch = (_url: string) =>
			Promise.reject(new DOMException("The operation was aborted", "AbortError"));

		registerWebSearchTool(mockPi.pi, { basePath, fetchFn: timeoutFetch });

		const tool = mockPi.getRegisteredTool("web_search")!;
		const result = await tool.execute("tc-1", { query: "test" }, undefined, undefined, undefined as never);

		expect(result.content[0].text).toMatch(/search failed/i);
	});
});

describe("web_search handles empty results (VAL-SEARCH-006)", () => {
	it("returns success with no-results message when search returns empty", async () => {
		const basePath = makeBasePath();
		const mockPi = createMockPi();
		registerWebSearchTool(mockPi.pi, { basePath, fetchFn: mockFetchEmpty() });

		const tool = mockPi.getRegisteredTool("web_search")!;
		const result = await tool.execute("tc-1", { query: "obscure query" }, undefined, undefined, undefined as never);

		expect(result.content[0].text).toMatch(/no results/i);
		expect(result.details).toBeDefined();
		const details = result.details as { results: SearchResult[] };
		expect(details.results).toHaveLength(0);
	});

	it("does not contain error message for empty results", async () => {
		const basePath = makeBasePath();
		const mockPi = createMockPi();
		registerWebSearchTool(mockPi.pi, { basePath, fetchFn: mockFetchEmpty() });

		const tool = mockPi.getRegisteredTool("web_search")!;
		const result = await tool.execute("tc-1", { query: "obscure query" }, undefined, undefined, undefined as never);

		expect(result.content[0].text).not.toMatch(/^Error:/);
	});
});

describe("parseSearchResults", () => {
	it("parses valid search response JSON", () => {
		const response: SearchResponse = {
			results: [
				{ title: "Result 1", url: "https://a.com", snippet: "Snip 1" },
				{ title: "Result 2", url: "https://b.com", snippet: "Snip 2" },
			],
		};
		const parsed = parseSearchResults(JSON.stringify(response));
		expect(parsed).toHaveLength(2);
		expect(parsed[0].title).toBe("Result 1");
		expect(parsed[1].url).toBe("https://b.com");
	});

	it("returns empty array for malformed JSON", () => {
		const parsed = parseSearchResults("not json");
		expect(parsed).toEqual([]);
	});

	it("returns empty array for JSON without results field", () => {
		const parsed = parseSearchResults(JSON.stringify({ data: [] }));
		expect(parsed).toEqual([]);
	});

	it("filters results missing required fields", () => {
		const response = {
			results: [
				{ title: "Good", url: "https://a.com", snippet: "Ok" },
				{ title: "No URL", snippet: "Missing url" },
				{ url: "https://c.com", snippet: "Missing title" },
			],
		};
		const parsed = parseSearchResults(JSON.stringify(response));
		expect(parsed).toHaveLength(1);
		expect(parsed[0].title).toBe("Good");
	});

	it("limits results to maxResults", () => {
		const results = Array.from({ length: 10 }, (_, i) => ({
			title: `R${i}`,
			url: `https://${i}.com`,
			snippet: `S${i}`,
		}));
		const response = { results };
		const parsed = parseSearchResults(JSON.stringify(response), 3);
		expect(parsed).toHaveLength(3);
	});
});

describe("formatResultsAsText", () => {
	it("formats results with numbered list", () => {
		const results: SearchResult[] = [
			{ title: "First", url: "https://a.com", snippet: "Snip A" },
			{ title: "Second", url: "https://b.com", snippet: "Snip B" },
		];
		const text = formatResultsAsText(results, "test query");
		expect(text).toContain("test query");
		expect(text).toContain("1.");
		expect(text).toContain("First");
		expect(text).toContain("https://a.com");
		expect(text).toContain("Snip A");
		expect(text).toContain("2.");
		expect(text).toContain("Second");
	});

	it("returns no-results message for empty array", () => {
		const text = formatResultsAsText([], "obscure query");
		expect(text).toMatch(/no results/i);
	});
});

describe("saveResultsToLibrary function", () => {
	it("formats markdown with query header, results list, and timestamps", () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		const results: SearchResult[] = [
			{ title: "TypeScript Guide", url: "https://typescriptlang.org", snippet: "Learn TypeScript" },
		];
		saveResultsToLibrary(basePath, "typescript guide", results);

		const content = readFileSync(join(basePath, "library", "research.md"), "utf8");
		expect(content).toContain("## Web Search: typescript guide");
		expect(content).toContain("TypeScript Guide");
		expect(content).toContain("https://typescriptlang.org");
		expect(content).toContain("Learn TypeScript");
	});

	it("appends to existing research.md", () => {
		const basePath = makeBasePath();
		initLibrary(basePath);
		writeFileSync(join(basePath, "library", "research.md"), "# Research\n\nPrevious findings");

		saveResultsToLibrary(basePath, "new topic", [
			{ title: "New", url: "https://new.com", snippet: "New info" },
		]);

		const content = readFileSync(join(basePath, "library", "research.md"), "utf8");
		expect(content).toContain("Previous findings");
		expect(content).toContain("New");
	});
});
