// Gmail and HEY, feature by feature. Names are theirs; status is ours.
// Only features specific to Gmail or HEY belong here (6 Nov 2026): standard
// email features (filters, search, undo send, snooze, shortcuts, forwarding…)
// are just features, listed in roadmap.ts and features.ts.
//
// Two views of the same comparison:
//   - `gmail` / `hey`: the full tables on /roadmap#compare (§4.3 R4), notes
//     and all. `notyet` rows go last; the table collapses them.
//   - `landingGmail` / `landingHey`: the short summaries on the landing
//     (§4.1 L5). They use shorter names and notes and their own order, so
//     they're written out here rather than filtered from the full tables.
//     Use these for the landing, not `gmail.filter((r) => r.landing)`.
import { flags } from "../config";
import type { ParityRow } from "./types";

const GMAIL = "RM#2; WEB#3 (Gmail names)";
const HEY = "RM#3; WEB#2.1 (HEY names)";

// Web-only rows drop out while the web app isn't public (none right now).
type Row = ParityRow & { webOnly?: boolean };
const shown = (rows: Row[]): ParityRow[] => rows.filter((r) => !r.webOnly || flags.webAppPublic).map(({ webOnly: _, ...r }) => r);

export const gmail: ParityRow[] = shown([
	{ competitor: "gmail", theirs: "Categories and tabs", ours: "Inbox · Promotions · Updates · Spam", status: "partly", note: "Newsletters from people you’ve emailed are sorted for you; senders you accept go where you choose. No Social or Forums.", src: `${GMAIL}; dev 31c58c6 (classifier files allowed senders without a chosen destination; header rules, not AI)` },
	{ competitor: "gmail", theirs: "Labels", ours: "Folders and stars", status: "partly", note: "One folder per email, and your own folders show as tags in every app. More than one per email is being explored.", src: `${GMAIL}; dev FoldersColumn.tsx; AVE-158 0561af7 (Settings → Tags on iOS and Android)` },
	{ competitor: "gmail", theirs: "Help me write", ours: "Ask AI", status: "partly", note: flags.autoDraftsFromDayOne ? "Drafts replies when you ask, and as personal mail arrives. On the web, grey text can finish your sentence as you type; not yet on iPhone or Android." : "Drafts replies when you ask. On the web, grey text can finish your sentence as you type; not yet on iPhone or Android.", src: `${GMAIL}; dev index.ts auto-draft gate (PR #49); AVE-189 (writing suggestions, web only, off by default)` },
	{ competitor: "gmail", theirs: "Priority Inbox", ours: "New and Seen", status: "partly", note: "New sits above Seen.", src: GMAIL },
	{ competitor: "gmail", theirs: "Takeout", ours: ".mbox export", status: "partly", note: "Whole domains, by domain admins; a one-mailbox export is planned.", src: GMAIL },
	{ competitor: "gmail", theirs: "Confidential mode", ours: "—", status: "notyet", src: GMAIL },
]);

