// src: MEDIA (stills and clips from the capture pipeline, checked against SP/capture/review); J (CT media rules)
// The UI is the real app. The Ask AI conversation is a scripted transcript in a
// DEBUG build, and the search results were matched offline over the sample
// mailbox, so those alts say so (D5).
// Names, alt text and clip facts for every screen on the site. The files
// themselves are read-only: stills in src/assets/screens (<name>-<light|dark>.png,
// 1206×2622), clips in public/media (<name>[-dark].{mp4,webm,jpg}, 590×1282).
import type { ImageMetadata } from "astro";

export type StillName =
	| "inbox"
	| "detail"
	| "chat"
	| "search"
	| "screener"
	| "screener-list"
	| "reply-later"
	| "compose"
	| "compose-minimized"
	| "action-menu"
	| "welcome"
	| "get-started"
	| "domain-admin"
	| "sign-in-methods";

export type ClipName = "inbox-open" | "screener-flow" | "reply-later" | "ask-ai" | "compose-dock";

export type Theme = "light" | "dark";

export const stills: Record<StillName, { alt: string }> = {
	inbox: {
		alt: "The Inbox on iPhone: New holds three unread threads, from Jordan Hale, Morgan Lee and Sam Chen, Seen holds the rest, and a banner says one first-time sender is waiting in the Screener.",
	},
	detail: {
		alt: "A thread on iPhone: “Quarterly planning notes” from Jordan Hale, tagged Inbox, Unread and 3 messages, with a proposed agenda of Q4 priorities, hiring and a launch checklist.",
	},
	chat: {
		alt: "An Ask AI conversation on iPhone titled “Replies due this week”: asked what needs a reply, the assistant searched the mailbox, listed Pat Legal’s contract, Alex Rivera’s invoice and Sam Chen’s design review, then saved a draft reply to Pat in Drafts. Sample mailbox; the conversation is staged.",
	},
	search: {
		alt: "Search on iPhone: the query “in:inbox review” finds Sam Chen’s “Design review tomorrow” and Pat Legal’s “Can you review the contract?”, with “review” in bold, and offers to ask AI instead. Sample mailbox; the results are simulated offline.",
	},
	screener: {
		alt: "An email from a first-time sender, Dana Whitfield, “Guest spot on Small Studio Talks?”, with the note “New sender — approve where their mail should go, or screen them out privately.” and Accept and Decline buttons.",
	},
	"screener-list": {
		alt: "The Screener on iPhone: one unread message from Dana Whitfield, with Accept and Decline buttons.",
	},
	"reply-later": {
		alt: "Reply Later on iPhone: two threads to reply to, from Alex Rivera and Pat Legal.",
	},
	compose: {
		alt: "Replying on iPhone to Jordan Hale: “Re: Quarterly planning notes” with “9:30 works for me.”, and buttons for formatting and attachments.",
	},
	"compose-minimized": {
		alt: "The Inbox on iPhone with a draft, “Re: Quarterly planning notes”, docked at the bottom of the screen.",
	},
	"action-menu": {
		alt: "The corner button’s menu on iPhone, over a blurred Inbox: Settings, Trash, Archive, Drafts, Sent, Updates, Promotions, Screener, Inbox and Compose.",
	},
	welcome: {
		alt: "The Inboxies welcome screen on iPhone: “Your Personal email app” and a round button to continue.",
	},
	"get-started": {
		alt: "“Welcome to Inboxies” on iPhone with two choices: Personal Address, an instant @inboxies.email address, and Custom Domain, set up through Cloudflare DNS.",
	},
	"domain-admin": {
		alt: "Domain Admin on iPhone: DNS & Domain Configuration, a Create email button, and the domain’s mailboxes you@, ops@ and pending@.",
	},
	"sign-in-methods": {
		alt: "Sign-in methods on iPhone: the methods connected to you@inboxies.email, a form to change the password, and Link another device.",
	},
};

// `dark: false` means there's no dark encode: in the dark theme the clip never
// plays and its still shows instead (no light media on a dark page).
// `duration` is in seconds (the light encode; the dark ones differ by < 0.8s).
// The welcome-flow capture is left out on purpose: its sign-in sheet links a
// Terms page that 404s.
export const clips: Record<ClipName, { dark: boolean; duration: number; still: StillName; alt: string }> = {
	"inbox-open": {
		dark: true,
		duration: 8.5,
		still: "inbox",
		alt: "Inboxies on iPhone: the Inbox, split into New and Seen. Jordan Hale’s thread “Quarterly planning notes” opens, scrolls and closes, and moves from New to Seen.",
	},
	"screener-flow": {
		dark: true,
		duration: 9.7,
		still: "screener-list",
		alt: "On iPhone, the Inbox shows a banner for one first-time sender. In the Screener, Dana Whitfield waits with Accept and Decline; Accept offers Inbox, Promotions or Updates, and her email then appears in the Inbox.",
	},
	"reply-later": {
		dark: false,
		duration: 8.0,
		still: "reply-later",
		alt: "On iPhone, the Reply Later pill opens a pile of two threads. Pat Legal’s “Can you review the contract?” opens, then closes back to the pile.",
	},
	"ask-ai": {
		dark: true,
		duration: 10.5,
		still: "chat",
		alt: "Ask AI on iPhone: the question “What needs my reply this week?” gets a streamed answer listing three threads waiting on you. Sample mailbox; the conversation is staged.",
	},
	"compose-dock": {
		dark: true,
		duration: 10.4,
		still: "compose-minimized",
		alt: "Compose on iPhone: a new message, “Running 10 min late”, is swiped down into a dock at the bottom of the Inbox, then tapped open again.",
	},
};

// Eager so <Picture> gets real ImageMetadata (and sharp sizes) at build time.
const files = import.meta.glob<{ default: ImageMetadata }>("/src/assets/screens/*.png", { eager: true });

/** The still for one theme. Throws at build if the file is missing, so a renamed capture can't ship a broken image. */
export function getStill(name: StillName, theme: Theme): ImageMetadata {
	const file = files[`/src/assets/screens/${name}-${theme}.png`];
	if (!file) throw new Error(`media: missing still src/assets/screens/${name}-${theme}.png`);
	return file.default;
}

/** Public paths for a clip in one theme, or null when that theme has no encode. */
export function clipFiles(name: ClipName, theme: Theme): { mp4: string; webm: string; poster: string } | null {
	if (theme === "dark" && !clips[name].dark) return null;
	const base = `/media/${name}${theme === "dark" ? "-dark" : ""}`;
	return { mp4: `${base}.mp4`, webm: `${base}.webm`, poster: `${base}.jpg` };
}
