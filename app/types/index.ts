// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface SignatureSettings {
	enabled: boolean;
	text: string;
	html?: string;
}

export interface InboxFilterRule {
	id: string;
	enabled: boolean;
	name?: string;
	from?: string;
	list?: string;
	subject?: string;
	folderId?: string;
	skipAutoDraft?: boolean;
	forwardTo?: string;
}

export interface MailboxAcl {
	owners?: string[];
	members?: string[];
}

export interface MailboxSettings {
	fromName?: string;
	forwarding?: { enabled: boolean; email: string };
	signature?: SignatureSettings;
	autoReply?: { enabled: boolean; subject: string; message: string };
	agentSystemPrompt?: string;
	filters?: InboxFilterRule[];
	acl?: MailboxAcl;
}

export interface MeResponse {
	email: string | null;
	sub: string | null;
	keys: string[];
}

export interface Mailbox {
	id: string;
	email: string;
	name: string;
	settings?: MailboxSettings;
}

export interface Email {
	id: string;
	thread_id?: string | null;
	folder_id?: string | null;
	subject: string;
	sender: string;
	sender_name?: string | null;
	recipient: string;
	cc?: string;
	bcc?: string;
	date: string;
	read: boolean;
	starred: boolean;
	body?: string | null;
	in_reply_to?: string | null;
	email_references?: string | null;
	message_id?: string | null;
	raw_headers?: string | null;
	provider_message_id?: string | null;
	delivery_status?: "queued" | "accepted" | "failed" | "bounced" | "complained" | null;
	delivery_error?: string | null;
	attachments?: Attachment[];
	snippet?: string | null;
	// Thread aggregate fields (only present in threaded list view)
	thread_count?: number;
	thread_unread_count?: number;
	participants?: string;
	needs_reply?: boolean;
	has_draft?: boolean;
	has_attachment?: boolean;
}

export interface Attachment {
	id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id?: string;
	disposition?: string;
}

export interface Folder {
	id: string;
	name: string;
	unreadCount: number;
}

/** People I've emailed — compose autocomplete suggestion. */
export interface RecentRecipient {
	email: string;
	name?: string | null;
	lastEmailedAt?: string | null;
}

export interface AgentConversation {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	lastMessagePreview?: string | null;
}

export type {
	InboxDigest,
	InboxDigestTodo,
	InboxDigestTopic,
	InboxDigestTopicItem,
} from "shared/inbox-digest";
