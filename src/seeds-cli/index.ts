/**
 * Public re-exports for the seeds CLI facade. Consumers import from
 * here so the file layout under `seeds-cli/` can shift without
 * rippling out to call sites (mirrors src/warren-config/ + src/runs/).
 *
 * Today the facade owns:
 *   - the seeds `sd list` / `sd update --extensions` envelope schema
 *   - `listScheduledSeeds` + `clearScheduledFor` operations used by the
 *     R-06 cron tick
 *
 * R-01 step 2 adds `updateExtensions` plus a typed warren-namespaced
 * extensions schema; both will export from here.
 */

export { SeedsCliError } from "./errors.ts";
export {
	clearScheduledFor,
	listScheduledSeeds,
	type SeedsCliDeps,
} from "./extensions.ts";
export {
	type ParseScheduledSeedsResult,
	parseScheduledSeeds,
	type ScheduledSeed,
	type SeedRow,
	type SeedsListEnvelope,
	SeedsListEnvelopeSchema,
} from "./schema.ts";
