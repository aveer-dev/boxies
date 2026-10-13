// "Plain facts" (§4.1 L7) and "How it's built" (§4.1 L8). Facts are stated
// in the present tense: what's true today, not what's promised.
import { GITHUB_URL } from "../config";
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
		id: "open-source",
		title: "Open source",
		href: GITHUB_URL,
		meta: "Apache-2.0",
		body: "The server and web app are open source. Read the code, or run your own copy on Cloudflare; the iPhone app connects only to inboxies.email.",
		src: "PS#7 (Apache-2.0; release builds locked to inboxies.email)",
	},
	{
		id: "delete",
		title: "Deleting is permanent",
		body: "Deleting a mailbox erases its messages, attachments, raw files and assistant history, and you can delete your whole account from the iPhone app. Neither can be undone. An .mbox export made earlier isn’t deleted with it.",
		src: "FSW#supporting-features (purgeMailbox); PS#5 (deleting a mailbox); durableObject purgeMailbox leaves exports/data/* in R2 (email-exporter.ts); dev eda481f (Settings → Account → Delete account; DELETE /api/v1/me)",
	},
];

// The candid callout under the facts. Uses words (end-to-end, encrypt) that
// check:claims only allows inside data-claim="negated".
export const plainly: CalloutCopy = {
	id: "plainly",
	title: "Plainly:",
	body: "Inboxies doesn’t add end-to-end encryption. Cloudflare encrypts stored mail at rest, and the service that runs Inboxies can technically read it, as with most hosted email. Remote images stay hidden until you choose Load images; once you do, a sender’s tracking pixel can fire. [More in Support](/support#encryption)",
	claim: "negated",
	src: "PS#5 (privacy of mail at rest); dev 061e0ea EmailIframe.tsx, eda481f EmailHTMLSanitizer.swift / EmailBodyView.kt (remote images opt-in per message)",
	ownerConfirm: "approve candid wording",
};

export const builtOn: Tile[] = [
	{
		dt: "Storage",
		dd: "1 mailbox, 1 database",
		p: "Each mailbox runs in its own Durable Object with its own SQLite database.",
		src: "FSW#per-mailbox-isolation",
	},
	{
		dt: "Mail and files",
		dd: "R2",
		p: "Message bodies and attachments are stored in Cloudflare R2.",
		src: "FSW#per-mailbox-isolation",
	},
	{
		dt: "AI",
		dd: "Workers AI",
		p: "The spam check and the assistant run on Cloudflare Workers AI models.",
		src: "PS#5 (AI data handling); classify-email.ts (Llama spam check); D2",
	},
	{
		dt: "Checks",
		dd: "SPF · DKIM · DMARC",
		p: "Read on every incoming message, with a Spoofed warning when they fail.",
		src: "FSW#spoofing-protection",
	},
];
