// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Input, useKumoToastManager } from "@cloudflare/kumo";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useMemo, useState } from "react";
import { encode } from "uqr";
import { useMe } from "~/queries/account";
import { queryKeys } from "~/queries/keys";

const loadAuthClient = () => import("~/lib/auth-client");

function errorMessage(err: unknown, fallback: string): string {
	return err instanceof Error && err.message ? err.message : fallback;
}

/** The base32 secret in an otpauth:// URI, for typing into an app by hand. */
function totpSecret(uri: string): string | null {
	try {
		return new URL(uri).searchParams.get("secret");
	} catch {
		return null;
	}
}

/** Groups of four, as authenticator apps show them. */
function groupSecret(secret: string): string {
	return secret.replace(/(.{4})(?=.)/g, "$1 ");
}

/**
 * A QR code as one SVG path. Always dark on white with a quiet zone, whatever
 * the theme: some scanners can't read inverted codes.
 */
function QrCode({ value, size = 176 }: { value: string; size?: number }) {
	const { path, dimension } = useMemo(() => {
		const { data, size: modules } = encode(value, { ecc: "M", border: 0 });
		let d = "";
		for (let y = 0; y < modules; y++) {
			for (let x = 0; x < modules; x++) {
				if (data[y][x]) d += `M${x} ${y}h1v1h-1z`;
			}
		}
		return { path: d, dimension: modules };
	}, [value]);
	const quiet = 2;
	return (
		<svg
			role="img"
			aria-label="QR code for your authenticator app"
			width={size}
			height={size}
			viewBox={`${-quiet} ${-quiet} ${dimension + quiet * 2} ${dimension + quiet * 2}`}
			shapeRendering="crispEdges"
			className="rounded-lg bg-white"
		>
			<rect x={-quiet} y={-quiet} width={dimension + quiet * 2} height={dimension + quiet * 2} fill="#fff" />
			<path d={path} fill="#000" />
		</svg>
	);
}

function BackupCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
	const toastManager = useKumoToastManager();
	const text = codes.join("\n");

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			toastManager.add({ title: "Backup codes copied" });
		} catch {
			toastManager.add({ title: "Couldn't copy. Select the codes and copy them instead.", variant: "error" });
		}
	};

	const download = () => {
		const blob = new Blob(
			[`Inboxies backup codes\nEach code signs you in once if you can't use your authenticator app.\n\n${text}\n`],
			{ type: "text/plain" },
		);
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "inboxies-backup-codes.txt";
		a.click();
		URL.revokeObjectURL(url);
	};

	return (
		<div className="space-y-3">
			<p className="text-xs text-kumo-default rounded-md bg-kumo-warning-tint px-3 py-2">
				Save these backup codes somewhere safe, like your password manager. Each one signs you in
				once if you lose your authenticator app. You won't see them again.
			</p>
			<ul className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-kumo-line bg-kumo-tint px-4 py-3 font-mono text-sm text-kumo-default select-all">
				{codes.map((code) => (
					<li key={code}>{code}</li>
				))}
			</ul>
			<div className="flex flex-wrap gap-2">
				<Button variant="secondary" size="sm" onClick={() => void copy()}>
					Copy
				</Button>
				<Button variant="secondary" size="sm" onClick={download}>
					Download
				</Button>
				<Button variant="primary" size="sm" onClick={onDone}>
					I saved them
				</Button>
			</div>
		</div>
	);
}

type Stage =
	| { kind: "idle" }
	/** Asking for the password before `action`. */
	| { kind: "password"; action: "enable" | "disable" | "regenerate" }
	| { kind: "scan"; totpURI: string; backupCodes: string[] }
	| { kind: "codes"; backupCodes: string[] };

/**
 * Optional TOTP two-factor for password sign-in. Turning it on shows a QR
 * code (and the secret for typing in), checks one code from the app, then
 * shows the one-time backup codes. Turning it off or making new backup codes
 * asks for the password again. Passkeys, Google and Apple sign-in aren't
 * challenged: the authenticator or the provider is already the second factor.
 */
