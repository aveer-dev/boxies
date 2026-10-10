// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Loader } from "@cloudflare/kumo";
import { CreditCardIcon, GlobeIcon, ShieldCheckIcon, SparkleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

export function meta() {
	return [{ title: "Mock Stripe Checkout — Inboxies" }];
}

export default function CheckoutMockRoute() {
	// The simulator posts an unsigned webhook; it exists for local dev only.
	if (!import.meta.env.DEV) {
		return (
			<div className="min-h-screen bg-kumo-recessed flex items-center justify-center p-4 text-sm text-kumo-subtle">
				Checkout simulator is only available in development.
			</div>
		);
	}
	return <CheckoutMockSimulator />;
}

function CheckoutMockSimulator() {
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const domain = searchParams.get("domain") || "example.com";
	const sessionId = searchParams.get("session_id") || `mock_cs_${Date.now()}`;
	const client = searchParams.get("client") || "";
	const [completing, setCompleting] = useState(false);

	const domainFee = 10.44;
	const platformFee = 9.56;
	const total = 20.0;

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
								totalAnnualUsd: total.toFixed(2),
								domainFeeUsd: domainFee.toFixed(2),
								platformFeeUsd: platformFee.toFixed(2),
								retailPriceUsd: total.toFixed(2),
							},
						},
					},
				}),
			}).catch(() => {});

			// Redirect through hosted bridge return URL
			const clientParam = client ? `&client=${encodeURIComponent(client)}` : "";
			window.location.href = `/api/v1/billing/checkout-return?domain=${encodeURIComponent(domain)}&session_id=${encodeURIComponent(sessionId)}${clientParam}`;
		} catch (err) {
			console.error("Mock checkout error:", err);
			window.location.href = `/checkout/success?domain=${encodeURIComponent(domain)}&session_id=${encodeURIComponent(sessionId)}`;
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
					<div className="p-4 rounded-xl bg-kumo-recessed border border-kumo-line space-y-3">
						<div className="text-xs text-kumo-subtle font-semibold uppercase tracking-wider">
							Subscription Order Summary
						</div>

						<div className="space-y-2 text-xs">
							<div className="flex justify-between items-center text-kumo-default">
								<span className="flex items-center gap-1.5">
									<GlobeIcon size={14} className="text-kumo-subtle" />
									Domain Registration (1 Year)
								</span>
								<span className="font-mono font-medium">${domainFee.toFixed(2)} USD</span>
							</div>

							<div className="flex justify-between items-center text-kumo-default">
								<span className="flex items-center gap-1.5">
									<SparkleIcon size={14} className="text-sky-600 dark:text-sky-400" />
									Platform, AI & Cloud Infrastructure
								</span>
								<span className="font-mono font-medium">${platformFee.toFixed(2)} USD</span>
							</div>

							<div className="flex justify-between items-center pt-2 border-t border-kumo-line font-bold text-sm text-kumo-default">
								<span>Total Due Today</span>
								<span className="font-mono text-emerald-600 dark:text-emerald-400">
									${total.toFixed(2)} USD / yr
								</span>
							</div>
						</div>

						<div className="text-[11px] text-kumo-subtle font-mono border-t border-kumo-line/50 pt-2">
							Domain: {domain}
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
								<Loader size="sm" /> Simulating payment...
							</span>
						) : (
							`Pay $${total.toFixed(2)} & Subscribe`
						)}
					</Button>
					<Button
						variant="secondary"
						className="w-full justify-center"
						onClick={() => navigate(`/checkout/cancel?domain=${encodeURIComponent(domain)}`)}
						disabled={completing}
					>
						Cancel
					</Button>
				</div>
			</div>
		</div>
	);
}
