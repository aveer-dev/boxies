// What has shipped, newest first (§4.3 R5). Only what's on main: this list
// sits outside the roadmap's data-claim wrapper, so check:claims holds it to
// the strict rules.
//
// Left out on purpose: "Private email (v1)" from 5 Oct (its screen is on
// main, but its addresses don't receive mail; the working version is Next
// release), the hidden "For you" digest from 11 Sep (that entry is "Dark
// mode"), and the 20 Aug deploy fix.
import { flags } from "../config";
import type { ChangeEntry } from "./types";

export const entries: ChangeEntry[] = [
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
		description: `${flags.androidPublic ? "The Android app, and " : ""}Promotions, Updates and Spam folders, plus-addressing, forwarding and auto-reply.`,
		src: "RM#4 (#6–#10); D2 (no sorting claim: since the Screener, senders are filed where you accept them)",
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
