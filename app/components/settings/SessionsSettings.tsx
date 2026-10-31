// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Loader, useKumoToastManager } from "@cloudflare/kumo";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useMailboxId } from "~/hooks/useCurrentMailbox";
import { describeSession } from "~/lib/session-label";
import { useMcpGrants, useSessions } from "~/queries/account";
import { queryKeys } from "~/queries/keys";
import api from "~/services/api";
import type { AccountSession, McpGrant } from "~/types";
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

const SCOPE_LABELS: Record<string, string> = {
	read: "Read",
	draft: "Drafts",
	send: "Send",
	manage: "Organize",
};

function grantName(grant: McpGrant): string {
	return grant.clientName ?? "Unnamed app";
}

/** "Read, Drafts, Send · All mailboxes", in the server's order. */
function describeGrantAccess(grant: McpGrant): string {
	const scopes = grant.scopes.map((scope) => SCOPE_LABELS[scope] ?? scope).join(", ");
	const mailboxes =
		grant.mailboxIds === null
			? "All mailboxes"
			: grant.mailboxIds.length === 1
				? grant.mailboxIds[0]
				: `${grant.mailboxIds.length} mailboxes`;
	return [scopes, mailboxes].filter(Boolean).join(" · ");
}

function GrantRow({ grant, onRevoke }: { grant: McpGrant; onRevoke: () => void }) {
	return (
		<li className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
			<div className="min-w-0">
				<div className="text-sm text-kumo-default truncate">{grantName(grant)}</div>
				<div className="text-xs text-kumo-subtle truncate">
					{[`Connected ${formatWhen(grant.createdAt)}`, describeGrantAccess(grant)]
						.filter(Boolean)
						.join(" · ")}
				</div>
			</div>
			<Button variant="ghost" size="sm" onClick={onRevoke}>
				Disconnect
			</Button>
		</li>
	);
}

/**
 * Apps connected over MCP (OAuth grants). Disconnecting deletes the grant
 * and its tokens, so the app loses access on its next request.
 */
function ConnectedApps() {
	const toastManager = useKumoToastManager();
	const queryClient = useQueryClient();
	const { data: grants, isLoading, error } = useMcpGrants();
	const [revoking, setRevoking] = useState<McpGrant | null>(null);
	const [busy, setBusy] = useState(false);

	const handleRevoke = async () => {
		if (!revoking) return;
		setBusy(true);
		try {
			await api.revokeMcpGrant(revoking.id);
			toastManager.add({ title: `Disconnected ${grantName(revoking)}` });
			setRevoking(null);
			await queryClient.invalidateQueries({ queryKey: queryKeys.account.mcpGrants });
		} catch (err) {
			toastManager.add({ title: errorMessage(err, "Couldn't disconnect it"), variant: "error" });
		} finally {
			setBusy(false);
		}
	};

	return (
		<section className="mt-10">
			<h2 className="text-sm font-medium text-kumo-default mb-1">Connected apps</h2>
			<p className="text-sm text-kumo-subtle mb-4">
				AI assistants and other apps you allowed to use your mail over MCP. Disconnect one to
				cut off its access right away.
			</p>
			{isLoading ? (
				<div className="flex justify-center py-6">
					<Loader />
				</div>
			) : error || !grants ? (
				<p className="text-sm text-kumo-subtle">
					{errorMessage(error, "Couldn't load your connected apps.")}
				</p>
			) : grants.length === 0 ? (
				<p className="text-sm text-kumo-subtle">No apps connected.</p>
			) : (
				<div className="rounded-2xl border border-kumo-line bg-kumo-base p-5">
					<ul className="divide-y divide-kumo-line">
						{grants.map((grant) => (
							<GrantRow key={grant.id} grant={grant} onRevoke={() => setRevoking(grant)} />
						))}
					</ul>
				</div>
			)}

			<ConfirmDialog
				open={revoking !== null}
				title="Disconnect this app?"
				description={`${revoking ? grantName(revoking) : "It"} will lose access to your mail immediately. To use it again, connect it again from the app.`}
				confirmLabel="Disconnect"
				busy={busy}
				onConfirm={() => void handleRevoke()}
				onCancel={() => setRevoking(null)}
			/>
		</section>
	);
}

/** Where this account is signed in, with per-session and bulk sign-out. */
export default function SessionsSettings() {
	const mailboxId = useMailboxId();
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
					<div className="rounded-2xl border border-kumo-line bg-kumo-base p-5">
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

			<ConnectedApps />

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