export default function TwoFactorSection({ hasPassword }: { hasPassword: boolean }) {
	const toastManager = useKumoToastManager();
	const queryClient = useQueryClient();
	const { data: me } = useMe();
	const enabled = Boolean(me?.twoFactorEnabled);
	const [stage, setStage] = useState<Stage>({ kind: "idle" });
	const [password, setPassword] = useState("");
	const [code, setCode] = useState("");
	const [busy, setBusy] = useState(false);

	const reset = () => {
		setStage({ kind: "idle" });
		setPassword("");
		setCode("");
	};

	// Turning 2FA on or off replaces this session (Better Auth rotates it).
	const refreshAccount = async () => {
		await queryClient.invalidateQueries({ queryKey: queryKeys.account.me });
		await queryClient.invalidateQueries({ queryKey: queryKeys.account.sessions });
	};

	const submitPassword = async (e: FormEvent) => {
		e.preventDefault();
		if (stage.kind !== "password" || !password) return;
		setBusy(true);
		try {
			const client = await loadAuthClient();
			if (stage.action === "enable") {
				const setup = await client.startTwoFactorSetup(password);
				setPassword("");
				setStage({ kind: "scan", ...setup });
			} else if (stage.action === "disable") {
				await client.disableTwoFactor(password);
				reset();
				toastManager.add({ title: "Two-factor authentication is off" });
				await refreshAccount();
			} else {
				const backupCodes = await client.regenerateBackupCodes(password);
				setPassword("");
				setStage({ kind: "codes", backupCodes });
			}
		} catch (err) {
			toastManager.add({ title: errorMessage(err, "Something went wrong"), variant: "error" });
		} finally {
			setBusy(false);
		}
	};

	const submitCode = async (e: FormEvent) => {
		e.preventDefault();
		if (stage.kind !== "scan") return;
		setBusy(true);
		try {
			await (await loadAuthClient()).confirmTwoFactor(code);
			setCode("");
			setStage({ kind: "codes", backupCodes: stage.backupCodes });
			toastManager.add({ title: "Two-factor authentication is on" });
			await refreshAccount();
		} catch (err) {
			toastManager.add({ title: errorMessage(err, "That code didn't work"), variant: "error" });
		} finally {
			setBusy(false);
		}
	};

	const secret = stage.kind === "scan" ? totpSecret(stage.totpURI) : null;

	return (
		<div className="rounded-2xl border border-kumo-line bg-kumo-base p-5 space-y-4">
			<div>
				<div className="text-sm font-medium text-kumo-default mb-1 flex items-center gap-2">
					Two-factor authentication
					{enabled && <Badge variant="success">On</Badge>}
				</div>
				<p className="text-xs text-kumo-subtle">
					When you sign in with your password, also ask for a code from an authenticator app
					(1Password, Google Authenticator, Authy…). Optional.
				</p>
			</div>

			{!hasPassword && !enabled ? (
				<p className="text-xs text-kumo-subtle rounded-md bg-kumo-tint px-3 py-2">
					Two-factor protects password sign-in. Add a password to turn it on.
				</p>
			) : stage.kind === "password" ? (
				<form onSubmit={submitPassword} className="space-y-3">
					<Input
						label="Confirm your password"
						type="password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						autoComplete="current-password"
						autoFocus
					/>
					<div className="flex flex-wrap gap-2">
						<Button type="submit" variant="primary" size="sm" loading={busy} disabled={!password}>
							{stage.action === "enable"
								? "Continue"
								: stage.action === "disable"
									? "Turn off"
									: "Create new codes"}
						</Button>
						<Button type="button" variant="secondary" size="sm" onClick={reset}>
							Cancel
						</Button>
					</div>
				</form>
			) : stage.kind === "scan" ? (
				<form onSubmit={submitCode} className="space-y-4">
					<p className="text-sm text-kumo-default">
						Scan this code with your authenticator app, then enter the 6-digit code it shows.
					</p>
					<div className="flex flex-col gap-4 sm:flex-row sm:items-center">
						<QrCode value={stage.totpURI} />
						{secret && (
							<div className="min-w-0 space-y-1">
								<div className="text-xs text-kumo-subtle">Can't scan? Enter this key instead:</div>
								<code className="block break-all font-mono text-sm text-kumo-default select-all">
									{groupSecret(secret)}
								</code>
							</div>
						)}
					</div>
					<Input
						label="Code from the app"
						value={code}
						onChange={(e) => setCode(e.target.value)}
						placeholder="123456"
						maxLength={7}
						inputMode="numeric"
						autoComplete="one-time-code"
					/>
					<div className="flex flex-wrap gap-2">
						<Button
							type="submit"
							variant="primary"
							size="sm"
							loading={busy}
							disabled={!/^\d{6}$/.test(code.replace(/\s+/g, ""))}
						>
							Verify and turn on
						</Button>
						<Button type="button" variant="secondary" size="sm" onClick={reset}>
							Cancel
						</Button>
					</div>
				</form>
			) : stage.kind === "codes" ? (
				<BackupCodes codes={stage.backupCodes} onDone={reset} />
			) : enabled ? (
				<div className="flex flex-wrap gap-2">
					<Button
						variant="secondary"
						size="sm"
						onClick={() => setStage({ kind: "password", action: "regenerate" })}
					>
						New backup codes
					</Button>
					<Button variant="ghost" size="sm" onClick={() => setStage({ kind: "password", action: "disable" })}>
						Turn off
					</Button>
				</div>
			) : (
				<Button variant="secondary" size="sm" onClick={() => setStage({ kind: "password", action: "enable" })}>
					Set up two-factor
				</Button>
			)}
		</div>
	);
}
