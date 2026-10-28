# Watch companion app: plan (AVE-137)

Emmanuel's ask: users should be able to take **real actions** from the watch, on Apple Watch and on Wear OS.

This is a planning doc. It changes no code. File paths and endpoints are as of `dev` in late October 2026.

## Recommendation in one paragraph

Ship in three phases. **Phase 1 is actionable notifications on the phone apps.** iOS mirrors notifications to Apple Watch, and Android bridges them to Wear OS, so actions added on the phone (Archive, Mark read, Reply, Reply Later, Spam) appear on the watch without any watch app. The phone runs the action with the session it already has. That gets most of the value, needs no new credentials, and fits in one small PR per platform plus a small Worker change. **Phase 2 adds a real watch app on each platform:** a short Inbox list, a message view and the same actions, talking to the Worker directly with a new scoped **`watch` session**. It follows the AutoFill pattern, where the phone mints the session and hands it over. **Phase 3 adds complications, Smart Stack and Tiles.** The watch stays a companion, not a standalone client. Signing in on the watch, composing new mail, attachments, settings and admin stay on the phone.

## Goals and non-goals

**Goals**

- Triage from the wrist: archive, mark read or unread, Reply Later, report spam, and short replies (dictation or canned replies).
- Glanceable state: unread count for the Inbox, and the newest few messages.
- Both platforms ship the same features, as design twins, like the phone apps.
- No weaker security than today. The watch never holds the phone's full session.

**Non-goals (v1)**

- Signing in on the watch, or a watch with no phone (LTE-only setup). The watch needs a paired phone that is signed in. It can still work alone on Wi-Fi or LTE later in phase 2.
- Composing new messages, forwarding, attachments, rich HTML rendering, search, folders other than Inbox (plus Reply Later as a list), agent chat, notes, settings, admin and billing.
- Offline queues longer than a short retry. A failed action shows an error. It isn't kept for later.

## What exists today (grounding)

| Area | Where | Notes |
| --- | --- | --- |
| iOS push registration and tap handling | `ios/AgenticInbox/Inboxies/Services/PushNotificationManager.swift`, `AppDelegate.swift` | No `UNNotificationCategory` or actions are registered anywhere. A tap deep-links to the message. |
| Android push | `android/app/src/main/java/co/inboxies/app/services/InboxiesFirebaseMessagingService.kt` | Data-only FCM. The app builds the `NotificationCompat` itself, with no `addAction` and no `RemoteInput`. |
| APNs payload | `workers/lib/apns.ts` (`aps.alert`, `content-available`, plus `mailboxId`, `emailId`, `folderId`) | No `category`, no `thread-id`, no collapse ID. Badge is never set (see `docs/audits/push-notifications-2026-10.md`). |
| FCM payload | `workers/lib/fcm.ts` | Data has `emailId` and `folderId`. |
| Scoped sessions | `POST /api/v1/me/extension-session` in `workers/routes/account.ts`. Allowlist in `workers/lib/auth-paths.ts` (`isPathAllowedForTokenScope`). Scope type in `workers/auth/principal.ts` (`SessionScope = "aliases"`). | AutoFill and the browser extension get an `aliases`-scoped, 30-day session. It's listed and revocable under Devices & sessions. |
| iOS session sharing | `ios/AgenticInbox/Inboxies/Shared/SharedSession.swift`, `Services/AutofillSession.swift` | The app mints the extension's scoped token and writes it to the shared keychain group `<TeamID>.co.inboxies.shared` (`kSecAttrAccessibleAfterFirstUnlock`). It rotates the token within 7 days of expiry and revokes it on sign-out. The full session stays in the app's own group. |
| Android session | `android/app/src/main/java/co/inboxies/app/services/AuthStore.kt` | `EncryptedSharedPreferences`. |
| Theme tokens | iOS `ios/AgenticInbox/Inboxies/Theme/AppTheme.swift`. Android `android/app/src/main/java/co/inboxies/app/theme/AppTheme.kt` (`InboxiesColors`) and `theme/HomeChrome.kt` (`HomeChromeMetrics`). | Extend these. Don't fork them. |
| Build layout | iOS: XcodeGen `ios/AgenticInbox/project.yml` (targets `Inboxies`, `InboxiesCredentialProvider`, `InboxiesTests`; iOS 17). Android: `android/settings.gradle.kts` (only `:app`; `minSdk = 34`). | |

