// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface DeletionMember {
	role: "owner" | "member";
	you: boolean;
}

export interface PurgedMailbox {
	mailboxId: string;
	/** Members other than you who lose this mailbox's mail too. */
	othersLosingAccess: number;
}

/**
 * Mailboxes that deleting the account purges: the server deletes every
 * mailbox where you're the only owner, whoever else is a member.
 * `membersByMailbox` holds the member lists of the mailboxes you own;
 * a missing list counts as purged (the safe thing to warn about).
 */
export function mailboxesPurgedOnDelete(
	mailboxes: ReadonlyArray<{ id: string; role?: string | null }>,
	membersByMailbox: Readonly<Record<string, ReadonlyArray<DeletionMember> | undefined>>,
): PurgedMailbox[] {
	const purged: PurgedMailbox[] = [];
	for (const mailbox of mailboxes) {
		if (mailbox.role !== "owner") continue;
		const members = membersByMailbox[mailbox.id];
		if (!members) {
			purged.push({ mailboxId: mailbox.id, othersLosingAccess: 0 });
			continue;
		}
		const otherOwners = members.filter((m) => m.role === "owner" && !m.you).length;
		if (otherOwners > 0) continue;
		purged.push({ mailboxId: mailbox.id, othersLosingAccess: members.filter((m) => !m.you).length });
	}
	return purged;
}
