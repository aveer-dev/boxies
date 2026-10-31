// Plans, the price rule, the worked example, the compare table and limits
// (§4.2), plus the landing's pricing brief (§4.1 L9).
//
// One thing is paid today: a domain registered through Inboxies. With
// `domainPurchaseLive` off, every $20 surface drops out here (the third plan,
// its compare column, the brief row), so no page has to check the flag for data.
// Prices are "no charge today", never "free forever": the owner hasn't said
// how long either free tier lasts (§10 Q2–Q3).
import { IOS_STATUS, SIGN_UP_URL, flags, primaryCta } from "../config";
import type { BriefRow, CompareGroup, Plan, PlanCompare, PriceBreakdown, RecordRow } from "./types";

// "The web app and the iPhone beta"; the platform list follows the flags.
function appsLine(): string {
	const parts = flags.webAppPublic ? ["The web app"] : [];
	if (IOS_STATUS === "testflight") parts.push("the iPhone beta");
	if (IOS_STATUS === "appstore") parts.push("the iPhone app");
	if (flags.androidPublic) parts.push("Android");
	const line = parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
	return line.charAt(0).toUpperCase() + line.slice(1);
}

// Every plan starts in the web app's sign-up; while the web app isn't public,
// the iPhone beta stands in for all three.
const signUp = (label: string, variant: "primary" | "secondary"): Plan["cta"] =>
	flags.webAppPublic ? { label, href: SIGN_UP_URL, variant } : { label: primaryCta().label, href: primaryCta().href, variant };

const allPlans: Plan[] = [
	{
		id: "personal",
		name: "Personal",
		badge: "Start here",
		audience: "One person, one calm address.",
		price: "$0",
		unit: "no charge today",
		cta: signUp("Get started — free", "primary"),
		includes: [
			"you@inboxies.email",
			"The Screener, Reply Later, Promotions and Updates",
			"Ask AI, drafting replies you approve",
			"Gmail-style search that reads every word",
			...(appsLine() ? [appsLine()] : []),
		],
		footnote: "Pick a username, a password and a backup email. No card.",
		src: "PS#2; FSW#personal-address; FSW#headline-features; FSW#ai-email-agent; FSW#search; FC#4.1 (four steps, no payment step); D1 (sign-up starts at /login)",
		ownerConfirm: "personal address stays free long-term",
	},
	{
		id: "own-domain",
		name: "Your domain",
		audience: "A domain you already own.",
		price: "$0",
		unit: "no charge today",
		cta: signUp("Connect a domain", "secondary"),
		leadIn: "Everything in Personal, and:",
		includes: [
			"you@yourdomain, after a quick ownership check",
			"Email set up for you",
			"Email health check and one-click fix",
			"Team mailboxes, invites, and addresses like hello@",
			"Export every mailbox on the domain",
		],
		footnote: "You make two quick changes where you bought the domain, and Inboxies looks after its settings from then on. You keep renewing it there.",
		src: "PS#2 (no charge in code; full zone move); PS#5 (DNS setup); dev ca531c6 (TXT proof before the zone); FSW#custom-domains; FSW#domain-admin-console; FSW#domain-aliases; FSW#leave-anytime; cloudflare-client.ts createZone (zone in the operator's account)",
		ownerConfirm: "connecting your own domain stays free",
	},
	{
		id: "registered",
		name: "A domain we register",
		audience: "A new domain, set up end to end.",
		price: "$20",
		unit: "per year",
		cta: signUp("Find a domain", "secondary"),
		leadIn: "Everything in Your domain, and:",
		includes: [
			"A year of registration at the wholesale price",
			"Required domain fees, and your contact details kept private",
			"Domain settings, secure connections and email set up for you",
			"Your first mailbox, ready after checkout",
			"The transfer code, whenever you want it",
		],
		footnote: "For domains that cost $15 or less wholesale. Pricier domains are wholesale + $10 a year. You see the exact price before you pay.",
		hidden: !flags.domainPurchaseLive,
		src: "PS#1 (what the subscription includes; rule, live Cloudflare price wins); PS#3 (webhook registers, creates zone, mailbox); PS#5 (EPP); FC#9",
	},
];

/** Two plans when domain purchase is off, three when it's live. */
export const plans: Plan[] = allPlans.filter((p) => !p.hidden);

