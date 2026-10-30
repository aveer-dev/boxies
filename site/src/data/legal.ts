// /legal: the privacy policy, the terms of service and the acceptable use
// policy for the hosted service (the web app, @inboxies.email mail, the apps and this site).
// Like every data module, each clause carries `src` (where in the code the
// fact comes from; never rendered) and `ownerConfirm` where the line is a
// policy the owner still has to state or approve (site/README.md, Q18).
//
// The same copy rules as the rest of the site apply: check-claims scans
// /legal too, so encryption lines sit in data-claim="negated" clauses and
// flag-dependent surfaces (Android, AutoFill, the Chrome extension) only
// appear when their flag is on.
import { APP_HOST, GITHUB_URL, SUPPORT_EMAIL, flags } from "../config";
import type { LegalDoc } from "./types";

/** The date these documents last changed. Bump it with any edit to the copy below. */
export const legalUpdated = "2026-10-30";

const MAIL_US = `[${SUPPORT_EMAIL}](mailto:${SUPPORT_EMAIL})`;

// What's in this file that the owner must still confirm before it's binding:
// the operator's legal name and address, governing law, the minimum age,
// the refund line, and the "no sale, no ads" commitments (README Q4, Q9, Q11, Q18).

export const privacy: LegalDoc = {
	id: "privacy",
	title: "Privacy policy",
	lead:
		`This policy explains what Inboxies collects, why, who else handles it, how long it’s kept and what you can do about it. It covers the hosted service (the web app at ${APP_HOST} and mail at @inboxies.email), the Inboxies apps, and this website, inboxies.co. We’ve written it to match how the software actually works today, and we name the gaps rather than paper over them.`,
	src: "workers/, app/, ios/, android/, site/ (fact-finding pass, 14 Oct 2026)",
	clauses: [
		{
			id: "privacy-who",
			title: "Who we are",
			body: [
				`“Inboxies”, “we” and “us” mean the team that runs the hosted Inboxies service and this website. We decide how your data is used, so we’re the controller of it under laws like the GDPR. For anything in this policy, write to ${MAIL_US}.`,
				`Inboxies is open source. If you use an install that someone else runs on their own Cloudflare account, that operator controls your data there and this policy doesn’t apply to it. See [Self-hosted installs](#privacy-self-hosted).`,
			],
			src: "site/src/config.ts SUPPORT_EMAIL; LICENSE (Apache-2.0)",
			ownerConfirm: "legal entity name and postal address of the controller (and an EU/UK representative if needed)",
		},
		{
			id: "privacy-collect",
			title: "What we collect",
			body: [
				"**Your account.** Your username and address, your display name if you give one, a backup email outside Inboxies, and your password, stored only as a salted PBKDF2 hash. If you sign in with Apple or Google, we receive the name, email and profile picture that provider shares, plus an identifier for your account with them.",
				"**Your mail.** Every message you receive and send: senders and recipients, subject, body, attachments, headers and the full raw message, along with drafts, folders, read and starred state, and the results of SPF, DKIM and DMARC checks. That includes mail from people who don’t use Inboxies but write to you.",
				"**What you set up.** Mailbox settings, signature, forwarding and auto-reply, filters, your Screener decisions about senders, Reply Later, private email addresses and their labels, the people you share a mailbox with, and the assistant instructions you write.",
				"**Ask AI.** Your conversations with the assistant and the drafts it prepares.",
				"**Devices and sessions.** For each signed-in session we keep its IP address, browser or device description and expiry. If you allow notifications, we store your device’s push token.",
				"**Domains and payments.** For a custom domain: the domain, its DNS records, who its admins are, and its subscription status. If you buy a domain, Stripe collects your card and billing details; we receive a customer identifier and the payment’s status, never your card number.",
				"**Support.** What you send us by email or through the contact form on this site.",
				"**Security records.** A log of significant account actions, such as an account being deleted or an admin assigning a mailbox, with who did it and when.",
				"We don’t ask for your phone number, and we don’t collect your location, contacts or browsing history.",
			],
			src: "workers/auth/schema.ts (user, session ip/user_agent, account tokens, recovery_email, audit_log); workers/lib/password-auth.ts (PBKDF2-SHA256 100k); workers/durableObject/migrations.ts (emails, attachments, folders, emails_fts, device_tokens, sender_triage, aliases); workers/lib/email-content.ts (raw.eml in R2); workers/auth/mailboxes.ts (settings JSON); workers/routes/onboarding.ts:58-96 (sign-up fields; no phone); workers/routes/billing.ts:336-344 (Stripe metadata)",
		},
		{
			id: "privacy-use",
			title: "How we use it",
			body: [
				{
					list: [
						"To run the service: receive, store, sort, search, display and send your mail, and keep your apps in sync.",
						"To protect you: check incoming mail for spam and spoofing, hold new senders in the Screener, block remote images in Spam until you load them, and limit sign-in attempts and sending.",
						"To run the assistant, as described in [AI and your mail](#privacy-ai).",
						"To notify you about new mail, if you’ve allowed notifications.",
						"To set up and bill custom domains, and to email you about renewals and a domain’s service ending.",
						"To send account email: sign-in and reset codes, invitations and backup-email checks.",
						"To answer you when you write to us, and to investigate abuse or a security problem.",
						"To meet legal obligations, such as keeping payment records.",
					],
				},
				"We don’t sell your personal data, we don’t share it for advertising, and there are no ads in Inboxies. The apps have no analytics, tracking or crash-reporting tools. This website and the web app count page views with Cloudflare Web Analytics, which uses no cookies, and the web app’s page addresses don’t contain your email address or other account details, as [Analytics, this website and its contact form](#privacy-site) explains.",
				"Under the GDPR and UK GDPR, we rely on: performance of our contract with you for running the service and billing; our legitimate interests for spam protection, security and abuse prevention; legal obligation for tax and payment records; and your consent for notifications, which you can withdraw in Settings at any time.",
			],
			src: "workers/index.ts (inbound pipeline); workers/lib/classify-email.ts; workers/lib/sender-triage.ts; workers/auth/rate-limit.ts; workers/lib/service-reminders.ts; workers/auth/mail.ts; no analytics/crash SDKs in app/, ios/, android/, extension/ (ios PrivacyInfo.xcprivacy NSPrivacyTracking false); inboxies.co and inboxies.app: Cloudflare Web Analytics beacon injected at the edge by each zone's automatic setup (AVE-126); app URLs: shared/mailbox-url.ts",
			ownerConfirm: "no sale / no ads as a standing commitment (README Q9); lawful bases",
		},
		{
			id: "privacy-google",
			title: "Sign in with Google",
			body: [
				"If you choose Sign in with Google, or connect Google in Settings, Google shares your name, email address, profile picture and an account identifier with us. That’s all we ask for: the basic sign-in permissions (openid, email and profile). Inboxies gets no access to your Gmail, Drive, contacts or anything else in your Google account.",
				"We use that information only to sign you in and to show you which Google account is connected. We don’t use it for advertising, we don’t sell it, and we share it only as [Who else handles your data](#privacy-sharing) describes.",
				"Inboxies’ use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.",
				"To stop using it, disconnect Google in Settings → Sign-in methods, or remove Inboxies from your Google account’s third-party connections. Deleting your Inboxies account erases the link, as described in [How long we keep it](#privacy-retention).",
			],
			src: "workers/auth/index.ts socialProviders (ID token only, default openid/email/profile; no Google API scopes); app/lib/google-identity.ts (GIS credential); ios GoogleSignIn signIn(withPresenting:) without additionalScopes; android GetGoogleIdOption; workers/routes/account.ts:604-702 (identities list/attach/detach)",
		},
		{
			id: "privacy-ai",
			title: "AI and your mail",
			body: [
				"Inboxies uses AI models in three places:",
				{
					list: [
						"**Spam check.** Incoming mail that its headers don’t already settle is checked for spam by a small model, which reads the sender, the subject and the first 2,000 characters of the text.",
						"**Draft replies.** When mail arrives from a sender you’ve let in, the assistant reads that email and its thread to prepare a draft reply for you to review. It doesn’t draft for mail in the Screener, Spam, bulk mail, spoofed senders, or mail a filter files away or tells it to skip. Before drafting, the message and thread are checked for prompt injection.",
						"**Ask AI.** When you ask the assistant something, it can search and read your mail to answer, draft emails, mark mail read and move it between folders. It saves drafts; it doesn’t send.",
					],
				},
				"These models run on Cloudflare Workers AI: Kimi K2.5 for chat and drafts, and Llama models for the spam check, the injection check and tidying drafts. Your mail isn’t sent to any other AI company. Inboxies doesn’t train any AI model on your mail.",
				"There’s no switch to turn the assistant off for a mailbox yet. To stop drafts for particular senders, lists or subjects, add a filter with “Skip auto-draft”. Mailbox owners can change how it writes in Settings → AI prompt.",
			],
			src: "workers/lib/classify-email.ts:80-81,262-310 (From, Subject, 2,000 chars; llama-3.1-8b-instruct-fast); workers/agent/index.ts:287,315-471 (kimi-k2.5; auto-draft gates; injection scan); workers/lib/ai.ts:32,138; workers/lib/inbox-filters.ts:32 (skipAutoDraft); site faqs.ts ai-reads, ai-models, ai-off",
			ownerConfirm: "the training line (README Q11): true of Inboxies itself; says nothing about Cloudflare's own terms",
		},
		{
			id: "privacy-access",
			title: "Who can see your mail",
			claim: "negated",
			body: [
				{
					list: [
						"**You**, and the owners and members you share a mailbox with.",
						"**Domain admins.** On a custom domain, its admins can create, reassign and delete mailboxes on it, including assigning one to themselves, and can export every mailbox on the domain.",
						"**Tools you connect.** An outside AI tool you connect over MCP acts with your access and can read, send and delete what you can.",
						"**Us.** Mail isn’t end-to-end encrypted, so the people who run Inboxies can technically access stored mail, as with most hosted email. We don’t look at your mail except to fix a problem you’ve asked us to, to investigate abuse or a security incident, or where the law requires it.",
					],
				},
			],
			src: "workers/routes/admin-invites.ts:339-430 (assign incl. self); workers/routes/export-and-offboarding.ts:128-141; workers/mcp/index.ts (13 tools); site faqs.ts who-reads; workers/routes/ops.ts (no mail-reading route)",
			ownerConfirm: "the staff access policy (README Q10)",
		},
		{
			id: "privacy-sharing",
			title: "Who else handles your data",
			body: [
				"We use a small number of service providers. They process data for us under their own terms and privacy commitments.",
				{
					table: [
						["Cloudflare", "Runs everything: hosting, storage (Durable Objects, R2 and D1), receiving and sending mail (Email Routing and Email Service), the AI models (Workers AI), DNS for custom domains, domain registration (Cloudflare Registrar), and page view counts for this website and the web app (Web Analytics)."],
						["Stripe", "Payments for domains you buy: card details, billing address and invoices. We share the domain, your username, display name and price."],
						["Apple", "Sign in with Apple, and notifications to iPhone (the sender, subject and a short preview of a new email pass through Apple’s push service)."],
						[
							"Google",
							"Sign in with Google, if you link it. The web app loads its fonts from Google Fonts, so your browser connects to Google’s servers." +
								(flags.androidPublic ? " Notifications to Android devices go through Firebase Cloud Messaging, with the sender, subject and a short preview." : ""),
						],
					],
				},
				"Mail you send goes to its recipients and their providers, and forwarding sends copies where you’ve told it to. Outside Spam, images in a message load from the sender’s servers when you open it, so the sender can see that it was opened and the IP address it was opened from. We may also disclose data when the law requires it, to protect people’s safety or our service from abuse, or to a successor if Inboxies is reorganised or sold, in which case this policy keeps applying to your data.",
			],
			src: "wrangler.jsonc bindings; workers/lib/cloudflare-registrar.ts; workers/lib/stripe.ts, workers/routes/billing.ts:336-344; workers/auth/apple.ts; workers/lib/apns.ts, push-payload.ts (title, subtitle, 140-char preview); workers/lib/fcm.ts; app/root.tsx:98-106 (Google Fonts); app/components/settings/SignInSettings.tsx:79 (GSI); shared/remote-images.ts (remote images load outside Spam, AVE-132)",
		},
		{
			id: "privacy-location",
			title: "Where your data is",
			body: [
				"Your data is stored and processed on Cloudflare’s global network and isn’t pinned to one country or region, so it may be handled outside the country where you live, including in the United States. Where the law requires it, these transfers rely on safeguards such as the EU Standard Contractual Clauses in our providers’ terms.",
			],
			src: "wrangler.jsonc (no jurisdiction on DOs or R2)",
			ownerConfirm: "transfer mechanism wording",
		},
		{
			id: "privacy-retention",
			title: "How long we keep it",
			body: [
				{
					table: [
						["Mail and attachments", "Until you delete them. Deleting moves mail to Trash; deleting it from Trash, or emptying Trash, erases it. Trash and Spam aren’t emptied automatically."],
						["A deleted mailbox", "Its messages, attachments, settings, search index, private email addresses and assistant history are erased at once."],
						["A deleted account", "Your sign-in methods, sessions and memberships are erased, along with every mailbox you’re the only owner of. You’re removed from mailboxes that have other owners."],
						[".mbox exports", "7 days, then the file is deleted. An export made before a mailbox was deleted lasts its 7 days."],
						["Sessions", "Up to 30 days without use, then they expire and are cleared."],
						["Codes and links", "Sign-in and verification codes last 15 minutes; password reset links last an hour. Both are stored hashed and cleared once expired."],
						["Invitations", "Cleared 30 days after they expire."],
						["A lapsed paid domain", "Mailboxes turn read-only when service ends. If the domain isn’t renewed, its mail is erased 30 days after the name is released, with reminders before that."],
						["Payment records", "As long as tax and accounting law requires."],
						["Security records", "The log of account actions is kept to investigate abuse and disputes."],
						["Server logs", "Short-lived operational logs, which can include email addresses, kept by Cloudflare’s logging and not used for anything else."],
						["Support messages", "As long as we need them to help you, in our support mailbox."],
					],
				},
			],
			src: "workers/durableObject/index.ts:1489-1633 (trash, purge); workers/routes/account.ts:182-213,423-432 (account delete); workers/lib/email-exporter.ts SEVEN_DAYS_MS, maintenance.ts:111-153; workers/auth/index.ts:112-114 (30 d); workers/auth/otp.ts:25 (15 min), account.ts:53 (1 h); domain-service.ts (RETENTION_AFTER_RELEASE_DAYS 30); service-reminders.ts",
			ownerConfirm: "retention periods for payment records, the audit log and support mail; log retention",
		},
		{
			id: "privacy-rights",
			title: "Your choices and rights",
			body: [
				{
					list: [
						"**See and take your data.** Your mail is in the apps. Domain admins can export every mailbox on a domain to .mbox from Admin → Export.",
						`**Correct it.** Change your backup email, password, sign-in methods and the name your mail is sent from in Settings, or write to ${MAIL_US} to fix anything else.`,
						"**Delete it.** Delete a mailbox in its settings, or your whole account in Settings → Account → Delete account, on the web or in the iPhone app.",
						"**Control what reaches you.** Keep new senders in the Screener, leave remote images in Spam blocked, turn notifications off, and sign out other sessions from Settings.",
					],
				},
				`Depending on where you live, you may also have the right to access, correct, delete or port your data, to object to or restrict how we use it, and to withdraw consent. To use any of these rights, or to get a copy of data you can’t export yourself, write to ${MAIL_US} from the address on your account. We’ll answer within the time the law sets, usually a month.`,
				"If you’re in the EU, the EEA or the UK, you can also complain to your data protection authority. Californian residents: we don’t sell or share personal information as the CCPA defines those terms, and you won’t be treated differently for using your rights.",
			],
			src: "app/components/settings/pages.tsx:102-107 (web delete-account); iOS/Android SettingsSheetView (Account → Delete account); workers/routes/account.ts:436-482 (sessions); export-and-offboarding.ts (domain export)",
		},
		{
			id: "privacy-security",
			title: "Security",
			claim: "negated",
			body: [
				"Connections to Inboxies use TLS, and Cloudflare encrypts stored data at rest. Passwords are hashed, codes and reset links are stored hashed, and sign-in, reset and sending are rate-limited. Email HTML is cleaned and shown in a sandbox where scripts never run.",
				`Inboxies doesn’t add end-to-end encryption, and no service is free of risk. If you find a security problem, write to ${MAIL_US} with “Security” in the subject, or choose “Security report” in the [contact form](/support#contact). If a breach puts your data at risk, we’ll tell you and the authorities as the law requires.`,
			],
			src: "site faqs.ts encryption, html; workers/lib/password-auth.ts; workers/auth/otp.ts (SHA-256); wrangler.jsonc rate limiters; OtherWays.astro (Security report topic)",
		},
		{
			id: "privacy-cookies",
			title: "Cookies and local storage",
			body: [
				"Inboxies uses one cookie: the session cookie that keeps you signed in to the web app. It’s strictly necessary, so there’s no cookie banner. This website sets no cookies at all, and Web Analytics sets none on the website or the web app.",
				{
					table: [
						["Web app session cookie", "Keeps you signed in, for up to 30 days. Not readable by scripts."],
						["Web app local storage", "Your theme, text size and column widths, kept in your browser."],
						["This site’s local storage", "Your theme and text size, plus whether you paused the videos, kept in your browser."],
					],
				},
				"The iPhone app keeps a copy of your mail on the device for offline use and stores its sign-in token in the iOS Keychain. Deleting the app removes that copy.",
			],
			src: "workers/auth/middleware.ts:38, users.ts:104-121 (HttpOnly session cookie); app/lib/theme.ts, text-size.ts, hooks/useColumnWidths.ts; site/src/scripts/theme.ts, lib/type-scale.ts, scripts/clips.ts, components/Cursor.astro (sessionStorage); ios DatabaseService.swift, APIClient.swift (Keychain)",
		},
		{
			id: "privacy-site",
			title: "Analytics, this website and its contact form",
			body: [
				`This website (inboxies.co) and the web app (${APP_HOST}) use Cloudflare Web Analytics to count page views, see how people move around them, and see how fast pages load. Cloudflare adds a small script to their pages that reports the page you viewed (without anything after the “?” in its address), the page or site that sent you, your country, your browser, operating system and type of device, and page load timings. In the web app it also reports each move to a new screen, the same way. It sets no cookies and stores nothing in your browser, and Cloudflare says it doesn’t collect visitors’ personal data, fingerprint them, or track them across other sites. Your browser fetches the script from Cloudflare, which already serves every page of the website and the web app.`,
				"The web app’s page addresses don’t contain your email address, mailbox addresses, invite codes, search terms or other account details. A mailbox is named by its place in your list of mailboxes (the first is 0), an email by a random ID, and a folder or tag by its name. Older links that had an address in them are redirected before the page loads.",
				"The apps don’t use Web Analytics or any other analytics. On the website, that script is the only third-party script, and the fonts are served from our own domain.",
				`The contact form sends your name, email, Inboxies address (if you give one), topic and message, with the page you came from and your browser’s description, to ${SUPPORT_EMAIL} as an email. The website doesn’t store it, and its logs record only whether a message was sent and its topic. Our support mailbox runs on Inboxies, so your message is handled like any other mail there, spam check included.`,
			],
			src: "site/src/pages/api/contact.ts:7,40-43,216-248; @fontsource/inter; Cloudflare Web Analytics on inboxies.co and inboxies.app via each zone's automatic setup (not in site/ or app/ code; AVE-126). App URLs carry no account details: shared/mailbox-url.ts (mailbox index, /invite?token=), workers/lib/legacy-app-urls.ts (old-link redirects). Claims per developers.cloudflare.com/web-analytics/about/, /data-metrics/dimensions/, /data-metrics/data-origin-and-collection/, /faq/ (no query strings) and cloudflare.com/web-analytics/ (no cookies or localStorage, no fingerprinting)",
		},
		{
			id: "privacy-children",
			title: "Children",
			body: [
				"Inboxies isn’t meant for children. You must be at least 13 to use it, or older where your country sets a higher age for consenting to online services (16 in some EU countries). If you believe a child has given us data, write to us and we’ll delete it.",
			],
			src: "no age gate in code; policy",
			ownerConfirm: "minimum age",
		},
		{
			id: "privacy-self-hosted",
			title: "Self-hosted installs",
			body: [
				`Anyone can run Inboxies on their own Cloudflare account from [the source code](${GITHUB_URL}). On a self-hosted install, mail and accounts live in that operator’s account, and we have no access to it. Their own privacy terms apply there.`,
			],
			src: "LICENSE; site faqs.ts self-host",
		},
		{
			id: "privacy-changes",
			title: "Changes to this policy",
			body: [
				"When this policy changes, we’ll update the date at the top of this page. If a change materially affects how we use your data, we’ll tell you by email or in the app before it takes effect.",
			],
			src: "policy",
		},
	],
};

