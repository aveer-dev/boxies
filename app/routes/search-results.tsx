// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Loader } from "@cloudflare/kumo";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { Folders, getFolderDisplayName, SYSTEM_FOLDER_IDS } from "shared/folders";
import { displaySenderName } from "shared/sender";
import ColumnPane from "~/components/columns/ColumnPane";
import { ListEmptyState, ListPagination } from "~/components/columns/ListParts";
import ReaderColumn from "~/components/columns/ReaderColumn";
import ThreadRow, { ThreadChip } from "~/components/columns/ThreadRow";
import { useMailNavigation } from "~/hooks/useMailNavigation";
import { getSnippetText } from "~/lib/utils";
import { useUpdateEmail } from "~/queries/emails";
import { useFolders } from "~/queries/folders";
import { SEARCH_PAGE_SIZE, useSearchEmails } from "~/queries/search";
import type { Email } from "~/types";

function highlightTerms(text: string, query: string): React.ReactNode {
	if (!query || !text) return text;
	const freeText = query.replace(/\b(?:from|to|subject|in|is|has|before|after):"[^"]*"/gi, "").replace(/\b(?:from|to|subject|in|is|has|before|after):\S+/gi, "").trim();
	if (!freeText) return text;
	try {
		const escaped = freeText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const regex = new RegExp(`(${escaped})`, "gi");
		const parts = text.split(regex);
		if (parts.length === 1) return text;
		// Use case-insensitive string comparison instead of regex.test() with g flag,
		// which has stateful lastIndex causing alternating true/false results.
		const lowerEscaped = escaped.toLowerCase();
		return parts.map((part, i) => part.toLowerCase() === lowerEscaped ? <mark key={i} className="bg-kumo-warning-tint text-kumo-default rounded-sm px-0.5">{part}</mark> : part);
	} catch { return text; }
}

/** Column 3 for `/search?q=` (+ the reader for `:emailId`). */
export default function SearchResultsRoute() {
	const { mailboxId = "" } = useParams<{ mailboxId: string }>();
	const [searchParams] = useSearchParams();
	const { emailId, openEmail, closeSearch } = useMailNavigation();
	const updateEmail = useUpdateEmail();
	const { data: folders = [] } = useFolders(mailboxId);
	const urlQuery = searchParams.get("q") || "";
	const [page, setPage] = useState(1);
	const searchKey = useMemo(() => `${mailboxId}::${urlQuery}`, [mailboxId, urlQuery]);
	const prevSearchKeyRef = useRef(searchKey);
	const searchChanged = prevSearchKeyRef.current !== searchKey;
	const currentPage = searchChanged ? 1 : page;

	useEffect(() => {
		if (!searchChanged) return;
		prevSearchKeyRef.current = searchKey;
		setPage(1);
	}, [searchChanged, searchKey]);

	const { data: searchData, isLoading } = useSearchEmails(mailboxId, urlQuery, currentPage);
	const results = searchData?.results ?? [];
	const totalCount = searchData?.totalCount ?? 0;

	const isUnread = (email: Email) => !email.read && email.folder_id !== Folders.DRAFT;
	const handleOpen = (email: Email) => {
		openEmail(email.id);
		if (isUnread(email)) updateEmail.mutate({ mailboxId, id: email.id, data: { read: true } });
	};
	// Results carry folder_id plus folder_name (a display name). System folders
	// show their name; custom folders show as #tags.
	const folderLabel = (email: Email) => {
		const name = (email as Email & { folder_name?: string }).folder_name;
		const id = email.folder_id;
		if (!id) return name ?? null;
		if ((SYSTEM_FOLDER_IDS as readonly string[]).includes(id)) return getFolderDisplayName(id);
		const tag = folders.find((f) => f.id === id)?.name ?? name ?? id;
		return `#${tag.replace(/^#/, "")}`;
	};

	return (
		<>
			<ColumnPane
				id="list"
				title={
					<h2 className="text-xs font-medium text-kumo-subtle truncate">
						Search{urlQuery ? <> · <span className="text-kumo-default">{urlQuery}</span></> : null}
					</h2>
				}
				counter={isLoading ? undefined : totalCount}
				widthClassName="md:w-[400px]"
				onClose={closeSearch}
				closeLabel="Close search"
			>
				{isLoading ? (
					<div className="flex justify-center py-16">
						<Loader size="lg" />
					</div>
				) : results.length === 0 ? (
					<ListEmptyState
						icon={<MagnifyingGlassIcon size={40} weight="thin" className="text-kumo-subtle" />}
						title="No results found"
						description={
							urlQuery
								? `Nothing matched "${urlQuery}". Try different keywords, or operators like from:name, is:unread, has:attachment, before:2025-01-01.`
								: "Search from the bar below to find emails by subject, sender, or content."
						}
					/>
				) : (
					<>
						{results.map((email) => {
							const label = folderLabel(email);
							return (
								<ThreadRow
									key={email.id}
									email={email}
									isSelected={emailId === email.id}
									isUnread={isUnread(email)}
									onOpen={() => handleOpen(email)}
									sender={highlightTerms(displaySenderName(email), urlQuery)}
									subject={highlightTerms(email.subject || "(no subject)", urlQuery)}
									snippet={highlightTerms(getSnippetText(email.snippet, 120), urlQuery)}
									chips={label ? <ThreadChip>{label}</ThreadChip> : undefined}
								/>
							);
						})}
						<ListPagination
							page={currentPage}
							setPage={setPage}
							perPage={SEARCH_PAGE_SIZE}
							totalCount={totalCount}
						/>
					</>
				)}
			</ColumnPane>
			{emailId && <ReaderColumn emailId={emailId} />}
		</>
	);
}
