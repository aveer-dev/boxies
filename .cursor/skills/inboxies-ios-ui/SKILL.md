---
name: inboxies-ios-ui
description: Inboxies iOS SwiftUI design and implementation. Use when changing UI, layout, chrome, navigation, theming, lists, sheets, compose, chat, or any visual work under ios/. Encodes the Notion-inspired shell as implemented — AppTheme tokens, Inter, liquid-glass chrome, sheets/overlays instead of TabView. Do not invent Apple Mail or generic iOS look.
---

# Inboxies iOS UI

Canonical visual language for the SwiftUI client. Tokens live in code, not an asset catalog. Extend them; do not fork a second palette.

**Source of truth**

- Colors, type, list/chat metrics: `ios/AgenticInbox/Inboxies/Theme/AppTheme.swift`
- Chrome metrics + glass: `ios/AgenticInbox/Inboxies/Theme/LiquidGlass.swift`
- Theme preference: `ThemeMode.swift` + `ThemeController.swift` (`@AppStorage("app_theme")`)

When polishing motion, also load `animate`, `apple-design`, and `emil-design-eng`.

## Stack

- SwiftUI-first, iOS 17+, iPhone portrait only (`TARGETED_DEVICE_FAMILY: 1`).
- Swift **5.10** (`project.yml`). Do not migrate language/concurrency for a UI change.
- UIKit only for appearance proxies, `WKWebView` (HTML mail), Sign in with Apple, Quick Look, and hosting-VC theme override.
- `@Observable` `AppModel` + `AuthStore` via `.environment`. Views own local `@State` for presentation flags.

## Personality

Notion-inspired light shell with dynamic dark counterparts. Calm blue accent, not indigo, not Apple Mail blue. Flat search-row lists, not card grids. Inter for product chrome, not SF Pro. SF Symbols for icons.

## Colors

Use `AppTheme.*`. Never hardcode a new hex or RGB.

| Token | Light RGB | Dark RGB | Role |
| --- | --- | --- | --- |
| `background` | `(0.98, 0.98, 0.985)` | `(0.05, 0.05, 0.05)` | Screen fill |
| `surface` | white | `(0.11, 0.11, 0.12)` | Cards, fields, dock |
| `ink` | `(0.12, 0.12, 0.14)` | `(0.98, 0.98, 0.99)` | Primary text / tint |
| `muted` | `(0.45, 0.45, 0.48)` | `(0.60, 0.60, 0.65)` | Secondary text |
| `line` | `(0.90, 0.90, 0.92)` | `(0.20, 0.20, 0.22)` | Borders / dividers |
| `pillFill` | `(0.93, 0.93, 0.94)` | `(0.18, 0.18, 0.20)` | Chips, inactive pills |
| `pillActive` | `(0.86, 0.86, 0.875)` | `(0.28, 0.28, 0.30)` | Active / skeleton |
| `accent` | `(0.15, 0.35, 0.85)` | `(0.35, 0.55, 1.0)` | Links, toggles, Undo |
| `unread` | `(0.22, 0.22, 0.24)` | `(0.90, 0.90, 0.92)` | Unread dot |
| `deepDarkRed` | `(0.42, 0.08, 0.10)` | `(0.90, 0.35, 0.35)` | Draft / destructive notes |

Swipe-action tints (not in `AppTheme`): delete `.red`, archive purple `(0.55, 0.35, 0.85)`, star `.orange`, toggleRead `.blue`, reply `AppTheme.accent`.

## Typography

`Font.inter(size:weight:)` / `UIFont.inter`. Bundled: Inter Regular, Medium, SemiBold, Bold, Italic.

