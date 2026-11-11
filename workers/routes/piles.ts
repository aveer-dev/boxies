// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Custom pile routes (AVE-194). The route table, payloads and events are
 * documented in shared/piles.ts. Every route sits under
 * `/api/v1/mailboxes/:mailboxId/*`, so `requireMailbox` has already checked
 * the caller is a member of the mailbox; piles are shared by all members.
 * Listing piles stays `GET /workflow-piles` (workers/index.ts).
 */

import type { Context, Hono } from "hono";
import type { MailboxContext } from "../lib/mailbox";
import { MAX_CUSTOM_PILES } from "../../shared/piles";

type AppContext = Context<MailboxContext>;

const BASE = "/api/v1/mailboxes/:mailboxId";
const PILE_NOT_FOUND = { error: "Pile not found" } as const;
const PILE_TAKEN = { error: "A pile with this name already exists" } as const;
const PILE_BUILTIN = { error: "Built-in piles can't be renamed or deleted" } as const;

/** Pile ids the list route accepts; anything else can't exist. */
function isPileRouteId(id: string | undefined): id is string {
	return !!id && /^[a-z0-9_]{1,64}$/.test(id);
}

async function nameFromBody(c: AppContext): Promise<unknown> {
	const body = (await c.req.json().catch(() => null)) as unknown;
	return body && typeof body === "object" && !Array.isArray(body)
		? (body as { name?: unknown }).name
		: undefined;
}

/** `count` / `due_count` as `GET /workflow-piles` lists them. */
function withCounts<T extends object>(pile: T, count = 0) {
	return { ...pile, count, due_count: 0 };
}

export function registerPileRoutes(app: Hono<MailboxContext>) {
	app.post(`${BASE}/piles`, async (c) => {
		const result = await c.var.mailboxStub.createPile(await nameFromBody(c));
		if (result.ok) return c.json(withCounts(result.pile), 201);
		switch (result.error) {
			case "conflict":
				return c.json(PILE_TAKEN, 409);
			case "limit":
				return c.json({ error: `A mailbox can have at most ${MAX_CUSTOM_PILES} piles of its own` }, 400);
			default:
				return c.json({ error: result.message }, 400);
		}
	});

	app.patch(`${BASE}/piles/:pileId`, async (c) => {
		const pileId = c.req.param("pileId");
		if (!isPileRouteId(pileId)) return c.json(PILE_NOT_FOUND, 404);
		const result = await c.var.mailboxStub.renamePile(pileId, await nameFromBody(c));
		if (result.ok) {
			const piles = await c.var.mailboxStub.getWorkflowPiles();
			return c.json(piles.find((p) => p.id === pileId) ?? withCounts(result.pile));
		}
		switch (result.error) {
			case "not_found":
				return c.json(PILE_NOT_FOUND, 404);
			case "conflict":
				return c.json(PILE_TAKEN, 409);
			case "builtin":
				return c.json(PILE_BUILTIN, 400);
			default:
				return c.json({ error: result.message }, 400);
		}
	});

	app.delete(`${BASE}/piles/:pileId`, async (c) => {
		const pileId = c.req.param("pileId");
		if (!isPileRouteId(pileId)) return c.json(PILE_NOT_FOUND, 404);
		const result = await c.var.mailboxStub.deletePile(pileId);
		if (result === "ok") return c.body(null, 204);
		return result === "builtin" ? c.json(PILE_BUILTIN, 400) : c.json(PILE_NOT_FOUND, 404);
	});
}
