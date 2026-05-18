/**
 * Cross-tier inheritance composer (warren-44a3 follow-up to R-03 / pl-fef5).
 *
 * R-03 shipped per-project `.canopy/` as a third agent tier (project >
 * library > built-in). Canopy resolves inheritance *within* a single tier
 * — `cn render <name>` walks parents/mixins in its own cwd's prompts.jsonl
 * — but a project-tier role that names a library or built-in parent under
 * `extends:` makes canopy bail with `Prompt "X" not found` because the
 * parent lives in a different `.canopy/` (or, for built-ins, not on disk
 * at all). This composer fills that gap on warren's side.
 *
 * Algorithm mirrors canopy's `resolvePrompt` (see canopy/src/render.ts):
 *
 *   1. Resolve `extends` chain (parent first).
 *   2. Apply each mixin left-to-right on top of the base.
 *   3. Apply the focal prompt's own sections last; later overrides earlier
 *      on section-name conflict; empty body removes the section.
 *   4. Frontmatter merges parent → mixins → focal (later overrides).
 *   5. `resolvedFrom` collects every visited prompt in resolution order.
 *
 * The parent resolver is injected so the same composer drives both
 * production (project tier via `cn show`, global tier via agents-repo
 * lookup) and tests (deterministic in-memory maps).
 *
 * Cycle and depth-limit failures throw `AgentSchemaError` so the refresh
 * caller surfaces them as a per-agent skip rather than aborting the batch.
 * Depth defaults to canopy's `MAX_INHERIT_DEPTH` (5) to stay symmetric
 * with `cn render` once the chain stays in-tier.
 */

import type { RawAgentPrompt } from "./canopy.ts";
import { AgentSchemaError } from "./errors.ts";
import type { AgentDefinition } from "./schema.ts";

/** Matches canopy/src/types.ts `MAX_INHERIT_DEPTH`. */
export const MAX_INHERIT_DEPTH = 5;

/**
 * Per-parent resolution outcome. `"project"` returns the raw, un-resolved
 * prompt so the composer can recurse (a project-tier parent may itself
 * extend a library role, walking past name shadows per the seed's open
 * question). `"global"` returns an already-resolved `AgentDefinition` —
 * the library/built-in row's `renderedJson` is canopy's full output.
 */
export type ParentResolution =
	| { readonly kind: "project"; readonly raw: RawAgentPrompt }
	| { readonly kind: "global"; readonly definition: AgentDefinition };

/**
 * Resolver hook: given a parent name and the current resolution chain
 * (focal first, deepest-pending last), return how to materialize that
 * parent. The chain lets the resolver implement the seed's "walk past
 * name shadows" rule — when a parent name already appears in `visited`,
 * resolving it at the project tier again would loop, so the production
 * resolver skips the project tier for that name and falls through to
 * the global tier (library/built-in).
 */
export type ResolveParent = (
	name: string,
	visited: readonly string[],
) => Promise<ParentResolution | null>;

export interface ComposeOptions {
	readonly raw: RawAgentPrompt;
	readonly resolve: ResolveParent;
	/** Override the inheritance depth limit (default: `MAX_INHERIT_DEPTH`). */
	readonly maxDepth?: number;
}

interface Section {
	name: string;
	body: string;
}

/**
 * Compose a project-tier prompt against cross-tier parents. The focal
 * prompt's own `frontmatter` is preserved last (so the project tier
 * always wins on top-level fields like `provider`/`model`); source
 * stamping is the caller's job (`stampAgentSource` after this returns).
 */
export async function composeAgent(opts: ComposeOptions): Promise<AgentDefinition> {
	return composeInner(opts.raw, opts.resolve, [], opts.maxDepth ?? MAX_INHERIT_DEPTH);
}

