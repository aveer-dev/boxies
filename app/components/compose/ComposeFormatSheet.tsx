// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button } from "@cloudflare/kumo";
import {
	ListBulletsIcon,
	ListNumbersIcon,
	TextAlignCenterIcon,
	TextAlignLeftIcon,
	TextAlignRightIcon,
	TextBIcon,
	TextIndentIcon,
	TextItalicIcon,
	TextOutdentIcon,
	TextStrikethroughIcon,
	TextUnderlineIcon,
	XIcon,
} from "@phosphor-icons/react";
import type { Editor } from "@tiptap/react";
import {
	applyParagraphStyle,
	bumpFontSize,
	currentFontSize,
	currentParagraphStyle,
	useEditorTick,
	type ParagraphStyle,
} from "~/lib/compose-format";

const STYLES: { id: ParagraphStyle; label: string }[] = [
	{ id: "title", label: "Title" },
	{ id: "subtitle", label: "Subtitle" },
	{ id: "body", label: "Body" },
	{ id: "caption", label: "Caption" },
];

function ToolButton({
	active,
	label,
	onClick,
	children,
}: {
	active?: boolean;
	label: string;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={active}
			onClick={onClick}
			className={`h-11 flex-1 rounded-full flex items-center justify-center text-sm font-medium ${
				active ? "bg-kumo-fill text-kumo-default" : "bg-kumo-recessed text-kumo-default"
			}`}
		>
			{children}
		</button>
	);
}

export default function ComposeFormatSheet({
	editor,
	onClose,
}: {
	editor: Editor | null;
	onClose: () => void;
}) {
	useEditorTick(editor);
	if (!editor) return null;

	const style = currentParagraphStyle(editor);
	const size = currentFontSize(editor);
	const color = String(editor.getAttributes("textStyle").color || "#1f1f24");

	return (
		<div className="rounded-t-2xl border border-kumo-line bg-kumo-base shadow-lg p-4 pb-5">
			<div className="flex items-center justify-between mb-4">
				<h3 className="text-xl font-semibold text-kumo-default">Format</h3>
				<Button
					type="button"
					variant="ghost"
					shape="square"
					size="sm"
					icon={<XIcon size={18} />}
					onClick={onClose}
					aria-label="Close format"
				/>
			</div>

			<div className="flex items-center gap-2 mb-4">
				{STYLES.map((item) => {
					const active = style === item.id;
					return (
						<button
							key={item.id}
							type="button"
							onClick={() => applyParagraphStyle(editor, item.id)}
							className={`flex-1 h-10 rounded-full text-sm ${
								item.id === "title" ? "font-bold" : item.id === "subtitle" ? "font-semibold" : item.id === "caption" ? "text-xs" : "font-medium"
							} ${active ? "bg-kumo-link text-white" : "text-kumo-default"}`}
						>
							{item.label}
						</button>
					);
				})}
			</div>

			<div className="flex items-center gap-2 mb-3">
				<ToolButton active={editor.isActive("bold")} label="Bold" onClick={() => editor.chain().focus().toggleBold().run()}>
					<TextBIcon size={18} />
				</ToolButton>
				<ToolButton active={editor.isActive("italic")} label="Italic" onClick={() => editor.chain().focus().toggleItalic().run()}>
					<TextItalicIcon size={18} />
				</ToolButton>
				<ToolButton active={editor.isActive("underline")} label="Underline" onClick={() => editor.chain().focus().toggleUnderline().run()}>
					<TextUnderlineIcon size={18} />
				</ToolButton>
				<ToolButton active={editor.isActive("strike")} label="Strikethrough" onClick={() => editor.chain().focus().toggleStrike().run()}>
					<TextStrikethroughIcon size={18} />
				</ToolButton>
				<label className="size-11 rounded-full overflow-hidden shrink-0 border border-kumo-line relative" aria-label="Text color">
					<span
						className="absolute inset-0 rounded-full"
						style={{
							background:
								"conic-gradient(red, yellow, lime, aqua, blue, magenta, red)",
						}}
					/>
					<input
						type="color"
						value={/^#/.test(color) ? color : "#1f1f24"}
						onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
						className="absolute inset-0 opacity-0 cursor-pointer"
					/>
				</label>
			</div>

			<div className="flex items-center gap-2 mb-3">
				<div className="flex-1 h-11 rounded-full bg-kumo-recessed flex items-center px-4 text-sm text-kumo-default">
					Default Font
				</div>
				<div className="flex items-center rounded-full bg-kumo-recessed overflow-hidden">
					<button
						type="button"
						className="size-11 text-lg"
						aria-label="Smaller text"
						onClick={() => bumpFontSize(editor, -1)}
					>
						−
					</button>
					<span className="w-8 text-center text-sm">{size}</span>
					<button
						type="button"
						className="size-11 text-lg"
						aria-label="Larger text"
						onClick={() => bumpFontSize(editor, 1)}
					>
						+
					</button>
				</div>
			</div>

			<div className="flex items-center gap-2">
				<ToolButton active={editor.isActive("bulletList")} label="Bulleted list" onClick={() => editor.chain().focus().toggleBulletList().run()}>
					<ListBulletsIcon size={18} />
				</ToolButton>
				<ToolButton active={editor.isActive("orderedList")} label="Numbered list" onClick={() => editor.chain().focus().toggleOrderedList().run()}>
					<ListNumbersIcon size={18} />
				</ToolButton>
				<ToolButton active={editor.isActive({ textAlign: "left" }) || (!editor.isActive({ textAlign: "center" }) && !editor.isActive({ textAlign: "right" }))} label="Align left" onClick={() => editor.chain().focus().setTextAlign("left").run()}>
					<TextAlignLeftIcon size={18} />
				</ToolButton>
				<ToolButton
					active={editor.isActive({ textAlign: "center" })}
					label="Align center"
					onClick={() => editor.chain().focus().setTextAlign("center").run()}
				>
					<TextAlignCenterIcon size={18} />
				</ToolButton>
				<ToolButton active={editor.isActive({ textAlign: "right" })} label="Align right" onClick={() => editor.chain().focus().setTextAlign("right").run()}>
					<TextAlignRightIcon size={18} />
				</ToolButton>
				<ToolButton label="Outdent" onClick={() => editor.chain().focus().outdent().run()}>
					<TextOutdentIcon size={18} />
				</ToolButton>
				<ToolButton label="Indent" onClick={() => editor.chain().focus().indent().run()}>
					<TextIndentIcon size={18} />
				</ToolButton>
			</div>
		</div>
	);
}
