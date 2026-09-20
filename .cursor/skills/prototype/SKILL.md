---
name: prototype
description: Build multiple genuinely different versions of an Inboxies UI piece behind a native preview switcher (SwiftUI #Preview or Compose @Preview). Only runs when explicitly invoked. Does not trigger on its own. Never a web HTML picker.
disable-model-invocation: true
---

# Prototyping Variants (Inboxies)

Adapted from Emil Kowalski's [prototype](https://github.com/emilkowalski/skills). Same divergence rules. **The picker is native previews**, not a web HTML overlay.

Copyright (c) 2026 Emil Kowalski. MIT License. See `.cursor/skills/NOTICE`.

Load `inboxies-ios-ui` or `inboxies-android-ui` during recon so every variant uses real tokens.

## Operating posture

Divergence is the point: three tints of the same idea waste the picker. Each variant must be shippable on its own. Craft bar still applies (chrome spring, no ease-in, no scale(0), Inter, `AppTheme` / `InboxiesColors`).

## Hard rules

1. **Never touch production screens during exploration.** Isolated preview files only. Integration is Phase 6, winner only.
2. Variants diverge on a **named axis** (layout, density, motion, interaction). Sharing product tokens is required, not convergence.
3. Every variant fully works — realistic mail/chat copy, real springs, no lorem ipsum.
4. The switcher is chrome: `#Preview` names or a debug `enum` / `PreviewParameter`. Switching is **instant** (100+/session — no animation on the switch).
5. After a winner is promoted, delete the prototype files unless the user asks to keep them.

## Workflow

### Phase 1 — Scope

One component per run. If the brief is "the home screen," pick the highest-leverage piece (e.g. the floating Ask AI + Compose bar). Restate the brief in one sentence.

### Phase 2 — Recon

- **Stack:** SwiftUI `ios/` or Compose `android/`.
- **Tokens:** `AppTheme` / `HomeChromeMetrics` or `InboxiesColors` / `AppThemeDims`.
- **Personality:** calm Notion mail.
- **Context:** against `background`, under large title or above home chrome.

### Phase 3 — Directions

Default **3** variants, max 5. Name the axis ("Quiet chrome", "Dock-first compose", "Dense list"). Not Option A/B/C. If two differ only in accent, they are one direction.

### Phase 4 — Harness

**iOS** — new file under `ios/AgenticInbox/Inboxies/Views/Prototypes/` (create the group if needed). One `enum PrototypeVariant` + a container `View` that switches with a segmented control **only in the preview** (or separate `#Preview("Quiet")` blocks). Use `PreviewSupport` fixtures. Do not import the prototype from `HomeShellView`. For full-activity Simulator certainty (not Canvas-only), also launch with DEBUG args from `InboxiesApp` / `PreviewSupport` (`-previewMailbox`, `-previewDomainAdmin`, …).

**Android** — new file under `android/app/src/main/java/co/inboxies/app/ui/prototypes/`. `@Preview(name = "Quiet")` per variant, or `PreviewParameterProvider`. Wrap in `InboxiesTheme`. Prefer `ui/preview/PreviewSupport` fixtures. Do not reference from `HomeShellView`. For full-activity emulator certainty (required parity with iOS Simulator launch-arg reviews), use the DEBUG intent harness: `android/scripts/run-debug-preview.sh <mode>` or `adb … --ez previewMailbox true` — see `inboxies-android-ui` “DEBUG preview harness”.

Never a standalone HTML file. Never `/prototypes` web route. **Do not** treat iOS Simulator-only evidence as enough when the change also ships on Android — run the matching Android preview mode.

Render **one variant at a time, full size**, with realistic surroundings (a toast needs a home list behind it).

### Phase 5 — Hand off

Confirm each preview renders (or compile). Present:

| # | Variant | Axis | When it's right | Cost |
| --- | --- | --- | --- | --- |

Stop. The user chooses. Point at the preview names / file paths.

### Phase 6 — Promote

Integrate the winner using production conventions (`Views/<Feature>/` or `ui/<feature>/`), then delete `Views/Prototypes/` or `ui/prototypes/` files from this run.

## Invocation

| Invocation | Behavior |
| --- | --- |
| `prototype <thing>` | Full workflow, 3 variants |
| `prototype <thing> x5` | Up to 5 |
| `riff <variant>` | New round around that direction |
| `keep <variant>` | Promote and delete harness |
| `keep, leave the picker` | Promote, keep preview files |

## Tone

Sell each variant honestly. Don't pre-pick in the table. If two converged while building, cut one.
