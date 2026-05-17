/**
 * Event-type partitions used by the facade's write-ACL narrowing.
 *
 * `HUMANS_ONLY_EVENT_TYPES` mirrors the SPEC §6 ACL entries whose
 * `allowed` list is exactly `["user"]`. Keeping the constant local to
 * warren means a Plot SPEC change that loosens an ACL entry won't
 * silently relax warren's facade — the lists drift, CI fails on the
 * type narrowing, and we make a deliberate decision to follow.
 *
 * The `as const satisfies` shape pins each literal at compile time
 * against Plot's exported `PlotEventType`, so a future Plot rename
 * (e.g. `intent_edited` → `intent_updated`) shows up here as a type
 * error rather than a silent miss.
 */

import type { PlotEventType } from "@os-eco/plot-cli";

export const HUMANS_ONLY_EVENT_TYPES = [
	"intent_edited",
	"status_changed",
	"attachment_removed",
	"question_answered",
] as const satisfies readonly PlotEventType[];

export type HumansOnlyEventType = (typeof HUMANS_ONLY_EVENT_TYPES)[number];

/**
 * Event types an agent actor may construct via the facade's generic
 * `append()` surface. The four dedicated mutators (`editIntent`,
 * `setStatus`, `detach`, plus `question_answered` appends) live only
 * on `UserPlotHandle`, so the narrowing here covers the one append
 * path agents share with users (`question_answered`) and lets the
 * other three drop out of the agent surface entirely.
 */
export type AgentAllowedEventType = Exclude<PlotEventType, HumansOnlyEventType>;

export function isHumansOnlyEventType(value: string): value is HumansOnlyEventType {
	return (HUMANS_ONLY_EVENT_TYPES as readonly string[]).includes(value);
}
