// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Input, useKumoToastManager } from "@cloudflare/kumo";
import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router";
import { AuthShell, quietLinkClass } from "~/components/AuthShell";
import { TwoFactorChallengeForm } from "~/components/TwoFactorChallengeForm";
import api, { type TwoFactorChallenge, twoFactorChallenge } from "~/services/api";

export function meta() {
	return [{ title: "Reset password — Inboxies" }];
}

export default function ResetPasswordRoute() {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const toastManager = useKumoToastManager();

	const tokenParam = searchParams.get("token") || "";
	const [token, setToken] = useState(tokenParam);
	const [email, setEmail] = useState(searchParams.get("email") || "");
	const [code, setCode] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	// Set when the account has two-factor on: the reset worked, but signing
	// in still needs the authenticator (or a backup) code.
	const [challenge, setChallenge] = useState<TwoFactorChallenge | null>(null);
	const emailInputRef = useRef<HTMLInputElement>(null);
	const codeInputRef = useRef<HTMLInputElement>(null);
	const passwordInputRef = useRef<HTMLInputElement>(null);

	// Focus the first field still to fill: a reset link only needs the new
	// password; the code form starts at the email (or the code when the email
	// came in the URL).
	useEffect(() => {
		if (tokenParam) {
			setToken(tokenParam);
			passwordInputRef.current?.focus();
			return;
		}
		(searchParams.get("email") ? codeInputRef : emailInputRef).current?.focus();
	}, [tokenParam]);

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		if (!token && (!email.trim() || !code)) {
			toastManager.add({
				title: "Email and 6-digit reset code are required",
				variant: "error",
			});
			return;
		}
		if (newPassword.length < 10) {
			toastManager.add({
				title: "Password must be at least 10 characters",
				variant: "error",
			});
			return;
		}

		setSubmitting(true);
		try {
			const res = await api.resetPassword(
				token.trim()
					? { token: token.trim(), newPassword }
					: { email: email.trim(), code: code.trim(), newPassword },
			);
			toastManager.add({
				title: "Password reset successfully",
				variant: "success",
			});
			const pending = twoFactorChallenge(res);
			if (pending) {
				setNewPassword("");
				setChallenge(pending);
				return;
			}
			navigate("/");
		} catch (err: unknown) {
			toastManager.add({
				title: err instanceof Error ? err.message : "Password reset failed",
				variant: "error",
			});
		} finally {
			setSubmitting(false);
		}
	};

	if (challenge) {
		return (
			<AuthShell title="Two-factor authentication">
				<TwoFactorChallengeForm
					challenge={challenge}
					email={email.trim() || undefined}
					onSignedIn={() => navigate("/")}
					// The new password is set; an expired challenge just means signing in again.
					onExpired={() => navigate("/login")}
				/>
			</AuthShell>
		);
	}

	return (
		<AuthShell title="Set a new password for your account">
			<form onSubmit={handleSubmit} className="space-y-4">
				{!tokenParam && (
					<>
						<p className="text-xs text-kumo-subtle">
							Enter the email you sign in with and the 6-digit code we sent to your
							recovery email.
						</p>
						<div>
							<label
								htmlFor="reset-email"
								className="block text-xs font-medium text-kumo-subtle mb-1"
							>
								Inboxies email
							</label>
							<Input
								id="reset-email"
								className="w-full"
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								placeholder="you@example.com"
								autoComplete="email"
								ref={emailInputRef}
								required={!token}
							/>
						</div>
						<div>
							<label
								htmlFor="reset-code"
								className="block text-xs font-medium text-kumo-subtle mb-1"
							>
								6-digit reset code
							</label>
							<Input
								id="reset-code"
								className="w-full"
								type="text"
								value={code}
								onChange={(e) => setCode(e.target.value)}
								placeholder="123456"
								maxLength={6}
								inputMode="numeric"
								autoComplete="one-time-code"
								ref={codeInputRef}
								required={!token}
							/>
						</div>
					</>
				)}

				<div>
					<label
						htmlFor="reset-new-password"
						className="block text-xs font-medium text-kumo-subtle mb-1"
					>
						New password
					</label>
					<div className="relative flex items-center">
						<Input
							id="reset-new-password"
							type={showPassword ? "text" : "password"}
							value={newPassword}
							onChange={(e) => setNewPassword(e.target.value)}
							required
							minLength={10}
							autoComplete="new-password"
							ref={passwordInputRef}
							aria-describedby="reset-new-password-hint"
							className="w-full pr-10"
						/>
						<button
							type="button"
							onClick={() => setShowPassword(!showPassword)}
							className="absolute right-3 text-kumo-subtle hover:text-kumo-default p-1 cursor-pointer"
							title={showPassword ? "Hide password" : "Show password"}
							aria-label={showPassword ? "Hide password" : "Show password"}
						>
							{showPassword ? <EyeSlashIcon size={16} /> : <EyeIcon size={16} />}
						</button>
					</div>
					<p id="reset-new-password-hint" className="mt-1 text-xs text-kumo-subtle">
						{newPassword.length > 0 && newPassword.length < 10
							? `${10 - newPassword.length} more characters needed (minimum 10)`
							: "At least 10 characters"}
					</p>
				</div>

				<Button
					type="submit"
					variant="primary"
					className="w-full"
					loading={submitting}
					disabled={
						newPassword.length < 10 || (!token && (!email.trim() || code.length < 6))
					}
				>
					Reset password & sign in
				</Button>
			</form>

			<div className="mt-6 text-center text-xs">
				<Link to="/login" className={quietLinkClass}>
					Back to sign in
				</Link>
			</div>
		</AuthShell>
	);
}
