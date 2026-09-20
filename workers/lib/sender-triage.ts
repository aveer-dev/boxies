// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Screener-lite: consent gate for unknown senders.
 *
 * Spam files to spam first. Rejected → screened_out. Allowed → destination
 * (filters may override). Unknown → screener (filters cannot bypass).
 */

import {
	Folders,
	SCREENER_DESTINATION_IDS,
	type ScreenerDestinationId,
} from "../../shared/folders.ts";
import { normalizeEmailAddress } from "./mail-automations.ts";
import type { InboxFilterHit } from "./inbox-filters.ts";

export type SenderTriageStatus = "allowed" | "rejected";

export interface SenderTriageRow {
	sender: string;
	status: SenderTriageStatus;
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
 *   filter folder → purpose preference → triage destination → classify.
 * When screener is disabled: filter → preference → classify.
 */
export function resolveInboundFolder(
	input: ResolveInboundFolderInput,
): ResolveInboundFolderResult {
	const { classification, triage, filterHit } = input;
	const screenerEnabled = input.screenerEnabled !== false;
	const preferenceFolder = input.preferenceFolderId?.trim() || null;

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

	if (!screenerEnabled) {
		return {
			folderId:
				filterHit?.folderId || preferenceFolder || classification.folderId,
			skipAutoDraft: Boolean(filterHit?.skipAutoDraft),
			skipPush: false,
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
		const dest =
			triage.destination_folder_id && isScreenerDestination(triage.destination_folder_id)
				? triage.destination_folder_id
				: Folders.INBOX;
		return {
			folderId: filterHit?.folderId || preferenceFolder || dest,
			skipAutoDraft: Boolean(filterHit?.skipAutoDraft),
			skipPush: false,
			skipAutoReply: false,
			skipForward: false,
			triageAction: "allowed",
		};
	}

	// Unknown sender — Screener. Filters must not smuggle past the gate.
	return {
		folderId: Folders.SCREENER,
		skipAutoDraft: true,
		skipPush: true,
		skipAutoReply: true,
		skipForward: true,
		triageAction: "unknown",
	};
}

/** Normalize a From address for triage PK lookup. */
export function normalizeTriageSender(
	sender: string | null | undefined,
): string | null {
	return normalizeEmailAddress(sender);
}

export interface BootstrapSenderSeed {
	sender: string;
	destination_folder_id: ScreenerDestinationId;
	display_name?: string | null;
}

/**
 * Build allow-list seeds from Sent recipients and prior folder senders.
 * Priority: Sent → inbox → promotions → updates (first wins).
 */
export function buildBootstrapAllowSeeds(input: {
	sentAddresses: Array<{ email: string; name?: string | null }>;
	inboxSenders: Array<{ email: string; name?: string | null }>;
	promotionsSenders?: Array<{ email: string; name?: string | null }>;
	updatesSenders?: Array<{ email: string; name?: string | null }>;
}): BootstrapSenderSeed[] {
	const bySender = new Map<string, BootstrapSenderSeed>();

	const add = (
		entries: Array<{ email: string; name?: string | null }>,
		destination: ScreenerDestinationId,
	) => {
		for (const entry of entries) {
			const email = normalizeTriageSender(entry.email);
			if (!email) continue;
			if (bySender.has(email)) continue;
			bySender.set(email, {
				sender: email,
				destination_folder_id: destination,
				display_name: entry.name?.trim() || null,
			});
		}
	};

	add(input.sentAddresses, Folders.INBOX);
	add(input.inboxSenders, Folders.INBOX);
	add(input.promotionsSenders ?? [], Folders.PROMOTIONS);
	add(input.updatesSenders ?? [], Folders.UPDATES);

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
 * Never overrides an explicit reject.
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
				destination_folder_id: Folders.INBOX,
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
