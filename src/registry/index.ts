/**
 * Public re-exports for the canopy agent registry. Internal modules
 * import from here so the file layout under `registry/` can shift
 * without rippling out to call sites.
 */

export {
	type AgentSummary,
	CanopyClient,
	type CanopyClientOptions,
	DEFAULT_CANOPY_TIMEOUT_MS,
	type SpawnFn,
	type SpawnOptions,
	type SpawnResult,
} from "./canopy.ts";
export {
	type CloneOptions,
	type CloneResult,
	cloneOrUpdateCanopyRepo,
	DEFAULT_GIT_TIMEOUT_MS,
} from "./clone.ts";
export {
	type CanopyRegistryConfig,
	DEFAULT_CANOPY_DIR,
	type EnvLike,
	loadCanopyRegistryConfigFromEnv,
} from "./config.ts";
export { AgentSchemaError, CanopyUnavailableError } from "./errors.ts";
export {
	type RefreshOptions,
	type RefreshResult,
	type RefreshSkipped,
	refreshAgentRegistry,
} from "./refresh.ts";
export {
	type AgentDefinition,
	parseRenderedAgent,
	REQUIRED_AGENT_SECTIONS,
	type RenderResponse,
	RenderResponseSchema,
	type RequiredAgentSection,
} from "./schema.ts";
