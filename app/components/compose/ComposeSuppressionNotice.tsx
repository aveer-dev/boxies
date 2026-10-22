// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button } from "@cloudflare/kumo";
import { type SuppressedRecipient, suppressionReasonText } from "~/lib/suppression";

/**
 * Inline notice for a send the server refused because a recipient is on the
 * bounce / complaint suppression list (409 recipient_suppressed). Lists each
 * address with its reason and offers Un-suppress, which lifts them and sends.
 */
export default function ComposeSuppressionNotice({
	suppressed,
	busy,
	disabled,
	onUnsuppressAndSend,
}: {
	suppressed: SuppressedRecipient[];
	busy: boolean;
	disabled?: boolean;
	onUnsuppressAndSend: () => void;
}) {
	if (suppressed.length === 0) return null;
	const canLiftAll = suppressed.every((s) => s.canUnsuppress);
	const many = suppressed.length > 1;
	return (
		<div
			className="rounded-md border border-kumo-line bg-kumo-tint px-3 py-2.5 text-xs text-kumo-default"
			role="alert"
		>
			<div className="font-medium">Not sent</div>
			<ul className="mt-1.5 space-y-1.5">
				{suppressed.map((s) => (
					<li key={s.address} className="min-w-0">
						<div className="truncate font-medium text-kumo-strong">{s.address}</div>
						<div className="text-kumo-subtle">
							{suppressionReasonText(s)}.
							{s.detail ? <span className="ml-1 break-words">{s.detail}</span> : null}
						</div>
						{!s.canUnsuppress && (
							<div className="text-kumo-subtle">
								Another mailbox on this domain suppressed it. Ask a domain admin to un-suppress it.
							</div>
						)}
					</li>
				))}
			</ul>
			<div className="mt-2 flex flex-wrap items-center gap-2">
				{canLiftAll && (
					<Button
						type="button"
						variant="secondary"
						size="sm"
						loading={busy}
						disabled={busy || disabled}
						onClick={onUnsuppressAndSend}
					>
						{many ? "Un-suppress all and send" : "Un-suppress and send"}
					</Button>
				)}
				<span className="text-kumo-subtle">
					{canLiftAll
						? "Or remove the address to send to everyone else."
						: "Remove the address to send to everyone else."}
				</span>
			</div>
		</div>
	);
}
