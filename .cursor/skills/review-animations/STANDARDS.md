# Animation Standards (Inboxies)

Adapted from Emil Kowalski's review-animations STANDARDS. Cite these values instead of approximating. Product chrome tokens: `inboxies-ios-ui` / `inboxies-android-ui`.

Copyright (c) 2026 Emil Kowalski. MIT License. See `.cursor/skills/NOTICE`.

## Frequency

| Frequency | Decision |
| --- | --- |
| 100+/day | No animation |
| Tens/day | Remove or opacity-only (pressed row 0.55) |
| Occasional (sheets, toasts, compose) | Standard — chrome spring |
| Rare / first-time | Delight allowed |

Valid purposes: spatial consistency, state indication, explanation, feedback, preventing jarring change.

## Inboxies springs (canonical)

```swift
// Chrome / toast / dock / most custom overlays
.spring(response: 0.32, dampingFraction: 0.86)

// Compose expand (HomeShellView)
.spring(response: 0.32, dampingFraction: 0.88)

// Select mode / some overlays
.spring(response: 0.28, dampingFraction: 0.82)

// Compose-action rows
.spring(response: 0.28, dampingFraction: 0.84)

// Folder tabs
.spring(duration: 0.42, bounce: 0.18)
```

```kotlin
spring(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow)

// Compose-action highlight
spring(dampingRatio = 0.82f, stiffness = 480f) // existing overlay

// Compose-action rows
spring(dampingRatio = 0.84f, stiffness = Spring.StiffnessMediumLow)
```

| Timing (when not a spring) | Spec |
| --- | --- |
| Search | iOS `easeInOut 0.28` |
| Auth | iOS `easeInOut 0.2`; Android fade |
| Skeleton | `easeInOut 0.95` reverse / Android tween 950ms, alpha 0.45↔1 |
| Tab offsets | insert ±28, remove ±18 (pt/dp) |

**Never ease-in on UI.**

If a timing curve is required instead of a spring: ease-out enter/exit; ease-in-out for on-screen moves; linear for spinners. UI timing stays **under 300ms**.

## Duration budgets (timing animations)

| Element | Duration |
| --- | --- |
| Press feedback | instant opacity, or 100–160ms |
| Small popover / menu | 125–200ms or chrome spring |
| Sheets / compose | system sheet or chrome spring (response 0.32) |
| Marketing | n/a in these clients |

## Physicality

- Never `scaleEffect(0)` / `scale(0f)`. Use 0.9–0.97 + opacity 0.
- Menus from trigger (`Menu`, `InboxiesMenu`, compose-action overlay).
- Modals/sheets centered (email detail, settings).
- Pressed mail row: opacity **0.55**.

## Interruptibility

Prefer `.animation(spring, value:)` / `animate*AsState` / `withAnimation` springs. Don't reset an `Animatable` to 0 on every toast id if a spring retarget would do.

Exit the way it entered (bottom toast, directional tab slide).

Asymmetric: hold slow, release snap. Folder tabs already asymmetric (±28 vs ±18).

## Performance

Animate offset, scale, opacity. Don't animate mail-row width/padding. `animateContentSize` is OK on select-mode chrome and compose dock.

Avoid extra blur animations on Android `liquidGlass` (already a fake frost).

## Accessibility

iOS `accessibilityReduceMotion`: drop large offsets and zoom; keep opacity. Android: honor reduce-motion equivalently.

## Gestures

Velocity-based dismiss (~flick), rubber-band past rest, 1:1 while dragging. Folder swipe hysteresis ~40.dp on Android. Compose long-press haptic (medium / confirm).

## Stagger

30–80ms only on rare group entrances (compose-action overlay already does). Never stagger the mail list.

## Cohesion

Calm Notion mail client. Don't introduce a second motion system. If a new spring is truly needed, add a named helper next to the existing ones and use it in both platforms.
