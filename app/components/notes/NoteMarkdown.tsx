// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/*
 * A note's markdown, compact and in the surrounding ink (so it reads on the
 * sticky's paper and on the inline card alike). Raw HTML is never rendered:
 * react-markdown escapes it by default.
 */
const components: Components = {
	a: ({ href, children }) => (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			className="underline underline-offset-2 decoration-current/40 hover:decoration-current"
			onClick={(e) => e.stopPropagation()}
		>
			{children}
		</a>
	),
	p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
	strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
	ul: ({ children }) => <ul className="mb-1.5 last:mb-0 list-disc pl-4 space-y-0.5">{children}</ul>,
	ol: ({ children }) => <ol className="mb-1.5 last:mb-0 list-decimal pl-4 space-y-0.5">{children}</ol>,
	li: ({ children, className }) => (
		<li className={className?.includes("task-list-item") ? "-ml-4 flex list-none items-center gap-1.5" : undefined}>
			{children}
		</li>
	),
	input: ({ checked, type }) =>
		type === "checkbox" ? (
			<input
				type="checkbox"
				checked={!!checked}
				readOnly
				disabled
				className="h-3 w-3 shrink-0 accent-current"
			/>
		) : null,
	h1: ({ children }) => <p className="mb-1 font-semibold text-sm">{children}</p>,
	h2: ({ children }) => <p className="mb-1 font-semibold">{children}</p>,
	h3: ({ children }) => <p className="mb-1 font-semibold">{children}</p>,
	h4: ({ children }) => <p className="mb-1 font-semibold">{children}</p>,
	blockquote: ({ children }) => (
		<blockquote className="mb-1.5 last:mb-0 border-l-2 border-current/25 pl-2 opacity-85">
			{children}
		</blockquote>
	),
	code: ({ children }) => (
		<code className="rounded bg-current/[0.08] px-1 py-px font-mono text-[0.92em]">{children}</code>
	),
	pre: ({ children }) => (
		<pre className="mb-1.5 last:mb-0 overflow-x-auto rounded-md bg-current/[0.06] p-2 [&_code]:bg-transparent [&_code]:p-0">
			{children}
		</pre>
	),
	hr: () => <hr className="my-2 border-current/15" />,
	img: ({ alt }) => <span>{alt}</span>,
	table: ({ children }) => (
		<div className="mb-1.5 overflow-x-auto">
			<table className="w-full border-collapse text-xs">{children}</table>
		</div>
	),
	th: ({ children }) => <th className="border-b border-current/20 px-1.5 py-0.5 text-left font-semibold">{children}</th>,
	td: ({ children }) => <td className="border-b border-current/10 px-1.5 py-0.5">{children}</td>,
};

export default function NoteMarkdown({ body, className = "" }: { body: string; className?: string }) {
	return (
		<div className={`break-words [overflow-wrap:anywhere] ${className}`}>
			<Markdown remarkPlugins={[remarkGfm]} components={components}>
				{body}
			</Markdown>
		</div>
	);
}
