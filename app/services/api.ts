// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type {
	AgentConversation,
	Email,
	Folder,
	InboxDigest,
	Mailbox,
	RecentRecipient,
	SenderPreference,
} from "~/types";

const REQUEST_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
	status: number;
	body: Record<string, unknown>;

	constructor(status: number, body: Record<string, unknown>) {
		super((body.error as string) || `Request failed: ${status}`);
		this.name = "ApiError";
		this.status = status;
		this.body = body;
	}
}

async function request<T>(
	url: string,
	options: RequestInit = {},
): Promise<T> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	// Combine caller signal (e.g. TanStack Query abort) with our timeout signal
	const signal = options.signal
		? AbortSignal.any([options.signal, controller.signal])
		: controller.signal;

	try {
		const res = await fetch(url, {
			...options,
			credentials: "include",
			signal,
			headers: {
				"Content-Type": "application/json",
				...(options.headers as Record<string, string>),
			},
		});

		if (!res.ok) {
			const contentType = res.headers.get("content-type") ?? "";
			if (contentType.includes("application/json")) {
				const body = await res.json().catch(() => ({}));
				throw new ApiError(res.status, body as Record<string, unknown>);
			}
			const text = (await res.text().catch(() => "")).trim();
			throw new ApiError(res.status, {
				error: text || `Request failed: ${res.status}`,
			});
		}

		if (res.status === 204) return undefined as T;

		const contentType = res.headers.get("content-type") ?? "";
		if (contentType.includes("application/json")) {
			return res.json() as Promise<T>;
		}
		return res.blob() as unknown as T;
	} finally {
		clearTimeout(timeout);
	}
}

function get<T>(url: string, opts?: { params?: Record<string, string>; responseType?: string; signal?: AbortSignal }) {
	const query = opts?.params ? `?${new URLSearchParams(opts.params)}` : "";
	return request<T>(`${url}${query}`, {
		method: "GET",
		signal: opts?.signal,
		...(opts?.responseType === "blob" ? { headers: { Accept: "*/*" } } : {}),
	});
}

function post<T>(url: string, body?: unknown, opts?: { signal?: AbortSignal }) {
	return request<T>(url, {
		method: "POST",
		signal: opts?.signal,
		body: body != null ? JSON.stringify(body) : undefined,
	});
}

function put<T>(url: string, body?: unknown) {
	return request<T>(url, {
		method: "PUT",
		body: body != null ? JSON.stringify(body) : undefined,
	});
}

function del<T>(url: string) {
	return request<T>(url, { method: "DELETE" });
}

// ---------- Typed response shapes ----------

interface EmailListResponse {
	emails: Email[];
	totalCount: number;
	newCount?: number;
	seenCount?: number;
}

interface InviteCreateResponse {
	token: string;
	inviteUrl: string;
	emailSent: boolean;
	emailError: string | null;
	mailboxId: string;
	inviteeEmail: string;
	role: string;
	expiresAt: string;
}

// ---------- API client ----------

