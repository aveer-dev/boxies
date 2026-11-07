// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Input, Loader, Text, useKumoToastManager } from "@cloudflare/kumo";
import { type FormEvent, type ReactNode, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMe } from "~/queries/account";
import { queryKeys } from "~/queries/keys";
import { AuthShell, quietLinkClass } from "~/components/AuthShell";
import api, { ApiError } from "~/services/api";
import { openMailbox } from "~/lib/open-mailbox";
import { invitePath } from "shared/mailbox-url";

export function meta() {
	return [{ title: "Accept invite — Inboxies" }];
}

/** Why an invite can't be opened, from GET /invites/:token's 404/410. */
function inviteUnavailableMessage(error: unknown): string {
	if (error instanceof ApiError) {
		const status = (error.body.invite as { status?: string } | undefined)?.status;
		if (status === "accepted") return "This invite has already been accepted. Sign in to open the mailbox.";
		if (status === "revoked") return "This invite was revoked. Ask the mailbox owner for a new one.";
		if (status === "expired") return "This invite has expired. Ask the mailbox owner for a new one.";
		if (error.status === 404) return "This invite link isn't valid. Check that you copied all of it.";
	}
	return error instanceof Error && error.message ? error.message : "This invite is invalid or expired.";
}

/** What went wrong accepting; 409 means the address already has an account. */
function acceptErrorMessage(error: unknown): { message: string; signInInstead: boolean } {
	if (error instanceof ApiError) {
		if (error.status === 409) {
			const message = /sign in/i.test(error.message)
				? error.message
				: `${error.message} Sign in to it, then open this invite again.`;
			return { message, signInInstead: true };
		}
		if (error.status === 410) return { message: "This invite is no longer active.", signInInstead: false };
	}
	return {
		message: error instanceof Error && error.message ? error.message : "Couldn't accept the invite",
		signInInstead: false,
	};
}

function Card({ children }: { children: ReactNode }) {
	return <AuthShell title="Accept invite">{children}</AuthShell>;
}

