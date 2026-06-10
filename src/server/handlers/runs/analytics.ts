/**
 * Run analytics handlers (warren-0692 / pl-ad0f step 2).
 *
 * Thin `RouteHandler` factories over the pure `buildRunMetrics`
 * aggregator (`src/runs/analytics/run-metrics.ts`). Mirrors the cost
 * analytics handler exactly: parse + validate the `?from`/`?to`/
 * `?projectId` window, fetch the matching `runs` rows via
 * `RunsRepo.listForAnalytics`, hydrate usage so bridge-died terminal
 * runs still carry cost/token totals, map each row into a flat
 * `RunMetricsRow` (extracting `provider`/`model` from the rendered
 * agent frontmatter), then emit the rollup wrapped in the resolved
 * `filter` echo.
 */

import type { EventsRepo } from "../../../db/repos/events.ts";
import type { RunRow } from "../../../db/schema.ts";
import {
	buildCommandMining,
	buildInsights,
	buildRunMetrics,
	hydrateRunsUsage,
	type RunMetrics,
	type RunMetricsRow,
	type SteeringSignals,
	type ToolEventRow,
} from "../../../runs/index.ts";
import { jsonResponse } from "../../response.ts";
import type { RouteHandler, ServerDeps } from "../../types.ts";
import {
	extractProviderModel,
	parseAnalyticsDateBound,
	resolveAnalyticsFrom,
} from "./lifecycle.ts";

/** Resolved `?from`/`?to`/`?projectId` analytics window. */
interface AnalyticsWindow {
	projectId?: string;
	from?: string;
	to?: string;
}

/**
 * Parse + resolve the shared `?from`/`?to`/`?projectId` window. Defaults the
 * `from` bound to the last 30 days when neither bound is supplied, matching
 * `GET /analytics/cost`. Both bounds and `projectId` are validated lightly — a
 * malformed date is a 400 because the lexicographic ISO8601 compare in
 * `listForAnalytics` would silently produce surprising results otherwise.
 */
function resolveAnalyticsWindow(ctx: { url: URL }): {
	echo: { projectId: string | null; from: string | null; to: string | null };
	filter: AnalyticsWindow;
} {
	const projectId = ctx.url.searchParams.get("projectId") ?? undefined;
	const from = parseAnalyticsDateBound(ctx, "from");
	const to = parseAnalyticsDateBound(ctx, "to");
	const defaultFrom = resolveAnalyticsFrom(from, to);
	const filter: AnalyticsWindow = {};
	if (projectId !== undefined) filter.projectId = projectId;
	if (defaultFrom !== undefined) filter.from = defaultFrom;
	if (to !== undefined) filter.to = to;
	return {
		echo: { projectId: projectId ?? null, from: defaultFrom ?? null, to: to ?? null },
		filter,
	};
}

/** Map hydrated `runs` rows into the flat aggregator input shape. */
function toMetricsRows(rows: readonly RunRow[]): RunMetricsRow[] {
	return rows.map((r) => {
		const { provider, model } = extractProviderModel(r.renderedAgentJson);
		return {
			runId: r.id,
			projectId: r.projectId,
			agentName: r.agentName,
			provider: provider ?? null,
			model: model ?? null,
			seedId: r.seedId,
			state: r.state,
			failureReason: r.failureReason,
			costUsd: r.costUsd,
			tokensInput: r.tokensInput,
			tokensCacheRead: r.tokensCacheRead,
			tokensOutput: r.tokensOutput,
			startedAt: r.startedAt,
			endedAt: r.endedAt,
		};
	});
}

/**
 * Fetch + hydrate the `runs` rows for an analytics window and compute the
 * run-level rollup. Shared by `GET /analytics/runs` (the rollup is the
 * response) and `GET /analytics/behavior` (the rollup feeds the derived
 * insights layer). Returns the hydrated rows too so the behavior handler can
 * derive the run-id set for its event scan without a second query.
 */
async function loadRunMetrics(
	deps: ServerDeps,
	filter: AnalyticsWindow,
): Promise<{ rows: RunRow[]; metrics: RunMetrics }> {
	const rowsRaw = await deps.repos.runs.listForAnalytics(filter);
	// Hydrate so terminal runs with bridge-died usage still count.
	const rows = await hydrateRunsUsage(rowsRaw, deps.repos.events);
	return { rows, metrics: buildRunMetrics(toMetricsRows(rows)) };
}

