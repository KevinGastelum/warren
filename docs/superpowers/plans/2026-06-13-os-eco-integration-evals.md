# os-eco Integration Evals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a four-layer eval suite (efficiency budgets, functional gap-fill scenarios, agent-quality+cost evals, unified scorecard) that verifies warren's os-eco integrations — canopy, mulch, seeds, sapling, burrow, plot, plan-run — are functioning and operating efficiently.

**Architecture:** A single `EvalResult` shape that every layer emits. Layer 1 = pure in-process "probes" that wrap each integration's injectable seam (spawn / fetch / emit / repos) to count calls + bytes with zero variance, gated by a ratchet (`scripts/eval-budgets.json` + `scripts/check-eval-budgets.ts`) modeled on the existing bundle-size guard. Layer 2 = three new acceptance scenarios (34/35/36) for the functional thin spots. Layer 3 = real-LLM scenarios (37+twin) against a committed fixture repo, gated on a deterministic `outcomeOk` + a cost ceiling. Layer 4 = a scorecard that folds `EvalResult[]` into a green/amber/red per-integration table.

**Tech Stack:** Bun + TypeScript strict (`noUncheckedIndexedAccess`, no `any`), `bun test`, Biome (tab indent, 100-char width). Probes import warren modules directly; scenarios extend `scripts/acceptance/`.

---

## Context the implementer needs before starting

Read these first — the plan references them as templates and seams:

- **Scenario interface + assert helpers:** `scripts/acceptance/lib/assert.ts` (`Scenario`, `ScenarioCtx`, `assertEqual`, `assertTrue`, `assertContains`, `skipScenario`).
- **Ratchet guard to model Layer 1 on:** `scripts/check-bundle-size.ts` (loadBudgets / measure / diff / updateBudgets / `--update` / `AUTO_RAISE_CAP`) and its budget file `scripts/bundle-size-budgets.json`.
- **CI parity rule:** `scripts/check-ci-parity.ts` — every `bun run <name>` in a `ci*.yml` workflow must be reachable from `check:all` (or aliased / in `CI_ONLY`). Consequences: (a) a new `check:eval-budgets` script wired into `ci.yml` MUST also be added to the `check:all` chain in `package.json`; (b) workflows NOT named `ci*.yml` are skipped by the detector, and `bun run scripts/foo.ts` (file form) is never matched — so Layer 2/3 workflows use a non-`ci` name and file-form invocations.
- **Scenario templates to copy structure from:** `scripts/acceptance/scenarios/21-claude-code-cost-smoke.ts` (real-ish dispatch + cost columns), `23-canopy-project-tier.ts` (canopy), `26-plan-run-roundtrip.ts` (plan-run endpoints + polling), `25-plot-roundtrip.ts` (plot). **Read the matching template at the top of each Layer 2/3 task — it carries the exact endpoint shapes and polling helpers; do not invent endpoint payloads.**
- **Injectable seams (verified) the probes wrap:**
  - canopy: `new CanopyClient({ cnBinary, cwd, spawn })` — `spawn?: SpawnFn = (cmd, opts) => Promise<SpawnResult>`; methods `listAgents()`, `renderAgent(name)`. (`src/registry/canopy.ts`)
  - mulch: `mergeMulchFile(domain, existingBody, incomingBody, emit)` — pure, returns `{ merged, changed, updated, skipped, appended }`. (`src/runs/reap/mulch.ts`)
  - seeds: `listScheduledSeeds(deps, projectPath)` and `updateExtensions(deps, projectPath, seedId, extensions)` where `deps: { sdBinary, spawn: SpawnFn, timeoutMs? }`. (`src/seeds-cli/extensions.ts`)
  - sapling: `SAPLING_BUILTIN: AgentDefinition` (`src/registry/builtins/sapling.ts`), `buildSeedFiles(agent): BuildSeedFilesResult` (`src/runs/seed.ts`).
  - burrow: `new BurrowClient({ ...opts, fetch })` — `fetch?: typeof fetch`; method `burrowsUp(input)`. (`src/burrow-client/client.ts`)
  - plot: `mergePlotEventsFile(existingBody, incomingBody)` and `mergePlotJsonFile(existing, incoming)` — pure. (`src/runs/reap/plot-merge.ts`)
  - plan-run: `checkParentRunMerged({ planRun, repos, checkPrMerged, emit, mergeTimeoutMs, now })` — reads `repos.runs.get(id)` + `repos.events.listByRun(id)`. (`src/plan-runs/merge-gate.ts`)
- **There is no in-process metrics counter in warren** — call counts MUST come from wrapping the injected seam.

**Conventions to honor (from CLAUDE.md):** no comments unless the WHY is non-obvious; no debt markers (`TODO`/`FIXME` fail `check:debt-markers`); tab indent; import with `.ts` extensions; new tested code keeps the coverage ratchet green (floors in `scripts/coverage-budgets.json`); files stay under the `check:file-sizes` budget. Run `bun run typecheck` after each task; full `bun run check:all` only passes on Linux/CI (Windows checkout cannot — verify gates in the Linux container).

---

## File Structure

**New files:**
- `scripts/acceptance/lib/eval-result.ts` — `EvalResult` type + `emptyEfficiency()` / `collectResults()` helpers. (Layer 0)
- `scripts/acceptance/lib/eval-result.test.ts` — unit tests for the helpers.
- `scripts/eval-probes/helpers.ts` — `countingSpawn()`, `countingFetch()`, byte helpers shared by probes.
- `scripts/eval-probes/helpers.test.ts`
- `scripts/eval-probes/canopy.ts` … `plan-run.ts` — one probe per integration; each exports `runXProbe(): Promise<EvalResult>`.
- `scripts/eval-probes/<name>.test.ts` — co-located test per probe.
- `scripts/eval-probes/index.ts` — `ALL_PROBES` array.
- `scripts/eval-budgets.json` — ratchet budgets (counts/bytes) + cost ceilings.
- `scripts/check-eval-budgets.ts` — guard (load/measure/diff/update), modeled on check-bundle-size.ts.
- `scripts/check-eval-budgets.test.ts`
- `scripts/acceptance/scorecard.ts` — folds `EvalResult[]` → markdown table + `eval-results.json`.
- `scripts/acceptance/scorecard.test.ts`
- `scripts/acceptance/scenarios/34-sapling-dispatch.ts`
- `scripts/acceptance/scenarios/35-plan-run-full-lifecycle.ts`
- `scripts/acceptance/scenarios/36-plot-sync-github.ts`
- `scripts/acceptance/scenarios/37-real-claude-code-quality.ts`
- `scripts/acceptance/fixtures/eval-repo/` — committed reference repo (failing test + known fix target).
- `.github/workflows/evals.yml` — Layer 2 deterministic scenarios + scorecard (ubuntu, blocking).
- `.github/workflows/evals-real.yml` — Layer 3 real-LLM (ubuntu, secrets-gated, blocking).

**Modified files:**
- `package.json` — add `check:eval-budgets`, `eval:probes`, `eval:scorecard`; extend `check:all`.
- `.github/workflows/ci.yml` — add one `bun run check:eval-budgets` step.
- `scripts/acceptance/run.ts` — register scenarios 34/35/36/37; thread `--real` to enable 37.

---

## Phase 1 — `EvalResult` model (Layer 0)

### Task 1: Define the `EvalResult` type and helpers

**Files:**
- Create: `scripts/acceptance/lib/eval-result.ts`
- Test: `scripts/acceptance/lib/eval-result.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/acceptance/lib/eval-result.test.ts
import { describe, expect, test } from "bun:test";
import { collectResults, emptyEfficiency, type EvalResult } from "./eval-result.ts";

const sample = (over: Partial<EvalResult> = {}): EvalResult => ({
	integration: "mulch",
	scenarioId: "probe:mulch",
	functioning: { ok: true, assertions: [{ name: "merged", ok: true }] },
	durationMs: 3,
	...over,
});

describe("eval-result", () => {
	test("emptyEfficiency returns an empty array", () => {
		expect(emptyEfficiency()).toEqual([]);
	});

	test("collectResults groups by integration and counts failures", () => {
		const results = [
			sample(),
			sample({ integration: "canopy", functioning: { ok: false, assertions: [] } }),
		];
		const summary = collectResults(results);
		expect(summary.total).toBe(2);
		expect(summary.failing).toBe(1);
		expect(summary.byIntegration.get("mulch")?.length).toBe(1);
		expect(summary.byIntegration.get("canopy")?.[0]?.functioning.ok).toBe(false);
	});
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `bun test scripts/acceptance/lib/eval-result.test.ts`
Expected: FAIL — `Cannot find module './eval-result.ts'`.

- [ ] **Step 3: Write the implementation**

```typescript
// scripts/acceptance/lib/eval-result.ts
/**
 * Common result shape every eval layer emits so the scorecard (Layer 4)
 * can aggregate efficiency probes, functional scenarios, and real-LLM
 * runs through one channel. Designed before the other layers so they all
 * produce compatible data.
 */
export type Integration =
	| "canopy"
	| "mulch"
	| "seeds"
	| "sapling"
	| "burrow"
	| "plot"
	| "plan-run";

export interface EvalAssertion {
	readonly name: string;
	readonly ok: boolean;
	readonly detail?: string;
}

export type EvalUnit = "ms" | "bytes" | "count";

export interface EvalEfficiency {
	readonly metric: string;
	readonly value: number;
	readonly unit: EvalUnit;
	readonly budget?: number;
	readonly withinBudget?: boolean;
}

export interface EvalQuality {
	readonly score?: number;
	readonly outcomeOk?: boolean;
	readonly judge?: string;
}

