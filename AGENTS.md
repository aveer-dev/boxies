# Agent notes

Inboxies is a Cloudflare Workers email client with a React web app plus native **iOS (SwiftUI)** and **Android (Jetpack Compose)** clients. Those two native apps are design twins: Notion-inspired Inter chrome, calm blue accent, flat mail rows, pill liquid-glass bars, sheets/overlays — **not** Apple Mail, **not** Material You.

## Skills (`.cursor/skills/`)

Load the matching skill before changing native UI.

| Work | Skill |
| --- | --- |
| iOS UI, layout, chrome, theming, lists, sheets | `inboxies-ios-ui` |
| Android UI (same surfaces) | `inboxies-android-ui` |
| Swift language (not look-and-feel) | `write-swift` — honor the Swift **5.10 / iOS 17** overlay |
| Polish / whether to animate | `emil-design-eng`, `animate`, `apple-design` |
| “What's this motion called?” | `animation-vocabulary` |
| Explicit review / audit / hunt / prototype variants | `review-animations`, `improve-animations`, `find-animation-opportunities`, `prototype` (`disable-model-invocation` — only when asked) |

**Do not** install `animate-expo`, `ask-sonner`, or `pick-ui-library` from [emilkowalski/skills](https://github.com/emilkowalski/skills). This repo is not React Native, not Sonner, and does not add web UI kits.

Adapted Emil skills keep MIT copyright; see `.cursor/skills/NOTICE`.

## Native UI rules (short)

- Tokens: `AppTheme` / `LiquidGlass` (iOS), `InboxiesColors` / `HomeChromeMetrics` (Android). Extend, don't fork.
- Default spring: iOS `.spring(response: 0.32, dampingFraction: 0.86)`; Android `dampingRatio = 0.86f` + `StiffnessMediumLow`.
- No `TabView` IA on iOS. No `NavHost` IA on Android (the Navigation Compose dependency is unused).
- Visual changes land on **both** clients unless the task is explicitly one platform.
- Web `app/` is a separate Tailwind/React surface — these mobile skills do not apply there.

## Tooling

Use **pnpm** for JS/Worker work. iOS: Xcode + `ios/AgenticInbox`. Android: Gradle from `android/`.
