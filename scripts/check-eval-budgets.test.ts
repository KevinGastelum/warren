import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EvalResult } from "./acceptance/lib/eval-result.ts";
import { diff, type EvalBudgets, gatedMetrics, updateBudgets } from "./check-eval-budgets.ts";

const sample: EvalResult[] = [
	{
		integration: "canopy",
		scenarioId: "probe:canopy",
		functioning: { ok: true, assertions: [] },
		efficiency: [
			{ metric: "canopy.spawnCount", value: 4, unit: "count" },
			{ metric: "canopy.bytes", value: 1000, unit: "bytes" },
			{ metric: "canopy.timeMs", value: 12, unit: "ms" },
		],
		durationMs: 12,
	},
];

describe("eval-budgets ratchet", () => {
	test("gatedMetrics drops ms, keeps count + bytes", () => {
		const g = gatedMetrics(sample);
		expect(g.map((m) => m.metric)).toEqual(["canopy.spawnCount", "canopy.bytes"]);
	});

	test("count must match exactly; bytes within budget; both pass when in spec", () => {
		const budgets: EvalBudgets = {
			"canopy.spawnCount": { unit: "count", budget: 4 },
			"canopy.bytes": { unit: "bytes", budget: 1024 },
		};
		expect(diff(gatedMetrics(sample), budgets)).toEqual([]);
	});

	test("count mismatch and bytes overage each fail", () => {
		const tighter: EvalBudgets = {
			"canopy.spawnCount": { unit: "count", budget: 3 },
			"canopy.bytes": { unit: "bytes", budget: 512 },
		};
		const fails = diff(gatedMetrics(sample), tighter);
		expect(fails.length).toBe(2);
	});

	test("a measured metric with no budget fails", () => {
		expect(diff(gatedMetrics(sample), {}).length).toBe(2);
	});

	test("updateBudgets writes exact counts and bytes with headroom", () => {
		const dir = mkdtempSync(join(tmpdir(), "eval-budgets-"));
		const path = join(dir, "b.json");
		writeFileSync(path, JSON.stringify({ metrics: {} }));
		updateBudgets(gatedMetrics(sample), path);
		const written = JSON.parse(readFileSync(path, "utf8")) as { metrics: EvalBudgets };
		expect(written.metrics["canopy.spawnCount"]).toEqual({ unit: "count", budget: 4 });
		expect(written.metrics["canopy.bytes"]?.budget).toBeGreaterThanOrEqual(1000);
		// a budget written by --update always passes its own gate
		expect(diff(gatedMetrics(sample), written.metrics)).toEqual([]);
	});
});
