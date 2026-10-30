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
	// The token rides in the query string, which Web Analytics drops (AVE-126);
	// old /invite/<token> links are rewritten (the Worker does it on page load).
	route("invite", "routes/invite.tsx"),
	route("invite/:token", "routes/invite-legacy.tsx"),
	route("login", "routes/login.tsx"),
	route("onboarding", "routes/onboarding.tsx"),
	route("reset-password", "routes/reset-password.tsx"),
	route("extension/connect", "routes/extension-connect.tsx"),
	// MCP OAuth consent; only the Worker's GET /authorize gives it data.
	route("authorize", "routes/authorize.tsx"),
	// Miller columns: each child route renders its own column(s); an optional
	// trailing :emailId opens the reader beside the list. :mailboxRef is the
	// mailbox's index in the user's list, never its address (AVE-126,
	// shared/mailbox-url.ts); read the real id with useMailboxId().
	route("mailbox/:mailboxRef", "routes/mailbox.tsx", [
		index("routes/mailbox-index.tsx"),
		// Built-in folders by name; tags (named by the user) by their index in
		// the mailbox's tag list, never their name (shared/tag-url.ts). Old
		// emails/<tag> links are rewritten to tags/<index>.
		route("emails/:folder/:emailId?", "routes/email-list.tsx"),
		route("tags/:tagRef/:emailId?", "routes/email-list.tsx", { id: "routes/tag-list" }),
		route("reply-later/:emailId?", "routes/reply-later.tsx"),
		route("new/:emailId?", "routes/inbox-new.tsx"),
		route("search/:emailId?", "routes/search-results.tsx"),
		// Settings is a side panel (useUIStore); old links open it.
		route("settings/:page?", "routes/settings.tsx"),
	]),
	route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