## Real actions and how they map to the Worker

Every action below already exists as an endpoint, except snooze with a time.

| Action | Endpoint (all exist in `workers/index.ts` unless noted) | Body | Watch notes |
| --- | --- | --- | --- |
| Mark read / unread | `PUT /api/v1/mailboxes/:mailboxId/emails/:id` | `{ "read": true }` / `{ "read": false }` | Thread-level read is `POST /api/v1/mailboxes/:mailboxId/threads/:threadId/read`. The push payload has no `threadId` yet. |
| Archive | `POST /api/v1/mailboxes/:mailboxId/emails/:id/move` | `{ "folderId": "archive" }` (`Folders.ARCHIVE` in `shared/folders.ts`) | |
| Report spam | `POST /api/v1/mailboxes/:mailboxId/emails/:id/move` | `{ "folderId": "spam", "setSenderPreference": true }` | This also re-files the sender's other mail (AVE-98). On the watch, ask for confirmation first. Undo stays on the phone (`/sender-rules/undo`). |
| Reply Later (flag) | `PUT /api/v1/mailboxes/:mailboxId/emails/:id` | `{ "reply_later": true }` | The list is `GET .../emails?reply_later=true`. |
| Star | same `PUT` | `{ "starred": true }` | Optional. Leave it out of the notification and put it in the watch app. |
| Reply (dictation / canned) | `POST /api/v1/mailboxes/:mailboxId/emails/:id/reply` (`workers/routes/reply-forward.ts`) | `SendEmailRequestSchema` needs `to`, `from`, `subject`, and `text` or `html`. Send an `Idempotency-Key` header. | The client has to fetch the original email first to fill `to`, `from` and `subject`. Plain `text` is accepted. Use a UUID per reply attempt as the `Idempotency-Key` so a watch retry can't send twice. |
| Trash | `DELETE /api/v1/mailboxes/:mailboxId/emails/:id` | | Not in v1. It's destructive and too easy to hit by accident on a small screen. |
| Snooze until a time | **missing** | | `reply_later` is a flag with `reply_later_at` (when it was set). Nothing brings a message back at a chosen time. Leave it out of v1. Track it as its own issue if wanted. |

### Server-side work needed

1. **APNs `category` and `thread-id`** (phase 1, S). In `workers/lib/apns.ts`, set `aps.category = "INBOXIES_MAIL"` and `aps["thread-id"]` to the thread ID, so iOS shows the actions and groups by conversation. Also send `threadId` in the custom payload and in the FCM data (`workers/lib/fcm.ts`).
2. **Server-composed reply** (phase 1, S, optional but recommended). Add `POST /api/v1/mailboxes/:mailboxId/emails/:id/quick-reply { text }`. The Worker fills `to`, `from` (thread alias) and `Re:` subject from the original, the same way `handleReplyEmail` already resolves the alias. Then a notification action handler or a watch doesn't need a second round trip. Keep the `Idempotency-Key` support.
3. **`watch` session scope** (phase 2, M). Extend `SessionScope` with `"watch"`. Add an allowlist branch in `isPathAllowedForTokenScope` that covers only: `GET /api/v1/me`, `GET /api/v1/mailboxes`, `GET .../emails` (list), `GET .../emails/:id`, `PUT .../emails/:id`, `POST .../emails/:id/move` (only when `folderId` is `archive`, `inbox` or `spam`), `POST .../emails/:id/reply` or `quick-reply`, `POST .../threads/:threadId/read`, `GET .../folders` (unread counts), and `POST /api/v1/auth/logout`. No agents, MCP, admin, billing, export, aliases, members or device tokens. Mint it from `POST /api/v1/me/extension-session` with `client: "watchos"` / `"wearos"`, labeled "Apple Watch" / "Wear OS watch".
4. **Unread count** (phase 3, none expected). The complication or tile needs a count. `GET /api/v1/mailboxes/:mailboxId/folders` already returns `unreadCount` per folder, so allow it in the `watch` scope. Add a dedicated endpoint only if that call is too heavy for a complication refresh.

