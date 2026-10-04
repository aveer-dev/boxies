// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button } from "@cloudflare/kumo";
import { XCircleIcon, ArrowLeftIcon } from "@phosphor-icons/react";
import { Link, useSearchParams } from "react-router";

export function meta() {
	return [{ title: "Checkout Cancelled — Inboxies" }];
}

export default function CheckoutCancelRoute() {
	const [searchParams] = useSearchParams();
	const domain = searchParams.get("domain") || "";

	return (
		<div className="min-h-screen bg-kumo-recessed flex items-center justify-center p-4">
			<div className="w-full max-w-md bg-kumo-base rounded-2xl border border-kumo-line shadow-sm overflow-hidden p-6 sm:p-8 space-y-6">
				<div className="flex items-center gap-3 border-b border-kumo-line pb-4">
					<div className="p-2.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
						<XCircleIcon size={26} weight="fill" />
					</div>
					<div>
						<h1 className="text-base font-bold text-kumo-default">
							Checkout Cancelled
						</h1>
						{domain && (
							<p className="text-xs text-kumo-subtle font-mono mt-0.5">
								{domain}
							</p>
						)}
					</div>
				</div>

				<div className="rounded-xl bg-kumo-recessed border border-kumo-line p-4 space-y-2 text-xs text-kumo-subtle">
					<p className="text-kumo-default font-medium">
						No charges were made to your payment method.
					</p>
					<p>
						You can return to onboarding or domain administration whenever you are ready to complete registration.
					</p>
				</div>

				<div className="space-y-2 pt-2">
					<Link to="/" className="block">
						<Button variant="primary" className="w-full justify-center">
							<span className="flex items-center gap-2">
								<ArrowLeftIcon size={16} /> Return to Home
							</span>
						</Button>
					</Link>
					{domain && (
						<Link to={`/admin?tab=dns&domain=${encodeURIComponent(domain)}`} className="block">
							<Button variant="secondary" className="w-full justify-center">
								Return to Domain DNS
							</Button>
						</Link>
					)}
				</div>
			</div>
		</div>
	);
}
