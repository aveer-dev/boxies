// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useCallback, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useMailboxId } from "~/hooks/useCurrentMailbox";
import EmailPanel from "~/components/EmailPanel";
import { useUIStore } from "~/hooks/useUIStore";
import { useShortcut } from "~/lib/shortcuts";

const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";
const DURATION = 440;

/** The transform that lays the sheet (at `to`) over the column (at `from`). */
function overColumn(from: DOMRect, to: DOMRect) {
	return `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A message popped out of its column: it morphs from the column into a
 * borderless sheet over a blurred, see-through canvas, its edges fading into
 * that blur. Esc, the sheet's ✕ or a click outside morphs it back.
 */
export default function PopOutReader() {
	const popOut = useUIStore((s) => s.popOut);
	if (!popOut || typeof document === "undefined") return null;
	return createPortal(
		<PopOutSheet key={popOut.emailId} emailId={popOut.emailId} from={popOut.from} />,
		document.body,
	);
}

function PopOutSheet({ emailId, from }: { emailId: string; from?: string }) {
	const mailboxId = useMailboxId();
	const closePopOut = useUIStore((s) => s.closePopOut);
	const sheetRef = useRef<HTMLDivElement>(null);
	const overlayRef = useRef<HTMLDivElement>(null);
	const closing = useRef(false);
	const columnRect = () =>
		from ? document.getElementById(`column-${from}`)?.getBoundingClientRect() : undefined;

	// In: grow out of the column while the canvas blurs away behind.
	useLayoutEffect(() => {
		const sheet = sheetRef.current;
		const overlay = overlayRef.current;
		if (!sheet || !overlay) return;
		const opener = document.activeElement as HTMLElement | null;
		sheet.focus({ preventScroll: true });
		// The canvas and dock go inert: focus and clicks stay in the sheet.
		const behind = Array.from(document.querySelectorAll<HTMLElement>(".column-canvas, [data-app-chrome]"));
		for (const el of behind) el.inert = true;

		overlay.animate({ opacity: [0, 1] }, { duration: 260, easing: "ease-out" });
		const src = columnRect();
		if (src && !reducedMotion()) {
			sheet.animate(
				[
					{ transform: overColumn(src, sheet.getBoundingClientRect()), opacity: 0.6 },
					{ transform: "none", opacity: 1 },
				],
				{ duration: DURATION, easing: EASE },
			);
		} else {
			sheet.animate({ opacity: [0, 1], transform: ["scale(0.97)", "none"] }, { duration: 220, easing: EASE });
		}
		return () => {
			for (const el of behind) el.inert = false;
			opener?.focus({ preventScroll: true });
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
	}, []);

	// Out: shrink back into the column (or just fade if it's gone), then unmount.
	const close = useCallback(() => {
		const sheet = sheetRef.current;
		const overlay = overlayRef.current;
		if (closing.current || !sheet || !overlay) return;
		closing.current = true;
		const src = columnRect();
		overlay.animate({ opacity: [1, 0] }, { duration: 300, easing: "ease-in", fill: "forwards" });
		const animation =
			src && !reducedMotion()
				? sheet.animate(
						[
							{ transform: "none", opacity: 1 },
							{ transform: overColumn(src, sheet.getBoundingClientRect()), opacity: 0 },
						],
						{ duration: 360, easing: EASE, fill: "forwards" },
					)
				: sheet.animate(
						{ opacity: [1, 0], transform: ["none", "scale(0.97)"] },
						{ duration: 180, easing: "ease-in", fill: "forwards" },
					);
		animation.finished.then(closePopOut, closePopOut);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- `from` is fixed per sheet
	}, [closePopOut]);

	// Esc closes the sheet before anything behind it.
	useShortcut("close", () => close(), { priority: 100 });
	useShortcut("popOut", () => close(), { priority: 100 });

	return (
		<div data-popout className="fixed inset-0 z-[90] flex items-center justify-center p-6 md:p-10">
			<div
				ref={overlayRef}
				aria-hidden
				onPointerDown={close}
				className="absolute inset-0 bg-[color-mix(in_srgb,var(--bg)_38%,transparent)] backdrop-blur-[18px] backdrop-saturate-150"
			/>
			<div
				ref={sheetRef}
				role="dialog"
				aria-modal="true"
				aria-label="Message"
				tabIndex={-1}
				className="popout-sheet relative flex h-full max-h-[920px] w-full max-w-[960px] flex-col bg-kumo-base outline-none"
			>
				<EmailPanel emailId={emailId} mailboxId={mailboxId} onClose={close} inPopOut />
			</div>
		</div>
	);
}
