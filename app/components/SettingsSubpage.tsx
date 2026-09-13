// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { CaretLeftIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Link } from "react-router";

export default function SettingsSubpage({
	mailboxId,
	title,
	children,
}: {
	mailboxId: string;
	title: string;
	children: ReactNode;
}) {
	return (
		<div className="max-w-2xl px-4 py-4 md:px-8 md:py-6 h-full overflow-y-auto">
			<Link
				to={`/mailbox/${mailboxId}/settings`}
				className="inline-flex items-center gap-1 text-sm text-kumo-subtle hover:text-kumo-default mb-4"
			>
				<CaretLeftIcon size={14} />
				Settings
			</Link>
			<h1 className="text-lg font-semibold text-kumo-default mb-4">{title}</h1>
			{children}
		</div>
	);
}
