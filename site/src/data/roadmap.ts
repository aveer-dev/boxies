// The roadmap database (§4.3 R2), the landing's "Today and next" rows
// (`landing: true`, §4.1 L6) and "Coming next, in detail" (§4.3 R3).
// Status follows the branches: the site ships with dev, so on dev = available,
// open PR or branch = review / in progress. Nothing here is "available" unless
// it works end to end on dev. Something on dev that visitors can't install yet
// (iPhone AutoFill before a TestFlight build carries it, the Chrome extension
// before a store listing) waits behind its flag in config.ts as "next".
//
// Left out on purpose: "Offline on Android", which has no plan behind it.
// (The export fixes, PRs #47 and #48, are on dev and in the changelog.)
import { APP_HOST, IOS_STATUS, asOf, flags } from "../config";
import { onSomePublicPlatform } from "../lib/platforms";
import type { CalloutCopy, ComingNext, RoadmapGroup, RoadmapRow } from "./types";

export { asOf };

export const GROUP_LABEL: Record<RoadmapGroup, string> = {
	triage: "Triage",
	ai: "AI",
	"search-compose": "Search and compose",
	domains: "Domains and teams",
	privacy: "Privacy and trust",
	apps: "Apps and sync",
};

// Shipping either of these is a flag flip in config.ts, not a data edit.
const privateEmailStatus = flags.privateEmailShipped ? "available" : "next";
const draftsStatus = flags.autoDraftsFromDayOne ? "available" : "next"; // PR #49 on dev since 9 Oct; flag on while the site ships with dev

