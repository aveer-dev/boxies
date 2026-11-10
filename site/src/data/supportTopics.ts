// The topic list at the top of /support (§4.4 S3). A topic with a `group`
// shows that group's answer count, computed from faqs.ts; the two without
// one carry their own `meta`.
import type { SupportTopic } from "./types";

export const topics: SupportTopic[] = [
	{
		id: "topic-getting-started",
		title: "Getting started",
		href: "#getting-started",
		group: "getting-started",
		description: "Addresses, apps and your first few minutes.",
		src: "CT#2.3 (support topics)",
	},
	{
		id: "topic-sorting",
		title: "Screener and sorting",
		href: "#sorting-topic",
		group: "sorting-topic",
		description: "Who gets in, and where their mail goes.",
		src: "CT#2.3 (support topics)",
	},
	{
		id: "topic-everyday",
		title: "Everyday mail",
		href: "#everyday-topic",
		group: "everyday-topic",
		description: "Reply Later, search, compose, undo and notifications.",
		src: "CT#2.3 (support topics)",
	},
	{
		id: "topic-ai",
		title: "Ask AI",
		href: "#ai-topic",
		group: "ai-topic",
		description: "What the assistant does, and what it won’t.",
		src: "CT#2.3 (support topics)",
	},
	{
		id: "topic-domains",
		title: "Domains and teams",
		href: "#domains-topic",
		group: "domains-topic",
		description: "Connecting, registering and sharing.",
		src: "CT#2.3 (support topics)",
	},
	{
		id: "topic-account",
		title: "Account and sign-in",
		href: "#account-topic",
		group: "account-topic",
		description: "Passwords, Apple sign-in, other devices and deleting your account.",
		src: "CT#2.3 (support topics)",
	},
	{
		id: "topic-data",
		title: "Your data",
		href: "#data-topic",
		group: "data-topic",
		description: "Where mail lives, who can read it, export and deleting.",
		src: "CT#2.3 (support topics)",
	},
	{
		id: "topic-developers",
		title: "For developers",
		href: "#developers-topic",
		group: "developers-topic",
		description: "The source code, connecting AI tools and running your own copy.",
		src: "CT#2.3 (support topics); PS#7",
	},
	{
		id: "topic-billing",
		title: "Billing",
		href: "/pricing#faq",
		meta: "on Pricing",
		description: "Prices and cancelling.",
		src: "CT#2.3 (support topics); PS#1",
	},
	{
		id: "topic-contact",
		title: "Contact",
		href: "#contact",
		meta: "—",
		description: "Write to us.",
		src: "PS#6 (support@ for Contact Support and Send Feedback)",
	},
];
