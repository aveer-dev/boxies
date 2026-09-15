// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { eq, and, or, asc, desc, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import * as schema from "../db/schema";
import { Folders } from "../../shared/folders";
import { AUTO_REPLY_WINDOW_MS } from "../lib/mail-automations";
import type { InboxDigest } from "../../shared/inbox-digest";
import type { Env } from "../types";
import { applyMigrations, mailboxMigrations } from "./migrations";
import {
	senderNameFromRawHeaders,
} from "../../shared/sender";
import {
	buildInboxDigest,
	type DigestEmailRow,
} from "../lib/inbox-digest";
import {
	buildSimpleMime,
	computeSnippet,
	deleteEmailContent,
	loadEmailBody,
	storeEmailContent,
} from "../lib/email-content";
import {
	FTS_BACKFILL_BATCH_SIZE,
	FTS_BACKFILL_MIGRATION,
	computeSearchText,
	formatFtsRecipients,
	sanitizeFtsQuery,
	type FtsEmailFields,
} from "../lib/email-fts";
import { aggregateRecentRecipients } from "../../shared/recent-recipients";

/**
 * SQL expression to normalize email subjects by stripping common
 * reply/forward prefixes (Re:, Fwd:, FW:, AW:, WG:, Réf:, SV:).
 * Used for conversation grouping. Hardcoded to the `subject` column.
 */
const NORMALIZED_SUBJECT_SQL = `LOWER(TRIM(
	REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
		LOWER(subject),
		'aw: ', ''), 'wg: ', ''), 'réf: ', ''), 'sv: ', ''),
		're: ', ''), 'fwd: ', ''), 'fw: ', '')
))`;

/** Resolve a system folder by id or name. `name = 'draft'` does not match the
 *  stored display name `'Drafts'`; looking up `id` as well is the same pattern
 *  used for the folder filter (`name = ?1 OR id = ?1`). */
const folderIdSql = (id: string) =>
	`(SELECT id FROM folders WHERE name = '${id}' OR id = '${id}' LIMIT 1)`;
const DRAFT_FOLDER_ID_SQL = folderIdSql(Folders.DRAFT);
const SENT_FOLDER_ID_SQL = folderIdSql(Folders.SENT);

const ALLOWED_SORT_COLUMNS = [
	"id",
	"subject",
	"sender",
	"recipient",
	"date",
	"read",
	"starred",
] as const;

type SortColumn = (typeof ALLOWED_SORT_COLUMNS)[number];

/**
 * Map SortColumn string names to Drizzle column references for safe
 * ORDER BY construction (no string interpolation into SQL).
 */
const SORT_COLUMN_MAP = {
	id: schema.emails.id,
	subject: schema.emails.subject,
	sender: schema.emails.sender,
	recipient: schema.emails.recipient,
	date: schema.emails.date,
	read: schema.emails.read,
	starred: schema.emails.starred,
} satisfies Record<SortColumn, typeof schema.emails[keyof typeof schema.emails]>;

interface SearchFilterOptions {
	query: string;
	folder?: string;
	from?: string;
	to?: string;
	subject?: string;
	date_start?: string;
	date_end?: string;
	is_read?: boolean;
	is_starred?: boolean;
	has_attachment?: boolean;
}

interface GetEmailsOptions {
	folder?: string;
	thread_id?: string;
	page?: number;
	limit?: number;
	sortColumn?: SortColumn;
	sortDirection?: "ASC" | "DESC";
}

export type DeliveryStatus =
	| "queued"
	| "accepted"
	| "failed"
	| "bounced"
	| "complained";

interface EmailData {
	id: string;
	subject: string;
	sender: string;
	sender_name?: string | null;
	recipient: string;
	cc?: string | null;
	bcc?: string | null;
	date: string;
	/** Full body for R2 offload; not persisted in SQLite for new mail. */
	body?: string | null;
	/** Persisted list/search preview. */
	snippet?: string | null;
	/** Plain-text body for FTS; preferred over stripping `body` when provided. */
	search_text?: string | null;
	read?: boolean;
	starred?: boolean;
	in_reply_to?: string | null;
	email_references?: string | null;
	thread_id?: string | null;
	message_id?: string | null;
	raw_headers?: string | null;
	provider_message_id?: string | null;
	delivery_status?: DeliveryStatus | null;
	delivery_error?: string | null;
}

interface AttachmentData {
	id: string;
	email_id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id?: string | null;
	disposition?: string | null;
}

export class MailboxDO extends DurableObject<Env> {
	declare __DURABLE_OBJECT_BRAND: never;
	db: ReturnType<typeof drizzle>;
	#subscribers: Set<ReadableStreamDefaultController> = new Set();

	subscribeEvents(): ReadableStream {
		let controller: ReadableStreamDefaultController;
		return new ReadableStream({
			start: (c) => {
				controller = c;
				this.#subscribers.add(c);
				c.enqueue(new TextEncoder().encode("event: connected\ndata: {}\n\n"));
			},
			cancel: () => {
				if (controller) {
					this.#subscribers.delete(controller);
				}
			},
		});
	}

