import { describe, expect, test } from "bun:test";
import { runPlanRunProbe } from "./plan-run.ts";

describe("plan-run probe", () => {
	test("the parent-merge gate reads the DB a bounded number of times", async () => {
		const r = await runPlanRunProbe();
		expect(r.integration).toBe("plan-run");
		expect(r.functioning.ok).toBe(true);
		const reads = r.efficiency?.find((e) => e.metric === "plan-run.parentGate.dbReads");
		// empty-push trivial-merge path: 1 runs.get + 1 events.listByRun
		expect(reads?.value).toBe(2);
		expect(reads?.value).toBeLessThanOrEqual(3);
	});
});