// "How the price works". No per-domain price list: the fallback table in code
// can disagree with the registrar's live prices, so the page states the rule.
export const priceRule: RecordRow[] = [
	{ label: "Domains that cost $15 or less wholesale", value: "$20 a year in total", src: "PS#1 (computeDomainPricing)" },
	{ label: "Domains that cost more", value: "wholesale + $10 a year", src: "PS#1 (computeDomainPricing)" },
	{ label: "Where the wholesale price comes from", value: "the registrar’s live price when you search, or our copy of its price list if that lookup fails", src: "PS#1 (live Cloudflare price); cloudflare-registrar.ts (TLD_WHOLESALE_PRICING fallback)" },
	{ label: "When you see the total", value: "before you pay", src: "PS#1; PS#3" },
	{ label: "How you pay", value: "by card at checkout, once a year", src: "PS#1 (interval year, USD); PS#3" },
];

// "Where the $20 goes": a .com at $10.44 wholesale (the case the pricing
// tests assert). The platform share is whatever's left of $20, so it moves
// with the domain; above $15 wholesale it's a flat $10.
export const breakdown: PriceBreakdown = {
	lines: [
		{
			label: "Domain registration",
			detail: "at the wholesale price, with the required domain fees and your contact details kept private",
			amount: "$10.44",
			src: "PS#1 (tests assert .com 20.00 = 10.44 + 9.56)",
		},
		{
			label: "Inboxies platform",
			detail: "the assistant, sync and search, storage, domain setup and mail delivery",
			amount: "$9.56",
			src: "PS#1 (platform share = 20 − domain fee)",
		},
	],
	total: { label: "Per year", amount: "$20.00", src: "PS#1" },
	note: "Example: a .com with a wholesale price of $10.44. The two lines always add up to $20 when the wholesale price is $15 or less, so the platform share changes with the domain. Above $15, the platform share is a flat $10. Checkout shows the exact split for your domain.",
	src: "PS#1 (tests assert .com 20.00 = 10.44 + 9.56; platform share = 20 − domain fee; flat $10 above $15)",
	ownerConfirm: "native fallbacks still say 10.46 when the API sends no price (RootView.swift:1262, MailboxOnboardingView.kt:1259); the web reads domainFeeUsd on dev",
};

// "What's included". `true` renders "Yes", `false` renders "—" (read as "Not
// included"). Values are listed for all three plans and trimmed to the
// visible plans below.
const iphoneCell: string | boolean | null = IOS_STATUS === "testflight" ? "Beta" : IOS_STATUS === "appstore" ? true : null;

const compareGroups: CompareGroup[] = [
	{
		label: "Mail",
		rows: [
			{ label: "Address", values: ["you@inboxies.email", "you@yourdomain", "you@yourdomain"], src: "PS#2" },
			{ label: "Screener, New and Seen, Reply Later", values: [true, true, true], src: "FSW#headline-features" },
			{ label: "Promotions, Updates and Spam", values: [true, true, true], src: "FSW#smart-sorting; dev 31c58c6 (header sorting for senders without a chosen destination; accepted senders filed where you chose)" },
			{ label: "Gmail-style search", values: [true, true, true], src: "FSW#search" },
			{ label: "Filters", values: ["50", "50", "50"], src: "PS#4" },
			{ label: "Auto-reply", values: [true, true, true], src: "FSW#supporting-features (vacation auto-reply)" },
			{
				label: "Forwarding",
				values: ["On request", "On request", "On request"],
				src: "FSW#supporting-features; RM#2; D3 (destination must be verified in Email Routing; no in-app verification)",
				ownerConfirm: "support adds forwarding destinations by hand",
			},
			...(flags.privateEmailShipped
				? [{ label: "Private email addresses", values: ["1,000", "1,000", "1,000"], src: "dev fc74b93 (MAX_ALIASES_PER_MAILBOX = 1000; on the mailbox's own domain, so @inboxies.email on Personal)" }]
				: []),
		],
	},
	{
		label: "Assistant",
		rows: [
			{ label: "Ask AI", values: [true, true, true], src: "FSW#ai-email-agent" },
			...(flags.autoDraftsFromDayOne
				? [{ label: "Draft replies as mail arrives", values: [true, true, true], src: "PR #49 / b7895d9 on dev; index.ts auto-draft gate (no plan check)" }]
				: []),
		],
	},
	{
		label: "People",
		rows: [
			{ label: "More than one mailbox", values: [true, true, true], src: "RM#2 (multiple accounts)" },
			{ label: "Share a mailbox", values: [true, true, true], src: "FSW#shared-mailboxes" },
			{ label: "Team mailboxes and invites", values: [false, true, true], src: "FSW#domain-admin-console" },
			{ label: "hello@ and support@ addresses", values: [false, true, true], src: "FSW#domain-aliases" },
		],
	},
	{
		label: "Domain",
		rows: [
			{ label: "Email set up for you", values: [false, "after two quick changes", true], src: "PS#5 (DNS setup)" },
			{ label: "Domain health check and settings", values: [false, true, true], src: "FSW#custom-domains" },
			{ label: "Contact details kept private", values: [false, "from your registrar", "Included"], src: "PS#1" },
			{ label: "Transfer code", values: [false, "from your registrar", true], src: "PS#5 (EPP for domains bought through Inboxies)" },
			{ label: "Export every mailbox on the domain", values: [false, true, true], src: "FSW#leave-anytime" },
		],
	},
	{
		label: "Apps",
		rows: [
			...(flags.webAppPublic ? [{ label: "Web app", values: [true, true, true], src: "FSW (scope)" }] : []),
			...(iphoneCell === null ? [] : [{ label: "iPhone app", values: [iphoneCell, iphoneCell, iphoneCell], src: "FC#8.5" }]),
			...(flags.androidPublic ? [{ label: "Android app", values: [true, true, true], src: "FC#1; FC#8.5" }] : []),
		],
	},
];

