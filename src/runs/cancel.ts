/**
 * `cancelRun` — SPEC §8.1 `POST /runs/:id/cancel`.
 *
 * Forwards a graceful cancel to burrow's `POST /runs/:burrow_run_id/cancel`
 * and emits a `cancel.requested` audit event on the warren run's event log.
 *
 * State transitions are deliberately *not* performed here. Reap (Phase 7)
 * is the only path that takes a non-terminal warren run to a terminal
 * state, because the terminal transition is paired with the mulch merge,
 * seeds-close mirror, and branch push. If `cancelRun` finalized the row
 * directly, reap would skip those reap sub-steps via its `isTerminal`
 * short-circuit, and the operator would silently lose the agent's
 * partial work. The pipeline is:
 *
 *   warren cancelRun → burrow cancels run → burrow emits run terminal
 *   event → bridgeRunStream persists it → reap fires with outcome=cancelled.
 *
 * Two corner cases bypass burrow:
 *   1. The run is already terminal. Burrow's cancel is itself idempotent
 *      (200 with the current row), but warren can answer locally without
 *      a wire call.
 *   2. The run is queued and has no `burrow_run_id`. This is the partial
 *      spawn window: a burrow was provisioned but `POST /burrows/:id/runs`
 *      never landed (or rolled back). The warren row is queued with
 *      burrow_run_id = null. There is nothing remote to cancel, so the
 *      warren row is transitioned queued → cancelled directly. Bypasses
 *      the reap pipeline because there's no burrow_run_id to read events
 *      from. Idempotent against a concurrent spawn rollback because
 *      the state-machine guard catches the race.
 *
 * Errors from burrow (`BurrowError`) and the transport layer
 * (`BurrowUnreachableError`) pass through unchanged so the HTTP route can
 * map them onto the response envelope.
 */

import type { Run as BurrowRun } from "@os-eco/burrow-cli";
import type { BurrowClient } from "../burrow-client/client.ts";
import { withTransportMapping } from "../burrow-client/client.ts";
import { ValidationError } from "../core/errors.ts";
import type { Repos } from "../db/repos/index.ts";
import type { RunState } from "../db/schema.ts";
import type { RunEventBroker } from "./events.ts";

export interface CancelRunInput {
	readonly runId: string;
	readonly reason?: string;
	readonly repos: Repos;
	readonly burrowClient: BurrowClient;
	/** If supplied, the audit event is published here too. */
	readonly broker?: RunEventBroker;
	readonly now?: () => Date;
}

export interface CancelRunResult {
	/** Warren run state after the call. Unchanged for the common path; only updated for the no-burrow_run_id direct cancel. */
	readonly state: RunState;
	/** The burrow run row returned by burrow's cancel endpoint, or null when the call was bypassed (terminal / no burrow_run_id). */
	readonly burrowRun: BurrowRun | null;
	/** True when the warren row was already terminal on entry — no work was done. */
	readonly alreadyTerminal: boolean;
}

export async function cancelRun(input: CancelRunInput): Promise<CancelRunResult> {
	const run = input.repos.runs.require(input.runId);

	if (isTerminal(run.state)) {
		return { state: run.state, burrowRun: null, alreadyTerminal: true };
	}

	if (run.burrowRunId === null) {
		// Partial spawn — never made it to POST /burrows/:id/runs. The warren
		// state machine allows queued → cancelled directly. A running row
		// without a burrow_run_id is not a state the spawn flow can produce,
		// so reject it loudly.
		if (run.state !== "queued") {
			throw new ValidationError(
				`run is in state '${run.state}' but has no burrow_run_id; cannot cancel`,
			);
		}
		const updated = input.repos.runs.finalize(run.id, "cancelled", input.now?.());
		emitCancelEvent(input, run.id, { reason: input.reason, mode: "warren_only" });
		return { state: updated.state, burrowRun: null, alreadyTerminal: false };
	}

	const burrowRunId = run.burrowRunId;
	const burrowRun = await withTransportMapping(input.burrowClient.config, () =>
		input.burrowClient.http.runs.cancel(
			burrowRunId,
			input.reason !== undefined ? { reason: input.reason } : {},
		),
	);

	emitCancelEvent(input, run.id, {
		reason: input.reason,
		mode: "forwarded",
		burrowRunId,
		burrowRunState: burrowRun.state,
	});

	return { state: run.state, burrowRun, alreadyTerminal: false };
}

function emitCancelEvent(input: CancelRunInput, runId: string, payload: object): void {
	const now = input.now ?? (() => new Date());
	const seq = (input.repos.events.maxSeqForRun(runId) ?? 0) + 1;
	const row = input.repos.events.append({
		runId,
		burrowEventSeq: seq,
		ts: now().toISOString(),
		kind: "cancel.requested",
		stream: "system",
		payload,
	});
	input.broker?.publish(runId, row);
}

function isTerminal(state: string): boolean {
	return state === "succeeded" || state === "failed" || state === "cancelled";
}