| Namespace | Token | Size |
| --- | --- | --- |
| `FontSize` | `largeTitle` | 22 |
| | `inlineTitle` | 14 |
| | `sender` | 13 |
| | `recipient` / `meta` / `body` / `homeSubtitle` | 12–13 |
| | `chevron` | 8 |
| `List` | title/sender 15, subject 13, preview 12, date/badge 10, sectionHeader 11 | |
| `List.tracking` | `0.25` | |
| `Chat` | body 13, toolAction 12, meta/codeMeta 11, prompt/input 14, code 12.5, tableCell 12 | |
| `Chat.bodyLineSpacingRatio` | `0.28` | |
| Home nav | large title **34 bold**, inline **17 semibold**, subtitle **13** | |
| Root default | `.font(.inter(size: 14))` on `RootView` | |

Most UI uses fixed point sizes from these tokens. Dynamic Type helpers exist; do not switch chrome to system text styles.

Monospace only for code blocks and the API URL field.

## Spacing and chrome

`AppTheme.List`

| Token | Value |
| --- | --- |
| `rowVerticalPadding` | 18 |
| `rowTextSpacing` | 6 |
| `rowHorizontalPadding` | 20 |
| `dotToText` | 14 |
| `unreadDotSize` | 8 |
| `unreadDotLineHeight` | 22 |
| `separatorHeight` | 0.5 |
| `separatorColor` | `line.opacity(0.65)` |
| `separatorLeadingInset` | `20 + 8 + 14` = 42 |

`HomeChromeMetrics`

| Token | Value |
| --- | --- |
| `actionBarHeight` | 52 |
| `chromeHorizontalPadding` | 12 |
| `chromeSpacing` | 10 |
| `chromeBottomPadding` | 20 |
| `chromeCornerRadius` | **50** (pill glass bars) |
| `tabLabelPointSize` | 10 |
| `minimizedComposeHeight` | 66 |

Corner radii in the wild: digest cards **18**, compose dock top **18**, chat bubbles/action sheets/toast **14–16**, settings rows/fields **10–12**, tags **6**, skeleton bars **4**.

## Liquid glass

Use `.liquidGlass(in:)` for floating chrome. Do not reinvent blur.

```swift
func liquidGlass<S: Shape>(in shape: S) -> some View {
    if #available(iOS 26.0, *) {
        self.glassEffect(.regular.interactive(), in: shape)
    } else {
        self
            .background(.ultraThinMaterial, in: shape)
            .overlay { shape.stroke(Color.white.opacity(0.45), lineWidth: 0.5) }
            .shadow(color: .black.opacity(0.08), radius: 12, y: 4)
    }
}
```

Home large-title fade: `ProgressiveBlurBackground` (ultraThinMaterial masked to a top gradient). Toasts: `.regularMaterial` capsule + hairline + shadow `black 0.12 / r12 / y4`. Undo uses `accent`.

## Navigation (not TabView)

`RootView`: Sign in → mailbox onboarding (no mailboxes) → `HomeShellView`. Auth crossfade `.easeInOut(duration: 0.2)`.

| Surface | Mechanism |
| --- | --- |
| Home | `NavigationStack`, large title, hidden toolbar background + progressive blur |
| Folder tabs | Custom chrome on `AppModel.selectedTab` (`HomeTab`). Horizontal swipe between folders. **Not** `TabView`. |
| Email detail | `.sheet(item:)` with stable id `"email-detail"` so prev/next does not remount |
| Compose | `.fullScreenCover` when expanded; minimize to `ComposeDockBar` (do not dismiss) |
| Ask AI | `.fullScreenCover` + inner `NavigationStack(path:)` |
| Search | ZStack opacity swap over home (not a push) |
| Settings | `.sheet` large detent + `NavigationLink` subpages |
| Email actions | height-estimated sheet; iOS 18+ `navigationTransition(.zoom)` from detail |
| Detents | Settings large; add-mailbox medium/large; swipe picker medium; quoted original medium/large; reasoning `.fraction(0.4)` + large |

Folder order: For you → Inbox → Promotions → Updates → Sent → Drafts → Archive → Spam → Trash.

Presentation and chrome live on `HomeShellView`. Domain state lives on `AppModel`.

## Motion already in this app

Reuse these. Do not invent a parallel spring system.

