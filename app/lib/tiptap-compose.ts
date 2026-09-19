// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Extension } from "@tiptap/core";

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		indent: {
			indent: () => ReturnType;
			outdent: () => ReturnType;
		};
	}
}

const INDENT_STEP = 24;
const INDENT_MAX = 120;

export const Indent = Extension.create({
	name: "indent",
	addGlobalAttributes() {
		return [
			{
				types: ["paragraph", "heading"],
				attributes: {
					indent: {
						default: 0,
						parseHTML: (element) => {
							const margin = parseInt(element.style.marginLeft || "0", 10);
							return Number.isFinite(margin) ? margin : 0;
						},
						renderHTML: (attributes) => {
							if (!attributes.indent) return {};
							return { style: `margin-left: ${attributes.indent}px` };
						},
					},
				},
			},
		];
	},
	addCommands() {
		return {
			indent:
				() =>
				({ editor, commands }) => {
					const type = editor.isActive("heading") ? "heading" : "paragraph";
					const current = Number(editor.getAttributes(type).indent || 0);
					const next = Math.min(INDENT_MAX, current + INDENT_STEP);
					return commands.updateAttributes(type, { indent: next });
				},
			outdent:
				() =>
				({ editor, commands }) => {
					const type = editor.isActive("heading") ? "heading" : "paragraph";
					const current = Number(editor.getAttributes(type).indent || 0);
					const next = Math.max(0, current - INDENT_STEP);
					return commands.updateAttributes(type, { indent: next });
				},
		};
	},
});
