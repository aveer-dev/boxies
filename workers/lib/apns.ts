// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { importPKCS8, SignJWT } from "jose";
import type { Env } from "../types";

export interface APNsPayload {
	title: string;
	/** APNs alert.body (preview, or subject when no preview). */
	body: string;
	/** FCM data `body` (the Android app renders it); defaults to `body` when omitted. */
	fcmBody?: string;
	/** APNs alert.subtitle (typically the mail subject). */
	subtitle?: string;
	mailboxId: string;
	emailId: string;
	folderId?: string;
	/**
	 * Conversation (`emails.thread_id`) the mail belongs to. APNs `thread-id`
	 * (iOS groups notifications by it) and `threadId` in both custom payloads,
	 * so notification actions can call the thread routes (AVE-140).
	 */
	threadId?: string;
	/**
	 * Notification category: set to `MAIL_NOTIFICATION_CATEGORY` for pushes
	 * about a real message, so iOS shows the mail actions (Archive, Mark read,
	 * Reply Later, Reply, Spam). Omitted for pushes with no message behind
	 * them (test-push).
	 */
	category?: typeof MAIL_NOTIFICATION_CATEGORY;
	badge?: number;
}

/** `UNNotificationCategory` identifier the iOS app registers its mail actions under. */
export const MAIL_NOTIFICATION_CATEGORY = "INBOXIES_MAIL";

/**
 * APNs request body. Fields existing clients read (`aps.alert`, `mailboxId`,
 * `emailId`, `folderId`) keep their shape; `category`, `thread-id` and
 * `threadId` are only added when set.
 */
export function buildAPNsBody(payload: APNsPayload): Record<string, unknown> {
	const alert: { title: string; subtitle?: string; body: string } = {
		title: payload.title,
		body: payload.body,
	};
	if (payload.subtitle) {
		alert.subtitle = payload.subtitle;
	}
	const aps: Record<string, unknown> = {
		alert,
		sound: "default",
		badge: payload.badge,
		"content-available": 1, // Wakes up app in background to pre-sync local SQLite
	};
	if (payload.category) aps.category = payload.category;
	if (payload.threadId) aps["thread-id"] = payload.threadId;
	return {
		aps,
		mailboxId: payload.mailboxId,
		emailId: payload.emailId,
		folderId: payload.folderId ?? "inbox",
		...(payload.threadId ? { threadId: payload.threadId } : {}),
	};
}

/**
 * The env fields APNs delivery reads. `APNS_SANDBOX` / `APNS_TOPIC` are wrangler
 * vars that deployments override, so read them as plain strings rather than the
 * literal defaults `wrangler types` generates from wrangler.jsonc.
 */
type APNsEnv = Pick<Env, "APNS_KEY_ID" | "APNS_TEAM_ID" | "APNS_PRIVATE_KEY"> & {
	APNS_SANDBOX?: string;
	APNS_TOPIC?: string;
};

let cachedKey: CryptoKey | null = null;
let cachedKeyPem: string | null = null;
let cachedJwt: string | null = null;
let cachedJwtIssuedAt = 0;
let cachedJwtKey: string | null = null;

/**
 * Parses and imports the APNs .p8 EC private key.
 */
async function getPrivateKey(pem: string): Promise<CryptoKey> {
	if (cachedKey && cachedKeyPem === pem) {
		return cachedKey;
	}

	let trimmed = pem.trim().replace(/\\n/g, "\n");
	const formattedPem = trimmed.includes("-----BEGIN")
		? trimmed
		: `-----BEGIN PRIVATE KEY-----\n${trimmed}\n-----END PRIVATE KEY-----`;

	cachedKey = (await importPKCS8(formattedPem, "ES256")) as CryptoKey;
	cachedKeyPem = pem;
	return cachedKey;
}

/**
 * Generates an APNs authentication token (valid for up to 50 minutes).
 */
async function getAPNsBearerToken(env: APNsEnv): Promise<string | null> {
	if (!env.APNS_KEY_ID || !env.APNS_TEAM_ID || !env.APNS_PRIVATE_KEY) {
		return null;
	}

	const now = Math.floor(Date.now() / 1000);
	// Apple permits JWTs to be reused for up to 60 minutes; refresh every 45 minutes
	const jwtKey = `${env.APNS_KEY_ID}:${env.APNS_TEAM_ID}`;
	if (cachedJwt && cachedJwtKey === jwtKey && now - cachedJwtIssuedAt < 45 * 60) {
		return cachedJwt;
	}

	try {
		const key = await getPrivateKey(env.APNS_PRIVATE_KEY);
		cachedJwt = await new SignJWT({})
			.setProtectedHeader({ alg: "ES256", kid: env.APNS_KEY_ID })
			.setIssuer(env.APNS_TEAM_ID)
			.setIssuedAt(now)
			.sign(key);
		cachedJwtIssuedAt = now;
		cachedJwtKey = jwtKey;
		return cachedJwt;
	} catch (err) {
		console.error("[APNs] Failed to sign APNs JWT:", err);
		return null;
	}
}

