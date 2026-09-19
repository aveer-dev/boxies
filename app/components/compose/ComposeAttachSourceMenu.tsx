// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { FileIcon, ImageIcon } from "@phosphor-icons/react";

export default function ComposeAttachSourceMenu({
	onPhotos,
	onFiles,
	onClose,
}: {
	onPhotos: () => void;
	onFiles: () => void;
	onClose: () => void;
}) {
	return (
		<div className="fixed inset-0 z-50" onClick={onClose} role="presentation">
			<div
				className="absolute bottom-20 right-4 w-56 rounded-2xl border border-kumo-line bg-kumo-base shadow-lg overflow-hidden"
				onClick={(e) => e.stopPropagation()}
			>
				<button
					type="button"
					className="w-full flex items-center gap-3 px-4 py-3 text-sm text-kumo-default hover:bg-kumo-recessed"
					onClick={onPhotos}
				>
					<ImageIcon size={18} />
					Photo library
				</button>
				<button
					type="button"
					className="w-full flex items-center gap-3 px-4 py-3 text-sm text-kumo-default hover:bg-kumo-recessed border-t border-kumo-line"
					onClick={onFiles}
				>
					<FileIcon size={18} />
					Files
				</button>
			</div>
		</div>
	);
}
