// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Dialog } from "@cloudflare/kumo";
import { XIcon } from "@phosphor-icons/react";
import { type CSSProperties, useState } from "react";
import { IconButton } from "~/components/IconButton";
import { SHORTCUTS, type ShortcutId, useShortcut } from "~/lib/shortcuts";

const GROUPS = ["Mail", "Navigation", "App"] as const;

export function Keycap({ children }: { children: string }) {
	return (
		<kbd className="inline-flex min-w-6 justify-center rounded-md bg-[var(--bg-badge)] px-1.5 font-sans text-xs leading-[22px] text-kumo-strong shadow-[inset_0_0_0_1px_var(--border-card),0_1px_0_var(--border-card)]">
			{children}
		</kbd>
	);
}

/** `?` — every shortcut, grouped, straight from the shortcut map. */
export default function ShortcutSheet() {
	const [open, setOpen] = useState(false);
	useShortcut("cheatSheet", () => setOpen(true));

	const entries = Object.entries(SHORTCUTS) as [ShortcutId, (typeof SHORTCUTS)[ShortcutId]][];
	let row = 0;

	return (
		<Dialog.Root open={open} onOpenChange={setOpen}>
			<Dialog size="lg" className="p-6">
				<div className="flex items-center justify-between gap-4">
					<Dialog.Title className="text-base font-semibold">Keyboard shortcuts</Dialog.Title>
					<Dialog.Close render={<IconButton label="Close" shortcut="Esc" icon={XIcon} close className="-mr-2" />} />
				</div>
				<p className="mt-1 text-sm text-kumo-subtle">
					Mail keys act on the focused row, or on the open message.
				</p>
				<div className="mt-5 grid gap-x-8 gap-y-6 sm:grid-cols-2">
					{GROUPS.map((group) => (
						<section key={group} className={group === "Mail" ? "sm:row-span-2" : undefined}>
							<h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-kumo-subtle">{group}</h3>
							<dl className="space-y-0.5">
								{entries
									.filter(([, s]) => s.group === group)
									.map(([id, s]) => (
										<div
											key={id}
											style={{ "--i": row++ } as CSSProperties}
											className="row-enter flex items-center justify-between gap-4 rounded-lg px-2 py-1.5 -mx-2 hover:bg-kumo-tint"
										>
											<dt className="text-sm text-kumo-default">{s.label}</dt>
											<dd>
												<Keycap>{s.keys}</Keycap>
											</dd>
										</div>
									))}
							</dl>
						</section>
					))}
				</div>
			</Dialog>
		</Dialog.Root>
	);
}
