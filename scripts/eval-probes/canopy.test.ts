import { describe, expect, test } from "bun:test";
import { runCanopyProbe } from "./canopy.ts";

describe("canopy probe", () => {
	test("list + render of N agents costs N+1 spawns", async () => {
		const r = await runCanopyProbe();
		expect(r.integration).toBe("canopy");
		expect(r.functioning.ok).toBe(true);
		const spawnCount = r.efficiency?.find((e) => e.metric === "canopy.listAndRender.spawnCount");
		// fixture N=3 -> 1 list + 3 render = 4
		expect(spawnCount?.value).toBe(4);
	});
});
