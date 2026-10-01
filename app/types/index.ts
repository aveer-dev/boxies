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

export type PurposeFolderId = "inbox" | "promotions" | "updates";

export interface SenderPreference {
	address: string;
	folderId: PurposeFolderId;
	displayName?: string | null;
	source?: "user" | "screener" | "seeded";
	updatedAt?: string;
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
	canManage?: boolean;
}

export interface MeResponse {
	email: string | null;
	sub: string | null;
	keys: string[];
	isAdmin?: boolean;
	administeredDomains?: string[];
}

export interface CloudflareDnsRecord {
	id: string;
	zone_id: string;
	zone_name: string;
	name: string;
	type: string;
	content: string;
	proxiable: boolean;
	proxied: boolean;
	ttl: number;
	priority?: number;
	comment?: string | null;
}

export interface NewDnsRecord {
	type: string;
	name: string;
	content: string;
	ttl?: number;
	proxied?: boolean;
	priority?: number;
	comment?: string;
}

export interface EmailHealthItem {
	name: string;
	type: "MX" | "SPF" | "DKIM" | "DMARC";
	status: "connected" | "pending" | "missing" | "conflict";
	expectedValue: string;
	currentValue?: string;
	message: string;
}

export interface EmailHealthAudit {
	overallStatus: "healthy" | "action_needed" | "pending";
	zoneStatus: string;
	nameservers: string[];
	items: EmailHealthItem[];
	issues: string[];
}

export interface AdminDomainInfo {
	domain: string;
	zoneId: string;
	status: string;
	nameservers: string[];
	createdAt?: string;
	updatedAt?: string;
}

export interface DomainAvailabilityResponse {
	domain: string;
	available: boolean;
	registered: boolean;
	tldSupported: boolean;
	wholesalePriceUsd: number;
	retailPriceUsd: number;
	currency: string;
	periodYears?: number;
	supportedTld?: string;
	alreadyInInboxies?: boolean;
	message?: string;
}

export interface DomainCheckoutResponse {
	checkoutUrl: string;
	sessionId: string;
	domain: string;
	priceUsd: number;
	mock?: boolean;
}

export interface ExportJob {
	id: string;
	domain?: string;
	mailboxId?: string;
	status: "pending" | "processing" | "completed" | "failed";
	progress: {
		processedCount: number;
		totalCount: number;
		percent: number;
	};
	totalEmails: number;
	fileSizeBytes?: number;
	downloadUrl?: string;
	expiresAt: string;
	createdAt: string;
	error?: string;
}

export interface DecommissionPreflightResponse {
	domain: string;
	status: string;
	activeMailboxCount: number;
	activeMailboxes: string[];
	hasRecentExport: boolean;
	lastExport?: {
		id: string;
		createdAt: string;
		downloadUrl?: string;
		totalEmails: number;
	} | null;
	isRegistrarDomain: boolean;
	transferLocked: boolean;
}

export interface DecommissionResponse {
	success: boolean;
	domain: string;
	status: string;
	eppCode?: string;
	message: string;
}

export interface DomainHealthResponse {
	domain: string;
	zoneId: string;
	zoneStatus: string;
	nameservers: string[];
	audit: EmailHealthAudit;
}

export interface AdminMailboxRow {
	id: string;
	email: string;
	name: string;
	acl: MailboxAcl;
	claimed: boolean;
	fromName: string | null;
}

export interface InviteInfo {
	token: string;
	inviteUrl: string;
	emailSent: boolean;
	emailError?: string | null;
	inviteeEmail: string;
	role: "owner" | "member";
	expiresAt?: string;
	mailboxId?: string;
}

export interface Mailbox {
	id: string;
	email: string;
	name: string;
	settings?: MailboxSettings;
	canManage?: boolean;
}

export interface EmailAuthSnapshot {
	spf?: string;
	dkim?: string;
	dmarc?: string;
	dkimDomain?: string;
	spfMailfrom?: string;
	headerFrom?: string;
	envelopeFrom?: string;
	aligned?: boolean | null;
	spoofed?: boolean;
	source?: "authentication-results" | "arc-authentication-results" | "none";
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
	reply_later?: boolean;
	reply_later_at?: string | null;
	body?: string | null;
	in_reply_to?: string | null;
	email_references?: string | null;
	message_id?: string | null;
	raw_headers?: string | null;
	provider_message_id?: string | null;
	delivery_status?: "queued" | "accepted" | "failed" | "bounced" | "complained" | null;
	delivery_error?: string | null;
	auth?: EmailAuthSnapshot | null;
	attachments?: Attachment[];
	snippet?: string | null;
	// Thread aggregate fields (only present in threaded list view)
	thread_count?: number;
	thread_unread_count?: number;
	participants?: string;
	needs_reply?: boolean;
	has_draft?: boolean;
	has_attachment?: boolean;
	/** Inbox New vs Seen section (threaded inbox list only). */
	list_section?: "new" | "seen";
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
