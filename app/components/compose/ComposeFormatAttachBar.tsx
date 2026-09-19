// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { PaperclipIcon, TextAaIcon } from "@phosphor-icons/react";

export default function ComposeFormatAttachBar({
	onFormat,
	onAttach,
}: {
	onFormat: () => void;
	onAttach: () => void;
}) {
	return (
		<div className="flex justify-end px-3 pb-2 pt-1">
			<div className="flex items-center gap-1 rounded-full border border-kumo-line bg-kumo-base/95 shadow-sm px-1.5 py-1">
				<button
					type="button"
					onClick={onFormat}
					className="size-9 rounded-full flex items-center justify-center text-kumo-default hover:bg-kumo-recessed active:opacity-55"
					aria-label="Format"
				>
					<TextAaIcon size={18} />
				</button>
				<button
					type="button"
					onClick={onAttach}
					className="size-9 rounded-full flex items-center justify-center text-kumo-default hover:bg-kumo-recessed active:opacity-55"
					aria-label="Attach"
				>
					<PaperclipIcon size={18} />
				</button>
			</div>
		</div>
	);
}
