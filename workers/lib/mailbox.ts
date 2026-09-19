// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Hono middleware: authorize the mailbox for the request principal, then
 * attach the Mailbox Durable Object stub (`c.var.mailboxStub`).
 */
import { createMiddleware } from "hono/factory";
import type { MailboxDO } from "../durableObject";
import type { Env } from "../types";
import { authorizeMailbox, type RequestPrincipal } from "./mailbox-acl.ts";

export type MailboxContext = {
	Bindings: Env;
	Variables: {
		mailboxStub: DurableObjectStub<MailboxDO>;
		mailboxId: string;
		principal?: RequestPrincipal;
	};
};

export const requireMailbox = createMiddleware<MailboxContext>(async (c, next) => {
	const rawId = c.req.param("mailboxId");
	if (!rawId) return c.json({ error: "Mailbox ID required" }, 400);

	const authz = await authorizeMailbox(c.env.BUCKET, c.get("principal"), rawId);
	if (!authz.ok) {
		return c.json({ error: authz.error }, authz.status);
	}

	const ns = c.env.MAILBOX;
	const id = ns.idFromName(authz.mailboxId);
	const stub = ns.get(id);

	c.set("mailboxStub", stub);
	c.set("mailboxId", authz.mailboxId);

	await next();
});
