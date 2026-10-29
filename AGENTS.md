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
| Cloudflare Email Service & Routing | `cloudflare-email-service` |
| Cloudflare Workers best practices & runtime patterns | `workers-best-practices` |
| Cloudflare Agents SDK & stateful AI agents | `agents-sdk` |
| Cloudflare Durable Objects & SQLite coordination | `durable-objects` |
| Wrangler CLI, config, & migrations | `wrangler` |
| Cloudflare products catalog & docs index | `cloudflare` |

**Do not** install `animate-expo`, `ask-sonner`, or `pick-ui-library` from [emilkowalski/skills](https://github.com/emilkowalski/skills). This repo is not React Native, not Sonner, and does not add web UI kits.

Adapted Emil skills keep MIT copyright; Cloudflare skills keep Apache 2.0 copyright; see `.cursor/skills/NOTICE`.

## Native UI rules (short)

- Tokens: `AppTheme` / `LiquidGlass` (iOS), `InboxiesColors` / `HomeChromeMetrics` (Android). Extend, don't fork.
- Default spring: iOS `.spring(response: 0.32, dampingFraction: 0.86)`; Android `dampingRatio = 0.86f` + `StiffnessMediumLow`.
- No `TabView` IA on iOS. No `NavHost` IA on Android (Navigation Compose is not a dependency).
- Visual changes land on **both** clients unless the task is explicitly one platform.
- Web `app/` is a separate Tailwind/React surface — these mobile skills do not apply there.
- **DEBUG previews:** iOS Simulator launch args (`-previewDomainAdmin`, `-previewMailbox`, …) and Android intent extras / `android/scripts/run-debug-preview.sh` are peers. For cross-platform UI review, exercise **both** — see `inboxies-android-ui` “DEBUG preview harness” and iOS `PreviewSupport.swift`.

## Tooling

Use **pnpm** for JS/Worker work. iOS: Xcode + `ios/AgenticInbox`. Android: Gradle from `android/`. Android DEBUG previews: `cd android && INSTALL=1 ./scripts/run-debug-preview.sh <mode>`.

## Production secrets (`agentic-inbox` Worker)

Change production secrets **only** by deploying code with them, from a clean, up-to-date `dev` checkout (`git status` empty, `git pull --ff-only`):

```bash
pnpm install --frozen-lockfile && pnpm run ensure-queues && pnpm run build
pnpm wrangler deploy --secrets-file <file>
```

`<file>` is JSON or `.env` (`NAME=value`), kept outside the repo and deleted afterwards. It is additive: secrets not in the file keep their values.

**Never** change production secrets in the dashboard (Variables & Secrets), with `wrangler versions secret put` + `versions deploy`, or with `wrangler secret put`. This overrides the `wrangler` skill's `versions secret` advice. Each of those builds the new version on the Worker's **newest uploaded** version, not the live one, and Workers Builds uploads an undeployed version for every push to a branch other than `main`. On 2026-10-28 a dashboard secret edit shipped an unmerged branch build to production this way.

Pushes to `main` also deploy production, through Workers Builds (`pnpm run deploy`). Sessions do not run `wrangler deploy`, `versions upload` or secret commands against `agentic-inbox` unless the user asks.
