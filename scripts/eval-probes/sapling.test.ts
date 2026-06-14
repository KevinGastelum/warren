import { describe, expect, test } from "bun:test";
import { runSaplingProbe } from "./sapling.ts";

describe("sapling probe", () => {
	test("builds seed files and reports file count + bytes", async () => {
		const r = await runSaplingProbe();
		expect(r.integration).toBe("sapling");
		expect(r.functioning.ok).toBe(true);
		const fileCount = r.efficiency?.find((e) => e.metric === "sapling.buildSeedFiles.fileCount");
		expect(fileCount?.value).toBeGreaterThan(0);
	});

	test("asserts the sonnet tier is frozen onto the agent", async () => {
		const r = await runSaplingProbe();
		const tier = r.functioning.assertions.find((a) => a.name === "sonnet-tier");
		expect(tier?.ok).toBe(true);
	});
});
