// Every answer on /support (§4.4 S4, nine groups) and the billing questions
// on /pricing (§4.2 P6). Answers are Blocks: a string is a paragraph of
// markdown-lite ([text](href), `code`); { list }, { table } and { records }
// render as their own elements. `id` is the <details id>, so the landing,
// the chips and links like /support#forgot-password open the right answer.
//
// Answers a flag hides are dropped here, so counts ("5 answers") and search
// only ever see what's on the page.
//
// Left out on purpose: "Is my mail used to train AI?" (it depends on Cloudflare's
// AI terms, §10 Q11), and any refund or renewal-price answer until the
// owner writes those policies (§10 Q4).
//
// No stack names: the site sells the product, so answers say what happens to
// your mail, not which services do it (Cloudflare is named only where someone
// needs it to judge where their mail lives). The exception is the last group,
// For developers, where every answer is claim "dev".
import { APP_HOST, APP_STORE_URL, APP_URL, GITHUB_URL, IOS_BETA_MAILTO, IOS_STATUS, SIGN_UP_URL, SUPPORT_EMAIL, TESTFLIGHT_URL, flags } from "../config";
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
		a: ["There’s no charge for it today. You make two quick changes where you bought the domain, Inboxies sets up its email, and you keep renewing the domain there. [Step by step](/support#connect-domain)."],
		src: "PS#2; PS#5 (DNS setup); cloudflare-client.ts createZone (zone in the operator's account); dev ca531c6 domain-verification.ts, onboarding.ts (428 until the TXT is found)",
		ownerConfirm: "BYO domain stays free",
	},
	{
		id: "what-20-covers",
		group: "billing",
		q: "What does the $20 a year cover?",
		a: ["Two things on one yearly bill. The domain: a year of registration at the wholesale price, with the required domain fees and your contact details kept private. And the platform: the assistant, sync and search, storage, domain setup, mail delivery, and spam and spoofing protection."],
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
		a: ["No. Domains are billed once a year, in US dollars."],
		hidden: !flags.domainPurchaseLive,
		src: "PS#1 (interval year, USD); PS#3",
	},
	{
		id: "cancel",
		group: "billing",
		q: "How do I cancel?",
		a: [`A domain admin can cancel from the domain’s Subscription card in Admin on the web: Manage billing opens the billing page, where you can also change the card and see invoices. Cancelling stops the next renewal, and the domain keeps working until the paid year ends. You can also write to ${MAIL_US} from the address on your account.`],
		hidden: !flags.domainPurchaseLive,
		src: "DomainSubscriptionCard.tsx ManageBillingButton (Stripe billing portal: card, invoices, cancel); routes/billing.ts:602-630; legal.ts terms-billing",
		ownerConfirm: "REQUIRED — confirm the manual process and what happens to the domain",
	},
	{
		id: "transfer",
		group: "billing",
		q: "Can I move my domain somewhere else?",
		a: ["Yes, if Inboxies registered it. In Admin, a domain admin can export every mailbox to .mbox, unlock the domain and reveal its transfer code for your new registrar. A domain you connected stays where you bought it; to leave, you just point it somewhere else."],
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
		a: ["Storage isn’t capped today. Ask AI allows 50 chats a day per mailbox, and the AI spam check and drafts on incoming mail run up to 200 times a day; past that, mail is still sorted, just without them. The other limits are about sending and message size, and they’re listed above."],
		src: "PS#4 (no storage quota); workers/lib/ai-quota.ts AI_DAILY_LIMITS (AVE-45: chat 50, inbound 200 per mailbox per UTC day; over quota → rules-only, no auto-draft)",
		ownerConfirm: "no storage quota planned near-term (§10 Q14)",
	},
	{
		id: "more-mailboxes",
		group: "billing",
		q: "Do extra mailboxes on my domain cost more?",
		a: ["Not today. There’s no charge per mailbox."],
		src: "PS#1 (\"no per-domain cap on mailboxes\")",
		ownerConfirm: "no per-mailbox charge today (§10 Q14)",
	},
]);

// ── /support · Answers ──

