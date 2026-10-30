# inboxies.co

The marketing site for Inboxies: a landing page with a scroll-pinned phone tour, Pricing, Roadmap, Support (with a contact form) and Legal. It's Astro 7 with `@astrojs/cloudflare`, plain CSS and a few small TypeScript modules, deployed as one Cloudflare Worker at https://inboxies.co. The web app is at https://inboxies.app; mail addresses stay @inboxies.email.

Every page is prerendered except `POST /api/contact` and `GET /api/roadmap`, so the Worker mostly serves static assets. Its entry, `src/worker.ts`, wraps Astro's handler: it answers byte-range requests for `/media/*` (the static asset server ignores `Range`, and Safari and iOS won't play video without `206`s) and adds the security headers that `public/_headers` can't reach (Worker responses: the 404 page, `/api/contact`, `/media`).

## Commands

From the repo root:

| Command | What it does |
|---|---|
| `pnpm site:dev` | Dev server at http://localhost:4321 |
| `pnpm site:build` | Build, then run the claims and budget checks (fails on any hit) |
| `pnpm site:deploy` | Build and `wrangler deploy` |

From `site/` (`pnpm <script>`):

| Script | What it does |
|---|---|
| `dev` | `astro dev` |
| `build` | `astro build && check-claims && check-budget` |
| `preview` | Build, then serve the production Worker with `wrangler dev` on :8787 (assets, `/api/contact`, byte ranges on `/media`, real 404s) |
| `check` | `astro check` (types and templates) |
| `check:claims` / `check:budget` | Run either post-build check on its own |
| `typegen` | `wrangler types`: regenerates `worker-configuration.d.ts` (committed) |
| `og` | Regenerates `public/og.png` (committed) |
| `run deploy` | Build and deploy (`run` is needed: `pnpm deploy` is a pnpm built-in) |

`REPO/.claude/launch.json` has two configurations for the desktop preview: `site` (the dev server on 4321) and `site-preview` (the `preview` script on 8787). `site` passes `--ignore-lock` because Astro 7 detaches `astro dev` into a background daemon when it detects an agent; this flag keeps it in the foreground, so the launcher can stop it.

`scripts/with-lock.sh <command>` runs a command under a lock in `/tmp`. It exists for several agents building the same checkout at once. It isn't needed when you're working alone.

## Checks that fail the build

- `src/data/validate.ts` (runs inside every page render): every data entry has a `src`, ids are unique, nothing Available carries an owner gate, no changelog date is after `asOf`, and private email isn't described as shipped while `privateEmailShipped` is false. It warns when `asOf` is more than 45 days old.
- `scripts/check-claims.mjs`: scans the built HTML for banned phrases (“unlimited”, “end-to-end encrypted”, “24/7”, any claim that mail sorts itself…), and for phrases allowed only inside `data-claim` (unbuilt work), plus flag-dependent ones (`$20` when domain purchase is off, “App Store” before an App Store listing, Android before it's public, “Web” while the web app isn't). It checks links into the app too: while `webAppPublic` is true every link to the web app's host (`APP_URL`) must go to `/login`, and while it's false there may be none. It also fails on duplicate element ids.
- `scripts/check-budget.mjs`: at most 20KB of JS and 30KB of CSS (gzip) per page. It also fails if anything built points at an `/_astro/*.png`: those are unused image originals, and `public/.assetsignore` keeps them out of the deploy.

## Config (`src/config.ts`)

Every switchable claim reads from here. Flip a value and rebuild; the checks re-verify the copy.

