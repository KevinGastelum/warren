/**
 * Convenience surface that wires every repo against a single drizzle handle.
 * Higher layers grab one Repos and pass it through.
 */

import type { WarrenDb } from "../client.ts";
import { AgentsRepo } from "./agents.ts";
import { BurrowsRepo } from "./burrows.ts";
import { DrizzleAdapter } from "./drizzle-adapter.ts";
import { EventsRepo } from "./events.ts";
import { ProjectsRepo } from "./projects.ts";
import { RunsRepo } from "./runs.ts";
import { TriggersRepo } from "./triggers.ts";
import { WorkersRepo } from "./workers.ts";

export interface Repos {
	agents: AgentsRepo;
	projects: ProjectsRepo;
	runs: RunsRepo;
	events: EventsRepo;
	triggers: TriggersRepo;
	workers: WorkersRepo;
	burrows: BurrowsRepo;
}

export function createRepos(db: WarrenDb): Repos {
	// pl-f1be migration: every repo is on the dialect-polymorphic adapter as
	// of step 5. Step 7 widens this factory's input from WarrenDb (sqlite) to
	// AnyWarrenDb so the pg branch boots.
	const adapter = DrizzleAdapter.for(db);
	return {
		agents: new AgentsRepo(adapter),
		projects: new ProjectsRepo(adapter),
		runs: new RunsRepo(adapter),
		events: new EventsRepo(adapter),
		triggers: new TriggersRepo(adapter),
		workers: new WorkersRepo(adapter),
		burrows: new BurrowsRepo(adapter),
	};
}

export { AgentsRepo, BurrowsRepo, EventsRepo, ProjectsRepo, RunsRepo, TriggersRepo, WorkersRepo };
