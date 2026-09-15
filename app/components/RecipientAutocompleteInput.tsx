// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	useEffect,
	useId,
	useRef,
	useState,
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
	/** Show the people-I've-emailed list under the field (default true). */
	showPeopleList?: boolean;
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
	showPeopleList = true,
}: RecipientAutocompleteInputProps) {
	const listId = useId();
	const inputId = id ?? listId;
	const inputRef = useRef<HTMLInputElement>(null);
	const [highlight, setHighlight] = useState(0);
	const { token } = currentToken(value);

	const { data: recipients = [] } = useRecentRecipients(mailboxId, token, {
		enabled: !!mailboxId,
	});

	const suggestions = recipients.filter((r) => {
		const already = value
			.toLowerCase()
			.split(",")
			.map((p) => p.trim())
			.filter(Boolean);
		const email = r.email.toLowerCase();
		const committedOnly = token ? already.slice(0, -1) : already;
		return !committedOnly.some(
			(entry) =>
				entry === email ||
				entry.includes(`<${email}>`) ||
				entry.endsWith(email),
		);
	});

	// Always show the people-I've-emailed list while there are matches.
	const showList = showPeopleList && suggestions.length > 0;

	useEffect(() => {
		setHighlight(0);
	}, [token, suggestions.length]);

	const selectAt = (index: number) => {
		const suggestion = suggestions[index];
		if (!suggestion) return;
		onChange(applySuggestion(value, suggestion));
		setHighlight(0);
		inputRef.current?.focus();
	};

	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (!showList) return;
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
			inputRef.current?.blur();
		}
	};

	return (
		<div className={`relative ${className ?? ""}`}>
			{label ? (
				<label
					htmlFor={inputId}
					className="mb-1.5 block text-sm font-medium text-kumo-default"
				>
					{label}
					{required ? (
						<span className="text-kumo-danger" aria-hidden>
							{" "}
							*
						</span>
					) : null}
				</label>
			) : null}
			<input
				ref={inputRef}
				id={inputId}
				type="text"
				placeholder={placeholder}
				value={value}
				required={required}
				autoComplete="off"
				role="combobox"
				aria-label={label ?? placeholder ?? "Recipients"}
				aria-expanded={showList}
				aria-controls={listId}
				aria-autocomplete="list"
				aria-activedescendant={
					showList && suggestions[highlight]
						? `${listId}-${highlight}`
						: undefined
				}
				className="w-full h-6.5 gap-1 rounded-md px-2 text-xs border-0 bg-kumo-control text-kumo-default ring ring-kumo-hairline focus:ring-kumo-hairline outline-none"
				onChange={(e) => {
					onChange(e.target.value);
				}}
				onKeyDown={onKeyDown}
			/>
			{showList ? (
				<ul
					id={listId}
					role="listbox"
					className="relative z-20 mt-1 max-h-48 w-full overflow-auto rounded-md border border-kumo-line bg-kumo-base py-1 shadow-md"
				>
					{suggestions.map((r, i) => {
						const selected = i === highlight;
						return (
							<li
								key={r.email}
								id={`${listId}-${i}`}
								role="option"
								aria-selected={selected}
								className={`cursor-pointer px-3 py-2 text-sm ${
									selected
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
			) : null}
		</div>
	);
}
