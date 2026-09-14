/**
 * SQLite FTS5 integration via system sqlite3 (node:sqlite lacks FTS5).
 * Covers deep-body match, reindex, delete, and structured AND filters.
 * Run: node --experimental-strip-types workers/test/email-fts-e2e.test.mjs
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	computeSearchText,
	formatFtsRecipients,
	sanitizeFtsQuery,
} from "../lib/email-fts.ts";

const dir = mkdtempSync(join(tmpdir(), "email-fts-"));
const dbPath = join(dir, "test.db");

function sql(statements) {
	return execFileSync("sqlite3", ["-batch", dbPath], {
		input: statements,
		encoding: "utf8",
	}).trim();
}

function sqlRows(statements) {
	const out = sql(statements);
	if (!out) return [];
	return out.split("\n").map((line) => {
		const [id, subject] = line.split("|");
		return { id, subject };
	});
}

try {
	sql(`
		CREATE TABLE emails (
			id TEXT PRIMARY KEY,
			folder_id TEXT NOT NULL,
			subject TEXT,
			sender TEXT,
			sender_name TEXT,
			recipient TEXT,
			cc TEXT,
			bcc TEXT,
			date TEXT,
			read INTEGER DEFAULT 0,
			starred INTEGER DEFAULT 0,
			snippet TEXT
		);
		CREATE VIRTUAL TABLE emails_fts USING fts5(
			id UNINDEXED,
			subject,
			sender,
			sender_name,
			recipients,
			body_text,
			tokenize = 'porter unicode61'
		);
	`);

	function upsertFts(row) {
		const recipients = formatFtsRecipients(row.recipient, row.cc, row.bcc);
		const esc = (v) => String(v ?? "").replace(/'/g, "''");
		sql(`
			DELETE FROM emails_fts WHERE id = '${esc(row.id)}';
			INSERT INTO emails_fts(id, subject, sender, sender_name, recipients, body_text)
			VALUES (
				'${esc(row.id)}',
				'${esc(row.subject)}',
				'${esc(row.sender)}',
				'${esc(row.sender_name)}',
				'${esc(recipients)}',
				'${esc(row.body_text)}'
			);
		`);
	}

	function deleteFts(id) {
		sql(`DELETE FROM emails_fts WHERE id = '${id.replace(/'/g, "''")}';`);
	}

	function search(query, { from } = {}) {
		const ftsQuery = sanitizeFtsQuery(query);
		assert.ok(ftsQuery, "expected sanitizable query");
		const esc = (v) => String(v).replace(/'/g, "''");
		const conditions = [`emails_fts MATCH '${esc(ftsQuery)}'`];
		if (from) {
			conditions.push(
				`(e.sender LIKE '%${esc(from)}%' OR e.sender_name LIKE '%${esc(from)}%')`,
			);
		}
		return sqlRows(`
			SELECT e.id, e.subject
			FROM emails e
			JOIN emails_fts ON emails_fts.id = e.id
			WHERE ${conditions.join(" AND ")}
			ORDER BY bm25(emails_fts) ASC, e.date DESC;
		`);
	}

	// Body past the 300-char snippet: unique token only in the deep body.
	const deepToken = "xylophone42unique";
	const deepBody =
		"A".repeat(350) +
		` Please review the ${deepToken} attachment details carefully.`;
	const snippet = deepBody.slice(0, 300);
	assert.ok(!snippet.includes(deepToken), "token must be past snippet");

	const emailId = "msg-deep-1";
	sql(`
		INSERT INTO emails(id, folder_id, subject, sender, sender_name, recipient, date, snippet)
		VALUES (
			'${emailId}',
			'inbox',
			'Quarterly report',
			'alice@example.com',
			'Alice',
			'bob@example.com',
			'2026-01-01',
			'${snippet.replace(/'/g, "''")}'
		);
	`);

	upsertFts({
		id: emailId,
		subject: "Quarterly report",
		sender: "alice@example.com",
		sender_name: "Alice",
		recipient: "bob@example.com",
		body_text: computeSearchText(`<p>${deepBody}</p>`),
	});

	// Deep-body free-text hit
	let hits = search(deepToken);
	assert.equal(hits.length, 1);
	assert.equal(hits[0].id, emailId);

	// Header still searchable
	hits = search("Quarterly");
	assert.equal(hits.length, 1);

	// Structured from: + free-text AND
	hits = search(deepToken, { from: "alice@example.com" });
	assert.equal(hits.length, 1);
	hits = search(deepToken, { from: "carol@example.com" });
	assert.equal(hits.length, 0);

	// Reindex via updateDraft-style rewrite
	upsertFts({
		id: emailId,
		subject: "Quarterly report",
		sender: "alice@example.com",
		sender_name: "Alice",
		recipient: "bob@example.com",
		body_text: computeSearchText("completely different body with zebra99token"),
	});
	hits = search(deepToken);
	assert.equal(hits.length, 0);
	hits = search("zebra99token");
	assert.equal(hits.length, 1);

	// Delete removes from FTS
	deleteFts(emailId);
	sql(`DELETE FROM emails WHERE id = '${emailId}';`);
	hits = search("zebra99token");
	assert.equal(hits.length, 0);

	// Backfill-shaped insert: index from R2-loaded HTML
	const legacyId = "msg-legacy-1";
	const legacyHtml = `<div>${"x".repeat(400)}<span>backfillneedle77</span></div>`;
	sql(`
		INSERT INTO emails(id, folder_id, subject, sender, recipient, date, snippet)
		VALUES (
			'${legacyId}',
			'inbox',
			'Legacy',
			'dan@example.com',
			'bob@example.com',
			'2026-02-01',
			'${legacyHtml.slice(0, 300).replace(/'/g, "''")}'
		);
	`);
	upsertFts({
		id: legacyId,
		subject: "Legacy",
		sender: "dan@example.com",
		recipient: "bob@example.com",
		body_text: computeSearchText(legacyHtml),
	});
	hits = search("backfillneedle77");
	assert.equal(hits.length, 1);
	assert.equal(hits[0].id, legacyId);

	console.log("email-fts-e2e tests passed");
} finally {
	rmSync(dir, { recursive: true, force: true });
}
