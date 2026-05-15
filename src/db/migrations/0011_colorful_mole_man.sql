PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_name` text NOT NULL,
	`project_id` text,
	`burrow_id` text,
	`burrow_run_id` text,
	`worker_id` text,
	`seed_id` text,
	`rendered_agent_json` text NOT NULL,
	`state` text NOT NULL,
	`failure_reason` text,
	`started_at` text,
	`ended_at` text,
	`prompt` text NOT NULL,
	`trigger` text NOT NULL,
	`pr_url` text,
	`cost_usd` real,
	`tokens_input` integer,
	`tokens_output` integer,
	`tokens_cache_read` integer,
	`tokens_cache_write` integer,
	`preview_state` text,
	`preview_port` integer,
	`preview_started_at` text,
	`preview_last_hit_at` text,
	`preview_failure_message` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_runs`("id", "agent_name", "project_id", "burrow_id", "burrow_run_id", "worker_id", "seed_id", "rendered_agent_json", "state", "failure_reason", "started_at", "ended_at", "prompt", "trigger", "pr_url", "cost_usd", "tokens_input", "tokens_output", "tokens_cache_read", "tokens_cache_write", "preview_state", "preview_port", "preview_started_at", "preview_last_hit_at", "preview_failure_message") SELECT "id", "agent_name", "project_id", "burrow_id", "burrow_run_id", "worker_id", "seed_id", "rendered_agent_json", "state", "failure_reason", "started_at", "ended_at", "prompt", "trigger", "pr_url", "cost_usd", "tokens_input", "tokens_output", "tokens_cache_read", "tokens_cache_write", "preview_state", "preview_port", "preview_started_at", "preview_last_hit_at", "preview_failure_message" FROM `runs`;--> statement-breakpoint
DROP TABLE `runs`;--> statement-breakpoint
ALTER TABLE `__new_runs` RENAME TO `runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `runs_state_idx` ON `runs` (`state`);--> statement-breakpoint
CREATE INDEX `runs_project_started_idx` ON `runs` (`project_id`,"started_at" DESC);--> statement-breakpoint
CREATE INDEX `runs_agent_started_idx` ON `runs` (`agent_name`,"started_at" DESC);--> statement-breakpoint
CREATE INDEX `runs_worker_state_idx` ON `runs` (`worker_id`,`state`);--> statement-breakpoint
CREATE TABLE `__new_agents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`rendered_json` text NOT NULL,
	`registered_at` text NOT NULL,
	`last_refreshed` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_agents`("name", "rendered_json", "registered_at", "last_refreshed") SELECT "name", "rendered_json", "registered_at", "last_refreshed" FROM `agents`;--> statement-breakpoint
DROP TABLE `agents`;--> statement-breakpoint
ALTER TABLE `__new_agents` RENAME TO `agents`;--> statement-breakpoint
CREATE UNIQUE INDEX `agents_project_name_idx` ON `agents` (`project_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `agents_global_name_idx` ON `agents` (`name`) WHERE "agents"."project_id" IS NULL;