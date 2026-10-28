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
		description: "Accept a sender into Inbox, Promotions or Updates, and their mail goes there from then on. Mail from people you’ve emailed is sorted by its headers: list mail to Promotions, or to Updates for receipts and alerts, and the rest to Inbox. Spam goes to Spam, caught by its headers, sender checks or a Workers AI model.",
		status: "available",
		src: "FSW#the-screener (accept into Inbox, Promotions or Updates); dev 31c58c6 (PR #56): sender-triage.ts resolveInboundFolder uses the classifier's folder for allowed senders with no chosen destination (emailed, bootstrap, welcome); approve stores one (index.ts sender-triage/approve); classify-email.ts classifyFromHeaders (List-*/Precedence → Promotions, Auto-Submitted or receipt words → Updates; Workers AI is spam vs ham only)",
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
		description: "See who wrote and a preview, then tap to land on that exact email. The Screener, Spam and mail a filter files away stay silent.",
		status: "available",
		src: "FC#4.10; FSW#supporting-features (push); dev cb0b217 sender-triage.ts (filedAway → skipPush)",
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
		id: "web-columns",
		title: "Columns on the web",
		href: "/support#shortcuts",
		platforms: ["web"],
		description: "Mailboxes, folders, the list and the message open side by side, and every view has its own link. Reply from the box under a message, press C to write or ⌘K to search. On a phone, each column gets its own screen.",
		status: "available",
		src: "dev 87720b1/4545317 (PR #53, on dev via 6ebc554 11 Oct): routes.ts (emails/:folder/:emailId?, nested settings), mailbox.tsx (Accounts/Folders/list/reader columns), QuickReplyBar.tsx, FloatingDock.tsx (C, ⌘K focuses search); ColumnCanvas.tsx (snap-x on phones)",
	},
	{
		id: "mailboxes",
		title: "Many mailboxes, one sign-in",
		href: "/support#mailboxes",
		platforms: ["ios", "android", "web"],
		description: "Keep several addresses under one account and switch between them. Share a mailbox with owners and members, without sharing a password.",
		status: "available",
		src: "FSW#shared-mailboxes; FC#4.1 (avatar menu on iPhone); home.tsx (Mailboxes page on the web); dev AccountsColumn.tsx (mailbox column on the web)",
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
		description: "Email HTML is cleaned, scripts never run, and messages render in a sandbox. In Spam, remote images wait until you choose Load images, and you can view any message’s headers.",
		status: "available",
		src: "FSW#supporting-features (safe HTML); FC#4.5; EmailPanelDialogs.tsx and EmailActionsSheet.swift (headers only, no raw MIME); dev AVE-132 (Spam blocks remote images until Load images) (#168: shared/remote-images.ts, EmailIframe.tsx; EmailHTMLSanitizer.swift / EmailHtmlSanitizer.kt blocksRemoteImages, folder_id == spam)",
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

// Joins the list once private email is on dev (the landing callout and the
// roadmap's "Next release" go at the same time). Chrome stays off the
// platform line until the extension is listed (platforms.ts).
const privateEmail: Feature = {
	id: "private-email",
	title: "Private email",
	href: "/support#private-email",
	platforms: ["ios", "android", "web", "chrome"],
	description: flags.iosAutofillInBeta
		? "A random address for every sign-up form, delivered to your mailbox. Replies go out from it, so your real address stays yours. Pause it, let it expire or delete it, and on iPhone, AutoFill makes one right in the form."
		: "A random address for every sign-up form, delivered to your mailbox. Replies go out from it, so your real address stays yours. Pause it, let it expire or delete it.",
	status: "available",
	src: "PR #46 on dev 8 Oct: fc74b93 (aliases.ts create/patch/delete; alias-utils.ts random token, cap 1,000; alias-sender.ts replies from the alias); fc8e2b2 settings-aliases.tsx (web); AliasesSettingsView.swift / .kt; d5df670 (AutoFill, gated on iosAutofillInBeta)",
};

// Joins the list once auto-drafts run on new mailboxes (PR #49, on dev). Avoids
// the words "automatic draft", which check:claims gates on the same flag.
const autoDrafts: Feature = {
	id: "auto-drafts",
	title: "Draft replies, ready when you are",
	href: "/support#ai-reads",
	platforms: ["ios", "android", "web"],
	description: "When personal mail arrives from someone you’ve let in, the assistant writes a reply into Drafts for you to edit or send. It skips the Screener, Spam, bulk and spoofed mail, and checks each message for prompt injection first.",
	status: "available",
	src: "dev b7895d9 (PR #49, dev 9 Oct): email-agent.ts getAgentByName, so the auto conversation runs on brand-new mailboxes; index.ts auto-draft gate (ham, not Screener, not filed away, not spoofed); agent/index.ts handleNewEmail (injection scan of subject, body and thread)",
};

// A row whose platforms are all hidden (say, web-only while the web app isn't public) drops out.
export const moreFeatures: Feature[] = [
	...rows,
	...(flags.privateEmailShipped ? [privateEmail] : []),
	...(flags.autoDraftsFromDayOne ? [autoDrafts] : []),
].filter((f) => onSomePublicPlatform(f.platforms));
