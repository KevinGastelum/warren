import { mergePlotEventsFile } from "../../src/runs/reap/plot-merge.ts";
import type { EvalResult } from "../acceptance/lib/eval-result.ts";
import { byteLen } from "./helpers.ts";

const N = 40;

function events(idStart: number): string {
	const lines: string[] = [];
	for (let i = 0; i < N; i++) {
		lines.push(JSON.stringify({ id: `evt-${idStart + i}`, seq: idStart + i, kind: "note" }));
	}
	return `${lines.join("\n")}\n`;
}

export async function runPlotProbe(): Promise<EvalResult> {
	// Dedup is by exact line content, so the 20 overlapping lines (idStart 20..39)
	// are byte-identical and dedup; the 20 new lines (40..59) append.
	const existing = events(0);
	const incoming = events(20);
	const start = Date.now();
	const res = mergePlotEventsFile(existing, incoming);
	const durationMs = Date.now() - start;
	const ok = res.merged.length > 0;
	return {
		integration: "plot",
		scenarioId: "probe:plot",
		functioning: {
			ok,
			assertions: [{ name: "merged-nonempty", ok }],
		},
		efficiency: [
			{ metric: "plot.mergeEvents.appended", value: res.appended, unit: "count" },
			{ metric: "plot.mergeEvents.mergedBytes", value: byteLen(res.merged), unit: "bytes" },
			{ metric: "plot.mergeEvents.timeMs", value: durationMs, unit: "ms" },
		],
		durationMs,
	};
}
