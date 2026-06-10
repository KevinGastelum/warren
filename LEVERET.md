# Leveret — V1 specification

> Status: **spec**. Promoted from brainstorm on **2026-06-06** after a second
> grounding + alignment pass (re-scouted warren, `../burrow`, and pi **v0.77.0**;
> locked the v1 scope with the operator). **§0 (V1 Specification) is
> authoritative.** §1–§10 below are retained as design history/context; where
> they disagree with §0, §0 wins. Where §0 disagrees with `SPEC.md`, fold the
> resolution into `SPEC.md` as this lands (see §0.11).
>
> **Earlier grounding pass (2026-06-05):** §10 captured the first round of
> verified findings + locked decisions; §0 supersedes it where they differ.
>
> **Reconciliation pass (2026-06-06):** the §0.0 round-2 deltas (PR-gated
> send-off that closes the conversation, N:1 Plot↔conversation with re-plan via
> a new conversation, the `plots` projection table, the PR-merge poller +
> auto-dispatched planner, manual plan-run dispatch) have been **folded down
> into §0.1–§0.14**, so all of §0 now reads as one coherent narrative. The
> round-1 mechanics that §0.0 replaced ("re-send supersedes the prior plan",
> "plan-run dispatch closes the conversation", the two-button popup framing) are
> removed from §0.1–§0.14; consult git history for the prior wording. §0.0
> remains the authoritative summary of those decisions.

## 0. V1 Specification (2026-06-06)

> Authoritative for v1. Promoted from the §1–§10 brainstorm after a second
> grounding pass (warren + `../burrow` + pi 0.77.0) and four alignment rounds
> with the operator. Code-seam citations are from that pass; line numbers are
> indicative, not load-bearing.

### 0.0 Round-2 grounding + decisions (AUTHORITATIVE — supersedes §0.1–§0.14 where noted)

> Added **2026-06-06** after a second parallel grounding pass (warren codebase,
> `../burrow`, and pi **0.77.0** queried directly via `pi -p`) and a two-round
> alignment with the operator. **Where this subsection conflicts with §0.1–§0.14,
> §0.0 wins.** This is the ready-to-build layer.

#### A. Plot persistence — full-state JSON mirror (NEW; revises §0.5; resolves the operator's open concern)

Plots remain **git-backed source of truth** — the two-files-per-Plot model in the
project's `.plot/` (`<id>.json` state doc carrying `intent`, `<id>.events.jsonl`
append log), authored for clean git diffs, with a rebuildable `.index.db` cache.
**There is no authoritative plots DB; there isn't one today either** (warren only
holds back-links: `projects.has_plot`, `runs.plot_id`, `plan_runs.plot_id`).

Warren **adds a `plots` projection table** that mirrors **full plot state as a
single JSON-blob column**, *not* normalized per-field columns, plus a small set
of promoted scalar columns for list/index queries (`id`, `project_id`, `status`,
`title`, `updated_at`).

- **Why JSON-blob:** the shape of a Plot (which sections/categories it carries)
  is expected to **drift rapidly** once the system is in real use. A blob keeps
  the store schema-stable across add/remove of plot sections — no migration per
  shape change.
- **Source of truth stays git.** The table is a **read-cache/projection**,
  upserted whenever warren reads or writes a Plot through the single
  `src/plot-client/` write path (which already does the locked
  read-modify-write on `<id>.json` + `intent_edited` append).
- **UI renders the right pane dynamically from the plot JSON shape** — no
  hardcoded goal/non-goals/constraints/success-criteria fields — so each Plot can
  surface a custom structure.
- This is a deliberate **partial down-payment on the §8 first-class plots table**,
  scoped to a *projection* (not authoritative), so the §8 "don't rewrite the
  spine" deferral still holds.
- *Open:* whether to summarize `events` onto the row (count / last-seq) or omit
  for v1.

#### B. Send-off — PR-gated, auto-dispatched planner (REPLACES §0.7 steps 1–4 and the §0.2 "send-off does not close the conversation" decision)

1. **"Send to planner"** (enabled once intent is non-empty): warren opens a **PR
   against the target project** whose **only** change is the plot-state update —
   safe by construction, since Leveret ships no `edit`/`write` tool, so nothing
   else can be in the diff. Reuses the existing `plotSync` PR machinery
   (`src/plots/sync.ts`). **This action CLOSES the conversation.**
2. **No webhooks in v1** → warren **polls the PR/branch until merged** (a new
   boot-worker mirroring `bootPauseDetector` / `bootWatchdog`). The operator
   merges the PR manually. (Accepted tradeoff for v1.)
3. **On detected merge → warren auto-dispatches the `planner` run keyed on
   `plot_id`** (`src/registry/builtins/planner.ts`, its own burrow). The
   planner's fresh clone now contains the merged intent; it emits an `sd plan`
   and does **not** self-dispatch.
4. **Plan-run dispatch stays operator-gated (CONFIRMED 2026-06-06)** — the §10.4
   approval-gate / taste signal is preserved: the planner auto-dispatches on
   merge and emits the `sd plan`, but the final plan-run dispatch remains a
   manual approve step ("Dispatch plan" opens the `/plan-runs/new`-style popup).
   Auto-dispatch of the plan-run is explicitly **not** in v1.

#### C. Cardinality N:1 + re-shape via new conversation (REVISES §0.2 cardinality and §0.7 re-send)

A **Plot hosts many conversations** (`conversations.plot_id` set; **N:1**).
Because "Send to planner" closes the conversation, the **re-plan path is to start
a NEW conversation attached to the same existing Plot**, which re-loads current
intent from the projection / `.plot/`. The old **"re-send supersedes the prior
undispatched plan" mechanic is DROPPED.** A new conversation may **auto-create a
fresh Plot** or **attach to an existing one** (operator choice at start).

#### D. Lifecycle (REVISES §0.4 + §0.7)

A conversation is `active` while being shaped and transitions to `closed` on
**"Send to planner"** (B.1). The **anchoring run** still finalizes independently
on idle-timeout (transcript survives in `messages`; re-wake replays the DB
transcript into a fresh pi session). The **Plot always persists.**

#### E. Scout-verified corrections to §0.3 / §0.4 / §0.6 / §0.11

- **§0.3 "reuses `buildPiArgv` unchanged" is INACCURATE.** `--no-extensions` is a
  hard-coded element of `PI_FORCED_ARGV` (`../burrow/src/runtime/pi.ts:185`). A
  **small refactor to parameterize the extensions flag in `buildPiArgv` is
  mandatory**, not optional. The rest of the kept-alive seam is verified accurate
  (`useStdinHold = runtime.shouldCloseStdinOnEvent !== undefined` verbatim;
  returning `false` on `agent_end` keeps the run `running`; per-burrow
  `concurrency:1`; `timeout_minutes` not enforced).
- **`extension_ui_request` auto-answer is GENUINELY NET-NEW.** Nothing in burrow
  replies to it today — that is precisely why `--no-extensions` exists. pi
  confirms the host declines with `{"type":"extension_ui_response", id,
  cancelled:true}` (or auto-answers `confirmed:true` for an allowlist). **Needs
  golden capture** against host pi **0.77.0** (burrow goldens are **0.74.0**).
