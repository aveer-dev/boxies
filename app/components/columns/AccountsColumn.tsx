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
import { Tip } from "~/components/IconButton";
import { AddMailboxDialog } from "~/components/AddMailboxDialog";
import { folderPath } from "~/hooks/useMailNavigation";
import { slidingMarkClass, useSlidingHighlight } from "~/hooks/useSlidingHighlight";
import { useInboxUnreadCounts } from "~/queries/folders";
import { queryKeys } from "~/queries/keys";
import { SHOW_ALL_MAILBOXES_STATE } from "~/lib/last-mailbox";
import { mailboxDisplayName } from "~/lib/mailbox-display";
import { signOut } from "~/lib/sign-out";
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
	// NavLink only marks the inbox route current; the mailbox stays current in any folder.
	const { railRef, markRef } = useSlidingHighlight<HTMLElement>(
		`${activeMailboxId}:${mailboxes.length}`,
		'[data-current="true"]',
	);

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
			icon: SquaresFourIcon,
			onSelect: () => navigate("/", { state: SHOW_ALL_MAILBOXES_STATE }),
		},
		...(me?.isAdmin
			? [
					{
						label: "Admin",
						icon: ShieldIcon,
						onSelect: () => navigate("/admin"),
					},
				]
			: []),
		{
			label: "Log out",
			icon: SignOutIcon,
			onSelect: () => void signOut(),
		},
	];

	return (
		<ColumnPane
			id="accounts"
			title="Inboxies"
			isRoot
			actions={
				<>
					<Tip label="Add a mailbox">
						<button
							type="button"
							onClick={() => setIsAddOpen(true)}
							className="group/add inline-flex h-7 items-center gap-1 px-2 rounded-lg text-xs font-medium text-kumo-subtle hover:text-kumo-default hover:bg-kumo-tint"
						>
							<PlusIcon size={14} className="transition-transform duration-200 group-hover/add:rotate-90" />
							Add
						</button>
					</Tip>
					<ColumnMenu
						label="Account menu"
						icon={DotsThreeIcon}
						weight="bold"
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
				<nav ref={railRef} aria-label="Mailboxes" className="relative mx-2 space-y-1">
					<span ref={markRef} aria-hidden className={slidingMarkClass} />
					{mailboxes.map((mailbox) => {
						const isActive = mailbox.id === activeMailboxId;
						const count = unread[mailbox.id] ?? 0;
						return (
							<NavLink
								key={mailbox.id}
								to={folderPath(mailbox.id, "inbox")}
								aria-current={isActive ? "page" : undefined}
								data-current={isActive}
								className={`relative flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors duration-150 ${
									isActive ? "" : "hover:bg-kumo-tint"
								}`}
							>
								<span
									className={`h-1.5 w-1.5 rounded-full shrink-0 transition-[background-color,scale] duration-300 ease-[var(--spring)] ${
										isActive ? "bg-kumo-contrast scale-125" : "bg-[var(--border-card)]"
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
									<span className="shrink-0 text-xs text-kumo-subtle tabular-nums">
										{formatCount(count)}
									</span>
								)}
							</NavLink>
						);
					})}
				</nav>
			)}

			<AddMailboxDialog
				isOpen={isAddOpen}
				onClose={() => setIsAddOpen(false)}
				mailDomain={mailDomain}
				isAdmin={Boolean(me?.isAdmin)}
				onSuccess={async (mailboxId) => {
					setIsAddOpen(false);
					await refetch();
					navigate(folderPath(mailboxId, "inbox"));
				}}
			/>
		</ColumnPane>
	);
}
