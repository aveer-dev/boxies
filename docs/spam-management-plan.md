# Spam management plan

Status: approved (AVE-88). Decisions recorded 2026-10-22 (section 10). This is research and design only; the implementation work is the set of sub-issues in section 9.

## 1. Problem

> When an email arrives in spam and I set it to "not spam", I do not expect later email from that contact to land in spam.

This is how every mainstream provider behaves, and Inboxies does not do it reliably today. The sections below explain why, then propose one sender-reputation model shared by the Worker, web, iOS and Android.

## 2. Current behaviour

### Inbound pipeline

| Step | Code | What it does |
| --- | --- | --- |
| 1. Auth signals | `parseAuthSignals` in `workers/lib/email-auth.ts` | Reads Cloudflare's `Authentication-Results` / `ARC-Authentication-Results` (authserv `*.cloudflare.net` only). Sets `aligned` to true, false, or null when there's no trusted verdict. **Sets `spoofed = aligned !== true` whenever any SPF/DKIM/DMARC verdict can be evaluated** (line ~442). |
| 2. Classify | `classifyInboundEmail` → `classifyFromHeaders` in `workers/lib/classify-email.ts` | Spam headers (`X-Spam-Flag`, `X-Spam-Status: yes`, `Precedence: junk`) → spam. `Auto-Submitted` / `List-*` → bulk (Promotions/Updates). `isAuthSpoofed` → spam with reason `auth-spoofed`. Anything else goes to the Workers AI spam/ham prompt, which fails open to ham. |
| 3. Vouch override | `overrideAiSpamForVouchedSender` (classify-email.ts), called in `workers/index.ts` ~2058 | Only an **`ai-spam`** verdict can be overridden, and only when the sender is vouched (`isVouchedSender` in `workers/lib/sender-triage.ts`) **and** `auth.aligned === true`. |
| 4. Route | `resolveInboundFolder` in `workers/lib/sender-triage.ts` | Spam always comes first. Then rejected → Screened out (or Spam when Screener is off), unknown → Screener, allowed → filter / purpose preference / triage destination / classifier. |

### What "Not spam" writes

Web (`handleSpamAction`, `app/components/EmailPanel.tsx`), iOS (`markNotSpam`, `ios/.../Services/EmailActionExecutor.swift`) and Android (`markNotSpam`, `android/.../services/AppModel.kt`) all call `POST /api/v1/mailboxes/:id/emails/:id/move` with `folderId: "inbox"` and `setSenderPreference: true`. The handler (`workers/index.ts` ~736, `senderLessonForMove`) then writes:

- `sender_triage(sender, status='allowed', destination_folder_id='inbox')`. This table lives in the per-mailbox Durable Object SQLite, keyed by the exact lower-cased From address.
- `sender_preferences(address, folder_id='inbox', source='user')`.

"Report spam" writes `sender_triage.status='rejected'` and deletes the purpose preference. With Screener on, that sender's future mail goes to **Screened out**, not Spam.

So "Not spam" does persist. There's no trivial persistence bug. The problem is that the allow decision never reaches most of the verdicts that put mail in Spam.

### Root cause of the AVE-88 symptom

1. **`auth-spoofed` is far too broad, and nothing overrides it.** Any message whose SPF/DKIM pass for a domain other than the From domain gets `spoofed = true`, even when the From domain publishes no DMARC policy (`dmarc=none`). That covers a small business on SendGrid/Mailchimp/HubSpot, a calendar or helpdesk tool sending "as" a person, and mail relayed by a forwarder or list. I reproduced this locally:
   - Input: `dkim=pass header.d=sendgrid.net; spf=pass smtp.mailfrom=…sendgrid.net; dmarc=none` with `From: ada@smallbiz.example`.
   - Result: `aligned:false, spoofed:true`, so `classifyFromHeaders` returns `{spam, auth-spoofed}`.
   - Step 3 only overrides `ai-spam`, so this sender lands in Spam **every time**, however often the user clicks Not spam.
2. **No trusted verdict means no override.** When `aligned` is null (no Cloudflare `Authentication-Results` header, or only `none`/`neutral` verdicts), an `ai-spam` verdict is never overridden for a vouched sender.
3. **Upstream spam headers are final.** Step 2 never consults the allow list for them.
4. **The allow list is keyed by exact address only.** Not-spamming `billing@acme.com` does nothing for `receipts@acme.com`. No domain-level allow or block exists.
5. **Other ways out of Spam teach nothing.** These paths don't send `setSenderPreference`:
   - the web move menu when the user declines "remember" (`handleMove`);
   - iOS bulk `moveEmails`;
   - swipe moves;
   - the agent/MCP `move_email` tool (`toolMoveEmail`).
