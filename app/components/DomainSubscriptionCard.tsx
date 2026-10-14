// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { CheckCircleIcon, HourglassIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { useDomainService } from "~/queries/billing";
import { formatServiceDate, RenewButton, serviceMessage } from "./ServiceBanner";

/**
 * The domain's subscription on the admin page: active, ending (with "Keep
 * subscription") or ended (with the renewal deadline and "Renew"). Back from
 * a renewal checkout (`justRenewed`), it polls briefly while the payment
 * webhook brings the domain back.
 */
export function DomainSubscriptionCard({ domain, justRenewed }: { domain: string; justRenewed?: boolean }) {
	const { data: service, refetch } = useDomainService(domain || undefined);
	const polls = useRef(0);

	useEffect(() => {
		if (!justRenewed || service?.status !== "ended" || polls.current >= 10) return;
		const timer = setTimeout(() => {
			polls.current += 1;
			void refetch();
		}, 2000);
		return () => clearTimeout(timer);
	}, [justRenewed, service, refetch]);

	if (!service?.billed) return null;

	const icon =
		service.status === "ended" ? (
			<WarningCircleIcon size={18} weight="fill" className="shrink-0 text-amber-500" />
		) : service.status === "ending" ? (
			<HourglassIcon size={18} className="shrink-0 text-sky-500" />
		) : (
			<CheckCircleIcon size={18} weight="fill" className="shrink-0 text-emerald-500" />
		);
	const detail =
		service.status === "active"
			? service.registrarManaged && service.registrationExpiresAt
				? `Subscription active. The domain registration renews on ${formatServiceDate(service.registrationExpiresAt)}.`
				: "Subscription active."
			: serviceMessage(service);

	return (
		<div className="rounded-xl border border-kumo-line bg-kumo-base p-4 flex items-center gap-3">
			{icon}
			<div className="flex-1 min-w-0">
				<div className="text-sm font-semibold text-kumo-default">Subscription</div>
				<p className="text-xs text-kumo-subtle mt-0.5">
					{justRenewed && service.status === "ended" ? "Finishing your renewal…" : detail}
				</p>
			</div>
			<RenewButton service={service} />
		</div>
	);
}
