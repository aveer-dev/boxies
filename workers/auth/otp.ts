// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Short-lived 6-digit codes, stored hashed in Better Auth's `verification`
 * table.
 *
 * Each purpose names exactly where its code may be sent, and the routes that
 * call `issueOtp` enforce it:
 * - `recovery-email`: the address the signed-in user wants as recovery email.
 * - `invite`: the invitee address on the invite.
 * - `password-reset`: the user's verified recovery email, never a mailbox.
 *
 * (Better Auth's emailOTP plugin is not used: its generic sign-in and reset
 * routes mail codes to `user.email`, which can be a shared mailbox.)
 */

import { and, eq, like, lt } from "drizzle-orm";
import type { AuthDb } from "./authz";
import * as schema from "./schema";

export type OtpPurpose = "recovery-email" | "invite" | "password-reset";

const OTP_TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
/** Re-sending inside this window keeps the code instead of minting a new one. */
const RESEND_COOLDOWN_MS = 60 * 1000;

type StoredOtp = { hash: string; attempts: number; target: string; issuedAt: number };

function identifier(purpose: OtpPurpose, subject: string): string {
	return `otp:${purpose}:${subject}`;
}

export async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomCode(): string {
	const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
	return n.toString().padStart(6, "0");
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

export type IssuedOtp =
	| { ok: true; code: string }
	| { ok: false; reason: "cooldown" };

/**
 * Mint a code for (`purpose`, `subject`), bound to `target` (the address it
 * is mailed to). Re-issuing replaces the previous code, except within the
 * resend cooldown for the same target.
 */
export async function issueOtp(
	db: AuthDb,
	purpose: OtpPurpose,
	subject: string,
	target: string,
	now = Date.now(),
): Promise<IssuedOtp> {
	const id = identifier(purpose, subject);
	const existing = await db
		.select()
		.from(schema.verification)
		.where(eq(schema.verification.identifier, id))
		.get();
	if (existing) {
		const stored = parseStored(existing.value);
		if (
			stored &&
			stored.target === target &&
			existing.expiresAt.getTime() > now &&
			now - stored.issuedAt < RESEND_COOLDOWN_MS
		) {
			return { ok: false, reason: "cooldown" };
		}
	}
	const code = randomCode();
	const value: StoredOtp = { hash: await sha256Hex(`${id}:${code}`), attempts: 0, target, issuedAt: now };
	await db.batch([
		db.delete(schema.verification).where(eq(schema.verification.identifier, id)),
		db.insert(schema.verification).values({
			id: crypto.randomUUID(),
			identifier: id,
			value: JSON.stringify(value),
			expiresAt: new Date(now + OTP_TTL_MS),
		}),
	]);
	return { ok: true, code };
}

function parseStored(raw: string): StoredOtp | null {
	try {
		const v = JSON.parse(raw) as StoredOtp;
		return typeof v.hash === "string" && typeof v.attempts === "number" ? v : null;
	} catch {
		return null;
	}
}

export type OtpCheck = { ok: true; target: string } | { ok: false };

/**
 * Check and consume a code. Wrong guesses count against the code; after
 * MAX_ATTEMPTS it is gone and a new one must be requested.
 */
export async function consumeOtp(
	db: AuthDb,
	purpose: OtpPurpose,
	subject: string,
	code: string,
	now = Date.now(),
): Promise<OtpCheck> {
	const id = identifier(purpose, subject);
	const row = await db
		.select()
		.from(schema.verification)
		.where(eq(schema.verification.identifier, id))
		.get();
	if (!row) return { ok: false };
	const stored = parseStored(row.value);
	if (!stored || row.expiresAt.getTime() <= now || stored.attempts >= MAX_ATTEMPTS) {
		await db.delete(schema.verification).where(eq(schema.verification.id, row.id));
		return { ok: false };
	}
	const guess = await sha256Hex(`${id}:${code.trim()}`);
	if (!timingSafeEqual(guess, stored.hash)) {
		const attempts = stored.attempts + 1;
		if (attempts >= MAX_ATTEMPTS) {
			await db.delete(schema.verification).where(eq(schema.verification.id, row.id));
		} else {
			await db
				.update(schema.verification)
				.set({ value: JSON.stringify({ ...stored, attempts }) })
				.where(eq(schema.verification.id, row.id));
		}
		return { ok: false };
	}
	// Delete-by-id so two concurrent correct guesses can't both win.
	const deleted = await db
		.delete(schema.verification)
		.where(eq(schema.verification.id, row.id))
		.returning({ id: schema.verification.id });
	return deleted.length > 0 ? { ok: true, target: stored.target } : { ok: false };
}

/** Single-use opaque tokens (password-reset links). Only the hash is stored. */
export async function issueLinkToken(
	db: AuthDb,
	purpose: string,
	payload: string,
	ttlMs: number,
	now = Date.now(),
): Promise<string> {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
	await db.insert(schema.verification).values({
		id: crypto.randomUUID(),
		identifier: `link:${purpose}:${await sha256Hex(token)}`,
		value: payload,
		expiresAt: new Date(now + ttlMs),
	});
	return token;
}

/** Redeem a link token once; returns its payload, or null. */
export async function consumeLinkToken(
	db: AuthDb,
	purpose: string,
	token: string,
	now = Date.now(),
): Promise<string | null> {
	if (!/^[0-9a-f]{64}$/.test(token)) return null;
	const deleted = await db
		.delete(schema.verification)
		.where(eq(schema.verification.identifier, `link:${purpose}:${await sha256Hex(token)}`))
		.returning({ value: schema.verification.value, expiresAt: schema.verification.expiresAt });
	const row = deleted[0];
	if (!row || row.expiresAt.getTime() <= now) return null;
	return row.value;
}

/** Drop every outstanding link token for `purpose` whose payload is `payload`. */
export async function revokeLinkTokens(db: AuthDb, purpose: string, payload: string): Promise<void> {
	await db
		.delete(schema.verification)
		.where(
			and(
				like(schema.verification.identifier, `link:${purpose}:%`),
				eq(schema.verification.value, payload),
			),
		);
}

/** Cron: remove expired codes and tokens (Better Auth's own rows included). */
export async function deleteExpiredVerifications(db: AuthDb, now = Date.now()): Promise<void> {
	await db.delete(schema.verification).where(lt(schema.verification.expiresAt, new Date(now)));
}
