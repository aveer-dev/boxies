// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { sendEmail } from "../email-sender";
import { isDevRuntime } from "../lib/dev-runtime";
import { resolveMailDomain } from "../lib/mail-domain";
import type { Env } from "../types";

/** Plain-text platform email (codes, resets) from noreply@ the mail domain. */
export async function sendAuthEmail(
	env: Env,
	message: { to: string; subject: string; text: string },
): Promise<void> {
	if (!env.EMAIL) {
		if (isDevRuntime()) {
			console.log(`[auth mail] to=${message.to} subject=${message.subject}\n${message.text}`);
			return;
		}
		throw new Error("EMAIL binding is not configured");
	}
	const from = env.INVITE_FROM_EMAIL?.trim() || `noreply@${resolveMailDomain(env)}`;
	await sendEmail(env.EMAIL, {
		to: message.to,
		from: { email: from, name: "Inboxies" },
		subject: message.subject,
		text: message.text,
	});
}