export const terms: LegalDoc = {
	id: "terms",
	title: "Terms of service",
	lead:
		`These terms are the agreement between you and Inboxies for using the hosted service (the web app at ${APP_HOST} and mail at @inboxies.email) and the Inboxies apps. By creating an account or using the service, you agree to them, to the [Acceptable use policy](#acceptable-use), and to how we handle data as described in the [Privacy policy](#privacy).`,
	src: "policy; apps link “Terms of Use” on sign-in (SignInView.swift:493, SignInView.kt:514)",
	clauses: [
		{
			id: "terms-accounts",
			title: "Your account",
			body: [
				"You need to be at least 13, or the minimum age for online services where you live, and able to make this agreement. If you use Inboxies for an organisation, you confirm you’re allowed to accept these terms for it.",
				"Keep your password and devices safe, and set a backup email you control: it’s how you get back in and where we send renewal notices. You’re responsible for what happens in your account. Tell us at once if you think someone else got into it.",
			],
			src: "workers/routes/onboarding.ts:73-96 (backup email for billing notices); policy",
			ownerConfirm: "minimum age",
		},
		{
			id: "terms-addresses",
			title: "Addresses and usernames",
			body: [
				"An @inboxies.email address is yours to use while your account is active, but the domain stays ours. Some names, such as support, security, postmaster and abuse, are reserved. We may reclaim or rename an address that impersonates a person, a brand or Inboxies, that misleads people, or that infringes someone’s rights.",
				"When an address is deleted, mail sent to it stops arriving. We may make a deleted name available again after a while.",
			],
			src: "workers/lib/mailbox-routing.ts:85-103 (RESERVED_LOCAL_PARTS)",
			ownerConfirm: "address reclaim and reuse policy",
		},
		{
			id: "terms-content",
			title: "Your content",
			body: [
				"Your mail, attachments and settings stay yours. You give us permission to store, process, copy, transmit and display them only as needed to run Inboxies for you: to deliver and send mail, search it, check it for spam, run the assistant and show it in your apps. That permission ends when the content is deleted, apart from copies kept for the periods in the privacy policy.",
				"You’re responsible for what you send and store, and you confirm you have the right to it.",
			],
			src: "policy",
		},
		{
			id: "terms-ai",
			title: "The assistant",
			body: [
				"Drafts and answers from the assistant are generated by AI. They can be wrong, incomplete or inappropriate, and they aren’t professional advice. The assistant saves drafts and never sends on its own. Read anything it writes before you send it: what you send is yours. The spam check and the Screener can also make mistakes, so look in Screener and Spam if you’re expecting something.",
				"If you connect an outside tool over MCP, it acts with your access, including sending and deleting mail. You’re responsible for what it does.",
			],
			src: "workers/agent/index.ts (drafts only, source agent); site faqs.ts ai-sending, mcp",
		},
		{
			id: "terms-limits",
			title: "Limits",
			body: [
				"To keep mail flowing and stop abuse, Inboxies sets limits. Today they include:",
				{
					records: [
						["Sending", "20 an hour, 100 a day per mailbox"],
						["Largest message you send", "5 MiB, attachments included"],
						["Largest message you receive", "25 MiB"],
						["Filters", "50 per mailbox"],
						["Private email addresses", "1,000 per mailbox"],
					],
				},
				"We may change these limits, and we’ll keep the current ones on the [Support page](/support#limits).",
			],
			src: "workers/durableObject/index.ts:2485-2512 (20/h, 100/day); shared/outbound-limits.ts:10 (5 MiB); workers/index.ts:1324 (25 MiB); inbox-filters.ts:19 (50); alias-utils.ts:52 (1,000)",
		},
		{
			id: "terms-domains",
			title: "Custom domains",
			body: [
				"You may only connect a domain you control. Connecting one moves its DNS to a Cloudflare zone that Inboxies runs, so Inboxies then manages all of its records, your website’s included. Check that the records your other services need are in the new zone; we’re not responsible for services outside Inboxies that stop working after the move.",
				"Domain admins can create, reassign, export and delete every mailbox on their domain. If you add people to your domain, you’re responsible for telling them that, and for their use of it. Leaving is in Admin: export your mail, then choose Move DNS / Offboard and point the nameservers elsewhere.",
			],
			src: "site faqs.ts connect-domain, dns-records, leave; workers/routes/domain-dns.ts; export-and-offboarding.ts; workers/auth/authz.ts:127-165",
		},
		{
			id: "terms-billing",
			title: "Buying a domain",
			hidden: !flags.domainPurchaseLive,
			body: [
				"**Price.** A domain costs $20 a year, covering its registration and the Inboxies platform. A domain whose wholesale price is over $15 a year costs its wholesale price plus $10. You see the exact total before you pay. Prices are in US dollars, through Stripe, plus any tax that applies.",
				"**Registration.** We register the domain through Cloudflare Registrar, in the Cloudflare account Inboxies runs, with WHOIS privacy on. While it’s with us you can unlock it and get its transfer code from Admin, to move it to another registrar.",
				"**Renewal.** Your subscription renews every year until you cancel. We charge about 60 days before the registration expires and email your backup address 7 days before each charge. If a charge fails, or you cancel, we turn off the domain’s auto-renewal.",
				"**Cancelling.** A domain admin can cancel, change the card and see invoices from the domain’s Subscription card in Admin on the web (Manage billing), or write to us. Cancelling stops the next renewal; the domain and its mail keep working until the paid period ends. Deleting your account doesn’t cancel a subscription.",
				`**Refunds.** If we can’t register the domain you paid for, because someone else took it first, we cancel the subscription and refund you in full automatically. For anything else, write to ${MAIL_US}. Nothing here limits refund rights you have under the law where you live.`,
			],
			src: "workers/lib/cloudflare-registrar.ts:68-86,126-163,357-425 (pricing, privacy true, auto_renew, operator account); domain-service.ts RENEWAL_CHARGE_LEAD_DAYS 60; service-reminders.ts CHARGE_NOTICE_DAYS 7; billing-fulfillment.ts:16-19,497-532,901-908; DomainSubscriptionCard.tsx ManageBillingButton; routes/account.ts (delete doesn't touch Stripe)",
			ownerConfirm: "REQUIRED: refund policy beyond failed registration (README Q4); who is registrant of record; tax wording",
		},
		{
			id: "terms-lapse",
			title: "When a domain’s service ends",
			hidden: !flags.domainPurchaseLive,
			body: [
				"If a domain’s subscription ends, its mailboxes turn read-only: people can still sign in, read and export, but nothing is sent or received. For a domain we registered, you can renew at the normal price for about 40 days after the registration expires. After that, Cloudflare releases the name, about 75 days after expiry, and the domain’s mail is erased 30 days after the name is released. We email the domain’s owner and admins at their backup addresses before each of these steps. Accounts aren’t deleted.",
			],
			src: "workers/lib/domain-service.ts:6-19,33-55 (read-only, 40-day grace, 75-day release, 30-day retention); service-reminders.ts:10-17; domain-purge.ts",
		},
		{
			id: "terms-service",
			title: "The service",
			body: [
				"Inboxies is changing quickly. We may add, change or remove features, and some, like the iPhone app on TestFlight, are in beta. The personal address and connecting your own domain have no charge today. If we ever start charging for something you already use, we’ll tell you in advance, and you can leave before it applies.",
				"Inboxies relies on Cloudflare, Stripe, Apple and Google, and their outages can affect it. We don’t promise the service will always be available or free of errors.",
			],
			src: "site config.ts IOS_STATUS testflight; faqs.ts free-personal, free-domain",
			ownerConfirm: "advance notice of new charges",
		},
		{
			id: "terms-open-source",
			title: "Open source",
			body: [
				`The Inboxies source code is available under the Apache License 2.0 at [GitHub](${GITHUB_URL}). That license governs the code; these terms govern the hosted service. The Inboxies name and logo aren’t licensed for use on your own install.`,
			],
			src: "LICENSE; site Footer (Apache-2.0)",
			ownerConfirm: "trademark line",
		},
		{
			id: "terms-ending",
			title: "Suspension and ending",
			body: [
				"You can stop using Inboxies and delete your account at any time from Settings.",
				"We may suspend or close an account, an address or a domain that breaks these terms or the acceptable use policy, puts others at risk, or where the law requires it. Where it’s reasonable, we’ll tell you first and give you a chance to fix the problem and export your mail. If we ever shut the hosted service down, we’ll give at least 30 days’ notice so you can take your mail with you.",
			],
			src: "workers/routes/account.ts:423-432; workers/routes/ops.ts:129 (revoke sessions); policy",
			ownerConfirm: "suspension process; shutdown notice period",
		},
		{
			id: "terms-disclaimers",
			title: "Disclaimers",
			body: [
				"Inboxies is provided “as is” and “as available”. To the extent the law allows, we disclaim all warranties, express or implied, including merchantability, fitness for a particular purpose and non-infringement. Email can be delayed, filtered or lost, so don’t rely on Inboxies as the only copy of anything important, or for emergencies.",
			],
			src: "policy",
		},
		{
			id: "terms-liability",
			title: "Limitation of liability",
			body: [
				"To the extent the law allows, Inboxies isn’t liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, data or goodwill. Our total liability for any claim about the service is limited to the greater of what you paid us in the 12 months before the claim and US$50.",
				"Nothing in these terms limits liability that can’t be limited by law, such as for fraud, or for death or personal injury caused by negligence, or removes rights you have as a consumer.",
			],
			src: "policy",
		},
		{
			id: "terms-indemnity",
			title: "Indemnity",
			body: [
				"If you use Inboxies for a business and your use of it, or content you send, leads to a claim against us, you agree to cover our reasonable costs of that claim. This doesn’t apply to consumers where the law doesn’t allow it.",
			],
			src: "policy",
		},
		{
			id: "terms-changes",
			title: "Changes to these terms",
			body: [
				"We may update these terms. We’ll change the date at the top of this page and, for material changes, tell you by email or in the app at least 30 days before they apply. If you keep using Inboxies after that, the new terms apply; if you don’t agree, you can delete your account.",
			],
			src: "policy",
		},
		{
			id: "terms-law",
			title: "Disputes",
			body: [
				`If something goes wrong, write to ${MAIL_US} first and we’ll try to sort it out. If we can’t, the courts where you live may hear your claim, and you keep the protection of consumer law where you live. If any part of these terms can’t be enforced, the rest still applies.`,
			],
			src: "policy",
			ownerConfirm: "REQUIRED: governing law and venue (README Q18)",
		},
	],
};

