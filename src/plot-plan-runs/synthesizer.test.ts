/**
 * Unit tests for the plot-plan-run synthesizer
 * (warren-99b2 / pl-f404 step 3 / SPEC §11.Q).
 *
 * Stubs the `seedsCli.spawn` seam so we don't shell out to a real `sd`
 * binary. The synthesizer's contract is two shell-outs in a known
 * order — `sd create --json` first, then `sd plan submit --json` — so
 * the tests intercept by command shape and return canned JSON payloads.
 */

import { describe, expect, test } from "bun:test";
import type { SpawnOptions, SpawnResult } from "../projects/clone.ts";
import { SdPlanSynthesisError } from "./errors.ts";
import { buildSynthesizedPlanJson, createDefaultPlanSynthesizer } from "./synthesizer.ts";

interface RecordedCall {
	cmd: readonly string[];
	opts: SpawnOptions;
}

function stubSpawn(
	calls: RecordedCall[],
	responder: (cmd: readonly string[]) => SpawnResult,
): (cmd: readonly string[], opts: SpawnOptions) => Promise<SpawnResult> {
	return async (cmd, opts) => {
		calls.push({ cmd, opts });
		return responder(cmd);
	};
}

function happyResponder(parentSeedId: string, planId: string) {
	return (cmd: readonly string[]): SpawnResult => {
		if (cmd[1] === "create") {
			return {
				stdout: JSON.stringify({ success: true, command: "create", id: parentSeedId }),
				stderr: "",
				exitCode: 0,
			};
		}
		if (cmd[1] === "plan" && cmd[2] === "submit") {
			return {
				stdout: JSON.stringify({
					success: true,
					command: "plan submit",
					plan_id: planId,
					children: ["warren-a", "warren-b", "warren-c"],
					parent_seed: parentSeedId,
					revision: 1,
				}),
				stderr: "",
				exitCode: 0,
			};
		}
		return { stdout: "", stderr: `no stub for ${cmd.join(" ")}`, exitCode: 1 };
	};
}

describe("buildSynthesizedPlanJson", () => {
	test("uses feature template + emits one adoption step per candidate", () => {
		const raw = buildSynthesizedPlanJson({
			plotId: "plot-deadbeef",
			candidateSeedIds: ["warren-a", "warren-b", "warren-c"],
		});
		const parsed = JSON.parse(raw) as {
			template: string;
			name: string;
			sections: {
				context: string;
				approach: string;
				steps: { existing_seed: string; title?: string }[];
				acceptance: string[];
			};
		};
		expect(parsed.template).toBe("feature");
		expect(parsed.name).toContain("plot-deadbeef");
		// Feature template requires context.min_length: 50.
		expect(parsed.sections.context.length).toBeGreaterThanOrEqual(50);
		expect(parsed.sections.approach.length).toBeGreaterThan(0);
		// Adoption-only — no `title` field, just `existing_seed`.
		expect(parsed.sections.steps).toEqual([
			{ existing_seed: "warren-a" },
			{ existing_seed: "warren-b" },
			{ existing_seed: "warren-c" },
		]);
		expect(parsed.sections.acceptance.length).toBeGreaterThanOrEqual(1);
	});
});

