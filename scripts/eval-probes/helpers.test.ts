import { describe, expect, test } from "bun:test";
import { byteLen, countingFetch, countingSpawn } from "./helpers.ts";

describe("eval-probes helpers", () => {
	test("countingSpawn counts each call and forwards to the inner fn", async () => {
		const counter = { n: 0 };
		const spawn = countingSpawn(counter, async (_cmd: readonly string[], _opts: unknown) => ({
			exitCode: 0,
			stdout: "ok",
			stderr: "",
		}));
		await spawn(["cn", "list"], {});
		await spawn(["cn", "render", "x"], {});
		expect(counter.n).toBe(2);
	});

	test("countingFetch counts calls even when the inner response is minimal", async () => {
		const counter = { n: 0 };
		const fetchImpl = countingFetch(counter, async () => new Response("{}", { status: 200 }));
		await fetchImpl("http://x/burrows", { method: "POST" });
		expect(counter.n).toBe(1);
	});

	test("byteLen measures UTF-8 byte length", () => {
		expect(byteLen("abc")).toBe(3);
		expect(byteLen("é")).toBe(2);
	});
});
