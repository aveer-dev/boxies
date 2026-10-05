# Project: Persistent Horizontal Column Navigation Canvas (Miller Columns / Infinite Sliding Panes)

## Architecture
A persistent horizontal column navigation canvas for the Inboxies web client (`app/`) replacing full-page routing transitions with infinite sliding panes based on Figma design `node-id=18-970`, strictly adhering to `@cloudflare/kumo` color tokens and preserving all rich email reader capabilities.

### Key Architectural Layers:
1. **Column Stack Engine (`app/hooks/useColumnStack.ts`)**:
   - Centralized state store managing an ordered column array: `columns: ColumnItem[]`.
   - Parallel link routing: selecting a new sibling in column $N$ replaces/updates column $N+1$ in-place while cleanly truncating any downstream descendants at $N+2+$.
   - Platform link routing: auxiliary views (Settings, Compose, Search, Agent) are opened adjacent to the active column or appended, focusing existing instances without duplication.
   - Smooth auto-scroll: programmatically brings newly opened/appended columns into view via `scrollIntoView({ behavior: 'smooth', inline: 'nearest' })`.
   - Dismissal: non-root columns feature a subtle close button (`✕`) in their header to remove the column and its descendants.

2. **Canvas Shell (`app/components/columns/ColumnCanvas.tsx` & `ColumnPane.tsx`)**:
   - Root container: `overflow-x-auto h-screen w-screen bg-kumo-base scroll-smooth flex flex-row flex-nowrap`.
   - Holds mounted columns side-by-side with `border-r border-kumo-line`.
   - Scroll offsets, active item selections, and live DOM state remain preserved when scrolling or swiping horizontally.

3. **Column Adapters (`app/components/columns/*`)**:
   - **Col 1 (Accounts - 300px)**: Root list of connected mailboxes, active indicator dots (`bg-kumo-default`), account names, email handles, unread counters (`text-kumo-subtle`).
   - **Col 2 (Folders & Tags - 300px)**: Account navigation with core system folders (`Inbox`, `Priority/VIP`, `Sent`, `Drafts`, `Scheduled`, `Archive`, `Trash`) with counts, and custom tags section (`HYPERION TAGS` with hashtag pills).
   - **Col 3 (Thread List - 400px)**: Email list feed with folder title, message count badge, mark-all-read checkmark, unread dots, sender, timestamp, subject, 1-line snippet, tag chips (`#Engineering-PRs`), attachment indicators (`2 files`).
   - **Col 4 (Reading Room - 848px+ / flex-1)**: Reading pane with category breadcrumbs, large subject header, sender avatar circle, preserved `EmailPanel` and all subcomponents, and docked quick reply bar (`Pop Out ⇧⌘O`, AI Assist `⌘J`, `Send`).
   - **Platform Columns**: Settings (540px), Compose (560px), Search (460px), Agent (380px) formatted as sliding columns.

4. **Floating Viewport Chrome (`app/components/columns/FloatingDock.tsx`)**:
   - Positioned fixed at `bottom-6 left-1/2 -translate-x-1/2 z-50`.
   - Centered floating Omnibar pill (`bg-kumo-elevated/90 backdrop-blur-md border border-kumo-line text-kumo-default shadow-sm`) with search input & `⌘K` badge.
   - Floating action buttons: Settings FAB (`⚙`) and primary Compose FAB (`✏` in `bg-kumo-brand`).

5. **Design System & Styling**:
   - Strictly utilizes `@cloudflare/kumo@1.19.0` and Tailwind CSS v4 `@theme` design tokens (`bg-kumo-base`, `bg-kumo-recessed`, `bg-kumo-elevated`, `bg-kumo-fill`, `bg-kumo-tint`, `bg-kumo-brand`, `border-kumo-line`, `border-kumo-hairline`, `text-kumo-default`, `text-kumo-strong`, `text-kumo-subtle`, `text-kumo-inverse`, `text-kumo-warning`, `text-kumo-destructive`). Zero hardcoded colors.

---

