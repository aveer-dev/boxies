// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Centralised query key factories for cache invalidation. */
export const queryKeys = {
	mailboxes: {
		all: ["mailboxes"] as const,
		detail: (id: string) => ["mailboxes", id] as const,
	},
	emails: {
		list: (mailboxId: string, params: Record<string, string>) =>
			["emails", mailboxId, params] as const,
		detail: (mailboxId: string, emailId: string) =>
			["emails", mailboxId, emailId] as const,
		thread: (mailboxId: string, threadId: string) =>
			["emails", mailboxId, "thread", threadId] as const,
	},
	summaries: {
		all: (mailboxId: string) => ["summaries", mailboxId] as const,
		thread: (mailboxId: string, threadId: string) =>
			["summaries", mailboxId, "thread", threadId] as const,
		email: (mailboxId: string, emailId: string) =>
			["summaries", mailboxId, "email", emailId] as const,
	},
	folders: {
		list: (mailboxId: string) => ["folders", mailboxId] as const,
	},
	workflowPiles: {
		list: (mailboxId: string) => ["workflow-piles", mailboxId] as const,
	},
	inboxDigest: {
		detail: (mailboxId: string) => ["inbox-digest", mailboxId] as const,
	},
	search: {
		results: (mailboxId: string, query: string, page: number) =>
			["search", mailboxId, query, page] as const,
	},
	recipients: {
		list: (mailboxId: string, q: string) =>
			["recipients", mailboxId, q] as const,
	},
	domainService: (domain: string) => ["domain-service", domain] as const,
	config: ["config"] as const,
	account: {
		me: ["me"] as const,
		identities: ["identities"] as const,
		sessions: ["account", "sessions"] as const,
		mcpGrants: ["account", "mcp-grants"] as const,
		recoveryEmail: ["account", "recovery-email"] as const,
		passkeys: ["account", "passkeys"] as const,
	},
	suppressions: {
		list: (mailboxId: string) => ["suppressions", mailboxId] as const,
	},
	members: {
		list: (mailboxId: string) => ["members", mailboxId] as const,
		invites: (mailboxId: string) => ["members", mailboxId, "invites"] as const,
	},
};