- **§0.6 `propose_intent` is FULLY VIABLE (confirmed).** A pi tool's `execute()`
  returns `details` (arbitrary JSON, never shown to the model) carried on the
  **`tool_execution_end`** stdout event — the conversation bridge parses intent
  fields from there. NOT from the `message_end`/toolResult form, which drops
  `details`. Correlate via `toolCallId`.
- **§0.4 "crash recovery finalizes orphaned running rows" is IMPRECISE.**
  `bootBridges` (`src/server/bridges.ts`) *resumes* bridges and only finalizes
  (`burrow_run_lost`) when a burrow pre-probe 404s. "Exempt or re-anchor" still
  holds; the trigger is burrow-lost, not a blanket restart sweep.
- **`runtime:"pi-chat"` needs no `KNOWN_RUNTIME_IDS` change.** `readRuntimeId`
  reads `frontmatter.runtime` as a free string without validation;
  `KNOWN_RUNTIME_IDS` only gates `interactiveAgents.*` config overrides, which
  Leveret does not use.
- **§0.8 caution:** `formalizePlotHandler` + `answerPlotQuestionHandler` share
  `workbench.ts` with `POST /brainstorm`; **only the brainstorm dispatcher is
  removed** — do not delete formalize/answer wholesale.
- **Pause detector already exempts `mode:"conversation"`** for free
  (`src/runs/pause.ts` guards on `mode !== "batch"`). **Workspace GC** is
  state-keyed (safe while the run is non-terminal). Only **watchdog**
  (`src/runs/watchdog.ts`) and **reap-destroy** (`src/runs/reap/destroy.ts`) need
  an explicit `"conversation"` skip added.

#### F. Updated change-surface delta (additions to §0.11)

- **warren:** new **`plots` projection table + `PlotsRepo`** — JSON-blob column +
  promoted scalars (`id`, `project_id`, `status`, `title`, `updated_at`); mirror
  in `src/db/schema/{columns,sqlite,postgres}.ts` (+ `drift.test.ts` maps);
  `bun run db:generate`. Upsert hook on the `src/plot-client/` read/write paths.
- **warren:** new **PR-merge poller** boot-worker (mirror `bootPauseDetector`);
  persist the submitted PR ref + `plot_id` + planner agent (on the conversation
  row or a small `plot_submissions` record) so the poller can auto-dispatch the
  planner on merge.
- **UI:** right-pane renders **dynamically from plot JSON shape** (schema-flexible
  per-plot), replacing any fixed intent-field form.
- Everything else in §0.11 stands, with the §0.0.E corrections folded in. The §0.12
  phase order still applies; insert the **plots projection table** into phase 2
  (warren store) and the **PR-merge poller + auto-dispatch** into phase 5 (send-off).

#### G. Residual opens (safe to settle in implementation)

- Exact promoted scalar columns; whether an event summary lives on the projection row.
- Where the submitted-PR ref lives (conversation row vs new `plot_submissions`).
- Plan-run dispatch auto-vs-manual after the planner emits its plan (assumed manual).
- Poller interval; whether to reuse the `plotSync` PR identity for the merge probe.
- `messages.content` shape; whether tool calls persist as `role:"tool"` rows.

### 0.1 Scope

**In (v1):**

- A persistent, pi-backed **conversational overseer** ("Leveret") the operator
  chats with to shape a Plot's intent in real time.
- **One long-lived burrow run per conversation** (`mode="conversation"`), kept
  alive across turns; modeled/surfaced as a conversation, **never** in the Runs
  list.
- New `conversations` + `messages` warren tables as the durable transcript,
  plus a **`plots` projection table** (JSON-blob full-state mirror + promoted
  scalars) that read-caches git-backed Plot state for list/index queries (§0.0.A).
- A **top-level Leveret UI**: conversation (left) + live-editable Plot intent
  (right, rendered **dynamically from the plot JSON shape**) + send-off buttons (top).
- Live intent writing via a single shipped pi extension tool, **`propose_intent`**;
  warren applies the canonical `intent_edited` with `actor = agent:leveret`.
- **Send-off** (§0.0.B): "Send to planner" opens a **PR against the target
  project** carrying only the plot-state update (safe by construction — Leveret
  ships no `edit`/`write` tool), reusing the `plotSync` PR machinery; **this
  closes the conversation**. A **PR-merge poller** (boot-worker; no webhooks in
  v1, operator merges manually) detects the merge and **auto-dispatches a
  separate `planner` run** keyed on `plot_id`, whose fresh clone contains the
  merged intent. The planner emits an `sd plan` and does **not** self-dispatch.
  The final plan-run dispatch stays **operator-gated** via a `/plan-runs/new`-style
  popup (confirmed manual; no auto-dispatch in v1).
- Removal of the old respawn-per-turn path (`mode=interactive`,
  `POST /brainstorm`, `spawnInteractiveTurn`, `reap/interactive`), preserving the
  byte-identical no-Plot batch path.
- Burrow **extension plumbing landed now** (the `pi-chat` runtime, dropping
  `--no-extensions` for it, `extension_ui_request` auto-handling, `pi_extensions`
  seeding) even though only `propose_intent` ships in v1.
- A small `../plot` ACL change: allow an **agent-actor `intent_edited`**.

**Out (deferred):** subagents (eventual shape locked: subprocess child-pi,
read-only repo + web — §0.12), Exa web search, the agent-to-agent API, the
autonomy dial / approval-as-classifier, project-less / colony conversations, pi
`--session` resume (v1 re-wakes by **transcript replay**), and all §8 data-plane
work.

### 0.2 Locked decisions (this session)

| Topic | Decision |
|---|---|
| **Send-off** | "Send to planner" opens a `plotSync` PR with the intent update and **closes the conversation**; a PR-merge poller auto-dispatches a separate `planner` run on merge; that planner emits an `sd plan` and does not self-dispatch; the plan-run dispatch is operator-driven. **No** §11.Q attachment-synthesizer, **no** plan-run auto-dispatch in v1. |
| **MVP scope** | Long-lived conversation + live Plot intent + send-off only. Subagents/Exa deferred. |
| **Extension plumbing** | Land the burrow + seeding plumbing now; ship exactly one extension (`propose_intent`). |
| **Leveret tools** | Read-leaning built-ins `read/grep/find/ls/bash` (bash kept as an operator-trusted overseer escape hatch) + `propose_intent`. **No** `edit`/`write`. |
| **Interactive retirement** | Rip out `mode=interactive` / `brainstorm` in this slice. |
| **Re-wake** | Always replay the DB transcript into a fresh pi session; do **not** depend on the burrow/workspace surviving (so v1 needs no pi `--session` resume). |
| **Intent ACL** | Add an agent-actor `intent_edited` to `../plot`; Leveret edits intent **as leveret** (tracked as such, not under a human guise). |
| **Conversation scoping** | Project **required**; a Plot is **auto-created or attached** when the conversation starts (operator choice). A Plot **hosts many conversations** (N:1). |
| **Send-off ↔ lifetime** | "Send to planner" **closes the conversation** (§0.0.B/D). The *anchoring run* finalizes independently on idle-timeout; the **Plot always persists**. |
| **Re-plan** | The conversation closes on send-off, so re-planning is a **new conversation attached to the same Plot** (re-loads current intent). The old "re-send supersedes the prior undispatched plan" mechanic is **dropped** (§0.0.C). |
| **UI** | Top-level Leveret surface; split view (conversation left, live Plot right rendered dynamically from the plot JSON shape), dispatch buttons at the top. |
| **Closure** | A conversation closes on **"Send to planner"**; idle-timeout finalizes only the *anchoring run*. The **Plot always persists**. |

