// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Input, Loader, useKumoToastManager } from "@cloudflare/kumo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import ConfirmDialog from "./ConfirmDialog";
import RecoveryEmailSection from "./RecoveryEmailSection";
import SettingsSubpage from "./SettingsSubpage";
import { useIdentities } from "~/queries/account";
import { queryKeys } from "~/queries/keys";
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
		default:
			return type;
	}
}

declare global {
	interface Window {
		google?: {
			accounts: {
				id: {
					initialize: (config: {
						client_id: string;
						callback: (response: { credential: string }) => void;
						auto_select?: boolean;
						cancel_on_tap_outside?: boolean;
					}) => void;
					prompt: (
						momentListener?: (notification: {
							isNotDisplayed: () => boolean;
							isSkippedMoment: () => boolean;
							getNotDisplayedReason: () => string;
						}) => void,
					) => void;
					renderButton: (
						parent: HTMLElement,
						options: {
							theme?: string;
							size?: string;
							text?: string;
							width?: number;
						},
					) => void;
				};
			};
		};
	}
}

function loadGoogleIdentityScript(): Promise<void> {
	if (window.google?.accounts?.id) return Promise.resolve();
	const existing = document.querySelector<HTMLScriptElement>(
		'script[data-google-gis="1"]',
	);
	if (existing) {
		return new Promise((resolve, reject) => {
			existing.addEventListener("load", () => resolve());
			existing.addEventListener("error", () =>
				reject(new Error("Failed to load Google Sign-In")),
			);
		});
	}
	return new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = "https://accounts.google.com/gsi/client";
		script.async = true;
		script.defer = true;
		script.dataset.googleGis = "1";
		script.onload = () => resolve();
		script.onerror = () => reject(new Error("Failed to load Google Sign-In"));
		document.head.appendChild(script);
	});
}

