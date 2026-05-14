CREATE TABLE `burrows` (
	`id` text PRIMARY KEY NOT NULL,
	`worker_id` text NOT NULL,
	`added_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `burrows_worker_idx` ON `burrows` (`worker_id`);--> statement-breakpoint
ALTER TABLE `runs` ADD `worker_id` text;--> statement-breakpoint
CREATE INDEX `runs_worker_state_idx` ON `runs` (`worker_id`,`state`);