// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Password reset tokens and 6-digit codes stored in R2.
 */

export const PASSWORD_RESET_TOKEN_PREFIX = "platform/password-resets/tokens/";
export const PASSWORD_RESET_CODE_PREFIX = "platform/password-resets/codes/";

export const PASSWORD_RESET_TTL_SECONDS = 60 * 60; // 1 hour

export interface PasswordResetRecord {
	token: string;
	code: string;
	userId: string;
	email: string;
	expiresAt: string;
	createdAt: string;
}

function tokenKey(token: string): string {
	return `${PASSWORD_RESET_TOKEN_PREFIX}${token}.json`;
}

function codeKey(code: string): string {
	return `${PASSWORD_RESET_CODE_PREFIX}${code}.json`;
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

export async function createPasswordReset(
	bucket: R2Bucket,
	userId: string,
	email: string,
): Promise<PasswordResetRecord> {
	const token = generateResetToken();
	let code = generateResetCode();

	// Guard against active code collisions (retry up to 3 times)
	for (let i = 0; i < 3; i++) {
		const existing = await bucket.head(codeKey(code));
		if (!existing) break;
		code = generateResetCode();
	}

	const now = new Date();
	const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_SECONDS * 1000).toISOString();

	const record: PasswordResetRecord = {
		token,
		code,
		userId,
		email,
		expiresAt,
		createdAt: now.toISOString(),
	};

	const payload = JSON.stringify(record);
	await bucket.put(tokenKey(token), payload);
	await bucket.put(codeKey(code), payload);

	return record;
}

export async function verifyPasswordReset(
	bucket: R2Bucket,
	identifier: { token?: string; code?: string },
): Promise<PasswordResetRecord | null> {
	let key = "";
	if (identifier.token && identifier.token.trim()) {
		key = tokenKey(identifier.token.trim());
	} else if (identifier.code && identifier.code.trim()) {
		key = codeKey(identifier.code.trim());
	} else {
		return null;
	}

	const obj = await bucket.get(key);
	if (!obj) return null;

	try {
		const raw = await obj.json() as unknown;
		if (
			typeof raw === "object" &&
			raw !== null &&
			"token" in raw &&
			"code" in raw &&
			"userId" in raw &&
			"expiresAt" in raw
		) {
			const record = raw as PasswordResetRecord;
			const expiresAt = new Date(record.expiresAt).getTime();
			if (Date.now() > expiresAt) {
				await consumePasswordReset(bucket, record).catch(() => {});
				return null;
			}
			return record;
		}
	} catch {
		/* ignore malformed json */
	}
	return null;
}

export async function consumePasswordReset(
	bucket: R2Bucket,
	record: PasswordResetRecord,
): Promise<void> {
	await Promise.allSettled([
		bucket.delete(tokenKey(record.token)),
		bucket.delete(codeKey(record.code)),
	]);
}
