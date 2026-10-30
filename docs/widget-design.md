# "Today's inbox" widget design (AVE-138)

This is a design sign-off for the home-screen widget on iOS and Android. **iOS is built (AVE-149):** the `InboxiesWidget` WidgetKit extension draws the round 2 "Depth" views from `InboxWidgetDepth.swift` (`InboxWidgetDepthContent`), the app writes snapshots through `InboxWidgetStore` (`Inboxies/WidgetShared/`), and the App Group is `group.co.inboxies.app`. Android is AVE-150. The mocks are plain views inside the existing app targets. There is no WidgetKit extension, no App Group and no Glance yet. They use sample data and don't touch the network.

| | iOS | Android |
| --- | --- | --- |
| Mock views, round 1 "Calm" | `ios/AgenticInbox/Inboxies/Views/WidgetDesign/InboxWidgetMock.swift` (`#Preview` per state) | `android/app/src/main/java/co/inboxies/app/ui/widget/InboxWidgetMock.kt` (`@Preview` per state × light/dark) |
| Mock views, round 2 "Depth" | `InboxWidgetDepth.swift` | `InboxWidgetDepth.kt` |
| Data model + samples | `InboxWidgetSnapshot.swift` | `InboxWidgetSnapshot.kt` |
| DEBUG gallery | `InboxWidgetGallery.swift`, launch arg `-previewWidgets` (add `-app_theme Dark` / `Light`) | `InboxWidgetGallery.kt`, `./scripts/run-debug-preview.sh widgets` (the Light/Dark pill flips the screen) |
| Tokens | `AppTheme.Widget` + `AppTheme.Widget.Depth` (extends `AppTheme`) | `InboxWidgetMetrics` + `InboxWidgetDepthMetrics` (next to `InboxiesColors` / `HomeChromeMetrics`) |

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

**Tapping.** In round 1, the whole small widget opens the Inbox. In the medium size each row opens its own thread and the rest of the widget opens the Inbox. Round 2 adds one interactive control, the deck's › button (see Depth). Large and lock-screen widgets come later.

## Round 2: Depth

Round 2 keeps everything above (grey-scale, ink bloom, Inter, glass pieces) and adds depth people can touch. The gallery shows Depth first, a preview-only tilt inspector, then round 1 ("Calm") for comparison.

- **A deck of New mail.** The New-mail state shows the newest threads as a stack of cards. The front card has the avatar, sender, time (medium only) and a two-line subject. Two cards peek out behind it. Each one is 6% smaller, anchored at its top edge, sits 7pt/dp higher, and gets a little darker (black at 4.5% per layer in light mode, 16% in dark). Every card has a soft black shadow and a white top-lip highlight that fades down the sides, so it looks like it has thickness. In dark mode the front card is lifted with 5% `ink`, because raised surfaces look lighter in the dark. Everything stays grey-scale.
- **Tap › to flip.** An `ink` disc with a `surface` chevron sits at the bottom trailing corner of the front card. Tapping it deals the front card off to the trailing side with a 7° turn as it fades out. The cards behind move forward, and the deck wraps around after the last thread. Dots on the card (the current one is a wider `ink` capsule) show which thread you're on, out of up to five. Tapping the card itself opens that thread, and tapping anywhere else opens the Inbox, as before.
- **The count rolls.** On iOS the New count uses `contentTransition(.numericText(value:))`, so when a new timeline entry changes it, the digits roll instead of jumping.
- **Inbox zero floats.** The check disc sits 8pt/dp above a soft elliptical ground shadow, so it looks like it's hovering. It's a still image, not an animation.
- **Small layout.** The header shows "Inbox ●" with "7 new" on the right, and the deck fills the rest of the widget. The avatar stack and the Reply later pill only appear in round 1's small widget. **Medium layout:** the left column is unchanged (count, "New", Reply later pill), and the deck replaces the thread panel.
- **Data.** The snapshot now stores up to **5** threads (`InboxWidgetSnapshot.maxThreads` / `MAX_THREADS`). The medium list in round 1 still shows 3. The widget also stores which thread is on top (`frontIndex`, per widget instance). The app resets it to 0 whenever the snapshot changes.

