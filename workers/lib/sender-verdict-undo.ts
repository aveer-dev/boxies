// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Retroactive rescue and refile, with Undo (AVE-98,
 * docs/spam-management-plan.md §5 "What the actions write", §7, §10
 * decision 2).
 *
 * - **Not spam** (any move out of Spam that teaches an allow) also moves
 *   the sender's other Spam messages from the last 30 days to their
 *   classified folder: the sender's purpose box when they have one, else the
 *   bulk / transactional box their headers point at, else Inbox. Mail that
 *   failed sender authentication stays in Spam (no allow overrides
 *   `failed`, §5 step 1).
 * - **Report spam** (any move into Spam) also moves the sender's Inbox /
 *   Promotions / Updates mail to Spam, unless the client unticks "Also move
 *   their other mail to Spam".
 * - Either way the move response carries `rescuedCount` (how many *other*
 *   messages moved) and an `undoToken`. `POST sender-rules/undo` puts the
 *   sender's triage row, purpose-box preference and address rule back as
 *   they were, and moves every message (the one the user moved too) back
 *   where it came from, unless it has been moved again since.
 *
 * Undo records live in the mailbox DO's `sender_verdict_undo` table
 * (migration `40_sender_verdict_undo`) for UNDO_TTL_MS. Expired rows are
 * swept on every write, so no alarm is needed. Only the newest verdict per
 * sender can be undone: an older snapshot would clobber the newer verdict.
 *
 * Raw SQL on `ctx.storage.sql`, so the same code runs in the DO and on
 * node:sqlite in tests. Callers run each entry point inside `transactionSync`.
 */

import { Folders, isPurposeFolderId, type PurposeFolderId } from "../../shared/folders.ts";
import { ClassificationReasons } from "../../shared/spam-reason.ts";
import { classifyFromHeaders } from "./classify-email.ts";
import { normalizeTriageSender } from "./sender-triage.ts";

type Sql = Pick<SqlStorage, "exec">;

/** Not spam rescues the sender's Spam received in this many days. */
export const RESCUE_WINDOW_DAYS = 30;
/** How long an undo token stays valid. Toasts show Undo for seconds; this is slack for slow networks. */
export const UNDO_TTL_MS = 10 * 60 * 1000;
/** At most this many other messages move per verdict (newest first). */
export const RETROACTIVE_MOVE_LIMIT = 500;

const PURPOSE_FOLDERS_SQL = `'${Folders.INBOX}', '${Folders.PROMOTIONS}', '${Folders.UPDATES}'`;

export type SenderVerdictKind = "allow" | "block";

type TriageRow = {
	sender: string;
	status: string;
	destination_folder_id: string | null;
	display_name: string | null;
	decided_at: string;
	updated_at: string;
};

type PreferenceRow = {
	address: string;
	folder_id: string;
	display_name: string | null;
	source: string;
	updated_at: string;
};

type RuleRow = {
	id: string;
	kind: string;
	value: string;
	verdict: string;
	source: string;
	created_at: string;
	updated_at: string;
	last_matched_at: string | null;
	match_count: number;
};

/** Everything a verdict overwrites about one sender, captured before it runs. */
export interface SenderVerdictState {
	sender: string;
	triage: TriageRow | null;
	preference: PreferenceRow | null;
	addressRule: RuleRow | null;
}

/** One message a verdict moved, with what Undo needs to put it back. */
export interface VerdictMove {
	id: string;
	from: string;
	to: string;
	/** Moving into Spam clears Reply later; Undo restores it. */
	replyLater?: boolean;
	replyLaterAt?: string | null;
}

export interface SenderVerdictUndoRecord {
	token: string;
	sender: string;
	kind: SenderVerdictKind;
	state: SenderVerdictState;
	moves: VerdictMove[];
}

function rows<T>(sql: Sql, query: string, ...bindings: unknown[]): T[] {
	return [...sql.exec(query, ...bindings)] as T[];
}

/** Lower-cased bare address, or null. */
function senderKey(raw: string | null | undefined): string | null {
	return normalizeTriageSender(raw);
}

