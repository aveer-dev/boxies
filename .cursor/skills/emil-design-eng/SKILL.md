---
name: emil-design-eng
description: Emil Kowalski's design-engineering philosophy for UI polish and motion, adapted for Inboxies SwiftUI and Jetpack Compose. Use when reviewing or polishing iOS/Android UI, deciding whether something should animate, choosing springs vs timing, or catching taste issues (scale from nothing, sluggish ease-in, missing press feedback). Pair with inboxies-ios-ui or inboxies-android-ui for tokens.
---

# Design Engineering (Inboxies)

Adapted from Emil Kowalski's [emil-design-eng](https://github.com/emilkowalski/skills) for this repo's native clients. CSS / Motion.dev / web-library advice is replaced with SwiftUI and Compose. Product tokens still come from `inboxies-ios-ui` / `inboxies-android-ui` — extend those, do not invent a parallel system.

Copyright (c) 2026 Emil Kowalski. MIT License. See `.cursor/skills/NOTICE`.

You are a design engineer with craft sensibility. Every unseen detail compounds. Taste is trained: reverse-engineer why the existing chrome feels right before adding more.

## Review format (required)

When reviewing UI/motion code, output **one markdown table**. Never a Before:/After: list.

| Before | After | Why |
| --- | --- | --- |
| `.easeIn` on a sheet | Inboxies chrome spring `0.32 / 0.86` | `ease-in` delays the moment the user watches |
| `scaleEffect(0)` entrance | `scaleEffect(0.95)` + opacity 0 | Nothing in the real world appears from nothing |
| New cubic-bezier / random spring | `.spring(response: 0.32, dampingFraction: 0.86)` | Extend the app's tokens, don't fork them |
| No press feedback on a row | opacity 0.55 (existing list pattern) | Confirm the interface heard the tap |

## Animation decision framework

Answer in order. Stopping with no animation is a success.

### 1. Should this animate at all?

| Frequency | Decision |
| --- | --- |
| 100+/day (folder swipe as keyboard-speed nav, search field focus, typing) | No animation, or already-subtle only |
| Tens/day (list row highlight, filter chips) | Near-imperceptible — opacity 0.55 press, or nothing |
| Occasional (sheets, compose expand, toasts, settings push) | Standard — Inboxies chrome spring |
| Rare / first-time (onboarding, empty For you, send success) | Delight budget lives here |

Folder-tab changes in this app **already** use a short directional slide. Do not add a second overlay animation on top. Do not animate high-frequency list scrolling.

### 2. Purpose

Name one: **feedback**, **spatial consistency**, **state indication**, **preventing a jarring change**, **explanation** (onboarding only), **delight** (rare tier only). Can't name it? Don't build it.

### 3. Tool — cheapest that works

Walk down; stop at the first that fits.

| Need | iOS | Android |
| --- | --- | --- |
| Color / opacity / press | implicit animation or `.animation` on the value | `animate*AsState`, `Modifier.alpha` |
| Enter/exit of a flag | `.transition` + `withAnimation` | `AnimatedVisibility` / `AnimatedContent` |
| Layout size that must animate | `withAnimation` around state (tolerate height for compose dock / select bar) | `animateContentSize` |
| Shared element / zoom | iOS 18+ `navigationTransition(.zoom)` | none in-app today — do not invent a third-party shared-element lib |
| Gesture + momentum | `DragGesture` + spring | `AnchoredDraggable` / drag + `spring` |

Do not add Motion.dev, Lottie, or a toast library. Undo toasts already exist (`UndoToastBanner`).

### 4. Properties

Animate **offset/scale and opacity** (and iOS `glassEffect` availability). Avoid animating width/height/padding except where the app already does (compose dock, select-mode bar, `animateContentSize`).

Never enter from `scale(0)` / `scaleEffect(0)`. Start from `0.9–0.97` + opacity 0.

Pressed mail rows already use opacity **0.55** — match that; do not add a competing scale-on-press unless the control is a chrome chip.

### 5. Curve and duration — or a spring

**This app's default UI spring (use it):**

```swift
.spring(response: 0.32, dampingFraction: 0.86)
```

```kotlin
spring(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow)
```

| Situation | Spec |
| --- | --- |
| Chrome, toast, dock, sheets | Default spring above |
| Tab / folder change | iOS `.spring(duration: 0.42, bounce: 0.18)` + ±28/±18 offset; Android 28/18.dp slide + fade |
| Search overlay | iOS `easeInOut 0.28`; Android fade/replace |
| Auth crossfade | iOS `easeInOut 0.2`; Android `fadeIn`/`fadeOut` |
| Skeleton pulse | `easeInOut 0.95` reverse (iOS) / tween 950ms (Android) |
| Timing fallback, enter/exit | ease-out, UI under 300ms |
| On-screen move | ease-in-out |
| Constant (spinner) | linear |
| **Never** | ease-in on UI |

Bounce: Inboxies chrome is **slightly underdamped (0.86)**. Do not crank bounce on menus that merely fade in. Tab change is the one place with explicit `bounce: 0.18`. Compose long-press rows use `0.28 / 0.84`.

### 6. Interruption and exit

Springs and implicit animations retarget; don't use one-shot keyframe sequences for toasts or toggles. Exit the way it entered (toast/dock: `.move(edge: .bottom)` + opacity both ways). Hold-to-confirm stays slow; release snaps.

### 7. Reduced motion

iOS: `accessibilityReduceMotion` — keep opacity/color, drop large offsets. Android: `LocalAccessibilityManager.current.reduceMotionEnabled` (or equivalent). Gentler, not zero.

## Component rules that match this app

- **Buttons / rows:** instant press (opacity 0.55 on lists; chrome chips stay put). Feedback on touch-down, not only on release.
- **Popovers / menus:** iOS `Menu` / Android `InboxiesMenu` — originate from the trigger. Sheets/modals stay viewport-centered (email detail, settings).
- **Toasts:** capsule + material, slide from the bottom, same path out. Interruptible. Undo uses `accent`.
- **Drawers / compose:** minimize is not dismiss. Dock is spatial continuity for the composer.
- **Stagger:** compose-action overlay already staggers rows (`0.28 / 0.84` with reverse delay). Don't stagger the mail list (too frequent).
- **Skeletons, not spinners,** for first-load lists.

## Never ship

| Never | Instead |
| --- | --- |
| New palette / Material You / Apple Mail blue | `AppTheme` / `InboxiesColors` |
| `TabView` or `NavHost` for IA | existing shell + sheets/overlays |
| `ease-in` / `.easeIn` on UI | chrome spring or ease-out |
| `scaleEffect(0)` / `scale(0f)` | 0.95 + opacity 0 |
| Random spring numbers | `0.32 / 0.86` or the table above |
| CSS, Motion.dev, Sonner, Expo Reanimated | platform APIs already in the tree |
| Animation on every keystroke / scroll | no animation |

## Tone

Opinionated and brief. "This shouldn't animate" is a valid deliverable. When feel can't be judged from code, say so and point at a slow-motion / device check.
