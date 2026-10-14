// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, useKumoToastManager } from "@cloudflare/kumo";
import { HourglassIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useDomainService, useRenewDomain } from "~/queries/billing";
import { ApiError } from "~/services/api";
import type { DomainService } from "~/types";

export function formatServiceDate(iso: string | undefined): string {
	if (!iso) return "";
	return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/** One-line status for a domain whose service is ending or ended. */
export function serviceMessage(service: DomainService): string {
	const { domain } = service;
	if (service.status === "ending") {
		return `Service for ${domain} ends on ${formatServiceDate(service.endsAt) || "the end of the billing period"}.`;
	}
	const base = `The subscription for ${domain} ended. Mail is read-only.`;
	if (!service.canRenew) {
		if (!service.renewBy) return base;
		return service.purgeAt
			? `${domain} can no longer be renewed. Your mail is deleted on ${formatServiceDate(service.purgeAt)}; export it before then.`
			: `${domain} can no longer be renewed. You can still read and export your mail.`;
	}
	if (service.renewBy) {
		const days = service.daysLeftToRenew ?? 0;
		return `${base} Renew by ${formatServiceDate(service.renewBy)} (${days} ${days === 1 ? "day" : "days"} left).`;
	}
	return base;
}

/** Renew / keep button for a domain's subscription; renders nothing when the caller can't. */
export function RenewButton({ service, size = "sm" }: { service: DomainService; size?: "sm" | "base" }) {
	const renew = useRenewDomain();
	const toastManager = useKumoToastManager();
	if (!service.canManage || !service.canRenew) return null;
	const label = service.status === "ending" ? "Keep subscription" : "Renew";
	return (
		<Button
			variant="primary"
			size={size}
			loading={renew.isPending}
			onClick={() =>
				renew.mutate(service.domain, {
					onSuccess: (res) => {
						if (res.resumed) toastManager.add({ title: `${service.domain} will keep running` });
						if (res.renewed) toastManager.add({ title: `${service.domain} is back in service` });
					},
					onError: (e) =>
						toastManager.add({
							title: "Couldn't renew",
							description: e instanceof ApiError ? e.message : "Try again in a moment.",
							variant: "error",
						}),
				})
			}
		>
			{label}
		</Button>
	);
}

/**
 * Floating notice above the dock when the open mailbox's domain is ending
 * (shown to its admins) or ended (shown to everyone on it).
 */
export default function ServiceBanner({ mailboxId, billed }: { mailboxId: string | undefined; billed: boolean }) {
	const domain = mailboxId?.slice(mailboxId.lastIndexOf("@") + 1);
	const { data: service } = useDomainService(billed ? domain : undefined);
	if (!service || service.status === "active") return null;
	if (service.status === "ending" && !service.canManage) return null;

	const ended = service.status === "ended";
	const askAdmin = ended && service.canRenew && !service.canManage;
	return (
		<div
			role="status"
			className="fixed bottom-16 left-1/2 -translate-x-1/2 z-40 w-[min(672px,calc(100vw-2rem))] flex items-center gap-2.5 px-3 py-2 rounded-lg border border-kumo-line bg-kumo-base/90 backdrop-blur-md shadow-lg text-xs"
		>
			{ended ? (
				<WarningCircleIcon size={16} weight="fill" className="shrink-0 text-amber-500" />
			) : (
				<HourglassIcon size={16} className="shrink-0 text-sky-500" />
			)}
			<span className="flex-1 min-w-0 text-kumo-default">
				{serviceMessage(service)}
				{askAdmin && <span className="text-kumo-subtle"> Ask an admin of {service.domain} to renew.</span>}
			</span>
			<RenewButton service={service} />
		</div>
	);
}
