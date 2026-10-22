// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Screener-lite: consent gate for unknown senders.
 *
 * Spam files to spam first. Rejected → screened_out. Allowed → explicit
 * destination, else classify (filters may override). Unknown → screener
 * (filters cannot bypass).
 */

import {
	Folders,
	SCREENER_DESTINATION_IDS,
	type ScreenerDestinationId,
} from "../../shared/folders.ts";
import { normalizeEmailAddress } from "./mail-automations.ts";
import { canonicalMailboxId } from "./mailbox-routing.ts";
import type { SenderTrust } from "./classify-email.ts";
import type { InboxFilterHit } from "./inbox-filters.ts";

export type SenderTriageStatus = "allowed" | "rejected";

export interface SenderTriageRow {
	sender: string;
	status: SenderTriageStatus;
	/**
	 * Purpose box the user explicitly picked (Accept menu, Settings → Senders).
	 * Null for auto-allowed senders (outbound recipients, bootstrap), whose
	 * mail is filed by the classifier.
	 */
	destination_folder_id: string | null;
	display_name?: string | null;
	decided_at: string;
	updated_at: string;
}

export interface EmailClassificationLike {
	class: string;
	folderId: string;
	reason?: string;
}

export interface ResolveInboundFolderInput {
	classification: EmailClassificationLike;
	triage: SenderTriageRow | null;
	filterHit: InboxFilterHit | null;
	/** When false, unknowns file by classify+filters (legacy). Default true. */
	screenerEnabled?: boolean;
	/**
	 * Purpose-box preference (Inbox / Promotions / Updates).
	 * Used after filters for allowed senders, or when screener is disabled.
	 */
	preferenceFolderId?: string | null;
}

export interface ResolveInboundFolderResult {
	folderId: string;
	/** Skip AI auto-draft for this message. */
	skipAutoDraft: boolean;
	/** Skip push notifications. */
	skipPush: boolean;
	/** Skip vacation auto-reply. */
	skipAutoReply: boolean;
	/** Skip forwarding (global or filter). */
	skipForward: boolean;
	triageAction: "spam" | "rejected" | "allowed" | "unknown" | "disabled";
}

export function isScreenerDestination(folderId: string): folderId is ScreenerDestinationId {
	return (SCREENER_DESTINATION_IDS as readonly string[]).includes(folderId);
}

export function parseScreenerEnabled(raw: unknown): boolean {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return true;
	const screener = (raw as Record<string, unknown>).screener;
	if (!screener || typeof screener !== "object" || Array.isArray(screener)) {
		return true;
	}
	const enabled = (screener as Record<string, unknown>).enabled;
	if (enabled === false) return false;
	return true;
}

export function screenerSettingsError(raw: unknown): string | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const screener = (raw as Record<string, unknown>).screener;
	if (screener === undefined) return null;
	if (!screener || typeof screener !== "object" || Array.isArray(screener)) {
		return "screener settings must be an object";
	}
	const enabled = (screener as Record<string, unknown>).enabled;
	if (enabled !== undefined && typeof enabled !== "boolean") {
		return "screener.enabled must be a boolean";
	}
	return null;
}

/**
 * Resolve where to file inbound mail after classification + triage lookup.
 *
 * Order: spam → rejected → unknown(screener) → allowed:
 *   filter folder → purpose preference → explicit triage destination → classify.
 * When screener is disabled: spam → rejected (to Spam) → filter → preference → classify.
 */
