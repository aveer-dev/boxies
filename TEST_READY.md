# TEST READY: Miller Columns Horizontal Navigation Canvas E2E Test Suite

Published: 2026-10-04T23:51:30Z  
Scope: Persistent Horizontal Column Navigation Canvas (Miller Columns / Infinite Sliding Panes) for Inboxies Web Client (`app/`)  
Authoritative Sources: `ORIGINAL_REQUEST.md`, `PROJECT.md`, `TEST_INFRA.md`  

---

## 1. Test Suite Overview

A comprehensive, requirement-driven, opaque-box E2E test suite has been designed, implemented, and verified covering Tiers 1–4 across all 15 features defined in `TEST_INFRA.md`.

- **Total Test Cases**: 172
- **Pass Rate**: 100% (172 / 172 Passed)
- **Execution Duration**: ~1.2s
- **Exit Code**: 0 on passing, 1 on any failure
- **Zero Flakiness**: Deterministic DOM simulation, isolated state resets, and path-alias module resolution.

---

## 2. Test Execution Commands

### Primary Test Runner Command:
```bash
node scripts/test-miller-columns-e2e.mjs
```

### Filtering & Options:
```bash
# Run specific tier (1, 2, 3, or 4)
node scripts/test-miller-columns-e2e.mjs --tier=1
node scripts/test-miller-columns-e2e.mjs --tier=2
node scripts/test-miller-columns-e2e.mjs --tier=3
node scripts/test-miller-columns-e2e.mjs --tier=4

# Filter by feature name
node scripts/test-miller-columns-e2e.mjs --feature=F01_CanvasShell
node scripts/test-miller-columns-e2e.mjs --feature=F12_FloatingOmnibar

# Verbose output (detailed assertion and duration per test)
node scripts/test-miller-columns-e2e.mjs --verbose

# Machine-readable JSON output (for CI/CD pipelines)
node scripts/test-miller-columns-e2e.mjs --json
```

---

## 3. Tier Coverage Breakdown

| Tier | Category | Specification Requirement | Test Count | Pass Rate | Status |
|:---:|:---|:---|:---:|:---:|:---:|
| **Tier 1** | Feature Coverage | ≥5 tests per feature across all 15 features in `TEST_INFRA.md` | **75** | 100% (75/75) | **PASSED** |
| **Tier 2** | Boundary & Corner Cases | ≥5 tests per feature covering edge, stress, and corner conditions | **75** | 100% (75/75) | **PASSED** |
| **Tier 3** | Cross-Feature Combinations | Pairwise interaction tests covering multi-column workflows | **16** | 100% (16/16) | **PASSED** |
| **Tier 4** | Real-World Workflows | ≥6 realistic multi-column end-to-end user journeys | **6** | 100% (6/6) | **PASSED** |
| **TOTAL** | **Complete Suite** | Comprehensive opaque-box coverage | **172** | **100%** | **PASSED** |

---

## 4. Feature Coverage Matrix (Features 1–15)

| Feature # | Feature Name | Tier 1 Tests | Tier 2 Tests | Tier 3/4 Coverage | Pass Status |
|:---:|:---|:---:|:---:|:---:|:---:|
| **F01** | Horizontal Miller Canvas Shell | 5 | 5 | T3-01, T3-12, T4-01, T4-03 | 10/10 Passed |
| **F02** | Centralized Column Stack Engine | 5 | 5 | T3-02, T3-10, T4-01, T4-02 | 10/10 Passed |
| **F03** | In-Place Sibling Replacement | 5 | 5 | T3-02, T3-03, T3-13, T4-02 | 10/10 Passed |
| **F04** | Platform Link Routing | 5 | 5 | T3-04, T3-07, T3-08, T4-04 | 10/10 Passed |
| **F05** | Smooth Auto-Scroll to Active Column | 5 | 5 | T3-01, T3-08, T3-09, T4-01 | 10/10 Passed |
| **F06** | Column Header Dismissal (`✕`) | 5 | 5 | T3-03, T3-04, T3-10, T4-05 | 10/10 Passed |
| **F07** | Col 1 Accounts (300px, active dot, unread) | 5 | 5 | T3-05, T3-12, T4-01 | 10/10 Passed |
| **F08** | Col 2 Folders & HYPERION TAGS (300px) | 5 | 5 | T3-05, T3-06, T3-14, T4-06 | 10/10 Passed |
| **F09** | Col 3 Thread List (400px, chips, attachments) | 5 | 5 | T3-05, T3-06, T3-15, T4-03 | 10/10 Passed |
| **F10** | Col 4 Reading Room (848px+, breadcrumbs) | 5 | 5 | T3-06, T3-11, T3-14, T4-01 | 10/10 Passed |
| **F11** | Docked Quick Reply Bar (`⇧⌘O`, `⌘J`, `Send`) | 5 | 5 | T3-07, T3-11, T3-13, T4-04 | 10/10 Passed |
| **F12** | Floating Omnibar Pill (`bg-kumo-elevated/90`) | 5 | 5 | T3-08, T3-12, T3-15, T4-05 | 10/10 Passed |
| **F13** | Floating Action Buttons (Settings, Compose) | 5 | 5 | T3-09, T3-16, T4-05 | 10/10 Passed |
| **F14** | Email Core Engine Preservation | 5 | 5 | T3-11, T4-01, T4-06 | 10/10 Passed |
| **F15** | Strict Kumo Token Compliance | 5 | 5 | T3-12, Static AST / Token audits | 10/10 Passed |

