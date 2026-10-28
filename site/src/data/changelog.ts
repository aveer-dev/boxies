// What has shipped, newest first (§4.3 R5). Only what's on dev, the branch
// the site ships with; dates are when a change reached dev (GitHub's merge
// time, UTC). This list sits outside the roadmap's data-claim wrapper, so
// check:claims holds it to the strict rules.
//
// Left out on purpose: "Private email (v1)" from 5 Oct (superseded by the
// working version on 8 Oct), iPhone AutoFill and the Chrome extension until
// people can install them, internal fixes (Stripe webhook signing, CI, type
// errors), the hidden "For you" digest from 11 Sep (that entry is "Dark
// mode"), the 20 Aug deploy fix, and 11 Oct "Remote images wait for you"
// (superseded by AVE-132, #168: images load, and only Spam holds them back;
// its own entry waits until asOf in config.ts moves past its merge date).
import { flags } from "../config";
import type { ChangeEntry } from "./types";

const appsLine = flags.androidPublic ? "in the iPhone and Android apps" : "in the iPhone app";

export const entries: ChangeEntry[] = [
	{
		date: "2026-10-11",
		title: "Columns on the web",
		description:
			"The web app puts your mailboxes, folders, the list and the message side by side, and every view has its own link, so back, reload and bookmarks work. Reply from the box under a message, press C to write, ⌘K to search and ⌘J to ask the assistant. On a phone, each column gets its own screen.",
		src: "PR #53 (87720b1, 4545317; main 10 Oct), on dev via 6ebc554 \"Merge main into dev\" 11 Oct; FloatingDock.tsx, QuickReplyBar.tsx, ColumnCanvas.tsx",
	},
	{
		date: "2026-10-11",
		title: "Delete your account",
		description: `Settings → Account → Delete account ${appsLine} removes your account and its sign-in methods. Mailboxes where you’re the only owner are erased; from mailboxes with other owners, you’re removed.`,
		src: "PR #59 (eda481f) + PR #52 (cb0b217: DELETE /api/v1/me), on dev 11 Oct; SettingsSheetView.swift / .kt",
	},
	{
		date: "2026-10-11",
		title: "Sorting for people you know",
		description:
			"Mail from people you’ve emailed, and from senders already in your mail, is sorted into Inbox, Promotions or Updates by its headers again. Senders you accept still go where you chose, and the AI spam check alone no longer sends their verified mail to Spam.",
		src: "PR #56 (31c58c6, main 10 Oct) and PR #64 (d19cd72, main 11 Oct), both on dev via 6ebc554 \"Merge main into dev\" 11 Oct",
	},
	{
		date: "2026-10-11",
		title: "Trash, filters and forwarding",
		description:
			"Deleting mail moves it to Trash first, and the web app can empty Trash. Mail a filter files away no longer notifies you or gets a draft, mail in the Screener is forwarded if you forward your mail, and the assistant’s drafts never replace yours. Only a mailbox’s owners can change its forwarding, auto-reply, filters and AI prompt.",
		src: "PR #52 (cb0b217): trashOrDeleteEmail + POST /folders/trash/empty (email-list.tsx Empty Trash); sender-triage.ts (filedAway skips; unknown skipForward false); tools.ts drafts source agent; index.ts ownerOnlyKeys; on dev 11 Oct",
	},
	{
		date: "2026-10-11",
		title: "Exports and moving a domain",
		description:
			"Only a domain’s admins can download its .mbox export, and the download is kept for 7 days. Move DNS / Offboard stops mail for the domain, and first asks for a recent export of the whole domain.",
		src: "PR #47 (4811793, f11c872; dev 8 Oct), PR #48 (d024650; dev 9 Oct), ca531c6 (expiry) and cb0b217 (catch-all disabled on offboarding), dev 11 Oct; dated by the last part to land",
	},
	{
		date: "2026-10-11",
		title: "Safer password resets and domain setup",
		description:
			"A reset code works only with the email it was sent to and stops after five wrong tries, and a reset signs you out everywhere else you used your old password. Connecting a domain you own starts with a TXT record that shows it’s yours.",
		src: "PR #57 (a85c07e, main 10 Oct → dev via 6ebc554 11 Oct); PR #51 (ca531c6: domain-verification.ts, tokenVersion bump), dev 11 Oct",
	},
	{
		date: "2026-10-11",
		title: "A clearer stack button",
		description: "The button that opens your folders shows a stack instead of a pencil, and springs back when you press it. The iPhone beta opens on iOS 18.5 again.",
		src: "PR #55 (fe7e1e2, main 10 Oct) and PR #61 (a0739ed, main 11 Oct), on dev via 6ebc554 11 Oct",
	},
	...(flags.autoDraftsFromDayOne
		? [
				{
					date: "2026-10-09",
					title: "Draft replies from the first email",
					description: "The assistant now prepares draft replies on brand-new mailboxes too, from their first email. They wait in Drafts until you send them.",
					src: "PR #49 (b7895d9) merged to dev 2026-10-09T00:14Z; ba5d920 (PR #60) is the same fix on main",
				},
			]
		: []),
	...(flags.privateEmailShipped
		? [
				{
					date: "2026-10-08",
					title: "Private email",
					description: `Make a random address for every sign-up in Settings → Private email, ${flags.webAppPublic ? `on the web and ${appsLine}` : appsLine}. Mail to it reaches your mailbox, replies go out from it, and you can pause it, let it expire or delete it, up to 1,000 per mailbox.`,
					src: "PR #46 merged to dev 2026-10-08T03:35Z (454dd4f): fc74b93 worker, fc8e2b2 web, e9236be iOS, 2ef2e82 Android",
				},
			]
		: []),
	{
		date: "2026-10-04",
		title: "Sign up on your own",
		description: flags.domainPurchaseLive
			? "Get a personal @inboxies.email address or set up a domain without an invite, register a domain with yearly pricing, and reset a forgotten password by email."
			: "Get a personal @inboxies.email address or set up a domain without an invite, and reset a forgotten password by email.",
		src: "RM#4 (#43)",
	},
	{
		date: "2026-10-01",
		title: "A new icon, easier switching",
		description: "The wireframe paper plane on every platform, quicker account switching, redesigned sharing, and DNS management in the apps.",
		src: "RM#4 (bfd559b, 22640b1, 187a496)",
	},
	{
		date: "2026-09-30",
		title: "One account, many ways in",
		description: "Mailboxes belong to your account, not to one sign-in method, and you can change your password in any app.",
		src: "RM#4 (#37–#42)",
	},
	{
		date: "2026-09-27",
		title: "A compose button that stacks",
		description: "A new stacked compose button, and drag to dismiss and drag to dock are back.",
		src: "RM#4 (#36, #38, #40)",
	},
	{
		date: "2026-09-21",
		title: "More ways to sign in",
		description: "Add sign-in methods from inside the app, or link another device with a code.",
		src: "RM#4 (#33–#35)",
	},
	{
		date: "2026-09-20",
		title: "Domain Admin and invites",
		description: "Create, assign and delete mailboxes on your domain, and invite people by email.",
		src: "RM#4 (#29–#32)",
	},
	{
		date: "2026-09-20",
		title: "Screener, New and Seen, Reply Later",
		description: "First-time senders wait for your yes, senders get a default destination, the Inbox splits into New and Seen, and Reply Later arrives with Focus & Reply on the web.",
		src: "RM#4 (#18, #24–#28)",
	},
	{
		date: "2026-09-19",
		title: "Spoofing warnings, filters and attachments",
		description: "SPF, DKIM and DMARC warnings, inbound filters, sending attachments, safer HTML in the apps, search operators everywhere, and bounce badges.",
		src: "RM#4 (#17, #19–#23)",
	},
	{
		date: "2026-09-16",
		title: "Recipient suggestions",
		description: "To, Cc and Bcc suggest people you’ve emailed.",
		src: "RM#4 (#16)",
	},
	{
		date: "2026-09-14",
		title: "Full-text search, delivery status, push",
		description: "Search reads whole message bodies, sent mail shows delivery and bounces, and notifications open the exact email.",
		src: "RM#4 (#11–#14)",
	},
	{
		date: "2026-09-13",
		title: "Promotions, Updates and Spam",
		description: `${flags.androidPublic ? "The Android app, and " : ""}Mail sorted into Promotions, Updates and Spam, plus-addressing, forwarding and auto-reply.`,
		src: "RM#4 (#6–#10: header and AI classifier); dev 31c58c6 (sorting applies again to senders without a chosen destination)",
	},
	{
		date: "2026-09-11",
		title: "Dark mode",
		description: "Light, dark or system in the iPhone app.",
		src: "RM#4 (1045f50, 11 Sep)",
	},
	{
		date: "2026-09-09",
		title: "Inter, everywhere",
		description: "Inter type across the apps, a smoother AI chat, and cleaner quoted replies on iPhone.",
		src: "RM#4 (#5); aa4028e (quoted replies, 9 Sep)",
	},
	{
		date: "2026-09-03",
		title: "The iPhone app",
		description: "A native SwiftUI app with live sync, push notifications, Sign in with Apple and multi-chat AI.",
		src: "RM#4 (#3, #4)",
	},
	{
		date: "2026-04-16",
		title: "Where it started",
		description: "A fork of Cloudflare’s open-source agentic-inbox: a web client, an AI agent and an MCP server.",
		src: "RM#4 (cff1a79)",
	},
];
