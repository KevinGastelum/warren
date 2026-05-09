/**
 * Scenario 03 — POST /projects + GET /projects + DELETE /projects/:id.
 *
 * Acceptance criterion #3:
 *   "POST /projects clones the configured GitHub URL (via the
 *   GIT_CONFIG_GLOBAL insteadOf rewrite — no real network), GET /projects
 *   lists it, DELETE /projects/:id removes both the row and the on-disk
 *   clone."
 *
 * Verifies the §8.1 atomicity contract: a row exists ⇔ its localPath
 * exists. We poke the filesystem directly to make sure deleteProject
 * isn't lying about the rmrf step.
 */

import { existsSync } from "node:fs";

import { AcceptanceError, assertEqual, assertTrue, type Scenario } from "../lib/assert.ts";
import { WarrenHttp } from "../lib/http.ts";

interface ProjectRow {
	readonly id: string;
	readonly gitUrl: string;
	readonly localPath: string;
	readonly defaultBranch: string;
	readonly addedAt: string;
}

interface ErrorEnvelope {
	readonly error: { readonly code: string; readonly message?: string };
}

export const scenario: Scenario = {
	id: "03",
	title: "POST /projects clones via insteadOf, GET lists, DELETE removes row + disk",
	modes: ["in-proc", "container"],
	async run(ctx) {
		const http = new WarrenHttp({ baseUrl: ctx.warrenUrl, token: ctx.token });

		// /projects starts empty (DB is fresh per harness boot).
		const before = await http.expectJson<{ projects: ProjectRow[] }>("GET", "/projects", 200);
		assertEqual(before.projects.length, 0, "/projects is empty before first POST");

		// Clone the sample fixture. Warren resolves the fake github.com URL
		// through GIT_CONFIG_GLOBAL's insteadOf rewrite to the local fixture
		// path — no network, no production code change.
		const created = await http.expectJson<ProjectRow>("POST", "/projects", 201, {
			body: { gitUrl: ctx.fixtures.sampleProjectGitUrl },
		});
		assertTrue(
			typeof created.id === "string" && created.id.length > 0,
			"POST /projects response missing id",
		);
		assertEqual(created.gitUrl, ctx.fixtures.sampleProjectGitUrl, "ProjectRow.gitUrl");
		assertTrue(
			typeof created.localPath === "string" && created.localPath.length > 0,
			"POST /projects response missing localPath",
		);
		assertTrue(
			typeof created.defaultBranch === "string" && created.defaultBranch.length > 0,
			"POST /projects response missing defaultBranch",
		);
		assertTrue(
			typeof created.addedAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(created.addedAt),
			`POST /projects addedAt is not an ISO8601 string: ${JSON.stringify(created.addedAt)}`,
		);

		// addProject's contract: row inserted only after clone succeeds, so
		// localPath must exist on disk by the time we get a 201.
		assertTrue(
			existsSync(created.localPath),
			`clone localPath ${created.localPath} does not exist after POST /projects 201`,
		);

		// GET now lists the project.
		const after = await http.expectJson<{ projects: ProjectRow[] }>("GET", "/projects", 200);
		const found = after.projects.find((p) => p.id === created.id);
		if (found === undefined) {
			throw new AcceptanceError(
				`GET /projects after POST does not include id ${created.id}: ${JSON.stringify(after.projects)}`,
			);
		}
		assertEqual(found.gitUrl, ctx.fixtures.sampleProjectGitUrl, "listed project gitUrl");
		assertEqual(
			found.localPath,
			created.localPath,
			"listed project localPath matches POST response",
		);

		// Re-adding the same gitUrl is a 400 validation_error (already exists).
		const dupRes = await http.request("POST", "/projects", {
			body: { gitUrl: ctx.fixtures.sampleProjectGitUrl },
		});
		assertEqual(dupRes.status, 400, "duplicate POST /projects status");
		const dupBody = (await dupRes.json()) as ErrorEnvelope;
		assertEqual(dupBody.error?.code, "validation_error", "duplicate POST /projects error code");

		// DELETE removes row + on-disk clone.
		const deleted = await http.expectJson<ProjectRow>(
			"DELETE",
			`/projects/${encodeURIComponent(created.id)}`,
			200,
		);
		assertEqual(deleted.id, created.id, "DELETE response id");
		assertTrue(
			!existsSync(created.localPath),
			`localPath ${created.localPath} still exists after DELETE /projects/:id`,
		);

		// GET is empty again.
		const finalList = await http.expectJson<{ projects: ProjectRow[] }>("GET", "/projects", 200);
		assertEqual(finalList.projects.length, 0, "/projects is empty after DELETE");

		// Second DELETE is a 404 (row already gone).
		const repeatDel = await http.request("DELETE", `/projects/${encodeURIComponent(created.id)}`);
		assertEqual(repeatDel.status, 404, "second DELETE /projects/:id status");
	},
};
