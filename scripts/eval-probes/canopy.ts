import { CanopyClient, type SpawnFn } from "../../src/registry/canopy.ts";
import type { EvalResult } from "../acceptance/lib/eval-result.ts";
import { type CallCounter, countingSpawn } from "./helpers.ts";

const AGENTS = ["alpha", "beta", "gamma"]; // N = 3

/**
 * Stub `cn` shell-out matching canopy's `--json` envelope:
 *   `cn list ...`   -> { success, command: "list", prompts: [...] }
 *   `cn render ...` -> any non-error JSON (renderAgent returns it raw).
 * Shapes satisfy CanopyClient's zod parsers (src/registry/canopy.ts).
 */
const stubSpawn: SpawnFn = async (cmd) => {
	if (cmd.includes("list")) {
		return {
			stdout: JSON.stringify({
				success: true,
				command: "list",
				prompts: AGENTS.map((name) => ({ name, version: 1, status: "active", tags: ["agent"] })),
			}),
			stderr: "",
			exitCode: 0,
		};
	}
	return {
		stdout: JSON.stringify({
			success: true,
			command: "render",
			prompt: { name: "x", version: 1, sections: [] },
		}),
		stderr: "",
		exitCode: 0,
	};
};

export async function runCanopyProbe(): Promise<EvalResult> {
	const counter: CallCounter = { n: 0 };
	const client = new CanopyClient({
		cnBinary: "cn",
		cwd: process.cwd(),
		spawn: countingSpawn(counter, stubSpawn),
	});

	const start = Date.now();
	const summaries = await client.listAgents();
	for (const s of summaries) {
		await client.renderAgent(s.name);
	}
	const durationMs = Date.now() - start;

	const ok = summaries.length === AGENTS.length && counter.n === AGENTS.length + 1;
	return {
		integration: "canopy",
		scenarioId: "probe:canopy",
		functioning: {
			ok,
			assertions: [
				{ name: "listed-all", ok: summaries.length === AGENTS.length },
				{ name: "n+1-shellouts", ok: counter.n === AGENTS.length + 1 },
			],
		},
		efficiency: [
			{ metric: "canopy.listAndRender.spawnCount", value: counter.n, unit: "count" },
			{ metric: "canopy.listAndRender.timeMs", value: durationMs, unit: "ms" },
		],
		durationMs,
	};
}
