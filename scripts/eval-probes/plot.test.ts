import { describe, expect, test } from "bun:test";
import { runPlotProbe } from "./plot.ts";

describe("plot probe", () => {
	test("functioning result with append + bytes metrics", async () => {
		const r = await runPlotProbe();
		expect(r.integration).toBe("plot");
		expect(r.functioning.ok).toBe(true);
		const metrics = (r.efficiency ?? []).map((e) => e.metric);
		expect(metrics).toContain("plot.mergeEvents.appended");
		expect(metrics).toContain("plot.mergeEvents.mergedBytes");
	});

	test("is deterministic across runs (zero variance)", async () => {
		const a = await runPlotProbe();
		const b = await runPlotProbe();
		const pick = (r: typeof a, m: string) => r.efficiency?.find((e) => e.metric === m)?.value;
		expect(pick(a, "plot.mergeEvents.appended")).toBe(pick(b, "plot.mergeEvents.appended"));
		expect(pick(a, "plot.mergeEvents.mergedBytes")).toBe(pick(b, "plot.mergeEvents.mergedBytes"));
	});
});