export default function InviteAcceptRoute() {
	// In the query string, not the path, so page analytics never see it (AVE-126).
	const [searchParams] = useSearchParams();
	const token = searchParams.get("token")?.trim() ?? "";
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const toastManager = useKumoToastManager();
	const invite = useQuery({
		queryKey: ["invite", token],
		queryFn: () => api.getInvite(token),
		enabled: Boolean(token),
		retry: false,
	});
	// 401 when signed out; that decides which flow to show.
	const me = useMe();
	const signedInAs = me.data?.email ?? null;

	const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
	const [code, setCode] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [busy, setBusy] = useState(false);
	const [formError, setFormError] = useState<{ message: string; signInInstead: boolean } | null>(
		null,
	);

	const signInHref = `/login?next=${encodeURIComponent(invitePath(token))}`;

	const sendCode = async () => {
		setFormError(null);
		setBusy(true);
		try {
			const res = await api.sendInviteCode(token);
			setCodeSentTo(res.sentTo);
			if (res.devCode) setCode(res.devCode);
		} catch (err) {
			setFormError(acceptErrorMessage(err));
		} finally {
			setBusy(false);
		}
	};

	const accept = async (e: FormEvent) => {
		e.preventDefault();
		setFormError(null);
		if (code.trim().length < 6) {
			setFormError({ message: "Enter the 6-digit code", signInInstead: false });
			return;
		}
		if (!signedInAs) {
			if (password.length < 10) {
				setFormError({ message: "Password must be at least 10 characters", signInInstead: false });
				return;
			}
			if (password !== confirm) {
				setFormError({ message: "Passwords do not match", signInInstead: false });
				return;
			}
		}
		setBusy(true);
		try {
			const result = await api.acceptInvite(token, {
				code: code.trim(),
				...(signedInAs
					? {}
					: { password, displayName: displayName.trim() || undefined }),
			});
			if (!signedInAs && result.email) {
				toastManager.add({ title: `You're in. Next time, sign in with ${result.email}.` });
			}
			await queryClient.invalidateQueries({ queryKey: queryKeys.account.me });
			await openMailbox(queryClient, navigate, result.mailboxId);
		} catch (err) {
			setFormError(acceptErrorMessage(err));
			setBusy(false);
		}
	};

	const switchAccount = async () => {
		setFormError(null);
		try {
			await api.logout();
		} catch {
			setFormError({ message: "Couldn't sign you out. Try again.", signInInstead: false });
			return;
		}
		// Start clean: no cached account data from the previous user.
		queryClient.clear();
		window.location.reload();
	};

	if (invite.isLoading || me.isLoading) {
		return (
			<Card>
				<div className="flex justify-center py-10">
					<Loader size="lg" />
				</div>
			</Card>
		);
	}

	if (invite.error || !invite.data) {
		return (
			<Card>
				<p className="text-sm text-kumo-subtle">{inviteUnavailableMessage(invite.error)}</p>
				<div className="mt-6 text-xs">
					<Link to="/login" className={quietLinkClass}>
						Go to sign in
					</Link>
				</div>
			</Card>
		);
	}

	const { mailboxId, inviteeEmail, inviteeName, role } = invite.data;

	return (
		<Card>
			<p className="text-sm text-kumo-subtle mb-6">
				{inviteeName ? `${inviteeName}, you're` : "You're"} invited to{" "}
				<strong className="text-kumo-default">{mailboxId}</strong> as{" "}
				{role === "owner" ? "an owner" : "a member"}.
			</p>

			{formError && (
				<div className="mb-4 space-y-1">
					<Text variant="error" size="sm">
						{formError.message}
					</Text>
					{formError.signInInstead && (
						<Link to={signInHref} className={`text-xs ${quietLinkClass}`}>
							Sign in
						</Link>
					)}
				</div>
			)}

			{signedInAs && (
				<div className="mb-4 flex items-center justify-between gap-2 text-xs text-kumo-subtle">
					<span className="truncate">
						Accept as <strong className="text-kumo-default">{signedInAs}</strong>
					</span>
					<button
						type="button"
						onClick={() => void switchAccount()}
						className={`shrink-0 ${quietLinkClass}`}
					>
						Not you?
					</button>
				</div>
			)}

			{!codeSentTo ? (
				<div className="space-y-4">
					<p className="text-xs text-kumo-subtle">
						To confirm the invite is yours, we'll email a 6-digit code to{" "}
						<strong className="text-kumo-default">{inviteeEmail}</strong>.
					</p>
					<Button variant="primary" className="w-full" loading={busy} onClick={() => void sendCode()}>
						Send code
					</Button>
					{!signedInAs && (
						<p className="text-xs text-kumo-subtle text-center">
							Already have an Inboxies account?{" "}
							<Link to={signInHref} className={quietLinkClass}>
								Sign in first
							</Link>
						</p>
					)}
				</div>
			) : (
				<form onSubmit={accept} className="space-y-4">
					<p className="text-xs text-kumo-subtle">
						Enter the code we sent to{" "}
						<strong className="text-kumo-default">{codeSentTo}</strong>.{" "}
						<button
							type="button"
							onClick={() => void sendCode()}
							disabled={busy}
							className={quietLinkClass}
						>
							Resend
						</button>
					</p>
					<Input
						className="w-full"
						label="6-digit code"
						value={code}
						onChange={(e) => setCode(e.target.value)}
						placeholder="123456"
						maxLength={6}
						inputMode="numeric"
						autoComplete="one-time-code"
						required
					/>
					{!signedInAs && (
						<>
							<Input
								className="w-full"
								label="Your name (optional)"
								value={displayName}
								onChange={(e) => setDisplayName(e.target.value)}
								autoComplete="name"
							/>
							<Input
								className="w-full"
								label="Choose a password"
								type="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder="At least 10 characters"
								required
								autoComplete="new-password"
							/>
							<Input
								className="w-full"
								label="Confirm password"
								type="password"
								value={confirm}
								onChange={(e) => setConfirm(e.target.value)}
								required
								autoComplete="new-password"
							/>
						</>
					)}
					<Button type="submit" variant="primary" className="w-full" loading={busy}>
						{signedInAs ? "Accept invite" : "Create account & join"}
					</Button>
				</form>
			)}
		</Card>
	);
}
