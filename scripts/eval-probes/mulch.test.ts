import { describe, expect, test } from "bun:test";
import { runMulchProbe } from "./mulch.ts";

describe("mulch probe", () => {
	test("emits a functioning result with emitCount and mergedBytes metrics", async () => {
		const r = await runMulchProbe();
		expect(r.integration).toBe("mulch");
		expect(r.functioning.ok).toBe(true);
		const metrics = (r.efficiency ?? []).map((e) => e.metric);
		expect(metrics).toContain("mulch.merge.emitCount");
		expect(metrics).toContain("mulch.merge.mergedBytes");
		const emitCount = r.efficiency?.find((e) => e.metric === "mulch.merge.emitCount");
		expect(emitCount?.unit).toBe("count");
		expect(emitCount?.value).toBeGreaterThan(0);
	});

	test("is deterministic across runs (zero variance)", async () => {
		const a = await runMulchProbe();
		const b = await runMulchProbe();
		const pick = (r: typeof a, m: string) => r.efficiency?.find((e) => e.metric === m)?.value;
		expect(pick(a, "mulch.merge.emitCount")).toBe(pick(b, "mulch.merge.emitCount"));
		expect(pick(a, "mulch.merge.mergedBytes")).toBe(pick(b, "mulch.merge.mergedBytes"));
	});
});