## Auth (security decision for Emmanuel)

> **Needs review.** This sets what a lost or stolen watch can do.

**Phase 1 needs no new credentials.** On iOS, a notification action runs in the iPhone app, which launches in the background with the full session from the app keychain group. That group is `AfterFirstUnlock`, so it can be read after the first unlock even when the phone is locked. On Android, the action `PendingIntent` goes to a `BroadcastReceiver` or worker in the phone app, which uses `AuthStore`. Wear OS sends bridged actions back to the phone, so the watch never sees a token.

Decision for phase 1: should destructive-ish actions (Spam, Reply) need an unlocked phone? On iOS that's `UNNotificationActionOptions.authenticationRequired`. The watch's wrist detection already gates its own UI. **Recommended default:** Archive, Mark read and Reply Later run without unlocking. Reply and Spam use `.authenticationRequired` on iOS, which on a watch means the watch has to be unlocked, not the phone. On Android, rely on Wear OS's own lock.

**Phase 2 (watch app): a separate scoped session. Never the phone's full session.**

- **iOS.** The iPhone app mints a `watch`-scoped session (same lifecycle as `AutofillSession`: 30-day expiry, rotate within 7 days, revoke on sign-out). It sends the session to the watch over **WatchConnectivity** (`WCSession.transferUserInfo`, and `updateApplicationContext` for the latest token). The watch stores it in the **watch's own keychain**. A shared keychain access group doesn't cross from phone to watch. Each device has its own keychain, so the handoff has to go over WatchConnectivity.
- **Android.** The phone app mints the session and sends it over the **Wear Data Layer**: a `MessageClient` request/response started by the watch, not a `DataItem`, because DataItems persist and sync. The watch stores it in `EncryptedSharedPreferences` (Keystore-backed), the same as `AuthStore`. The Data Layer only talks to paired nodes running an app with the same package name and signing key.
- **Refresh.** The watch can't refresh itself. When it gets a 401, it asks the phone for a new token (WatchConnectivity message / Data Layer message). If the phone can't be reached, the watch shows "Open Inboxies on your phone".
- **Sign-out propagation.** When the phone signs out, it revokes the watch session on the server (through `DELETE /api/v1/me/sessions/:id`, as it does for AutoFill) and sends a "clear" message. The watch also wipes itself on any 401 from a revoked session. Revoking "Apple Watch" or "Wear OS watch" in Devices & sessions on any device has the same effect.
- **Push to the watch app.** Notifications stay mirrored and bridged from the phone in phase 2. That avoids registering watch device tokens, and the `watch` scope never needs `/device-token`.

## Push and actionable notifications (phase 1)

**iOS** (`PushNotificationManager.swift`, `AppDelegate.swift`)

- Register one `UNNotificationCategory` `INBOXIES_MAIL` with these actions: `ARCHIVE`, `MARK_READ`, `REPLY_LATER`, `REPLY` (`UNTextInputNotificationAction`; the watch offers dictation, Scribble and quick replies) and `SPAM` (`.destructive`, `.authenticationRequired`).
- In `userNotificationCenter(_:didReceive:withCompletionHandler:)`, branch on `actionIdentifier`, call the endpoint, and call the completion handler when the call finishes. For Reply, use `quick-reply` if it ships. If not, call `getEmail` and then `reply`.
- Optional: a `UNNotificationContentExtension` long look that shows the preview in Inboxies type. Skip it in phase 1. Mirrored notifications already show sender, subject and preview.
- Apple Watch shows the mirrored notification and its actions when the iPhone is locked and the watch is on the wrist.

**Android** (`InboxiesFirebaseMessagingService.kt`)

- Add `NotificationCompat.Action`s (Archive, Mark read, Reply Later, Reply with `RemoteInput` and `setChoices(...)` canned replies, and Spam behind a confirm step). Each one is a `PendingIntent` to a new `NotificationActionReceiver`, which uses `goAsync()` or hands off to WorkManager to call `ApiClient`.
- Add `NotificationCompat.WearableExtender` to order the actions and mark Reply as the content action. Bridging to Wear OS happens automatically.
- After a successful action, cancel the notification on both platforms. Pushes for the same thread should replace each other (iOS `thread-id` groups them; Android uses the thread ID as a notification tag).

