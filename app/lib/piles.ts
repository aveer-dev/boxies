// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Email } from "~/types";

/** Built-in piles (AVE-201); workers/lib/piles.ts holds the rules. */
export const PILE_REPLY_LATER = "reply_later";
export const PILE_SET_ASIDE = "set_aside";

/** The message's pile; older Workers send only `reply_later`. */
export function pileOf(email: Pick<Email, "pile_id" | "reply_later">): string | null {
	if (email.pile_id !== undefined) return email.pile_id;
	return email.reply_later ? PILE_REPLY_LATER : null;
}

export function isSetAside(email: Pick<Email, "pile_id" | "reply_later">): boolean {
	return pileOf(email) === PILE_SET_ASIDE;
}
