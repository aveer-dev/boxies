// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	Button,
	Dialog,
	Input,
	Loader,
	Text,
	useKumoToastManager,
} from "@cloudflare/kumo";
import {
	ArrowRightIcon,
	CheckCircleIcon,
	CloudIcon,
	CopyIcon,
	EnvelopeIcon,
	GlobeIcon,
	ShieldCheckIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent } from "react";
import api from "~/services/api";
import type { DomainAvailabilityResponse } from "~/types";

interface OnboardingFlowProps {
	isOpen: boolean;
	onClose: () => void;
	mailDomain: string;
	onSuccess: (mailboxId: string) => void;
}

type OnboardingTrack = "select" | "personal" | "domain" | "dns_wizard";

interface DnsSetupState {
	domain: string;
	zoneId: string;
	nameservers: string[];
	mailboxId: string;
}

export function OnboardingFlow({
	isOpen,
	onClose,
	mailDomain,
	onSuccess,
}: OnboardingFlowProps) {
	const toastManager = useKumoToastManager();
	const getInitialTrack = (): OnboardingTrack => {
		if (typeof window !== "undefined") {
			const params = new URLSearchParams(window.location.search);
			if (params.get("debug") === "domain" || params.get("preview") === "domain") {
				return "domain";
			}
		}
		return "personal";
	};

	const [track, setTrack] = useState<OnboardingTrack>(getInitialTrack);
	const [devTapCount, setDevTapCount] = useState(0);

	// Personal form state
	const [personalUsername, setPersonalUsername] = useState("");
	const [personalPassword, setPersonalPassword] = useState("");
	const [personalName, setPersonalName] = useState("");
	const [personalLoading, setPersonalLoading] = useState(false);
	const [personalError, setPersonalError] = useState<string | null>(null);

	// Custom domain form state
	const [customDomain, setCustomDomain] = useState("");
	const [customUsername, setCustomUsername] = useState("");
	const [customPassword, setCustomPassword] = useState("");
	const [customName, setCustomName] = useState("");
	const [customLoading, setCustomLoading] = useState(false);
	const [customError, setCustomError] = useState<string | null>(null);

	// Domain availability & purchase state
	const [availability, setAvailability] = useState<DomainAvailabilityResponse | null>(null);
	const [checkLoading, setCheckLoading] = useState(false);
	const [domainAction, setDomainAction] = useState<"purchase" | "connect">("purchase");
	const [checkoutRedirecting, setCheckoutRedirecting] = useState(false);

	// DNS wizard state
	const [dnsSetup, setDnsSetup] = useState<DnsSetupState | null>(null);
	const [copiedNs, setCopiedNs] = useState<string | null>(null);

	const resetState = () => {
		setTrack(getInitialTrack());
		setDevTapCount(0);
		setPersonalUsername("");
		setPersonalPassword("");
		setPersonalName("");
		setPersonalError(null);
		setCustomDomain("");
		setCustomUsername("");
		setCustomPassword("");
		setCustomName("");
		setCustomError(null);
		setAvailability(null);
		setCheckLoading(false);
		setDomainAction("purchase");
		setCheckoutRedirecting(false);
		setDnsSetup(null);
	};

	useEffect(() => {
		if (isOpen) {
			setTrack(getInitialTrack());
		}
	}, [isOpen]);

	// Debounced domain availability check
	useEffect(() => {
		const trimmed = customDomain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
		if (!trimmed || !trimmed.includes(".") || trimmed.endsWith(".")) {
			setAvailability(null);
			setCheckLoading(false);
			return;
		}

		setCheckLoading(true);
		let cancelled = false;

		const timer = setTimeout(async () => {
			try {
				const res = await api.checkDomainAvailability(trimmed);
				if (!cancelled) {
					setAvailability(res);
					if (res.available) {
						setDomainAction("purchase");
					} else {
						setDomainAction("connect");
					}
				}
			} catch {
				if (!cancelled) {
					setAvailability(null);
				}
			} finally {
				if (!cancelled) {
					setCheckLoading(false);
				}
			}
		}, 500);

		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [customDomain]);

	const handlePersonalSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setPersonalError(null);
		setPersonalLoading(true);

		try {
			const res = await api.signupPersonal({
				username: personalUsername.trim(),
				password: personalPassword,
				displayName: personalName.trim() || undefined,
			});
			toastManager.add({ title: "Account created successfully!" });
			onSuccess(res.mailbox.id);
			resetState();
			onClose();
		} catch (err: unknown) {
			setPersonalError(
				err instanceof Error ? err.message : "Failed to create personal account",
			);
		} finally {
			setPersonalLoading(false);
		}
	};

	const handleCustomDomainSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setCustomError(null);

		const domain = customDomain.trim().toLowerCase();
		if (!domain || !domain.includes(".")) {
			setCustomError("Please enter a valid domain name");
			return;
		}

		if (availability?.alreadyInInboxies) {
			setCustomError("This domain is already registered with Inboxies. Please sign in or use another domain.");
			return;
		}

		// Track 1: In-flow purchase via Cloudflare Registrar & Stripe
		if (domainAction === "purchase" && availability?.available) {
			setCustomLoading(true);
			setCheckoutRedirecting(true);
			try {
				const returnUrl = `${window.location.origin}/api/v1/billing/checkout-return`;
				const res = await api.createDomainCheckout({
					domain,
					username: customUsername.trim().toLowerCase(),
					password: customPassword,
					displayName: customName.trim() || undefined,
					returnUrl,
				});

				if (res.checkoutUrl) {
					window.location.href = res.checkoutUrl;
				} else {
					throw new Error("No checkout URL returned from billing service");
				}
			} catch (err: unknown) {
				setCheckoutRedirecting(false);
				setCustomLoading(false);
				setCustomError(
					err instanceof Error ? err.message : "Failed to initiate domain checkout",
				);
			}
			return;
		}

		// Track 2: Connect existing domain via Cloudflare zone setup
		setCustomLoading(true);
		try {
			const res = await api.signupDomain({
				domain,
				username: customUsername.trim().toLowerCase(),
				password: customPassword,
				displayName: customName.trim() || undefined,
			});
			setDnsSetup({
				domain: res.domain.domain,
				zoneId: res.domain.zoneId,
				nameservers: res.domain.nameservers,
				mailboxId: res.mailbox.id,
			});
			setTrack("dns_wizard");
			toastManager.add({ title: "Domain provisioned in Cloudflare!" });
		} catch (err: unknown) {
			setCustomError(
				err instanceof Error ? err.message : "Failed to set up custom domain",
			);
		} finally {
			setCustomLoading(false);
		}
	};

	const handleCopy = (text: string) => {
		navigator.clipboard.writeText(text);
		setCopiedNs(text);
		toastManager.add({ title: "Nameserver copied" });
		setTimeout(() => setCopiedNs(null), 2000);
	};

	const effectiveMailDomain = mailDomain || "inboxies.email";

	return (
		<Dialog.Root
			open={isOpen}
			onOpenChange={(open) => {
				if (!open) {
					resetState();
					onClose();
				}
			}}
		>
			<Dialog size="lg" className="p-6">
				{track === "select" && (
					<div>
						<Dialog.Title className="text-xl font-bold text-kumo-default mb-2">
							Choose your email setup
						</Dialog.Title>
						<p className="text-sm text-kumo-subtle mb-6">
							Get started with a free personal address or connect your company's custom domain.
						</p>

						<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
							{/* Option 1: Personal */}
							<button
								type="button"
								onClick={() => setTrack("personal")}
								className="flex flex-col text-left p-5 rounded-xl border border-kumo-line bg-kumo-base hover:border-kumo-default hover:bg-kumo-tint transition-all group cursor-pointer"
							>
								<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mb-3 group-hover:scale-105 transition-transform">
									<EnvelopeIcon size={24} />
								</div>
								<h3 className="text-base font-semibold text-kumo-default mb-1">
									Personal Account
								</h3>
								<p className="text-xs text-kumo-subtle flex-1 mb-4">
									Instant address on @{effectiveMailDomain}. No DNS or setup required.
								</p>
								<span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
									Get Started <ArrowRightIcon size={12} />
								</span>
							</button>

							{/* Option 2: Custom Domain */}
							<button
								type="button"
								onClick={() => setTrack("domain")}
								className="flex flex-col text-left p-5 rounded-xl border border-kumo-line bg-kumo-base hover:border-kumo-default hover:bg-kumo-tint transition-all group cursor-pointer"
							>
								<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 mb-3 group-hover:scale-105 transition-transform">
									<GlobeIcon size={24} />
								</div>
								<h3 className="text-base font-semibold text-kumo-default mb-1">
									Custom Domain
								</h3>
								<p className="text-xs text-kumo-subtle flex-1 mb-4">
									Automated Cloudflare integration. Send and receive with your own domain name.
								</p>
								<span className="text-xs font-semibold text-sky-600 dark:text-sky-400 flex items-center gap-1">
									Connect Domain <ArrowRightIcon size={12} />
								</span>
							</button>
						</div>

						<div className="mt-6 flex justify-end">
							<Button variant="secondary" onClick={onClose}>
								Cancel
							</Button>
						</div>
					</div>
				)}

				{track === "personal" && (
					<div>
						<Dialog.Title
							className={`text-lg font-bold text-kumo-default mb-1 ${import.meta.env.DEV ? "cursor-pointer select-none" : ""}`}
							onClick={() => {
								if (import.meta.env.DEV) {
									setDevTapCount((prev) => {
										const next = prev + 1;
										if (next >= 5) {
											setTrack("domain");
											return 0;
										}
										return next;
									});
								}
							}}
						>
							Welcome to Inboxies
						</Dialog.Title>
						<p className="text-xs text-kumo-subtle mb-4">
							Choose your address on @{effectiveMailDomain}.
						</p>

						<form onSubmit={handlePersonalSubmit} className="space-y-4">
							{personalError && (
								<div className="rounded-lg bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
									{personalError}
								</div>
							)}

							<div>
								<label className="block text-xs font-medium text-kumo-subtle mb-1">
									Email Address
								</label>
								<div className="flex items-center gap-2">
									<Input
										placeholder="username"
										value={personalUsername}
										onChange={(e) => setPersonalUsername(e.target.value)}
										required
										autoFocus
									/>
									<span className="text-xs font-medium text-kumo-subtle whitespace-nowrap">
										@{effectiveMailDomain}
									</span>
								</div>
							</div>

							<div>
								<label className="block text-xs font-medium text-kumo-subtle mb-1">
									Your Name (optional)
								</label>
								<Input
									placeholder="e.g. Alex Smith"
									value={personalName}
									onChange={(e) => setPersonalName(e.target.value)}
								/>
							</div>

							<div>
								<label className="block text-xs font-medium text-kumo-subtle mb-1">
									Password (min 10 characters)
								</label>
								<Input
									type="password"
									placeholder="••••••••••••"
									value={personalPassword}
									onChange={(e) => setPersonalPassword(e.target.value)}
									required
									minLength={10}
								/>
							</div>

							<div className="flex justify-end gap-2 pt-4 border-t border-kumo-line">
								<Button
									variant="secondary"
									onClick={onClose}
									disabled={personalLoading}
								>
									Cancel
								</Button>
								<Button
									variant="primary"
									type="submit"
									disabled={personalLoading || personalPassword.length < 10}
								>
									{personalLoading ? "Creating..." : "Create Account"}
								</Button>
							</div>
						</form>
					</div>
				)}

				{track === "domain" && (
					<div>
						<div className="flex items-center gap-2 mb-2">
							<button
								type="button"
								onClick={() => setTrack("personal")}
								className="text-xs text-kumo-subtle hover:text-kumo-default"
							>
								← Back to personal account
							</button>
						</div>
						<Dialog.Title className="text-lg font-bold text-kumo-default mb-1">
							Connect or Register Custom Domain
						</Dialog.Title>
						<p className="text-xs text-kumo-subtle mb-3">
							Instant wholesale registration or connect your existing domain with automated Cloudflare routing.
						</p>

						{/* Powered by Cloudflare Brand Callout */}
						<div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 flex items-start gap-3 mb-4">
							<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400 mt-0.5">
								<CloudIcon size={16} weight="fill" />
							</div>
							<div className="text-xs space-y-0.5">
								<div className="font-semibold text-kumo-default flex items-center gap-1.5">
									<span>Powered by Cloudflare</span>
									<span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
										Global Edge
									</span>
								</div>
								<p className="text-kumo-subtle">
									Every domain benefits from Cloudflare Anycast DNS, Universal SSL/TLS certificates, email routing with SPF/DKIM/DMARC, and enterprise DDoS protection.
								</p>
							</div>
						</div>

						<form onSubmit={handleCustomDomainSubmit} className="space-y-4">
							{customError && (
								<div className="rounded-lg bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
									{customError}
								</div>
							)}

							<div>
								<div className="flex items-center justify-between mb-1">
									<label className="block text-xs font-medium text-kumo-subtle">
										Your Custom Domain
									</label>
									{checkLoading && (
										<span className="text-[11px] text-kumo-subtle flex items-center gap-1">
											<Loader size="xs" /> Checking availability...
										</span>
									)}
								</div>
								<Input
									placeholder="e.g. acme.corp"
									value={customDomain}
									onChange={(e) => setCustomDomain(e.target.value)}
									required
									autoFocus
								/>

								{/* Availability Feedback Card */}
								{availability && (
									<div className="mt-2 text-xs">
										{availability.alreadyInInboxies ? (
											<div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-2.5 text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
												<WarningCircleIcon size={16} className="shrink-0" />
												<span>This domain is already registered inside Inboxies.</span>
											</div>
										) : availability.available ? (
											<div className="space-y-2.5 pt-1">
												<div className="flex items-center justify-between p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300">
													<span className="flex items-center gap-1.5 font-medium">
														<CheckCircleIcon size={16} weight="fill" />
														Domain is available to register!
													</span>
													<span className="font-bold text-xs bg-emerald-500/20 px-2 py-0.5 rounded-full">
														$14.00 / year
													</span>
												</div>

												{/* 2-Track Selector: Purchase vs Connect */}
												<div className="grid grid-cols-2 gap-2 p-1 bg-kumo-recessed rounded-lg border border-kumo-line text-xs font-medium">
													<button
														type="button"
														onClick={() => setDomainAction("purchase")}
														className={`py-2 px-3 rounded-md transition-all text-center cursor-pointer ${
															domainAction === "purchase"
																? "bg-kumo-base text-kumo-default shadow-sm font-semibold border border-kumo-line"
																: "text-kumo-subtle hover:text-kumo-default"
														}`}
													>
														Register Domain ($14/yr)
													</button>
													<button
														type="button"
														onClick={() => setDomainAction("connect")}
														className={`py-2 px-3 rounded-md transition-all text-center cursor-pointer ${
															domainAction === "connect"
																? "bg-kumo-base text-kumo-default shadow-sm font-semibold border border-kumo-line"
																: "text-kumo-subtle hover:text-kumo-default"
														}`}
													>
														I already own this domain
													</button>
												</div>

												{domainAction === "purchase" ? (
													<div className="text-[11px] text-kumo-subtle bg-kumo-tint p-2.5 rounded-lg border border-kumo-line space-y-0.5">
														<div className="font-medium text-kumo-default">
															Instant 1-Click Registration:
														</div>
														<div>
															✓ Automatic root DNS and email routing setup without touching nameservers.
														</div>
														<div>
															✓ Direct wholesale renewal price via Cloudflare Registrar.
														</div>
													</div>
												) : (
													<div className="text-[11px] text-kumo-subtle bg-kumo-tint p-2.5 rounded-lg border border-kumo-line">
														You will configure your domain registrar (GoDaddy, Namecheap, etc.) to point to Cloudflare nameservers.
													</div>
												)}
											</div>
										) : (
											<div className="flex items-center justify-between p-2.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-700 dark:text-sky-300">
												<span className="flex items-center gap-1.5 font-medium">
													<GlobeIcon size={16} />
													Domain registered externally
												</span>
												<span className="text-[11px] opacity-80">
													Connect via Cloudflare Nameservers
												</span>
											</div>
										)}
									</div>
								)}
							</div>

							<div>
								<label className="block text-xs font-medium text-kumo-subtle mb-1">
									Primary Admin Address
								</label>
								<div className="flex items-center gap-2">
									<Input
										placeholder="you"
										value={customUsername}
										onChange={(e) => setCustomUsername(e.target.value)}
										required
									/>
									<span className="text-xs font-medium text-kumo-subtle whitespace-nowrap">
										@{customDomain.trim() || "yourdomain.com"}
									</span>
								</div>
							</div>

							<div>
								<label className="block text-xs font-medium text-kumo-subtle mb-1">
									Full Name (optional)
								</label>
								<Input
									placeholder="e.g. Alex Johnson"
									value={customName}
									onChange={(e) => setCustomName(e.target.value)}
								/>
							</div>

							<div>
								<label className="block text-xs font-medium text-kumo-subtle mb-1">
									Password (min 10 characters)
								</label>
								<Input
									type="password"
									placeholder="••••••••••••"
									value={customPassword}
									onChange={(e) => setCustomPassword(e.target.value)}
									required
									minLength={10}
								/>
							</div>

							<div className="flex justify-end gap-2 pt-4 border-t border-kumo-line">
								<Button
									variant="secondary"
									onClick={() => setTrack("select")}
									disabled={customLoading || checkoutRedirecting}
								>
									Back
								</Button>
								<Button
									variant="primary"
									type="submit"
									disabled={
										customLoading ||
										checkoutRedirecting ||
										customPassword.length < 10 ||
										Boolean(availability?.alreadyInInboxies)
									}
								>
									{checkoutRedirecting
										? "Redirecting to Checkout..."
										: customLoading
											? "Provisioning..."
											: domainAction === "purchase" && availability?.available
												? "Register & Pay $14.00/yr →"
												: "Connect Domain & Setup"}
								</Button>
							</div>
						</form>
					</div>
				)}

				{track === "dns_wizard" && dnsSetup && (
					<div className="space-y-4">
						<div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
							<CheckCircleIcon size={24} weight="fill" />
							<Dialog.Title className="text-lg font-bold text-kumo-default">
								Domain Registered & Provisioned!
							</Dialog.Title>
						</div>
						<p className="text-sm text-kumo-subtle">
							Cloudflare Email Routing has been configured for{" "}
							<span className="font-semibold text-kumo-default">{dnsSetup.domain}</span>.
						</p>

						<div className="rounded-xl border border-kumo-line bg-kumo-recessed p-4 space-y-3">
							<div className="text-xs font-bold text-kumo-default uppercase tracking-wider">
								Update Nameservers at your Domain Registrar
							</div>
							<p className="text-xs text-kumo-subtle">
								Log into your domain provider (GoDaddy, Namecheap, Google Domains) and point your domain to Cloudflare:
							</p>

							<div className="space-y-1.5">
								{dnsSetup.nameservers.map((ns) => (
									<div
										key={ns}
										className="flex items-center justify-between text-xs font-mono bg-kumo-base px-3 py-2 rounded-lg border border-kumo-line text-kumo-default"
									>
										<span>{ns}</span>
										<button
											type="button"
											onClick={() => handleCopy(ns)}
											className="text-kumo-subtle hover:text-kumo-default transition-colors p-1"
											title="Copy nameserver"
										>
											<CopyIcon size={16} />
										</button>
									</div>
								))}
							</div>
						</div>

						<div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
							<WarningCircleIcon size={18} className="shrink-0 mt-0.5" />
							<div>
								<strong>Non-blocking Setup:</strong> You can start exploring your inbox immediately while DNS records propagate across the internet.
							</div>
						</div>

						<div className="flex justify-end gap-2 pt-2">
							<Button
								variant="primary"
								onClick={() => {
									onSuccess(dnsSetup.mailboxId);
									resetState();
									onClose();
								}}
							>
								Go to Inbox
							</Button>
						</div>
					</div>
				)}
			</Dialog>
		</Dialog.Root>
	);
}