const all: (RoadmapRow & { hidden?: boolean })[] = [
	// ── Triage ──
	{ id: "screener", group: "triage", name: "Screener", status: "available", lineage: "HEY", platforms: ["ios", "android", "web"], note: "On for every new mailbox. No off switch yet.", landing: true, src: "FSW#the-screener; RM#3" },
	{ id: "new-and-seen", group: "triage", name: "New and Seen", status: "available", lineage: "HEY", platforms: ["ios", "android", "web"], note: "Opening a thread moves it to Seen.", src: "FSW#supporting-features" },
	{ id: "categories", group: "triage", name: "Promotions and Updates", status: "available", lineage: "Gmail", platforms: ["ios", "android", "web"], note: "Choose one per sender, or let newsletters from people you’ve emailed be sorted for you. No Social or Forums.", landing: true, src: "RM#2 (categories); dev 31c58c6 (explicit destination wins; classifier files allowed senders without one; classify-email.ts header rules)" },
	{ id: "sender-destinations", group: "triage", name: "Sender destinations", status: "available", lineage: "HEY", platforms: ["ios", "android", "web"], note: "Settings → Senders.", src: "FSW#sender-destinations" },
	{ id: "reply-later", group: "triage", name: "Reply Later", status: "available", lineage: "HEY", platforms: ["ios", "android", "web"], note: "Leaves the pile when you reply.", landing: true, src: "RM#3" },
	{ id: "focus-reply", group: "triage", name: "Focus & Reply", status: "available", lineage: "HEY", platforms: ["web"], note: "Web only.", landing: true, src: "RM#3 (web only)" },
	{ id: "filters", group: "triage", name: "Filters", status: "available", lineage: "Gmail", platforms: ["ios", "android", "web"], note: "Up to 50 per mailbox.", src: "FSW#filters" },
	{ id: "swipes", group: "triage", name: "Swipe actions", status: "available", platforms: ["ios", "android"], note: "Up to three per edge.", src: "FC#4.4" },
	{ id: "undo", group: "triage", name: "Undo for delete, archive and move", status: "available", lineage: "Gmail", platforms: ["ios", "android"], note: "About five seconds.", src: "FC#4.4; J (no undo on web)" },
	{ id: "undo-send", group: "triage", name: "Undo send", status: "available", lineage: "Gmail", platforms: ["ios"], note: "A few seconds after you tap Send.", src: "RM#2 (iOS only)" },
	{ id: "set-aside", group: "triage", name: "Set Aside", status: "planned", lineage: "HEY", platforms: [], note: "A second pile for mail you need to keep handy.", landing: true, src: "RM#1 (4)" },
	{ id: "tags", group: "triage", name: "Tags and a VIP view", status: "exploring", lineage: "Gmail", platforms: [], note: "Today: folders and stars; the web app lists your own folders as #tags.", src: "RM#1 (8); dev FoldersColumn.tsx (custom folders shown as #tags, one per email); no VIP view in app/" },

	// ── AI ──
	{ id: "ask-ai", group: "ai", name: "Ask AI", status: "available", platforms: ["ios", "android", "web"], note: flags.webAppPublic ? "Drafts and files; never sends. Several chats in the apps, one on the web." : "Drafts and files; never sends. Several chats at once.", landing: true, src: "FSW#ai-email-agent; FC#4.8; FC#2" },
	{ id: "ai-prompt", group: "ai", name: "Custom AI prompt", status: "available", platforms: ["ios", "android", "web"], note: "One per mailbox.", src: "FC#4.8" },
	{
		id: "drafts-day-one",
		group: "ai",
		name: draftsStatus === "available" ? "Draft replies as mail arrives" : "Drafts from day one",
		status: draftsStatus,
		platforms: draftsStatus === "available" ? ["ios", "android", "web"] : [],
		note:
			draftsStatus === "available"
				? "Personal mail from senders you’ve let in gets a reply in Drafts, from a new mailbox’s first email. Never sent for you."
				: "Draft replies that start on a brand-new mailbox’s first email.",
		src: "RM#1 (2); PR #49 / b7895d9 merged to dev 9 Oct; dev index.ts auto-draft gate; email-agent.ts getAgentByName",
		ownerConfirm: draftsStatus === "available" ? undefined : "list publicly",
	},
	{ id: "for-you", group: "ai", name: "“For you” brief", status: "progress", lineage: "HEY", platforms: ["ios", "android"], note: "To-dos and topics to catch up on. Built, not switched on yet.", src: "FC#7 (built, hidden)", ownerConfirm: "tease publicly" },
	{ id: "rewrite", group: "ai", name: "Rewrite in the composer", status: "exploring", lineage: "Gmail", platforms: [], note: "Ask the assistant to tighten or rephrase.", src: "RM#1 (11)" },
	{ id: "scoped-keys", group: "ai", name: "Connect your own AI tools", status: "available", platforms: [], note: "Claude, Cursor and other AI apps, with the mailboxes and permissions you choose.", src: "RM#1 (12); MCP OAuth on main since #152 (AVE-67/68/69/70): mcp/oauth.ts, shared/mcp-consent.ts, mcp/scopes.ts, SessionsSettings.tsx" },

	// ── Search and compose ──
	{ id: "search-operators", group: "search-compose", name: "Gmail-style search", status: "available", lineage: "Gmail", platforms: ["ios", "android", "web"], note: "from: to: subject: in: is: has: before: after:", landing: true, src: "FSW#search; RM#2" },
	{ id: "full-text-search", group: "search-compose", name: "Full-text search", status: "available", lineage: "Gmail", platforms: ["ios", "android", "web"], note: "Message bodies, not just previews.", src: "FSW#search" },
	{ id: "on-device-search", group: "search-compose", name: "Instant on-device search", status: "available", platforms: ["ios"], note: "Your phone’s index first, then the server.", src: "FC#4.7" },
	{ id: "compose-dock", group: "search-compose", name: "Compose dock", status: "available", platforms: ["ios", "android"], note: "Swipe a draft down to park it.", src: "FC#4.6" },
	{ id: "formatting", group: "search-compose", name: "Formatting and attachments", status: "available", platforms: ["ios", "android", "web"], note: flags.androidPublic ? "No text colour on Android yet." : undefined, src: "FC#4.6 (text colour iOS, not Android); FSW#supporting-features; ComposeFormatSheet.tsx (text colour on the web)" },
	{ id: "recipients", group: "search-compose", name: "Recipient suggestions", status: "available", lineage: "Gmail", platforms: ["ios", "android", "web"], note: "From people you’ve emailed.", src: "FSW#supporting-features" },
	{ id: "web-workspace", group: "search-compose", name: "Columns on the web", status: "available", platforms: ["web"], note: "Mailboxes, folders, list and message side by side, with ⌘K search and a quick-reply box.", landing: true, src: "RM#1 (5); dev 87720b1/#53 (routes.ts nested column routes; mailbox.tsx columns; FloatingDock.tsx ⌘K focuses search; QuickReplyBar.tsx), on dev via 6ebc554 11 Oct" },
	{ id: "shortcuts", group: "search-compose", name: "More keyboard shortcuts on the web", status: "planned", lineage: "Gmail", platforms: ["web"], note: "j and k, r, l and more, with a ? list. C, ⌘K, ⌘J, [ ] and Esc work today.", landing: true, src: "RM#1 (6); dev FloatingDock.tsx (C, ⌘K), ColumnCanvas.tsx ([ ] and Esc), QuickReplyBar.tsx (⌘J, ⌘↵, ⇧⌘O); no j/k/r/l/? handler in app/" },
	{ id: "signature-web", group: "search-compose", name: "Signature editor on the web", status: "exploring", lineage: "Gmail", platforms: ["web"], note: "The iPhone app can add a fixed “Sent with Inboxies Email” line; custom signatures can’t be written yet.", src: "RM#1 (10); FSW#caveats (7); SettingsSheetView.swift (signature toggle only)" },
	{ id: "scheduled-send", group: "search-compose", name: "Scheduled send", status: "exploring", lineage: "Gmail", platforms: [], note: "Write now, send later.", landing: true, src: "RM#1 (9)" },

	// ── Domains and teams ──
	{
		id: "custom-domains",
		group: "domains",
		name: "Custom domains, set up for you",
		status: "available",
		platforms: ["ios", "android", "web"],
		note: flags.domainPurchaseLive ? "Connect one you own, or register one." : "Connect one you own.",
		landing: true,
		src: "FSW#custom-domains",
	},
	{ id: "dns", group: "domains", name: "Domain health check", status: "available", platforms: ["ios", "android", "web"], note: "See what’s working, and fix what’s off in one click. Edit the domain’s records yourself if you need to.", src: "FSW#custom-domains" },
	{ id: "domain-admin", group: "domains", name: "Domain Admin and invites", status: "available", lineage: "Gmail", platforms: ["ios", "android", "web"], note: "Create, assign, invite, delete.", src: "FSW#domain-admin-console" },
	{ id: "shared-mailboxes", group: "domains", name: "Shared mailboxes", status: "available", lineage: "Gmail", platforms: ["ios", "android", "web"], note: "Owners and members.", src: "FSW#shared-mailboxes" },
	{ id: "domain-export", group: "domains", name: "Whole-domain .mbox export", status: "available", lineage: "Gmail", platforms: ["ios", "android", "web"], note: "Domain admins.", src: "FSW#leave-anytime" },
	{ id: "transfer", group: "domains", name: "Transfer code and unlock", status: "available", platforms: ["ios", "android", "web"], note: "Domains registered through Inboxies.", src: "PS#5" },
	{ id: "mailbox-export", group: "domains", name: "Export a mailbox from Settings", status: "planned", lineage: "Gmail", platforms: [], note: "One button, any mailbox.", landing: true, src: "RM#1 (7)" },

	// ── Privacy and trust ──
	{
		id: "private-email",
		group: "privacy",
		name: "Private email addresses",
		anchor: "private-email",
		status: privateEmailStatus,
		lineage: "Hide My Email",
		platforms: ["ios", "android", "web", "chrome"],
		note: "A fresh address per sign-up; replies come from it. Up to 1,000 per mailbox.",
		landing: true,
		src: "PR #46 on dev 8 Oct (fc74b93 deliverable aliases, cap 1,000, From enforced; fc8e2b2 web; e9236be iOS; 2ef2e82 Android); Chrome hidden by platforms.ts until chromeExtensionPublic",
	},
	{
		id: "private-email-autofill",
		group: "privacy",
		name: "Private email from AutoFill",
		status: flags.iosAutofillInBeta ? "available" : "next",
		lineage: "Hide My Email",
		platforms: ["ios", "android"],
		note: "Makes one right in a sign-up form. On iOS 17 it’s copied for you to paste.",
		landing: true,
		src: "d5df670 (InboxiesCredentialProvider target, entitlements, iOS 18 text insertion, password-list copy); c0d5002 (Android autofill service); needs the App ID / App Group portal setup before a TestFlight build",
		ownerConfirm: flags.iosAutofillInBeta ? undefined : "next TestFlight build carries the AutoFill extension",
	},
	{
		id: "chrome-extension",
		group: "privacy",
		name: "Chrome extension for private email",
		status: flags.chromeExtensionPublic ? "available" : "progress",
		platforms: ["chrome"],
		note: flags.chromeExtensionPublic ? "A Private email button next to sign-up email fields." : "Built; it goes up once it’s listed in the Chrome Web Store.",
		src: "1afa7e3 (MV3, Chrome 120+, aliases-only pairing via /extension/connect, sign-up pill); dev extension/manifest.json (no store listing)",
		ownerConfirm: flags.chromeExtensionPublic ? undefined : "submit to the Chrome Web Store",
	},
	{ id: "spoofing", group: "privacy", name: "Spoofing warnings", status: "available", lineage: "Gmail", platforms: ["ios", "android", "web"], note: "Mail pretending to be from someone else is flagged.", src: "FSW#spoofing-protection" },
	{ id: "safe-html", group: "privacy", name: "Safe to open", status: "available", platforms: ["ios", "android", "web"], note: "Code hidden in an email never runs.", src: "FSW#supporting-features" },
	{ id: "tracking-pixels", group: "privacy", name: "Remote images held back in Spam", status: "available", lineage: "Gmail", platforms: ["ios", "android", "web"], note: "Hidden in Spam until you choose Load images; elsewhere they load.", src: "dev AVE-132 (#168: shared/remote-images.ts, EmailIframe.tsx; EmailHTMLSanitizer.swift / EmailHtmlSanitizer.kt blocksRemoteImages, folder_id == spam)" },
	{
		id: "delete-account",
		group: "privacy",
		name: "Delete your account",
		status: "available",
		platforms: ["ios", "android"],
		note: flags.webAppPublic ? "Settings → Account in the apps; not on the web yet." : "Settings → Account.",
		src: "dev eda481f + cb0b217 (#59/#52): index.ts DELETE /api/v1/me (sole-owned mailboxes purged, otherwise removed from the ACL); SettingsSheetView.swift / .kt Account → Delete account; no web UI",
	},

	// ── Apps and sync ──
	{ id: "web-app", group: "apps", name: "Web app", status: "available", platforms: ["web"], note: APP_HOST, src: "FSW (scope)" },
	{
		id: "iphone-app",
		group: "apps",
		name: "iPhone app",
		status: "available",
		platforms: ["ios"],
		note: IOS_STATUS === "appstore" ? "On the App Store." : "Beta on TestFlight.",
		hidden: IOS_STATUS === "hidden",
		src: "FC#8.5",
	},
	{
		id: "android-app",
		group: "apps",
		name: "Android app",
		// Shown as coming soon until it's public (AVE-54).
		status: flags.androidPublic ? "available" : "next",
		platforms: ["android"],
		note: flags.androidPublic ? "On Google Play." : "Coming soon.",
		src: "FC#1 (Android 14+); FC#8.5; AVE-54 (Android coming soon)",
	},
	{ id: "push", group: "apps", name: "Push notifications", status: "available", lineage: "Gmail", platforms: ["ios", "android"], note: "Tap to open the exact email.", src: "RM#2" },
	{ id: "live", group: "apps", name: "Live updates", status: "available", platforms: ["ios", "android", "web"], note: "New mail appears as it arrives.", src: "FSW#supporting-features" },
	{ id: "offline", group: "apps", name: "Offline on iPhone", status: "available", lineage: "Gmail", platforms: ["ios"], note: "A local copy, and actions queued until you’re back.", src: "FC#4.10" },
];

