// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Loader, useKumoToastManager } from "@cloudflare/kumo";
import { TrashIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useParams } from "react-router";
import {
	FOLDER_DISPLAY_NAMES,
	PURPOSE_FOLDER_IDS,
	type PurposeFolderId,
} from "shared/folders";
import SettingsSubpage from "~/components/SettingsSubpage";
import {
	useDeleteSenderPreference,
	useSenderPreferences,
	useUpsertSenderPreference,
} from "~/queries/sender-preferences";

export default function SendersSettingsRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const toastManager = useKumoToastManager();
	const [query, setQuery] = useState("");
	const { data: preferences, isLoading } = useSenderPreferences(mailboxId, {
		q: query.trim() || undefined,
	});
	const upsertMut = useUpsertSenderPreference();
	const deleteMut = useDeleteSenderPreference();

	const rows = useMemo(() => preferences ?? [], [preferences]);

	const handleFolderChange = async (
		address: string,
		folderId: PurposeFolderId,
	) => {
		if (!mailboxId) return;
		try {
			const result = await upsertMut.mutateAsync({
				mailboxId,
				address,
				folderId,
				refile: true,
			});
			const count = result.refiledCount;
			toastManager.add({
				title:
					count > 0
						? `Saved — moved ${count} message${count === 1 ? "" : "s"}`
						: "Sender destination saved",
			});
		} catch {
			toastManager.add({
				title: "Failed to update sender",
				variant: "error",
			});
		}
	};

	const handleDelete = async (address: string) => {
		if (!mailboxId) return;
		if (
			!window.confirm(
				`Remove the destination for ${address}? Existing mail stays where it is; future mail uses the default sorter again.`,
			)
		) {
			return;
		}
		try {
			await deleteMut.mutateAsync({ mailboxId, address });
			toastManager.add({ title: "Sender preference removed" });
		} catch {
			toastManager.add({
				title: "Failed to remove preference",
				variant: "error",
			});
		}
	};

	if (!mailboxId) return null;

	return (
		<SettingsSubpage mailboxId={mailboxId} title="Senders">
			<p className="text-sm text-kumo-subtle mb-4">
				Choose which purpose box each sender goes to — Inbox, Promotions, or
				Updates. Changing a destination also moves their existing mail in those
				boxes.
			</p>

			<input
				type="search"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				placeholder="Search senders"
				className="w-full mb-4 rounded-md border border-kumo-line bg-kumo-base px-3 py-2 text-sm text-kumo-default placeholder:text-kumo-subtle"
			/>

			{isLoading ? (
				<div className="flex justify-center py-12">
					<Loader size="lg" />
				</div>
			) : rows.length === 0 ? (
				<div className="rounded-lg border border-kumo-line bg-kumo-base px-4 py-8 text-center">
					<p className="text-sm text-kumo-default mb-1">No sender defaults yet</p>
					<p className="text-xs text-kumo-subtle">
						When you move mail into Inbox, Promotions, or Updates, you can set
						where future mail from that sender goes.
					</p>
				</div>
			) : (
				<ul className="divide-y divide-kumo-line rounded-lg border border-kumo-line bg-kumo-base">
					{rows.map((pref) => (
						<li
							key={pref.address}
							className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3"
						>
							<div className="min-w-0 flex-1">
								<div className="text-sm font-medium text-kumo-default truncate">
									{pref.displayName || pref.address}
								</div>
								{pref.displayName ? (
									<div className="text-xs text-kumo-subtle truncate">
										{pref.address}
									</div>
								) : null}
							</div>
							<select
								value={pref.folderId}
								onChange={(e) =>
									handleFolderChange(
										pref.address,
										e.target.value as PurposeFolderId,
									)
								}
								className="rounded-md border border-kumo-line bg-kumo-base px-2 py-1.5 text-sm text-kumo-default"
								aria-label={`Destination for ${pref.address}`}
							>
								{PURPOSE_FOLDER_IDS.map((id) => (
									<option key={id} value={id}>
										{FOLDER_DISPLAY_NAMES[id] ?? id}
									</option>
								))}
							</select>
							<Button
								variant="ghost"
								size="sm"
								aria-label={`Remove preference for ${pref.address}`}
								onClick={() => handleDelete(pref.address)}
							>
								<TrashIcon size={16} />
							</Button>
						</li>
					))}
				</ul>
			)}

			<p className="mt-4 text-xs text-kumo-subtle">
				Filters still override these defaults when a rule matches. Spam is never
				routed by sender preference.
			</p>
		</SettingsSubpage>
	);
}
