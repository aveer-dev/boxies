ALTER TABLE `invite` ADD `email_count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `invite` ADD `last_emailed_at` integer;--> statement-breakpoint
ALTER TABLE `session` ADD `scope` text;--> statement-breakpoint
ALTER TABLE `session` ADD `label` text;--> statement-breakpoint
CREATE INDEX `session_expires_at_idx` ON `session` (`expires_at`);