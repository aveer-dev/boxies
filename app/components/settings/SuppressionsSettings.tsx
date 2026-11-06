// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Loader, useKumoToastManager } from "@cloudflare/kumo";
import { useState } from "react";
import { useMailboxId } from "~/hooks/useCurrentMailbox";
import { ApiError } from "~/services/api";
import {
	formatSuppressionDate,
	type SuppressedRecipient,
	suppressionReasonLabel,
} from "~/lib/suppression";
import { useSuppressions, useUnsuppress } from "~/queries/suppressions";
import ConfirmDialog from "./ConfirmDialog";
import SettingsSubpage from "./SettingsSubpage";

/**
 * Recipients the sending domain no longer mails after a hard bounce or a spam
 * complaint (AVE-37). Members see the ones their mailbox caused; domain
 * admins see the whole domain's. Un-suppress lets mail go to them again.
 */
export default function SuppressionsSettings() {
	const mailboxId = useMailboxId();
	const toastManager = useKumoToastManager();
	const { data, isLoading, isError, refetch } = useSuppressions(mailboxId);
	const unsuppressMut = useUnsuppress();
	const [confirming, setConfirming] = useState<SuppressedRecipient | null>(null);

	const handleUnsuppress = async (row: SuppressedRecipient) => {
		if (!mailboxId) return;
		try {
			await unsuppressMut.mutateAsync({ mailboxId, address: row.address });
			toastManager.add({ title: `${row.address} un-suppressed` });
		} catch (err) {
			// 404: already lifted; the list refetches either way.
			if (!(err instanceof ApiError && err.status === 404)) {
				toastManager.add({
					title: (err instanceof Error && err.message) || "Couldn't un-suppress the address",
					variant: "error",
				});
			}
		} finally {
			setConfirming(null);
		}
	};

	if (!mailboxId) return null;
	const rows = data?.suppressions ?? [];

	return (
		<SettingsSubpage mailboxId={mailboxId} title="Bounced addresses">
			<p className="text-sm text-kumo-subtle mb-4">
				After a hard bounce or a spam report, mail from
				{data?.domain ? <span className="text-kumo-default"> {data.domain} </span> : " this domain "}
				stops going to that address, which protects your sending reputation.
				{data?.scope === "domain"
					? " As a domain admin you see every mailbox's."
					: " You see the ones this mailbox's sends caused."}
			</p>

			{isLoading ? (
				<div className="flex justify-center py-12">
					<Loader size="lg" />
				</div>
			) : isError ? (
				<div className="rounded-2xl border border-kumo-line bg-kumo-base px-4 py-8 text-center">
					<p className="text-sm text-kumo-default mb-3">Couldn't load bounced addresses</p>
					<Button variant="secondary" size="sm" onClick={() => void refetch()}>
						Try again
					</Button>
				</div>
			) : rows.length === 0 ? (
				<div className="rounded-2xl border border-kumo-line bg-kumo-base px-4 py-8 text-center">
					<p className="text-sm text-kumo-default mb-1">No bounced addresses</p>
					<p className="text-xs text-kumo-subtle">
						Addresses that hard-bounce or report your mail as spam show up here.
					</p>
				</div>
			) : (
				<ul className="divide-y divide-kumo-line rounded-2xl border border-kumo-line bg-kumo-base">
					{rows.map((row) => (
						<li
							key={row.address}
							className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3"
						>
							<div className="min-w-0 flex-1">
								<div className="text-sm font-medium text-kumo-default truncate">{row.address}</div>
								<div className="text-xs text-kumo-subtle">
									{suppressionReasonLabel(row.reason)} · {formatSuppressionDate(row.suppressedAt)}
								</div>
								{row.detail ? (
									<div className="text-xs text-kumo-subtle break-words">{row.detail}</div>
								) : null}
							</div>
							{row.canUnsuppress ? (
								<Button
									variant="secondary"
									size="sm"
									onClick={() => setConfirming(row)}
									disabled={unsuppressMut.isPending}
								>
									Un-suppress
								</Button>
							) : (
								<span className="text-xs text-kumo-subtle">Domain admin only</span>
							)}
						</li>
					))}
				</ul>
			)}

			<ConfirmDialog
				open={confirming !== null}
				title="Un-suppress this address?"
				description={
					confirming
						? `Mail will go to ${confirming.address} again. If it ${
								confirming.reason === "complaint" ? "reports spam" : "bounces"
							} again, it's suppressed again.`
						: ""
				}
				confirmLabel="Un-suppress"
				destructive={false}
				busy={unsuppressMut.isPending}
				onConfirm={() => confirming && void handleUnsuppress(confirming)}
				onCancel={() => setConfirming(null)}
			/>
		</SettingsSubpage>
	);
}
