// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Password reset tokens and 6-digit codes stored in R2.
 */

export const PASSWORD_RESET_TOKEN_PREFIX = "platform/password-resets/tokens/";
/**
 * One active reset per user. The 6-digit code is only checked against the
 * record for the user named by the email the caller supplies, so codes can't
 * be guessed across the whole user base, and a few wrong guesses burn it.
 */
export const PASSWORD_RESET_USER_PREFIX = "platform/password-resets/users/";

export const PASSWORD_RESET_TTL_SECONDS = 60 * 60; // 1 hour
export const PASSWORD_RESET_MAX_CODE_ATTEMPTS = 5;

export interface PasswordResetRecord {
	token: string;
	code: string;
	userId: string;
	email: string;
	expiresAt: string;
	createdAt: string;
	/** Wrong code guesses so far; the record is burned at the max. */
	attempts?: number;
}

function tokenKey(token: string): string {
	return `${PASSWORD_RESET_TOKEN_PREFIX}${token}.json`;
}

function userKey(userId: string): string {
	return `${PASSWORD_RESET_USER_PREFIX}${userId}.json`;
}

export function generateResetToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(24));
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateResetCode(): string {
	const array = new Uint32Array(1);
	crypto.getRandomValues(array);
	const num = 100000 + (array[0] % 900000);
	return num.toString();
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

function parseRecord(raw: unknown): PasswordResetRecord | null {
	if (
		typeof raw === "object" &&
		raw !== null &&
		"token" in raw &&
		"code" in raw &&
		"userId" in raw &&
		"expiresAt" in raw
	) {
		return raw as PasswordResetRecord;
	}
	return null;
}

async function readRecord(bucket: R2Bucket, key: string): Promise<PasswordResetRecord | null> {
	const obj = await bucket.get(key);
	if (!obj) return null;
	try {
		return parseRecord(await obj.json());
	} catch {
		return null;
	}
}

function isExpired(record: PasswordResetRecord): boolean {
	return Date.now() > new Date(record.expiresAt).getTime();
}

export async function createPasswordReset(
	bucket: R2Bucket,
	userId: string,
	email: string,
): Promise<PasswordResetRecord> {
	// A new request replaces any outstanding reset for this user.
	const previous = await readRecord(bucket, userKey(userId));
	if (previous) await consumePasswordReset(bucket, previous);

	const now = new Date();
	const record: PasswordResetRecord = {
		token: generateResetToken(),
		code: generateResetCode(),
		userId,
		email,
		expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_SECONDS * 1000).toISOString(),
		createdAt: now.toISOString(),
		attempts: 0,
	};

	const payload = JSON.stringify(record);
	await bucket.put(tokenKey(record.token), payload);
	await bucket.put(userKey(userId), payload);
	return record;
}

/**
 * Look up an active reset. The link token stands alone; a 6-digit code must
 * come with the userId resolved from the email the user typed.
 */
export async function verifyPasswordReset(
	bucket: R2Bucket,
	identifier: { token?: string; code?: string; userId?: string },
): Promise<PasswordResetRecord | null> {
	const token = identifier.token?.trim();
	if (token) {
		const record = await readRecord(bucket, tokenKey(token));
		if (!record) return null;
		if (isExpired(record)) {
			await consumePasswordReset(bucket, record).catch(() => {});
			return null;
		}
		return record;
	}

	const code = identifier.code?.trim();
	if (!code || !identifier.userId) return null;
	const record = await readRecord(bucket, userKey(identifier.userId));
	if (!record) return null;
	if (isExpired(record) || (record.attempts ?? 0) >= PASSWORD_RESET_MAX_CODE_ATTEMPTS) {
		await consumePasswordReset(bucket, record).catch(() => {});
		return null;
	}
	if (!timingSafeEqual(record.code, code)) {
		const attempts = (record.attempts ?? 0) + 1;
		if (attempts >= PASSWORD_RESET_MAX_CODE_ATTEMPTS) {
			await consumePasswordReset(bucket, record).catch(() => {});
		} else {
			const updated = JSON.stringify({ ...record, attempts });
			await bucket.put(userKey(record.userId), updated);
			await bucket.put(tokenKey(record.token), updated);
		}
		return null;
	}
	return record;
}

export async function consumePasswordReset(
	bucket: R2Bucket,
	record: PasswordResetRecord,
): Promise<void> {
	await Promise.allSettled([
		bucket.delete(tokenKey(record.token)),
		bucket.delete(userKey(record.userId)),
	]);
}
