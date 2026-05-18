/**
 * Convenience surface that wires every repo against a single drizzle handle.
 * Higher layers grab one Repos and pass it through.
 */

import type { AnyWarrenDb } from "../client.ts";
import { AgentsRepo } from "./agents.ts";
import { BurrowsRepo } from "./burrows.ts";
import { DrizzleAdapter } from "./drizzle-adapter.ts";
import { EventsRepo } from "./events.ts";
import { PlanRunsRepo } from "./plan-runs.ts";
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
	planRuns: PlanRunsRepo;
}

export function createRepos(db: AnyWarrenDb): Repos {
	const adapter = DrizzleAdapter.for(db);
	return {
		agents: new AgentsRepo(adapter),
		projects: new ProjectsRepo(adapter),
		runs: new RunsRepo(adapter),
		events: new EventsRepo(adapter),
		triggers: new TriggersRepo(adapter),
		workers: new WorkersRepo(adapter),
		burrows: new BurrowsRepo(adapter),
		planRuns: new PlanRunsRepo(adapter),
	};
}

export {
	AgentsRepo,
	BurrowsRepo,
	EventsRepo,
	PlanRunsRepo,
	ProjectsRepo,
	RunsRepo,
	TriggersRepo,
	WorkersRepo,
};
