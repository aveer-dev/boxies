// Every answer on /support (§4.4 S4, nine groups) and the billing questions
// on /pricing (§4.2 P6). Answers are Blocks: a string is a paragraph of
// markdown-lite ([text](href), `code`); { list }, { table } and { records }
// render as their own elements. `id` is the <details id>, so the landing,
// the chips and links like /support#forgot-password open the right answer.
//
// Answers a flag hides are dropped here, so counts ("5 answers") and search
// only ever see what's on the page.
//
// Left out on purpose: "Is my mail used to train AI?" (it depends on Cloudflare
// Workers AI terms, §10 Q11), and any refund or renewal-price answer until the
// owner writes those policies (§10 Q4).
import { APP_STORE_URL, GITHUB_URL, IOS_BETA_MAILTO, IOS_STATUS, SIGN_UP_URL, SUPPORT_EMAIL, TESTFLIGHT_URL, flags } from "../config";
import type { Faq, FaqGroup } from "./types";

const MAIL_US = `[${SUPPORT_EMAIL}](mailto:${SUPPORT_EMAIL})`;
const visible = (items: Faq[]) => items.filter((f) => !f.hidden);

// ── /pricing · Questions & answers ──

export const billing: Faq[] = visible([
	{
		id: "free-personal",
		group: "billing",
		q: "Is the personal address really free?",
		a: ["There’s no payment step and no card, and no charge for it today. You get you@inboxies.email with the Screener, Reply Later, Promotions and Updates, and Ask AI."],
		src: "PS#2; D2 (no automatic sorting claim)",
		ownerConfirm: "long-term free",
	},
	{
		id: "free-domain",
		group: "billing",
		q: "Is connecting my own domain free?",
		a: ["There’s no charge for it today. You point your domain’s nameservers at a Cloudflare zone that Inboxies runs, Inboxies writes the email records, and you keep renewing the domain with your registrar."],
		src: "PS#2; PS#5 (DNS setup); cloudflare-client.ts createZone (zone in the operator's account)",
		ownerConfirm: "BYO domain stays free",
	},
	{
		id: "what-20-covers",
		group: "billing",
		q: "What does the $20 a year cover?",
		a: ["Two things on one yearly bill. The domain: a year of registration through Cloudflare Registrar at the wholesale price, with the ICANN fee and WHOIS privacy. And the platform: the assistant, sync and search, storage, DNS, SSL, Email Routing, and spam protection with SPF, DKIM and DMARC set up for you."],
		hidden: !flags.domainPurchaseLive,
		src: "PS#1 (subscription line items)",
	},
	{
		id: "premium-domains",
		group: "billing",
		q: "Why do some domains cost more?",
		a: ["Some domains cost more than $15 a year wholesale. For those you pay the wholesale price plus $10 a year. You see the exact total before you pay."],
		hidden: !flags.domainPurchaseLive,
		src: "PS#1",
	},
	{
		id: "monthly",
		group: "billing",
		q: "Can I pay monthly?",
		a: ["No. Domains are billed once a year, in US dollars, through Stripe."],
		hidden: !flags.domainPurchaseLive,
		src: "PS#1 (interval year, USD); PS#3",
	},
	{
		id: "cancel",
		group: "billing",
		q: "How do I cancel?",
		a: [`There’s no billing page in the apps yet. Write to ${MAIL_US} from the address on your account and we’ll help.`],
		hidden: !flags.domainPurchaseLive,
		src: "PS#3 (no customer portal, no in-app cancel)",
		ownerConfirm: "REQUIRED — confirm the manual process and what happens to the domain",
	},
	{
		id: "transfer",
		group: "billing",
		q: "Can I move my domain somewhere else?",
		a: ["Yes, if Inboxies registered it. In Admin, a domain admin can export every mailbox to .mbox, unlock the domain and reveal its transfer code for your new registrar. A domain you connected stays with your registrar; you just change its nameservers."],
		src: "PS#5 (leaving / offboarding: EPP for domains bought through Inboxies)",
	},
	{
		id: "ai-cost",
		group: "billing",
		q: "Does the assistant cost extra?",
		a: ["No. Ask AI comes with every address, and there’s no separate AI plan."],
		src: "PS#2 (no billing path other than domains)",
	},
	{
		id: "caps",
		group: "billing",
		q: "Are storage or AI use capped?",
		a: ["No quota is set for storage or AI today. The limits that exist are about sending and message size, and they’re listed above."],
		src: "PS#4",
		ownerConfirm: "no storage or AI quotas planned near-term (§10 Q14)",
	},
	{
		id: "more-mailboxes",
		group: "billing",
		q: "Do extra mailboxes on my domain cost more?",
		a: ["Not today. There’s no charge per mailbox."],
		src: "PS#1 (\"no per-domain cap on mailboxes\")",
		ownerConfirm: "no per-mailbox charge today (§10 Q14)",
	},
	{
		id: "self-host-cost",
		group: "billing",
		q: "What does self-hosting cost?",
		a: ["Nothing to us. The code is Apache-2.0. You pay Cloudflare for the Workers, storage, AI and email you use, and you bring your own domain."],
		src: "PS#7",
	},
]);

