# Inboxies platform review — 2026-10-09

Scope: Worker API, Durable Object, AI agent/MCP, automations, web app, iOS, Android, at `2847401` (main).

## Health checks

| Check | Result |
| --- | --- |
| `pnpm test:unit` (44 suites) | ✅ pass |
| `pnpm typecheck` | ❌ **78 errors**. Several are real runtime bugs (below), the rest are type drift. |
| Android `assembleDebug` + unit tests | ✅ pass |
| iOS build + `InboxiesTests` | ✅ pass |

**Verdict:** The core loop works on all three clients: receive, read, thread, search, compose, send, reply, forward, star/read, Reply Later, settings and sharing. Three areas are broken or unsafe:

- **Account and billing security.** There are several full-takeover paths.
- **The newer features.** Private email, domain purchase, export and auto-draft don't work.
- **Android parity.** Delete, archive and drafts don't sync.

✔ = I re-checked it myself in the code. Everything else was traced by an audit agent.

---

## P0: Security (fix before anything else)

| # | Issue | Where |
| --- | --- | --- |
| S1 ✔ | **Domain-owner takeover.** Public `GET /billing/checkout-return?domain=X` mints a 30-day session for X's owner. It never checks `session_id`. | `workers/routes/billing.ts:371` |
| S2 ✔ | **Admin/ACL takeover via an unverified email.** `signup-personal` stores `backupEmail` without verifying it. Minting a link code then promotes it to an `email:` principal. If that email is in `DOMAIN_ADMINS`, the attacker becomes super-admin. The same flaw exists in `/me/identities/attach` (password), which writes the login index *before* the attachable check. | `onboarding.ts:192`, `identity-links.ts:998`, `:1470` |
| S3 ✔ | **Stripe webhook unsigned when the secret is unset or a placeholder.** A forged `checkout.session.completed` triggers a real registrar purchase. `/checkout/mock` ships in prod. `payment_status` is never checked. | `billing.ts:520`, `:330`, `checkout-mock.tsx` |
| S4 | **`signup-domain` is public with no payment or ownership proof.** Anyone can claim any unclaimed domain and create a zone in the operator's account. | `onboarding.ts:244` |
| S5 | **Squatting.** Mailbox create under the "open" policy has no domain-ownership check, so anyone can create mailboxes on other tenants' domains. Private-email `baseDomain` is not validated either. | `index.ts:281`, `aliases.ts:51` |
| S6 | **Password reset brute force.** The code is 6 digits, isn't bound to an email, and has no attempt limit. Reset/logout don't revoke the stateless 30-day JWTs. | `password-reset.ts`, `admin-invites.ts:930` |
| S7 | **Unverified identity sources.** `/auth/link-provider` links any typed `sub`. Google sign-in ignores `email_verified`. | `admin-invites.ts:990`, `index.ts:1268` |
| S8 | **Data leaks.** Exports are downloadable by any signed-in user (no owner check, no expiry). `GET /accounts` lists every user's email. | `export-and-offboarding.ts:100`, `admin-invites.ts:1053` |
| S9 ✔ | **Android: any app can redirect the API host** through the exported activity's `apiBase` extra, so the Bearer token leaks. | `MainActivity.kt:55` |
| S10 | **Forged `Authentication-Results`.** The last trusted header wins instead of the first, so a spoofed message can pass DMARC checks. | `email-auth.ts:264` |

## P1: Broken features

**Mail core (Worker)**
- ✔ **Send rate limit.** It compares ISO `date` text against SQLite `datetime()`, so the hourly window covers the whole UTC day. After 20 sends a day, users get 429 and auto-replies stop. `durableObject/index.ts:2349`
- ✔ **Deleting a custom folder deletes its emails.** This happens via `ON DELETE CASCADE`, and it orphans the R2 bodies and attachments. `durableObject/index.ts:1601`
- **Outbound `Message-ID` is never sent,** so external replies don't thread. They fall back to a 7-day subject match. `index.ts:540`, `reply-forward.ts`
- **Delete is a permanent hard delete,** but the Trash UI says mail can be restored. `durableObject/index.ts:1426`
- **Mailbox purge leaves private-email aliases live.** A re-created address then receives the old aliases' mail. `durableObject/index.ts:1497`
- **Domain decommission only flips a status flag.** Routing stays on and mail keeps arriving. `export-and-offboarding.ts:237`

