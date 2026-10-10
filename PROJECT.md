# Web mailbox: horizontal Miller columns

The web client (`app/`) shows a mailbox as columns side by side that scroll
horizontally, per the Figma file `zxP77RlQB26hQn8XsEof7W`, frame `18:970`
("Kōdo Mail Workspace"). Every capability of the old sidebar/list/panel layout
is kept; see the parity table below.

## Layout

```
[Inboxies] [Folders & tags] [List] [Reader] [Compose] [Assistant]    + floating dock
   300          300           400    flex ≥848    600       400
```

- **Inboxies**: every mailbox, inbox unread count, "+ Add" (opens
  `OnboardingFlow`), and a menu with All mailboxes / Admin / Log out.
- **Folders & tags**: system folders in `shared/folders.ts` order, Workflow
  (Reply Later), then Tags. Tags are custom folders shown as `#name`. A message
  carries one tag: the folder it's in.
- **List**: the folder, Reply Later or search results, depending on the route.
- **Reader**: the full `EmailPanel` (toolbar, thread, Screener triage,
  attachments), plus a docked quick reply.
- **Compose** and **Assistant** are transient columns that open on the right.
- **Dock**: search (⌘K), settings, assistant toggle, compose (C).

On phones (below `md`), each column is one screen wide and the canvas snaps
between columns. Headers show a back chevron.

## The URL decides the columns

| Route | Columns after Folders |
|---|---|
| `/mailbox/:id/emails/:folder/:emailId?` | list, then reader when `:emailId` is set |
| `/mailbox/:id/reply-later/:emailId?` | Reply Later, then reader |
| `/mailbox/:id/search/:emailId?` with `?q=` | results, then reader |
| `/mailbox/:id/settings/:page?` | Settings, then the sub-page column |

- **Route-driven columns**: each child route renders its own column(s) with
  `ColumnPane`. That way back/forward, reload and deep links all work.
- **URL helpers**: `app/hooks/useMailNavigation.ts` builds every URL change
  (`openEmail`, `closeEmail`, `search`, settings) and `closeDeepest` (Esc, and
  the phone back chevron).
- **Transient state**: `app/hooks/useUIStore.ts` holds only what isn't in the
  URL — compose options, whether the assistant is open, and the AI Assist prompt.
- **Focus**: `app/hooks/useColumnFocus.ts` tracks which column has keyboard focus.
- **Scrolling**: `ColumnCanvas` scrolls the right-most column into view after
  every navigation.

## Keyboard

| Key | Action |
|---|---|
| `[` / `]` | Move focus between columns |
| Esc | Close the right-most closable column |
| ⌘K | Search |
| C | Compose |
| ⌘↵ (in quick reply) | Send |
| ⇧⌘O (in quick reply) | Pop out to the composer, carrying the text |
| ⌘J (in reader) | AI Assist: opens the assistant with a reply prompt |

## Parity with the previous layout

| Capability | Where it lives now |
|---|---|
| All system folders, unread counts, custom folders, create folder | Folders & tags column |
| Reply Later, Focus & Reply, Skip | Workflow → Reply Later column |
| Inbox New/Seen sections, star, mark read/unread, delete, badges (thread count, Draft, Spoofed, Needs reply, files), refresh, 30s refetch, 25/page pagination, per-folder empty states | List column (`ThreadRow`) |
| Search operators, highlighting, folder/tag chip, pagination | Search column |
| Reader toolbar (reply, reply-all, forward, star, Reply Later, read, move, view source, delete), Screener triage, threads, drafts Send/Edit/Discard, private-email banner, attachments | Reader column (`EmailPanel`) |
| Composer (autocomplete, rich text, attachments, autosave, send from alias) | Compose column |
| Agent chat + MCP tab | Assistant column (dock button or ⌘J) |
| Settings + 7 sub-pages | Settings column + sub-page column |
| Mailbox switch, home, admin, log out, create mailbox | Inboxies column |

Reply envelopes (to / cc / from-alias / subject) come from
`shared/reply-envelope.ts`, which both the quick reply and the composer use.
It is covered by `workers/test/reply-envelope.test.mjs` (in `pnpm test:unit`).

## Not built yet

- **Real multi-label tags.** Tags are folders today.
- **Priority/VIP and Scheduled folders.** They're in the Figma file, but there is
  no backend for them.
- **`/` reply templates.**