## Feature Inventory
Every feature identified during the survey phase is mapped to a designated milestone:

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Horizontal Miller Canvas Shell | `overflow-x-auto h-screen w-screen bg-kumo-base` container hosting sliding panes with horizontal scrolling | M1 | Survey / R1 |
| 2 | Centralized Column Stack Engine | Zustand store (`useColumnStack`) managing ordered column stack array and active column state | M1 | Survey / R2 |
| 3 | In-Place Parallel Link Replacement | Sibling selection in Col $N$ updates Col $N+1$ in-place and truncates downstream columns $N+2+$ | M1 | Survey / R2 |
| 4 | Platform Link Routing | Open auxiliary views (Settings, Compose, Search, Agent) in stack, focusing existing instances without duplication | M1 | Survey / R2 |
| 5 | Smooth Auto-Scroll | Auto-scroll viewport horizontally on column open/append via `scrollIntoView({ behavior: 'smooth', inline: 'nearest' })` | M1 | Survey / R2 |
| 6 | Column Dismissal Header Close Button | Non-root columns feature header close button (`✕`) to cleanly remove branch | M1 | Survey / R2 |
| 7 | Floating Omnibar Pill | Centered floating pill (`bg-kumo-elevated/90 backdrop-blur-md border border-kumo-line text-kumo-default shadow-sm`) with `⌘K` badge | M1 | Survey / R4 |
| 8 | Floating Action Buttons (FABs) | Settings FAB (`⚙`) and primary Compose FAB (`✏` in `bg-kumo-brand`) | M1 | Survey / R4 |
| 9 | Col 1 (Accounts - 300px) | Root connected mailboxes list, active indicator dot (`bg-kumo-default`), names, handles, unread counts (`text-kumo-subtle`) | M2 | Survey / R3 |
| 10 | Col 2 System Folders (300px) | Account navigation with core folders (`Inbox`, `VIP`, `Sent`, `Drafts`, `Scheduled`, `Archive`, `Trash`) with counts | M2 | Survey / R3 |
| 11 | Col 2 HYPERION TAGS (300px) | Custom hashtag pill list (`#Engineering-PRs`, etc.) with hashtag styling | M2 | Survey / R3 |
| 12 | Col 3 Thread List Feed (400px) | Email list feed with folder title, conversation count badge, mark-all-read checkmark, unread dots | M2 | Survey / R3 |
| 13 | Col 3 Thread Card Details | Sender, timestamp, subject, 1-line snippet, tag chips (`#Engineering-PRs`), attachment indicators (`2 files`) | M2 | Survey / R3 |
| 14 | Col 4 Reading Room Container (848px+ / flex-1) | Reading pane shell, category breadcrumbs, large subject header, sender avatar circle | M3 | Survey / R3 |
| 15 | Email Core Engine Preservation | Preserves full thread history, accordion collapse/expand, iframe HTML rendering with CSP, attachments, toolbar, screener triage | M3 | Survey / R5 |
| 16 | Docked Quick Reply Bar | Inline quick reply bar at base of Col 4 with `Pop Out ⇧⌘O`, `AI Assist ⌘J`, and `Send` button | M3 | Survey / R3 |
| 17 | Platform Auxiliary Columns | Settings (540px), Compose (560px), Search (460px), Agent (380px) in column format | M3 | Survey / R3 |
| 18 | Strict Kumo Design Token Adherence | Zero custom un-themed colors; 100% adherence to `@cloudflare/kumo` tokens across all columns | M1, M2, M3 | Survey / R3 |
| 19 | Route Mounting & Deep-Linking | Boots at `/mailbox/:mailboxId` into horizontal canvas with query param sync (`?threadId=...`) | M4 | Survey / Acceptance |
| 20 | Automated Compilation & Typecheck | Zero errors on `pnpm run typecheck` and `pnpm run build` | M4 | Survey / Acceptance |
| 21 | 100% E2E Test Pass & Coverage Hardening | Pass all E2E test tiers 1-4 and Tier 5 adversarial coverage hardening | M4 | Survey / Acceptance |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Column Stack Engine, Canvas Shell & Floating Dock | `useColumnStack` hook, `ColumnCanvas`, `ColumnPane`, smooth scrolling, parallel/platform links, close buttons, floating Omnibar pill & FABs | none | DONE |
| M2 | Navigation Column Adapters (Col 1, Col 2, Col 3) | Col 1 Accounts (300px), Col 2 Folders & HYPERION TAGS (300px), Col 3 Thread List (400px) with chips, counts, and indicators | M1 | IN_PROGRESS |
| M3 | Reading Room (Col 4), Email Core Engine & Platform Columns | Col 4 Reading Room (848px+ / flex-1), preserved `EmailPanel` integration, docked quick reply bar (`⇧⌘O`, `⌘J`, `Send`), and platform columns (Settings, Compose, Search) | M1, M2 | PLANNED |
| M4 | Route Integration, Typecheck Resolution & Final E2E Test Suite Pass | Mount canvas at `/mailbox/:mailboxId`, eliminate any typecheck errors (`pnpm run typecheck`), build verification (`pnpm run build`), pass 100% E2E test suite (Tiers 1-4) and Tier 5 adversarial hardening | M1, M2, M3 | PLANNED |

