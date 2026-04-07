import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { clearProtocolCache } from "../orchestrator/protocol.js";
import { appendLibraryTopic } from "../state/library.js";

const DEFAULT_MAX_RESULTS = 5;
const SEARCH_URL = "https://html.duckduckgo.com/html/";

interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

interface SearchResponse {
	results: SearchResult[];
}

function parseSearchResults(json: string, maxResults?: number): SearchResult[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return [];
	}
	if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as SearchResponse).results)) {
		return [];
	}
	const all = (parsed as SearchResponse).results.filter(
		(r): r is SearchResult =>
			typeof r === "object" &&
			r !== null &&
			typeof r.title === "string" &&
			typeof r.url === "string" &&
			typeof r.snippet === "string",
	);
	if (maxResults !== undefined && maxResults > 0) {
		return all.slice(0, maxResults);
	}
	return all;
}

function extractResultsFromHtml(html: string, maxResults: number): SearchResult[] {
	const results: SearchResult[] = [];
	const resultBlocks = html.split('<div class="result results_links results_links_deep web-result">');
	if (resultBlocks.length < 2) {
		const altBlocks = html.split('<div class="result results_links');
		for (let i = 1; i < altBlocks.length && results.length < maxResults; i++) {
			const block = altBlocks[i]!;
			const titleMatch = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
			const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/[at][^>]*>/);
			const urlMatch = block.match(/href="(\/\/duckduckgo\.com\/l\/\?uddg=([^"&]+))/);
			let url = "";
			if (urlMatch) {
				try {
					url = decodeURIComponent(urlMatch[2]!);
				} catch {
					url = "";
				}
			}
			if (titleMatch && url) {
				results.push({
					title: titleMatch[1]!.replace(/<[^>]*>/g, "").trim(),
					url,
					snippet: snippetMatch ? snippetMatch[1]!.replace(/<[^>]*>/g, "").trim() : "",
				});
			}
		}
		return results.slice(0, maxResults);
	}
	for (let i = 1; i < resultBlocks.length && results.length < maxResults; i++) {
		const block = resultBlocks[i]!;
		const titleMatch = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
		const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/[at][^>]*>/);
		const urlMatch = block.match(/href="(\/\/duckduckgo\.com\/l\/\?uddg=([^"&]+))/);
		let url = "";
		if (urlMatch) {
			try {
				url = decodeURIComponent(urlMatch[2]!);
			} catch {
				url = "";
			}
		}
		if (titleMatch && url) {
			results.push({
				title: titleMatch[1]!.replace(/<[^>]*>/g, "").trim(),
				url,
				snippet: snippetMatch ? snippetMatch[1]!.replace(/<[^>]*>/g, "").trim() : "",
			});
		}
	}
	return results.slice(0, maxResults);
}

async function searchWeb(
	query: string,
	maxResults?: number,
	fetchFn?: (url: string) => Promise<Response>,
): Promise<SearchResponse> {
	const effectiveMax = maxResults ?? DEFAULT_MAX_RESULTS;
	const fetch = fetchFn ?? globalThis.fetch;

	const formData = new URLSearchParams();
	formData.set("q", query);
	formData.set("b", "");

	const response = await fetch(`${SEARCH_URL}?${formData.toString()}`);

	if (!response.ok) {
		if (response.status === 429) {
			throw new Error(`Rate limited by search provider (HTTP 429). Please retry after a moment.`);
		}
		throw new Error(`Search request failed with HTTP ${response.status}`);
	}

	const contentType = response.headers.get("content-type") ?? "";
	const body = await response.text();

	if (contentType.includes("application/json")) {
		const results = parseSearchResults(body, effectiveMax);
		return { results };
	}

	const results = extractResultsFromHtml(body, effectiveMax);
	return { results };
}

function formatResultsAsText(results: SearchResult[], query: string): string {
	if (results.length === 0) {
		return `No results found for "${query}".`;
	}
	const lines: string[] = [`Search results for "${query}":`, ""];
	for (let i = 0; i < results.length; i++) {
		const r = results[i]!;
		lines.push(`${i + 1}. ${r.title}`);
		lines.push(`   ${r.url}`);
		if (r.snippet) {
			lines.push(`   ${r.snippet}`);
		}
		lines.push("");
	}
	return lines.join("\n");
}

function saveResultsToLibrary(basePath: string, query: string, results: SearchResult[]): void {
	if (results.length === 0) return;
	const lines: string[] = [`## Web Search: ${query}`, ""];
	for (const r of results) {
		lines.push(`- **${r.title}**`);
		lines.push(`  ${r.url}`);
		if (r.snippet) {
			lines.push(`  ${r.snippet}`);
		}
		lines.push("");
	}
	appendLibraryTopic(basePath, "research", lines.join("\n"));
	clearProtocolCache();
}

interface Deps {
	basePath: string;
	fetchFn?: (url: string) => Promise<Response>;
}

function registerWebSearchTool(pi: ExtensionAPI, deps: Deps): void {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web using DuckDuckGo. Returns a list of results with title, URL, and snippet. Optionally saves results to the library for future reference.",
		promptSnippet: "Search the web for documentation, APIs, or solutions.",
		parameters: Type.Object({
			query: Type.String({ description: "Search query string" }),
			maxResults: Type.Optional(
				Type.Number({ description: "Maximum number of results to return (default: 5)", default: 5 }),
			),
			saveToLibrary: Type.Optional(
				Type.Boolean({ description: "If true, append results to library/research.md", default: false }),
			),
		}),
		async execute(_toolCallId, params) {
			if (!params.query || params.query.trim() === "") {
				return {
					content: [{ type: "text", text: "Error: query must not be empty." }],
					details: { error: true, results: [] },
				};
			}

			const maxResults = params.maxResults ?? DEFAULT_MAX_RESULTS;

			try {
				const response = await searchWeb(params.query, maxResults, deps.fetchFn);

				if (params.saveToLibrary === true) {
					saveResultsToLibrary(deps.basePath, params.query, response.results);
				}

				const text = formatResultsAsText(response.results, params.query);
				return {
					content: [{ type: "text", text }],
					details: { error: false, results: response.results },
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Search failed: ${message}` }],
					details: { error: true, results: [] },
				};
			}
		},
	});
}

export {
	formatResultsAsText,
	parseSearchResults,
	registerWebSearchTool,
	type SearchResponse,
	type SearchResult,
	saveResultsToLibrary,
	searchWeb,
};
