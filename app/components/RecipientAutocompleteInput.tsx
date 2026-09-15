// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Input } from "@cloudflare/kumo";
import {
	useEffect,
	useId,
	useRef,
	useState,
	type ChangeEvent,
	type KeyboardEvent,
} from "react";
import { useRecentRecipients } from "~/queries/recipients";
import type { RecentRecipient } from "~/types";

function currentToken(value: string): { prefix: string; token: string } {
	const lastComma = value.lastIndexOf(",");
	if (lastComma === -1) {
		return { prefix: "", token: value };
	}
	return {
		prefix: value.slice(0, lastComma + 1),
		token: value.slice(lastComma + 1).replace(/^\s+/, ""),
	};
}

function formatSuggestion(r: RecentRecipient): string {
	const name = (r.name || "").trim();
	if (name) return `${name} <${r.email}>`;
	return r.email;
}

function applySuggestion(value: string, suggestion: RecentRecipient): string {
	const { prefix } = currentToken(value);
	const sep = prefix && !prefix.endsWith(" ") ? " " : "";
	return `${prefix}${sep}${formatSuggestion(suggestion)}, `;
}

interface RecipientAutocompleteInputProps {
	mailboxId: string | undefined;
	value: string;
	onChange: (value: string) => void;
	label?: string;
	placeholder?: string;
	required?: boolean;
	id?: string;
	className?: string;
}

export default function RecipientAutocompleteInput({
	mailboxId,
	value,
	onChange,
	label,
	placeholder,
	required,
	id,
	className,
}: RecipientAutocompleteInputProps) {
	const listId = useId();
	const rootRef = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [highlight, setHighlight] = useState(0);
	const { token } = currentToken(value);
	const { data: recipients = [] } = useRecentRecipients(mailboxId, token, {
		enabled: open,
	});

	const suggestions = recipients.filter((r) => {
		const already = value
			.toLowerCase()
			.split(",")
			.map((p) => p.trim())
			.filter(Boolean);
		const email = r.email.toLowerCase();
		// Allow the in-progress token to match itself; exclude committed addresses.
		const committed = already.slice(0, -1);
		return !committed.some(
			(entry) =>
				entry === email ||
				entry.includes(`<${email}>`) ||
				entry.endsWith(email),
		);
	});

	useEffect(() => {
		setHighlight(0);
	}, [token, suggestions.length]);

	useEffect(() => {
		function onPointerDown(e: MouseEvent) {
			if (!rootRef.current?.contains(e.target as Node)) {
				setOpen(false);
			}
		}
		document.addEventListener("mousedown", onPointerDown);
		return () => document.removeEventListener("mousedown", onPointerDown);
	}, []);

	const showList = open && suggestions.length > 0;

	const selectAt = (index: number) => {
		const suggestion = suggestions[index];
		if (!suggestion) return;
		onChange(applySuggestion(value, suggestion));
		setOpen(true);
		setHighlight(0);
	};

	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (!showList) {
			if (e.key === "ArrowDown" && suggestions.length > 0) {
				setOpen(true);
			}
			return;
		}
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setHighlight((h) => (h + 1) % suggestions.length);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
		} else if (e.key === "Enter" || e.key === "Tab") {
			if (suggestions[highlight]) {
				e.preventDefault();
				selectAt(highlight);
			}
		} else if (e.key === "Escape") {
			e.preventDefault();
			setOpen(false);
		}
	};

	return (
		<div ref={rootRef} className={`relative ${className ?? ""}`}>
			<Input
				id={id}
				label={label}
				type="text"
				placeholder={placeholder}
				size="sm"
				value={value}
				required={required}
				role="combobox"
				aria-expanded={showList}
				aria-controls={listId}
				aria-autocomplete="list"
				aria-activedescendant={
					showList && suggestions[highlight]
						? `${listId}-${highlight}`
						: undefined
				}
				onFocus={() => setOpen(true)}
				onChange={(e: ChangeEvent<HTMLInputElement>) => {
					onChange(e.target.value);
					setOpen(true);
				}}
				onKeyDown={onKeyDown}
			/>
			{showList && (
				<ul
					id={listId}
					role="listbox"
					className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-kumo-line bg-kumo-base py-1 shadow-md"
				>
					{suggestions.map((r, i) => {
						const active = i === highlight;
						return (
							<li
								key={r.email}
								id={`${listId}-${i}`}
								role="option"
								aria-selected={active}
								className={`cursor-pointer px-3 py-2 text-sm ${
									active
										? "bg-kumo-tint text-kumo-default"
										: "text-kumo-default hover:bg-kumo-tint"
								}`}
								onMouseEnter={() => setHighlight(i)}
								onMouseDown={(e) => {
									e.preventDefault();
									selectAt(i);
								}}
							>
								<div className="font-medium truncate">
									{r.name?.trim() || r.email}
								</div>
								{r.name?.trim() ? (
									<div className="text-xs text-kumo-subtle truncate">
										{r.email}
									</div>
								) : null}
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
