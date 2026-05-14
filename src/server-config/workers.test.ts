import { describe, expect, test } from "bun:test";
import { ValidationError } from "../core/errors.ts";
import {
	parseWorkerUrl,
	requireSharedBurrowToken,
	SHARED_BURROW_TOKEN_HINT,
	validateWorkerEntries,
	WARREN_BURROW_TOKEN_ENV,
} from "./workers.ts";

describe("parseWorkerUrl", () => {
	test("parses a unix:// URL into a unix transport", () => {
		const r = parseWorkerUrl("unix:///var/run/burrow.sock");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.transport).toEqual({ kind: "unix", path: "/var/run/burrow.sock" });
	});

	test("parses unix:// with a relative-looking path verbatim", () => {
		// V1 leaves path resolution to the deployer; we only require non-empty.
		const r = parseWorkerUrl("unix://tmp/burrow.sock");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.transport).toEqual({ kind: "unix", path: "tmp/burrow.sock" });
	});

	test("rejects an empty unix:// path", () => {
		const r = parseWorkerUrl("unix://");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toMatch(/empty path/);
	});

	test("parses http://host:port into a tcp transport", () => {
		const r = parseWorkerUrl("http://burrow.local:9410");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.transport).toEqual({ kind: "tcp", hostname: "burrow.local", port: 9410 });
	});

	test("rejects https:// (TLS is out of V1 scope)", () => {
		const r = parseWorkerUrl("https://burrow.example.com:443");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toMatch(/unix:\/\/ or http:\/\//);
	});

	test("accepts a trailing slash on the http URL", () => {
		const r = parseWorkerUrl("http://burrow.local:9410/");
		expect(r.ok).toBe(true);
	});

	test("rejects http URL with a path", () => {
		const r = parseWorkerUrl("http://burrow.local:9410/api");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toMatch(/path/);
	});

	test("rejects http URL with a query string", () => {
		const r = parseWorkerUrl("http://burrow.local:9410?foo=1");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toMatch(/query/);
	});

	test("rejects http URL without an explicit port", () => {
		const r = parseWorkerUrl("http://burrow.local");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toMatch(/port/);
	});

	test("rejects http URL with port 0 (defensive bound; URL spec allows it)", () => {
		const r = parseWorkerUrl("http://burrow.local:0");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toMatch(/1\.\.65535/);
	});

	test("rejects http URL with an out-of-range port (URL constructor throws)", () => {
		const r = parseWorkerUrl("http://burrow.local:70000");
		expect(r.ok).toBe(false);
	});

	test("rejects a non-unix, non-http scheme", () => {
		const r = parseWorkerUrl("ftp://burrow.local:21");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toMatch(/unix:\/\/ or http/);
	});

	test("rejects an empty string", () => {
		const r = parseWorkerUrl("");
		expect(r.ok).toBe(false);
	});
});

describe("validateWorkerEntries", () => {
	test("empty array → ok with empty workers", () => {
		const r = validateWorkerEntries([]);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.workers).toEqual([]);
	});

	test("valid entries → parsed transports preserved alongside name + url", () => {
		const r = validateWorkerEntries([
			{ name: "alpha", url: "http://a:1" },
			{ name: "beta", url: "unix:///b.sock" },
		]);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.workers).toEqual([
				{ name: "alpha", url: "http://a:1", transport: { kind: "tcp", hostname: "a", port: 1 } },
				{ name: "beta", url: "unix:///b.sock", transport: { kind: "unix", path: "/b.sock" } },
			]);
		}
	});

	test("duplicate name → workers[i].name duplicated message", () => {
		const r = validateWorkerEntries([
			{ name: "alpha", url: "http://a:1" },
			{ name: "alpha", url: "http://b:2" },
		]);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.message).toMatch(/workers\[1\]\.name/);
			expect(r.message).toMatch(/duplicated/);
		}
	});

	test("invalid name → workers[i].name regex message", () => {
		const r = validateWorkerEntries([{ name: "has space", url: "http://a:1" }]);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toMatch(/workers\[0\]\.name/);
	});

	test("name starting with non-alphanumeric → rejected", () => {
		const r = validateWorkerEntries([{ name: "-alpha", url: "http://a:1" }]);
		expect(r.ok).toBe(false);
	});

	test("underscore + digits in name → accepted", () => {
		const r = validateWorkerEntries([{ name: "worker_01", url: "http://a:1" }]);
		expect(r.ok).toBe(true);
	});

	test("bad url → workers[i].url message", () => {
		const r = validateWorkerEntries([{ name: "alpha", url: "not-a-url" }]);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toMatch(/workers\[0\]\.url/);
	});

	test("fails fast on the first error (does not concatenate)", () => {
		const r = validateWorkerEntries([
			{ name: "ok", url: "http://a:1" },
			{ name: "has space", url: "not-a-url" },
		]);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toMatch(/workers\[1\]\.name/);
	});
});

describe("requireSharedBurrowToken", () => {
	test("returns the token when WARREN_BURROW_TOKEN is set", () => {
		const t = requireSharedBurrowToken({ [WARREN_BURROW_TOKEN_ENV]: "secret-123" });
		expect(t).toBe("secret-123");
	});

	test("throws ValidationError when WARREN_BURROW_TOKEN is unset", () => {
		expect(() => requireSharedBurrowToken({})).toThrow(ValidationError);
	});

	test("throws ValidationError when WARREN_BURROW_TOKEN is the empty string", () => {
		expect(() => requireSharedBurrowToken({ [WARREN_BURROW_TOKEN_ENV]: "" })).toThrow(
			ValidationError,
		);
	});

	test("missing-token ValidationError carries the shared-token recovery hint", () => {
		try {
			requireSharedBurrowToken({});
			throw new Error("expected throw");
		} catch (err) {
			expect(err).toBeInstanceOf(ValidationError);
			const ve = err as ValidationError;
			expect(ve.message).toContain(WARREN_BURROW_TOKEN_ENV);
			expect(ve.recoveryHint).toBe(SHARED_BURROW_TOKEN_HINT);
			expect(ve.recoveryHint).toContain("BURROW_API_TOKEN");
		}
	});
});
