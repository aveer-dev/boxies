// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { ReactNode } from "react";
import { ColumnHeader } from "~/components/columns/ColumnPane";
import { useMailNavigation } from "~/hooks/useMailNavigation";

/** Body of a settings sub-page column, opened beside the Settings column. */
export default function SettingsSubpage({
	title,
	children,
}: {
	mailboxId: string;
	title: string;
	children: ReactNode;
}) {
	const { closeSettingsPage } = useMailNavigation();
	return (
		<>
			<div className="sticky top-0 z-10">
				<ColumnHeader
					title={title}
					onClose={closeSettingsPage}
					closeLabel={`Close ${title}`}
				/>
			</div>
			<div className="max-w-2xl px-4 py-4 md:px-6 md:py-5">{children}</div>
		</>
	);
}
