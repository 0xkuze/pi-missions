import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

const BOX_TL = "\u250c";
const BOX_TR = "\u2510";
const BOX_BL = "\u2514";
const BOX_BR = "\u2518";
const BOX_H = "\u2500";
const BOX_V = "\u2502";

export interface FrameStyle {
	bgFn?: (text: string) => string;
	borderFn?: (text: string) => string;
	titleFn?: (text: string) => string;
	accentFn?: (text: string) => string;
	successFn?: (text: string) => string;
	errorFn?: (text: string) => string;
	warningFn?: (text: string) => string;
	mutedFn?: (text: string) => string;
	textFn?: (text: string) => string;
	boldFn?: (text: string) => string;
}

// why: pi Theme uses branded union types for color parameters; we accept `any` at this boundary
export function themeFrameStyle(theme: {
	fg: (...args: any[]) => string;
	bg: (...args: any[]) => string;
	bold: (text: string) => string;
}): FrameStyle {
	return {
		bgFn: (t) => theme.bg("customMessageBg", t),
		borderFn: (t) => theme.fg("borderMuted", t),
		titleFn: (t) => theme.bold(theme.fg("text", t)),
		accentFn: (t) => theme.bold(theme.fg("accent", t)),
		successFn: (t) => theme.fg("success", t),
		errorFn: (t) => theme.fg("error", t),
		warningFn: (t) => theme.fg("warning", t),
		mutedFn: (t) => theme.fg("muted", t),
		textFn: (t) => theme.fg("text", t),
		boldFn: (t) => theme.bold(t),
	};
}

function padOrTruncate(line: string, contentWidth: number): string {
	const vw = visibleWidth(line);
	if (vw > contentWidth) {
		return truncateToWidth(line, contentWidth);
	}
	return line + " ".repeat(contentWidth - vw);
}

function applyBg(line: string, width: number, bgFn: (text: string) => string): string {
	const vw = visibleWidth(line);
	const padded = vw < width ? line + " ".repeat(width - vw) : line;
	return bgFn(padded);
}

const SHORTCUT_KEY_PATTERN = /([A-Za-z0-9]+(?:\+[A-Za-z0-9]+)*):/g;

function styleFooter(footerLine: string, accentFn?: (text: string) => string): string {
	if (!accentFn) return footerLine;
	return footerLine.replace(SHORTCUT_KEY_PATTERN, (_match, key) => `${accentFn(key)}:`);
}

export function frame(
	title: string,
	lines: string[],
	width: number,
	footerLine?: string,
	style?: FrameStyle,
): string[] {
	const contentWidth = width - 4;
	if (contentWidth < 1) {
		return [];
	}

	const b = style?.borderFn ?? ((t: string) => t);
	const tf = style?.titleFn ?? ((t: string) => t);

	const styledTitle = tf(title);
	const titleText = ` ${styledTitle} `;
	const titleVW = visibleWidth(titleText);
	const topFill = Math.max(0, width - 3 - titleVW);
	const topBorder = `${b(BOX_TL + BOX_H)}${titleText}${b(BOX_H.repeat(topFill) + BOX_TR)}`;

	let bottomBorder: string;
	if (footerLine) {
		const styledFooter = styleFooter(footerLine, style?.accentFn);
		const maxFooterVW = width - 5;
		const truncatedFooter = truncateToWidth(styledFooter, maxFooterVW);
		const footerText = ` ${truncatedFooter} `;
		const footerVW = visibleWidth(footerText);
		const bottomFill = Math.max(0, width - 3 - footerVW);
		bottomBorder = `${b(BOX_BL + BOX_H)}${footerText}${b(BOX_H.repeat(bottomFill) + BOX_BR)}`;
	} else {
		bottomBorder = b(`${BOX_BL}${BOX_H.repeat(width - 2)}${BOX_BR}`);
	}

	const emptyLine = `${b(BOX_V)}  ${" ".repeat(contentWidth)}${b(BOX_V)}`;

	const raw: string[] = [topBorder, emptyLine];

	for (const line of lines) {
		raw.push(`${b(BOX_V)}  ${padOrTruncate(line, contentWidth)}${b(BOX_V)}`);
	}

	raw.push(emptyLine, bottomBorder);

	if (!style?.bgFn) return raw;

	return raw.map((l) => applyBg(l, width, style.bgFn!));
}

export function section(title: string, contentWidth: number, style?: FrameStyle): string {
	const b = style?.borderFn ?? ((t: string) => t);
	const tf = style?.titleFn ?? ((t: string) => t);
	const label = ` ${tf(title)} `;
	const labelVW = visibleWidth(label);
	const fill = Math.max(0, contentWidth - 2 - labelVW);
	return `${b(BOX_H + BOX_H)}${label}${b(BOX_H.repeat(fill))}`;
}

export function sectionWithCount(title: string, count: string, contentWidth: number, style?: FrameStyle): string {
	const b = style?.borderFn ?? ((t: string) => t);
	const tf = style?.titleFn ?? ((t: string) => t);
	const mf = style?.mutedFn ?? ((t: string) => t);
	const label = ` ${tf(title)} `;
	const countLabel = ` ${mf(count)} `;
	const labelVW = visibleWidth(label);
	const countVW = visibleWidth(countLabel);
	const fill = Math.max(0, contentWidth - 2 - labelVW - countVW);
	return `${b(BOX_H + BOX_H)}${label}${b(BOX_H.repeat(fill))}${countLabel}`;
}

const IDENTITY_FN = (t: string) => t;

export function styledFeatureIcon(status: string, style?: FrameStyle): string {
	const icons: Record<string, { icon: string; fn?: (t: string) => string }> = {
		done: { icon: "\u2713", fn: style?.successFn },
		active: { icon: "\u25cf", fn: style?.accentFn },
		pending: { icon: "\u00b7", fn: style?.mutedFn },
		failed: { icon: "\u2717", fn: style?.errorFn },
		blocked: { icon: "\u2717", fn: style?.errorFn },
		skipped: { icon: "\u2013", fn: style?.mutedFn },
	};
	const entry = icons[status] ?? { icon: "\u00b7", fn: style?.mutedFn };
	const styled = entry.fn ? entry.fn(entry.icon) : entry.icon;
	return styled;
}

export function styledFeatureName(name: string, status: string, style?: FrameStyle): string {
	if (!style) return name;
	switch (status) {
		case "done":
			return (style.mutedFn ?? IDENTITY_FN)(name);
		case "active":
			return (style.accentFn ?? IDENTITY_FN)(name);
		case "failed":
		case "blocked":
			return (style.errorFn ?? IDENTITY_FN)(name);
		default:
			return (style.textFn ?? IDENTITY_FN)(name);
	}
}
