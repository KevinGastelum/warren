/**
 * Type-narrowed wrappers around `@os-eco/plot-cli`'s `PlotHandle`.
 *
 * `UserPlotHandle` exposes the full mutating surface — intent edits,
 * status transitions, attach/detach, arbitrary `append`.
 * `AgentPlotHandle` exposes only the subset agents are allowed to
 * touch per SPEC §6: read, events, view, attach, and an `append`
 * narrowed to `AgentAllowedEventType`. The four humans-only event
 * types (`intent_edited`, `status_changed`, `attachment_removed`,
 * `question_answered`) are unreachable from this side of the boundary
 * — the first three because their dedicated mutators (`editIntent`,
 * `setStatus`, `detach`) don't exist on this class, and the fourth
 * because `append`'s generic parameter excludes it.
 *
 * The runtime guard inside `append` is defense in depth: if a caller
 * widens the type with `as` or feeds a dynamic event-type string from
 * a wire payload, we still refuse before reaching `PlotStore.append`
 * — see `PlotAgentACLViolationError`.
 */

import type {
	AgentActor,
	AttachInput,
	Attachment,
	Plot,
	PlotEvent,
	PlotEventType,
	PlotHandle,
	PlotStatus,
	UserActor,
} from "@os-eco/plot-cli";
import { PlotAgentACLViolationError } from "./errors.ts";
import { type AgentAllowedEventType, isHumansOnlyEventType } from "./types.ts";

export interface AgentAppendInput<T extends AgentAllowedEventType> {
	type: T;
	data: Record<string, unknown>;
}

export interface UserAppendInput<T extends PlotEventType> {
	type: T;
	data: Record<string, unknown>;
}

abstract class BasePlotHandle {
	constructor(protected readonly inner: PlotHandle) {}

	get id(): string {
		return this.inner.id;
	}

	read(): Promise<Plot> {
		return this.inner.read();
	}

	events(): Promise<PlotEvent[]> {
		return this.inner.events();
	}

	// Plot v1 only knows the `implementer` view; the underlying handle
	// throws on anything else. Mirror that signature so the facade has
	// the same single-view contract.
	view(name: "implementer") {
		return this.inner.view(name);
	}

	attach(input: AttachInput): Promise<Attachment> {
		return this.inner.attach(input);
	}
}

export class UserPlotHandle extends BasePlotHandle {
	readonly actorKind: UserActor["kind"] = "user";

	editIntent(patch: Parameters<PlotHandle["editIntent"]>[0]): Promise<Plot> {
		return this.inner.editIntent(patch);
	}

	detach(attachmentId: string): Promise<void> {
		return this.inner.detach(attachmentId);
	}

	setStatus(status: PlotStatus): Promise<Plot> {
		return this.inner.setStatus(status);
	}

	append<T extends PlotEventType>(input: UserAppendInput<T>): Promise<PlotEvent> {
		return this.inner.append(input);
	}
}

export class AgentPlotHandle extends BasePlotHandle {
	readonly actorKind: AgentActor["kind"] = "agent";

	append<T extends AgentAllowedEventType>(input: AgentAppendInput<T>): Promise<PlotEvent> {
		if (isHumansOnlyEventType(input.type)) {
			throw new PlotAgentACLViolationError(input.type);
		}
		return this.inner.append(input);
	}
}

export type AnyPlotHandle = UserPlotHandle | AgentPlotHandle;
