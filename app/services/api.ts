// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type {
	AgentConversation,
	AiSummaryResponse,
	Email,
	Folder,
	InboxDigest,
	Mailbox,
	RecentRecipient,
	SenderPreference,
	AdminDomainInfo,
	CloudflareDnsRecord,
	DomainHealthResponse,
	NewDnsRecord,
	DomainAvailabilityResponse,
	DomainCheckoutResponse,
	CheckoutStatusResponse,
	DomainService,
	RenewDomainResponse,
	ExportJob,
	DecommissionPreflightResponse,
	DecommissionResponse,
	MaskedAlias,
	MeResponse,
	AccountSession,
	McpGrant,
	RecoveryEmailStatus,
	MailboxMember,
	MailboxInviteRow,
	MailboxRole,
} from "~/types";
import { idempotencyHeaders } from "~/lib/send-idempotency";

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

/** Per-call options; `signal` lets TanStack Query cancel in-flight requests. */
type RequestOptions = { signal?: AbortSignal };

function get<T>(
	url: string,
	opts?: { params?: Record<string, string | undefined>; responseType?: string } & RequestOptions,
) {
	// Drop undefined params instead of sending the string "undefined".
	const params = Object.fromEntries(
		Object.entries(opts?.params ?? {}).filter((entry): entry is [string, string] => entry[1] !== undefined),
	);
	const query = Object.keys(params).length > 0 ? `?${new URLSearchParams(params)}` : "";
	return request<T>(`${url}${query}`, {
		method: "GET",
		signal: opts?.signal,
		...(opts?.responseType === "blob" ? { headers: { Accept: "*/*" } } : {}),
	});
}

function post<T>(url: string, body?: unknown, opts?: RequestOptions & { headers?: Record<string, string> }) {
	return request<T>(url, {
		method: "POST",
		signal: opts?.signal,
		headers: opts?.headers,
		body: body != null ? JSON.stringify(body) : undefined,
	});
}

function put<T>(url: string, body?: unknown, opts?: RequestOptions) {
	return request<T>(url, {
		method: "PUT",
		signal: opts?.signal,
		body: body != null ? JSON.stringify(body) : undefined,
	});
}

function patch<T>(url: string, body?: unknown, opts?: RequestOptions) {
	return request<T>(url, {
		method: "PATCH",
		signal: opts?.signal,
		body: body != null ? JSON.stringify(body) : undefined,
	});
}

