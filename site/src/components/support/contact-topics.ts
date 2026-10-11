// The contact form's topics (§4.4 S5), in menu order. The form renders them
// and the endpoint checks against them, so a topic can't drift between the
// two. The label also heads the email's subject.
import { IOS_STATUS, flags } from "../../config";

export interface ContactTopic {
	value: string;
	label: string;
}

export const CONTACT_TOPICS: ContactTopic[] = [
	{ value: "start", label: "Getting started" },
	{ value: "account", label: "Account and sign-in" },
	{ value: "sorting", label: "Screener and sorting" },
	{ value: "ai", label: "Ask AI" },
	{ value: "domain", label: "Custom domain or DNS" },
	// Without domain purchase there's nothing to buy, so it's just billing.
	{ value: "billing", label: flags.domainPurchaseLive ? "Billing and domain purchase" : "Billing" },
	// Only while the iPhone app is a TestFlight beta.
	...(IOS_STATUS === "testflight" ? [{ value: "beta", label: "iPhone beta" }] : []),
	{ value: "broken", label: "Something’s broken" },
	{ value: "feedback", label: "Idea or feedback" },
	{ value: "security", label: "Security report" },
	{ value: "other", label: "Something else" },
];

export const topicLabel = (value: string): string | undefined => CONTACT_TOPICS.find((t) => t.value === value)?.label;
