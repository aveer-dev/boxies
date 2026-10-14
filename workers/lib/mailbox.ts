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
import { serviceEndedErrorForMailbox } from "./domain-service";

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

	// A domain whose subscription ended is read-only: reading, export and
	// read/star flags still work; anything that sends or changes config doesn't.
	if (!isReadOnlySafe(c.req.method, c.req.path)) {
		const ended = await serviceEndedErrorForMailbox(c.env, authz.mailboxId);
		if (ended) return c.json(ended, 403);
	}

	c.set("mailboxStub", stub);
	c.set("mailboxId", authz.mailboxId);
	c.set("mailboxRole", authz.role);

	await next();
});

/**
 * Requests a read-only mailbox still serves. GETs are always fine (clients
 * treat a 403 on a read as "lost access" and drop the mailbox).
 */
const READ_ONLY_WRITES: Array<[method: string, path: RegExp]> = [
	["POST", /^\/export$/], // download their mail
	["PUT", /^\/emails\/[^/]+$/], // read / starred / reply-later flags
	["POST", /^\/threads\/[^/]+\/read$/],
	["POST", /^\/inbox-digest\/topics\/[^/]+\/mark-read$/],
	["POST", /^\/inbox-digest\/todos\/[^/]+\/complete$/],
	["POST", /^\/device-token$/],
	["DELETE", /^\/device-token\/[^/]+$/],
];

export function isReadOnlySafe(method: string, path: string): boolean {
	const m = method.toUpperCase();
	if (m === "GET" || m === "HEAD" || m === "OPTIONS") return true;
	// The part after /api/v1/mailboxes/<id>, however the id was spelled in the URL.
	const rest = path.replace(/^\/api\/v1\/mailboxes\/[^/]+/, "");
	return READ_ONLY_WRITES.some(([wm, re]) => wm === m && re.test(rest));
}