**Canned replies (both):** "Thanks!", "Got it, will reply soon", "Can we talk later?", "👍". They're hard-coded for v1 and could be editable in Settings later.

## Phase 2 watch app surfaces

| | watchOS (SwiftUI, watchOS 10+) | Wear OS (Compose for Wear OS, Wear OS 4+) |
| --- | --- | --- |
| Inbox | `NavigationStack` + `List` of the newest 20 Inbox messages for the active mailbox. Flat rows: sender, subject, unread dot. | `ScalingLazyColumn` with the same rows. Swipe-to-dismiss navigation (see Questions about `SwipeDismissableNavHost`). |
| Message | Plain-text body (server `text`, or HTML stripped to text), trimmed to about 2 KB. Action buttons at the bottom. | Same. |
| Actions | Same set as the notifications. Reply uses `TextFieldLink` (dictation/Scribble) or a canned list. | `RemoteInput` intent for voice/keyboard, or a canned `Chip` list. |
| Mailbox switch | Only if the user has more than one mailbox. A simple picker. | Same. |
| Data path | **Direct to the Worker** with the `watch` token (URLSession works over the phone's link, Wi-Fi or LTE). WatchConnectivity is only for the token and the active mailbox / API origin (from `SharedSession.publish`). | **Direct to the Worker** with the `watch` token (OkHttp over the phone's proxy, Wi-Fi or LTE). Data Layer is only for the token and the active mailbox. |
| Phase 3 glance | WidgetKit complication + Smart Stack widget: Inbox unread count, and the newest sender. Refresh on push (the phone app calls `WidgetCenter.reloadTimelines` through `transferCurrentComplicationUserInfo`) and on a timeline budget. | Tile (`androidx.wear.tiles`) for the unread count and the top 3 senders. `ComplicationDataSourceService` for the count. |

Why go direct instead of relaying through the phone: it works when the phone is out of range on Wi-Fi or LTE, and the phone app doesn't have to stay alive as a proxy. A relay would keep the token off the watch completely, but every action would depend on the phone app waking up. The scoped token limits the risk instead.

## Design

