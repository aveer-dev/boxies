// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { DotsThreeIcon, PencilSimpleIcon, StackIcon, TrashIcon } from "@phosphor-icons/react";
import { Navigate, useNavigate, useParams } from "react-router";
import { Folders } from "shared/folders";
import ColumnMenu from "~/components/columns/ColumnMenu";
import { ListEmptyState } from "~/components/columns/ListParts";
import PileColumn from "~/components/columns/PileColumn";
import { usePileEditor } from "~/components/PileDialogs";
import { useMailboxId, useMailboxRef } from "~/hooks/useCurrentMailbox";
import { folderPath, pilePath } from "~/hooks/useMailNavigation";
import { useUIStore } from "~/hooks/useUIStore";
import { isBuiltinPile } from "~/lib/piles";
import { useWorkflowPiles } from "~/queries/folders";

/**
 * Column 3 for `/piles/:pileId` (+ the reader for `:emailId`): a pile
 * someone made (AVE-194), like "Waiting on" or "To pay". It works like Set
 * Aside: mail stays until you take it out; replying doesn't clear it.
 */
export default function PileRoute() {
	const { pileId = "" } = useParams<{ pileId: string }>();
	const mailboxId = useMailboxId();
	const mailboxRef = useMailboxRef();
	const navigate = useNavigate();
	const isReadOnly = useUIStore((s) => s.isReadOnly);
	const { data: piles, isSuccess } = useWorkflowPiles(mailboxId);
	const pile = piles?.find((p) => p.id === pileId);
	const editor = usePileEditor(mailboxId, {
		onDeleted: () => navigate(folderPath(mailboxRef, Folders.INBOX)),
	});

	// Built-in piles have their own routes.
	if (isBuiltinPile(pileId)) return <Navigate to={pilePath(mailboxRef, pileId)} replace />;

	const name = pile?.name ?? "";
	const missing = isSuccess && !pile;
	const ref = pile ? { id: pile.id, name } : null;

	return (
		<>
			<PileColumn
				pileId={pileId}
				title={missing ? "Pile not found" : name}
				icon={StackIcon}
				emptyTitle={`Nothing in ${name || "this pile"}`}
				emptyDescription="Put mail here from a message's Piles button or a row's menu. It stays until you take it out."
				removeLabel={`Remove from ${name || "pile"}`}
				onRemove={(email, actions) => actions.setPile(email, null)}
				missing={
					missing ? (
						<ListEmptyState
							icon={<StackIcon size={40} weight="thin" className="text-kumo-subtle" />}
							title="This pile no longer exists"
							description="It may have been deleted on another device. The mail that was in it is still in its folders."
						/>
					) : undefined
				}
				menu={
					ref && !isReadOnly ? (
						<ColumnMenu
							label="Pile options"
							heading={name}
							icon={DotsThreeIcon}
							weight="bold"
							items={[
								{ label: "Rename…", icon: PencilSimpleIcon, onSelect: () => editor.startRename(ref) },
								{ label: "Delete pile", icon: TrashIcon, onSelect: () => editor.startDelete(ref) },
							]}
						/>
					) : undefined
				}
			/>
			{editor.dialogs}
		</>
	);
}
