import type { EventRow } from "../../src/db/schema.ts";
import { mergeMulchFile } from "../../src/runs/reap/mulch.ts";
import type { EvalResult } from "../acceptance/lib/eval-result.ts";
import { byteLen } from "./helpers.ts";

/**
 * Fixed fixture: N existing records + N incoming where half collide by id
 * with newer recorded_at (last-write-wins updates) and half are new
 * (appends). Counts are zero-variance; durationMs is advisory only.
 */
const N = 50;

function buildBody(idStart: number, recordedAt: string): string {
	const lines: string[] = [];
	for (let i = 0; i < N; i++) {
		lines.push(
			JSON.stringify({
				id: `rec-${idStart + i}`,
				domain: "probe",
				recorded_at: recordedAt,
				body: `record ${idStart + i} payload`,
			}),
		);
	}
	return `${lines.join("\n")}\n`;
}

export async function runMulchProbe(): Promise<EvalResult> {
	const existing = buildBody(0, "2026-01-01T00:00:00.000Z");
	// 25 collisions (ids rec-25..rec-49 are newer -> updated) and 25 appends (rec-50..rec-74).
	const incoming = buildBody(25, "2026-02-01T00:00:00.000Z");

	let emitCount = 0;
	const emit = async (): Promise<EventRow> => {
		emitCount += 1;
		return {} as EventRow;
	};

	const start = Date.now();
	const res = await mergeMulchFile("probe", existing, incoming, emit);
	const durationMs = Date.now() - start;

	const ok = res.changed && res.merged.length > 0;
	return {
		integration: "mulch",
		scenarioId: "probe:mulch",
		functioning: {
			ok,
			assertions: [
				{ name: "changed", ok: res.changed },
				{ name: "merged-nonempty", ok: res.merged.length > 0 },
			],
		},
		efficiency: [
			{ metric: "mulch.merge.emitCount", value: emitCount, unit: "count" },
			{ metric: "mulch.merge.updated", value: res.updated, unit: "count" },
			{ metric: "mulch.merge.appended", value: res.appended, unit: "count" },
			{ metric: "mulch.merge.mergedBytes", value: byteLen(res.merged), unit: "bytes" },
			{ metric: "mulch.merge.timeMs", value: durationMs, unit: "ms" },
		],
		durationMs,
	};
}
