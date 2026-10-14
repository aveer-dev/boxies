// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Input, Loader, useKumoToastManager } from "@cloudflare/kumo";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useRecoveryEmail } from "~/queries/account";
import { queryKeys } from "~/queries/keys";
import api from "~/services/api";
import ConfirmDialog from "./ConfirmDialog";

function errorMessage(err: unknown, fallback: string): string {
	return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * The address password-reset codes go to. Until it's verified, "Forgot
 * password" sends nothing, so this says so plainly.
 */
export default function RecoveryEmailSection() {
	const toastManager = useKumoToastManager();
	const queryClient = useQueryClient();
	const { data: status, isLoading } = useRecoveryEmail();
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const [code, setCode] = useState("");
	const [busy, setBusy] = useState(false);
	const [confirmRemove, setConfirmRemove] = useState(false);

	const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.account.recoveryEmail });
	const awaitingCode = Boolean(status?.email && !status.verified) && !editing;

	const sendCode = async (email: string) => {
		setBusy(true);
		try {
			const res = await api.setRecoveryEmail(email);
			setCode(res.devCode ?? "");
			setEditing(false);
			setDraft("");
			toastManager.add({ title: `Code sent to ${res.email}` });
			await refresh();
		} catch (err) {
			toastManager.add({ title: errorMessage(err, "Couldn't send the code"), variant: "error" });
		} finally {
			setBusy(false);
		}
	};

	const verify = async () => {
		setBusy(true);
		try {
			await api.verifyRecoveryEmail(code.trim());
			setCode("");
			toastManager.add({ title: "Recovery email verified" });
			await refresh();
		} catch (err) {
			toastManager.add({ title: errorMessage(err, "Invalid or expired code"), variant: "error" });
		} finally {
			setBusy(false);
		}
	};

	const remove = async () => {
		setBusy(true);
		try {
			await api.removeRecoveryEmail();
			setConfirmRemove(false);
			setCode("");
			toastManager.add({ title: "Recovery email removed" });
			await refresh();
		} catch (err) {
			toastManager.add({ title: errorMessage(err, "Couldn't remove it"), variant: "error" });
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="rounded-2xl border border-kumo-line bg-kumo-base p-5 space-y-4">
			<div>
				<div className="text-sm font-medium text-kumo-default mb-1 flex items-center gap-2">
					Recovery email
					{status?.verified && <Badge variant="success">Verified</Badge>}
					{status?.email && !status.verified && <Badge variant="warning">Not verified</Badge>}
				</div>
				<p className="text-xs text-kumo-subtle">
					Password reset codes go only here. Use an address outside Inboxies that only you
					can read.
				</p>
			</div>

			{isLoading || !status ? (
				<div className="flex justify-center py-4">
					<Loader />
				</div>
			) : editing || !status.email ? (
				<>
					{!status.email && !editing && (
						<p className="text-xs text-kumo-default rounded-md bg-kumo-warning-tint px-3 py-2">
							Without a verified recovery email, you can't reset a forgotten password.
						</p>
					)}
					{editing && status.verified && (
						<p className="text-xs text-kumo-default rounded-md bg-kumo-warning-tint px-3 py-2">
							Your current recovery email ({status.email}) stops working for password resets
							as soon as we send the code, until you confirm the new one.
						</p>
					)}
					<Input
						label={status.email ? "New recovery email" : "Email"}
						type="email"
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						placeholder="you@gmail.com"
						autoComplete="email"
					/>
					<div className="flex flex-wrap gap-2">
						<Button
							variant="primary"
							size="sm"
							loading={busy}
							disabled={!draft.trim().includes("@")}
							onClick={() => void sendCode(draft.trim())}
						>
							Send code
						</Button>
						{editing && (
							<Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
								Cancel
							</Button>
						)}
					</div>
				</>
			) : awaitingCode ? (
				<>
					<p className="text-sm text-kumo-default">
						Enter the 6-digit code we sent to <strong>{status.email}</strong>.
					</p>
					<Input
						label="Code"
						value={code}
						onChange={(e) => setCode(e.target.value)}
						placeholder="123456"
						maxLength={6}
						inputMode="numeric"
						autoComplete="one-time-code"
					/>
					<div className="flex flex-wrap gap-2">
						<Button
							variant="primary"
							size="sm"
							loading={busy}
							disabled={code.trim().length < 6}
							onClick={() => void verify()}
						>
							Verify
						</Button>
						<Button
							variant="secondary"
							size="sm"
							disabled={busy}
							onClick={() => void sendCode(status.email!)}
						>
							Resend code
						</Button>
						<Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
							Use a different address
						</Button>
						<Button variant="ghost" size="sm" onClick={() => setConfirmRemove(true)}>
							Remove
						</Button>
					</div>
				</>
			) : (
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="text-sm text-kumo-default truncate">{status.email}</div>
					<div className="flex gap-2">
						<Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
							Change
						</Button>
						<Button variant="ghost" size="sm" onClick={() => setConfirmRemove(true)}>
							Remove
						</Button>
					</div>
				</div>
			)}

			<ConfirmDialog
				open={confirmRemove}
				title="Remove recovery email?"
				description="You won't be able to reset your password if you forget it."
				confirmLabel="Remove"
				busy={busy}
				onConfirm={() => void remove()}
				onCancel={() => setConfirmRemove(false)}
			/>
		</div>
	);
}
