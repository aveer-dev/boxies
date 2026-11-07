<div align="center">
  <h1>Inboxies</h1>
  <p><em>Email with an AI assistant built in. A hosted service at <a href="https://inboxies.app">inboxies.app</a>, open source so you can also run your own copy on Cloudflare Workers.</em></p>
</div>

Inboxies is an email client for the web, iOS and Android. Most people use the hosted service at [inboxies.app](https://inboxies.app), with an address on `inboxies.email` or on their own domain. This repository is the code behind that service, under the Apache 2.0 license. You can read it, contribute to it, or deploy it to your own Cloudflare account and run it there.

Everything runs on Cloudflare. Incoming mail arrives through [Email Routing](https://developers.cloudflare.com/email-routing/) and outgoing mail leaves through [Email Service](https://developers.cloudflare.com/email-service/). Each mailbox lives in its own [Durable Object](https://developers.cloudflare.com/durable-objects/) with a SQLite database. Message bodies, raw MIME and attachments are kept in [R2](https://developers.cloudflare.com/r2/), and accounts in [D1](https://developers.cloudflare.com/d1/). The assistant is built with the [Agents SDK](https://developers.cloudflare.com/agents/) and [Workers AI](https://developers.cloudflare.com/workers-ai/).

## Use the hosted service

- **Web:** sign up at [inboxies.app](https://inboxies.app).
- **iOS and Android:** the native apps in [`ios/`](./ios/README.md) and [`android/`](./android/README.md) connect to the hosted service.
- **MCP:** connect an MCP client to `https://inboxies.app/mcp`. It signs in with OAuth. You choose the scopes (`read` always, plus `draft`, `send` or `manage`) and the mailboxes the client may use.

You don't need anything in this repository to use Inboxies. The rest of this README is for developers.

## Features

- **Full email client:** send and receive mail with a rich text composer, threaded replies and forwards, folders, full-text search and attachments.
- **Per-mailbox isolation:** each mailbox runs in its own Durable Object, with SQLite for metadata, snippets and the search index, and R2 for bodies, raw MIME and attachments.
- **Built-in AI assistant:** a side panel that can read, search and draft mail. It saves drafts. Sending is always your choice.
- **MCP server:** outside AI tools can work with your mailboxes over OAuth 2.1, with scopes and a mailbox list you approve.
- **Accounts:** passwords, passkeys, two-factor authentication, and Sign in with Apple or Google. Mailboxes can be shared with other people as owners or members.
- **Native apps:** SwiftUI for iOS and Jetpack Compose for Android, using the same Worker API.

## Stack

- **Frontend:** React 19, React Router v7, Tailwind CSS, Zustand, TipTap, `@cloudflare/kumo`
- **Backend:** Hono, Cloudflare Workers, Durable Objects (SQLite), D1, R2, KV, Queues, Email Routing, Email Service
- **AI assistant:** Cloudflare Agents SDK (`AIChatAgent`), AI SDK v6, Workers AI (`@cf/moonshotai/kimi-k2.5`), `react-markdown` + `remark-gfm`
- **Auth:** [Better Auth](https://www.better-auth.com/) with users and sessions in D1; Cloudflare Access for operator routes under `/ops`

## Run it locally

You need Node.js, [pnpm](https://pnpm.io/) and a Cloudflare account. Workers AI and the `send_email` binding run against Cloudflare even in local dev, so sign in to Wrangler first.

```bash
pnpm install
pnpm wrangler login
cp .dev.vars.example .dev.vars
pnpm auth:migrate:local
pnpm dev
```

Open `http://localhost:5173` and create an account at `/onboarding`. Local dev keeps D1, KV and R2 data in `.wrangler/state`, apart from any deployed Worker.

## Self-host on Cloudflare

Self-hosting is supported. You deploy the same Worker to your own Cloudflare account and receive mail on your own domain. `wrangler.jsonc` in this repository is set up for the hosted service: it names its resources, routes and domains. Before your first deploy, create your own resources and point the config at them.

There is no Deploy to Cloudflare button. The config's custom-domain routes and production values would make that flow fail or deploy a broken copy.

### Prerequisites

- A Cloudflare account with a domain on Cloudflare DNS
- [Email Routing](https://developers.cloudflare.com/email-routing/) for that domain, to receive mail
- [Email Service](https://developers.cloudflare.com/email-service/) set up for that domain, to send mail
- [Workers AI](https://developers.cloudflare.com/workers-ai/), for the assistant
- Node.js and pnpm

### 1. Clone and install

```bash
git clone https://github.com/aveer-dev/boxies.git
cd boxies
pnpm install
pnpm wrangler login
```

### 2. Create the resources

Create these in your account, then put the new IDs in `wrangler.jsonc`:

| Resource | Command | In `wrangler.jsonc` |
| --- | --- | --- |
| D1 database for accounts | `pnpm wrangler d1 create inboxies-auth` | `d1_databases[0].database_id` (and `database_name` if you chose another name) |
| KV namespace for MCP OAuth | `pnpm wrangler kv namespace create OAUTH_KV` | `kv_namespaces[0].id` |
| R2 bucket for mail | `pnpm wrangler r2 bucket create agentic-inbox` | `r2_buckets[0].bucket_name` and `preview_bucket_name` if you chose another name |
| Queues for sending and delivery events | `pnpm run ensure-queues` | Nothing to change. It creates `outbound-send`, `outbound-send-dlq`, `email-sending-events` and `email-sending-events-dlq` |

Durable Objects, Workers AI and the rate limiters need nothing created. Each rate limiter's `namespace_id` must be unique in your account, so change them if they clash with limiters you already have.

### 3. Point the config at your domain

In `wrangler.jsonc`:

- `name`: your Worker's name.
- `routes`: replace `inboxies.email` and `inboxies.app` with your own hostname(s). You can also delete `routes` and set `workers_dev` to `true` to use a `workers.dev` address.
- `vars.DOMAINS`: the domain(s) you receive mail for, comma-separated. New addresses use the first one, unless you set `MAIL_DOMAIN`.
- `vars.APP_BASE_URL`: the URL the web app is served from, for example `https://mail.example.com`. Sign-in, passkeys, MCP OAuth and links in emails all use it.
- `vars.WEB_REDIRECT_HOSTS`: hosts whose web pages should redirect to `APP_BASE_URL`. Use `""` if you serve from one host.
- `vars.APPLE_WEB_SERVICES_ID`, `APNS_TOPIC` and `APNS_SANDBOX` are the hosted service's Apple identifiers. They do nothing until you add Apple secrets (step 5). Change them to your own when you do.

### 4. Create the account tables

```bash
pnpm auth:migrate:remote
```

This applies `migrations/auth` to the D1 database bound as `AUTH_DB`.

### 5. Set secrets and deploy

Put your secrets in a file outside the repository, as JSON or `.env` lines (`NAME=value`). `BETTER_AUTH_SECRET` is required. Without it nobody can sign in. Generate one with `openssl rand -base64 32`.

```bash
pnpm run build
pnpm wrangler deploy --secrets-file ../inboxies-secrets.env
```

Delete the file afterwards. Secrets you leave out of a later `--secrets-file` deploy keep their values, so you only need to include the ones you are adding or changing. After that, `pnpm run deploy` deploys code changes.

Optional secrets (see `.dev.vars.example` and `workers/types.ts`):

| Secret | What it turns on |
| --- | --- |
| `POLICY_AUD`, `TEAM_DOMAIN` | Operator tools under `/ops`, behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/). Unset leaves `/ops` closed. `TEAM_DOMAIN` may be the Access team URL or the full `.../cdn-cgi/access/certs` URL. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_EXTRA_CLIENT_IDS` | Sign in with Google |
| `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET`, `APPLE_TEAM_ID`, `APPLE_SIGNIN_KEY_ID`, `APPLE_SIGNIN_PRIVATE_KEY` | Sign in with Apple |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `FCM_SERVICE_ACCOUNT_JSON` | Push notifications for your own builds of the native apps |
| `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `WORKER_NAME`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | The hosted service's sign-up with a custom domain, which sets up the domain's zone and Email Routing and takes payment. Not needed to run on your own domain. |

### 6. Connect email

1. **Receive:** in the Cloudflare dashboard, open your domain → **Email Routing** and add a catch-all rule that sends to this Worker.
2. **Send:** set up your domain for [Email Service](https://developers.cloudflare.com/email-service/) so the Worker's `send_email` binding can send from it. Sends, replies and forwards go through the `outbound-send` queue. Messages that run out of retries go to `outbound-send-dlq`, and the Sent message is marked failed.
3. **Delivery events (recommended):** open **Queues → email-sending-events → Event subscriptions**, choose **Email Sending** for your domain, and subscribe at least to `message.bounced` and `message.complained` (optionally `message.failed` and `message.rejected`). Subscribe to `message.delivered` and `message.deferred` too for per-recipient status. Bounces and complaints then show on the Sent message in the thread. Events that fail 5 times go to `email-sending-events-dlq`, are kept in R2, and can be listed, replayed or discarded under `/ops/dead-letters/email-sending-events`.

### 7. Create your account

Open `APP_BASE_URL` and sign up at `/onboarding` for an address on your domain. Anyone who can reach your Worker can sign up the same way.

Outbound messages larger than **5 MiB** (body and attachments) are rejected with HTTP `413` before sending. Mailbox send rate limits return HTTP `429`.

## Accounts and mailbox access

Users, sessions, passkeys and two-factor settings live in D1 through Better Auth (`workers/auth/`). Each mailbox has members with a role, `owner` or `member`, and every request is checked against that role (`workers/auth/authz.ts`). Owners can share a mailbox with other people. MCP (`/mcp`) and the assistant (`/agents/*`) go through the same checks.

Operators (people running the deployment) are a separate group. They sign in to `/ops` through Cloudflare Access to manage domains and mailboxes, read the audit log, replay dead-lettered events and see spam metrics (`workers/routes/ops.ts`).

## MCP

MCP clients authenticate to `/mcp` with OAuth 2.1: dynamic client registration and PKCE S256. Discovery is at `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server` on `APP_BASE_URL`. A signed-in user gives consent at `/authorize` and picks the scopes (`read`, always granted, plus `draft` / `send` / `manage`) and the mailboxes the client may use. Clients, grants and tokens are stored in the `OAUTH_KV` namespace. Without that binding OAuth is off, and `/mcp` accepts only a session token sent as `Authorization: Bearer`, which is being deprecated. See `workers/mcp/oauth.ts`.

In local dev (`pnpm dev`), `OAUTH_KV` is a local namespace under `.wrangler/state` that starts empty, so register and authorize an MCP client against your local server. On the hosted service, MCP is at `https://inboxies.app/mcp`.

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

The Worker also uses D1 (`AUTH_DB`) for accounts, mailbox membership and domains; KV (`OAUTH_KV`) for MCP OAuth; the `EmailMCP` Durable Object for the MCP server; the `ExportJobDO` Durable Object for mailbox exports; and Queues for outbound sends and Email Sending events. An hourly cron does upkeep (`workers/lib/maintenance.ts`).

Full HTML and raw MIME are stored in R2 (`emails/{id}/body.html`, `emails/{id}/raw.eml`). The mailbox's SQLite database keeps metadata and a short `snippet` for list previews, plus an **FTS5** index (`emails_fts`) over subject, sender, recipients and plain-text body, so search matches the whole message and not just its first 300 characters. Deleting a mailbox purges its Durable Object, its R2 bodies and attachments, and its assistant chat history.

## License

Apache 2.0. See [LICENSE](LICENSE).

Inboxies started as a fork of [Agentic Inbox](https://github.com/cloudflare/agentic-inbox) by Cloudflare, Inc., also licensed under Apache 2.0. Files from that project keep their Cloudflare copyright headers, and the copyright notice in [LICENSE](LICENSE) is Cloudflare's. You can read more about the original project in Cloudflare's [Email for Agents](https://blog.cloudflare.com/email-for-agents/) blog post.
