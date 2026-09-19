// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";

const BODY_SIZE = 14;
const CAPTION_SIZE = 12;

export type ParagraphStyle = "title" | "subtitle" | "body" | "caption";

export function currentParagraphStyle(editor: Editor): ParagraphStyle {
	if (editor.isActive("heading", { level: 1 })) return "title";
	if (editor.isActive("heading", { level: 2 })) return "subtitle";
	const size = String(editor.getAttributes("textStyle").fontSize || "");
	if (size.startsWith("12")) return "caption";
	return "body";
}

export function applyParagraphStyle(editor: Editor, style: ParagraphStyle) {
	const chain = editor.chain().focus();
	if (style === "title") {
		chain.setHeading({ level: 1 }).unsetFontSize().run();
		return;
	}
	if (style === "subtitle") {
		chain.setHeading({ level: 2 }).unsetFontSize().run();
		return;
	}
	chain.setParagraph();
	if (style === "caption") {
		chain.setFontSize(`${CAPTION_SIZE}px`).run();
	} else {
		chain.unsetFontSize().run();
	}
}

export function currentFontSize(editor: Editor): number {
	const raw = String(editor.getAttributes("textStyle").fontSize || "");
	const parsed = parseInt(raw, 10);
	if (Number.isFinite(parsed) && parsed > 0) return parsed;
	if (editor.isActive("heading", { level: 1 })) return 22;
	if (editor.isActive("heading", { level: 2 })) return 18;
	return BODY_SIZE;
}

export function bumpFontSize(editor: Editor, delta: number) {
	const next = Math.min(36, Math.max(10, currentFontSize(editor) + delta));
	editor.chain().focus().setFontSize(`${next}px`).run();
}

export function useEditorTick(editor: Editor | null) {
	const [, setTick] = useState(0);
	useEffect(() => {
		if (!editor) return;
		const bump = () => setTick((n) => n + 1);
		editor.on("selectionUpdate", bump);
		editor.on("transaction", bump);
		return () => {
			editor.off("selectionUpdate", bump);
			editor.off("transaction", bump);
		};
	}, [editor]);
}
