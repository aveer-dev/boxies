CREATE TABLE `domain_offboarding` (
	`domain` text PRIMARY KEY NOT NULL,
	`decommissioned_at` integer NOT NULL,
	`finalize_after` integer NOT NULL,
	`warning_sent_at` integer,
	`finalize_requested_by` text,
	`finalize_requested_at` integer,
	`finalize_started_at` integer,
	`finalized_at` integer,
	`subscription_id` text,
	`customer_id` text,
	`subscription_canceled_at` integer,
	`mailboxes_purged` integer DEFAULT 0 NOT NULL,
	`zone_id` text,
	`registrar_managed` integer,
	`data_deleted_at` integer,
	`zone_deleted_at` integer,
	`zone_delete_after` integer,
	`registrar_released_at` integer,
	`step` text,
	`last_error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_until` integer,
	`created_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `domain_offboarding_finalize_after_idx` ON `domain_offboarding` (`finalize_after`);