| Setting | Default | Effect |
|---|---|---|
| `IOS_STATUS` | `"testflight"` | `"hidden"` drops iPhone everywhere. `"testflight"` shows “Ask for the iPhone beta” (a mailto), or “Join the iPhone beta ↗” when `TESTFLIGHT_URL` is set. `"appstore"` plus `APP_STORE_URL` shows “Download for iPhone ↗” |
| `flags.webAppPublic` | `true` | `false` while signed-out visitors can't reach `inboxies.app/login` (Cloudflare Access): drops “Web” from platform and availability lines, hides Sign in and “Open the app”, and the main CTA becomes the iPhone beta |
| `flags.privateEmailShipped` | `false` | `true` moves Private email into “And the rest” and removes the roadmap callout. Flip when PR #46 reaches main |
| `flags.autoDraftsFromDayOne` | `false` | `true` marks “Drafts from day one” Available on the roadmap, drops it from Coming next and updates the matching Support answer. Flip when PR #49 (merged to dev) reaches main |
| `flags.domainPurchaseLive` | `true` | `false` removes every `$20` surface (the third plan, “How the price works”, the price lines) |
| `flags.androidPublic` | `false` | `true` adds Android to platform lines, the sign-in copy and the apps answer, and turns its roadmap row from “Coming soon” to available |
| `asOf` | `"2026-10-09"` | “Updated …” date on the roadmap, and the sitemap `lastmod` |
| `X_URL` | `https://x.com/inboxies_app` | `null` hides every X link |
| `SIGN_UP_URL` (= `SIGN_IN_URL`), `SUPPORT_EMAIL`, `GITHUB_URL` | | Link targets used site-wide. Sign-up and sign-in both go to `https://inboxies.app/login`; the app's root sits behind Access. `primaryCta()` picks the main button |

Copy lives in `src/data/*.ts`, one module per surface, and each entry carries its source in `src`.

## Before launch

Three things outside this folder decide whether the site works on day one. Until each is done, the site stays honest by its defaults, but visitors hit a wall.

1. **The web app's Access wall.** Done (15 Oct 2026): signed-out visitors reach `https://inboxies.app/login`, and the app's assets, invite, reset and checkout pages load without an Access login. A signed-out visit to any other app page lands on `/login`. inboxies.email web pages redirect to inboxies.app.
2. **The `inboxies.co` zone.** It's still on Namecheap DNS, and the custom domains, the www redirect and Email Service all need an active Cloudflare zone. Deploying, step 0.
3. **Contact form delivery.** Onboard `inboxies.co` to Email Service and verify `support@inboxies.email` as an Email Routing destination (Contact form, steps 1–2). Until then the form answers 503 and falls back to the visitor's email app.

Also before launch: reserve the role usernames on inboxies.email (question 17) and the security fixes in question 21.

## Deploying

0. **Before the first deploy (owner):** `inboxies.co` is still on Namecheap DNS (parking page, Namecheap mail forwarding). Custom domains and Email Service both need it to be an active zone in the Cloudflare account:
   1. Add `inboxies.co` to the account and switch the nameservers at Namecheap; wait until the zone shows Active.
   2. Delete the imported parking records: the apex `A 162.255.119.103` and the `www` CNAME to `parkingpage.namecheap.com`. A custom domain can't attach over an existing A/AAAA/CNAME record.
   3. Decide what happens to Namecheap's email forwarding on `inboxies.co`: enabling Email Routing replaces those MX records.
   4. Until the zone is Active, deploy to staging only: comment out `routes`, set `workers_dev` back to `true`, and run the smoke tests below on the `workers.dev` URL.
