// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Input, Loader, useKumoToastManager } from "@cloudflare/kumo";
import { FingerprintIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { PasskeyRow } from "~/lib/auth-client";
import { queryKeys } from "~/queries/keys";
import ConfirmDialog from "./ConfirmDialog";

const loadAuthClient = () => import("~/lib/auth-client");

function errorMessage(err: unknown, fallback: string): string {
	return err instanceof Error && err.message ? err.message : fallback;
}

function formatDate(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

/**
 * Passkeys (WebAuthn) on this account: each signs in on its own, without the
 * password or a two-factor code. Registering one needs this signed-in
 * session; the browser or password manager keeps the private key.
 */
export default function PasskeysSection() {
	const toastManager = useKumoToastManager();
	const queryClient = useQueryClient();
	const [supported, setSupported] = useState(true);
	const [adding, setAdding] = useState(false);
	const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
	const [removing, setRemoving] = useState<PasskeyRow | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		setSupported(typeof window.PublicKeyCredential === "function");
	}, []);

	const { data: passkeys, isLoading, isError } = useQuery({
		queryKey: queryKeys.account.passkeys,
		queryFn: async () => (await loadAuthClient()).listPasskeys(),
		staleTime: 30_000,
	});

	const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.account.passkeys });

	const add = async () => {
		setAdding(true);
		try {
			const { addPasskey, isCancelled } = await loadAuthClient();
			try {
				await addPasskey();
			} catch (err) {
				if (isCancelled(err)) return;
				throw err;
			}
			toastManager.add({ title: "Passkey added" });
			await refresh();
		} catch (err) {
			toastManager.add({ title: errorMessage(err, "Couldn't add the passkey"), variant: "error" });
		} finally {
			setAdding(false);
		}
	};

	const saveName = async () => {
		if (!renaming) return;
		const name = renaming.name.trim();
		if (!name) return;
		setBusy(true);
		try {
			await (await loadAuthClient()).renamePasskey(renaming.id, name);
			setRenaming(null);
			await refresh();
		} catch (err) {
			toastManager.add({ title: errorMessage(err, "Couldn't rename the passkey"), variant: "error" });
		} finally {
			setBusy(false);
		}
	};

	const remove = async () => {
		if (!removing) return;
		setBusy(true);
		try {
			await (await loadAuthClient()).deletePasskey(removing.id);
			setRemoving(null);
			toastManager.add({ title: "Passkey removed" });
			await refresh();
		} catch (err) {
			toastManager.add({ title: errorMessage(err, "Couldn't remove the passkey"), variant: "error" });
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="rounded-2xl border border-kumo-line bg-kumo-base p-5 space-y-4">
			<div>
				<div className="text-sm font-medium text-kumo-default mb-1">Passkeys</div>
				<p className="text-xs text-kumo-subtle">
					Sign in with Face ID, Touch ID, Windows Hello, or a security key instead of a
					password. A passkey is saved in your browser or password manager.
				</p>
			</div>

			{isLoading ? (
				<div className="flex justify-center py-4">
					<Loader />
				</div>
			) : isError ? (
				<p className="text-xs text-kumo-subtle">Couldn't load your passkeys.</p>
			) : passkeys && passkeys.length > 0 ? (
				<ul className="divide-y divide-kumo-line">
					{passkeys.map((passkey) => (
						<li key={passkey.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
							{renaming?.id === passkey.id ? (
								<form
									className="flex w-full flex-wrap items-end gap-2"
									onSubmit={(e) => {
										e.preventDefault();
										void saveName();
									}}
								>
									<Input
										aria-label="Passkey name"
										className="min-w-0 flex-1"
										value={renaming.name}
										onChange={(e) => setRenaming({ id: passkey.id, name: e.target.value })}
										maxLength={100}
										autoFocus
									/>
									<Button type="submit" variant="primary" size="sm" loading={busy} disabled={!renaming.name.trim()}>
										Save
									</Button>
									<Button type="button" variant="secondary" size="sm" onClick={() => setRenaming(null)}>
										Cancel
									</Button>
								</form>
							) : (
								<>
									<div className="min-w-0">
										<div className="text-sm text-kumo-default truncate flex items-center gap-2">
											<FingerprintIcon size={14} className="shrink-0 text-kumo-subtle" />
											<span className="truncate">{passkey.name || "Passkey"}</span>
											{passkey.backedUp && <Badge>Synced</Badge>}
										</div>
										<div className="text-xs text-kumo-subtle">Added {formatDate(passkey.createdAt)}</div>
									</div>
									<div className="flex shrink-0 gap-1">
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setRenaming({ id: passkey.id, name: passkey.name ?? "" })}
										>
											Rename
										</Button>
										<Button variant="ghost" size="sm" onClick={() => setRemoving(passkey)}>
											Remove
										</Button>
									</div>
								</>
							)}
						</li>
					))}
				</ul>
			) : (
				<p className="text-xs text-kumo-subtle">No passkeys yet.</p>
			)}

			{supported ? (
				<Button
					variant="secondary"
					size="sm"
					icon={<FingerprintIcon size={14} />}
					loading={adding}
					onClick={() => void add()}
				>
					Add a passkey
				</Button>
			) : (
				<p className="text-xs text-kumo-subtle rounded-md bg-kumo-tint px-3 py-2">
					This browser doesn't support passkeys.
				</p>
			)}

			<ConfirmDialog
				open={removing !== null}
				title="Remove this passkey?"
				description={`You won't be able to sign in with "${removing?.name || "this passkey"}" anymore. Also delete it from your password manager or device so it isn't offered again.`}
				confirmLabel="Remove"
				busy={busy}
				onConfirm={() => void remove()}
				onCancel={() => setRemoving(null)}
			/>
		</div>
	);
}
