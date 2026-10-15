# Enabling Google sign-in (AVE-56)

## How it works today

Inboxies does **not** use Firebase Authentication, and it shouldn't. The flow is:

1. A client gets a **Google ID token** (a JWT signed by Google) from Google's own SDK:
   - Android: Credential Manager (`GetGoogleIdOption`)
   - Web: Google Identity Services (the GIS button)
   - iOS: nothing yet
2. The client POSTs it to the Worker:
   - `POST /api/v1/auth/google {idToken}` to sign in
   - `POST /api/v1/me/identities/attach {provider:"google", idToken}` to connect it to the signed-in account
3. Better Auth ([`workers/auth/index.ts`](../workers/auth/index.ts)) checks the token against Google's JWKS. It requires the token's `aud` to be `GOOGLE_CLIENT_ID` or one of the IDs in `GOOGLE_EXTRA_CLIENT_IDS`.

Use Firebase only as a **console**: the Firebase project behind FCM is a Google Cloud project, and the console creates the OAuth clients for you. Don't call `FirebaseAuth.signInWithCredential` and send its token. Firebase ID tokens have `iss = securetoken.google.com/<project>` and `aud = <project-id>`, so the Worker rejects them.

### Status

| Where | State |
| --- | --- |
| Worker | Live: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_EXTRA_CLIENT_IDS` are in the deployed version, and `/api/v1/auth/google` (which also sets the web session cookie) rejects bad tokens with 401. Signed-out web visitors still hit Cloudflare Access before `/login`; bypass `/login`, `/assets/*`, `/*.data`, `/__manifest` and `/favicon.ico` (see `site/README.md`) to let them reach the Google button. |
| Android | Firebase project `inboxies-app` has the Android client (debug SHA-1) and the Web client. `GOOGLE_WEB_CLIENT_ID` can now come from `local.properties`, `-P` or an env var. Credential Manager failures are now shown instead of ignored. |
| iOS | Built: GoogleSignIn-iOS 9.x, a Google button beside Apple, and Settings → Connect Google. The client IDs are in `ios/AgenticInbox/project.yml` (they're public). |
| Web | Built: "Continue with Google" on `app/routes/login.tsx` (email step) and Settings → Connect Google. Both need `GOOGLE_CLIENT_ID` on the Worker. |

---

## Step by step

### 1. Pick the project and set up the consent screen (once)

1. Open the Firebase project that already serves FCM for `co.inboxies.app`. Click its **Google Cloud** link so you're in the same project.
2. Prove you own the domains. In [Google Search Console](https://search.google.com/search-console), signed in as an **Owner or Editor of this Cloud project**, add a **Domain** property for each of `inboxies.co` (the site) and `inboxies.app` (the web app). Search Console gives you a `google-site-verification=…` TXT record; add it at the zone apex in Cloudflare DNS (or use Search Console's Cloudflare shortcut), then click **Verify**. Wait 24 hours before asking Google to re-check branding.
3. Go to **Google Auth Platform → Branding** and use exactly these values:

   | Field | Value |
   | --- | --- |
   | App name | `Inboxies` (the name the home page shows) |
   | User support email | `support@inboxies.email` |
   | Application home page | `https://inboxies.co` |
   | Privacy policy | `https://inboxies.co/privacy` |
   | Terms of service | `https://inboxies.co/terms` |
   | Authorized domains | `inboxies.co`, `inboxies.app` |

   Why these values:
   - The home page must load for a signed-out visitor, say what the app does, and link the privacy policy. `inboxies.co` does all three; the web app at `inboxies.app` doesn't (it's behind Cloudflare Access).
   - The home page and privacy policy must be on the same domain, and that domain must be in **Authorized domains** and verified in Search Console. Otherwise Google reports "not a valid domain" or "not registered to you".
   - `inboxies.email` isn't listed: it only serves mail and the native apps' API, and its web pages redirect to `inboxies.app`, so no browser runs Google sign-in there.
   - The privacy policy has a [Sign in with Google](https://inboxies.co/legal#privacy-google) clause, with the Limited Use statement reviewers look for.
4. Under **Audience**, choose **External** and click **Publish app**. While the app is in *Testing*, only listed test users can sign in.
5. Under **Data access**, add only `openid`, `email` and `profile`. These scopes are non-sensitive, so they need brand verification but no security review.
6. Under **Verification Center**, request verification. If it fails, fix what it lists and wait 24 hours after any Search Console change before retrying.

### 2. Create the Web client (the server audience)

1. In Firebase, go to **Authentication → Sign-in method → Google → Enable**. Expand **Web SDK configuration** and copy the **Web client ID** and **secret**.
   - Enabling this provider is only a shortcut that creates *"Web client (auto created by Google Service)"*. Nothing calls Firebase Auth.
   - Instead, you can create it directly in **Cloud Console → APIs & Services → Credentials → Create OAuth client → Web application**.
2. Edit that client in Cloud Console. Under **Authorized JavaScript origins**, add these (GIS needs them):
   - `https://inboxies.app`
   - `http://localhost:5173`
   - `http://localhost`
3. Under **Authorized redirect URIs**, add `https://inboxies.app/api/auth/callback/google`. This is only needed if you ever use Better Auth's redirect flow. The ID-token flow doesn't use it, but adding it costs nothing.

### 3. Configure the Worker

```bash
wrangler secret put GOOGLE_CLIENT_ID
```

```bash
wrangler secret put GOOGLE_CLIENT_SECRET
```

```bash
wrangler secret put GOOGLE_EXTRA_CLIENT_IDS
```

- `GOOGLE_CLIENT_ID`: the Web client ID from step 2.
- `GOOGLE_CLIENT_SECRET`: its secret. The ID-token flow doesn't need it, but Better Auth's redirect flow does.
- `GOOGLE_EXTRA_CLIENT_IDS`: the iOS client ID from step 5, comma-separated. Leave it empty until iOS exists.

For local dev, set the same values in `.dev.vars` (see `.dev.vars.example`).

Check that **Zero Trust → Access** bypasses `inboxies.email/api/*` (see [`android/README.md`](../android/README.md#cloudflare-access-required-for-production)). Otherwise mobile calls get the Access HTML page back.

**Verify:**

```bash
curl -s https://inboxies.email/api/v1/config
```

`googleClientId` should now be the Web client ID.

```bash
curl -s -X POST https://inboxies.email/api/v1/auth/google -H 'content-type: application/json' -d '{"idToken":"x"}'
```

This should return **401** "Invalid Google identity token", not 503.

### 4. Android

1. In Firebase, go to **Project settings → Your apps → `co.inboxies.app` → Add fingerprint**. Add the **SHA-1** of each signing key:
   - **Debug keystore**: run `cd android && ./gradlew signingReport`.
   - **Upload key**: the release keystore.
   - **Play App Signing key**: in Play Console → *Test and release → App integrity*. Builds installed from Play are signed with this key, not your upload key. When it's missing, Google sign-in works locally but fails from Play.

   Each fingerprint creates an **Android OAuth client** for you. Without one, Credential Manager fails with `NoCredentialException` or *"[28444] Developer console is not set up correctly"*.
2. Download a fresh `google-services.json` to `android/app/`. It's gitignored and now includes the `oauth_client` entries.
3. Put the **Web** client ID (not the Android one) in `android/local.properties` as `GOOGLE_WEB_CLIENT_ID=…`. The app passes it as `setServerClientId`, so the token's `aud` equals `GOOGLE_CLIENT_ID` and the Worker accepts it with no extra IDs.
4. For release and CI builds, pass `-PGOOGLE_WEB_CLIENT_ID=…` or set the `GOOGLE_WEB_CLIENT_ID` env var. `local.properties` is only read locally. The client ID isn't secret.
5. Test on a device that has a Google account.

### 5. iOS (done; this is how it works)

1. Get an iOS client: in Firebase, **Add app → iOS**, bundle ID `co.inboxies.app`, then download `GoogleService-Info.plist`. It has `CLIENT_ID` and `REVERSED_CLIENT_ID`. Or create an **iOS** OAuth client in Cloud Console. You don't need the Firebase SDK.
2. Add the iOS client ID to `GOOGLE_EXTRA_CLIENT_IDS` on the Worker (step 3). This guarantees `aud` matches whatever the SDK puts there.
3. Add the [GoogleSignIn-iOS](https://github.com/google/GoogleSignIn-iOS) package to `project.yml`. In the Info.plist keys, set:
   - `GIDClientID` = the iOS client ID
   - `GIDServerClientID` = the Web client ID
   - a **URL type** whose scheme is `REVERSED_CLIENT_ID`
4. In the app root, add `.onOpenURL { GIDSignIn.sharedInstance.handle($0) }`.
5. On the sign-in screen, add a Google button next to Apple:
   1. Call `GIDSignIn.sharedInstance.signIn(withPresenting:)`.
   2. Take `result.user.idToken?.tokenString`.
   3. Send it to the same `/api/v1/auth/google` endpoint Android uses (add an `authGoogle` call in `APIClient`).
   4. Wire **Settings → Sign-in methods → Connect Google** to the existing `attachGoogleIdentity`.
6. Apple guideline 4.8 is already met because Sign in with Apple is offered.

### 6. Web (done)

1. Connect Google in Settings starts working as soon as step 3 is done. No code change is needed.
2. [`app/routes/login.tsx`](../app/routes/login.tsx) shows "Continue with Google" on the email step. It sends the GIS credential to `/api/v1/auth/google`, which sets the session cookie, and shows the server's 409 "not linked" message as a toast. The loader is shared in [`app/lib/google-identity.ts`](../app/lib/google-identity.ts).

---

## Behaviour to expect (by design)

- **Existing users must connect first.** Implicit account linking is off. If a user's Google email matches an existing Inboxies user, they get **409**: *"This sign-in isn't connected to an Inboxies account yet…"*. They need to sign in with their password once, then use Connect Google in Settings.
- **New Google users get a new user with no mailbox.** If the email is on a domain we host, the user gets a placeholder `@users.inboxies.invalid` address instead. Decide whether a brand-new Google user should see onboarding or be turned away.

## Cleanup while you're here

- [`android/README.md`](../android/README.md) still lists `MOBILE_JWT_SECRET`. Sessions are Better Auth now (`BETTER_AUTH_SECRET`), and Google tokens are checked against `GOOGLE_CLIENT_ID` plus `GOOGLE_EXTRA_CLIENT_IDS`.
- Item S7 in [`platform-review-2026-10-09.md`](platform-review-2026-10-09.md) says Google sign-in ignores `email_verified`. Recheck it against Better Auth's Google verifier before launch.
