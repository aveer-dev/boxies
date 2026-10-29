# Push notifications: end-to-end audit (AVE-103, October 2026)

Question: are push notifications still working after the recent changes on `dev`
(spam auth tiers, Screener, bounce suppression, outbound send queue, the Better Auth cutover,
purge ordering, dedup, iPad/tablet layouts, passkeys)?

## Short answer

The push pipeline itself (registration → storage → dispatch → client) is intact. **Pushes
stopped because almost no mail qualified for one.** Production Workers logs for the 12 inbound
messages in the retention window (Oct 17–21):

| Classification | Count | Filed to | Push? |
| --- | --- | --- | --- |
| `spam / ai-spam` (senders: uber.com ×5, checkr.com ×2, x.com ×1) | 8 | Spam | no, by design |
| `ham / ai-ham`, unknown sender | 2 | Screener | no, by design |
| `bulk / bulk-list-headers`, unknown sender | 2 | Screener | no, by design |

None of the 12 reached a push, and there are no `[Push]`/`[APNs]` log lines in the window,
so dispatch was never attempted. Two causes:

1. **The AI spam step junks legitimate transactional mail.** Llama 3.1 8B flagged receipts and
   alerts from Uber, Checkr and X as spam. This is the "everything goes to spam" symptom.
   **Fixed** (see below) for authenticated senders: Screener now decides instead of Spam.
2. **Screener (on by default) holds every first-time sender, and Screener mail never pushes.**
   That's intended. But it means a new sender never pings you until you accept them.
   Changing it is a product decision (see Questions).

## Traced flow

Status: **OK** = read and consistent; **fixed** = changed in this PR; **gap** = works but
incomplete; **unverifiable** = needs a device or console.

### Client registration

| Hop | Where | Status |
| --- | --- | --- |
| iOS: `aps-environment` entitlement, `remote-notification` background mode | `ios/AgenticInbox/Inboxies/Inboxies.entitlements:5`, `Info.plist:96` | OK. `development` is rewritten to `production` on App Store/TestFlight export |
| iOS: permission prompt + `registerForRemoteNotifications` | `Services/PushNotificationManager.swift:44` | OK |
| iOS: token hex → `POST /device-token` | `PushNotificationManager.swift:61`, `APIClient.swift:1166` | OK |
| iOS: which mailboxes get registered | `Services/AppModel.swift:315` (`setupRealTimeStream`, called from `loadMailbox`) | **fixed**: previously only the mailbox on screen; now every mailbox (Android parity) |
| iOS: Settings toggle off/on | `Views/Settings/SettingsSheetView.swift:316` | **fixed**: previously only unregistered the selected mailbox, so other mailboxes kept pushing |
| iOS: re-registration after sign-in / new session | `AppModel.swift:315` runs on every mailbox load; cached token synced immediately | OK. Owner keys move to the new session on each launch |
| iOS: sign-out / account deletion unregister | `PushNotificationManager.swift:118`, `AppModel.swift:1560` | OK |
| Android: `POST_NOTIFICATIONS` prompt (once) | `ui/home/HomeShellView.kt:260` | OK |
| Android: FCM token → every mailbox, re-POST per process | `services/PushNotificationManager.kt:83`, `AppModel.kt:366` | OK |
| Android: token rotation (`onNewToken`) | `services/InboxiesFirebaseMessagingService.kt:23` | OK |
| Android: `google-services.json` | gitignored; present in the main checkout only | unverifiable from the repo. Without it `HAS_GOOGLE_SERVICES=false` and push is a silent no-op |

### Server registration and storage

| Hop | Where | Status |
| --- | --- | --- |
| `POST /api/v1/mailboxes/:id/device-token` (mailbox ACL via `requireMailbox`) | `workers/index.ts:1007` | OK. Covered by `mailbox-access-http.test.mjs` |
| Storage: `device_tokens` in the MailboxDO SQLite, `owner_keys = [user:<id>, session:<id>]` | `workers/durableObject/index.ts:3185`, migrations `12_add_device_tokens`, `27_device_token_owner` | OK |
| Better Auth cutover: owner keys use the new D1 user/session IDs | `workers/auth/principal.ts:52` | OK. Dispatch doesn't filter by owner, so pre-cutover tokens still receive pushes until a membership prune drops them. Apps re-register on launch with new keys |
| Session ended → prune that session's tokens | `workers/auth/index.ts:176` → `auth/hooks.ts:32` → `durableObject/index.ts:3213` | OK. Sign-out, revoke, password reset and expiry all go through Better Auth `deleteSession(s)`, so the hook fires |
| Left mailbox → prune to members | `workers/auth/mailboxes.ts:120` | OK |
| Mailbox purge wipes `device_tokens` | `workers/lib/mailbox-purge.ts:43` | OK |

### Inbound mail → push decision

