import { describe, expect, test } from "bun:test";
import { AgentSchemaError } from "./errors.ts";
import { parseRenderedAgent, RenderResponseSchema } from "./schema.ts";

const VALID = {
	success: true,
	command: "render",
	name: "refactor-bot",
	version: 3,
	sections: [
		{ name: "system", body: "You are a refactor agent." },
		{ name: "skills", body: "- run-tests\n- open-pr" },
		{ name: "expertise_seed", body: '{"type":"convention","domain":"refactor","content":"..."}' },
	],
	resolvedFrom: ["base-coding-agent", "refactor-bot"],
	frontmatter: { owner: "platform" },
};

describe("RenderResponseSchema", () => {
	test("accepts the canonical wire shape", () => {
		const parsed = RenderResponseSchema.safeParse(VALID);
		expect(parsed.success).toBe(true);
	});

	test("rejects success: false envelopes (caller handles those)", () => {
		const parsed = RenderResponseSchema.safeParse({
			success: false,
			command: "render",
			error: "Prompt not found",
		});
		expect(parsed.success).toBe(false);
	});

	test("requires version to be a positive integer", () => {
		const parsed = RenderResponseSchema.safeParse({ ...VALID, version: 0 });
		expect(parsed.success).toBe(false);
	});
});

describe("parseRenderedAgent", () => {
	test("collapses sections into a name → body map", () => {
		const def = parseRenderedAgent(VALID);
		expect(def.name).toBe("refactor-bot");
		expect(def.version).toBe(3);
		expect(def.sections.system).toBe("You are a refactor agent.");
		expect(def.sections.skills).toBe("- run-tests\n- open-pr");
		expect(def.resolvedFrom).toEqual(["base-coding-agent", "refactor-bot"]);
		expect(def.frontmatter).toEqual({ owner: "platform" });
	});

	test("defaults resolvedFrom and frontmatter when canopy omits them", () => {
		const def = parseRenderedAgent({
			success: true,
			command: "render",
			name: "minimal",
			version: 1,
			sections: [{ name: "system", body: "hi" }],
		});
		expect(def.resolvedFrom).toEqual([]);
		expect(def.frontmatter).toEqual({});
	});

	test("rejects prompts missing the system section", () => {
		const raw = {
			...VALID,
			sections: [
				{ name: "skills", body: "..." },
				{ name: "workflow", body: "..." },
			],
		};
		expect(() => parseRenderedAgent(raw)).toThrow(AgentSchemaError);
	});

	test("rejects duplicate section names from a corrupt render", () => {
		const raw = {
			...VALID,
			sections: [
				{ name: "system", body: "first" },
				{ name: "system", body: "second" },
			],
		};
		expect(() => parseRenderedAgent(raw)).toThrow(/duplicate section "system"/);
	});

	test("includes the agent name in schema-failure messages when provided", () => {
		expect(() => parseRenderedAgent({ success: true }, "broken-bot")).toThrow(/broken-bot/);
	});

	test("rejects malformed envelopes", () => {
		expect(() => parseRenderedAgent({ success: false })).toThrow(AgentSchemaError);
		expect(() => parseRenderedAgent(null)).toThrow(AgentSchemaError);
		expect(() => parseRenderedAgent("not an object")).toThrow(AgentSchemaError);
	});
});
