---
name: animate
description: Build an animation from scratch for Inboxies iOS (SwiftUI) or Android (Compose). Decision order — should it animate, purpose, tool, properties, curve/spring, interruption, reduced motion — then write the implementation. Use when asked to animate something, add motion, make a component feel alive, or build a transition. For critiquing existing motion use review-animations; for auditing a whole codebase use improve-animations. Pair with inboxies-ios-ui or inboxies-android-ui.
---

# Building Animations (Inboxies)

Adapted from Emil Kowalski's [animate](https://github.com/emilkowalski/skills) for SwiftUI and Jetpack Compose. This skill does ONE thing: turn a request for motion into an implementation that would survive `review-animations`. It does not audit a codebase or critique a diff.

Copyright (c) 2026 Emil Kowalski. MIT License. See `.cursor/skills/NOTICE`.

Load `inboxies-ios-ui` or `inboxies-android-ui` first so tokens stay canonical.

## Operating posture

Two failure modes, and the first is worse:

1. **Animating something that shouldn't animate.** The gate below exists to produce zero lines of code sometimes. That's a success.
2. **Animating the right thing with the wrong ingredients** — `.easeIn` on an entrance, `scaleEffect(0)`, a new spring that doesn't match chrome.

Never present motion options as a menu. Make the call, state the reasoning in one line, write the code.

## Hard rules

1. Run the sequence in order. Steps 1 and 2 gate everything.
2. **No approximated springs.** Use the Inboxies table. Do not invent `cubic-bezier` or a one-off `dampingRatio`.
3. **Extend the codebase's tokens, don't fork them.**
4. Reduced motion ships with the animation.
5. Cheapest platform API that works. Do not add a motion library.

## The build sequence

### 1. Should this animate at all?

| Frequency | Decision |
| --- | --- |
| 100+/day (typing, cursor, high-frequency folder hops as a habit) | **No animation. Ever.** Stop here. |
| Tens/day (row press, filter chips) | Near-imperceptible only — opacity 0.55, or nothing |
| Occasional (modals, drawers, toasts, compose expand) | Standard animation |
| Rare / first-time (onboarding, celebration) | Delight budget |

If the request fails this gate, say so and don't write the animation.

Note: this app **already** animates folder-tab changes with a short directional slide. Don't stack another transition on that path.

### 2. What is the purpose?

Name it: **feedback**, **spatial consistency**, **state indication**, **preventing a jarring change**, **explanation**, **delight** (rare only). Can't name it? Don't build it.

Data the user is reading (mail list while scrolling) should not move for style.

### 3. Pick the tool — cheapest that works

| Need | SwiftUI | Compose |
| --- | --- | --- |
| Value you already own (flag, selection) | `.animation(_:value:)` on that value | `animate*AsState` / `animateFloatAsState` |
| Insert/remove a view | `.transition` + `withAnimation` | `AnimatedVisibility` |
| Swap two screens | `withAnimation` + asymmetric transition, or iOS 18 zoom | `AnimatedContent` |
| Size of chrome that must grow | `withAnimation` around state (dock, select bar) | `animateContentSize` |
| Shared-element zoom | `matchedTransitionSource` + `navigationTransition(.zoom)` (iOS 18+) | not used — don't add a library |
| Gesture with momentum | `DragGesture` + spring | drag / `AnchoredDraggable` + `spring` |
| Matched highlight | `matchedGeometryEffect` (compose-action overlay) | `animateRectAsState` + highlight spring |

### 4. Pick the properties

- Prefer **offset, scale, opacity**. GPU-friendly.
- Never `scaleEffect(0)` / `scale(0f)`. Start from `0.9–0.97` + opacity 0.
- Trigger-anchored UI (menus, compose-action overlay) grows from the trigger. Sheets/modals stay centered.
- Prefer relative offsets (`transition(.move(edge: .bottom))`, `slideInVertically { it }`) over magic pixel constants — except where this app already standardized **±28 / ±18** for tab changes.
- Don't animate a child's transform via a parent-only animatable that forces full subtree layout every frame.

### 5. Easing and duration — or a spring