| Hop | Where | Status |
| --- | --- | --- |
| Message-ID claim; a duplicate returns before storage (no second push) | `workers/index.ts:1864` | OK. Now covered by `inbound-push.test.mjs` |
| DSN (bounce report) → archived, returns before push | `workers/index.ts:1938` | OK, intended |
| Classify: spam headers → bulk → spoofed From → Workers AI spam/ham | `workers/lib/classify-email.ts:221`, `:261` | **broken in practice**: AI step flags legit transactional mail (8/12 in prod logs) |
| Vouched sender (allowed / purpose box) + aligned auth overrides AI spam | `workers/index.ts:2059` | OK |
| **New**: aligned auth + Screener on → AI spam deferred to Screener | `workers/index.ts:2071`, `classify-email.ts:341` | **fixed** |
| Folder + `skipPush`: spam, Screener (unknown sender), Screened Out, and filter "file away" skip push | `workers/lib/sender-triage.ts:106` | OK, intended. Bulk (Promotions/Updates) from allowed senders **does** push |
| Push gate | `workers/index.ts:2224` | OK |
| Private-email inbound counter after the row is stored | `workers/index.ts:2142` | **fixed**: a throw here was rethrown after storage, the retry was dropped by dedup, and the push (plus forward/auto-reply/draft) was lost. Now best-effort |
| Payload copy (title = sender, subtitle = subject, body = preview) | `workers/index.ts:2234`, `workers/lib/push-payload.ts` | OK |

### Dispatch

| Hop | Where | Status |
| --- | --- | --- |
| Fan-out iOS/Android, prune stale tokens | `workers/index.ts:177` | OK |
| APNs JWT (ES256, `kid`, `iss`, 45-min cache) | `workers/lib/apns.ts:58` | **fixed**: a JWT Apple rejects (`ExpiredProviderToken`/`InvalidProviderToken`) was reused for up to 45 min, and the cache ignored a changed key/team ID. Now dropped and re-signed |
| APNs host: `APNS_SANDBOX="true"` in `wrangler.jsonc:43` → sandbox first, production on `BadDeviceToken` | `workers/lib/apns.ts:112` | OK, but every TestFlight/App Store push costs a failed sandbox request first. See Questions |
| APNs topic `co.inboxies.app` = app bundle ID | `apns.ts:119`, `project.pbxproj` | OK |
| APNs stale tokens: 410, or `BadDeviceToken` on both hosts | `apns.ts:207` | OK |
| APNs collapse ID / badge | n/a | gap: none sent. Badge isn't implemented server- or client-side |
| FCM HTTP v1, service-account OAuth, data-only, `priority: high` | `workers/lib/fcm.ts:81` | OK |
| FCM stale tokens: 404 / `UNREGISTERED` only | `fcm.ts:159` | OK |
| Missing secrets | `apns.ts` / `fcm.ts` | logged as `console.warn` and skipped. Visible in Workers Logs, not surfaced elsewhere |

### Client handling

| Hop | Where | Status |
| --- | --- | --- |
| iOS foreground banner | `ios/.../AppDelegate.swift:67` | OK |
| iOS background `content-available` → folder sync | `AppDelegate.swift:38` | OK |
| iOS tap → `pendingDeepLink` → open email in the right mailbox/folder | `AppDelegate.swift:78` → `PushNotificationManager.swift:136` → `RootView.swift:55` → `AppModel.swift:1041` | OK |
| Android data message → filter (signed in, enabled, known mailbox) → notification | `InboxiesFirebaseMessagingService.kt:28` | OK |
| Android tap → `MainActivity.handlePushIntent` → `RootView` deep link | `MainActivity.kt:194`, `ui/RootView.kt:89` | OK |

## Fixes in this PR

1. **AI spam on authenticated mail goes to Screener, not Spam** (`deferAuthenticatedAiSpamToScreener`).
   This applies only when Screener is on, the AI step alone said spam, and Cloudflare's
   SPF/DKIM/DMARC verdict aligns with the From domain. Unknown senders land in Screener (still
   no push or draft), and rejected senders still go to Screened Out. Spam headers, forged From,
   and Screener-off mailboxes are unchanged.
2. **A failed private-email counter no longer loses the push.**
3. **APNs re-signs a JWT Apple rejects** and keys the JWT cache on key/team ID.
4. **iOS registers every mailbox, and the Settings toggle covers all of them** (Android parity).

Tests: `workers/test/inbound-push.test.mjs` (new; drives `receiveEmail` through APNs dispatch),
`workers/test/apns-dispatch.test.mjs` (new), `workers/test/classify-email.test.mjs` (extended).

## Needs a real device or console

- APNs delivery on a TestFlight/App Store build (production token via the fallback path) and on a
  debug build (sandbox token). Use `POST /api/v1/mailboxes/:id/test-push` while signed in.
- That `APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_PRIVATE_KEY` and `FCM_SERVICE_ACCOUNT_JSON` are set
  on the production Worker (not checked here: no secrets were read).
- The Android release build includes `google-services.json` for the right Firebase project.
- Whether the Uber/Checkr/X messages above were in fact DKIM/DMARC-aligned. The logs don't record
  the auth verdict, so fix 1 only helps if they were. Those domains publish enforcing DMARC, so
  they most likely were.
