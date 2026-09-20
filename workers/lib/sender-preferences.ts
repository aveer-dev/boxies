// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Per-sender purpose-box defaults (Inbox / Promotions / Updates).
 *
 * Stored in MailboxDO SQLite — not the R2 settings blob — so inbound
 * lookup and bulk refile stay indexed. Classify is only a suggestion
 * when no preference (and no filter folder) applies.
 */

import {
	Folders,
	PURPOSE_FOLDER_IDS,
	isPurposeFolderId,
	type PurposeFolderId,
} from "../../shared/folders.ts";
import { normalizeEmailAddress } from "./mail-automations.ts";

export type SenderPreferenceSource = "user" | "screener" | "seeded";

export interface SenderPreference {
	address: string;
	folderId: PurposeFolderId;
	displayName: string | null;
	source: SenderPreferenceSource;
	updatedAt: string;
}

export interface UpsertSenderPreferenceInput {
	address: string;
	folderId: string;
	displayName?: string | null;
	source?: SenderPreferenceSource;
	refile?: boolean;
}

const SOURCES = new Set<SenderPreferenceSource>([
	"user",
	"screener",
	"seeded",
]);

/**
 * Inbound filing precedence among purpose boxes:
 *   spam (classifier) → filter folder → sender preference → classify suggestion
 */
export function resolveInboundFolder(options: {
	classificationFolderId: string;
	filterFolderId?: string | null;
	preferenceFolderId?: string | null;
}): string {
	if (options.classificationFolderId === Folders.SPAM) {
		return Folders.SPAM;
	}
	const filterFolder = options.filterFolderId?.trim();
	if (filterFolder) return filterFolder;
	const preferenceFolder = options.preferenceFolderId?.trim();
	if (preferenceFolder) return preferenceFolder;
	return options.classificationFolderId;
}

export function normalizeSenderPreferenceAddress(
	address: string | null | undefined,
): string | null {
	return normalizeEmailAddress(address);
}

export function parseSenderPreferenceSource(
	raw: unknown,
): SenderPreferenceSource {
	if (typeof raw === "string" && SOURCES.has(raw as SenderPreferenceSource)) {
		return raw as SenderPreferenceSource;
	}
	return "user";
}

/** Validate upsert body; returns error message or null. */
export function senderPreferenceUpsertError(
	input: UpsertSenderPreferenceInput,
): string | null {
	const address = normalizeSenderPreferenceAddress(input.address);
	if (!address) return "Enter a valid sender email address";
	if (!isPurposeFolderId(input.folderId)) {
		return `Destination must be one of: ${PURPOSE_FOLDER_IDS.join(", ")}`;
	}
	if (
		input.source !== undefined &&
		!SOURCES.has(input.source as SenderPreferenceSource)
	) {
		return "Invalid preference source";
	}
	return null;
}

export function purposeFoldersSqlList(): string {
	return PURPOSE_FOLDER_IDS.map((id) => `'${id}'`).join(", ");
}
