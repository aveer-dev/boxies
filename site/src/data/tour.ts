// The landing tour (§4.1 L2): six stops, each with its screen. Media names
// map to src/data/media.ts. Chapters have no status: only shipped work gets
// a stop, and validate.ts keeps "private email" out of them until it ships.
import { flags } from "../config";
import { onSomePublicPlatform } from "../lib/platforms";
import type { Operator, TourChapter } from "./types";

const allChapters: TourChapter[] = [
	{
		id: "tour-screener",
		num: "01",
		name: "Screener",
		lineage: "HEY",
		platforms: ["ios", "android", "web"],
		title: "Strangers wait at the door.",
		body: "The first time someone emails you, their message waits in the Screener instead of your Inbox. Accept them into Inbox, Promotions or Updates, or decline and their mail is filed quietly in Screened out.",
		rows: [
			{
				lead: "Quiet by design.",
				text: "Mail in the Screener never sends a notification, never gets an assistant draft and never gets your auto-reply. If you forward your mail, a copy still goes out.",
				src: "FSW#the-screener; dev cb0b217 sender-triage.ts resolveInboundFolder (unknown: skipPush/skipAutoDraft/skipAutoReply true, skipForward false)",
			},
			{
				lead: "People you write to are already in.",
				text: "Anyone you’ve emailed is approved automatically, and so are senders already in your mail. Their mail is sorted for you: list mail to Promotions or Updates, the rest to Inbox.",
				src: "FSW#the-screener (allow-list seeded from Sent and existing mail); dev 31c58c6 (those seeds carry no destination, so classify-email.ts files them; migration 25)",
			},
			{
				lead: "On from the first email.",
				text: "Every new mailbox starts with the Screener on. There’s no switch to turn it off yet.",
				src: "FSW#the-screener (screener.enabled true; no client switch); PS#5",
			},
		],
		supportHref: "/support#screener",
		railLabel: "Screener",
		media: { still: "screener-list", clip: "screener-flow" },
		src: "J (OS headline graft); FSW#the-screener; FC#4.3",
	},
	{
		id: "tour-reply-later",
		num: "02",
		name: "Reply Later",
		lineage: "HEY",
		platforms: ["ios", "android", "web"],
		title: "What you owe a reply gets its own pile.",
		body: flags.webAppPublic
			? "Mark a thread Reply Later from its actions and it joins a pile with a live count: in the bar at the bottom of the screen on iPhone, and under Workflow in the folder column on the web. Send your reply and it leaves the pile on its own."
			: "Mark a thread Reply Later from its actions and it joins a pile with a live count in the bar at the bottom of the screen. Send your reply and it leaves the pile on its own.",
		rows: [
			{
				lead: "A pile, not a timer.",
				text: "Nothing disappears and nothing comes back at a set time. The pile waits until you’re ready.",
				src: "RM#2 (Snooze: \"Reply Later is a pile, not a timer\")",
			},
			{
				lead: "Needs reply.",
				text: "A small tag marks threads you’ve read where the last message isn’t yours.",
				src: "FC#4.3 (needs-reply heuristic); FSW#supporting-features",
			},
			{
				lead: "Focus & Reply.",
				text: "Work through the pile one thread at a time, with the reply already open.",
				platforms: ["web"],
				src: "FSW#reply-later; RM#3 (Focus & Reply web only)",
			},
		],
		supportHref: "/support#reply-later",
		railLabel: "Reply Later",
		media: { still: "reply-later", clip: "reply-later" },
		src: "J (OS headline graft); FC#4.3 (marked from the actions sheet; bottom pill with count); FSW#reply-later; dev FoldersColumn.tsx (Workflow → Reply Later with count; Sidebar.tsx removed in 87720b1)",
	},
	{
		id: "tour-ask-ai",
		num: "03",
		name: "Ask AI",
		platforms: ["ios", "android", "web"],
		title: "An assistant that drafts. You press send.",
		body: "Ask AI searches your mail, reads threads, sums up what’s waiting and drafts replies. You can see each step as it works, and drafts wait in your Drafts folder until you send them.",
		extra: "agent-strip",
		rows: [
			{
				lead: "Your rules.",
				text: "Give each mailbox its own instructions in Settings → AI prompt: tone, sign-off, what to leave alone.",
				src: "FC#4.8 (custom AI prompt per mailbox)",
			},
			{
				lead: "Runs on Cloudflare.",
				text: "The assistant uses models on Cloudflare Workers AI. Inboxies doesn’t send your mail to another AI provider.",
				src: "PS#5 (AI data handling: no third-party LLM API)",
			},
			{
				lead: "Your own AI tools, too.",
				text: "On a self-hosted install, connect Claude Code, Cursor or another MCP client. It acts with your access, including sending and deleting mail, so only connect tools you trust.",
				src: "FSW#mcp-server (send_reply, send_email, delete_email tools); dev tools.ts toolDeleteEmail (to Trash first, permanent only from Trash or Drafts); D3: /mcp needs Access or a session token, and inboxies.email offers no way to get one (app.ts, MCPPanel.tsx, unchanged on dev); BRIEF (disclose plainly)",
			},
		],
		supportHref: "/support#ask-ai",
		railLabel: "Ask AI",
		media: { still: "chat", clip: "ask-ai" },
		src: "J (OS headline graft); FSW#ai-email-agent; FC#4.8; FSW#ai-email-agent (9 tools, no send)",
	},
	{
		id: "tour-search",
		num: "04",
		name: "Search",
		lineage: "Gmail",
		platforms: ["ios", "android", "web"],
		title: "Find it the way you remember it.",
		body: "Search reads the whole message body, not just the preview, and understands the operators you already use in Gmail.",
		extra: "operators",
		rows: [
			{
				lead: "Instant on iPhone.",
				text: "Results come from an index on your phone first, then the server fills in the rest.",
				platforms: ["ios"],
				src: "FC#4.7 (instant local results, iOS only)",
			},
			{
				lead: "Matches highlighted.",
				text: "The words you searched for are marked in each result.",
				src: "FC#4.7 (highlighted matches)",
			},
			{
				lead: "Or ask.",
				text: "On iPhone, one tap hands your search to Ask AI.",
				platforms: ["ios"],
				src: "FC#4.7 (\"Ask AI '<query>'\" row, SearchView.swift); MEDIA (search still)",
			},
		],
		supportHref: "/support#search",
		railLabel: "Search",
		media: { still: "search" },
		src: "J (OS headline graft); FSW#search (FTS5 over the body, capped at 100,000 characters in email-fts.ts; operators)",
	},
	{
		id: "tour-compose",
		num: "05",
		name: "Compose",
		platforms: ["ios", "android"],
		title: "Drafts that step aside.",
		body: "Swipe a message down and it docks at the bottom of the screen while you check something else. Tap the dock to pick up where you left off.",
		rows: [
			{
				lead: "Saves as you go.",
				text: "Drafts save a few seconds after you stop typing.",
				src: "FC#4.6 (3-second debounce autosave)",
			},
			{
				lead: "Formatting without fuss.",
				text: "Headings, lists, bold and italics, alignment, and attachments from Photos, the camera or Files.",
				src: "FC#4.6 (format sheet; attachments)",
			},
			{
				lead: "Fits the limit.",
				text: "Photos are resized on your phone to fit the 5 MiB send limit. Videos can’t be attached.",
				src: "FC#4.6; PS#4",
			},
		],
		supportHref: "/support#compose",
		railLabel: "Compose",
		media: { still: "compose-minimized", clip: "compose-dock" },
		src: "CT (chapter title); FC#4.6 (compose that minimizes instead of discarding)",
	},
	{
		id: "tour-domains",
		num: "06",
		name: "Your domain",
		platforms: ["ios", "android", "web"],
		title: "Your own name, with the records written for you.",
		body: flags.domainPurchaseLive
			? "Connect a domain you own with one TXT record and a nameserver switch, or register a new one in the app. Inboxies creates the Cloudflare zone, turns on Email Routing and writes your MX, SPF and DMARC records. Check MX, SPF, DKIM and DMARC whenever you like, and one button fixes what’s off."
			: "Connect a domain you own with one TXT record and a nameserver switch. Inboxies creates the Cloudflare zone, turns on Email Routing and writes your MX, SPF and DMARC records. Check MX, SPF, DKIM and DMARC whenever you like, and one button fixes what’s off.",
		rows: [
			{
				lead: "Bring the team.",
				text: "In Domain Admin, create mailboxes, invite people by email, and share a mailbox without sharing a password.",
				src: "FSW#domain-admin-console; FSW#shared-mailboxes",
			},
			{
				lead: "hello@ and support@.",
				text: "While you set up the domain, send addresses like these to any mailbox on it.",
				src: "FC#4.1 (alias presets during onboarding); FSW#domain-aliases",
			},
			{
				lead: "Leave with your mail.",
				text: "Domain admins can export every mailbox to .mbox. Domains registered through Inboxies come with their transfer code.",
				src: "FSW#leave-anytime; PS#5 (EPP only for domains bought through Inboxies)",
			},
		],
		supportHref: "/support#connect-domain",
		railLabel: "Domains",
		media: { still: "domain-admin" },
		src: flags.domainPurchaseLive
			? "J (OS headline graft); FSW#custom-domains; FSW#buy-a-domain; onboarding.ts (records written at zone creation; health check runs on demand); dev ca531c6 domain-verification.ts (TXT proof for connected domains; registered ones skip it)"
			: "J (OS headline graft); FSW#custom-domains; onboarding.ts (records written at zone creation; health check runs on demand); dev ca531c6 domain-verification.ts (TXT proof for connected domains)",
	},
];

