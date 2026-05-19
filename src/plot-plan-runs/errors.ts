/**
 * Errors specific to the `POST /plot-plan-runs` synthesis handler
 * (warren-99b2 / pl-f404 step 3 / SPEC §11.Q).
 *
 * Two error families live here:
 *   - `NoDispatchableSeedsError` (400) — handler-edge rejection when a
 *      Plot has zero open non-`sd_plan` `seeds_issue` attachments. Mapped
 *      to 400 in src/server/errors.ts alongside ValidationError and the
 *      `ProjectLacks*Error` family.
 *   - `SdPlanSynthesisError` (500) — internal failure from the
 *      synthesizer's `sd create` / `sd plan submit` shell-out. Surfaces
 *      as 500 because the caller-side request was well-formed; the
 *      failure is on warren's side (seeds-cli refused to write, host
 *      lock contention, partial state). Distinguished from the
 *      generic `SeedsCliError` so consumers can branch on it.
 */

import { WarrenError } from "../core/errors.ts";

export class NoDispatchableSeedsError extends WarrenError {
	readonly code = "no_dispatchable_seeds";
}

export class SdPlanSynthesisError extends WarrenError {
	readonly code = "sd_plan_synthesis_error";
}
