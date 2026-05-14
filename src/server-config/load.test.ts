import { describe, expect, test } from "bun:test";
import { ValidationError } from "../core/errors.ts";
import { WARREN_CONFIG_FILE_ENV } from "./config.ts";
import { type ExistsFn, loadWarrenServerConfigFromFile, type ReadFileFn } from "./load.ts";

const CONFIG_PATH = "/etc/warren/warren.toml";

interface FsHarness {
	readonly exists: ExistsFn;
	readonly readFile: ReadFileFn;
}

function fs(files: Record<string, string>): FsHarness {
	const present = new Set<string>(Object.keys(files));
	return {
		exists: (path) => present.has(path),
		readFile: async (path) => {
			const value = files[path];
			if (value === undefined) {
				throw new Error(`unexpected read: ${path}`);
			}
			return value;
		},
	};
}

describe("loadWarrenServerConfigFromFile", () => {
	test("WARREN_CONFIG_FILE unset → empty config, path null (zero-config back-compat)", async () => {
		const result = await loadWarrenServerConfigFromFile({
			env: {},
			...fs({}),
		});
		expect(result.path).toBeNull();
		expect(result.config).toEqual({});
	});

	test("WARREN_CONFIG_FILE empty string → empty config, path null", async () => {
		const result = await loadWarrenServerConfigFromFile({
			env: { [WARREN_CONFIG_FILE_ENV]: "" },
			...fs({}),
		});
		expect(result.path).toBeNull();
		expect(result.config).toEqual({});
	});

	test("explicit path overrides env var", async () => {
		const result = await loadWarrenServerConfigFromFile({
			path: CONFIG_PATH,
			env: { [WARREN_CONFIG_FILE_ENV]: "/some/other.toml" },
			...fs({ [CONFIG_PATH]: "" }),
		});
		expect(result.path).toBe(CONFIG_PATH);
	});

	test("WARREN_CONFIG_FILE set but file missing → ValidationError with recovery hint", async () => {
		await expect(
			loadWarrenServerConfigFromFile({
				env: { [WARREN_CONFIG_FILE_ENV]: CONFIG_PATH },
				...fs({}),
			}),
		).rejects.toBeInstanceOf(ValidationError);
	});

	test("missing-file ValidationError carries copy-paste recovery hint", async () => {
		try {
			await loadWarrenServerConfigFromFile({
				env: { [WARREN_CONFIG_FILE_ENV]: CONFIG_PATH },
				...fs({}),
			});
			throw new Error("expected throw");
		} catch (err) {
			expect(err).toBeInstanceOf(ValidationError);
			const ve = err as ValidationError;
			expect(ve.recoveryHint).toContain(WARREN_CONFIG_FILE_ENV);
			expect(ve.recoveryHint).toContain(CONFIG_PATH);
		}
	});

	test("empty file → empty config (Bun.TOML.parse('') === {})", async () => {
		const result = await loadWarrenServerConfigFromFile({
			env: { [WARREN_CONFIG_FILE_ENV]: CONFIG_PATH },
			...fs({ [CONFIG_PATH]: "" }),
		});
		expect(result.path).toBe(CONFIG_PATH);
		expect(result.config).toEqual({});
	});

	test("whitespace-only file → empty config", async () => {
		const result = await loadWarrenServerConfigFromFile({
			env: { [WARREN_CONFIG_FILE_ENV]: CONFIG_PATH },
			...fs({ [CONFIG_PATH]: "\n\n   \n" }),
		});
		expect(result.config).toEqual({});
	});

	test("comments-only file → empty config", async () => {
		const result = await loadWarrenServerConfigFromFile({
			env: { [WARREN_CONFIG_FILE_ENV]: CONFIG_PATH },
			...fs({ [CONFIG_PATH]: "# warren server config\n# nothing set yet\n" }),
		});
		expect(result.config).toEqual({});
	});

	test("malformed TOML → ValidationError with parse-error detail", async () => {
		await expect(
			loadWarrenServerConfigFromFile({
				env: { [WARREN_CONFIG_FILE_ENV]: CONFIG_PATH },
				...fs({ [CONFIG_PATH]: "not = toml = bad\n" }),
			}),
		).rejects.toBeInstanceOf(ValidationError);
	});

	test("malformed TOML ValidationError includes path in message", async () => {
		try {
			await loadWarrenServerConfigFromFile({
				env: { [WARREN_CONFIG_FILE_ENV]: CONFIG_PATH },
				...fs({ [CONFIG_PATH]: "not = toml = bad\n" }),
			});
			throw new Error("expected throw");
		} catch (err) {
			expect(err).toBeInstanceOf(ValidationError);
			expect((err as Error).message).toContain(CONFIG_PATH);
			expect((err as Error).message).toContain("TOML");
		}
	});

	test("unknown top-level key → ValidationError (strict schema rejects passthrough)", async () => {
		await expect(
			loadWarrenServerConfigFromFile({
				env: { [WARREN_CONFIG_FILE_ENV]: CONFIG_PATH },
				...fs({ [CONFIG_PATH]: "banana = 1\n" }),
			}),
		).rejects.toBeInstanceOf(ValidationError);
	});

	test("[[workers]] block parses into ParsedWorkerEntry[] with transports", async () => {
		const result = await loadWarrenServerConfigFromFile({
			env: { [WARREN_CONFIG_FILE_ENV]: CONFIG_PATH },
			...fs({
				[CONFIG_PATH]: [
					"[[workers]]",
					'name = "alpha"',
					'url = "http://alpha.local:9410"',
					"",
					"[[workers]]",
					'name = "beta"',
					'url = "unix:///var/run/burrow-beta.sock"',
					"",
				].join("\n"),
			}),
		});
		expect(result.workers).toEqual([
			{
				name: "alpha",
				url: "http://alpha.local:9410",
				transport: { kind: "tcp", hostname: "alpha.local", port: 9410 },
			},
			{
				name: "beta",
				url: "unix:///var/run/burrow-beta.sock",
				transport: { kind: "unix", path: "/var/run/burrow-beta.sock" },
			},
		]);
	});

	test("no [[workers]] block → workers is an empty array", async () => {
		const result = await loadWarrenServerConfigFromFile({
			env: { [WARREN_CONFIG_FILE_ENV]: CONFIG_PATH },
			...fs({ [CONFIG_PATH]: "" }),
		});
		expect(result.workers).toEqual([]);
	});

	test("duplicate worker name → ValidationError citing workers[i].name", async () => {
		try {
			await loadWarrenServerConfigFromFile({
				env: { [WARREN_CONFIG_FILE_ENV]: CONFIG_PATH },
				...fs({
					[CONFIG_PATH]: [
						"[[workers]]",
						'name = "alpha"',
						'url = "http://a:1"',
						"[[workers]]",
						'name = "alpha"',
						'url = "http://b:2"',
					].join("\n"),
				}),
			});
			throw new Error("expected throw");
		} catch (err) {
			expect(err).toBeInstanceOf(ValidationError);
			expect((err as Error).message).toMatch(/workers\[1\]\.name/);
			expect((err as Error).message).toMatch(/duplicated/);
		}
	});

	test("invalid worker URL → ValidationError citing workers[i].url", async () => {
		try {
			await loadWarrenServerConfigFromFile({
				env: { [WARREN_CONFIG_FILE_ENV]: CONFIG_PATH },
				...fs({
					[CONFIG_PATH]: ["[[workers]]", 'name = "alpha"', 'url = "ftp://nope"'].join("\n"),
				}),
			});
			throw new Error("expected throw");
		} catch (err) {
			expect(err).toBeInstanceOf(ValidationError);
			expect((err as Error).message).toMatch(/workers\[0\]\.url/);
		}
	});

	test("worker name with invalid character → ValidationError citing workers[i].name", async () => {
		try {
			await loadWarrenServerConfigFromFile({
				env: { [WARREN_CONFIG_FILE_ENV]: CONFIG_PATH },
				...fs({
					[CONFIG_PATH]: ["[[workers]]", 'name = "has space"', 'url = "http://a:1"'].join("\n"),
				}),
			});
			throw new Error("expected throw");
		} catch (err) {
			expect(err).toBeInstanceOf(ValidationError);
			expect((err as Error).message).toMatch(/workers\[0\]\.name/);
		}
	});

	test("readFile throws (e.g. EACCES) → ValidationError with cause", async () => {
		await expect(
			loadWarrenServerConfigFromFile({
				env: { [WARREN_CONFIG_FILE_ENV]: CONFIG_PATH },
				exists: () => true,
				readFile: async () => {
					throw new Error("EACCES: permission denied");
				},
			}),
		).rejects.toBeInstanceOf(ValidationError);
	});

	test("defaults to process.env when env not provided", async () => {
		// Sanity check: the loader doesn't blow up when env is omitted —
		// it falls through to `process.env`, where WARREN_CONFIG_FILE is
		// (assumed to be) unset in test context.
		const result = await loadWarrenServerConfigFromFile();
		// Either the var is unset (no path), or it's set to a real file
		// the operator wired up — both are valid; this test only asserts
		// the loader doesn't throw on the default-env path.
		expect(result.config).toEqual({});
	});
});
