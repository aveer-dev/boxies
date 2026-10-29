// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useKumoToastManager } from "@cloudflare/kumo";
import { useCallback } from "react";
import { type SpamVerdictResult, spamVerdictToastTitle } from "~/lib/spam-verdict";
import { useUndoSenderVerdict } from "~/queries/emails";

/**
 * Shows the Not spam / Report spam toast with Undo (AVE-98). Undo reverts the
 * sender's rule and every message the verdict moved, server-side.
 */
export function useSpamVerdictToast(mailboxId: string | undefined) {
	const toastManager = useKumoToastManager();
	const undo = useUndoSenderVerdict();
	return useCallback(
		(result: SpamVerdictResult | undefined, context: { folderId: string; sender?: string | null }) => {
			const title = spamVerdictToastTitle(result, context);
			if (!title) return false;
			const token = result?.undoToken;
			let toastId: string | undefined;
			toastId = toastManager.add({
				title,
				actions:
					token && mailboxId
						? [
								{
									children: "Undo",
									variant: "secondary",
									size: "sm",
									onClick: () => {
										if (toastId) toastManager.close(toastId);
										undo.mutate(
											{ mailboxId, undoToken: token },
											{
												onSuccess: () => toastManager.add({ title: "Undone" }),
												onError: () =>
													toastManager.add({ title: "Couldn't undo", variant: "error" }),
											},
										);
									},
								},
							]
						: undefined,
			});
			return true;
		},
		[mailboxId, toastManager, undo],
	);
}
