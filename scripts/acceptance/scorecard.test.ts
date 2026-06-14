import { describe, expect, test } from "bun:test";
import type { EvalResult } from "./lib/eval-result.ts";
import { renderScorecard, scoreIntegration } from "./scorecard.ts";

const base = (over: Partial<EvalResult>): EvalResult => ({
	integration: "mulch",
	scenarioId: "x",
	functioning: { ok: true, assertions: [] },
	durationMs: 1,
	...over,
});

describe("scorecard", () => {
	test("red when functioning fails", () => {
		expect(scoreIntegration([base({ functioning: { ok: false, assertions: [] } })])).toBe("red");
	});

	test("red when an efficiency metric is over budget", () => {
		const r = base({
			efficiency: [{ metric: "a", value: 5, unit: "count", budget: 1, withinBudget: false }],
		});
		expect(scoreIntegration([r])).toBe("red");
	});

	test("amber when cost is within 10% of ceiling", () => {
		const r = base({ cost: { usd: 0.95, budgetUsd: 1, withinBudget: true } });
		expect(scoreIntegration([r])).toBe("amber");
	});

	test("green otherwise", () => {
		expect(scoreIntegration([base({})])).toBe("green");
	});

	test("renderScorecard emits one markdown row per integration", () => {
		const md = renderScorecard([base({ integration: "mulch" }), base({ integration: "canopy" })]);
		expect(md).toContain("mulch");
		expect(md).toContain("canopy");
		expect(md).toMatch(/🟢|🟡|🔴/);
	});
});