// ── /support · Answers ──

// The iPhone line in "Which apps are there?", by status. null when the app isn't shown.
function iphoneAppLine(): string | null {
	if (IOS_STATUS === "appstore" && APP_STORE_URL) return `An iPhone app for iOS 17 and later, on the [App Store](${APP_STORE_URL}). There’s no iPad version.`;
	if (IOS_STATUS === "testflight") {
		const invite = TESTFLIGHT_URL ? `[join the beta](${TESTFLIGHT_URL})` : `[ask for an invite](${IOS_BETA_MAILTO})`;
		return `An iPhone app for iOS 17 and later, in beta on TestFlight: ${invite}. There’s no iPad version.`;
	}
	return null;
}

const gettingStarted: Faq[] = [
	{
		id: "get-address",
		group: "getting-started",
		q: "How do I get an @inboxies.email address?",
		a: [
			(flags.webAppPublic ? `Open [inboxies.email](${SIGN_UP_URL}) and choose Get started` : "In the iPhone app, tap Get started") +
				", then Personal Address. Pick your name, a password of at least 10 characters, a backup email and a username. There’s no payment step." +
				(flags.webAppPublic && IOS_STATUS !== "hidden" ? " Or tap Get started in the iPhone app." : ""),
		],
		src: "FC#4.1; FSW#personal-address; PS#4 (password 10–200); D1 (the web sign-up lives at /login)",
	},
	{
		id: "apps",
		group: "getting-started",
		q: "Which apps are there?",
		claim: "negated",
		a: [
			{
				list: [
					...(flags.webAppPublic ? ["The web app at inboxies.email, in any modern browser."] : []),
					...(iphoneAppLine() ? [iphoneAppLine() as string] : []),
					flags.androidPublic
						? "An Android app for Android 14 and later, on Google Play."
						: "There’s also an Android app with most of the same features. It isn’t publicly available.",
				],
			},
		],
		src: "FC#1 (iOS 17+, iPhone only; Android 14+); FC#8.5 (TestFlight, no store listing; Android versionName 0.1.0); FC#2 (Android lacks offline, on-device search, undo send, Apple sign-in)",
	},
	{
		id: "first-email",
		group: "getting-started",
		q: "What happens to email from someone new?",
		a: ["It waits in the Screener. You decide whether that sender reaches your Inbox, Promotions or Updates, or is screened out. People you’ve emailed are let through automatically. [How the Screener works](#screener)."],
		src: "FSW#the-screener",
	},
	{
		id: "welcome-emails",
		group: "getting-started",
		q: "Why are there three emails in my new mailbox?",
		claim: "roadmap",
		a: ["Every new mailbox starts with three short guides. They come from welcome@, agent@ and security@ on your own domain, and they’re automated, so don’t reply to them. A few things the guides mention, like web keyboard shortcuts and an export button in Settings, aren’t built yet; they’re on the [roadmap](/roadmap)."],
		src: "PS#5 (other support facts); RM#5 (welcome-email overclaims); welcome-emails.ts (senders); onboarding.ts (those usernames aren't reserved)",
	},
	{
		id: "not-imap",
		group: "getting-started",
		q: "Can I add my Gmail or Outlook account?",
		a: ["No. Inboxies hosts its own mailboxes and doesn’t connect to outside accounts over IMAP."],
		src: "RM#2 (multiple accounts: no outside Gmail or IMAP)",
	},
];

