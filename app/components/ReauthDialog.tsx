// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Dialog, Input } from "@cloudflare/kumo";
import { EnvelopeSimpleIcon, EyeIcon, EyeSlashIcon, FingerprintIcon, KeyIcon } from "@phosphor-icons/react";
import { type FormEvent, useEffect, useState } from "react";
import { Modal, ModalHeader } from "~/components/Modal";
import { type ReauthMethod, useReauthStore } from "~/lib/reauth";
import { signOut } from "~/lib/sign-out";
import api from "~/services/api";

const loadAuthClient = () => import("~/lib/auth-client");

function errorMessage(err: unknown, fallback: string): string {
	return err instanceof Error && err.message ? err.message : fallback;
}

const SWITCH_LABEL: Record<Exclude<ReauthMethod, "sign_in">, { label: string; icon: typeof KeyIcon }> = {
	password: { label: "Use your password", icon: KeyIcon },
	passkey: { label: "Use a passkey", icon: FingerprintIcon },
	email_code: { label: "Email me a code", icon: EnvelopeSimpleIcon },
};

const quietLinkClass = "text-kumo-subtle hover:text-kumo-default underline-offset-2 hover:underline cursor-pointer";

/**
 * "Confirm it's you" before a sensitive account change (AVE-113). Opened by
 * `requestReauth` when the Worker answers `reauth_required`; offers what the
 * account has (password + 2FA code, passkey, emailed code) and falls back to
 * signing in again. On success the original request is retried.
 */
