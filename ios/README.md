# Inboxies — iOS

Native SwiftUI client for the Cloudflare [Agentic Inbox](../../README.md) backend.

Designed for people coming from **web / Ionic / Capacitor**: SwiftUI views ≈ React components, `@Observable` stores ≈ Zustand/context, `async/await` + `URLSession` ≈ `fetch`.

**UI for agents:** follow [`.cursor/skills/inboxies-ios-ui`](../.cursor/skills/inboxies-ios-ui/SKILL.md) (tokens, chrome, navigation, motion). Do not invent Apple Mail styling.

## What’s included

### Phase 1 (MVP)
- **Sign in with Apple, Google, email + password (with two-factor) or a passkey** → the Worker answers with a [Better Auth](https://www.better-auth.com/) session token, which the app keeps in the Keychain and sends as `Authorization: Bearer …`
- **Dev login** (DEBUG builds only) against `/api/v1/auth/dev`, which exists only while the Worker runs under `pnpm dev`
- **Notion-inspired shell**: top folder pills (Inbox / Sent / Drafts / Archive / Trash / AI), floating Search + Ask AI bar
- **Email list + detail**, styled like Notion search rows
- **Search screen** with highlighted snippets
- **Multi-conversation AI chat** via WebSocket `/agents/email-agent/{mailbox}::{conversationId}`

### Phase 2
- **Mail-like compose interactions** (Notion look): drag grabber to **minimize** to a bottom dock (not dismiss); tap dock to expand
- **New / Reply / Reply All / Forward / Edit Draft** with save draft + send
- **Outbound attachments** (photo / camera / files) with client JPEG compression under the 5 MiB cap
- **Mail-like Format sheet** (Aa dock) on a rich `UITextView` editor; quoted original stays split
- **HTML body rendering** (`WKWebView`) and **attachment download** (Quick Look)
- Compose chrome uses `AppTheme` (not Apple Mail blue branding)

### Phase 3
- **Push notifications** (APNs)

## Open in Xcode

1. Install Xcode 26 or later. The app targets iOS 17 but uses iOS 26 APIs behind availability checks, so it needs the iOS 26 SDK.
2. Open `Inboxies.xcodeproj`.
3. Set your **Team** under Signing & Capabilities.
4. Confirm bundle ID `co.inboxies.app` (or change it — then set the Worker's `APPLE_CLIENT_ID` to match).
5. Capability **Sign in with Apple** is declared in `Inboxies.entitlements`.
6. The app talks to `https://inboxies.email` (`AppConfig.defaultAPIBaseURL`). See [API base URL](#api-base-url) to point it somewhere else.

### API base URL

- **Production:** `https://inboxies.email`, the default. That host serves mail and the native apps' API; its web pages redirect to the web app at `inboxies.app`.
- **Local Worker (Simulator):** run `pnpm dev` on the Mac and launch a DEBUG build with the argument `-apiBase http://127.0.0.1:5173` (Xcode: Edit Scheme → Run → Arguments). With a local API base the sign-in screen shows **Continue with Dev Login**.
- **Another deployed Worker:** in DEBUG builds, tap the welcome screen five times (or launch with `-showApiBase`) to show the API base field, and enter an HTTPS origin. The field drops `localhost`, `127.0.0.1` and `10.0.2.2` and goes back to the default.

### How the app signs in

The app signs in through the Worker's own auth, not Cloudflare Access. Sign-in calls `/api/v1/auth/apple`, `/api/v1/auth/google` or `/api/v1/auth/password` (passkeys use Better Auth's `/api/auth/passkey/*`). The Worker checks the credential with Better Auth, stores the user and session in D1 (`AUTH_DB`), and returns a session token. The app sends that token as `Authorization: Bearer …` on `/api/*` and on the assistant's WebSocket under `/agents/*`.

Cloudflare Access (`POLICY_AUD`, `TEAM_DOMAIN`) only guards the operator tools under `/ops/*`. Don't put Access in front of `/api/*`, `/agents/*` or the sign-in pages: the app can't complete an Access login, and Access would answer its requests with an HTML login page.

### Optional: XcodeGen

If you prefer regenerating the project from `project.yml`:

```bash
brew install xcodegen
cd ios/AgenticInbox
xcodegen generate
open Inboxies.xcodeproj
```

## Worker config for iOS

Set these on the Worker the way the [root README](../README.md#5-set-secrets-and-deploy) describes (`wrangler deploy --secrets-file`), and in `.dev.vars` for local dev (see `.dev.vars.example`):

| Name | Purpose |
|------|---------|
| `BETTER_AUTH_SECRET` | Required for every sign-in method. Better Auth's signing secret (32+ random bytes) |
| `APPLE_CLIENT_ID` | iOS bundle ID, the `aud` of Apple identity tokens. Unset, `/api/v1/auth/apple` returns 503 |
| `APPLE_TEAM_ID`, `APPLE_SIGNIN_KEY_ID`, `APPLE_SIGNIN_PRIVATE_KEY` | Sign in with Apple key, used to revoke Apple tokens when an account is deleted (App Store requirement) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_EXTRA_CLIENT_IDS` | Google sign-in. Add the iOS OAuth client ID to `GOOGLE_EXTRA_CLIENT_IDS`; see [`docs/google-auth-setup.md`](../docs/google-auth-setup.md) |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` | Push notifications. `APNS_TOPIC` and `APNS_SANDBOX` are vars in `wrangler.jsonc` |

Passkeys use `APP_BASE_URL`'s host as the relying party. The app's `webcredentials:inboxies.app` associated domain and `public/.well-known/apple-app-site-association` must name that host and your Team ID + bundle ID.

## Mental model (web → native)

| Web / Ionic | iOS |
|-------------|-----|
| React route | SwiftUI `View` |
| Zustand store | `@Observable` class + `.environment` |
| `fetch` / React Query | `APIClient` + `.task { await … }` |
| `useComposeForm` | `ComposeFormModel` + `ComposeSession` |
| Agents SDK `useAgentChat` | `AgentChatClient` (WebSocket `cf_agent_*`) |
| Capacitor Preferences | Keychain (`KeychainStore`) |

## Folder map

```
Inboxies/
  InboxiesApp.swift          # @main
  Config/AppConfig.swift     # API base URL, bundle ID
  Models/                    # Codable types matching backend JSON
  Services/                  # API, auth, app state, compose, agent WS
  Views/                     # Auth, Home, Email, Compose, Search, Chat
  Theme/                     # Notion-like light palette
```
