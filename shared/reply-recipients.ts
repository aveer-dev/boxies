// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Reply/Reply-All recipient selection.
 *
 * Plain Reply to a message you sent must go to the original recipients,
 * not back to your own mailbox.
 */

export function splitAddressList(value?: string | null): string[] {
	return (value || "")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

export function normalizeAddress(address: string): string {
	const trimmed = address.trim();
	if (!trimmed) return "";
	const angle = trimmed.match(/<([^>]+)>/);
	return (angle ? angle[1] : trimmed).trim().toLowerCase();
}

export function isSameAddress(a: string, b?: string | null): boolean {
	if (!b) return false;
	const left = normalizeAddress(a);
	const right = normalizeAddress(b);
	return Boolean(left) && left === right;
}

export function uniqueAddresses(
	addresses: string[],
	exclude?: string | null,
): string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	const excluded = exclude ? normalizeAddress(exclude) : "";

	for (const address of addresses) {
		const trimmed = address.trim();
		if (!trimmed) continue;
		const normalized = normalizeAddress(trimmed);
		if (!normalized || (excluded && normalized === excluded) || seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		result.push(trimmed);
	}

	return result;
}

export interface ReplyOriginal {
	sender: string;
	recipient?: string | null;
	cc?: string | null;
}

/** Plain Reply: other party, or original To when the message is your own Sent copy. */
export function replyToAddresses(
	original: ReplyOriginal,
	selfAddress?: string | null,
): string[] {
	if (selfAddress && isSameAddress(original.sender, selfAddress)) {
		const recipients = uniqueAddresses(
			splitAddressList(original.recipient),
			selfAddress,
		);
		return recipients.length > 0 ? recipients : uniqueAddresses([original.sender]);
	}
	return uniqueAddresses([original.sender]);
}

export function replyAllAddresses(
	original: ReplyOriginal,
	selfAddress?: string | null,
): { to: string[]; cc: string[] } {
	const to = uniqueAddresses(
		[original.sender, ...splitAddressList(original.recipient)],
		selfAddress,
	);
	const toSeen = new Set(to.map(normalizeAddress));
	const cc = uniqueAddresses(splitAddressList(original.cc), selfAddress).filter(
		(address) => !toSeen.has(normalizeAddress(address)),
	);
	return { to, cc };
}

function asRecipientField(addresses: string[]): string | string[] {
	if (addresses.length <= 1) return addresses[0] || "";
	return addresses;
}

/**
 * If a reply is addressed only to the mailbox that sent the original,
 * retarget it at the original recipients. Leaves intentional self-mail alone
 * when the original was already to yourself.
 */
export function rewriteSelfReplyTo(
	to: string | string[],
	original: ReplyOriginal,
	selfAddress: string,
): string | string[] {
	const requested = Array.isArray(to) ? to : splitAddressList(to);
	const onlySelf =
		requested.length > 0 &&
		requested.every((address) => isSameAddress(address, selfAddress));
	if (!onlySelf || !isSameAddress(original.sender, selfAddress)) {
		return to;
	}

	const corrected = uniqueAddresses(
		splitAddressList(original.recipient),
		selfAddress,
	);
	if (corrected.length === 0) return to;
	return asRecipientField(corrected);
}
