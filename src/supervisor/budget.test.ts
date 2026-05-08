import { describe, expect, test } from "bun:test";
import { backoffMs, RestartBudget } from "./budget.ts";

describe("RestartBudget", () => {
	test("admits up to maxRestarts within the window", () => {
		const budget = new RestartBudget(5, 60_000);
		expect(budget.tryRecord(0)).toBe(true);
		expect(budget.tryRecord(1_000)).toBe(true);
		expect(budget.tryRecord(2_000)).toBe(true);
		expect(budget.tryRecord(3_000)).toBe(true);
		expect(budget.tryRecord(4_000)).toBe(true);
		expect(budget.tryRecord(5_000)).toBe(false);
		expect(budget.recentCount(5_000)).toBe(5);
	});

	test("expires entries that fall outside the sliding window", () => {
		const budget = new RestartBudget(2, 60_000);
		expect(budget.tryRecord(0)).toBe(true);
		expect(budget.tryRecord(30_000)).toBe(true);
		expect(budget.tryRecord(40_000)).toBe(false);
		// Move past the first entry's expiry — budget reopens.
		expect(budget.tryRecord(60_001)).toBe(true);
		expect(budget.recentCount(60_001)).toBe(2);
	});

	test("cutoff is exclusive: an entry at exactly now - windowMs is dropped", () => {
		const budget = new RestartBudget(1, 1_000);
		expect(budget.tryRecord(0)).toBe(true);
		// At now=1000, cutoff = 0; entry at 0 is at the boundary and gets pruned.
		expect(budget.tryRecord(1_000)).toBe(true);
	});

	test("constructor rejects non-positive inputs", () => {
		expect(() => new RestartBudget(0, 1_000)).toThrow();
		expect(() => new RestartBudget(5, 0)).toThrow();
		expect(() => new RestartBudget(-1, 1_000)).toThrow();
	});
});

describe("backoffMs", () => {
	test("doubles each attempt with default base=1s, cap=16s", () => {
		expect(backoffMs(1)).toBe(1_000);
		expect(backoffMs(2)).toBe(2_000);
		expect(backoffMs(3)).toBe(4_000);
		expect(backoffMs(4)).toBe(8_000);
		expect(backoffMs(5)).toBe(16_000);
		expect(backoffMs(6)).toBe(16_000);
	});

	test("returns 0 for non-positive attempt numbers", () => {
		expect(backoffMs(0)).toBe(0);
		expect(backoffMs(-1)).toBe(0);
	});

	test("respects custom base and cap", () => {
		expect(backoffMs(1, 250, 1_000)).toBe(250);
		expect(backoffMs(2, 250, 1_000)).toBe(500);
		expect(backoffMs(3, 250, 1_000)).toBe(1_000);
		expect(backoffMs(10, 250, 1_000)).toBe(1_000);
	});
});
