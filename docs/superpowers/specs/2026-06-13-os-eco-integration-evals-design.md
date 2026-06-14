# os-eco Integration Evals — Design

- **Date:** 2026-06-13
- **Status:** Approved (scope + cadence confirmed by operator; building forward without per-step gating)
- **Topic:** Evals to verify warren's os-eco integrations (canopy, mulch, seeds, sapling, burrow, plot, plan-run) are *functioning* and *operating efficiently*.

## 1. Context & Finding

Warren already has strong **functional** coverage of the integrations:

- 251 `*.test.ts` unit/integration files; coverage floor 87.09% fn / 90.32% lines (`scripts/coverage-budgets.json`).
- 33 acceptance scenarios (`scripts/acceptance/scenarios/`) including os-eco roundtrips:
  canopy `23`, mulch `09`, seeds `10`/`22`, plot `25`/`28`/`29`/`31`/`32`, plan-run `26`/`27`,
  burrow `18-multi-worker` + `integration.cross-process.test.ts`.

The genuine gap is the operator's phrase **"operating as efficiently as possible"**:

- Acceptance records each scenario's `durationMs` but enforces **no budgets**.
- **No** latency/throughput/resource/size evals per integration.
- **No** agent-output-quality evals (`--real` flag exists but is a no-op stub).
- **No** cost/token budgets (cost columns exist on `runs`, unenforced).

Functional thin spots also remain: **sapling** has no dedicated scenario (only implied in dispatch tests); there is **no full plan-run create→N-children→all-merge lifecycle** e2e; **plot-sync-to-GitHub** is untested.

## 2. Goals / Non-Goals

