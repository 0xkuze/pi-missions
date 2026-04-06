import { homedir } from "node:os";
import { fuzzyFilter, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { MissionRegistryEntry } from "../state/registry.js";
import type { FrameStyle } from "./frame.js";
import { applyBg, footerBar, panel, section, titleBar } from "./frame.js";

export type MissionListAction =
	| { kind: "close" }
	| { kind: "new_mission" }
	| { kind: "select"; entryIndex: number }
	| { kind: "noop" };

export interface MissionListState {
	searchQuery: string;
	highlightedIndex: number;
	scrollOffset: number;
}

export function initialMissionListState(): MissionListState {
	return { searchQuery: "", highlightedIndex: 0, scrollOffset: 0 };
}

function relativeTime(iso: string): string {
	const diff = Date.now() - new Date(iso).getTime();
	const minutes = Math.floor(diff / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	const months = Math.floor(days / 30);
	return `${months}mo ago`;
}

function shortenPath(fullPath: string): string {
	const home = homedir();
	if (fullPath.startsWith(home)) return `~${fullPath.slice(home.length)}`;
	return fullPath;
}

function statusDisplay(status: string): { label: string; styleFn: keyof FrameStyle } {
	switch (status) {
		case "executing":
		case "validating":
			return { label: "Executing", styleFn: "accentFn" };
		case "planning":
		case "draft_review":
		case "approved":
			return { label: "Planning", styleFn: "accentFn" };
		case "paused":
			return { label: "Paused", styleFn: "warningFn" };
		case "completed":
			return { label: "Completed", styleFn: "successFn" };
		case "failed":
			return { label: "Failed", styleFn: "errorFn" };
		case "aborted":
			return { label: "Aborted", styleFn: "mutedFn" };
		default:
			return { label: status, styleFn: "mutedFn" };
	}
}

function filterEntries(entries: MissionRegistryEntry[], query: string): MissionRegistryEntry[] {
	if (!query) return entries;
	return fuzzyFilter(entries, query, (e) => `${e.description} ${e.projectPath} ${e.status}`);
}

function padRight(text: string, width: number): string {
	const vw = visibleWidth(text);
	if (vw >= width) return truncateToWidth(text, width);
	return text + " ".repeat(width - vw);
}

function buildContentLines(
	entries: MissionRegistryEntry[],
	currentProjectPath: string,
	viewState: MissionListState,
	contentWidth: number,
	style?: FrameStyle,
): string[] {
	const tf = style?.textFn ?? ((t: string) => t);
	const mf = style?.mutedFn ?? ((t: string) => t);
	const af = style?.accentFn ?? ((t: string) => t);
	const bf = style?.boldFn ?? ((t: string) => t);
	const b = style?.borderFn ?? ((t: string) => t);

	const lines: string[] = [];

	const cursor = viewState.searchQuery || "";
	const searchDisplay = cursor ? tf(cursor) : mf("Type to filter missions...");
	lines.push(`${mf("Search:")} ${searchDisplay}${af("\u2588")}`);
	lines.push("");

	const isNewMissionHighlighted = viewState.highlightedIndex === 0;
	const pointer = isNewMissionHighlighted ? af("\u25b8") : " ";
	const label = isNewMissionHighlighted ? af(bf("Begin new mission")) : tf("Begin new mission");
	lines.push(`${pointer} ${label}`);
	lines.push("");

	const filtered = filterEntries(entries, viewState.searchQuery);

	if (filtered.length > 0) {
		lines.push(section(`${filtered.length} mission${filtered.length !== 1 ? "s" : ""}`, contentWidth, style));
		lines.push("");

		const colState = 11;
		const colUpdated = 10;
		const colFeatures = 6;
		const sepVW = 3;
		const prefixVW = 3;
		const fixedVW = prefixVW + colState + sepVW + colUpdated + sepVW + colFeatures + sepVW + sepVW;
		const remaining = Math.max(10, contentWidth - fixedVW);
		const colTitle = Math.max(6, Math.floor(remaining * 0.6));
		const colPath = Math.max(4, remaining - colTitle);

		const styledSep = b("\u2502");
		const headerLine =
			`   ${padRight(mf("State"), colState)}` +
			` ${styledSep} ${padRight(mf("Updated"), colUpdated)}` +
			` ${styledSep} ${padRight(mf("Feat."), colFeatures)}` +
			` ${styledSep} ${padRight(mf("Title"), colTitle)}` +
			` ${styledSep} ${padRight(mf("Path"), colPath)}`;
		lines.push(truncateToWidth(headerLine, contentWidth));

		const d = "\u2500";
		const x = "\u253c";
		const sepLine = `${d.repeat(colState + 3)}${d}${x}${d}${d.repeat(colUpdated)}${d}${x}${d}${d.repeat(colFeatures)}${d}${x}${d}${d.repeat(colTitle)}${d}${x}${d}${d.repeat(colPath)}`;
		lines.push(truncateToWidth(b(sepLine), contentWidth));

		for (let i = 0; i < filtered.length; i++) {
			const entry = filtered[i]!;
			const listIdx = i + 1;
			const isHighlighted = viewState.highlightedIndex === listIdx;

			const { label: sLabel, styleFn } = statusDisplay(entry.status);
			const sfn = (style?.[styleFn] as ((t: string) => string) | undefined) ?? tf;

			const isCurrent = entry.projectPath === currentProjectPath;
			const dot = isCurrent ? sfn("\u25cf") : " ";
			const stateText = padRight(sfn(sLabel), colState);
			const updatedText = padRight(mf(relativeTime(entry.updatedAt)), colUpdated);
			const featuresText = padRight(tf(`${entry.featuresCompleted}/${entry.featuresTotal}`), colFeatures);
			const titleText = padRight(
				truncateToWidth(isHighlighted ? af(entry.description) : tf(entry.description), colTitle, ""),
				colTitle,
			);
			const pathText = padRight(truncateToWidth(mf(shortenPath(entry.projectPath)), colPath, ""), colPath);

			const row =
				`${dot} ${stateText}` +
				` ${styledSep} ${updatedText}` +
				` ${styledSep} ${featuresText}` +
				` ${styledSep} ${titleText}` +
				` ${styledSep} ${pathText}`;

			const prefix = isHighlighted ? af("\u25b8") : " ";
			lines.push(truncateToWidth(`${prefix}${row}`, contentWidth));
		}
	} else if (viewState.searchQuery) {
		lines.push("");
		lines.push(mf("  No matching missions."));
	} else {
		lines.push("");
		lines.push(mf("  No missions yet."));
		lines.push(mf('  Select "Begin new mission" to get started.'));
	}

	return lines;
}

export function renderMissionList(
	entries: MissionRegistryEntry[],
	currentProjectPath: string,
	viewState: MissionListState,
	width: number,
	height: number,
	style?: FrameStyle,
): string[] {
	const contentWidth = width - 4;
	const lines = buildContentLines(entries, currentProjectPath, viewState, contentWidth, style);

	const panelHeight = Math.max(5, height - 7);
	const bgFn = style?.bgFn;

	const title = titleBar("Missions", width, style);
	const panelLines = panel("Mission List", lines, width, panelHeight, viewState.scrollOffset, style);
	const footer = footerBar("Enter: select   Esc: close", width, style);

	const output = [title, ...panelLines, ...footer];
	if (bgFn) {
		return output.map((l) => applyBg(l, width, bgFn));
	}
	return output;
}

export function handleMissionListKey(
	key: string,
	viewState: MissionListState,
	totalEntries: number,
): { action: MissionListAction; nextState: MissionListState } {
	const maxIdx = totalEntries;

	if (matchesKey(key, "escape")) {
		return { action: { kind: "close" }, nextState: viewState };
	}

	if (matchesKey(key, "return")) {
		if (viewState.highlightedIndex === 0) {
			return { action: { kind: "new_mission" }, nextState: viewState };
		}
		const entryIndex = viewState.highlightedIndex - 1;
		return { action: { kind: "select", entryIndex }, nextState: viewState };
	}

	if (matchesKey(key, "up") || matchesKey(key, "k")) {
		const next = Math.max(0, viewState.highlightedIndex - 1);
		return {
			action: { kind: "noop" },
			nextState: { ...viewState, highlightedIndex: next },
		};
	}

	if (matchesKey(key, "down") || matchesKey(key, "j")) {
		const next = Math.min(maxIdx, viewState.highlightedIndex + 1);
		return {
			action: { kind: "noop" },
			nextState: { ...viewState, highlightedIndex: next },
		};
	}

	if (matchesKey(key, "pageUp")) {
		return {
			action: { kind: "noop" },
			nextState: { ...viewState, scrollOffset: Math.max(0, viewState.scrollOffset - 10) },
		};
	}

	if (matchesKey(key, "pageDown")) {
		return {
			action: { kind: "noop" },
			nextState: { ...viewState, scrollOffset: viewState.scrollOffset + 10 },
		};
	}

	if (matchesKey(key, "backspace")) {
		return {
			action: { kind: "noop" },
			nextState: { ...viewState, searchQuery: viewState.searchQuery.slice(0, -1), highlightedIndex: 0 },
		};
	}

	if (key.length === 1 && key >= " ") {
		return {
			action: { kind: "noop" },
			nextState: { ...viewState, searchQuery: viewState.searchQuery + key, highlightedIndex: 0 },
		};
	}

	return { action: { kind: "noop" }, nextState: viewState };
}
