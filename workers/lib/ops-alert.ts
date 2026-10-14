// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Env } from "../types";
import { sendSystemEmail } from "../auth/mail";
import { escapeHtml } from "./email-helpers";

/** Tell the operator something needs a human: always logged, emailed to OPS_ALERT_EMAIL when set. */
export async function alertOps(env: Env, subject: string, text: string): Promise<void> {
	console.error(`[OpsAlert] ${subject}: ${text}`);
	const to = env.OPS_ALERT_EMAIL?.trim();
	if (!to) return;
	await sendSystemEmail(env, { to, subject: `[Inboxies ops] ${subject}`, text, html: `<p>${escapeHtml(text)}</p>` });
}
