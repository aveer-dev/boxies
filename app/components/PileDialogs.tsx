// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Dialog, Input, useKumoToastManager } from "@cloudflare/kumo";
import { type ReactNode, useCallback, useState } from "react";
import { normalizePileName, PILE_NAME_MAX } from "shared/piles";
import { Modal, ModalHeader } from "~/components/Modal";
import ConfirmDialog from "~/components/settings/ConfirmDialog";
import { useMailboxId } from "~/hooks/useCurrentMailbox";
import { useReplyLater } from "~/hooks/useReplyLater";
import { useUIStore } from "~/hooks/useUIStore";
import { useCreatePile, useDeletePile, useRenamePile } from "~/queries/piles";

/** A pile the editor can rename or delete (custom piles only, AVE-194). */
export interface PileRef {
	id: string;
	name: string;
}

function PileNameDialog({
	open,
	title,
	initial,
	submitLabel,
	busy,
	onSubmit,
	onCancel,
}: {
	open: boolean;
	title: string;
	initial: string;
	submitLabel: string;
	busy: boolean;
	onSubmit: (name: string) => void;
	onCancel: () => void;
}) {
	const [name, setName] = useState(initial);
	const checked = normalizePileName(name);
	return (
		<Dialog.Root
			open={open}
			onOpenChange={(next) => {
				if (!next && !busy) onCancel();
			}}
		>
			<Modal size="sm">
				<ModalHeader title={title} />
				<form
					className="space-y-4"
					onSubmit={(e) => {
						e.preventDefault();
						if (checked.ok) onSubmit(checked.name);
					}}
				>
					<Input
						label="Pile name"
						placeholder="e.g. Waiting on"
						value={name}
						onChange={(e) => setName(e.target.value)}
						maxLength={PILE_NAME_MAX * 2}
						autoFocus
						required
					/>
					{!checked.ok && name.trim() !== "" && (
						<p className="-mt-2 text-xs text-kumo-danger">{checked.error}</p>
					)}
					<div className="flex justify-end gap-2">
						<Button variant="secondary" onClick={onCancel} disabled={busy}>
							Cancel
						</Button>
						<Button type="submit" variant="primary" loading={busy} disabled={!checked.ok}>
							{submitLabel}
						</Button>
					</div>
				</form>
			</Modal>
		</Dialog.Root>
	);
}

function errorTitle(err: unknown, fallback: string) {
	return err instanceof Error ? err.message : fallback;
}

/**
 * "New pile" (AVE-194), opened from the sidebar's + or a "New pile…" menu
 * item (`useUIStore.openPileCreator`). From a message, the message goes
 * into the new pile. Mounted once per mailbox (routes/mailbox.tsx).
 */
export function PileCreateDialog() {
	const mailboxId = useMailboxId();
	const creator = useUIStore((s) => s.pileCreator);
	const closeCreator = useUIStore((s) => s.closePileCreator);
	const createPile = useCreatePile();
	const { setPile } = useReplyLater(mailboxId);
	const toastManager = useKumoToastManager();
	if (!creator || !mailboxId) return null;
	return (
		<PileNameDialog
			key="create-pile"
			open
			title="New pile"
			initial=""
			submitLabel="Create"
			busy={createPile.isPending}
			onCancel={closeCreator}
			onSubmit={(name) =>
				createPile.mutate(
					{ mailboxId, name },
					{
						onSuccess: (pile) => {
							closeCreator();
							if (creator.email) setPile(creator.email, { id: pile.id, name: pile.name });
							else toastManager.add({ title: `Made ${pile.name}` });
						},
						// Keep the dialog open with the name so it can be fixed.
						onError: (err) =>
							toastManager.add({ title: errorTitle(err, "Couldn't make the pile"), variant: "error" }),
					},
				)
			}
		/>
	);
}

type Editing = { kind: "rename"; pile: PileRef } | { kind: "delete"; pile: PileRef } | null;

/**
 * Rename and delete a custom pile (AVE-194) from the sidebar or its view.
 * Deleting a pile only takes its mail out of it; no email is deleted.
 */
export function usePileEditor(mailboxId: string, { onDeleted }: { onDeleted?: (pile: PileRef) => void } = {}) {
	const [editing, setEditing] = useState<Editing>(null);
	const renamePile = useRenamePile();
	const deletePile = useDeletePile();
	const toastManager = useKumoToastManager();
	const close = useCallback(() => setEditing(null), []);
	const fail = (err: unknown, fallback: string) =>
		toastManager.add({ title: errorTitle(err, fallback), variant: "error" });

	let dialogs: ReactNode = null;
	if (editing?.kind === "rename") {
		const { pile } = editing;
		dialogs = (
			<PileNameDialog
				key={`rename-${pile.id}`}
				open
				title="Rename pile"
				initial={pile.name}
				submitLabel="Rename"
				busy={renamePile.isPending}
				onCancel={close}
				onSubmit={(name) =>
					name === pile.name
						? close()
						: renamePile.mutate(
								{ mailboxId, pileId: pile.id, name },
								{ onSuccess: close, onError: (err) => fail(err, "Couldn't rename the pile") },
							)
				}
			/>
		);
	} else if (editing?.kind === "delete") {
		const { pile } = editing;
		dialogs = (
			<ConfirmDialog
				open
				title={`Delete “${pile.name}”?`}
				description="Mail in this pile comes out of it and stays where it is. No email is deleted."
				confirmLabel="Delete pile"
				busy={deletePile.isPending}
				onCancel={close}
				onConfirm={() =>
					deletePile.mutate(
						{ mailboxId, pileId: pile.id },
						{
							onSuccess: () => {
								close();
								onDeleted?.(pile);
							},
							onError: (err) => fail(err, "Couldn't delete the pile"),
						},
					)
				}
			/>
		);
	}

	return {
		startRename: useCallback((pile: PileRef) => setEditing({ kind: "rename", pile }), []),
		startDelete: useCallback((pile: PileRef) => setEditing({ kind: "delete", pile }), []),
		dialogs,
	};
}
