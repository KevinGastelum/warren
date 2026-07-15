import { collectResults, type EvalResult, type Integration } from "./lib/eval-result.ts";

export type Grade = "green" | "amber" | "red";

const AMBER_COST_FRACTION = 0.9;
const QUALITY_SOFT_FLOOR = 0.6;

function resultIsRed(r: EvalResult): boolean {
	if (!r.functioning.ok) return true;
	if ((r.efficiency ?? []).some((e) => e.withinBudget === false)) return true;
	return r.cost?.withinBudget === false;
}

function resultIsAmber(r: EvalResult): boolean {
	const costNearCeiling =
		r.cost?.usd !== undefined &&
		r.cost.budgetUsd !== undefined &&
		r.cost.usd >= r.cost.budgetUsd * AMBER_COST_FRACTION;
	const qualityBelowFloor = r.quality?.score !== undefined && r.quality.score < QUALITY_SOFT_FLOOR;
	return costNearCeiling || qualityBelowFloor;
}

export function scoreIntegration(results: readonly EvalResult[]): Grade {
	let amber = false;
	for (const r of results) {
		if (resultIsRed(r)) return "red";
		if (resultIsAmber(r)) amber = true;
	}
	return amber ? "amber" : "green";
}

const ICON: Record<Grade, string> = { green: "🟢", amber: "🟡", red: "🔴" };

export function renderScorecard(results: readonly EvalResult[]): string {
	const { byIntegration } = collectResults(results);
	const lines: string[] = [];
	lines.push("## os-eco Integration Eval Scorecard");
	lines.push("");
	lines.push("| Integration | Grade | Scenarios | Notes |");
	lines.push("|---|---|---|---|");
	const order: Integration[] = [
		"canopy",
		"mulch",
		"seeds",
		"sapling",
		"burrow",
		"plot",
		"plan-run",
	];
	for (const integration of order) {
		const rs = byIntegration.get(integration);
		if (rs === undefined || rs.length === 0) {
			lines.push(`| ${integration} | ⚪ | 0 | no eval ran |`);
			continue;
		}
		const grade = scoreIntegration(rs);
		const notes = rs
			.filter((r) => !r.functioning.ok)
			.map((r) => r.scenarioId)
			.join(", ");
		lines.push(`| ${integration} | ${ICON[grade]} | ${rs.length} | ${notes || "ok"} |`);
	}
	return lines.join("\n");
}

/** Integrations graded 🔴 — the set that must fail the CLI / CI gate. */
export function redIntegrations(results: readonly EvalResult[]): Integration[] {
	const { byIntegration } = collectResults(results);
	const reds: Integration[] = [];
	for (const [integration, rs] of byIntegration) {
		if (rs.length > 0 && scoreIntegration(rs) === "red") reds.push(integration);
	}
	return reds;
}

async function main(): Promise<void> {
	const { runAllProbes } = await import("../eval-probes/index.ts");
	const { loadBudgets, hydrateWithinBudget } = await import("../check-eval-budgets.ts");
	const raw = await runAllProbes();
	const results = hydrateWithinBudget(raw, loadBudgets());
	const md = renderScorecard(results);
	console.log(md);
	const { writeFileSync } = await import("node:fs");
	writeFileSync("eval-results.json", `${JSON.stringify(results, null, "\t")}\n`);
	const summaryPath = process.env.GITHUB_STEP_SUMMARY;
	if (summaryPath) writeFileSync(summaryPath, `${md}\n`, { flag: "a" });
	const reds = redIntegrations(results);
	if (reds.length > 0) {
		console.error(`✗ scorecard: ${reds.length} integration(s) graded 🔴: ${reds.join(", ")}`);
		process.exit(1);
	}
}

if (import.meta.main) await main();
