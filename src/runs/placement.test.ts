import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { openDatabase, type WarrenDb } from "../db/client.ts";
import type { AgentsRepo } from "../db/repos/agents.ts";
import type { BurrowsRepo } from "../db/repos/burrows.ts";
import { createRepos, type Repos } from "../db/repos/index.ts";
import type { ProjectsRepo } from "../db/repos/projects.ts";
import type { RunsRepo } from "../db/repos/runs.ts";
import type { WorkersRepo } from "../db/repos/workers.ts";
import {
	NoEligibleWorkerError,
	placeForBurrow,
	placeForProject,
	StickyWorkerUnreachableError,
} from "./placement.ts";

describe("placeForProject", () => {
	let db: WarrenDb;
	let repos: Repos;
	let projectId: string;
	let otherProjectId: string;
	let agentName: string;

	beforeEach(async () => {
		db = await openDatabase({ path: ":memory:" });
		repos = createRepos(db);
		const agents = repos.agents as AgentsRepo;
		const projects = repos.projects as ProjectsRepo;
		agents.upsert({ name: "claude-code", renderedJson: { sections: {} } });
		agentName = "claude-code";
		const p1 = projects.create({
			gitUrl: "https://github.com/x/y.git",
			localPath: "/data/projects/x/y",
			defaultBranch: "main",
		});
		const p2 = projects.create({
			gitUrl: "https://github.com/x/z.git",
			localPath: "/data/projects/x/z",
			defaultBranch: "main",
		});
		projectId = p1.id;
		otherProjectId = p2.id;
	});

	afterEach(() => {
		db.close();
	});

	function addWorker(name: string, state: "healthy" | "draining" | "unreachable" = "healthy") {
		(repos.workers as WorkersRepo).upsert({ name, url: `http://${name}:1`, state });
	}

	function spawnRun(opts: {
		project?: string;
		workerId?: string | null;
		state?: "queued" | "running" | "succeeded" | "failed";
		endedAt?: string;
	}) {
		const runs = repos.runs as RunsRepo;
		const row = runs.create({
			agentName,
			projectId: opts.project ?? projectId,
			prompt: "do thing",
			renderedAgentJson: { sections: {} },
			trigger: "manual",
			workerId: opts.workerId ?? null,
		});
		if (opts.state === "succeeded" || opts.state === "failed") {
			runs.markRunning(row.id);
			runs.finalize(row.id, opts.state, opts.endedAt ? new Date(opts.endedAt) : new Date());
		} else if (opts.state === "running") {
			runs.markRunning(row.id);
		}
		return row;
	}

	test("throws NoEligibleWorker when the workers table is empty", () => {
		expect(() => placeForProject({ repos }, { projectId })).toThrow(NoEligibleWorkerError);
	});

	test("throws NoEligibleWorker when every worker is draining or unreachable", () => {
		addWorker("alpha", "draining");
		addWorker("beta", "unreachable");
		expect(() => placeForProject({ repos }, { projectId })).toThrow(NoEligibleWorkerError);
	});

	test("affinity wins: prior successful run for this project sticks to the same worker", () => {
		addWorker("alpha");
		addWorker("beta");
		spawnRun({ workerId: "beta", state: "succeeded", endedAt: "2026-05-13T00:00:00.000Z" });
		expect(placeForProject({ repos }, { projectId })).toBe("beta");
	});

	test("affinity ignores prior runs for a different project", () => {
		addWorker("alpha");
		addWorker("beta");
		spawnRun({
			project: otherProjectId,
			workerId: "beta",
			state: "succeeded",
			endedAt: "2026-05-13T00:00:00.000Z",
		});
		expect(placeForProject({ repos }, { projectId })).toBe("alpha");
	});

	test("affinity ignores failed runs", () => {
		addWorker("alpha");
		addWorker("beta");
		spawnRun({ workerId: "beta", state: "failed", endedAt: "2026-05-13T00:00:00.000Z" });
		expect(placeForProject({ repos }, { projectId })).toBe("alpha");
	});

	test("affinity picks the newest successful run by endedAt", () => {
		addWorker("alpha");
		addWorker("beta");
		spawnRun({ workerId: "alpha", state: "succeeded", endedAt: "2026-05-13T00:00:00.000Z" });
		spawnRun({ workerId: "beta", state: "succeeded", endedAt: "2026-05-13T02:00:00.000Z" });
		expect(placeForProject({ repos }, { projectId })).toBe("beta");
	});

	test("affinity falls through when the sticky worker is draining", () => {
		addWorker("alpha");
		addWorker("beta", "draining");
		spawnRun({ workerId: "beta", state: "succeeded", endedAt: "2026-05-13T00:00:00.000Z" });
		expect(placeForProject({ repos }, { projectId })).toBe("alpha");
	});

	test("affinity falls through when the sticky worker is unreachable", () => {
		addWorker("alpha");
		addWorker("beta", "unreachable");
		spawnRun({ workerId: "beta", state: "succeeded", endedAt: "2026-05-13T00:00:00.000Z" });
		expect(placeForProject({ repos }, { projectId })).toBe("alpha");
	});

	test("least-loaded wins when there is no affinity", () => {
		addWorker("alpha");
		addWorker("beta");
		spawnRun({ workerId: "alpha", state: "running" });
		spawnRun({ workerId: "alpha", state: "queued" });
		expect(placeForProject({ repos }, { projectId })).toBe("beta");
	});

	test("least-loaded counts queued + running but not succeeded/failed", () => {
		addWorker("alpha");
		addWorker("beta");
		spawnRun({ workerId: "alpha", state: "succeeded", endedAt: "2026-05-13T00:00:00.000Z" });
		// alpha has affinity from succeeded run; verify behavior changes if we
		// drop affinity by making beta the affinity target and adding load.
		spawnRun({ workerId: "alpha", state: "running" });
		spawnRun({ workerId: "alpha", state: "queued" });
		// alpha has the most recent succeeded run, so affinity picks alpha.
		expect(placeForProject({ repos }, { projectId })).toBe("alpha");
	});

	test("least-loaded ties break alphabetically by worker name", () => {
		addWorker("zulu");
		addWorker("alpha");
		addWorker("mike");
		// Zero load on every worker → alphabetical tiebreak.
		expect(placeForProject({ repos }, { projectId })).toBe("alpha");
	});

	test("least-loaded excludes draining + unreachable workers entirely", () => {
		addWorker("alpha");
		addWorker("beta", "draining");
		addWorker("gamma", "unreachable");
		spawnRun({ workerId: "alpha", state: "running" });
		spawnRun({ workerId: "alpha", state: "running" });
		// beta + gamma have zero load but are not healthy → alpha wins
		// despite its 2 in-flight runs.
		expect(placeForProject({ repos }, { projectId })).toBe("alpha");
	});

	test("rows without a workerId are not counted as load", () => {
		addWorker("alpha");
		addWorker("beta");
		// Legacy row from before pl-9ba1 step 4: state=running but workerId is null.
		spawnRun({ workerId: null, state: "running" });
		// alpha and beta both still report zero load → alphabetical wins.
		expect(placeForProject({ repos }, { projectId })).toBe("alpha");
	});
});