1. `wrangler login` (there's no `account_id`, so wrangler uses the logged-in account), then `pnpm site:deploy`.
2. The `routes` block attaches `inboxies.co` and `www.inboxies.co` as custom domains. Then, on the zone (owner, dashboard):
   - SSL/TLS → Edge Certificates: turn on **Always Use HTTPS** and **HSTS**. `_headers` and the Worker send a one-year `Strict-Transport-Security` without `includeSubDomains`.
   - A Single Redirect rule: `http.host eq "www.inboxies.co"` → `concat("https://inboxies.co", http.request.uri.path)`, 301, query string kept. Redirect rules run before the Worker, and the canonical tags already point at `https://inboxies.co`.

   In code (AVE-166, `src/lib/canonical-redirect.ts`): a fallback for both, for requests that reach the Worker (`/api/*`, `/roadmap`, `/media/*`, 404s). HTTP gets a 301 to HTTPS (308 for a POST, so the body survives), and a GET or HEAD on `www.inboxies.co` gets one 301 to `https://inboxies.co`, path and query kept. Local hosts are never redirected. Prerendered pages are served by the asset server before the Worker runs, so `http://inboxies.co/` and `https://www.inboxies.co/` only redirect once the zone settings are on.
3. The build writes `dist/server/wrangler.json` and a redirect in `.wrangler/deploy/config.json`. Plain `wrangler dev` / `wrangler deploy` from `site/` pick it up.
4. After the first deploy, smoke test:
   - `/` returns 200 and `/does-not-exist` returns 404 with the Screener line.
   - `/sitemap.xml` lists `/`, `/pricing`, `/roadmap`, `/support`, `/request` and `/legal`.
   - `/terms` and `/privacy` answer `301` to `/legal#terms` and `/legal#privacy` (`_redirects`, from `redirects` in `astro.config.mjs`).
   - `curl -sI -H "Range: bytes=0-1" https://inboxies.co/media/inbox-open.mp4` answers `206` with `Content-Range: bytes 0-1/330088`. Without it, Safari and every iOS browser keep the clips on their posters. `pnpm preview` answers the same locally.
   - A signed-out visit to the sign-up link reaches “Get started”, not an Access login (open question 1).
5. `"workers_dev"` and `"preview_urls"` are `false` in `wrangler.jsonc` (AVE-166), so the site and `/api/contact` live on one host, behind the zone's WAF and rate-limiting rules. Site PRs get no preview URLs.

## Contact form

`POST /api/contact` sends the form to support through the `SUPPORT_INBOX` `send_email` binding. The message goes from `site@inboxies.co` to `support@inboxies.email`, with Reply-To set to the visitor.

To make it deliver:

1. Onboard `inboxies.co` to Email Service, so the Worker can send as `site@inboxies.co`: `npx wrangler email sending enable inboxies.co` (adds the SPF and DKIM records), then confirm it with `npx wrangler email sending list`. This needs the zone from Deploying step 0.
2. Under Email Routing → Destination addresses, add `support@inboxies.email` and click the verification link sent to it. The binding in `wrangler.jsonc` only allows that destination.
3. Deploy. `CONTACT_RATE` (5 requests per 60s per IP) is optional; the endpoint skips the check if the binding is missing.

How it behaves:

- **Not deliverable** (the binding is missing or the send fails): 503 with `fallback: "mailto"`. The page offers “Open in your email app” and copies the message.
- **No JavaScript:** the form posts natively and gets a 303 to `/support/sent` or `/support/unavailable`.
- **Bots:** the honeypot and submissions faster than 2s get a fake success.
- **Logs:** one JSON line per request (outcome and topic), never the message, name or address.

Local test: `pnpm preview`, then submit the form. Wrangler simulates `send_email` locally (nothing is sent) and logs where it saved the message.

## Roadmap from Linear

`GET /api/roadmap` reads the issues labelled `public-roadmap` from Linear's GraphQL API and answers JSON. Linear is the only source; GitHub issues aren't mirrored. The roadmap page's "Coming next, in detail" list reads it in the browser (AVE-87, `src/lib/roadmap-live.ts`): it ships prerendered with the hand-written list, and swaps in the Linear items only when the endpoint answers OK with `source: "linear"` and at least one item within 3 seconds. Anything else (no key, an error, a timeout, an empty list) leaves the static list in place.

To turn it on (owner):

1. In Linear's settings, create a personal API key with **read** permission only, limited to the teams that hold roadmap issues if you can.
2. `cd site && npx wrangler secret put LINEAR_ROADMAP_API_KEY` and paste the key. For `pnpm preview`, put `LINEAR_ROADMAP_API_KEY=...` in `site/.dev.vars` (gitignored).
3. Label the issues you want public with `public-roadmap`. To give one a blurb, add a `## Public summary` section to its description (a bold `**Public summary:**` line or a `Public summary:` line also works); the text up to the next heading or rule is used. Without one, the page shows the title alone.

What it answers:

```json
{ "items": [{ "id": "3f9a…", "title": "Snooze", "summary": "Hide a thread until later.", "status": "Planned" }],
  "source": "linear", "fetchedAt": "2026-10-20T09:00:00.000Z" }
```

- **Status:** Linear's state type decides it: triage, backlog and unstarted → Planned; started → In progress; completed → Shipped. Canceled (and duplicates) are left out. Sorted In progress, Planned, Shipped, latest first.
- **Public fields only:** the title (plain text, 120 characters at most), the Public summary (plain text with links, URLs, HTML, code and images stripped, 280 characters at most) and the status. `id` is a hash of the Linear id, stable but not a link into Linear. No identifiers, assignees, estimates, comments or the rest of the description.
- **No key:** 503 with `source: "unconfigured"` and no items. **Linear failing** (HTTP error, GraphQL error, 5s timeout): the last good answer this isolate holds (up to a day old) if there is one, otherwise 503 with `source: "error"`. The page should treat anything but `source: "linear"` as "use the static list".
- **Caching:** 10 minutes in the Cache API (a failure for 1 minute), plus a copy in the isolate's memory, because the Cache API does nothing on `workers.dev`. Browsers may cache the answer for 10 minutes too.
- **Logs:** one JSON line per request (outcome, item count), never the key or Linear's response.

The parsing and mapping live in `src/lib/roadmap-linear.ts`, tested by `site/test/roadmap-linear.test.mjs` (`pnpm test:unit roadmap` from the repo root).

## Request forms

`/request` lets anyone, signed in or not, send a **feature request**, **bug report** or **feedback** (AVE-81). Each one becomes a Linear issue in the AVE team's **Triage**, labelled `user-request` plus `feature`, `bug` or `feedback`. The roadmap page and the footer link to it, and `/request?type=bug` (or `feature`, `feedback`) preselects the kind.

- `GET /api/requests` answers `{ available, siteKey }`. The page reads it to decide whether to show the Turnstile widget or say the form is offline.
- `POST /api/requests` takes JSON `{ kind, title, details, email, platform, token, t, website }`. The checks run in this order: secrets set, then body size (32 KB) and origin, then the honeypot and the 2 s time trap (both get a fake OK), then the field rules (title 4 to 120 characters, details 10 to 4,000, email up to 254, platform required for bugs), then the per-IP rate limit, then Turnstile `siteverify`, then Linear. The code is in `src/lib/requests.ts`, the rules shared with the browser are in `src/components/request/request-rules.ts`, and the tests are in `site/test/requests.test.mjs` (`pnpm test:unit requests`).
- **The submitter's email is kept out of the issue.** It goes on a Linear attachment called "Requester": `url` is `https://inboxies.co/request?ref=<uuid>`, `subtitle` is the address, and `metadata.requesterEmail` holds it too. Attachments are only visible inside the workspace, and `/api/roadmap` never reads them. A later status-email job can find a request's address with `issue.attachments(filter: { url: { startsWith: "https://inboxies.co/request" } }) { nodes { metadata } }`. The details are quoted line by line in the description, so a submitter can't plant a "Public summary" section.
- **Off the public roadmap by default.** `/api/roadmap` only reads issues labelled `public-roadmap`, so a request shows up there only if you add that label yourself. If you do, the issue title is published as it stands, so edit off the "Bug: " or "Feature request: " prefix first. Any Public summary you write is published too. The submitter's details never are.
- **Confirmation email:** once the issue exists, `REQUEST_MAIL` sends "We got your feature request" from `support@inboxies.email` to the submitter. Replies land in support. If the binding is missing or the send fails, the request still succeeds and the log says `confirmation_failed`. Status emails, sent when an issue moves to Done or Canceled, are a later sub-issue.
- **When something isn't set up:** without the three secrets, GET says unavailable, POST answers 503 `{ error: "unavailable" }`, and the page says to email support. If Linear fails, the answer is also a 503. If Turnstile rejects the token, the answer is a 400 `{ error: "turnstile" }`. If the rate limit trips, the answer is a 429.
- **Logs:** one JSON line per request with the outcome, the kind and, once filed, the issue identifier. They never include the address, the text or a key.

To turn it on (owner):

1. **Linear key.** Create a personal API key in Linear (Settings → Account → Security & Access) limited to the AVE team. It needs permission to create issues and attachments, plus labels if they don't exist yet ("Write" covers all three). Don't reuse the read-only `LINEAR_ROADMAP_API_KEY`. Then run `cd site && npx wrangler secret put LINEAR_REQUESTS_API_KEY`.
2. **Labels.** The endpoint looks up `user-request`, `feature`, `bug` and `feedback` by name, ignoring case. The team's own label wins over a workspace one. Any that are missing get created on the AVE team. If the key isn't allowed to create them, the issue goes in without them and the log says `label_missing`, so create them by hand in that case.
3. **Triage.** Keep Triage on for AVE. With it off, requests land in the team's default state and the log says `no_triage_state`.
4. **Turnstile.** In the dashboard, go to Turnstile → Add widget for `inboxies.co` (plus the `workers.dev` host while staging), in Managed mode. Then run `npx wrangler secret put TURNSTILE_SITE_KEY` and `npx wrangler secret put TURNSTILE_SECRET_KEY`. The site key is public: GET hands it to the page, so it could also be a plain `vars` entry.
5. **Optional:** set `LINEAR_REQUESTS_TEAM_KEY` (a var) to file into a team other than `AVE`.
6. **Bindings** are already in `wrangler.jsonc`, and nothing needs creating:
   - `REQUESTS_RATE`: Workers Rate Limiting, namespace `4102`, 3 requests per 60 s per IP (an IPv6 /64 counts as one). It's optional, and the check is skipped if the binding is missing.
   - `REQUEST_MAIL`: `send_email` with `allowed_sender_addresses: ["support@inboxies.email"]`, which allows any recipient. `inboxies.email` has to be onboarded to Email Sending in this account; check with `npx wrangler email sending list`. If it isn't, run `npx wrangler email sending enable inboxies.email`, or drop the binding and no confirmation is sent.
7. Deploy, then send one request of each kind and check they show up in Triage with the right labels, a Requester link and a confirmation email.

Local test: `pnpm build`, then `npx wrangler dev --var TURNSTILE_SITE_KEY:1x00000000000000000000AA --var TURNSTILE_SECRET_KEY:1x0000000000000000000000000000000AA --var LINEAR_REQUESTS_API_KEY:<key>`. Those are Cloudflare's always-pass Turnstile test keys. Leave out the Linear key and the form shows its offline state. Locally, `send_email` is simulated.

## Re-shooting the iOS media

Media is read by the build, never generated by it:

- **Stills:** `src/assets/screens/<name>-<light|dark>.png` at 1206×2622, all 14 names in both themes. The build makes AVIF/WebP at 320/640/960w.
- **Clips:** `public/media/<clip>[-dark].{mp4,webm,jpg}` at 590px wide. The `.jpg` is the poster, kept at 70KB or under. Pages offer the MP4 first (it's the smaller file for all but one clip, and plays everywhere); the WebM is the fallback.
- Media names aren't fingerprinted, so `/media/*` is cached for an hour (then served stale while it revalidates). A re-shoot reaches returning visitors within about a visit.

Alt text and clip lengths live in `src/data/media.ts`. Update them if what's on screen changes. `src/assets/screens/manifest.json` describes the set.

1. Build the DEBUG app from `ios/AgenticInbox` onto an iPhone 17 Pro simulator (bundle id `co.inboxies.app`). The DEBUG launch arguments open fixture screens (the “Alex Rivera” sample mailbox; see `ios/AgenticInbox/Inboxies/Views/PreviewSupport.swift`).
2. Set the theme with `xcrun simctl ui booted appearance light` (or `dark`) and shoot each still in both themes:

   ```sh
   xcrun simctl launch --terminate-running-process booted co.inboxies.app -apiBase http://127.0.0.1:9 <args>
   xcrun simctl io booted screenshot --type=png <name>-<theme>.png
   ```

   `-apiBase http://127.0.0.1:9` points the app at a closed local port, so only fixtures show.

   | Still | Launch args |
   |---|---|
   | `inbox` | `-previewMailbox` |
   | `detail` | `-previewDetail` |
   | `chat` | `-previewChat` |
   | `screener` | `-previewScreener` |
   | `screener-list` | `-previewScreenerList` |
   | `reply-later` | `-previewReplyLater` |
   | `compose` | `-previewCompose` |
   | `compose-minimized` | `-previewComposeMinimized` |
   | `domain-admin` | `-previewDomainAdmin` |
   | `sign-in-methods` | `-previewSignInMethods` |
   | `welcome` | `-previewWelcome` |
   | `get-started` | `-previewWelcome -previewGetStarted` |
   | `search` | `-previewMailbox`, then search `in:inbox review` |
   | `action-menu` | `-previewMailbox`, then open the compose button's menu |

3. Copy the PNGs in losslessly. Drop a fully opaque alpha channel, write no metadata, and check the pixels are unchanged.
4. Record each clip in both themes. `reply-later` has no dark encode: the dark theme shows its still instead.
   - Start: `xcrun simctl io booted recordVideo --codec=h264 --force <clip>.mov`
   - Drive the flow from the matching launch args, then stop the recording with Ctrl-C (SIGINT).
   - Clips: `inbox-open`, `screener-flow`, `reply-later`, `ask-ai`, `compose-dock`. Don't use `welcome-flow`: its sign-in sheet links a Terms page that 404s.
5. Encode at 30fps, scale to 590px wide with lanczos, trim to the flow and hold the last frame:

   ```sh
   ffmpeg -i <clip>.mov -vf "fps=30,scale=590:-2:flags=lanczos,trim=<s>:<e>,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=<hold>,format=yuv420p" \
     -an -c:v libx264 -preset slow -crf 28 -profile:v high -pix_fmt yuv420p -movflags +faststart <clip>.mp4
   ffmpeg -i <clip>.mp4 -an -c:v libvpx-vp9 -crf 38 -b:v 0 -row-mt 1 -deadline good -cpu-used 2 -pix_fmt yuv420p <clip>.webm
   ffmpeg -ss 0.2 -i <clip>.mp4 -frames:v 1 -q:v 3 <clip>.jpg
   ```

   Dark encodes are named `<clip>-dark.*`. Set the poster time (`-ss`) to the strongest frame. Keep clips 7–12s.
6. Rebuild and check both themes: no light media may show on a dark page.

## Open questions for the owner

Spec §10. The site ships with each default until it's answered.

- [x] **1.** Can a signed-out visitor to `https://inboxies.app/login` reach “Get started”? Yes (15 Oct 2026): the Access bypass is live. Should CTAs deep-link (e.g. `?start=personal`)? Default: every CTA goes to `SIGN_UP_URL`. If Access ever walls `/login` again, set `flags.webAppPublic = false`.
- [ ] **2.** Is the personal @inboxies.email address free long-term? Default: “No charge today”, the CTA says “Get started — free”, never “free forever”.
- [ ] **3.** Does connecting your own domain stay $0? Default: “No charge today”.
- [ ] **4.** Cancelling a registered domain: is “write to support and we'll help” OK, and what happens to the domain? Refund and renewal-price policy? Default: the cancel FAQ shows that line, with no refund or renewal answer.
- [ ] **5.** Account deletion by request until there's an in-app path (App Store 5.1.1(v))? Default: shown (“write to us and we'll help”).
- [x] **6.** Is there a public TestFlight link? Yes (AVE-54): `TESTFLIGHT_URL` is set, so the site shows “Join the iPhone beta ↗”. Clear it to fall back to the `IOS_BETA_MAILTO` request.
- [ ] **7.** When does Android go public, and where? Default: `androidPublic: false`, so Android shows only as coming soon: in the Support apps answer and as a “next” row on /roadmap.
- [ ] **8.** Is @inboxies_app on X live and owned? Default: shown in the colophon and Other ways. `X_URL = null` hides both.
- [ ] **9.** OK to state “There are no ads in Inboxies today” as a plain fact? Default: shown, in the present tense, with no business-model claim.
- [ ] **10.** Approve the candid lines (the Plainly callout, encryption, who can read my mail, tracking pixels, AI reads)? Default: shown.
- [ ] **11.** Can the site say anything about AI training on mail (this depends on the Cloudflare Workers AI terms)? Keep the model names in Support? Default: no training claim either way; model names shown.
- [ ] **12.** Tease “Drafts from day one” and the “For you” brief publicly? Default: both on /roadmap only, not in the landing table.
- [ ] **13.** Forwarding and MCP for hosted accounts. Forwarding only delivers to an address verified in Cloudflare Email Routing, and the apps have no way to verify one. Default: “to an address verified in Cloudflare Email Routing; on inboxies.email, ask support to add yours”, and “On request” in the plans table. That assumes support adds destinations in the Cloudflare account by hand; if not, change the copy to self-hosted installs only (`features.ts`, `faqs.ts`, `parity.ts`, `pricing.ts`). MCP has no way in for an inboxies.email account (`/mcp` needs Access or a session token), so it's “on self-hosted installs today”, with scoped keys on the roadmap.
- [ ] **14.** No storage or AI quotas and no per-mailbox charge “today”: OK to say? Default: shown.
- [ ] **15.** Fix the in-app price display before launch? `app/components/OnboardingFlow.tsx:935` shows $10.46 for every TLD, and iOS/Android label the retail total “Wholesale price”. Default: “Where the $20 goes” ships with the $10.44 worked example; fix the app before launch.
- [ ] **16. Launch blocker.** Contact form: onboard inboxies.co to Email Service (From `site@inboxies.co`; it needs the zone first) and verify `support@inboxies.email` as a destination? Is that mailbox monitored? Default: binding configured; until it works, the 503 → mailto fallback carries the form.
- [ ] **17. Launch blocker.** Reserve `support@`, `security@`, `admin@`, `postmaster@`, `abuse@`, `noreply@`, `billing@`, `privacy@`, `welcome@` and `agent@` on inboxies.email. Anyone can claim them today, and the site publishes support@.
- [ ] **18. Launch blocker.** Legal. `/legal` now carries a privacy policy, terms of service and acceptable use policy written from the code (`src/data/legal.ts`; `legalUpdated` is its date), linked from the colophon, with `/privacy` and `/terms` redirecting to it. Before it's binding the owner must supply or approve every `ownerConfirm` in that file, chiefly: the operator's legal name and address (and an EU/UK representative if needed), governing law and venue (the Disputes clause names none), the minimum age (13 by default), the refund line beyond failed registrations (Q4), and the no-ads, no-sale and no-training lines (Q9, Q11). It's worth a lawyer's read. App-side: the iPhone and Android sign-in screens link `inboxies.email/terms`, which redirects signed-out visitors to `/login`; point them at `https://inboxies.co/terms`, add a Privacy link beside it, and use `https://inboxies.co/privacy` as the store privacy URL. Reserve `privacy@` and `legal@` too (not in `RESERVED_LOCAL_PARTS`).
- [ ] **19.** www → apex. Default: the owner adds a 301 Redirect Rule on the zone; canonical tags point to `https://inboxies.co`.
- [ ] **20.** Redirect `inboxies.email/help` (the in-app Help Center, a 404 today) to `https://inboxies.co/support`. This is an owner change in the app repo.
- [ ] **21. Launch blocker.** Security before launch: password-reset throttling and binding codes to the email, the Stripe webhook failing closed in production, and export authorization (PR #48). The site never describes these gaps.
- [ ] **22.** Fix the seeded welcome emails' overclaims (shortcuts, Settings → Export, “Approve & Send”, “snooze”). Default: the Support `[welcome-emails]` answer defuses them.
- [ ] **23.** Are the Stripe, Registrar and webhook production secrets live? Default: `domainPurchaseLive: true`. Flip it to `false` if not, which removes every $20 surface.
- [ ] **24.** OG image: keep the generated composite or supply artwork? Default: generated by `scripts/make-og.mjs`.
- [ ] **25.** Add a full CSP? It needs hashes for every inline script. Those are the boot, hero-poster preload, type scale, reveal tagger and hero `<picture>` scripts, plus the speculation rules and the small module scripts Astro inlines. Default: no script CSP at launch. `_headers` (and `src/worker.ts`, for Worker responses) set nosniff, referrer and permissions policies, `X-Frame-Options: DENY` with `frame-ancestors 'none'` (no framing, so no clickjacking of the contact form), and HSTS.
- [ ] **26.** Sorting. With the Screener on (always), a sender's mail goes where you accepted them; the classifier's Promotions/Updates guess is only used with the Screener off, so the site never says mail sorts itself and `check-claims` bans it. If the app changes so accepted senders fall back to the classifier, revisit `features.ts`, the sorting answers in `faqs.ts`, `parity.ts` and those bans.
- [ ] **27.** App-side follow-ups the copy works around (outside this folder): `.mbox` exports survive mailbox deletion and never expire (the delete answers say so); the registrar prices from a built-in table when Cloudflare's lookup fails (the pricing rows say so); and main shows a Private email screen whose addresses don't receive mail yet (the Support answer warns about it). Consider hiding that screen until PR #46 reaches main.