### 0.3 Conversational runtime `pi-chat` — burrow

The kept-alive mechanism is a **second registered `AgentRuntime`**, not a burrow
overhaul. Burrow already enables "hold stdin open" purely from the *presence* of
the optional `shouldCloseStdinOnEvent` hook
(`../burrow/src/runner/dispatch.ts`: `const useStdinHold =
runtime.shouldCloseStdinOnEvent !== undefined`).

- **`pi-chat` runtime** (`../burrow/src/runtime/pi.ts`): reuses every exported
  helper (`buildPiArgv`, `encodePiStdin`, `encodeSteeringMessage`, the pi parser,
  `extractMetadata`, `piEnvPassthrough`) but **keeps the hook defined** and
  returns `false` for `agent_end`, so stdin stays open and the run stays
  `running`. Subsequent operator turns ride the **existing** `writeStdin` /
  mid-run steering loop (only the `{"type":"prompt"}` RPC verb is fixture-proven —
  do not introduce new verbs without golden capture; burrow's goldens are from
  the pi **0.74.0** era while the host pi is **0.77.0**).
- **Argv:** split `PI_FORCED_ARGV` so `--no-extensions` is appended
  conditionally; `pi-chat` omits it (keep `--offline`). Burrow already forces
  `--session-dir .pi/sessions`, so in-sandbox sessions live at
  `<workspace>/.pi/sessions/` as assumed (resume flag is `--session`; there is no
  `--session-id`).
- **`extension_ui_request` handling:** `--no-extensions` exists specifically to
  avoid hangs on pi's interactive `extension_ui_request` RPC. Enabling extensions
  means the `pi-chat` dispatch path must **auto-answer/decline**
  `extension_ui_request` (e.g. deny non-`propose_intent` UI prompts) so a run
  never blocks.
- **Env:** add `EXA_API_KEY` to the pi env-passthrough set now (forwarded only
  when present on the host; never via argv) so the later Exa slice needs no
  burrow change. `network = "open"` is already set for pi-style builtins.
- **No wall-clock safety:** `timeout_minutes` is parsed but **not enforced** by
  the LocalProvider — lifetime control is warren-side (§0.4).
- **Burrow serializes runs per-burrow at `concurrency:1`** — a conversation run
  pins its burrow until it ends. Acceptable: one conversation = one burrow.
  Subagents (later) are child *processes* inside that sandbox, not warren runs.

### 0.4 Conversation lifetime + re-wake — warren

The kill chain to suppress: burrow emits a terminal envelope on `agent_end` →
the stream bridge (`src/runs/stream/bridge.ts`) sets `terminalDetected` and reap
runs. The `pi-chat` change (§0.3) stops that envelope per-turn. The remaining
warren-side guards:

- **Heartbeat watchdog** (`src/runs/watchdog.ts`) is opt-in
  (`WARREN_RUN_HEARTBEAT_TIMEOUT_MS`) and has **no `mode` exemption** — add one
  so an armed watchdog can't force-fail an idle conversation run.
- **Reap workspace-destroy** (`src/runs/reap/destroy.ts`) and the **pause
  detector** (`src/runs/pause.ts`) already exempt `mode:"interactive"` — extend
  to `mode:"conversation"`.
- **Workspace GC** (`src/runs/reap/gc.ts`) spares burrows with any non-terminal
  run; safe while the conversation run is `running`.
- **Crash recovery** finalizes orphaned `running` rows on restart — exempt or
  re-anchor `mode:"conversation"` rows.
- **Idle-timeout coordinator** (new; mirror `bootPauseDetector` /
  `agent.pauseTimeoutMs` in `src/warren-config/schema.ts`): a new config knob
  (proposed `conversation.idleTimeoutMs`, default ~20 min, in
  `.warren/config.yaml`) finalizes the *anchoring run* after inactivity. This
  does **not** close the conversation.
- **Re-wake:** when the operator returns to an `active` conversation whose
  anchoring run is terminal, spawn a **new** `mode:"conversation"` run that
  **replays the DB transcript** into a fresh pi session (no dependence on the
  prior workspace/`.pi/sessions/`). Token cost grows with transcript length;
  acceptable for v1.

### 0.5 Data model

New tables (bun:sqlite + drizzle; mirror in `src/db/schema/postgres.ts` or the
drift test fails; generate via `bun run db:generate`). Follow the `projects` +
`ProjectsRepo` template.

- **`conversations`**: `id` (pk), `project_id` (**required** in v1, FK/text to
  `projects`), `plot_id` (text, nullable in schema for forward-compat though v1
  always sets it), `anchoring_run_id` (text, nullable — rotates on re-wake),
  `status` (`active` | `closed`), `title`, `created_at`, `last_activity_at`,
  `closed_at`. Index `(project_id)`, `(plot_id)`.
- **`messages`**: `id` (pk), `conversation_id` (FK, `onDelete: cascade`), `seq`
  (monotonic per conversation), `role` (`user` | `assistant` | `system` |
  `tool`), `content` (text/json), `created_at`, optional `run_id` (which
  anchoring run produced it). Index `(conversation_id, seq)`.
- **New run mode `"conversation"`** added to `RUN_STATES`' sibling
  `RUN_MODES` tuple (`src/db/schema/columns.ts`). The anchoring run is filtered
  out of the Runs list by mode.
- The `events` table stays run-anchored + single-writer (the bridge); conversation
  turns live **only** in `messages`. Assistant text streams to the UI via the
  existing event broker for live view and is persisted as a final `messages` row
  on turn end.

### 0.6 Live intent — `propose_intent` → `intent_edited(actor=leveret)`

Leveret runs *inside* the sandbox, so workspace `.plot/` writes are invisible to
warren until reap. Live intent therefore travels **out over the event stream**:

1. Leveret calls the shipped pi extension tool **`propose_intent`** (the one
   extension v1 ships, seeded via the new `pi_extensions` path — §0.10). Its
   structured emission (the proposed intent fields — goal, non-goals,
   constraints, success criteria, matching the `../plot` intent schema) lands on
   pi stdout → burrow stream → warren.
2. The conversation stream bridge parses the `propose_intent` emission and, **host-side**,
   writes the canonical `intent_edited` to the Plot via the plot client with
   `actor = agent:leveret`.