**AI agent and automations**
- ✔ **Auto-draft fails silently** for anyone who never opened the Auto chat (that is, every web user). The raw DO `fetch` lacks the partyserver room header. `index.ts:1919`
- **Auto-draft hard-deletes the user's own in-progress drafts** in that thread. `tools.ts:193`
- **Auto-reply and MCP sends go out from the real address,** not the private alias. `index.ts:1527`, `tools.ts:463`
- **Forwarding skips every unknown sender** while the Screener is on (it is on by default). The UI says "each incoming message". `sender-triage.ts:155`

**Cross-client contract mismatches**
- ✔ **Domain purchase is broken on iOS and Android.** The server returns `domainFeeUsd`/`billingInterval`, but the clients require `domainWholesaleUsd`/`interval`, so decoding fails. Web shows a hard-coded $10.46.
- ✔ **Private email updates are broken everywhere:**
  - Web calls an undefined `patch()` (`app/services/api.ts:783`).
  - iOS and Android send snake_case keys, which zod drops.
  - Android can't decode the list (`mailbox_id` is required; `is_active` is an int).
- **Private email AutoFill on both native apps fabricates addresses** (`@private.inboxies.app`) and never calls the API. The iOS extension isn't even a build target.
- **Domain export on iOS/Android:** the `ExportJob` shape doesn't match the server, and the download opens a browser without auth, which returns 403.
- **iOS live inserts over SSE fail to decode** (`reply_later` is required), so every event triggers a full resync.
- **Android AI chat dates** use snake_case keys while the server sends camelCase.

**Android-only (parity gaps)**
- ✔ **Swipe/bulk Delete and Archive never call the API.** The outbox is a no-op, so mail reappears on the next sync. `AppModel.kt:1389`
- ✔ **Save Draft is a toast only.** Nothing reaches the server. `ComposeFormModel.kt:322`
- Push never registers (no `POST_NOTIFICATIONS` request), and the token isn't unregistered on sign-out.
- Sending an opened draft leaves it in Drafts. Compose is lost on dark-mode or locale change. The cache isn't per-mailbox.
- A crafted `cid:` crashes the email view (unescaped `Regex`). Attachments are read on the main thread.

**iOS-only**
- Cancelling payment is treated as success.
- Push stays registered after sign-out.
- An expired session (after 30 days) wipes the mailbox list instead of showing sign-in.
- The Google button is a no-op.

**Web-only**
- ✔ **Password-session users can't log out.** Logout only hits the Access logout URL.
- ✔ **Reply Later pagination** passes the wrong props, so it throws once there are more than 25 items.
- ✔ **Admin mailbox changes don't refresh the sidebar** (wrong query key).
- ✔ **Indent/Outdent buttons** call TipTap commands that don't exist.
- **API errors render as "Your inbox is empty".**
- **Signed-out visitors get raw 403 text** instead of `/login`.
- **Forward drops attachments, and quoted text is garbled.**
- **Remote images (tracking pixels) auto-load.**

## P2: Correctness and debt
- **Threading and counts:**
  - Thread counts double when a subject changes mid-thread.
  - The subject fallback merges recurring receipts.
  - The participant check is a substring match.
- **Snippets and push previews** are built from raw HTML.
- **Bounce events for alias senders** go to the wrong DO.
- **Scale and errors:**
  - `bucket.list` is never paginated (limit 1,000).
  - Malformed input returns 500 instead of 400 (ZodError, `atob`).
- **Folder rules:**
  - System folders can be renamed, and duplicate names return 500.
  - `moveEmail` into Sent/Drafts is allowed.
- **Permissions and agent safety:**
  - Mailbox *members* can change forwarding and the agent prompt.
  - The auto-run agent has `move_email`/`discard_draft` and only scans the body for injection.
  - MCP `send_email` has no server-side confirmation.
- **Store compliance:** no account deletion on either native app, which both App Store and Google Play policies require.
- **Typecheck:** 78 `tsc` errors, so `pnpm typecheck` can't gate CI.

## Verified working
- Auth middleware order (Access → Bearer → cookie, failing closed in prod).
- Per-mailbox ACL on REST, `/agents/*` and MCP.
- PBKDF2 password hashing; invite tokens; Apple/Google JWKS validation.
- Inbound routing, plus-addressing, dedupe; FTS index lifecycle; R2 key consistency.
- Drafts and send on web/iOS; outbound size limit (413).
- Auto-reply loop guards; forwarding loop guards (only verified destinations).
- Filter and screener order; the bounce queue consumer.
- WebView/iframe sanitization (DOMPurify; jsoup on Android).
- Every client API path exists on the Worker.
