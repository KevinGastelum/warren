import { describe, expect, test } from "bun:test";
import { parseWarrenServerFileConfig } from "./schema.ts";

describe("parseWarrenServerFileConfig", () => {
	test("undefined → empty config", () => {
		const result = parseWarrenServerFileConfig(undefined);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual({});
	});

	test("null → empty config (defensive: TOML rarely produces null at root)", () => {
		const result = parseWarrenServerFileConfig(null);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual({});
	});

	test("empty object → empty config", () => {
		const result = parseWarrenServerFileConfig({});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual({});
	});

	test("unknown top-level key → not ok (strict schema rejects passthrough)", () => {
		const result = parseWarrenServerFileConfig({ banana: 1 });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toMatch(/banana/);
	});

	test("non-object root → not ok", () => {
		const result = parseWarrenServerFileConfig("not an object");
		expect(result.ok).toBe(false);
	});

	test("accepts a [[workers]] array of entries with name + url", () => {
		const result = parseWarrenServerFileConfig({
			workers: [
				{ name: "alpha", url: "http://alpha:9410" },
				{ name: "beta", url: "unix:///var/run/burrow-beta.sock" },
			],
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.workers).toEqual([
				{ name: "alpha", url: "http://alpha:9410" },
				{ name: "beta", url: "unix:///var/run/burrow-beta.sock" },
			]);
		}
	});

	test("accepts an empty workers array (same as omitted)", () => {
		const result = parseWarrenServerFileConfig({ workers: [] });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.workers).toEqual([]);
	});

	test("worker entry missing name → not ok", () => {
		const result = parseWarrenServerFileConfig({
			workers: [{ url: "http://alpha:9410" }],
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toMatch(/name/);
	});

	test("worker entry missing url → not ok", () => {
		const result = parseWarrenServerFileConfig({
			workers: [{ name: "alpha" }],
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toMatch(/url/);
	});

	test("worker entry with empty name → not ok (min(1))", () => {
		const result = parseWarrenServerFileConfig({
			workers: [{ name: "", url: "http://alpha:9410" }],
		});
		expect(result.ok).toBe(false);
	});

	test("worker entry with extra field → not ok (strict at row level)", () => {
		const result = parseWarrenServerFileConfig({
			workers: [{ name: "alpha", url: "http://alpha:9410", extra: 1 }],
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toMatch(/extra/);
	});
});