/** Snapshot of the sender's triage row, purpose-box preference and address rule. */
export function captureSenderVerdictState(sql: Sql, rawSender: string): SenderVerdictState | null {
	const sender = senderKey(rawSender);
	if (!sender) return null;
	const triage =
		rows<TriageRow>(
			sql,
			`SELECT sender, status, destination_folder_id, display_name, decided_at, updated_at
			 FROM sender_triage WHERE sender = ?1`,
			sender,
		)[0] ?? null;
	const preference =
		rows<PreferenceRow>(
			sql,
			`SELECT address, folder_id, display_name, source, updated_at
			 FROM sender_preferences WHERE address = ?1`,
			sender,
		)[0] ?? null;
	const rule = rows<RuleRow>(
		sql,
		`SELECT id, kind, value, verdict, source, created_at, updated_at, last_matched_at, match_count
		 FROM sender_rules WHERE kind = 'address' AND value = ?1`,
		sender,
	)[0];
	return {
		sender,
		triage: triage ? { ...triage } : null,
		preference: preference ? { ...preference } : null,
		addressRule: rule ? { ...rule, match_count: Number(rule.match_count) || 0 } : null,
	};
}

/** Puts the sender's triage row, preference and address rule back exactly as captured. */
export function restoreSenderVerdictState(sql: Sql, state: SenderVerdictState): void {
	const { sender } = state;
	if (state.triage) {
		const t = state.triage;
		sql.exec(
			`INSERT OR REPLACE INTO sender_triage
			   (sender, status, destination_folder_id, display_name, decided_at, updated_at)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
			t.sender,
			t.status,
			t.destination_folder_id,
			t.display_name,
			t.decided_at,
			t.updated_at,
		);
	} else {
		sql.exec(`DELETE FROM sender_triage WHERE sender = ?1`, sender);
	}

	if (state.preference) {
		const p = state.preference;
		sql.exec(
			`INSERT OR REPLACE INTO sender_preferences (address, folder_id, display_name, source, updated_at)
			 VALUES (?1, ?2, ?3, ?4, ?5)`,
			p.address,
			p.folder_id,
			p.display_name,
			p.source,
			p.updated_at,
		);
	} else {
		sql.exec(`DELETE FROM sender_preferences WHERE address = ?1`, sender);
	}

	if (state.addressRule) {
		const r = state.addressRule;
		// OR REPLACE also drops a rule the verdict re-created under a new id.
		sql.exec(
			`INSERT OR REPLACE INTO sender_rules
			   (id, kind, value, verdict, source, created_at, updated_at, last_matched_at, match_count)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
			r.id,
			r.kind,
			r.value,
			r.verdict,
			r.source,
			r.created_at,
			r.updated_at,
			r.last_matched_at,
			r.match_count,
		);
	} else {
		sql.exec(`DELETE FROM sender_rules WHERE kind = 'address' AND value = ?1`, sender);
	}
}

type CandidateRow = {
	id: string;
	sender: string | null;
	folder_id: string;
	subject: string | null;
	raw_headers: string | null;
	auth_tier: string | null;
	classification_reason: string | null;
	reply_later: number | null;
	reply_later_at: string | null;
};

/**
 * Messages from `sender` in the given folders, newest first. The SQL match is
 * loose (display-name forms, LIKE wildcards); the exact address is checked here.
 */
function senderMessages(
	sql: Sql,
	sender: string,
	foldersSql: string,
	options: { excludeId?: string | null; since?: string | null },
): CandidateRow[] {
	const params: unknown[] = [sender];
	let where = `folder_id IN (${foldersSql})
	   AND (LOWER(TRIM(sender)) = ?1 OR instr(LOWER(sender), '<' || ?1 || '>') > 0)`;
	if (options.excludeId) {
		params.push(options.excludeId);
		where += ` AND id != ?${params.length}`;
	}
	if (options.since) {
		params.push(options.since);
		where += ` AND date >= ?${params.length}`;
	}
	// Over-fetch a little: the exact-address filter below can drop rows.
	params.push(RETROACTIVE_MOVE_LIMIT * 2);
	return rows<CandidateRow>(
		sql,
		`SELECT id, sender, folder_id, subject, raw_headers, auth_tier, classification_reason,
		        reply_later, reply_later_at
		 FROM emails
		 WHERE ${where}
		 ORDER BY date DESC
		 LIMIT ?${params.length}`,
		...params,
	)
		.filter((row) => senderKey(row.sender) === sender)
		.slice(0, RETROACTIVE_MOVE_LIMIT);
}

/** Mail that failed sender authentication stays in Spam whatever the user allowed. */
function failedAuth(row: Pick<CandidateRow, "auth_tier" | "classification_reason">): boolean {
	return row.auth_tier === "failed" || row.classification_reason === ClassificationReasons.AUTH_FAILED;
}

