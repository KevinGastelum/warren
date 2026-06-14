import { describe, expect, test } from "bun:test";
import { runBurrowProbe } from "./burrow.ts";

describe("burrow probe", () => {
	test("a single burrowsUp costs exactly one HTTP round-trip", async () => {
		const r = await runBurrowProbe();
		expect(r.integration).toBe("burrow");
		expect(r.functioning.ok).toBe(true);
		const roundTrips = r.efficiency?.find((e) => e.metric === "burrow.burrowsUp.fetchCount");
		expect(roundTrips?.value).toBe(1);
	});
});
