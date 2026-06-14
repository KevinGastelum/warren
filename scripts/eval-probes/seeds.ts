import {
	listScheduledSeeds,
	type SeedsCliDeps,
	updateExtensions,
} from "../../src/seeds-cli/extensions.ts";
import type { EvalResult } from "../acceptance/lib/eval-result.ts";
import { type CallCounter, countingSpawn } from "./helpers.ts";

const PROJECT_PATH = "/tmp/eval-probe-project";

/**
 * Stub `sd` shell-out. `listScheduledSeeds` parses stdout as the
 * `SeedsListEnvelopeSchema` ({ issues: [...] }), so an empty issues array is
 * the minimal valid reply; `updateExtensions` only checks exitCode 0.
 */
const makeDeps = (counter: CallCounter): SeedsCliDeps => ({
	sdBinary: "sd",
	spawn: countingSpawn(counter, async () => ({
		stdout: JSON.stringify({ issues: [] }),
		stderr: "",
		exitCode: 0,
	})),
});

export async function runSeedsProbe(): Promise<EvalResult> {
	const start = Date.now();

	const listCounter: CallCounter = { n: 0 };
	await listScheduledSeeds(makeDeps(listCounter), PROJECT_PATH);

	const updateCounter: CallCounter = { n: 0 };
	await updateExtensions(makeDeps(updateCounter), PROJECT_PATH, "seed-1", {});

	const durationMs = Date.now() - start;
	const ok = listCounter.n === 1 && updateCounter.n === 1;

	return {
		integration: "seeds",
		scenarioId: "probe:seeds",
		functioning: {
			ok,
			assertions: [
				{ name: "list-one-shellout", ok: listCounter.n === 1 },
				{ name: "update-one-shellout", ok: updateCounter.n === 1 },
			],
		},
		efficiency: [
			{ metric: "seeds.listScheduled.spawnCount", value: listCounter.n, unit: "count" },
			{ metric: "seeds.updateExtensions.spawnCount", value: updateCounter.n, unit: "count" },
			{ metric: "seeds.probe.timeMs", value: durationMs, unit: "ms" },
		],
		durationMs,
	};
}
