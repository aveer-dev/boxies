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

- SwiftUI-first, iOS 17+, iPhone (portrait only) + iPad (all orientations, Split View / Slide Over) — `TARGETED_DEVICE_FAMILY: "1,2"`.
- iPad: `horizontalSizeClass == .regular` → `HomeSplitLayout` two-pane (list column + reading pane, `Views/Home/HomeSplitLayout.swift`); compact width is the phone layout. Regular width ≥ `HomeChromeMetrics.threeColumnMinWidth` (1180pt, 11"/13" iPad landscape) adds a leading `HomeFolderColumn` (240pt; folders + Reply Later, web Miller "Folders" twin; AVE-73). Toggle lives in the column header + mailbox avatar menu, never the toolbar (an extra leading item crowds it); `@AppStorage("home_folder_column_visible")`. The list keeps its two-pane width; `listColumnNavigationBarMargins` restores the bar's 20pt margins once the list is off the window edge. Sheets use `.formSheetSizing()` (centered form sheet on iPad, iOS 18+).
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
| `minimizedComposeGap` | 10 |

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

Home large-title fade: `ProgressiveBlurBackground` (ultraThinMaterial masked to a top gradient). Toasts: one component, `InboxiesToast` (`Views/Components/InboxiesToast.swift`) — `.liquidGlass` pill (26pt continuous radius, min height 52 = `actionBarHeight`, max width 440), Inter 15 medium, optional leading `ToastIcon` + trailing `ToastAction` (accent text on an `accent` 12% capsule), swipe down / tap to dismiss. Place with `ToastMetrics` (`screenInset`, `barGap` above the bottom bar, `standaloneBottomInset`), animate with `ToastMetrics.animation`. App-level: `AppModel.showToast(_:isError:isLoading:isUndo:icon:action:duration:)`. Never build an ad-hoc toast.

## Navigation (not TabView)

`RootView`: Sign in → mailbox onboarding (no mailboxes) → `HomeShellView`. Auth crossfade `.easeInOut(duration: 0.2)`.

| Surface | Mechanism |
| --- | --- |
| Home | `NavigationStack`, large title, hidden toolbar background + progressive blur |
| Folder tabs | Custom chrome on `AppModel.selectedTab` (`HomeTab`). Horizontal swipe between folders. **Not** `TabView`. |
| Email detail | Compact: `.sheet(item:)` with stable id `"email-detail"` so prev/next does not remount. Regular width: `HomeReadingPane` beside the list |
| Compose | `.sheet` when expanded; minimize to `ComposeDockBar` on dismiss |
| Ask AI | `.sheet` + inner `NavigationStack(path:)` |
| Search | ZStack opacity swap over home (not a push) |
| Settings | `.sheet` large detent + `NavigationLink` subpages |
| Email actions | height-estimated sheet; iOS 18+ `navigationTransition(.zoom)` from detail |
| Detents | Settings / compose large; add-mailbox medium/large; swipe picker medium; quoted original medium/large; reasoning `.fraction(0.4)` + large |

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
- **Load failed:** `LoadFailedContent` (`Views/Components/LoadFailedViews.swift`) — `ContentUnavailableView` + ink Retry. Never show onboarding or "empty" for a failed fetch.
- **Load more:** one `EmailRowSkeleton` footer row while `EmailListPaging.hasMore`; muted "Couldn’t load more · Retry" after a failed page.
- **Loading:** skeleton rows (`EmailRowSkeleton`, ~9 rows) + `.skeletonPulse`. `ProgressView` for digest/auth/busy, not as the only list placeholder.
- **Forms:** Settings `insetGrouped`; fields `surface` + continuous rounded 10 + `line` stroke.
- **Modals / sheets close:** Modal and sheet dismiss/close controls must use an "x" icon (`Image(systemName: "xmark")`, 32×32 frame, `AppTheme.ink`), never "Cancel" text. Use `.accessibilityLabel("Close")`. Reserve "Cancel" text strictly for confirmation alert dialogs.

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
| `-previewPasswordSignIn -previewTwoFactorChallenge` | Two-factor code step after a password sign-in (fixture challenge, no API) |
| `-previewInviteAccept` | Invite accept (signed out: code + create account) |
| `-previewInviteAcceptSignedIn` | Invite accept into the signed-in account |
| `-previewSignInMethods` | Sign-in & recovery (methods + recovery email) |
| `-previewMembers` | Mailbox members + pending invites |
| `-previewSessions` | Devices & sessions |
| `-previewSenders` | Settings → Senders, Allowed tab with fixture rules (add `-previewSendersBlocked` for Blocked; adding `@gmail.com` shows the free-mail inline error) |
| `-previewSettings` | Settings sheet on the fixture mailbox (add `-previewScreenerOff` for the Screener switch off) |
| `-previewAIUsage normal\|warning\|exhausted` | Stub AI usage (12/50, 42/50, 50/50 chats). Pair with `-previewChat` (meter / limit notice above the composer) or `-previewSettings` (AI usage section) (AVE-45) |
| `-previewMailbox` | Inbox New/Seen |
| `-previewScreener` | Screener + detail |
| `-previewReplyLater` | Reply Later pile |
| `-previewSpam` | Spam folder + detail open (Not Spam action) |
| `-previewDetail -previewNewsletter` | Long, wide newsletter open in the reader: scaled to fit, rigid table scrolls sideways (AVE-89) |
| `-previewMailbox -previewLoadFailed` | First mailbox load failed, nothing cached (error + Retry / Sign out, not onboarding) |
| `-previewMailbox -previewListError` | Folder fetch failed with an empty cache (error + Retry, not "This folder is empty") |
| `-previewMailbox -previewLoadMore` | Inbox with the infinite-scroll skeleton footer (scroll to the bottom) |
| `-previewMailbox -previewToast` | Inbox with a pinned "Archived · Undo" toast above the bottom bar (AVE-134) |
| `-previewMailbox -previewManyNew` | Inbox with a dozen New: New capped at 5 + "Show N more new" (pushes the All new screen) above Seen |
| `-previewMailbox -previewNotes` | Inbox rows with the notes-to-self strip and "N private notes" chip |
| `-previewDetail -previewNotes` | Q3 thread with a sticky note + inline notes (add `-previewNotesMoved` for a dragged sticky, `-previewNotesThrow` for a scripted drag/throw/spring loop to screen-record) |
| `-htmlHardenFixture` | Sanitizer / link-policy fixture + quoted-replies sheet |
| `-previewAutofill` | AutoFill extension lists fixture private emails (no sign-in or API). Enable the provider with `xcrun simctl spawn <udid> pluginkit -e use -i co.inboxies.app.credential-provider`, then in Safari tap an email field → QuickType **Passwords** → Inboxies. iOS always shows credential-provider UI as a full-height sheet. |

## Hard don'ts

- New palettes, SF Pro for chrome, or Apple Mail blue branding.
- `TabView` as information architecture.
- Elevated Material-style cards for mail rows.
- `NavigationPath` for folder switching.
- Hardcoded colors/fonts/radii when `AppTheme` / `HomeChromeMetrics` already has a token.
- Spinner-only first load on lists (use skeletons).
- Dismissing compose instead of minimizing to the dock.
- "Cancel" text buttons to dismiss modals, sheets, or form overlays (use `Image(systemName: "xmark")` icon button instead; text "Cancel" is only for alert dialogs).
- Shipping iOS-only visual changes without the Android twin unless the task is explicitly iOS-only.
- Treating Simulator-only evidence as enough for a dual-platform change — run Android DEBUG previews (`inboxies-android-ui`) for the same surfaces.
