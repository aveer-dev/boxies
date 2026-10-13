// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Side effects Better Auth triggers on its own rows (see `auth/index.ts`). */

import { eq } from "drizzle-orm";
import { mailDomainConfig } from "../lib/mail-domain";
import type { Env } from "../types";
import { authDb, listMailboxesForUser } from "./authz";
import { sessionKey } from "./principal";
import * as schema from "./schema";

/** True when `email` is on a platform mail domain or a customer domain we host. */
export async function isHostedEmailDomain(env: Env, email: string): Promise<boolean> {
	const domain = email.slice(email.lastIndexOf("@") + 1).trim().toLowerCase();
	if (!domain) return false;
	if (mailDomainConfig(env).domains.includes(domain)) return true;
	if (!env.AUTH_DB) return false;
	const row = await authDb(env.AUTH_DB)
		.select({ domain: schema.domain.domain })
		.from(schema.domain)
		.where(eq(schema.domain.domain, domain))
		.get();
	return Boolean(row);
}

/**
 * A session ended (sign-out, revoke, password reset, expiry sweep): stop
 * pushing that device the user's mail.
 */
export async function pruneSessionDeviceTokens(
	env: Env,
	opts: { userId: string; sessionId: string },
): Promise<void> {
	if (!env.AUTH_DB || !env.MAILBOX) return;
	try {
		const mailboxes = await listMailboxesForUser(authDb(env.AUTH_DB), opts.userId);
		await Promise.all(
			mailboxes.map(({ mailboxId }) =>
				env.MAILBOX.get(env.MAILBOX.idFromName(mailboxId)).removeDeviceTokensWithKey(
					sessionKey(opts.sessionId),
				),
			),
		);
	} catch (e) {
		console.error("[Auth] Device-token prune failed:", (e as Error).message);
	}
}
