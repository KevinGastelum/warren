import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AgentPlotClient,
	isAgentPlotClient,
	isUserPlotClient,
	openPlotClient,
	UserPlotClient,
} from "./client.ts";
import { PlotAgentACLViolationError } from "./errors.ts";
import { AgentPlotHandle, UserPlotHandle } from "./handle.ts";
import { HUMANS_ONLY_EVENT_TYPES } from "./types.ts";

function makePlotDir(): string {
	return mkdtempSync(join(tmpdir(), "warren-plot-client-"));
}

describe("openPlotClient", () => {
	test("returns a UserPlotClient for a user actor", () => {
		const dir = makePlotDir();
		try {
			const client = openPlotClient({
				dir,
				actor: { kind: "user", handle: "alice", raw: "user:alice" },
			});
			try {
				expect(client).toBeInstanceOf(UserPlotClient);
				expect(isUserPlotClient(client)).toBe(true);
				expect(isAgentPlotClient(client)).toBe(false);
			} finally {
				client.close();
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("returns an AgentPlotClient for an agent actor", () => {
		const dir = makePlotDir();
		try {
			const client = openPlotClient({
				dir,
				actor: {
					kind: "agent",
					name: "claude-code",
					runId: "run-1",
					raw: "agent:claude-code:run-1",
				},
			});
			try {
				expect(client).toBeInstanceOf(AgentPlotClient);
				expect(isAgentPlotClient(client)).toBe(true);
				expect(isUserPlotClient(client)).toBe(false);
			} finally {
				client.close();
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("AgentPlotClient", () => {
	test("get() returns an AgentPlotHandle", () => {
		const dir = makePlotDir();
		const client = new AgentPlotClient({
			dir,
			actor: {
				kind: "agent",
				name: "claude-code",
				runId: "run-1",
				raw: "agent:claude-code:run-1",
			},
		});
		try {
			const handle = client.get("pl-deadbeef");
			expect(handle).toBeInstanceOf(AgentPlotHandle);
		} finally {
			client.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test.each(
		HUMANS_ONLY_EVENT_TYPES.map((t) => [t] as const),
	)("refuses to construct %s through the full client→handle path", (eventType) => {
		// End-to-end check: a real AgentPlotClient against a real .plot/
		// dir. We never have to call PlotStore.append because the facade
		// throws first — that's the second line of defense the SPEC §6
		// library ACL also enforces, but we want the warren-side error
		// (`plot_agent_acl_violation`) to win so HTTP responses are
		// stable across Plot library upgrades.
		const dir = makePlotDir();
		const client = new AgentPlotClient({
			dir,
			actor: {
				kind: "agent",
				name: "claude-code",
				runId: "run-1",
				raw: "agent:claude-code:run-1",
			},
		});
		try {
			const handle = client.get("pl-deadbeef");
			const call = () =>
				handle.append({ type: eventType, data: {} } as unknown as {
					type: "note";
					data: Record<string, unknown>;
				});
			expect(call).toThrow(PlotAgentACLViolationError);
			try {
				call();
			} catch (err) {
				expect(err).toMatchObject({
					code: "plot_agent_acl_violation",
					eventType,
				});
			}
		} finally {
			client.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("does not expose a create() method on the agent client", () => {
		// `plot_created` is allowed for both actor kinds per SPEC §6, but
		// warren only ever creates Plots from user-facing actions (see
		// client.ts:97-103 docstring). Keeping `create` off the agent client
		// makes that intent enforceable at the type level.
		const proto = AgentPlotClient.prototype as unknown as Record<string, unknown>;
		expect(proto.create).toBeUndefined();
	});

	test("get() typing narrows away the user-only mutators", () => {
		// Compile-time guard: AgentPlotClient.get's return type is
		// AgentPlotHandle, so any warren code that resolves a client at the
		// `UserPlotClient | AgentPlotClient` union and then calls a user-only
		// mutator must narrow with isUserPlotClient first. The @ts-expect-error
		// lines below pin that contract.
		const dir = makePlotDir();
		const client = new AgentPlotClient({
			dir,
			actor: {
				kind: "agent",
				name: "claude-code",
				runId: "run-1",
				raw: "agent:claude-code:run-1",
			},
		});
		try {
			const handle = client.get("pl-deadbeef");
			// @ts-expect-error — editIntent does not exist on AgentPlotHandle
			void ((h: typeof handle) => h.editIntent({ goal: "x" }));
			// @ts-expect-error — setStatus does not exist on AgentPlotHandle
			void ((h: typeof handle) => h.setStatus("ready"));
			// @ts-expect-error — detach does not exist on AgentPlotHandle
			void ((h: typeof handle) => h.detach("att-001"));
			// @ts-expect-error — create is user-only on the client surface
			void ((c: AgentPlotClient) => c.create({ name: "x" }));
		} finally {
			client.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("UserPlotClient", () => {
	test("get() returns a UserPlotHandle", () => {
		const dir = makePlotDir();
		const client = new UserPlotClient({
			dir,
			actor: { kind: "user", handle: "alice", raw: "user:alice" },
		});
		try {
			const handle = client.get("pl-deadbeef");
			expect(handle).toBeInstanceOf(UserPlotHandle);
		} finally {
			client.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
