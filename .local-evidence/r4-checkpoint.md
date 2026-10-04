# R4 CHECKPOINT — Prices truth (Knowledge Prices / Price Lists section) — 🟢 CLOSED

Canonical repo HEAD `029b426...` · runtime :4183 · no commits made.

## RE-EVALUATION GATE findings (before R4)

Empirical re-verification of every remaining slice against live APIs/UI at the gate
(probe results + section sweep recorded below; detailed in `.local-evidence/r3-checkpoint.md` exit note):

- **R4 (this slice)**: the Knowledge Prices/Price Lists section showed "FILES=5" over
  price-list source files and NO truthful price information. `GET /api/knowledge/summary`
  already serves the truthful `prices_discovered: 1503`. Confirmed defect.
- **R5**: `No automatic promotion` banner + `Permitted use: Discovery Only` fallbacks
  (files rows consume fields the API never sends: `document_type`/`source_type`/
  `downstream_use` all absent; payload actually carries `detected_type`,
  `classification_status`, `summary`, `secondary_types`).
- **R6**: CONFIRMED at runtime — `?workspace=Knowledge&section=Fire+Alarm`,
  `?workspace=Knowledge&section=CCTV`, `?workspace=Fire+Alarm+Knowledge`, and
  `?workspace=CCTV+Knowledge` ALL fall through `globalWorkspacePresentation` to
  Dashboard Overview (0/4 probe). Defect is 1) presentation mapping missing
  "Fire Alarm Knowledge"/"CCTV Knowledge", 2) stale `release-1-app-shell` test
  asserting a superseded 7-child nav (real IA has 11 children).
- **R7**: all 29 knowledge-file rows fabricate "Unclassified" + "Permitted use:
  Discovery Only" (fields don't exist in the payload); review items always carry real
  `item_type` so their fallback is inert. Files rows must use `detected_type` /
  `classification_status` and add a source drill-down.

Gate conclusion: plan holds; order R4 → R5 → R6 → R7 unchanged.

## Defect proven (per slice)

The Prices section of the Knowledge workspace presented a FILES-count metric and file
rows for a section titled "Prices", with no truthful price figure anywhere. summary API
truth: `prices_discovered = 1503`.

## Implementation (smallest sufficient — backend untouched)

`/api/knowledge/summary` already serves `prices_discovered`; page.tsx already passed the
summary bag to the workspace. Only the workspace's presentation lied by omission.

### `app/components/workspaces/KnowledgeLibraryWorkspace.tsx`
- Destructured `summary` from Props (was typed but never destructured).
- `isPriceSection = section === "Prices" || section === "Price Lists"`.
- Metric: Prices sections now render `PRICES = summary.prices_discovered` (truthful
  org-wide discovered-price total; 1503 at runtime) instead of `FILES = files.length`.
- Heading copy for Prices sections: "Price evidence discovered from {N} price-list
  source file(s) — {M} discovered prices stay Discovery-Only until governed approval."
- Non-price file sections (Files/Datasheets/Case Studies) keep `FILES = files.length`.

## Evidence

- Focused contract test `tests/knowledge-prices-truth-contract.test.mjs`: 5/5 PASS
  (PRICES metric keyed off `summary.prices_discovered` for Prices/Price Lists; never a
  FILES claim; heading copy honesty; Props typing; page passes summary; summary handler
  serves prices_discovered via COUNT(*)).
- Guards: KN-UX + R1/R2/R3 contracts + R4 = 56/57 (sole failure = pre-existing
  nav-children test, R6-owned, unchanged).
- `npm test`: 508/508 PASS.
- ESLint workspace: clean. `tsc --noEmit`: zero errors in workspace (fixed the one
  TS2304 by destructuring `summary`).

## Runtime :4183

Playwright 5/5 PASS:
- `?workspace=Knowledge&section=Prices`: metric `PRICES = 1503`; heading copy states
  "Price evidence discovered from 5 price-list source files — 1503 discovered prices
  stay Discovery-Only until governed approval."; no `FILES=5` label; 5 source-file rows
  still listed.
- `?workspace=Knowledge&section=Files`: metric unchanged at `FILES = 29`.
- Screenshot: `.local-evidence/kn-r4-prices.png`.

## Repo safety

R4 changed: `M app/components/workspaces/KnowledgeLibraryWorkspace.tsx`,
`?? tests/knowledge-prices-truth-contract.test.mjs`. Nothing committed; no live mutation.

## Exit decision

R4 CLOSED 🟢. Next: R5 — banner copy truth.