const sorting: Faq[] = [
	{
		id: "screener",
		group: "sorting-topic",
		q: "How does the Screener work?",
		a: ["Mail from a first-time sender goes to the Screener, not your Inbox. Accept the sender and choose where their mail goes: Inbox, Promotions or Updates. Decline, and their mail is filed in Screened out. Screened mail never notifies you, never gets an assistant draft, and is never forwarded or auto-replied to. The sender isn’t told."],
		src: "FSW#the-screener; FC#4.3 (\"screen them out privately\")",
	},
	{
		id: "screener-skip",
		group: "sorting-topic",
		q: "Who skips the Screener?",
		a: ["Anyone you’ve emailed, and senders already in your mail when the Screener started. Filters can’t let a new sender skip it."],
		src: "FSW#the-screener; FSW#filters (\"filters cannot bypass the Screener\")",
	},
	{
		id: "screener-off",
		group: "sorting-topic",
		q: "Can I turn the Screener off?",
		a: ["Not yet. It’s on for every mailbox, and there’s no switch in the apps today."],
		src: "FSW#the-screener (no client switch)",
	},
	{
		id: "new-and-seen",
		group: "sorting-topic",
		q: "What are New and Seen?",
		a: ["Your Inbox has two parts. New holds threads you haven’t opened, and Seen holds the rest. Opening a thread moves it to Seen."],
		src: "FSW#supporting-features (New vs Seen)",
	},
	{
		id: "sorting",
		group: "sorting-topic",
		q: "How does Inboxies decide where an email goes?",
		a: ["In this order: spam, then senders you’ve screened out, then the Screener for anyone new, then your filters, then the sender’s destination. That’s the place you chose when you accepted them or in Settings → Senders, and Inbox if you didn’t choose. Spam is mail with spam headers, personal mail that fails sender checks, or mail a Workers AI model flags. If that model can’t be reached, the mail is treated as not spam, so nothing is lost."],
		src: "D2: sender-triage.ts resolveInboundFolder (spam → rejected → unknown → filter → sender preference → triage destination, Inbox by default; classifier folder used only with the Screener off); classify-email.ts (spam headers, spoof check, Llama spam/ham, fail-open to ham)",
	},
	{
		id: "senders",
		group: "sorting-topic",
		q: "How do I always send a sender somewhere?",
		a: ["Move one of their emails to Inbox, Promotions or Updates and choose “Yes, for this sender”. Their earlier mail moves too. To change or remove these choices, go to Settings → Senders."],
		src: "FSW#sender-destinations; FC#4.3",
	},
	{
		id: "filters",
		group: "sorting-topic",
		q: "How do filters work?",
		a: ["Each mailbox can have up to 50 rules. A rule matches a sender (an exact address, an @domain or part of an address), a mailing list, or words in the subject. It can then move the email to a folder, forward it, or tell the assistant not to draft a reply. The first matching rule wins. A spoofed sender never matches a sender rule."],
		src: "FSW#filters; PS#4",
	},
	{
		id: "spoofed",
		group: "sorting-topic",
		q: "Why is an email marked Spoofed?",
		a: ["Its From address didn’t pass SPF, DKIM or DMARC alignment, so it may not be who it says it is. Spoofed personal mail goes to Spam. Any spoofed message is flagged, never gets an assistant draft, and is ignored by sender filters."],
		src: "FSW#spoofing-protection; classify-email.ts classifyFromHeaders (list and auto-submitted mail is classed before the spoof check)",
	},
];