3. **`../plot` change:** widen the intent-edit ACL so `AgentPlotClient` can emit
   `intent_edited` with an agent actor. The mechanism is `EVENT_ACL.intent_edited`
   in `../plot/src/acl.ts` (`["user"]` → `["user", "agent"]`), and the change
   touches a documented hard invariant — so the full surface is: (a) `EVENT_ACL`
   in `src/acl.ts`; (b) the `intent_edited` `REDIRECT_HINT` (drop or scope it so
   agents aren't redirected to `question_posed`); (c) the SPEC §6 "single hard
   rule: agents may never mutate intent" text; (d) the ACL tests in
   `src/acl.test.ts` (e.g. `EVENT_ACL.intent_edited` equals `["user"]`, the
   agent-rejection cases); (e) the `.factory/skills/plot-coordination/SKILL.md`
   doc. Either widen `["user","agent"]` outright or add an agent-permitted
   variant. The event log records leveret authorship explicitly — *not* under a
   human guise. The operator can still edit intent directly (`UserPlotClient`);
   both authorships coexist in the log.

`propose_intent` patches structured intent fields (not free-form replace). The
old "formalize" marker-parser is **not** reused for intent in v1 (superseded by
the typed tool); retire or repoint it.

### 0.7 Send-off + dispatch (PR-gated; §0.0.B authoritative)

1. **Button "Send to planner"** (top of the Leveret surface, enabled once intent
   is non-empty): warren opens a **PR against the target project** whose only
   change is the plot-state update — safe by construction (Leveret ships no
   `edit`/`write` tool, so nothing else can be in the diff). Reuses the existing
   `plotSync` PR machinery (`src/plots/sync.ts`). **This action closes the
   conversation** (transitions to `closed`; the anchoring run finalizes). The
   Plot persists.
2. **No webhooks in v1** → a new **PR-merge poller** boot-worker (mirror
   `bootPauseDetector`; reuse the existing plan-runs merge-polling helpers in
   `src/plan-runs/pr-merge.ts` / `merge-gate.ts` rather than re-implementing)
   polls the PR/branch until merged. The operator merges the PR manually
   (accepted v1 tradeoff). The submitted PR ref + `plot_id` + planner agent are
   persisted (conversation row or a small `plot_submissions` record — §0.0.G) so
   the poller can auto-dispatch on merge.
3. **On detected merge → warren auto-dispatches a separate `planner` run**
   (existing `src/registry/builtins/planner.ts`, its own burrow) keyed on
   `plot_id`. Its fresh clone now contains the merged intent. The planner emits
   an `sd plan` via `sd plan prompt` / `sd plan submit` and **does not
   self-dispatch** (confirmed: its prompt forbids `POST /runs` / `POST
   /plan-runs`).
4. **Plan-run dispatch stays operator-gated (manual, confirmed):** "Dispatch
   plan" opens a popup that **mirrors the existing `/plan-runs/new` fields**,
   pre-filled from the synthesized plan — identical to a manual plan-run dispatch
   (reuses `src/plan-runs/` + the existing handler). Plan-run auto-dispatch is
   **not** in v1.
5. **Re-plan is a new conversation attached to the same Plot** (§0.0.C). Because
   send-off closed the prior conversation, refining intent means starting a fresh
   `mode:"conversation"` run attached to the existing Plot, which re-loads current
   intent from the projection / `.plot/`. The old "re-send supersedes" mechanic is
   dropped.

This is the §10.4 path. Direct bugwatch-style dispatch ("Leveret, fix this bug"
→ `auto_plan_run`) is **not** in v1 — deferred (the §4 precedent stands for a
later slice).

### 0.8 Retirement of `mode=interactive`

Rip out in this slice, preserving the byte-identical no-Plot batch path
(acceptance guarantee):

- Remove `spawnInteractiveTurn` (`src/runs/interactive.ts`), the interactive
  branch of `POST /runs/:id/messages` (`src/server/handlers/runs/dispatch.ts`),
  `POST /brainstorm` (`src/server/handlers/plots/workbench.ts`), and
  `src/runs/reap/interactive.ts`.
- Retire the `brainstorm` builtin (and the interactive `mode` value once no rows
  depend on it).
- Repoint the reusable steering channel onto the conversation turn-delivery path.

### 0.9 UI — top-level Leveret surface

- A **new top-level "Leveret" nav** (cross-project overseer home) with a
  conversations list.
- A conversation opens a **split view**: **left** = the Leveret chat (streamed);
  **right** = the Plot being shaped — **operator-editable** and **live-updates
  when Leveret edits intent** (via `propose_intent` → `intent_edited`).
- **Top bar buttons:** "Send to planner" and (once a plan exists) "Dispatch plan"
  (opens the `/plan-runs/new`-style popup).
- The anchoring `mode:"conversation"` run never appears in the Runs list.
- Reuses `src/ui/src/components/Chat.tsx`; replaces the
  `plot-detail/interactive-panel.tsx` brainstorm flow.

### 0.10 Seeding `pi_extensions` — warren

Mirror the existing `pi_skills` / `pi_prompts` path in `src/runs/seed.ts`
(`buildPiArtifactFiles`):

- Add a third `PiArtifactKind = "extension"` → base dir `.pi/extensions`, flat
  path `${name}.ts` (extensions are TS modules default-exporting `(pi) => {…}`).
  JSONL `{name, body}` shape + `isSafeArtifactName` guard reused.
- Add `agent.sections.pi_extensions` handling + a `piExtensions` field on
  `BuildSeedFilesResult`.
- Inert until burrow drops `--no-extensions` for `pi-chat` (§0.3) — both land
  together.

### 0.11 Change-surface summary

**`../plot`:** allow agent-actor `intent_edited` by widening
`EVENT_ACL.intent_edited` in `src/acl.ts` (`["user"]` → `["user","agent"]`) or
adding an agent-permitted variant — also updating the `REDIRECT_HINT`, SPEC §6,
`src/acl.test.ts`, and `.factory/skills/plot-coordination/SKILL.md` (§0.6); bump
the warren `plot-cli` pin if a new capability gate is needed.

**`../burrow`:** (1) register the `pi-chat` runtime (stdin held on `agent_end`);
(2) conditional `--no-extensions` in `PI_FORCED_ARGV` / `buildPiArgv`; (3)
auto-handle `extension_ui_request` on the conversational dispatch path; (4) add
`EXA_API_KEY` to the pi env-passthrough set. No `burrow.toml` schema change.

**warren:**
- `src/registry/builtins/leveret.ts` (`runtime:"pi-chat"`, `system`,
  `burrow_config network="open"`, `pi_extensions` carrying `propose_intent`) +
  append to `BUILTIN_AGENTS`.
- `src/runs/seed.ts`: `pi_extensions` → `.pi/extensions/` (§0.10).
- `src/db/schema/{columns,sqlite,postgres}.ts` + repos: `conversations` +
  `messages` + `mode:"conversation"`; **`plots` projection table + `PlotsRepo`**
  (JSON-blob full-state column + promoted scalars `id`/`project_id`/`status`/
  `title`/`updated_at`; upsert hook on the `src/plot-client/` read/write paths —
  §0.0.A/F); `bun run db:generate`.
- Lifetime: idle-timeout coordinator + `conversation.idleTimeoutMs` schema knob;
  watchdog/crash-recovery/reap-destroy/pause exemptions for `mode:"conversation"`
  (pause detector already exempt via `mode !== "batch"` — only watchdog,
  crash-recovery, and reap-destroy need an explicit skip; §0.0.E).
- Conversation stream bridge variant that persists turns to `messages`, parses
  `propose_intent` from `tool_execution_end` `details` (§0.0.E), and writes
  `intent_edited(actor=leveret)`; re-wake via transcript replay.
- Send-off: open the `plotSync` PR + close the conversation; **PR-merge poller
  boot-worker** (reuse `src/plan-runs/pr-merge.ts` helpers) that auto-dispatches
  the `planner` run on merge; persist the submitted PR ref + `plot_id` + planner
  agent; "Dispatch plan" → existing plan-run path (manual, operator-gated).
- Conversation API endpoints (create/list/get/post-message/send-off); hide
  `mode:"conversation"` from the Runs API.
- UI: top-level Leveret surface (§0.9); retire interactive (§0.8).

### 0.12 Build phases (suggested sequencing)

1. **Burrow `pi-chat` runtime** (+ extension plumbing, env, `extension_ui_request`
   handling) with goldens — the prerequisite.
2. **warren store**: `conversations`/`messages`/`mode:"conversation"` + repos +
   the **`plots` projection table + `PlotsRepo`** (§0.0.A) + lifetime exemptions
   + idle-timeout coordinator + re-wake replay.
3. **`leveret` builtin + `pi_extensions` seeding + `propose_intent`** +
   `../plot` ACL + host-side `intent_edited(actor=leveret)`.
4. **Conversation API + top-level Leveret UI** (split view, streaming).
5. **Send-off** (`plotSync` PR + close conversation → **PR-merge poller** →
   auto-dispatch planner run → `/plan-runs/new` popup for the manual,
   operator-gated plan-run dispatch).
6. **Retire `mode=interactive` / `brainstorm`** (last, once parity is proven;
   keep the no-Plot batch path byte-identical).

### 0.13 Acceptance (v1)

- A conversation shapes a Plot's intent live (operator sees right-pane intent
  update as Leveret calls `propose_intent`, attributed to leveret).
