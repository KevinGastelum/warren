/**
 * Common result shape every eval layer emits so the scorecard (Layer 4)
 * can aggregate efficiency probes, functional scenarios, and real-LLM
 * runs through one channel. Designed before the other layers so they all
 * produce compatible data.
 */
export type Integration = "canopy" | "mulch" | "seeds" | "sapling" | "burrow" | "plot" | "plan-run";

export interface EvalAssertion {
	readonly name: string;
	readonly ok: boolean;
	readonly detail?: string;
}

export type EvalUnit = "ms" | "bytes" | "count";

export interface EvalEfficiency {
	readonly metric: string;
	readonly value: number;
	readonly unit: EvalUnit;
	readonly budget?: number;
	readonly withinBudget?: boolean;
}

export interface EvalQuality {
	readonly score?: number;
	readonly outcomeOk?: boolean;
	readonly judge?: string;
}

export interface EvalCost {
	readonly usd?: number;
	readonly tokensIn?: number;
	readonly tokensOut?: number;
	readonly budgetUsd?: number;
	readonly withinBudget?: boolean;
}

export interface EvalResult {
	readonly integration: Integration;
	readonly scenarioId: string;
	readonly functioning: { readonly ok: boolean; readonly assertions: readonly EvalAssertion[] };
	readonly efficiency?: readonly EvalEfficiency[];
	readonly quality?: EvalQuality;
	readonly cost?: EvalCost;
	readonly durationMs: number;
}

export interface ResultSummary {
	readonly total: number;
	readonly failing: number;
	readonly byIntegration: Map<Integration, EvalResult[]>;
}

export function collectResults(results: readonly EvalResult[]): ResultSummary {
	const byIntegration = new Map<Integration, EvalResult[]>();
	let failing = 0;
	for (const r of results) {
		if (!r.functioning.ok) failing += 1;
		const bucket = byIntegration.get(r.integration) ?? [];
		bucket.push(r);
		byIntegration.set(r.integration, bucket);
	}
	return { total: results.length, failing, byIntegration };
}
