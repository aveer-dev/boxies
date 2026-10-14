// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	AddressBookIcon,
	ArrowBendUpLeftIcon,
	FunnelSimpleIcon,
	KeyIcon,
	PaperPlaneTiltIcon,
	UsersThreeIcon,
} from "@phosphor-icons/react";
import { type ComponentType, lazy, type ReactNode } from "react";
import PrivateEmailLogo from "~/components/PrivateEmailLogo";

export const SETTINGS_PAGE_IDS = [
	"aliases",
	"forwarding",
	"auto-reply",
	"filters",
	"senders",
	"sharing",
	"sign-in",
] as const;

export type SettingsPageId = (typeof SETTINGS_PAGE_IDS)[number];

export function isSettingsPageId(value: string | undefined): value is SettingsPageId {
	return (SETTINGS_PAGE_IDS as readonly string[]).includes(value ?? "");
}

export interface SettingsPage {
	id: SettingsPageId;
	label: string;
	description: string;
	icon: ReactNode;
	Component: ComponentType;
}

/** Each sub-page opens in its own column beside Settings (lazy: some are large). */
export const SETTINGS_PAGES: Record<SettingsPageId, SettingsPage> = {
	aliases: {
		id: "aliases",
		label: "Private email",
		description: "Random addresses that keep your real one hidden",
		icon: <PrivateEmailLogo size={18} />,
		Component: lazy(() => import("./AliasesSettings")),
	},
	forwarding: {
		id: "forwarding",
		label: "Forwarding",
		description: "Send a copy of incoming mail to another address",
		icon: <PaperPlaneTiltIcon size={18} />,
		Component: lazy(() => import("./ForwardingSettings")),
	},
	"auto-reply": {
		id: "auto-reply",
		label: "Auto-reply",
		description: "Automatically reply to new personal messages",
		icon: <ArrowBendUpLeftIcon size={18} />,
		Component: lazy(() => import("./AutoReplySettings")),
	},
	filters: {
		id: "filters",
		label: "Filters",
		description: "File, skip auto-draft, or forward matching mail",
		icon: <FunnelSimpleIcon size={18} />,
		Component: lazy(() => import("./FiltersSettings")),
	},
	senders: {
		id: "senders",
		label: "Senders",
		description: "Default Inbox, Promotions, or Updates per sender",
		icon: <AddressBookIcon size={18} />,
		Component: lazy(() => import("./SendersSettings")),
	},
	sharing: {
		id: "sharing",
		label: "Sharing",
		description: "Owners and members who can access this mailbox",
		icon: <UsersThreeIcon size={18} />,
		Component: lazy(() => import("./SharingSettings")),
	},
	"sign-in": {
		id: "sign-in",
		label: "Sign-in methods",
		description: "Apple, Google, password, and linked devices",
		icon: <KeyIcon size={18} />,
		Component: lazy(() => import("./SignInSettings")),
	},
};

/** Listed under "Incoming mail" in the Settings column. */
export const INCOMING_MAIL_PAGES: SettingsPageId[] = [
	"aliases",
	"forwarding",
	"auto-reply",
	"filters",
	"senders",
	"sharing",
];
