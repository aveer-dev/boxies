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
- Navigation Compose is a **declared unused** dependency. Do not introduce `NavHost` / `rememberNavController`.
- `minSdk 34`, `targetSdk/compileSdk 35`, portrait, phone screens.
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
| Email detail | `ModalBottomSheet` (`skipPartiallyExpanded = true`, custom scrim, no drag handle) |
| Settings | Same modal sheet; nested pages via horizontal `AnimatedContent` |
| Search | Full-screen replace inside home (`showSearch`) |
| AI chat | Custom full-screen overlay; drag-to-dismiss; list ↔ conversation `AnimatedContent` |
| Compose | Full overlay when expanded; `ComposeDockBar` when minimized |
| Compose actions | Long-press overlay (`ComposeActionListOverlay`) |
| Dialogs | Compose `Dialog` (add mailbox) |
| Back | `BackHandler` for search, select mode, compose actions, chat stack |

Folder order: For you (`HomeTab.AiInbox`) then Inbox → Promotions → Updates → Sent → Drafts → Archive → Spam → Trash.

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
- **Pull to refresh:** `PullToRefreshBox` on email list / digest.
- **Sheets:** Custom grabber (36×5 muted pill); often `dragHandle = null`; scrim `HomeChromeMetrics.modalScrim`.

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

## Hard don'ts

- Material You / `dynamicColor` / purple M3 defaults.
- `NavHost` for app IA.
- FAB-centric home chrome (the floating bar is Ask AI + Compose, not a FAB).
- Elevated `Card` for mail rows.
- Hardcoded colors/fonts/radii when `InboxiesColors` / `AppThemeDims` / `HomeChromeMetrics` already has a token.
- Spinner-only first load on lists (use skeletons).
- Dismissing compose instead of minimizing to the dock.
- Opaque system bars or ignoring window insets.
- Shipping Android-only visual changes without the iOS twin unless the task is explicitly Android-only.
