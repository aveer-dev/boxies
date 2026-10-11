// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Input, useKumoToastManager } from "@cloudflare/kumo";
import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router";
import api from "~/services/api";

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
	const passwordInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (tokenParam) {
			setToken(tokenParam);
		}
		passwordInputRef.current?.focus();
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
			await api.resetPassword(
				token.trim()
					? { token: token.trim(), newPassword }
					: { email: email.trim(), code: code.trim(), newPassword },
			);
			toastManager.add({
				title: "Password reset successfully",
				variant: "success",
			});
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

	return (
		<div className="min-h-screen bg-kumo-recessed flex items-center justify-center px-4">
			<div className="w-full max-w-md rounded-xl border border-kumo-line bg-kumo-base p-6 md:p-8">
				<div className="flex items-center gap-3 mb-6">
					<img src="/favicon.svg" alt="Inboxies" className="w-9 h-9" />
					<div>
						<h1 className="text-xl font-bold text-kumo-default leading-tight">Inboxies</h1>
						<p className="text-xs text-kumo-subtle">
							Set a new password for your account
						</p>
					</div>
				</div>

				<form onSubmit={handleSubmit} className="space-y-4">
					{!tokenParam && (
						<>
							<Input
								label="Email"
								type="email"
								size="sm"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								placeholder="you@example.com"
								autoComplete="email"
								required={!token}
							/>
							<Input
								label="6-digit reset code"
								type="text"
								size="sm"
								value={code}
								onChange={(e) => setCode(e.target.value)}
								placeholder="123456"
								maxLength={6}
								inputMode="numeric"
								autoComplete="one-time-code"
								required={!token}
							/>
						</>
					)}

					<div className="relative">
						<Input
							label="New password"
							type={showPassword ? "text" : "password"}
							size="sm"
							value={newPassword}
							onChange={(e) => setNewPassword(e.target.value)}
							required
							minLength={10}
							autoComplete="new-password"
							ref={passwordInputRef}
							autoFocus
							className="pr-10"
						/>
						<button
							type="button"
							onClick={() => setShowPassword(!showPassword)}
							className="absolute right-3 top-8 text-kumo-subtle hover:text-kumo-default p-1 cursor-pointer"
							title={showPassword ? "Hide password" : "Show password"}
							aria-label={showPassword ? "Hide password" : "Show password"}
						>
							{showPassword ? <EyeSlashIcon size={16} /> : <EyeIcon size={16} />}
						</button>
					</div>

					{newPassword.length > 0 && newPassword.length < 10 && (
						<p className="text-xs text-kumo-subtle">
							{10 - newPassword.length} more characters needed (minimum 10)
						</p>
					)}

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

				<div className="mt-6 text-center text-xs text-kumo-subtle">
					<Link to="/login" className="text-kumo-accent hover:underline">
						Back to sign in
					</Link>
				</div>
			</div>
		</div>
	);
}