- The conversation survives many turns on one run, an idle finalize, and a
  re-wake (transcript replay) without losing transcript.
- "Send to planner" opens a `plotSync` PR and **closes the conversation**; on
  merge the PR-merge poller auto-dispatches the `planner`, which produces an
  `sd plan` (does not self-dispatch); "Dispatch plan" dispatches a plan-run via
  the existing path (manual, operator-gated). The Plot persists, and re-planning
  is a new conversation attached to the same Plot.
- No `mode:"conversation"` run appears in the Runs list.
- The no-Plot batch dispatch path remains byte-identical (existing acceptance
  guarantee).
- A new acceptance scenario under `scripts/acceptance/scenarios/` exercises the
  conversation → intent → send-off → dispatch loop, deterministic + idempotent.

### 0.14 Residual details (safe to settle in implementation)

- Exact `messages.content` shape (plain text vs typed parts) and whether tool
  calls are persisted as `role:"tool"` rows.
- `propose_intent` field set — bind to the `../plot` intent schema exactly.
- Whether the idle-timeout default is 20 min and the precise knob path under
  `.warren/config.yaml`.
- Whether to mirror anything into `.plot/` at send-off vs rely on the committed
  `intent_edited`.
- Conversation title derivation (first user message vs Leveret-named).

---

## 1. The motivating shift

Today warren is driven by **manually dispatching move-primitives**: the operator
opens the UI and hits "dispatch a run" or "dispatch a plan-run." The operator is
the orchestrator.

The wanted interaction is:

> I go into the UI, **iterate an idea inside a Plot** until it's shaped right,
> then **send that Plot off** and the system delegates and dispatches the
> underlying plans/runs for me.

So the **Plot becomes the atomic unit** of how I work: it is both
1. my **thinking / iteration surface**, and
2. the **origin of dispatch**.

Runs and plan-runs become the machinery a Plot drives, not things I hand-author.
"Run" should mean **an agent writing code**, not "a conversation turn."

### Framing decisions locked in this session

- **"Atom" is two-layered and both can hold.** *Plot* is the product/conceptual
  atom (what I see and steer). The typed event *Record* (from the Agent State
  Protocol note) is the eventual storage atom. We are **not** rewriting warren's
  event/run spine to chase the Record idea now.
- **Purely additive.** Nothing in the existing run / burrow / plan-run / events
  spine gets rewritten or broken. Leveret and "send-off" sit *on top*.
- **Heavy data-plane work is parked.** First-class `plots` DB table, full ASP
  Record envelope (id/type/actor/parents/clock/sig), and DB-authoritative-with-
  git-export are interesting but **deferred**. Build the interaction loop on the
  current store first. (Captured in §8 as future work.)
- **We own `../plot` and the pi runtime config**, so we can shape their
  types/behaviour to serve this exactly.

## 2. Leveret — the concept

**Leveret** (a baby rabbit living in the warren) is warren's resident
**conversational overseer**.

- I **converse** with Leveret in a persistent chat. This is *not* respawn-per-turn
  and is *not* tracked as runs.
- Leveret has **subagents** as tools: scouting subagents and web-search subagents
  (Exa API), so heavy lookups happen off to the side **without overfilling the
  main conversation context**.
- Leveret is an **overseer across all projects**; a conversation can be **scoped
  to a specific project**.
- As we talk, Leveret **fills in the Plot's intent in real time** (goal,
  non-goals, constraints, success criteria). I can correct it by **chatting** or
  by **editing the intent fields directly**.
- When I'm satisfied, I **send the Plot off** → a **planner** agent converts the
  intent into an **`sd plan`**, which is then **auto-dispatched** (a plan-run
  walks it).
- Leveret can also **dispatch work directly** — "Leveret, fix this bug" → it
  files a seed and dispatches a run/plan-run.
- Leveret is exposed via **API endpoints**, so other agents can talk to it
  directly.

End-to-end:

```
me  ⇄  Leveret  →  Plot (shaped intent)  →  [send off]  →  planner  →  sd plan  →  auto-dispatched plan-run  →  runs (agents writing code)
        │
        └─ "fix this bug" → file seed → dispatch (bugwatch-style auto_plan_run)
```

## 3. Substrate (the chosen direction)

**Leveret is pi-backed, running in a burrow** — *not* a warren-native LLM loop.
Rationale (correcting an earlier over-engineered proposal): **pi already does all
the provider/LLM work**, so warren needs **no LLM SDK and no in-process provider
key**. Custom tools and subagents are **pi extensions**. The one real problem to
solve is burrow lifetime.

### 3.1 Keep the burrow alive for the conversation

