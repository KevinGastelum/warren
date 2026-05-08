import { describe, expect, test } from "bun:test";
import { CanopyClient, type SpawnFn, type SpawnResult } from "./canopy.ts";
import type { CanopyRegistryConfig } from "./config.ts";
import { CanopyUnavailableError } from "./errors.ts";

const CFG: CanopyRegistryConfig = {
	repoUrl: "https://example.com/agents.git",
	localDir: "/tmp/canopy",
	cnBinary: "cn",
	gitBinary: "git",
};

function makeSpawn(
	handler: (cmd: readonly string[], cwd: string) => SpawnResult | Promise<SpawnResult>,
): { spawn: SpawnFn; calls: { cmd: readonly string[]; cwd: string }[] } {
	const calls: { cmd: readonly string[]; cwd: string }[] = [];
	const spawn: SpawnFn = async (cmd, opts) => {
		calls.push({ cmd, cwd: opts.cwd });
		return await handler(cmd, opts.cwd);
	};
	return { spawn, calls };
}

function ok(stdout: string): SpawnResult {
	return { stdout, stderr: "", exitCode: 0 };
}

function fail(stderr: string, exitCode = 1, stdout = ""): SpawnResult {
	return { stdout, stderr, exitCode };
}

describe("CanopyClient.listAgents", () => {
	test("invokes `cn list --tag agent --json` with the canopy dir as cwd", async () => {
		const list = {
			success: true,
			command: "list",
			prompts: [
				{ name: "refactor-bot", version: 2, status: "active", tags: ["agent"] },
				{ name: "docs-bot", version: 1, status: "active", tags: ["agent"] },
			],
		};
		const { spawn, calls } = makeSpawn(() => ok(JSON.stringify(list)));
		const client = new CanopyClient({ config: CFG, spawn });

		const agents = await client.listAgents();
		expect(agents).toHaveLength(2);
		expect(agents[0]?.name).toBe("refactor-bot");
		expect(calls).toHaveLength(1);
		expect(calls[0]?.cmd).toEqual(["cn", "list", "--tag", "agent", "--json"]);
		expect(calls[0]?.cwd).toBe("/tmp/canopy");
	});

	test("filters out non-active prompts (draft, archived)", async () => {
		const list = {
			success: true,
			command: "list",
			prompts: [
				{ name: "active-bot", version: 1, status: "active" },
				{ name: "draft-bot", version: 1, status: "draft" },
				{ name: "old-bot", version: 1, status: "archived" },
			],
		};
		const { spawn } = makeSpawn(() => ok(JSON.stringify(list)));
		const client = new CanopyClient({ config: CFG, spawn });
		const agents = await client.listAgents();
		expect(agents.map((a) => a.name)).toEqual(["active-bot"]);
	});

	test("treats missing status as active (forward-compat with older canopy)", async () => {
		const list = {
			success: true,
			command: "list",
			prompts: [{ name: "no-status", version: 1 }],
		};
		const { spawn } = makeSpawn(() => ok(JSON.stringify(list)));
		const client = new CanopyClient({ config: CFG, spawn });
		const agents = await client.listAgents();
		expect(agents.map((a) => a.name)).toEqual(["no-status"]);
	});

	test("throws CanopyUnavailableError on non-zero exit", async () => {
		const { spawn } = makeSpawn(() => fail("cn: command not found", 127));
		const client = new CanopyClient({ config: CFG, spawn });
		await expect(client.listAgents()).rejects.toBeInstanceOf(CanopyUnavailableError);
		await expect(client.listAgents()).rejects.toMatchObject({
			message: expect.stringContaining("exited 127"),
		});
	});

	test("throws CanopyUnavailableError when stdout is not JSON", async () => {
		const { spawn } = makeSpawn(() => ok("not json"));
		const client = new CanopyClient({ config: CFG, spawn });
		await expect(client.listAgents()).rejects.toBeInstanceOf(CanopyUnavailableError);
	});

	test("throws CanopyUnavailableError when envelope shape is wrong", async () => {
		const { spawn } = makeSpawn(() => ok(JSON.stringify({ success: true, prompts: "nope" })));
		const client = new CanopyClient({ config: CFG, spawn });
		await expect(client.listAgents()).rejects.toBeInstanceOf(CanopyUnavailableError);
	});

	test("wraps spawn rejections (binary missing) in CanopyUnavailableError", async () => {
		const spawn: SpawnFn = async () => {
			const err = new Error("ENOENT") as Error & { code: string };
			err.code = "ENOENT";
			throw err;
		};
		const client = new CanopyClient({ config: CFG, spawn });
		await expect(client.listAgents()).rejects.toMatchObject({
			code: "canopy_unavailable",
			message: expect.stringContaining("failed to spawn"),
		});
	});
});

describe("CanopyClient.renderAgent", () => {
	test("invokes `cn render <name> --format json`", async () => {
		const render = {
			success: true,
			command: "render",
			name: "refactor-bot",
			version: 1,
			sections: [{ name: "system", body: "..." }],
		};
		const { spawn, calls } = makeSpawn(() => ok(JSON.stringify(render)));
		const client = new CanopyClient({ config: CFG, spawn });
		const out = await client.renderAgent("refactor-bot");
		expect(out).toEqual(render);
		expect(calls[0]?.cmd).toEqual(["cn", "render", "refactor-bot", "--json"]);
	});

	test("surfaces canopy's structured `success: false` error envelope", async () => {
		const errEnv = { success: false, command: "render", error: 'Prompt "missing" not found' };
		// canopy exits 1 with the structured error on stdout
		const { spawn } = makeSpawn(() => fail("", 1, JSON.stringify(errEnv)));
		const client = new CanopyClient({ config: CFG, spawn });
		await expect(client.renderAgent("missing")).rejects.toMatchObject({
			code: "canopy_unavailable",
			message: expect.stringContaining('Prompt "missing" not found'),
		});
	});

	test("still throws on non-zero exit when stdout is empty", async () => {
		const { spawn } = makeSpawn(() => fail("crashed in canopy", 2));
		const client = new CanopyClient({ config: CFG, spawn });
		await expect(client.renderAgent("foo")).rejects.toBeInstanceOf(CanopyUnavailableError);
	});

	test("rejects unparseable stdout on a zero-exit (impossible-but-defensive)", async () => {
		const { spawn } = makeSpawn(() => ok("garbage"));
		const client = new CanopyClient({ config: CFG, spawn });
		await expect(client.renderAgent("foo")).rejects.toBeInstanceOf(CanopyUnavailableError);
	});
});