const everyday: Faq[] = [
	{
		id: "reply-later",
		group: "everyday-topic",
		q: "What’s Reply Later?",
		a: [`A pile for emails that need an answer. Mark a thread Reply Later from its actions and it shows up in the pile with a count. When you reply, it leaves the pile on its own.${flags.webAppPublic ? " On the web, Focus & Reply opens each thread with a reply ready, and you can skip as you go." : ""} Search \`is:reply-later\` to find them too.`],
		src: "FSW#reply-later; FC#4.3; RM#3 (Focus & Reply web only)",
	},
	{
		id: "reply-later-timer",
		group: "everyday-topic",
		q: "Does Reply Later bring mail back at a set time?",
		a: ["No. It’s a pile, not a timer. A thread stays there until you reply or take it off."],
		src: "RM#2",
	},
	{
		id: "search",
		group: "everyday-topic",
		q: "Which search operators work?",
		a: [
			// First column renders as <code>; operators that share a row are space-separated.
			{
				table: [
					["from:", "mail from a name or address"],
					["to:", "mail to an address"],
					["subject:", "words in the subject"],
					["in:inbox in:sent", "mail in a folder"],
					["is:unread is:read", "by read state"],
					["is:starred is:unstarred", "by star"],
					["is:reply-later", "your Reply Later pile"],
					["has:attachment", "mail with files"],
					["before:2026-09-01 after:2026-09-01", "by date"],
					['from:"Jordan Hale"', "quotes for names and phrases"],
				],
			},
			"Search covers subjects, people and the whole message body. On iPhone, results from your phone appear first.",
		],
		src: "FSW#search; FC#4.7; durableObject searchEmails (to: matches recipient, cc and bcc addresses)",
	},
	{
		id: "compose",
		group: "everyday-topic",
		q: "Can I put a draft aside while I check something?",
		a: [
			`${flags.androidPublic ? "In the iPhone and Android apps" : "In the iPhone app"}, swipe the message you’re writing down and it docks at the bottom of the screen. Tap the dock to keep going. Drafts save a few seconds after you stop typing.`,
		],
		src: "FC#4.6",
	},
	{
		id: "undo",
		group: "everyday-topic",
		q: "Can I undo?",
		a: [
			(flags.androidPublic
				? "In the iPhone and Android apps, delete, archive and move wait about five seconds for Undo. On iPhone you can also shake to undo, and sending gets a short undo window."
				: "In the iPhone app, delete, archive and move wait about five seconds for Undo, and you can shake to undo. Sending gets a short undo window too.") +
				(flags.webAppPublic ? " The web app has no undo." : ""),
		],
		src: "FC#4.4; RM#2 (undo send iOS only); J (no undo on web)",
	},
	{
		id: "swipes",
		group: "everyday-topic",
		q: "Can I change what swipes do?",
		a: ["Yes. Settings → Swipe settings lets you put up to three actions on each edge, with a live preview. A full swipe runs the first one."],
		src: "FC#4.4",
	},
	{
		id: "notifications",
		group: "everyday-topic",
		q: "Which emails send notifications?",
		a: ["Notifications show the sender, the subject and a preview, and tapping one opens that email. Mail held in the Screener or sent to Spam never notifies you. You can turn notifications off in Settings."],
		src: "FC#4.10; FSW#supporting-features (push)",
	},
	{
		id: "forwarding",
		group: "everyday-topic",
		q: "How do forwarding and auto-reply work?",
		a: [
			"Settings → Forwarding sends a copy of every incoming email to another address, and keeps the original. Filters can forward only some mail. The address has to be verified in Cloudflare Email Routing first: on inboxies.email, write to support and we’ll add it, then Cloudflare emails it a link to confirm. On a self-hosted install, add it in your own Cloudflare account. Until the address is verified, nothing is forwarded to it. Spam is never forwarded.",
			"Settings → Auto-reply sends your away message at most once per sender every 24 hours, and never to mailing lists, bulk mail, no-reply addresses or other auto-replies.",
		],
		src: "FSW#supporting-features (forwarding, vacation auto-reply); D3: index.ts applyInboundForward (message.forward needs a verified Email Routing destination; failures only logged); settings-forwarding.tsx; mail-automations.ts shouldForward (no spam)",
		ownerConfirm: "support adds forwarding destinations to the Cloudflare account by hand",
	},
	{
		id: "offline",
		group: "everyday-topic",
		q: "Does it work offline?",
		a: ["In the iPhone app, yes: mail opens from a copy on your phone, search starts from an index on the device, and what you do offline is queued until you’re back." + (flags.webAppPublic ? " The web app needs a connection." : "")],
		src: "FC#4.10; FC#4.7",
	},
	{
		id: "html",
		group: "everyday-topic",
		q: "Is it safe to open HTML email?",
		a: ["Email HTML is cleaned, scripts never run, and messages render in a sandbox. You can view any message’s headers."],
		src: "FSW#supporting-features (safe HTML); FC#4.5; EmailPanelDialogs.tsx and EmailActionsSheet.swift (headers only)",
	},
];