**Default UI spring (chrome, toast, dock, most sheets):**

```swift
.spring(response: 0.32, dampingFraction: 0.86)
```

```kotlin
spring(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow)
```

| Situation | iOS | Android |
| --- | --- | --- |
| Compose expand | `0.32 / 0.88` | same default spring |
| Tab / folder change | `.spring(duration: 0.42, bounce: 0.18)` + offset ±28 / ±18 + opacity | 28.dp / 18.dp slide + fade |
| Search | `.easeInOut(duration: 0.28)` | fade/replace |
| Select mode | `0.28 / 0.82` | default spring + `animateContentSize` |
| Compose long-press overlay | easeOut 0.2 / dismiss 0.18; rows `0.28 / 0.84` | backdrop medium spring; highlight `0.82` / stiffness 480; rows `0.84` + MediumLow |
| Auth | `.easeInOut(0.2)` | `fadeIn` togetherWith `fadeOut` |
| Skeleton | `easeInOut 0.95` reverse | tween 950ms reverse, alpha 0.45↔1 |
| Timing enter/exit (no spring) | ease-out, **under 300ms** | same |
| On-screen morph | ease-in-out | `FastOutSlowInEasing` |
| **Never** | `.easeIn` on UI | `FastOutLinearInEasing` / EaseIn on UI |

Keep bounce subtle. Visible bounce is for tab change (`0.18`) and momentum gestures, not for a settings row fade.

### 6. Interruption and exit

- Implicit animations / springs retarget. Don't use a restarting keyframe/`Animatable` reset for toasts or toggles.
- Gestures: spring so velocity carries through reverse (chat drag-to-dismiss, compose minimize).
- Exit the way it entered. Toast/dock: bottom + opacity both ways.
- Asymmetric: slow on hold-to-confirm, snap on release.

### 7. Reduced motion

```swift
@Environment(\.accessibilityReduceMotion) var reduceMotion
// keep opacity; drop large offsets / zoom
```

```kotlin
val reduce = LocalAccessibilityManager.current?.let { /* reduceMotionEnabled if available */ }
```

Reduced motion = fewer and gentler, not zero. Keep opacity/color that aid comprehension.

## Recipes

### Toast / undo banner

Already exists: iOS home capsule + `UndoToastBanner`; Android `UndoToastBanner`. New toasts should **reuse** those, spring `0.32 / 0.86`, `.move(edge: .bottom) + opacity`.

### Sheet / modal

iOS `.sheet` / `.fullScreenCover` (system motion). Custom overlays: default chrome spring. Android `ModalBottomSheet` or overlay + `slideInVertically` + fade. Scrim `HomeChromeMetrics.modalScrim` (Android).

### Folder tab change

Do not reinvent. Copy `HomeShellView` asymmetric offset ±28 insert / ±18 remove + opacity.

### Compose minimize

Not dismiss. Animate expanded cover ↔ `ComposeDockBar`. iOS `0.32 / 0.86` (expand often `0.88`). Android slide + default spring.

### Pressed row

Opacity **0.55**. No extra scale unless it's a chrome control.

### Skeleton

`.skeletonPulse` (iOS) / existing list skeleton pulse (Android). Don't add a shimmer library.

## Never ship

| Never | Instead |
| --- | --- |
| CSS / Motion.dev / Reanimated / Lottie | SwiftUI / Compose APIs above |
| `scaleEffect(0)` | 0.95 + opacity 0 |
| `.easeIn` on UI | chrome spring or ease-out |
| Duration > 300ms on UI with no reason | default spring or 150–250ms |
| New spring constants | table in step 5 |
| Animating high-frequency list scroll | no animation |
| Sonner / toast library | existing capsule toast |

## Output

Write the code. Then, in a few lines:

- **Gate result** — frequency tier and named purpose. What was rejected, if anything.
- **Ingredients** — tool, properties, spring/timing, in one line each.
- **Feel-check** — if you can't judge from code (bounce, crossfade), say so: slow-mo, device, next day.

## Tone

Opinionated and brief. "This shouldn't animate" is why this skill exists.