### What the platform allows

Home-screen widgets are static snapshots that the system renders from a timeline (iOS) or from RemoteViews (Android). They can't run code while you look at them. The table below shows what each effect needs and whether the platform can do it.

| Effect | iOS WidgetKit (17+, 26) | Android Glance / RemoteViews | Used here |
| --- | --- | --- | --- |
| Layered cards, shading, soft shadows, gradients | Yes. Static SwiftUI rendering (`shadow`, `RadialGradient`, `blur` all render) | Partly. No shadows or blur, so the back cards and their shadows are one **pre-rendered bitmap** (`ImageProvider`) behind a real front `Box` with `cornerRadius` (API 31+) | Deck, floating check |
| Tap a button to change what's shown | Yes. `Button(intent:)` / `Toggle(intent:)` with an `AppIntent` (iOS 17+), which writes `frontIndex` to the App Group and reloads the timeline | Yes. `actionRunCallback<ShowNextThreadAction>()`, which updates the Glance state and calls `update()` | › flips the deck |
| Animated change between two states | Yes. Short system-run transitions between timeline entries: `.transition`, view identity (`id`), `contentTransition(.numericText)`, about 2s max | **No.** RemoteViews swaps instantly. The deck jumps to the next card (the in-app spring is preview only) | Deal/advance, count roll (iOS) |
| Pending state while an intent runs | Yes. `invalidatableContent()` dims the card until the new entry lands | No equivalent. The update is fast because it's local state | Front card |
| Theme-aware rendering | Yes. `widgetRenderingMode` (full color / accented / vibrant). On iOS 26, tinted and clear glass home screens: mark the count, the check and the › disc `widgetAccentable()`, and the user's tint replaces ink | Yes. Light/dark via `GlanceTheme` or resources. Android 12+ dynamic color exists, but we stay grey-scale | Default grey-scale; follows the system tint |
| Surfacing at the right time | Yes. Smart Stack relevance (`TimelineEntryRelevance`, iOS 26 `WidgetRelevance`) when New grows | No equivalent | Raise relevance when `newCount` increases |
| Continuous animation (bobbing, shimmer, looping) | **No** | **No** | Not used |
| Drag, swipe, long-press-to-peek inside the widget | **No.** Only taps on buttons, toggles and links | **No.** Only clicks (plus list scrolling in collection widgets) | Not used |
| Tilt/parallax from the gyroscope, 3D rotation on touch | **No.** No motion data, no gestures, no live rendering. (The visionOS-only `levelOfDetail`/`widgetTexture` APIs don't apply to iPhone) | **No** | **Preview-only inspector**, clearly labelled |
| Real-time count without the app | No. Updates come from the app (`WidgetCenter.reloadTimelines`) or a push-driven reload | No. Updates come from the app (`updateAll`) or a WorkManager job | Snapshot write on refresh |

The **depth inspector** in the gallery lets you drag the medium widget to tilt it in 3D and spread its layers apart, so the depth recipe can be reviewed. It is labelled "Preview only · Not possible in a home-screen widget" on both platforms, and nothing in the widget build depends on it. The same tilt could someday be used inside the app (for example, an inbox-zero moment), but not on the home screen.

### Effect → API mapping

| Effect | iOS | Android |
| --- | --- | --- |
| Deck poses | `InboxWidgetDeckPose.forSlot` → `scaleEffect(anchor: .top)`, `offset`, `rotationEffect`, `opacity`, `zIndex`, with all stored threads drawn and keyed by `thread.id` | Same math in `InboxWidgetDeckPose.forSlot`. In Glance, only the front card is a live `Box`; the back cards are the bitmap background |
| › button | `Button(intent: ShowNextThreadIntent(mailboxId:))` | `actionRunCallback<ShowNextThreadAction>(actionParametersOf(mailboxKey to id))` |
| Flip motion | WidgetKit animates the pose change between entries because view identity is stable | None (instant swap) |
| Count roll | `contentTransition(.numericText(value:))` | None |
| Ground shadow / lip highlight / shade | `Ellipse().blur`, `strokeBorder(LinearGradient)`, black overlays | Drawn into the background bitmap at the widget's size |
| Tinted / clear (iOS 26) | `widgetAccentable()` on the count, check and ›; `containerBackground(for: .widget)` for the bloom so the system can remove it in clear mode | n/a |

## Data the app must provide

Both platforms use the same snapshot, written by the app whenever the Inbox for the widget's mailbox refreshes (foreground load, SSE/push refresh, after a read or archive), and once more when the app moves to the background:

```
mailboxId, mailboxAddress
newCount          // the Inbox "New" count, same rule as the New section
replyLaterCount
threads[≤5]       // newest New: id, senderName, subject, receivedAt
frontIndex        // deck position, per widget instance; reset to 0 on a new snapshot
updatedAt
```

The mailbox comes from the widget's configuration and defaults to the last active mailbox (AVE-90).

- **iOS:** add an App Group (`group.co.inboxies.app`) to the app and to a new `InboxiesWidget` extension. The app writes `InboxWidgetSnapshot` as JSON into the group container, one file per mailbox, then calls `WidgetCenter.shared.reloadTimelines(ofKind:)`. The extension's `TimelineProvider` reads that file. It never touches the network or the session token. Mailbox selection uses an `AppIntentConfiguration` with a `MailboxEntity` query over the mailbox list stored in the group.
- **Android:** a Glance `GlanceAppWidget` with `PreferencesGlanceStateDefinition` (or a small custom JSON state). The app updates it from `AppModel` refreshes via `updateAll` or `update(glanceId)`. Mailbox selection lives in a configuration activity, registered as `android:configure` and made reconfigurable.
- **Deep links:** a row opens `inboxies://thread?mailbox=<id>&thread=<threadId>`, and the background opens `inboxies://inbox?mailbox=<id>`. On iOS that's `widgetURL` / `Link`; on Android it's `actionStartActivity` with the same intent extras the push-notification open path already handles. Both clients route these to the same place a notification tap goes today.
- **Privacy:** sender names and subjects show on the home screen. iOS should mark them with `.privacySensitive()` so they redact on a locked device. Android shows them as is, as Gmail does. Only the top 5 threads are stored, and the snapshot is cleared on sign-out.

## Porting notes

- **iOS:** the mocks drop into the extension as the entry view. `RadialGradient` works in WidgetKit. Liquid Glass (`glassEffect`) and materials don't render live in widgets, so in the extension the glass pieces fall back to the same translucent fill + hairline Android uses. On iOS 26 the system's tinted and clear modes should be honored, with `widgetAccentable()` on the count and the check (the system tint is the user's choice, not ours; the default rendering stays grey-scale). The background goes in `containerBackground(for: .widget)`.
- **Android:** Glance has no radial gradients or blur. Render the ink bloom as a bitmap at the widget's size (or as a pair of `GradientDrawable` layers) and set it as `ImageProvider` background. Use the `res/font` Inter for text (Glance `FontFamily` supports custom fonts from API 31+, and minSdk is 34). Avatars are `Box` + `cornerRadius` + `Text`.
- Keep `AppTheme.Widget` and `InboxWidgetMetrics` as the single source for sizes and the bloom recipe. They need to move into shared code: the iOS extension needs `AppTheme` (via `Inboxies/Shared` or target membership), and the Android Glance receiver lives in the same module.

## Proposed build sub-issues

1. **iOS: "Today's inbox" widget (small + medium).** Add the App Group and an `InboxiesWidget` WidgetKit extension in `project.yml`. Write the snapshot from `AppModel`, add the `AppIntent` mailbox picker defaulting to the last active mailbox, add deep-link routing for thread and inbox, add `privacySensitive` and the tinted/clear rendering modes, and clear the snapshot on sign-out. Reuse `InboxWidgetMock` as the entry view.
2. **Android: "Today's inbox" widget (2×2 + 4×2).** Add the Glance dependency, `GlanceAppWidget` + receiver + `appwidget-provider` XML (responsive sizes, preview layout or `previewImage`), a state written from `AppModel` refreshes, a configuration activity for the mailbox defaulting to the last active one, the bitmap ink-bloom background, deep-link intents through the push-open path, and clearing the state on sign-out. Port `InboxWidgetMock` layouts to Glance.
