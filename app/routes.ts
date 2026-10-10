// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	index,
	type RouteConfig,
	route,
} from "@react-router/dev/routes";

export default [
	index("routes/home.tsx"),
	route("admin", "routes/admin.tsx"),
	route("checkout/mock", "routes/checkout-mock.tsx"),
	route("checkout/success", "routes/checkout-success.tsx"),
	route("checkout/cancel", "routes/checkout-cancel.tsx"),
	route("invite/:token", "routes/invite.tsx"),
	route("login", "routes/login.tsx"),
	route("reset-password", "routes/reset-password.tsx"),
	// Miller columns: each child route renders its own column(s); an optional
	// trailing :emailId opens the reader beside the list.
	route("mailbox/:mailboxId", "routes/mailbox.tsx", [
		index("routes/mailbox-index.tsx"),
		route("emails/:folder/:emailId?", "routes/email-list.tsx"),
		route("reply-later/:emailId?", "routes/reply-later.tsx"),
		route("search/:emailId?", "routes/search-results.tsx"),
		route("settings", "routes/settings.tsx", [
			route("forwarding", "routes/settings-forwarding.tsx"),
			route("auto-reply", "routes/settings-auto-reply.tsx"),
			route("filters", "routes/settings-filters.tsx"),
			route("senders", "routes/settings-senders.tsx"),
			route("sharing", "routes/settings-sharing.tsx"),
			route("sign-in", "routes/settings-sign-in.tsx"),
			route("aliases", "routes/settings-aliases.tsx"),
		]),
	]),
	route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
