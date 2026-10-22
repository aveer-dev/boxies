// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Dialog, Input, useKumoToastManager } from "@cloudflare/kumo";
import { HourglassIcon, TrashIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import api from "~/services/api";
import type { OffboardingDomain } from "~/types";

export const OFFBOARDING_DOMAINS_QUERY_KEY = ["offboarding-domains"] as const;

function formatDate(iso: string): string {
	return new Date(iso).toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

function daysLeft(iso: string): number {
	return Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / (24 * 60 * 60 * 1000)));
}

/**
 * Decommissioned domains waiting out their grace period (AVE-43): when their
 * data is deleted, and "Delete now", which needs the domain typed to confirm
 * (the server checks it too). Renders nothing when there are none.
 */
export function OffboardingDomainsCard() {
	const { data } = useQuery({
		queryKey: OFFBOARDING_DOMAINS_QUERY_KEY,
		queryFn: ({ signal }) => api.listOffboardingDomains({ signal }),
		staleTime: 30_000,
	});
	const [target, setTarget] = useState<OffboardingDomain | null>(null);
	const domains = data?.domains ?? [];
	if (domains.length === 0 && !target) return null;

	return (
		<div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
			<div className="flex items-center gap-2 text-sm font-semibold text-kumo-default">
				<HourglassIcon size={18} className="text-amber-500" />
				Scheduled for deletion
			</div>
			{domains.map((d) => {
				const left = daysLeft(d.offboarding.finalizeAfter);
				return (
					<div
						key={d.domain}
						className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg bg-kumo-base border border-kumo-line p-3"
					>
						<div className="min-w-0">
							<div className="text-sm font-semibold text-kumo-default truncate">{d.domain}</div>
							<p className="text-xs text-kumo-subtle">
								{d.offboarding.finalizeStartedAt
									? "Deleting its data now. This finishes within the hour."
									: `Decommissioned. Its mailboxes, aliases, members, subscription and DNS zone are deleted on ${formatDate(
											d.offboarding.finalizeAfter,
										)} (${left} ${left === 1 ? "day" : "days"} left). Export your mail before then.`}
							</p>
						</div>
						{d.offboarding.canFinalizeNow && !d.offboarding.finalizeStartedAt && (
							<Button
								variant="destructive"
								size="sm"
								icon={<TrashIcon size={14} />}
								onClick={() => setTarget(d)}
							>
								Delete now
							</Button>
						)}
					</div>
				);
			})}
			<FinalizeDomainDialog target={target} onClose={() => setTarget(null)} />
		</div>
	);
}

function FinalizeDomainDialog({ target, onClose }: { target: OffboardingDomain | null; onClose: () => void }) {
	const toastManager = useKumoToastManager();
	const queryClient = useQueryClient();
	const [confirmInput, setConfirmInput] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const domain = target?.domain ?? "";
	const matches = confirmInput.trim().toLowerCase() === domain.toLowerCase();

	const close = () => {
		if (busy) return;
		setConfirmInput("");
		setError(null);
		onClose();
	};

	const handleFinalize = async () => {
		setBusy(true);
		setError(null);
		try {
			const res = await api.finalizeDomain(domain, confirmInput.trim());
			toastManager.add({
				title: res.finalized
					? `${domain}'s data was deleted`
					: `Deleting ${domain}'s data. This finishes within the hour.`,
			});
			await queryClient.invalidateQueries({ queryKey: OFFBOARDING_DOMAINS_QUERY_KEY });
			setConfirmInput("");
			onClose();
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : "Failed to delete the domain's data");
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog.Root open={target !== null} onOpenChange={(open) => !open && close()}>
			<Dialog size="lg" className="p-6">
				<Dialog.Title className="text-base font-semibold mb-1 flex items-center gap-2 text-red-600 dark:text-red-400">
					<WarningCircleIcon size={20} weight="fill" />
					Delete {domain} now
				</Dialog.Title>
				<p className="text-xs text-kumo-subtle mb-4">
					This permanently deletes every mailbox on{" "}
					<span className="font-semibold text-kumo-default">{domain}</span> with its mail and
					attachments, its aliases, members and pending invites, and cancels its subscription
					without a refund for the unused time. It also deletes the domain's Cloudflare DNS zone
					and, if you bought the domain through Inboxies, turns off its auto-renew so it lapses
					when it expires. It can't be undone.
				</p>
				{error && (
					<div className="rounded-lg bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400 mb-3">{error}</div>
				)}
				<label className="block text-xs font-medium text-kumo-subtle mb-1">
					Type <strong className="text-kumo-default font-mono">{domain}</strong> to confirm:
				</label>
				<Input placeholder={domain} value={confirmInput} onChange={(e) => setConfirmInput(e.target.value)} />
				<div className="flex justify-end gap-2 pt-4 mt-4 border-t border-kumo-line">
					<Button variant="secondary" onClick={close} disabled={busy}>
						Cancel
					</Button>
					<Button variant="destructive" onClick={handleFinalize} disabled={busy || !matches}>
						{busy ? "Deleting..." : "Delete all data"}
					</Button>
				</div>
			</Dialog>
		</Dialog.Root>
	);
}
