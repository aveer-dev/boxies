// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Color } from "@tiptap/extension-color";
import TiptapImage from "@tiptap/extension-image";
import LinkExtension from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";
import { Indent } from "~/lib/tiptap-compose";

interface RichTextEditorProps {
	value: string;
	onChange: (value: string) => void;
	onEditorChange?: (editor: Editor | null) => void;
	showToolbar?: boolean;
}

export default function RichTextEditor({
	value,
	onChange,
	onEditorChange,
	showToolbar = false,
}: RichTextEditorProps) {
	const editor = useEditor({
		extensions: [
			StarterKit,
			Underline,
			TextAlign.configure({ types: ["heading", "paragraph"] }),
			LinkExtension.configure({ openOnClick: false }),
			TiptapImage,
			TextStyle,
			FontSize,
			Indent,
			Color,
		],
		content: value,
		editorProps: {
			attributes: {
				class:
					"prose prose-sm max-w-none focus:outline-none min-h-[180px] p-3 text-sm [&_blockquote]:border-l-2 [&_blockquote]:border-kumo-line [&_blockquote]:pl-3 [&_blockquote]:text-kumo-subtle [&_blockquote]:bg-kumo-tint [&_blockquote]:py-1 [&_blockquote]:my-2 [&_blockquote]:text-xs [&_blockquote]:rounded-r-sm",
			},
		},
		onUpdate: ({ editor }) => {
			onChange(editor.getHTML());
		},
	});

	useEffect(() => {
		onEditorChange?.(editor ?? null);
		return () => onEditorChange?.(null);
	}, [editor, onEditorChange]);

	useEffect(() => {
		if (editor && !editor.isDestroyed && value !== editor.getHTML()) {
			editor.commands.setContent(value);
			const rafId = requestAnimationFrame(() => {
				if (!editor.isDestroyed) {
					editor.commands.focus("start");
				}
			});
			return () => cancelAnimationFrame(rafId);
		}
	}, [value, editor]);

	if (!editor) return null;

	return (
		<div className={showToolbar ? "rounded-lg border border-kumo-line overflow-hidden flex flex-col h-full" : "flex flex-col h-full min-h-[180px]"}>
			<div className="flex-1 overflow-y-auto">
				<EditorContent editor={editor} />
			</div>
		</div>
	);
}
