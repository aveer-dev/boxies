// "Plain facts" (§4.1 L7) and "Under the hood" (§4.1 L8). Facts are stated
// in the present tense: what's true today, not what's promised.
import type { CalloutCopy, Principle, Tile } from "./types";

export const facts: Principle[] = [
	{
		id: "no-ads",
		title: "No ads",
		body: "There are no ads in Inboxies today: not in the apps, and not in your mail.",
		src: "PS#1 (one paid thing; no ad code); J (reframed as a present-tense fact, not a commitment)",
		ownerConfirm: "OK to state publicly",
	},
	{
		id: "export",
		title: "Export as .mbox",
		body: "Domain admins can export every mailbox on their domain to a standard .mbox file that Apple Mail and Thunderbird open. A one-tap export for a single mailbox is planned.",
		claim: "roadmap",
		src: "FSW#leave-anytime; PS#5 (exporting mail); RM#1 (7)",
	},
	{
		id: "ai-included",
		title: "AI included",
		body: "Ask AI comes with every address, with no separate AI plan to buy. Each mailbox gets 50 chats with it a day.",
		src: "PS#2 (no billing path other than domains); workers/lib/ai-quota.ts AI_DAILY_LIMITS (AVE-45, eba8ee9: free tier for everyone, chat 50 a UTC day per mailbox); faqs.ts ai-cost, caps",
	},
	{
		id: "delete",
		title: "Deleting is permanent",
		body: "Deleting a mailbox erases its messages, attachments, raw files and assistant history, and you can delete your whole account in Settings. Neither can be undone. An .mbox export made earlier isn’t deleted with it.",
		src: "FSW#supporting-features (purgeMailbox); PS#5 (deleting a mailbox); durableObject purgeMailbox leaves exports/data/* in R2 (email-exporter.ts); dev eda481f (Settings → Account → Delete account; DELETE /api/v1/me)",
	},
];

// The candid callout under the facts. Uses words (end-to-end, encrypt) that
// check:claims only allows inside data-claim="negated".
export const plainly: CalloutCopy = {
	id: "plainly",
	title: "Plainly:",
	body: "Inboxies doesn’t add end-to-end encryption. Stored mail is encrypted at rest, and the service that runs Inboxies can technically read it, as with most hosted email. Remote images load when you open a message, so a sender’s tracking pixel can fire. In Spam they stay hidden until you choose Load images. [More in Support](/support#encryption)",
	claim: "negated",
	src: "PS#5 (privacy of mail at rest); dev AVE-132 (#168: shared/remote-images.ts, EmailIframe.tsx; EmailHTMLSanitizer.swift / EmailHtmlSanitizer.kt blocksRemoteImages, folder_id == spam)",
	ownerConfirm: "approve candid wording",
};

// What it's built on, said as what you get. Cloudflare is named once, as the
// one network everything runs on; no product names (the site sells the
// service; the stack is for developers, in Support → For developers).
export const builtOn: Tile[] = [
	{
		dt: "Where it runs",
		dd: "One network",
		p: "Your mail, attachments, the assistant and your domain’s settings all run on Cloudflare.",
		src: "FSW#per-mailbox-isolation; PS#5 (AI data handling); cloudflare-client.ts createZone (zones in the operator's account)",
	},
	{
		dt: "Your mailbox",
		dd: "Kept apart",
		p: "Each mailbox has its own database for mail and search, separate from every other mailbox.",
		src: "FSW#per-mailbox-isolation",
	},
	{
		dt: "The assistant",
		dd: "No outside AI",
		p: "Ask AI and the spam check run next to your mail. Inboxies doesn’t send it to another AI company.",
		src: "PS#5 (AI data handling: no third-party LLM API); classify-email.ts; D2",
	},
	{
		dt: "Every message",
		dd: "Spoof checks",
		p: "Every incoming email is checked to be from who it says it’s from, with a Spoofed warning when it isn’t.",
		src: "FSW#spoofing-protection",
	},
];
