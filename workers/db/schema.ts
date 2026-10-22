// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";

export const folders = sqliteTable("folders", {
	id: text("id").primaryKey(),
	name: text("name").notNull().unique(),
	is_deletable: integer("is_deletable").notNull().default(1),
});

export const emails = sqliteTable("emails", {
	id: text("id").primaryKey(),
	folder_id: text("folder_id")
		.notNull()
		.references(() => folders.id, { onDelete: "cascade" }),
	subject: text("subject"),
	sender: text("sender"),
	sender_name: text("sender_name"),
	recipient: text("recipient"),
	cc: text("cc"),
	bcc: text("bcc"),
	date: text("date"),
	read: integer("read").default(0),
	starred: integer("starred").default(0),
	/** Reply Later pile membership (orthogonal to folder_id / starred). */
	reply_later: integer("reply_later").default(0),
	/** ISO timestamp when added to Reply Later; used for FIFO pile order. */
	reply_later_at: text("reply_later_at"),
	/** @deprecated Full HTML/text lives in R2; kept nullable for legacy rows during lazy offload. */
	body: text("body"),
	/** List/search preview; full body is in R2 (`emails/{id}/body.html`). */
	snippet: text("snippet"),
	in_reply_to: text("in_reply_to"),
	email_references: text("email_references"),
	thread_id: text("thread_id"),
	message_id: text("message_id"),
	raw_headers: text("raw_headers"),
	provider_message_id: text("provider_message_id"),
	delivery_status: text("delivery_status"),
	delivery_error: text("delivery_error"),
	/** JSON EmailAuth snapshot (SPF/DKIM/DMARC). Null on outbound and legacy rows. */
	auth: text("auth"),
	/** Masked email alias ID if this email was received via an alias. */
	alias_id: text("alias_id"),
	/** Draft author: "agent" for AI drafts, null for the user's own. */
	source: text("source"),
	/** Client `Idempotency-Key` for a send/reply/forward; unique when set (migration 33). */
	idempotency_key: text("idempotency_key"),
	/**
	 * ISO time the message entered Spam or Trash; NULL in every other folder.
	 * Maintained by SQLite triggers (migration 34); retention purges by it.
	 */
	retention_since: text("retention_since"),
	/** Why inbound mail was filed where it was (shared/spam-reason.ts codes; migration 37). */
	classification_reason: text("classification_reason"),
	/** verified | unverified | failed at receive time. Null on outbound and pre-37 rows. */
	auth_tier: text("auth_tier"),
	/** Sender rule that decided the folder. Null until sender_rules exists. */
	matched_rule_id: text("matched_rule_id"),
});

export const attachments = sqliteTable("attachments", {
	id: text("id").primaryKey(),
	email_id: text("email_id")
		.notNull()
		.references(() => emails.id, { onDelete: "cascade" }),
	filename: text("filename").notNull(),
	mimetype: text("mimetype").notNull(),
	size: integer("size").notNull(),
	content_id: text("content_id"),
	disposition: text("disposition"),
});

/**
 * Per-recipient delivery state from Email Sending events (migration
 * 36_delivery_recipients). Written and read with raw SQL in
 * workers/lib/delivery-recipients.ts; mirrored here for types.
 */
export const deliveryRecipients = sqliteTable(
	"delivery_recipients",
	{
		email_id: text("email_id")
			.notNull()
			.references(() => emails.id, { onDelete: "cascade" }),
		address: text("address").notNull(),
		status: text("status").notNull(),
		error: text("error"),
		updated_at: text("updated_at").notNull(),
	},
	(table) => [primaryKey({ columns: [table.email_id, table.address] })],
);

/** Registry of AI chat conversations for a mailbox (messages live in EmailAgent DOs). */
export const agentConversations = sqliteTable("agent_conversations", {
	id: text("id").primaryKey(),
	title: text("title").notNull(),
	created_at: text("created_at").notNull(),
	updated_at: text("updated_at").notNull(),
	last_message_preview: text("last_message_preview"),
});

/** Screener-lite: allow/deny decisions per sender address. */
export const senderTriage = sqliteTable("sender_triage", {
	sender: text("sender").primaryKey(),
	status: text("status").notNull(),
	destination_folder_id: text("destination_folder_id"),
	display_name: text("display_name"),
	decided_at: text("decided_at").notNull(),
	updated_at: text("updated_at").notNull(),
});

/**
 * Explicit allow / block rules by address or registrable domain (migration
 * 38_sender_rules). Queried with raw SQL in workers/lib/sender-rules.ts;
 * mirrored here for types.
 */
export const senderRules = sqliteTable("sender_rules", {
	id: text("id").primaryKey(),
	kind: text("kind").notNull(),
	value: text("value").notNull(),
	verdict: text("verdict").notNull(),
	source: text("source").notNull(),
	created_at: text("created_at").notNull(),
	updated_at: text("updated_at").notNull(),
	last_matched_at: text("last_matched_at"),
	match_count: integer("match_count").notNull().default(0),
});

/** Masked email aliases configured for this mailbox. */
export const aliases = sqliteTable("aliases", {
	id: text("id").primaryKey(),
	alias_email: text("alias_email").notNull().unique(),
	domain: text("domain").notNull(),
	base_domain: text("base_domain").notNull(),
	label: text("label"),
	is_active: integer("is_active").notNull().default(1),
	paused_action: text("paused_action").notNull().default("drop"),
	expires_at: text("expires_at"),
	created_at: text("created_at").notNull(),
	stats_received: integer("stats_received").notNull().default(0),
	stats_blocked: integer("stats_blocked").notNull().default(0),
});

/**
 * Notes to self (migration 31_thread_notes_to_self), private to their author.
 * Queried with raw SQL in workers/lib/thread-notes.ts; mirrored here for types.
 */
export const threadNotes = sqliteTable("thread_notes", {
	id: text("id").primaryKey(),
	thread_id: text("thread_id").notNull(),
	email_id: text("email_id"),
	note_type: text("note_type").notNull(),
	body: text("body").notNull(),
	pos_x: real("pos_x"),
	pos_y: real("pos_y"),
	author_user_id: text("author_user_id").notNull(),
	created_at: text("created_at").notNull(),
	updated_at: text("updated_at").notNull(),
});