function del<T>(url: string, opts?: RequestOptions) {
	return request<T>(url, { method: "DELETE", signal: opts?.signal });
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
		get<{
			mailDomain: string;
			domains: string[];
			emailAddresses?: string[];
			googleClientId?: string | null;
			appleSignInConfigured?: boolean;
			/** Services ID for Sign in with Apple on the web; null hides the button. */
			appleWebClientId?: string | null;
		}>("/api/v1/config"),

    // Mailboxes
	listMailboxes: () => get<Mailbox[]>("/api/v1/mailboxes"),
	/** Token for the browser extension; the Worker scopes it to private emails. */
	createExtensionSession: () =>
		post<{ token: string; expiresAt: string }>("/api/v1/me/extension-session"),
	getMe: () => get<MeResponse>("/api/v1/me"),
	/** Delete the signed-in account; mailboxes only this user owns go with it. */
	deleteAccount: () =>
		request<{ ok: boolean; deletedMailboxes: string[]; leftMailboxes: string[] }>("/api/v1/me", {
			method: "DELETE",
			body: JSON.stringify({ confirm: "DELETE" }),
		}),

	// Sessions
	listSessions: () => get<AccountSession[]>("/api/v1/me/sessions"),
	revokeSession: (sessionId: string) =>
		del<{ ok: boolean }>(`/api/v1/me/sessions/${encodeURIComponent(sessionId)}`),
	revokeOtherSessions: () =>
		post<{ ok: boolean; revoked: number }>("/api/v1/me/sessions/revoke-others"),

	// Connected apps (MCP OAuth grants)
	listMcpGrants: () => get<McpGrant[]>("/api/v1/me/mcp-grants"),
	revokeMcpGrant: (grantId: string) =>
		del<{ ok: boolean }>(`/api/v1/me/mcp-grants/${encodeURIComponent(grantId)}`),

	// Recovery email (where password reset codes go)
	getRecoveryEmail: () => get<RecoveryEmailStatus>("/api/v1/me/recovery-email"),
	/** Sets (or replaces) the address and mails it a 6-digit code. */
	setRecoveryEmail: (email: string) =>
		post<{ ok: boolean; email: string; verified: false; devCode?: string }>(
			"/api/v1/me/recovery-email",
			{ email },
		),
	verifyRecoveryEmail: (code: string) =>
		post<{ ok: boolean; email: string; verified: true }>("/api/v1/me/recovery-email/verify", { code }),
	removeRecoveryEmail: () => del<{ ok: boolean }>("/api/v1/me/recovery-email"),

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
	attachIdentity: (body:
		| { provider: "apple"; identityToken: string }
		| { provider: "google"; idToken: string }
		| { provider: "password"; password: string; loginEmail?: string }) =>
		post<{
			ok: boolean;
			provider: string;
			accountId: string;
			userId?: string;
			linkedEmails: string[];
			keys: string[];
			isAdmin: boolean;
			identities: {
				type: string;
				key: string;
				label: string;
				current: boolean;
			}[];
		}>("/api/v1/me/identities/attach", body),
	changePassword: (body: { currentPassword: string; newPassword: string }) =>
		post<{
			ok: boolean;
			userId: string;
			accountId: string;
			identities: {
				type: string;
				key: string;
				label: string;
				current: boolean;
			}[];
		}>("/api/v1/me/identities/password", body),
	/** Disconnect a sign-in method; the server refuses to remove the last one. */
	removeIdentity: (type: string) =>
		del<{ ok: boolean }>(`/api/v1/me/identities/${encodeURIComponent(type)}`),
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
	/** Mails a 6-digit code to the invited address. */
	sendInviteCode: (token: string) =>
		post<{ ok: boolean; sentTo: string; devCode?: string }>(
			`/api/v1/invites/${encodeURIComponent(token)}/otp`,
		),
	/**
	 * Signed in: `code` joins the invite to this account. Signed out: creates
	 * a new account with `password` and sets the session cookie.
	 */
	acceptInvite: (
		token: string,
		body: { code: string; password?: string; displayName?: string },
	) =>
		post<{
			mailboxId: string;
			userId: string;
			email?: string;
		}>(`/api/v1/invites/${encodeURIComponent(token)}/accept`, body),
	passwordLogin: (email: string, password: string) =>
		post<{ token: string; expiresAt: string; email: string | null }>(
			"/api/v1/auth/password",
			{ email, password },
		),
	/** Google ID token from the GIS button; sets the session cookie like passwordLogin. */
	googleLogin: (idToken: string) =>
		post<{ token: string; expiresAt: string }>("/api/v1/auth/google", { idToken }),
	/** Same endpoint as iOS; it also sets the web session cookie. */
	appleLogin: (body: {
		identityToken: string;
		nonce: string;
		/** Apple's one-time code; the Worker exchanges it so account deletion can revoke. */
		authorizationCode?: string;
		fullName?: { givenName?: string; familyName?: string };
	}) => post<{ token: string; expiresAt: string }>("/api/v1/auth/apple", body),
	forgotPassword: (email: string) =>
		post<{
			ok: boolean;
			message: string;
			devResetCode?: string;
			devResetToken?: string;
		}>("/api/v1/auth/password/forgot", { email }),
	/** Pass `token` (email link), or `email` + `code` (6-digit code). */
	resetPassword: (body: {
		token?: string;
		email?: string;
		code?: string;
		newPassword: string;
	}) =>
		post<{
			ok: boolean;
			token?: string;
			expiresAt?: string;
			email?: string | null;
		}>("/api/v1/auth/password/reset", body),
	/** Revokes this session and clears the session cookie. */
	logout: () => post<{ ok: boolean }>("/api/v1/auth/logout"),

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

	listMailboxInvites: (mailboxId: string) =>
		get<MailboxInviteRow[]>(
			`/api/v1/admin/mailboxes/${encodeURIComponent(mailboxId)}/invites`,
		),
	/** `inviteId` is the invite's `id` from the list. */
	revokeMailboxInvite: (inviteId: string) =>
		post<unknown>(`/api/v1/admin/invites/${encodeURIComponent(inviteId)}/revoke`),

	// Members
	listMailboxMembers: (mailboxId: string) =>
		get<MailboxMember[]>(`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/members`),
	setMailboxMemberRole: (mailboxId: string, userId: string, role: MailboxRole) =>
		patch<{ ok: boolean }>(
			`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/members/${encodeURIComponent(userId)}`,
			{ role },
		),
	/** Owners remove anyone; removing yourself leaves the mailbox. */
	removeMailboxMember: (mailboxId: string, userId: string) =>
		del<{ ok: boolean }>(
			`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/members/${encodeURIComponent(userId)}`,
		),

	// Emails
	listEmails: (mailboxId: string, params: Record<string, string>, opts?: { signal?: AbortSignal }) =>
		get<EmailListResponse | Email[]>(`/api/v1/mailboxes/${mailboxId}/emails`, { params, signal: opts?.signal }),
	/** `idempotencyKey`: one per compose, reused on retries (a replay is a 202 too). */
	sendEmail: (mailboxId: string, email: unknown, idempotencyKey?: string) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails`, email, { headers: idempotencyHeaders(idempotencyKey) }),
	getEmail: (mailboxId: string, id: string, opts?: { signal?: AbortSignal }) =>
		get<Email>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`, { signal: opts?.signal }),
	updateEmail: (mailboxId: string, id: string, data: unknown) =>
		put<Email>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`, data),
	/** Moves to Trash; permanent when the email is already in Trash or Drafts. */
	deleteEmail: (mailboxId: string, id: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`),
	emptyTrash: (mailboxId: string) =>
		post<{ deleted: number }>(`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/folders/trash/empty`),
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
	/** Cached thread summary, generated on first open (AVE-20). */
	getThreadSummary: (mailboxId: string, threadId: string, opts?: { signal?: AbortSignal }) =>
		get<AiSummaryResponse>(
			`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/threads/${encodeURIComponent(threadId)}/summary`,
			{ signal: opts?.signal },
		),
	regenerateThreadSummary: (mailboxId: string, threadId: string) =>
		post<AiSummaryResponse>(
			`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/threads/${encodeURIComponent(threadId)}/summary/regenerate`,
		),
	/** Quick summary of one message in a multi-message thread. */
	generateEmailSummary: (
		mailboxId: string,
		emailId: string,
		opts?: { regenerate?: boolean; signal?: AbortSignal },
	) =>
		post<AiSummaryResponse>(
			`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/emails/${encodeURIComponent(emailId)}/summary/generate`,
			{ regenerate: opts?.regenerate ?? false },
			{ signal: opts?.signal },
		),
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
	replyToEmail: (mailboxId: string, emailId: string, email: unknown, idempotencyKey?: string) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/reply`, email, {
			headers: idempotencyHeaders(idempotencyKey),
		}),
	forwardEmail: (mailboxId: string, emailId: string, email: unknown, idempotencyKey?: string) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/forward`, email, {
			headers: idempotencyHeaders(idempotencyKey),
		}),

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

	// Onboarding & Custom Domains
	signupPersonal: (body: {
		username: string;
		password: string;
		displayName?: string;
		backupEmail?: string;
	}) =>
		post<{
			token: string;
			expiresAt: string;
			mailbox: { id: string; email: string; name: string };
			user: { id: string; email: string };
		}>("/api/v1/auth/signup-personal", body),

	signupDomain: (body: {
		domain: string;
		username: string;
		password: string;
		displayName?: string;
		backupEmail?: string;
	}) =>
		post<{
			token: string;
			expiresAt: string;
			mailbox: { id: string; email: string; name: string };
			domain: { domain: string; zoneId: string; status: string; nameservers: string[] };
			audit: unknown;
			user: { id: string; email: string };
		}>("/api/v1/auth/signup-domain", body),

	// Admin Domain & DNS Suite
	listAdminDomains: () =>
		get<{ domains: AdminDomainInfo[] }>("/api/v1/admin/domains"),

	connectAdminDomain: (body: { domain: string }) =>
		post<{
			domain: AdminDomainInfo;
			audit: unknown;
		}>("/api/v1/admin/domains", body),

	getAdminDomain: (domain: string) =>
		get<AdminDomainInfo>(`/api/v1/admin/domains/${encodeURIComponent(domain)}`),

	getDomainDnsHealth: (domain: string) =>
		get<DomainHealthResponse>(
			`/api/v1/admin/domains/${encodeURIComponent(domain)}/dns/health`,
		),

	fixDomainEmailDns: (domain: string) =>
		post<{ success: boolean; audit: unknown }>(
			`/api/v1/admin/domains/${encodeURIComponent(domain)}/dns/fix-email`,
		),

	// Email Aliases & Batch Onboarding Setup
	listDomainAliases: (domain: string) =>
		get<{
			domain: string;
			aliases: Array<{
				aliasLocal: string;
				aliasEmail: string;
				targetMailboxId: string;
				createdAt: string;
			}>;
		}>(`/api/v1/admin/domains/${encodeURIComponent(domain)}/aliases`),

	createDomainAlias: (
		domain: string,
		body: { aliasLocal: string; targetMailboxId: string },
	) =>
		post<{ success: boolean; alias: unknown }>(
			`/api/v1/admin/domains/${encodeURIComponent(domain)}/aliases`,
			body,
		),

	deleteDomainAlias: (domain: string, aliasLocal: string) =>
		del<{ success: boolean; aliasLocal: string }>(
			`/api/v1/admin/domains/${encodeURIComponent(domain)}/aliases/${encodeURIComponent(aliasLocal)}`,
		),

	setupDomainAliases: (
		domain: string,
		aliases: Array<{ aliasLocal: string; targetMailboxId: string }>,
	) =>
		post<{ success: boolean; aliases: unknown[] }>(
			`/api/v1/admin/domains/${encodeURIComponent(domain)}/setup-aliases`,
			{ aliases },
		),

	setupDomainUsers: (
		domain: string,
		users: Array<{ fullName: string; contactEmail: string; username: string }>,
	) =>
		post<{ success: boolean; users: unknown[] }>(
			`/api/v1/admin/domains/${encodeURIComponent(domain)}/setup-users`,
			{ users },
		),

	listDomainDnsRecords: (
		domain: string,
		params?: { type?: string; name?: string },
	) => {
		const query: Record<string, string> = {};
		if (params?.type) query.type = params.type;
		if (params?.name) query.name = params.name;
		return get<{ records: CloudflareDnsRecord[] }>(
			`/api/v1/admin/domains/${encodeURIComponent(domain)}/dns/records`,
			{ params: query },
		);
	},

	createDomainDnsRecord: (domain: string, record: NewDnsRecord) =>
		post<{ record: CloudflareDnsRecord }>(
			`/api/v1/admin/domains/${encodeURIComponent(domain)}/dns/records`,
			record,
		),

	updateDomainDnsRecord: (
		domain: string,
		recordId: string,
		record: NewDnsRecord,
	) =>
		put<{ record: CloudflareDnsRecord }>(
			`/api/v1/admin/domains/${encodeURIComponent(domain)}/dns/records/${encodeURIComponent(recordId)}`,
			record,
		),

	deleteDomainDnsRecord: (domain: string, recordId: string) =>
		del<{ success: boolean; id: string }>(
			`/api/v1/admin/domains/${encodeURIComponent(domain)}/dns/records/${encodeURIComponent(recordId)}`,
		),

	// Registrar & Billing
	checkDomainAvailability: (domain: string) =>
		get<DomainAvailabilityResponse>("/api/v1/auth/domains/check", {
			params: { domain },
		}),

	createDomainCheckout: (body: {
		domain: string;
		username?: string;
		password?: string;
		displayName?: string;
		backupEmail?: string;
		client?: "web" | "ios" | "android";
		returnUrl?: string;
	}) =>
		post<DomainCheckoutResponse>("/api/v1/billing/create-domain-checkout", body),

	getCheckoutStatus: (params: { sessionId?: string; domain?: string }) =>
		get<CheckoutStatusResponse>("/api/v1/billing/checkout-status", {
			params: {
				...(params.sessionId ? { session_id: params.sessionId } : {}),
				...(params.domain ? { domain: params.domain } : {}),
			},
		}),

	getDomainService: (domain: string) =>
		get<DomainService>(`/api/v1/billing/domains/${encodeURIComponent(domain)}/service`),

	/** Stripe's billing portal for the domain's subscription (card, invoices, cancel). */
	openBillingPortal: (domain: string) =>
		post<{ url: string }>(`/api/v1/billing/domains/${encodeURIComponent(domain)}/portal`),

	/** Keep a subscription that is set to end, or start a new one for an ended domain. */
	renewDomain: (domain: string) =>
		post<RenewDomainResponse>(`/api/v1/billing/domains/${encodeURIComponent(domain)}/renew`, { client: "web" }),

	// Email Data Export Engine
	exportMailbox: (mailboxId: string) =>
		post<ExportJob>(`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/export`),

	exportDomain: (domain: string) =>
		post<ExportJob>(`/api/v1/admin/domains/${encodeURIComponent(domain)}/export`),

	getExportJob: (exportId: string) =>
		get<ExportJob>(`/api/v1/exports/${encodeURIComponent(exportId)}`),

	getExportDownloadUrl: (exportId: string) =>
		`/api/v1/exports/${encodeURIComponent(exportId)}/download`,

	// DNS Migration & Offboarding
	getDecommissionPreflight: (domain: string) =>
		post<DecommissionPreflightResponse>(
			`/api/v1/admin/domains/${encodeURIComponent(domain)}/decommission-preflight`,
		),

	decommissionDomain: (
		domain: string,
		body: { confirmDomain: string; skipExportAcknowledged?: boolean },
	) =>
		post<DecommissionResponse>(
			`/api/v1/admin/domains/${encodeURIComponent(domain)}/decommission`,
			body,
		),

	getDomainEppCode: (domain: string) =>
		get<{ domain: string; eppCode: string }>(
			`/api/v1/admin/domains/${encodeURIComponent(domain)}/epp-code`,
		),

	setDomainTransferLock: (domain: string, locked: boolean) =>
		post<{ success: boolean; domain: string; locked: boolean }>(
			`/api/v1/admin/domains/${encodeURIComponent(domain)}/transfer-lock`,
			{ locked },
		),

	// Private emails (aliases on the mailbox's own domain)
	listAliases: (mailboxId: string, options?: RequestOptions) =>
		get<{ aliases: MaskedAlias[] }>(
			`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/aliases`,
			options,
		),

	createAlias: (
		mailboxId: string,
		body: {
			label?: string | null;
			expiresAt?: string | null;
			pausedAction?: "drop" | "reject";
		},
		options?: RequestOptions,
	) =>
		post<{ alias: MaskedAlias }>(
			`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/aliases`,
			body,
			options,
		),

	updateAlias: (
		mailboxId: string,
		aliasId: string,
		updates: {
			label?: string | null;
			isActive?: boolean;
			pausedAction?: "drop" | "reject";
			expiresAt?: string | null;
		},
		options?: RequestOptions,
	) =>
		patch<{ alias: MaskedAlias }>(
			`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/aliases/${encodeURIComponent(aliasId)}`,
			updates,
			options,
		),

	deleteAlias: (mailboxId: string, aliasId: string, options?: RequestOptions) =>
		del<void>(
			`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/aliases/${encodeURIComponent(aliasId)}`,
			options,
		),
};

export default api;
