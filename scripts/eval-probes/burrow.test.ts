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

	test("a thrown burrowsUp fails functioning.ok but still counts the round-trip", async () => {
		const bad = async () => new Response("not json", { status: 200 });
		const r = await runBurrowProbe(bad);
		expect(r.functioning.ok).toBe(false);
		const succeeded = r.functioning.assertions.find((a) => a.name === "burrowsUp-succeeded");
		expect(succeeded?.ok).toBe(false);
		expect(succeeded?.detail).toBeDefined();
		const roundTrips = r.efficiency?.find((e) => e.metric === "burrow.burrowsUp.fetchCount");
		expect(roundTrips?.value).toBe(1);
	});
});
