// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import {
	buildMaskedAddress,
	generateRandomAliasToken,
	aliasMetadataKey,
	type StoredAliasMetadata,
} from "../lib/alias-utils";
import { mailDomainConfig } from "../lib/mail-domain";

const CreateAliasSchema = z.object({
	baseDomain: z.string().trim().optional(),
	label: z.string().trim().max(100).optional(),
	expiresAt: z.string().datetime().optional().nullable(),
	pausedAction: z.enum(["drop", "reject"]).default("drop"),
});

const UpdateAliasSchema = z.object({
	label: z.string().trim().max(100).optional().nullable(),
	isActive: z.boolean().optional(),
	pausedAction: z.enum(["drop", "reject"]).optional(),
	expiresAt: z.string().datetime().optional().nullable(),
});

export function registerAliasRoutes(app: Hono<any>) {
	// List all masked aliases for this mailbox
	app.get("/api/v1/mailboxes/:mailboxId/aliases", async (c) => {
		const stub = c.var.mailboxStub;
		const list = await stub.listAliases();
		return c.json({ aliases: list });
	});

	// Create a new masked alias on private.<domain>
	app.post("/api/v1/mailboxes/:mailboxId/aliases", async (c) => {
		const mailboxId = c.var.mailboxId;
		const stub = c.var.mailboxStub;

		let body: z.infer<typeof CreateAliasSchema>;
		try {
			const json = await c.req.json().catch(() => ({}));
			body = CreateAliasSchema.parse(json);
		} catch (err: any) {
			return c.json({ error: err.message || "Invalid request body" }, 400);
		}

		// Determine base domain: request body -> mailbox domain -> fallback mail domain
		let baseDomain = body.baseDomain?.trim();
		if (!baseDomain) {
			const atIdx = mailboxId.lastIndexOf("@");
			if (atIdx !== -1) {
				baseDomain = mailboxId.slice(atIdx + 1);
			} else {
				const config = mailDomainConfig(c.env);
				baseDomain = config.mailDomain || config.domains[0] || "inboxies.email";
			}
		}

		// Generate random token and ensure no collision in R2 index
		let token = "";
		let masked = { aliasEmail: "", domain: "", baseDomain: "", local: "" };
		let attempts = 0;
		while (attempts < 5) {
			token = generateRandomAliasToken(8);
			masked = buildMaskedAddress(token, baseDomain);
			const head = await c.env.BUCKET.head(aliasMetadataKey(masked.aliasEmail));
			if (!head) break;
			attempts++;
		}

		if (attempts >= 5) {
			return c.json({ error: "Failed to generate unique alias token. Please try again." }, 500);
		}

		const id = crypto.randomUUID();
		const now = new Date().toISOString();

		// 1. Insert in Durable Object SQLite
		const created = await stub.createAlias({
			id,
			alias_email: masked.aliasEmail,
			domain: masked.domain,
			base_domain: masked.baseDomain,
			label: body.label || null,
			is_active: 1,
			paused_action: body.pausedAction,
			expires_at: body.expiresAt || null,
			created_at: now,
		});

		// 2. Write O(1) envelope lookup metadata into R2
		const meta: StoredAliasMetadata = {
			aliasId: id,
			aliasEmail: masked.aliasEmail,
			targetMailboxId: mailboxId,
			domain: masked.domain,
			baseDomain: masked.baseDomain,
			label: body.label || null,
			isActive: true,
			pausedAction: body.pausedAction,
			expiresAt: body.expiresAt || null,
			createdAt: now,
		};

		await c.env.BUCKET.put(aliasMetadataKey(masked.aliasEmail), JSON.stringify(meta), {
			httpMetadata: { contentType: "application/json" },
		});

		return c.json({ alias: created }, 201);
	});

	// Update an existing masked alias (active/pause, label, expiry, action)
	app.patch("/api/v1/mailboxes/:mailboxId/aliases/:aliasId", async (c) => {
		const mailboxId = c.var.mailboxId;
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

		const updated = await stub.updateAlias(aliasId, {
			label: body.label !== undefined ? body.label : undefined,
			is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : undefined,
			paused_action: body.pausedAction,
			expires_at: body.expiresAt !== undefined ? body.expiresAt : undefined,
		});

		if (!updated) {
			return c.json({ error: "Failed to update alias" }, 500);
		}

		// Update R2 index
		const meta: StoredAliasMetadata = {
			aliasId: updated.id,
			aliasEmail: updated.alias_email,
			targetMailboxId: mailboxId,
			domain: updated.domain,
			baseDomain: updated.base_domain,
			label: updated.label,
			isActive: Boolean(updated.is_active),
			pausedAction: updated.paused_action as "drop" | "reject",
			expiresAt: updated.expires_at,
			createdAt: updated.created_at,
		};

		await c.env.BUCKET.put(aliasMetadataKey(updated.alias_email), JSON.stringify(meta), {
			httpMetadata: { contentType: "application/json" },
		});

		return c.json({ alias: updated });
	});

	// Delete an alias
	app.delete("/api/v1/mailboxes/:mailboxId/aliases/:aliasId", async (c) => {
		const stub = c.var.mailboxStub;
		const aliasId = c.req.param("aliasId");

		const existing = await stub.getAlias(aliasId);
		if (!existing) {
			return c.json({ error: "Alias not found" }, 404);
		}

		// Delete R2 lookup key
		await c.env.BUCKET.delete(aliasMetadataKey(existing.alias_email));

		// Delete in DO SQLite
		await stub.deleteAlias(aliasId);

		return c.body(null, 204);
	});
}
