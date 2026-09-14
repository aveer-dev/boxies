// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { importPKCS8, SignJWT } from "jose";
import type { Env } from "../types";
import type { APNsPayload } from "./apns";

interface ServiceAccount {
	project_id: string;
	client_email: string;
	private_key: string;
}

let cachedAccessToken: string | null = null;
let cachedAccessTokenExpiresAt = 0;
let cachedSaKey: string | null = null;

function parseServiceAccount(raw: string): ServiceAccount | null {
	try {
		const parsed = JSON.parse(raw) as ServiceAccount;
		if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

async function getFcmAccessToken(sa: ServiceAccount): Promise<string | null> {
	const now = Math.floor(Date.now() / 1000);
	if (cachedAccessToken && cachedSaKey === sa.client_email && now < cachedAccessTokenExpiresAt - 60) {
		return cachedAccessToken;
	}

	try {
		const key = await importPKCS8(sa.private_key.replace(/\\n/g, "\n"), "RS256");
		const assertion = await new SignJWT({
			scope: "https://www.googleapis.com/auth/firebase.messaging",
		})
			.setProtectedHeader({ alg: "RS256", typ: "JWT" })
			.setIssuer(sa.client_email)
			.setSubject(sa.client_email)
			.setAudience("https://oauth2.googleapis.com/token")
			.setIssuedAt(now)
			.setExpirationTime(now + 3600)
			.sign(key);

		const res = await fetch("https://oauth2.googleapis.com/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
				assertion,
			}),
		});
		if (!res.ok) {
			console.error("[FCM] Token exchange failed:", res.status, await res.text());
			return null;
		}
		const json = (await res.json()) as { access_token?: string; expires_in?: number };
		if (!json.access_token) return null;
		cachedAccessToken = json.access_token;
		cachedAccessTokenExpiresAt = now + (json.expires_in ?? 3600);
		cachedSaKey = sa.client_email;
		return cachedAccessToken;
	} catch (err) {
		console.error("[FCM] Failed to mint access token:", err);
		return null;
	}
}

/**
 * Dispatch FCM HTTP v1 notifications. No-ops when FCM_SERVICE_ACCOUNT_JSON is unset.
 */
export async function sendFcmPush(
	env: Env,
	deviceTokens: string[],
	payload: APNsPayload,
): Promise<{ successCount: number; failureCount: number; staleTokens: string[]; details: unknown[] }> {
	if (!deviceTokens.length) {
		return { successCount: 0, failureCount: 0, staleTokens: [], details: [] };
	}

	const raw = env.FCM_SERVICE_ACCOUNT_JSON;
	if (!raw) {
		console.warn("[FCM] Push skipped: FCM_SERVICE_ACCOUNT_JSON not configured.");
		return { successCount: 0, failureCount: 0, staleTokens: [], details: [] };
	}

	const sa = parseServiceAccount(raw);
	if (!sa) {
		console.warn("[FCM] Push skipped: FCM_SERVICE_ACCOUNT_JSON is invalid JSON.");
		return { successCount: 0, failureCount: 0, staleTokens: [], details: [] };
	}

	const accessToken = await getFcmAccessToken(sa);
	if (!accessToken) {
		return { successCount: 0, failureCount: 0, staleTokens: [], details: [] };
	}

	const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
	let successCount = 0;
	let failureCount = 0;
	const staleTokens: string[] = [];
	const details: unknown[] = [];

	await Promise.all(
		deviceTokens.map(async (token) => {
			try {
				const res = await fetch(url, {
					method: "POST",
					headers: {
						authorization: `Bearer ${accessToken}`,
						"content-type": "application/json",
					},
					body: JSON.stringify({
						message: {
							token,
							notification: {
								title: payload.title,
								body: payload.fcmBody ?? payload.body,
							},
							data: {
								title: payload.title,
								body: payload.fcmBody ?? payload.body,
								mailboxId: payload.mailboxId,
								emailId: payload.emailId,
								folderId: payload.folderId ?? "inbox",
							},
							android: {
								priority: "high",
							},
						},
					}),
				});
				if (res.ok) {
					successCount += 1;
					details.push({ token: token.slice(0, 8) + "...", status: 200 });
				} else {
					failureCount += 1;
					const text = await res.text();
					details.push({ token: token.slice(0, 8) + "...", status: res.status, body: text });
					if (
						res.status === 404 ||
						text.includes("UNREGISTERED") ||
						text.includes("INVALID_ARGUMENT")
					) {
						staleTokens.push(token);
					}
				}
			} catch (err) {
				failureCount += 1;
				details.push({ token: token.slice(0, 8) + "...", error: String(err) });
			}
		}),
	);

	return { successCount, failureCount, staleTokens, details };
}
