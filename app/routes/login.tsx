// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Input, useKumoToastManager } from "@cloudflare/kumo";
import { ArrowLeftIcon, EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";
import { OnboardingFlow } from "~/components/OnboardingFlow";
import { queryKeys } from "~/queries/keys";
import api from "~/services/api";

export function meta() {
	return [{ title: "Sign in — Inboxies" }];
}

type LoginStep = "email" | "password" | "forgot" | "reset";

export default function PasswordLoginRoute() {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	// Where to land after signing in (set by the Worker's signed-out redirect).
	// Same-origin paths only, so this can't be used as an open redirect.
	const nextParam = searchParams.get("next") || "/";
	const afterSignIn = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";
	const { data: config } = useQuery({
		queryKey: queryKeys.config,
		queryFn: () => api.getConfig(),
		staleTime: Infinity,
	});
	const toastManager = useKumoToastManager();
	const [step, setStep] = useState<LoginStep>("email");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [resetCode, setResetCode] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [showNewPassword, setShowNewPassword] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [showOnboarding, setShowOnboarding] = useState(false);

	const emailInputRef = useRef<HTMLInputElement>(null);
	const passwordInputRef = useRef<HTMLInputElement>(null);
	const resetCodeInputRef = useRef<HTMLInputElement>(null);
	const newPasswordInputRef = useRef<HTMLInputElement>(null);

	const isValidEmail = email.trim().includes("@") && email.trim().includes(".");

	useEffect(() => {
		if (step === "email") {
			emailInputRef.current?.focus();
		} else if (step === "password") {
			// Password gains focus once in view just like the email input
			passwordInputRef.current?.focus();
		} else if (step === "forgot") {
			emailInputRef.current?.focus();
		} else if (step === "reset") {
			if (!resetCode) {
				resetCodeInputRef.current?.focus();
			} else {
				newPasswordInputRef.current?.focus();
			}
		}
	}, [step, resetCode]);

	const handleEmailNext = (e: FormEvent) => {
		e.preventDefault();
		if (!isValidEmail) {
			toastManager.add({
				title: "Please enter a valid email address",
				variant: "error",
			});
			return;
		}
		setStep("password");
	};

	const handlePasswordLogin = async (e: FormEvent) => {
		e.preventDefault();
		setSubmitting(true);
		try {
			await api.passwordLogin(email.trim(), password);
			navigate(afterSignIn);
		} catch (err: unknown) {
			toastManager.add({
				title: err instanceof Error ? err.message : "Sign in failed",
				variant: "error",
			});
		} finally {
			setSubmitting(false);
		}
	};

	const handleSendResetCode = async (e: FormEvent) => {
		e.preventDefault();
		if (!isValidEmail) {
			toastManager.add({
				title: "Please enter a valid email address",
				variant: "error",
			});
			return;
		}
		setSubmitting(true);
		try {
			const res = await api.forgotPassword(email.trim());
			if (res.devResetCode) {
				setResetCode(res.devResetCode);
			}
			toastManager.add({
				title: "Reset code sent! Check your email.",
				variant: "success",
			});
			setStep("reset");
		} catch (err: unknown) {
			toastManager.add({
				title: err instanceof Error ? err.message : "Failed to send reset code",
				variant: "error",
			});
		} finally {
			setSubmitting(false);
		}
	};

	const handleResetPassword = async (e: FormEvent) => {
		e.preventDefault();
		if (resetCode.trim().length < 6) {
			toastManager.add({
				title: "Please enter the 6-digit reset code",
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
			await api.resetPassword({
				code: resetCode.trim(),
				email: email.trim(),
				newPassword,
			});
			toastManager.add({
				title: "Password reset successfully",
				variant: "success",
			});
			navigate(afterSignIn);
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
							{step === "forgot"
								? "Reset your password"
								: step === "reset"
									? "Enter your reset code"
									: "Sign in to your mailbox"}
						</p>
					</div>
				</div>

				{(step === "email" || step === "password") && (
					<>
						<Button
							type="button"
							variant="primary"
							className="w-full"
							onClick={() => setShowOnboarding(true)}
						>
							Get started
						</Button>

						<div className="flex items-center my-4 text-xs text-kumo-subtle">
							<div className="flex-1 border-t border-kumo-line" />
							<span className="px-3">or</span>
							<div className="flex-1 border-t border-kumo-line" />
						</div>
					</>
				)}

				{step === "email" && (
					<form onSubmit={handleEmailNext} className="space-y-2">
						<div>
							<label className="block text-xs font-medium text-kumo-subtle mb-1">
								Mailbox email
							</label>
							<Input
								ref={emailInputRef}
								type="email"
								size="sm"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								placeholder="name@example.com"
								required
								autoComplete="username"
								autoFocus
							/>
						</div>

						{/* Button for forgot password should be below the email input, then some extra space below it before the next button. */}
						<div className="flex justify-end pt-1">
							<button
								type="button"
								onClick={() => setStep("forgot")}
								className="text-xs text-kumo-accent hover:underline cursor-pointer"
							>
								Forgot password?
							</button>
						</div>

						<div className="h-4" />

						<Button
							type="submit"
							variant="primary"
							className="w-full"
							disabled={!isValidEmail}
						>
							Next
						</Button>
					</form>
				)}

				{step === "password" && (
					<form onSubmit={handlePasswordLogin} className="space-y-3">
						<div className="flex items-center justify-between text-xs text-kumo-subtle">
							<span className="truncate mr-2">
								Signing in as <strong className="text-kumo-default">{email}</strong>
							</span>
							<button
								type="button"
								onClick={() => setStep("email")}
								className="text-kumo-accent hover:underline shrink-0 cursor-pointer"
							>
								Change
							</button>
						</div>

						<div>
							<label className="block text-xs font-medium text-kumo-subtle mb-1">
								Password
							</label>
							<div className="relative flex items-center">
								<Input
									ref={passwordInputRef}
									type={showPassword ? "text" : "password"}
									size="sm"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									placeholder="Enter your password"
									required
									autoComplete="current-password"
									autoFocus
									className="pr-10"
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
						</div>

						<div className="flex justify-end pt-1">
							<button
								type="button"
								onClick={() => setStep("forgot")}
								className="text-xs text-kumo-accent hover:underline cursor-pointer"
							>
								Forgot password?
							</button>
						</div>

						<Button
							type="submit"
							variant="primary"
							className="w-full mt-2"
							loading={submitting}
							disabled={!password}
						>
							Sign in
						</Button>
					</form>
				)}

				{step === "forgot" && (
					<form onSubmit={handleSendResetCode} className="space-y-4">
						<div>
							<button
								type="button"
								onClick={() => setStep("email")}
								className="inline-flex items-center gap-1.5 text-xs text-kumo-subtle hover:text-kumo-default mb-3 cursor-pointer"
							>
								<ArrowLeftIcon size={14} /> Back to sign in
							</button>
							<p className="text-xs text-kumo-subtle">
								Enter your mailbox or contact email. We'll send you a 6-digit reset code.
							</p>
						</div>

						<div>
							<label className="block text-xs font-medium text-kumo-subtle mb-1">
								Email address
							</label>
							<Input
								ref={emailInputRef}
								type="email"
								size="sm"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								placeholder="name@example.com"
								required
								autoComplete="username"
								autoFocus
							/>
						</div>

						<Button
							type="submit"
							variant="primary"
							className="w-full"
							loading={submitting}
							disabled={!isValidEmail}
						>
							Send reset code
						</Button>
					</form>
				)}

				{step === "reset" && (
					<form onSubmit={handleResetPassword} className="space-y-3">
						<div>
							<button
								type="button"
								onClick={() => setStep("forgot")}
								className="inline-flex items-center gap-1.5 text-xs text-kumo-subtle hover:text-kumo-default mb-3 cursor-pointer"
							>
								<ArrowLeftIcon size={14} /> Back
							</button>
							<p className="text-xs text-kumo-subtle">
								Enter the 6-digit code sent to <strong className="text-kumo-default">{email}</strong> and your new password.
							</p>
						</div>

						<div>
							<label className="block text-xs font-medium text-kumo-subtle mb-1">
								6-digit reset code
							</label>
							<Input
								ref={resetCodeInputRef}
								type="text"
								size="sm"
								value={resetCode}
								onChange={(e) => setResetCode(e.target.value)}
								placeholder="123456"
								maxLength={6}
								required
								autoFocus
							/>
						</div>

						<div>
							<label className="block text-xs font-medium text-kumo-subtle mb-1">
								New password
							</label>
							<div className="relative flex items-center">
								<Input
									ref={newPasswordInputRef}
									type={showNewPassword ? "text" : "password"}
									size="sm"
									value={newPassword}
									onChange={(e) => setNewPassword(e.target.value)}
									placeholder="At least 10 characters"
									required
									minLength={10}
									autoComplete="new-password"
									className="pr-10"
								/>
								<button
									type="button"
									onClick={() => setShowNewPassword(!showNewPassword)}
									className="absolute right-3 text-kumo-subtle hover:text-kumo-default p-1 cursor-pointer"
									title={showNewPassword ? "Hide password" : "Show password"}
									aria-label={showNewPassword ? "Hide password" : "Show password"}
								>
									{showNewPassword ? <EyeSlashIcon size={16} /> : <EyeIcon size={16} />}
								</button>
							</div>
						</div>

						{newPassword.length > 0 && newPassword.length < 10 && (
							<p className="text-xs text-kumo-subtle">
								{10 - newPassword.length} more characters needed (minimum 10)
							</p>
						)}

						<Button
							type="submit"
							variant="primary"
							className="w-full mt-2"
							loading={submitting}
							disabled={resetCode.trim().length < 6 || newPassword.length < 10}
						>
							Reset password & sign in
						</Button>
					</form>
				)}

				<OnboardingFlow
					isOpen={showOnboarding}
					onClose={() => setShowOnboarding(false)}
					onSuccess={() => navigate(afterSignIn)}
					mailDomain={config?.mailDomain || "inboxies.email"}
				/>
			</div>
		</div>
	);
}
