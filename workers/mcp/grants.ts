// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The signed-in user's MCP OAuth grants ("connected apps"), for Settings →
 * Sessions on web, iOS and Android (AVE-70).
 *
 * A grant is one app the user approved on the consent page (workers/mcp/oauth.ts).
 * Revoking it deletes the grant and every access and refresh token issued
 * under it, so the app's next `/mcp` call gets a 401 and it can't refresh.
 *
 * Everything is keyed by the user id from the session: the library stores a
 * grant under `grant:<userId>:<grantId>`, so a user can only ever list or
 * revoke their own.
 */

import type { GrantSummary } from "@cloudflare/workers-oauth-provider";
import type { OAuthApi } from "./oauth";

/** What the clients render. Plain JSON. */
export type McpGrantView = {
	id: string;
	clientId: string;
	/** The name the app registered itself with (unverified), or null. */
	clientName: string | null;
	/** The app's homepage, if it registered one. */
	clientUri: string | null;
	scopes: string[];
	/**
	 * Mailboxes the grant is limited to, when the grant records them in its
	 * metadata (AVE-68). Null means every mailbox the user can open.
	 */
	mailboxIds: string[] | null;
	createdAt: string;
	expiresAt: string | null;
};

/** Grant ids are the library's random ids; anything else can't be one. */
const GRANT_ID = /^[A-Za-z0-9_-]{1,128}$/;

const PAGE_SIZE = 100;
/** A user with more than this many grants is not a real case; stop paging there. */
const MAX_GRANTS = 500;

async function allGrants(api: OAuthApi, userId: string): Promise<GrantSummary[]> {
	const grants: GrantSummary[] = [];
	let cursor: string | undefined;
	do {
		const page = await api.listUserGrants(userId, { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) });
		grants.push(...page.items);
		cursor = page.cursor;
	} while (cursor && grants.length < MAX_GRANTS);
	// The listing is keyed by user already; this is belt and braces.
	return grants.filter((grant) => grant.userId === userId);
}

function stringList(value: unknown): string[] | null {
	return Array.isArray(value) && value.every((item) => typeof item === "string") ? [...value] : null;
}

function isoSeconds(seconds: number | undefined): string | null {
	return typeof seconds === "number" && Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
}

/** The user's grants, newest first, with each app's registered name. */
export async function listMcpGrants(api: OAuthApi, userId: string): Promise<McpGrantView[]> {
	const now = Date.now() / 1000;
	const grants = (await allGrants(api, userId)).filter((grant) => !grant.expiresAt || grant.expiresAt > now);
	const clientIds = [...new Set(grants.map((grant) => grant.clientId))];
	const clients = new Map(
		await Promise.all(
			clientIds.map(async (clientId) => [clientId, await api.lookupClient(clientId).catch(() => null)] as const),
		),
	);
	return grants
		.sort((a, b) => b.createdAt - a.createdAt)
		.map((grant) => {
			const client = clients.get(grant.clientId);
			const metadata = (grant.metadata ?? {}) as { mailboxIds?: unknown };
			return {
				id: grant.id,
				clientId: grant.clientId,
				clientName: client?.clientName?.trim() || null,
				clientUri: client?.clientUri ?? null,
				scopes: stringList(grant.scope) ?? [],
				mailboxIds: stringList(metadata.mailboxIds),
				createdAt: isoSeconds(grant.createdAt) ?? new Date(0).toISOString(),
				expiresAt: isoSeconds(grant.expiresAt),
			};
		});
}

/**
 * Revoke one of the user's grants and all its tokens. False when the user
 * has no such grant (unknown, already revoked, or someone else's).
 */
export async function revokeMcpGrant(api: OAuthApi, userId: string, grantId: string): Promise<boolean> {
	if (!GRANT_ID.test(grantId)) return false;
	const owned = (await allGrants(api, userId)).some((grant) => grant.id === grantId);
	if (!owned) return false;
	await api.revokeGrant(grantId, userId);
	return true;
}
