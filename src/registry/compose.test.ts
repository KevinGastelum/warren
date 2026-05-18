import { describe, expect, test } from "bun:test";
import type { RawAgentPrompt } from "./canopy.ts";
import { composeAgent, MAX_INHERIT_DEPTH, type ParentResolution } from "./compose.ts";
import { AgentSchemaError } from "./errors.ts";
import type { AgentDefinition } from "./schema.ts";

function raw(input: Partial<RawAgentPrompt> & { name: string }): RawAgentPrompt {
	return {
		version: 1,
		sections: [],
		extends: undefined,
		mixins: [],
		frontmatter: {},
		...input,
	};
}

function globalDef(input: Partial<AgentDefinition> & { name: string }): AgentDefinition {
	return {
		version: 1,
		sections: {},
		resolvedFrom: [input.name],
		frontmatter: {},
		...input,
	};
}

function makeResolver(
	entries: Record<string, ParentResolution>,
): (name: string, visited: readonly string[]) => Promise<ParentResolution | null> {
	return async (name: string) => entries[name] ?? null;
}

describe("composeAgent", () => {
	test("no inheritance — composes the focal prompt's own sections + frontmatter", async () => {
		const focal = raw({
			name: "leaf",
			sections: [
				{ name: "system", body: "leaf-system" },
				{ name: "skills", body: "leaf-skills" },
			],
			frontmatter: { provider: "anthropic" },
		});
		const def = await composeAgent({ raw: focal, resolve: makeResolver({}) });
		expect(def.name).toBe("leaf");
		expect(def.sections).toEqual({ system: "leaf-system", skills: "leaf-skills" });
		expect(def.frontmatter).toEqual({ provider: "anthropic" });
		expect(def.resolvedFrom).toEqual(["leaf"]);
	});

	test("project role extending a global (built-in) parent merges sections with child override", async () => {
		const builtinParent = globalDef({
			name: "claude-code",
			sections: { system: "builtin-system", workflow: "builtin-workflow" },
			frontmatter: { source: "builtin", provider: "anthropic" },
		});
		const focal = raw({
			name: "refactor-bot",
			extends: "claude-code",
			sections: [
				// Override `system`, add a new `expertise_seed`, keep parent's `workflow`.
				{ name: "system", body: "refactor-system" },
				{ name: "expertise_seed", body: "refactor-seed" },
			],
			frontmatter: { model: "claude-sonnet-4-6" },
		});
		const def = await composeAgent({
			raw: focal,
			resolve: makeResolver({ "claude-code": { kind: "global", definition: builtinParent } }),
		});
		expect(def.sections).toEqual({
			system: "refactor-system",
			workflow: "builtin-workflow",
			expertise_seed: "refactor-seed",
		});
		// Parent frontmatter merged in first; focal wins on conflicts.
		expect(def.frontmatter).toEqual({
			source: "builtin",
			provider: "anthropic",
			model: "claude-sonnet-4-6",
		});
		expect(def.resolvedFrom).toEqual(["claude-code", "refactor-bot"]);
	});

	test("empty body in the child removes a section inherited from the parent", async () => {
		const parent = globalDef({
			name: "base",
			sections: { system: "base-system", verbose: "base-verbose" },
		});
		const focal = raw({
			name: "trimmed",
			extends: "base",
			sections: [{ name: "verbose", body: "" }],
		});
		const def = await composeAgent({
			raw: focal,
			resolve: makeResolver({ base: { kind: "global", definition: parent } }),
		});
		expect(def.sections).toEqual({ system: "base-system" });
	});

	test("mixins apply left-to-right between parent and focal — later overrides earlier", async () => {
		const parent = globalDef({
			name: "p",
			sections: { system: "p-system", common: "p-common" },
		});
		const mixinA = globalDef({
			name: "ma",
			sections: { system: "ma-system", a: "ma-a" },
		});
		const mixinB = globalDef({
			name: "mb",
			sections: { a: "mb-a", b: "mb-b" },
		});
		const focal = raw({
			name: "f",
			extends: "p",
			mixins: ["ma", "mb"],
			sections: [{ name: "system", body: "f-system" }],
		});
		const def = await composeAgent({
			raw: focal,
			resolve: makeResolver({
				p: { kind: "global", definition: parent },
				ma: { kind: "global", definition: mixinA },
				mb: { kind: "global", definition: mixinB },
			}),
		});
		expect(def.sections).toEqual({
			system: "f-system", // focal wins
			common: "p-common",
			a: "mb-a", // mixin B overrides mixin A
			b: "mb-b",
		});
		expect(def.resolvedFrom).toEqual(["p", "ma", "mb", "f"]);
	});

	test("project-tier parent recurses through cn show before bottoming out at a global parent (name shadow walk-past)", async () => {
		// The seed's open question: a project role extends `claude-code`, and
		// another project role *named* `claude-code` exists. The parent
		// resolution must walk past the project-tier shadow when called from
		// the focal's resolver, so we model that by having the resolver
		// return the project-tier shadow on the FIRST lookup and the
		// built-in on the SECOND (the project shadow itself re-extends the
		// real built-in).
		const builtin = globalDef({
			name: "claude-code",
			sections: { system: "builtin", workflow: "wf" },
			frontmatter: { source: "builtin" },
		});
		const projectShadow = raw({
			name: "claude-code",
			extends: "claude-code", // walks past via the resolver — see below
			sections: [{ name: "workflow", body: "project-workflow" }],
		});
		const focal = raw({
			name: "tuned",
			extends: "claude-code",
			sections: [{ name: "system", body: "tuned-system" }],
		});
		// The resolver's job mirrors what refresh.ts does: first call returns
		// the project shadow; the shadow's own `extends: "claude-code"` then
		// has to bottom out at the built-in. We approximate the walk-past by
		// keeping a counter.
		// Resolver implements the walk-past rule: if "claude-code" already
		// appears in the visited chain, skip the project tier and return
		// the global built-in instead.
		const resolve = async (
			name: string,
			visited: readonly string[],
		): Promise<ParentResolution | null> => {
			if (name !== "claude-code") return null;
			if (visited.includes("claude-code")) return { kind: "global", definition: builtin };
			return { kind: "project", raw: projectShadow };
		};
		const def = await composeAgent({ raw: focal, resolve });
		// builtin → projectShadow → tuned: system from focal, workflow from shadow.
		expect(def.sections).toEqual({ system: "tuned-system", workflow: "project-workflow" });
		expect(def.resolvedFrom).toEqual(["claude-code", "claude-code", "tuned"]);
	});

	test("missing parent throws AgentSchemaError with the focal name in the message", async () => {
		const focal = raw({ name: "orphan", extends: "missing-parent" });
		expect(composeAgent({ raw: focal, resolve: makeResolver({}) })).rejects.toMatchObject({
			code: "agent_schema_error",
			message: expect.stringContaining("missing-parent"),
		});
	});

	test("self-referential extends throws a circular-inheritance AgentSchemaError", async () => {
		const focal = raw({ name: "loop", extends: "loop" });
		// Resolver that returns the SAME prompt regardless of visited — i.e.
		// a resolver that does NOT walk past. The composer's cycle check
		// must still trip.
		const resolve = async (name: string): Promise<ParentResolution | null> =>
			name === "loop" ? { kind: "project", raw: focal } : null;
		expect(composeAgent({ raw: focal, resolve })).rejects.toMatchObject({
			code: "agent_schema_error",
			message: expect.stringContaining("Circular inheritance".toLowerCase()),
		});
	});

	test("depth limit throws AgentSchemaError after MAX_INHERIT_DEPTH hops", async () => {
		// Build a project-tier chain longer than MAX_INHERIT_DEPTH.
		const chain: Record<string, RawAgentPrompt> = {};
		for (let i = 0; i <= MAX_INHERIT_DEPTH + 1; i++) {
			chain[`level-${i}`] = raw({
				name: `level-${i}`,
				extends: i < MAX_INHERIT_DEPTH + 1 ? `level-${i + 1}` : undefined,
				sections: [{ name: "system", body: `s${i}` }],
			});
		}
		const resolve = async (name: string): Promise<ParentResolution | null> => {
			const r = chain[name];
			return r === undefined ? null : { kind: "project", raw: r };
		};
		const top = chain["level-0"];
		if (top === undefined) throw new Error("test setup");
		expect(composeAgent({ raw: top, resolve })).rejects.toMatchObject({
			code: "agent_schema_error",
			message: expect.stringContaining("depth limit"),
		});
	});

	test("focal frontmatter overrides parent frontmatter on conflicting keys", async () => {
		const parent = globalDef({
			name: "p",
			sections: { system: "p" },
			frontmatter: { provider: "anthropic", model: "claude-sonnet" },
		});
		const focal = raw({
			name: "f",
			extends: "p",
			frontmatter: { model: "claude-opus" },
		});
		const def = await composeAgent({
			raw: focal,
			resolve: makeResolver({ p: { kind: "global", definition: parent } }),
		});
		expect(def.frontmatter).toEqual({ provider: "anthropic", model: "claude-opus" });
	});

	test("does not throw on a missing system section — caller validates separately", async () => {
		// Composer is content-agnostic; section presence checks live in
		// validateAgentDefinition so the refresh path can attribute the
		// schema error to the focal name rather than to compose itself.
		const focal = raw({ name: "no-system", sections: [{ name: "skills", body: "x" }] });
		const def = await composeAgent({ raw: focal, resolve: makeResolver({}) });
		expect(Object.hasOwn(def.sections, "system")).toBe(false);
	});

	test("returns AgentSchemaError instances on cycles (real instanceof, not a structural fake)", async () => {
		const focal = raw({ name: "a", extends: "b" });
		const b = raw({ name: "b", extends: "a" });
		// Resolver that does NOT walk past — both names always resolve to
		// project-tier prompts. The composer's visited tracking is what
		// catches the cycle.
		const resolve = async (name: string): Promise<ParentResolution | null> => {
			if (name === "a") return { kind: "project", raw: focal };
			if (name === "b") return { kind: "project", raw: b };
			return null;
		};
		await expect(composeAgent({ raw: focal, resolve })).rejects.toBeInstanceOf(AgentSchemaError);
	});
});