/**
 * Where a rescued Spam message goes: the sender's purpose box (preference,
 * then Screener destination), else the bulk / transactional box its headers
 * point at (ignoring the spam headers that put it in Spam), else Inbox.
 */
export function rescueFolderFor(input: {
	preferenceFolderId?: string | null;
	triageDestination?: string | null;
	rawHeaders?: string | null;
	subject?: string | null;
	sender?: string | null;
}): PurposeFolderId {
	if (input.preferenceFolderId && isPurposeFolderId(input.preferenceFolderId)) {
		return input.preferenceFolderId;
	}
	if (input.triageDestination && isPurposeFolderId(input.triageDestination)) {
		return input.triageDestination;
	}
	const byHeaders = classifyFromHeaders(
		{ headers: input.rawHeaders ?? null, subject: input.subject ?? "", sender: input.sender ?? "" },
		{ ignoreSpamHeaders: true },
	);
	if (byHeaders && isPurposeFolderId(byHeaders.folderId)) return byHeaders.folderId;
	return Folders.INBOX;
}

/**
 * Not spam: the sender's other Spam messages received since `now -
 * RESCUE_WINDOW_DAYS`, with the box each goes to. Reads the sender's
 * preference / triage as the allow left them. Doesn't write.
 */
export function planSpamRescue(
	sql: Sql,
	rawSender: string,
	options: { excludeId?: string | null; now?: number } = {},
): VerdictMove[] {
	const sender = senderKey(rawSender);
	if (!sender) return [];
	const now = options.now ?? Date.now();
	const since = new Date(now - RESCUE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
	const preference =
		rows<{ folder_id: string }>(sql, `SELECT folder_id FROM sender_preferences WHERE address = ?1`, sender)[0]
			?.folder_id ?? null;
	const triageDestination =
		rows<{ destination_folder_id: string | null }>(
			sql,
			`SELECT destination_folder_id FROM sender_triage WHERE sender = ?1 AND status = 'allowed'`,
			sender,
		)[0]?.destination_folder_id ?? null;
	return senderMessages(sql, sender, `'${Folders.SPAM}'`, { excludeId: options.excludeId, since })
		.filter((row) => !failedAuth(row))
		.map((row) => ({
			id: row.id,
			from: row.folder_id,
			to: rescueFolderFor({
				preferenceFolderId: preference,
				triageDestination,
				rawHeaders: row.raw_headers,
				subject: row.subject,
				sender: row.sender,
			}),
		}));
}

/** Report spam: the sender's Inbox / Promotions / Updates mail, all bound for Spam. Doesn't write. */
export function planSpamRefile(
	sql: Sql,
	rawSender: string,
	options: { excludeId?: string | null } = {},
): VerdictMove[] {
	const sender = senderKey(rawSender);
	if (!sender) return [];
	return senderMessages(sql, sender, PURPOSE_FOLDERS_SQL, { excludeId: options.excludeId }).map((row) => ({
		id: row.id,
		from: row.folder_id,
		to: Folders.SPAM,
		replyLater: Boolean(row.reply_later),
		replyLaterAt: row.reply_later_at ?? null,
	}));
}

/** Applies planned moves. Into Spam clears Reply later, as a single move does. Returns the moves that happened. */
export function applyVerdictMoves(sql: Sql, moves: VerdictMove[]): VerdictMove[] {
	const done: VerdictMove[] = [];
	for (const move of moves) {
		const changed =
			move.to === Folders.SPAM
				? rows<{ id: string }>(
						sql,
						`UPDATE emails SET folder_id = ?1, reply_later = 0, reply_later_at = NULL
						 WHERE id = ?2 AND folder_id = ?3 RETURNING id`,
						move.to,
						move.id,
						move.from,
					)
				: rows<{ id: string }>(
						sql,
						`UPDATE emails SET folder_id = ?1 WHERE id = ?2 AND folder_id = ?3 RETURNING id`,
						move.to,
						move.id,
						move.from,
					);
		if (changed.length > 0) done.push(move);
	}
	return done;
}

/**
 * Moves each message back where the verdict found it, when it's still where
 * the verdict put it (a later move by the user wins). Returns the reverted moves.
 */
export function revertVerdictMoves(sql: Sql, moves: VerdictMove[]): VerdictMove[] {
	const done: VerdictMove[] = [];
	for (const move of moves) {
		const changed =
			move.replyLater !== undefined
				? rows<{ id: string }>(
						sql,
						`UPDATE emails SET folder_id = ?1, reply_later = ?2, reply_later_at = ?3
						 WHERE id = ?4 AND folder_id = ?5 RETURNING id`,
						move.from,
						move.replyLater ? 1 : 0,
						move.replyLaterAt ?? null,
						move.id,
						move.to,
					)
				: rows<{ id: string }>(
						sql,
						`UPDATE emails SET folder_id = ?1 WHERE id = ?2 AND folder_id = ?3 RETURNING id`,
						move.from,
						move.id,
						move.to,
					);
		if (changed.length > 0) done.push(move);
	}
	return done;
}

function sweepExpiredUndo(sql: Sql, now: number): void {
	sql.exec(`DELETE FROM sender_verdict_undo WHERE expires_at <= ?1`, new Date(now).toISOString());
}

/** Stores an undo record and returns its token. Replaces any older one for the same sender. */
export function saveSenderVerdictUndo(
	sql: Sql,
	input: { kind: SenderVerdictKind; state: SenderVerdictState; moves: VerdictMove[] },
	options: { now?: number; token?: string } = {},
): string {
	const now = options.now ?? Date.now();
	sweepExpiredUndo(sql, now);
	sql.exec(`DELETE FROM sender_verdict_undo WHERE sender = ?1`, input.state.sender);
	const token = options.token ?? crypto.randomUUID();
	sql.exec(
		`INSERT INTO sender_verdict_undo (token, sender, kind, payload, created_at, expires_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
		token,
		input.state.sender,
		input.kind,
		JSON.stringify({ state: input.state, moves: input.moves }),
		new Date(now).toISOString(),
		new Date(now + UNDO_TTL_MS).toISOString(),
	);
	return token;
}

/** Deletes and returns a live undo record, or null when it's unknown, used or expired. */
export function takeSenderVerdictUndo(
	sql: Sql,
	token: string,
	options: { now?: number } = {},
): SenderVerdictUndoRecord | null {
	const now = options.now ?? Date.now();
	sweepExpiredUndo(sql, now);
	const row = rows<{ token: string; sender: string; kind: string; payload: string }>(
		sql,
		`SELECT token, sender, kind, payload FROM sender_verdict_undo WHERE token = ?1`,
		token,
	)[0];
	if (!row) return null;
	sql.exec(`DELETE FROM sender_verdict_undo WHERE token = ?1`, token);
	try {
		const payload = JSON.parse(row.payload) as { state: SenderVerdictState; moves: VerdictMove[] };
		return {
			token: row.token,
			sender: row.sender,
			kind: row.kind === "block" ? "block" : "allow",
			state: payload.state,
			moves: Array.isArray(payload.moves) ? payload.moves : [],
		};
	} catch {
		return null;
	}
}

/**
 * After a verdict has been written: move the sender's other mail (rescue for
 * `allow`, refile for `block` when `refile`), and store an undo record that
 * also covers `primary`, the message the user moved. Run in `transactionSync`.
 */
export function finishSenderVerdict(
	sql: Sql,
	input: {
		kind: SenderVerdictKind;
		state: SenderVerdictState;
		primary: VerdictMove;
		refile: boolean;
	},
	options: { now?: number; token?: string } = {},
): { rescued: VerdictMove[]; undoToken: string } {
	const planned =
		input.kind === "allow"
			? planSpamRescue(sql, input.state.sender, { excludeId: input.primary.id, now: options.now })
			: input.refile
				? planSpamRefile(sql, input.state.sender, { excludeId: input.primary.id })
				: [];
	const rescued = applyVerdictMoves(sql, planned);
	const undoToken = saveSenderVerdictUndo(
		sql,
		{ kind: input.kind, state: input.state, moves: [input.primary, ...rescued] },
		options,
	);
	return { rescued, undoToken };
}

/**
 * `POST sender-rules/undo`: restores the sender's rule, triage and
 * preference, and moves the messages back. Null when the token is unknown,
 * already used or expired. Run in `transactionSync`.
 */
export function undoSenderVerdict(
	sql: Sql,
	token: string,
	options: { now?: number } = {},
): { sender: string; kind: SenderVerdictKind; reverted: VerdictMove[] } | null {
	const record = takeSenderVerdictUndo(sql, token, options);
	if (!record) return null;
	restoreSenderVerdictState(sql, record.state);
	const reverted = revertVerdictMoves(sql, record.moves);
	return { sender: record.sender, kind: record.kind, reverted };
}