6. **The verdict is invisible.** The classification `reason` is only logged and never stored on the email, so the UI can't say *why* something is in Spam, and support can't debug it.

Two smaller gaps: "Not spam" always files to Inbox even for bulk mail, and neither action moves the sender's *other* messages.

## 3. How other providers handle it

| Provider | User "not spam" / allow | Block | Auth interaction |
| --- | --- | --- | --- |
| **Gmail** | "Report not spam" trains the per-user model. Contacts and people you've replied to get a boost. A filter with "Never send it to Spam" is the hard allow. ([help](https://support.google.com/mail/answer/1366858)) | "Block sender" sends future mail to Spam. | Unauthenticated mail gets warning banners. Phishing and malware verdicts still win over filters. |
| **Outlook / Microsoft 365** | Safe Senders and Safe Domains lists, by address or domain. Contacts can count as safe. ([docs](https://learn.microsoft.com/en-us/defender-office-365/create-safe-sender-lists-in-office-365)) | Blocked Senders / Domains go to Junk. | Safe lists don't override malware or high-confidence phishing. Microsoft recommends against domain-wide safe lists for widely spoofed domains. |
| **iCloud Mail** | "Not Junk" (move out of Junk) trains the filter. | "Block sender" (synced) sends mail to Trash. | Server-side filtering is opaque. No user-visible allow list. |
| **Fastmail** | Moving mail out of Spam trains a per-user Bayes filter. Contacts can be treated as trusted. | Block sender → filter rule (Sieve under the hood). | Authentication results feed the score. |
| **Proton Mail** | Explicit **Allow list** and **Block list** (address or domain) in Settings → Filters. "Not spam" adds the sender to the allow list. ([support](https://proton.me/support/spam-filtering)) | Block list sends mail to Spam. | Lists apply on top of Proton's filtering; how they interact with auth failures isn't documented in detail. |
| **HEY** | The Screener: first contact needs a yes/no, and that decision covers the sender from then on. | "Screened out" is a silent block. | Spam filtering is separate from the Screener. |

What they agree on:

- The user's decision is **remembered per sender**, and the user can see it.
- It can be **address- or domain-scoped**.
- A user allow **lowers the spam score, but doesn't beat proven spoofing, phishing or malware**.
- Block and allow lists are **editable in Settings**.

Our Screener is already HEY-like. The missing piece is a Proton/Outlook-style allow/block list that the spam step actually respects.

## 4. Relevant standards

- **SPF** ([RFC 7208](https://www.rfc-editor.org/rfc/rfc7208)) and **DKIM** ([RFC 6376](https://www.rfc-editor.org/rfc/rfc6376)) authenticate the envelope domain and the signing domain. Neither one proves the visible From.
- **DMARC** ([RFC 7489](https://www.rfc-editor.org/rfc/rfc7489); DMARCbis in progress at the IETF) is what ties SPF/DKIM to the **From domain** (alignment).
  - `dmarc=fail` against a `p=quarantine`/`reject` policy is a strong spoofing signal.
  - Unaligned mail from a domain with **no DMARC policy** is only *unverified*. The domain owner hasn't asked receivers to reject it.
  - **Our `spoofed` flag treats unverified as forged. That's the bug in root cause 1.**
- **Authentication-Results** ([RFC 8601](https://www.rfc-editor.org/rfc/rfc8601)): only trust results from your own authserv-id. We already restrict this to `cloudflare.net`.
- **ARC** ([RFC 8617](https://www.rfc-editor.org/rfc/rfc8617)) keeps authentication results across forwarders and lists. Honour ARC only from trusted sealers. Without it, "allow" breaks for forwarded mail.
- **List headers**: `List-Unsubscribe` / `List-Id` ([RFC 2369](https://www.rfc-editor.org/rfc/rfc2369), [RFC 2919](https://www.rfc-editor.org/rfc/rfc2919)) and one-click unsubscribe ([RFC 8058](https://www.rfc-editor.org/rfc/rfc8058)).
  - The [Gmail](https://support.google.com/a/answer/81126) and [Yahoo](https://senders.yahooinc.com/best-practices/) 2024 bulk-sender rules require SPF+DKIM, DMARC alignment, one-click unsubscribe and a spam rate below 0.3%.
  - Bulk mail that meets these rules is legitimate, and "Report spam" on it should offer **Unsubscribe**.
- **Spam keywords**: IMAP4rev2 ([RFC 9051 §2.3.2](https://www.rfc-editor.org/rfc/rfc9051#section-2.3.2)) and JMAP Mail ([RFC 8621](https://www.rfc-editor.org/rfc/rfc8621)) define `$Junk`, `$NotJunk` and `$Phishing`. They're listed in the [IANA IMAP/JMAP keywords registry](https://www.iana.org/assignments/imap-jmap-keywords/imap-jmap-keywords.xhtml). Our verdict should map to these if we ever expose IMAP/JMAP.
- **Sieve** ([RFC 5228](https://www.rfc-editor.org/rfc/rfc5228)) is the standard per-user filter language. Allow/block lists are equivalent to Sieve `address :is`/`:domain` tests. Keep our rules expressible that way so they can be exported.
- **Abuse Reporting Format / feedback loops** ([RFC 5965](https://www.rfc-editor.org/rfc/rfc5965)): "Report spam" could later produce ARF reports. This is out of scope for now.

## 5. Model

### Sender rules, per mailbox

There is one rule list per mailbox. Each rule is an **address** or a **domain** with a verdict of `allow` or `block`, plus a source:

- `not_spam`
- `report_spam`
- `settings`
- `screener`
- `sent` (we emailed them)
- `bootstrap`

Address rules beat domain rules. Domain rules match subdomains (relaxed, like DMARC).

### Auth tiers (replaces the boolean `spoofed`)

| Tier | Meaning |
| --- | --- |
| `verified` | DMARC pass, or SPF/DKIM pass *aligned* with the From domain, or a trusted ARC chain carrying one of these. |
| `unverified` | No trusted verdict, or passes only for a different domain, with no DMARC policy on the From domain. |
| `failed` | `dmarc=fail` and the From domain publishes `p=quarantine`/`reject`, or SPF hard-fail and no DKIM pass for any domain. |

Only `failed` counts as spoofed. `unverified` mail goes to the normal classifier, as Gmail does, and shows an "unverified sender" banner.

### Precedence (first match wins)

1. **Auth `failed`** → Spam (`auth-failed`). No allow rule overrides this.
2. **User block** (address, then domain) → Screened out if Screener is on, otherwise Spam.
3. **User allow** (address, then domain):
   - If `verified`: never Spam. Skip the AI and spam-header verdicts and file by filter / preference / classifier (bulk vs inbox).
   - If `unverified`: allow an **address** rule (not a domain rule), file normally, and show the "unverified" banner. A domain rule needs `verified`, because domain-wide allows are what spoofers exploit.
4. **Implicit trust** (we sent to them, or accepted in Screener): overrides an AI-only verdict. This is today's vouch behaviour, extended to `unverified`. Contacts are not an explicit allow (decision 5).
5. **Upstream spam headers** → Spam.
6. **AI / heuristics** → Spam / ham / bulk.

This fixes AVE-88: a not-spammed sender is either `verified` (always allowed) or `unverified` (allowed by address, with a banner). Only a sender that actually fails DMARC stays in Spam, and the UI can now say why.

### What the actions write

| Action | Writes | Retroactive | Undo |
| --- | --- | --- | --- |
| **Not spam** (any path out of Spam: button, move menu, swipe, bulk, MCP) | `allow` rule for the address, source `not_spam`. Clears any `block`. Sets `sender_triage = allowed`. | Moves the sender's other Spam messages from the last 30 days to their classified folder. Returns `rescuedCount`. | Toast "Undo" deletes the rule and moves the messages back. |
| **Report spam** | `block` rule for the address. Drops the purpose preference. For bulk mail with RFC 8058 one-click unsubscribe, also shows an "Unsubscribe" checkbox, unchecked by default. | Moves that sender's Inbox/Promotions/Updates mail to Spam (opt-in checkbox, default on). | Toast "Undo". |
| **Block domain / Allow domain** (Settings only) | Domain rule. A domain allow only ever applies to `verified` mail. Refused for free-mail providers and public suffixes. | As above, scoped to the domain. | Remove the rule in Settings. |

The MCP/agent `move_email` tool must **not** create rules implicitly. Agents get explicit `allow_sender` / `block_sender` tools, gated by the existing scope checks from AVE-69.

### Explainability

Store `classification_reason`, `auth_tier` and `matched_rule_id` on each email. Spam and Screened-out readers show a one-line reason, for example:

- "Failed sender authentication"
- "You blocked acme.com"
- "Our filter thought this looked like spam"

## 6. UI (web, iOS, Android — design twins)

- **Reader:**
  - Keep the existing Report spam / Not spam button.
  - After Not spam, the toast says "Moved to Inbox · future mail from ada@x will skip Spam" with **Undo**. If other messages were rescued, it adds "· 3 more moved".
  - An "Unverified sender" banner appears for `unverified` mail. A spam-reason line appears in Spam.
- **Settings → Senders** gets three tabs: **Allowed**, **Blocked** and **Sorting** (today's purpose preferences).
  - Each row shows the address or domain, source and date, with remove/edit.
  - An "Add" button takes an address or `@domain`. This is the only place domain rules are created.
  - Same layout on all three clients. iOS uses `SendersSettingsView` and Android uses its Senders screen. Use `AppTheme` / `InboxiesColors` tokens. No new IA.
- **Move-out-of-Spam paths** (move menu, swipe, multi-select) behave exactly like Not spam. No "remember?" prompt for leaving Spam: leaving Spam is the signal.

## 7. Data model and API

DO SQLite migration (`workers/durableObject/migrations.ts`):

```sql
CREATE TABLE sender_rules (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('address','domain')),
  value TEXT NOT NULL,              -- normalized address or registrable domain
  verdict TEXT NOT NULL CHECK (verdict IN ('allow','block')),
  source TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  last_matched_at TEXT, match_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (kind, value)
);
ALTER TABLE emails ADD COLUMN classification_reason TEXT;
ALTER TABLE emails ADD COLUMN matched_rule_id TEXT;
```

**Backfill:**

- `sender_triage.rejected` becomes address `block` rules.
- `sender_triage.allowed` stays as is. It's implicit trust (tier 4), not an explicit allow, unless a `sender_preferences` row with `source='user'` exists.

`sender_triage` keeps its Screener role. `sender_rules` is the explicit spam list.

**Endpoints** (mailbox-scoped, same auth as today):

- `GET /api/v1/mailboxes/:id/sender-rules?verdict=allow|block&q=`
- `PUT /api/v1/mailboxes/:id/sender-rules` with body `{kind, value, verdict}`
- `DELETE /api/v1/mailboxes/:id/sender-rules/:ruleId`
- `POST /emails/:id/move` gains `rescuedCount`/`undoToken` in the response. Rules are written for every move out of or into Spam.
- `POST /api/v1/mailboxes/:id/sender-rules/undo` with body `{undoToken}`

Use a normalized registrable domain (Public Suffix List) for domain rules. Today's `domainsAligned` has no PSL. Add one before shipping domain rules so that `@co.uk` can't be allow-listed. `PUT` also refuses domain rules for a bundled free-mail provider list (gmail.com, outlook.com, icloud.com, …).

## 8. Metrics

These are logged per mailbox and aggregated without content:

- spam rate by `classification_reason`
- Not-spam rate (false positives) by reason. **This is the headline AVE-88 metric. Target: under 1% of Spam rescued, and zero repeat rescues for a sender with an allow rule.**
- Report-spam rate on Inbox mail (false negatives)
- rule counts and match counts
- `unverified` share of inbound

## 9. Sub-issues

Ship #1 and #2 first. Together they fix the reported symptom without new UI.

| # | Title | Size | Platforms | Depends on |
| --- | --- | --- | --- | --- |
| 1 | Split `spoofed` into auth tiers | M | Worker | — |
| 2 | Allowed senders beat AI verdicts and spam headers | S | Worker | 1 |
| 3 | Store and show the spam reason and auth tier | M | Worker, web, iOS, Android | 1 |
| 4 | Every move into or out of Spam teaches the sender | S | Worker, web, iOS, Android, MCP | 2 |
| 5 | `sender_rules` table, API and domain rules | M | Worker | 2 |
| 6 | Settings → Senders: Allowed / Blocked tabs | M | web, iOS, Android | 5 |
| 7 | Retroactive rescue and refile, with Undo | M | Worker, web, iOS, Android | 4, 5 |
| 8 | Report spam on bulk mail offers unsubscribe | S | Worker, web, iOS, Android | 4 |
| 9 | Spam metrics | S | Worker, admin dashboard | 3 |

**1. Split `spoofed` into auth tiers (M).** Replace the boolean `spoofed` in `parseAuthSignals` with `authTier: verified | unverified | failed` (section 5). `failed` needs `dmarc=fail` with `p=quarantine`/`reject`, or SPF hard-fail with no DKIM pass. Honour ARC only from trusted sealers. `classifyFromHeaders` returns `auth-failed` only for `failed`.
Done when: the SendGrid-style `dmarc=none` case is `unverified` and is not spam; `dmarc=fail p=reject` is `failed` and is spam; `email-auth.test.mjs` and `classify-email.test.mjs` cover all three tiers.

**2. Allowed senders beat AI verdicts and spam headers (S).** Apply the section 5 precedence in the inbound path. An allowed address skips AI and upstream spam-header verdicts when `verified`, and AI verdicts when `unverified`. Treat `aligned === null` as `unverified`, not as "no override". Implicit trust (we sent to them, Screener accepted) overrides AI-only verdicts. Depends on #1.
Done when: after Not spam, the next message from an `unverified` ESP sender lands in Inbox; a `failed` message from the same sender still lands in Spam; tests cover each precedence step.

**3. Store and show the spam reason and auth tier (M).** Add `classification_reason`, `auth_tier` and `matched_rule_id` to `emails` and return them from the email API. Show a one-line reason in Spam and Screened out, and an "Unverified sender" banner on `unverified` mail, on web, iOS and Android (design twins, existing tokens). Depends on #1.
Done when: every new email has a stored reason and tier; all three clients show the reason line and banner; the banner appears for an allowed `unverified` sender.

**4. Every move into or out of Spam teaches the sender (S).** The move menu, swipe and multi-select on all clients behave like Not spam / Report spam, with no "remember?" prompt. MCP `move_email` stays neutral; add explicit `allow_sender` / `block_sender` agent tools behind the AVE-69 scope checks. Depends on #2.
Done when: moving out of Spam by any client path records the allow; `move_email` writes no rule; the new agent tools are scope-checked and tested.

**5. `sender_rules` table, API and domain rules (M).** Add the section 7 DO migration and backfill (`sender_triage.rejected` → address block rules). Add GET/PUT/DELETE `sender-rules` endpoints. Normalize domains with the Public Suffix List. Refuse domain rules for public suffixes and free-mail providers. Domain allows apply only to `verified` mail. Depends on #2.
Done when: the migration and backfill run on existing mailboxes; CRUD endpoints are tested; `@co.uk` and `@gmail.com` rules are rejected; an unverified message never matches a domain allow.

**6. Settings → Senders: Allowed / Blocked tabs (M).** Add Allowed, Blocked and Sorting tabs on web, iOS (`SendersSettingsView`) and Android. Each row shows address or domain, source and date, with remove. "Add" takes an address or `@domain`. This is the only place to create domain rules. Depends on #5.
Done when: all three clients list, add and remove address and domain rules; the free-mail refusal shows an inline error; iOS and Android match visually.

**7. Retroactive rescue and refile, with Undo (M).** Not spam moves the sender's other Spam messages from the last 30 days to their classified folder. Report spam moves that sender's Inbox/Promotions/Updates mail to Spam (checkbox, default on). The move response returns `rescuedCount` and `undoToken`; `POST sender-rules/undo` reverts the rule and the moves. Toasts with Undo on all clients. Depends on #4, #5.
Done when: Not spam on one message rescues the sender's recent Spam and the toast says "· N more moved"; Undo restores both the rule and the folders.

**8. Report spam on bulk mail offers unsubscribe (S).** When the reported message has `List-Unsubscribe` with RFC 8058 `List-Unsubscribe-Post`, the Report spam confirmation shows an "Unsubscribe" checkbox, unchecked by default. When checked, the Worker sends the one-click POST. Web, iOS and Android. Depends on #4.
Done when: the checkbox appears only for RFC 8058 mail, is unchecked by default, and when checked the Worker sends exactly one POST; tests cover the POST.

**9. Spam metrics (S).** Log, per mailbox and without content, the section 8 metrics: spam rate by reason, Not-spam rate by reason, Report-spam rate on Inbox mail, rule and match counts, and `unverified` share. Show them in the admin/ops dashboard. Depends on #3.
Done when: the dashboard shows each metric for the last 7 and 30 days, including repeat rescues for senders with an allow rule.

## 10. Decisions (approved 2026-10-22)

Emmanuel approved the recommended defaults.

1. **Not spam on an `unverified` sender allows it**, for that exact address only, with an "Unverified sender" banner. Domain allows require `verified`.
2. **Not spam rescues that sender's other Spam messages** from the last 30 days, with Undo.
3. **Blocked senders' mail goes to Screened out when Screener is on**, as today. Both appear under Settings → Senders → Blocked.
4. **Report spam on a newsletter offers unsubscribe**, unchecked by default.
5. **Contacts do not count as an explicit allow.** "We emailed them" stays implicit trust (precedence step 4).
6. **Block domain is Settings only at first.** Domain rules are refused for free-mail providers.
