import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

const BOX_TL = "\u250c";
const BOX_TR = "\u2510";
const BOX_BL = "\u2514";
const BOX_BR = "\u2518";
const BOX_H = "\u2500";
const BOX_V = "\u2502";

function padOrTruncate(line: string, contentWidth: number): string {
	const vw = visibleWidth(line);
	if (vw > contentWidth) {
		return truncateToWidth(line, contentWidth);
	}
	return line + " ".repeat(contentWidth - vw);
}

export function frame(title: string, lines: string[], width: number, footerLine?: string): string[] {
	const contentWidth = width - 4;
	if (contentWidth < 1) {
		return [];
	}

	const titleText = ` ${title} `;
	const titleVW = visibleWidth(titleText);
	const topFill = Math.max(0, width - 2 - titleVW);
	const topBorder = `${BOX_TL}${BOX_H}${titleText}${BOX_H.repeat(topFill)}${BOX_TR}`;

	let bottomBorder: string;
	if (footerLine) {
		const footerText = ` ${footerLine} `;
		const footerVW = visibleWidth(footerText);
		const bottomFill = Math.max(0, width - 2 - footerVW);
		bottomBorder = `${BOX_BL}${BOX_H}${footerText}${BOX_H.repeat(bottomFill)}${BOX_BR}`;
	} else {
		bottomBorder = `${BOX_BL}${BOX_H.repeat(width - 2)}${BOX_BR}`;
	}

	const emptyLine = `${BOX_V}  ${" ".repeat(contentWidth)}${BOX_V}`;

	const result: string[] = [topBorder, emptyLine];

	for (const line of lines) {
		result.push(`${BOX_V}  ${padOrTruncate(line, contentWidth)}${BOX_V}`);
	}

	result.push(emptyLine, bottomBorder);

	return result;
}

export function section(title: string, contentWidth: number): string {
	const label = ` ${title} `;
	const labelVW = visibleWidth(label);
	const fill = Math.max(0, contentWidth - 2 - labelVW);
	return `${BOX_H}${BOX_H}${label}${BOX_H.repeat(fill)}`;
}
