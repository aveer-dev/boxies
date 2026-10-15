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
import { APP_HOST, APP_STORE_URL, GITHUB_URL, IOS_BETA_MAILTO, IOS_STATUS, SIGN_UP_URL, SUPPORT_EMAIL, TESTFLIGHT_URL, flags } from "../config";
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
		src: "PS#2",
		ownerConfirm: "long-term free",
	},
	{
		id: "free-domain",
		group: "billing",
		q: "Is connecting my own domain free?",
		a: ["There’s no charge for it today. You add one TXT record to show the domain is yours, point its nameservers at a Cloudflare zone that Inboxies runs, Inboxies writes the email records, and you keep renewing the domain with your registrar."],
		src: "PS#2; PS#5 (DNS setup); cloudflare-client.ts createZone (zone in the operator's account); dev ca531c6 domain-verification.ts, onboarding.ts (428 until the TXT is found)",
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
		a: [`A domain admin can cancel from the domain’s Subscription card in Admin on the web: Manage billing opens Stripe, where you can also change the card and see invoices. Cancelling stops the next renewal, and the domain keeps working until the paid year ends. You can also write to ${MAIL_US} from the address on your account.`],
		hidden: !flags.domainPurchaseLive,
		src: "DomainSubscriptionCard.tsx ManageBillingButton (Stripe billing portal: card, invoices, cancel); routes/billing.ts:602-630; legal.ts terms-billing",
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
			(flags.webAppPublic ? `Open [${APP_HOST}](${SIGN_UP_URL}) and choose Get started` : "In the iPhone app, tap Get started") +
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
					...(flags.webAppPublic ? [`The web app at ${APP_HOST}, in any modern browser.`] : []),
					...(iphoneAppLine() ? [iphoneAppLine() as string] : []),
					flags.androidPublic
						? "An Android app for Android 14 and later, on Google Play."
						: "An Android app with most of the same features is coming soon.",
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
		a: ["Every new mailbox starts with three short guides. They come from welcome@, agent@ and security@ on your own domain, and they’re automated, so don’t reply to them. Some of what they describe isn’t there yet: most of the web keyboard shortcuts they list (C to compose and ⌘K to search work today), a signature editor in web Settings, an export button in Settings, and connecting an AI tool over MCP, which works only on self-hosted installs. The shortcuts, the signature editor and the export button are on the [roadmap](/roadmap)."],
		src: "PS#5 (other support facts); RM#5 (welcome-email overclaims); dev welcome-emails.ts (shortcut table and ? overlay, Settings → Email Signature, Settings → Export Mailbox, /mcp; only change on dev is destination_folder_id null); FloatingDock.tsx (C, ⌘K); onboarding.ts (those usernames aren't reserved)",
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
		a: ["Mail from a first-time sender goes to the Screener, not your Inbox. Accept the sender and choose where their mail goes: Inbox, Promotions or Updates. Decline, and their mail is filed in Screened out. Mail in the Screener never notifies you, never gets an assistant draft and never gets your auto-reply, but if you forward your mail, a copy still goes out. Mail you’ve screened out is never forwarded or auto-replied to. The sender isn’t told."],
		src: "FSW#the-screener; FC#4.3 (\"screen them out privately\"); dev cb0b217 sender-triage.ts resolveInboundFolder (unknown: skipPush/skipAutoDraft/skipAutoReply, skipForward false; rejected: skips forwarding too)",
	},
	{
		id: "screener-skip",
		group: "sorting-topic",
		q: "Who skips the Screener?",
		a: ["Anyone you’ve emailed, and senders already in your mail when the Screener started. Until you choose a place for one of them, their mail is sorted by its headers ([how](#sorting)). Filters can’t let a new sender skip it."],
		src: "FSW#the-screener; FSW#filters (\"filters cannot bypass the Screener\"); dev 31c58c6 sender-triage.ts allowOutboundRecipients / buildBootstrapAllowSeeds (no destination), migration 25_sender_triage_auto_destination",
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
		a: ["In this order: spam, then senders you’ve screened out, then the Screener for anyone new, then your filters, then the place you chose for the sender, when you accepted them or in Settings → Senders. If you never chose one, as with people you’ve emailed, the email is sorted by its headers: mailing-list mail goes to Promotions, or to Updates when it’s a receipt, an alert or an automatic reply, and everything else goes to Inbox. Spam is mail with spam headers, personal mail that fails sender checks, or mail a Workers AI model flags. The model alone can’t send mail to Spam from someone you’ve accepted, emailed or given a place, as long as it passes their domain’s SPF, DKIM or DMARC check. If the model can’t be reached, the mail is treated as not spam, so nothing is lost."],
		src: "dev sender-triage.ts resolveInboundFolder (spam → rejected → unknown → filter → sender preference → explicit destination → classifier folder → Inbox; 31c58c6, PR #56); classify-email.ts (spam headers; Auto-Submitted / List-* / Precedence → Updates or Promotions; spoof check; Llama spam/ham; fail-open to ham); d19cd72 (PR #64): overrideAiSpamForVouchedSender (reason ai-spam only, auth.aligned), isVouchedSender",
	},
	{
		id: "senders",
		group: "sorting-topic",
		q: "How do I always send a sender somewhere?",
		a: ["Move one of their emails to Inbox, Promotions or Updates and choose “Yes, for this sender”. Their earlier mail moves too. To change or remove these choices, go to Settings → Senders. Remove one, and that sender’s new mail is sorted by its headers again."],
		src: "FSW#sender-destinations; FC#4.3; dev 31c58c6 index.ts DELETE sender-preferences clears the triage destination; settings-senders.tsx (\"future mail uses the default sorter again\")",
	},
	{
		id: "filters",
		group: "sorting-topic",
		q: "How do filters work?",
		a: ["Each mailbox can have up to 50 rules, set by its owners. A rule matches a sender (an exact address, an @domain or part of an address), a mailing list, or words in the subject. It can then move the email to a folder, forward it, or tell the assistant not to draft a reply. Mail a rule moves anywhere other than Inbox, Promotions or Updates doesn’t notify you or get a draft. The first matching rule wins. A spoofed sender never matches a sender rule."],
		src: "FSW#filters; PS#4; dev cb0b217: sender-triage.ts (filedAway → skipPush, skipAutoDraft); index.ts ownerOnlyKeys (forwarding, autoReply, filters, agentSystemPrompt → 403 for members)",
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
		// Names unbuilt shortcuts and uses "keyboard shortcuts", so it sits in the roadmap wrapper.
		id: "shortcuts",
		group: "everyday-topic",
		q: "Are there keyboard shortcuts on the web?",
		claim: "roadmap",
		hidden: !flags.webAppPublic,
		a: [
			"A few. The web app opens your mailboxes, folders, the list and the message as columns side by side. C starts a new message, ⌘K jumps to search, [ and ] move between columns, and Esc closes the right-most one. In an open message, ⌘J asks the assistant to draft a reply, ⌘↵ sends the quick reply and ⇧⌘O moves it into the full composer. On Windows and Linux, use Ctrl for ⌘. Gmail-style j and k, r for reply and a ? list aren’t built yet; they’re on the [roadmap](/roadmap).",
		],
		src: "dev 87720b1 (#53): FloatingDock.tsx (C, ⌘K; metaKey || ctrlKey), ColumnCanvas.tsx ([ ], Esc → closeDeepest), QuickReplyBar.tsx (⌘J, ⌘↵, ⇧⌘O); RM#1 (6)",
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
				(flags.webAppPublic ? " The web app has no undo, but Delete there moves mail to Trash, so you can move it back." : ""),
		],
		src: "FC#4.4; RM#2 (undo send iOS only); J (no undo on web); dev email-list.tsx (outside Trash, delete moves to Trash); cb0b217 trashOrDeleteEmail",
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
		a: ["Notifications show the sender, the subject and a preview, and tapping one opens that email. Mail held in the Screener, sent to Spam, or moved by a filter somewhere other than Inbox, Promotions or Updates never notifies you. You can turn notifications off in Settings."],
		src: "FC#4.10; FSW#supporting-features (push); dev cb0b217 sender-triage.ts (skipPush: filedAway)",
	},
	{
		id: "forwarding",
		group: "everyday-topic",
		q: "How do forwarding and auto-reply work?",
		a: [
			"Settings → Forwarding sends a copy of every incoming email to another address, and keeps the original. That includes mail waiting in the Screener, but not spam or mail you’ve screened out. Filters can forward only some mail. The address has to be verified in Cloudflare Email Routing first: on inboxies.email, write to support and we’ll add it, then Cloudflare emails it a link to confirm. On a self-hosted install, add it in your own Cloudflare account. Until the address is verified, nothing is forwarded to it.",
			"Settings → Auto-reply sends your away message at most once per sender every 24 hours, and never to mailing lists, bulk mail, no-reply addresses, other auto-replies or anyone still in the Screener. Mail sent to hello@ or another address on your domain gets its reply from that address" +
				(flags.privateEmailShipped ? ", and mail sent to a private email address gets none." : ".") +
				" Only a mailbox’s owners can change forwarding, auto-reply and filters.",
		],
		src: "FSW#supporting-features (forwarding, vacation auto-reply); D3: index.ts applyInboundForward (message.forward needs a verified Email Routing destination; failures only logged; unchanged on dev); settings-forwarding.tsx; mail-automations.ts shouldForward (no spam); dev sender-triage.ts (unknown: skipForward false, skipAutoReply true; rejected: both skipped); alias-utils.ts autoReplySender (domain aliases reply as themselves; private emails never); index.ts ownerOnlyKeys",
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
		a: ["It can search your mail, read threads, summarise, draft replies and new emails, mark mail read, and move it to a folder. It shows each step as it works. In the iPhone app you can keep several conversations" + (flags.webAppPublic ? "; the web app has one, and ⌘J in an open message asks it to draft a reply." : ".")],
		src: "FSW#ai-email-agent; FC#4.8; FSW#caveats (5: one chat on web); dev QuickReplyBar.tsx (⌘J / AI Assist prefills a reply request)",
	},
	{
		id: "ai-sending",
		group: "ai-topic",
		q: "Can the assistant send email for me?",
		a: ["No. Ask AI saves drafts, and sending is always your tap. One exception, and it’s your choice: on a self-hosted install, an outside AI tool you connect over MCP acts with your access, including sending and deleting mail. Only connect tools you trust."],
		src: "FSW#ai-email-agent (\"only drafts and never sends\"); FSW#mcp-server (send_reply, send_email, delete_email); D3 (MCP self-hosted only; MCPPanel.tsx and /mcp auth unchanged on dev); dev tools.ts toolDeleteEmail (to Trash first, cb0b217)",
	},
	{
		id: "ai-reads",
		group: "ai-topic",
		q: "What does the assistant read?",
		a: [
			"Personal mail that its headers don’t already settle is checked for spam by a small model, which reads the sender, the subject and the first 2,000 characters. The assistant reads your mail when you ask it something in Ask AI. " +
				(flags.autoDraftsFromDayOne
					? "When personal mail arrives from a sender you’ve let in, it also reads that email and its thread to prepare a draft reply for you to review."
					: "On some mailboxes it may also read new personal mail to prepare a draft reply for you to review; that doesn’t run on brand-new mailboxes yet."),
			"It never drafts for mail in the Screener, Spam, bulk mail or spoofed senders, or for mail a filter files away or tells it to skip. Before any such draft, the message, its subject and the rest of the thread are checked for prompt injection. A new draft only replaces the assistant’s own earlier draft, never one you wrote. You can’t switch the assistant off for a mailbox yet.",
		],
		src: "PS#5 (AI data handling: 2,000 chars; auto-draft on ham); classify-email.ts (model only when classifyFromHeaders returns null; spam vs ham only); FSW#auto-drafted-replies (skips; injection scan); dev b7895d9/PR #49 (auto-drafts on new mailboxes); cb0b217 (agent/index.ts subject + thread scan; tools.ts draft source agent, deleteSiblingDrafts onlySource agent; sender-triage.ts filedAway skip); J (gate auto-draft wording)",
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
		a: ["There’s no off switch per mailbox yet. To stop drafts for particular senders, lists or subjects, add a filter with “Skip auto-draft”, or one that moves their mail out of Inbox, Promotions and Updates."],
		src: "PS#5 (\"no per-user switch to turn AI off\"); FSW#filters; settings-filters.tsx (label “Skip auto-draft”); dev sender-triage.ts (skipAutoDraft || filedAway); no auto-draft setting in dev app/, ios/, android/",
	},
	{
		id: "ai-prompt",
		group: "ai-topic",
		q: "Can I change how it writes?",
		a: ["Yes. A mailbox’s owners set its instructions in Settings → AI prompt: tone, sign-off, what to leave alone. Reset to default puts it back."],
		src: "FC#4.8; dev cb0b217 index.ts ownerOnlyKeys (agentSystemPrompt)",
	},
	{
		id: "mcp",
		group: "ai-topic",
		q: "Can I use my mailbox from Claude Code or Cursor?",
		a: ["On a self-hosted install, yes. Inboxies has an MCP server with 13 tools for listing, reading, searching, drafting, sending, moving, marking and deleting mail, and it uses the same permissions you have. Deleting moves mail to Trash first, as in the apps. The MCP panel in the web app shows the server address. On inboxies.email there’s no way to give an outside tool access yet; [scoped keys](/roadmap) for that are being explored."],
		src: "FSW#mcp-server; dev mcp/index.ts (13 tools incl. delete_email); dev tools.ts toolDeleteEmail → trashOrDeleteEmail (cb0b217); D3: MCPPanel.tsx (server URL only, unchanged on dev); app.ts (/mcp needs Access or a session token)",
	},
];

