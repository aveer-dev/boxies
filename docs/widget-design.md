# "Today's inbox" widget design (AVE-138)

This is a design sign-off for the home-screen widget on iOS and Android. The mocks are plain views inside the existing app targets. There is no WidgetKit extension, no App Group and no Glance yet. They use sample data and don't touch the network.

| | iOS | Android |
| --- | --- | --- |
| Mock views | `ios/AgenticInbox/Inboxies/Views/WidgetDesign/InboxWidgetMock.swift` (`#Preview` per state) | `android/app/src/main/java/co/inboxies/app/ui/widget/InboxWidgetMock.kt` (`@Preview` per state × light/dark) |
| Data model + samples | `InboxWidgetSnapshot.swift` | `InboxWidgetSnapshot.kt` |
| DEBUG gallery | `InboxWidgetGallery.swift`, launch arg `-previewWidgets` (add `-app_theme Dark` / `Light`) | `InboxWidgetGallery.kt`, `./scripts/run-debug-preview.sh widgets` (the Light/Dark pill flips the screen) |
| Tokens | `AppTheme.Widget` (extends `AppTheme`) | `InboxWidgetMetrics` (next to `InboxiesColors` / `HomeChromeMetrics`) |

## The idea

The widget is a calm summary of today's inbox that deepens when something arrives.

- **Grey-scale only.** Every colour comes from the existing platform palette: `surface`, `ink`, `muted`, `line`, `pillFill`, `unread` (iOS `AppTheme`, Android `InboxiesColors`), plus the white sheen/hairline and black shadow the glass chrome already uses. The widget never uses `accent` and adds no new hues. This matches the direction of moving "attention" states to ink.
- **Ink bloom.** The widget's base is the `surface` color with a soft radial wash of `ink`. The dense spot sits in the top trailing corner, with a dimmer echo in the bottom leading corner. A faint white sheen at the top gives the glass something to catch. In light mode `ink` is near-black, so the bloom reads as a soft graphite shade on white; in dark mode `ink` is near-white, so the same recipe reads as a pale moonlit glow on the dark surface.
- **The bloom carries the state.** Its strength grows with the New count and stops growing at 5 (`glowStrength(newCount:dark:)`). Even one New conversation looks clearly deeper than inbox zero. At inbox zero the bloom fades almost to nothing (`glowCalm` 0.03). Peak `ink` opacity is 0.15 in light and 0.17 in dark. The big Inter count and the glass pieces do the rest of the "catchy" work; the tone stays monochrome.
- **Type.** All text is Inter. The New count is a large bold numeral (46pt/sp, tracking −1.5). Senders are SemiBold 12 and subjects and meta text use the `muted` color, as in mail rows.
- **Glass.** iOS uses `liquidGlass(in:)` for the Reply later pill, the thread panel and the inbox-zero check. Android uses a frosted fill instead: translucent `surface` plus a white hairline, with no blur and no shadow, because RemoteViews can't draw either.
- **Avatars.** Initials come from the shared `AvatarInitials` helper. Each avatar is a grey disc (`ink` at 14% over `surface`, a little lighter for each sender down the stack) with `ink` initials and a `surface` ring so the overlaps stay clean. In the stack the first sender sits on top, and a `pillFill` "+N" disc follows the avatars.
- **Header.** A tray glyph in `ink`, "Inbox", and the `unread` dot when there's something New (the same dot as unread mail rows).
- **Inbox zero.** A glass disc with an `ink` check and a soft `ink` halo, the words "Inbox zero" and one short line of copy. The line changes daily, picked by day of the year, and both platforms use the same four lines in the same order:
  1. Nothing new. Enjoy the quiet.
  2. All caught up. Go make something.
  3. Clear skies in your inbox.
  4. That's everything. Nice work.

## States × sizes

| | Small: iOS 170×170pt / Android 2×2 (176×176dp) | Medium: iOS 364×170pt / Android 4×2 (368×176dp) |
| --- | --- | --- |
| **New mail** | "Inbox ●" header, the New count, "New conversations", an avatar stack (top 3 senders + "+N"), a compact Reply later pill (clock + count) | Left column (108): header, count, "New", "N Reply later" pill. Right: a glass panel with the top 3 New threads (avatar · sender · time / subject), hairline separators |
| **Inbox zero** | Header without the live dot, the check disc, "Inbox zero", the daily line | Large check disc on the left. Right: header, "Inbox zero" (22 bold), the daily line, and the Reply later pill when the count is above 0 |