/**
 * Every visible row, in group order (48 with the default flags). A shipped
 * row whose platforms are all hidden (the web app and Focus & Reply while the
 * web app isn't public) drops out rather than show no platform.
 */
export const rows: RoadmapRow[] = all
	.filter((r) => !r.hidden && (r.status !== "available" || onSomePublicPlatform(r.platforms)))
	.map(({ hidden: _, ...r }) => r);

// The landing's "Today and next" table lists its rows in its own order (§4.1
// L6), not the database's group order. RoadmapTable sorts by status and keeps
// this order within a status.
const LANDING_ORDER = [
	"screener",
	"reply-later",
	"focus-reply",
	"categories",
	"search-operators",
	"ask-ai",
	"custom-domains",
	"private-email",
	"private-email-autofill",
	"web-workspace",
	"shortcuts",
	"set-aside",
	"mailbox-export",
	"scheduled-send",
];

/** The `landing: true` rows in the landing table's order (14 with the default flags). Use this, not `rows.filter((r) => r.landing)`. */
const landingRank = (id: string) => (LANDING_ORDER.includes(id) ? LANDING_ORDER.indexOf(id) : LANDING_ORDER.length);
export const landingRows: RoadmapRow[] = rows
	.filter((r) => r.landing)
	.sort((a, b) => landingRank(a.id) - landingRank(b.id));

