import { MODEL_TIERS } from "../../src/registry/builtins/model-tiers.ts";
import { SAPLING_BUILTIN } from "../../src/registry/builtins/sapling.ts";
import { buildSeedFiles } from "../../src/runs/seed.ts";
import type { EvalResult } from "../acceptance/lib/eval-result.ts";
import { byteLen } from "./helpers.ts";

export async function runSaplingProbe(): Promise<EvalResult> {
	const start = Date.now();
	const built = buildSeedFiles(SAPLING_BUILTIN);
	const durationMs = Date.now() - start;
	const totalBytes = built.files.reduce((sum, f) => sum + byteLen(f.contents), 0);
	const hasTier = SAPLING_BUILTIN.frontmatter.model === MODEL_TIERS.sonnet.model;
	const ok = built.files.length > 0 && hasTier;
	return {
		integration: "sapling",
		scenarioId: "probe:sapling",
		functioning: {
			ok,
			assertions: [
				{ name: "files-built", ok: built.files.length > 0 },
				{ name: "sonnet-tier", ok: hasTier, detail: MODEL_TIERS.sonnet.model },
			],
		},
		efficiency: [
			{ metric: "sapling.buildSeedFiles.fileCount", value: built.files.length, unit: "count" },
			{ metric: "sapling.buildSeedFiles.totalBytes", value: totalBytes, unit: "bytes" },
			{ metric: "sapling.buildSeedFiles.timeMs", value: durationMs, unit: "ms" },
		],
		durationMs,
	};
}
