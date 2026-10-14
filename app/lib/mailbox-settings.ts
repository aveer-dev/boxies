// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Fields the server adds to a mailbox's settings for display. They are never
 * saved: membership lives in AUTH_DB and changes through invites and the
 * members routes, so a settings PUT must not echo them back.
 */
const READ_ONLY_SETTINGS_KEYS = ["acl", "canManage"] as const;

/** The settings blob a client may PUT (a shallow copy without read-only fields). */
export function writableMailboxSettings(settings: unknown): Record<string, unknown> {
	if (!settings || typeof settings !== "object" || Array.isArray(settings)) return {};
	const next: Record<string, unknown> = { ...(settings as Record<string, unknown>) };
	for (const key of READ_ONLY_SETTINGS_KEYS) delete next[key];
	return next;
}
