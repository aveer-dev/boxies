CREATE TABLE `email_suppression` (
	`domain` text NOT NULL,
	`recipient` text NOT NULL,
	`reason` text NOT NULL,
	`source` text NOT NULL,
	`source_event_id` text,
	`source_mailbox_id` text,
	`source_message_id` text,
	`detail` text,
	`created_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL,
	PRIMARY KEY(`domain`, `recipient`)
);
--> statement-breakpoint
CREATE INDEX `email_suppression_source_mailbox_idx` ON `email_suppression` (`source_mailbox_id`);