// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Dialog, Input } from "@cloudflare/kumo";
import { type FormEvent, useRef, useState } from "react";
import { Link as RouterLink } from "react-router";
import { newMailboxRequest } from "~/lib/new-mailbox";
import { useCreateMailbox } from "~/queries/mailboxes";

interface AddMailboxDialogProps {
	isOpen: boolean;
	onClose: () => void;
	mailDomain: string;
	/** Domain admins also get a pointer to Admin for addresses on their own domains. */
	isAdmin?: boolean;
	onSuccess: (mailboxId: string) => void | Promise<void>;
}

/**
 * Signed-in "Add a mailbox": creates an address on the shared mail domain for
 * the current account (`POST /api/v1/mailboxes`). Unlike `OnboardingFlow`, it
 * never creates a user or a session.
 */
export function AddMailboxDialog({
	isOpen,
	onClose,
	mailDomain,
	isAdmin = false,
	onSuccess,
}: AddMailboxDialogProps) {
	const createMailbox = useCreateMailbox();
	const [name, setName] = useState("");
	const [username, setUsername] = useState("");
	const [error, setError] = useState<string | null>(null);
	// The pending flag lags a render; the ref drops a double click straight away.
	const inFlight = useRef(false);
	const isPending = createMailbox.isPending;

	const reset = () => {
		setName("");
		setUsername("");
		setError(null);
		createMailbox.reset();
	};

	const close = () => {
		if (inFlight.current) return;
		reset();
		onClose();
	};

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		if (inFlight.current) return;
		const request = newMailboxRequest(username, name, mailDomain);
		if (!request.ok) {
			setError(request.error);
			return;
		}
		inFlight.current = true;
		setError(null);
		try {
			const mailbox = await createMailbox.mutateAsync({
				email: request.email,
				name: request.name,
			});
			reset();
			await onSuccess(mailbox.id);
		} catch (err: unknown) {
			setError((err instanceof Error ? err.message : null) || "Couldn't create the mailbox");
		} finally {
			inFlight.current = false;
		}
	};

	return (
		<Dialog.Root
			open={isOpen}
			onOpenChange={(open) => {
				if (!open) close();
			}}
		>
			<Dialog size="sm" className="p-6">
				<form onSubmit={handleSubmit} className="space-y-4">
					<div>
						<Dialog.Title className="text-lg font-bold text-kumo-default mb-1">
							Add a mailbox
						</Dialog.Title>
						<Dialog.Description className="text-xs text-kumo-subtle">
							Create a new address on @{mailDomain} for this account.
						</Dialog.Description>
					</div>

					{error && (
						<div
							role="alert"
							className="rounded-lg bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400"
						>
							{error}
						</div>
					)}

					<div>
						<label
							htmlFor="add-mailbox-name"
							className="block text-xs font-medium text-kumo-subtle mb-1"
						>
							Name
						</label>
						<Input
							id="add-mailbox-name"
							placeholder="Full name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							disabled={isPending}
							autoFocus
						/>
					</div>
					<div>
						<label
							htmlFor="add-mailbox-username"
							className="block text-xs font-medium text-kumo-subtle mb-1"
						>
							Username
						</label>
						<div className="flex items-center gap-2">
							<Input
								id="add-mailbox-username"
								placeholder="username"
								value={username}
								onChange={(e) => {
									// The domain is fixed: keep only what's before "@".
									setUsername(e.target.value.split("@")[0]);
									if (error) setError(null);
								}}
								disabled={isPending}
								autoCapitalize="none"
								autoCorrect="off"
								spellCheck={false}
								required
							/>
							<span className="text-xs font-medium text-kumo-subtle whitespace-nowrap">
								@{mailDomain}
							</span>
						</div>
					</div>

					{isAdmin && (
						<p className="text-xs text-kumo-subtle">
							Adding an address on your own domain?{" "}
							<RouterLink to="/admin" onClick={close} className="text-kumo-default underline">
								Open Admin
							</RouterLink>
						</p>
					)}

					<div className="flex justify-end gap-2 pt-4 border-t border-kumo-line">
						<Button type="button" variant="secondary" onClick={close} disabled={isPending}>
							Cancel
						</Button>
						<Button
							type="submit"
							variant="primary"
							loading={isPending}
							disabled={isPending || !username.trim() || !mailDomain}
						>
							Create
						</Button>
					</div>
				</form>
			</Dialog>
		</Dialog.Root>
	);
}