/** Map capped `tool_use`/`tool_result` event rows into the mining input shape. */
async function loadToolEventRows(
	events: EventsRepo,
	runIds: readonly string[],
): Promise<ToolEventRow[]> {
	const rows = await events.listToolEventsForRuns(runIds);
	return rows.map((e) => ({
		runId: e.runId,
		kind: e.kind,
		seq: e.burrowEventSeq,
		payload: e.payloadJson,
	}));
}

/**
 * `GET /analytics/runs?from=&to=&projectId=` (warren-0692 / pl-ad0f step 2).
 *
 * Window defaults to the last 30 days when neither bound is supplied,
 * matching `GET /analytics/cost`. Both bounds and `projectId` are
 * validated lightly — a malformed date is a 400 because the
 * lexicographic ISO8601 compare in `listForAnalytics` would silently
 * produce surprising results otherwise.
 */
export function listRunAnalyticsHandler(deps: ServerDeps): RouteHandler {
	return async (ctx) => {
		const { echo, filter } = resolveAnalyticsWindow(ctx);
		const { metrics } = await loadRunMetrics(deps, filter);
		return jsonResponse(200, { filter: echo, ...metrics });
	};
}

/**
 * Build {@link SteeringSignals} from the already-loaded run rows plus a
 * per-run steer-event count map (warren-92ad). Pause information comes
 * from the `pausedAt` column on each run row (non-null → paused at least
 * once); pause timeouts from the `PAUSE_TIMED_OUT_KIND` system event
 * kind are not available here, so we use `state === "failed"` with a
 * `paused_at` stamp as a conservative proxy.
 *
 * Steering messages are counted from `steer.sent` events written by
 * `steerRun()` into the events table, grouped by run.
 */
function buildSteeringSignals(
	rows: readonly RunRow[],
	steerCountsByRunId: ReadonlyMap<string, number>,
): SteeringSignals {
	let runsSteered = 0;
	let steeringMessages = 0;
	let runsPaused = 0;
	for (const r of rows) {
		const steerCount = steerCountsByRunId.get(r.id) ?? 0;
		if (steerCount > 0) {
			runsSteered += 1;
			steeringMessages += steerCount;
		}
		if (r.pausedAt !== null) runsPaused += 1;
	}
	return {
		totalRuns: rows.length,
		runsSteered,
		steeringMessages,
		runsPaused,
		pauseTimeouts: 0,
	};
}

/**
 * `GET /analytics/behavior?from=&to=&projectId=` (warren-5d50 / pl-ad0f step 9).
 *
 * The heavier companion to `GET /analytics/runs`. Resolves the same window,
 * loads the run-level rollup, then scans the capped `tool_use`/`tool_result`
 * event trace for those runs (`EventsRepo.listToolEventsForRuns`) and mines it
 * for the generalized command-frequency / failure / stuck-loop rankings
 * (`buildCommandMining`). Finally distills the metrics + mining into the
 * ranked, severity-coded callout list (`buildInsights`), including steering
 * and pause signals derived from `steer.sent` events and the `pausedAt` column
 * on each run row (warren-92ad).
 *
 * Note: `pauseTimeouts` is set to 0 because the `PAUSE_TIMED_OUT_KIND` system
 * event is an in-process signal not stored separately in the events table.
 */
export function listBehaviorAnalyticsHandler(deps: ServerDeps): RouteHandler {
	return async (ctx) => {
		const { echo, filter } = resolveAnalyticsWindow(ctx);
		const { rows, metrics } = await loadRunMetrics(deps, filter);
		const runIds = rows.map((r) => r.id);
		const [eventRows, steerCountsByRunId] = await Promise.all([
			loadToolEventRows(deps.repos.events, runIds),
			deps.repos.events.countSteerEventsByRuns(runIds),
		]);
		const mining = buildCommandMining(eventRows);
		const steering = buildSteeringSignals(rows, steerCountsByRunId);
		const insights = buildInsights({ metrics, mining, steering });
		return jsonResponse(200, { filter: echo, mining, insights });
	};
}
