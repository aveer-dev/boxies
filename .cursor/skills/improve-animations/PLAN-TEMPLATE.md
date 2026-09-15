# Plan Template (Inboxies)

Every `improve-animations` plan follows this structure. The executor has zero extra context.

```markdown
# NNN — <Short imperative title>

- **Status**: TODO
- **Commit**: <git rev-parse --short HEAD>
- **Severity**: HIGH | MEDIUM | LOW
- **Category**: <AUDIT.md category>
- **Estimated scope**: <n files>

## Problem

What is wrong, where, and why it matters. Cite `path/to/File.swift:123` and paste the current snippet.

## Target

Exact end state. Spell springs out:

```swift
.spring(response: 0.32, dampingFraction: 0.86)
```

```kotlin
spring(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow)
```

Never "use a nicer easing."

## Repo conventions to follow

- iOS tokens: `AppTheme`, `HomeChromeMetrics`, `.liquidGlass`
- Android tokens: `InboxiesColors` / `inboxiesColors()`, `HomeChromeMetrics`, `Modifier.liquidGlass`
- Motion: match `HomeShellView` / existing `selectModeSpring()`
- Exemplar: `<file:line that already does this correctly>`

## Steps

1. <One concrete edit per step.>
2. …

## Boundaries

- Do NOT touch files out of scope.
- Do NOT add CSS, Motion.dev, Lottie, Sonner, Navigation Compose, or TabView.
- Do NOT invent a new palette.
- If the code drifted from the commit stamp, STOP and report.

## Verification

- **Mechanical**: iOS — build the Inboxies scheme if Xcode is available; Android — `./gradlew :app:assembleDebug` from `android/`.
- **Feel check**: trigger <interaction> on a simulator/emulator/device:
  - <observable, e.g. dock springs with the chrome spring, not ease-in>
  - spam the action — animation retargets, does not jump to 0
  - reduced motion — large travel dropped, opacity remains
- **Done when**: <checkable criteria>
```

## Notes for the author

- One plan per finding unless the same helper swap applies to several files.
- Pull values from AUDIT.md / STANDARDS.md.
- Feel-check is required.
- After writing plans, update `plans/README.md` (number, title, severity, status, order).
