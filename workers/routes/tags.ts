// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Tag routes (AVE-240). The route table, payloads and events are documented
 * in shared/tags.ts. Every route sits under `/api/v1/mailboxes/:mailboxId/*`,
 * so `requireMailbox` has already checked the caller is a member of the
 * mailbox and picked its Durable Object; tags are shared by all members.
 */

import type { Context, Hono } from "hono";
import type { MailboxContext } from "../lib/mailbox";
import { isValidTagRouteId } from "../lib/tags";
import { MAX_TAGS_PER_MAILBOX } from "../../shared/tags";

type AppContext = Context<MailboxContext>;

const BASE = "/api/v1/mailboxes/:mailboxId";

async function nameFromBody(c: AppContext): Promise<unknown> {
	const body = (await c.req.json()) as unknown;
	return body && typeof body === "object" && !Array.isArray(body)
		? (body as { name?: unknown }).name
		: undefined;
}

function boolQuery(c: AppContext, key: string): boolean {
	const v = c.req.query(key);
	return v === "true" || v === "1";
}

function intQuery(c: AppContext, key: string): number | undefined {
	const v = c.req.query(key);
	if (!v) return undefined;
	const n = Number(v);
	return Number.isFinite(n) ? n : undefined;
}

const TAG_NOT_FOUND = { error: "Tag not found" } as const;

export function registerTagRoutes(app: Hono<MailboxContext>) {
	app.get(`${BASE}/tags`, async (c) => {
		return c.json({ tags: await c.var.mailboxStub.listTags() });
	});

	app.post(`${BASE}/tags`, async (c) => {
		const result = await c.var.mailboxStub.createTag(await nameFromBody(c));
		if (result.ok) return c.json(result.tag, 201);
		switch (result.error) {
			case "conflict":
				return c.json({ error: "Tag with this name already exists" }, 409);
			case "limit":
				return c.json({ error: `A mailbox can have at most ${MAX_TAGS_PER_MAILBOX} tags` }, 400);
			default:
				return c.json({ error: result.message }, 400);
		}
	});

	app.patch(`${BASE}/tags/:tagId`, async (c) => {
		const tagId = c.req.param("tagId");
		if (!isValidTagRouteId(tagId)) return c.json(TAG_NOT_FOUND, 404);
		const result = await c.var.mailboxStub.renameTag(tagId, await nameFromBody(c));
		if (result.ok) return c.json(result.tag);
		switch (result.error) {
			case "not_found":
				return c.json(TAG_NOT_FOUND, 404);
			case "conflict":
				return c.json({ error: "Tag with this name already exists" }, 409);
			default:
				return c.json({ error: result.message }, 400);
		}
	});

	app.delete(`${BASE}/tags/:tagId`, async (c) => {
		const tagId = c.req.param("tagId");
		if (!isValidTagRouteId(tagId)) return c.json(TAG_NOT_FOUND, 404);
		const deleted = await c.var.mailboxStub.deleteTag(tagId);
		return deleted ? c.body(null, 204) : c.json(TAG_NOT_FOUND, 404);
	});

	app.get(`${BASE}/tags/:tagId/emails`, async (c) => {
		const tagId = c.req.param("tagId");
		if (!isValidTagRouteId(tagId)) return c.json(TAG_NOT_FOUND, 404);
		const result = await c.var.mailboxStub.getTaggedEmails(tagId, {
			threaded: boolQuery(c, "threaded"),
			includeJunk: boolQuery(c, "include_junk"),
			page: intQuery(c, "page"),
			limit: intQuery(c, "limit"),
			userId: c.get("principal")?.userId,
		});
		return result ? c.json(result) : c.json(TAG_NOT_FOUND, 404);
	});

	for (const [method, on] of [["put", true], ["delete", false]] as const) {
		app[method](`${BASE}/emails/:id/tags/:tagId`, async (c) => {
			const emailId = c.req.param("id");
			const tagId = c.req.param("tagId");
			if (!isValidTagRouteId(emailId)) return c.json({ error: "Email not found" }, 404);
			if (!isValidTagRouteId(tagId)) return c.json(TAG_NOT_FOUND, 404);
			const result = await c.var.mailboxStub.setEmailTag(emailId, tagId, on);
			if (!result.ok) {
				return result.error === "email_not_found"
					? c.json({ error: "Email not found" }, 404)
					: c.json(TAG_NOT_FOUND, 404);
			}
			return c.json({ id: result.id, tags: result.tags });
		});

		app[method](`${BASE}/threads/:threadId/tags/:tagId`, async (c) => {
			const threadId = c.req.param("threadId");
			const tagId = c.req.param("tagId");
			if (!isValidTagRouteId(threadId)) return c.json({ error: "Thread not found" }, 404);
			if (!isValidTagRouteId(tagId)) return c.json(TAG_NOT_FOUND, 404);
			const result = await c.var.mailboxStub.setThreadTag(threadId, tagId, on);
			if (!result.ok) {
				return result.error === "thread_not_found"
					? c.json({ error: "Thread not found" }, 404)
					: c.json(TAG_NOT_FOUND, 404);
			}
			return c.json({ threadId: result.threadId, tags: result.tags, emailIds: result.emailIds });
		});
	}
}