const domains: Faq[] = [
	{
		id: "connect-domain",
		group: "domains-topic",
		q: "How do I connect a domain I already own?",
		a: [
			`Start setup ${flags.webAppPublic ? "on the web or in the app" : "in the app"}, choose Custom Domain, then “I already own it”. First, show the domain is yours: Inboxies gives you a TXT record named _inboxies-verify.yourdomain to add where your DNS lives today, and you continue once it’s published. Then you’ll get two Cloudflare nameservers to set at your registrar, which moves the domain’s DNS to a Cloudflare zone that Inboxies runs. Inboxies writes the MX, SPF and DMARC records into that zone right away, and they take effect once the nameservers switch. Admin → DNS checks MX, SPF, DKIM and DMARC whenever you open it, and Fix Email DNS repairs anything that drifts.`,
		],
		src: "PS#5 (DNS setup); FSW#custom-domains; FC#4.1; onboarding.ts (createZone then ensureFullEmailDns at once; no scheduled check); cloudflare-client.ts createZone (operator's account); dev ca531c6 domain-verification.ts (_inboxies-verify TXT), onboarding.ts / domain-dns.ts (428 until found)",
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
		a: ["Choose Custom Domain and search for a name to see whether it’s free and what it costs per year. Pay through Stripe, and the domain is registered through Cloudflare Registrar with WHOIS privacy. Its email records and your first mailbox are set up once Stripe confirms the payment."],
		hidden: !flags.domainPurchaseLive,
		src: "FSW#buy-a-domain; PS#3; dev billing.ts (fulfils only on paid / no_payment_required, deduplicated; 272d53b, ca531c6)",
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
		a: ["Yes. Each mailbox has owners, who manage access, forwarding, auto-reply, filters and the AI prompt, and members, who use it. Add people from the mailbox’s Sharing settings. Nobody shares a password."],
		src: "FSW#shared-mailboxes; dev cb0b217 index.ts ownerOnlyKeys",
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
		// Codes are bound to the account, capped at 5 tries and 5 issues an hour,
		// and a reset revokes older password sessions (a85c07e, ca531c6).
		id: "forgot-password",
		group: "account-topic",
		q: "I forgot my password.",
		a: ["Choose Forgot password? on the sign-in screen and enter your email. We send a 6-digit code and a link, both valid for an hour, to your backup email and your mailbox. Enter the code with that same email, or open the link. Five wrong tries cancel a code, so ask for a new one. Resetting your password signs you out everywhere else you signed in with it. Set a backup email: if you’re locked out, the copy sent to your Inboxies mailbox won’t help. Accounts that only use Apple sign-in have no password to reset."],
		src: "PS#5 (password reset); dev password-reset.ts (1 h, 5 attempts, 5 issues per window); admin-invites.ts (email required with the code; tokenVersion bump revokes password sessions); app.ts passwordSessionIsCurrent",
	},
	{
		id: "mailboxes",
		group: "account-topic",
		q: "Can I have more than one mailbox?",
		a: [
			"Yes. In the iPhone app, tap your avatar and choose Add another email. Switch between mailboxes from the same menu, and choose which one you’re writing from in compose." +
				(flags.webAppPublic ? " On the web, switch from the first column on the left, or from the Mailboxes page." : ""),
		],
		src: "FC#4.1; HomeShellView.swift (Add another email); home.tsx (Mailboxes page; no From picker in web compose); dev AccountsColumn.tsx (mailbox column)",
	},
	{
		id: "delete",
		group: "account-topic",
		q: "How do I delete a mailbox or my account?",
		a: [
			`Owners can delete a mailbox in Settings → Delete email in the iPhone app${flags.webAppPublic ? ", or from the mailbox list on the web" : ""}. It’s permanent: messages, attachments and assistant history are erased.`,
			`To delete your account, go to Settings → Account → Delete account in the iPhone app${flags.androidPublic ? " or the Android app" : ""}${flags.webAppPublic ? ", or Settings → Delete account on the web" : ""}. Mailboxes where you’re the only owner are erased with all their mail, even for people you shared them with. From mailboxes that have other owners, you’re just removed. Your sign-in methods go too, and it can’t be undone.${flags.domainPurchaseLive ? ` Deleting your account doesn’t stop a domain’s yearly bill; write to ${MAIL_US} for that.` : ""}`,
		],
		src: "PS#5 (deleting a mailbox); dev eda481f + cb0b217: index.ts DELETE /api/v1/me (sole owner → purgeMailboxAndAgents; else removed from the ACL; deleteIdentityAccountData; no Stripe call); SettingsSheetView.swift / .kt (Account → Delete account); app/components/settings/pages.tsx:102-107 + DeleteAccountSettings.tsx (web)",
		ownerConfirm: "what happens to a registered domain's subscription and registration when its owner deletes their account",
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
		a: ["It holds back remote images, which is where tracking pixels live. In every message they stay hidden until you choose Load images, so a sender can’t tell you opened the message before then. Once you load them, they can. Inboxies doesn’t send read receipts."],
		src: "dev 061e0ea EmailIframe.tsx (CSP img-src blocks remote until Load images; a new message starts blocked); eda481f EmailHTMLSanitizer.swift remoteImagesBlockedPolicy, EmailBodyView.kt allowRemoteImages; RM#3 (read receipts)",
	},
	{
		id: "export",
		group: "data-topic",
		q: "How do I export my mail?",
		claim: "roadmap",
		a: ["Domain admins can export every mailbox on a domain from Admin → Export (.mbox). Only that domain’s admins can download it, and the download is kept for 7 days. The file opens in Apple Mail, Thunderbird and other mail apps. A one-tap export for a single mailbox, a personal address included, is planned."],
		src: "PS#5 (exporting mail); RM#1 (7); dev export-and-offboarding.ts loadAuthorizedExportJob + 410 after expiresAt (d024650, ca531c6); email-exporter.ts SEVEN_DAYS_MS; exportMailbox has no caller in any client",
	},
	{
		id: "leave",
		group: "data-topic",
		q: "How do I move my domain somewhere else?",
		a: [`Export your mail first, from Admin → Export. Then choose Move DNS / Offboard in Admin: Inboxies stops taking mail for the domain, and it asks for a whole-domain export from the past 7 days unless you choose to skip it. For a domain Inboxies registered, unlock it for transfer and reveal the transfer (EPP) code for your new registrar. For a domain you connected, change its nameservers at your registrar. For billing, write to ${MAIL_US}.`],
		src: "PS#5 (leaving / offboarding); dev export-and-offboarding.ts (recent-export guard unless skipExportAcknowledged; disableCatchAllRule; unlock + EPP); email-exporter.ts hasRecentExportForDomain (domain-wide, 7 days); AdminDnsSuite.tsx / DomainAdminDNSView.swift (Move DNS / Offboard); 4811793 (#47), cb0b217",
	},
	{
		id: "delete-data",
		group: "data-topic",
		q: "What happens when I delete a mailbox?",
		a: [
			`Its database, stored messages, raw files, attachments and assistant chat history are erased${flags.privateEmailShipped ? ", and its private email addresses stop working" : ""}. This can’t be undone. An .mbox export made earlier isn’t deleted with it, though its download stops working after 7 days.`,
		],
		src: "FSW#supporting-features (purgeMailbox); durableObject purgeMailbox leaves exports/data/* in R2 (email-exporter.ts); dev cb0b217 purgeMailbox removes the mailbox's aliases and their routes; export expiry (export-and-offboarding.ts 410)",
	},
	{
		id: "private-email",
		group: "data-topic",
		q: "Can I hide my real address when I sign up for things?",
		// Shipped, it's plain copy: no AutoFill or Chrome extension until each can be installed.
		claim: flags.privateEmailShipped ? undefined : "roadmap",
		a: [
			flags.privateEmailShipped
				? "Yes. Settings → Private email makes a random address on your mailbox’s domain that delivers to this mailbox. Give it a label so you know which site has it. When you reply to mail sent to it, the reply goes out from that address, so the site never sees your real one. A site’s first email still waits in the Screener like any new sender, and your auto-reply never answers from a private address. Pause one (its mail is dropped quietly or bounced, your choice), set it to expire, or delete it. Up to 1,000 per mailbox." +
					(flags.iosAutofillInBeta
						? " On iPhone, turn on Inboxies in Settings → General → AutoFill & Passwords. Then choose AutoFill → Inboxies in a sign-up form to make one and fill it in, or on iOS 17 pick Inboxies from the passwords bar and paste the address it copies."
						: "") +
					(flags.androidPublic && flags.iosAutofillInBeta ? " On Android, choose Inboxies as your autofill service and it offers one in email fields." : "") +
					(flags.chromeExtensionPublic ? " In Chrome, the Inboxies extension puts a Private email button next to sign-up email fields." : "") +
					(!flags.iosAutofillInBeta || !flags.chromeExtensionPublic ? " Making one right inside a sign-up form is [on the way](/roadmap#next-private-email-autofill)." : "")
				: "Not yet. You may already see Private email in Settings, but addresses made there don’t receive mail yet, so don’t use them for sign-ups. The working version arrives in the next release: a fresh address for each sign-up, which you can reply from without revealing your own, then pause or delete. AutoFill on iPhone and a Chrome extension follow after it.",
		],
		src: "PR #46 on dev: fc74b93 (apex aliases on the mailbox's domain, cap 1,000, alias-sender.ts replies from the alias, pausedAction drop|reject, autoReplySender skips private emails); index.ts resolveInboundFolder (no Screener bypass); settings-aliases.tsx (label, expiry, pause); AliasesSettingsView.swift:76 (AutoFill & Passwords path); d5df670, c0d5002, 1afa7e3 (AutoFill and extension, behind iosAutofillInBeta / chromeExtensionPublic)",
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
					["Password reset code", "1 hour and 5 tries; up to 5 codes an hour"],
				],
			},
		],
		src: "PS#4; dev password-reset.ts (1 h TTL, 5 attempts, 5 issues per window)",
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
 * the answer count is `items.length` (5 · 8 · 11 · 7 · 6 · 5 · 9 · 3 with the
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
