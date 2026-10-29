// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Dialog } from "@cloudflare/kumo";
import { Dialog as DialogPrimitive } from "@cloudflare/kumo/primitives/dialog";
import { XIcon } from "@phosphor-icons/react";
import { type ReactNode, useRef } from "react";
import { IconButton } from "~/components/IconButton";

const WIDTH = {
	sm: "max-w-[400px]",
	md: "max-w-[520px]",
	lg: "max-w-[640px]",
	xl: "max-w-[800px]",
} as const;

export type ModalSize = keyof typeof WIDTH;

/**
 * The one modal shell for the web app, styled like the popped-out message
 * (`PopOutReader`): the canvas behind blurs and turns see-through, and the
 * sheet is borderless, its edges fading into that blur (`.modal-sheet` in
 * index.css shares the pop-out's mask). Drop-in for Kumo's `<Dialog>` popup:
 * keep `Dialog.Root` (open / onOpenChange / role) around it, and start the
 * content with `ModalHeader` for the title and the ✕.
 */
export function Modal({
	size = "sm",
	className = "",
	children,
}: {
	size?: ModalSize;
	className?: string;
	children: ReactNode;
}) {
	// Focus lands on the sheet itself, like the pop-out, not on the ✕ (which
	// would open with its tooltip and focus ring showing). Tab still reaches it.
	const sheetRef = useRef<HTMLDivElement>(null);
	return (
		<DialogPrimitive.Portal>
			<DialogPrimitive.Backdrop className="modal-backdrop fixed inset-0 bg-[color-mix(in_srgb,var(--bg)_38%,transparent)] backdrop-blur-[18px] backdrop-saturate-150" />
			<DialogPrimitive.Popup
				ref={sheetRef}
				initialFocus={sheetRef}
				tabIndex={-1}
				className={`modal-sheet fixed top-1/2 left-1/2 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto bg-kumo-base text-kumo-default outline-none ${WIDTH[size]} ${className}`}
			>
				{children}
			</DialogPrimitive.Popup>
		</DialogPrimitive.Portal>
	);
}

/**
 * Title row of a `Modal`: title, optional description, and the same ✕ as the
 * pop-out (Esc closes too).
 */
export function ModalHeader({
	title,
	description,
	closeLabel = "Close",
	className = "",
}: {
	title: ReactNode;
	description?: ReactNode;
	closeLabel?: string;
	className?: string;
}) {
	return (
		<div className={`mb-4 flex items-start gap-3 ${className}`}>
			<div className="min-w-0 flex-1 pt-1">
				<Dialog.Title className="flex items-center gap-2 text-base font-semibold text-kumo-default">
					{title}
				</Dialog.Title>
				{description != null && (
					<Dialog.Description className="mt-1 text-sm text-kumo-subtle">{description}</Dialog.Description>
				)}
			</div>
			<Dialog.Close
				render={(props) => (
					<IconButton {...props} label={closeLabel} shortcut="Esc" icon={XIcon} size="md" close className="-mr-1.5" />
				)}
			/>
		</div>
	);
}
