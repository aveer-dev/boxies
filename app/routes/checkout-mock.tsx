// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Loader, Text } from "@cloudflare/kumo";
import { CheckCircleIcon, CreditCardIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

export function meta() {
	return [{ title: "Mock Stripe Checkout — Inboxies" }];
}

export default function CheckoutMockRoute() {
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const domain = searchParams.get("domain") || "example.com";
	const sessionId = searchParams.get("session_id") || `mock_cs_${Date.now()}`;
	const [completing, setCompleting] = useState(false);

	const handleCompletePayment = async () => {
		setCompleting(true);
		try {
			// Trigger webhook fulfillment simulation
			await fetch("/api/v1/billing/stripe-webhook", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					type: "checkout.session.completed",
					data: {
						object: {
							id: sessionId,
							metadata: {
								domain,
								username: "admin",
								displayName: "Admin",
								retailPriceUsd: "14.00",
							},
						},
					},
				}),
			}).catch(() => {});

			// Redirect through standard return URL
			window.location.href = `/api/v1/billing/checkout-return?domain=${encodeURIComponent(domain)}&session_id=${encodeURIComponent(sessionId)}`;
		} catch (err) {
			console.error("Mock checkout error:", err);
			window.location.href = `/admin?tab=dns&domain=${encodeURIComponent(domain)}&purchased=true`;
		}
	};

	return (
		<div className="min-h-screen bg-kumo-recessed flex items-center justify-center p-4">
			<div className="w-full max-w-md bg-kumo-base rounded-2xl border border-kumo-line shadow-sm overflow-hidden p-6 space-y-6">
				<div className="flex items-center justify-between border-b border-kumo-line pb-4">
					<div className="flex items-center gap-2">
						<CreditCardIcon size={22} className="text-sky-600 dark:text-sky-400" />
						<h1 className="text-base font-bold text-kumo-default">
							Stripe Checkout Simulator
						</h1>
					</div>
					<span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
						Dev Mock
					</span>
				</div>

				<div className="space-y-4">
					<div className="p-4 rounded-xl bg-kumo-recessed border border-kumo-line space-y-2">
						<div className="text-xs text-kumo-subtle font-medium uppercase tracking-wider">
							Order Summary
						</div>
						<div className="flex justify-between items-center text-sm font-semibold text-kumo-default">
							<span>Domain Registration (1 Year)</span>
							<span>$14.00 USD</span>
						</div>
						<div className="text-xs text-kumo-subtle font-mono">
							{domain}
						</div>
					</div>

					<div className="p-3 rounded-lg border border-sky-500/20 bg-sky-500/5 text-xs text-sky-700 dark:text-sky-300 flex items-start gap-2">
						<ShieldCheckIcon size={18} className="shrink-0 mt-0.5" />
						<div>
							<strong>Cloudflare Registrar Fulfillment:</strong> On completion, this domain will be registered wholesale and configured with Anycast DNS and Email Routing.
						</div>
					</div>
				</div>

				<div className="space-y-2 pt-2">
					<Button
						variant="primary"
						className="w-full justify-center"
						onClick={handleCompletePayment}
						disabled={completing}
					>
						{completing ? (
							<span className="flex items-center gap-2">
								<Loader size="xs" /> Simulating payment...
							</span>
						) : (
							"Pay $14.00 & Activate Domain"
						)}
					</Button>
					<Button
						variant="secondary"
						className="w-full justify-center"
						onClick={() => navigate("/")}
						disabled={completing}
					>
						Cancel
					</Button>
				</div>
			</div>
		</div>
	);
}
