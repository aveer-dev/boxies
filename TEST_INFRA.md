# E2E Test Infra: Horizontal Column Navigation Canvas (Miller Columns)

## Test Philosophy
- Opaque-box, requirement-driven. Derived from `ORIGINAL_REQUEST.md` and user-facing specifications, not internal component implementation.
- Methodology: Category-Partition + Boundary Value Analysis (BVA) + Pairwise Combinatorial Testing + Real-World Workload Testing.
- Progressive testability: Verification mechanism does not rely on features more complex than what is being tested.

## Feature Inventory
| # | Feature | Source (requirement) | Tier 1 | Tier 2 | Tier 3 |
|---|---------|---------------------|:------:|:------:|:------:|
| 1 | Horizontal Miller Canvas Shell | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 2 | Centralized Column Stack Engine | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 3 | In-Place Sibling Replacement (Parallel Links) | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 4 | Platform Link Routing | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 5 | Smooth Auto-Scroll to Active Column | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 6 | Column Header Dismissal (`✕`) | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 7 | Col 1 Accounts (300px, active dot, unread) | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |
| 8 | Col 2 Folders & HYPERION TAGS (300px) | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |
| 9 | Col 3 Thread List (400px, chips, attachments) | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |
| 10 | Col 4 Reading Room (848px+, header, breadcrumbs) | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |
| 11 | Docked Quick Reply Bar (`⇧⌘O`, `⌘J`, `Send`) | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |
| 12 | Floating Omnibar Pill (`bg-kumo-elevated/90`, `⌘K`) | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ |
| 13 | Floating Action Buttons (Settings, Compose) | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ |
| 14 | Email Core Engine Preservation | ORIGINAL_REQUEST §R5 | 5 | 5 | ✓ |
| 15 | Strict Kumo Token Compliance | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |

## Test Architecture
- **Test Runner**: Node.js test harness / Playwright script executing automated headless verification.
- **Test Location**: `scripts/test-miller-columns-e2e.mjs` and component test suites.
- **Pass/Fail Semantics**: Exit code 0 on all tests passing; exit code 1 on any failure with structured error assertions.

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Full Miller Navigation Workflow: Select Mailbox -> Select System Folder -> Select Thread -> Read in Reading Room -> Reply | F1, F2, F3, F7, F8, F9, F10, F11, F14 | High |
| 2 | Parallel Sibling In-Place Replacement: Switch between multiple threads in Col 3, verifying Col 4 updates without spawning duplicate columns | F2, F3, F9, F10 | Medium |
| 3 | State & Scroll Preservation: Scroll down Col 3 to item #30, inspect email in Col 4, scroll left, verify Col 3 scroll offset and selection intact | F1, F2, F9, F10 | Medium |
| 4 | Quick Reply to Pop-Out Compose: Type reply in Col 4 quick reply, press `⇧⌘O`, verify text transfers to Compose column in stack | F4, F10, F11 | High |
| 5 | Floating Chrome & Shortcuts: Trigger `⌘K` Omnibar search, open Settings FAB, dismiss column with `✕`, verify focus restoration | F4, F5, F6, F12, F13 | Medium |
| 6 | Tag Navigation: Select `#Engineering-PRs` in Col 2, filter threads in Col 3, view thread with tag chips & attachment indicators | F8, F9, F10, F14 | Medium |

## Coverage Thresholds
- **Tier 1 (Feature Coverage)**: ≥5 test cases per feature (75+ tests).
- **Tier 2 (Boundary & Corner Cases)**: ≥5 test cases per feature (75+ tests).
- **Tier 3 (Cross-Feature Combinations)**: Pairwise coverage across core navigation interactions (15+ tests).
- **Tier 4 (Real-World Scenarios)**: ≥6 realistic application workflows.
- **Total Minimum**: ~170 test assertions covering the complete feature set.
