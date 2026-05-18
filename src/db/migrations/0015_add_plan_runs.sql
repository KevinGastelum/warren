CREATE TABLE `plan_run_children` (
	`plan_run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`seed_id` text NOT NULL,
	`run_id` text,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`started_at` text,
	`ended_at` text,
	`pr_merged_at` text,
	`failure_reason` text,
	PRIMARY KEY(`plan_run_id`, `seq`),
	FOREIGN KEY (`plan_run_id`) REFERENCES `plan_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `plan_run_children_run_idx` ON `plan_run_children` (`run_id`);--> statement-breakpoint
CREATE INDEX `plan_run_children_state_idx` ON `plan_run_children` (`plan_run_id`,`state`);--> statement-breakpoint
CREATE TABLE `plan_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`project_id` text NOT NULL,
	`agent_name` text NOT NULL,
	`prompt_template` text DEFAULT 'work on sd {seed_id}' NOT NULL,
	`ref` text,
	`provider_override` text,
	`model_override` text,
	`dispatcher_handle` text DEFAULT 'operator' NOT NULL,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`state` text NOT NULL,
	`failure_reason` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`ended_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plan_runs_project_state_idx` ON `plan_runs` (`project_id`,`state`);--> statement-breakpoint
CREATE INDEX `plan_runs_state_idx` ON `plan_runs` (`state`);