<div align="center">
  <h1>Agentic Inbox</h1>
  <p><em>A self-hosted email client with an AI agent, running entirely on Cloudflare Workers</em></p>
</div>

Agentic Inbox lets you send, receive, and manage emails through a modern web interface -- all powered by your own Cloudflare account. Incoming emails arrive via [Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/), each mailbox is isolated in its own [Durable Object](https://developers.cloudflare.com/durable-objects/) with a SQLite database for metadata and snippets, and message bodies (HTML), raw MIME (`.eml`), and attachments are stored in [R2](https://developers.cloudflare.com/r2/).

An **AI-powered Email Agent** can read your inbox, search conversations, and draft replies -- built with the [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/) and [Workers AI](https://developers.cloudflare.com/workers-ai/).

![Agentic Inbox screenshot](./demo_app.png)


Read the blog post to learn more about Cloudflare Email Service and how to use it with the Agents SDK, MCP, and from the Wrangler CLI: [Email for Agents](https://blog.cloudflare.com/email-for-agents/).

## How to setup

**Important**: Clicking the 'Deploy to Cloudflare' button is only one part of the setup. You must follow the **After deploying** steps as well. For a full step-by-step guide with screenshots, refer to this comment: 
https://github.com/cloudflare/agentic-inbox/issues/4#issuecomment-4269118513

### To set up

1. Deploy to Cloudflare. The deploy flow will automatically provision R2, Durable Objects, and Workers AI. You'll be prompted for **DOMAINS** (comma-separated hosts you receive mail for). Optionally set **MAIL_DOMAIN** to pin the primary create-address suffix; when both are unset the API falls back to `inboxies.email` for hosted SaaS compatibility only.

     [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/agentic-inbox)

2. **Configure Cloudflare Access** -- Enable [one-click Cloudflare Access](https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/) on your Worker under Settings > Domains & Routes. The modal will show your `POLICY_AUD` and `TEAM_DOMAIN` values. `TEAM_DOMAIN` can be either your Access team URL or the full `.../cdn-cgi/access/certs` URL. **You must set these as secrets for your Worker.**
3. **Set up Email Routing** -- In the Cloudflare dashboard, go to your domain > Email Routing and create a catch-all rule that forwards to this Worker
4. **Enable Email Service** -- The worker needs the `send_email` binding to send outbound emails. See [Email Service docs](https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/)
5. **Subscribe to Email Sending events (recommended)** -- Create a Queue named `email-sending-events` before the first deploy (`npm run ensure-queues`, or `npx wrangler queues create email-sending-events`). Wrangler attaches the consumer on deploy, but it will not create the queue. In the Cloudflare dashboard, open **Queues → email-sending-events → Event subscriptions**, choose **Email Sending** for your sending domain, and subscribe at least to `message.bounced` and `message.complained` (optionally `message.failed` / `message.rejected`). Bounce and complaint events are then written onto the matching Sent message in the thread.
6. **Create a mailbox** -- Visit your deployed app and create a mailbox for any address on your domain (e.g. `hello@example.com`)

Outbound messages larger than **5 MiB** (body + attachments) are rejected with HTTP `413` before send. Mailbox send rate limits return HTTP `429`. Deferred delivery failures, bounces, and complaints appear as delivery badges on the Sent message in the thread.

### Troubleshooting Access

1. If you see `Invalid or expired Access token`, that usually means `POLICY_AUD` or `TEAM_DOMAIN` secrets are incorrect.
   * Resolution: [turn Access off and back on for the Worker to get the Access modal again](https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/), then reset your Worker secrets to the latest `POLICY_AUD` and `TEAM_DOMAIN` values shown there.
2. If you see `Cloudflare Access must be configured in production`, this application is intentionally enforcing Cloudflare Access so your inbox is not exposed to anyone on the internet.
   * Resolution: enable Access using [one-click Cloudflare Access for Workers](https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/), then set the `POLICY_AUD` and `TEAM_DOMAIN` Worker secrets from the modal values.

## Features

- **Full email client** — Send and receive emails via Cloudflare Email Routing with a rich text composer, reply/forward threading, folder organization, search, and attachments
- **Per-mailbox isolation** — Each mailbox runs in its own Durable Object with SQLite for metadata/snippets/FTS and R2 for HTML bodies, raw MIME, and attachments
- **Built-in AI agent** — Side panel with 9 email tools for reading, searching, drafting, and sending
- **Auto-draft on new email** — Agent automatically reads inbound emails and generates draft replies, always requiring explicit confirmation before sending
- **Configurable and persistent** — Custom system prompts per mailbox, persistent chat history, streaming markdown responses, and tool call visibility

## Stack

- **Frontend:** React 19, React Router v7, Tailwind CSS, Zustand, TipTap, `@cloudflare/kumo`
- **Backend:** Hono, Cloudflare Workers, Durable Objects (SQLite), R2, Email Routing
- **AI Agent:** Cloudflare Agents SDK (`AIChatAgent`), AI SDK v6, Workers AI (`@cf/moonshotai/kimi-k2.5`), `react-markdown` + `remark-gfm`
- **Auth:** Cloudflare Access JWT validation (required outside local development)

## Getting Started

```bash
pnpm install
pnpm run dev
```

### Native iOS client

A SwiftUI app lives in [`ios/`](./ios/README.md) (open `ios/AgenticInbox/Inboxies.xcodeproj`). It reuses this Worker API with Sign in with Apple (mobile JWT), Notion-inspired shell, multi-conversation AI chat, and Phase 2 Mail-like minimizable compose (send/reply/forward/drafts, HTML bodies, attachments).

### Native Android client

A Jetpack Compose app lives in [`android/`](./android/README.md). It reuses the same Worker API with Google Sign-In (mobile JWT), Notion-inspired shell, inbox digest, multi-conversation AI chat, and minimizable compose. Emulator default API base is `http://10.0.2.2:5173`.
### Configuration

1. Set your mailbox domain(s) in `wrangler.jsonc` (`DOMAINS`, optional `MAIL_DOMAIN`) or via Worker vars. `GET /api/v1/config` returns `{ mailDomain, domains, emailAddresses }` for web and native clients.
2. Create an R2 bucket named `agentic-inbox`: `wrangler r2 bucket create agentic-inbox`

### Deploy

```bash
npm run deploy
```

## Prerequisites

- Cloudflare account with a domain
- [Email Routing](https://developers.cloudflare.com/email-routing/) enabled for receiving
- [Email Service](https://developers.cloudflare.com/email-service/) enabled for sending
- [Workers AI](https://developers.cloudflare.com/workers-ai/) enabled (for the agent)
- [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) configured for deployed/shared environments (required in production)

Any authenticated user is authorized **per mailbox**. Each mailbox stores an explicit ACL (`acl.owners` + `acl.members`) in its R2 settings blob. Owners can share access by adding another person's Access or mobile email (`email:you@example.com`). A principal may own many mailboxes. Unclaimed mailboxes (missing `acl` or empty `owners`) are claimed on first access when the caller's email matches the canonical mailbox address. If your Access email is not the mailbox address (for example personal Gmail Access into a domain mailbox), you cannot auto-claim it — create the mailbox, or have an owner add your Access email. `EMAIL_ADDRESSES` remains a create allowlist only, not authorization. MCP `/mcp` and Agents `/agents/*` use the same helper.

**Domain Admin:** set Worker secret/var `DOMAIN_ADMINS` to a comma-separated list of Access emails and optional `sub:…` keys (matched against `GET /api/v1/me` → `keys`). Admins get `isAdmin: true`, can list/create/assign/delete via `/api/v1/admin/*`, and are not subject to silent mailbox-content omniscience (ACL still gates mail). When `DOMAIN_ADMINS` is non-empty, mailbox create defaults to **admin-only** unless you set `MAILBOX_CREATE_POLICY=open`. Invitees set a password via `/invite/<token>` (public Worker paths; also add Cloudflare Access **bypass** for `/invite/*`, `/login`, and `/api/v1/invites/*` + `/api/v1/auth/password*`). Optional: `INVITE_FROM_EMAIL`, `APP_BASE_URL`, `MAIL_DOMAIN` (primary create-address suffix; else first `DOMAINS` entry; else `inboxies.email`). Password sessions reuse `MOBILE_JWT_SECRET` (cookie `inboxies_session` or Bearer).

**Mobile Apple / Google vs Access:** Assign-to-me and Sharing store the **web Access** principal (`email:you@gmail.com`). Sign in with Apple often uses a different key (`email:…@privaterelay.appleid.com` and/or `sub:…`), so mobile can show Welcome even when web works. Fixes:

1. If Apple/Google returns an email that is already in `DOMAIN_ADMINS`, the Worker **auto-links** that IdP `sub` to the email (durable identity account in R2). Later mobile sessions expand to the same ACL/admin keys.
2. **Product flow (preferred — in-session Connect):** While signed in, Settings → **Sign-in methods** → **Connect Apple** (iOS) / **Connect Google** (Android or web GIS) / **Add password** or **Change password**. Completes that provider’s normal auth on *this* device and attaches it to the current durable account via `POST /api/v1/me/identities/attach` (rejects if the IdP is already tied to a different account). Change password uses `POST /api/v1/me/password` (requires current password).
3. **Cross-device fallback:** Settings → Sign-in methods → **Link another device** (secondary) → generate/redeem a 15‑minute code. Use when Connect IdP can’t run on that surface (e.g. Connect Apple from Access web).
4. API: `GET /api/v1/me/identities`, `POST /api/v1/me/identities/attach`, `POST /api/v1/me/identity-link-codes`, `POST /api/v1/auth/redeem-identity-link`. Legacy `POST /api/v1/auth/link-provider` remains for password sessions.
5. **Web limits:** Cloudflare Access does not mint Apple ID tokens in the browser — Connect Apple is iOS-only (or use a link code). Connect Google on web needs Worker `GOOGLE_CLIENT_ID` (exposed as `googleClientId` on `/api/v1/config`) for Google Identity Services.
6. Interim ops: add the mobile `sub:…` (from `/api/v1/me` on the device) to `DOMAIN_ADMINS`, and/or add `email:…@privaterelay.appleid.com` / `sub:…` under Settings → Sharing on each mailbox.

## Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Browser    │────>│  Hono Worker     │────>│  MailboxDO      │
│  React SPA   │     │  (API + SSR)     │     │  SQLite meta +  │
│  Agent Panel │     │                  │     │  snippets + FTS │
└──────┬───────┘     │  /agents/* ──────┼────>└────────┬────────┘
       │             │                  │              │
       │ WebSocket   │                  │              ▼
       └─────────────┤                  │     ┌─────────────────┐
                     │                  │     │  R2             │
                     │                  │     │  body.html      │
                     │                  │     │  raw.eml        │
                     │                  │     │  attachments    │
                     │                  │     └─────────────────┘
                     │                  │────>┌─────────────────┐
                     │                  │     │  EmailAgent DO  │
                     │                  │     │  (AIChatAgent)  │
                     └──────────────────┘     └─────────────────┘
```

Full HTML and raw MIME are stored in R2 (`emails/{id}/body.html`, `emails/{id}/raw.eml`). The Durable Object SQLite database keeps metadata and a short `snippet` for list previews, plus an **FTS5** index (`emails_fts`) over subject, sender, recipients, and plain-text body so free-text search matches the full message — not just the first 300 characters. Existing mail is backfilled from R2 in alarm-driven batches. Deleting a mailbox purges the Durable Object inventory, R2 bodies/attachments, and related EmailAgent chat storage before removing `mailboxes/{id}.json`.

## License

Apache 2.0 -- see [LICENSE](LICENSE).
