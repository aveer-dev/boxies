# Inboxies — Android

Native Jetpack Compose client for the Cloudflare [Agentic Inbox](../README.md) backend.

Designed for people coming from **web / Ionic / Capacitor**: Compose screens ≈ React components, `StateFlow` stores ≈ Zustand/context, `suspend` + OkHttp ≈ `fetch`.

**UI for agents:** follow [`.cursor/skills/inboxies-android-ui`](../.cursor/skills/inboxies-android-ui/SKILL.md) (tokens, chrome, navigation, iOS parity). Do not use Material You / Navigation Compose for app IA.

## What’s included

- **Sign in with Google, email + password (with two-factor) or a passkey** → the Worker answers with a [Better Auth](https://www.better-auth.com/) session token, which the app sends as `Authorization: Bearer …`. Sign in with Apple is iOS and web only.
- **Dev login** (DEBUG builds, local API only) against `/api/v1/auth/dev`, which exists only while the Worker runs under `pnpm dev`
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
4. The app talks to `https://inboxies.email` (`BuildConfig.DEFAULT_API_BASE`, the same in debug and release). See [API base URL](#api-base-url) to point a debug build somewhere else.

### API base URL

- **Production:** `https://inboxies.email`, the default. That host serves mail and the native apps' API; its web pages redirect to the web app at `inboxies.app`. Release builds always use it and ignore any stored override.
- **Another deployed Worker (DEBUG builds):** tap the logo on the welcome screen five times to show the API base field, or launch with `adb shell am start -n co.inboxies.app/.MainActivity --ez showApiBase true`. You can also pass the URL directly with `--es apiBase https://…`. Use an HTTPS origin.
- **Local Worker:** not reachable from a debug build right now. The API base field and the `apiBase` extra drop `localhost`, `127.0.0.1` and `10.0.2.2` and go back to the default, and debug builds allow cleartext HTTP only to those hosts, so neither `http://10.0.2.2:5173` nor a LAN IP reaches `pnpm dev`. Dev login appears only with a local API base, so it is unreachable too. Use the iOS Simulator (see [`ios/README.md`](../ios/README.md#api-base-url)) to test against a local Worker.

### How the app signs in

The app signs in through the Worker's own auth, not Cloudflare Access. Sign-in calls `/api/v1/auth/google` or `/api/v1/auth/password` (passkeys use Better Auth's `/api/auth/passkey/*`). The Worker checks the credential with Better Auth, stores the user and session in D1 (`AUTH_DB`), and returns a session token. The app sends that token as `Authorization: Bearer …` on `/api/*` and on the assistant's WebSocket under `/agents/*`.

Cloudflare Access (`POLICY_AUD`, `TEAM_DOMAIN`) only guards the operator tools under `/ops/*`. Don't put Access in front of `/api/*`, `/agents/*` or the sign-in pages: the app can't complete an Access login, and Access would answer its requests with an HTML login page.

### Google OAuth

1. Create an OAuth 2.0 **Web client** in Google Cloud Console (used as the server client id for Credential Manager).
2. Create an **Android** OAuth client with package `co.inboxies.app` and your signing-cert SHA-1.
3. Put the Web client id in `android/local.properties`:

```properties
sdk.dir=/path/to/Android/Sdk
GOOGLE_WEB_CLIENT_ID=xxxxxx.apps.googleusercontent.com
```

4. On the Worker, set `GOOGLE_CLIENT_ID` to the same Web client id. The app passes it to Credential Manager as the server client id, so it is the ID token's `aud`.

[`docs/google-auth-setup.md`](../docs/google-auth-setup.md) has the full walkthrough, including the SHA-1 fingerprints for the upload and Play App Signing keys.

### FCM (optional)

1. Copy `app/google-services.json.example` → `app/google-services.json` and replace with a real Firebase Android app config for `co.inboxies.app`.
2. Rebuild — `BuildConfig.HAS_GOOGLE_SERVICES` becomes `true` and the Google Services Gradle plugin is applied.
3. Without `google-services.json`, push registration is a no-op and the app still builds.

The Worker sends **data-only** FCM messages, so the app always builds the notification itself
(channel `inboxies_mail`, created at app start) and drops pushes while notifications are off,
when signed out, or for a mailbox the user no longer has. With notifications on, the device
token is registered for every mailbox the user has; turning them off unregisters all of them.

## Worker config for Android

Set these on the Worker the way the [root README](../README.md#5-set-secrets-and-deploy) describes (`wrangler deploy --secrets-file`), and in `.dev.vars` for local dev (see `.dev.vars.example`):

| Name | Purpose |
|------|---------|
| `BETTER_AUTH_SECRET` | Required for every sign-in method. Better Auth's signing secret (32+ random bytes) |
| `GOOGLE_CLIENT_ID` | Google ID token audience (the Web client id). Unset, `/api/v1/auth/google` returns 503. Extra accepted client ids go in `GOOGLE_EXTRA_CLIENT_IDS` |
| `PASSKEY_EXTRA_ORIGINS` | Android passkeys: `android:apk-key-hash:<base64url SHA-256 of the signing cert>`, comma-separated. A var in `wrangler.jsonc`, not a secret |
| `FCM_SERVICE_ACCOUNT_JSON` | Firebase service-account JSON (one line) for FCM push |

Passkeys also need `public/.well-known/assetlinks.json` to list the SHA-256 fingerprint of the key that signs installed builds (the Play App Signing key for Play installs).

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

### Release (R8 + signing)

`./gradlew :app:assembleRelease` (or `:app:bundleRelease`) minifies and shrinks with R8
(`app/proguard-rules.pro`; the mapping lands in `app/build/outputs/mapping/release/`).

Release signing uses the Play **upload key**, read from Gradle properties
(`~/.gradle/gradle.properties` or `-P…`) or environment variables of the same name:

| Name | Value |
|------|-------|
| `INBOXIES_UPLOAD_STORE_FILE` | Path to the upload keystore (`.jks`) |
| `INBOXIES_UPLOAD_STORE_PASSWORD` | Keystore password |
| `INBOXIES_UPLOAD_KEY_ALIAS` | Key alias |
| `INBOXIES_UPLOAD_KEY_PASSWORD` | Key password |

When any of them is missing the release still assembles, unsigned
(`app-release-unsigned.apk`). Never commit a keystore. To smoke-test a release build on an
emulator, sign the unsigned APK with the debug key:

```bash
$ANDROID_HOME/build-tools/<version>/apksigner sign --ks ~/.android/debug.keystore \
  --ks-pass pass:android --ks-key-alias androiddebugkey \
  --out /tmp/app-release-debugsigned.apk app/build/outputs/apk/release/app-release-unsigned.apk
adb install -r /tmp/app-release-debugsigned.apk
```

## DEBUG preview harness (emulator)

Offline UI surfaces for review — same role as iOS Simulator launch args (`-previewDomainAdmin`, …). **DEBUG builds only.**

```bash
cd android
./gradlew :app:assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk
./scripts/run-debug-preview.sh domainAdmin      # Domain Admin console
./scripts/run-debug-preview.sh passwordSignIn   # Password form on Sign In
./scripts/run-debug-preview.sh inviteAccept     # Accept-invite form
./scripts/run-debug-preview.sh mailbox          # Inbox New/Seen fixtures
./scripts/run-debug-preview.sh loadMore         # Inbox with more pages (bottom skeleton row)
./scripts/run-debug-preview.sh loadFailed       # First mailbox load failed (Retry / Sign out)
./scripts/run-debug-preview.sh listError        # Inbox fetch failed, empty cache (Retry)
./scripts/run-debug-preview.sh screener         # Screener + detail
./scripts/run-debug-preview.sh replyLater       # Reply Later pile
# Or: INSTALL=1 ./scripts/run-debug-preview.sh mailbox
```

Raw adb: `adb shell am start -n co.inboxies.app/.MainActivity --ez previewDomainAdmin true`  
(or `-e preview mailbox`). See `.cursor/skills/inboxies-android-ui` for the full mode table.
