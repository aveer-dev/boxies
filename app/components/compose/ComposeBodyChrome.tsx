// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import RichTextEditor from "~/components/RichTextEditor";
import type { PreparedAttachment } from "~/lib/prepare-compose-attachment";
import ComposeAttachChips from "./ComposeAttachChips";
import ComposeAttachSourceMenu from "./ComposeAttachSourceMenu";
import ComposeFormatAttachBar from "./ComposeFormatAttachBar";
import ComposeFormatSheet from "./ComposeFormatSheet";

export default function ComposeBodyChrome({
	body,
	onBodyChange,
	attachments,
	onAddFiles,
	onRemoveAttachment,
}: {
	body: string;
	onBodyChange: (html: string) => void;
	attachments: PreparedAttachment[];
	onAddFiles: (files: File[]) => void;
	onRemoveAttachment: (id: string) => void;
}) {
	const [editor, setEditor] = useState<Editor | null>(null);
	const [showFormat, setShowFormat] = useState(false);
	const [showAttachMenu, setShowAttachMenu] = useState(false);
	const photoInput = useRef<HTMLInputElement>(null);
	const fileInput = useRef<HTMLInputElement>(null);
	const [coarsePointer, setCoarsePointer] = useState(false);

	useEffect(() => {
		const media = window.matchMedia("(pointer: coarse)");
		const update = () => setCoarsePointer(media.matches);
		update();
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, []);

	const handleEditor = useCallback((next: Editor | null) => {
		setEditor(next);
	}, []);

	const onPicked = (list: FileList | null) => {
		if (!list?.length) return;
		onAddFiles(Array.from(list));
	};

	return (
		<div className="relative flex flex-col min-h-[220px]">
			<RichTextEditor value={body} onChange={onBodyChange} onEditorChange={handleEditor} />
			<ComposeAttachChips attachments={attachments} onRemove={onRemoveAttachment} />
			{showFormat ? (
				<div className="motion-safe:animate-[composeFormatIn_0.32s_ease-out] motion-reduce:animate-none">
					<ComposeFormatSheet editor={editor} onClose={() => setShowFormat(false)} />
				</div>
			) : (
				<ComposeFormatAttachBar
					onFormat={() => setShowFormat(true)}
					onAttach={() => {
						if (coarsePointer) {
							setShowAttachMenu(true);
						} else {
							fileInput.current?.click();
						}
					}}
				/>
			)}
			{showAttachMenu && (
				<ComposeAttachSourceMenu
					onPhotos={() => {
						photoInput.current?.click();
						setShowAttachMenu(false);
					}}
					onFiles={() => {
						fileInput.current?.click();
						setShowAttachMenu(false);
					}}
					onClose={() => setShowAttachMenu(false)}
				/>
			)}
			<input
				ref={photoInput}
				type="file"
				accept="image/*"
				multiple
				className="hidden"
				onChange={(e) => {
					onPicked(e.target.files);
					e.target.value = "";
				}}
			/>
			<input
				ref={fileInput}
				type="file"
				multiple
				className="hidden"
				onChange={(e) => {
					onPicked(e.target.files);
					e.target.value = "";
				}}
			/>
		</div>
	);
}