/** APNs refused our provider JWT (expired, or signed with a stale key). */
export function isRejectedProviderToken(status: number, body: string): boolean {
	return status === 403 && /ExpiredProviderToken|InvalidProviderToken/.test(body);
}

/**
 * Dispatches an Apple Push Notification to one or more iOS device tokens.
 */
export async function sendAPNsPush(
	env: APNsEnv,
	deviceTokens: string[],
	payload: APNsPayload,
): Promise<{ successCount: number; failureCount: number; staleTokens: string[]; details: any[] }> {
	if (!deviceTokens || deviceTokens.length === 0) {
		return { successCount: 0, failureCount: 0, staleTokens: [], details: [] };
	}

	const jwt = await getAPNsBearerToken(env);
	if (!jwt) {
		console.warn(
			"[APNs] Push notification skipped: APNS_KEY_ID, APNS_TEAM_ID, or APNS_PRIVATE_KEY not configured.",
		);
		return { successCount: 0, failureCount: 0, staleTokens: [], details: [] };
	}

	const isExplicitProd = env.APNS_SANDBOX === "false";
	const primaryHost = isExplicitProd
		? "https://api.push.apple.com"
		: "https://api.sandbox.push.apple.com";
	const fallbackHost = (primaryHost === "https://api.sandbox.push.apple.com")
		? "https://api.push.apple.com"
		: "https://api.sandbox.push.apple.com";
	const topic = env.APNS_TOPIC || "co.inboxies.app";

	console.log(`[APNs] Dispatching push for mailbox "${payload.mailboxId}" to ${deviceTokens.length} device(s). Target: ${primaryHost}, topic: ${topic}`);

	const requestBody = JSON.stringify(buildAPNsBody(payload));

	let successCount = 0;
	let failureCount = 0;
	const staleTokens: string[] = [];
	const details: any[] = [];

	await Promise.all(
		deviceTokens.map(async (token) => {
			async function postToHost(h: string) {
				return fetch(`${h}/3/device/${token}`, {
					method: "POST",
					headers: {
						authorization: `bearer ${jwt}`,
						"apns-topic": topic,
						"apns-push-type": "alert",
						"apns-priority": "10",
						"content-type": "application/json",
					},
					body: requestBody,
				});
			}

			try {
				let usedHost = primaryHost;
				let response = await postToHost(usedHost);
				let respText = "";

				// If BadDeviceToken on sandbox/production, try the alternate server automatically
				if (!response.ok && response.status === 400) {
					respText = await response.text();
					if (respText.includes("BadDeviceToken") || respText.includes("TopicDisallowed")) {
						console.log(`[APNs] Primary server (${usedHost}) returned ${respText}. Attempting fallback (${fallbackHost})...`);
						const fallbackResponse = await postToHost(fallbackHost);
						if (fallbackResponse.ok) {
							response = fallbackResponse;
							usedHost = fallbackHost;
							respText = "";
						} else {
							respText = await fallbackResponse.text();
							usedHost = fallbackHost;
						}
					}
				} else if (!response.ok) {
					respText = await response.text();
				}

				if (response.ok) {
					successCount += 1;
					console.log(`[APNs] ✓ Successfully sent push to ${token.slice(0, 8)}... via ${usedHost}`);
					details.push({ token: token.slice(0, 8) + "...", status: 200, host: usedHost });
				} else {
					failureCount += 1;
					console.warn(
						`[APNs] ✗ Failed to send push to ${token.slice(0, 8)}... status=${response.status} body=${respText} host=${usedHost}`,
					);
					details.push({ token: token.slice(0, 8) + "...", status: response.status, body: respText, host: usedHost });
					if (isRejectedProviderToken(response.status, respText)) {
						// Re-sign on the next push instead of reusing a JWT Apple refuses
						// for the rest of the 45-minute cache window.
						cachedJwt = null;
					}
					if (
						response.status === 410 ||
						(response.status === 400 && respText.includes("BadDeviceToken"))
					) {
						staleTokens.push(token);
					}
				}
			} catch (err) {
				failureCount += 1;
				console.error(`[APNs] Network exception sending to ${token.slice(0, 8)}:`, err);
				details.push({ token: token.slice(0, 8) + "...", error: String(err) });
			}
		}),
	);

	return { successCount, failureCount, staleTokens, details };
}
