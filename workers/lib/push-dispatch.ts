// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { sendAPNsPush, type APNsPayload } from "./apns";
import { sendFcmPush } from "./fcm";
import type { Env } from "../types";

export type DeviceTokenRow = { token: string; platform: string };

/**
 * Send one alert to every device registered on a mailbox (APNs for iOS, FCM
 * for Android) and drop tokens the providers report as stale. Shared by the
 * inbound path, the test-push route and the mailbox DO (Reply Later
 * reminders, AVE-86).
 */
export async function dispatchPushToDevices(
	env: Env,
	stub: {
		getDeviceTokens: () => Promise<DeviceTokenRow[]> | DeviceTokenRow[];
		unregisterDeviceToken: (token: string) => Promise<unknown> | unknown;
	},
	payload: APNsPayload,
): Promise<{ deviceCount: number; ios: unknown; android: unknown }> {
	const rows = await stub.getDeviceTokens();
	const iosTokens = rows.filter((r) => r.platform !== "android").map((r) => r.token);
	const androidTokens = rows.filter((r) => r.platform === "android").map((r) => r.token);

	const ios = await sendAPNsPush(env, iosTokens, payload);
	const android = await sendFcmPush(env, androidTokens, payload);

	for (const stale of [...ios.staleTokens, ...android.staleTokens]) {
		await stub.unregisterDeviceToken(stale);
	}

	return { deviceCount: rows.length, ios, android };
}
