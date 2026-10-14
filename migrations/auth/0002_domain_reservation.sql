CREATE TABLE `domain_reservation` (
	`domain` text PRIMARY KEY NOT NULL,
	`hold_id` text,
	`session_id` text,
	`status` text NOT NULL,
	`expires_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL
);
