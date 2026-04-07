import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TOPIC_NAME_RE = /^[a-zA-Z0-9-]+$/;
const MAX_CONTENT_LENGTH = 2000;
const TRUNCATION_MARKER = "...truncated";

const DEFAULT_TOPICS = [
	{ name: "architecture", header: "# Architecture" },
	{ name: "environment", header: "# Environment" },
	{ name: "pitfalls", header: "# Pitfalls" },
	{ name: "conventions", header: "# Conventions" },
	{ name: "research", header: "# Research" },
] as const;

function validateTopicName(topic: string): void {
	if (!TOPIC_NAME_RE.test(topic)) {
		throw new Error(`Invalid topic name: "${topic}". Only alphanumeric characters and hyphens are allowed.`);
	}
}

function libraryDir(basePath: string): string {
	return join(basePath, "library");
}

function topicPath(basePath: string, topic: string): string {
	return join(libraryDir(basePath), `${topic}.md`);
}

function truncateContent(content: string): string {
	if (content.length <= MAX_CONTENT_LENGTH) {
		return content;
	}
	return content.slice(0, MAX_CONTENT_LENGTH - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

function initLibrary(basePath: string): void {
	const dir = libraryDir(basePath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	for (const { name, header } of DEFAULT_TOPICS) {
		const filePath = join(dir, `${name}.md`);
		if (!existsSync(filePath)) {
			writeFileSync(filePath, `${header}\n`, "utf8");
		}
	}
}

function readLibraryTopic(basePath: string, topic: string): string | null {
	validateTopicName(topic);
	const filePath = topicPath(basePath, topic);
	if (!existsSync(filePath)) {
		return null;
	}
	const content = readFileSync(filePath, "utf8");
	return truncateContent(content);
}

function writeLibraryTopic(basePath: string, topic: string, content: string): void {
	validateTopicName(topic);
	const dir = libraryDir(basePath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	const filePath = join(dir, `${topic}.md`);
	writeFileSync(filePath, content, "utf8");
}

function appendLibraryTopic(basePath: string, topic: string, entry: string): void {
	validateTopicName(topic);
	const dir = libraryDir(basePath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	const filePath = join(dir, `${topic}.md`);
	const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
	const updated = existing ? `${existing}\n\n${entry}` : `${entry}`;
	writeFileSync(filePath, updated, "utf8");
}

export { appendLibraryTopic, initLibrary, readLibraryTopic, writeLibraryTopic };
