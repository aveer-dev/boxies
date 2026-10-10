// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Password reset tokens and 6-digit codes stored in R2.
 *
 * - Link tokens are long random strings keyed directly by token.
 * - 6-digit codes are bound to a user: one active code per user, stored as a
 *   SHA-256 hash under `codes/<userId>.json` with a failed-attempt counter.
 *   Attempts are counted with R2 conditional writes (etag compare-and-swap),
 *   so parallel guesses cannot exceed `PASSWORD_RESET_MAX_CODE_ATTEMPTS`.
 */

export const PASSWORD_RESET_TOKEN_PREFIX = "platform/password-resets/tokens/";
export const PASSWORD_RESET_CODE_PREFIX = "platform/password-resets/codes/";

export const PASSWORD_RESET_TTL_SECONDS = 60 * 60; // 1 hour

/** Wrong guesses allowed per issued code before it is invalidated. */
export const PASSWORD_RESET_MAX_CODE_ATTEMPTS = 5;

/** Reset emails a single user may be issued per rolling TTL window. */
export const PASSWORD_RESET_MAX_ISSUES_PER_WINDOW = 5;

/** Compare-and-swap retries before a contended code check fails closed. */
const CODE_CAS_RETRIES = 5;

/** Link-token record; also what a successful verification returns. */
export interface PasswordResetRecord {
	token: string;
	userId: string;
	email: string;
	expiresAt: string;
	createdAt: string;
}

/** Freshly issued reset, including the plaintext code for the email. */
export interface IssuedPasswordReset extends PasswordResetRecord {
	code: string;
}

/** Per-user code state at `codes/<userId>.json`. */
interface PasswordResetCodeRecord extends PasswordResetRecord {
	/** SHA-256 of `<userId>:<code>`; null once used or locked out. */
	codeHash: string | null;
	failedAttempts: number;
	/** Issue timestamps within the current TTL window (issuance cap). */
	issuedAt: string[];
}

export type PasswordResetIdentifier =
	| { token: string }
	| { userId: string; code: string };

function tokenKey(token: string): string {
	return `${PASSWORD_RESET_TOKEN_PREFIX}${token}.json`;
}

function codeKey(userId: string): string {
	return `${PASSWORD_RESET_CODE_PREFIX}${encodeURIComponent(userId)}.json`;
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

async function hashResetCode(userId: string, code: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(`${userId}:${code}`),
	);
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

function isExpired(record: { expiresAt: string }): boolean {
	return !(Date.now() <= new Date(record.expiresAt).getTime());
}

function toResetRecord(raw: PasswordResetRecord): PasswordResetRecord {
	return {
		token: raw.token,
		userId: raw.userId,
		email: raw.email,
		expiresAt: raw.expiresAt,
		createdAt: raw.createdAt,
	};
}

function parseCodeRecord(raw: unknown): PasswordResetCodeRecord | null {
	if (typeof raw !== "object" || raw === null) return null;
	const r = raw as Partial<PasswordResetCodeRecord>;
	if (
		typeof r.token !== "string" ||
		typeof r.userId !== "string" ||
		typeof r.expiresAt !== "string" ||
		!(typeof r.codeHash === "string" || r.codeHash === null)
	) {
		return null;
	}
	return {
		token: r.token,
		userId: r.userId,
		email: typeof r.email === "string" ? r.email : "",
		expiresAt: r.expiresAt,
		createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
		codeHash: r.codeHash,
		failedAttempts: typeof r.failedAttempts === "number" ? r.failedAttempts : 0,
		issuedAt: Array.isArray(r.issuedAt)
			? r.issuedAt.filter((t): t is string => typeof t === "string")
			: [],
	};
}

async function readCodeRecord(
	bucket: R2Bucket,
	userId: string,
): Promise<{ record: PasswordResetCodeRecord; etag: string } | null> {
	const obj = await bucket.get(codeKey(userId));
	if (!obj) return null;
	try {
		const record = parseCodeRecord(await obj.json());
		return record ? { record, etag: obj.etag } : null;
	} catch {
		return null;
	}
}

/**
 * Issue a new link token + 6-digit code for `userId`, replacing any active
 * code. Returns null when the user has hit the issuance cap for this window.
 */
export async function createPasswordReset(
	bucket: R2Bucket,
	userId: string,
	email: string,
): Promise<IssuedPasswordReset | null> {
	const now = new Date();
	const windowStart = now.getTime() - PASSWORD_RESET_TTL_SECONDS * 1000;
	const existing = await readCodeRecord(bucket, userId);
	const recentIssues = (existing?.record.issuedAt ?? []).filter(
		(t) => new Date(t).getTime() > windowStart,
	);
	if (recentIssues.length >= PASSWORD_RESET_MAX_ISSUES_PER_WINDOW) {
		return null;
	}

	const token = generateResetToken();
	const code = generateResetCode();
	const record: PasswordResetRecord = {
		token,
		userId,
		email,
		expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_SECONDS * 1000).toISOString(),
		createdAt: now.toISOString(),
	};
	const codeRecord: PasswordResetCodeRecord = {
		...record,
		codeHash: await hashResetCode(userId, code),
		failedAttempts: 0,
		issuedAt: [...recentIssues, record.createdAt],
	};

	await bucket.put(tokenKey(token), JSON.stringify(record));
	await bucket.put(codeKey(userId), JSON.stringify(codeRecord));

	return { ...record, code };
}