**Goals**
- Assert each integration **functions** end-to-end (extend, don't duplicate, existing acceptance).
- Assert each integration **operates efficiently** via a ratcheted budget guard on warren's own boundary work.
- Grade **agent output quality + cost** for real runs against a fixed reference fixture, cheaply enough to gate every PR.
- Roll all of the above into one **green/amber/red per-integration scorecard**.

**Non-Goals**
- Re-testing what unit tests already cover (LWW merge math, schema validation, etc.).
- Ratcheting **LLM wall-clock** (non-deterministic) — efficiency budgets target warren's deterministic boundary work only.
- Running real-burrow or real-LLM evals on Windows (impossible — burrow needs Linux user-namespaces). Those are Linux/CI-only.

## 3. Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Eval scope | All four layers (efficiency, functional gap-fill, quality+cost, scorecard) | Operator selected all. |
| Real-LLM cadence | **Gate every PR**, cost-bounded | Operator chose gating; kept viable via a tiny fixed eval set + cheap judge. |
| Harness | Extend `scripts/acceptance/` | Reuse trusted boot/assert/lib + scenario pattern + `--real` seam. |
| Efficiency target | Deterministic **stub** harness, not real LLM | Stable, CI-able ratchet; measures warren's overhead, not model latency. |
| Ratchet direction | Only improves (faster/smaller), like coverage/bundle-size | Same discipline the repo already enforces. |
| Execution split | Deterministic layers on PR-fast (free); real layer on Linux PR job (gated) | Keep core CI fast/free; isolate $ spend. |

## 4. Architecture

### 4.1 Common result model
A single `EvalResult` type (new, `scripts/acceptance/lib/eval-result.ts`) that every eval emits:

```
EvalResult {
  integration: "canopy" | "mulch" | "seeds" | "sapling" | "burrow" | "plot" | "plan-run"
  scenarioId: string
  functioning: { ok: boolean, assertions: {name, ok, detail?}[] }
  efficiency?: { metric: string, value: number, unit: "ms"|"bytes"|"count", budget?: number, withinBudget?: boolean }[]
  quality?: { score?: number /*0..1*/, outcomeOk?: boolean, judge?: string }
  cost?: { usd?: number, tokensIn?: number, tokensOut?: number, budgetUsd?: number, withinBudget?: boolean }
  durationMs: number
}
```
Existing scenarios keep working; new/extended ones additionally return `EvalResult` via a thin adapter so the scorecard can aggregate. Designed first so all layers emit compatible data.

### 4.2 Layer 1 — Efficiency budgets (deterministic)
- New `scripts/eval-budgets.json` (budgets) + `scripts/check-eval-budgets.ts` (guard), modeled on `check-bundle-size.ts`.
- Metrics captured against the **in-proc stub** harness:
  - **canopy:** `refreshAgentRegistry` wall-time with stubbed `cn`; # `cn` invocations (N+1 watch).
  - **mulch:** `mergeMulch` time for a fixed N-record fixture; merged jsonl byte growth; # events emitted.
  - **seeds:** `sd list`/extension-write shell-out count per tick; tick wall-time.
  - **sapling:** boot-seed upsert time; dispatch seed-build time.
  - **burrow:** socket round-trip **count** for provision+seed+dispatch (assert atomic-provision stays 1 call); reap round-trips.
  - **plot:** `mergePlotEventsFile`/`mergePlotJsonFile` time + dedupe pass cost for a fixed event log; projection upsert count.
  - **plan-run:** coordinator tick latency; # DB queries per advance (N+1 watch on `pickNextPending`/merge-gate).
- Ratchet: lowering always applies; raising bounded by an `AUTO_RAISE_CAP` with `$comment` justification, same posture as bundle-size. Re-baseline via `--update`.

### 4.3 Layer 2 — Functional gap-fill (in-proc, stub burrow)
New scenarios in `scripts/acceptance/scenarios/`:
- `34-sapling-dispatch` — dispatch `agent: "sapling"`, assert Sonnet tier applied, system prompt frozen in `runs.rendered_agent_json`, workspace seeded with sapling `.canopy/agent.json`.
- `35-plan-run-full-lifecycle` — create plan-run with 3 children → coordinator dispatches seq 1, gates on PR merge, advances to 2, 3 → plan `succeeded`; assert serial gating + final state + per-child events.
- `36-plot-sync-github` — exercise `POST /plots/:id/sync` against a stub GitHub seam; assert sync PR creation per `plotSync.mergeStrategy`.

### 4.4 Layer 3 — Agent-quality + cost evals (`--real`, Linux/CI)
- A small committed **reference-repo fixture** (`scripts/acceptance/fixtures/eval-repo/`) with a deliberately-failing test and a known-correct fix.
- `37-real-claude-code-quality` (and a `sapling` twin) dispatch a real agent against the fixture, then grade:
  - **outcomeOk:** the target test passes after the agent's branch is applied (deterministic, primary gate).
  - **cost:** `runs.cost_usd` / tokens vs a fixed `budgetUsd` ceiling in `eval-budgets.json`.
  - **quality (optional):** a **haiku** LLM-judge scores the diff against a rubric (advisory unless score floor set).
- **Cost-bounding (makes per-PR gating viable):** exactly 1–2 scenarios, tiny fixture, cheap judge, hard token ceiling; the gate fails on `outcomeOk=false` or cost-over-budget, not on judge noise by default.
- Gate strictness is config-driven (`WARREN_EVAL_REAL_STRICT`) so it can be dialed without re-architecting.

### 4.5 Layer 4 — Unified scorecard
- `scripts/acceptance/scorecard.ts` consumes the `EvalResult[]` produced by a run and emits:
  - Markdown per-integration **green/amber/red** table → `$GITHUB_STEP_SUMMARY` (mirrors `report:quality-metrics`).
  - `eval-results.json` artifact for trending.
- Rule: red = any `functioning.ok=false` or budget breach; amber = quality below soft floor / cost within 10% of ceiling; green otherwise.

### 4.6 CI wiring
- **PR-fast job** (extend `.github/workflows/ci.yml`): run deterministic evals (Layers 1+2) + `check:eval-budgets` + scorecard (deterministic rows). Free, fast, blocking.
- **PR-real job** (new Linux workflow, e.g. `ci-evals-real.yml`): run Layer 3 against the fixture with secrets; blocking per operator's "gate every PR" choice; cost-bounded.

## 5. Per-Integration Eval Matrix

| Integration | Functioning (Layer 2) | Efficiency (Layer 1) | Quality/Cost (Layer 3) |
|---|---|---|---|
| canopy | existing `23` (adopt) | refresh time, `cn` invocation count | n/a |
| mulch | existing `09` (adopt) | merge time, jsonl growth, event count | n/a |
| seeds | existing `10`/`22` (adopt) | shell-out count/tick, tick time | n/a |
| sapling | **new `34`** | boot-seed + dispatch-seed time | covered by real-eval twin |
| burrow | existing cross-process (adopt) | provision/seed/reap round-trip counts | underlies real evals |
| plot | existing `25`+ (adopt) **new `36` sync** | merge + dedupe time, projection upserts | n/a |
| plan-run | **new `35` full lifecycle** | tick latency, queries/advance | n/a |
| (whole stack) | — | — | **new `37`** real claude-code + sapling on fixture |

## 6. Testing the Evals Themselves
- Budget guard, scorecard aggregation, and `EvalResult` adapter get plain `*.test.ts` unit coverage (they're deterministic code) — keeps them under the coverage ratchet.
- New in-proc scenarios are self-checking and clean up after themselves (existing acceptance contract).

## 7. Risks & Mitigations
- **Real-eval cost/flakiness gating PRs** → tiny fixed fixture, cheap judge, gate on deterministic `outcomeOk`+cost not judge score, strictness toggle.
- **Efficiency-budget noise in CI** → measure deterministic stub-harness boundary work only; allow bounded auto-raise like bundle-size; budgets are counts/bytes where possible (zero variance).
- **Windows can't run real/burrow evals** → deterministic layers run locally; real layer documented as Linux/CI-only.
- **Scope creep** → strict build order; each layer independently shippable; scorecard degrades gracefully when a layer is absent.

## 8. Build Order (phases → implementation plan)
1. `EvalResult` model + adapter + unit tests.
2. Efficiency budgets: instrument stub harness, `eval-budgets.json`, `check-eval-budgets.ts`, wire to `check:all` + ci.yml.
3. Functional gap-fill scenarios `34`/`35`/`36`.
4. Scorecard `scorecard.ts` + `$GITHUB_STEP_SUMMARY` wiring.
5. Real-LLM layer: fixture repo, scenarios `37`(+sapling), `ci-evals-real.yml`, cost ceilings.

## 9. Open Questions (non-blocking; sensible defaults chosen)
- Exact $ ceiling per real-eval scenario — default to a low fixed cap, tune after first real run.
- Whether the haiku judge score becomes a hard floor — default advisory; promote later if stable.
