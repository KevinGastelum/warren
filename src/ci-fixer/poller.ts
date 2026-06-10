/**
 * CI-fixer tick function (warren-0b75).
 *
 * Runs on the scheduler's existing cadence (wired into `src/triggers/tick.ts`).
 * Each tick:
 *
 *   1. For each project where `ciFixer.enabled` is true, query `succeeded`
 *      runs that have a non-null `prUrl`.
 *   2. For each such run, fetch the check-runs for the PR's head commit SHA.
 *   3. If the verdict is `failing`, check retries + cooldown, then dispatch
 *      a `pr-fixer` run targeting the original PR's branch.
 *
 * Retry and cooldown tracking: counts `pr-fixer` runs that carry the original
 * run's id as `parentRunId`. A zero retry cap or cooldown window falls through
 * to dispatch immediately — safe because `decideDispatch` enforces the gates.
 *
 * The function is designed to be called per-project from the existing tick
 * loop rather than owning its own interval, keeping single-flight and stop
 * semantics centralized in `startScheduler`.
 */

import type { Repos } from "../db/repos/index.ts";
import type { ProjectRow, RunRow } from "../db/schema.ts";
import { parsePullRequestUrl } from "../runs/pr.ts";
import type { LoadedWarrenConfig } from "../warren-config/index.ts";
import {
	type CiFixerConfig,
	DEFAULT_CI_FIXER_COOLDOWN_MINUTES,
	DEFAULT_CI_FIXER_LOG_TAIL_LINES,
	DEFAULT_CI_FIXER_MAX_RETRIES,
	DEFAULT_CI_FIXER_ROLE,
} from "../warren-config/schema.ts";
import { classifyCheckRuns, fetchCheckRuns } from "./check-runs.ts";
import { buildFixerPrompt, decideDispatch, fetchJobLog } from "./dispatch.ts";
import type { SpawnFixerFn } from "./spawn.ts";

export interface CiFixerTickLogger {
	info(obj: Record<string, unknown>, msg?: string): void;
	warn(obj: Record<string, unknown>, msg?: string): void;
	error(obj: Record<string, unknown>, msg?: string): void;
}

export interface CiFixerTickDeps {
	readonly repos: Pick<Repos, "runs">;
	readonly githubToken: string;
	readonly spawnFixer: SpawnFixerFn;
	readonly now?: () => Date;
	readonly logger?: CiFixerTickLogger;
	/** Test seam — defaults to `globalThis.fetch`. */
	readonly fetch?: typeof fetch;
}

export type CiFixerRunResultKind = "dispatched" | "skipped" | "error";

export type CiFixerRunResult =
	| { readonly kind: "dispatched"; readonly runId: string; readonly prUrl: string }
	| { readonly kind: "skipped"; readonly reason: string; readonly prUrl: string }
	| { readonly kind: "error"; readonly prUrl: string; readonly message: string };

export interface RunCiFixerTickResult {
	readonly dispatched: number;
	readonly skipped: number;
	readonly errors: number;
	readonly results: readonly CiFixerRunResult[];
}

const EMPTY_RESULT: RunCiFixerTickResult = {
	dispatched: 0,
	skipped: 0,
	errors: 0,
	results: [],
};

/**
 * Run one CI-fixer pass for a single project. Called by `runProjectTick`
 * in `src/triggers/tick.ts` after the cron and scheduled-seed passes.
 */
export async function runCiFixerTick(input: {
	readonly project: ProjectRow;
	readonly config: LoadedWarrenConfig;
	readonly deps: CiFixerTickDeps;
	readonly now: Date;
}): Promise<RunCiFixerTickResult> {
	const { project, config, deps, now } = input;
	const ciFixerRaw = config.defaults?.ciFixer;

	// Off by default — skip if the project hasn't opted in.
	if (!ciFixerRaw?.enabled) {
		return EMPTY_RESULT;
	}

	const settings: CiFixerConfig = {
		enabled: ciFixerRaw.enabled,
		maxRetries: ciFixerRaw.maxRetries ?? DEFAULT_CI_FIXER_MAX_RETRIES,
		cooldownMinutes: ciFixerRaw.cooldownMinutes ?? DEFAULT_CI_FIXER_COOLDOWN_MINUTES,
		logTailLines: ciFixerRaw.logTailLines ?? DEFAULT_CI_FIXER_LOG_TAIL_LINES,
		role: ciFixerRaw.role ?? DEFAULT_CI_FIXER_ROLE,
	};

	let succeededRuns: RunRow[];
	try {
		succeededRuns = await deps.repos.runs.listSucceededWithPrUrl(project.id);
	} catch (err) {
		deps.logger?.error(
			{ projectId: project.id, err: formatError(err) },
			"ci_fixer.list_runs_failed",
		);
		return EMPTY_RESULT;
	}

	const results: CiFixerRunResult[] = [];

	for (const run of succeededRuns) {
		const prUrl = run.prUrl as string;
		const result = await processRun({ run, prUrl, project, settings, deps, now });
		results.push(result);
		if (result.kind === "dispatched") {
			deps.logger?.info(
				{ projectId: project.id, runId: run.id, prUrl, fixerRunId: result.runId },
				"ci_fixer.dispatched",
			);
		} else if (result.kind === "error") {
			deps.logger?.warn(
				{ projectId: project.id, runId: run.id, prUrl, message: result.message },
				"ci_fixer.error",
			);
		}
	}

	return {
		dispatched: results.filter((r) => r.kind === "dispatched").length,
		skipped: results.filter((r) => r.kind === "skipped").length,
		errors: results.filter((r) => r.kind === "error").length,
		results,
	};
}

