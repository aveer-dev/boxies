// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { CaretDownIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { quoteDate, quoteSender } from "shared/quoted-html";
import { blocksRemoteImages } from "shared/remote-images";
import EmailIframe from "~/components/EmailIframe";
import type { Email } from "~/types";

/**
 * The message a reply / forward quotes, rendered like the reader renders it
 * (same sandboxed iframe, same remote-image rule) under the editor. It is not
 * editable: the Worker appends this original, sanitised, to the sent mail
 * (AVE-133), so what you see here is what the recipient gets.
 */
export default function ComposeQuotedOriginal({
	original,
	mode,
}: {
	original: Email;
	mode: "reply" | "forward";
}) {
	const [open, setOpen] = useState(true);
	const timeZone = useMemo(() => {
		try {
			return Intl.DateTimeFormat().resolvedOptions().timeZone;
		} catch {
			return undefined;
		}
	}, []);
	const date = quoteDate(original.date, { timeZone });
	const sender = quoteSender(original);
	const header =
		mode === "forward"
			? ["---------- Forwarded message ---------", `From: ${sender}`, `Date: ${date}`, `Subject: ${original.subject ?? ""}`, `To: ${original.recipient ?? ""}`]
			: [`On ${date}, ${sender} wrote:`];

	return (
		<div className="border-t border-kumo-line" data-testid="compose-quoted-original">
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				aria-expanded={open}
				className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-kumo-subtle hover:text-kumo-default"
			>
				<span className="min-w-0 flex-1 truncate">
					{open ? (mode === "forward" ? "Forwarded message" : "Quoted message") : header[header.length > 1 ? 1 : 0]}
				</span>
				<span className="shrink-0">{open ? "Hide" : "Show quoted text"}</span>
				<CaretDownIcon
					size={12}
					className={`shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
				/>
			</button>
			{open ? (
				<div className="px-3 pb-3">
					<div className="mb-2 text-xs leading-5 text-kumo-subtle">
						{header.map((line) => (
							<div key={line} className="break-words">
								{line}
							</div>
						))}
					</div>
					<div className={mode === "reply" ? "border-l-2 border-kumo-line pl-3" : undefined}>
						<EmailIframe
							body={original.body || ""}
							autoSize
							blockRemoteImages={blocksRemoteImages(original.folder_id)}
						/>
					</div>
				</div>
			) : null}
		</div>
	);
}