export const hey: ParityRow[] = shown([
	{ competitor: "hey", theirs: "The Screener", ours: "Screener", status: "available", note: "Accept into Inbox, Promotions or Updates; decline quietly.", src: HEY },
	{ competitor: "hey", theirs: "The Imbox", ours: "Inbox, New and Seen", status: "available", note: "New sits above Seen.", src: HEY },
	{ competitor: "hey", theirs: "Reply Later", ours: "Reply Later", status: "available", note: "Leaves the pile when you reply.", src: HEY },
	{ competitor: "hey", theirs: "The Feed", ours: "Promotions", status: "partly", note: "A plain list, not a reading feed.", src: HEY },
	{ competitor: "hey", theirs: "Paper Trail", ours: "Updates", status: "partly", note: "A plain list.", src: HEY },
	{ competitor: "hey", theirs: "Focus & Reply", ours: "Focus & Reply", status: "available", note: "One thread at a time, with the reply open.", src: `${HEY}; AVE-193 (iOS, Android)` },
	{ competitor: "hey", theirs: "Workflows", ours: "Reply Later pile", status: "partly", note: "One pile so far.", src: HEY },
	{ competitor: "hey", theirs: "Bundles", ours: "“For you” topics", status: "progress", note: "Grouped by topic, not by sender; built, not switched on yet.", src: HEY, ownerConfirm: "tease the “For you” brief publicly" },
	{ competitor: "hey", theirs: "Set Aside", ours: "Set Aside", status: "planned", note: "Next to Reply Later.", src: HEY },
	{ competitor: "hey", theirs: "Spy Pixel Blocker", ours: "Tracker blocking", status: "available", note: "Known tracking pixels are removed in every folder, and the message says who tried. Other images still load; in Spam, remote images stay hidden until you load them.", src: `${HEY}; dev AVE-195 (shared/tracking-pixels.ts: MailboxDO getEmail / getThreadEmails strip known pixels, blocked_trackers → reader note on web, iOS, Android); AVE-132 (#168, shared/remote-images.ts)` },
	{ competitor: "hey", theirs: "Notes", ours: "Private notes", status: "available", note: "A sticky note on a thread, or a note on one message. Only you see them.", src: `${HEY}; AVE-59..62 (shared/thread-notes.ts; web, iOS, Android)` },
	{ competitor: "hey", theirs: "Clips", ours: "—", status: "notyet", src: HEY },
	{ competitor: "hey", theirs: "Rename subjects", ours: "—", status: "notyet", src: HEY },
	{ competitor: "hey", theirs: "Merge threads", ours: "—", status: "notyet", src: HEY },
	{ competitor: "hey", theirs: "Bubble Up", ours: "—", status: "notyet", src: HEY },
	{ competitor: "hey", theirs: "Collections", ours: "—", status: "notyet", src: HEY },
]);

// Landing summary rows (columns: You know it as · In Inboxies · Status; the
// note sits under "In Inboxies").
export const landingGmail: ParityRow[] = shown([
	{ competitor: "gmail", theirs: "Inbox categories", ours: "Inbox · Promotions · Updates", status: "partly", note: "Sorted for you, or per sender.", landing: true, src: "RM#2; dev 31c58c6" },
	{ competitor: "gmail", theirs: "Labels", ours: "Folders and stars", status: "partly", note: "One folder per email.", landing: true, src: "RM#2" },
	{ competitor: "gmail", theirs: "Priority Inbox", ours: "New and Seen", status: "partly", note: "New sits above Seen.", landing: true, src: "RM#2" },
	{ competitor: "gmail", theirs: "Help me write", ours: "Ask AI", status: "partly", note: "Drafts when you ask; suggestions as you type on the web.", landing: true, src: "RM#2; AVE-189" },
	{ competitor: "gmail", theirs: "Takeout", ours: ".mbox export", status: "partly", note: "Whole domains, by domain admins.", landing: true, src: "RM#2" },
]);

export const landingHey: ParityRow[] = shown([
	{ competitor: "hey", theirs: "The Screener", ours: "Screener", status: "available", landing: true, src: "RM#3; WEB#2.1 (HEY names)" },
	{ competitor: "hey", theirs: "The Imbox", ours: "Inbox, New and Seen", status: "available", landing: true, src: "RM#3; WEB#2.1 (HEY names)" },
	{ competitor: "hey", theirs: "Reply Later", ours: "Reply Later", status: "available", landing: true, src: "RM#3; WEB#2.1 (HEY names)" },
	{ competitor: "hey", theirs: "Focus & Reply", ours: "Focus & Reply", status: "available", landing: true, src: "RM#3; WEB#2.1 (HEY names); AVE-193 (iOS, Android)" },
	{ competitor: "hey", theirs: "The Feed", ours: "Promotions", status: "partly", note: "A plain list, not a reading feed.", landing: true, src: "RM#3; WEB#2.1 (HEY names)" },
	{ competitor: "hey", theirs: "Paper Trail", ours: "Updates", status: "partly", note: "A plain list.", landing: true, src: "RM#3; WEB#2.1 (HEY names)" },
	{ competitor: "hey", theirs: "Set Aside", ours: "Set Aside", status: "planned", landing: true, src: "RM#3; WEB#2.1 (HEY names)" },
	{ competitor: "hey", theirs: "Spy Pixel Blocker", ours: "Tracker blocking", status: "available", note: "In every folder, naming who tried.", landing: true, src: "RM#3; WEB#2.1 (HEY names); dev AVE-195 (shared/tracking-pixels.ts: MailboxDO getEmail / getThreadEmails strip known pixels, blocked_trackers → reader note on web, iOS, Android); AVE-132 (#168)" },
]);
