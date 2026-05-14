/**
 * Public re-exports for the warren server TOML config module
 * (pl-9ba1 step 7 / warren-3909). Internal callers import from here so
 * file layout under `server-config/` can shift without rippling out.
 */

export {
	type EnvLike,
	resolveWarrenConfigFilePath,
	WARREN_CONFIG_FILE_ENV,
} from "./config.ts";
export { ValidationError } from "./errors.ts";
export {
	type ExistsFn,
	type LoadedWarrenServerConfig,
	type LoadWarrenServerConfigInput,
	loadWarrenServerConfigFromFile,
	type ReadFileFn,
} from "./load.ts";
export {
	type ParseResult,
	parseWarrenServerFileConfig,
	type WarrenServerFileConfig,
	WarrenServerFileConfigSchema,
	type WorkerEntry,
	WorkerEntrySchema,
} from "./schema.ts";
export {
	type ParsedWorkerEntry,
	type ParseUrlResult,
	parseWorkerUrl,
	requireSharedBurrowToken,
	SHARED_BURROW_TOKEN_HINT,
	UNIX_URL_PREFIX,
	type ValidateWorkersResult,
	validateWorkerEntries,
	WARREN_BURROW_TOKEN_ENV,
} from "./workers.ts";