const ai: Faq[] = [
	{
		id: "ask-ai",
		group: "ai-topic",
		q: "What can Ask AI do?",
		a: ["It can search your mail, read threads, summarise, draft replies and new emails, mark mail read, and move it to a folder. It shows each step as it works. In the iPhone app you can keep several conversations" + (flags.webAppPublic ? "; the web app has one." : ".")],
		src: "FSW#ai-email-agent; FC#4.8; FSW#caveats (5: one chat on web)",
	},
	{
		id: "ai-sending",
		group: "ai-topic",
		q: "Can the assistant send email for me?",
		a: ["No. Ask AI saves drafts, and sending is always your tap. One exception, and it’s your choice: on a self-hosted install, an outside AI tool you connect over MCP acts with your access, including sending and permanently deleting mail. Only connect tools you trust."],
		src: "FSW#ai-email-agent (\"only drafts and never sends\"); FSW#mcp-server (send_reply, send_email, delete_email); D3 (MCP self-hosted only)",
	},
	{
		id: "ai-reads",
		group: "ai-topic",
		q: "What does the assistant read?",
		a: [
			"Personal mail that its headers don’t already settle is checked for spam by a small model, which reads the sender, the subject and the first 2,000 characters. The assistant reads your mail when you ask it something in Ask AI. " +
				(flags.autoDraftsFromDayOne
					? "When personal mail arrives, it may also read it to prepare a draft reply for you to review."
					: "On some mailboxes it may also read new personal mail to prepare a draft reply for you to review; that doesn’t run on brand-new mailboxes yet."),
			"It never drafts for mail in the Screener, Spam, bulk mail or spoofed senders, or for senders a filter tells it to skip, and a message is checked for prompt injection before any such draft is made. You can’t switch the assistant off for a mailbox yet.",
		],
		src: "PS#5 (AI data handling: 2,000 chars; auto-draft on ham); classify-email.ts (model only when classifyFromHeaders returns null; spam vs ham only); FSW#auto-drafted-replies (skips; injection scan); FSW#caveats (2: PR #49); J (gate auto-draft wording)",
	},
	{
		id: "ai-models",
		group: "ai-topic",
		q: "Which AI models does it use?",
		a: ["Models that run on Cloudflare Workers AI: Kimi K2.5 for chat and drafts, and Llama models for the spam check, safety checks and tidying drafts. Inboxies doesn’t call any other AI company’s API."],
		src: "PS#5 (models); classify-email.ts, ai.ts (Llama: spam check, injection scan, draft verifier)",
		ownerConfirm: "keep model names",
	},
	{
		id: "ai-off",
		group: "ai-topic",
		q: "Can I turn the AI off?",
		a: ["There’s no off switch per mailbox yet. To stop drafts for particular senders, lists or subjects, add a filter with “Skip auto-draft”."],
		src: "PS#5 (\"no per-user switch to turn AI off\"); FSW#filters; settings-filters.tsx (label “Skip auto-draft”)",
	},
	{
		id: "ai-prompt",
		group: "ai-topic",
		q: "Can I change how it writes?",
		a: ["Yes. Settings → AI prompt sets the instructions for each mailbox: tone, sign-off, what to leave alone. Reset to default puts it back."],
		src: "FC#4.8",
	},
	{
		id: "mcp",
		group: "ai-topic",
		q: "Can I use my mailbox from Claude Code or Cursor?",
		a: ["On a self-hosted install, yes. Inboxies has an MCP server with 13 tools for listing, reading, searching, drafting, sending, moving, marking and permanently deleting mail, and it uses the same permissions you have. The MCP panel in the web app shows the server address. On inboxies.email there’s no way to give an outside tool access yet; [scoped keys](/roadmap) for that are being explored."],
		src: "FSW#mcp-server; mcp/index.ts (13 tools incl. delete_email); D3: MCPPanel.tsx (server URL only); app.ts (/mcp needs Access or a session token)",
	},
];

