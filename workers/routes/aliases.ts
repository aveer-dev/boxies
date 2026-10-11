// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type Hono } from "hono";
import { z } from "zod";
import {
	buildPrivateAddress,
	generateRandomAliasToken,
	aliasMetadataKey,
	MAX_ALIASES_PER_MAILBOX,
	type AliasRow,
	type StoredAliasMetadata,
} from "../lib/alias-utils";
import { isAddressTaken } from "../lib/mailbox-routing";

const CreateAliasSchema = z.object({
	label: z.string().trim().max(100).optional().nullable(),
	expiresAt: z.string().datetime().optional().nullable(),
	pausedAction: z.enum(["drop", "reject"]).default("drop"),
});

const UpdateAliasSchema = z.object({
	label: z.string().trim().max(100).optional().nullable(),
	isActive: z.boolean().optional(),
	pausedAction: z.enum(["drop", "reject"]).optional(),
	expiresAt: z.string().datetime().optional().nullable(),
});

const MAX_TOKEN_ATTEMPTS = 5;

function routingRecord(row: AliasRow, mailboxId: string): StoredAliasMetadata {
	return {
		kind: "private",
		aliasId: row.id,
		aliasEmail: row.alias_email,
		targetMailboxId: mailboxId,
		domain: row.domain,
		baseDomain: row.base_domain,
		label: row.label,
		isActive: Boolean(row.is_active),
		pausedAction: row.paused_action === "reject" ? "reject" : "drop",
		expiresAt: row.expires_at,
		createdAt: row.created_at,
	};
}

async function putRoutingRecord(bucket: R2Bucket, meta: StoredAliasMetadata) {
	await bucket.put(aliasMetadataKey(meta.aliasEmail), JSON.stringify(meta), {
		httpMetadata: { contentType: "application/json" },
	});
}

export function registerAliasRoutes(app: Hono<any>) {
	// List all private emails for this mailbox
	app.get("/api/v1/mailboxes/:mailboxId/aliases", async (c) => {
		const stub = c.var.mailboxStub;
		const list = await stub.listAliases();
		return c.json({ aliases: list });
	});

	// Create a private email on the apex of the mailbox's own domain.
	// The domain is never caller-supplied: an alias on someone else's
	// domain would let this mailbox send as that domain.
	app.post("/api/v1/mailboxes/:mailboxId/aliases", async (c) => {
		const mailboxId: string = c.var.mailboxId;
		const stub = c.var.mailboxStub;

		let body: z.infer<typeof CreateAliasSchema>;
		try {
			const json = await c.req.json().catch(() => ({}));
			body = CreateAliasSchema.parse(json);
		} catch (err: any) {
			return c.json({ error: err.message || "Invalid request body" }, 400);
		}

		const mailboxDomain = mailboxId.slice(mailboxId.lastIndexOf("@") + 1);
		if (!mailboxDomain) return c.json({ error: "Invalid mailbox address" }, 400);

		if ((await stub.countAliases()) >= MAX_ALIASES_PER_MAILBOX) {
			return c.json(
				{ error: `You can have up to ${MAX_ALIASES_PER_MAILBOX} private emails. Delete some to create more.` },
				409,
			);
		}

		// Aliases and mailboxes share one address space; retry on collision.
		let address: ReturnType<typeof buildPrivateAddress> | null = null;
		for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt++) {
			const candidate = buildPrivateAddress(generateRandomAliasToken(8), mailboxDomain);
			if (!(await isAddressTaken(c.env.BUCKET, candidate.aliasEmail))) {
				address = candidate;
				break;
			}
		}
		if (!address) {
			return c.json({ error: "Failed to generate unique alias token. Please try again." }, 500);
		}

		const row: AliasRow = {
			id: crypto.randomUUID(),
			alias_email: address.aliasEmail,
			domain: address.domain,
			base_domain: address.domain,
			label: body.label || null,
			is_active: 1,
			paused_action: body.pausedAction,
			expires_at: body.expiresAt || null,
			created_at: new Date().toISOString(),
			stats_received: 0,
			stats_blocked: 0,
		};

		// Routing record first, so a row never exists that mail can't reach;
		// roll it back if the Durable Object insert fails.
		await putRoutingRecord(c.env.BUCKET, routingRecord(row, mailboxId));
		try {
			const created = await stub.createAlias(row);
			return c.json({ alias: created }, 201);
		} catch (err) {
			await c.env.BUCKET.delete(aliasMetadataKey(row.alias_email));
			throw err;
		}
	});

	// Update an existing private email (active/pause, label, expiry, action)
	app.patch("/api/v1/mailboxes/:mailboxId/aliases/:aliasId", async (c) => {
		const mailboxId: string = c.var.mailboxId;
		const stub = c.var.mailboxStub;
		const aliasId = c.req.param("aliasId");

		let body: z.infer<typeof UpdateAliasSchema>;
		try {
			const json = await c.req.json();
			body = UpdateAliasSchema.parse(json);
		} catch (err: any) {
			return c.json({ error: err.message || "Invalid request body" }, 400);
		}

		const existing = await stub.getAlias(aliasId);
		if (!existing) {
			return c.json({ error: "Alias not found" }, 404);
		}

		const updated = await stub.updateAlias(existing.id, {
			label: body.label === undefined ? undefined : body.label || null,
			is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : undefined,
			paused_action: body.pausedAction,
			expires_at: body.expiresAt !== undefined ? body.expiresAt : undefined,
		});

		if (!updated) {
			return c.json({ error: "Failed to update alias" }, 500);
		}

		await putRoutingRecord(c.env.BUCKET, routingRecord(updated, mailboxId));
		return c.json({ alias: updated });
	});

	// Delete a private email; mail to it bounces from then on.
	app.delete("/api/v1/mailboxes/:mailboxId/aliases/:aliasId", async (c) => {
		const stub = c.var.mailboxStub;
		const aliasId = c.req.param("aliasId");

		const existing = await stub.getAlias(aliasId);
		if (!existing) {
			return c.json({ error: "Alias not found" }, 404);
		}

		await c.env.BUCKET.delete(aliasMetadataKey(existing.alias_email));
		await stub.deleteAlias(existing.id);

		return c.body(null, 204);
	});
}
