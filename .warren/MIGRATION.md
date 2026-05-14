# `.warren/` migration guide (warren-5840)

Warren's per-project `.warren/` layout moved from one mostly-JSON file to one
YAML file per concern. Existing installs keep working unchanged — the loader
falls back to `.warren/defaults.json` and surfaces a deprecation warning in
`warren doctor` / `/readyz` — so you can migrate at leisure.

This doc shows the before/after for the three things that changed and tells
you how to convert in place.

## Layout — before and after

```
Before (R-02, pre-warren-5840)         After (warren-5840 canonical)
.warren/                                .warren/
  triggers.yaml                           triggers.yaml          (unchanged)
  defaults.json   ← global defaults +     config.yaml            ← global defaults (YAML)
                    optional preview      preview.yaml           ← hoisted preview block
  pr-template.md                          pr-template.md         (unchanged)
```

YAML across the board so reviewers can comment-annotate the file as new knobs
land. One file per concern so a small `preview:` change doesn't show up as a
diff next to an unrelated `defaultModel` bump.

## One-shot conversion

For each project, run the migrate command in the project repo root (or pass
`--project <id>` to target a registered project's clone):

```bash
warren config migrate --cwd /path/to/project
```

The command:

1. Reads `.warren/defaults.json`.
2. Splits any `preview` block into `.warren/preview.yaml`.
3. Writes the remaining fields to `.warren/config.yaml`.
4. Deletes `.warren/defaults.json` so the deprecation warning stops firing on
   the next `POST /projects/:id/refresh`.

It refuses to clobber an existing `config.yaml` or `preview.yaml` — resolve
those first (delete or merge by hand) and re-run. A malformed `defaults.json`
aborts the migrate with the schema error; fix the JSON by hand and retry.

Commit the resulting `.warren/config.yaml` + `.warren/preview.yaml` (and the
`.warren/defaults.json` deletion) the same way you'd commit any other repo
change. Warren refreshes the project on its next pull and the deprecation
warning goes away.

## Field-by-field equivalence

### Global defaults

`.warren/defaults.json` → `.warren/config.yaml`. Same schema; only the
serialization format changes.

Before:

```json
{
  "defaultRole": "claude-code",
  "defaultBranch": "main",
  "defaultPrompt": "Read the issue, plan, execute.",
  "defaultProvider": "anthropic",
  "defaultModel": "claude-opus-4-7",
  "runBranchPrefix": "warren"
}
```

After:

```yaml
defaultRole: claude-code
defaultBranch: main
defaultPrompt: Read the issue, plan, execute.
defaultProvider: anthropic
defaultModel: claude-opus-4-7
runBranchPrefix: warren
```

### Preview block

Before (nested under `preview:` in `defaults.json`):

```json
{
  "preview": {
    "type": "server",
    "command": "bun run dev",
    "port": 3000,
    "readiness_path": "/healthz",
    "idle_ttl": "30m",
    "max_lifetime": "8h"
  }
}
```

After (`preview.yaml` — top-level document is the preview block itself):

```yaml
type: server
command: bun run dev
port: 3000
readiness_path: /healthz
idle_ttl: 30m
max_lifetime: 8h
```

The block is still accepted nested under `preview:` in `config.yaml` (and in
legacy `defaults.json`) for smooth migration. When both exist, `preview.yaml`
wins.

## Loader precedence

```
defaults: config.yaml > defaults.json (deprecation warning)
preview : preview.yaml > defaults.preview (from whichever source above)
```

A malformed file in either tier surfaces in the per-file `errors[]` envelope
(rendered by `GET /projects/:id/warren-config`, `warren doctor`, and the
project UI). A legacy `defaults.json` adds a `warnings[]` entry with code
`warren_config_deprecated` — non-fatal, visible in the new
`warren_config_deprecations` diagnostic check.

## When can I stop carrying `defaults.json`?

As soon as `warren config migrate` succeeds you can delete it. The loader
treats absent legacy files as success — your project goes back to a clean
`warren_config_deprecations` row in `warren doctor` / `/readyz`.
