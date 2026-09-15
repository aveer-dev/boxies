# Animation Audit Playbook (Inboxies)

Eight categories with Inboxies target values. Never approximate a spring that appears here — copy it. Distilled from Emil Kowalski's philosophy; mapped off CSS/Motion.dev onto SwiftUI/Compose.

Copyright (c) 2026 Emil Kowalski. MIT License. See `.cursor/skills/NOTICE`.

## 1. Purpose & frequency

Same table as STANDARDS.md. Hunt: extra animation on folder tabs, list hover-equivalents, keyboard/search field. Strongest fix is often **delete**.

## 2. Easing & duration

- Enter/exit → chrome spring or ease-out
- On-screen move → ease-in-out / existing tab spring
- Color/press → implicit, or opacity 0.55
- Spinner → linear
- **`.easeIn` / EaseIn on UI is always a finding**

Canonical springs:

```swift
.spring(response: 0.32, dampingFraction: 0.86) // chrome, toast, dock
.spring(response: 0.32, dampingFraction: 0.88) // compose expand
.spring(response: 0.28, dampingFraction: 0.82) // select mode
.spring(response: 0.28, dampingFraction: 0.84) // compose-action rows
.spring(duration: 0.42, bounce: 0.18)          // folder tabs
```

```kotlin
spring(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow)
```

Timing already in app: search `easeInOut 0.28`, auth `0.2` / fade, skeleton 0.95s / 950ms.

UI timing (non-spring) **under 300ms**. Don't introduce cubic-bezier tokens.

## 3. Physicality & origin

- Never `scaleEffect(0)` / `scale(0f)` → `0.95` + opacity 0
- Menus / compose-action overlay from trigger
- Email/settings sheets centered — do not report center origin on those
- Pressed row opacity 0.55

## 4. Interruptibility

Springs and `.animation(_:value:)` / `animate*AsState`. Hunt: toast animations that restart from 0 on every new id; gesture sheets that ignore velocity; symmetric ±28 both ways on tabs (removal should stay ±18).

Hold-to-confirm slow; release snap.

## 5. Performance

Offset/scale/opacity. Mail-row layout animation is a finding. `animateContentSize` OK on select bar and compose dock. No Framer `x`/`y` shorthands (N/A). No `transition: all`.

## 6. Accessibility

`accessibilityReduceMotion` / Android reduce-motion: keep opacity, drop large travel and zoom. Hunt: zoom transitions with no reduce-motion branch; infinite skeleton pulse that doesn't pause when reduce-motion is on (LOW unless nauseating).

## 7. Cohesion & tokens

One motion system. Duplicate near-identical springs should consolidate to a named helper. Personality: calm, not playful bounce on send. Stagger only on compose-action overlay (30–80ms). Cross-platform: if iOS uses `0.32 / 0.86` and Android uses a default tween, that's a cohesion finding.

## 8. Missed opportunities

Teleporting overlays, toasts without a bottom path, rare empty/success moments. Report a handful, not a wishlist. Don't suggest animating the inbox list.
