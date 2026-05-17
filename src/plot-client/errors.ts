/**
 * Errors specific to warren's facade over `@os-eco/plot-cli`.
 *
 * The Plot library itself enforces SPEC §6 write-ACL: agents may not
 * emit `intent_edited` / `status_changed` / `attachment_removed` /
 * `question_answered`. That guard is the system-of-record. This facade
 * adds a *second* guard at the warren↔Plot boundary so warren's own
 * code can never accidentally construct one of those calls from an
 * agent actor — the type system rejects it at compile time, this error
 * fires at runtime if the type system is bypassed (e.g. dynamic event
 * type from a wire payload).
 *
 * The Plot library would still refuse the write — this just lets warren
 * fail with a stable, code-tagged error before reaching `assertCanEmit`
 * so HTTP responses and logs say `plot_agent_acl_violation` instead of
 * a raw `Error` thrown from inside the library.
 */

import { WarrenError } from "../core/errors.ts";

export class PlotAgentACLViolationError extends WarrenError {
	readonly code = "plot_agent_acl_violation";
	readonly eventType: string;

	constructor(eventType: string, options?: { cause?: unknown }) {
		super(
			`plot facade: agent actors cannot emit ${JSON.stringify(eventType)} (humans-only per Plot SPEC §6)`,
			{
				...(options?.cause !== undefined ? { cause: options.cause } : {}),
				recoveryHint:
					"agents surface a `question_posed` event for a human to act on; only user actors can mutate intent/status/attachments or answer questions",
			},
		);
		this.eventType = eventType;
	}
}