const domains: Faq[] = [
	{
		id: "connect-domain",
		group: "domains-topic",
		q: "How do I connect a domain I already own?",
		a: [
			`Start setup ${flags.webAppPublic ? "on the web or in the app" : "in the app"}, choose Custom Domain, then “I already own it”. You’ll get two Cloudflare nameservers to set at your registrar, which moves the domain’s DNS to a Cloudflare zone that Inboxies runs. Inboxies writes the MX, SPF and DMARC records into that zone right away, and they take effect once the nameservers switch. Admin → DNS checks MX, SPF, DKIM and DMARC whenever you open it, and Fix Email DNS repairs anything that drifts.`,
		],
		src: "PS#5 (DNS setup); FSW#custom-domains; FC#4.1; onboarding.ts (createZone then ensureFullEmailDns at once; no scheduled check); cloudflare-client.ts createZone (operator's account)",
	},
	{
		id: "dns-records",
		group: "domains-topic",
		q: "Will my website and other records keep working?",
		a: ["The whole domain’s DNS moves to a Cloudflare zone that Inboxies runs, so Inboxies then manages all of its records, your website’s included. Check that the records your website and other services need are in the new zone. The DNS editor in Admin handles A, AAAA, CNAME, TXT, MX and NS records. If you leave, point the nameservers somewhere else."],
		src: "FSW#custom-domains; PS#2 (full zone move); cloudflare-client.ts createZone (operator's account); AdminDnsSuite.tsx RECORD_TYPES (no SRV)",
	},
	{
		id: "register-domain",
		group: "domains-topic",
		q: "How does registering a new domain work?",
		a: ["Choose Custom Domain and search for a name to see whether it’s free and what it costs per year. Pay through Stripe, and the domain is registered through Cloudflare Registrar with WHOIS privacy. Its email records and your first mailbox are set up once checkout completes."],
		hidden: !flags.domainPurchaseLive,
		src: "FSW#buy-a-domain; PS#3",
	},
	{
		id: "teams",
		group: "domains-topic",
		q: "Can I add my team?",
		a: ["Yes. In Domain Admin, create mailboxes on your domain, invite people by email or with a link, hand a mailbox to someone, or take one yourself. Each person sets their own password."],
		src: "FSW#domain-admin-console",
	},
	{
		id: "sharing",
		group: "domains-topic",
		q: "Can more than one person use a mailbox?",
		a: ["Yes. Each mailbox has owners, who manage access, and members, who use it. Add people from the mailbox’s Sharing settings. Nobody shares a password."],
		src: "FSW#shared-mailboxes",
	},
	{
		id: "aliases",
		group: "domains-topic",
		q: "Can hello@ or support@ go to my mailbox?",
		a: ["Yes. While you set up your domain, add addresses such as support@, hello@, sales@, billing@ or info@ and choose the mailbox each one delivers to. Changing them after setup isn’t in the apps yet."],
		src: "FC#4.1 (alias presets); FSW#domain-aliases; FSW#caveats (5: no web UI for aliases after onboarding)",
	},
];

const account: Faq[] = [
	{
		id: "sign-in",
		group: "account-topic",
		q: "How do I sign in?",
		a: [
			{
				list: [
					...(IOS_STATUS !== "hidden" ? ["On iPhone: Sign in with Apple, or your email and password."] : []),
					...(flags.webAppPublic ? ["On the web: your email and password."] : []),
					...(flags.androidPublic ? ["On Android: Google, or your email and password."] : []),
				],
			},
			"Signing in with Apple doesn’t create a mailbox by itself; choose Get started to make one.",
		],
		src: "FC#2; FC#8.3; PS#5 (sign-in methods: Apple/Google don't auto-create a mailbox)",
	},
	{
		id: "sign-in-methods",
		group: "account-topic",
		q: "Can I use more than one way to sign in?",
		a: ["Yes. Settings → Sign-in methods shows what’s connected. From there you can connect Apple on iPhone, set or change a password, or use Link another device: it gives you a code that works for 15 minutes on your other device."],
		src: "FC#4.1; PS#4 (device-link code 15 min); MEDIA (sign-in-methods still)",
	},
	{
		// Launch blocker until reset-code throttling is merged (§10 Q21); the copy stays.
		id: "forgot-password",
		group: "account-topic",
		q: "I forgot my password.",
		a: ["Choose Forgot password? on the sign-in screen. We email a 6-digit code and a link, both valid for an hour, to your backup email and your mailbox. Set a backup email: if you’re locked out, the copy sent to your Inboxies mailbox won’t help. Accounts that only use Apple sign-in have no password to reset."],
		src: "PS#5 (password reset)",
	},
	{
		id: "mailboxes",
		group: "account-topic",
		q: "Can I have more than one mailbox?",
		a: [
			"Yes. In the iPhone app, tap your avatar and choose Add another email. Switch between mailboxes from the same menu, and choose which one you’re writing from in compose." +
				(flags.webAppPublic ? " On the web, pick a mailbox from the Mailboxes page." : ""),
		],
		src: "FC#4.1; HomeShellView.swift (Add another email); home.tsx (Mailboxes page; no From picker in web compose)",
	},
	{
		id: "delete",
		group: "account-topic",
		q: "How do I delete a mailbox or my account?",
		a: [`Owners can delete a mailbox in Settings → Delete email in the iPhone app${flags.webAppPublic ? ", or from the mailbox list on the web" : ""}. It’s permanent: messages, attachments and assistant history are erased. Deleting the account you sign in with isn’t in the apps yet; write to ${MAIL_US} and we’ll help.`],
		src: "PS#5 (deleting a mailbox; no \"delete my account\")",
		ownerConfirm: "REQUIRED — manual account deletion",
	},
];

