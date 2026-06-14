import type { EvalResult, Integration } from "../acceptance/lib/eval-result.ts";
import { runBurrowProbe } from "./burrow.ts";
import { runCanopyProbe } from "./canopy.ts";
import { runMulchProbe } from "./mulch.ts";
import { runPlanRunProbe } from "./plan-run.ts";
import { runPlotProbe } from "./plot.ts";
import { runSaplingProbe } from "./sapling.ts";
import { runSeedsProbe } from "./seeds.ts";

export interface Probe {
	readonly integration: Integration;
	readonly run: () => Promise<EvalResult>;
}

/**
 * Every efficiency probe, one per integration. These are pure in-process
 * measurements — they import warren modules and wrap an injectable seam
 * with a counter, so they run on any platform (no burrow boot) and feed
 * both the budget ratchet (`check:eval-budgets`) and the scorecard.
 */
export const ALL_PROBES: readonly Probe[] = [
	{ integration: "canopy", run: runCanopyProbe },
	{ integration: "mulch", run: runMulchProbe },
	{ integration: "seeds", run: runSeedsProbe },
	{ integration: "sapling", run: runSaplingProbe },
	{ integration: "burrow", run: runBurrowProbe },
	{ integration: "plot", run: runPlotProbe },
	{ integration: "plan-run", run: runPlanRunProbe },
];

export async function runAllProbes(): Promise<EvalResult[]> {
	const results: EvalResult[] = [];
	for (const probe of ALL_PROBES) {
		results.push(await probe.run());
	}
	return results;
}
