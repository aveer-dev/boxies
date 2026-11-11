// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Paper Trail, a quiet receipts folder (AVE-192, HEY's Paper Trail).
 *
 * Its own system folder (`paper_trail`), next to Updates. Only senders you
 * send there land in it: pick Paper Trail when you accept them in the
 * Screener, or move one of their messages there and keep future mail there.
 * The classifier never files anything here. Receipts, confirmations and
 * notifications are kept for reference, not to interrupt: mail filed in
 * Paper Trail never sends a push, the list shows compact rows (sender,
 * subject, date; no preview line) grouped by month, and opening a message
 * marks it read like any other folder. Updates stays a normal folder.
 *
 * iOS (`PaperTrail.swift`) and Android (`PaperTrail.kt`) mirror these rules.
 */

import { Folders } from "./folders.ts";

/** Folders that render as the quiet receipts view. */
export function folderIsPaperTrail(folderId: string | null | undefined): boolean {
	return folderId === Folders.PAPER_TRAIL;
}

/** Folders whose new mail never sends a push notification. */
export function folderIsQuiet(folderId: string | null | undefined): boolean {
	return folderIsPaperTrail(folderId);
}

const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
] as const;

function parseDate(value: string | null | undefined): Date | null {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

/** Section id for a date's local calendar month: "2026-11"; "undated" when unparseable. */
export function monthSectionId(value: string | null | undefined): string {
	const date = parseDate(value);
	if (!date) return "undated";
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Header for a month section: "November" in the current year,
 * "November 2025" otherwise, "Earlier" for mail without a usable date.
 */
export function monthSectionLabel(value: string | null | undefined, now: Date = new Date()): string {
	const date = parseDate(value);
	if (!date) return "Earlier";
	const month = MONTHS[date.getMonth()];
	return date.getFullYear() === now.getFullYear() ? month : `${month} ${date.getFullYear()}`;
}

export type MonthListItem<T> =
	| { type: "section"; id: string; label: string }
	| { type: "email"; email: T };

/**
 * Rows for the month-grouped list. Keeps the server's order (date DESC) and
 * starts a section whenever the month changes.
 */
export function buildMonthListItems<T extends { date?: string | null }>(
	emails: T[],
	now: Date = new Date(),
): MonthListItem<T>[] {
	const items: MonthListItem<T>[] = [];
	let current: string | null = null;
	for (const email of emails) {
		const id = monthSectionId(email.date);
		if (id !== current) {
			items.push({ type: "section", id: `month-${id}`, label: monthSectionLabel(email.date, now) });
			current = id;
		}
		items.push({ type: "email", email });
	}
	return items;
}