| Moment | Spec |
| --- | --- |
| Chrome / toast / dock / compose quoted | `.spring(response: 0.32, dampingFraction: 0.86)` |
| Compose expand | often `0.32 / 0.88` |
| Tab change | `.spring(duration: 0.42, bounce: 0.18)` + offset ±28 insert / ±18 remove + opacity |
| Search show/hide | `.easeInOut(duration: 0.28)` |
| Select mode | `0.28 / 0.82` |
| Compose long-press overlay | easeOut 0.2 / dismiss 0.18; staggered row `0.28 / 0.84` |
| Skeleton | `easeInOut 0.95` repeatForever autoreverse (opacity 0.55 ↔ 1) via `.skeletonPulse` |
| Pressed row | opacity **0.55** |
| Transient chrome | `.move(edge: .bottom).combined(with: .opacity)` |

iOS 18+ zoom: `matchedTransitionSource` + `navigationTransition(.zoom)` for Ask AI, Compose, email actions.

Haptics: `.sensoryFeedback(.success/.selection)`; `UIImpactFeedbackGenerator` light (contact pill) / medium (compose long-press).

Gate iOS 18/26 APIs with `#available` the same way (glass, zoom, `ToolbarSpacer`, `navigationSubtitle`).

## Layout conventions

- **Lists:** `.listStyle(.plain)`, hidden separators, custom bottom separator inset past the unread-dot column, `contentMargins(.top, 12)`, `scrollContentBackground(.hidden)`, `safeAreaInset` for chrome height.
- **Rows:** unread/read dot · sender (+ thread badge / Draft) · date/star/paperclip · subject · 1-line preview · optional tags. `.buttonStyle(.plain)`.
- **Cards:** rare — digest topic cards only (`surface` + 18pt continuous radius + hairline).
- **Empty:** `ContentUnavailableView`.
- **Loading:** skeleton rows (`EmailRowSkeleton`, ~9 rows) + `.skeletonPulse`. `ProgressView` for digest/auth/busy, not as the only list placeholder.
- **Forms:** Settings `insetGrouped`; fields `surface` + continuous rounded 10 + `line` stroke.

## Screen map

| Screen | Path |
| --- | --- |
| Sign in / onboarding | `Views/Auth/SignInView.swift`, `RootView.swift` |
| Home shell | `Views/Home/HomeShellView.swift` |
| For you digest | `Views/Home/InboxDigestView.swift` |
| Compose action overlay | `Views/Home/ComposeActionListOverlay.swift` |
| Email list / detail / body / actions | `Views/Email/*` |
| Compose + dock | `Views/Compose/*` |
| Chat | `Views/Chat/ChatSheetView.swift` |
| Search | `Views/Search/SearchView.swift` |
| Settings | `Views/Settings/*` |
| Markdown / toast / flow | `Views/Components/*` |
| DEBUG Simulator previews | `Views/PreviewSupport.swift` + launch args in `InboxiesApp.swift` |

## DEBUG Simulator launch args

Peers of the Android intent harness. Use for E2E / visual review — when the change also ships on Android, require the matching `android/scripts/run-debug-preview.sh` mode too.

| Arg | Surface |
| --- | --- |
| `-previewDomainAdmin` | Domain Admin console |
| `-previewPasswordSignIn` | Password sign-in |
| `-previewInviteAccept` | Invite accept form |
| `-previewMailbox` | Inbox New/Seen |
| `-previewScreener` | Screener + detail |
| `-previewReplyLater` | Reply Later pile |

## Hard don'ts

- New palettes, SF Pro for chrome, or Apple Mail blue branding.
- `TabView` as information architecture.
- Elevated Material-style cards for mail rows.
- `NavigationPath` for folder switching.
- Hardcoded colors/fonts/radii when `AppTheme` / `HomeChromeMetrics` already has a token.
- Spinner-only first load on lists (use skeletons).
- Dismissing compose instead of minimizing to the dock.
- Shipping iOS-only visual changes without the Android twin unless the task is explicitly iOS-only.
- Treating Simulator-only evidence as enough for a dual-platform change — run Android DEBUG previews (`inboxies-android-ui`) for the same surfaces.
