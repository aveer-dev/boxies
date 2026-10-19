// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Body for `api.createMailbox`, or the reason the form can't be sent yet. */
export type NewMailboxRequest =
	| { ok: true; email: string; name: string }
	| { ok: false; error: string };

/**
 * Normalise the "Add a mailbox" form: the username field takes a local part
 * (anything typed after "@" is dropped, since the domain is fixed), and an
 * empty name falls back to that local part. Reserved names, duplicates and
 * domain rules stay with the server, which reports them inline.
 */
export function newMailboxRequest(
	username: string,
	name: string,
	mailDomain: string,
): NewMailboxRequest {
	const local = username.split("@")[0].trim().toLowerCase();
	const domain = mailDomain.trim().toLowerCase();
	if (!domain) return { ok: false, error: "No mail domain is configured" };
	if (!local) return { ok: false, error: "Choose a username" };
	if (!/^[a-z0-9](?:[a-z0-9._+-]*[a-z0-9])?$/.test(local) || local.includes("..")) {
		return {
			ok: false,
			error: "Use letters, numbers, dots, dashes, underscores or plus signs",
		};
	}
	return { ok: true, email: `${local}@${domain}`, name: name.trim() || local };
}