async function composeInner(
	raw: RawAgentPrompt,
	resolve: ResolveParent,
	visited: readonly string[],
	maxDepth: number,
): Promise<AgentDefinition> {
	if (visited.includes(raw.name)) {
		throw new AgentSchemaError(`circular inheritance: ${[...visited, raw.name].join(" → ")}`);
	}
	if (visited.length >= maxDepth) {
		throw new AgentSchemaError(
			`inheritance depth limit (${maxDepth}) exceeded at "${raw.name}". Chain: ${visited.join(" → ")}`,
		);
	}
	const nextVisited = [...visited, raw.name];

	let baseSections: Section[] = [];
	let baseFrontmatter: Record<string, unknown> = {};
	let baseResolvedFrom: string[] = [];

	if (raw.extends !== undefined) {
		const parent = await resolveOrThrow(raw.extends, resolve, raw.name, nextVisited);
		const parentDef = await materialize(parent, resolve, nextVisited, maxDepth);
		baseSections = sectionsFromDefinition(parentDef);
		baseFrontmatter = { ...parentDef.frontmatter };
		baseResolvedFrom = [...parentDef.resolvedFrom];
	}

	for (const mixinName of raw.mixins) {
		const mixin = await resolveOrThrow(mixinName, resolve, raw.name, nextVisited);
		// Each mixin resolves on its own visited branch so the same ancestor
		// can appear via extends AND a mixin (diamond) without tripping the
		// cycle check. The focal prompt is still in the branch, so a mixin
		// that points back at the focal still throws.
		const mixinDef = await materialize(mixin, resolve, nextVisited, maxDepth);
		baseSections = mergeSections(baseSections, sectionsFromDefinition(mixinDef));
		baseFrontmatter = { ...baseFrontmatter, ...mixinDef.frontmatter };
		baseResolvedFrom = [...baseResolvedFrom, ...mixinDef.resolvedFrom];
	}

	const focalSections = raw.sections.map((s) => ({ name: s.name, body: s.body }));
	const mergedSections = mergeSections(baseSections, focalSections);
	const sectionsMap: Record<string, string> = {};
	for (const section of mergedSections) {
		sectionsMap[section.name] = section.body;
	}

	return {
		name: raw.name,
		version: raw.version,
		sections: sectionsMap,
		resolvedFrom: [...baseResolvedFrom, raw.name],
		frontmatter: { ...baseFrontmatter, ...raw.frontmatter },
	};
}

async function resolveOrThrow(
	name: string,
	resolve: ResolveParent,
	focalName: string,
	visited: readonly string[],
): Promise<ParentResolution> {
	const parent = await resolve(name, visited);
	if (parent === null) {
		throw new AgentSchemaError(`parent prompt "${name}" not found while resolving "${focalName}"`, {
			recoveryHint:
				"verify the parent exists in this project's .canopy/, the canopy library, or as a built-in",
		});
	}
	return parent;
}

async function materialize(
	parent: ParentResolution,
	resolve: ResolveParent,
	visited: readonly string[],
	maxDepth: number,
): Promise<AgentDefinition> {
	if (parent.kind === "global") return parent.definition;
	return composeInner(parent.raw, resolve, visited, maxDepth);
}

function sectionsFromDefinition(def: AgentDefinition): Section[] {
	return Object.entries(def.sections).map(([name, body]) => ({ name, body }));
}

function mergeSections(parent: readonly Section[], child: readonly Section[]): Section[] {
	const result: Section[] = parent.map((s) => ({ ...s }));
	for (const c of child) {
		const idx = result.findIndex((s) => s.name === c.name);
		if (c.body === "") {
			if (idx !== -1) result.splice(idx, 1);
			continue;
		}
		if (idx !== -1) result[idx] = { ...c };
		else result.push({ ...c });
	}
	return result;
}

/**
 * Heuristic for "does this raw prompt need cross-tier composition?".
 * True when the prompt declares any `extends` or `mixins` reference — we
 * can't tell from the raw prompt alone whether the parent is in-tier
 * (canopy could resolve it) or cross-tier (canopy bails), so the refresh
 * path uses this to opt into compose for any prompt with inheritance and
 * lets the resolver itself walk project → global. Same-tier parents are
 * picked up by the resolver's project-tier path; cross-tier names fall
 * through to global.
 */
export function rawPromptHasParents(raw: Pick<RawAgentPrompt, "extends" | "mixins">): boolean {
	return raw.extends !== undefined || raw.mixins.length > 0;
}
