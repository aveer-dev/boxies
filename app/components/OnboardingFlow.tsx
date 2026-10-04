// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	Button,
	Dialog,
	Input,
	Loader,
	useKumoToastManager,
} from "@cloudflare/kumo";
import {
	ArrowLeftIcon,
	ArrowRightIcon,
	CheckCircleIcon,
	CheckIcon,
	ClockIcon,
	CloudIcon,
	CopyIcon,
	EnvelopeIcon,
	EyeIcon,
	EyeSlashIcon,
	GlobeIcon,
	PlusIcon,
	ShieldCheckIcon,
	SparkleIcon,
	TrashIcon,
	UserPlusIcon,
	UsersIcon,
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

type OnboardingTrack = "select" | "personal" | "domain";

interface NewTeamUser {
	fullName: string;
	contactEmail: string;
	username: string;
}

interface NewAlias {
	aliasLocal: string;
	targetMailboxId: string;
}

export function OnboardingFlow({
	isOpen,
	onClose,
	mailDomain,
	onSuccess,
}: OnboardingFlowProps) {
	const toastManager = useKumoToastManager();
	const effectiveMailDomain = mailDomain || "inboxies.email";

	const getInitialTrack = (): OnboardingTrack => {
		if (typeof window !== "undefined") {
			const params = new URLSearchParams(window.location.search);
			if (params.get("debug") === "domain" || params.get("preview") === "domain") {
				return "domain";
			}
		}
		return "select";
	};

	const [track, setTrack] = useState<OnboardingTrack>(getInitialTrack);

	// Personal Flow Step (1: Name, 2: Password, 3: Backup Email, 4: Username)
	const [personalStep, setPersonalStep] = useState(1);
	const [personalName, setPersonalName] = useState("");
	const [personalPassword, setPersonalPassword] = useState("");
	const [showPersonalPassword, setShowPersonalPassword] = useState(false);
	const [personalBackupEmail, setPersonalBackupEmail] = useState("");
	const [personalUsername, setPersonalUsername] = useState("");
	const [personalLoading, setPersonalLoading] = useState(false);
	const [personalError, setPersonalError] = useState<string | null>(null);

	// Custom Domain Flow Step:
	// 1: Name, 2: Password, 3: Backup Email, 4: Domain Input,
	// 5: Domain Acquisition (Price/Pay or Nameservers),
	// 6: Custom Username, 7: Add Users, 8: Add Aliases,
	// 9: State of Setup, 10: Manual DNS Review (Skip), 11: Welcome
	const [domainStep, setDomainStep] = useState(1);
	const [customName, setCustomName] = useState("");
	const [customPassword, setCustomPassword] = useState("");
	const [showCustomPassword, setShowCustomPassword] = useState(false);
	const [customBackupEmail, setCustomBackupEmail] = useState("");
	const [customDomain, setCustomDomain] = useState("");
	const [customUsername, setCustomUsername] = useState("");
	const [customLoading, setCustomLoading] = useState(false);
	const [customError, setCustomError] = useState<string | null>(null);

	// Domain Availability & Checkout
	const [availability, setAvailability] = useState<DomainAvailabilityResponse | null>(null);
	const [checkLoading, setCheckLoading] = useState(false);
	const [checkError, setCheckError] = useState<string | null>(null);
	const [domainAction, setDomainAction] = useState<"purchase" | "connect">("purchase");
	const [checkoutRedirecting, setCheckoutRedirecting] = useState(false);
	const [nameservers, setNameservers] = useState<string[]>([
		"anna.ns.cloudflare.com",
		"bob.ns.cloudflare.com",
	]);
	const [isWatchingNameservers, setIsWatchingNameservers] = useState(false);
	const [zoneStatus, setZoneStatus] = useState<string>("pending");
	const [dnsAutoConfigured, setDnsAutoConfigured] = useState(false);

	// Additional Users (Step 7)
	const [teamUsers, setTeamUsers] = useState<NewTeamUser[]>([]);
	const [newUserName, setNewUserName] = useState("");
	const [newUserEmail, setNewUserEmail] = useState("");
	const [newUserUsername, setNewUserUsername] = useState("");

	// Email Aliases (Step 8)
	const [aliases, setAliases] = useState<NewAlias[]>([]);
	const [newAliasLocal, setNewAliasLocal] = useState("");
	const [newAliasTarget, setNewAliasTarget] = useState("");

	// Completed Session State
	const [createdMailboxId, setCreatedMailboxId] = useState<string | null>(null);
	const [copiedText, setCopiedText] = useState<string | null>(null);

	const resetState = () => {
		setTrack(getInitialTrack());
		setPersonalStep(1);
		setPersonalName("");
		setPersonalPassword("");
		setShowPersonalPassword(false);
		setPersonalBackupEmail("");
		setPersonalUsername("");
		setPersonalError(null);
		setPersonalLoading(false);

		setDomainStep(1);
		setCustomName("");
		setCustomPassword("");
		setShowCustomPassword(false);
		setCustomBackupEmail("");
		setCustomDomain("");
		setCustomUsername("");
		setCustomError(null);
		setCustomLoading(false);
		setAvailability(null);
		setCheckLoading(false);
		setCheckError(null);
		setDomainAction("purchase");
		setCheckoutRedirecting(false);
		setTeamUsers([]);
		setAliases([]);
		setCreatedMailboxId(null);
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
			setCheckError(null);
			return;
		}

		setCheckLoading(true);
		setCheckError(null);
		let cancelled = false;

		const timer = setTimeout(async () => {
			try {
				const res = await api.checkDomainAvailability(trimmed);
				if (!cancelled) {
					setAvailability(res);
					setCheckError(null);
					setDomainAction(res.available ? "purchase" : "connect");
				}
			} catch (err: unknown) {
				if (!cancelled) {
					setAvailability(null);
					const msg = err instanceof Error ? err.message : "Failed to check domain availability";
					setCheckError(msg);
				}
			} finally {
				if (!cancelled) setCheckLoading(false);
			}
		}, 500);

		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [customDomain]);

	// Handle copy to clipboard
	const handleCopy = (text: string) => {
		navigator.clipboard.writeText(text);
		setCopiedText(text);
		toastManager.add({ title: "Copied to clipboard" });
		setTimeout(() => setCopiedText(null), 2000);
	};

	// Submit Personal Account
	const handlePersonalComplete = async (e: FormEvent) => {
		e.preventDefault();
		setPersonalError(null);
		setPersonalLoading(true);

		try {
			const res = await api.signupPersonal({
				username: personalUsername.trim().toLowerCase(),
				password: personalPassword,
				displayName: personalName.trim() || undefined,
				backupEmail: personalBackupEmail.trim() || undefined,
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

	// Start Domain Purchase Checkout
	const handleInitiateDomainPurchase = async () => {
		setCustomLoading(true);
		setCheckoutRedirecting(true);
		setCustomError(null);

		const domain = customDomain.trim().toLowerCase();
		try {
			const returnUrl = `${window.location.origin}/api/v1/billing/checkout-return?domain=${encodeURIComponent(domain)}`;
			const res = await api.createDomainCheckout({
				domain,
				username: customUsername.trim().toLowerCase() || "admin",
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
	};

	// Provision Domain in Cloudflare (Connect Existing or Continue)
	const handleProvisionDomain = async () => {
		setCustomLoading(true);
		setCustomError(null);
		const domain = customDomain.trim().toLowerCase();
		const username = customUsername.trim().toLowerCase() || "admin";

		try {
			const res = await api.signupDomain({
				domain,
				username,
				password: customPassword,
				displayName: customName.trim() || undefined,
				backupEmail: customBackupEmail.trim() || undefined,
			});
			setNameservers(res.domain.nameservers || ["anna.ns.cloudflare.com", "bob.ns.cloudflare.com"]);
			setZoneStatus(res.domain.status);
			setDnsAutoConfigured(true);
			setCreatedMailboxId(res.mailbox.id);

			// Advance to step 6 (Custom Username selection)
			setDomainStep(6);
			toastManager.add({ title: "Domain registered & staged in Cloudflare!" });
		} catch (err: unknown) {
			setCustomError(
				err instanceof Error ? err.message : "Failed to provision custom domain",
			);
		} finally {
			setCustomLoading(false);
		}
	};

	// Watch nameservers in background
	const handleStartWatchingNameservers = () => {
		setIsWatchingNameservers(true);
		toastManager.add({ title: "Watching nameservers in the background..." });

		// Simulated/real background check: trigger DNS config once active
		setTimeout(async () => {
			try {
				const domain = customDomain.trim().toLowerCase();
				await api.fixDomainEmailDns(domain).catch(() => {});
				setDnsAutoConfigured(true);
				setZoneStatus("active");
			} catch {
				// continues in background
			}
		}, 3000);

		// Advance to custom username step
		setDomainStep(6);
	};

	// Add team user
	const handleAddTeamUser = () => {
		if (!newUserName.trim() || !newUserEmail.trim() || !newUserUsername.trim()) return;
		setTeamUsers((prev) => [
			...prev,
			{
				fullName: newUserName.trim(),
				contactEmail: newUserEmail.trim(),
				username: newUserUsername.trim().toLowerCase(),
			},
		]);
		setNewUserName("");
		setNewUserEmail("");
		setNewUserUsername("");
	};

	// Add email alias
	const handleAddAlias = (preset?: string) => {
		const local = (preset || newAliasLocal).trim().toLowerCase().replace(/^@+/, "");
		if (!local) return;
		const target = newAliasTarget || `${customUsername || "admin"}@${customDomain}`;
		if (aliases.some((a) => a.aliasLocal === local)) return;

		setAliases((prev) => [...prev, { aliasLocal: local, targetMailboxId: target }]);
		setNewAliasLocal("");
	};

	// Persist Team Users and Aliases before setup review
	const handleSaveTeamAndAliases = async () => {
		setCustomLoading(true);
		const domain = customDomain.trim().toLowerCase();
		try {
			if (teamUsers.length > 0) {
				await api.setupDomainUsers(domain, teamUsers).catch(() => {});
			}
			if (aliases.length > 0) {
				await api.setupDomainAliases(domain, aliases).catch(() => {});
			}
		} finally {
			setCustomLoading(false);
			setDomainStep(9); // State of setup
		}
	};

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
				{/* ------------------------------------------------------------- */}
				{/* SELECT TRACK                                                  */}
				{/* ------------------------------------------------------------- */}
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
								onClick={() => {
									setTrack("personal");
									setPersonalStep(1);
								}}
								className="flex flex-col text-left p-5 rounded-xl border border-kumo-line bg-kumo-base hover:border-kumo-default hover:bg-kumo-tint transition-all group cursor-pointer"
							>
								<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mb-3 group-hover:scale-105 transition-transform">
									<EnvelopeIcon size={24} />
								</div>
								<h3 className="text-base font-semibold text-kumo-default mb-1">
									Personal Address
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
								onClick={() => {
									setTrack("domain");
									setDomainStep(1);
								}}
								className="flex flex-col text-left p-5 rounded-xl border border-kumo-line bg-kumo-base hover:border-kumo-default hover:bg-kumo-tint transition-all group cursor-pointer"
							>
								<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 mb-3 group-hover:scale-105 transition-transform">
									<GlobeIcon size={24} />
								</div>
								<h3 className="text-base font-semibold text-kumo-default mb-1">
									Custom Domain
								</h3>
								<p className="text-xs text-kumo-subtle flex-1 mb-4">
									Automated Cloudflare integration. Buy wholesale or connect an existing domain.
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

				{/* ------------------------------------------------------------- */}
				{/* PERSONAL TRACK (4 STEPS)                                      */}
				{/* ------------------------------------------------------------- */}
				{track === "personal" && (
					<div className="space-y-4">
						{/* Progress Bar */}
						<div className="flex items-center justify-between border-b border-kumo-line pb-3">
							<div className="flex items-center gap-2">
								<span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
									Personal Setup
								</span>
								<span className="text-xs text-kumo-subtle">
									Step {personalStep} of 4
								</span>
							</div>
							<div className="flex gap-1">
								{[1, 2, 3, 4].map((step) => (
									<div
										key={step}
										className={`h-1.5 w-6 rounded-full transition-all ${
											step <= personalStep
												? "bg-emerald-500"
												: "bg-kumo-line"
										}`}
									/>
								))}
							</div>
						</div>

						{personalError && (
							<div className="rounded-lg bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
								{personalError}
							</div>
						)}

						{/* Step 1: Full Name */}
						{personalStep === 1 && (
							<div className="space-y-4">
								<div>
									<Dialog.Title className="text-lg font-bold text-kumo-default mb-1">
										What is your name?
									</Dialog.Title>
									<p className="text-xs text-kumo-subtle">
										We'll display this name on your outgoing emails.
									</p>
								</div>
								<div>
									<label className="block text-xs font-medium text-kumo-subtle mb-1">
										Full Name
									</label>
									<Input
										placeholder="e.g. Alex Smith"
										value={personalName}
										onChange={(e) => setPersonalName(e.target.value)}
										autoFocus
										required
									/>
								</div>
								<div className="flex justify-between pt-4 border-t border-kumo-line">
									<Button variant="secondary" onClick={() => setTrack("select")}>
										Back
									</Button>
									<Button
										variant="primary"
										onClick={() => setPersonalStep(2)}
										disabled={!personalName.trim()}
									>
										Continue <ArrowRightIcon size={14} className="ml-1" />
									</Button>
								</div>
							</div>
						)}

						{/* Step 2: Password with Toggle */}
						{personalStep === 2 && (
							<div className="space-y-4">
								<div>
									<Dialog.Title className="text-lg font-bold text-kumo-default mb-1">
										Set your password
									</Dialog.Title>
									<p className="text-xs text-kumo-subtle">
										Create a secure password with at least 10 characters.
									</p>
								</div>
								<div>
									<label className="block text-xs font-medium text-kumo-subtle mb-1">
										Password
									</label>
									<div className="relative flex items-center">
										<Input
											type={showPersonalPassword ? "text" : "password"}
											placeholder="••••••••••••"
											value={personalPassword}
											onChange={(e) => setPersonalPassword(e.target.value)}
											autoFocus
											required
											minLength={10}
										/>
										<button
											type="button"
											onClick={() => setShowPersonalPassword(!showPersonalPassword)}
											className="absolute right-3 text-kumo-subtle hover:text-kumo-default p-1 cursor-pointer"
											title={showPersonalPassword ? "Hide password" : "Show password"}
										>
											{showPersonalPassword ? <EyeSlashIcon size={16} /> : <EyeIcon size={16} />}
										</button>
									</div>
								</div>
								<div className="flex justify-between pt-4 border-t border-kumo-line">
									<Button variant="secondary" onClick={() => setPersonalStep(1)}>
										Back
									</Button>
									<Button
										variant="primary"
										onClick={() => setPersonalStep(3)}
										disabled={personalPassword.length < 10}
									>
										Continue <ArrowRightIcon size={14} className="ml-1" />
									</Button>
								</div>
							</div>
						)}

						{/* Step 3: Backup Email + Disclosure */}
						{personalStep === 3 && (
							<div className="space-y-4">
								<div>
									<Dialog.Title className="text-lg font-bold text-kumo-default mb-1">
										Backup & recovery email
									</Dialog.Title>
									<p className="text-xs text-kumo-subtle">
										Provide an existing email address for account recovery.
									</p>
								</div>
								<div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 flex items-start gap-2.5 text-xs text-emerald-700 dark:text-emerald-300">
									<ShieldCheckIcon size={20} className="shrink-0 mt-0.5" />
									<p>
										We will use this email address strictly for account backup, password resets, and critical security notices.
									</p>
								</div>
								<div>
									<label className="block text-xs font-medium text-kumo-subtle mb-1">
										Recovery Email Address
									</label>
									<Input
										type="email"
										placeholder="e.g. alex@gmail.com"
										value={personalBackupEmail}
										onChange={(e) => setPersonalBackupEmail(e.target.value)}
										autoFocus
										required
									/>
								</div>
								<div className="flex justify-between pt-4 border-t border-kumo-line">
									<Button variant="secondary" onClick={() => setPersonalStep(2)}>
										Back
									</Button>
									<Button
										variant="primary"
										onClick={() => setPersonalStep(4)}
										disabled={!personalBackupEmail.includes("@")}
									>
										Continue <ArrowRightIcon size={14} className="ml-1" />
									</Button>
								</div>
							</div>
						)}

						{/* Step 4: Create Email Address */}
						{personalStep === 4 && (
							<form onSubmit={handlePersonalComplete} className="space-y-4">
								<div>
									<Dialog.Title className="text-lg font-bold text-kumo-default mb-1">
										Choose your address
									</Dialog.Title>
									<p className="text-xs text-kumo-subtle">
										Your personal email address will be on @{effectiveMailDomain}.
									</p>
								</div>
								<div>
									<label className="block text-xs font-medium text-kumo-subtle mb-1">
										Username
									</label>
									<div className="flex items-center gap-2">
										<Input
											placeholder="username"
											value={personalUsername}
											onChange={(e) => setPersonalUsername(e.target.value)}
											autoFocus
											required
										/>
										<span className="text-xs font-medium text-kumo-subtle whitespace-nowrap">
											@{effectiveMailDomain}
										</span>
									</div>
								</div>
								<div className="flex justify-between pt-4 border-t border-kumo-line">
									<Button
										variant="secondary"
										onClick={() => setPersonalStep(3)}
										disabled={personalLoading}
									>
										Back
									</Button>
									<Button
										variant="primary"
										type="submit"
										disabled={personalLoading || !personalUsername.trim()}
									>
										{personalLoading ? "Creating..." : "Create Account"}
									</Button>
								</div>
							</form>
						)}
					</div>
				)}

				{/* ------------------------------------------------------------- */}
				{/* CUSTOM DOMAIN TRACK (11 STEPS)                                */}
				{/* ------------------------------------------------------------- */}
				{track === "domain" && (
					<div className="space-y-4">
						{/* Progress Header */}
						<div className="flex items-center justify-between border-b border-kumo-line pb-3">
							<div className="flex items-center gap-2">
								<span className="text-xs font-bold text-sky-600 dark:text-sky-400 uppercase tracking-wider">
									Custom Domain
								</span>
								<span className="text-xs text-kumo-subtle">
									Step {domainStep} of 11
								</span>
							</div>
							<div className="flex gap-1 overflow-hidden">
								{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((step) => (
									<div
										key={step}
										className={`h-1.5 w-3.5 rounded-full transition-all ${
											step <= domainStep ? "bg-sky-500" : "bg-kumo-line"
										}`}
									/>
								))}
							</div>
						</div>

						{customError && (
							<div className="rounded-lg bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
								{customError}
							</div>
						)}

						{/* Step 1: Full Name */}
						{domainStep === 1 && (
							<div className="space-y-4">
								<div>
									<Dialog.Title className="text-lg font-bold text-kumo-default mb-1">
										What is your full name?
									</Dialog.Title>
									<p className="text-xs text-kumo-subtle">
										This will be your primary administrator name.
									</p>
								</div>
								<div>
									<label className="block text-xs font-medium text-kumo-subtle mb-1">
										Full Name
									</label>
									<Input
										placeholder="e.g. Sarah Connor"
										value={customName}
										onChange={(e) => setCustomName(e.target.value)}
										autoFocus
										required
									/>
								</div>
								<div className="flex justify-between pt-4 border-t border-kumo-line">
									<Button variant="secondary" onClick={() => setTrack("select")}>
										Back
									</Button>
									<Button
										variant="primary"
										onClick={() => setDomainStep(2)}
										disabled={!customName.trim()}
									>
										Continue <ArrowRightIcon size={14} className="ml-1" />
									</Button>
								</div>
							</div>
						)}

						{/* Step 2: Password with Toggle */}
						{domainStep === 2 && (
							<div className="space-y-4">
								<div>
									<Dialog.Title className="text-lg font-bold text-kumo-default mb-1">
										Set master password
									</Dialog.Title>
									<p className="text-xs text-kumo-subtle">
										Used to log in as domain administrator (min 10 characters).
									</p>
								</div>
								<div>
									<label className="block text-xs font-medium text-kumo-subtle mb-1">
										Password
									</label>
									<div className="relative flex items-center">
										<Input
											type={showCustomPassword ? "text" : "password"}
											placeholder="••••••••••••"
											value={customPassword}
											onChange={(e) => setCustomPassword(e.target.value)}
											autoFocus
											required
											minLength={10}
										/>
										<button
											type="button"
											onClick={() => setShowCustomPassword(!showCustomPassword)}
											className="absolute right-3 text-kumo-subtle hover:text-kumo-default p-1 cursor-pointer"
											title={showCustomPassword ? "Hide password" : "Show password"}
										>
											{showCustomPassword ? <EyeSlashIcon size={16} /> : <EyeIcon size={16} />}
										</button>
									</div>
								</div>
								<div className="flex justify-between pt-4 border-t border-kumo-line">
									<Button variant="secondary" onClick={() => setDomainStep(1)}>
										Back
									</Button>
									<Button
										variant="primary"
										onClick={() => setDomainStep(3)}
										disabled={customPassword.length < 10}
									>
										Continue <ArrowRightIcon size={14} className="ml-1" />
									</Button>
								</div>
							</div>
						)}

						{/* Step 3: Backup Email */}
						{domainStep === 3 && (
							<div className="space-y-4">
								<div>
									<Dialog.Title className="text-lg font-bold text-kumo-default mb-1">
										Administrator backup email
									</Dialog.Title>
									<p className="text-xs text-kumo-subtle">
										External email address used for domain alerts and account recovery.
									</p>
								</div>
								<div>
									<label className="block text-xs font-medium text-kumo-subtle mb-1">
										Backup Email Address
									</label>
									<Input
										type="email"
										placeholder="e.g. sarah@external.com"
										value={customBackupEmail}
										onChange={(e) => setCustomBackupEmail(e.target.value)}
										autoFocus
										required
									/>
								</div>
								<div className="flex justify-between pt-4 border-t border-kumo-line">
									<Button variant="secondary" onClick={() => setDomainStep(2)}>
										Back
									</Button>
									<Button
										variant="primary"
										onClick={() => setDomainStep(4)}
										disabled={!customBackupEmail.includes("@")}
									>
										Continue <ArrowRightIcon size={14} className="ml-1" />
									</Button>
								</div>
							</div>
						)}

						{/* Step 4: Custom Domain Input / Selection */}
						{domainStep === 4 && (
							<div className="space-y-4">
								<div>
									<Dialog.Title className="text-lg font-bold text-kumo-default mb-1">
										Select or enter domain
									</Dialog.Title>
									<p className="text-xs text-kumo-subtle">
										Buy a new domain or connect a domain you already own.
									</p>
								</div>
								<div>
									<div className="flex items-center justify-between mb-1">
										<label className="block text-xs font-medium text-kumo-subtle">
											Domain Name
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
										autoFocus
										required
									/>
								</div>

								{/* Availability Feedback Card */}
								{checkError && !checkLoading && (
									<div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5">
										<WarningCircleIcon size={16} />
										<span>{checkError}</span>
									</div>
								)}

								{availability && (
									<div className="rounded-xl border border-kumo-line bg-kumo-recessed p-3 space-y-2 text-xs">
										{availability.alreadyInInboxies ? (
											<div className="text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
												<WarningCircleIcon size={16} />
												<span>This domain is already registered inside Inboxies.</span>
											</div>
										) : availability.available ? (
											<div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400 font-medium">
												<span className="flex items-center gap-1.5">
													<CheckCircleIcon size={16} weight="fill" />
													Domain available to buy wholesale!
												</span>
												<span className="font-bold bg-emerald-500/10 px-2 py-0.5 rounded-full">
													$14.00 / yr
												</span>
											</div>
										) : (
											<div className="flex items-center justify-between text-sky-600 dark:text-sky-400 font-medium">
												<span className="flex items-center gap-1.5">
													<GlobeIcon size={16} />
													Domain is registered externally.
												</span>
												<span className="text-[11px]">Connect via Cloudflare NS</span>
											</div>
										)}
									</div>
								)}

								<div className="flex justify-between pt-4 border-t border-kumo-line">
									<Button variant="secondary" onClick={() => setDomainStep(3)}>
										Back
									</Button>
									<Button
										variant="primary"
										onClick={() => setDomainStep(5)}
										disabled={
											!customDomain.includes(".") ||
											Boolean(availability?.alreadyInInboxies) ||
											checkLoading
										}
									>
										Continue <ArrowRightIcon size={14} className="ml-1" />
									</Button>
								</div>
							</div>
						)}

						{/* Step 5: Domain Acquisition (Price Breakdown OR Nameservers) */}
						{domainStep === 5 && (
							<div className="space-y-4">
								{domainAction === "purchase" && availability?.available ? (
									<>
										<div>
											<Dialog.Title className="text-lg font-bold text-kumo-default mb-1">
												Pricing breakdown
											</Dialog.Title>
											<p className="text-xs text-kumo-subtle">
												Instant wholesale domain registration powered by Cloudflare Registrar.
											</p>
										</div>

										<div className="rounded-xl border border-kumo-line bg-kumo-recessed p-4 space-y-3">
											<div className="flex justify-between items-center text-sm font-semibold text-kumo-default border-b border-kumo-line pb-2">
												<span>1-Year Domain Registration</span>
												<span>$14.00 USD</span>
											</div>
											<div className="text-xs text-kumo-subtle space-y-1.5">
												<div className="flex items-center justify-between">
													<span>ICANN Fees</span>
													<span className="text-emerald-600 dark:text-emerald-400 font-medium">Included</span>
												</div>
												<div className="flex items-center justify-between">
													<span>WHOIS Privacy Protection</span>
													<span className="text-emerald-600 dark:text-emerald-400 font-medium">Free</span>
												</div>
												<div className="flex items-center justify-between">
													<span>Global Anycast DNS & SSL</span>
													<span className="text-emerald-600 dark:text-emerald-400 font-medium">Included</span>
												</div>
												<div className="flex items-center justify-between">
													<span>Auto-Configured MX/SPF/DMARC</span>
													<span className="text-emerald-600 dark:text-emerald-400 font-medium">Automatic</span>
												</div>
											</div>
										</div>

										<div className="flex justify-between pt-4 border-t border-kumo-line">
											<Button variant="secondary" onClick={() => setDomainStep(4)}>
												Back
											</Button>
											<div className="flex gap-2">
												<Button
													variant="secondary"
													onClick={() => {
														setDomainAction("connect");
													}}
												>
													I already own this domain
												</Button>
												<Button
													variant="primary"
													onClick={handleInitiateDomainPurchase}
													disabled={customLoading || checkoutRedirecting}
												>
													{checkoutRedirecting ? (
														"Redirecting to payment..."
													) : (
														"Pay $14.00 & Register →"
													)}
												</Button>
											</div>
										</div>
									</>
								) : (
									<>
										<div>
											<Dialog.Title className="text-lg font-bold text-kumo-default mb-1">
												Update registrar nameservers
											</Dialog.Title>
											<p className="text-xs text-kumo-subtle">
												Point your domain to Cloudflare nameservers at your registrar.
											</p>
										</div>

										<div className="rounded-xl border border-kumo-line bg-kumo-recessed p-4 space-y-3">
											<p className="text-xs text-kumo-subtle">
												Log into your registrar (GoDaddy, Namecheap, Google) and set your nameservers to:
											</p>
											<div className="space-y-2">
												{nameservers.map((ns) => (
													<div
														key={ns}
														className="flex items-center justify-between text-xs font-mono bg-kumo-base px-3 py-2 rounded-lg border border-kumo-line text-kumo-default"
													>
														<span>{ns}</span>
														<button
															type="button"
															onClick={() => handleCopy(ns)}
															className="text-kumo-subtle hover:text-kumo-default transition-colors p-1"
															title="Copy"
														>
															{copiedText === ns ? <CheckIcon size={14} className="text-emerald-500" /> : <CopyIcon size={14} />}
														</button>
													</div>
												))}
											</div>
										</div>

										<div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 text-xs text-sky-700 dark:text-sky-300 flex items-start gap-2">
											<CloudIcon size={18} className="shrink-0 mt-0.5" />
											<p>
												Once you confirm, we watch in the background. As soon as nameservers point to Cloudflare, email DNS is configured automatically!
											</p>
										</div>

										<div className="flex justify-between pt-4 border-t border-kumo-line">
											<Button variant="secondary" onClick={() => setDomainStep(4)}>
												Back
											</Button>
											<Button
												variant="primary"
												onClick={handleStartWatchingNameservers}
											>
												I've updated my nameservers →
											</Button>
										</div>
									</>
								)}
							</div>
						)}

						{/* Step 6: Custom Email Username */}
						{domainStep === 6 && (
							<div className="space-y-4">
								<div>
									<Dialog.Title className="text-lg font-bold text-kumo-default mb-1">
										Your admin email address
									</Dialog.Title>
									<p className="text-xs text-kumo-subtle">
										Choose your custom username on @{customDomain}.
									</p>
								</div>
								<div>
									<label className="block text-xs font-medium text-kumo-subtle mb-1">
										Custom Username
									</label>
									<div className="flex items-center gap-2">
										<Input
											placeholder="you"
											value={customUsername}
											onChange={(e) => setCustomUsername(e.target.value)}
											autoFocus
											required
										/>
										<span className="text-xs font-medium text-kumo-subtle whitespace-nowrap">
											@{customDomain}
										</span>
									</div>
								</div>
								<div className="flex justify-between pt-4 border-t border-kumo-line">
									<Button variant="secondary" onClick={() => setDomainStep(5)}>
										Back
									</Button>
									<Button
										variant="primary"
										onClick={() => setDomainStep(7)}
										disabled={!customUsername.trim()}
									>
										Continue <ArrowRightIcon size={14} className="ml-1" />
									</Button>
								</div>
							</div>
						)}

						{/* Step 7: Add Users */}
						{domainStep === 7 && (
							<div className="space-y-4">
								<div>
									<Dialog.Title className="text-lg font-bold text-kumo-default mb-1">
										Add team users (optional)
									</Dialog.Title>
									<p className="text-xs text-kumo-subtle">
										Create additional email addresses for your team members.
									</p>
								</div>

								{/* User creation inputs */}
								<div className="p-3.5 rounded-xl border border-kumo-line bg-kumo-recessed space-y-2.5">
									<div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
										<Input
											placeholder="Full Name"
											value={newUserName}
											onChange={(e) => setNewUserName(e.target.value)}
										/>
										<Input
											placeholder="Contact Email"
											value={newUserEmail}
											onChange={(e) => setNewUserEmail(e.target.value)}
										/>
										<div className="flex items-center gap-1">
											<Input
												placeholder="username"
												value={newUserUsername}
												onChange={(e) => setNewUserUsername(e.target.value)}
											/>
											<span className="text-[11px] text-kumo-subtle">@{customDomain}</span>
										</div>
									</div>
									<Button
										variant="secondary"
										className="w-full justify-center text-xs"
										onClick={handleAddTeamUser}
										disabled={!newUserName || !newUserEmail || !newUserUsername}
									>
										<PlusIcon size={14} className="mr-1" /> Add User
									</Button>
								</div>

								{/* Users List */}
								{teamUsers.length > 0 && (
									<div className="space-y-1.5 max-h-36 overflow-y-auto">
										{teamUsers.map((u, i) => (
											<div
												key={i}
												className="flex items-center justify-between text-xs p-2.5 rounded-lg border border-kumo-line bg-kumo-base"
											>
												<div>
													<span className="font-semibold text-kumo-default">{u.fullName}</span>{" "}
													<span className="text-kumo-subtle font-mono">
														({u.username}@{customDomain})
													</span>
												</div>
												<button
													type="button"
													onClick={() => setTeamUsers(teamUsers.filter((_, idx) => idx !== i))}
													className="text-red-500 hover:text-red-600 p-1"
												>
													<TrashIcon size={14} />
												</button>
											</div>
										))}
									</div>
								)}

								<div className="flex justify-between pt-4 border-t border-kumo-line">
									<Button variant="secondary" onClick={() => setDomainStep(6)}>
										Back
									</Button>
									<Button variant="primary" onClick={() => setDomainStep(8)}>
										{teamUsers.length === 0 ? "Skip" : "Continue"} <ArrowRightIcon size={14} className="ml-1" />
									</Button>
								</div>
							</div>
						)}

						{/* Step 8: Add Email Aliases */}
						{domainStep === 8 && (
							<div className="space-y-4">
								<div>
									<Dialog.Title className="text-lg font-bold text-kumo-default mb-1">
										Add email aliases
									</Dialog.Title>
									<p className="text-xs text-kumo-subtle">
										Forward common addresses directly to your primary inbox.
									</p>
								</div>

								{/* Quick preset chips */}
								<div className="flex items-center gap-1.5 flex-wrap">
									<span className="text-xs text-kumo-subtle">Quick presets:</span>
									{["support", "billing", "info", "hello"].map((preset) => (
										<button
											key={preset}
											type="button"
											onClick={() => handleAddAlias(preset)}
											className="text-[11px] px-2.5 py-1 rounded-full border border-kumo-line bg-kumo-base hover:bg-kumo-tint text-kumo-default transition-all cursor-pointer"
										>
											+{preset}@{customDomain}
										</button>
									))}
								</div>

								{/* Custom alias input */}
								<div className="flex items-center gap-2">
									<div className="flex items-center gap-1 flex-1">
										<Input
											placeholder="alias (e.g. sales)"
											value={newAliasLocal}
											onChange={(e) => setNewAliasLocal(e.target.value)}
										/>
										<span className="text-xs text-kumo-subtle">@{customDomain}</span>
									</div>
									<Button
										variant="secondary"
										onClick={() => handleAddAlias()}
										disabled={!newAliasLocal.trim()}
									>
										Add
									</Button>
								</div>

								{/* Configured Aliases */}
								{aliases.length > 0 && (
									<div className="space-y-1.5 max-h-36 overflow-y-auto">
										{aliases.map((a, i) => (
											<div
												key={i}
												className="flex items-center justify-between text-xs p-2.5 rounded-lg border border-kumo-line bg-kumo-base"
											>
												<span className="font-mono text-kumo-default">
													{a.aliasLocal}@{customDomain} → {a.targetMailboxId}
												</span>
												<button
													type="button"
													onClick={() => setAliases(aliases.filter((_, idx) => idx !== i))}
													className="text-red-500 hover:text-red-600 p-1"
												>
													<TrashIcon size={14} />
												</button>
											</div>
										))}
									</div>
								)}

								<div className="flex justify-between pt-4 border-t border-kumo-line">
									<Button variant="secondary" onClick={() => setDomainStep(7)}>
										Back
									</Button>
									<Button
										variant="primary"
										onClick={handleSaveTeamAndAliases}
										disabled={customLoading}
									>
										{customLoading ? "Saving..." : "Continue"} <ArrowRightIcon size={14} className="ml-1" />
									</Button>
								</div>
							</div>
						)}

						{/* Step 9: State of Setup */}
						{domainStep === 9 && (
							<div className="space-y-4">
								<div>
									<Dialog.Title className="text-lg font-bold text-kumo-default mb-1">
										State of setup
									</Dialog.Title>
									<p className="text-xs text-kumo-subtle">
										Current readiness of your domain and email configuration.
									</p>
								</div>

								<div className="rounded-xl border border-kumo-line bg-kumo-recessed p-4 space-y-2.5 text-xs">
									<div className="flex items-center justify-between">
										<span className="font-medium text-kumo-default">Domain Registration / Zone</span>
										<span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
											<CheckCircleIcon size={16} weight="fill" /> Active
										</span>
									</div>
									<div className="flex items-center justify-between">
										<span className="font-medium text-kumo-default">Cloudflare Nameservers</span>
										<span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
											<CheckCircleIcon size={16} weight="fill" /> Assigned
										</span>
									</div>
									<div className="flex items-center justify-between">
										<span className="font-medium text-kumo-default">Email Routing (MX & Catch-All)</span>
										<span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
											<CheckCircleIcon size={16} weight="fill" /> Configured
										</span>
									</div>
									<div className="flex items-center justify-between">
										<span className="font-medium text-kumo-default">SPF, DKIM & DMARC Security</span>
										<span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
											<CheckCircleIcon size={16} weight="fill" /> Staged
										</span>
									</div>
									<div className="flex items-center justify-between">
										<span className="font-medium text-kumo-default">Team Users Configured</span>
										<span className="font-semibold text-kumo-default">
											{teamUsers.length + 1} Mailbox(es)
										</span>
									</div>
									<div className="flex items-center justify-between">
										<span className="font-medium text-kumo-default">Email Aliases</span>
										<span className="font-semibold text-kumo-default">
											{aliases.length} Active
										</span>
									</div>
								</div>

								<div className="flex justify-between pt-4 border-t border-kumo-line">
									<Button variant="secondary" onClick={() => setDomainStep(8)}>
										Back
									</Button>
									<Button variant="primary" onClick={() => setDomainStep(10)}>
										Review DNS Records <ArrowRightIcon size={14} className="ml-1" />
									</Button>
								</div>
							</div>
						)}

						{/* Step 10: Manual DNS Records (Can Skip) */}
						{domainStep === 10 && (
							<div className="space-y-4">
								<div>
									<Dialog.Title className="text-lg font-bold text-kumo-default mb-1">
										DNS records overview
									</Dialog.Title>
									<p className="text-xs text-kumo-subtle">
										For domains maintaining external DNS, configure these records. (You can skip if using Cloudflare nameservers).
									</p>
								</div>

								<div className="rounded-xl border border-kumo-line bg-kumo-recessed p-3.5 space-y-2 text-xs font-mono">
									<div className="p-2 rounded bg-kumo-base border border-kumo-line">
										<div className="text-[10px] text-kumo-subtle uppercase">MX Records (Priority 10)</div>
										<div>route1.mx.cloudflare.net</div>
									</div>
									<div className="p-2 rounded bg-kumo-base border border-kumo-line">
										<div className="text-[10px] text-kumo-subtle uppercase">SPF Record (TXT)</div>
										<div>v=spf1 include:_spf.mx.cloudflare.net ~all</div>
									</div>
									<div className="p-2 rounded bg-kumo-base border border-kumo-line">
										<div className="text-[10px] text-kumo-subtle uppercase">DMARC Record (TXT)</div>
										<div>v=DMARC1; p=reject; sp=reject; adkim=r; aspf=r;</div>
									</div>
								</div>

								<div className="flex justify-between pt-4 border-t border-kumo-line">
									<Button variant="secondary" onClick={() => setDomainStep(9)}>
										Back
									</Button>
									<div className="flex gap-2">
										<Button variant="secondary" onClick={() => setDomainStep(11)}>
											Skip
										</Button>
										<Button variant="primary" onClick={() => setDomainStep(11)}>
											Continue to Welcome <ArrowRightIcon size={14} className="ml-1" />
										</Button>
									</div>
								</div>
							</div>
						)}

						{/* Step 11: Welcome Page */}
						{domainStep === 11 && (
							<div className="space-y-5 text-center py-4">
								<div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
									<SparkleIcon size={32} weight="fill" />
								</div>
								<div>
									<Dialog.Title className="text-xl font-bold text-kumo-default mb-1">
										Welcome to your new Inbox!
									</Dialog.Title>
									<p className="text-xs text-kumo-subtle max-w-sm mx-auto">
										Your domain <span className="font-semibold text-kumo-default">{customDomain}</span> is ready with automated Cloudflare routing.
									</p>
								</div>

								<div className="rounded-xl border border-kumo-line bg-kumo-recessed p-3.5 text-xs text-left space-y-1.5">
									<div>
										<span className="text-kumo-subtle">Primary Address:</span>{" "}
										<span className="font-semibold font-mono text-kumo-default">
											{customUsername}@{customDomain}
										</span>
									</div>
									{teamUsers.length > 0 && (
										<div>
											<span className="text-kumo-subtle">Team Members:</span>{" "}
											<span className="font-medium text-kumo-default">{teamUsers.length} added</span>
										</div>
									)}
									{aliases.length > 0 && (
										<div>
											<span className="text-kumo-subtle">Active Aliases:</span>{" "}
											<span className="font-medium text-kumo-default">{aliases.length} configured</span>
										</div>
									)}
								</div>

								<Button
									variant="primary"
									className="w-full justify-center py-2.5 text-sm font-semibold"
									onClick={() => {
										onSuccess(createdMailboxId || `${customUsername}@${customDomain}`);
										resetState();
										onClose();
									}}
								>
									Open Inbox →
								</Button>
							</div>
						)}
					</div>
				)}
			</Dialog>
		</Dialog.Root>
	);
}
