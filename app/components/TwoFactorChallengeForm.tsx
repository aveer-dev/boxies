// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Input, useKumoToastManager } from "@cloudflare/kumo";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { quietLinkClass } from "~/components/AuthShell";
import api, { ApiError, type TwoFactorChallenge } from "~/services/api";

/**
 * The second step of a password sign-in for an account with two-factor on:
 * a 6-digit code from the authenticator app, or one of the one-time backup
 * codes. The challenge is good for one sign-in, 10 minutes and 5 codes; when
 * it runs out, `onExpired` sends the user back to their password.
 */
export function TwoFactorChallengeForm({
	challenge,
	email,
	onSignedIn,
	onExpired,
	onBack,
}: {
	challenge: TwoFactorChallenge;
	email?: string;
	onSignedIn: () => void;
	onExpired: () => void;
	onBack?: () => void;
}) {
	const toastManager = useKumoToastManager();
	const [method, setMethod] = useState<"totp" | "backup_code">("totp");
	const [code, setCode] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, [method]);

	const trimmed = code.replace(/\s+/g, "");
	// Backup codes are shown as `xxxxx-xxxxx`; accept them typed without the dash.
	const submitted =
		method === "backup_code" && /^[A-Za-z0-9]{10}$/.test(trimmed)
			? `${trimmed.slice(0, 5)}-${trimmed.slice(5)}`
			: trimmed;
	const ready = method === "totp" ? /^\d{6}$/.test(trimmed) : trimmed.length >= 10;

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		if (!ready || submitting) return;
		setSubmitting(true);
		try {
			await api.verifyTwoFactor({ twoFactorToken: challenge.twoFactorToken, code: submitted, method });
			onSignedIn();
		} catch (err) {
			const errorCode = err instanceof ApiError ? String(err.body.code ?? "") : "";
			toastManager.add({
				title: err instanceof Error && err.message ? err.message : "That code didn't work",
				variant: "error",
			});
			if (errorCode === "TWO_FACTOR_EXPIRED") {
				onExpired();
				return;
			}
			setCode("");
			inputRef.current?.focus();
		} finally {
			setSubmitting(false);
		}
	};

	const switchMethod = () => {
		setMethod((m) => (m === "totp" ? "backup_code" : "totp"));
		setCode("");
	};

	return (
		<form onSubmit={handleSubmit} className="space-y-3">
			{onBack && (
				<button
					type="button"
					onClick={onBack}
					className="inline-flex items-center gap-1.5 text-xs text-kumo-subtle hover:text-kumo-default mb-1 cursor-pointer"
				>
					<ArrowLeftIcon size={14} /> Back
				</button>
			)}
			<p className="text-xs text-kumo-subtle">
				{method === "totp"
					? "Open your authenticator app and enter the 6-digit code for Inboxies"
					: "Enter one of the backup codes you saved when you turned on two-factor. Each code works once"}
				{email ? (
					<>
						{" "}
						(<strong className="text-kumo-default">{email}</strong>).
					</>
				) : (
					"."
				)}
			</p>

			<div>
				<label htmlFor="two-factor-code" className="block text-xs font-medium text-kumo-subtle mb-1">
					{method === "totp" ? "Authentication code" : "Backup code"}
				</label>
				<Input
					id="two-factor-code"
					ref={inputRef}
					className="w-full font-mono tracking-wider"
					type="text"
					value={code}
					onChange={(e) => setCode(e.target.value)}
					placeholder={method === "totp" ? "123456" : "xxxxx-xxxxx"}
					inputMode={method === "totp" ? "numeric" : "text"}
					autoComplete="one-time-code"
					autoCapitalize="off"
					spellCheck={false}
					maxLength={method === "totp" ? 7 : 16}
					required
					autoFocus
				/>
			</div>

			<div className="flex justify-end pt-1">
				<button type="button" onClick={switchMethod} className={`text-xs ${quietLinkClass}`}>
					{method === "totp" ? "Use a backup code" : "Use your authenticator app"}
				</button>
			</div>

			<Button type="submit" variant="primary" className="w-full mt-2" loading={submitting} disabled={!ready}>
				Verify
			</Button>
		</form>
	);
}