export function resolveInboundFolder(
	input: ResolveInboundFolderInput,
): ResolveInboundFolderResult {
	const { classification, triage, filterHit } = input;
	const screenerEnabled = input.screenerEnabled !== false;
	const preferenceFolder = input.preferenceFolderId?.trim() || null;
	// A filter that files mail away (archive, trash, a custom folder…) means the
	// user doesn't want to be pinged or have the agent draft a reply for it.
	const filedAway = Boolean(filterHit?.folderId && !isScreenerDestination(filterHit.folderId));

	if (classification.class === "spam" || classification.folderId === Folders.SPAM) {
		return {
			folderId: Folders.SPAM,
			skipAutoDraft: true,
			skipPush: true,
			skipAutoReply: true,
			skipForward: false,
			triageAction: "spam",
		};
	}

	// A rejected sender (declined in Screener, or reported as spam) stays out
	// even with Screener off; there, Spam is where it lands.
	if (triage?.status === "rejected" && !screenerEnabled) {
		return {
			folderId: Folders.SPAM,
			skipAutoDraft: true,
			skipPush: true,
			skipAutoReply: true,
			skipForward: true,
			triageAction: "rejected",
		};
	}

	if (!screenerEnabled) {
		return {
			folderId:
				filterHit?.folderId || preferenceFolder || classification.folderId,
			skipAutoDraft: Boolean(filterHit?.skipAutoDraft) || filedAway,
			skipPush: filedAway,
			skipAutoReply: false,
			skipForward: false,
			triageAction: "disabled",
		};
	}

	if (triage?.status === "rejected") {
		return {
			folderId: Folders.SCREENED_OUT,
			skipAutoDraft: true,
			skipPush: true,
			skipAutoReply: true,
			skipForward: true,
			triageAction: "rejected",
		};
	}

	if (triage?.status === "allowed") {
		const explicitDest =
			triage.destination_folder_id && isScreenerDestination(triage.destination_folder_id)
				? triage.destination_folder_id
				: null;
		return {
			folderId:
				filterHit?.folderId ||
				preferenceFolder ||
				explicitDest ||
				classification.folderId ||
				Folders.INBOX,
			skipAutoDraft: Boolean(filterHit?.skipAutoDraft) || filedAway,
			skipPush: filedAway,
			skipAutoReply: false,
			skipForward: false,
			triageAction: "allowed",
		};
	}

	// Unknown sender — Screener. Filters must not smuggle past the gate. Forwarding
	// still applies: the setting promises a copy of each incoming message, and the
	// forwarder itself drops spam and spoofed mail.
	return {
		folderId: Folders.SCREENER,
		skipAutoDraft: true,
		skipPush: true,
		skipAutoReply: true,
		skipForward: false,
		triageAction: "unknown",
	};
}

/**
 * The user has vouched for this sender: allowed in Screener (accepted, or
 * auto-allowed because you emailed them) or given a purpose box. Rejected
 * senders never count.
 */
export function isVouchedSender(
	triage: SenderTriageRow | null,
	preferenceFolderId?: string | null,
): boolean {
	if (triage?.status === "rejected") return false;
	return triage?.status === "allowed" || Boolean(preferenceFolderId?.trim());
}

/**
 * How much the user vouches for this sender (docs/spam-management-plan.md §5).
 * An allowed sender with a user-picked purpose box (Not spam into a box,
 * Settings → Senders) is an explicit allow; other allowed or sorted senders
 * (emailed, accepted in Screener, bootstrap) are implicit trust.
 */
export function senderTrustOf(
	triage: SenderTriageRow | null,
	preference?: { folderId: string; source: string } | null,
): SenderTrust {
	if (triage?.status === "rejected") return "none";
	if (triage?.status === "allowed" && preference?.source === "user") return "allowed";
	return isVouchedSender(triage, preference?.folderId) ? "implicit" : "none";
}

/** Normalize a From address for triage PK lookup. */
export function normalizeTriageSender(
	sender: string | null | undefined,
): string | null {
	return normalizeEmailAddress(sender);
}

export interface BootstrapSenderSeed {
	sender: string;
	display_name?: string | null;
}

/**
 * Build allow-list seeds from Sent recipients and prior folder senders.
 * Seeds carry no destination — the classifier keeps sorting their mail.
 * Display-name priority: Sent → inbox → promotions → updates (first wins).
 */
