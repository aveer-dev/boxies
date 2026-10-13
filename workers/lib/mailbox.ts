// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Hono middleware: authorize the mailbox for the request principal (one
 * `mailbox_member` lookup), then attach the Mailbox Durable Object stub
 * (`c.var.mailboxStub`).
 */
import { createMiddleware } from "hono/factory";
import type { MailboxDO } from "../durableObject";
import type { Env } from "../types";
import { authDb, authorizeMailboxAccess } from "../auth/authz";
import type { RequestPrincipal } from "../auth/principal";
import type { MailboxRole } from "../auth/schema";
import type { Operator } from "../auth/operators";

export type MailboxContext = {
	Bindings: Env;
	Variables: {
		mailboxStub: DurableObjectStub<MailboxDO>;
		mailboxId: string;
		mailboxRole: MailboxRole;
		principal?: RequestPrincipal;
		operator?: Operator;
	};
};

export const requireMailbox = createMiddleware<MailboxContext>(async (c, next) => {
	const rawId = c.req.param("mailboxId");
	if (!rawId) return c.json({ error: "Mailbox ID required" }, 400);

	const authz = await authorizeMailboxAccess(authDb(c.env.AUTH_DB), c.get("principal")?.userId, rawId);
	if (!authz.ok) {
		return c.json({ error: authz.error }, authz.status);
	}

	const ns = c.env.MAILBOX;
	const id = ns.idFromName(authz.mailboxId);
	const stub = ns.get(id);

	c.set("mailboxStub", stub);
	c.set("mailboxId", authz.mailboxId);
	c.set("mailboxRole", authz.role);

	await next();
});