async function processRun(input: {
	readonly run: RunRow;
	readonly prUrl: string;
	readonly project: ProjectRow;
	readonly settings: CiFixerConfig;
	readonly deps: CiFixerTickDeps;
	readonly now: Date;
}): Promise<CiFixerRunResult> {
	const { run, prUrl, project, settings, deps, now } = input;

	const parsed = parsePullRequestUrl(prUrl);
	if (parsed === null) {
		return { kind: "error", prUrl, message: `could not parse PR URL: ${prUrl}` };
	}

	// Fetch the PR head branch + check-runs via a single PR lookup + check-runs call.
	const prResult = await fetchPrHeadAndCheckRuns(
		parsed.owner,
		parsed.repo,
		parsed.number,
		deps.githubToken,
		deps.fetch,
	);
	if (prResult.kind !== "ok") {
		return { kind: "error", prUrl, message: prResult.message };
	}

	const { verdict, failures } = classifyCheckRuns(prResult.checkRuns);

	let history: { attempts: number; lastAttemptAt: string | null };
	try {
		const raw = await deps.repos.runs.countFixerRunsForParent(run.id, settings.role);
		history = { attempts: raw.count, lastAttemptAt: raw.lastEndedAt };
	} catch (err) {
		return {
			kind: "error",
			prUrl,
			message: `could not count prior fixer runs: ${formatError(err)}`,
		};
	}

	const decision = decideDispatch({ settings, verdict, history, now });
	if (decision.kind === "skip") {
		return { kind: "skipped", reason: decision.reason, prUrl };
	}

	// Fetch CI log tail for the first failing check-run (best-effort).
	let logTail: string | null = null;
	const firstFailure = failures[0];
	if (firstFailure !== undefined && firstFailure.id > 0) {
		const logResult = await fetchJobLog({
			owner: parsed.owner,
			repo: parsed.repo,
			jobId: firstFailure.id,
			token: deps.githubToken,
			logTailLines: settings.logTailLines,
			...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
		});
		if (logResult.kind === "ok") {
			logTail = logResult.logTail;
		}
	}

	const prompt = buildFixerPrompt({ prUrl, failures, logTail });

	try {
		const fixerRunId = await deps.spawnFixer({
			projectId: project.id,
			agentName: settings.role,
			prompt,
			parentRunId: run.id,
			targetBranch: prResult.prHeadBranch,
			trigger: "ci-fixer",
		});
		return { kind: "dispatched", runId: fixerRunId, prUrl };
	} catch (err) {
		return { kind: "error", prUrl, message: `spawn failed: ${formatError(err)}` };
	}
}

interface PrHeadAndCheckRunsResult {
	readonly kind: "ok";
	readonly checkRuns: ReturnType<typeof classifyCheckRuns>["failures"];
	readonly prHeadBranch: string;
}

type FetchPrResult =
	| PrHeadAndCheckRunsResult
	| { readonly kind: "error"; readonly message: string };

async function fetchPrHeadAndCheckRuns(
	owner: string,
	repo: string,
	prNumber: number,
	token: string,
	fetchImpl?: typeof fetch,
): Promise<FetchPrResult> {
	if (token === "") {
		return { kind: "error", message: "GITHUB_TOKEN unset; cannot check CI" };
	}

	const fn = fetchImpl ?? globalThis.fetch;
	const headers: Record<string, string> = {
		accept: "application/vnd.github+json",
		authorization: `Bearer ${token}`,
		"user-agent": "warren-ci-fixer",
		"x-github-api-version": "2022-11-28",
	};

	// Fetch the PR to learn head SHA + branch.
	const prApiUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;
	let prRes: Response;
	try {
		prRes = await fn(prApiUrl, { method: "GET", headers });
	} catch (err) {
		return { kind: "error", message: err instanceof Error ? err.message : String(err) };
	}

	if (!prRes.ok) {
		const text = await safeText(prRes);
		return {
			kind: "error",
			message: `GET /pulls/${prNumber} returned ${prRes.status}: ${text.slice(0, 300)}`,
		};
	}

	const prBody = (await safeJson(prRes)) as {
		head?: { ref?: unknown; sha?: unknown };
		state?: unknown;
	} | null;

	if (prBody?.state !== "open") {
		return { kind: "error", message: "PR is not open; skipping CI check" };
	}
	const headSha = typeof prBody?.head?.sha === "string" ? prBody.head.sha : null;
	const headBranch = typeof prBody?.head?.ref === "string" ? prBody.head.ref : "";

	if (headSha === null) {
		return { kind: "error", message: "could not read PR head SHA" };
	}

	const checkResult = await fetchCheckRuns({
		owner,
		repo,
		ref: headSha,
		token,
		...(fetchImpl !== undefined ? { fetch: fetchImpl } : {}),
	});

	if (checkResult.kind !== "ok") {
		return {
			kind: "error",
			message: checkResult.kind === "missing_token" ? checkResult.message : checkResult.message,
		};
	}

	return { kind: "ok", checkRuns: checkResult.checkRuns, prHeadBranch: headBranch };
}

async function safeJson(res: Response): Promise<unknown> {
	try {
		return await res.json();
	} catch {
		return null;
	}
}

async function safeText(res: Response): Promise<string> {
	try {
		return await res.text();
	} catch {
		return "";
	}
}

function formatError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