describe("createDefaultPlanSynthesizer", () => {
	test("happy path: shells out to sd create + sd plan submit and returns the plan id", async () => {
		const calls: RecordedCall[] = [];
		const synthesizer = createDefaultPlanSynthesizer({
			seedsCli: {
				sdBinary: "sd",
				spawn: stubSpawn(calls, happyResponder("wa-1234", "pl-syn1")),
			},
		});

		const result = await synthesizer.synthesize({
			projectPath: "/tmp/syn-project",
			plotId: "plot-deadbeef",
			candidateSeedIds: ["warren-a", "warren-b", "warren-c"],
		});

		expect(result.parentSeedId).toBe("wa-1234");
		expect(result.planId).toBe("pl-syn1");
		expect(result.children).toEqual(["warren-a", "warren-b", "warren-c"]);

		// Two shell-outs in order: create first, plan submit second.
		expect(calls).toHaveLength(2);
		const createCall = calls[0];
		const submitCall = calls[1];
		if (!createCall || !submitCall) throw new Error("expected two recorded calls");

		expect(createCall.cmd[0]).toBe("sd");
		expect(createCall.cmd[1]).toBe("create");
		expect(createCall.cmd).toContain("--json");
		const titleIdx = createCall.cmd.indexOf("--title");
		expect(titleIdx).toBeGreaterThanOrEqual(0);
		expect(createCall.cmd[titleIdx + 1]).toContain("plot-deadbeef");
		expect(createCall.opts.cwd).toBe("/tmp/syn-project");

		expect(submitCall.cmd[1]).toBe("plan");
		expect(submitCall.cmd[2]).toBe("submit");
		expect(submitCall.cmd[3]).toBe("wa-1234");
		expect(submitCall.cmd).toContain("--json");
		expect(submitCall.cmd).toContain("--plan");
		// Plan file is a real path under tmpdir — exact value differs across
		// runs, just assert the flag is followed by a non-empty string.
		const planIdx = submitCall.cmd.indexOf("--plan");
		expect(typeof submitCall.cmd[planIdx + 1]).toBe("string");
		expect((submitCall.cmd[planIdx + 1] as string).length).toBeGreaterThan(0);
	});

	test("rejects empty candidate list with SdPlanSynthesisError", async () => {
		const synthesizer = createDefaultPlanSynthesizer({
			seedsCli: {
				sdBinary: "sd",
				spawn: stubSpawn([], () => ({ stdout: "", stderr: "", exitCode: 0 })),
			},
		});

		await expect(
			synthesizer.synthesize({
				projectPath: "/tmp/x",
				plotId: "plot-x",
				candidateSeedIds: [],
			}),
		).rejects.toBeInstanceOf(SdPlanSynthesisError);
	});

	test("surfaces sd create non-zero exit as SdPlanSynthesisError", async () => {
		const calls: RecordedCall[] = [];
		const synthesizer = createDefaultPlanSynthesizer({
			seedsCli: {
				sdBinary: "sd",
				spawn: stubSpawn(calls, (cmd) => {
					if (cmd[1] === "create") {
						return { stdout: "", stderr: "sd: locked", exitCode: 1 };
					}
					return { stdout: "", stderr: "", exitCode: 0 };
				}),
			},
		});

		await expect(
			synthesizer.synthesize({
				projectPath: "/tmp/x",
				plotId: "plot-x",
				candidateSeedIds: ["warren-a"],
			}),
		).rejects.toBeInstanceOf(SdPlanSynthesisError);
		// `plan submit` should not have been called once create failed.
		expect(calls.map((c) => c.cmd[1])).toEqual(["create"]);
	});

	test("surfaces sd plan submit non-zero exit as SdPlanSynthesisError", async () => {
		const synthesizer = createDefaultPlanSynthesizer({
			seedsCli: {
				sdBinary: "sd",
				spawn: stubSpawn([], (cmd) => {
					if (cmd[1] === "create") {
						return {
							stdout: JSON.stringify({ success: true, command: "create", id: "wa-1" }),
							stderr: "",
							exitCode: 0,
						};
					}
					return { stdout: "", stderr: "plan validation failed", exitCode: 1 };
				}),
			},
		});

		await expect(
			synthesizer.synthesize({
				projectPath: "/tmp/x",
				plotId: "plot-x",
				candidateSeedIds: ["warren-a", "warren-b"],
			}),
		).rejects.toBeInstanceOf(SdPlanSynthesisError);
	});

	test("surfaces missing 'id' in sd create response as SdPlanSynthesisError", async () => {
		const synthesizer = createDefaultPlanSynthesizer({
			seedsCli: {
				sdBinary: "sd",
				spawn: stubSpawn([], (cmd) => {
					if (cmd[1] === "create") {
						return {
							stdout: JSON.stringify({ success: true, command: "create" }),
							stderr: "",
							exitCode: 0,
						};
					}
					return { stdout: "", stderr: "", exitCode: 0 };
				}),
			},
		});

		await expect(
			synthesizer.synthesize({
				projectPath: "/tmp/x",
				plotId: "plot-x",
				candidateSeedIds: ["warren-a"],
			}),
		).rejects.toBeInstanceOf(SdPlanSynthesisError);
	});

	test("surfaces non-JSON sd create stdout as SdPlanSynthesisError", async () => {
		const synthesizer = createDefaultPlanSynthesizer({
			seedsCli: {
				sdBinary: "sd",
				spawn: stubSpawn([], (cmd) => {
					if (cmd[1] === "create") {
						return { stdout: "Created wa-1234", stderr: "", exitCode: 0 };
					}
					return { stdout: "", stderr: "", exitCode: 0 };
				}),
			},
		});

		await expect(
			synthesizer.synthesize({
				projectPath: "/tmp/x",
				plotId: "plot-x",
				candidateSeedIds: ["warren-a"],
			}),
		).rejects.toBeInstanceOf(SdPlanSynthesisError);
	});

	test("surfaces missing plan_id in sd plan submit response as SdPlanSynthesisError", async () => {
		const synthesizer = createDefaultPlanSynthesizer({
			seedsCli: {
				sdBinary: "sd",
				spawn: stubSpawn([], (cmd) => {
					if (cmd[1] === "create") {
						return {
							stdout: JSON.stringify({ success: true, command: "create", id: "wa-1" }),
							stderr: "",
							exitCode: 0,
						};
					}
					return {
						stdout: JSON.stringify({ success: true, command: "plan submit" }),
						stderr: "",
						exitCode: 0,
					};
				}),
			},
		});

		await expect(
			synthesizer.synthesize({
				projectPath: "/tmp/x",
				plotId: "plot-x",
				candidateSeedIds: ["warren-a"],
			}),
		).rejects.toBeInstanceOf(SdPlanSynthesisError);
	});
});
