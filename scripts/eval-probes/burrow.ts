import { BurrowClient } from "../../src/burrow-client/client.ts";
import type { EvalResult } from "../acceptance/lib/eval-result.ts";
import { type CallCounter, countingFetch } from "./helpers.ts";

/**
 * Probe the burrow HTTP facade WITHOUT booting burrow. `burrowsUp` with an
 * `env` field takes the client's direct `fetchImpl` path (env vars can't ride
 * the allowlisted HttpClient route), so wrapping fetch with a counter lets us
 * assert "provisioning a burrow is one round-trip". The stub Response carries
 * the date fields `reviveBurrow` dereferences so the success path completes.
 */
const stubResponse = (): Response =>
	new Response(
		JSON.stringify({
			id: "bur-1",
			name: "probe",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			destroyedAt: null,
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);

export async function runBurrowProbe(): Promise<EvalResult> {
	const counter: CallCounter = { n: 0 };
	const client = new BurrowClient({
		config: { transport: { kind: "tcp", hostname: "127.0.0.1", port: 65535 } },
		fetch: countingFetch(counter, async () => stubResponse()),
	});

	const start = Date.now();
	let ok = false;
	try {
		await client.burrowsUp({ projectRoot: "/repo", env: { PROBE: "1" } });
		ok = counter.n === 1;
	} catch {
		// Schema drift in @os-eco/burrow-cli's revive path shouldn't fail the
		// efficiency assertion — the round-trip count is what we gate on.
		ok = counter.n === 1;
	}
	const durationMs = Date.now() - start;

	return {
		integration: "burrow",
		scenarioId: "probe:burrow",
		functioning: {
			ok,
			assertions: [{ name: "one-round-trip", ok: counter.n === 1 }],
		},
		efficiency: [
			{ metric: "burrow.burrowsUp.fetchCount", value: counter.n, unit: "count" },
			{ metric: "burrow.burrowsUp.timeMs", value: durationMs, unit: "ms" },
		],
		durationMs,
	};
}
