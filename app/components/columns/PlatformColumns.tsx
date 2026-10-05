// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useState } from "react";
import AgentSidebar from "~/components/AgentSidebar";
import ComposePanel from "~/components/ComposePanel";
import { useColumnStack } from "~/hooks/useColumnStack";
import { useSearchEmails } from "~/queries/search";
import SettingsRoute from "~/routes/settings";
import ColumnPane from "./ColumnPane";

export function SettingsColumn({ columnId }: { columnId: string }) {
	return (
		<ColumnPane
			id={columnId}
			title="Settings"
			width={540}
			closable={true}
			contentClassName="overflow-y-auto"
		>
			<SettingsRoute />
		</ColumnPane>
	);
}

export function ComposeColumn({ columnId }: { columnId: string }) {
	return (
		<ColumnPane
			id={columnId}
			title="New Message"
			width={560}
			closable={true}
			contentClassName="h-full flex flex-col"
		>
			<ComposePanel />
		</ColumnPane>
	);
}

export function AgentColumn({ columnId }: { columnId: string }) {
	return (
		<ColumnPane
			id={columnId}
			title="Agent Assistant"
			width={380}
			closable={true}
			contentClassName="h-full flex flex-col"
		>
			<AgentSidebar />
		</ColumnPane>
	);
}

export function SearchColumn({
	columnId,
	initialQuery = "",
}: {
	columnId: string;
	initialQuery?: string;
}) {
	const [query, setQuery] = useState(initialQuery);
	const { selectedMailboxId, selectThread } = useColumnStack();

	const { data: searchResults = [], isLoading } = useSearchEmails(
		selectedMailboxId || undefined,
		query,
	);

	return (
		<ColumnPane
			id={columnId}
			title="Search"
			width={460}
			closable={true}
			contentClassName="flex flex-col h-full"
		>
			<div className="p-3 border-b border-kumo-line bg-kumo-base shrink-0">
				<div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-kumo-elevated border border-kumo-line">
					<MagnifyingGlassIcon size={14} className="text-kumo-subtle shrink-0" />
					<input
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search emails..."
						className="w-full bg-transparent text-xs text-kumo-default focus:outline-none"
					/>
				</div>
			</div>

			<div className="flex-1 overflow-y-auto divide-y divide-kumo-line/50">
				{isLoading ? (
					<div className="p-4 text-xs text-kumo-subtle text-center">Searching...</div>
				) : searchResults.length === 0 ? (
					<div className="p-6 text-xs text-kumo-subtle text-center">
						{query ? "No emails found matching your query." : "Type a query to search messages."}
					</div>
				) : (
					searchResults.map((email) => (
						<button
							key={email.id}
							type="button"
							onClick={() => selectThread(email.id, email.subject)}
							className="w-full text-left p-3 hover:bg-kumo-tint transition-colors text-xs space-y-1"
						>
							<div className="flex items-center justify-between text-kumo-strong font-medium">
								<span className="truncate">{email.sender}</span>
								<span className="text-[10px] text-kumo-subtle font-mono">{email.date}</span>
							</div>
							<div className="text-kumo-default truncate font-medium">
								{email.subject || "(no subject)"}
							</div>
							<div className="text-[11px] text-kumo-subtle truncate">
								{email.body?.slice(0, 100) || "No preview"}
							</div>
						</button>
					))
				)}
			</div>
		</ColumnPane>
	);
}
