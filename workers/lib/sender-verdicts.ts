// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * What "Not spam" and "Report spam" write about a sender
 * (docs/spam-management-plan.md §5 "What the actions write"). One place for
 * the move endpoint (every client path into or out of Spam) and the agent
 * `allow_sender` / `block_sender` tools, so they can't drift apart.
 *
 * Until `sender_rules` lands (AVE-88 #5), the allow is `sender_triage =
 * allowed` plus a user purpose-box preference (the explicit allow that
 * `senderTrustOf` reads), and the block is `sender_triage = rejected`.
 */

import { isScreenerDestination, normalizeTriageSender } from "./sender-triage.ts";
import { canonicalMailboxId } from "./mailbox-routing.ts";
import type { ScreenerDestinationId } from "../../shared/folders.ts";

type TriageRow = {
	status: string;
	destination_folder_id?: string | null;
	display_name?: string | null;
} & Record<string, unknown>;

/** The mailbox DO methods a sender verdict needs. */
export interface SenderVerdictStub {
	upsertSenderTriage(row: {
		sender: string;
		status: "allowed" | "rejected";
		destination_folder_id?: string | null;
		display_name?: string | null;
	}): Promise<unknown>;
	upsertSenderPreference(input: {
		address: string;
		folderId: string;
		displayName?: string | null;
		source?: string;
		refile?: boolean;
	}): Promise<unknown>;
	deleteSenderPreference(address: string): Promise<boolean>;
	getSenderPreference(address: string): Promise<{ folderId: string; source: string } | null>;
}

/**
 * Not spam: allow the sender. With a purpose-box `destination`, their future
 * mail is filed there (a user preference, so it counts as an explicit allow).
 */
export async function recordSenderAllow(
	stub: SenderVerdictStub,
	input: { sender: string; destination: ScreenerDestinationId | null; displayName?: string | null },
) {
	const displayName = input.displayName ?? null;
	const triage = await stub.upsertSenderTriage({
		sender: input.sender,
		status: "allowed",
		destination_folder_id: input.destination,
		display_name: displayName,
	});
	if (input.destination) {
		await stub.upsertSenderPreference({
			address: input.sender,
			folderId: input.destination,
			displayName,
			source: "user",
			refile: false,
		});
	}
	return triage as TriageRow | null;
}

/** Report spam: reject the sender (future mail is screened out) and drop their purpose box. */
export async function recordSenderBlock(
	stub: SenderVerdictStub,
	input: { sender: string; displayName?: string | null },
) {
	const triage = await stub.upsertSenderTriage({
		sender: input.sender,
		status: "rejected",
		destination_folder_id: null,
		display_name: input.displayName ?? null,
	});
	await stub.deleteSenderPreference(input.sender);
	return triage as TriageRow | null;
}

/** Validates an agent-supplied sender: a real address that isn't the mailbox itself. */
function agentSender(mailboxId: string, raw: string): { sender: string } | { error: string } {
	const sender = normalizeTriageSender(raw);
	if (!sender) return { error: "Invalid sender address" };
	if (canonicalMailboxId(sender) === canonicalMailboxId(mailboxId)) {
		return { error: "You can't allow or block your own address" };
	}
	return { sender };
}

/**
 * Agent `allow_sender`: the same allow as Not spam. Files future mail to
 * `folderId` (inbox, promotions, updates); without one, keeps the sender's
 * current box, else Inbox, as Not spam does.
 */
export async function allowSenderForAgent(
	stub: SenderVerdictStub,
	mailboxId: string,
	params: { sender: string; folderId?: string | null },
) {
	const checked = agentSender(mailboxId, params.sender);
	if ("error" in checked) return checked;
	const { sender } = checked;
	let destination: ScreenerDestinationId;
	if (params.folderId) {
		if (!isScreenerDestination(params.folderId)) {
			return { error: "folderId must be inbox, promotions, or updates" };
		}
		destination = params.folderId;
	} else {
		const current = await stub.getSenderPreference(sender);
		destination =
			current && isScreenerDestination(current.folderId) ? current.folderId : "inbox";
	}
	await recordSenderAllow(stub, { sender, destination });
	return { status: "allowed" as const, sender, folder: destination };
}

/** Agent `block_sender`: the same block as Report spam. */
export async function blockSenderForAgent(
	stub: SenderVerdictStub,
	mailboxId: string,
	params: { sender: string },
) {
	const checked = agentSender(mailboxId, params.sender);
	if ("error" in checked) return checked;
	await recordSenderBlock(stub, { sender: checked.sender });
	return { status: "blocked" as const, sender: checked.sender };
}