const allComingNext: (ComingNext & { hidden?: boolean })[] = [
	{
		id: "private-email",
		title: "Private email addresses",
		status: "next",
		body:
			"Make a fresh address for every site you sign up to, from Settings → Private email. Mail to it reaches your mailbox with a “Private email” badge (a site’s first email waits in the Screener, like any new sender), and replies go out from that address, so your real one stays private. Pause one, set it to expire, or delete it. Up to 1,000 per mailbox." +
			" AutoFill on iPhone, which creates one right in the email field (on iOS 17 it copies one for you to paste), follows in a later TestFlight build, and a Chrome extension follows once it’s in Chrome’s store." +
			(flags.androidPublic ? " Android’s autofill does the same." : ""),
		hidden: flags.privateEmailShipped,
		src: "FC#7 (iOS 18+ inserts, iOS 17 copies; Chrome pairing; From enforced; cap 1,000); FC#4.9; RM#1 (1); dev index.ts (alias mail runs through resolveInboundFolder, no Screener bypass); d5df670 (AutoFill needs App ID and App Group setup); extension/manifest.json (no store listing)",
	},
	{
		// Once private email itself is out, this keeps the sign-up-form story
		// (inside the roadmap wrapper) until both pieces can be installed.
		id: "private-email-autofill",
		title: "Private email in the sign-up form",
		status: flags.iosAutofillInBeta ? "progress" : "next",
		body: [
			flags.iosAutofillInBeta
				? ""
				: "On iPhone, choose AutoFill → Inboxies in a sign-up form and a new private address is made and filled in; on iOS 17, pick Inboxies from the passwords bar and paste the address it copies. It’s finished and comes with the next TestFlight build.",
			flags.chromeExtensionPublic ? "" : "In Chrome, an extension puts a Private email button next to sign-up email fields. It’s built, and goes up once it’s listed in the Chrome Web Store.",
			flags.androidPublic ? "Android’s autofill does the same." : "",
		]
			.filter(Boolean)
			.join(" "),
		hidden: !flags.privateEmailShipped || (flags.iosAutofillInBeta && flags.chromeExtensionPublic),
		src: "d5df670 (iOS 18 text insertion; password-list copy; portal setup pending); c0d5002 (Android); 1afa7e3 + extension/manifest.json (no store listing)",
		ownerConfirm: "next TestFlight build carries AutoFill; Chrome Web Store submission",
	},
	{
		id: "drafts-day-one",
		title: "Drafts from day one",
		status: draftsStatus,
		body: "Automatic draft replies to personal mail, working from a new mailbox’s first email. Drafts still wait in Drafts until you send them.",
		hidden: flags.autoDraftsFromDayOne,
		src: "RM#1 (2); PR #49 merged to dev",
		ownerConfirm: "list publicly",
	},
	{
		id: "for-you",
		title: "“For you” brief",
		status: "progress",
		body: "A short summary in the iPhone app: replies you probably owe, as to-dos you can tick off, and topics like purchases, travel and security to catch up on. It’s built, and not switched on yet.",
		src: "FC#7; FSW#supporting-features (Inbox Brief: rules, not AI)",
		ownerConfirm: "tease publicly",
	},
	{
		id: "shortcuts",
		title: "More keyboard shortcuts on the web",
		status: "planned",
		body: "More single-key shortcuts like Gmail’s: j and k to move through mail, r to reply, l for Reply Later, and ? to see them all. Today the web app has C to compose, ⌘K to search, ⌘J to ask the assistant, [ and ] to move between columns, and Esc to close the last one.",
		src: "RM#1 (6); PS#5 (shortcut list); dev FloatingDock.tsx, ColumnCanvas.tsx, QuickReplyBar.tsx",
	},
	{
		id: "set-aside",
		title: "Set Aside",
		status: "planned",
		body: "A second pile next to Reply Later, for mail you need to keep handy, like tickets or a document you’re waiting on.",
		src: "RM#1 (4)",
	},
	{
		id: "export",
		title: "Export a mailbox from Settings",
		status: "planned",
		body: "One button to download any mailbox, a personal address included, as .mbox.",
		src: "RM#1 (7)",
	},
];

export const comingNext: ComingNext[] = allComingNext.filter((c) => !c.hidden).map(({ hidden: _, ...c }) => c);

// The landing callout under "Today and next" (tone="next", icon="private").
// null once private email is on dev: the feature joins "And the rest" instead.
export const privateEmailCallout: CalloutCopy | null = flags.privateEmailShipped
	? null
	: {
			id: "private-email-callout",
			title: "Private email, for every sign-up form.",
			body: `Make a fresh address for each site you sign up to. Mail to it reaches your mailbox, though a site’s first email waits in the Screener like any new sender, and your replies go out from that address, so your real one stays yours. Pause or delete any of them, up to 1,000 per mailbox. AutoFill on iPhone${flags.androidPublic ? " and Android" : ""} and a Chrome extension follow soon after. [What’s coming next →](/roadmap#next)`,
			status: "next",
			claim: "roadmap",
			src: "RM#1 (1); FC#7 (apex aliases, From enforced, cap 1,000, iOS AutoFill, Chrome pairing); dev index.ts (no Screener bypass for alias mail); d5df670 and extension/manifest.json (AutoFill and extension not yet distributable)",
		};
