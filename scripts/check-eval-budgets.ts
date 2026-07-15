#!/usr/bin/env bun
/**
 * Efficiency-budget ratchet for the os-eco integration probes
 * (scripts/eval-probes/). Modeled on check-bundle-size.ts.
 *
 * Each probe emits `efficiency` metrics with a unit:
 *   - `count`  — shell-outs / fetches / DB reads. Pure deterministic;
 *     gated EXACTLY (actual must equal budget). A drift in either
 *     direction is a real change in call shape — re-baseline with
 *     `--update` so the new count is a deliberate, reviewed floor.
 *   - `bytes`  — payload sizes. Ratcheted: actual ≤ budget passes.
 *     `--update` re-baselines to measured + headroom; lowering always
 *     applies, raising is bounded by AUTO_RAISE_CAP_BYTES unless
 *     WARREN_EVAL_BUDGET_ALLOW_RAISE=1.
 *   - `ms`     — wall-clock. ADVISORY ONLY, never gated (machine-variant).
 *
 * Usage:
 *   bun run scripts/check-eval-budgets.ts            # measure + gate
 *   bun run scripts/check-eval-budgets.ts --update   # re-baseline budgets
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EvalResult } from "./acceptance/lib/eval-result.ts";
import { runAllProbes } from "./eval-probes/index.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");
const BUDGETS_PATH = resolve(REPO_ROOT, "scripts/eval-budgets.json");

/** Small churn buffer added to a measured byte size when re-baselining. */
const HEADROOM_BYTES = 256;
/** Bounded auto-raise cap for byte budgets (a larger jump needs the override). */
const AUTO_RAISE_CAP_BYTES = 512;

export type GatedUnit = "count" | "bytes";
export interface MetricBudget {
	readonly unit: GatedUnit;
	readonly budget: number;
}
export type EvalBudgets = Record<string, MetricBudget>;

export interface GatedMetric {
	readonly metric: string;
	readonly unit: GatedUnit;
	readonly value: number;
}

export interface Failure {
	readonly metric: string;
	readonly reason:
		| "no-budget"
		| "count-mismatch"
		| "bytes-overage"
		| "stale-budget"
		| "unit-mismatch";
	readonly actual?: number;
	readonly budget?: number;
}

/** Flatten all probe efficiency metrics, dropping advisory `ms` entries. */
export function gatedMetrics(results: readonly EvalResult[]): GatedMetric[] {
	const out: GatedMetric[] = [];
	for (const r of results) {
		for (const e of r.efficiency ?? []) {
			if (e.unit === "ms") continue;
			out.push({ metric: e.metric, unit: e.unit, value: e.value });
		}
	}
	return out;
}

export function diff(measured: readonly GatedMetric[], budgets: EvalBudgets): Failure[] {
	const failures: Failure[] = [];
	const seen = new Set<string>();
	for (const m of measured) {
		seen.add(m.metric);
		const b = budgets[m.metric];
		if (b === undefined) {
			failures.push({ metric: m.metric, reason: "no-budget", actual: m.value });
			continue;
		}
		if (b.unit !== m.unit) {
			failures.push({
				metric: m.metric,
				reason: "unit-mismatch",
				actual: m.value,
				budget: b.budget,
			});
			continue;
		}
		if (m.unit === "count" && m.value !== b.budget) {
			failures.push({
				metric: m.metric,
				reason: "count-mismatch",
				actual: m.value,
				budget: b.budget,
			});
		} else if (m.unit === "bytes" && m.value > b.budget) {
			failures.push({
				metric: m.metric,
				reason: "bytes-overage",
				actual: m.value,
				budget: b.budget,
			});
		}
	}
	for (const metric of Object.keys(budgets)) {
		if (!seen.has(metric)) failures.push({ metric, reason: "stale-budget" });
	}
	return failures;
}

export interface UpdateResult {
	readonly wrote: boolean;
	readonly raised: string[];
}

/**
 * Re-baseline budgets from a measurement. Rebuilds the metrics map entirely
 * (stale entries dropped, new ones added). Counts are written exactly; byte
 * budgets become measured + headroom, with lowering always applied and
 * raising bounded by AUTO_RAISE_CAP_BYTES unless `allowRaise`.
 */
