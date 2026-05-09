PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_name` text NOT NULL,
	`project_id` text,
	`burrow_id` text,
	`burrow_run_id` text,
	`rendered_agent_json` text NOT NULL,
	`state` text NOT NULL,
	`failure_reason` text,
	`started_at` text,
	`ended_at` text,
	`prompt` text NOT NULL,
	`trigger` text NOT NULL,
	FOREIGN KEY (`agent_name`) REFERENCES `agents`(`name`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_runs`("id", "agent_name", "project_id", "burrow_id", "burrow_run_id", "rendered_agent_json", "state", "failure_reason", "started_at", "ended_at", "prompt", "trigger") SELECT "id", "agent_name", "project_id", "burrow_id", "burrow_run_id", "rendered_agent_json", "state", "failure_reason", "started_at", "ended_at", "prompt", "trigger" FROM `runs`;--> statement-breakpoint
DROP TABLE `runs`;--> statement-breakpoint
ALTER TABLE `__new_runs` RENAME TO `runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `runs_state_idx` ON `runs` (`state`);--> statement-breakpoint
CREATE INDEX `runs_project_started_idx` ON `runs` (`project_id`,"started_at" DESC);--> statement-breakpoint
CREATE INDEX `runs_agent_started_idx` ON `runs` (`agent_name`,"started_at" DESC);