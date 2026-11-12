// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { PILE_REPLY_LATER, PILE_SET_ASIDE, type WorkflowPile } from "shared/piles";
import type { Email } from "~/types";

/** Built-in piles (AVE-201); workers/lib/piles.ts holds the rules, shared/piles.ts the API. */
export { PILE_REPLY_LATER, PILE_SET_ASIDE };

/** A pile as the web reads `GET /workflow-piles` (older Workers send only id and counts). */
export type PileSummary = Pick<WorkflowPile, "id" | "count"> & Partial<WorkflowPile>;

/** The message's pile; older Workers send only `reply_later`. */
export function pileOf(email: Pick<Email, "pile_id" | "reply_later">): string | null {
	if (email.pile_id !== undefined) return email.pile_id;
	return email.reply_later ? PILE_REPLY_LATER : null;
}

export function isSetAside(email: Pick<Email, "pile_id" | "reply_later">): boolean {
	return pileOf(email) === PILE_SET_ASIDE;
}

export function isBuiltinPile(id: string): boolean {
	return id === PILE_REPLY_LATER || id === PILE_SET_ASIDE;
}

/** Piles people made (AVE-194), in the order the Worker lists them. */
export function customPiles<T extends PileSummary>(piles: readonly T[]): T[] {
	return piles.filter((p) => p.builtin === false || (p.builtin === undefined && !isBuiltinPile(p.id)));
}

/** The message's custom pile, if it's in one the list knows. */
export function customPileOf<T extends PileSummary>(
	email: Pick<Email, "pile_id" | "reply_later">,
	piles: readonly T[],
): T | null {
	const id = pileOf(email);
	if (!id || isBuiltinPile(id)) return null;
	return piles.find((p) => p.id === id) ?? null;
}