export function updateBudgets(
	measured: readonly GatedMetric[],
	budgetsPath = BUDGETS_PATH,
	allowRaise = process.env.WARREN_EVAL_BUDGET_ALLOW_RAISE === "1",
): UpdateResult {
	const raw = JSON.parse(readFileSync(budgetsPath, "utf8")) as Record<string, unknown>;
	const prev = (raw.metrics ?? {}) as EvalBudgets;
	const next: Record<string, MetricBudget> = {};
	const raised: string[] = [];

	for (const m of measured) {
		if (m.unit === "count") {
			next[m.metric] = { unit: "count", budget: m.value };
			continue;
		}
		const target = m.value + HEADROOM_BYTES;
		const current = prev[m.metric]?.budget;
		if (current === undefined || target <= current || allowRaise) {
			next[m.metric] = { unit: "bytes", budget: target };
			continue;
		}
		const delta = target - current;
		if (delta <= AUTO_RAISE_CAP_BYTES) {
			next[m.metric] = { unit: "bytes", budget: target };
			continue;
		}
		raised.push(
			`${m.metric}: ${current} → ${target} (+${delta} B, exceeds ${AUTO_RAISE_CAP_BYTES} B cap)`,
		);
		next[m.metric] = { unit: "bytes", budget: current };
	}

	if (raised.length > 0) return { wrote: false, raised };

	const sorted: Record<string, MetricBudget> = {};
	for (const key of Object.keys(next).sort()) sorted[key] = next[key] as MetricBudget;
	raw.metrics = sorted;
	writeFileSync(budgetsPath, `${JSON.stringify(raw, null, "\t")}\n`);
	return { wrote: true, raised };
}

export function loadBudgets(budgetsPath = BUDGETS_PATH): EvalBudgets {
	const raw = JSON.parse(readFileSync(budgetsPath, "utf8")) as { metrics?: EvalBudgets };
	if (raw.metrics === undefined) throw new Error(`${budgetsPath}: missing "metrics" object`);
	return raw.metrics;
}

/**
 * Annotate each gated efficiency metric with its `budget` + `withinBudget`
 * from the ratchet, so the scorecard's red-on-overage branch actually fires
 * in the `eval:scorecard` CLI path (probes themselves don't know the floors).
 * `ms` metrics and metrics with no budget pass through untouched. Uses the
 * same rule as `diff()`: exact for `count`, ≤ for `bytes`.
 */
export function hydrateWithinBudget(
	results: readonly EvalResult[],
	budgets: EvalBudgets,
): EvalResult[] {
	return results.map((r) => ({
		...r,
		efficiency: r.efficiency?.map((e) => {
			if (e.unit === "ms") return e;
			const b = budgets[e.metric];
			if (b === undefined || b.unit !== e.unit) return e;
			const withinBudget = e.unit === "count" ? e.value === b.budget : e.value <= b.budget;
			return { ...e, budget: b.budget, withinBudget };
		}),
	}));
}

function printAdvisory(results: readonly EvalResult[]): void {
	for (const r of results) {
		for (const e of r.efficiency ?? []) {
			if (e.unit === "ms") console.log(`  (advisory) ${e.metric}: ${e.value} ms`);
		}
	}
}

function describeFailure(f: Failure): string {
	if (f.reason === "no-budget")
		return `  ${f.metric}: measured ${f.actual} but no budget (run --update)`;
	if (f.reason === "stale-budget") {
		return `  ${f.metric}: budget present but probe no longer emits it (run --update)`;
	}
	if (f.reason === "unit-mismatch") {
		return `  ${f.metric}: unit changed vs stored budget (run --update)`;
	}
	return `  ${f.metric}: actual ${f.actual} vs budget ${f.budget} (${f.reason})`;
}

function runUpdate(measured: readonly GatedMetric[]): void {
	const { wrote, raised } = updateBudgets(measured);
	if (!wrote) {
		console.error("\nEval-budget --update refused to raise byte budgets beyond the cap:");
		for (const r of raised) console.error(`  ${r}`);
		console.error("\nRe-run with WARREN_EVAL_BUDGET_ALLOW_RAISE=1 and document why.");
		process.exit(1);
	}
	console.log(`Wrote re-baselined budgets to ${BUDGETS_PATH}.`);
}

function runGate(measured: readonly GatedMetric[]): void {
	const failures = diff(measured, loadBudgets());
	if (failures.length > 0) {
		console.error("\nEval-budget guard failed:");
		for (const f of failures) console.error(describeFailure(f));
		console.error(
			"\nRe-baseline with `bun run check:eval-budgets -- --update` once the change is intended.",
		);
		process.exit(1);
	}
	console.log(`Eval-budget guard ok (${measured.length} gated metrics).`);
}

async function main(): Promise<void> {
	const args = new Set(process.argv.slice(2));
	const results = await runAllProbes();
	const measured = gatedMetrics(results);
	printAdvisory(results);
	if (args.has("--update")) runUpdate(measured);
	else runGate(measured);
}

if (import.meta.main) await main();
