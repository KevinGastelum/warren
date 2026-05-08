import { describe, expect, test } from "bun:test";
import { waitForSocket } from "./socket.ts";

describe("waitForSocket", () => {
	test("returns true on the first probe when the socket already exists", async () => {
		let probes = 0;
		let sleeps = 0;
		const ok = await waitForSocket("/var/run/burrow.sock", {
			intervalMs: 100,
			timeoutMs: 5_000,
			exists: async () => {
				probes += 1;
				return true;
			},
			sleep: async () => {
				sleeps += 1;
			},
			now: () => 0,
		});
		expect(ok).toBe(true);
		expect(probes).toBe(1);
		expect(sleeps).toBe(0);
	});

	test("polls until the socket appears, then returns true", async () => {
		const flips = [false, false, false, true];
		let i = 0;
		let virtualNow = 0;
		const ok = await waitForSocket("/socket", {
			intervalMs: 100,
			timeoutMs: 5_000,
			exists: async () => flips[i++] ?? true,
			sleep: async (ms) => {
				virtualNow += ms;
			},
			now: () => virtualNow,
		});
		expect(ok).toBe(true);
		expect(i).toBe(4);
	});

	test("returns false when the deadline elapses without the socket appearing", async () => {
		let virtualNow = 0;
		const ok = await waitForSocket("/socket", {
			intervalMs: 100,
			timeoutMs: 500,
			exists: async () => false,
			sleep: async (ms) => {
				virtualNow += ms;
			},
			now: () => virtualNow,
		});
		expect(ok).toBe(false);
		// 5 intervals fit in a 500ms window plus the boundary check: ~6 probes total.
		expect(virtualNow).toBeGreaterThanOrEqual(500);
	});

	test("the default existence check returns false (not throw) for missing files", async () => {
		// Smoke test the live defaultExists path through a tiny timeout against
		// a definitely-missing file. The polling loop must terminate cleanly
		// rather than throw — a thrown ENOENT would crash the supervisor.
		const ok = await waitForSocket("/var/run/this-socket-does-not-exist-warren-test", {
			intervalMs: 10,
			timeoutMs: 30,
		});
		expect(ok).toBe(false);
	});
});