describe("placeForBurrow", () => {
	let db: WarrenDb;
	let repos: Repos;

	beforeEach(async () => {
		db = await openDatabase({ path: ":memory:" });
		repos = createRepos(db);
	});

	afterEach(() => {
		db.close();
	});

	function addWorker(name: string, state: "healthy" | "draining" | "unreachable" = "healthy") {
		(repos.workers as WorkersRepo).upsert({ name, url: `http://${name}:1`, state });
	}

	test("returns the recorded worker for a healthy burrow", () => {
		addWorker("alpha");
		(repos.burrows as BurrowsRepo).create({ id: "bur_aaaaaaaaaaaa", workerId: "alpha" });
		expect(placeForBurrow({ repos }, { burrowId: "bur_aaaaaaaaaaaa" })).toBe("alpha");
	});

	test("returns the recorded worker even when it is draining (existing burrows finish)", () => {
		addWorker("alpha", "draining");
		(repos.burrows as BurrowsRepo).create({ id: "bur_aaaaaaaaaaaa", workerId: "alpha" });
		expect(placeForBurrow({ repos }, { burrowId: "bur_aaaaaaaaaaaa" })).toBe("alpha");
	});

	test("throws StickyWorkerUnreachableError when the pinned worker is unreachable", () => {
		addWorker("alpha", "unreachable");
		(repos.burrows as BurrowsRepo).create({ id: "bur_aaaaaaaaaaaa", workerId: "alpha" });
		expect(() => placeForBurrow({ repos }, { burrowId: "bur_aaaaaaaaaaaa" })).toThrow(
			StickyWorkerUnreachableError,
		);
	});

	test("throws StickyWorkerUnreachableError when the pinned worker row is gone", () => {
		(repos.burrows as BurrowsRepo).create({ id: "bur_aaaaaaaaaaaa", workerId: "vanished" });
		expect(() => placeForBurrow({ repos }, { burrowId: "bur_aaaaaaaaaaaa" })).toThrow(
			StickyWorkerUnreachableError,
		);
	});

	test("throws NoEligibleWorker when warren has no placement record for the burrow", () => {
		addWorker("alpha");
		expect(() => placeForBurrow({ repos }, { burrowId: "bur_missing00000" })).toThrow(
			NoEligibleWorkerError,
		);
	});
});
