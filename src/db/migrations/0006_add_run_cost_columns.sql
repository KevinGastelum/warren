ALTER TABLE `runs` ADD `cost_usd` real;--> statement-breakpoint
ALTER TABLE `runs` ADD `tokens_input` integer;--> statement-breakpoint
ALTER TABLE `runs` ADD `tokens_output` integer;--> statement-breakpoint
ALTER TABLE `runs` ADD `tokens_cache_read` integer;--> statement-breakpoint
ALTER TABLE `runs` ADD `tokens_cache_write` integer;