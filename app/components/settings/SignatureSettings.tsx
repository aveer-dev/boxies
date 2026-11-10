// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Input, Loader, Switch, useKumoToastManager } from "@cloudflare/kumo";
import {
	LinkBreakIcon,
	LinkSimpleIcon,
	ListBulletsIcon,
	TextBIcon,
	TextItalicIcon,
	TextUnderlineIcon,
} from "@phosphor-icons/react";
import { EditorContent, type Editor, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { type ReactNode, useEffect, useState } from "react";
import { sanitizeSignatureHtml, signatureHtmlToText, signatureTextToHtml } from "shared/signature";
import { useMailboxId } from "~/hooks/useCurrentMailbox";
import { useEditorTick } from "~/lib/compose-format";
import { useMailbox, useUpdateMailbox } from "~/queries/mailboxes";
import SettingsSubpage from "./SettingsSubpage";

/** What a signature link may point at, or null. Bare addresses become mailto:. */
export function signatureLinkHref(raw: string): string | null {
	const value = raw.trim();
	if (!value) return null;
	if (/^(https?:\/\/|mailto:)\S+$/i.test(value)) return value;
	if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;
	if (/^[^\s:/]+\.[^\s]+$/.test(value)) return `https://${value}`;
	return null;
}

function ToolButton({
	active,
	label,
	onClick,
	disabled,
	children,
}: {
	active?: boolean;
	label: string;
	onClick: () => void;
	disabled?: boolean;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			aria-pressed={active}
			disabled={disabled}
			onMouseDown={(e) => e.preventDefault()}
			onClick={onClick}
			className={`size-8 rounded-lg flex items-center justify-center text-kumo-default disabled:opacity-40 ${
				active ? "bg-kumo-fill" : "hover:bg-kumo-tint"
			}`}
		>
			{children}
		</button>
	);
}

function SignatureToolbar({ editor, disabled }: { editor: Editor; disabled: boolean }) {
	useEditorTick(editor);
	const [linkOpen, setLinkOpen] = useState(false);
	const [linkDraft, setLinkDraft] = useState("");
	const [linkError, setLinkError] = useState<string | null>(null);
	const onLink = editor.isActive("link");

	const openLink = () => {
		const current = String(editor.getAttributes("link").href ?? "");
		setLinkDraft(current.replace(/^mailto:/i, ""));
		setLinkError(null);
		setLinkOpen(true);
	};

	const applyLink = () => {
		const href = signatureLinkHref(linkDraft);
		if (!href) {
			setLinkError("Enter a web address or an email address");
			return;
		}
		const chain = editor.chain().focus().extendMarkRange("link");
		if (editor.state.selection.empty && !onLink) {
			const label = href.replace(/^mailto:/i, "");
			chain.insertContent({ type: "text", text: label, marks: [{ type: "link", attrs: { href } }] }).run();
		} else {
			chain.setLink({ href }).run();
		}
		setLinkOpen(false);
	};

	return (
		<div className="border-b border-kumo-line">
			<div className="flex items-center gap-1 px-2 py-1.5">
				<ToolButton
					label="Bold"
					active={editor.isActive("bold")}
					disabled={disabled}
					onClick={() => editor.chain().focus().toggleBold().run()}
				>
					<TextBIcon size={16} />
				</ToolButton>
				<ToolButton
					label="Italic"
					active={editor.isActive("italic")}
					disabled={disabled}
					onClick={() => editor.chain().focus().toggleItalic().run()}
				>
					<TextItalicIcon size={16} />
				</ToolButton>
				<ToolButton
					label="Underline"
					active={editor.isActive("underline")}
					disabled={disabled}
					onClick={() => editor.chain().focus().toggleUnderline().run()}
				>
					<TextUnderlineIcon size={16} />
				</ToolButton>
				<ToolButton
					label="Bulleted list"
					active={editor.isActive("bulletList")}
					disabled={disabled}
					onClick={() => editor.chain().focus().toggleBulletList().run()}
				>
					<ListBulletsIcon size={16} />
				</ToolButton>
				<span className="mx-1 h-5 w-px bg-kumo-line" aria-hidden />
				<ToolButton label="Link" active={onLink || linkOpen} disabled={disabled} onClick={openLink}>
					<LinkSimpleIcon size={16} />
				</ToolButton>
				{onLink && (
					<ToolButton
						label="Remove link"
						disabled={disabled}
						onClick={() => editor.chain().focus().extendMarkRange("link").unsetLink().run()}
					>
						<LinkBreakIcon size={16} />
					</ToolButton>
				)}
			</div>
			{linkOpen && !disabled && (
				<form
					className="flex items-start gap-2 px-3 pb-3"
					onSubmit={(e) => {
						e.preventDefault();
						applyLink();
					}}
				>
					<div className="flex-1">
						<Input
							aria-label="Link address"
							value={linkDraft}
							autoFocus
							placeholder="example.com or you@example.com"
							onChange={(e) => {
								setLinkDraft(e.target.value);
								setLinkError(null);
							}}
							onKeyDown={(e) => {
								if (e.key === "Escape") setLinkOpen(false);
							}}
						/>
						{linkError && <p className="mt-1 text-xs text-kumo-danger">{linkError}</p>}
					</div>
					<Button type="submit" variant="secondary">
						{onLink ? "Update" : "Add link"}
					</Button>
					<Button type="button" variant="ghost" onClick={() => setLinkOpen(false)}>
						Cancel
					</Button>
				</form>
			)}
		</div>
	);
}

/** The signature as editor content: stored HTML, or the apps' plain text as lines. */
function signatureEditorHtml(signature?: { text?: string; html?: string }): string {
	const html = sanitizeSignatureHtml(signature?.html);
	if (html) return html;
	const text = signature?.text?.trim() ?? "";
	return text ? `<p>${signatureTextToHtml(text)}</p>` : "";
}

export default function SignatureSettings() {
	const mailboxId = useMailboxId();
	const toastManager = useKumoToastManager();
	const { data: mailbox } = useMailbox(mailboxId);
	const updateMailboxMutation = useUpdateMailbox();

	const [enabled, setEnabled] = useState(false);
	const [isSaving, setIsSaving] = useState(false);

	const editor = useEditor({
		extensions: [
			StarterKit.configure({
				heading: false,
				blockquote: false,
				code: false,
				codeBlock: false,
				horizontalRule: false,
				link: {
					openOnClick: false,
					autolink: true,
					defaultProtocol: "https",
					protocols: ["mailto"],
					isAllowedUri: (url) => signatureLinkHref(url) !== null,
				},
			}),
		],
		content: "",
		immediatelyRender: false,
		editorProps: {
			attributes: {
				"aria-label": "Signature",
				class:
					"prose prose-sm max-w-none focus:outline-none min-h-[140px] px-3 py-2.5 text-sm text-kumo-default [&_a]:text-kumo-link [&_a]:underline [&_p]:my-0 [&_ul]:my-1",
			},
		},
	});

	// Load the saved signature when the mailbox (or the editor) arrives.
	const mailboxKey = mailbox?.id;
	useEffect(() => {
		if (!mailbox || !editor || editor.isDestroyed) return;
		setEnabled(Boolean(mailbox.settings?.signature?.enabled));
		editor.commands.setContent(signatureEditorHtml(mailbox.settings?.signature), { emitUpdate: false });
		// Only on mailbox switch: a save shouldn't reset what's being typed.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [mailboxKey, editor]);

	useEffect(() => {
		editor?.setEditable(enabled);
	}, [editor, enabled]);

	const handleSave = async () => {
		if (!mailbox || !mailboxId || !editor) return;
		const html = editor.isEmpty ? "" : sanitizeSignatureHtml(editor.getHTML());
		const text = signatureHtmlToText(html);
		if (enabled && !text) {
			toastManager.add({ title: "Write a signature or turn it off", variant: "error" });
			return;
		}
		setIsSaving(true);
		try {
			await updateMailboxMutation.mutateAsync({
				mailboxId,
				settings: {
					...mailbox.settings,
					signature: text ? { enabled, text, html } : { enabled, text: "" },
				},
			});
			toastManager.add({ title: "Signature saved" });
		} catch (e) {
			const title = e instanceof Error && e.message ? e.message : "Failed to save signature";
			toastManager.add({ title, variant: "error" });
		} finally {
			setIsSaving(false);
		}
	};

	if (!mailbox || !mailboxId) {
		return (
			<div className="flex justify-center py-20">
				<Loader size="lg" />
			</div>
		);
	}

	return (
		<SettingsSubpage mailboxId={mailboxId} title="Signature">
			<div className="rounded-2xl border border-kumo-line bg-kumo-base p-5 space-y-4">
				<p className="text-sm text-kumo-default leading-relaxed">
					Added under new mail, replies and forwards from {mailbox.email}, on the web and in
					the apps. You can still edit or delete it in each message.
				</p>
				<Switch
					label="Add a signature"
					checked={enabled}
					onCheckedChange={setEnabled}
					controlFirst={false}
				/>
				<div
					className={`rounded-2xl border border-kumo-line bg-kumo-recessed overflow-hidden focus-within:ring-1 focus-within:ring-kumo-ring ${
						enabled ? "" : "opacity-50"
					}`}
				>
					{editor && <SignatureToolbar editor={editor} disabled={!enabled} />}
					<EditorContent editor={editor} />
				</div>
				<p className="text-xs text-kumo-subtle leading-relaxed">
					Bold, italic, underline, lists and links. The apps edit the words only; a
					signature changed there keeps its links as addresses but loses formatting.
					Replies sent from a private email never include it.
				</p>
				<div className="flex justify-end pt-2">
					<Button variant="primary" onClick={handleSave} loading={isSaving}>
						Save
					</Button>
				</div>
			</div>
		</SettingsSubpage>
	);
}
