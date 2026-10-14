// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Dialog } from "@cloudflare/kumo";
import type { ReactNode } from "react";

/** A small yes/no confirmation for destructive settings actions. */
export default function ConfirmDialog({
	open,
	title,
	description,
	confirmLabel,
	destructive = true,
	busy = false,
	onConfirm,
	onCancel,
}: {
	open: boolean;
	title: string;
	description: ReactNode;
	confirmLabel: string;
	destructive?: boolean;
	busy?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	return (
		<Dialog.Root
			role="alertdialog"
			open={open}
			onOpenChange={(next) => {
				if (!next && !busy) onCancel();
			}}
		>
			<Dialog size="sm" className="p-6">
				<Dialog.Title className="text-base font-semibold mb-2">{title}</Dialog.Title>
				<Dialog.Description className="text-sm text-kumo-subtle mb-5">
					{description}
				</Dialog.Description>
				<div className="flex justify-end gap-2">
					<Button variant="secondary" onClick={onCancel} disabled={busy}>
						Cancel
					</Button>
					<Button
						variant={destructive ? "destructive" : "primary"}
						onClick={onConfirm}
						loading={busy}
					>
						{confirmLabel}
					</Button>
				</div>
			</Dialog>
		</Dialog.Root>
	);
}