	broadcastEvent(event: string, data: any) {
		const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
		const encoded = new TextEncoder().encode(payload);
		for (const controller of this.#subscribers) {
			try {
				controller.enqueue(encoded);
			} catch {
				this.#subscribers.delete(controller);
			}
		}
	}

	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
		this.db = drizzle(this.ctx.storage, { schema });
		applyMigrations(this.ctx.storage.sql, mailboxMigrations, this.ctx.storage);
		this.#backfillSenderNames();
		this.#scheduleFtsBackfill();
	}

	/** Incremental R2 → FTS indexing for mail created before FTS existed. */
	async alarm(): Promise<void> {
		await this.#runFtsBackfillBatch();
	}

	/**
	 * Recover display names for mail stored before `sender_name` existed.
	 * Runs once per mailbox; later rows are populated at ingest.
	 */
	#backfillSenderNames() {
		try {
			const sql = this.ctx.storage.sql;
			const applied = [
				...sql.exec(
					`SELECT 1 FROM d1_migrations WHERE name = ?`,
					"js_backfill_sender_names",
				),
			];
			if (applied.length > 0) return;

			this.ctx.storage.transactionSync(() => {
				const rows = [
					...sql.exec(
						`SELECT id, raw_headers FROM emails
						 WHERE raw_headers IS NOT NULL AND raw_headers != ''
						   AND (sender_name IS NULL OR sender_name = '')`,
					),
				] as { id: string; raw_headers: string }[];

				for (const row of rows) {
					const name = senderNameFromRawHeaders(row.raw_headers);
					if (name) {
						sql.exec(
							`UPDATE emails SET sender_name = ?1 WHERE id = ?2`,
							name,
							row.id,
						);
					}
				}

				sql.exec(
					`INSERT INTO d1_migrations (name) VALUES ('js_backfill_sender_names')`,
				);
			});
		} catch (e) {
			console.error("sender_name backfill failed:", (e as Error).message);
		}
	}

	#isFtsBackfillDone(): boolean {
		try {
			const applied = [
				...this.ctx.storage.sql.exec(
					`SELECT 1 FROM d1_migrations WHERE name = ?`,
					FTS_BACKFILL_MIGRATION,
				),
			];
			return applied.length > 0;
		} catch {
			return false;
		}
	}

	#markFtsBackfillDone(): void {
		this.ctx.storage.sql.exec(
			`INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)`,
			FTS_BACKFILL_MIGRATION,
		);
	}

	/** Kick off (or continue) FTS backfill without blocking the constructor. */
	#scheduleFtsBackfill(): void {
		if (this.#isFtsBackfillDone()) return;
		try {
			void this.ctx.storage.setAlarm(Date.now() + 50);
		} catch (e) {
			console.error("FTS backfill schedule failed:", (e as Error).message);
		}
	}

	#upsertEmailFts(fields: FtsEmailFields): void {
		const recipients = formatFtsRecipients(
			fields.recipient,
			fields.cc,
			fields.bcc,
		);
		// DELETE+INSERT must be atomic: a failed INSERT after DELETE would leave
		// the row unsearchable, and post-backfill alarms would not retry it.
		this.ctx.storage.transactionSync(() => {
			this.ctx.storage.sql.exec(
				`DELETE FROM emails_fts WHERE id = ?1`,
				fields.id,
			);
			this.ctx.storage.sql.exec(
				`INSERT INTO emails_fts(id, subject, sender, sender_name, recipients, body_text)
				 VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
				fields.id,
				fields.subject ?? "",
				fields.sender ?? "",
				fields.sender_name ?? "",
				recipients,
				fields.body_text ?? "",
			);
		});
	}

	#deleteEmailFts(id: string): void {
		this.ctx.storage.sql.exec(`DELETE FROM emails_fts WHERE id = ?1`, id);
	}

	async #runFtsBackfillBatch(): Promise<void> {
		if (this.#isFtsBackfillDone()) return;

		try {
			const rows = [
				...this.ctx.storage.sql.exec(
					`SELECT e.id as id, e.subject as subject, e.sender as sender,
					        e.sender_name as sender_name, e.recipient as recipient,
					        e.cc as cc, e.bcc as bcc, e.body as body, e.snippet as snippet
					 FROM emails e
					 LEFT JOIN emails_fts f ON f.id = e.id
					 WHERE f.id IS NULL
					 ORDER BY e.date DESC
					 LIMIT ?1`,
					FTS_BACKFILL_BATCH_SIZE,
				),
			] as {
				id: string;
				subject: string | null;
				sender: string | null;
				sender_name: string | null;
				recipient: string | null;
				cc: string | null;
				bcc: string | null;
				body: string | null;
				snippet: string | null;
			}[];

			if (rows.length === 0) {
				this.#markFtsBackfillDone();
				return;
			}

			for (const row of rows) {
				let htmlOrText = row.body;
				if (htmlOrText == null || htmlOrText === "") {
					htmlOrText = await loadEmailBody(this.env.BUCKET, row.id);
				}
				const bodyText = htmlOrText
					? computeSearchText(htmlOrText)
					: computeSearchText(row.snippet ?? "");
				this.#upsertEmailFts({
					id: row.id,
					subject: row.subject,
					sender: row.sender,
					sender_name: row.sender_name,
					recipient: row.recipient,
					cc: row.cc,
					bcc: row.bcc,
					body_text: bodyText,
				});
			}

			const remaining = [
				...this.ctx.storage.sql.exec(
					`SELECT 1 as one
					 FROM emails e
					 LEFT JOIN emails_fts f ON f.id = e.id
					 WHERE f.id IS NULL
					 LIMIT 1`,
				),
			];
			if (remaining.length === 0) {
				this.#markFtsBackfillDone();
			} else {
				await this.ctx.storage.setAlarm(Date.now() + 250);
			}
		} catch (e) {
			console.error("FTS backfill batch failed:", (e as Error).message);
			try {
				await this.ctx.storage.setAlarm(Date.now() + 5_000);
			} catch {
				/* ignore reschedule failure */
			}
		}
	}

	/**
	 * Flag list/search rows that have a file attachment (this message or
	 * another in the same thread). Kept as a follow-up query so the thread
	 * list SQL stays the same shape that production already runs.
	 */
	#withFileAttachmentFlag<T extends { id: string; thread_id?: string | null }>(
		rows: T[],
	): (T & { has_attachment: boolean })[] {
		if (rows.length === 0) return rows.map((row) => ({ ...row, has_attachment: false }));

		try {
			const emailIds = rows.map((row) => row.id);
			const threadIds = [
				...new Set(rows.map((row) => row.thread_id).filter((id): id is string => !!id)),
			];
			const params = [...emailIds, ...threadIds];
			const emailPlaceholders = emailIds.map((_, i) => `?${i + 1}`).join(",");
			const threadClause =
				threadIds.length > 0
					? `OR e.thread_id IN (${threadIds.map((_, i) => `?${emailIds.length + i + 1}`).join(",")})`
					: "";

			const attached = [
				...this.ctx.storage.sql.exec(
					`SELECT DISTINCT e.id as email_id, e.thread_id as thread_id
					 FROM emails e
					 INNER JOIN attachments a ON a.email_id = e.id
					 WHERE COALESCE(a.disposition, '') != 'inline'
					   AND (e.id IN (${emailPlaceholders}) ${threadClause})`,
					...params,
				),
			] as { email_id: string; thread_id: string | null }[];

			const attachedEmailIds = new Set(attached.map((row) => row.email_id));
			const attachedThreadIds = new Set(
				attached.map((row) => row.thread_id).filter((id): id is string => !!id),
			);

			return rows.map((row) => ({
				...row,
				has_attachment:
					attachedEmailIds.has(row.id) ||
					(!!row.thread_id && attachedThreadIds.has(row.thread_id)),
			}));
		} catch (e) {
			console.error("has_attachment lookup failed:", (e as Error).message);
			return rows.map((row) => ({ ...row, has_attachment: false }));
		}
	}

	// ── Email CRUD (Drizzle) ───────────────────────────────────────

	async getEmails(options: GetEmailsOptions = {}) {
		const {
			folder,
			thread_id,
			page = 1,
			limit: rawLimit = 25,
			sortColumn: rawSortColumn = "date",
			sortDirection = "DESC",
		} = options;

		// Cap pagination limit to prevent unbounded queries
		const limit = Math.min(Math.max(rawLimit, 1), 100);

		const sortColumn: SortColumn = ALLOWED_SORT_COLUMNS.includes(
			rawSortColumn as SortColumn,
		)
			? rawSortColumn
			: "date";

		const offset = (page - 1) * limit;

		const conditions: SQL[] = [];
		if (folder) {
			conditions.push(
				sql`${schema.emails.folder_id} = (SELECT id FROM folders WHERE name = ${folder} OR id = ${folder} LIMIT 1)`,
			);
		}
		if (thread_id) {
			conditions.push(eq(schema.emails.thread_id, thread_id));
		}

		const orderCol = SORT_COLUMN_MAP[sortColumn];
		const orderDir = sortDirection === "ASC" ? asc(orderCol) : desc(orderCol);

		const result = this.db
			.select({
				id: schema.emails.id,
				subject: schema.emails.subject,
				sender: schema.emails.sender,
				sender_name: schema.emails.sender_name,
				recipient: schema.emails.recipient,
				cc: schema.emails.cc,
				bcc: schema.emails.bcc,
				date: schema.emails.date,
				read: schema.emails.read,
				starred: schema.emails.starred,
				in_reply_to: schema.emails.in_reply_to,
				email_references: schema.emails.email_references,
				thread_id: schema.emails.thread_id,
				folder_id: schema.emails.folder_id,
				provider_message_id: schema.emails.provider_message_id,
				delivery_status: schema.emails.delivery_status,
				delivery_error: schema.emails.delivery_error,
				snippet: schema.emails.snippet,
			})
			.from(schema.emails)
			.where(conditions.length > 0 ? and(...conditions) : undefined)
			.orderBy(orderDir)
			.limit(limit)
			.offset(offset)
			.all();

		return this.#withFileAttachmentFlag(
			result.map((email) => ({
				...email,
				read: !!email.read,
				starred: !!email.starred,
			})),
		);
	}

	/**
	 * People I've emailed: unique recipients from recent Sent mail,
	 * ranked by most recent, optionally filtered by `q`.
	 */
	async listRecentRecipients(options: { q?: string; limit?: number } = {}) {
		const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
		const scanLimit = 200;

		const sentRows = [
			...this.ctx.storage.sql.exec(
				`SELECT recipient, cc, bcc, date
				 FROM emails
				 WHERE folder_id = ${SENT_FOLDER_ID_SQL}
				 ORDER BY date DESC
				 LIMIT ?`,
				scanLimit,
			),
		] as {
			recipient: string | null;
			cc: string | null;
			bcc: string | null;
			date: string | null;
		}[];

		const knownNames = new Map<string, string>();
		try {
			const nameRows = [
				...this.ctx.storage.sql.exec(
					`SELECT LOWER(TRIM(sender)) AS email, sender_name AS name
					 FROM emails
					 WHERE sender IS NOT NULL
					   AND TRIM(sender) != ''
					   AND sender_name IS NOT NULL
					   AND TRIM(sender_name) != ''
					 GROUP BY LOWER(TRIM(sender))
					 ORDER BY MAX(date) DESC
					 LIMIT 500`,
				),
			] as { email: string; name: string }[];
			for (const row of nameRows) {
				if (row.email && row.name && !knownNames.has(row.email)) {
					knownNames.set(row.email, row.name);
				}
			}
		} catch (e) {
			console.error("known sender names lookup failed:", (e as Error).message);
		}

		return aggregateRecentRecipients(sentRows, {
			q: options.q,
			limit,
			knownNames,
		});
	}

	/**
	 * Count total emails matching the given filters (for pagination).
	 */
	async countEmails(options: { folder?: string; thread_id?: string } = {}) {
		const { folder, thread_id } = options;
		const conditions: string[] = [];
		const params: (string | number)[] = [];

		if (folder) {
			conditions.push(
				"folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)",
			);
			params.push(folder);
		}

		if (thread_id) {
			conditions.push(`thread_id = ?${params.length + 1}`);
			params.push(thread_id);
		}

		const where =
			conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const row = [
			...this.ctx.storage.sql.exec(
				`SELECT COUNT(*) as total FROM emails ${where}`,
				...params,
			),
		][0] as { total: number } | undefined;

		return row?.total ?? 0;
	}

	// ── Threaded queries (raw SQL — too complex for Drizzle's builder) ──

	async getThreadedEmails(options: GetEmailsOptions = {}) {
		const {
			folder,
			page = 1,
			limit: rawLimit = 25,
		} = options;
		const limit = Math.min(Math.max(rawLimit, 1), 100);

		if (!folder) {
			// Fallback to regular getEmails if no folder specified
			return this.getEmails(options);
		}

		const offset = (page - 1) * limit;

		// Thread grouping strategy:
		// For DRAFT folder: group by in_reply_to (the email being replied to).
		//   This ensures reply-drafts to different emails stay separate, even if
		//   they share a thread_id or subject. New drafts (no in_reply_to) each
		//   get their own group via their unique id.
		// For other folders:
		//   1. Primary: group by thread_id (from email threading headers)
		//   2. Fallback: group by normalized subject (strips Re:/Fwd:/FW: prefixes)
		//      for legacy emails that lack threading headers (thread_id IS NULL).
		const isDraftFolder = folder === Folders.DRAFT;

		if (isDraftFolder) {
			const result = this.ctx.storage.sql.exec(
				`WITH
				folder_emails AS (
					SELECT *,
						COALESCE(in_reply_to, id) as draft_group_key
					FROM emails
					WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
				),
				draft_stats AS (
					SELECT
						draft_group_key,
						COUNT(*) as thread_count,
						0 as thread_unread_count,
						GROUP_CONCAT(DISTINCT COALESCE(NULLIF(TRIM(sender_name), ''), sender)) as participants
					FROM folder_emails
					GROUP BY draft_group_key
				),
				latest_per_group AS (
					SELECT
						fe.*,
						ROW_NUMBER() OVER (
							PARTITION BY fe.draft_group_key
							ORDER BY fe.date DESC
						) as rn
					FROM folder_emails fe
				)
				SELECT
					lp.id, lp.subject, lp.sender, lp.sender_name, lp.recipient, lp.date,
					lp.read, lp.starred, lp.thread_id, lp.folder_id,
					lp.in_reply_to, lp.email_references,
					lp.provider_message_id, lp.delivery_status, lp.delivery_error,
					lp.snippet as snippet,
					ds.thread_count, ds.thread_unread_count, ds.participants
				FROM latest_per_group lp
				JOIN draft_stats ds ON lp.draft_group_key = ds.draft_group_key
				WHERE lp.rn = 1
				ORDER BY lp.date DESC
				LIMIT ?2 OFFSET ?3`,
				folder, limit, offset
			);

			const rows = [...result];
			return this.#withFileAttachmentFlag(
				rows.map((row: any) => ({
					...row,
					read: !!row.read,
					starred: !!row.starred,
					thread_count: row.thread_count || 1,
					thread_unread_count: row.thread_unread_count || 0,
					participants: row.participants || row.sender,
				})),
			);
		}

		// Non-draft folders: full threading logic
		const result = this.ctx.storage.sql.exec(
			`WITH
			folder_emails AS (
				SELECT *,
					COALESCE(thread_id, id) as raw_thread_id,
					${NORMALIZED_SUBJECT_SQL} as normalized_subject
				FROM emails
				WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
			),
			thread_to_conversation AS (
				SELECT
					raw_thread_id,
					normalized_subject,
					CASE
						WHEN thread_id IS NOT NULL THEN raw_thread_id
						ELSE MIN(raw_thread_id) OVER (PARTITION BY normalized_subject)
					END as conversation_id
				FROM folder_emails
				GROUP BY raw_thread_id, normalized_subject, thread_id
			),
			all_emails_with_conversation AS (
				SELECT
					e.*,
					COALESCE(tc.conversation_id, COALESCE(e.thread_id, e.id)) as conversation_id
				FROM emails e
				LEFT JOIN thread_to_conversation tc
					ON COALESCE(e.thread_id, e.id) = tc.raw_thread_id
			),
			conversation_stats AS (
				SELECT
					conversation_id,
					COUNT(*) as thread_count,
					SUM(CASE WHEN read = 0 AND folder_id != ${DRAFT_FOLDER_ID_SQL} THEN 1 ELSE 0 END) as thread_unread_count,
					SUM(CASE WHEN read = 1 THEN 1 ELSE 0 END) as thread_read_count,
					GROUP_CONCAT(DISTINCT COALESCE(NULLIF(TRIM(sender_name), ''), sender)) as participants,
					SUM(CASE WHEN folder_id = ${DRAFT_FOLDER_ID_SQL} THEN 1 ELSE 0 END) as has_draft
				FROM all_emails_with_conversation
				WHERE conversation_id IN (
					SELECT DISTINCT conversation_id FROM all_emails_with_conversation
					WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
				)
				GROUP BY conversation_id
			),
			latest_message_per_conversation AS (
				SELECT
					conversation_id,
					folder_id,
					ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY date DESC) as rn
				FROM all_emails_with_conversation
			),
			latest_in_folder AS (
				SELECT
					fe.*,
					COALESCE(tc.conversation_id, fe.raw_thread_id) as conversation_id,
					ROW_NUMBER() OVER (
						PARTITION BY COALESCE(tc.conversation_id, fe.raw_thread_id)
						ORDER BY fe.date DESC
					) as rn
				FROM folder_emails fe
				LEFT JOIN thread_to_conversation tc
					ON fe.raw_thread_id = tc.raw_thread_id
			)
			SELECT
				lif.id, lif.subject, lif.sender, lif.sender_name, lif.recipient, lif.date,
				lif.read, lif.starred, lif.thread_id, lif.folder_id,
				lif.in_reply_to, lif.email_references,
				lif.provider_message_id, lif.delivery_status, lif.delivery_error,
				lif.snippet as snippet,
				cs.thread_count, cs.thread_unread_count, cs.participants,
				CASE WHEN lmc.folder_id != ${SENT_FOLDER_ID_SQL}
					AND lmc.folder_id != ${DRAFT_FOLDER_ID_SQL}
					AND cs.thread_read_count > 0
					THEN 1 ELSE 0 END as needs_reply,
				CASE WHEN cs.has_draft > 0 THEN 1 ELSE 0 END as has_draft
			FROM latest_in_folder lif
			JOIN conversation_stats cs ON lif.conversation_id = cs.conversation_id
			LEFT JOIN latest_message_per_conversation lmc
				ON lmc.conversation_id = lif.conversation_id AND lmc.rn = 1
			WHERE lif.rn = 1
			ORDER BY lif.date DESC
			LIMIT ?2 OFFSET ?3`,
			folder, limit, offset
		);

		const rows = [...result];
		return this.#withFileAttachmentFlag(
			rows.map((row: any) => ({
				...row,
				read: !!row.read,
				starred: !!row.starred,
				thread_count: row.thread_count || 1,
				thread_unread_count: row.thread_unread_count || 0,
				participants: row.participants || row.sender,
				needs_reply: !!row.needs_reply,
				has_draft: !!row.has_draft,
			})),
		);
	}

	/**
	 * Count threaded conversations in a folder (for pagination).
	 * Returns the number of conversation groups, not individual emails.
	 */
	async countThreadedEmails(folder: string) {
		const isDraftFolder = folder === Folders.DRAFT;

		if (isDraftFolder) {
			const row = [
				...this.ctx.storage.sql.exec(
					`SELECT COUNT(DISTINCT COALESCE(in_reply_to, id)) as total
					 FROM emails
					 WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)`,
					folder,
				),
			][0] as { total: number } | undefined;
			return row?.total ?? 0;
		}

		const row = [
			...this.ctx.storage.sql.exec(
				`WITH
				folder_emails AS (
					SELECT
						COALESCE(thread_id, id) as raw_thread_id,
						thread_id,
					${NORMALIZED_SUBJECT_SQL} as normalized_subject
					FROM emails
					WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
				),
				thread_to_conversation AS (
					SELECT
						raw_thread_id,
						CASE
							WHEN thread_id IS NOT NULL THEN raw_thread_id
							WHEN normalized_subject != '' THEN MIN(raw_thread_id) OVER (PARTITION BY normalized_subject)
							ELSE raw_thread_id
						END as conversation_id
					FROM folder_emails
					GROUP BY raw_thread_id, normalized_subject, thread_id
				)
				SELECT COUNT(DISTINCT conversation_id) as total
				FROM thread_to_conversation`,
				folder,
			),
		][0] as { total: number } | undefined;
		return row?.total ?? 0;
	}

	// ── Single email operations (Drizzle) ──────────────────────────

	async getEmail(id: string) {
		const email = this.db
			.select()
			.from(schema.emails)
			.where(eq(schema.emails.id, id))
			.get();

		if (!email) return null;

		const emailAttachments = this.db
			.select()
			.from(schema.attachments)
			.where(eq(schema.attachments.email_id, id))
			.all();

		const body = await this.#hydrateBody(id, email.body, email.snippet);

		return {
			...email,
			body,
			read: !!email.read,
			starred: !!email.starred,
			attachments: emailAttachments,
		};
	}

	/**
	 * Fetch all emails in a thread with full bodies and attachments in
	 * two queries (one for emails, one for attachments) instead of
	 * N+1 individual getEmail calls.
	 */
	async getThreadEmails(threadId: string) {
		const emailRows = [
			...this.ctx.storage.sql.exec(
				`SELECT * FROM emails WHERE thread_id = ?1 ORDER BY date ASC`,
				threadId,
			),
		] as any[];

		if (emailRows.length === 0) return [];

		const emailIds = emailRows.map((e) => e.id as string);

		// Batch-fetch all attachments for the thread in a single query
		const placeholders = emailIds.map((_, i) => `?${i + 1}`).join(",");
		const attachmentRows = [
			...this.ctx.storage.sql.exec(
				`SELECT * FROM attachments WHERE email_id IN (${placeholders})`,
				...emailIds,
			),
		] as any[];

		// Group attachments by email_id
		const attachmentsByEmail = new Map<string, any[]>();
		for (const att of attachmentRows) {
			const list = attachmentsByEmail.get(att.email_id) || [];
			list.push(att);
			attachmentsByEmail.set(att.email_id, list);
		}

		return await Promise.all(
			emailRows.map(async (email) => ({
				...email,
				body: await this.#hydrateBody(email.id, email.body, email.snippet),
				read: !!email.read,
				starred: !!email.starred,
				attachments: attachmentsByEmail.get(email.id) || [],
			})),
		);
	}

	async updateEmail(
		id: string,
		{ read, starred }: { read?: boolean; starred?: boolean },
	) {
		const data: { read?: number; starred?: number } = {};
		if (read !== undefined) {
			data.read = read ? 1 : 0;
		}
		if (starred !== undefined) {
			data.starred = starred ? 1 : 0;
		}

		if (Object.keys(data).length === 0) {
			return this.getEmail(id);
		}

		this.db
			.update(schema.emails)
			.set(data)
			.where(eq(schema.emails.id, id))
			.run();

		this.broadcastEvent("email_updated", { id, read, starred });
		return this.getEmail(id);
	}

	async updateDraft(
		id: string,
		data: {
			subject: string;
			recipient: string;
			cc: string | null;
			bcc: string | null;
			body: string;
			date: string;
			in_reply_to: string | null;
			thread_id: string | null;
		},
	) {
		const existing = this.db
			.select({
				id: schema.emails.id,
				folder_id: schema.emails.folder_id,
				sender: schema.emails.sender,
				sender_name: schema.emails.sender_name,
			})
			.from(schema.emails)
			.where(eq(schema.emails.id, id))
			.get();

		if (!existing || existing.folder_id !== Folders.DRAFT) return null;

		const snippet = computeSnippet(data.body);
		await storeEmailContent(this.env.BUCKET, id, {
			htmlOrText: data.body,
			rawMime: buildSimpleMime(
				{
					to: data.recipient,
					cc: data.cc,
					bcc: data.bcc,
					subject: data.subject,
					date: data.date,
					inReplyTo: data.in_reply_to,
				},
				data.body,
			),
		});

		this.db
			.update(schema.emails)
			.set({
				subject: data.subject,
				recipient: data.recipient,
				cc: data.cc,
				bcc: data.bcc,
				body: null,
				snippet,
				date: data.date,
				in_reply_to: data.in_reply_to,
				thread_id: data.thread_id,
			})
			.where(eq(schema.emails.id, id))
			.run();

		this.#upsertEmailFts({
			id,
			subject: data.subject,
			sender: existing.sender,
			sender_name: existing.sender_name,
			recipient: data.recipient,
			cc: data.cc,
			bcc: data.bcc,
			body_text: computeSearchText(data.body),
		});

		this.broadcastEvent("email_updated", { id, folder_id: Folders.DRAFT });
		return this.getEmail(id);
	}

	async findEmailByMessageId(messageId: string) {
		const cleaned = messageId.trim().replace(/^<|>$/g, "");
		if (!cleaned) return null;
		return (
			this.db
				.select()
				.from(schema.emails)
				.where(eq(schema.emails.message_id, cleaned))
				.get() ?? null
		);
	}

	async findEmailByProviderMessageId(providerMessageId: string) {
		const cleaned = providerMessageId.trim();
		if (!cleaned) return null;
		return (
			this.db
				.select()
				.from(schema.emails)
				.where(eq(schema.emails.provider_message_id, cleaned))
				.get() ?? null
		);
	}

	async setDeliveryState(
		id: string,
		state: {
			providerMessageId?: string | null;
			status: DeliveryStatus;
			error?: string | null;
		},
	) {
		const data: {
			provider_message_id?: string | null;
			delivery_status: DeliveryStatus;
			delivery_error: string | null;
		} = {
			delivery_status: state.status,
			delivery_error: state.error ?? null,
		};
		if (state.providerMessageId !== undefined) {
			data.provider_message_id = state.providerMessageId;
		}

		this.db
			.update(schema.emails)
			.set(data)
			.where(eq(schema.emails.id, id))
			.run();

		this.broadcastEvent("email_updated", {
			id,
			provider_message_id: state.providerMessageId,
			delivery_status: state.status,
			delivery_error: state.error ?? null,
		});
		return this.getEmail(id);
	}

	async deleteDraftsForThread(threadId: string) {
		if (!threadId) return [];
		const rows = [
			...this.ctx.storage.sql.exec(
				`SELECT id FROM emails WHERE folder_id = ?1 AND thread_id = ?2`,
				Folders.DRAFT,
				threadId,
			),
		] as { id: string }[];
		const ids: string[] = [];
		for (const row of rows) {
			await this.deleteEmail(row.id);
			ids.push(row.id);
		}
		return ids;
	}

	async deleteSiblingDrafts(
		keepId: string,
		opts: { threadId?: string | null; inReplyTo?: string | null },
	) {
		const threadId = opts.threadId?.trim() || "";
		const inReplyTo = opts.inReplyTo?.trim() || "";
		if (!threadId && !inReplyTo) return [];

		const clauses: string[] = [];
		const params: string[] = [Folders.DRAFT, keepId];
		if (threadId) {
			clauses.push(`thread_id = ?${params.length + 1}`);
			params.push(threadId);
		}
		if (inReplyTo) {
			clauses.push(`in_reply_to = ?${params.length + 1}`);
			params.push(inReplyTo);
		}

		const rows = [
			...this.ctx.storage.sql.exec(
				`SELECT id FROM emails
				 WHERE folder_id = ?1 AND id != ?2 AND (${clauses.join(" OR ")})`,
				...params,
			),
		] as { id: string }[];
		const ids: string[] = [];
		for (const row of rows) {
			await this.deleteEmail(row.id);
			ids.push(row.id);
		}
		return ids;
	}

	async markThreadRead(threadId: string) {
		this.ctx.storage.sql.exec(
			`UPDATE emails SET read = 1 WHERE thread_id = ? AND read = 0`,
			threadId,
		);
		this.broadcastEvent("thread_read", { threadId });
		return { threadId, markedRead: true };
	}

	async deleteEmail(id: string) {
		const email = this.db
			.select({ id: schema.emails.id })
			.from(schema.emails)
			.where(eq(schema.emails.id, id))
			.get();

		if (!email) return null;

		const emailAttachments = this.db
			.select({
				id: schema.attachments.id,
				filename: schema.attachments.filename,
			})
			.from(schema.attachments)
			.where(eq(schema.attachments.email_id, id))
			.all();

		this.db
			.delete(schema.emails)
			.where(eq(schema.emails.id, id))
			.run();

		this.#deleteEmailFts(id);

		await deleteEmailContent(this.env.BUCKET, id);

		this.broadcastEvent("email_deleted", { id });
		return emailAttachments;
	}

	async getAttachment(id: string) {
		return (
			this.db
				.select()
				.from(schema.attachments)
				.where(eq(schema.attachments.id, id))
				.get() ?? null
		);
	}

	// ── Folders (Drizzle) ──────────────────────────────────────────

	async getFolders() {
		const result = this.db
			.select({
				id: schema.folders.id,
				name: schema.folders.name,
				unreadCount: sql<number>`COALESCE(SUM(CASE WHEN ${schema.emails.read} = 0 THEN 1 ELSE 0 END), 0)`.mapWith(Number),
			})
			.from(schema.folders)
			.leftJoin(schema.emails, eq(schema.emails.folder_id, schema.folders.id))
			.groupBy(schema.folders.id, schema.folders.name)
			.all();
		return result;
	}

	async createFolder(id: string, name: string, is_deletable: number = 1) {
		try {
			const result = this.db
				.insert(schema.folders)
				.values({ id, name, is_deletable })
				.returning({ id: schema.folders.id, name: schema.folders.name })
				.get();
			return { ...result, unreadCount: 0 };
		} catch (e: unknown) {
			if (e instanceof Error && e.message.includes("UNIQUE constraint failed")) {
				return null;
			}
			throw e;
		}
	}

	async updateFolder(id: string, name: string) {
		const result = this.db
			.update(schema.folders)
			.set({ name })
			.where(eq(schema.folders.id, id))
			.returning({ id: schema.folders.id, name: schema.folders.name })
			.get();
		return result;
	}

	async deleteFolder(id: string) {
		const folder = this.db
			.select({ is_deletable: schema.folders.is_deletable })
			.from(schema.folders)
			.where(eq(schema.folders.id, id))
			.get();

		if (!folder || folder.is_deletable === 0) {
			return false;
		}

		this.db
			.delete(schema.folders)
			.where(eq(schema.folders.id, id))
			.run();

		return true;
	}

	// ── Agent conversations (registry only; messages live in EmailAgent) ──

	async listAgentConversations() {
		return this.db
			.select({
				id: schema.agentConversations.id,
				title: schema.agentConversations.title,
				createdAt: schema.agentConversations.created_at,
				updatedAt: schema.agentConversations.updated_at,
				lastMessagePreview: schema.agentConversations.last_message_preview,
			})
			.from(schema.agentConversations)
			.orderBy(desc(schema.agentConversations.updated_at))
			.all();
	}

	async createAgentConversation(options: {
		id?: string;
		title?: string;
		lastMessagePreview?: string | null;
	} = {}) {
		const now = new Date().toISOString();
		const id = (options.id || crypto.randomUUID()).trim();
		const title = (options.title || "New chat").trim() || "New chat";

		const existing = await this.getAgentConversation(id);
		if (existing) {
			if (options.title || options.lastMessagePreview !== undefined) {
				return (
					(await this.updateAgentConversation(id, {
						title: options.title,
						lastMessagePreview: options.lastMessagePreview,
					})) ?? existing
				);
			}
			return existing;
		}

		try {
			return this.db
				.insert(schema.agentConversations)
				.values({
					id,
					title,
					created_at: now,
					updated_at: now,
					last_message_preview: options.lastMessagePreview ?? null,
				})
				.returning({
					id: schema.agentConversations.id,
					title: schema.agentConversations.title,
					createdAt: schema.agentConversations.created_at,
					updatedAt: schema.agentConversations.updated_at,
					lastMessagePreview: schema.agentConversations.last_message_preview,
				})
				.get();
		} catch {
			// Parallel creates with the same client id should reuse the winner.
			const raced = await this.getAgentConversation(id);
			if (raced) return raced;
			throw new Error(`Failed to create conversation ${id}`);
		}
	}

	async getAgentConversation(id: string) {
		return this.db
			.select({
				id: schema.agentConversations.id,
				title: schema.agentConversations.title,
				createdAt: schema.agentConversations.created_at,
				updatedAt: schema.agentConversations.updated_at,
				lastMessagePreview: schema.agentConversations.last_message_preview,
			})
			.from(schema.agentConversations)
			.where(eq(schema.agentConversations.id, id))
			.get();
	}

	async updateAgentConversation(
		id: string,
		updates: { title?: string; lastMessagePreview?: string | null },
	) {
		const existing = await this.getAgentConversation(id);
		if (!existing) return null;

		const now = new Date().toISOString();
		const result = this.db
			.update(schema.agentConversations)
			.set({
				title: updates.title?.trim() || existing.title,
				updated_at: now,
				last_message_preview:
					updates.lastMessagePreview !== undefined
						? updates.lastMessagePreview
						: existing.lastMessagePreview,
			})
			.where(eq(schema.agentConversations.id, id))
			.returning({
				id: schema.agentConversations.id,
				title: schema.agentConversations.title,
				createdAt: schema.agentConversations.created_at,
				updatedAt: schema.agentConversations.updated_at,
				lastMessagePreview: schema.agentConversations.last_message_preview,
			})
			.get();

		return result;
	}

	async deleteAgentConversation(id: string) {
		const existing = await this.getAgentConversation(id);
		if (!existing) return false;

		this.db
			.delete(schema.agentConversations)
			.where(eq(schema.agentConversations.id, id))
			.run();

		return true;
	}

	/**
	 * Ensure the reserved auto-draft conversation exists for this mailbox.
	 */
	async ensureAutoAgentConversation() {
		const existing = await this.getAgentConversation("auto");
		if (existing) return existing;
		return this.createAgentConversation({
			id: "auto",
			title: "Auto drafts",
		});
	}

	async moveEmail(id: string, folderId: string) {
		const folder = this.db
			.select({ id: schema.folders.id })
			.from(schema.folders)
			.where(eq(schema.folders.id, folderId))
			.get();

		if (!folder) return false;

		this.db
			.update(schema.emails)
			.set({ folder_id: folderId })
			.where(eq(schema.emails.id, id))
			.run();

		this.broadcastEvent("email_moved", { id, folder_id: folderId });
		return true;
	}

	// ── Search (raw SQL — dynamic condition builder) ───────────────

	/**
	 * Build JOIN / WHERE / ORDER BY fragments for search queries.
	 * Free-text uses FTS5 MATCH + bm25; structured filters stay on `emails`.
	 */
	#prepareSearchQuery(
		options: SearchFilterOptions,
		tableAlias = "e",
	): {
		ftsJoin: string;
		where: string;
		params: (string | number)[];
		orderBy: string;
	} {
		const {
			query,
			folder,
			from,
			to,
			subject,
			date_start,
			date_end,
			is_read,
			is_starred,
			has_attachment,
		} = options;
		const prefix = tableAlias ? `${tableAlias}.` : "";
		const conditions: string[] = [];
		const params: (string | number)[] = [];
		let paramIdx = 0;

		const addParam = (value: string | number) => {
			paramIdx++;
			params.push(value);
			return `?${paramIdx}`;
		};

		const ftsQuery = query ? sanitizeFtsQuery(query) : null;
		let ftsJoin = "";
		if (ftsQuery) {
			ftsJoin = `JOIN emails_fts ON emails_fts.id = ${prefix}id`;
			conditions.push(`emails_fts MATCH ${addParam(ftsQuery)}`);
		} else if (query && query.trim()) {
			// Free-text was provided but had no searchable tokens — match nothing.
			conditions.push("1 = 0");
		}

		if (folder) {
			const p = addParam(folder);
			conditions.push(
				`${prefix}folder_id = (SELECT id FROM folders WHERE name = ${p} OR id = ${p} LIMIT 1)`,
			);
		}
		if (from) {
			const p = addParam(`%${from}%`);
			conditions.push(
				`(${prefix}sender LIKE ${p} OR ${prefix}sender_name LIKE ${p})`,
			);
		}
		if (to) {
			const p = addParam(`%${to}%`);
			conditions.push(
				`(${prefix}recipient LIKE ${p} OR ${prefix}cc LIKE ${p} OR ${prefix}bcc LIKE ${p})`,
			);
		}
		if (subject) {
			const p = addParam(`%${subject}%`);
			conditions.push(`${prefix}subject LIKE ${p}`);
		}
		if (date_start) {
			const p = addParam(date_start);
			conditions.push(`${prefix}date >= ${p}`);
		}
		if (date_end) {
			const p = addParam(date_end);
			conditions.push(`${prefix}date <= ${p}`);
		}
		if (is_read !== undefined) {
			const p = addParam(is_read ? 1 : 0);
			conditions.push(`${prefix}read = ${p}`);
		}
		if (is_starred !== undefined) {
			const p = addParam(is_starred ? 1 : 0);
			conditions.push(`${prefix}starred = ${p}`);
		}
		if (has_attachment) {
			conditions.push(
				`${prefix}id IN (SELECT DISTINCT email_id FROM attachments)`,
			);
		}

		return {
			ftsJoin,
			where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
			params,
			orderBy: ftsQuery
				? `ORDER BY bm25(emails_fts) ASC, ${prefix}date DESC`
				: `ORDER BY ${prefix}date DESC`,
		};
	}

	async searchEmails(options: SearchFilterOptions & { page?: number; limit?: number }) {
		this.#scheduleFtsBackfill();

		const { page = 1, limit: rawLimit = 25 } = options;
		const limit = Math.min(Math.max(rawLimit, 1), 100);
		const { ftsJoin, where, params, orderBy } = this.#prepareSearchQuery(
			options,
			"e",
		);
		const offset = (page - 1) * limit;

		const query = `
			SELECT e.id, e.subject, e.sender, e.sender_name, e.recipient, e.cc, e.bcc, e.date,
				e.read, e.starred, e.in_reply_to, e.email_references,
				e.thread_id, e.folder_id,
				e.provider_message_id, e.delivery_status, e.delivery_error,
				e.snippet as snippet,
				f.name as folder_name
			FROM emails e
			${ftsJoin}
			LEFT JOIN folders f ON e.folder_id = f.id
			${where}
			${orderBy}
			LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`;
		params.push(limit, offset);

		const result = this.ctx.storage.sql.exec(query, ...params);
		return this.#withFileAttachmentFlag(
			[...result].map((row: any) => ({
				...row,
				read: !!row.read,
				starred: !!row.starred,
			})),
		);
	}

	/**
	 * Count total search results matching the given filters (for pagination).
	 */
	async countSearchResults(options: SearchFilterOptions) {
		this.#scheduleFtsBackfill();

		const { ftsJoin, where, params } = this.#prepareSearchQuery(options, "e");
		const query = `SELECT COUNT(*) as total FROM emails e ${ftsJoin} ${where}`;

		const row = [...this.ctx.storage.sql.exec(query, ...params)][0] as
			| { total: number }
			| undefined;
		return row?.total ?? 0;
	}

	// ── Threading helpers (raw SQL) ────────────────────────────────

	/**
	 * Find an existing thread_id by searching for any referenced RFC message-id or internal email id.
	 */
	async findThreadIdByReferences(references: string[]): Promise<string | null> {
		const cleaned = references
			.map((r) => r.trim().replace(/^<|>$/g, ""))
			.filter(Boolean);

		if (cleaned.length === 0) return null;

		// Limit to 50 candidate references to avoid SQLite query limit
		const refs = cleaned.slice(0, 50);
		const n = refs.length;
		const p1 = refs.map((_, i) => `?${i + 1}`).join(",");
		const p2 = refs.map((_, i) => `?${n + i + 1}`).join(",");

		const result = [
			...this.ctx.storage.sql.exec(
				`SELECT thread_id, id FROM emails
				 WHERE message_id IN (${p1}) OR id IN (${p2})
				 ORDER BY date DESC
				 LIMIT 1`,
				...refs,
				...refs,
			),
		] as { thread_id: string | null; id: string }[];

		if (result.length > 0 && result[0]) {
			return result[0].thread_id || result[0].id;
		}

		return null;
	}

	async findThreadBySubject(subject: string, senderAddress?: string): Promise<string | null> {
		const normalized = subject
			.replace(/^(?:(?:re|fwd?|fw|aw|wg|r[eé]f|sv)\s*:\s*)+/i, "")
			.trim()
			.toLowerCase();

		if (!normalized) return null;

		const result = this.ctx.storage.sql.exec(
			`SELECT thread_id, subject,
			        GROUP_CONCAT(DISTINCT LOWER(sender)) as senders,
			        GROUP_CONCAT(DISTINCT LOWER(recipient)) as recipients
			 FROM emails
			 WHERE thread_id IS NOT NULL
			   AND date >= datetime('now', '-7 days')
			 GROUP BY thread_id
			 ORDER BY MAX(date) DESC
			 LIMIT 50`,
		);

		const normalizedSender = senderAddress?.toLowerCase().trim();

		for (const row of result) {
			const rowSubject = String((row as any).subject || "")
				.replace(/^(?:(?:re|fwd?|fw|aw|wg|r[eé]f|sv)\s*:\s*)+/i, "")
				.trim()
				.toLowerCase();
			if (rowSubject !== normalized) continue;

			if (normalizedSender) {
				const threadSenders = String((row as any).senders || "");
				const threadRecipients = String((row as any).recipients || "");
				const allParticipants = `${threadSenders},${threadRecipients}`;
				if (!allParticipants.includes(normalizedSender)) {
					continue;
				}
			}

			return String((row as any).thread_id);
		}
		return null;
	}

	// ── Rate limiting (raw SQL) ────────────────────────────────────

	/**
	 * Check if the mailbox has exceeded the send rate limit.
	 * Limits: 20 emails per hour, 100 per day per mailbox.
	 * Returns null if under limit, or an error message string if exceeded.
	 */
	async checkSendRateLimit(): Promise<string | null> {
		const hourRow = [...this.ctx.storage.sql.exec(
			`SELECT COUNT(*) as cnt FROM emails
			 WHERE folder_id = ?1
			   AND date >= datetime('now', '-1 hour')`,
			Folders.SENT,
		)][0] as { cnt: number } | undefined;

		if ((hourRow?.cnt ?? 0) >= 20) {
			return "Rate limit exceeded: max 20 emails per hour per mailbox";
		}

		const dayRow = [...this.ctx.storage.sql.exec(
			`SELECT COUNT(*) as cnt FROM emails
			 WHERE folder_id = ?1
			   AND date >= datetime('now', '-1 day')`,
			Folders.SENT,
		)][0] as { cnt: number } | undefined;

		if ((dayRow?.cnt ?? 0) >= 100) {
			return "Rate limit exceeded: max 100 emails per day per mailbox";
		}

		return null;
	}

	/**
	 * Claim the once-per-sender auto-reply window. Returns false if this
	 * sender already received an auto-reply inside the window.
	 */
	async claimAutoReply(
		sender: string,
		windowMs: number = AUTO_REPLY_WINDOW_MS,
	): Promise<boolean> {
		const normalized = sender.trim().toLowerCase();
		if (!normalized) return false;
		const now = Date.now();
		return this.ctx.storage.transactionSync(() => {
			const existing = [
				...this.ctx.storage.sql.exec(
					`SELECT last_sent_at FROM auto_reply_receipts WHERE sender = ?1`,
					normalized,
				),
			][0] as { last_sent_at: number } | undefined;
			if (existing && now - Number(existing.last_sent_at) < windowMs) {
				return false;
			}
			this.ctx.storage.sql.exec(
				`INSERT INTO auto_reply_receipts (sender, last_sent_at) VALUES (?1, ?2)
				 ON CONFLICT(sender) DO UPDATE SET last_sent_at = excluded.last_sent_at`,
				normalized,
				now,
			);
			return true;
		});
	}

	/**
	 * Drop a claim so a failed send can retry. Must DELETE: setting
	 * last_sent_at to 0 would still look like a send inside the window.
	 */
	async releaseAutoReply(sender: string): Promise<void> {
		const normalized = sender.trim().toLowerCase();
		if (!normalized) return;
		this.ctx.storage.sql.exec(
			`DELETE FROM auto_reply_receipts WHERE sender = ?1`,
			normalized,
		);
	}

	// ── Email creation (Drizzle) ───────────────────────────────────

	async createEmail(
		folder: string,
		email: EmailData,
		attachments: AttachmentData[],
	) {
		// Resolve folder name or ID to the actual folder ID.
		const folderRow = this.db
			.select({ id: schema.folders.id })
			.from(schema.folders)
			.where(or(eq(schema.folders.id, folder), eq(schema.folders.name, folder)))
			.limit(1)
			.get();

		if (!folderRow) {
			throw new Error(
				`createEmail: folder "${folder}" not found. ` +
					"Ensure the folder exists before inserting an email.",
			);
		}

		const folderId = folderRow.id;
		const isOwnComposition =
			folderId === Folders.SENT || folderId === Folders.DRAFT;

		const snippet =
			email.snippet ?? (email.body ? computeSnippet(email.body) : null);
		// Callers should write R2 first; if body is still provided, offload here as a safety net.
		if (email.body) {
			await storeEmailContent(this.env.BUCKET, email.id, {
				htmlOrText: email.body,
				rawMime: buildSimpleMime(
					{
						from: email.sender_name
							? `${email.sender_name} <${email.sender}>`
							: email.sender,
						to: email.recipient,
						cc: email.cc,
						bcc: email.bcc,
						subject: email.subject,
						date: email.date,
						messageId: email.message_id,
						inReplyTo: email.in_reply_to,
					},
					email.body,
				),
			});
		}

		// Sent and draft emails are always read — the author already knows the content.
		// This prevents them from looking unread in lists or inflating thread_unread_count.
		this.db
			.insert(schema.emails)
			.values({
				id: email.id,
				folder_id: folderId,
				subject: email.subject,
				sender: email.sender,
				sender_name: email.sender_name ?? null,
				recipient: email.recipient,
				cc: email.cc ?? null,
				bcc: email.bcc ?? null,
				date: email.date,
				read: isOwnComposition ? 1 : (email.read ? 1 : 0),
				starred: email.starred ? 1 : 0,
				body: null,
				snippet,
				in_reply_to: email.in_reply_to ?? null,
				email_references: email.email_references ?? null,
				thread_id: email.thread_id ?? null,
				message_id: email.message_id ?? null,
				raw_headers: email.raw_headers ?? null,
				provider_message_id: email.provider_message_id ?? null,
				delivery_status: email.delivery_status ?? null,
				delivery_error: email.delivery_error ?? null,
			})
			.run();

		if (attachments.length > 0) {
			this.db.insert(schema.attachments).values(attachments).run();
		}

		const bodyText =
			email.search_text ??
			(email.body ? computeSearchText(email.body) : "");
		this.#upsertEmailFts({
			id: email.id,
			subject: email.subject,
			sender: email.sender,
			sender_name: email.sender_name,
			recipient: email.recipient,
			cc: email.cc,
			bcc: email.bcc,
			body_text: bodyText,
		});

		this.broadcastEvent("new_email", {
			id: email.id,
			folder_id: folderId,
			subject: email.subject,
			sender: email.sender,
			sender_name: email.sender_name ?? null,
			recipient: email.recipient,
			date: email.date,
			read: isOwnComposition ? true : !!email.read,
			starred: !!email.starred,
			snippet,
			thread_id: email.thread_id ?? null,
			provider_message_id: email.provider_message_id ?? null,
			delivery_status: email.delivery_status ?? null,
			delivery_error: email.delivery_error ?? null,
		});
	}

	/**
	 * Resolve full body from R2, with SQLite `body` as a legacy fallback.
	 * Lazily migrates legacy rows into R2 and clears the SQLite body column.
	 */
	async #hydrateBody(
		emailId: string,
		legacyBody: string | null | undefined,
		snippet: string | null | undefined,
	): Promise<string | null> {
		const fromR2 = await loadEmailBody(this.env.BUCKET, emailId);
		if (fromR2 != null) return fromR2;

		if (legacyBody == null || legacyBody === "") {
			return legacyBody ?? null;
		}

		await storeEmailContent(this.env.BUCKET, emailId, {
			htmlOrText: legacyBody,
		});
		const nextSnippet = snippet || computeSnippet(legacyBody);
		this.db
			.update(schema.emails)
			.set({ body: null, snippet: nextSnippet })
			.where(eq(schema.emails.id, emailId))
			.run();

		// Ensure FTS has body text when lazily migrating legacy SQLite bodies.
		const meta = this.db
			.select({
				subject: schema.emails.subject,
				sender: schema.emails.sender,
				sender_name: schema.emails.sender_name,
				recipient: schema.emails.recipient,
				cc: schema.emails.cc,
				bcc: schema.emails.bcc,
			})
			.from(schema.emails)
			.where(eq(schema.emails.id, emailId))
			.get();
		if (meta) {
			this.#upsertEmailFts({
				id: emailId,
				subject: meta.subject,
				sender: meta.sender,
				sender_name: meta.sender_name,
				recipient: meta.recipient,
				cc: meta.cc,
				bcc: meta.bcc,
				body_text: computeSearchText(legacyBody),
			});
		}

		return legacyBody;
	}

	// ── Push Notification Device Tokens ────────────────────────────

	async registerDeviceToken(token: string, platform = "ios") {
		this.ctx.storage.sql.exec(
			`INSERT INTO device_tokens (token, platform, updated_at)
			 VALUES (?, ?, datetime('now'))
			 ON CONFLICT(token) DO UPDATE SET
			   platform = excluded.platform,
			   updated_at = datetime('now');`,
			token,
			platform,
		);
		return { status: "registered" };
	}

	async unregisterDeviceToken(token: string) {
		this.ctx.storage.sql.exec(
			`DELETE FROM device_tokens WHERE token = ?;`,
			token,
		);
		return { status: "unregistered" };
	}

	async getDeviceTokens(): Promise<{ token: string; platform: string }[]> {
		const rows = [
			...this.ctx.storage.sql.exec(`SELECT token, platform FROM device_tokens;`),
		];
		return rows.map((r: any) => ({
			token: r.token as string,
			platform: (r.platform as string) || "ios",
		}));
	}

	// ── Inbox digest (in-time) ─────────────────────────────────────

	async getInboxDigest(greetingName: string): Promise<InboxDigest> {
		const emails = (await this.getThreadedEmails({
			folder: Folders.INBOX,
			page: 1,
			limit: 50,
		})) as DigestEmailRow[];

		const folders = await this.getFolders();
		const inbox = folders.find(
			(folder) => folder.id === Folders.INBOX || folder.name.toLowerCase() === "inbox",
		);
		const unreadCount = inbox?.unreadCount ?? 0;

		const dismissedRows = [
			...this.ctx.storage.sql.exec(`SELECT email_id FROM dismissed_todos;`),
		] as { email_id: string }[];
		const dismissedIds = new Set(dismissedRows.map((row) => row.email_id));

		const attachmentCounts = this.#attachmentCountsForEmails(emails.map((e) => e.id));

		return buildInboxDigest({
			emails,
			dismissedIds,
			unreadCount,
			greetingName,
			attachmentCounts,
		});
	}

	async completeDigestTodo(emailId: string) {
		const email = this.db
			.select({ id: schema.emails.id, thread_id: schema.emails.thread_id })
			.from(schema.emails)
			.where(eq(schema.emails.id, emailId))
			.get();
		if (!email) return null;

		this.ctx.storage.sql.exec(
			`INSERT INTO dismissed_todos (email_id, dismissed_at)
			 VALUES (?, ?)
			 ON CONFLICT(email_id) DO UPDATE SET dismissed_at = excluded.dismissed_at;`,
			emailId,
			Date.now(),
		);

		if (email.thread_id) {
			await this.markThreadRead(email.thread_id);
		} else {
			await this.updateEmail(emailId, { read: true });
		}

		this.broadcastEvent("digest_todo_completed", { emailId });
		return { status: "completed" as const };
	}

	async markDigestTopicRead(emailIds: string[]) {
		const unique = [...new Set(emailIds.filter(Boolean))];
		if (unique.length === 0) return { status: "marked_read" as const, count: 0 };

		let count = 0;
		for (const id of unique) {
			const email = this.db
				.select({ id: schema.emails.id, thread_id: schema.emails.thread_id })
				.from(schema.emails)
				.where(eq(schema.emails.id, id))
				.get();
			if (!email) continue;
			if (email.thread_id) {
				await this.markThreadRead(email.thread_id);
			} else {
				await this.updateEmail(id, { read: true });
			}
			count += 1;
		}
		this.broadcastEvent("digest_topic_read", { emailIds: unique });
		return { status: "marked_read" as const, count };
	}

	#attachmentCountsForEmails(emailIds: string[]): Map<string, number> {
		const counts = new Map<string, number>();
		if (emailIds.length === 0) return counts;
		try {
			const placeholders = emailIds.map((_, i) => `?${i + 1}`).join(",");
			const rows = [
				...this.ctx.storage.sql.exec(
					`SELECT email_id, COUNT(*) as count
					 FROM attachments
					 WHERE email_id IN (${placeholders})
					   AND COALESCE(disposition, '') != 'inline'
					 GROUP BY email_id`,
					...emailIds,
				),
			] as { email_id: string; count: number }[];
			for (const row of rows) {
				counts.set(row.email_id, Number(row.count) || 0);
			}
		} catch (e) {
			console.error("attachment count lookup failed:", (e as Error).message);
		}
		return counts;
	}
}
