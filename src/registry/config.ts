/**
 * Resolve the canopy registry's environment-driven config (SPEC §10.1, §10.2).
 *
 * Two pieces of state matter:
 *   1. Where the canopy library repo lives on disk (cloned + refreshed by
 *      warren — not the same as warren's own .canopy/ dev dir).
 *   2. Where the canopy git URL points (the operator's prompt library).
 *
 * Env contract:
 *   CANOPY_REPO_URL       git URL of the agent library — required
 *   WARREN_CANOPY_DIR     local clone path — defaults to /data/canopy-repo
 *
 * The binary names (`cn`, `git`) are deliberately part of the config so tests
 * can swap them and so a future operator can pin a specific path.
 */

import { ValidationError } from "../core/errors.ts";

export const DEFAULT_CANOPY_DIR = "/data/canopy-repo";

export interface CanopyRegistryConfig {
	readonly repoUrl: string;
	readonly localDir: string;
	readonly cnBinary: string;
	readonly gitBinary: string;
}

export type EnvLike = Readonly<Record<string, string | undefined>>;

export function loadCanopyRegistryConfigFromEnv(env: EnvLike = process.env): CanopyRegistryConfig {
	const repoUrl = env.CANOPY_REPO_URL;
	if (repoUrl === undefined || repoUrl === "") {
		throw new ValidationError("CANOPY_REPO_URL is not set", {
			recoveryHint:
				"set CANOPY_REPO_URL to the git URL of your canopy agent library (e.g. https://github.com/<you>/agents.git)",
		});
	}

	const localDir = env.WARREN_CANOPY_DIR ?? DEFAULT_CANOPY_DIR;
	if (localDir === "") {
		throw new ValidationError("WARREN_CANOPY_DIR is set to an empty string", {
			recoveryHint: `unset WARREN_CANOPY_DIR to fall back to ${DEFAULT_CANOPY_DIR}`,
		});
	}

	return {
		repoUrl,
		localDir,
		cnBinary: env.WARREN_CN_BINARY ?? "cn",
		gitBinary: env.WARREN_GIT_BINARY ?? "git",
	};
}
