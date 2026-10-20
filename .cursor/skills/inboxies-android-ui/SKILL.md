---
name: inboxies-android-ui
description: Inboxies Android Jetpack Compose design and implementation. Use when changing UI, layout, chrome, navigation, theming, lists, sheets, compose, chat, or any visual work under android/. Encodes the Notion-inspired shell as implemented — InboxiesColors, Inter, liquid-glass chrome, state-driven sheets/overlays instead of NavHost. Not Material You. Match iOS visually.
---

# Inboxies Android UI

Canonical visual language for the Compose client. It is a design twin of iOS. Tokens live in Kotlin, not XML color resources (launcher bg excepted). Extend them; do not fork Material You or a second palette.

**Source of truth**

- Palette, Material scheme, Inter, dims: `android/app/src/main/java/co/inboxies/app/theme/AppTheme.kt`
- Chrome metrics + glass modifiers: `android/app/src/main/java/co/inboxies/app/theme/HomeChrome.kt`
- Theme preference: `ThemeMode.kt` (SharedPreferences key `app_theme`)
- Edge-to-edge: `MainActivity.kt` + `SystemBars.kt`

When polishing motion, also load `animate`, `apple-design`, and `emil-design-eng`. Visual changes should land on iOS too unless the task is explicitly Android-only.

## Stack

- Compose-only UI. No Fragments, no `R.layout`.
- Material 3 (`androidx.compose.material3`) for primitives: `ModalBottomSheet`, `Switch`, `DropdownMenu`, `PullToRefreshBox`, `Button`. Visual language is custom Notion/iOS, not default M3.
- **No dynamic / wallpaper color.** Comment in `AppTheme.kt`: “Notion-inspired Inboxies palette — not purple Material You.”
- Navigation Compose is **not a dependency** (removed). Do not introduce `NavHost` / `rememberNavController`.
- `minSdk 34`, `targetSdk/compileSdk 35`. Resizable activity, any orientation; phones plus tablets / foldables (two-pane at ≥ 840.dp, see below).
- HTML mail via `AndroidView` + `WebView` in `EmailBodyView.kt`.
- Icons: Material Icons Extended.
- State: `AppModel` `StateFlow`s via `LocalAppModel` / `LocalAuthStore` / `LocalInboxiesPalette`. Collect with `collectAsState()`.

## Personality

Same as iOS: Notion-inspired shell, Inter, calm blue accent, flat mail rows, pill frosted chrome, floating Ask AI + Compose bar. Primary buttons are often **ink on white** (or white on ink), not heavy tonal M3 buttons.

## Colors

Use `inboxiesColors()` / `InboxiesPalette`. Never new hex.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `background` | `#FAFAFB` | `#0D0D0D` | Screen fill |
| `surface` | `#FFFFFF` | `#1C1C1F` | Cards, fields, dock |
| `ink` | `#1F1F24` | `#FAFAFC` | Primary text / tint |
| `muted` | `#73737A` | `#9999A6` | Secondary text |
| `line` | `#E6E6EB` | `#333338` | Borders / dividers |
| `pillFill` | `#EDEDEF` | `#2E2E33` | Chips, inactive pills |
| `pillActive` | `#DBDBDF` | `#47474D` | Active / skeleton |
| `accent` | `#2659D9` | `#598CFF` | Links, toggles, Undo |
| `unread` | `#38383D` | `#E6E6EB` | Unread dot |
| `deepDarkRed` | `#6B141A` | `#E65959` | Draft / destructive |

Material `ColorScheme` maps primary→accent, background/surface→palette, error→`deepDarkRed`, outline→`line`. Aliases in `PaletteAliases.kt` (`gray900`→ink, `blue`→accent) exist for compatibility — prefer palette names in new code.

## Typography

`InterFontFamily` from `res/font/inter_{regular,medium,semibold,bold,italic}.ttf`.

Material overrides in `InboxiesTheme` (all Inter): displayLarge 34 Bold, headlineLarge 24 Bold, headlineMedium 20 SemiBold, titleLarge 17 SemiBold, titleMedium 15 SemiBold, bodyLarge 15, bodyMedium 13, bodySmall 12 muted, labels 14/12/10 Medium.

**Domain dims (`AppThemeDims`)** — match iOS:

