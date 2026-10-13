// Gmail and HEY, feature by feature. Names are theirs; status is ours.
//
// Two views of the same comparison:
//   - `gmail` / `hey`: the full tables on /roadmap#compare (§4.3 R4), notes
//     and all. `notyet` rows go last; the table collapses them.
//   - `landingGmail` / `landingHey`: the eight-row summaries on the landing
//     (§4.1 L5). They use shorter names and notes and their own order, so
//     they're written out here rather than filtered from the full tables.
//     Use these for the landing, not `gmail.filter((r) => r.landing)`.
import { flags } from "../config";
import type { ParityRow } from "./types";

const GMAIL = "RM#2; WEB#3 (Gmail names)";
const HEY = "RM#3; WEB#2.1 (HEY names)";

// Web-only rows (Focus & Reply) drop out while the web app isn't public.
type Row = ParityRow & { webOnly?: boolean };
const shown = (rows: Row[]): ParityRow[] => rows.filter((r) => !r.webOnly || flags.webAppPublic).map(({ webOnly: _, ...r }) => r);

const customDomainNote = flags.domainPurchaseLive ? "Connect one, or register one." : "Connect one you own.";

export const gmail: ParityRow[] = shown([
	{ competitor: "gmail", theirs: "Categories and tabs", ours: "Inbox · Promotions · Updates · Spam", status: "partly", note: "List mail from people you’ve emailed is sorted by its headers; senders you accept go where you choose. No Social or Forums.", src: `${GMAIL}; dev 31c58c6 (classifier files allowed senders without a chosen destination; header rules, not AI)` },
	{ competitor: "gmail", theirs: "Filters", ours: "Filters", status: "available", note: "Sender, list or subject; move, forward or skip the assistant’s draft.", src: GMAIL },
	{ competitor: "gmail", theirs: "Search operators", ours: "Search", status: "available", note: "Plus full-text search of message bodies.", src: GMAIL },
	{ competitor: "gmail", theirs: "Vacation responder", ours: "Auto-reply", status: "available", note: "Once per sender a day. No start or end dates.", src: GMAIL },
	{ competitor: "gmail", theirs: "Forwarding", ours: "Forwarding", status: "partly", note: "To an address verified in Cloudflare Email Routing, with loop protection. On inboxies.email, support adds it for you.", src: `${GMAIL}; D3 (message.forward needs a verified destination; no in-app verification)`, ownerConfirm: "support adds forwarding destinations by hand" },
	{ competitor: "gmail", theirs: "Multiple accounts", ours: "Mailbox switcher", status: "available", note: "Inboxies mailboxes only; no outside Gmail or IMAP accounts.", src: GMAIL },
	{ competitor: "gmail", theirs: "Notifications", ours: "Push", status: "available", note: "In the iPhone app, with previews; tapping opens the email.", src: GMAIL },
	{ competitor: "gmail", theirs: "Contact suggestions", ours: "People you’ve emailed", status: "available", note: "No address book.", src: GMAIL },
	{ competitor: "gmail", theirs: "Spam protection", ours: "Spam and spoof warnings", status: "available", note: "Spam headers, a Workers AI check, and SPF, DKIM and DMARC.", src: GMAIL },
	{ competitor: "gmail", theirs: "Delegation", ours: "Sharing · Invites · Domain Admin", status: "available", note: "Owners and members per mailbox.", src: GMAIL },
	{ competitor: "gmail", theirs: "Custom domain", ours: "Custom domains", status: "available", note: customDomainNote, src: GMAIL },
	{ competitor: "gmail", theirs: "Labels", ours: "Folders and stars", status: "partly", note: "One folder per email (the web app shows yours as #tags); more than one per email is being explored.", src: `${GMAIL}; dev FoldersColumn.tsx` },
	{ competitor: "gmail", theirs: "Undo send", ours: "Undo", status: "partly", note: "iPhone only, a few seconds. Delete, archive and move have a five-second undo in the iPhone app.", src: GMAIL },
	{ competitor: "gmail", theirs: "Send as", ours: "From picker", status: "partly", note: flags.privateEmailShipped ? "Choose which of your mailboxes to send from on iPhone. A reply to mail sent to a private address goes out from that address." : "Choose which of your mailboxes to send from on iPhone. Private addresses arrive next release.", src: `${GMAIL}; dev alias-sender.ts (replies in a private-email thread go out from the alias); ComposeFormModel.swift (From locked for those replies)` },
	{ competitor: "gmail", theirs: "Help me write", ours: "Ask AI", status: "partly", note: flags.autoDraftsFromDayOne ? "Drafts replies when you ask, and as personal mail arrives; no suggestions as you type." : "Drafts replies when you ask; no suggestions as you type.", src: `${GMAIL}; dev index.ts auto-draft gate (PR #49)` },
	{ competitor: "gmail", theirs: "Priority Inbox", ours: "New and Seen", status: "partly", note: "New sits above Seen.", src: GMAIL },
	{ competitor: "gmail", theirs: "Offline", ours: "Local copy", status: "partly", note: flags.webAppPublic ? "iPhone only; the web needs a connection." : "In the iPhone app.", src: GMAIL },
	{ competitor: "gmail", theirs: "Attachments", ours: "Attachments", status: "partly", note: "5 MiB per message; no large-file links.", src: GMAIL },
	{ competitor: "gmail", theirs: "Takeout", ours: ".mbox export", status: "partly", note: "Whole domains, by domain admins; a one-mailbox export is planned.", src: GMAIL },
	{ competitor: "gmail", theirs: "Keyboard shortcuts", ours: "A few, on the web", status: "partly", note: "C, ⌘K, ⌘J, [ and ], Esc. No j and k or ? list yet.", webOnly: true, src: `${GMAIL}; dev FloatingDock.tsx, ColumnCanvas.tsx, QuickReplyBar.tsx` },
	{ competitor: "gmail", theirs: "Schedule send", ours: "—", status: "exploring", src: GMAIL },
	// Collapsed under "Show 4 we haven’t planned"
	{ competitor: "gmail", theirs: "Snooze", ours: "—", status: "notyet", note: "Reply Later is a pile, not a timer.", src: GMAIL },
	{ competitor: "gmail", theirs: "Templates", ours: "—", status: "notyet", src: GMAIL },
	{ competitor: "gmail", theirs: "Confidential mode", ours: "—", status: "notyet", src: GMAIL },
	{ competitor: "gmail", theirs: "One-click unsubscribe", ours: "—", status: "notyet", note: "There’s no unsubscribe button.", src: GMAIL },
]);

