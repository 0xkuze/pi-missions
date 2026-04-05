import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { acquireLock, isLocked, releaseLock, updateHeartbeat } from "../../extensions/state/lock.js";
import type { TempDir } from "../helpers/index.js";
import { createTempDir, makeActiveSession } from "../helpers/index.js";

let tmp: TempDir;

beforeEach(() => {
	tmp = createTempDir("pi-missions-lock-");
});

afterEach(() => {
	tmp.cleanup();
});

describe("acquireLock", () => {
	it("succeeds when no lock exists", () => {
		const session = makeActiveSession();
		const result = acquireLock(tmp.path, session);
		expect(result).toBe(true);
		expect(existsSync(join(tmp.path, "lock"))).toBe(true);
		expect(existsSync(join(tmp.path, "active-session.json"))).toBe(true);
	});

	it("writes active-session.json with correct session info on success", () => {
		const session = makeActiveSession({ sessionId: "my-session", pid: process.pid });
		acquireLock(tmp.path, session);
		const { session: loaded } = isLocked(tmp.path);
		expect(loaded?.sessionId).toBe("my-session");
		expect(loaded?.pid).toBe(process.pid);
	});

	it("fails when another live process holds the lock", () => {
		const session1 = makeActiveSession({ sessionId: "session-1", pid: process.pid });
		acquireLock(tmp.path, session1);

		const session2 = makeActiveSession({ sessionId: "session-2", pid: process.pid });
		const result = acquireLock(tmp.path, session2);
		expect(result).toBe(false);
	});

	it("allows takeover when owning PID is dead (stale lock)", () => {
		const deadPid = 999999999;
		const staleSession = makeActiveSession({ sessionId: "old-session", pid: deadPid });
		acquireLock(tmp.path, staleSession);

		const newSession = makeActiveSession({ sessionId: "new-session", pid: process.pid });
		const result = acquireLock(tmp.path, newSession);
		expect(result).toBe(true);

		const { session: loaded } = isLocked(tmp.path);
		expect(loaded?.sessionId).toBe("new-session");
	});

	it("same-session re-lock is idempotent", () => {
		const session = makeActiveSession({ sessionId: "my-session" });
		const first = acquireLock(tmp.path, session);
		const second = acquireLock(tmp.path, session);
		expect(first).toBe(true);
		expect(second).toBe(true);
	});

	it("creates basePath directory on demand", () => {
		const nestedPath = join(tmp.path, "nested", "deep");
		const session = makeActiveSession();
		const result = acquireLock(nestedPath, session);
		expect(result).toBe(true);
		expect(existsSync(nestedPath)).toBe(true);
	});
});

describe("releaseLock", () => {
	it("removes lock file and active-session.json", () => {
		const session = makeActiveSession();
		acquireLock(tmp.path, session);
		expect(existsSync(join(tmp.path, "lock"))).toBe(true);

		releaseLock(tmp.path);
		expect(existsSync(join(tmp.path, "lock"))).toBe(false);
		expect(existsSync(join(tmp.path, "active-session.json"))).toBe(false);
	});

	it("is safe to call when no lock exists (no-op)", () => {
		expect(() => releaseLock(tmp.path)).not.toThrow();
	});

	it("allows re-acquiring lock after release", () => {
		const session1 = makeActiveSession({ sessionId: "session-1" });
		acquireLock(tmp.path, session1);
		releaseLock(tmp.path);

		const session2 = makeActiveSession({ sessionId: "session-2" });
		const result = acquireLock(tmp.path, session2);
		expect(result).toBe(true);

		const { session } = isLocked(tmp.path);
		expect(session?.sessionId).toBe("session-2");
	});
});

describe("isLocked", () => {
	it("returns locked:false when no lock exists", () => {
		const result = isLocked(tmp.path);
		expect(result.locked).toBe(false);
		expect(result.session).toBeUndefined();
	});

	it("returns locked:true with session info when locked", () => {
		const session = makeActiveSession({ sessionId: "check-session" });
		acquireLock(tmp.path, session);

		const result = isLocked(tmp.path);
		expect(result.locked).toBe(true);
		expect(result.session?.sessionId).toBe("check-session");
		expect(result.session?.pid).toBe(process.pid);
	});

	it("returns locked:true even when active-session.json missing", () => {
		const session = makeActiveSession();
		acquireLock(tmp.path, session);
		rmSync(join(tmp.path, "active-session.json"), { force: true });

		const result = isLocked(tmp.path);
		expect(result.locked).toBe(true);
		expect(result.session).toBeUndefined();
	});
});

describe("updateHeartbeat", () => {
	it("updates lastHeartbeatAt", async () => {
		const originalTime = new Date(Date.now() - 5000).toISOString();
		const session = makeActiveSession({ lastHeartbeatAt: originalTime });
		acquireLock(tmp.path, session);

		await new Promise((resolve) => setTimeout(resolve, 5));
		updateHeartbeat(tmp.path);

		const { session: updated } = isLocked(tmp.path);
		expect(updated?.lastHeartbeatAt).not.toBe(originalTime);
		expect(new Date(updated!.lastHeartbeatAt).getTime()).toBeGreaterThan(new Date(originalTime).getTime());
	});

	it("preserves all other session fields", async () => {
		const session = makeActiveSession({ sessionId: "heartbeat-session", pid: process.pid });
		acquireLock(tmp.path, session);

		updateHeartbeat(tmp.path);

		const { session: updated } = isLocked(tmp.path);
		expect(updated?.sessionId).toBe("heartbeat-session");
		expect(updated?.pid).toBe(process.pid);
	});

	it("is a no-op when no session file exists", () => {
		expect(() => updateHeartbeat(tmp.path)).not.toThrow();
	});
});
