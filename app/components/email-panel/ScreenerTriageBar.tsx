// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, useKumoToastManager } from "@cloudflare/kumo";
import { CheckIcon, ProhibitIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Folders, SCREENER_DESTINATION_IDS, FOLDER_DISPLAY_NAMES } from "shared/folders";
import api from "~/services/api";

interface ScreenerTriageBarProps {
	mailboxId: string;
	emailId: string;
	sender: string;
	senderName?: string | null;
	onDone: () => void;
}

export default function ScreenerTriageBar({
	mailboxId,
	emailId,
	sender,
	senderName,
	onDone,
}: ScreenerTriageBarProps) {
	const toastManager = useKumoToastManager();
	const queryClient = useQueryClient();
	const [busy, setBusy] = useState(false);
	const [picking, setPicking] = useState(false);

	const invalidate = async () => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: ["emails", mailboxId] }),
			queryClient.invalidateQueries({ queryKey: ["folders", mailboxId] }),
		]);
	};

	const approve = async (destinationFolderId: string) => {
		setBusy(true);
		try {
			await api.approveSender(mailboxId, {
				sender,
				destinationFolderId,
				emailId,
				displayName: senderName || undefined,
			});
			toastManager.add({
				title: `Allowed — future mail goes to ${FOLDER_DISPLAY_NAMES[destinationFolderId] ?? destinationFolderId}`,
			});
			await invalidate();
			onDone();
		} catch (err) {
			toastManager.add({
				title: err instanceof Error ? err.message : "Could not approve sender",
				variant: "error",
			});
		} finally {
			setBusy(false);
			setPicking(false);
		}
	};

	const reject = async () => {
		setBusy(true);
		try {
			await api.rejectSender(mailboxId, {
				sender,
				emailId,
				displayName: senderName || undefined,
			});
			toastManager.add({ title: "Sender screened out" });
			await invalidate();
			onDone();
		} catch (err) {
			toastManager.add({
				title: err instanceof Error ? err.message : "Could not reject sender",
				variant: "error",
			});
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="px-4 py-3 border-b border-kumo-line bg-kumo-recessed space-y-2">
			<p className="text-sm text-kumo-strong">
				New sender — approve where their mail should go, or screen them out
				privately.
			</p>
			{picking ? (
				<div className="flex flex-wrap gap-2">
					{SCREENER_DESTINATION_IDS.map((id) => (
						<Button
							key={id}
							variant={id === Folders.INBOX ? "primary" : "secondary"}
							size="sm"
							disabled={busy}
							onClick={() => approve(id)}
						>
							{FOLDER_DISPLAY_NAMES[id]}
						</Button>
					))}
					<Button
						variant="ghost"
						size="sm"
						disabled={busy}
						onClick={() => setPicking(false)}
					>
						Cancel
					</Button>
				</div>
			) : (
				<div className="flex flex-wrap gap-2">
					<Button
						variant="primary"
						size="sm"
						icon={<CheckIcon size={16} />}
						disabled={busy}
						loading={busy}
						onClick={() => setPicking(true)}
					>
						Approve
					</Button>
					<Button
						variant="secondary"
						size="sm"
						icon={<ProhibitIcon size={16} />}
						disabled={busy}
						onClick={reject}
					>
						Reject
					</Button>
				</div>
			)}
		</div>
	);
}