const planCount = plans.length;

export const compare: PlanCompare = {
	caption: "What’s included in each plan",
	columns: [
		{ name: "Personal", price: "$0", src: "PS#2" },
		{ name: "Your domain", price: "$0", src: "PS#2" },
		{ name: "Registered domain", price: "$20/yr*", src: "PS#1" },
	].slice(0, planCount),
	groups: compareGroups.map((g) => ({ ...g, rows: g.rows.map((r) => ({ ...r, values: r.values.slice(0, planCount) })) })),
	footnote: flags.domainPurchaseLive ? "* When the domain’s wholesale price is $15 or less. Otherwise wholesale + $10 a year." : undefined,
	src: "PS#1; PS#2",
};

// Limits: the same on every plan, per mailbox.
export const limits: RecordRow[] = [
	{ label: "Sending", value: "100 recipients an hour, 300 a day", src: "AVE-125 b04d196: workers/lib/send-quota.ts SEND_QUOTA_RECIPIENTS_PER_HOUR 100, _PER_DAY 300 (rolling, counted per recipient)" },
	{ label: "Recipients per message", value: "50, across To, Cc and Bcc", src: "AVE-125: shared/outbound-limits.ts MAX_RECIPIENTS_PER_MESSAGE" },
	{ label: "Outgoing message", value: "5 MB including attachments; photos are resized to fit, videos can’t be attached", src: "PS#4 (hard limits); FC#4.6" },
	{ label: "Incoming message", value: "25 MB", src: "PS#4 (hard limits)" },
	{ label: "Filters", value: "50", src: "PS#4 (hard limits)" },
	{ label: "Auto-reply", value: "once per sender every 24 hours", src: "PS#4 (hard limits)" },
	{ label: "Ask AI", value: "50 chats a day", src: "workers/lib/ai-quota.ts AI_DAILY_LIMITS (AVE-45: free tier for everyone, per mailbox, UTC day)" },
	{
		label: "AI on incoming mail",
		value: "200 spam checks and drafts a day; past that, mail is still sorted, without them",
		src: "workers/lib/ai-quota.ts (inbound bucket 200; over quota falls back to rules-only classification, no auto-draft)",
	},
	{
		label: "Storage",
		value: "no quota is set today",
		src: "PS#4 (\"Storage quota: None in code\")",
		ownerConfirm: "no storage quota planned near-term",
	},
];

// The landing's three pricing rows; prices render in ink.
const allBrief: (BriefRow & { hidden?: boolean })[] = [
	{
		id: "personal",
		title: "A personal address",
		href: "/pricing",
		meta: "$0",
		description: "you@inboxies.email, with the Screener, Reply Later and Ask AI. No charge today.",
		src: "PS#2",
	},
	{
		id: "own-domain",
		title: "A domain you own",
		href: "/pricing",
		meta: "$0",
		description: "Bring it along and the email records are written for you. No charge today.",
		src: "PS#2 (connect a domain: no charge in code)",
	},
	{
		id: "registered",
		title: "A domain we register",
		href: "/pricing#how-pricing-works",
		meta: "$20/yr",
		description: "The domain, private contact details, setup, the platform and the assistant in one yearly price when the domain costs $15 or less wholesale. Pricier domains are wholesale + $10 a year.",
		hidden: !flags.domainPurchaseLive,
		src: "PS#1 (computeDomainPricing)",
	},
];

export const brief: BriefRow[] = allBrief.filter((r) => !r.hidden).map(({ hidden: _, ...r }) => r);
