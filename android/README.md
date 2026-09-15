# Inboxies — Android

Native Jetpack Compose client for the Cloudflare [Agentic Inbox](../README.md) backend.

Designed for people coming from **web / Ionic / Capacitor**: Compose screens ≈ React components, `StateFlow` stores ≈ Zustand/context, `suspend` + OkHttp ≈ `fetch`.

**UI for agents:** follow [`.cursor/skills/inboxies-android-ui`](../.cursor/skills/inboxies-android-ui/SKILL.md) (tokens, chrome, navigation, iOS parity). Do not use Material You / Navigation Compose for app IA.

## What’s included

- **Google Sign-In** → backend exchanges the Google ID token for a mobile session JWT (`Authorization: Bearer …`) via `/api/v1/auth/google`
- **Dev login** (DEBUG builds, local API only) against `/api/v1/auth/dev` while running the Worker locally
- **Notion-inspired shell**: large-title nav with mailbox avatar, swipe between folders (For you / Inbox / Promotions / Updates / Sent / Drafts / Archive / Spam / Trash), long-press compose action list, floating Ask AI + Compose bar
- **Email list + detail**, HTML body via `WebView`
- **Search**, **AI chat** via WebSocket `/agents/email-agent/{mailbox}::{conversationId}`
- **Compose** (new / reply / reply-all / forward / draft) with minimize dock
- **Inbox digest** (“For you”) from `/inbox-digest`
- **FCM push** (optional — requires `google-services.json`)

## Open in Android Studio

1. Install Android Studio (API 34+ / SDK 35).
2. Open the `android/` directory as a Gradle project.
3. Confirm application id `co.inboxies.app`.
4. On the sign-in screen, set **API base URL**:
   - **Emulator** → `http://10.0.2.2:5173` when `pnpm dev` is running on the host machine (this is the default in debug builds).
   - **Physical device** → your machine’s LAN IP, e.g. `http://192.168.1.10:5173`.
   - **Production** → `https://inboxies.email` (only after Access bypass below).

### Cloudflare Access (required for production)

`inboxies.email` is behind Cloudflare Access. The Android app cannot complete an Access browser login, so Access intercepts `/api/v1/auth/google` and returns HTML — that shows up as a JSON decode error.

In **Zero Trust → Access → Applications**, keep Access on the web UI and add more-specific Bypass apps so the Worker (not Access) authenticates the API:

| Application path | Policy |
|---|---|
| `inboxies.email/api/*` | **Bypass**, Include **Everyone** |
| `inboxies.email/agents/*` | **Bypass**, Include **Everyone** (AI chat WebSocket) |

### Google OAuth

1. Create an OAuth 2.0 **Web client** in Google Cloud Console (used as the server client id for Credential Manager).
2. Create an **Android** OAuth client with package `co.inboxies.app` and your signing-cert SHA-1.
3. Put the Web client id in `android/local.properties`:

```properties
sdk.dir=/path/to/Android/Sdk
GOOGLE_WEB_CLIENT_ID=xxxxxx.apps.googleusercontent.com
```

4. Worker secret: `GOOGLE_CLIENT_ID` (or whatever the Worker expects for Google token `aud`) plus `MOBILE_JWT_SECRET`.

### FCM (optional)

1. Copy `app/google-services.json.example` → `app/google-services.json` and replace with a real Firebase Android app config for `co.inboxies.app`.
2. Rebuild — `BuildConfig.HAS_GOOGLE_SERVICES` becomes `true` and the Google Services Gradle plugin is applied.
3. Without `google-services.json`, push registration is a no-op and the app still builds.

## Backend secrets for mobile

| Secret | Purpose |
|--------|---------|
| `GOOGLE_CLIENT_ID` | Google ID token audience (Web client id) |
| `MOBILE_JWT_SECRET` | HS256 secret for mobile session JWTs |
| `APPLE_CLIENT_ID` | iOS only |

## Mental model (web → native)

| Web / Ionic | Android |
|-------------|---------|
| React route | Compose screen |
| Zustand store | `StateFlow` + `CompositionLocal` |
| `fetch` / React Query | `ApiClient` + coroutines |
| `useComposeForm` | `ComposeFormModel` + `ComposeSession` |
| Agents SDK `useAgentChat` | `AgentChatClient` (WebSocket `cf_agent_*`) |
| Capacitor Preferences | EncryptedSharedPreferences |

## Folder map

```
app/src/main/java/co/inboxies/app/
  InboxiesApp.kt / MainActivity.kt
  config/AppConfig.kt
  models/
  services/   # API, auth, app state, compose, agent WS, Room, FCM
  ui/         # Auth, Home, Email, Compose, Search, Chat, Settings
  theme/      # Notion-like palette + Inter
  util/       # shared TS ports (reply recipients, compose body)
```

## Build

```bash
cd android
export ANDROID_HOME=/path/to/Android/Sdk
./gradlew :app:assembleDebug
```

Debug APK: `app/build/outputs/apk/debug/app-debug.apk`