---

## Interface Contracts

### `useColumnStack` Store Interface
```typescript
export type ColumnType =
  | 'accounts'
  | 'folders'
  | 'threads'
  | 'reader'
  | 'settings'
  | 'compose'
  | 'search'
  | 'agent';

export interface ColumnItem {
  id: string;
  type: ColumnType;
  title: string;
  subtitle?: string;
  width?: number | string; // e.g. 300, 400, 'min-w-[848px] flex-1'
  closable: boolean;
  props?: Record<string, any>;
}

export interface ColumnStackStore {
  columns: ColumnItem[];
  activeColumnId: string | null;
  // Navigation actions
  selectMailbox: (mailboxId: string) => void;
  selectFolder: (folderId: string, folderName?: string) => void;
  selectThread: (emailId: string, emailSubject?: string) => void;
  openPlatformColumn: (type: 'settings' | 'compose' | 'search' | 'agent', props?: Record<string, any>) => void;
  closeColumn: (columnId: string) => void;
  setActiveColumn: (columnId: string) => void;
  scrollToColumn: (columnId: string) => void;
}
```

### Column Component Props Contract
Every column component conforms to:
```typescript
export interface ColumnComponentProps {
  columnId: string;
  isActive: boolean;
  onClose?: () => void;
}
```

### Col 4 Quick Reply Bar Contract
```typescript
export interface QuickReplyBarProps {
  emailId: string;
  mailboxId: string;
  onPopOut: (draftText: string) => void; // Pops out into Compose column
  onAIAssist: (currentText: string) => Promise<string>; // Triggers agent assist
  onSend: (text: string) => Promise<void>;
}
```

---

## Code Layout
- `app/hooks/useColumnStack.ts`: Central column stack state store.
- `app/components/columns/ColumnCanvas.tsx`: Horizontally scrollable canvas shell.
- `app/components/columns/ColumnPane.tsx`: Reusable pane wrapper with header, title, badge, dismiss button, and scrollable body.
- `app/components/columns/AccountsColumn.tsx`: Col 1 (300px) connected mailboxes.
- `app/components/columns/FoldersTagsColumn.tsx`: Col 2 (300px) system folders and HYPERION TAGS.
- `app/components/columns/ThreadListColumn.tsx`: Col 3 (400px) email list feed.
- `app/components/columns/ReadingRoomColumn.tsx`: Col 4 (848px+ / flex-1) email reading room with breadcrumbs and docked quick reply bar.
- `app/components/columns/QuickReplyBar.tsx`: Docked quick reply component with keyboard shortcuts (`⇧⌘O`, `⌘J`).
- `app/components/columns/FloatingDock.tsx`: Floating Omnibar pill and FAB buttons.
- `app/components/columns/PlatformColumns.tsx`: Auxiliary columns (Settings, Compose, Search, Agent).
- `app/routes/mailbox.tsx`: Route entry point rendering `ColumnCanvas` for `/mailbox/:mailboxId`.
