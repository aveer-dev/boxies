// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	DotsThreeIcon,
	PlusIcon,
	ShieldIcon,
	SignOutIcon,
	SquaresFourIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router";
import { OnboardingFlow } from "~/components/OnboardingFlow";
import { folderPath } from "~/hooks/useMailNavigation";
import { useInboxUnreadCounts } from "~/queries/folders";
import { queryKeys } from "~/queries/keys";
import { mailboxDisplayName } from "~/lib/mailbox-display";
import { useMailboxDetails, useMailboxes } from "~/queries/mailboxes";
import api from "~/services/api";
import ColumnMenu from "./ColumnMenu";
import ColumnPane from "./ColumnPane";

function formatCount(count: number) {
	return count > 999 ? "999+" : count.toLocaleString();
}

/** Column 1 — every mailbox the user can open ("Inboxies"). */
export default function AccountsColumn() {
	const { mailboxId: activeMailboxId } = useParams<{ mailboxId: string }>();
	const navigate = useNavigate();
	const { data: mailboxes = [], isLoading, refetch } = useMailboxes();
	const mailboxIds = mailboxes.map((m) => m.id);
	const unread = useInboxUnreadCounts(mailboxIds);
	const details = useMailboxDetails(mailboxIds);
	const [isAddOpen, setIsAddOpen] = useState(false);

	const { data: config } = useQuery({
		queryKey: queryKeys.config,
		queryFn: () => api.getConfig(),
		staleTime: Number.POSITIVE_INFINITY,
	});
	const { data: me } = useQuery({
		queryKey: ["me"],
		queryFn: () => api.getMe(),
		staleTime: 60_000,
	});
	const mailDomain = config?.mailDomain ?? config?.domains?.[0] ?? "";

	const menuItems = [
		{
			label: "All mailboxes",
			icon: <SquaresFourIcon size={16} />,
			onSelect: () => navigate("/"),
		},
		...(me?.isAdmin
			? [
					{
						label: "Admin",
						icon: <ShieldIcon size={16} />,
						onSelect: () => navigate("/admin"),
					},
				]
			: []),
		{
			label: "Log out",
			icon: <SignOutIcon size={16} />,
			onSelect: () => {
				window.location.href = "/cdn-cgi/access/logout";
			},
		},
	];

	return (
		<ColumnPane
			id="accounts"
			title="Inboxies"
			isRoot
			actions={
				<>
					<button
						type="button"
						onClick={() => setIsAddOpen(true)}
						className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs text-kumo-subtle hover:text-kumo-default hover:bg-kumo-tint transition-colors"
					>
						<PlusIcon size={12} />
						Add
					</button>
					<ColumnMenu
						label="Account menu"
						trigger={<DotsThreeIcon size={16} weight="bold" />}
						items={menuItems}
					/>
				</>
			}
			bodyClassName="py-1.5"
		>
			{isLoading && mailboxes.length === 0 ? (
				<div className="px-4 py-2 space-y-4 animate-pulse">
					{[1, 2, 3].map((i) => (
						<div key={i} className="space-y-1.5 pl-4">
							<div className="h-3 w-28 bg-kumo-fill rounded" />
							<div className="h-2.5 w-36 bg-kumo-fill rounded" />
						</div>
					))}
				</div>
			) : (
				<nav aria-label="Mailboxes" className="px-2 space-y-0.5">
					{mailboxes.map((mailbox) => {
						const isActive = mailbox.id === activeMailboxId;
						const count = unread[mailbox.id] ?? 0;
						return (
							<NavLink
								key={mailbox.id}
								to={folderPath(mailbox.id, "inbox")}
								aria-current={isActive ? "page" : undefined}
								className={`flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors ${
									isActive ? "bg-kumo-fill" : "hover:bg-kumo-tint"
								}`}
							>
								<span
									className={`h-1.5 w-1.5 rounded-full shrink-0 ${
										isActive ? "bg-kumo-contrast" : "bg-kumo-line"
									}`}
								/>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-sm leading-5 text-kumo-default">
										{mailboxDisplayName(details[mailbox.id] ?? mailbox)}
									</span>
									<span className="block truncate text-xs text-kumo-subtle">
										{mailbox.email}
									</span>
								</span>
								{count > 0 && (
									<span className="shrink-0 text-[11px] text-kumo-subtle tabular-nums">
										{formatCount(count)}
									</span>
								)}
							</NavLink>
						);
					})}
				</nav>
			)}

			<OnboardingFlow
				isOpen={isAddOpen}
				onClose={() => setIsAddOpen(false)}
				mailDomain={mailDomain}
				onSuccess={async (mailboxId) => {
					setIsAddOpen(false);
					await refetch();
					navigate(folderPath(mailboxId, "inbox"));
				}}
			/>
		</ColumnPane>
	);
}
