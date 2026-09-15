---
name: apple-design
description: Apple's interface and fluid-motion principles (WWDC Designing Fluid Interfaces), applied to Inboxies native iOS SwiftUI and the matching Android Compose client. Use when building or reviewing gesture-driven UI, springs, drag/swipe/sheet interactions, liquid glass, haptics, reduced motion, or spatial consistency. Pair with inboxies-ios-ui or inboxies-android-ui.
---

# Apple Design (Inboxies)

Adapted from Emil Kowalski's [apple-design](https://github.com/emilkowalski/skills). Original skill translated WWDC talks for the web; **this repo is native**. Principles stay. Pointer Events / `backdrop-filter` / Motion.dev snippets are replaced with SwiftUI and Compose as these apps already use them.

Copyright (c) 2026 Emil Kowalski. MIT License. See `.cursor/skills/NOTICE`.

Through-line: an interface feels alive when motion **starts from the current on-screen value**, inherits velocity, projects momentum, and can be grabbed and reversed. Springs make that natural.

Inboxies is Notion-inspired, not a clone of Mail. Use Apple's *motion and gesture* principles; use `AppTheme` / Inter / liquid-glass chrome for *look*. Do not switch product type to SF Pro or system Mail blue.

## The core idea

Align the interface with how people think and move. Things respond instantly, move continuously, carry momentum, resist at boundaries, and can be redirected mid-motion.

Apple's four human needs: **safety/predictability, understanding, achievement, joy.**

## 1. Response — kill latency

- Highlight on **touch-down**, not only on release. Mail rows: opacity **0.55** while pressed.
- No extra debounce on chrome taps. Search debounce is for the **query**, not for showing the search surface.
- Drag (compose minimize, chat dismiss, folder swipe) must update 1:1 while the finger is down — don't animate only at gesture end.

## 2. Direct manipulation — 1:1 tracking

Touch and content move together. Respect grab offset (compose grabber, chat sheet).

```swift
// Track translation from the drag; apply to the presented overlay.
DragGesture()
    .onChanged { value in offset = value.translation.height }
    .onEnded { value in
        // spring back or dismiss using velocity, not only distance
    }
```

```kotlin
// Prefer AnchoredDraggable / draggable where a sheet already does this (chat).
// On release, spring to the nearest anchor with the gesture's velocity.
```

Do not snap the grabbed point to the view's center.

## 3. Interruptibility

Never lock out input during a transition. Animate from the **presentation** value. SwiftUI/`withAnimation` and Compose `Animatable`/`animate*AsState` retarget; don't cancel and restart a keyframe from zero for toasts or compose expand.

When a gesture reverses, keep velocity (chat drag-to-dismiss, compose dock).

## 4. Behavior over animation — springs

Inboxies default chrome spring (slightly underdamped, matches existing dock/toast):

| Platform | Config |
| --- | --- |
| SwiftUI | `.spring(response: 0.32, dampingFraction: 0.86)` |
| Compose | `spring(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow)` |

Apple's designer parameters: **damping ratio** (1.0 = no bounce; lower = bouncier) and **response** (seconds to settle, not a CSS duration).

WWDC-style starting points vs this app:

| Interaction | Apple talk | Inboxies ships |
| --- | --- | --- |
| Default UI | damping 1.0, response 0.3–0.4 | **0.86 / 0.32** (chrome) |
| Drawer / sheet | 0.8 / 0.3 | system `.sheet` / `ModalBottomSheet`, or chrome spring |
| Tab change | — | iOS `duration 0.42, bounce 0.18` |
| Momentum flick | ~0.8 damping | chat / compose drag |

Don't add bounce to a settings fade just because Apple listed 0.8 for drawers. Overshoot belongs on **momentum** gestures.

## 5–6. Velocity handoff and momentum projection

On gesture end, continue at finger velocity. Project resting position, then snap to the nearest target (dismiss vs rest) — chat sheet and compose dock already think this way. A flick should dismiss without crossing a huge distance threshold.