export function buildBootstrapAllowSeeds(input: {
	sentAddresses: Array<{ email: string; name?: string | null }>;
	inboxSenders: Array<{ email: string; name?: string | null }>;
	promotionsSenders?: Array<{ email: string; name?: string | null }>;
	updatesSenders?: Array<{ email: string; name?: string | null }>;
}): BootstrapSenderSeed[] {
	const bySender = new Map<string, BootstrapSenderSeed>();

	const add = (entries: Array<{ email: string; name?: string | null }>) => {
		for (const entry of entries) {
			const email = normalizeTriageSender(entry.email);
			if (!email) continue;
			if (bySender.has(email)) continue;
			bySender.set(email, {
				sender: email,
				display_name: entry.name?.trim() || null,
			});
		}
	};

	add(input.sentAddresses);
	add(input.inboxSenders);
	add(input.promotionsSenders ?? []);
	add(input.updatesSenders ?? []);

	return Array.from(bySender.values());
}

/** Flatten to/cc/bcc fields from a send payload into address strings. */
export function collectOutboundRecipientAddresses(
	to: unknown,
	cc?: unknown,
	bcc?: unknown,
): string[] {
	const out: string[] = [];
	const push = (value: unknown) => {
		if (value == null) return;
		if (Array.isArray(value)) {
			for (const item of value) push(item);
			return;
		}
		if (typeof value === "object" && value !== null && "email" in value) {
			const email = (value as { email?: unknown }).email;
			if (typeof email === "string") out.push(email);
			return;
		}
		if (typeof value === "string") {
			for (const part of value.split(",")) {
				const trimmed = part.trim();
				if (trimmed) out.push(trimmed);
			}
		}
	};
	push(to);
	push(cc);
	push(bcc);
	return out;
}

export type SenderTriageStub = {
	getSenderTriage: (sender: string) => Promise<SenderTriageRow | null>;
	upsertSenderTriage: (row: {
		sender: string;
		status: "allowed" | "rejected";
		destination_folder_id?: string | null;
		display_name?: string | null;
	}) => Promise<unknown>;
};

/**
 * After a successful send, allow-list recipients so their replies skip Screener.
 * No destination is stored, so their mail is still sorted by the classifier.
 * Never overrides an existing decision.
 */
export async function allowOutboundRecipients(
	stub: SenderTriageStub,
	to: unknown,
	cc?: unknown,
	bcc?: unknown,
): Promise<number> {
	let upserted = 0;
	for (const raw of collectOutboundRecipientAddresses(to, cc, bcc)) {
		const dest = normalizeTriageSender(raw);
		if (!dest) continue;
		try {
			const existing = await stub.getSenderTriage(dest);
			if (existing?.status === "rejected" || existing?.status === "allowed") {
				continue;
			}
			await stub.upsertSenderTriage({
				sender: dest,
				status: "allowed",
				destination_folder_id: null,
			});
			upserted += 1;
		} catch (e) {
			console.error(
				`Outbound triage allow failed for ${dest}:`,
				(e as Error).message,
			);
		}
	}
	return upserted;
}

/** What moving a message teaches the mailbox about its sender. */
export type SenderLesson =
	/** Report spam: reject the sender and drop their purpose-box default. */
	| { kind: "reject"; sender: string }
	/** Not spam: allow the sender; file future mail to `destination` when it's a purpose box. */
	| { kind: "allow"; sender: string; destination: ScreenerDestinationId | null }
	/** Moved between boxes: make the destination the sender's default box. */
	| { kind: "preference"; sender: string; destination: string }
	| { kind: "none" };

/**
 * The sender lesson for a user moving one message from `fromFolderId` to
 * `toFolderId` with "remember this sender" on. Your own address is never
 * judged (a sent copy or a note to self can land in Spam).
 */
export function senderLessonForMove(input: {
	sender: string | null | undefined;
	mailboxId: string;
	fromFolderId: string | null | undefined;
	toFolderId: string;
}): SenderLesson {
	const sender = normalizeTriageSender(input.sender);
	if (!sender || canonicalMailboxId(sender) === canonicalMailboxId(input.mailboxId)) return { kind: "none" };
	if (input.toFolderId === Folders.SPAM) return { kind: "reject", sender };
	if (input.fromFolderId === Folders.SPAM) {
		return {
			kind: "allow",
			sender,
			destination: isScreenerDestination(input.toFolderId) ? input.toFolderId : null,
		};
	}
	return { kind: "preference", sender, destination: input.toFolderId };
}