// The iPhone line in "Which apps are there?", by status. null when the app isn't shown.
function iphoneAppLine(): string | null {
	if (IOS_STATUS === "appstore" && APP_STORE_URL) return `An iPhone app for iOS 17 and later, on the [App Store](${APP_STORE_URL}). It runs on iPad too, with the list and the message side by side.`;
	if (IOS_STATUS === "testflight") {
		const invite = TESTFLIGHT_URL ? `[join the beta](${TESTFLIGHT_URL})` : `[ask for an invite](${IOS_BETA_MAILTO})`;
		return `An iPhone app for iOS 17 and later, in beta on TestFlight: ${invite}. It runs on iPad too, with the list and the message side by side.`;
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
		a: ["Every new mailbox starts with three short guides. They come from welcome@, agent@ and security@ on your own domain, and they’re automated, so don’t reply to them. Some of what they describe isn’t there yet: j, k and / among the web keyboard shortcuts they list (the rest work), a signature editor in web Settings, and an export button in Settings. All three are on the [roadmap](/roadmap)."],
		src: "PS#5 (other support facts); RM#5 (welcome-email overclaims); dev welcome-emails.ts (shortcut table and ? overlay, Settings → Email Signature, Settings → Export Mailbox; its /mcp section is true since MCP OAuth shipped, #152); FloatingDock.tsx (C, ⌘K); onboarding.ts (those usernames aren't reserved)",
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
		a: ["Mail from a first-time sender goes to the Screener, not your Inbox. Accept the sender, and their mail is sorted into Inbox, Promotions or Updates by its headers; accept into Promotions or Updates to keep it there. Decline, and their mail is filed in Screened out. Mail in the Screener never notifies you, never gets an assistant draft and never gets your auto-reply, but if you forward your mail, a copy still goes out. Mail you’ve screened out is never forwarded or auto-replied to. The sender isn’t told."],
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
		a: ["Yes. Every mailbox starts with it on, and the Screener switch in Settings turns it off. New senders’ mail is then sorted like everyone else’s, and spam and senders you’ve screened out still go to Spam. Mail already waiting in the Screener moves to your Inbox. Turn it back on and new senders are screened again from then on."],
		src: "AVE-104 a9fead1: SettingsColumns.tsx ScreenerToggle (\"First-time senders go to your Inbox. Spam and blocked senders are still filtered.\"), SettingsSheetView.swift / .kt screener toggle; MailboxDO.releaseScreenerToInbox on on→off; back on screens only new mail; workers/index.ts honours settings.screener.enabled",
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
		a: ["In this order: spam, then senders you’ve screened out, then the Screener for anyone new, then your filters, then the place you chose for the sender, when you accepted them into Promotions or Updates or in Settings → Senders. If you never chose one, as with people you’ve emailed or accepted with a plain Accept, the email is sorted by its headers: mailing-list mail goes to Promotions, or to Updates when it’s a receipt, an alert or an automatic reply, and everything else goes to Inbox. Spam is mail with spam headers, personal mail that fails sender checks, or mail the AI spam check flags. The AI check alone can’t send mail to Spam from someone you’ve accepted, emailed or given a place, as long as it passes sender checks. If the AI check can’t run, the mail is treated as not spam, so nothing is lost."],
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
		q: "Can Reply Later remind me?",
		a: ["Yes. Choose Remind me… in a thread’s actions, or Add reminder right after you add it to Reply Later, and pick later today, tomorrow, next week, or a date and time up to a year ahead. When it’s due, the thread is marked unread and comes back to the top of your Inbox if you’d filed it away, and it stays in Reply Later. Your phone gets a notification; on the web, Reply Later shows what’s due. Nothing is hidden while you wait."],
		src: "AVE-86 409d1b4: workers/lib/reply-later-reminders.ts, durableObject/index.ts (unread, refile to Inbox from Archive/Promotions/Updates/tags, top of New, one push); useEmailMenu.ts / EmailActionsSheet.swift / .kt \"Remind me…\"; toast \"Add reminder\"; max one year ahead",
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
			"Yes. Press ? to see them all. On a selected email or the open message: C writes a new message, R replies, A replies to all, F forwards, E archives, # deletes, U marks read or unread, S stars and L adds it to Reply Later. ⌘K jumps to search, [ and ] move between columns, Esc closes the right-most one, and ⌘J opens the assistant; in an open message it drafts a reply. ⌘↵ sends a quick reply and ⇧⌘O moves it into the full composer. On Windows and Linux, use Ctrl for ⌘. Gmail-style j and k aren’t built yet; they’re on the [roadmap](/roadmap).",
		],
		src: "AVE-28 1e535a7: app/lib/shortcuts.ts SHORTCUTS, ShortcutSheet.tsx (? overlay), useListShortcuts.ts / EmailPanel.tsx (focused row or open message); QuickReplyBar.tsx (⌘J, ⌘↵, ⇧⌘O); no j/k or / handler; RM#1 (6)",
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
				(flags.webAppPublic ? " The web app has no undo, but Delete there moves mail to Trash, so you can move it back within 30 days." : ""),
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
			"Settings → Forwarding sends a copy of every incoming email to another address, and keeps the original. That includes mail waiting in the Screener, but not spam or mail you’ve screened out. Filters can forward only some mail. The address has to be verified first: write to support and we’ll add it, then that address gets an email with a link to confirm. Until it’s confirmed, nothing is forwarded to it.",
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
		a: ["No. Ask AI saves drafts, and sending is always your tap. The one exception is your choice: an AI tool you [connect](#ai-tools) and allow to send can send from the mailboxes you picked for it."],
		src: "FSW#ai-email-agent (\"only drafts and never sends\"); mcp/scopes.ts (send_email, send_reply need the send scope); shared/mcp-consent.ts (mailbox picker)",
	},
	{
		id: "ai-reads",
		group: "ai-topic",
		q: "What does the assistant read?",
		a: [
			"Personal mail that its headers don’t already settle is checked for spam by a small model, which reads the sender, the subject and the first 2,000 characters. The assistant reads your mail when you ask it something in Ask AI. " +
				(flags.autoDraftsFromDayOne
					? "When personal mail addressed to you lands in your Inbox from a sender you’ve let in, it also reads that email and its thread to prepare a draft reply for you to review."
					: "On some mailboxes it may also read new personal mail to prepare a draft reply for you to review; that doesn’t run on brand-new mailboxes yet."),
			"On the web, opening a longer message also has a small model write a short summary of it. The assistant never drafts for newsletters, notifications or other automated mail, no-reply senders, mail you were only Bcc’d on, spoofed senders, or anything outside your Inbox, including the Screener, Spam, Promotions and Updates, or for mail a filter tells it to skip. Before any such draft, the message, its subject and the rest of the thread are checked for prompt injection. A new draft only replaces the assistant’s own earlier draft, never one you wrote. You can’t switch the assistant off for a mailbox yet.",
		],
		src: "PS#5 (AI data handling: 2,000 chars; auto-draft on ham); classify-email.ts (model only when classifyFromHeaders returns null; spam vs ham only); FSW#auto-drafted-replies (skips; injection scan); dev b7895d9/PR #49 (auto-drafts on new mailboxes); cb0b217 (agent/index.ts subject + thread scan; tools.ts draft source agent, deleteSiblingDrafts onlySource agent; sender-triage.ts filedAway skip); J (gate auto-draft wording)",
	},
	{
		id: "ai-models",
		group: "ai-topic",
		q: "Is my mail sent to an outside AI company?",
		a: ["No. The assistant and the spam check run on Cloudflare, the same network that stores your mail. Inboxies doesn’t call any other AI company’s API. An AI app you [connect](#ai-tools) yourself reads only the mailboxes you pick for it."],
		src: "PS#5 (models); classify-email.ts, ai.ts (Workers AI only: spam check, injection scan, draft verifier); model names dropped from the site 29 Oct 2026",
	},
	{
		id: "ai-off",
		group: "ai-topic",
		q: "Can I turn the AI off?",
		a: ["There’s no off switch per mailbox yet. To stop drafts for particular senders, lists or subjects, add a filter with “Skip auto-draft”, or one that moves their mail out of your Inbox."],
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
		id: "ai-tools",
		group: "ai-topic",
		q: "Can I connect my own AI tools?",
		a: ["Yes. AI apps such as Claude and Cursor can connect to your mail. When one asks, you choose which mailboxes it may use and what it can do: read, write drafts, send or organize. Settings → Devices lists the apps you’ve connected, and you can disconnect any of them there. Setup is under [For developers](#mcp)."],
		src: "AVE-67/68/69/70 on main since #152: mcp/oauth.ts (OAuth 2.1, DCR + PKCE), shared/mcp-consent.ts (scopes, mailbox picker), mcp/scopes.ts, SessionsSettings.tsx (Settings → Devices → Connected apps, Disconnect); wrangler.jsonc OAUTH_KV bound in prod",
	},
];