export const acceptableUse: LegalDoc = {
	id: "acceptable-use",
	title: "Acceptable use policy",
	lead: "Inboxies is for your own mail and your team’s. Don’t use it to:",
	src: "policy; workers/lib/mailbox-routing.ts (reserved names); send caps",
	clauses: [
		{
			id: "aup-spam",
			title: "Send spam",
			body: [
				"Send unsolicited bulk or commercial email, buy or rent lists, or send to people who haven’t agreed to hear from you. Inboxies isn’t a newsletter or marketing tool, and the sending limits reflect that.",
			],
			src: "policy; send_log caps",
		},
		{
			id: "aup-deceive",
			title: "Deceive people",
			body: [
				"Phish, impersonate someone, forge headers, or pretend to be Inboxies, a company or a public body. Don’t use private email addresses to defraud anyone or get around a ban.",
			],
			src: "policy",
		},
		{
			id: "aup-harm",
			title: "Harm others",
			body: [
				"Send malware, harass or threaten people, or send or store anything illegal, including material that sexually exploits children, which we report to the authorities.",
			],
			src: "policy",
		},
		{
			id: "aup-abuse",
			title: "Abuse the service",
			body: [
				"Get around limits, for example with many accounts; probe, scan or attack Inboxies or its users; access an account or mailbox you weren’t given; resell addresses; or use the assistant to generate abusive mail.",
			],
			src: "policy; workers/auth/rate-limit.ts",
		},
		{
			id: "aup-law",
			title: "Break the law",
			body: [
				"Infringe someone’s copyright, trademark or privacy, or break anti-spam and data protection laws such as CAN-SPAM and the GDPR.",
			],
			src: "policy",
		},
		{
			id: "aup-report",
			title: "Reporting abuse",
			body: [
				`If an Inboxies address is sending you spam, phishing or abuse, write to ${MAIL_US} with “Abuse” in the subject and include the message with its headers. We may remove content, limit sending, or suspend accounts that break this policy.`,
			],
			src: "policy",
			ownerConfirm: "abuse intake address (reserve abuse@, README Q17)",
		},
	],
};

/** On the page, in order. Hidden clauses (behind a flag) are dropped here. */
export const legalDocs: LegalDoc[] = [privacy, terms, acceptableUse].map((d) => ({
	...d,
	clauses: d.clauses.filter((c) => !c.hidden),
}));
