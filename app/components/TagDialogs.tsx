// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Dialog, Input, useKumoToastManager } from "@cloudflare/kumo";
import { type ReactNode, useCallback, useState } from "react";
import { normalizeTagName, TAG_NAME_MAX, type TagRef } from "shared/tags";
import { Modal, ModalHeader } from "~/components/Modal";
import ConfirmDialog from "~/components/settings/ConfirmDialog";
import { useCreateTag, useDeleteTag, useRenameTag } from "~/queries/tags";

type Editing =
	| { kind: "create" }
	| { kind: "rename"; tag: TagRef }
	| { kind: "delete"; tag: TagRef }
	| null;

function TagNameDialog({
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
	const checked = normalizeTagName(name);
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
						label="Tag name"
						placeholder="e.g. Receipts"
						value={name}
						onChange={(e) => setName(e.target.value)}
						maxLength={TAG_NAME_MAX * 2}
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

/**
 * Create, rename and delete tags (AVE-241) from the sidebar or a tag view.
 * Returns the actions and the dialogs to render. Deleting a tag only removes
 * it from mail; no email is deleted.
 */
export function useTagEditor(mailboxId: string, { onDeleted }: { onDeleted?: (tag: TagRef) => void } = {}) {
	const [editing, setEditing] = useState<Editing>(null);
	const createTag = useCreateTag();
	const renameTag = useRenameTag();
	const deleteTag = useDeleteTag();
	const toastManager = useKumoToastManager();
	const close = useCallback(() => setEditing(null), []);
	const fail = (err: unknown, fallback: string) =>
		toastManager.add({ title: err instanceof Error ? err.message : fallback, variant: "error" });

	let dialogs: ReactNode = null;
	if (editing?.kind === "create") {
		dialogs = (
			<TagNameDialog
				key="create"
				open
				title="Create tag"
				initial=""
				submitLabel="Create"
				busy={createTag.isPending}
				onCancel={close}
				onSubmit={(name) =>
					createTag.mutate(
						{ mailboxId, name },
						// Keep the dialog open with the name so it can be fixed.
						{ onSuccess: close, onError: (err) => fail(err, "Couldn't create the tag") },
					)
				}
			/>
		);
	} else if (editing?.kind === "rename") {
		const { tag } = editing;
		dialogs = (
			<TagNameDialog
				key={`rename-${tag.id}`}
				open
				title="Rename tag"
				initial={tag.name}
				submitLabel="Rename"
				busy={renameTag.isPending}
				onCancel={close}
				onSubmit={(name) =>
					name === tag.name
						? close()
						: renameTag.mutate(
								{ mailboxId, tagId: tag.id, name },
								{ onSuccess: close, onError: (err) => fail(err, "Couldn't rename the tag") },
							)
				}
			/>
		);
	} else if (editing?.kind === "delete") {
		const { tag } = editing;
		dialogs = (
			<ConfirmDialog
				open
				title={`Delete “${tag.name}”?`}
				description="The tag comes off every email that has it. No email is deleted."
				confirmLabel="Delete tag"
				busy={deleteTag.isPending}
				onCancel={close}
				onConfirm={() =>
					deleteTag.mutate(
						{ mailboxId, tagId: tag.id },
						{
							onSuccess: () => {
								close();
								onDeleted?.(tag);
							},
							onError: (err) => fail(err, "Couldn't delete the tag"),
						},
					)
				}
			/>
		);
	}

	return {
		startCreate: useCallback(() => setEditing({ kind: "create" }), []),
		startRename: useCallback((tag: TagRef) => setEditing({ kind: "rename", tag }), []),
		startDelete: useCallback((tag: TagRef) => setEditing({ kind: "delete", tag }), []),
		dialogs,
	};
}