| Namespace | Token | Size |
| --- | --- | --- |
| `FontSize` | `largeTitle` 22.sp, `inlineTitle` 14.sp, sender 13, recipient/meta/body/homeSubtitle 12–13, chevron 8 | |
| Home large title UI | **34.sp Bold** (not the 22.sp token) | |
| `List` | title/sender 15.sp, subject 13, preview 12, date/badge 10, sectionHeader 11, tracking `0.25.sp` | |
| `Chat` | body 13, prompt/input 14, code 12.5, meta/codeMeta 11, tableCell 12, line spacing ratio `0.28` | |

## Spacing and chrome

`AppThemeDims.List` — same numbers as iOS (18/20/6 paddings, 8.dp unread dot, 0.5.dp separators, swipe `actionWidth` **72.dp**).

`HomeChromeMetrics`

| Token | Value |
| --- | --- |
| `actionBarHeight` | 52.dp |
| `chromeHorizontalPadding` | 12.dp |
| `chromeSpacing` | 10.dp |
| `chromeBottomPadding` | 20.dp |
| `chromeCornerRadius` | **50.dp** |
| `minimizedComposeHeight` | 88.dp (taller than iOS 66 because of system bars / dock chrome) |
| `minimizedComposeGap` | 10.dp |
| `mailboxAvatarSize` | 48.dp |
| `bottomBarHorizontalPadding` | 24.dp |
| `selectionBarHeight` | 58.dp |
| `toolbarControlSize` | 48.dp |
| `toolbarControlCornerRadius` | 50.dp |
| `toolbarControlIconSize` | 22.dp |
| `toolbarControlElevation` | 8.dp |
| `menuCornerRadius` | **22.dp** |
| `menuIconSize` | 16.dp |
| `menuItemHorizontalPadding` / `menuDividerInset` | 16.dp |
| `menuMinWidth` | 220.dp |
| `modalScrim` | Black **22%** |

Corner radii: digest cards **18.dp**, compose dock top **18.dp**, settings groups / sign-in **12.dp**, fields/code **10.dp / 8.dp**, blockquote **4.dp**, sheet grabber 36×5.dp radius 50.

## Liquid glass and system bars

`Modifier.liquidGlass(shape)` is the **pre-26 iOS fallback**: frost ~92% surface, white 0.45 hairline, 12.dp shadow — not Android 16+ real blur. Toolbar chips use `homeChromeToolbarSurface`. Menus: `InboxiesMenu` (iOS `Menu` look), not default `DropdownMenu` chrome.

Edge-to-edge is required:

- `enableEdgeToEdge` with transparent status/nav bars
- `TransparentSystemBars()`
- Consume `statusBarsPadding`, `navigationBarsPadding`, `imePadding`
- Contrast enforcement off (API 29+)

## Navigation (not Navigation Component)

`RootView` `AnimatedContent` (`fadeIn` togetherWith `fadeOut`): `sign_in` → `onboarding` → `home`.

| Surface | Mechanism |
| --- | --- |
| Folder tabs | `HomeTab` + horizontal swipe (≥40.dp) |
| Email detail | Stacked: `ModalBottomSheet` (`skipPartiallyExpanded = true`, custom scrim, no drag handle). Two-pane: reading pane (`HomeSplitLayout`) |
| Settings | Same modal sheet; nested pages via horizontal `AnimatedContent` |
| Search | Full-screen replace inside home (`showSearch`) |
| AI chat | Custom full-screen overlay; drag-to-dismiss; list ↔ conversation `AnimatedContent` |
| Compose | Full overlay when expanded; `ComposeDockBar` when minimized |
| Compose actions | Long-press overlay (`ComposeActionListOverlay`) |
| Dialogs | Compose `Dialog` (add mailbox) |
| Back | `BackHandler` for search, select mode, compose actions, chat stack |

Folder order: For you (`HomeTab.AiInbox`) then Inbox → Promotions → Updates → Sent → Drafts → Archive → Spam → Trash.

## Large screens (tablet / foldable)

`ui/home/HomeSplitLayout.kt`, design twin of iOS `HomeSplitLayout` (AVE-71/72). `HomeLayoutMode` comes from window width (`LocalConfiguration.screenWidthDp`), not the device:

