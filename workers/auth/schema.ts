// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * D1 schema for identity and permissions (`AUTH_DB`).
 *
 * The first four tables belong to Better Auth: their JS property names must
 * match Better Auth's field names (the drizzle adapter maps by key). The rest
 * are ours. Every permission is a row keyed by `user.id`; emails are
 * attributes, never identities.
 *
 * After editing, regenerate the SQL migration:
 *   pnpm auth:generate
 */

import { sql } from "drizzle-orm";
import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

const createdAt = () =>
	integer("created_at", { mode: "timestamp_ms" })
		.notNull()
		.default(sql`(unixepoch('subsecond') * 1000)`);

const updatedAt = () =>
	integer("updated_at", { mode: "timestamp_ms" })
		.notNull()
		.default(sql`(unixepoch('subsecond') * 1000)`)
		.$onUpdate(() => new Date());

// ── Better Auth ──────────────────────────────────────────────────

export const user = sqliteTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: integer("email_verified", { mode: "boolean" })
		.notNull()
		.default(false),
	image: text("image"),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});

export const session = sqliteTable(
	"session",
	{
		id: text("id").primaryKey(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		token: text("token").notNull().unique(),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		/**
		 * Null for a full app session. "aliases" for browser-extension and
		 * AutoFill tokens, which may only list mailboxes and manage private
		 * emails (see `lib/auth-paths.ts`).
		 */
		scope: text("scope"),
		/** Name shown in the session list ("Browser extension", "iPhone AutoFill"). */
		label: text("label"),
	},
	(t) => [
		index("session_user_id_idx").on(t.userId),
		index("session_expires_at_idx").on(t.expiresAt),
	],
);

export const account = sqliteTable(
	"account",
	{
		id: text("id").primaryKey(),
		/** Provider's id for the person: Apple/Google `sub`, or the user id for "credential". */
		accountId: text("account_id").notNull(),
		/** "credential" (password), "apple", "google". */
		providerId: text("provider_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
		refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
		scope: text("scope"),
		password: text("password"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		index("account_user_id_idx").on(t.userId),
		// One person per provider identity: an Apple/Google sub can only ever
		// belong to one user.
		uniqueIndex("account_provider_account_uidx").on(t.providerId, t.accountId),
	],
);

/**
 * Sign in with Apple refresh tokens, one per Apple client a user signed in
 * through: the iOS bundle id (native) or the web Services ID (Apple JS).
 * Apple only revokes a token when `client_id` matches the client that
 * issued it, so each token keeps its client. Revoked on account deletion and
 * Apple unlink (`auth/apple.ts`). Tokens from before this table live in
 * `account.refresh_token` and belong to the bundle id.
 */
export const appleRefreshToken = sqliteTable(
	"apple_refresh_token",
	{
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		/** The bundle id or Services ID the token was issued to. */
		clientId: text("client_id").notNull(),
		refreshToken: text("refresh_token").notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [primaryKey({ columns: [t.userId, t.clientId] })],
);

export const verification = sqliteTable(
	"verification",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ── Inboxies permissions ─────────────────────────────────────────

/** A mailbox address. Settings and mail stay in R2 / the mailbox Durable Object. */
export const mailbox = sqliteTable(
	"mailbox",
	{
		/** Canonical address, e.g. `ada@inboxies.email`. */
		id: text("id").primaryKey(),
		domain: text("domain").notNull(),
		createdAt: createdAt(),
		deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
	},
	(t) => [index("mailbox_domain_idx").on(t.domain)],
);

export const MAILBOX_ROLES = ["owner", "member"] as const;
export type MailboxRole = (typeof MAILBOX_ROLES)[number];

export const mailboxMember = sqliteTable(
	"mailbox_member",
	{
		mailboxId: text("mailbox_id")
			.notNull()
			.references(() => mailbox.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: text("role", { enum: MAILBOX_ROLES }).notNull(),
		createdAt: createdAt(),
	},
	(t) => [
		primaryKey({ columns: [t.mailboxId, t.userId] }),
		index("mailbox_member_user_id_idx").on(t.userId),
	],
);

/** `suspended`: the domain's subscription ended; its mailboxes are read-only until renewed. */
export const DOMAIN_STATUSES = ["pending", "active", "suspended", "decommissioned"] as const;
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

/** A customer domain. Registrar/DNS details stay in R2 domain metadata. */
export const domain = sqliteTable(
	"domain",
	{
		domain: text("domain").primaryKey(),
		ownerUserId: text("owner_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		status: text("status", { enum: DOMAIN_STATUSES }).notNull().default("pending"),
		/** Value the owner publishes as a DNS TXT record to prove control. */
		verificationToken: text("verification_token"),
		verifiedAt: integer("verified_at", { mode: "timestamp_ms" }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [index("domain_owner_user_id_idx").on(t.ownerUserId)],
);

export const DOMAIN_RESERVATION_STATUSES = ["checkout", "awaiting_payment", "provisioning"] as const;
export type DomainReservationStatus = (typeof DOMAIN_RESERVATION_STATUSES)[number];

/**
 * One in-flight purchase per domain, so two buyers can't both pay for it.
 * The row goes away once the domain is provisioned, refunded or abandoned.
 */
export const domainReservation = sqliteTable("domain_reservation", {
	domain: text("domain").primaryKey(),
	/** Secret in the checkout's cancel URL; lets that browser give the hold back. */
	holdId: text("hold_id"),
	/** Stripe Checkout Session id; null until the session exists. */
	sessionId: text("session_id"),
	status: text("status", { enum: DOMAIN_RESERVATION_STATUSES }).notNull(),
	/**
	 * When the hold lapses: checkout expiry plus a grace period for late webhooks,
	 * or the provisioning lease. Null while a delayed payment is pending.
	 */
	expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});

export const domainAdmin = sqliteTable(
	"domain_admin",
	{
		domain: text("domain")
			.notNull()
			.references(() => domain.domain, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: createdAt(),
	},
	(t) => [
		primaryKey({ columns: [t.domain, t.userId] }),
		index("domain_admin_user_id_idx").on(t.userId),
	],
);

export const invite = sqliteTable(
	"invite",
	{
		/** SHA-256 of the invite token; the token itself is never stored. */
		tokenHash: text("token_hash").primaryKey(),
		mailboxId: text("mailbox_id")
			.notNull()
			.references(() => mailbox.id, { onDelete: "cascade" }),
		role: text("role", { enum: MAILBOX_ROLES }).notNull(),
		inviteeEmail: text("invitee_email").notNull(),
		inviteeName: text("invitee_name"),
		createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		acceptedBy: text("accepted_by").references(() => user.id, { onDelete: "set null" }),
		acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
		revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
		/** Invite emails sent so far and when the last went out (resend throttle). */
		emailCount: integer("email_count").notNull().default(1),
		lastEmailedAt: integer("last_emailed_at", { mode: "timestamp_ms" }),
		createdAt: createdAt(),
	},
	(t) => [index("invite_mailbox_id_idx").on(t.mailboxId)],
);

/** Where password resets go. Only used once verified by OTP. */
export const recoveryEmail = sqliteTable("recovery_email", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	email: text("email").notNull(),
	verifiedAt: integer("verified_at", { mode: "timestamp_ms" }),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});

export const auditLog = sqliteTable(
	"audit_log",
	{
		id: text("id").primaryKey(),
		createdAt: createdAt(),
		actorUserId: text("actor_user_id"),
		action: text("action").notNull(),
		target: text("target"),
		/** JSON blob. */
		detail: text("detail"),
	},
	(t) => [index("audit_log_created_at_idx").on(t.createdAt)],
);

export const SUPPRESSION_REASONS = ["hard_bounce", "complaint"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export const SUPPRESSION_SOURCES = ["email_sending_event", "inbound_dsn"] as const;
export type SuppressionSource = (typeof SUPPRESSION_SOURCES)[number];

/**
 * Recipients we stop sending to from a domain after a hard bounce or a spam
 * complaint (AVE-37). Keyed by the sending domain (`private.<domain>` folds
 * into `<domain>`) so one customer's bad address can't keep hurting the
 * domain's reputation, and customers on other domains are unaffected.
 * Deleting a row is the un-suppress action.
 */
export const emailSuppression = sqliteTable(
	"email_suppression",
	{
		domain: text("domain").notNull(),
		/** Lower-cased bare address. */
		recipient: text("recipient").notNull(),
		reason: text("reason", { enum: SUPPRESSION_REASONS }).notNull(),
		source: text("source", { enum: SUPPRESSION_SOURCES }).notNull(),
		/** Email Sending `eventId`, or the DSN's Message-ID. */
		sourceEventId: text("source_event_id"),
		/** Mailbox whose send bounced; manages the row with domain admins. */
		sourceMailboxId: text("source_mailbox_id"),
		/** Sent row id (DSN) or provider message id (Email Sending event). */
		sourceMessageId: text("source_message_id"),
		/** SMTP status / diagnostic or complaint type, for display. */
		detail: text("detail"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		primaryKey({ columns: [t.domain, t.recipient] }),
		index("email_suppression_source_mailbox_idx").on(t.sourceMailboxId),
	],
);