async function verifyResetToken(
	bucket: R2Bucket,
	token: string,
): Promise<PasswordResetRecord | null> {
	const obj = await bucket.get(tokenKey(token));
	if (!obj) return null;

	try {
		const raw = (await obj.json()) as unknown;
		if (
			typeof raw === "object" &&
			raw !== null &&
			"token" in raw &&
			"userId" in raw &&
			"expiresAt" in raw
		) {
			const record = toResetRecord(raw as PasswordResetRecord);
			if (isExpired(record)) {
				// Only drop this token: the user may have a newer active code.
				await bucket.delete(tokenKey(token)).catch(() => {});
				return null;
			}
			return record;
		}
	} catch {
		/* ignore malformed json */
	}
	return null;
}

/**
 * Check a 6-digit code against the user's active code. Every resolved guess
 * is recorded with an etag-conditional write before it is answered, so a
 * correct guess is claimed exactly once and wrong guesses are capped at
 * `PASSWORD_RESET_MAX_CODE_ATTEMPTS` even under concurrency.
 */
async function verifyResetCode(
	bucket: R2Bucket,
	userId: string,
	code: string,
): Promise<PasswordResetRecord | null> {
	const candidateHash = await hashResetCode(userId, code);

	for (let i = 0; i < CODE_CAS_RETRIES; i++) {
		const current = await readCodeRecord(bucket, userId);
		if (!current) return null;
		const { record, etag } = current;

		if (isExpired(record)) {
			await consumePasswordReset(bucket, record).catch(() => {});
			return null;
		}
		if (
			record.codeHash === null ||
			record.failedAttempts >= PASSWORD_RESET_MAX_CODE_ATTEMPTS
		) {
			return null;
		}

		const matches = timingSafeEqual(candidateHash, record.codeHash);
		const failedAttempts = matches ? record.failedAttempts : record.failedAttempts + 1;
		const next: PasswordResetCodeRecord = {
			...record,
			failedAttempts,
			codeHash:
				matches || failedAttempts >= PASSWORD_RESET_MAX_CODE_ATTEMPTS
					? null
					: record.codeHash,
		};
		const written = await bucket.put(codeKey(userId), JSON.stringify(next), {
			onlyIf: { etagMatches: etag },
		});
		if (!written) continue; // lost the race; re-read and try again

		return matches ? toResetRecord(record) : null;
	}
	return null;
}

/**
 * Resolve a reset by link token, or by 6-digit code bound to `userId`.
 * A code without a user is always rejected.
 */
export async function verifyPasswordReset(
	bucket: R2Bucket,
	identifier: PasswordResetIdentifier,
): Promise<PasswordResetRecord | null> {
	if ("token" in identifier) {
		const token = identifier.token.trim();
		return token ? verifyResetToken(bucket, token) : null;
	}
	const userId = identifier.userId?.trim();
	const code = identifier.code?.trim();
	if (!userId || !code || !/^\d{6}$/.test(code)) return null;
	return verifyResetCode(bucket, userId, code);
}

/** Delete the link token and the user's active code after a reset. */
export async function consumePasswordReset(
	bucket: R2Bucket,
	record: PasswordResetRecord,
): Promise<void> {
	await Promise.allSettled([
		bucket.delete(tokenKey(record.token)),
		bucket.delete(codeKey(record.userId)),
	]);
}
