/**
 * Errors specific to the R-06 scheduler module.
 *
 * `TriggerDispatchError` covers failures inside a single trigger dispatch
 * (cron-grammar parse failure, malformed seed reference) — recoverable
 * per-trigger, not fatal to the tick. The tick loop catches these so a
 * single bad entry can't take down the whole scheduler.
 *
 * Seeds CLI shell-out errors live in `src/seeds-cli/` since they are
 * shared with the post-dispatch updateExtensions path (R-01).
 */

import { WarrenError } from "../core/errors.ts";

export class TriggerDispatchError extends WarrenError {
	readonly code = "trigger_dispatch_error";
}
