/**
 * `CanopyClient` — shell-out facade for the `cn` CLI.
 *
 * Warren's only seam to canopy is the `cn` binary; we never import
 * canopy as a library. Two reasons: canopy is git-native and works on
 * an on-disk `.canopy/` directory, and the same canopy CLI is the
 * supported contract for every other os-eco tool, so changes stay
 * visible at one boundary.
 *
 * The facade exposes two operations the registry refresh needs:
 *   - `listAgents()` — `cn list --tag agent --json`, returning prompt
 *     summaries warren cares about (name + version + status).
 *   - `renderAgent(name)` — `cn render <name> --format json`, returning
 *     the raw JSON envelope which `parseRenderedAgent` then validates.
 *
 * What the facade adds beyond a raw `Bun.spawn`:
 *   - Cwd is fixed to the cloned canopy library, so callers can't accidentally
 *     resolve `.canopy/` in the wrong place.
 *   - Transport-layer failures (binary missing, non-zero exit, malformed
 *     JSON, empty stdout) become `CanopyUnavailableError`, mirroring the
 *     burrow-client transport-error mapping pattern.
 *   - Spawn is injectable so tests can stub `cn` without a real binary on PATH.
 *
 * What the facade deliberately does not do:
 *   - No retry. Same posture as burrow-client: registry refresh is operator-
 *     triggered, not request-driven, so explicit failure is more useful than
 *     hidden retry.
 *   - No semantic validation. That lives in `schema.ts` and is applied by
 *     `refresh.ts`, so a malformed prompt only kills its own row, not the
 *     whole refresh.
 */

import { z } from "zod";
import type { CanopyRegistryConfig } from "./config.ts";
import { CanopyUnavailableError } from "./errors.ts";

export interface SpawnResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
}

export interface SpawnOptions {
	readonly cwd: string;
	readonly timeoutMs?: number;
}

export type SpawnFn = (cmd: readonly string[], opts: SpawnOptions) => Promise<SpawnResult>;

export const DEFAULT_CANOPY_TIMEOUT_MS = 30_000;

const AgentSummarySchema = z.object({
	name: z.string().min(1),
	version: z.number().int().positive(),
	status: z.enum(["draft", "active", "archived"]).optional(),
	tags: z.array(z.string()).optional(),
});

export type AgentSummary = z.infer<typeof AgentSummarySchema>;

const ListResponseSchema = z.object({
	success: z.literal(true),
	command: z.literal("list"),
	prompts: z.array(AgentSummarySchema.passthrough()),
});

const ErrorResponseSchema = z.object({
	success: z.literal(false),
	command: z.string().optional(),
	error: z.string(),
});

export interface CanopyClientOptions {
	readonly config: CanopyRegistryConfig;
	readonly spawn?: SpawnFn;
	readonly timeoutMs?: number;
}

export class CanopyClient {
	private readonly config: CanopyRegistryConfig;
	private readonly spawn: SpawnFn;
	private readonly timeoutMs: number;

	constructor(opts: CanopyClientOptions) {
		this.config = opts.config;
		this.spawn = opts.spawn ?? defaultSpawn;
		this.timeoutMs = opts.timeoutMs ?? DEFAULT_CANOPY_TIMEOUT_MS;
	}

	/** List prompts tagged `agent`, filtered to active status. */
	async listAgents(): Promise<AgentSummary[]> {
		const result = await this.invoke(["list", "--tag", "agent", "--json"]);
		const parsed = parseEnvelope(result, ListResponseSchema, "cn list");
		return parsed.prompts.filter((p) => p.status === undefined || p.status === "active");
	}

