-- AVE-143: a "watch" session is tied to the phone session it was minted from.
-- drizzle-kit drops ON DELETE from ADD COLUMN; it is added by hand so deleting
-- the phone session deletes its watch sessions too.
ALTER TABLE `session` ADD `parent_session_id` text REFERENCES session(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `session_parent_session_id_idx` ON `session` (`parent_session_id`);
