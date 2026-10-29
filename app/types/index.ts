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
	/** Only mail delivered via this private email. */
	toAlias?: string;
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

export type SenderRuleKind = "address" | "domain";
export type SenderRuleVerdict = "allow" | "block";

/** An explicit allow / block rule (Settings → Senders, AVE-96 / AVE-97). */
export interface SenderRule {
	id: string;
	kind: SenderRuleKind;
	value: string;
	verdict: SenderRuleVerdict;
	/** not_spam, report_spam, settings, screener, sent, bootstrap */
	source: string;
	createdAt: string;
	updatedAt: string;
	lastMatchedAt: string | null;
	matchCount: number;
}

/**
 * Read-only membership the server synthesizes for older app builds. Never
 * sent back: membership changes go through invites and the members routes.
 */
export interface MailboxAcl {
	owners?: string[];
	members?: string[];
}

export type MailboxRole = "owner" | "member";

export interface MailboxSettings {
	fromName?: string;
	forwarding?: { enabled: boolean; email: string };
	signature?: SignatureSettings;
	autoReply?: { enabled: boolean; subject: string; message: string };
	agentSystemPrompt?: string;
	filters?: InboxFilterRule[];
	/** Screener for first-time senders. Absent means on (AVE-104). */
	screener?: { enabled?: boolean };
	/** Server-synthesized, read-only; stripped before every save. */
	acl?: MailboxAcl;
	canManage?: boolean;
}

export interface MeResponse {
	userId: string;
	name: string | null;
	email: string | null;
	sub: string | null;
	keys: string[];
	isAdmin?: boolean;
	administeredDomains?: string[];
	mailDomain?: string;
	domains?: string[];
	sessionScope?: string | null;
	/** TOTP two-factor is on (it only challenges password sign-in). */
	twoFactorEnabled?: boolean;
}

export interface AccountSession {
	id: string;
	label: string | null;
	scope: string | null;
	userAgent: string | null;
	ipAddress: string | null;
	createdAt: string;
	lastActiveAt: string;
	expiresAt: string;
	current: boolean;
}

/** An app connected over MCP OAuth (Settings → Devices → Connected apps). */
export interface McpGrant {
	id: string;
	clientId: string;
	/** Self-registered and unverified; null when the app gave none. */
	clientName: string | null;
	clientUri: string | null;
	scopes: string[];
	/** Mailboxes the app is limited to; null means every mailbox. */
	mailboxIds: string[] | null;
	createdAt: string;
	expiresAt: string | null;
}

export interface RecoveryEmailStatus {
	email: string | null;
	verified: boolean;
}

export interface MailboxMember {
	userId: string;
	email: string;
	name: string | null;
	role: MailboxRole;
	you: boolean;
}