const domains: Faq[] = [
	{
		id: "connect-domain",
		group: "domains-topic",
		q: "How do I connect a domain I already own?",
		a: [
			`Start setup ${flags.webAppPublic ? "on the web or in the app" : "in the app"}, choose Custom Domain, then “I already own it”. First, show the domain is yours: Inboxies gives you a TXT record named _inboxies-verify.yourdomain to add where your DNS lives today, and you continue once it’s published. Then you’ll get two nameservers to set at your registrar, which moves the domain’s DNS to Inboxies. Inboxies writes your email records right away, and they take effect once the nameservers switch. Admin → DNS checks those records whenever you open it, and Fix Email DNS repairs anything that drifts.`,
		],
		src: "PS#5 (DNS setup); FSW#custom-domains; FC#4.1; onboarding.ts (createZone then ensureFullEmailDns at once; no scheduled check); cloudflare-client.ts createZone (operator's account); dev ca531c6 domain-verification.ts (_inboxies-verify TXT), onboarding.ts / domain-dns.ts (428 until found)",
	},
	{
		id: "dns-records",
		group: "domains-topic",
		q: "Will my website and other records keep working?",
		a: ["The whole domain’s DNS moves to Inboxies, which then manages all of its records, your website’s included. Check that the records your website and other services need are in the new zone. The DNS editor in Admin handles A, AAAA, CNAME, TXT, MX and NS records. If you leave, point the nameservers somewhere else."],
		src: "FSW#custom-domains; PS#2 (full zone move); cloudflare-client.ts createZone (operator's account); AdminDnsSuite.tsx RECORD_TYPES (no SRV)",
	},
	{
		id: "register-domain",
		group: "domains-topic",
		q: "How does registering a new domain work?",
		a: ["Choose Custom Domain and search for a name to see whether it’s free and what it costs per year. Pay at checkout, and the domain is registered with WHOIS privacy. Its email records and your first mailbox are set up as soon as the payment goes through."],
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
					...(IOS_STATUS !== "hidden" ? ["On iPhone: Sign in with Apple, Google, a passkey, or your email and password."] : []),
					...(flags.webAppPublic ? ["On the web: your email and password, Google, Sign in with Apple, or a passkey."] : []),
					...(flags.androidPublic ? ["On Android: Google, a passkey, or your email and password."] : []),
				],
			},
			"If you’ve turned on two-step verification, signing in with a password also asks for your code; a passkey doesn’t. Signing in with Apple or Google doesn’t create a mailbox by itself; choose Get started to make one.",
		],
		src: "FC#2; FC#8.3; PS#5 (Apple/Google don't auto-create a mailbox); SignInView.swift (Apple, Google, passkey, password); app/routes/login.tsx (password, Google, Apple, passkey); SignInView.kt (Google, passkey, password; Apple hidden, AVE-130); AVE-74..77 (passkeys, 2FA; passkey skips 2FA)",
	},
	{
		id: "sign-in-methods",
		group: "account-topic",
		q: "Can I use more than one way to sign in?",
		a: ["Yes. Settings → Sign-in & recovery shows how you can sign in. There you can add or remove passkeys, set or change a password, connect Google, and connect Apple on iPhone." + (flags.webAppPublic ? " Two-step verification with an authenticator app, and its backup codes, are set up there on the web." : "")],
		src: "SettingsSheetView.swift / .kt Sign-in & recovery; SignInSettings.tsx, TwoFactorSection.tsx (2FA setup web only); account.ts link codes return 410 (removed); AVE-74..77",
	},
	{
		// Codes go only to the verified recovery email (workers/auth/otp.ts),
		// last 15 minutes with 5 tries, and a reset revokes every session
		// (routes/account.ts password/forgot, password/reset).
		id: "forgot-password",
		group: "account-topic",
		q: "I forgot my password.",
		a: ["Choose Forgot password? on the sign-in screen and enter your email. If your account has a password and a confirmed recovery email, we send a 6-digit code and a link to that recovery email: the code works for 15 minutes and the link for an hour. Enter the code with the email you sign in with, or open the link. Five wrong tries cancel a code, so ask for a new one. Resetting your password signs you out everywhere. Nothing is sent to your Inboxies mailbox, so add a recovery email in Settings → Sign-in & recovery before you need it. Accounts that only use Apple, Google or a passkey have no password to reset."],
		src: "workers/routes/account.ts /api/v1/auth/password/forgot (verifiedRecoveryEmail only; OTP 15 min, link RESET_LINK_TTL_MS 1 h) and /reset (revokeUserSessions); workers/auth/otp.ts (password-reset: never a mailbox; MAX_ATTEMPTS 5)",
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
			`To delete your account, go to Settings → Account → Delete account in the iPhone app${flags.androidPublic ? " or the Android app" : ""}${flags.webAppPublic ? ", or Settings → Your account → Delete account on the web" : ""}. You need to have signed in within the last few minutes, so you may be asked to sign in again first. Mailboxes where you’re the only owner are erased with all their mail, even for people you shared them with. From mailboxes that have other owners, you’re just removed. Your sign-in methods go too, and it can’t be undone.${flags.domainPurchaseLive ? ` Deleting your account doesn’t stop a domain’s yearly bill; write to ${MAIL_US} for that.` : ""}`,
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
		a: ["On Cloudflare’s network. Each mailbox has its own database for messages and search, kept apart from every other mailbox. Full messages and attachments sit in separate file storage on the same network."],
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
		a: ["You, and the owners and members you share the mailbox with. On a custom domain, its domain admins can export every mailbox on it and reassign any mailbox, including to themselves. Because mail isn’t end-to-end encrypted, the service that runs Inboxies can technically access stored mail too. An AI app you connect can read the mailboxes you picked for it."],
		src: "PS#5 (\"The operator can technically read the mail\"; per-mailbox ACLs); mcp/scopes.ts (read always granted), shared/mcp-consent.ts (mailbox picker); J (OS omission fixed); admin-invites.ts (assign to self, ACL rewrite); export-and-offboarding.ts (domain export)",
		ownerConfirm: "wording; add the access policy once written",
	},
	{
		id: "tracking",
		group: "data-topic",
		q: "Does Inboxies block tracking pixels?",
		a: ["Only in Spam. Tracking pixels live in remote images, and outside Spam those load when you open a message, so a sender can tell you opened it. In Spam they stay hidden until you choose Load images on that message. Inboxies doesn’t send read receipts."],
		src: "dev AVE-132 (#168: shared/remote-images.ts, EmailIframe.tsx; EmailHTMLSanitizer.swift / EmailHtmlSanitizer.kt blocksRemoteImages, folder_id == spam); a new Spam message starts blocked; RM#3 (read receipts)",
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
					["Largest message you send", "5 MB, attachments included"],
					["Largest message you receive", "25 MB"],
					["Sending", "100 recipients an hour, 300 a day per mailbox"],
					["Recipients per message", "50, across To, Cc and Bcc"],
					["Ask AI", "50 chats a day per mailbox"],
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

// For developers: the code, MCP and running your own copy. Every answer is
// claim "dev", the only place the site names the license or Cloudflare's
// products (30 Oct 2026: open source again, but not a selling point).
const developers: Faq[] = [
	{
		id: "open-source",
		group: "developers-topic",
		q: "Is Inboxies open source?",
		claim: "dev",
		a: [`Yes. The code is on [GitHub](${GITHUB_URL}) under the Apache License 2.0. The license covers the code; the Inboxies name and logo aren’t part of it.`],
		src: "LICENSE; gh repo view aveer-dev/boxies (public, apache-2.0, not a fork, 30 Oct 2026); legal.ts terms-open-source",
		ownerConfirm: "trademark line",
	},
	{
		id: "mcp",
		group: "developers-topic",
		q: "How do I connect an MCP client?",
		claim: "dev",
		a: [
			`Add \`${APP_URL}/mcp\` as a remote MCP server in Claude, Cursor or any client that signs in with OAuth. Signing in opens a consent page where you pick the mailboxes it can use and what it may do:`,
			{
				list: [
					"Read mail, always on: mailboxes, folders, messages and threads, and search",
					"Write drafts: create and edit them, without sending",
					"Send mail: new messages and replies",
					"Organize mail: mark read or unread, move, delete, and allow or block senders",
				],
			},
			"The client sees only the tools its permissions cover, 15 in all. Deleting moves mail to Trash first, as in the apps. Settings → Devices lists connected apps, and Disconnect revokes one.",
		],
		src: "wrangler.jsonc APP_BASE_URL https://inboxies.app; app.ts EmailMCP.serve(\"/mcp\"); mcp/oauth.ts (DCR + PKCE S256); shared/mcp-consent.ts MCP_SCOPE_COPY; mcp/scopes.ts MCP_TOOL_SCOPES (15 tools, read always granted); tools.ts toolDeleteEmail (Trash first); SessionsSettings.tsx; all on main since #152",
	},
	{
		id: "self-host",
		group: "developers-topic",
		q: "Can I run my own copy?",
		claim: "dev",
		a: [
			`Yes, on your own Cloudflare account. Clone [the repository](${GITHUB_URL}); its README lists what to create before you deploy. It runs on Cloudflare Workers, with Durable Objects and R2 for storage, Email Routing and Email Service for mail, and Workers AI for the assistant. Cloudflare bills you for what it uses, and Inboxies charges nothing.`,
			"Your copy is yours to run: its mail and accounts stay in your account, and we can’t reach them. The iPhone app connects only to Inboxies, so your copy is used from the web.",
		],
		src: "PS#7; README.md (deploy steps, required resources); AppConfig.swift (release builds default to inboxies.email; server field is DEBUG-only in SignInView)",
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
	{ id: "developers-topic", title: "For developers", items: visible(developers), src: "CT#2.3 (support topics); PS#7" },
];
