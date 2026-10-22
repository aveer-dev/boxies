// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Per-tool OAuth scope enforcement for the MCP server (AVE-69).
 *
 * Each tool needs exactly one of the scopes the consent page grants
 * (shared/mcp-consent.ts, AVE-68). The table below is the single source of
 * truth; workers/mcp/index.ts consults it to hide tools a grant doesn't cover
 * from `tools/list` and to refuse them on `tools/call`.
 *
 * - Requests on a Better Auth session token (no `oauth` props, the legacy
 *   full-account path) keep every mapped tool until that path is deprecated.
 * - A tool missing from the table is denied for everyone (fail closed).
 */

import type { McpOAuthScope } from "../../shared/mcp-consent";
import type { McpRequestProps } from "./oauth";

/** Tool name → the scope a grant needs to see and call it. Keep in step with the scope copy on the consent page. */
export const MCP_TOOL_SCOPES = {
	// read: see mailboxes, folders, messages and threads, and search them.
	list_mailboxes: "read",
	list_emails: "read",
	get_email: "read",
	get_thread: "read",
	search_emails: "read",
	// draft: create and edit drafts (never sends).
	draft_reply: "draft",
	create_draft: "draft",
	update_draft: "draft",
	// send: send new messages and replies.
	send_email: "send",
	send_reply: "send",
	// manage: mark read/unread, move between folders, delete.
	mark_email_read: "manage",
	move_email: "manage",
	delete_email: "manage",
} as const satisfies Record<string, McpOAuthScope>;

export type McpToolName = keyof typeof MCP_TOOL_SCOPES;

/** The scope `toolName` needs, or null when the tool isn't in the table. */
export function requiredScopeForTool(toolName: string): McpOAuthScope | null {
	return Object.hasOwn(MCP_TOOL_SCOPES, toolName) ? MCP_TOOL_SCOPES[toolName as McpToolName] : null;
}

/**
 * Whether this request may list and call `toolName`. Unmapped tools are
 * denied; session-token requests (no `oauth`) get every mapped tool; an OAuth
 * grant needs the tool's scope.
 */
export function toolAllowed(oauth: McpRequestProps["oauth"] | undefined, toolName: string): boolean {
	const scope = requiredScopeForTool(toolName);
	if (!scope) return false;
	if (!oauth) return true;
	return oauth.scopes.includes(scope);
}

/** The error a tool call gets when the grant lacks its scope. */
export function scopeDeniedMessage(toolName: string): string {
	const scope = requiredScopeForTool(toolName);
	return scope
		? `This app wasn't granted the "${scope}" permission, which ${toolName} needs. Reconnect the app and allow it.`
		: `Tool ${toolName} is not available.`;
}
