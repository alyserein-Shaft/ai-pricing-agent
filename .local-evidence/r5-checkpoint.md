# R5 CHECKPOINT — Banner copy truth — 🟢 CLOSED

Canonical repo HEAD `029b426...` · runtime :4183 · no commits made.

## Defect proven (per slice)

Two safety banners carried claims that contradicted current backend truth:

1. **Product Library banner (page.tsx ~16116–16122)**: "Historical and Discovery
   Only prices remain blocked unless separately approved **with a current validity
   end date**." — `PRICE_VALIDITY_REQUIRED` was removed from the price-record review
   route; the route comment states "missing or expired valid_until must not, by
   itself, block this otherwise-authorized governed Costing approval". The banner's
   validity-date prerequisite was stale and false.
2. **Knowledge workspace banner (KnowledgeLibraryWorkspace.tsx ~99–105)**: "No
   automatic promotion" — present since the Phase 2.5 baseline (git `8ff22c5`),
   predating the governed promote/approve-discovery paths (R2/R3). Its blanket
   "nothing moves" phrasing is stale: learning IS automatic (facts/candidates are
   created automatically) while entry into APPROVED use requires explicit human
   review. The truthful boundary is learning automatic · promotion governed.

## What was checked and found truthful (no change)

- `product_sources.downstream_use` / `price_records.downstream_use` are
  `text DEFAULT 'Discovery Only' NOT NULL` (drizzle 0007) → all `|| "Discovery
  Only"` fallbacks in the Product Library source header (page 16149) and price
  helpers (page 2054) mirror the DB default; inert, not fabricated.
- Source/price-review API returns real `downstream_use` per row.
- Case Studies / Historical Learning safety banners assert separation claims
  consistent with their surfaces.

## Implementation (smallest sufficient — backend untouched)

### app/page.tsx (Product Library banner, ~16117)
Old: "…remain blocked unless separately approved with a current validity end date."
New: "Historical and Discovery Only prices remain blocked from project costing
unless separately approved. Validity is never inferred." (matches removed
PRICE_VALIDITY_REQUIRED + the detail panel's "Missing validity or approval is
never inferred" note).

### app/components/workspaces/KnowledgeLibraryWorkspace.tsx (Knowledge banner)
Old: "No automatic promotion — Historical evidence, reusable knowledge, product
approval, and price approval remain separate."
New: strong "Learning is automatic · promotion is governed"; span "Learned facts
and product candidates never enter approved use on their own. Product approval,
price approval, and reusable knowledge remain separate and require explicit human
review."

## Evidence

- Focused contract test `tests/knowledge-banner-copy-truth.test.mjs`: 4/4 PASS
  (backend no longer requires validity for Costing approval — PRICE_VALIDITY_REQUIRED
  absent + "must not, by itself, block" comment; Product Library banner has no
  validity-date prerequisite and says "Validity is never inferred"; Knowledge
  banner states learning-automatic/promotion-governed with explicit human review
  and no "No automatic promotion" string).
- Guards: KN-UX + R1/R2/R3/R4 contracts + R5 = 60/61 (sole failure = pre-existing
  nav-children test, R6-owned, unchanged).
- `npm test`: 508/508 PASS.
- ESLint: same 6 pre-existing errors (13056, 20311, 23461, 23581, 23582×2), zero in
  R5 regions. `tsc --noEmit`: zero errors in R5 regions.

## Runtime :4183

Playwright 6/6 PASS:
- Knowledge Files section: banner shows "Learning is automatic · promotion is
  governed" + "require explicit human review"; no "No automatic promotion".
- Product Library surface: "Costing safety is enforced" with "remain blocked from
  project costing unless separately approved" + "Validity is never inferred"; no
  "with a current validity end date".

## Repo safety

R5 changed: `M app/page.tsx`, `M app/components/workspaces/KnowledgeLibraryWorkspace.tsx`,
`?? tests/knowledge-banner-copy-truth.test.mjs`. Nothing committed; no live mutation.

## Exit decision

R5 CLOSED 🟢. Next: R6 — Fire Alarm/CCTV URL-restore fix.