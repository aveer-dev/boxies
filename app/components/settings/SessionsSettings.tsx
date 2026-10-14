// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Loader, useKumoToastManager } from "@cloudflare/kumo";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { describeSession } from "~/lib/session-label";
import { useSessions } from "~/queries/account";
import { queryKeys } from "~/queries/keys";
import api from "~/services/api";
import type { AccountSession } from "~/types";
import ConfirmDialog from "./ConfirmDialog";
import SettingsSubpage from "./SettingsSubpage";

function errorMessage(err: unknown, fallback: string): string {
	return err instanceof Error && err.message ? err.message : fallback;
}

function formatWhen(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime())
		? ""
		: date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function SessionRow({
	session,
	onRevoke,
}: {
	session: AccountSession;
	onRevoke: () => void;
}) {
	const details = [
		session.current ? "Active now" : `Last active ${formatWhen(session.lastActiveAt)}`,
		session.ipAddress,
	].filter(Boolean);
	return (
		<li className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
			<div className="min-w-0">
				<div className="text-sm text-kumo-default truncate flex items-center gap-2">
					<span className="truncate">{describeSession(session)}</span>
					{session.current && <Badge variant="success">This device</Badge>}
				</div>
				<div className="text-xs text-kumo-subtle truncate">{details.join(" · ")}</div>
			</div>
			{!session.current && (
				<Button variant="ghost" size="sm" onClick={onRevoke}>
					Sign out
				</Button>
			)}
		</li>
	);
}

/** Where this account is signed in, with per-session and bulk sign-out. */
export default function SessionsSettings() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const toastManager = useKumoToastManager();
	const queryClient = useQueryClient();
	const { data: sessions, isLoading, error } = useSessions();
	const [revoking, setRevoking] = useState<AccountSession | null>(null);
	const [confirmOthers, setConfirmOthers] = useState(false);
	const [busy, setBusy] = useState(false);

	const others = sessions?.filter((s) => !s.current) ?? [];
	// This device first; the rest stay most-recently-active first.
	const ordered = sessions ? [...sessions].sort((a, b) => Number(b.current) - Number(a.current)) : [];
	const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.account.sessions });

	const handleRevoke = async () => {
		if (!revoking) return;
		setBusy(true);
		try {
			await api.revokeSession(revoking.id);
			toastManager.add({ title: `Signed out ${describeSession(revoking)}` });
			setRevoking(null);
			await refresh();
		} catch (err) {
			toastManager.add({ title: errorMessage(err, "Couldn't sign it out"), variant: "error" });
		} finally {
			setBusy(false);
		}
	};

	const handleRevokeOthers = async () => {
		setBusy(true);
		try {
			const { revoked } = await api.revokeOtherSessions();
			toastManager.add({
				title: revoked === 1 ? "Signed out 1 other session" : `Signed out ${revoked} other sessions`,
			});
			setConfirmOthers(false);
			await refresh();
		} catch (err) {
			toastManager.add({ title: errorMessage(err, "Couldn't sign them out"), variant: "error" });
		} finally {
			setBusy(false);
		}
	};

	if (!mailboxId) return null;

	return (
		<SettingsSubpage mailboxId={mailboxId} title="Devices">
			<p className="text-sm text-kumo-subtle mb-6">
				Browsers, apps, and the browser extension signed in to your account. Sign out
				anything you don’t recognize, then change your password.
			</p>

			{isLoading ? (
				<div className="flex justify-center py-12">
					<Loader size="lg" />
				</div>
			) : error || !sessions ? (
				<p className="text-sm text-kumo-subtle">
					{errorMessage(error, "Couldn't load your sessions.")}
				</p>
			) : (
				<div className="space-y-6">
					<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
						<ul className="divide-y divide-kumo-line">
							{ordered.map((session) => (
								<SessionRow
									key={session.id}
									session={session}
									onRevoke={() => setRevoking(session)}
								/>
							))}
						</ul>
					</div>
					<div className="flex justify-end">
						<Button
							variant="secondary"
							disabled={others.length === 0}
							onClick={() => setConfirmOthers(true)}
						>
							Sign out everywhere else
						</Button>
					</div>
				</div>
			)}

			<ConfirmDialog
				open={revoking !== null}
				title="Sign out this session?"
				description={`${revoking ? describeSession(revoking) : "It"} will need to sign in again.`}
				confirmLabel="Sign out"
				busy={busy}
				onConfirm={() => void handleRevoke()}
				onCancel={() => setRevoking(null)}
			/>
			<ConfirmDialog
				open={confirmOthers}
				title="Sign out everywhere else?"
				description="Every other browser, app, and the browser extension will need to sign in again. You stay signed in here."
				confirmLabel="Sign out others"
				busy={busy}
				onConfirm={() => void handleRevokeOthers()}
				onCancel={() => setConfirmOthers(false)}
			/>
		</SettingsSubpage>
	);
}