- **Stacked** (< `HomeChromeMetrics.twoPaneMinWidth` 840.dp): phone layout, unchanged.
- **TwoPane** (≥ 840.dp): list column (`listColumnWidth` = 38% clamped 320–420.dp) + 0.5.dp `line` hairline + reading pane (`EmailDetailView(showsGrabber = false)` or `ReadingPanePlaceholder`). The email's close (x) and Back clear to the placeholder. The row open in the pane is tinted (`pillFill` @ 60% over `background`) via `LocalReadingPaneEmail`.
- Compose, Ask AI and Settings render through `HomeFormSheet`: full-window on phones, centered card (max 600×880.dp, 18.dp corners, `modalScrim`) in two-pane. Add mailbox is already a centered `Dialog`.
- Selection lives in `AppModel.selectedEmail`, so it survives resizing / fold changes. The manifest handles `screenSize|smallestScreenSize|screenLayout|orientation` itself, so `remember` state isn't lost.
- A future third column (AVE-73) = another `HomeLayoutMode` case + another column in `HomeSplitLayout`.

## Motion already in this app

Default chrome spring: `dampingRatio = 0.86f`, `stiffness = Spring.StiffnessMediumLow` (`selectModeSpring`, `settingsNavSpring`, `chatNavSpring`, `sheetNavSpring`).

| Moment | Spec |
| --- | --- |
| Root auth | `fadeIn` + `fadeOut` |
| Tab change | Short horizontal slide 28/18.dp + fade |
| Select mode / chrome | Spring fade+scale (~0.86), `animateContentSize` |
| Sheets / dock / selection bar | `slideInVertically` + fade |
| Chat / settings push | Full-width horizontal slide + fade |
| Compose long-press | Backdrop alpha spring; highlight `damping 0.82`, stiffness `480` |
| List skeleton | Infinite pulse tween **950ms** reverse, alpha 0.45↔1 |
| Pressed row | Alpha **0.55** |
| Haptics | Long-press confirm; highlight `CLOCK_TICK` |

## Layout conventions

- **Lists:** Flat `LazyColumn` rows (not Material `Card`). Unread **8.dp** dots; hairline separators inset past the dot.
- **Cards:** Digest `TopicCard` only — surface + **0.5.dp** line + **18.dp** corners, not elevated cards.
- **Empty:** Centered muted icon 40.dp + SemiBold 17.sp title + 13.sp muted subtitle. Filtered empty offers “Clear Filters.”
- **Loading:** Skeleton list (~9 pulsing bars) when empty+loading; `CircularProgressIndicator` for chat/body/auth.
- **Pull to refresh:** `PullToRefreshBox` on email list / digest. Pull-to-refresh and tab switches reset paging to page 1; background refreshes (SSE, poll, after actions) keep deeper pages.
- **Infinite scroll:** `AppModel.loadMoreEmails` fires 5 rows before the end (`EmailPaging.PREFETCH_DISTANCE`). While more pages exist the list ends in **one** pulsing skeleton row (same row as the first-load skeleton) — never a "Load more" button. A failed page swaps it for a centred muted "Couldn’t load more" + accent "Retry" line with row padding. Inbox: only page 1 takes part in the New/Seen split; rows from later pages join Seen in date order (even unread), so load-more never inserts above the reader. Matches iOS.
- **Load errors:** `LoadFailedContent` (`ui/components/LoadFailedViews.kt`): muted offline icon, SemiBold 17.sp title, 13.sp muted message (fallback "Check your connection and try again."), ink pill Retry. Mailbox gate: `MailboxLoadFailedView` adds muted "Sign out". Email list: "Couldn’t load emails" + Retry instead of the empty-folder state.
- **Sheets:** Custom grabber (36×5 muted pill); often `dragHandle = null`; scrim `HomeChromeMetrics.modalScrim`.
- **Modals / sheets / dialogs close:** Modal, sheet, and form dialog dismiss/close controls must use an "x" icon (`Icons.Outlined.Close`, `contentDescription = "Close"`, `tint = colors.ink`), never "Cancel" text. Reserve "Cancel" text strictly for confirmation alert dialogs.

Reusable chrome belongs in `theme/` or `ui/components/`. Feature screens under `ui/<feature>/`.

## Screen map

| Screen | Path |
| --- | --- |
| Root / auth | `ui/RootView.kt`, `ui/auth/*` |
| Home / digest | `ui/home/HomeShellView.kt`, `InboxDigestView.kt` |
| Email | `ui/email/*` |
| Compose | `ui/compose/*` |
| Chat | `ui/chat/*` |
| Search | `ui/search/SearchView.kt` |
| Settings | `ui/settings/*` |
| Menu / toast / markdown | `ui/components/*` |
| DEBUG previews | `ui/preview/*` (emulator intent harness) |

## Hard don'ts

