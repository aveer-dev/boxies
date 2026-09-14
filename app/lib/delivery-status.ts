// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Email } from "~/types";

export type FailureDeliveryStatus = "failed" | "bounced" | "complained";

export function isDeliveryFailure(
	status: Email["delivery_status"],
): status is FailureDeliveryStatus {
	return status === "failed" || status === "bounced" || status === "complained";
}

export function deliveryStatusLabel(
	status: Email["delivery_status"],
): string {
	switch (status) {
		case "failed":
			return "Send failed";
		case "bounced":
			return "Bounced";
		case "complained":
			return "Marked as spam";
		case "queued":
			return "Sending";
		case "accepted":
			return "Sent";
		default:
			return "Delivery issue";
	}
}
