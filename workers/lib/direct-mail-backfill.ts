// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Fill in `emails.direct_mail` for rows stored before migration 45 (AVE-173).
 * Runs in batches from the mailbox alarm; each update marks its conversation
 * dirty (trigger in 45_direct_mail), so needs_reply follows on the next
 * conversation index flush. Sent and Draft rows are the user's own mail: 0.
 */

import { Folders } from "../../shared/folders.ts";
import { directMailFlagForStoredRow } from "./direct-mail.ts";

type Sql = Pick<SqlStorage, "exec">;

/** Rows per alarm batch. */
export const DIRECT_MAIL_BACKFILL_BATCH = 500;

export function hasPendingDirectMail(sql: Sql): boolean {
	return [...sql.exec(`SELECT 1 AS x FROM emails WHERE direct_mail IS NULL LIMIT 1`)].length > 0;
}

/**
 * Compute the flag for up to `limit` rows that lack it. Run inside a
 * transaction. Returns true when rows may be left.
 */
export function backfillDirectMailBatch(
	sql: Sql,
	ownAddresses: Array<string | null | undefined>,
	limit = DIRECT_MAIL_BACKFILL_BATCH,
): boolean {
	const rows = [
		...sql.exec(
			`SELECT id, folder_id, sender, raw_headers FROM emails WHERE direct_mail IS NULL LIMIT ?1`,
			Math.max(1, Math.floor(limit)),
		),
	] as Array<{ id: string; folder_id: string; sender: string | null; raw_headers: string | null }>;
	for (const row of rows) {
		const own = row.folder_id === Folders.SENT || row.folder_id === Folders.DRAFT;
		const flag = own ? 0 : directMailFlagForStoredRow(row, ownAddresses);
		sql.exec(`UPDATE emails SET direct_mail = ?1 WHERE id = ?2`, flag, row.id);
	}
	return rows.length === limit;
}
