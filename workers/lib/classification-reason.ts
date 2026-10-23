// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * What the inbound path stores on each email so clients can explain where it
 * was filed (docs/spam-management-plan.md §5 Explainability):
 * `classification_reason` (stable machine code, see shared/spam-reason.ts),
 * `auth_tier` (verified / unverified / failed) and `matched_rule_id` (the
 * sender rule that decided it; always null until `sender_rules` lands).
 */

import { ClassificationReasons } from "../../shared/spam-reason.ts";
import { authTierOf, type AuthTier, type EmailAuth } from "./email-auth.ts";

/**
 * Reason code for the folder the message actually lands in. The classifier's
 * reason stands unless the sender's triage status moved it: a rejected sender
 * lands in Screened out (or Spam with Screener off) whatever the classifier
 * said, and the reader should say so.
 */
export function inboundClassificationReason(
	classification: { reason?: string | null },
	decision: { triageAction: string },
): string | null {
	if (decision.triageAction === "rejected") {
		return ClassificationReasons.SENDER_REJECTED;
	}
	return classification.reason?.trim() || null;
}

/** Tier to store for a message; null when there's no auth snapshot (outbound). */
export function storedAuthTier(
	auth: EmailAuth | null | undefined,
): AuthTier | null {
	return auth ? authTierOf(auth) : null;
}
