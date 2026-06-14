/**
 * Shared instrumentation for efficiency probes. Each helper wraps an
 * injectable seam (spawn / fetch) with a mutable counter so a probe can
 * assert "this operation costs exactly N shell-outs / round-trips" with
 * zero run-to-run variance. There is no built-in counter in warren —
 * wrapping the seam is the only observation point.
 */
export interface CallCounter {
	n: number;
}

/**
 * Variadic so the wrapper preserves the inner fn's EXACT signature. A
 * fixed `(cmd, opts: unknown)` shape would reject narrower seams like
 * canopy's `SpawnFn` (opts: SpawnOptions) under strictFunctionTypes —
 * param contravariance makes the narrower type non-assignable.
 */
export function countingSpawn<A extends readonly unknown[], R>(
	counter: CallCounter,
	inner: (...args: A) => R,
): (...args: A) => R {
	return (...args: A) => {
		counter.n += 1;
		return inner(...args);
	};
}

/**
 * Loose fetch shape: the wrapper only needs to forward args and return a
 * response, so the inner stub need not carry `fetch`'s extra `preconnect`
 * member. The wrapper is cast back to `typeof fetch` so callers that type
 * their seam as `typeof fetch` (e.g. BurrowClient) accept it.
 */
type FetchLike = (
	input: Parameters<typeof fetch>[0],
	init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

export function countingFetch(counter: CallCounter, inner: FetchLike): typeof fetch {
	const wrapped = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
		counter.n += 1;
		return inner(input, init);
	}) as typeof fetch;
	return wrapped;
}

export function byteLen(s: string): number {
	return Buffer.byteLength(s, "utf8");
}
