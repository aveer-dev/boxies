// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Password hashing (PBKDF2-SHA256) and password-session JWT helpers.
 * Password accounts are additive to Access / Apple / Google.
 */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

const SESSION_ISSUER = "agentic-inbox";
const SESSION_AUDIENCE = "agentic-inbox-ios";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const PASSWORD_SESSION_COOKIE = "inboxies_session";

export type PasswordAuthProvider = "password";

export interface PasswordSessionClaims extends JWTPayload {
	sub: string;
	email?: string;
	auth: PasswordAuthProvider;
	uid: string;
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
	const binary = atob(b64);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
	return out;
}

export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			salt,
			iterations: PBKDF2_ITERATIONS,
			hash: "SHA-256",
		},
		keyMaterial,
		KEY_BITS,
	);
	const hash = new Uint8Array(bits);
	return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

export async function verifyPassword(
	password: string,
	stored: string,
): Promise<boolean> {
	const parts = stored.split("$");
	if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") return false;
	const iterations = Number(parts[1]);
	if (!Number.isFinite(iterations) || iterations < 1) return false;
	const salt = base64ToBytes(parts[2]);
	const expected = base64ToBytes(parts[3]);
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			salt,
			iterations,
			hash: "SHA-256",
		},
		keyMaterial,
		expected.length * 8,
	);
	const actual = new Uint8Array(bits);
	if (actual.length !== expected.length) return false;
	let diff = 0;
	for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
	return diff === 0;
}

export function validatePasswordStrength(password: string): string | null {
	if (typeof password !== "string" || password.length < 10) {
		return "Password must be at least 10 characters";
	}
	if (password.length > 200) return "Password is too long";
	return null;
}

export async function issuePasswordSessionToken(
	secret: string,
	claims: { userId: string; email?: string },
): Promise<{ token: string; expiresAt: string }> {
	const key = new TextEncoder().encode(secret);
	const expiresAtMs = Date.now() + SESSION_TTL_SECONDS * 1000;
	const sub = `user:${claims.userId}`;
	const token = await new SignJWT({
		email: claims.email,
		auth: "password" as const,
		uid: claims.userId,
	})
		.setProtectedHeader({ alg: "HS256" })
		.setSubject(sub)
		.setIssuer(SESSION_ISSUER)
		.setAudience(SESSION_AUDIENCE)
		.setIssuedAt()
		.setExpirationTime(Math.floor(expiresAtMs / 1000))
		.sign(key);
	return { token, expiresAt: new Date(expiresAtMs).toISOString() };
}

export async function verifyPasswordSessionToken(
	token: string,
	secret: string,
): Promise<PasswordSessionClaims> {
	const key = new TextEncoder().encode(secret);
	const { payload } = await jwtVerify(token, key, {
		issuer: SESSION_ISSUER,
		audience: SESSION_AUDIENCE,
	});
	if (typeof payload.sub !== "string" || !payload.sub) {
		throw new Error("Password session token missing subject");
	}
	if (payload.auth !== "password") {
		throw new Error("Not a password session token");
	}
	const uid =
		typeof payload.uid === "string" && payload.uid
			? payload.uid
			: payload.sub.startsWith("user:")
				? payload.sub.slice("user:".length)
				: "";
	if (!uid) throw new Error("Password session token missing uid");
	return {
		...payload,
		sub: payload.sub,
		email: typeof payload.email === "string" ? payload.email : undefined,
		auth: "password",
		uid,
	};
}

export function passwordSessionCookieHeader(
	token: string,
	opts?: { maxAgeSeconds?: number; secure?: boolean },
): string {
	const maxAge = opts?.maxAgeSeconds ?? SESSION_TTL_SECONDS;
	const secure = opts?.secure !== false;
	const parts = [
		`${PASSWORD_SESSION_COOKIE}=${encodeURIComponent(token)}`,
		"Path=/",
		`Max-Age=${maxAge}`,
		"HttpOnly",
		"SameSite=Lax",
	];
	if (secure) parts.push("Secure");
	return parts.join("; ");
}

export function clearPasswordSessionCookieHeader(secure = true): string {
	const parts = [
		`${PASSWORD_SESSION_COOKIE}=`,
		"Path=/",
		"Max-Age=0",
		"HttpOnly",
		"SameSite=Lax",
	];
	if (secure) parts.push("Secure");
	return parts.join("; ");
}