const data: Faq[] = [
	{
		id: "storage",
		group: "data-topic",
		q: "Where is my mail stored?",
		a: ["On Cloudflare. Each mailbox has its own Durable Object with a SQLite database for messages and search. Full messages and attachments are stored in Cloudflare R2."],
		src: "FSW#per-mailbox-isolation; PS#5",
	},
	{
		id: "encryption",
		group: "data-topic",
		q: "Is my mail encrypted?",
		claim: "negated",
		a: ["Cloudflare encrypts stored data at rest. Inboxies doesn’t add its own end-to-end encryption, so stored mail can be read by the service that runs it, as with most hosted email."],
		src: "PS#5 (privacy of mail at rest)",
		ownerConfirm: "approve wording",
	},
	{
		id: "who-reads",
		group: "data-topic",
		q: "Who can read my mail?",
		claim: "negated",
		a: ["You, and the owners and members you share the mailbox with. On a custom domain, its domain admins can export every mailbox on it and reassign any mailbox, including to themselves. Because mail isn’t end-to-end encrypted, the service that runs Inboxies can technically access stored mail too. An AI tool you connect over MCP can read what you can."],
		src: "PS#5 (\"The operator can technically read the mail\"; per-mailbox ACLs); FSW#mcp-server; J (OS omission fixed); admin-invites.ts (assign to self, ACL rewrite); export-and-offboarding.ts (domain export)",
		ownerConfirm: "wording; add the access policy once written",
	},
	{
		id: "tracking",
		group: "data-topic",
		q: "Does Inboxies block tracking pixels?",
		a: ["No. Remote images load by default, so a sender’s tracking pixel can still report that you opened a message. Inboxies doesn’t send read receipts."],
		src: "RM#3 (spy-pixel blocking not-planned-yet; read receipts)",
	},
	{
		id: "export",
		group: "data-topic",
		q: "How do I export my mail?",
		claim: "roadmap",
		a: ["Domain admins can export every mailbox on a domain from Admin → Export (.mbox). The file opens in Apple Mail, Thunderbird and other mail apps. A one-tap export for a single mailbox, a personal address included, is planned."],
		src: "PS#5 (exporting mail); RM#1 (7); J (no \"7 days\")",
	},
	{
		id: "leave",
		group: "data-topic",
		q: "How do I move my domain somewhere else?",
		a: [`Export your mail first. For a domain Inboxies registered, go to Admin → your domain, unlock it for transfer and reveal the transfer (EPP) code for your new registrar. For a domain you connected, change its nameservers at your registrar. For billing, write to ${MAIL_US}.`],
		src: "PS#5 (leaving / offboarding)",
	},
	{
		id: "delete-data",
		group: "data-topic",
		q: "What happens when I delete a mailbox?",
		a: ["Its database, stored messages, raw files, attachments and assistant chat history are erased. This can’t be undone. An .mbox export made earlier isn’t deleted with it."],
		src: "FSW#supporting-features (purgeMailbox); durableObject purgeMailbox leaves exports/data/* in R2 (email-exporter.ts)",
	},
	{
		id: "private-email",
		group: "data-topic",
		q: "Can I hide my real address when I sign up for things?",
		claim: "roadmap",
		a: [
			flags.privateEmailShipped
				? "Yes. Settings → Private email creates a fresh address that delivers to this mailbox. Replies from it go out as that address, and you can pause it, set it to expire, or delete it. AutoFill on iPhone and the Chrome extension create them right where you type."
				: "Not yet. You may already see Private email in Settings, but addresses made there don’t receive mail yet, so don’t use them for sign-ups. The working version arrives in the next release: a fresh address for each sign-up, which you can reply from without revealing your own, then pause or delete. AutoFill on iPhone and a Chrome extension follow after it.",
		],
		src: "RM#1 (1); FC#7; main: settings/aliases (web), SettingsSheetView.swift (Private email row); alias-utils.ts (token@private.<domain>, not delivered on main per PR #46)",
	},
	{
		id: "limits",
		group: "data-topic",
		q: "What are the limits?",
		a: [
			{
				records: [
					["Largest message you send", "5 MiB, attachments included"],
					["Largest message you receive", "25 MiB"],
					["Sending", "20 an hour, 100 a day per mailbox"],
					["Videos in compose", "not supported"],
					["Filters", "50 per mailbox"],
					["Auto-reply", "once per sender per 24 hours"],
					["Password", "10 to 200 characters"],
					["Username", "2 to 50 characters: letters, numbers, . _ -"],
					["Staying signed in", "30 days"],
				],
			},
		],
		src: "PS#4",
	},
];