	/** Render a single prompt by name, returning the raw JSON envelope. */
	async renderAgent(name: string): Promise<unknown> {
		// Use the global `--json` flag, not `cn render --format json`. The
		// former emits canopy's full `{success, command, ...}` envelope (so
		// `success: false` errors round-trip cleanly); the latter emits a
		// bare object without `success`/`command`, which makes auth-vs-failure
		// disambiguation lossy.
		const result = await this.invoke(["render", name, "--json"]);
		// Best-effort extraction of canopy's structured `{success: false, error}` envelope
		// so warren reports e.g. "Prompt not found" instead of a raw JSON parse failure.
		const peek = tryParseJson(result.stdout);
		if (peek !== undefined) {
			const errResp = ErrorResponseSchema.safeParse(peek);
			if (errResp.success) {
				throw new CanopyUnavailableError(`cn render ${name} failed: ${errResp.data.error}`, {
					recoveryHint: "verify the prompt exists in the canopy repo (`cn list`)",
				});
			}
		}
		if (result.exitCode !== 0) {
			throw new CanopyUnavailableError(
				`cn render ${name} exited ${result.exitCode}: ${formatStderr(result)}`,
			);
		}
		if (peek === undefined) {
			throw new CanopyUnavailableError(`cn render ${name} did not produce parseable JSON`, {
				recoveryHint: "ensure the canopy CLI is at version 0.2 or newer (--format json)",
			});
		}
		return peek;
	}

	private async invoke(args: readonly string[]): Promise<SpawnResult> {
		const cmd = [this.config.cnBinary, ...args];
		try {
			return await this.spawn(cmd, { cwd: this.config.localDir, timeoutMs: this.timeoutMs });
		} catch (err) {
			if (err instanceof CanopyUnavailableError) throw err;
			throw new CanopyUnavailableError(
				`failed to spawn ${this.config.cnBinary} ${args.join(" ")}: ${formatError(err)}`,
				{
					cause: err,
					recoveryHint: `ensure the ${this.config.cnBinary} binary is on PATH and the canopy clone exists at ${this.config.localDir}`,
				},
			);
		}
	}
}

function parseEnvelope<T>(result: SpawnResult, schema: z.ZodType<T>, context: string): T {
	if (result.exitCode !== 0) {
		throw new CanopyUnavailableError(
			`${context} exited ${result.exitCode}: ${formatStderr(result)}`,
		);
	}
	const parsed = tryParseJson(result.stdout);
	if (parsed === undefined) {
		throw new CanopyUnavailableError(
			`${context} produced unparseable stdout: ${truncate(result.stdout, 200)}`,
		);
	}
	const validated = schema.safeParse(parsed);
	if (!validated.success) {
		throw new CanopyUnavailableError(
			`${context} returned an unrecognized envelope: ${validated.error.issues.map((i) => i.message).join("; ")}`,
		);
	}
	return validated.data;
}

function tryParseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function formatStderr(result: SpawnResult): string {
	const trimmed = result.stderr.trim();
	if (trimmed !== "") return truncate(trimmed, 500);
	const stdout = result.stdout.trim();
	if (stdout !== "") return truncate(stdout, 500);
	return "<no stderr>";
}

function truncate(s: string, max: number): string {
	return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function formatError(err: unknown): string {
	if (err instanceof Error) {
		const code = (err as Error & { code?: string }).code;
		return code !== undefined ? `${code}: ${err.message}` : err.message;
	}
	return String(err);
}

const defaultSpawn: SpawnFn = async (cmd, opts) => {
	if (cmd.length === 0) {
		throw new CanopyUnavailableError("spawn called with empty command");
	}
	const proc = Bun.spawn({
		cmd: cmd as string[],
		cwd: opts.cwd,
		stdout: "pipe",
		stderr: "pipe",
		stdin: "ignore",
	});
	const ctrl = new AbortController();
	const timer =
		opts.timeoutMs !== undefined
			? setTimeout(() => {
					proc.kill("SIGKILL");
					ctrl.abort();
				}, opts.timeoutMs)
			: undefined;
	try {
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		if (ctrl.signal.aborted) {
			throw new CanopyUnavailableError(
				`command timed out after ${opts.timeoutMs}ms: ${cmd.join(" ")}`,
			);
		}
		return { stdout, stderr, exitCode };
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
};
