// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Navigate, useLocation, useParams } from "react-router";
import { legacyInviteRedirect } from "shared/mailbox-url";

/**
 * Old `/invite/<token>` links: the Worker already redirects them on page load;
 * this covers one reached inside the app. `replace` keeps the token-in-path
 * URL out of history (AVE-126).
 */
export default function LegacyInviteRoute() {
	const { token = "" } = useParams<{ token: string }>();
	const { search } = useLocation();
	const target = legacyInviteRedirect(`/invite/${encodeURIComponent(token)}`, search) ?? "/";
	return <Navigate to={target} replace />;
}