- Material You / `dynamicColor` / purple M3 defaults.
- `NavHost` for app IA.
- FAB-centric home chrome (the floating bar is Ask AI + Compose, not a FAB).
- Elevated `Card` for mail rows.
- Hardcoded colors/fonts/radii when `InboxiesColors` / `AppThemeDims` / `HomeChromeMetrics` already has a token.
- Spinner-only first load on lists (use skeletons).
- Dismissing compose instead of minimizing to the dock.
- "Cancel" text buttons to dismiss modals, sheets, or form dialogs (use `Icons.Outlined.Close` icon button instead; text "Cancel" is only for alert dialogs).
- Opaque system bars or ignoring window insets.
- Shipping Android-only visual changes without the iOS twin unless the task is explicitly Android-only.
- Reviewing or shipping UI that was only verified on iOS Simulator — use the Android DEBUG preview harness below for the same surfaces.

## DEBUG preview harness (emulator / adb)

**Required for E2E / visual review.** Matches iOS Simulator launch args (`-previewDomainAdmin`, `-previewMailbox`, …). Agents must exercise Android with these previews the same way they use iOS args — do not treat “compile OK” as an Android UI pass.

| Mode | Intent (boolean extra) | `-e preview` value | Surface |
| --- | --- | --- | --- |
| Domain Admin | `previewDomainAdmin` | `domainAdmin` | Admin mailbox console (fixture rows, no network) |
| Password sign-in | `previewPasswordSignIn` | `passwordSignIn` | `SignInView` with password form expanded |
| Invite accept | `previewInviteAccept` | `inviteAccept` | Invite accept, signed out (code + create account) |
| Invite accept (signed in) | `previewInviteAcceptSignedIn` | `inviteAcceptSignedIn` | Invite accept into the signed-in account |
| Sign-in & recovery | `previewSignInMethods` | `signInMethods` | Sign-in methods + recovery email |
| Members | `previewMembers` | `members` | Mailbox members + pending invites |
| Devices & sessions | `previewSessions` | `sessions` | Session list |
| Inbox New/Seen | `previewMailbox` | `mailbox` | Home inbox list with New/Seen fixtures |
| Screener | `previewScreener` | `screener` | Screener folder + detail open |
| Reply Later | `previewReplyLater` | `replyLater` | Reply Later pile |
| Spam | `previewSpam` | `spam` | Spam folder with a spam fixture (open it for Not Spam) |
| Load more | `previewLoadMore` | `loadMore` | Inbox with more pages; scroll down for the pulsing skeleton footer row |
| Load failed | `previewLoadFailed` | `loadFailed` | Signed in, first mailbox load failed, nothing cached: Retry + Sign out (never onboarding) |
| List error | `previewListError` | `listError` | Inbox fetch failed with an empty cache: "Couldn’t load emails" + Retry |
| Service ended (admin) | `previewServiceEnded` | `serviceEnded` | Read-only inbox + "Renew" banner |
| Service ended (member) | `previewServiceEndedMember` | `serviceEndedMember` | Read-only inbox + "Ask an admin" |
| Service ending | `previewServiceEnding` | `serviceEnding` | Admin "Keep subscription" notice |
| DNS, service ended | `previewDomainDnsEnded` | `domainDnsEnded` | Subscription card, DNS edits frozen |

Code: `ui/preview/PreviewMode.kt`, `PreviewSupport.kt`, `PreviewRoots.kt`. Wired from `MainActivity` when `BuildConfig.DEBUG` and an extra is present. Fixtures never persist session (`AuthStore.applyEphemeralSession`); normal launches call `resyncFromStorage()`.

```bash
cd android
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
# or: INSTALL=1 ./scripts/run-debug-preview.sh domainAdmin
./scripts/run-debug-preview.sh domainAdmin
./scripts/run-debug-preview.sh mailbox
./scripts/run-debug-preview.sh screener
./scripts/run-debug-preview.sh replyLater
./scripts/run-debug-preview.sh spam
./scripts/run-debug-preview.sh passwordSignIn
./scripts/run-debug-preview.sh inviteAccept
```

Equivalent raw adb:

```bash
adb shell am start -n co.inboxies.app/.MainActivity --ez previewDomainAdmin true
adb shell am start -n co.inboxies.app/.MainActivity -e preview mailbox
```

Emulator tip: wait for `sys.boot_completed=1` before install/start (`adb wait-for-device` then poll `getprop`). Prefer a cold `emulator -avd <name> -no-snapshot-load` if the AVD flakes offline mid-boot.

For Compose `@Preview` / prototype variants, still use `ui/prototypes/` + `PreviewSupport` fixtures — the adb harness is for full-activity emulator certainty, not Studio pane-only.
