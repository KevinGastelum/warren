import { describe, expect, test } from "bun:test";
import type { SpawnFn, SpawnResult } from "./canopy.ts";
import { cloneOrUpdateCanopyRepo } from "./clone.ts";
import type { CanopyRegistryConfig } from "./config.ts";
import { CanopyUnavailableError } from "./errors.ts";

const CFG: CanopyRegistryConfig = {
	repoUrl: "https://example.com/agents.git",
	localDir: "/tmp/canopy-clone",
	cnBinary: "cn",
	gitBinary: "git",
};

interface Recorded {
	cmd: readonly string[];
	cwd: string;
}

function recorder(handler: (cmd: readonly string[]) => SpawnResult): {
	spawn: SpawnFn;
	calls: Recorded[];
} {
	const calls: Recorded[] = [];
	const spawn: SpawnFn = async (cmd, opts) => {
		calls.push({ cmd, cwd: opts.cwd });
		return handler(cmd);
	};
	return { spawn, calls };
}

function ok(stdout = ""): SpawnResult {
	return { stdout, stderr: "", exitCode: 0 };
}

describe("cloneOrUpdateCanopyRepo", () => {
	test("issues `git clone` when the local dir does not exist yet", async () => {
		const { spawn, calls } = recorder(() => ok());
		const result = await cloneOrUpdateCanopyRepo({
			config: CFG,
			spawn,
			exists: () => false,
		});
		expect(result.cloned).toBe(true);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.cmd).toEqual([
			"git",
			"clone",
			"https://example.com/agents.git",
			"/tmp/canopy-clone",
		]);
	});

	test("uses fetch + reset --hard origin/<branch> when the local dir exists", async () => {
		const { spawn, calls } = recorder((cmd) => {
			if (cmd[1] === "symbolic-ref") {
				return ok("refs/remotes/origin/main\n");
			}
			return ok();
		});
		const result = await cloneOrUpdateCanopyRepo({
			config: CFG,
			spawn,
			exists: () => true,
		});
		expect(result.cloned).toBe(false);
		expect(calls.map((c) => c.cmd[1])).toEqual(["fetch", "symbolic-ref", "reset"]);
		expect(calls[0]?.cwd).toBe("/tmp/canopy-clone");
		// The reset call must target origin/<branch>
		expect(calls[2]?.cmd).toEqual(["git", "reset", "--hard", "origin/main"]);
	});

	test("respects an explicit defaultBranch override (skips symbolic-ref)", async () => {
		const { spawn, calls } = recorder(() => ok());
		await cloneOrUpdateCanopyRepo({
			config: CFG,
			spawn,
			exists: () => true,
			defaultBranch: "trunk",
		});
		expect(calls.map((c) => c.cmd[1])).toEqual(["fetch", "reset"]);
		expect(calls[1]?.cmd).toEqual(["git", "reset", "--hard", "origin/trunk"]);
	});

	test("falls back to `remote set-head --auto` when symbolic-ref fails initially", async () => {
		let symbolicRefCalls = 0;
		const { spawn, calls } = recorder((cmd) => {
			if (cmd[1] === "symbolic-ref") {
				symbolicRefCalls += 1;
				return symbolicRefCalls === 1
					? { stdout: "", stderr: "no HEAD", exitCode: 1 }
					: ok("refs/remotes/origin/develop\n");
			}
			return ok();
		});
		await cloneOrUpdateCanopyRepo({ config: CFG, spawn, exists: () => true });
		expect(symbolicRefCalls).toBe(2);
		expect(calls.some((c) => c.cmd.includes("set-head"))).toBe(true);
		expect(calls[calls.length - 1]?.cmd).toEqual(["git", "reset", "--hard", "origin/develop"]);
	});

	test("throws CanopyUnavailableError when git clone fails", async () => {
		const { spawn } = recorder(() => ({
			stdout: "",
			stderr: "fatal: repository not found",
			exitCode: 128,
		}));
		await expect(
			cloneOrUpdateCanopyRepo({ config: CFG, spawn, exists: () => false }),
		).rejects.toBeInstanceOf(CanopyUnavailableError);
	});

	test("throws CanopyUnavailableError when default-branch detection fails", async () => {
		const { spawn } = recorder((cmd) => {
			if (cmd[1] === "symbolic-ref" || cmd.includes("set-head")) {
				return { stdout: "", stderr: "no remote HEAD", exitCode: 128 };
			}
			return ok();
		});
		await expect(
			cloneOrUpdateCanopyRepo({ config: CFG, spawn, exists: () => true }),
		).rejects.toBeInstanceOf(CanopyUnavailableError);
	});
});