const selfHosting: Faq[] = [
	{
		id: "self-host",
		group: "self-host-topic",
		q: "Can I run Inboxies myself?",
		a: [
			`Yes. It’s open source under Apache-2.0 and began as a fork of Cloudflare’s agentic-inbox. Clone [the repository](${GITHUB_URL}), set your domain in \`wrangler.jsonc\`, and deploy to your Cloudflare account. You’ll need:`,
			{
				list: [
					"an R2 bucket",
					"Email Routing with a catch-all to the Worker",
					"Email Service for sending",
					"the email-sending-events queue",
					"Workers AI",
					"Cloudflare Access",
				],
			},
		],
		src: "PS#7; PS#5 (Cloudflare Access required in production)",
	},
	{
		id: "self-host-apps",
		group: "self-host-topic",
		q: "Do the mobile apps work with my server?",
		a: ["No. The iPhone app connects only to inboxies.email, so a self-hosted install is used from the web."],
		src: "PS#7 (release builds locked to inboxies.email; override DEBUG-only); J (no \"build your own\")",
	},
	{
		id: "agentic-inbox",
		group: "self-host-topic",
		q: "Is it the same as Cloudflare’s agentic-inbox?",
		a: ["Inboxies started as a fork of it and has grown past it: the Screener, Reply Later, native apps, custom-domain setup and more. Deploying the original project gives you agentic-inbox, not Inboxies."],
		src: "PS#7 (Deploy button points at upstream)",
	},
];

/**
 * The support page, in order. `id` is the group's anchor (its SectionHead id);
 * the answer count is `items.length` (5 · 8 · 10 · 7 · 6 · 5 · 9 · 3 with the
 * default flags), never typed.
 */
export const supportGroups: FaqGroup[] = [
	{ id: "getting-started", title: "Getting started", items: visible(gettingStarted), src: "CT#2.3 (support topics)" },
	{ id: "sorting-topic", title: "Screener and sorting", items: visible(sorting), src: "CT#2.3 (support topics)" },
	{ id: "everyday-topic", title: "Everyday mail", items: visible(everyday), src: "CT#2.3 (support topics)" },
	{ id: "ai-topic", title: "Ask AI", items: visible(ai), src: "CT#2.3 (support topics)" },
	{ id: "domains-topic", title: "Domains and teams", items: visible(domains), src: "CT#2.3 (support topics)" },
	{ id: "account-topic", title: "Account and sign-in", items: visible(account), src: "CT#2.3 (support topics)" },
	{ id: "data-topic", title: "Your data", items: visible(data), src: "CT#2.3 (support topics)" },
	{ id: "self-host-topic", title: "Self-hosting", items: visible(selfHosting), src: "CT#2.3 (support topics)" },
];
