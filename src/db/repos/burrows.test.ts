import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { NotFoundError } from "../../core/errors.ts";
import { openDatabase, type WarrenDb } from "../client.ts";
import { BurrowsRepo } from "./burrows.ts";

describe("BurrowsRepo", () => {
	let db: WarrenDb;
	let repo: BurrowsRepo;

	beforeEach(async () => {
		db = await openDatabase({ path: ":memory:" });
		repo = new BurrowsRepo(db.drizzle);
	});

	afterEach(() => {
		db.close();
	});

	test("create stamps addedAt and stores the worker_id", () => {
		const row = repo.create({
			id: "bur_aaaaaaaaaaaa",
			workerId: "alpha",
			now: new Date("2026-05-13T00:00:00.000Z"),
		});
		expect(row.id).toBe("bur_aaaaaaaaaaaa");
		expect(row.workerId).toBe("alpha");
		expect(row.addedAt).toBe("2026-05-13T00:00:00.000Z");
	});

	test("get returns null for an unknown burrow", () => {
		expect(repo.get("bur_missing00000")).toBeNull();
	});

	test("require throws NotFoundError for an unknown burrow", () => {
		expect(() => repo.require("bur_missing00000")).toThrow(NotFoundError);
	});

	test("listByWorker filters rows to one worker", () => {
		repo.create({
			id: "bur_aaaaaaaaaaaa",
			workerId: "alpha",
			now: new Date("2026-05-13T00:00:00.000Z"),
		});
		repo.create({
			id: "bur_bbbbbbbbbbbb",
			workerId: "beta",
			now: new Date("2026-05-13T00:00:01.000Z"),
		});
		repo.create({
			id: "bur_cccccccccccc",
			workerId: "alpha",
			now: new Date("2026-05-13T00:00:02.000Z"),
		});
		const alphas = repo.listByWorker("alpha").map((b) => b.id);
		expect(alphas).toEqual(["bur_aaaaaaaaaaaa", "bur_cccccccccccc"]);
		const betas = repo.listByWorker("beta").map((b) => b.id);
		expect(betas).toEqual(["bur_bbbbbbbbbbbb"]);
	});

	test("listAll orders by addedAt then id", () => {
		repo.create({
			id: "bur_bbbbbbbbbbbb",
			workerId: "alpha",
			now: new Date("2026-05-13T00:00:00.000Z"),
		});
		repo.create({
			id: "bur_aaaaaaaaaaaa",
			workerId: "alpha",
			now: new Date("2026-05-13T00:00:00.000Z"),
		});
		repo.create({
			id: "bur_cccccccccccc",
			workerId: "beta",
			now: new Date("2026-05-13T00:00:01.000Z"),
		});
		expect(repo.listAll().map((b) => b.id)).toEqual([
			"bur_aaaaaaaaaaaa",
			"bur_bbbbbbbbbbbb",
			"bur_cccccccccccc",
		]);
	});

	test("delete removes the row", () => {
		repo.create({ id: "bur_aaaaaaaaaaaa", workerId: "alpha" });
		repo.delete("bur_aaaaaaaaaaaa");
		expect(repo.get("bur_aaaaaaaaaaaa")).toBeNull();
	});

	test("create with a duplicate id throws (id is the PK; no upsert)", () => {
		repo.create({ id: "bur_aaaaaaaaaaaa", workerId: "alpha" });
		expect(() => repo.create({ id: "bur_aaaaaaaaaaaa", workerId: "beta" })).toThrow();
	});
});