export const hey: ParityRow[] = shown([
	{ competitor: "hey", theirs: "The Screener", ours: "Screener", status: "available", note: "Accept into Inbox, Promotions or Updates; decline quietly.", src: HEY },
	{ competitor: "hey", theirs: "The Imbox", ours: "Inbox, New and Seen", status: "available", note: "New sits above Seen.", src: HEY },
	{ competitor: "hey", theirs: "Reply Later", ours: "Reply Later", status: "available", note: "Leaves the pile when you reply.", src: HEY },
	{ competitor: "hey", theirs: "Per-sender settings", ours: "Senders", status: "available", note: "Choose where each sender’s mail goes.", src: HEY },
	{ competitor: "hey", theirs: "Custom domains", ours: "Custom domains", status: "available", src: HEY },
	{ competitor: "hey", theirs: "The Feed", ours: "Promotions", status: "partly", note: "A plain list, not a reading feed.", src: HEY },
	{ competitor: "hey", theirs: "Paper Trail", ours: "Updates", status: "partly", note: "A plain list.", src: HEY },
	{ competitor: "hey", theirs: "Focus & Reply", ours: "Focus & Reply", status: "partly", note: "Web only.", webOnly: true, src: HEY },
	{ competitor: "hey", theirs: "Workflows", ours: "Reply Later pile", status: "partly", note: "One pile so far.", src: HEY },
	{ competitor: "hey", theirs: "Bundles", ours: "“For you” topics", status: "progress", note: "Grouped by topic, not by sender; built, not switched on yet.", src: HEY, ownerConfirm: "tease the “For you” brief publicly" },
	{ competitor: "hey", theirs: "Set Aside", ours: "Set Aside", status: "planned", note: "Next to Reply Later.", src: HEY },
	{ competitor: "hey", theirs: "Spy Pixel Blocker", ours: "Load images", status: "partly", note: "Every remote image waits until you load it; trackers aren’t picked out.", src: `${HEY}; dev 061e0ea EmailIframe.tsx; eda481f EmailHTMLSanitizer.swift, EmailBodyView.kt` },
	// Collapsed under "Show 6 we haven’t planned"
	{ competitor: "hey", theirs: "Clips", ours: "—", status: "notyet", src: HEY },
	{ competitor: "hey", theirs: "Notes", ours: "—", status: "notyet", src: HEY },
	{ competitor: "hey", theirs: "Rename subjects", ours: "—", status: "notyet", src: HEY },
	{ competitor: "hey", theirs: "Merge threads", ours: "—", status: "notyet", src: HEY },
	{ competitor: "hey", theirs: "Bubble Up", ours: "—", status: "notyet", src: HEY },
	{ competitor: "hey", theirs: "Collections", ours: "—", status: "notyet", src: HEY },
]);

