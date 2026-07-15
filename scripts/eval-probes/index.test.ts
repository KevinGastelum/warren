import { describe, expect, test } from "bun:test";
import { ALL_PROBES, runAllProbes } from "./index.ts";

describe("probe registry", () => {
	test("registers one probe per integration", () => {
		const integrations = ALL_PROBES.map((p) => p.integration).sort();
		expect(integrations).toEqual([
			"burrow",
			"canopy",
			"mulch",
			"plan-run",
			"plot",
			"sapling",
			"seeds",
		]);
	});

	test("runAllProbes returns a result per probe, all functioning", async () => {
		const results = await runAllProbes();
		expect(results.length).toBe(ALL_PROBES.length);
		for (const r of results) {
			expect(r.functioning.ok).toBe(true);
		}
	});
});
