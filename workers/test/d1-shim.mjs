/**
 * Minimal Cloudflare D1 binding backed by node:sqlite, for unit tests.
 * Implements what drizzle-orm/d1 uses: prepare/bind/all/raw/run/first, batch, exec.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const MIGRATIONS_DIR = new URL("../../migrations/auth/", import.meta.url).pathname;

function toSqlite(value) {
	if (value === undefined) return null;
	if (typeof value === "boolean") return value ? 1 : 0;
	if (value instanceof Date) return value.getTime();
	return value;
}

class Statement {
	constructor(db, sql, params = []) {
		this.db = db;
		this.sql = sql;
		this.params = params;
	}
	bind(...params) {
		return new Statement(this.db, this.sql, params.map(toSqlite));
	}
	#stmt() {
		return this.db.prepare(this.sql);
	}
	async all() {
		return { results: this.#stmt().all(...this.params), success: true, meta: {} };
	}
	async raw() {
		const stmt = this.#stmt();
		stmt.setReturnArrays(true);
		return stmt.all(...this.params);
	}
	async run() {
		const info = this.#stmt().run(...this.params);
		return {
			results: [],
			success: true,
			meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
		};
	}
	async first(column) {
		const row = this.#stmt().get(...this.params) ?? null;
		if (row && column) return row[column] ?? null;
		return row;
	}
}

/** A fresh in-memory AUTH_DB with every migration in migrations/auth applied. */
export function createTestD1() {
	const db = new DatabaseSync(":memory:");
	db.exec("PRAGMA foreign_keys = ON");
	for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
		db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8").replaceAll("--> statement-breakpoint", ""));
	}
	return {
		sqlite: db,
		prepare(sql) {
			return new Statement(db, sql);
		},
		async batch(statements) {
			db.exec("BEGIN");
			try {
				const out = [];
				for (const s of statements) out.push(await s.all());
				db.exec("COMMIT");
				return out;
			} catch (e) {
				db.exec("ROLLBACK");
				throw e;
			}
		},
		async exec(sql) {
			db.exec(sql);
			return { count: 0, duration: 0 };
		},
	};
}
