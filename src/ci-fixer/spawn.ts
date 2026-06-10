/**
 * Spawn wrapper for the CI-fixer poller (warren-a993).
 *
 * `createCiFixerSpawn` mirrors `createPlanRunSpawn` (src/plan-runs/dispatch.ts):
 * it composes a `SpawnFixerFn` the poller can call without knowing about burrow
 * pools, bridge registries, or project clones. The wrapper:
 *
 *   1. Calls `spawnRun` with `trigger:'ci-fixer'`, `agentName` from the config,
 *      and the original run's id as `parentRunId` (so the history tracker can
 *      count prior fixer dispatches).
 *   2. Passes `targetBranch` through to `composeRunBranch` so the fixer's
 *      workspace is checked out on the existing PR branch, not a fresh
 *      `${prefix}/${runId}` branch.
 *   3. Calls `bridges.start` so the fixer run's events stream into
 *      warren.events the same way scheduler-dispatched runs do.
 */

import type { BurrowClientPool } from "../burrow-client/pool.ts";
import type { Repos } from "../db/repos/index.ts";
import type { SpawnFn } from "../projects/clone.ts";
import type { ProjectsConfig } from "../projects/config.ts";
import { spawnRun } from "../runs/index.ts";
import type { SeedsCliDeps } from "../seeds-cli/index.ts";
import type { BridgeRegistry } from "../server/types.ts";
import type { WarrenConfigCache } from "../warren-config/index.ts";

export interface SpawnFixerInput {
	readonly projectId: string;
	readonly agentName: string;
	readonly prompt: string;
	readonly parentRunId: string;
	readonly targetBranch: string;
	readonly trigger: string;
}

export type SpawnFixerFn = (input: SpawnFixerInput) => Promise<string>;

export interface CreateCiFixerSpawnInput {
	readonly repos: Repos;
	readonly burrowClientPool: BurrowClientPool;
	readonly bridges: BridgeRegistry;
	readonly warrenConfigs: WarrenConfigCache;
	readonly projectsConfig: ProjectsConfig;
	readonly projectSpawn: SpawnFn;
	readonly seedsCli?: SeedsCliDeps;
	readonly runBranchPrefixDefault?: string;
	readonly now?: () => Date;
	/** Test seam — defaults to the live `spawnRun`. */
	readonly spawnRunFn?: typeof spawnRun;
}

export function createCiFixerSpawn(input: CreateCiFixerSpawnInput): SpawnFixerFn {
	const spawnRunFn = input.spawnRunFn ?? spawnRun;
	return async (fix) => {
		const result = await spawnRunFn({
			repos: input.repos,
			burrowClientPool: input.burrowClientPool,
			agentName: fix.agentName,
			projectId: fix.projectId,
			prompt: fix.prompt,
			trigger: fix.trigger,
			parentRunId: fix.parentRunId,
			cloneKind: "continue",
			targetBranch: fix.targetBranch,
			projectsConfig: input.projectsConfig,
			projectSpawn: input.projectSpawn,
			warrenConfigs: input.warrenConfigs,
			...(input.seedsCli !== undefined ? { seedsCli: input.seedsCli } : {}),
			...(input.runBranchPrefixDefault !== undefined
				? { runBranchPrefixDefault: input.runBranchPrefixDefault }
				: {}),
			...(input.now !== undefined ? { now: input.now } : {}),
		});
		input.bridges.start(result.run.id, result.burrowRun.id, result.burrow.id);
		return result.run.id;
	};
}
