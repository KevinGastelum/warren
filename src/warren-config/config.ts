/**
 * Static layout constants for the per-project `.warren/` directory (R-02).
 *
 * Unlike `src/projects/config.ts` and `src/registry/config.ts`, this module
 * has no env vars to resolve — `.warren/` lives at a fixed path inside each
 * project clone. The constants live here so file naming can shift in one
 * place without rippling through schema/loader/HTTP/UI.
 *
 * Layout (warren-5840 reorg, one file per concern):
 *   triggers.yaml    YAML — array of trigger entries (cron today; webhooks future)
 *   config.yaml      YAML — global per-project defaults (the canonical home)
 *   preview.yaml     YAML — preview environment block (hoisted from defaults)
 *   pr-template.md   MD   — per-fragment PR-body overrides (warren-bd49)
 *   defaults.json    JSON — legacy global defaults; loader falls back here with
 *                           a deprecation warning. `warren config migrate`
 *                           converts to the YAML layout.
 *
 * The original pl-5d74 choice for JSON-shaped `defaults.json` (`mx-2cefdd`)
 * is superseded by warren-5840: YAML is the canonical format because the file
 * grows fast as preview/MCP/etc. blocks accumulate and JSON's no-comments
 * limitation makes review painful. Existing `defaults.json` installs keep
 * working until they migrate.
 */

export const WARREN_CONFIG_DIR = ".warren";

export const WARREN_CONFIG_FILES = {
	triggers: "triggers.yaml",
	config: "config.yaml",
	preview: "preview.yaml",
	prTemplate: "pr-template.md",
	/** @deprecated since warren-5840 — use `config.yaml` (+ `preview.yaml`). */
	defaults: "defaults.json",
} as const;

export type WarrenConfigFileKey = keyof typeof WARREN_CONFIG_FILES;

/** Project-relative path for a known config file (e.g. `.warren/triggers.yaml`). */
export function warrenConfigRelativePath(key: WarrenConfigFileKey): string {
	return `${WARREN_CONFIG_DIR}/${WARREN_CONFIG_FILES[key]}`;
}