export default function SignInSettings() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const toastManager = useKumoToastManager();
	const queryClient = useQueryClient();
	const googleBtnRef = useRef<HTMLDivElement>(null);

	const { data, isLoading, refetch } = useIdentities();

	const { data: config } = useQuery({
		queryKey: ["config"],
		queryFn: () => api.getConfig(),
		staleTime: 60_000,
	});

	const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
	const [showPasswordForm, setShowPasswordForm] = useState(false);
	const [showChangePassword, setShowChangePassword] = useState(false);
	const [password, setPassword] = useState("");
	const [passwordConfirm, setPasswordConfirm] = useState("");
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
	const [isAddingPassword, setIsAddingPassword] = useState(false);
	const [isChangingPassword, setIsChangingPassword] = useState(false);
	const [disconnecting, setDisconnecting] = useState<{ type: string; label: string } | null>(null);
	const [isDisconnecting, setIsDisconnecting] = useState(false);

	const hasPassword = data?.identities.some((i) => i.type === "password");
	const hasGoogle = data?.identities.some((i) => i.type === "google");
	const hasApple = data?.identities.some((i) => i.type === "apple");
	const googleClientId = config?.googleClientId ?? null;
	const canAddMethod = !hasGoogle || !hasApple || !hasPassword;
	// One row per method type; the server refuses to remove the last one.
	const methodCount = new Set(data?.identities.map((i) => i.type)).size;

	const refreshAfterAttach = useCallback(
		async (title: string) => {
			toastManager.add({ title });
			await refetch();
			await queryClient.invalidateQueries({ queryKey: queryKeys.account.me });
			await queryClient.invalidateQueries({ queryKey: queryKeys.mailboxes.all });
		},
		[queryClient, refetch, toastManager],
	);

	const handleGoogleCredential = useCallback(
		async (credential: string) => {
			setIsConnectingGoogle(true);
			try {
				await api.attachIdentity({
					provider: "google",
					idToken: credential,
				});
				await refreshAfterAttach("Google connected");
			} catch (err) {
				const message =
					err instanceof Error ? err.message : "Could not connect Google";
				toastManager.add({
					title: message.includes("already linked")
						? "That Google account is already linked to another Inboxies account"
						: "Could not connect Google",
					variant: "error",
				});
			} finally {
				setIsConnectingGoogle(false);
			}
		},
		[refreshAfterAttach, toastManager],
	);

	useEffect(() => {
		if (!googleClientId || hasGoogle || !googleBtnRef.current) return;
		let cancelled = false;
		(async () => {
			try {
				await loadGoogleIdentityScript();
				if (cancelled || !window.google?.accounts?.id || !googleBtnRef.current)
					return;
				window.google.accounts.id.initialize({
					client_id: googleClientId,
					callback: (response) => {
						void handleGoogleCredential(response.credential);
					},
					auto_select: false,
					cancel_on_tap_outside: true,
				});
				googleBtnRef.current.innerHTML = "";
				window.google.accounts.id.renderButton(googleBtnRef.current, {
					theme: "outline",
					size: "large",
					text: "continue_with",
					width: 280,
				});
			} catch {
				/* GIS unavailable: Google can still be connected from the apps */
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [googleClientId, hasGoogle, handleGoogleCredential, data?.identities]);

	const handleDisconnect = async () => {
		if (!disconnecting) return;
		setIsDisconnecting(true);
		try {
			await api.removeIdentity(disconnecting.type);
			toastManager.add({ title: `${identityTypeLabel(disconnecting.type)} disconnected` });
			setDisconnecting(null);
			await refetch();
		} catch (err) {
			toastManager.add({
				title: err instanceof Error && err.message ? err.message : "Couldn't disconnect it",
				variant: "error",
			});
		} finally {
			setIsDisconnecting(false);
		}
	};

	const resetAddPasswordForm = () => {
		setShowPasswordForm(false);
		setPassword("");
		setPasswordConfirm("");
	};

	const resetChangePasswordForm = () => {
		setShowChangePassword(false);
		setCurrentPassword("");
		setNewPassword("");
		setNewPasswordConfirm("");
	};

	const handleAddPassword = async () => {
		if (password.length < 10) {
			toastManager.add({
				title: "Password must be at least 10 characters",
				variant: "error",
			});
			return;
		}
		if (password !== passwordConfirm) {
			toastManager.add({
				title: "Passwords do not match",
				variant: "error",
			});
			return;
		}
		setIsAddingPassword(true);
		try {
			await api.attachIdentity({ provider: "password", password });
			resetAddPasswordForm();
			await refreshAfterAttach("Password added");
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Could not add password";
			toastManager.add({ title: message, variant: "error" });
		} finally {
			setIsAddingPassword(false);
		}
	};

	const handleChangePassword = async () => {
		if (!currentPassword) {
			toastManager.add({
				title: "Enter your current password",
				variant: "error",
			});
			return;
		}
		if (newPassword.length < 10) {
			toastManager.add({
				title: "New password must be at least 10 characters",
				variant: "error",
			});
			return;
		}
		if (newPassword !== newPasswordConfirm) {
			toastManager.add({
				title: "New passwords do not match",
				variant: "error",
			});
			return;
		}
		if (currentPassword === newPassword) {
			toastManager.add({
				title: "New password must be different from the current password",
				variant: "error",
			});
			return;
		}
		setIsChangingPassword(true);
		try {
			await api.changePassword({ currentPassword, newPassword });
			resetChangePasswordForm();
			// The server signs out every other session on a password change.
			toastManager.add({ title: "Password updated — other devices were signed out" });
			await refetch();
			await queryClient.invalidateQueries({ queryKey: queryKeys.account.sessions });
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Could not change password";
			toastManager.add({
				title: message.includes("incorrect")
					? "Current password is incorrect"
					: message,
				variant: "error",
			});
		} finally {
			setIsChangingPassword(false);
		}
	};

	if (!mailboxId) return null;

	return (
		<SettingsSubpage mailboxId={mailboxId} title="Sign-in & recovery">
			<p className="text-sm text-kumo-subtle mb-6">
				Ways you sign in to your Inboxies account. Every method reaches the same
				mailboxes.
			</p>

			{isLoading || !data ? (
				<div className="flex justify-center py-12">
					<Loader size="lg" />
				</div>
			) : (
				<div className="space-y-6">
					<RecoveryEmailSection />

					<div className="rounded-2xl border border-kumo-line bg-kumo-base p-5">
						<div className="text-sm font-medium text-kumo-default mb-3">
							Connected
						</div>
						{data.identities.length === 0 ? (
							<p className="text-sm text-kumo-subtle">
								Nothing linked yet. Add a method below.
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
											</div>
										</div>
										<Button
											variant="ghost"
											size="sm"
											disabled={methodCount <= 1}
											title={
												methodCount <= 1
													? "Add another way to sign in before disconnecting this one"
													: undefined
											}
											onClick={() =>
												setDisconnecting({ type: identity.type, label: identity.label })
											}
										>
											Disconnect
										</Button>
									</li>
								))}
							</ul>
						)}
					</div>

					{hasPassword && (
						<div className="rounded-2xl border border-kumo-line bg-kumo-base p-5 space-y-4">
							<div>
								<div className="text-sm font-medium text-kumo-default mb-1">
									Password
								</div>
								<p className="text-xs text-kumo-subtle">
									Change the password used to sign in with email.
								</p>
							</div>
							{!showChangePassword ? (
								<Button
									variant="secondary"
									size="sm"
									onClick={() => setShowChangePassword(true)}
								>
									Change password
								</Button>
							) : (
								<>
									<Input
										label="Current password"
										type="password"
										value={currentPassword}
										onChange={(e) => setCurrentPassword(e.target.value)}
										autoComplete="current-password"
									/>
									<Input
										label="New password"
										type="password"
										value={newPassword}
										onChange={(e) => setNewPassword(e.target.value)}
										placeholder="At least 10 characters"
										autoComplete="new-password"
									/>
									<Input
										label="Confirm new password"
										type="password"
										value={newPasswordConfirm}
										onChange={(e) => setNewPasswordConfirm(e.target.value)}
										autoComplete="new-password"
									/>
									<div className="flex flex-wrap gap-2">
										<Button
											variant="primary"
											size="sm"
											disabled={isChangingPassword}
											onClick={handleChangePassword}
										>
											{isChangingPassword ? "Updating…" : "Update password"}
										</Button>
										<Button
											variant="secondary"
											size="sm"
											onClick={resetChangePasswordForm}
										>
											Cancel
										</Button>
									</div>
								</>
							)}
						</div>
					)}

					{canAddMethod && (
						<div className="rounded-2xl border border-kumo-line bg-kumo-base p-5 space-y-4">
							<div>
								<div className="text-sm font-medium text-kumo-default mb-1">
									Add a method
								</div>
								<p className="text-xs text-kumo-subtle">
									Stay signed in — we attach the new method to this account.
								</p>
							</div>

							{!hasGoogle && (
								<div className="space-y-2">
									{googleClientId ? (
										<>
											<div ref={googleBtnRef} />
											{isConnectingGoogle && (
												<p className="text-xs text-kumo-subtle">Connecting…</p>
											)}
										</>
									) : (
										<p className="text-xs text-kumo-subtle">
											Connect Google isn’t available here. Connect it from the
											Android app.
										</p>
									)}
								</div>
							)}

							{!hasApple && (
								<p className="text-xs text-kumo-subtle rounded-md bg-kumo-tint px-3 py-2">
									Connect Apple on iPhone: Settings → Sign-in methods → Connect
									Apple.
								</p>
							)}

							{!hasPassword && (
								<div className="space-y-3">
									{!showPasswordForm ? (
										<Button
											variant="secondary"
											size="sm"
											onClick={() => setShowPasswordForm(true)}
										>
											Add password
										</Button>
									) : (
										<>
											<Input
												label="New password"
												type="password"
												value={password}
												onChange={(e) => setPassword(e.target.value)}
												placeholder="At least 10 characters"
												autoComplete="new-password"
											/>
											<Input
												label="Confirm password"
												type="password"
												value={passwordConfirm}
												onChange={(e) => setPasswordConfirm(e.target.value)}
												autoComplete="new-password"
											/>
											<div className="flex flex-wrap gap-2">
												<Button
													variant="primary"
													size="sm"
													disabled={isAddingPassword}
													onClick={handleAddPassword}
												>
													{isAddingPassword ? "Saving…" : "Save password"}
												</Button>
												<Button
													variant="secondary"
													size="sm"
													onClick={resetAddPasswordForm}
												>
													Cancel
												</Button>
											</div>
										</>
									)}
								</div>
							)}
						</div>
					)}

				</div>
			)}

			<ConfirmDialog
				open={disconnecting !== null}
				title={`Disconnect ${disconnecting ? identityTypeLabel(disconnecting.type) : ""}?`}
				description={`You won't be able to sign in with ${disconnecting?.label ?? "it"} anymore. You can connect it again later.`}
				confirmLabel="Disconnect"
				busy={isDisconnecting}
				onConfirm={() => void handleDisconnect()}
				onCancel={() => setDisconnecting(null)}
			/>
		</SettingsSubpage>
	);
}
