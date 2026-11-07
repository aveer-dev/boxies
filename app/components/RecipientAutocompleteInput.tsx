// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	useEffect,
	useId,
	useRef,
	useState,
	type KeyboardEvent,
	type ReactNode,
} from "react";
import { useRecentRecipients } from "~/queries/recipients";
import type { RecentRecipient } from "~/types";
import {
	commitRecipientToken,
	currentToken,
	recipientKeyAction,
} from "~/lib/recipient-input";

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
	/** Shown inline to the right of the input (e.g. CC/BCC toggle). */
	trailing?: ReactNode;
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
	trailing,
	showPeopleList = true,
}: RecipientAutocompleteInputProps) {
	const listId = useId();
	const inputId = id ?? listId;
	const inputRef = useRef<HTMLInputElement>(null);
	const [highlight, setHighlight] = useState(0);
	const { token } = currentToken(value);

	// Load the recent-people set once; filter locally as the user types.
	const { data: recipients = [] } = useRecentRecipients(mailboxId, "", {
		enabled: !!mailboxId,
	});

	const suggestions = recipients.filter((r) => {
		const already = value
			.toLowerCase()
			.split(",")
			.map((p) => p.trim())
			.filter(Boolean);
		const email = r.email.toLowerCase();
		const name = (r.name || "").toLowerCase();
		const committedOnly = token ? already.slice(0, -1) : already;
		if (
			committedOnly.some(
				(entry) =>
					entry === email ||
					entry.includes(`<${email}>`) ||
					entry.endsWith(email),
			)
		) {
			return false;
		}
		const q = token.trim().toLowerCase();
		if (!q) return true;
		return email.includes(q) || name.includes(q);
	});

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
		const action = recipientKeyAction({
			key: e.key,
			metaKey: e.metaKey,
			ctrlKey: e.ctrlKey,
			shiftKey: e.shiftKey,
			altKey: e.altKey,
			isComposing: e.nativeEvent.isComposing,
			listOpen: showList,
			hasHighlight: showList && !!suggestions[highlight],
		});
		switch (action) {
			case "next":
				e.preventDefault();
				setHighlight((h) => (h + 1) % suggestions.length);
				break;
			case "prev":
				e.preventDefault();
				setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
				break;
			case "select":
				e.preventDefault();
				selectAt(highlight);
				break;
			case "commit": {
				// Plain Enter confirms the typed address; it must never submit the
				// surrounding compose form (AVE-122).
				e.preventDefault();
				const next = commitRecipientToken(value);
				if (next !== value) onChange(next);
				break;
			}
			case "send":
				e.preventDefault();
				e.currentTarget.form?.requestSubmit();
				break;
			case "close":
				e.preventDefault();
				inputRef.current?.blur();
				break;
		}
	};

	return (
		<div className={`min-w-0 ${className ?? ""}`}>
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
			<div className="flex items-center gap-2 min-w-0">
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
					className="min-w-0 flex-1 h-8 rounded-md px-2 text-sm border-0 bg-kumo-control text-kumo-default ring ring-kumo-hairline focus:ring-kumo-hairline outline-none"
					title={value || undefined}
					onChange={(e) => onChange(e.target.value)}
					onKeyDown={onKeyDown}
				/>
				{trailing}
			</div>
			{showList ? (
				<ul
					id={listId}
					role="listbox"
					className="mt-1 max-h-48 w-full overflow-auto rounded-md border border-kumo-line bg-kumo-base py-1 shadow-md"
				>
					{suggestions.map((r, i) => {
						const selected = i === highlight;
						return (
							<li
								key={r.email}
								id={`${listId}-${i}`}
								role="option"
								aria-selected={selected}
								title={r.email}
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
								<div className="font-medium break-all">
									{r.name?.trim() || r.email}
								</div>
								{r.name?.trim() ? (
									<div className="text-xs text-kumo-subtle break-all">
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