> **[GROUNDED → §10.2]** The mechanism is now decided: a **single long-lived
> run per conversation**, kept `running` by a small, reusable burrow tweak that
> stops treating `agent_end` as run-terminal for a "conversational" runtime;
> the run only finalizes on **send-off** or an **inactivity timeout**. No burrow
> overhaul. The exploratory text below is retained for context.

Burrow runs are one-shot today (spawn → exit at a terminal state), and warren's
watchdog/reap/pause machinery actively force-kills idle `running` agents. The
direction here is: **with some tweaking, keep the pi process / burrow alive for
the duration of a conversation, and re-wake it to resume.** These are considered
doable, not blockers.

Concretely this likely means:
- A long-lived pi session (pi runs `--mode rpc`, which already holds a stdin RPC
  channel; pi RPC has `prompt` / `steer` / `abort` / `get_state` /
  `get_session_stats` / `new_session` / `switch_session` / `fork` / `clone`).
- Tweaks so this session is **not** subject to the per-turn respawn, the
  heartbeat watchdog force-fail, the interactive pause-timeout respawn, or reap's
  `workspace_destroy` while a conversation is open. (See seams in
  `src/runs/watchdog.ts`, `src/runs/reap/`, `agent.pauseTimeoutMs` in
  `src/warren-config/schema.ts`, burrow `[sandbox] timeout_minutes`.)
- **Re-wake / resume**: when I come back to a conversation, re-attach to the
  session rather than replaying full history each turn. **[CORRECTION §10.1]**
  in-sandbox pi sessions live at `<workspace>/.pi/sessions/` (HOME is not
  `~/.pi` inside the sandbox); resume via `--session <id>` / `--session-id` /
  `--continue` or RPC `switch_session`. The durable transcript lives in a warren
  DB table (§10.3), so re-wake never depends on the burrow surviving.

### 3.2 Tools & subagents via pi extensions

- pi does **not** use MCP; custom tools are pi **extensions** (`registerTool` /
  `registerCommand` in `.pi/extensions/*.ts`). **[CORRECTION §10.1]** lifecycle
  hooks are `pi.on(event, handler)` — there is **no** `registerHook`. Extensions
  are TS modules default-exporting `(pi) => {…}`, loaded via jiti (no build step).
- **Net-new plumbing required**: warren currently seeds only `pi_skills` and
  `pi_prompts` into the workspace (`src/runs/seed.ts`) and burrow spawns pi with
  `--no-extensions`. To give Leveret tools we need to (a) seed a
  `pi_extensions`-style section into `.pi/extensions/`, mirroring the existing
  skills/prompts seeding, and (b) **drop `--no-extensions`** on the pi spawn for
  Leveret. **[CORRECTION §10.1]** burrow hard-codes `--no-extensions --offline`
  in `PI_FORCED_ARGV` (`../burrow/src/runtime/pi.ts`), so (b) is a real
  burrow-side change — seeding alone is a no-op until it lands. `--offline` is a
  startup-hang workaround and is orthogonal to tool network access (governed by
  `[sandbox] network`).
- **Exa web search** = a pi extension making an HTTP call. `EXA_API_KEY` rides in
  via burrow's `envPassthrough` (same seam already used for provider keys);
  `network = "open"` is already set on pi-style builtins.
- **Subagents** = a pi extension that delegates a scoped task to a child pi
  session and returns a summary, so scouting/search results don't bloat the main
  context. This is net-new (no Task/subagent pattern exists in warren or pi's
  documented RPC set today). **[CORRECTION §10.1]** pi ships a ready reference,
  `examples/extensions/subagent/` (registers a `subagent` tool, spawns a child
  pi in `--mode json`, single/parallel(≤8, 4 concurrent)/chain modes, caps each
  child's returned output at 50KB), plus an in-process route via the
  `createAgentSession` SDK. Net-new, but with a concrete template.

### 3.3 Conversation is NOT a run

The core fix for today's broken brainstorm: **a conversation turn is not a `runs`
row.** Today every brainstorm message spawns a fresh sandbox + a new
`mode='interactive'` run, with the reply only appearing after the run reaps (no
streaming, lossy on crash, and it pollutes the Runs list with no way to tell a
chat turn from a coding run).

- New lightweight warren DB tables: **`conversations` + `messages`** as the stable
  home for the transcript (instead of scattering it across N run ids).
- **Remove the `mode=interactive` respawn-per-turn path entirely** once Leveret
  lands (it currently backs both brainstorm and the interactive "planner" turns).
- Leveret's session may still be a burrow under the hood (§3.1), but it is modeled
  and surfaced as a **conversation**, never as runs in the Runs list.

## 4. The send-off pipeline

1. I shape intent with Leveret until satisfied (Leveret writes the Plot intent
   live; I can edit directly).
2. **Send off** → hand the finalized Plot/intent to the **planner**.
3. Planner (the existing `src/registry/builtins/planner.ts`, a pi run) turns
   intent into a real `sd plan` via `sd plan prompt` → `sd plan submit` (it emits
   a plan, it does **not** dispatch).
4. The `sd plan` is **auto-dispatched** as a plan-run that walks the plan's
   children one at a time (existing plan-run machinery).
5. **Approval gate**: show me the proposed decomposition (the plan of runs) to
   **approve / edit before dispatch**. The correction step is a first-class taste
   signal. (Longer term this can become an autonomy dial: auto-dispatch low-risk,
   propose-first for bigger/riskier plots.)

### Direct dispatch ("Leveret, fix this bug")

This already has a working precedent — **`bugwatch`**: an agent writes seeds with
`sd create` / `sd plan submit` in the workspace, and warren's reap auto-dispatches
a plan-run when the agent's frontmatter sets `auto_plan_run: true` (+ optional
`auto_plan_run_agent`). The `sd`/`ml`/`cn` CLIs are pre-installed in the sandbox;
no warren API token is injected. Leveret can use the same seam.

## 5. Authoring surface

- Evolve the brainstorm/formalize idea into the Leveret conversation. Leveret
  fills the Plot intent **in real time** as we talk; I correct via chat or direct
  edits.
- The existing `formalize` marker-parsing logic is reusable; repoint it at the new
  conversation store.

## 6. What exists vs net-new

