// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button } from "@cloudflare/kumo";
import { WarningCircleIcon } from "@phosphor-icons/react";

/** Shown when a list fails to load, so an error never reads as an empty folder. */
export function ListLoadError({
	error,
	onRetry,
}: {
	error: unknown;
	onRetry: () => void;
}) {
	const message = error instanceof Error ? error.message : "Something went wrong.";
	return (
		<div className="flex flex-col items-center justify-center py-24 px-6 text-center">
			<div className="mb-4">
				<WarningCircleIcon size={48} weight="thin" className="text-kumo-subtle" />
			</div>
			<h3 className="text-base font-semibold text-kumo-default mb-1.5">
				Couldn't load your mail
			</h3>
			<p className="text-sm text-kumo-subtle max-w-xs mb-5">{message}</p>
			<Button variant="secondary" size="sm" onClick={onRetry}>
				Try again
			</Button>
		</div>
	);
}
