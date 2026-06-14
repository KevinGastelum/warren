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

type SpawnLike = (cmd: readonly string[], opts: unknown) => Promise<unknown>;

export function countingSpawn<T extends SpawnLike>(counter: CallCounter, inner: T): T {
	const wrapped = (cmd: readonly string[], opts: unknown) => {
		counter.n += 1;
		return inner(cmd, opts);
	};
	return wrapped as T;
}

export function countingFetch(counter: CallCounter, inner: typeof fetch): typeof fetch {
	const wrapped = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
		counter.n += 1;
		return inner(input, init);
	}) as typeof fetch;
	return wrapped;
}

export function byteLen(s: string): number {
	return Buffer.byteLength(s, "utf8");
}
