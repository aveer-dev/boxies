// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * MCP OAuth consent (AVE-68): the scopes a connected app can be granted, the
 * data the Worker hands the web consent page (app/routes/authorize.tsx), and
 * the server-side check of what the consent form posted back.
 *
 * The Worker (workers/mcp/oauth.ts) owns every decision: the page only
 * renders this view and posts a plain form, and the POST is re-validated
 * here against the user's mailboxes as read from AUTH_DB at submit time.
 */

/** Everything this server can grant (planned in AVE-36). `read` is always granted. */
export const MCP_OAUTH_SCOPES = ["read", "draft", "send", "manage"] as const;
export type McpOAuthScope = (typeof MCP_OAUTH_SCOPES)[number];

/** The minimum grant: an app that can't read your mail can't do anything useful. */
export const MCP_REQUIRED_SCOPE: McpOAuthScope = "read";

export const MCP_SCOPE_COPY: Record<McpOAuthScope, { label: string; description: string }> = {
	read: { label: "Read mail", description: "See your mailboxes, folders, messages and threads, and search them." },
	draft: { label: "Write drafts", description: "Create and edit drafts. Drafts aren't sent until you send them." },
	send: { label: "Send mail", description: "Send new messages and replies from the mailboxes you pick." },
	manage: { label: "Organize mail", description: "Mark messages read or unread, move them between folders, and delete them." },
};

/** What the Worker gives the consent page to render. Plain JSON. */
export type McpConsentView = {
	/** Posted back with the form; bound to this browser by the library's cookie. */
	handle: string;
	/** The signed-in user's id, posted back so a switched account is caught. */
	account: string;
	email: string;
	client: {
		name: string;
		/** Set only for Client ID Metadata Document clients (verified domain). */
		domain: string | null;
		redirectHost: string;
		redirectIsLoopback: boolean;
	};
	/** Scopes pre-checked on the page: `read` plus what the client asked for. */
	requestedScopes: McpOAuthScope[];
	/** Mailboxes the signed-in user can open, in display order. */
	mailboxes: Array<{ id: string; role: string }>;
};

/** Form field names. The page and the Worker must agree. */
export const CONSENT_FIELDS = {
	handle: "handle",
	account: "account",
	decision: "decision",
	scope: "scope",
	mailbox: "mailbox",
} as const;

/** The client's requested scopes as the page should pre-check them: known ones only, `read` always. */
export function initialConsentScopes(requested: readonly string[]): McpOAuthScope[] {
	const asked = new Set(requested);
	return MCP_OAUTH_SCOPES.filter((scope) => scope === MCP_REQUIRED_SCOPE || asked.has(scope));
}

export type ConsentSelection =
	| { ok: true; scopes: McpOAuthScope[]; mailboxIds: string[] }
	| { ok: false; error: string };

/**
 * Validate what the consent form posted. Scopes must be known, include
 * `read`, and appear at most once; every mailbox must be one of
 * `accessibleMailboxIds` (the user's live memberships, read at submit time),
 * and at least one must be chosen. Never trust the posted ids beyond that.
 */
export function validateConsentSelection(
	posted: { scopes: readonly string[]; mailboxIds: readonly string[] },
	accessibleMailboxIds: readonly string[],
): ConsentSelection {
	const known = new Set<string>(MCP_OAUTH_SCOPES);
	const scopes = new Set<string>();
	for (const scope of posted.scopes) {
		if (!known.has(scope)) return { ok: false, error: "That access level isn't one Inboxies offers." };
		scopes.add(scope);
	}
	if (!scopes.has(MCP_REQUIRED_SCOPE)) return { ok: false, error: "Reading mail is required to connect an app." };

	const accessible = new Set(accessibleMailboxIds);
	const mailboxIds = new Set<string>();
	for (const id of posted.mailboxIds) {
		if (!accessible.has(id)) return { ok: false, error: "You can't share a mailbox you don't have access to." };
		mailboxIds.add(id);
	}
	if (mailboxIds.size === 0) return { ok: false, error: "Choose at least one mailbox." };

	return {
		ok: true,
		// Canonical order, so grants compare and display predictably.
		scopes: MCP_OAUTH_SCOPES.filter((scope) => scopes.has(scope)),
		mailboxIds: accessibleMailboxIds.filter((id) => mailboxIds.has(id)),
	};
}
