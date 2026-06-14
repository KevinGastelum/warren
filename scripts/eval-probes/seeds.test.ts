import { describe, expect, test } from "bun:test";
import { runSeedsProbe } from "./seeds.ts";

describe("seeds probe", () => {
	test("list and update each cost exactly one sd shell-out", async () => {
		const r = await runSeedsProbe();
		expect(r.integration).toBe("seeds");
		expect(r.functioning.ok).toBe(true);
		const list = r.efficiency?.find((e) => e.metric === "seeds.listScheduled.spawnCount");
		const update = r.efficiency?.find((e) => e.metric === "seeds.updateExtensions.spawnCount");
		expect(list?.value).toBe(1);
		expect(update?.value).toBe(1);
	});
});
