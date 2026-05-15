/**
 * Errors specific to the seeds CLI shell-out facade.
 *
 * `SeedsCliError` covers failures shelling out to `sd` against a project
 * clone (binary missing, non-zero exit, malformed JSON). Callers (the
 * tick loop, the post-dispatch updateExtensions write) catch it
 * per-project / per-run so one broken `.seeds/` doesn't kill the
 * surrounding flow.
 */

import { WarrenError } from "../core/errors.ts";

export class SeedsCliError extends WarrenError {
	readonly code = "seeds_cli_error";
}
