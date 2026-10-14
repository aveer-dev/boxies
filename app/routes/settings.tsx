// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useEffect } from "react";
import { Navigate, useParams } from "react-router";
import { Folders } from "shared/folders";
import { isSettingsPageId } from "~/components/settings/pages";
import { folderPath } from "~/hooks/useMailNavigation";
import { useUIStore } from "~/hooks/useUIStore";

/**
 * Old `/settings/:page?` links: settings is a panel now (it opens beside the
 * mail columns), so open it and land on the inbox.
 */
export default function SettingsRedirectRoute() {
	const { mailboxId = "", page } = useParams<{ mailboxId: string; page?: string }>();
	const openSettings = useUIStore((s) => s.openSettings);
	useEffect(() => {
		openSettings(isSettingsPageId(page) ? page : null);
	}, [openSettings, page]);
	return <Navigate to={folderPath(mailboxId, Folders.INBOX)} replace />;
}