| Capability | Status |
|---|---|
| Define Leveret as a built-in agent | **EXISTS** — add `src/registry/builtins/leveret.ts` `AgentDefinition`, append to `BUILTIN_AGENTS`; `runtime: "pi"`, `system` section, `burrow_config` `network="open"`. |
| pi multi-provider LLM (no warren SDK needed) | **EXISTS** — pi handles all providers; warren forwards `provider`/`model` strings only. |
| Programmatic dispatch / file-a-seed | **EXISTS** — `sd` CLI in-sandbox + `auto_plan_run` frontmatter (`src/runs/reap/auto-plan-run.ts`); `bugwatch` is the precedent. |
| Planner that emits a real `sd plan` | **EXISTS** — `src/registry/builtins/planner.ts` (does not self-dispatch). |
| Plan-run walking a seeds plan, gated on PR merge | **EXISTS** — `src/plan-runs/`, reap auto-dispatch. |
| Keep burrow/pi session alive across a conversation + re-wake to resume | **NET-NEW** — tweak watchdog/reap/pause + burrow sandbox timeout; resume via pi session / conversation record. |
| pi extensions enabled for Leveret (drop `--no-extensions`, seed `.pi/extensions/`) | **NET-NEW** — mirror `pi_skills`/`pi_prompts` seeding in `src/runs/seed.ts`. |
| Exa web-search pi extension (+ `EXA_API_KEY` via burrow `envPassthrough`) | **NET-NEW**. |
| Subagent pi extension (delegate scoped task to child pi session, return summary) | **NET-NEW**. |
| `conversations` + `messages` DB tables (transcript home) | **NET-NEW** (lightweight). |
| Conversation modeled/surfaced as NOT a run; remove `mode=interactive` | **NET-NEW** (remove existing path). |
| Leveret API endpoints for agent-to-agent talk | **NET-NEW**. |
| Plot intent written live + direct edits during conversation | **PARTIAL** — brainstorm/formalize exist but broken/respawn-based; rework. |
| Approval gate before auto-dispatch | **NET-NEW** (small) — surface proposed plan, then dispatch. |

## 7. Key code seams (for the next agent)

- Agent defs / builtins: `src/registry/schema.ts`, `src/registry/builtins/`
  (`pi.ts`, `brainstorm.ts`, `planner.ts`, `bugwatch.ts`, `index.ts`).
- pi seeding into workspace: `src/runs/seed.ts` (`pi_skills`/`pi_prompts` →
  `.pi/skills`/`.pi/prompts`; add `.pi/extensions`).
- Burrow boundary: `src/burrow-client/`, `src/runs/spawn/dispatch.ts`,
  `src/runs/stream/bridge.ts`, `src/runs/steer.ts`; burrow `SPEC.md` §§4/5/12/13/14
  (pi `--mode rpc`, inbox/steer, event kinds), §17 (`[sandbox] timeout_minutes`,
  `[env]`/`[secrets]`).
- Lifetime/GC to tweak for a kept-alive session: `src/runs/watchdog.ts`,
  `src/runs/reap/`, `agent.pauseTimeoutMs` in `src/warren-config/schema.ts`.
- Today's interactive (to replace): `src/runs/interactive.ts`,
  `src/server/handlers/plots/workbench.ts` (`POST /brainstorm`),
  `src/server/handlers/runs/dispatch.ts` (`POST /runs/:id/messages`),
  `src/runs/reap/interactive.ts`, UI `src/ui/src/pages/plot-detail/interactive-panel.tsx`,
  `src/ui/src/components/Chat.tsx`.
- Dispatch-from-agent: `src/runs/reap/auto-plan-run.ts`.
- Plot domain: `src/plots/`, `src/plot-client/`, `src/plot-plan-runs/synthesizer.ts`
  (§11.Q, design-locked Plot→plan-run pipeline — the existing send-off seam).

## 8. Parked / future (out of scope for first cut)

- First-class `plots` DB table; DB authoritative with git as a cold one-way
  export; full ASP Record envelope (ULID + type + subject + actor + parents[]
  DAG + clock + sig). Adopt the Record envelope in a new warren-owned Plot store
  later, still without rewriting the run-events spine.
- Unifying warren's `events` table (run-anchored) and Plot's JSONL log into one
  typed Record spine (runs + plots as projections). Big, separately-gated, and the
  ASP "convergence / conflict-classes" work is explicitly unproven.
- Value loop / "Layer 6": executable `success_criteria` predicates,
  `criterion_evaluated` / `outcome_ratified` events, telemetry auto-fix loop,
  autonomy classifier gated by blast-radius × reversibility × novelty.
- Intent-shapes as a reusable, outcome-weighted memory primitive (likely a new
  `mulch` record type), with a Plot as an instance.
- Cross-project / colony-level Plots ("think a thought at os-eco").

## 9. Open questions for the next session

> Several of these were resolved in the 2026-06-05 grounding pass — see §10.
> Resolutions are tagged inline; what remains open is the residual detail.

1. ~~**Exact kept-alive mechanism**~~ **[RESOLVED → §10.2]**: single long-lived
   run kept alive by a per-runtime "don't close stdin on `agent_end`" tweak;
   finalize on send-off or inactivity timeout; heartbeat watchdog left unarmed.
2. **Subagent extension shape** *(open; template found, §10.1)*: subprocess
   (`--mode json/rpc`) vs in-process (`createAgentSession`); context budget /
   isolation; do subagents ever need the repo (read-only) or just web.
3. ~~**Conversation ↔ Plot cardinality**~~ **[RESOLVED → §10.3]**: **N
   conversations per Plot**; `plot_id` nullable (project-scoped / unattached
   conversations allowed).
4. **Transcript store schema** *(direction set §10.3, columns open)*: exact
   `conversations`/`messages` columns; how/whether to mirror anything into
   `.plot/` at send-off.
5. ~~**Leveret vs planner split**~~ **[RESOLVED → §10.4]**: send-off dispatches
   a **separate planner run** (own burrow, repo reads); Leveret does not fold
   planning in as a subagent.
6. **Approval gate UX** *(direction set §10.4, UX open)*: where the proposed
   plan is shown and edited before dispatch; what the autonomy dial looks like
   later.
7. **API surface for agent-to-agent** *(open)*: endpoints, auth, and what other
   agents are allowed to ask Leveret to do.
8. ~~**Migration/removal plan** for `mode=interactive`~~ **[RESOLVED → §10.5]**:
   rework toward replacement — repoint reusable seams, retire the
   respawn-per-turn loop, preserve the "byte-identical no-Plot path" guarantee.

## 10. Grounding pass — verified findings + locked decisions (2026-06-05)

Scouted warren, `../burrow`, and pi (v0.77.0) directly. This section is
**authoritative** over §1–§7 where they conflict.

### 10.1 Verified facts / corrections

- **pi RPC is newline-delimited JSON (JSONL), not JSON-RPC.** stdin: one
  `{"type":"prompt","message":…}` per line; stdout: one event/response per line.
  All nine methods named in §3.1 exist (`prompt` / `steer` / `abort` /
  `get_state` / `get_session_stats` / `new_session` / `switch_session` / `fork`
  / `clone`) plus ~20 more (`follow_up`, `set_model`, `get_messages`, …).
  `prompt` accepts `streamingBehavior: "steer" | "followUp"` when the agent is
  already streaming.
- **Burrow today drives only the `prompt` command** and treats `agent_end` as
  run-terminal: its pi runtime returns true from `shouldCloseStdinOnEvent` on
  `agent_end`, closing stdin → pi exits → run finalizes
  (`../burrow/src/runtime/pi.ts`, `src/runner/dispatch.ts`). No
  `steer`/`abort`/`new_session`/… are wired burrow-side yet.
- **Burrow hard-codes `--no-extensions --offline` in `PI_FORCED_ARGV`.** Seeding
  `.pi/extensions/` warren-side is a no-op until burrow drops `--no-extensions`
  for the Leveret runtime. `--offline` is a startup-hang workaround (burrow-029d)
  and is orthogonal to tool network access (governed by `[sandbox] network`).