export default function ReauthDialog() {
	const challenge = useReauthStore((s) => s.challenge);
	const finish = useReauthStore((s) => s.finish);
	const usable = (challenge?.methods ?? []).filter((m): m is Exclude<ReauthMethod, "sign_in"> => m !== "sign_in");
	const [method, setMethod] = useState<Exclude<ReauthMethod, "sign_in"> | null>(null);
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [code, setCode] = useState("");
	const [useBackupCode, setUseBackupCode] = useState(false);
	const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// A new prompt starts on the first method the account has.
	useEffect(() => {
		setMethod(usable[0] ?? null);
		setPassword("");
		setShowPassword(false);
		setCode("");
		setUseBackupCode(false);
		setCodeSentTo(null);
		setError(null);
		setBusy(false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [challenge]);

	const run = async (fn: () => Promise<void>, fallback: string) => {
		setBusy(true);
		setError(null);
		try {
			await fn();
			finish(true);
		} catch (err) {
			const message = errorMessage(err, fallback);
			// A dismissed passkey sheet isn't an error worth showing.
			if (message !== "Cancelled.") setError(message);
		} finally {
			setBusy(false);
		}
	};

	const submitPassword = (e: FormEvent) => {
		e.preventDefault();
		void run(async () => {
			await api.reauth({
				method: "password",
				password,
				...(challenge?.twoFactor
					? { code: code.replace(/\s+/g, ""), codeType: useBackupCode ? "backup_code" : "totp" }
					: {}),
			});
		}, "Couldn't confirm it's you");
	};

	const usePasskey = () =>
		void run(async () => {
			await (await loadAuthClient()).reauthWithPasskey();
		}, "That passkey couldn't confirm it's you");

	const sendCode = async () => {
		setBusy(true);
		setError(null);
		try {
			const res = await api.sendReauthEmailCode();
			setCodeSentTo(res.sentTo);
			if (res.devCode) setCode(res.devCode);
		} catch (err) {
			setError(errorMessage(err, "Couldn't send the code"));
		} finally {
			setBusy(false);
		}
	};

	const submitCode = (e: FormEvent) => {
		e.preventDefault();
		void run(async () => {
			await api.reauth({ method: "email_code", code: code.trim() });
		}, "Invalid or expired code");
	};

	const switchTo = (next: Exclude<ReauthMethod, "sign_in">) => {
		setMethod(next);
		setCode("");
		setError(null);
	};

	const others = usable.filter((m) => m !== method);

	return (
		<Dialog.Root
			open={challenge !== null}
			onOpenChange={(next) => {
				if (!next && !busy) finish(false);
			}}
		>
			<Modal size="sm">
				<ModalHeader
					title="Confirm it's you"
					description="You're changing how your account signs in or recovers. Confirm it's you to continue."
				/>

				<div className="space-y-4">
					{method === "password" && (
						<form onSubmit={submitPassword} className="space-y-3">
							<div>
								<label htmlFor="reauth-password" className="block text-xs font-medium text-kumo-subtle mb-1">
									Password
								</label>
								<div className="relative flex items-center">
									<Input
										id="reauth-password"
										type={showPassword ? "text" : "password"}
										value={password}
										onChange={(e) => setPassword(e.target.value)}
										autoComplete="current-password"
										autoFocus
										className="w-full pr-10"
									/>
									<button
										type="button"
										onClick={() => setShowPassword(!showPassword)}
										className="absolute right-3 text-kumo-subtle hover:text-kumo-default p-1 cursor-pointer"
										aria-label={showPassword ? "Hide password" : "Show password"}
									>
										{showPassword ? <EyeSlashIcon size={16} /> : <EyeIcon size={16} />}
									</button>
								</div>
							</div>
							{challenge?.twoFactor && (
								<div>
									<label htmlFor="reauth-code" className="block text-xs font-medium text-kumo-subtle mb-1">
										{useBackupCode ? "Backup code" : "Authenticator code"}
									</label>
									<Input
										id="reauth-code"
										value={code}
										onChange={(e) => setCode(e.target.value)}
										placeholder={useBackupCode ? "xxxxx-xxxxx" : "123456"}
										inputMode={useBackupCode ? "text" : "numeric"}
										autoComplete="one-time-code"
										className="w-full"
									/>
									<button
										type="button"
										onClick={() => {
											setUseBackupCode(!useBackupCode);
											setCode("");
										}}
										className={`mt-1.5 text-xs ${quietLinkClass}`}
									>
										{useBackupCode ? "Use your authenticator app" : "Use a backup code"}
									</button>
								</div>
							)}
							<Button
								type="submit"
								variant="primary"
								className="w-full"
								loading={busy}
								disabled={!password || (challenge?.twoFactor === true && !code.trim())}
							>
								Confirm
							</Button>
						</form>
					)}

					{method === "passkey" && (
						<Button
							variant="primary"
							className="w-full"
							icon={<FingerprintIcon size={16} />}
							loading={busy}
							onClick={usePasskey}
						>
							Use a passkey
						</Button>
					)}

					{method === "email_code" &&
						(codeSentTo ? (
							<form onSubmit={submitCode} className="space-y-3">
								<p className="text-sm text-kumo-default">
									Enter the 6-digit code we sent to <strong>{codeSentTo}</strong>.
								</p>
								<Input
									aria-label="Code"
									value={code}
									onChange={(e) => setCode(e.target.value)}
									placeholder="123456"
									maxLength={6}
									inputMode="numeric"
									autoComplete="one-time-code"
									autoFocus
									className="w-full"
								/>
								<Button type="submit" variant="primary" className="w-full" loading={busy} disabled={code.trim().length < 6}>
									Confirm
								</Button>
							</form>
						) : (
							<div className="space-y-3">
								<p className="text-sm text-kumo-default">
									We'll email a 6-digit code to <strong>{challenge?.emailCodeTo}</strong>.
								</p>
								<Button variant="primary" className="w-full" loading={busy} onClick={() => void sendCode()}>
									Send code
								</Button>
							</div>
						))}

					{method === null && (
						<div className="space-y-3">
							<p className="text-sm text-kumo-default">
								Sign out and sign back in, then try again within 5 minutes.
							</p>
							<Button variant="primary" className="w-full" onClick={() => void signOut()}>
								Sign out
							</Button>
						</div>
					)}

					{error && (
						<p role="alert" className="rounded-lg bg-kumo-danger-tint px-3 py-2 text-xs text-kumo-default">
							{error}
						</p>
					)}

					{(others.length > 0 || method !== null) && (
						<div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-kumo-line pt-3 text-xs">
							{others.map((m) => {
								const { label, icon: Icon } = SWITCH_LABEL[m];
								return (
									<button
										key={m}
										type="button"
										onClick={() => switchTo(m)}
										className={`inline-flex items-center gap-1.5 ${quietLinkClass}`}
									>
										<Icon size={14} /> {label}
									</button>
								);
							})}
							{method !== null && (
								<button type="button" onClick={() => void signOut()} className={quietLinkClass}>
									Sign in again instead
								</button>
							)}
						</div>
					)}
				</div>
			</Modal>
		</Dialog.Root>
	);
}