Corner radius is 22pt on iOS, close to the system mask that clips the real widget. On Android it's 24dp, mapped to `@android:dimen/system_app_widget_background_radius` in the build. Padding is 16 on both. The Android dp sizes are typical for a 4-column Pixel launcher. The Glance build should use `SizeMode.Responsive` with these two breakpoints.

**Tapping.** In the small size the whole widget opens the Inbox. In the medium size each row opens its own thread and the rest of the widget opens the Inbox. There are no interactive buttons in v1. Large and lock-screen widgets come later.

## Data the app must provide

Both platforms use the same snapshot, written by the app whenever the Inbox for the widget's mailbox refreshes (foreground load, SSE/push refresh, after a read or archive), and once more when the app moves to the background:

```
mailboxId, mailboxAddress
newCount          // the Inbox "New" count, same rule as the New section
replyLaterCount
threads[≤3]       // newest New: id, senderName, subject, receivedAt
updatedAt
```

The mailbox comes from the widget's configuration and defaults to the last active mailbox (AVE-90).

- **iOS:** add an App Group (`group.co.inboxies.app`) to the app and to a new `InboxiesWidget` extension. The app writes `InboxWidgetSnapshot` as JSON into the group container, one file per mailbox, then calls `WidgetCenter.shared.reloadTimelines(ofKind:)`. The extension's `TimelineProvider` reads that file. It never touches the network or the session token. Mailbox selection uses an `AppIntentConfiguration` with a `MailboxEntity` query over the mailbox list stored in the group.
- **Android:** a Glance `GlanceAppWidget` with `PreferencesGlanceStateDefinition` (or a small custom JSON state). The app updates it from `AppModel` refreshes via `updateAll` or `update(glanceId)`. Mailbox selection lives in a configuration activity, registered as `android:configure` and made reconfigurable.
- **Deep links:** a row opens `inboxies://thread?mailbox=<id>&thread=<threadId>`, and the background opens `inboxies://inbox?mailbox=<id>`. On iOS that's `widgetURL` / `Link`; on Android it's `actionStartActivity` with the same intent extras the push-notification open path already handles. Both clients route these to the same place a notification tap goes today.
- **Privacy:** sender names and subjects show on the home screen. iOS should mark them with `.privacySensitive()` so they redact on a locked device. Android shows them as is, as Gmail does. Only the top 3 threads are stored, and the snapshot is cleared on sign-out.

## Porting notes

- **iOS:** the mocks drop into the extension as the entry view. `RadialGradient` works in WidgetKit. Liquid Glass (`glassEffect`) and materials don't render live in widgets, so in the extension the glass pieces fall back to the same translucent fill + hairline Android uses. On iOS 26 the system's tinted and clear modes should be honored, with `widgetAccentable()` on the count and the check (the system tint is the user's choice, not ours; the default rendering stays grey-scale). The background goes in `containerBackground(for: .widget)`.
- **Android:** Glance has no radial gradients or blur. Render the ink bloom as a bitmap at the widget's size (or as a pair of `GradientDrawable` layers) and set it as `ImageProvider` background. Use the `res/font` Inter for text (Glance `FontFamily` supports custom fonts from API 31+, and minSdk is 34). Avatars are `Box` + `cornerRadius` + `Text`.
- Keep `AppTheme.Widget` and `InboxWidgetMetrics` as the single source for sizes and the bloom recipe. They need to move into shared code: the iOS extension needs `AppTheme` (via `Inboxies/Shared` or target membership), and the Android Glance receiver lives in the same module.

## Proposed build sub-issues

1. **iOS: "Today's inbox" widget (small + medium).** Add the App Group and an `InboxiesWidget` WidgetKit extension in `project.yml`. Write the snapshot from `AppModel`, add the `AppIntent` mailbox picker defaulting to the last active mailbox, add deep-link routing for thread and inbox, add `privacySensitive` and the tinted/clear rendering modes, and clear the snapshot on sign-out. Reuse `InboxWidgetMock` as the entry view.
2. **Android: "Today's inbox" widget (2×2 + 4×2).** Add the Glance dependency, `GlanceAppWidget` + receiver + `appwidget-provider` XML (responsive sizes, preview layout or `previewImage`), a state written from `AppModel` refreshes, a configuration activity for the mailbox defaulting to the last active one, the bitmap ink-bloom background, deep-link intents through the push-open path, and clearing the state on sign-out. Port `InboxWidgetMock` layouts to Glance.