- **pi extension hooks are `pi.on(event, handler)` — there is NO `registerHook`.**
  `registerTool` / `registerCommand` confirmed, plus `registerShortcut` /
  `registerFlag` / `registerProvider` / `registerMessageRenderer`, `pi.exec`,
  `pi.appendEntry` (persistent state), `pi.events` (ext↔ext bus). Extensions are
  TS modules default-exporting `(pi) => {…}`, loaded via jiti (no build step).
- **No native subagent primitive in pi** (single-session by design) — but pi
  ships a ready reference `examples/extensions/subagent/` (registers a `subagent`
  tool, spawns a child pi in `--mode json`, single / parallel(≤8, 4 concurrent) /
  chain, caps child output at 50KB) and an in-process SDK route
  (`createAgentSession`). The §6 subagent line is net-new but has a template.
- **In-sandbox pi session dir is `<workspace>/.pi/sessions/`, not
  `~/.pi/agent/sessions/`** — HOME isn't `~/.pi` inside the sandbox. Sessions are
  JSONL trees (entry `id` + `parentId`); resume via `--session <id>` /
  `--session-id` / `--continue` or RPC `switch_session`. Workspace +
  `.pi/sessions/` persist until `burrow destroy`.
- **`EXA_API_KEY` rides via burrow `envPassthrough`** (process env, never argv);
  `network = "open"` is already set on pi builtins. Add the key to the burrow
  `PI_*_ENV_PASSTHROUGH` set (or the project `burrow.toml [env]`) and to warren's
  `composeRunEnv` (`src/runs/spawn/dispatch.ts`).
- **Reapers:** the heartbeat watchdog is opt-in (`WARREN_RUN_HEARTBEAT_TIMEOUT_MS`,
  leave unarmed for Leveret); `workspace_destroy` and the pause detector already
  exempt `mode:"interactive"`; the fallback workspace GC reclaims a burrow ~1h
  (`WARREN_WORKSPACE_GC_TTL`) after its anchoring run goes terminal — so a
  conversation burrow is safe only while its run is non-terminal.
- **`events` table is run-anchored and single-writer (the stream bridge)** — a
  conversation that is not a run cannot live there, so new tables are required
  (§10.3).
- **`[sandbox] timeout_minutes` is parsed but NOT enforced** by burrow's
  LocalProvider (no wall-clock kill). Don't rely on it for conversation lifetime.

### 10.2 Locked decision — session lifetime (resolves §9.1)

**One long-lived run per Leveret conversation, kept alive by suppressing the
terminal signal — NOT a burrow overhaul.**

- Leveret runs as a single burrow run in pi `--mode rpc`. The minimal, reusable
  burrow change: make the "close stdin on `agent_end`" behaviour configurable
  per-runtime so a **conversational** runtime keeps stdin open and the run stays
  `running` across turns. Subsequent user turns are delivered over the **existing
  mid-run steering / inbox loop** (already writes to the open child stdin). This
  is the seam we deliberately want to generalize for future conversational agents.
- The run finalizes (end signal → stdin closes → pi exits → normal reap) on
  exactly two triggers: **(A) send-off** (operator hands the Plot to the
  planner), or **(B) an inactivity timeout** (e.g. ~20 min since the last user
  message; new conversation-scoped config knob, mirroring the
  `agent.pauseTimeoutMs` pattern).
- **Transcript must survive timeout / crash** → persist messages in a new DB
  table (§10.3), independent of the burrow. Re-wake after a timeout = a new run
  resuming the on-disk pi session (`--session <id>` / `switch_session`) if the
  workspace still exists, else replay from the DB transcript. Do not depend on
  the burrow surviving.
- Leave the heartbeat watchdog unarmed (or exempt conversation runs); the
  inactivity timeout is the intended lifetime control.

### 10.3 Locked decision — conversation data model (resolves §9.3, partial §9.4)

- New lightweight tables `conversations` + `messages` (bun:sqlite + drizzle;
  mirror in `src/db/schema/postgres.ts` or the drift test fails; generate via
  `bun run db:generate`).
- **Cardinality: N conversations per Plot.** `conversations.plot_id` is nullable
  (project-scoped / unattached conversations allowed) — a Plot can host many
  Leveret sessions. `messages` FK → conversation.
- The conversation is modeled / surfaced as **NOT a run** — it never appears in
  the Runs list, even though one burrow run anchors it under the hood.
- *Open:* exact columns; whether/what to mirror into `.plot/` at send-off (§9.4).

### 10.4 Locked decision — send-off (resolves §9.5, partial §9.6)

- **Send-off dispatches a SEPARATE planner run** (the existing `planner`
  builtin, its own burrow run — it benefits from repo reads). Leveret hands over
  the finalized Plot intent; it does **not** fold planning into the conversation
  as a subagent.
- **Approval gate before dispatch:** the planner emits an `sd plan` (it does not
  self-dispatch); warren surfaces the proposed decomposition for operator
  **approve / edit**, then the plan-run dispatches. The correction step is the
  first-class taste signal (the autonomy dial is later — §8).
- *Open:* approval-gate UX placement (§9.6).

### 10.5 Locked decision — mode=interactive migration (resolves §9.8)

- The conversation turn-model is fundamentally different from today's
  respawn-per-turn (one persistent run vs a fresh run per message), so **rework
  toward replacement**: keep and repoint the reusable seams (the formalize
  marker-parser §5, the mid-run steering channel), and retire the
  respawn-per-turn turn loop (`spawnInteractiveTurn`, the `POST /runs/:id/messages`
  interactive path, `reap/interactive.ts`). A full tear-out is acceptable if
  cleaner. **Preserve the "byte-identical no-Plot path" acceptance guarantee
  throughout.**

### 10.6 Net-new work, restated against grounded facts

1. **Burrow:** per-runtime "conversational" mode (don't close stdin on
   `agent_end`; close on explicit end signal or idle timeout); drop
   `--no-extensions` for that runtime; optionally add `EXA_API_KEY` to the pi
   env-passthrough set.
2. **Warren — seeding:** add a `pi_extensions` agent section + `.pi/extensions/`
   drop in `src/runs/seed.ts` (mirror `pi_skills`/`pi_prompts`).
3. **Warren — agent:** `src/registry/builtins/leveret.ts` (`runtime:"pi"`,
   `system` section, `burrow_config` `network="open"`, `pi_extensions` section),
   appended to `BUILTIN_AGENTS`.
4. **Warren — extensions:** Exa web-search extension; subagent extension (from
   the pi reference); thread `EXA_API_KEY` through `composeRunEnv`.
5. **Warren — store:** `conversations` + `messages` tables/repos; conversation
   surfaced as not-a-run.
6. **Warren — lifetime:** conversation inactivity-timeout knob; ensure
   watchdog/GC/pause don't kill an open conversation run.
7. **Warren — API/UI:** conversation endpoints (incl. agent-to-agent, §9.7);
   send-off → planner-run + approval-gate flow; repoint the formalize
   marker-parser at the conversation store; retire the `mode=interactive` loop.
