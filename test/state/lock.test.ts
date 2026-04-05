import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { acquireLock, isLocked, releaseLock, updateHeartbeat } from "../../extensions/state/lock.js";
import type { ActiveSession } from "../../extensions/types.js";

const TEST_DIR = join(import.meta.dir, "../../.test-lock-tmp");

function makeSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
	return {
		sessionId: "test-session-1",
		pid: process.pid,
		startedAt: new Date().toISOString(),
		lastHeartbeatAt: new Date().toISOString(),
		...overrides,
	};
}

beforeEach(() => {
	mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("acquireLock", () => {
	it("succeeds when no lock exists", () => {
		const session = makeSession();
		const result = acquireLock(TEST_DIR, session);
		expect(result).toBe(true);
		expect(existsSync(join(TEST_DIR, "lock"))).toBe(true);
		expect(existsSync(join(TEST_DIR, "active-session.json"))).toBe(true);
	});

	it("writes active-session.json with correct session info on success", () => {
		const session = makeSession({ sessionId: "my-session", pid: process.pid });
		acquireLock(TEST_DIR, session);
		const { session: loaded } = isLocked(TEST_DIR);
		expect(loaded?.sessionId).toBe("my-session");
		expect(loaded?.pid).toBe(process.pid);
	});

	it("fails when another live process holds the lock", () => {
		const session1 = makeSession({ sessionId: "session-1", pid: process.pid });
		acquireLock(TEST_DIR, session1);

		const session2 = makeSession({ sessionId: "session-2", pid: process.pid });
		const result = acquireLock(TEST_DIR, session2);
		expect(result).toBe(false);
	});

	it("allows takeover when owning PID is dead (stale lock)", () => {
		const deadPid = 999999999;
		const staleSession = makeSession({ sessionId: "old-session", pid: deadPid });
		acquireLock(TEST_DIR, staleSession);

		const newSession = makeSession({ sessionId: "new-session", pid: process.pid });
		const result = acquireLock(TEST_DIR, newSession);
		expect(result).toBe(true);

		const { session: loaded } = isLocked(TEST_DIR);
		expect(loaded?.sessionId).toBe("new-session");
	});

	it("same-session re-lock is idempotent", () => {
		const session = makeSession({ sessionId: "my-session" });
		const first = acquireLock(TEST_DIR, session);
		const second = acquireLock(TEST_DIR, session);
		expect(first).toBe(true);
		expect(second).toBe(true);
	});

	it("creates basePath directory on demand", () => {
		const nestedPath = join(TEST_DIR, "nested", "deep");
		const session = makeSession();
		const result = acquireLock(nestedPath, session);
		expect(result).toBe(true);
		expect(existsSync(nestedPath)).toBe(true);
	});
});

describe("releaseLock", () => {
	it("removes lock file and active-session.json", () => {
		const session = makeSession();
		acquireLock(TEST_DIR, session);
		expect(existsSync(join(TEST_DIR, "lock"))).toBe(true);

		releaseLock(TEST_DIR);
		expect(existsSync(join(TEST_DIR, "lock"))).toBe(false);
		expect(existsSync(join(TEST_DIR, "active-session.json"))).toBe(false);
	});

	it("is safe to call when no lock exists (no-op)", () => {
		expect(() => releaseLock(TEST_DIR)).not.toThrow();
	});

	it("allows re-acquiring lock after release", () => {
		const session1 = makeSession({ sessionId: "session-1" });
		acquireLock(TEST_DIR, session1);
		releaseLock(TEST_DIR);

		const session2 = makeSession({ sessionId: "session-2" });
		const result = acquireLock(TEST_DIR, session2);
		expect(result).toBe(true);

		const { session } = isLocked(TEST_DIR);
		expect(session?.sessionId).toBe("session-2");
	});
});

describe("isLocked", () => {
	it("returns locked:false when no lock exists", () => {
		const result = isLocked(TEST_DIR);
		expect(result.locked).toBe(false);
		expect(result.session).toBeUndefined();
	});

	it("returns locked:true with session info when locked", () => {
		const session = makeSession({ sessionId: "check-session" });
		acquireLock(TEST_DIR, session);

		const result = isLocked(TEST_DIR);
		expect(result.locked).toBe(true);
		expect(result.session?.sessionId).toBe("check-session");
		expect(result.session?.pid).toBe(process.pid);
	});

	it("returns locked:true even when active-session.json missing", () => {
		const session = makeSession();
		acquireLock(TEST_DIR, session);
		rmSync(join(TEST_DIR, "active-session.json"), { force: true });

		const result = isLocked(TEST_DIR);
		expect(result.locked).toBe(true);
		expect(result.session).toBeUndefined();
	});
});

describe("updateHeartbeat", () => {
	it("updates lastHeartbeatAt", async () => {
		const originalTime = new Date(Date.now() - 5000).toISOString();
		const session = makeSession({ lastHeartbeatAt: originalTime });
		acquireLock(TEST_DIR, session);

		await new Promise((resolve) => setTimeout(resolve, 5));
		updateHeartbeat(TEST_DIR);

		const { session: updated } = isLocked(TEST_DIR);
		expect(updated?.lastHeartbeatAt).not.toBe(originalTime);
		expect(new Date(updated!.lastHeartbeatAt).getTime()).toBeGreaterThan(new Date(originalTime).getTime());
	});

	it("preserves all other session fields", async () => {
		const session = makeSession({ sessionId: "heartbeat-session", pid: process.pid });
		acquireLock(TEST_DIR, session);

		updateHeartbeat(TEST_DIR);

		const { session: updated } = isLocked(TEST_DIR);
		expect(updated?.sessionId).toBe("heartbeat-session");
		expect(updated?.pid).toBe(process.pid);
	});

	it("is a no-op when no session file exists", () => {
		expect(() => updateHeartbeat(TEST_DIR)).not.toThrow();
	});
});