- The same Inboxies look on both watches: Inter (bundled; SF is the fallback only where Inter can't render), the calm blue accent from `AppTheme`, and a near-black background (watch screens are OLED and dark-only). Use flat rows with no cards, and a hairline divider or spacing instead of tiles.
- Use the phone's tokens. Extend `AppTheme` / `InboxiesColors` with a small watch palette in a shared source set or file. Don't define new colors.
- Accent only for unread dots and the primary action. Spam is red text, not a red fill.
- Motion: use the system defaults on watch (Digital Crown scrolling, Wear `SwipeToDismiss`). Where we add our own, use the house spring (iOS `.spring(response: 0.32, dampingFraction: 0.86)`, Android `dampingRatio = 0.86f`, `StiffnessMediumLow`).
- Not Apple Mail and not Material You. Don't use the Wear Material 3 dynamic color.
- Load `inboxies-ios-ui` / `inboxies-android-ui` before building. Add a short watch section to each skill as part of phase 2.

## Repo and build changes

- **iOS (phase 2):** add a `InboxiesWatch` target (`type: application`, `platform: watchOS`, `deploymentTarget: "10.0"`) to `ios/AgenticInbox/project.yml`, embedded in `Inboxies`. Bundle ID `co.inboxies.app.watchkitapp`. Phase 3 adds a `InboxiesWatchWidgets` WidgetKit extension. Share models, the thin API client and theme tokens through a `Shared` folder compiled into both targets, as `SharedSession.swift` already is. Don't move the whole `APIClient.swift`; the watch needs about 8 calls.
- **Android (phase 2):** add a `:wear` module to `android/settings.gradle.kts` with the same `applicationId` (`co.inboxies.app`, which Data Layer requires) and the same signing config. Move `InboxiesColors` and the API models the watch needs into a small `:shared` module only if duplication gets painful. Copying about 5 data classes is fine for v1.
- **Worker:** the changes in "Server-side work needed" plus tests next to the existing ones (`workers/test/inbound-push.test.mjs`, `apns-dispatch.test.mjs`, and a new `auth-paths` scope test for `watch`).
- **Distribution:** watchOS ships inside the iOS app on the App Store/TestFlight. Wear OS ships as a separate APK/AAB under the same Play listing (Wear form factor track).

## Testing

- **Phase 1:** Worker unit tests for the APNs `category` and `thread-id` and for `quick-reply` (idempotency and alias choice). On devices, send `POST /api/v1/mailboxes/:id/test-push` to a locked iPhone with a paired Apple Watch (the Simulator can't mirror to a watch), and to an Android phone paired with a Wear OS emulator (Wear OS emulator pairing through the Wear OS app works for bridged notifications). Check each action on the server: the message moves, the read state changes, the reply arrives once.
- **Phase 2:** the watchOS Simulator paired with the iOS Simulator works for WatchConnectivity. Add DEBUG preview launch args in the same style as `PreviewSupport.swift` (`-previewWatchInbox`) and Wear intent extras, so both twins can be screenshotted for review (light/dark isn't relevant on watch; dark only). Worker test: a `watch` token gets 403 on everything outside the allowlist.
- **Security check before shipping phase 2:** revoke from Devices & sessions and confirm the watch wipes. Sign out on the phone and confirm the watch wipes. Confirm no full-session token is ever sent over WatchConnectivity or the Data Layer.

## Phases and proposed sub-issues

| # | Sub-issue | Platform | Size |
| --- | --- | --- | --- |
| 1a | Worker: APNs `category` + `thread-id`, `threadId` in FCM data, optional `quick-reply` endpoint + tests | Worker | S |
| 1b | iOS: `INBOXIES_MAIL` category with Archive / Mark read / Reply Later / Reply / Spam actions | iOS | S |
| 1c | Android: notification actions + `RemoteInput` canned replies + `WearableExtender` | Android | S |
| 2a | Worker: `watch` session scope + allowlist + tests | Worker | M |
| 2b | watchOS app: Inbox, message, actions, WatchConnectivity token handoff | iOS | L |
| 2c | Wear OS app: Inbox, message, actions, Data Layer token handoff | Android | L |
| 3a | Complications / Smart Stack (watchOS) | iOS | M |
| 3b | Tiles + complication (Wear OS) | Android | M |
| — | (Separate, optional) Snooze until a chosen time, on all clients | All | M |

Phase 1 is shippable alone and covers most of the ask. Re-plan phase 2 after watching how much phase 1 actions get used.

## Open questions for Emmanuel (each with a recommended default)

1. **Is phase 1 (actionable mirrored/bridged notifications) enough to close the "real actions" ask first?** Default: yes. Ship 1a to 1c, then decide on 2b/2c.
2. **Which actions run without unlocking?** Default: Archive, Mark read and Reply Later run straight away. Reply and Spam need an unlocked device (iOS `.authenticationRequired`). Trash isn't offered.
3. **Watch app auth: a scoped `watch` session that talks to the Worker directly, or relay everything through the phone?** Default: a scoped `watch` session, direct network, no access to send-as beyond replies, admin, aliases or agents. Revocable in Devices & sessions.
4. **Should the watch reply from the thread's alias the way the phone does?** Default: yes. The server-side `quick-reply` picks the same sender `handleReplyEmail` would.
5. **Snooze with a time.** Default: not in the watch v1. Use the Reply Later flag. File a separate issue if you want timed snooze on every client.
6. **Canned replies.** Default: four fixed replies in v1, editable in Settings later.
7. **Minimum OS versions.** Default: watchOS 10 and Wear OS 4 (API 33). That covers current Apple Watch and Pixel/Galaxy watches and gives modern SwiftUI/Compose for Wear APIs.
8. **Wear navigation.** Wear Compose's `SwipeDismissableNavHost` pulls in `androidx.wear.compose:compose-navigation` (it depends on Navigation). Default: allow it in the `:wear` module only, since swipe-to-dismiss is the platform's back gesture, and keep the phone app's no-`NavHost` rule.
9. **Multiple mailboxes on the watch.** Default: follow the phone's active mailbox and offer a simple picker when there's more than one. Notifications already cover every mailbox.
