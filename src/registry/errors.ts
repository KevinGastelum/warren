/**
 * Errors specific to the canopy agent registry.
 *
 * `CanopyUnavailableError` covers shell-out failures: `cn`/`git` binary
 * missing, clone refused, network down, working tree corrupt. Maps to a 503
 * at the warren HTTP boundary — registry refresh is not a per-request
 * concern, so the right operator action is "fix the canopy install" rather
 * than "retry the request".
 *
 * `AgentSchemaError` covers a single prompt that fails warren's semantic
 * validation (e.g., missing `system` section). The registry refresh
 * collects these per-prompt rather than aborting the whole refresh, so a
 * malformed prompt only dispatches itself, not the others.
 */

import { WarrenError } from "../core/errors.ts";

export class CanopyUnavailableError extends WarrenError {
	readonly code = "canopy_unavailable";
}

export class AgentSchemaError extends WarrenError {
	readonly code = "agent_schema_error";
}
