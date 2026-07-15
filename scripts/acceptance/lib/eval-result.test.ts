import { describe, expect, test } from "bun:test";
import { collectResults, type EvalResult } from "./eval-result.ts";

const sample = (over: Partial<EvalResult> = {}): EvalResult => ({
	integration: "mulch",
	scenarioId: "probe:mulch",
	functioning: { ok: true, assertions: [{ name: "merged", ok: true }] },
	durationMs: 3,
	...over,
});

describe("eval-result", () => {
	test("collectResults groups by integration and counts failures", () => {
		const results = [
			sample(),
			sample({ integration: "canopy", functioning: { ok: false, assertions: [] } }),
		];
		const summary = collectResults(results);
		expect(summary.total).toBe(2);
		expect(summary.failing).toBe(1);
		expect(summary.byIntegration.get("mulch")?.length).toBe(1);
		expect(summary.byIntegration.get("canopy")?.[0]?.functioning.ok).toBe(false);
	});
});