// A row that only runs somewhere visitors can't get yet (Focus & Reply while
// the web app isn't public) drops out rather than read as everywhere.
export const chapters: TourChapter[] = allChapters.map((c) => ({
	...c,
	rows: c.rows.filter((r) => !r.platforms || onSomePublicPlatform(r.platforms)),
}));

// Chapter 04's chips. Each chip's meaning becomes its tooltip and a
// screen-reader suffix ("from: — Sender’s name or address").
export const operators: Operator[] = [
	{ op: "from:", meaning: "Sender’s name or address", src: "FSW#search; FC#4.7; durableObject searchEmails (sender, sender_name)" },
	{ op: "to:", meaning: "Recipient’s address", src: "FSW#search; FC#4.7; durableObject searchEmails (recipient, cc, bcc hold addresses only)" },
	{ op: "subject:", meaning: "Words in the subject", src: "FSW#search; FC#4.7" },
	{ op: "in:", meaning: "A folder, like in:inbox", src: "FSW#search; FC#4.7" },
	{ op: "is:unread", meaning: "Mail you haven’t opened", src: "FSW#search; FC#4.7" },
	{ op: "is:starred", meaning: "Starred mail", src: "FSW#search; FC#4.7" },
	{ op: "is:reply-later", meaning: "Your Reply Later pile", src: "FSW#search; FC#4.7" },
	{ op: "has:attachment", meaning: "Mail with files", src: "FSW#search; FC#4.7" },
	{ op: "before:", meaning: "Before a date, like before:2026-09-01", src: "FSW#search; FC#4.7 (SearchQueryParser, YYYY-MM-DD)" },
	{ op: "after:", meaning: "After a date", src: "FSW#search; FC#4.7 (SearchQueryParser, YYYY-MM-DD)" },
];

// The 11px line under the chips: "Combine them: <code>…</code>".
export const operatorExample = {
	label: "Combine them:",
	query: "from:jordan has:attachment after:2026-09-01",
	src: "FSW#search; FC#4.7",
};

// Chapter 03's strip: the receipts Ask AI shows while it works, joined by " · ".
export const agentStrip = {
	label: "What Ask AI shows as it works",
	steps: ["Searched mailbox", "Read thread context", "Thought for 3s", "Drafted a reply in your Drafts folder."],
	src: "MEDIA (chat still); FC#4.8 (receipts, \"Thought for Ns\")",
};