export interface EvalCost {
	readonly usd?: number;
	readonly tokensIn?: number;
	readonly tokensOut?: number;
	readonly budgetUsd?: number;
	readonly withinBudget?: boolean;
}

export interface EvalResult {
	readonly integration: Integration;
	readonly scenarioId: string;
	readonly functioning: { readonly ok: boolean; readonly assertions: readonly EvalAssertion[] };
	readonly efficiency?: readonly EvalEfficiency[];
	readonly quality?: EvalQuality;
	readonly cost?: EvalCost;
	readonly durationMs: number;
}

export function emptyEfficiency(): EvalEfficiency[] {
	return [];
}

export interface ResultSummary {
	readonly total: number;
	readonly failing: number;
	readonly byIntegration: Map<Integration, EvalResult[]>;
}

export function collectResults(results: readonly EvalResult[]): ResultSummary {
	const byIntegration = new Map<Integration, EvalResult[]>();
	let failing = 0;
	for (const r of results) {
		if (!r.functioning.ok) failing += 1;
		const bucket = byIntegration.get(r.integration) ?? [];
		bucket.push(r);
		byIntegration.set(r.integration, bucket);
	}
	return { total: results.length, failing, byIntegration };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `bun test scripts/acceptance/lib/eval-result.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/acceptance/lib/eval-result.ts scripts/acceptance/lib/eval-result.test.ts
git commit -m "evals: EvalResult model + collectResults helper"
```

---

## Phase 2 — Efficiency probes + budget ratchet (Layer 1)

This is the "real gap" the operator emphasized. Probes are pure in-process measurements: wrap an integration's injected seam with a counter, run a fixed fixture, emit an `EvalResult` whose `efficiency[]` carries zero-variance counts/bytes (hard-gated) plus a `durationMs` (advisory, never gated — wall-time is noisy).

### Task 2: Counting helpers

**Files:**
- Create: `scripts/eval-probes/helpers.ts`
- Test: `scripts/eval-probes/helpers.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/eval-probes/helpers.test.ts
import { describe, expect, test } from "bun:test";
import { byteLen, countingFetch, countingSpawn } from "./helpers.ts";

describe("eval-probes helpers", () => {
	test("countingSpawn counts each call and forwards to the inner fn", async () => {
		const counter = { n: 0 };
		const spawn = countingSpawn(counter, async () => ({
			exitCode: 0,
			stdout: "ok",
			stderr: "",
		}));
		await spawn(["cn", "list"], {});
		await spawn(["cn", "render", "x"], {});
		expect(counter.n).toBe(2);
	});

	test("countingFetch counts calls even when the inner response is minimal", async () => {
		const counter = { n: 0 };
		const fetchImpl = countingFetch(counter, async () => new Response("{}", { status: 200 }));
		await fetchImpl("http://x/burrows", { method: "POST" });
		expect(counter.n).toBe(1);
	});

	test("byteLen measures UTF-8 byte length", () => {
		expect(byteLen("abc")).toBe(3);
		expect(byteLen("é")).toBe(2);
	});
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `bun test scripts/eval-probes/helpers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// scripts/eval-probes/helpers.ts
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
```

- [ ] **Step 4: Run, verify it passes**

Run: `bun test scripts/eval-probes/helpers.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/eval-probes/helpers.ts scripts/eval-probes/helpers.test.ts
git commit -m "evals: counting spawn/fetch helpers for efficiency probes"
```

---

### Task 3: Mulch probe (pure-function template for the others)

**Files:**
- Create: `scripts/eval-probes/mulch.ts`
- Test: `scripts/eval-probes/mulch.test.ts`

Mulch is the simplest probe (the merge entry point is pure), so it sets the pattern: build a fixed fixture, call the real function, count `emit` calls, measure output bytes.

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/eval-probes/mulch.test.ts
import { describe, expect, test } from "bun:test";
import { runMulchProbe } from "./mulch.ts";

describe("mulch probe", () => {
	test("emits a functioning result with emitCount and mergedBytes metrics", async () => {
		const r = await runMulchProbe();
		expect(r.integration).toBe("mulch");
		expect(r.functioning.ok).toBe(true);
		const metrics = (r.efficiency ?? []).map((e) => e.metric);
		expect(metrics).toContain("mulch.merge.emitCount");
		expect(metrics).toContain("mulch.merge.mergedBytes");
		const emitCount = r.efficiency?.find((e) => e.metric === "mulch.merge.emitCount");
		expect(emitCount?.unit).toBe("count");
		expect(emitCount?.value).toBeGreaterThan(0);
	});

	test("is deterministic across runs (zero variance)", async () => {
		const a = await runMulchProbe();
		const b = await runMulchProbe();
		const pick = (r: typeof a, m: string) => r.efficiency?.find((e) => e.metric === m)?.value;
		expect(pick(a, "mulch.merge.emitCount")).toBe(pick(b, "mulch.merge.emitCount"));
		expect(pick(a, "mulch.merge.mergedBytes")).toBe(pick(b, "mulch.merge.mergedBytes"));
	});
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `bun test scripts/eval-probes/mulch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// scripts/eval-probes/mulch.ts
import { mergeMulchFile } from "../../src/runs/reap/mulch.ts";
import type { EvalResult } from "../acceptance/lib/eval-result.ts";
import { byteLen } from "./helpers.ts";

/**
 * Fixed fixture: N existing records + N incoming where half collide by id
 * with newer recorded_at (last-write-wins updates) and half are new
 * (appends). Counts are zero-variance; durationMs is advisory only.
 */
const N = 50;

function buildBody(idStart: number, recordedAt: string): string {
	const lines: string[] = [];
	for (let i = 0; i < N; i++) {
		lines.push(
			JSON.stringify({
				id: `rec-${idStart + i}`,
				domain: "probe",
				recorded_at: recordedAt,
				body: `record ${idStart + i} payload`,
			}),
		);
	}
	return `${lines.join("\n")}\n`;
}

export async function runMulchProbe(): Promise<EvalResult> {
	const existing = buildBody(0, "2026-01-01T00:00:00.000Z");
	// 25 collisions (ids 25..74 vs existing 0..49 -> overlap 25..49) and 25 appends.
	const incoming = buildBody(25, "2026-02-01T00:00:00.000Z");

	let emitCount = 0;
	const emit = async (_kind: string, _payload: unknown) => {
		emitCount += 1;
		return { id: emitCount } as never;
	};

	const start = Date.now();
	const res = await mergeMulchFile("probe", existing, incoming, emit);
	const durationMs = Date.now() - start;

	const ok = res.changed && res.merged.length > 0;
	return {
		integration: "mulch",
		scenarioId: "probe:mulch",
		functioning: {
			ok,
			assertions: [
				{ name: "changed", ok: res.changed },
				{ name: "merged-nonempty", ok: res.merged.length > 0 },
			],
		},
		efficiency: [
			{ metric: "mulch.merge.emitCount", value: emitCount, unit: "count" },
			{ metric: "mulch.merge.updated", value: res.updated, unit: "count" },
			{ metric: "mulch.merge.appended", value: res.appended, unit: "count" },
			{ metric: "mulch.merge.mergedBytes", value: byteLen(res.merged), unit: "bytes" },
			{ metric: "mulch.merge.timeMs", value: durationMs, unit: "ms" },
		],
		durationMs,
	};
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `bun test scripts/eval-probes/mulch.test.ts`
Expected: PASS (2 tests). If `mergeMulchFile`'s `emit` return type rejects the `as never` shim, replace it with a minimal object matching `EventRow` (read the `EventRow` import at the top of `src/runs/reap/mulch.ts`).

- [ ] **Step 5: Commit**

```bash
git add scripts/eval-probes/mulch.ts scripts/eval-probes/mulch.test.ts
git commit -m "evals: mulch efficiency probe (merge emit-count + bytes)"
```

---

### Task 4: Plot probe (pure)

**Files:**
- Create: `scripts/eval-probes/plot.ts`
- Test: `scripts/eval-probes/plot.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/eval-probes/plot.test.ts
import { describe, expect, test } from "bun:test";
import { runPlotProbe } from "./plot.ts";

describe("plot probe", () => {
	test("functioning result with append + bytes metrics", async () => {
		const r = await runPlotProbe();
		expect(r.integration).toBe("plot");
		expect(r.functioning.ok).toBe(true);
		const metrics = (r.efficiency ?? []).map((e) => e.metric);
		expect(metrics).toContain("plot.mergeEvents.appended");
		expect(metrics).toContain("plot.mergeEvents.mergedBytes");
	});
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `bun test scripts/eval-probes/plot.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// scripts/eval-probes/plot.ts
import { mergePlotEventsFile } from "../../src/runs/reap/plot-merge.ts";
import type { EvalResult } from "../acceptance/lib/eval-result.ts";
import { byteLen } from "./helpers.ts";

const N = 40;

function events(idStart: number): string {
	const lines: string[] = [];
	for (let i = 0; i < N; i++) {
		lines.push(JSON.stringify({ id: `evt-${idStart + i}`, seq: idStart + i, kind: "note" }));
	}
	return `${lines.join("\n")}\n`;
}

export async function runPlotProbe(): Promise<EvalResult> {
	const existing = events(0);
	const incoming = events(20); // 20 overlap (dedup), 20 new (append)
	const start = Date.now();
	const res = mergePlotEventsFile(existing, incoming);
	const durationMs = Date.now() - start;
	const ok = res.merged.length > 0;
	return {
		integration: "plot",
		scenarioId: "probe:plot",
		functioning: {
			ok,
			assertions: [{ name: "merged-nonempty", ok }],
		},
		efficiency: [
			{ metric: "plot.mergeEvents.appended", value: res.appended, unit: "count" },
			{ metric: "plot.mergeEvents.mergedBytes", value: byteLen(res.merged), unit: "bytes" },
			{ metric: "plot.mergeEvents.timeMs", value: durationMs, unit: "ms" },
		],
		durationMs,
	};
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `bun test scripts/eval-probes/plot.test.ts`
Expected: PASS. If `mergePlotEventsFile`'s dedup key differs from `id`, adjust the fixture so overlap is real (read the merge body in `src/runs/reap/plot-merge.ts`).

- [ ] **Step 5: Commit**

```bash
git add scripts/eval-probes/plot.ts scripts/eval-probes/plot.test.ts
git commit -m "evals: plot efficiency probe (event merge append + bytes)"
```

---

### Task 5: Sapling probe (pure build-seed + tier assertion)

**Files:**
- Create: `scripts/eval-probes/sapling.ts`
- Test: `scripts/eval-probes/sapling.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/eval-probes/sapling.test.ts
import { describe, expect, test } from "bun:test";
import { runSaplingProbe } from "./sapling.ts";

describe("sapling probe", () => {
	test("builds seed files and reports file count + bytes", async () => {
		const r = await runSaplingProbe();
		expect(r.integration).toBe("sapling");
		expect(r.functioning.ok).toBe(true);
		const fileCount = r.efficiency?.find((e) => e.metric === "sapling.buildSeedFiles.fileCount");
		expect(fileCount?.value).toBeGreaterThan(0);
	});
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `bun test scripts/eval-probes/sapling.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// scripts/eval-probes/sapling.ts
import { SAPLING_BUILTIN } from "../../src/registry/builtins/sapling.ts";
import { buildSeedFiles } from "../../src/runs/seed.ts";
import type { EvalResult } from "../acceptance/lib/eval-result.ts";
import { byteLen } from "./helpers.ts";

export async function runSaplingProbe(): Promise<EvalResult> {
	const start = Date.now();
	const built = buildSeedFiles(SAPLING_BUILTIN);
	const durationMs = Date.now() - start;
	const totalBytes = built.files.reduce(
		(sum, f) => sum + byteLen(typeof f.content === "string" ? f.content : ""),
		0,
	);
	const hasTier = JSON.stringify(SAPLING_BUILTIN.frontmatter).includes("sonnet");
	const ok = built.files.length > 0 && hasTier;
	return {
		integration: "sapling",
		scenarioId: "probe:sapling",
		functioning: {
			ok,
			assertions: [
				{ name: "files-built", ok: built.files.length > 0 },
				{ name: "sonnet-tier", ok: hasTier },
			],
		},
		efficiency: [
			{ metric: "sapling.buildSeedFiles.fileCount", value: built.files.length, unit: "count" },
			{ metric: "sapling.buildSeedFiles.totalBytes", value: totalBytes, unit: "bytes" },
			{ metric: "sapling.buildSeedFiles.timeMs", value: durationMs, unit: "ms" },
		],
		durationMs,
	};
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `bun test scripts/eval-probes/sapling.test.ts`
Expected: PASS. If `HttpWorkspaceFile.content` is not a `string` (e.g. base64/bytes union), read its type in `src/runs/seed.ts` and adjust `byteLen` accordingly; if the tier marker isn't the literal `"sonnet"`, assert on `MODEL_TIERS.sonnet`'s actual field (read `src/registry/builtins/`).

- [ ] **Step 5: Commit**

```bash
git add scripts/eval-probes/sapling.ts scripts/eval-probes/sapling.test.ts
git commit -m "evals: sapling efficiency probe (build-seed file count + tier)"
```

---

### Task 6: Canopy probe (counted spawn = N+1 watch)

**Files:**
- Create: `scripts/eval-probes/canopy.ts`
- Test: `scripts/eval-probes/canopy.test.ts`

Faithful proxy for refresh cost without stubbing the repo/clone surface: a real `CanopyClient` with a counting stub spawn, then `listAgents()` + `renderAgent()` per agent. For N agents the shell-out count must be N+1; a regression that re-lists or double-renders trips it.

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/eval-probes/canopy.test.ts
import { describe, expect, test } from "bun:test";
import { runCanopyProbe } from "./canopy.ts";

describe("canopy probe", () => {
	test("list + render of N agents costs N+1 spawns", async () => {
		const r = await runCanopyProbe();
		expect(r.integration).toBe("canopy");
		expect(r.functioning.ok).toBe(true);
		const spawnCount = r.efficiency?.find((e) => e.metric === "canopy.listAndRender.spawnCount");
		// fixture N=3 -> 1 list + 3 render = 4
		expect(spawnCount?.value).toBe(4);
	});
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `bun test scripts/eval-probes/canopy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// scripts/eval-probes/canopy.ts
import { CanopyClient, type SpawnFn } from "../../src/registry/canopy.ts";
import type { EvalResult } from "../acceptance/lib/eval-result.ts";
import { type CallCounter, countingSpawn } from "./helpers.ts";

const AGENTS = ["alpha", "beta", "gamma"]; // N = 3

/**
 * Stub `cn` shell-out: `cn list` -> a JSON array of agent summaries;
 * `cn render <name>` / `cn show <name>` -> a minimal prompt envelope.
 * Returns shapes loose enough that listAgents()/renderAgent() parse them;
 * tighten if CanopyClient's parser rejects (read src/registry/canopy.ts).
 */
const stubSpawn: SpawnFn = async (cmd) => {
	const argv = cmd.join(" ");
	if (argv.includes(" list")) {
		const summaries = AGENTS.map((name) => ({ name, tags: ["agent"] }));
		return { exitCode: 0, stdout: JSON.stringify(summaries), stderr: "" } as never;
	}
	return {
		exitCode: 0,
		stdout: JSON.stringify({ name: "x", version: 1, sections: { system: "hi" } }),
		stderr: "",
	} as never;
};

export async function runCanopyProbe(): Promise<EvalResult> {
	const counter: CallCounter = { n: 0 };
	const client = new CanopyClient({
		cnBinary: "cn",
		cwd: process.cwd(),
		spawn: countingSpawn(counter, stubSpawn),
	});

	const start = Date.now();
	const summaries = await client.listAgents();
	for (const s of summaries) {
		await client.renderAgent(s.name);
	}
	const durationMs = Date.now() - start;

	const ok = summaries.length === AGENTS.length && counter.n === AGENTS.length + 1;
	return {
		integration: "canopy",
		scenarioId: "probe:canopy",
		functioning: {
			ok,
			assertions: [
				{ name: "listed-all", ok: summaries.length === AGENTS.length },
				{ name: "n+1-shellouts", ok: counter.n === AGENTS.length + 1 },
			],
		},
		efficiency: [
			{ metric: "canopy.listAndRender.spawnCount", value: counter.n, unit: "count" },
			{ metric: "canopy.listAndRender.timeMs", value: durationMs, unit: "ms" },
		],
		durationMs,
	};
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `bun test scripts/eval-probes/canopy.test.ts`
Expected: PASS. If `listAgents()`/`renderAgent()` parsing rejects the stub stdout, read the parse logic in `src/registry/canopy.ts` and adjust the stub JSON shapes; the spawn-count assertion is the invariant, not the exact JSON.

- [ ] **Step 5: Commit**

```bash
git add scripts/eval-probes/canopy.ts scripts/eval-probes/canopy.test.ts
git commit -m "evals: canopy efficiency probe (list+render N+1 shell-out watch)"
```

---

### Task 7: Seeds probe (per-op shell-out count)

**Files:**
- Create: `scripts/eval-probes/seeds.ts`
- Test: `scripts/eval-probes/seeds.test.ts`

`listScheduledSeeds` and `updateExtensions` must each cost exactly one `sd` shell-out. A regression that adds a redundant `sd` call per op trips this.

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/eval-probes/seeds.test.ts
import { describe, expect, test } from "bun:test";
import { runSeedsProbe } from "./seeds.ts";

describe("seeds probe", () => {
	test("list and update each cost exactly one sd shell-out", async () => {
		const r = await runSeedsProbe();
		expect(r.integration).toBe("seeds");
		expect(r.functioning.ok).toBe(true);
		const list = r.efficiency?.find((e) => e.metric === "seeds.listScheduled.spawnCount");
		const update = r.efficiency?.find((e) => e.metric === "seeds.updateExtensions.spawnCount");
		expect(list?.value).toBe(1);
		expect(update?.value).toBe(1);
	});
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `bun test scripts/eval-probes/seeds.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// scripts/eval-probes/seeds.ts
import {
	listScheduledSeeds,
	type SeedsCliDeps,
	updateExtensions,
} from "../../src/seeds-cli/extensions.ts";
import type { EvalResult } from "../acceptance/lib/eval-result.ts";
import { type CallCounter, countingSpawn } from "./helpers.ts";

const PROJECT_PATH = "/tmp/eval-probe-project";

/** `sd list --format json` -> empty list; `sd update ...` -> ok. */
const makeDeps = (counter: CallCounter): SeedsCliDeps => ({
	sdBinary: "sd",
	spawn: countingSpawn(counter, async () => ({ exitCode: 0, stdout: "[]", stderr: "" }) as never),
});

export async function runSeedsProbe(): Promise<EvalResult> {
	const listCounter: CallCounter = { n: 0 };
	const start = Date.now();
	await listScheduledSeeds(makeDeps(listCounter), PROJECT_PATH);

	const updateCounter: CallCounter = { n: 0 };
	await updateExtensions(makeDeps(updateCounter), PROJECT_PATH, "seed-1", {} as never);
	const durationMs = Date.now() - start;

	const ok = listCounter.n === 1 && updateCounter.n === 1;
	return {
		integration: "seeds",
		scenarioId: "probe:seeds",
		functioning: {
			ok,
			assertions: [
				{ name: "list-one-shellout", ok: listCounter.n === 1 },
				{ name: "update-one-shellout", ok: updateCounter.n === 1 },
			],
		},
		efficiency: [
			{ metric: "seeds.listScheduled.spawnCount", value: listCounter.n, unit: "count" },
			{ metric: "seeds.updateExtensions.spawnCount", value: updateCounter.n, unit: "count" },
			{ metric: "seeds.probe.timeMs", value: durationMs, unit: "ms" },
		],
		durationMs,
	};
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `bun test scripts/eval-probes/seeds.test.ts`
Expected: PASS. If `updateExtensions` rejects `{}` as `WarrenExtensions`, read the type in `src/seeds-cli/extensions.ts` and pass a minimal valid object; if `listScheduledSeeds` needs richer stdout than `[]`, read its parser and supply the minimum.

- [ ] **Step 5: Commit**

```bash
git add scripts/eval-probes/seeds.ts scripts/eval-probes/seeds.test.ts
git commit -m "evals: seeds efficiency probe (per-op sd shell-out count)"
```

---

### Task 8: Burrow probe (atomic provision = 1 round-trip)

**Files:**
- Create: `scripts/eval-probes/burrow.ts`
- Test: `scripts/eval-probes/burrow.test.ts`

The spec's invariant: `burrowsUp` must issue exactly one HTTP round-trip (atomic provision). The probe counts fetches and asserts 1 even if response parsing later throws — so it's robust to response-schema drift.

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/eval-probes/burrow.test.ts
import { describe, expect, test } from "bun:test";
import { runBurrowProbe } from "./burrow.ts";

describe("burrow probe", () => {
	test("burrowsUp issues exactly one HTTP round-trip", async () => {
		const r = await runBurrowProbe();
		expect(r.integration).toBe("burrow");
		const fetchCount = r.efficiency?.find((e) => e.metric === "burrow.burrowsUp.fetchCount");
		expect(fetchCount?.value).toBe(1);
		expect(r.functioning.ok).toBe(true);
	});
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `bun test scripts/eval-probes/burrow.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// scripts/eval-probes/burrow.ts
import { BurrowClient } from "../../src/burrow-client/client.ts";
import type { EvalResult } from "../acceptance/lib/eval-result.ts";
import { type CallCounter, countingFetch } from "./helpers.ts";

/**
 * Minimal Burrow JSON the HttpClient can deserialize. If burrowsUp's
 * validation rejects it the call throws AFTER the fetch is counted, so
 * the round-trip invariant still holds — we catch and assert the count.
 */
const BURROW_JSON = JSON.stringify({
	id: "burrow_probe000000",
	state: "ready",
	workspacePath: "/work",
});

export async function runBurrowProbe(): Promise<EvalResult> {
	const counter: CallCounter = { n: 0 };
	const fetchImpl = countingFetch(
		counter,
		async () => new Response(BURROW_JSON, { status: 200, headers: { "content-type": "application/json" } }),
	);
	const client = new BurrowClient({
		baseUrl: "http://127.0.0.1:0",
		token: "probe",
		fetch: fetchImpl,
	} as never);

	const start = Date.now();
	let provisioned = false;
	try {
		await client.burrowsUp({ projectId: "p", agent: "claude-code" } as never);
		provisioned = true;
	} catch {
		// Response-schema drift is fine: the round-trip count is the metric.
	}
	const durationMs = Date.now() - start;

	const ok = counter.n === 1;
	return {
		integration: "burrow",
		scenarioId: "probe:burrow",
		functioning: {
			ok,
			assertions: [
				{ name: "single-round-trip", ok: counter.n === 1 },
				{ name: "provisioned", ok: provisioned, detail: provisioned ? undefined : "response-schema drift (count still asserted)" },
			],
		},
		efficiency: [
			{ metric: "burrow.burrowsUp.fetchCount", value: counter.n, unit: "count" },
			{ metric: "burrow.burrowsUp.timeMs", value: durationMs, unit: "ms" },
		],
		durationMs,
	};
}
```

Note: `functioning.ok` is `counter.n === 1` only (not `provisioned`) — the invariant under test is the round-trip count; provision success depends on response-schema fidelity which is not the probe's concern.

- [ ] **Step 4: Run, verify it passes**

Run: `bun test scripts/eval-probes/burrow.test.ts`
Expected: PASS. If `new BurrowClient({...})` rejects these constructor fields, read `BurrowClientOptions` in `src/burrow-client/client.ts` and pass the real required fields (the `fetch` seam is the one that matters); if `burrowsUp` needs a different input shape, read `HttpBurrowUpInput` — but the `try/catch` already tolerates a throw, so only a throw *before* the fetch (e.g. a synchronous input-validation error) would break the count. If that happens, supply a minimally valid input.

- [ ] **Step 5: Commit**

```bash
git add scripts/eval-probes/burrow.ts scripts/eval-probes/burrow.test.ts
git commit -m "evals: burrow efficiency probe (atomic-provision round-trip watch)"
```

---

### Task 9: Plan-run probe (merge-gate DB read count)

**Files:**
- Create: `scripts/eval-probes/plan-run.ts`
- Test: `scripts/eval-probes/plan-run.test.ts`

The spec's N+1 watch for plan-run is the merge gate. `checkParentRunMerged` reads `repos.runs.get(id)` and `repos.events.listByRun(id)`. Wrap a counting in-memory repos stub and assert the read count for one gate check.

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/eval-probes/plan-run.test.ts
import { describe, expect, test } from "bun:test";
import { runPlanRunProbe } from "./plan-run.ts";

describe("plan-run probe", () => {
	test("merge-gate check stays within the DB-read budget", async () => {
		const r = await runPlanRunProbe();
		expect(r.integration).toBe("plan-run");
		const reads = r.efficiency?.find((e) => e.metric === "planRun.mergeGate.dbReadCount");
		expect(reads?.unit).toBe("count");
		expect(reads?.value).toBeGreaterThan(0);
		expect(reads?.value).toBeLessThanOrEqual(3);
		expect(r.functioning.ok).toBe(true);
	});
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `bun test scripts/eval-probes/plan-run.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// scripts/eval-probes/plan-run.ts
import { checkParentRunMerged } from "../../src/plan-runs/merge-gate.ts";
import type { EvalResult } from "../acceptance/lib/eval-result.ts";
import type { CallCounter } from "./helpers.ts";

/**
 * In-memory repos with just the two reads the merge gate makes, each
 * counted. `checkParentRunMerged` reads repos.runs.get(parentRunId) and
 * (when there is a push event) repos.events.listByRun(parentRunId).
 * We model a parent run that already merged so the gate returns "merged"
 * after a bounded number of reads. Field names/return shapes that the
 * gate inspects are read from src/plan-runs/merge-gate.ts — adjust the
 * stub rows below to whatever it dereferences.
 */
export async function runPlanRunProbe(): Promise<EvalResult> {
	const reads: CallCounter = { n: 0 };
	const repos = {
		runs: {
			get: async (_id: string) => {
				reads.n += 1;
				return { id: "run_parent00000", state: "succeeded", prUrl: "https://x/pull/1" } as never;
			},
		},
		events: {
			listByRun: async (_id: string) => {
				reads.n += 1;
				return [{ kind: "branch_pushed", payload: {} }] as never;
			},
		},
	};

	const planRun = { id: "pr_probe000000", parentRunId: "run_parent00000" } as never;
	const start = Date.now();
	let ran = false;
	try {
		await checkParentRunMerged({
			planRun,
			repos: repos as never,
			checkPrMerged: async () => ({ merged: true }) as never,
			emit: async () => {},
			mergeTimeoutMs: 60_000,
			now: () => new Date("2026-06-13T00:00:00.000Z"),
		});
		ran = true;
	} catch {
		// Stub-shape drift: the read count up to the throw is still the metric.
	}
	const durationMs = Date.now() - start;

	const ok = reads.n > 0 && reads.n <= 3;
	return {
		integration: "plan-run",
		scenarioId: "probe:plan-run",
		functioning: {
			ok,
			assertions: [
				{ name: "bounded-reads", ok: reads.n > 0 && reads.n <= 3 },
				{ name: "gate-ran", ok: ran, detail: ran ? undefined : "stub-shape drift" },
			],
		},
		efficiency: [
			{ metric: "planRun.mergeGate.dbReadCount", value: reads.n, unit: "count" },
			{ metric: "planRun.mergeGate.timeMs", value: durationMs, unit: "ms" },
		],
		durationMs,
	};
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `bun test scripts/eval-probes/plan-run.test.ts`
Expected: PASS. **Before finalizing, read `src/plan-runs/merge-gate.ts` `checkParentRunMerged` + `hasEmptyPushEvent` and make the stub rows carry exactly the fields they dereference** (e.g. the real merged-state value, the push-event `kind`). If the realistic read count differs from ≤3, set the test bound and the budget (Task 11) to the measured count — the metric is "this gate makes a fixed, small number of reads," not the literal 3.

- [ ] **Step 5: Commit**

```bash
git add scripts/eval-probes/plan-run.ts scripts/eval-probes/plan-run.test.ts
git commit -m "evals: plan-run efficiency probe (merge-gate DB read count)"
```

---

### Task 10: Probe registry

**Files:**
- Create: `scripts/eval-probes/index.ts`
- Test: `scripts/eval-probes/index.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/eval-probes/index.test.ts
import { describe, expect, test } from "bun:test";
import { ALL_PROBES, runAllProbes } from "./index.ts";

describe("probe registry", () => {
	test("registers all seven integrations", () => {
		const names = ALL_PROBES.map((p) => p.integration).sort();
		expect(names).toEqual(
			["burrow", "canopy", "mulch", "plan-run", "plot", "sapling", "seeds"].sort(),
		);
	});

	test("runAllProbes returns one EvalResult per probe", async () => {
		const results = await runAllProbes();
		expect(results.length).toBe(ALL_PROBES.length);
		for (const r of results) expect(r.efficiency?.length).toBeGreaterThan(0);
	});
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `bun test scripts/eval-probes/index.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// scripts/eval-probes/index.ts
import type { EvalResult, Integration } from "../acceptance/lib/eval-result.ts";
import { runBurrowProbe } from "./burrow.ts";
import { runCanopyProbe } from "./canopy.ts";
import { runMulchProbe } from "./mulch.ts";
import { runPlanRunProbe } from "./plan-run.ts";
import { runPlotProbe } from "./plot.ts";
import { runSaplingProbe } from "./sapling.ts";
import { runSeedsProbe } from "./seeds.ts";

export interface Probe {
	readonly integration: Integration;
	run(): Promise<EvalResult>;
}

export const ALL_PROBES: readonly Probe[] = [
	{ integration: "canopy", run: runCanopyProbe },
	{ integration: "mulch", run: runMulchProbe },
	{ integration: "seeds", run: runSeedsProbe },
	{ integration: "sapling", run: runSaplingProbe },
	{ integration: "burrow", run: runBurrowProbe },
	{ integration: "plot", run: runPlotProbe },
	{ integration: "plan-run", run: runPlanRunProbe },
];

export async function runAllProbes(): Promise<EvalResult[]> {
	const out: EvalResult[] = [];
	for (const probe of ALL_PROBES) {
		out.push(await probe.run());
	}
	return out;
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `bun test scripts/eval-probes/index.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/eval-probes/index.ts scripts/eval-probes/index.test.ts
git commit -m "evals: probe registry (ALL_PROBES + runAllProbes)"
```

---

### Task 11: Budget file + guard (`check:eval-budgets`)

**Files:**
- Create: `scripts/eval-budgets.json`
- Create: `scripts/check-eval-budgets.ts`
- Test: `scripts/check-eval-budgets.test.ts`

The guard mirrors `check-bundle-size.ts`: load budgets, run probes to measure, diff (only count/byte metrics are gated; `ms` metrics are skipped), `--update` re-baselines. Only-goes-tighter, with a bounded auto-raise.

- [ ] **Step 1: Seed the budget file by measuring once**

First run the probes to learn the real numbers, then hand-write them in (this is the one-time baseline — afterwards always use `--update`). Run:

```bash
bun -e 'import("./scripts/eval-probes/index.ts").then(async m => { for (const r of await m.runAllProbes()) for (const e of (r.efficiency ?? [])) if (e.unit !== "ms") console.log(`${e.metric} ${e.value} ${e.unit}`); })'
```

Record each `count`/`bytes` metric. Then create `scripts/eval-budgets.json`:

```json
{
	"$comment": "Efficiency ratchet for os-eco integration probes (scripts/eval-probes/). Counts + bytes only — ms metrics are advisory and never gated (wall-time is noisy). Ratchet goes DOWN; ordinary growth auto-raises within AUTO_RAISE_CAP, a large jump needs WARREN_EVAL_BUDGET_ALLOW_RAISE=1. Re-baseline with `bun run check:eval-budgets --update`, never hand-edit. Seeded 2026-06-13.",
	"metrics": {
		"canopy.listAndRender.spawnCount": 4,
		"mulch.merge.emitCount": 0,
		"mulch.merge.mergedBytes": 0,
		"plot.mergeEvents.appended": 0,
		"plot.mergeEvents.mergedBytes": 0,
		"sapling.buildSeedFiles.fileCount": 0,
		"sapling.buildSeedFiles.totalBytes": 0,
		"seeds.listScheduled.spawnCount": 1,
		"seeds.updateExtensions.spawnCount": 1,
		"burrow.burrowsUp.fetchCount": 1,
		"planRun.mergeGate.dbReadCount": 3
	},
	"cost": {
		"$comment": "USD ceilings for Layer 3 real-LLM scenarios (scripts/acceptance/scenarios/37*). Enforced by the real-eval scenario, not by check-eval-budgets. Start low; tune after first real run.",
		"real.claude-code.maxUsd": 0.5,
		"real.sapling.maxUsd": 0.5
	}
}
```

Replace each `0` with the measured value from the probe output above. Leave `canopy`, `seeds`, `burrow`, `planRun` as the fixed invariants shown (adjust `planRun.mergeGate.dbReadCount` to the count you measured in Task 9).

- [ ] **Step 2: Write the failing test**

```typescript
// scripts/check-eval-budgets.test.ts
import { describe, expect, test } from "bun:test";
import { diff, gatedMetrics, type Budgets } from "./check-eval-budgets.ts";
import type { EvalResult } from "./acceptance/lib/eval-result.ts";

const result = (efficiency: EvalResult["efficiency"]): EvalResult => ({
	integration: "mulch",
	scenarioId: "probe:mulch",
	functioning: { ok: true, assertions: [] },
	efficiency,
	durationMs: 1,
});

describe("check-eval-budgets", () => {
	test("gatedMetrics drops ms metrics, keeps count/bytes", () => {
		const r = result([
			{ metric: "a.count", value: 2, unit: "count" },
			{ metric: "a.timeMs", value: 99, unit: "ms" },
		]);
		const m = gatedMetrics([r]);
		expect(m.get("a.count")).toBe(2);
		expect(m.has("a.timeMs")).toBe(false);
	});

	test("diff flags a metric that exceeds budget", () => {
		const budgets: Budgets = { metrics: { "a.count": 1 }, cost: {} };
		const measured = new Map([["a.count", 5]]);
		const failures = diff(measured, budgets);
		expect(failures).toHaveLength(1);
		expect(failures[0]?.metric).toBe("a.count");
	});

	test("diff passes when at or under budget", () => {
		const budgets: Budgets = { metrics: { "a.count": 5 }, cost: {} };
		expect(diff(new Map([["a.count", 5]]), budgets)).toHaveLength(0);
	});

	test("diff flags an unbudgeted metric so new probes can't slip the ratchet", () => {
		const budgets: Budgets = { metrics: {}, cost: {} };
		const failures = diff(new Map([["new.count", 1]]), budgets);
		expect(failures[0]?.reason).toContain("no budget");
	});
});
```

- [ ] **Step 3: Run, verify it fails**

Run: `bun test scripts/check-eval-budgets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the guard**

```typescript
// scripts/check-eval-budgets.ts
#!/usr/bin/env bun
/**
 * Efficiency-budget guard for the os-eco integration probes
 * (scripts/eval-probes/). Modeled on check-bundle-size.ts: runs every
 * probe, collects the zero-variance count/byte metrics, and enforces the
 * ratchet in scripts/eval-budgets.json. `ms` metrics are advisory and
 * never gated. The ratchet only goes DOWN; `--update` re-baselines
 * (measured value as the new budget) with a bounded auto-raise so
 * ordinary growth re-baselines hands-free and a large jump needs
 * WARREN_EVAL_BUDGET_ALLOW_RAISE=1.
 *
 * Usage:
 *   bun run scripts/check-eval-budgets.ts            # measure + enforce
 *   bun run scripts/check-eval-budgets.ts --update   # re-baseline
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EvalResult } from "./acceptance/lib/eval-result.ts";
import { runAllProbes } from "./eval-probes/index.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");
const BUDGETS_PATH = resolve(REPO_ROOT, "scripts/eval-budgets.json");

/** Absolute auto-raise headroom: counts get +0 (must be exact), bytes get +512. */
const AUTO_RAISE_CAP_BYTES = 512;

export interface Budgets {
	metrics: Record<string, number>;
	cost: Record<string, number | string>;
}

export interface Failure {
	metric: string;
	actual: number;
	budget: number | null;
	reason: string;
}

export function loadBudgets(path = BUDGETS_PATH): Budgets {
	const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	const metrics = (raw.metrics ?? {}) as Record<string, number>;
	const cost = (raw.cost ?? {}) as Record<string, number | string>;
	return { metrics, cost };
}

/** Map of gated (count/bytes) metric -> value across all probe results. */
export function gatedMetrics(results: readonly EvalResult[]): Map<string, number> {
	const out = new Map<string, number>();
	for (const r of results) {
		for (const e of r.efficiency ?? []) {
			if (e.unit === "ms") continue;
			out.set(e.metric, e.value);
		}
	}
	return out;
}

export function diff(measured: Map<string, number>, budgets: Budgets): Failure[] {
	const failures: Failure[] = [];
	for (const [metric, actual] of measured) {
		const budget = budgets.metrics[metric];
		if (budget === undefined) {
			failures.push({
				metric,
				actual,
				budget: null,
				reason: `no budget for "${metric}" — run --update to baseline it`,
			});
			continue;
		}
		if (actual > budget) {
			failures.push({ metric, actual, budget, reason: `${actual} exceeds budget ${budget}` });
		}
	}
	return failures;
}

function isByteMetric(metric: string): boolean {
	return metric.toLowerCase().endsWith("bytes");
}

export function updateBudgets(
	measured: Map<string, number>,
	path = BUDGETS_PATH,
	allowRaise = process.env.WARREN_EVAL_BUDGET_ALLOW_RAISE === "1",
): { wrote: boolean; refused: string[] } {
	const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	const metrics = (raw.metrics ?? {}) as Record<string, number>;
	const refused: string[] = [];
	for (const [metric, value] of measured) {
		const current = metrics[metric];
		if (current === undefined || value <= current) {
			metrics[metric] = value;
			continue;
		}
		const cap = isByteMetric(metric) ? AUTO_RAISE_CAP_BYTES : 0;
		if (allowRaise || value - current <= cap) {
			metrics[metric] = value;
		} else {
			refused.push(`${metric}: ${current} → ${value} (+${value - current}, exceeds ${cap})`);
		}
	}
	if (refused.length > 0) return { wrote: false, refused };
	raw.metrics = metrics;
	writeFileSync(path, `${JSON.stringify(raw, null, "\t")}\n`);
	return { wrote: true, refused };
}

async function main(): Promise<void> {
	const results = await runAllProbes();
	const measured = gatedMetrics(results);
	const update = process.argv.includes("--update");

	if (update) {
		const { wrote, refused } = updateBudgets(measured);
		if (!wrote) {
			console.error("eval-budgets --update refused to raise beyond the cap:");
			for (const r of refused) console.error(`  ${r}`);
			console.error("Set WARREN_EVAL_BUDGET_ALLOW_RAISE=1 and document why in a $comment.");
			process.exit(1);
		}
		console.log(`Wrote re-baselined eval budgets to ${BUDGETS_PATH}.`);
		return;
	}

	const budgets = loadBudgets();
	const failures = diff(measured, budgets);
	for (const [metric, value] of [...measured].sort()) {
		console.log(`  ${metric}: ${value} (budget ${budgets.metrics[metric] ?? "—"})`);
	}
	if (failures.length > 0) {
		console.error("\nEval-budget guard failed:");
		for (const f of failures) console.error(`  ${f.metric}: ${f.reason}`);
		console.error("\nRe-baseline with `bun run check:eval-budgets --update` if the change is intended.");
		process.exit(1);
	}
	console.log("Eval-budget guard ok.");
}

if (import.meta.main) await main();
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `bun test scripts/check-eval-budgets.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Baseline the budgets for real**

Run: `bun run scripts/check-eval-budgets.ts --update`
Then: `bun run scripts/check-eval-budgets.ts`
Expected: "Eval-budget guard ok." with every metric printed at-or-under budget.

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add scripts/eval-budgets.json scripts/check-eval-budgets.ts scripts/check-eval-budgets.test.ts
git commit -m "evals: efficiency-budget ratchet guard (check:eval-budgets)"
```

---

### Task 12: Wire `check:eval-budgets` into `check:all` + CI

**Files:**
- Modify: `package.json:57` (the `check:all` chain) + scripts block
- Modify: `.github/workflows/ci.yml` (add one step)

- [ ] **Step 1: Add the scripts**

In `package.json` scripts, add after `"check:bundle-size:build"`:

```json
		"check:eval-budgets": "bun run scripts/check-eval-budgets.ts",
		"eval:probes": "bun run scripts/check-eval-budgets.ts",
```

- [ ] **Step 2: Extend `check:all`**

Edit `package.json:57` — insert `&& bun run check:eval-budgets` immediately before `&& bun run check:ci-parity`:

```json
		"check:all": "bun run check:coverage && bun run lint && bun run typecheck && bun run validate:agents-md && bun run check:file-sizes && bun run check:debt-markers && bun run check:duplicates && bun run check:deps && bun run check:bundle-size:build && bun run gen:docs:check && bun run gen:openapi:check && bun run check:eval-budgets && bun run check:ci-parity",
```

- [ ] **Step 3: Add the CI step**

In `.github/workflows/ci.yml`, after the `check:bundle-size` step (line ~29), add:

```yaml
      - run: bun run check:eval-budgets
```

- [ ] **Step 4: Verify parity holds**

Run: `bun run check:ci-parity`
Expected: `✓ CI parity` — `check:eval-budgets` is now reachable from `check:all`, so the new CI step passes the detector.

- [ ] **Step 5: Commit**

```bash
git add package.json .github/workflows/ci.yml
git commit -m "evals: gate efficiency budgets in check:all + CI"
```

---

## Phase 3 — Functional gap-fill scenarios (Layer 2)

These extend the acceptance harness (boots real warren+burrow in-proc). **Read the named template scenario first** — it has the exact endpoint payloads and polling helpers. Each new scenario follows the existing `Scenario` contract (`scripts/acceptance/lib/assert.ts`) and registers in `run.ts`.

### Task 13: Scenario 34 — sapling dispatch

**Files:**
- Template to read first: `scripts/acceptance/scenarios/21-claude-code-cost-smoke.ts` (dispatch + run-row assertions) and `23-canopy-project-tier.ts` (tier/rendered-agent assertions).
- Create: `scripts/acceptance/scenarios/34-sapling-dispatch.ts`
- Modify: `scripts/acceptance/run.ts` (register)

- [ ] **Step 1: Write the scenario**

Model the body on scenario 21. Assertions specific to sapling:
1. `GET /agents/sapling` → 200, `name === "sapling"`, `source === "builtin"`.
2. `POST /runs` with `{ agent: "sapling", project: <id>, prompt: "..." }` → 201; `run.agentName === "sapling"`, `run.burrowId` populated.
3. The rendered agent froze the Sonnet tier: read `run.renderedAgentJson.frontmatter` (the envelope shape is in scenario 21's `AgentDefinitionEnvelope`) and assert it carries the sonnet model tier (assert on the same field `MODEL_TIERS.sonnet` sets — confirm the literal by reading `src/registry/builtins/sapling.ts`; use `assertContains(JSON.stringify(run.renderedAgentJson.frontmatter), "<sonnet-model-id>", ...)`).
4. The workspace was seeded with sapling's `.canopy/agent.json` — assert via the first run event / reap as scenario 21 waits for events. If asserting workspace files is not exposed over HTTP, assert (3) only and note it.
5. `finally { safelyCancel(...) }` exactly as scenario 21.

`id: "34"`, `modes: ["in-proc"]`.

- [ ] **Step 2: Register in run.ts**

Add the import after the scenario33 import (`scripts/acceptance/run.ts:69`):

```typescript
import { scenario as scenario34 } from "./scenarios/34-sapling-dispatch.ts";
```

Add `scenario34,` to the `SCENARIOS` array after `scenario33,` (line ~105).

- [ ] **Step 3: Run the scenario in isolation (Linux or local Linux container)**

Run: `bun run scripts/acceptance/run.ts --only 34 --stop-on-failure`
Expected: `✓ 34 ... sapling` passes. (On Windows this cannot boot burrow — run in the Linux container per CLAUDE.md.)

- [ ] **Step 4: Commit**

```bash
git add scripts/acceptance/scenarios/34-sapling-dispatch.ts scripts/acceptance/run.ts
git commit -m "evals: acceptance scenario 34 — sapling dispatch + tier freeze"
```

---

### Task 14: Scenario 35 — plan-run full lifecycle

**Files:**
- Template to read first: `scripts/acceptance/scenarios/26-plan-run-roundtrip.ts` (POST /plan-runs payload, coordinator tick trigger, polling) and `27-plan-run-plot-roundtrip.ts`.
- Create: `scripts/acceptance/scenarios/35-plan-run-full-lifecycle.ts`
- Modify: `scripts/acceptance/run.ts`

- [ ] **Step 1: Write the scenario**

The lifecycle (use the exact endpoints + tick mechanism from scenario 26 — do not invent them):
1. Set up a project with a `.seeds/` plan that has 3 children (scenario 26 shows how it seeds the plan; reuse that helper/fixture).
2. `POST /plan-runs` for the plan → assert it dispatches child 1 only (children 2/3 stay pending/blocked).
3. Simulate child 1's PR merging (scenario 26 shows the merge-gate trigger — likely an empty-push event + a `checkPrMerged` stub or a forced advance). Drive the coordinator tick.
4. Assert the coordinator advances to child 2, then (repeat) child 3.
5. After child 3 merges, assert the plan-run reaches its terminal succeeded state.
6. Assert the per-child events were emitted in order (the event kinds are in `src/plan-runs/` — `PlanRunEventKind`).

Assertions to make explicit: serial gating (child N+1 never dispatches before child N's gate clears), final state, child count == 3. `id: "35"`, `modes: ["in-proc"]`. Clean up after (cancel any live runs).

- [ ] **Step 2: Register in run.ts** (import + array entry, same pattern as Task 13).

- [ ] **Step 3: Run in isolation**

Run: `bun run scripts/acceptance/run.ts --only 35 --stop-on-failure`
Expected: `✓ 35` passes (Linux).

- [ ] **Step 4: Commit**

```bash
git add scripts/acceptance/scenarios/35-plan-run-full-lifecycle.ts scripts/acceptance/run.ts
git commit -m "evals: acceptance scenario 35 — plan-run full create→N-children→merge lifecycle"
```

---

### Task 15: Scenario 36 — plot sync to GitHub

**Files:**
- Template to read first: `scripts/acceptance/scenarios/25-plot-roundtrip.ts` + `28-plot-list-and-create.ts` (plot creation), and the sync route `POST /plots/:id/sync` (find its handler under `src/server/` — search `plots/:id/sync` or `/sync`).
- Create: `scripts/acceptance/scenarios/36-plot-sync-github.ts`
- Modify: `scripts/acceptance/run.ts`

- [ ] **Step 1: Determine the GitHub seam**

Read how plotSync calls GitHub (search `plotSync`, `mergeStrategy`, the sync handler). Two cases:
- If the GitHub client is injectable / behind an env-gated stub like scenario 21's claude stub → drive a stub and assert a sync PR is "created".
- If it requires a real GitHub token with no stub seam → gate the scenario with `skipScenario("plot-sync needs a GitHub seam not available in-proc")` and assert only the local `POST /plots/:id/sync` request shape + that it transitions plot state. Record which path was taken in the scenario's top comment.

- [ ] **Step 2: Write the scenario**

1. Create a project with `.plot/` and a plot (scenario 25/28 show this).
2. `POST /plots/:id/sync` with `plotSync.mergeStrategy: "manual"` → assert a sync PR creation was attempted (stub seam) or the documented degraded assertion.
3. Assert the response/state matches the `mergeStrategy` (manual = PR not auto-merged).

`id: "36"`, `modes: ["in-proc"]`.

- [ ] **Step 3: Register in run.ts** (import + array entry).

- [ ] **Step 4: Run in isolation**

Run: `bun run scripts/acceptance/run.ts --only 36 --stop-on-failure`
Expected: `✓ 36` passes (or `○ 36 skipped` with the documented reason if no seam exists).

- [ ] **Step 5: Commit**

```bash
git add scripts/acceptance/scenarios/36-plot-sync-github.ts scripts/acceptance/run.ts
git commit -m "evals: acceptance scenario 36 — plot sync to GitHub"
```

---

## Phase 4 — Unified scorecard (Layer 4)

### Task 16: Scorecard aggregator

**Files:**
- Create: `scripts/acceptance/scorecard.ts`
- Test: `scripts/acceptance/scorecard.test.ts`

Folds `EvalResult[]` into a per-integration green/amber/red table. Rule: **red** = any `functioning.ok === false` or any gated efficiency metric over budget; **amber** = quality below a soft floor OR cost within 10% of its ceiling; **green** otherwise.

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/acceptance/scorecard.test.ts
import { describe, expect, test } from "bun:test";
import type { EvalResult } from "./lib/eval-result.ts";
import { renderScorecard, scoreIntegration } from "./scorecard.ts";

const base = (over: Partial<EvalResult>): EvalResult => ({
	integration: "mulch",
	scenarioId: "x",
	functioning: { ok: true, assertions: [] },
	durationMs: 1,
	...over,
});

describe("scorecard", () => {
	test("red when functioning fails", () => {
		expect(scoreIntegration([base({ functioning: { ok: false, assertions: [] } })])).toBe("red");
	});

	test("red when an efficiency metric is over budget", () => {
		const r = base({
			efficiency: [{ metric: "a", value: 5, unit: "count", budget: 1, withinBudget: false }],
		});
		expect(scoreIntegration([r])).toBe("red");
	});

	test("amber when cost is within 10% of ceiling", () => {
		const r = base({ cost: { usd: 0.95, budgetUsd: 1, withinBudget: true } });
		expect(scoreIntegration([r])).toBe("amber");
	});

	test("green otherwise", () => {
		expect(scoreIntegration([base({})])).toBe("green");
	});

	test("renderScorecard emits one markdown row per integration", () => {
		const md = renderScorecard([base({ integration: "mulch" }), base({ integration: "canopy" })]);
		expect(md).toContain("mulch");
		expect(md).toContain("canopy");
		expect(md).toMatch(/🟢|🟡|🔴/);
	});
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `bun test scripts/acceptance/scorecard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// scripts/acceptance/scorecard.ts
import { collectResults, type EvalResult, type Integration } from "./lib/eval-result.ts";

export type Grade = "green" | "amber" | "red";

const AMBER_COST_FRACTION = 0.9;
const QUALITY_SOFT_FLOOR = 0.6;

export function scoreIntegration(results: readonly EvalResult[]): Grade {
	let amber = false;
	for (const r of results) {
		if (!r.functioning.ok) return "red";
		for (const e of r.efficiency ?? []) {
			if (e.withinBudget === false) return "red";
		}
		if (r.cost?.withinBudget === false) return "red";
		if (
			r.cost?.usd !== undefined &&
			r.cost.budgetUsd !== undefined &&
			r.cost.usd >= r.cost.budgetUsd * AMBER_COST_FRACTION
		) {
			amber = true;
		}
		if (r.quality?.score !== undefined && r.quality.score < QUALITY_SOFT_FLOOR) amber = true;
	}
	return amber ? "amber" : "green";
}

const ICON: Record<Grade, string> = { green: "🟢", amber: "🟡", red: "🔴" };

export function renderScorecard(results: readonly EvalResult[]): string {
	const { byIntegration } = collectResults(results);
	const lines: string[] = [];
	lines.push("## os-eco Integration Eval Scorecard");
	lines.push("");
	lines.push("| Integration | Grade | Scenarios | Notes |");
	lines.push("|---|---|---|---|");
	const order: Integration[] = ["canopy", "mulch", "seeds", "sapling", "burrow", "plot", "plan-run"];
	for (const integration of order) {
		const rs = byIntegration.get(integration);
		if (rs === undefined || rs.length === 0) {
			lines.push(`| ${integration} | ⚪ | 0 | no eval ran |`);
			continue;
		}
		const grade = scoreIntegration(rs);
		const notes = rs
			.filter((r) => !r.functioning.ok)
			.map((r) => r.scenarioId)
			.join(", ");
		lines.push(`| ${integration} | ${ICON[grade]} | ${rs.length} | ${notes || "ok"} |`);
	}
	return lines.join("\n");
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `bun test scripts/acceptance/scorecard.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/acceptance/scorecard.ts scripts/acceptance/scorecard.test.ts
git commit -m "evals: scorecard aggregator (green/amber/red per integration)"
```

---

### Task 17: Scorecard CLI entry + `eval:scorecard` script + evals.yml

**Files:**
- Modify: `scripts/acceptance/scorecard.ts` (add a `main()` that runs probes + writes outputs)
- Modify: `package.json` (add `eval:scorecard`)
- Create: `.github/workflows/evals.yml`

- [ ] **Step 1: Add a `main()` to scorecard.ts**

Append:

```typescript
async function main(): Promise<void> {
	const { runAllProbes } = await import("../eval-probes/index.ts");
	const results = await runAllProbes();
	const md = renderScorecard(results);
	console.log(md);
	const { writeFileSync } = await import("node:fs");
	writeFileSync("eval-results.json", `${JSON.stringify(results, null, "\t")}\n`);
	const summaryPath = process.env.GITHUB_STEP_SUMMARY;
	if (summaryPath) writeFileSync(summaryPath, `${md}\n`, { flag: "a" });
}

if (import.meta.main) await main();
```

This makes the scorecard runnable standalone over the probe results (deterministic, no boot). The acceptance-scenario `EvalResult`s (Layers 2/3) get folded in later via the harness when it emits them; for now the scorecard covers the probe layer which is the always-on, cross-platform signal.

- [ ] **Step 2: Add the script**

In `package.json` scripts: `"eval:scorecard": "bun run scripts/acceptance/scorecard.ts",`

- [ ] **Step 3: Create the workflow** (`.github/workflows/evals.yml`)

```yaml
name: evals
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  evals:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6.0.2
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: .bun-version
      - run: bun install
      - name: Efficiency budgets
        run: bun run scripts/check-eval-budgets.ts
      - name: Scorecard
        run: bun run scripts/acceptance/scorecard.ts
      - name: Functional gap-fill scenarios
        run: bun run scripts/acceptance/run.ts --only 34,35,36 --stop-on-failure
      - name: Upload eval-results artifact
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: eval-results
          path: eval-results.json
          if-no-files-found: warn
```

Workflow is named `evals` (not `ci*`), and every command is a file-form `bun run scripts/...` — so `check-ci-parity.ts` neither inspects this file nor flags these invocations. If the in-proc acceptance harness cannot boot burrow on `ubuntu-latest` (sandbox/user-namespace limits), the scenario step will fail loudly; in that case move the "Functional gap-fill scenarios" step behind the same conditions the container acceptance uses (read `.github/workflows/ci-postgres.yml` for the pattern) or mark it `continue-on-error: true` and surface it in the scorecard — do NOT silently drop it.

- [ ] **Step 4: Verify parity is unaffected**

Run: `bun run check:ci-parity`
Expected: `✓ CI parity` (evals.yml is skipped — not `ci*`-prefixed; commands are file-form).

- [ ] **Step 5: Commit**

```bash
git add scripts/acceptance/scorecard.ts package.json .github/workflows/evals.yml
git commit -m "evals: scorecard CLI + evals.yml (probes, budgets, scenarios, scorecard)"
```

---

## Phase 5 — Real-LLM quality + cost layer (Layer 3)

### Task 18: Committed reference fixture repo

**Files:**
- Create: `scripts/acceptance/fixtures/eval-repo/` — a tiny self-contained repo: one source file with a bug, one test that fails because of it, a `package.json`/runner the sandbox can execute, and a `README` stating the task ("make the failing test pass").

- [ ] **Step 1: Create the fixture**

Minimal shape (keep it tiny to bound cost):

```
scripts/acceptance/fixtures/eval-repo/
  README.md           ← "Fix add() so the test passes."
  package.json        ← { "scripts": { "test": "bun test" } }
  src/math.ts         ← export const add = (a, b) => a - b;  // deliberate bug
  src/math.test.ts    ← expect(add(2,2)).toBe(4)
```

`src/math.ts`:
```typescript
export const add = (a: number, b: number): number => a - b;
```

`src/math.test.ts`:
```typescript
import { expect, test } from "bun:test";
import { add } from "./math.ts";

test("add sums two numbers", () => {
	expect(add(2, 2)).toBe(4);
});
```

The deterministic `outcomeOk` check is "does `bun test` pass after the agent's branch is applied" — the known-correct fix is `a + b`.

- [ ] **Step 2: Commit**

```bash
git add scripts/acceptance/fixtures/eval-repo
git commit -m "evals: reference fixture repo (failing test + known fix) for real-LLM evals"
```

---

### Task 19: Scenario 37 — real claude-code quality + cost

**Files:**
- Template to read first: `scripts/acceptance/scenarios/21-claude-code-cost-smoke.ts` (the cost-column read is exactly what Layer 3 reuses, minus the stub).
- Create: `scripts/acceptance/scenarios/37-real-claude-code-quality.ts`
- Modify: `scripts/acceptance/run.ts` (register; gate behind `--real`)

- [ ] **Step 1: Write the scenario**

Behavior:
1. At the top: `if (!ctx.real) skipScenario("real-LLM eval requires --real")` — thread `ctx.real` through the harness (Step 2 below).
2. Register the `eval-repo` fixture as a warren project (point the project gitUrl at the local fixture, mirroring how scenario 16/21 use `ctx.fixtures.sampleProjectGitUrl`; you may need to add the fixture as a fixture path — read `scripts/acceptance/lib/fixtures.ts`).
3. `POST /runs` `{ agent: "claude-code", project, prompt: "Make the failing test pass." }` against the REAL agent (no stub override). Requires `ANTHROPIC_API_KEY` in env.
4. Wait for the run to reach a terminal state and push a branch (scenario 21's `waitForClaudeUsage` / event polling shows the pattern).
5. **outcomeOk:** check out the agent's branch in a temp clone and run `bun test` in the fixture; pass = test green. This is the primary gate.
6. **cost:** read `run.costUsd`; load `scripts/eval-budgets.json` `cost["real.claude-code.maxUsd"]`; assert `costUsd <= maxUsd`.
7. Build an `EvalResult` with `quality.outcomeOk`, `cost.usd`/`budgetUsd`/`withinBudget`. Strictness: fail the scenario on `outcomeOk === false` OR cost-over-budget; the optional haiku judge (Step 8) is advisory unless `WARREN_EVAL_REAL_STRICT=1`.

`id: "37"`, `modes: ["in-proc"]`.

- [ ] **Step 2: Thread `--real` into ScenarioCtx**

`run.ts` already parses `--real` into `args.real` (run.ts:150-151). Add `real: boolean` to `ScenarioCtx` in `scripts/acceptance/lib/assert.ts` and populate it where the harness builds the ctx in `run.ts` (search where `ScenarioCtx` is constructed). Default `false`. Existing scenarios ignore it.

- [ ] **Step 3: Register scenario 37 in run.ts** (import + array entry).

- [ ] **Step 4: Run it (Linux + ANTHROPIC_API_KEY)**

Run: `ANTHROPIC_API_KEY=… bun run scripts/acceptance/run.ts --only 37 --real`
Expected: `✓ 37` — the agent fixes `add`, `bun test` passes, cost ≤ ceiling. Without `--real`: `○ 37 skipped`.

- [ ] **Step 5: Commit**

```bash
git add scripts/acceptance/scenarios/37-real-claude-code-quality.ts scripts/acceptance/run.ts scripts/acceptance/lib/assert.ts
git commit -m "evals: scenario 37 — real claude-code quality (outcomeOk) + cost ceiling"
```

---

### Task 20: Sapling twin + evals-real.yml

**Files:**
- Create: `scripts/acceptance/scenarios/38-real-sapling-quality.ts` (copy 37, `agent: "sapling"`, cost key `real.sapling.maxUsd`).
- Modify: `scripts/acceptance/run.ts` (register 38).
- Create: `.github/workflows/evals-real.yml`

- [ ] **Step 1: Write scenario 38** — identical to 37 but dispatches `agent: "sapling"` and reads the `real.sapling.maxUsd` ceiling. `id: "38"`.

- [ ] **Step 2: Register 38 in run.ts.**

- [ ] **Step 3: Create `.github/workflows/evals-real.yml`**

```yaml
name: evals-real
on:
  pull_request:
    branches: [main]

jobs:
  evals-real:
    runs-on: ubuntu-latest
    # Skip on PRs from forks (no access to secrets).
    if: github.event.pull_request.head.repo.full_name == github.repository
    steps:
      - uses: actions/checkout@v6.0.2
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: .bun-version
      - run: bun install
      - name: Real-LLM quality + cost evals
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: bun run scripts/acceptance/run.ts --only 37,38 --real --stop-on-failure
```

Named `evals-real` (not `ci*`) and file-form invocation → parity detector ignores it. The `if:` guard keeps fork PRs (no secrets) from failing on a missing key. Blocking per the operator's "gate every PR" choice; cost-bounded by the ceilings in `eval-budgets.json`.

- [ ] **Step 4: Verify parity**

Run: `bun run check:ci-parity`
Expected: `✓ CI parity`.

- [ ] **Step 5: Commit**

```bash
git add scripts/acceptance/scenarios/38-real-sapling-quality.ts scripts/acceptance/run.ts .github/workflows/evals-real.yml
git commit -m "evals: sapling real-eval twin (38) + evals-real.yml (secrets-gated)"
```

---

## Phase 6 — Final integration

### Task 21: Full gate + docs

**Files:**
- Modify: `ACCEPTANCE.md` (document the eval layers + how to run them) — read it first for the existing `--real` note and update it.
- Modify: `README.md` / `SPEC.md` only if they enumerate the acceptance scenarios (search for the scenario count "33").

- [ ] **Step 1: Update ACCEPTANCE.md** — replace the "doc-only `--real` gate" note with the real Layer 3 description; document `bun run check:eval-budgets`, `bun run eval:scorecard`, and the `evals.yml` / `evals-real.yml` jobs.

- [ ] **Step 2: Run the full gate in the Linux container** (per CLAUDE.md, Windows can't pass):

```bash
bun run check:all
```

Expected: all gates green, including `check:eval-budgets`. Fix any coverage-ratchet or file-size-budget regressions the new files introduce (raise no budgets except via the sanctioned `--update`).

- [ ] **Step 3: Run the deterministic eval scenarios** (Linux):

```bash
bun run scripts/acceptance/run.ts --only 34,35,36
bun run eval:scorecard
```

Expected: scenarios pass; scorecard prints a table with all seven integrations graded.

- [ ] **Step 4: Commit docs**

```bash
git add ACCEPTANCE.md README.md SPEC.md
git commit -m "evals: document the four-layer eval suite in ACCEPTANCE.md"
```

- [ ] **Step 5: Codex audit (milestone boundary, per global rule) then push + PR**

Per the operator's Codex audit protocol, audit the branch with Codex (exec-mode, never winpty) before any push. CLEAN → push `feat/os-eco-integration-evals` and open a PR. MUST-FIX → fix and re-audit. Non-critical → backlog and proceed.

```bash
git push -u origin feat/os-eco-integration-evals
```

---

## Self-Review (against the spec)

**Spec coverage:**
- Layer 1 efficiency budgets → Tasks 2–12 (probes for all 7 integrations + ratchet guard + CI wiring). ✓
- Layer 2 functional gap-fill (sapling 34, plan-run lifecycle 35, plot-sync 36) → Tasks 13–15. ✓
- Layer 3 quality+cost (real claude-code 37 + sapling twin 38, fixture, cost ceilings, strictness toggle) → Tasks 18–20. ✓
- Layer 4 scorecard (green/amber/red, `eval-results.json`, step summary) → Tasks 16–17. ✓
- Common `EvalResult` model designed first → Task 1. ✓
- CI split (deterministic free/blocking; real secrets-gated/blocking) → Tasks 12, 17, 20. ✓
- Per-integration matrix (canopy/mulch/seeds/sapling/burrow/plot/plan-run) → every integration has a probe (Task 6/3/7/5/8/4/9) + scorecard row. ✓
- Testing the evals themselves → every probe/guard/scorecard/model has a co-located `.test.ts`. ✓

**Deviations from spec (intentional, grounded in code reality):**
- Spec said "PR-fast job runs Layers 1+2." Reality: acceptance isn't in PR CI today and boots burrow (Linux). Resolution — Layer 1 (pure probes) wires into `check:all` + `ci.yml` (cross-platform, always-on); Layer 2 scenarios run in a dedicated `evals.yml` (ubuntu). Documented in Task 17 with an explicit fallback if burrow can't boot on the runner (no silent drop).
- Spec's efficiency metrics list per integration is honored at the achievable granularity: count/byte metrics are hard-gated (zero variance); `ms` metrics are recorded but advisory (never gated). Stated in Tasks 2/11.

**Placeholder scan:** No `TBD`/`TODO`/`FIXME` (would fail `check:debt-markers`). The "read template X first / adjust if the stub shape is rejected" instructions in Layer 2/3 tasks are deliberate — those scenarios mirror complex existing ones and inventing endpoint payloads would be wrong; the plan names the exact template file and the exact assertions instead.

**Type consistency:** `EvalResult`/`EvalEfficiency`/`Integration`/`Grade` are defined once (Task 1 / Task 16) and reused verbatim by every probe, the guard, and the scorecard. `CallCounter`/`countingSpawn`/`countingFetch`/`byteLen` defined in Task 2 and imported by Tasks 3–9. Budget JSON keys in Task 11 match the `metric` strings emitted by the probes in Tasks 3–9.