// Landing summary rows (columns: You know it as · In Inboxies · Status; the
// note sits under "In Inboxies").
export const landingGmail: ParityRow[] = shown([
	{ competitor: "gmail", theirs: "Inbox categories", ours: "Inbox · Promotions · Updates", status: "partly", note: "Sorted by headers, or per sender.", landing: true, src: "RM#2; dev 31c58c6" },
	{ competitor: "gmail", theirs: "Filters", ours: "Filters", status: "available", landing: true, src: "RM#2" },
	{ competitor: "gmail", theirs: "Search operators", ours: "Search", status: "available", landing: true, src: "RM#2" },
	{ competitor: "gmail", theirs: "Labels", ours: "Folders and stars", status: "partly", note: "One folder per email.", landing: true, src: "RM#2" },
	{ competitor: "gmail", theirs: "Undo send", ours: "Undo", status: "partly", note: "iPhone only.", landing: true, src: "RM#2" },
	{ competitor: "gmail", theirs: "Snooze", ours: "Reply Later", status: "notyet", note: "Reply Later is a pile, not a timer.", landing: true, src: "RM#2" },
	{ competitor: "gmail", theirs: "Keyboard shortcuts", ours: "A few, on the web", status: "partly", note: "No j and k yet.", landing: true, webOnly: true, src: "RM#2; dev FloatingDock.tsx, ColumnCanvas.tsx" },
	{ competitor: "gmail", theirs: "Takeout", ours: ".mbox export", status: "partly", note: "Whole domains, by domain admins.", landing: true, src: "RM#2" },
]);

export const landingHey: ParityRow[] = shown([
	{ competitor: "hey", theirs: "The Screener", ours: "Screener", status: "available", landing: true, src: "RM#3; WEB#2.1 (HEY names)" },
	{ competitor: "hey", theirs: "The Imbox", ours: "Inbox, New and Seen", status: "available", landing: true, src: "RM#3; WEB#2.1 (HEY names)" },
	{ competitor: "hey", theirs: "Reply Later", ours: "Reply Later", status: "available", landing: true, src: "RM#3; WEB#2.1 (HEY names)" },
	{ competitor: "hey", theirs: "Focus & Reply", ours: "Focus & Reply", status: "partly", note: "Web only.", landing: true, webOnly: true, src: "RM#3; WEB#2.1 (HEY names)" },
	{ competitor: "hey", theirs: "The Feed", ours: "Promotions", status: "partly", note: "A plain list, not a reading feed.", landing: true, src: "RM#3; WEB#2.1 (HEY names)" },
	{ competitor: "hey", theirs: "Paper Trail", ours: "Updates", status: "partly", note: "A plain list.", landing: true, src: "RM#3; WEB#2.1 (HEY names)" },
	{ competitor: "hey", theirs: "Set Aside", ours: "Set Aside", status: "planned", landing: true, src: "RM#3; WEB#2.1 (HEY names)" },
	{ competitor: "hey", theirs: "Spy Pixel Blocker", ours: "Load images", status: "partly", note: "Remote images wait until you load them.", landing: true, src: "RM#3; WEB#2.1 (HEY names); dev 061e0ea, eda481f" },
]);
