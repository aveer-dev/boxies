// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * One-time codes that the mobile Stripe checkout return hands to the app in
 * place of a session token (AVE-118).
 *
 * The `inboxies://` custom scheme can be claimed by any installed app, so the
 * deep link carries only a short-lived code. The app trades it, together with
 * the Stripe checkout session id it started (which is not in the link), for
 * its session at `POST /api/v1/auth/exchange` over HTTPS.
 *
 * Codes live hashed in Better Auth's `verification` table. The hash covers the
 * checkout session id too, so a code only redeems with the checkout it was
 * issued for, and a wrong session id doesn't burn it. Redeeming deletes the
 * row in one statement, so a code works once.
 */

import { eq } from "drizzle-orm";
import type { AuthDb } from "./authz";
import { sha256Hex } from "./otp";
import * as schema from "./schema";

export const CHECKOUT_EXCHANGE_TTL_MS = 60 * 1000;

const CODE_PATTERN = /^[0-9a-f]{64}$/;

type ExchangePayload = { userId: string; mailboxId: string };

async function rowIdentifier(sessionId: string, code: string): Promise<string> {
	return `checkout-exchange:${await sha256Hex(`${sessionId}:${code}`)}`;
}

/** Mint a code that redeems once, within the TTL, for `userId` with checkout `sessionId`. */
export async function issueCheckoutExchangeCode(
	db: AuthDb,
	sessionId: string,
	payload: ExchangePayload,
	now = Date.now(),
): Promise<string> {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	const code = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
	await db.insert(schema.verification).values({
		id: crypto.randomUUID(),
		identifier: await rowIdentifier(sessionId, code),
		value: JSON.stringify(payload),
		expiresAt: new Date(now + CHECKOUT_EXCHANGE_TTL_MS),
	});
	return code;
}

/** Redeem `code` for checkout `sessionId` once; its payload, or null when wrong, used or expired. */
export async function consumeCheckoutExchangeCode(
	db: AuthDb,
	sessionId: string,
	code: string,
	now = Date.now(),
): Promise<ExchangePayload | null> {
	if (!CODE_PATTERN.test(code) || !sessionId) return null;
	const deleted = await db
		.delete(schema.verification)
		.where(eq(schema.verification.identifier, await rowIdentifier(sessionId, code)))
		.returning({ value: schema.verification.value, expiresAt: schema.verification.expiresAt });
	const row = deleted[0];
	if (!row || row.expiresAt.getTime() <= now) return null;
	try {
		const parsed = JSON.parse(row.value) as Partial<ExchangePayload>;
		if (typeof parsed.userId !== "string" || typeof parsed.mailboxId !== "string") return null;
		return { userId: parsed.userId, mailboxId: parsed.mailboxId };
	} catch {
		return null;
	}
}
