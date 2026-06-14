import type { EventRow, PlanRunRow, RunRow } from "../../src/db/schema.ts";
import type { CoordinatorRepos } from "../../src/plan-runs/coordinator.ts";
import { checkParentRunMerged } from "../../src/plan-runs/merge-gate.ts";
import type { PrMergeChecker } from "../../src/plan-runs/pr-merge.ts";
import type { EvalResult } from "../acceptance/lib/eval-result.ts";

const PARENT_RUN_ID = "run-parent";

/**
 * Probe the parent-merge gate's DB-read cost on its trivial-merge path: a
 * parent run with no PR but a `reap.empty_push` event resolves to "merged"
 * via 1 `runs.get` + 1 `events.listByRun`, with no PR polling. Counting the
 * two seam reads pins the gate's per-tick cost without a real DB or burrow.
 */
export async function runPlanRunProbe(): Promise<EvalResult> {
	let runsGet = 0;
	let eventsList = 0;

	const repos = {
		runs: {
			get: async (_id: string): Promise<RunRow | null> => {
				runsGet += 1;
				return { prUrl: null } as RunRow;
			},
		},
		events: {
			listByRun: async (_runId: string): Promise<EventRow[]> => {
				eventsList += 1;
				return [{ kind: "reap.empty_push" } as EventRow];
			},
		},
		planRuns: {},
	} as unknown as CoordinatorRepos;

	const planRun = { parentRunId: PARENT_RUN_ID } as PlanRunRow;
	const checkPrMerged: PrMergeChecker = async () => {
		throw new Error("checkPrMerged must not run on the empty-push path");
	};

	const start = Date.now();
	const result = await checkParentRunMerged({
		planRun,
		repos,
		checkPrMerged,
		emit: async () => {},
		mergeTimeoutMs: 0,
		now: () => new Date(start),
	});
	const durationMs = Date.now() - start;

	const dbReads = runsGet + eventsList;
	// Gate passed (returns null) and cost the expected 2 reads.
	const ok = result === null && dbReads === 2;

	return {
		integration: "plan-run",
		scenarioId: "probe:plan-run",
		functioning: {
			ok,
			assertions: [
				{ name: "gate-passed", ok: result === null },
				{ name: "two-db-reads", ok: dbReads === 2 },
			],
		},
		efficiency: [
			{ metric: "plan-run.parentGate.dbReads", value: dbReads, unit: "count" },
			{ metric: "plan-run.parentGate.runsGet", value: runsGet, unit: "count" },
			{ metric: "plan-run.parentGate.eventsList", value: eventsList, unit: "count" },
			{ metric: "plan-run.parentGate.timeMs", value: durationMs, unit: "ms" },
		],
		durationMs,
	};
}
