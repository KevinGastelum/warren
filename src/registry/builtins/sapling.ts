/**
 * Built-in `sapling` agent definition.
 *
 * Sapling is the alternate harness burrow ships out of the box (the
 * other being claude-code). Warren includes a built-in for it so an
 * operator can pick between the two harnesses without standing up a
 * canopy library first.
 */

import type { AgentDefinition } from "../schema.ts";

const SYSTEM_BODY = `You are a helpful coding assistant. Be concise.

Workspace map:
- The project repo is mounted at the burrow workspace root.
- /workspace/.canopy/agent.json is the rendered agent definition (warren seeded it).
- /workspace/.mulch/expertise/<domain>.jsonl holds the project's expertise records.
- /workspace/.seeds/issues.jsonl holds the project's issue queue.

Operating contract:
- Edit files in place. Run tests when relevant.
- Before committing, run the project's quality gates to catch lint, type, and test failures. Use \`$WARREN_QUALITY_GATE\` if set, otherwise look for the command in CLAUDE.md, or fall back to common commands (\`bun run check:all\`, \`npm run lint && npm run typecheck\`). Fix any failures before committing.
- Use git as you normally would. Commit your changes; warren reaps the branch and pushes upstream.
- Do not run \`git push\` yourself — warren handles the push host-side after the run terminates.
`;

export const SAPLING_BUILTIN: AgentDefinition = {
	name: "sapling",
	version: 1,
	sections: {
		system: SYSTEM_BODY,
		burrow_config: '[sandbox]\nnetwork = "open"\n',
	},
	resolvedFrom: ["builtin:sapling"],
	frontmatter: {
		source: "builtin",
		tags: ["agent"],
	},
};
