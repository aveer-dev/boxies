// "And the rest" on the landing (§4.1 L4): smaller things that work today.
// Every row is `available`; FeatureRow and validate.ts both refuse anything else.
// Titles link to their Support answer; two rows have no answer and no link.
import { flags } from "../config";
import { onSomePublicPlatform } from "../lib/platforms";
import type { Feature } from "./types";

const rows: Feature[] = [
	{
		id: "sorting",
		title: "Promotions and Updates",
		href: "/support#sorting",
		platforms: ["ios", "android", "web"],
		description: "Accept a sender into Inbox, Promotions or Updates, and their mail goes there from then on. Spam goes to Spam, caught by its headers, sender checks or a Workers AI model.",
		status: "available",
		src: "FSW#the-screener (accept into Inbox, Promotions or Updates); FSW#smart-sorting (spam only); D2: sender-triage.ts resolveInboundFolder ignores the classifier's folder while the Screener is on",
	},
	{
		id: "senders",
		title: "Sender destinations",
		href: "/support#senders",
		platforms: ["ios", "android", "web"],
		description: "Move one email, choose “Yes, for this sender”, and their past and future mail goes there too. Change it in Settings → Senders.",
		status: "available",
		src: "FSW#sender-destinations; FC#4.3",
	},
	{
		id: "filters",
		title: "Filters",
		href: "/support#filters",
		platforms: ["ios", "android", "web"],
		description: "Up to 50 rules that match a sender, a mailing list or a subject, then file, forward or skip the assistant’s draft. A filter can’t let a stranger past the Screener.",
		status: "available",
		src: "FSW#filters; PS#4",
	},
	{
		id: "spoofed",
		title: "Spoofing warnings",
		href: "/support#spoofed",
		platforms: ["ios", "android", "web"],
		description: "Mail that fails SPF, DKIM or DMARC alignment is marked Spoofed and never drafted for. Personal mail that fails goes straight to Spam.",
		status: "available",
		src: "FSW#spoofing-protection; classify-email.ts classifyFromHeaders (list and auto-submitted mail is classed before the spoof check)",
	},
	{
		id: "forwarding",
		title: "Forwarding and auto-reply",
		href: "/support#forwarding",
		platforms: ["ios", "android", "web"],
		description: "Forward everything, or only what a filter picks, to an address verified in Cloudflare Email Routing; on inboxies.email, ask support to add yours. Away replies go once per sender a day, never to lists or no-reply addresses.",
		status: "available",
		src: "FSW#supporting-features (forwarding, auto-reply); D3: index.ts applyInboundForward uses message.forward, which needs a verified Email Routing destination; no in-app verification (settings-forwarding.tsx)",
		ownerConfirm: "support adds forwarding destinations to the Cloudflare account by hand",
	},
	{
		id: "undo",
		title: "Swipes and undo",
		href: "/support#undo",
		platforms: ["ios", "android"],
		description: "Set up to three swipe actions on each edge. Delete, archive and move wait five seconds for Undo, and you can shake to undo or take back a send for a few seconds on iPhone.",
		status: "available",
		src: "FC#4.4; RM#2 (undo send iOS only)",
	},
	{
		id: "notifications",
		title: "Notifications that open the email",
		href: "/support#notifications",
		platforms: ["ios", "android"],
		description: "See who wrote and a preview, then tap to land on that exact email. The Screener and Spam stay silent.",
		status: "available",
		src: "FC#4.10; FSW#supporting-features (push)",
	},
	{
		id: "offline",
		title: "Works offline on iPhone",
		href: "/support#offline",
		platforms: ["ios"],
		description: "Mail opens from a copy on your phone, and what you do offline is queued until you’re back.",
		status: "available",
		src: "FC#4.10 (offline-first, iOS only)",
	},
	{
		id: "live",
		title: "Live updates",
		platforms: ["ios", "android", "web"],
		description: "New mail appears at the top of the list as it arrives.",
		status: "available",
		src: "FSW#supporting-features (real-time sync); FC#4.10",
	},
	{
		id: "mailboxes",
		title: "Many mailboxes, one sign-in",
		href: "/support#mailboxes",
		platforms: ["ios", "android", "web"],
		description: "Keep several addresses under one account and switch between them. Share a mailbox with owners and members, without sharing a password.",
		status: "available",
		src: "FSW#shared-mailboxes; FC#4.1 (avatar menu on iPhone); home.tsx (Mailboxes page on the web)",
	},
	{
		id: "delivery",
		title: "Delivery status",
		platforms: ["ios", "android", "web"],
		description: "Sent mail shows Sending, Sent, Send failed, Bounced or Marked as spam, with the reason.",
		status: "available",
		src: "FSW#supporting-features (delivery status badges); FC#4.5",
	},
	{
		id: "html",
		title: "Safe HTML",
		href: "/support#html",
		platforms: ["ios", "android", "web"],
		description: "Email HTML is cleaned, scripts never run, and messages render in a sandbox. You can view any message’s headers.",
		status: "available",
		src: "FSW#supporting-features (safe HTML); FC#4.5; EmailPanelDialogs.tsx and EmailActionsSheet.swift (headers only, no raw MIME)",
	},
	{
		id: "sign-in",
		title: "Sign in your way",
		href: "/support#sign-in",
		platforms: ["ios", "android", "web"],
		description: flags.androidPublic
			? "Sign in with Apple on iPhone, Google on Android, or email and password everywhere."
			: "Sign in with Apple on iPhone, or with your email and password anywhere.",
		status: "available",
		src: "FC#8.3; PS#5 (sign-in methods)",
	},
];

// Joins the list once private email reaches main (the landing callout and
// the roadmap's "Next release" go at the same time).
const privateEmail: Feature = {
	id: "private-email",
	title: "Private email",
	href: "/support#private-email",
	platforms: ["ios", "android", "web", "chrome"],
	description: "A fresh address for every sign-up form. Reply from it, pause it, or let it expire, and your real address stays yours.",
	status: "available",
	src: "RM#1 (1); FC#7",
};

// A row whose platforms are all hidden (say, web-only while the web app isn't public) drops out.
export const moreFeatures: Feature[] = (flags.privateEmailShipped ? [...rows, privateEmail] : rows).filter((f) => onSomePublicPlatform(f.platforms));