---

## 5. Real-World Application Workflows (Tier 4)

1. **Scenario 1 (T4-01)**: *Full Miller Navigation Workflow*
   - Root Col 1 (Selects mailbox) -> Col 2 (Selects 'Priority/VIP' folder) -> Col 3 (Selects thread) -> Col 4 (Reading Room mounts with subject, avatar, breadcrumbs) -> Auto-scroll brings Col 4 into focus -> Inline quick reply composed and sent.
2. **Scenario 2 (T4-02)**: *Parallel Sibling In-Place Replacement*
   - User sequentially clicks threads 101, 102, 103, 104 in Col 3 -> Col 4 updates in place for every click -> Total column count remains constant at 4 (no duplicate reader columns spawned).
3. **Scenario 3 (T4-03)**: *State & Scroll Preservation Across Leftward Navigation*
   - Deep scroll inside Col 3 down to item #30 (`scrollTop: 1850px`) -> Select item #30 to open Col 4 -> Horizontally pan right to Col 4 -> Horizontally pan left back to Col 3 -> Col 3 scroll offset strictly preserved at 1850px and active selection remains intact.
4. **Scenario 4 (T4-04)**: *Quick Reply to Pop-Out Compose*
   - Reading thread in Col 4 -> Draft partial reply text in quick reply bar -> Trigger Pop Out (`⇧⌘O` / button) -> Compose platform column mounts in column stack with draft content, recipient, and subject pre-populated -> Canvas auto-scrolls to Compose column.
5. **Scenario 5 (T4-05)**: *Floating Chrome & Shortcuts*
   - Press `⌘K` -> Omnibar activates Search platform column -> Query entered -> Press `⌘,` -> Settings platform column opens -> Dismiss Settings column with `✕` -> Focus restores to Search column -> Dismiss Search column -> Focus restores to threads.
6. **Scenario 6 (T4-06)**: *Tag Navigation & Multi-Metadata Inspection*
   - Select `#Engineering-PRs` in Col 2 HYPERION TAGS -> Col 3 filters threads with tag chips and attachment badges (`2 files`) -> Open PR thread in Col 4 -> Verify attachment list, file downloads, and thread conversation history.

---

## 6. Test Suite Architecture

```
tests/miller-columns/
├── harness.mjs                  # Shared test infrastructure, DOM simulator, store wrappers, Kumo token audit
├── resolve-loader.mjs           # Path-alias ESM resolver for `shared/*`, `~/*`, and extensionless TypeScript
├── register-loader.mjs          # Node module registration hook for standalone execution
├── tier1-features.test.mjs      # 75 Feature coverage tests (Features 1–15)
├── tier2-boundaries.test.mjs    # 75 Boundary value & edge condition tests (Features 1–15)
├── tier3-pairwise.test.mjs      # 16 Cross-feature combination & pairwise tests
└── tier4-workflows.test.mjs     # 6 End-to-end multi-column user scenarios

scripts/
└── test-miller-columns-e2e.mjs  # Central executable CLI test runner with ANSI reporting & JSON modes
```