export interface MailboxInviteRow {
	id: string;
	mailboxId: string;
	role: MailboxRole;
	inviteeEmail: string;
	inviteeName?: string;
	expiresAt: string;
	status: "pending" | "accepted" | "revoked" | "expired";
	createdAt: string;
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

export interface DomainPricingBreakdown {
	domainFeeUsd: number;
	platformFeeUsd: number;
	totalAnnualUsd: number;
	billingInterval: "year";
	currency: "USD";
	features?: {
		domain: string;
		aiAndPlatform: string[];
	};
}

export interface DomainAvailabilityResponse {
	domain: string;
	available: boolean;
	registered: boolean;
	tldSupported: boolean;
	wholesalePriceUsd: number;
	retailPriceUsd: number;
	pricing?: DomainPricingBreakdown;
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
	pricing?: DomainPricingBreakdown;
	mock?: boolean;
}

export interface CheckoutStatusResponse {
	/**
	 * `awaiting_payment`: a bank payment is still clearing (can take days).
	 * `refunded`: the domain couldn't be bought, so the payment was returned.
	 * `canceled`: the checkout was abandoned or expired.
	 */
	status: "pending" | "awaiting_payment" | "provisioning" | "ready" | "failed" | "refunded" | "canceled";
	domain: string;
	pricing?: DomainPricingBreakdown;
	mailboxId?: string;
	error?: string;
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
	/** When the domain's data is deleted unless finalized sooner (AVE-43). */
	finalizeAfter?: string;
	offboarding?: DomainOffboardingState | null;
}

/** Where a decommissioned domain's offboarding stands (`/offboarding`). */
export interface DomainOffboardingState {
	decommissionedAt: string;
	/** Scheduled deletion: decommission + grace period, never under 7 days after the warning. */
	finalizeAfter: string;
	graceDays: number;
	warningSentAt: string | null;
	finalizeRequestedAt: string | null;
	finalizeStartedAt: string | null;
	finalizedAt: string | null;
	step: string | null;
	lastError: string | null;
	canFinalizeNow: boolean;
	scheduledFinalizeDue: boolean;
}

export interface OffboardingDomain {
	domain: string;
	offboarding: DomainOffboardingState;
}

export interface FinalizeDomainResponse {
	success: boolean;
	domain: string;
	finalized: boolean;
	/** "in_progress" or "will_retry" when it didn't finish now; the hourly run does. */
	status?: string;
	mailboxesPurged?: number;
	subscriptionCanceled?: boolean;
	error?: string;
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
	role?: MailboxRole | null;
	canManage?: boolean;
	/** The domain's subscription ended: read and export only. */
	readOnly?: boolean;
	/** Billing state of the mailbox's domain; null for domains Inboxies doesn't bill. */
	service?: DomainService | null;
}

/** Where a paid domain's service stands (GET /api/v1/billing/domains/:domain/service). */
export interface DomainService {
	domain: string;
	status: "active" | "ending" | "ended";
	/** When a subscription set to cancel ends. */
	endsAt?: string;
	endedAt?: string;
	registrarManaged: boolean;
	registrationExpiresAt?: string;
	/** Last day the domain can be renewed (registrar grace period). */
	renewBy?: string;
	daysLeftToRenew?: number;
	canRenew: boolean;
	/** The caller is an owner/admin of the domain (only those can renew). */
	canManage?: boolean;
	billed?: boolean;
	/** In service: the next yearly charge (60 days before the registration expires). */
	nextChargeAt?: string;
	nextChargeUsd?: number;
	/** Ended: when the mail on the domain is deleted (30 days after the name is released). */
	purgeAt?: string;
}

export interface RenewDomainResponse {
	resumed?: boolean;
	renewed?: boolean;
	checkoutUrl?: string;
	sessionId?: string;
	service?: DomainService;
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
	dmarcPolicy?: "none" | "quarantine" | "reject";
	authTier?: "verified" | "unverified" | "failed";
	/** Same as `authTier === "failed"`. */
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
	/** Pending Reply Later reminder, UTC ISO (AVE-86). */
	reply_later_remind_at?: string | null;
	/** When the reminder fired; with `read === false` the mail is due. */
	reply_later_reminded_at?: string | null;
	body?: string | null;
	in_reply_to?: string | null;
	email_references?: string | null;
	message_id?: string | null;
	raw_headers?: string | null;
	provider_message_id?: string | null;
	delivery_status?: "queued" | "accepted" | "failed" | "bounced" | "complained" | null;
	delivery_error?: string | null;
	auth?: EmailAuthSnapshot | null;
	/** Auth tier at receive time; null on outbound mail. */
	auth_tier?: "verified" | "unverified" | "failed" | null;
	/** RFC 8058 one-click unsubscribe is available (AVE-99); set on reader fetches. */
	one_click_unsubscribe?: boolean;
	/** Why inbound mail was filed where it was (code; see shared/spam-reason). */
	classification_reason?: string | null;
	/** Sender rule that decided the folder (null until sender rules exist). */
	matched_rule_id?: string | null;
	/** Private email the message arrived on or was sent from. */
	alias_id?: string | null;
	/** Detail/thread payloads only. Replies go out from this address. */
	alias_email?: string | null;
	/** Alias still active and unexpired; false means replies are refused. */
	alias_active?: boolean | null;
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
	/** Threaded list only: the signed-in user's own notes on this conversation. */
	has_sticky_note?: boolean;
	/** Latest sticky note's markdown, trimmed to a short snippet. */
	sticky_note_text?: string | null;
	inline_note_count?: number;
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

export type {
	AiSummary,
	AiSummaryIneligibleReason,
	AiSummaryResponse,
	AiSummaryTargetType,
} from "shared/ai-summaries";

export type {
	ThreadNote,
	ThreadNoteType,
	CreateThreadNoteRequest,
	UpdateThreadNoteRequest,
	ThreadNoteListFields,
} from "shared/thread-notes";

export interface MaskedAlias {
	id: string;
	alias_email: string;
	domain: string;
	base_domain: string;
	label: string | null;
	is_active: number;
	paused_action: "drop" | "reject";
	expires_at: string | null;
	created_at: string;
	stats_received: number;
	stats_blocked: number;
}
