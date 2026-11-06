CREATE TABLE `security_event` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`device` text,
	`ip_prefix` text,
	`country` text,
	`city` text,
	`new_device` integer DEFAULT false NOT NULL,
	`detail` text,
	`created_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `security_event_user_created_idx` ON `security_event` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `security_event_created_at_idx` ON `security_event` (`created_at`);