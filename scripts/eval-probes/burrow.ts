import { BurrowClient } from "../../src/burrow-client/client.ts";
import type { EvalResult } from "../acceptance/lib/eval-result.ts";
import { type CallCounter, countingFetch } from "./helpers.ts";

/**
 * Probe the burrow HTTP facade WITHOUT booting burrow. `burrowsUp` with an
 * `env` field takes the client's direct `fetchImpl` path (env vars can't ride
 * the allowlisted HttpClient route), so wrapping fetch with a counter lets us
 * assert "provisioning a burrow is one round-trip". The stub Response carries
 * the date fields `reviveBurrow` dereferences so the success path completes.
 *
 * A thrown `burrowsUp()` (e.g. burrow-cli's revive schema drifts) is a real
 * functional break, so it fails `functioning.ok` with a `burrowsUp-succeeded`
 * assertion carrying the error — the fetch-count metric is still emitted so
 * the budget gate keeps working even on the failing path.
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

export async function runBurrowProbe(
	fetchImpl: (input: Request | string | URL, init?: RequestInit) => Promise<Response> = async () =>
		stubResponse(),
): Promise<EvalResult> {
	const counter: CallCounter = { n: 0 };
	const client = new BurrowClient({
		config: { transport: { kind: "tcp", hostname: "127.0.0.1", port: 65535 } },
		fetch: countingFetch(counter, fetchImpl),
	});

	const start = Date.now();
	let threw: string | null = null;
	try {
		await client.burrowsUp({ projectRoot: "/repo", env: { PROBE: "1" } });
	} catch (err) {
		threw = err instanceof Error ? err.message : String(err);
	}
	const durationMs = Date.now() - start;

	const oneRoundTrip = counter.n === 1;
	const succeeded = threw === null;
	return {
		integration: "burrow",
		scenarioId: "probe:burrow",
		functioning: {
			ok: succeeded && oneRoundTrip,
			assertions: [
				{ name: "one-round-trip", ok: oneRoundTrip },
				{ name: "burrowsUp-succeeded", ok: succeeded, ...(threw !== null && { detail: threw }) },
			],
		},
		efficiency: [
			{ metric: "burrow.burrowsUp.fetchCount", value: counter.n, unit: "count" },
			{ metric: "burrow.burrowsUp.timeMs", value: durationMs, unit: "ms" },
		],
		durationMs,
	};
}
