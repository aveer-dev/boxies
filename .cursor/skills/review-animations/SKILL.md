---
name: review-animations
description: Review Inboxies iOS/Android animation and motion against Emil Kowalski's craft bar, using this app's springs and tokens. Default to flagging; approval is earned. Use when explicitly asked to review motion, or when auditing a UI diff for animation quality. Does not write features.
disable-model-invocation: true
---

# Reviewing Animations (Inboxies)

Adapted from Emil Kowalski's [review-animations](https://github.com/emilkowalski/skills). Same method; standards mapped to SwiftUI and Compose. Precise values live in [STANDARDS.md](STANDARDS.md).

Copyright (c) 2026 Emil Kowalski. MIT License. See `.cursor/skills/NOTICE`.

Load `inboxies-ios-ui` or `inboxies-android-ui` when the diff touches chrome or tokens.

## Operating posture

Bias toward motion that **feels right**. A transition that runs but is sluggish, comes from nowhere, fires too often, or fights `AppTheme` springs is a regression. Default to flagging.

If asked to review general (non-motion) code, decline and use a general review.

## The ten non-negotiable standards

1. **Justified motion.** Why: spatial consistency, state indication, feedback, explanation, or preventing a jarring change.
2. **Frequency-appropriate.** 100+/day → no animation. Tens/day → near-imperceptible. Occasional → Inboxies chrome spring. Rare → delight allowed.
3. **Responsive easing.** Enter/exit uses the chrome spring or ease-out. **`.easeIn` / EaseIn on UI is a block.**
4. **Sub-300ms UI** unless it's the existing 0.32-response spring or the 0.42 tab spring. A 400ms linear sheet is a finding.
5. **Origin and physical correctness.** Menus/overlays from the trigger. Never `scaleEffect(0)` / `scale(0f)`. Sheets/modals stay centered.
6. **Interruptibility.** Toasts, toggles, compose expand must retarget (implicit animation / spring), not restart from zero.
7. **GPU-friendly properties.** Offset, scale, opacity. Layout size only where this app already animates chrome (dock, select bar).
8. **Accessibility.** Reduced motion honored (gentler, not zero).
9. **Asymmetric enter/exit** on hold vs release. Folder tabs already use ±28 vs ±18 — don't symmetrize that by accident.
10. **Cohesion.** Match Inboxies: Notion-calm, Inter, liquid glass, `0.32 / 0.86`. A bouncy confetti send button in this mail client is a finding.

## Aggressive escalation

Flag on sight:

- `.easeIn` / `FastOutLinearInEasing` on UI
- `scaleEffect(0)` / `scale(0f)` / pure-fade with no spatial path on a sheet that should slide
- New cubic-bezier, Motion.dev, Lottie, Reanimated, Sonner
- `TabView` / `NavHost` introduced for a transition
- Animation on typing or scroll
- UI duration > 300ms with no reason and not an existing Inboxies spring
- Keyframe/`repeatForever` on a toast (skeleton pulse on placeholders is OK)
- Animating width/padding of a mail row
- Missing haptics on compose long-press (medium impact / confirm) when that overlay is new
- Spring constants that don't match the table in STANDARDS.md

## Remedial hierarchy

1. Delete the animation
2. Reduce it
3. Swap to chrome spring / ease-out
4. Fix origin / replace scale(0)
5. Make it interruptible
6. Move to offset/opacity
7. Asymmetric timing
8. Polish (existing tab offsets, glass, stagger only on rare overlays)
9. Reduced motion + cohesion with `AppTheme`

## Required output

### Part 1 — Findings table (REQUIRED)

| Before | After | Why |
| --- | --- | --- |
| `.easeIn(duration: 0.3)` on sheet | `.spring(response: 0.32, dampingFraction: 0.86)` | ease-in delays the watched moment; use app tokens |

### Part 2 — Verdict (REQUIRED)

Group by: feel-breaking, missed simplifications, performance, interruptibility, origin/cohesion, accessibility. Close with **Block** or **Approve**.

Cite `file:line`. Pull exact springs from STANDARDS.md, never approximate.

**Block** if: feel-breaking easing, high-frequency animation, scale(0), ease-in on UI, or an easy GPU fix left on the table.

**Approve** if: no feel-breaking issues, nothing obvious to delete, durations/springs in bounds, interruptibility where needed, reduced motion respected.

## Platform evidence

When the diff touches both clients (or Android alone), do **not** approve on iOS Simulator screenshots alone. For Android, use the DEBUG preview harness (`android/scripts/run-debug-preview.sh` / intent extras documented in `inboxies-android-ui`) so motion is felt on an emulator/device the same way iOS launch args are used.