## 7. Spatial consistency

Enter and exit along the same path. Toast/dock: bottom both ways. Compose minimize **keeps the composer on screen** (dock) instead of dismissing. iOS 18 zoom (`navigationTransition(.zoom)`) ties Ask AI / Compose / email actions to their bar/source.

Folder swipe is **direction-aware**: forward vs back offsets are mirrored (±28 insert, ±18 remove).

Menus (`Menu` / `InboxiesMenu`) originate at the trigger. Full-screen sheets stay centered.

## 8. Hint in the direction of the gesture

In-between frames should telegraph the outcome (compose overlay highlight follows the finger; folder content slides the way the swipe is going).

## 9. Rubber-banding

Soft boundaries, not brick walls. System scroll already rubber-bands lists. Custom drags (chat) should resist past the rest position rather than clamp hard.

## 10. Gesture checklist

- Tap: highlight on down, commit on up, cancel if dragged away.
- Folder swipe: hysteresis (~40.dp on Android) before committing direction, then track.
- Detect plausible gestures in parallel; don't wait for a discrete `swipeleft` with no tracking.
- Compose long-press: medium impact haptic when the overlay appears.

## 11. Frame-level smoothness

Animate offset/scale/opacity. Avoid layout-property animation except the chrome the app already grows (dock, select bar). Prefer the existing springs over a new timeline.

## 12. Materials and depth

This is how Inboxies implements Apple-style translucency:

| Layer | iOS | Android |
| --- | --- | --- |
| Floating chrome | `.liquidGlass` — iOS 26 `glassEffect`, else ultraThinMaterial + hairline + shadow | `Modifier.liquidGlass` frost 92% + hairline + shadow (no real blur) |
| Home title fade | `ProgressiveBlurBackground` ultraThinMaterial mask | gradient fade of `background` |
| Toasts | `.regularMaterial` capsule | matching capsule + elevation |
| Sheets | system sheet / material | `ModalBottomSheet` + `modalScrim` 22% |

Never stack two light glass surfaces. Content scrolls under home chrome. Don't replace glass with an opaque bar.

## 13. Haptics

Causality, same moment as the visual, utility only.

Existing: `.sensoryFeedback(.success/.selection)`; `UIImpactFeedbackGenerator` light (contact pill) / medium (compose long-press); Android long-press + `CLOCK_TICK` on highlight.

Don't haptic every row tap.

## 14. Reduced motion and accessibility

`accessibilityReduceMotion` / Android reduce-motion: cross-fade instead of large slides; drop zoom and bounce; keep opacity. If reduce-transparency exists, make glass more opaque (raise surface alpha, drop blur).

Theme changes (System / Light / Dark) should not strobe; `ThemeMode` already drives both apps.

## 15. Typography

Inboxies uses **Inter**, not SF, with **fixed point sizes** from `AppTheme` / `AppThemeDims` (list tracking `0.25`). Do not "fix" this by switching to SF Pro. Do not apply one tracking value to the 34pt home title and 10pt dates alike — follow the token tables.

## 16. Design foundations (WWDC)

Purpose, agency (undo toasts, confirm only when destructive), responsibility, familiarity (Mail-like minimize, Notion rows), flexibility (light/dark), simplicity not minimalism, craft, delight as a result.

Wayfinding: home large title + subtitle; floating Ask AI + Compose; settings as a sheet. Don't trap the user in compose — minimize, don't lose the draft.

## Quick reference

| Need | Inboxies value |
| --- | --- |
| Default spring | iOS `0.32 / 0.86`; Android `0.86` + `StiffnessMediumLow` |
| Tab change | iOS `0.42 / bounce 0.18` + ±28/±18 |
| Pressed row | opacity 0.55 |
| Glass | `liquidGlass` / `HomeChromeMetrics.chromeCornerRadius` 50 |
| Zoom | iOS 18 `navigationTransition(.zoom)` only |
| Undo | existing capsule toast, `accent` |