const api = {
	// Config
	getConfig: () =>
		get<{ mailDomain: string; domains: string[]; emailAddresses: string[] }>(
			"/api/v1/config",
		),

    // Mailboxes
	listMailboxes: () => get<Mailbox[]>("/api/v1/mailboxes"),
	getMe: () =>
		get<{
			email: string | null;
			sub: string | null;
			linkedEmails?: string[];
			keys: string[];
			isAdmin?: boolean;
			mailDomain?: string;
			domains?: string[];
		}>("/api/v1/me"),
	listIdentities: () =>
		get<{
			accountId: string;
			identities: {
				type: string;
				key: string;
				label: string;
				current: boolean;
			}[];
			keys: string[];
			linkedEmails: string[];
		}>("/api/v1/me/identities"),
	createIdentityLinkCode: () =>
		post<{
			code: string;
			emails: string[];
			principals: string[];
			accountId?: string;
			expiresAt: string;
		}>("/api/v1/me/identity-link-codes"),
	redeemIdentityLink: (code: string) =>
		post<{
			ok: boolean;
			accountId: string;
			linkedEmails: string[];
			keys: string[];
			isAdmin: boolean;
			identities?: {
				type: string;
				key: string;
				label: string;
				current: boolean;
			}[];
		}>("/api/v1/auth/redeem-identity-link", { code }),
	createMailbox: (email: string, name: string, settings?: unknown) =>
		post<Mailbox>("/api/v1/mailboxes", { email, name, settings }),
	getMailbox: (mailboxId: string) =>
		get<Mailbox>(`/api/v1/mailboxes/${mailboxId}`),
	updateMailbox: (mailboxId: string, settings: unknown) =>
		put<Mailbox>(`/api/v1/mailboxes/${mailboxId}`, { settings }),
	deleteMailbox: (mailboxId: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}`),

	// Domain admin
	listAdminMailboxes: () =>
		get<
			{
				id: string;
				email: string;
				name: string;
				acl: { owners: string[]; members: string[] };
				claimed: boolean;
				fromName: string | null;
			}[]
		>("/api/v1/admin/mailboxes"),
	createAdminMailbox: (body: {
		email: string;
		name?: string;
		assignTo?:
			| "self"
			| { inviteEmail: string; inviteeName?: string; role?: "owner" | "member" };
	}) =>
		post<
			Mailbox & {
				invite: {
					token: string;
					inviteUrl: string;
					emailSent: boolean;
					emailError: string | null;
					inviteeEmail: string;
					role: string;
				} | null;
			}
		>("/api/v1/admin/mailboxes", body),
	assignAdminMailbox: (
		mailboxId: string,
		assignTo:
			| "self"
			| { inviteEmail: string; inviteeName?: string; role?: "owner" | "member" },
	) =>
		post<unknown>(`/api/v1/admin/mailboxes/${encodeURIComponent(mailboxId)}/assign`, {
			assignTo,
		}),
	transferAdminAcl: (
		mailboxId: string,
		acl: { owners: string[]; members?: string[] },
	) =>
		put<Mailbox>(
			`/api/v1/admin/mailboxes/${encodeURIComponent(mailboxId)}/acl`,
			acl,
		),
	deleteAdminMailbox: (mailboxId: string) =>
		del<void>(`/api/v1/admin/mailboxes/${encodeURIComponent(mailboxId)}`),
	createAdminInvite: (body: {
		mailboxId: string;
		inviteEmail: string;
		inviteeName?: string;
		role?: "owner" | "member";
	}) => post<InviteCreateResponse>("/api/v1/admin/invites", body),
	revokeAdminInvite: (token: string) =>
		post<unknown>(`/api/v1/admin/invites/${encodeURIComponent(token)}/revoke`),
	resendAdminInvite: (token: string) =>
		post<InviteCreateResponse>(
			`/api/v1/admin/invites/${encodeURIComponent(token)}/resend`,
		),

	// Invites + password (public)
	getInvite: (token: string) =>
		get<{
			mailboxId: string;
			role: string;
			inviteeEmail: string;
			inviteeName: string | null;
			expiresAt: string;
			status: string;
		}>(`/api/v1/invites/${encodeURIComponent(token)}`),
	acceptInvite: (
		token: string,
		body: { password: string; displayName?: string },
	) =>
		post<{
			mailboxId: string;
			userId: string;
			token: string;
			expiresAt: string;
		}>(`/api/v1/invites/${encodeURIComponent(token)}/accept`, body),
	passwordLogin: (email: string, password: string) =>
		post<{ token: string; expiresAt: string; email: string | null }>(
			"/api/v1/auth/password",
			{ email, password },
		),
	passwordLogout: () => post<{ ok: boolean }>("/api/v1/auth/password/logout"),

	// Sharing invite (owner)
	createMailboxInvite: (
		mailboxId: string,
		body: {
			inviteEmail: string;
			inviteeName?: string;
			role?: "owner" | "member";
		},
	) =>
		post<InviteCreateResponse>(
			`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/invites`,
			body,
		),

	// Emails
	listEmails: (mailboxId: string, params: Record<string, string>, opts?: { signal?: AbortSignal }) =>
		get<EmailListResponse | Email[]>(`/api/v1/mailboxes/${mailboxId}/emails`, { params, signal: opts?.signal }),
	sendEmail: (mailboxId: string, email: unknown) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails`, email),
	getEmail: (mailboxId: string, id: string, opts?: { signal?: AbortSignal }) =>
		get<Email>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`, { signal: opts?.signal }),
	updateEmail: (mailboxId: string, id: string, data: unknown) =>
		put<Email>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`, data),
	deleteEmail: (mailboxId: string, id: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`),
	moveEmail: (
		mailboxId: string,
		id: string,
		folderId: string,
		opts?: { setSenderPreference?: boolean },
	) =>
		post<{
			status: string;
			preference?: SenderPreference | null;
			refiledCount?: number;
			preferenceError?: string;
		}>(`/api/v1/mailboxes/${mailboxId}/emails/${id}/move`, {
			folderId,
			setSenderPreference: opts?.setSenderPreference,
		}),
	listSenderPreferences: (
		mailboxId: string,
		params?: { q?: string; folder?: string; limit?: number },
		opts?: { signal?: AbortSignal },
	) => {
		const query: Record<string, string> = {};
		if (params?.q) query.q = params.q;
		if (params?.folder) query.folder = params.folder;
		if (params?.limit != null) query.limit = String(params.limit);
		return get<{ preferences: SenderPreference[] }>(
			`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/sender-preferences`,
			{ params: query, signal: opts?.signal },
		);
	},
	upsertSenderPreference: (
		mailboxId: string,
		address: string,
		data: {
			folderId: string;
			displayName?: string | null;
			refile?: boolean;
		},
	) =>
		put<{ preference: SenderPreference; refiledCount: number }>(
			`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/sender-preferences/${encodeURIComponent(address)}`,
			data,
		),
	deleteSenderPreference: (mailboxId: string, address: string) =>
		del<void>(
			`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/sender-preferences/${encodeURIComponent(address)}`,
		),
	getThread: (mailboxId: string, threadId: string, opts?: { signal?: AbortSignal }) =>
		get<Email[]>(`/api/v1/mailboxes/${mailboxId}/threads/${threadId}`, { signal: opts?.signal }),
	listRecentRecipients: (
		mailboxId: string,
		params?: { q?: string; limit?: number },
		opts?: { signal?: AbortSignal },
	) => {
		const query: Record<string, string> = {};
		if (params?.q) query.q = params.q;
		if (params?.limit != null) query.limit = String(params.limit);
		return get<{ recipients: RecentRecipient[] }>(
			`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/recipients`,
			{ params: query, signal: opts?.signal },
		);
	},
	markThreadRead: (mailboxId: string, threadId: string) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/threads/${threadId}/read`),
	getAttachment: (mailboxId: string, emailId: string, attachmentId: string) =>
		get<Blob>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/attachments/${attachmentId}`, { responseType: "blob" }),
	saveDraft: (
		mailboxId: string,
		draft: {
			to?: string;
			cc?: string;
			bcc?: string;
			subject?: string;
			body: string;
			in_reply_to?: string;
			thread_id?: string;
			draft_id?: string;
		},
	) => post<{ id: string; draft_id?: string }>(`/api/v1/mailboxes/${mailboxId}/drafts`, draft),
	replyToEmail: (mailboxId: string, emailId: string, email: unknown) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/reply`, email),
	forwardEmail: (mailboxId: string, emailId: string, email: unknown) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/forward`, email),

	// Folders
	listFolders: (mailboxId: string) =>
		get<Folder[]>(`/api/v1/mailboxes/${mailboxId}/folders`),
	listWorkflowPiles: (mailboxId: string) =>
		get<{ piles: { id: string; count: number }[] }>(
			`/api/v1/mailboxes/${mailboxId}/workflow-piles`,
		),
	createFolder: (mailboxId: string, name: string) =>
		post<Folder>(`/api/v1/mailboxes/${mailboxId}/folders`, { name }),
	updateFolder: (mailboxId: string, id: string, name: string) =>
		put<Folder>(`/api/v1/mailboxes/${mailboxId}/folders/${id}`, { name }),
	deleteFolder: (mailboxId: string, id: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}/folders/${id}`),

	// Sender triage (Screener-lite)
	approveSender: (
		mailboxId: string,
		body: {
			sender: string;
			destinationFolderId: string;
			emailId?: string;
			displayName?: string;
		},
	) =>
		post<{ triage: unknown; moved: { moved: number; ids: string[] } }>(
			`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/sender-triage/approve`,
			body,
		),
	rejectSender: (
		mailboxId: string,
		body: { sender: string; emailId?: string; displayName?: string },
	) =>
		post<{ triage: unknown; moved: { moved: number; ids: string[] } }>(
			`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/sender-triage/reject`,
			body,
		),
	deleteSenderTriage: (mailboxId: string, sender: string) =>
		del<void>(
			`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/sender-triage/${encodeURIComponent(sender)}`,
		),

	// Inbox digest (For You)
	getInboxDigest: (mailboxId: string, opts?: { signal?: AbortSignal }) =>
		get<InboxDigest>(`/api/v1/mailboxes/${mailboxId}/inbox-digest`, {
			signal: opts?.signal,
		}),
	completeDigestTodo: (mailboxId: string, todoId: string) =>
		post<{ status: string }>(
			`/api/v1/mailboxes/${mailboxId}/inbox-digest/todos/${todoId}/complete`,
		),
	markDigestTopicRead: (mailboxId: string, topicId: string, emailIds: string[]) =>
		post<{ status: string; count: number }>(
			`/api/v1/mailboxes/${mailboxId}/inbox-digest/topics/${encodeURIComponent(topicId)}/mark-read`,
			{ emailIds },
		),

	// Search
	searchEmails: (mailboxId: string, params: Record<string, string>) =>
		get<EmailListResponse | Email[]>(`/api/v1/mailboxes/${mailboxId}/search`, { params }),

	// Agent conversations (multi-chat)
	listAgentConversations: (mailboxId: string) =>
		get<AgentConversation[]>(
			`/api/v1/mailboxes/${mailboxId}/agent/conversations`,
		),
	createAgentConversation: (mailboxId: string, title?: string) =>
		post<AgentConversation>(
			`/api/v1/mailboxes/${mailboxId}/agent/conversations`,
			title ? { title } : {},
		),
	updateAgentConversation: (
		mailboxId: string,
		conversationId: string,
		data: { title?: string; lastMessagePreview?: string | null },
	) =>
		request<AgentConversation>(
			`/api/v1/mailboxes/${mailboxId}/agent/conversations/${conversationId}`,
			{
				method: "PATCH",
				body: JSON.stringify(data),
			},
		),
	deleteAgentConversation: (mailboxId: string, conversationId: string) =>
		del<void>(
			`/api/v1/mailboxes/${mailboxId}/agent/conversations/${conversationId}`,
		),

	// Mobile auth
	authApple: (identityToken: string, fullName?: { givenName?: string; familyName?: string }) =>
		post<{
			token: string;
			expiresAt: string;
			user: {
				id: string;
				email: string | null;
				fullName: { givenName?: string; familyName?: string } | null;
			};
		}>("/api/v1/auth/apple", { identityToken, fullName }),
	authDev: (email?: string) =>
		post<{
			token: string;
			expiresAt: string;
			user: { id: string; email: string | null; fullName: null };
		}>("/api/v1/auth/dev", { email }),
};

export default api;
