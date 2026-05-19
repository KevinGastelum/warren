/**
 * Public re-exports for the plot→plan-run synthesis module (warren-99b2
 * / pl-f404 step 3 / SPEC §11.Q).
 */

export { NoDispatchableSeedsError, SdPlanSynthesisError } from "./errors.ts";
export {
	buildSynthesizedPlanJson,
	type CreateDefaultPlanSynthesizerInput,
	createDefaultPlanSynthesizer,
	type PlanSynthesizer,
	type SynthesizePlanInput,
	type SynthesizePlanResult,
} from "./synthesizer.ts";
