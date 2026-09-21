// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Input, Loader, useKumoToastManager } from "@cloudflare/kumo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import SettingsSubpage from "~/components/SettingsSubpage";
import api from "~/services/api";

function identityTypeLabel(type: string): string {
	switch (type) {
		case "email":
			return "Email";
		case "password":
			return "Password";
		case "apple":
			return "Apple";
		case "google":
			return "Google";
		case "sub":
			return "Sign-in provider";
		case "access":
			return "Access";
		default:
			return type;
	}
}

export default function SignInMethodsSettingsRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const toastManager = useKumoToastManager();
	const queryClient = useQueryClient();

	const { data, isLoading, refetch } = useQuery({
		queryKey: ["identities"],
		queryFn: () => api.listIdentities(),
		staleTime: 30_000,
	});

	const [isMinting, setIsMinting] = useState(false);
	const [linkCode, setLinkCode] = useState<string | null>(null);
	const [expiresAt, setExpiresAt] = useState<string | null>(null);
	const [redeemDraft, setRedeemDraft] = useState("");
	const [isRedeeming, setIsRedeeming] = useState(false);

	const handleCreateCode = async () => {
		setIsMinting(true);
		try {
			const res = await api.createIdentityLinkCode();
			setLinkCode(res.code);
			setExpiresAt(res.expiresAt);
			toastManager.add({ title: "Link code created — expires in 15 minutes" });
		} catch {
			toastManager.add({
				title: "Could not create link code",
				variant: "error",
			});
		} finally {
			setIsMinting(false);
		}
	};

	const handleCopy = async () => {
		if (!linkCode) return;
		try {
			await navigator.clipboard.writeText(linkCode);
			toastManager.add({ title: "Code copied" });
		} catch {
			toastManager.add({ title: "Copy failed", variant: "error" });
		}
	};

	const handleRedeem = async () => {
		const code = redeemDraft.trim();
		if (!code) return;
		setIsRedeeming(true);
		try {
			const res = await api.redeemIdentityLink(code);
			toastManager.add({
				title: res.isAdmin
					? "Linked — Domain Admin access restored"
					: "Sign-in method linked",
			});
			setRedeemDraft("");
			await refetch();
			await queryClient.invalidateQueries({ queryKey: ["me"] });
			await queryClient.invalidateQueries({ queryKey: ["mailboxes"] });
		} catch {
			toastManager.add({
				title: "Invalid or expired code",
				variant: "error",
			});
		} finally {
			setIsRedeeming(false);
		}
	};

	if (!mailboxId) return null;

	return (
		<SettingsSubpage mailboxId={mailboxId} title="Sign-in methods">
			<p className="text-sm text-kumo-subtle mb-6">
				Link Access email, Apple, Google, or password so every sign-in resolves
				to the same Inboxies account, Domain Admin role, and mailbox access.
			</p>

			{isLoading || !data ? (
				<div className="flex justify-center py-12">
					<Loader size="lg" />
				</div>
			) : (
				<div className="space-y-6">
					<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
						<div className="text-sm font-medium text-kumo-default mb-3">
							Connected
						</div>
						{data.identities.length === 0 ? (
							<p className="text-sm text-kumo-subtle">
								No linked identities yet. Generate a code below, then redeem it
								from your other device or sign-in method.
							</p>
						) : (
							<ul className="divide-y divide-kumo-line">
								{data.identities.map((identity) => (
									<li
										key={identity.key}
										className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
									>
										<div className="min-w-0">
											<div className="text-sm text-kumo-default truncate">
												{identity.label}
											</div>
											<div className="text-xs text-kumo-subtle">
												{identityTypeLabel(identity.type)}
												{identity.current ? " · this session" : ""}
											</div>
										</div>
									</li>
								))}
							</ul>
						)}
					</div>

					<div className="rounded-lg border border-kumo-line bg-kumo-base p-5 space-y-4">
						<div>
							<div className="text-sm font-medium text-kumo-default mb-1">
								Connect another sign-in method
							</div>
							<p className="text-xs text-kumo-subtle">
								On this browser (email / Access / password), create a code. On
								your phone after Sign in with Apple or Google, open Settings →
								Sign-in methods and enter the code. Codes expire in 15 minutes
								and only work while you are signed in on both sides.
							</p>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<Button
								variant="primary"
								size="sm"
								disabled={isMinting}
								onClick={handleCreateCode}
							>
								{isMinting ? "Creating…" : "Generate link code"}
							</Button>
							{linkCode && (
								<Button variant="secondary" size="sm" onClick={handleCopy}>
									Copy code
								</Button>
							)}
						</div>
						{linkCode && (
							<div className="rounded-md bg-kumo-tint px-3 py-3">
								<div className="font-mono text-lg tracking-widest text-kumo-default">
									{linkCode}
								</div>
								{expiresAt && (
									<p className="text-xs text-kumo-subtle mt-1">
										Expires {new Date(expiresAt).toLocaleString()}
									</p>
								)}
							</div>
						)}
					</div>

					<div className="rounded-lg border border-kumo-line bg-kumo-base p-5 space-y-3">
						<div>
							<div className="text-sm font-medium text-kumo-default mb-1">
								Redeem a code on this session
							</div>
							<p className="text-xs text-kumo-subtle">
								If you generated a code on another device or sign-in method,
								paste it here while signed in.
							</p>
						</div>
						<Input
							label="Link code"
							value={redeemDraft}
							onChange={(e) => setRedeemDraft(e.target.value)}
							placeholder="Paste code"
						/>
						<Button
							variant="secondary"
							size="sm"
							disabled={isRedeeming || !redeemDraft.trim()}
							onClick={handleRedeem}
						>
							{isRedeeming ? "Linking…" : "Link to this account"}
						</Button>
					</div>
				</div>
			)}
		</SettingsSubpage>
	);
}
