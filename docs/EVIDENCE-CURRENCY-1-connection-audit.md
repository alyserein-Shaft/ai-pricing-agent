# EVIDENCE-CURRENCY-1 — Consumer Connection Audit & Closure Report

## Scope

Audit every downstream consumer against the canonical R3/R2 authorities and
connect the disconnected — reusing, never duplicating. A full reader inventory
(parallel audit slice) classified each production read as ALREADY_CANONICAL /
CONNECTION_GAP / DOMAIN_FRESHNESS_GAP / R4_OWNED / NOT_APPLICABLE.

## Closed gaps (behavior changes, all with focused tests)

### 1. Quantity decisions scoped to current evidence
`ownedItem` (`worker/quantity-source-decision-api.mjs`) read the raw table:
decisions could be recorded against (and raw quantities displayed for)
superseded/retired/deleted items, feeding nothing (all consumers resolve
through current items) while looking live. Now reads through
`currentBoqEvidenceFrom`; non-current items 404 on GET and POST.
Tests: `tests/evidence-currency-gaps.test.mjs` (3).

### 2. Pricing refuses stale-profile runs (DFG-A, shared reuse)
`loadPricingInput` (`worker/pricing-runtime.mjs`) priced any current run
regardless of requirement-profile currency, while approval-time 409s on
REQUIREMENT_PROFILE_CHANGED — the same invalidated basis entered through the
back door. Now reuses `matchRunStaleness` (no new definition) and throws
REQUIREMENT_PROFILE_CHANGED. Covers every pricing/costing path (all funnel
through `loadPricingInput`, including BOM/cost/panel downstream).
Tests: same file (2, positive + negative).

### 3. Safety signals scoped to the current run's candidates
`currentSafetyDecision` (`worker/boq-line-decision-api.mjs`) took the
cross-candidate MAX by version_number; version chains run per-candidate, so a
stale run's verdict could mask the current run's state in either direction.
Now takes the current run id and scopes candidates to it; no run → null →
"not yet eligible" (the file's own fail-closed convention). Exported and
reused by `review-workflow-api.mjs` queue sync, deleting the second copy of
the query there (one definition of "current safety" instead of two).
Tests: same file (1, both directions).

## Deliberate layering (documented, tested)

### Selection stays profile-agnostic
`resolveCurrentPrimarySelection` does NOT enforce profile staleness: panel
sizing carries its own STALE_PANEL_PRODUCT_SELECTION check and pricing refuses
downstream — refusing in the resolver would collapse those layers and mask
domain-specific codes (proven by `r7-panel-sizing-production` staleness test,
which failed during implementation until the layering was restored). Pinned by
test. Revisit only if a selection consumer appears that neither prices nor
carries its own staleness check.

### C-1 compat sub-rows (from GOV-AUTH-1)
Link+requirement approval covers the extracted set; no per-row review exists.
Unchanged.

## Recorded, deliberately unchanged (with reason)

- `currentPricingLine` (boq-line-cost) / `currentLine` (pricing-api): prior-line
  reference context and display endpoints; decisions re-gated downstream by
  `loadPricingInput` / canonical predicates.
- Knowledge-profile GET, review lists, export manifests: display/readiness
  surfaces; review `decision` gates separately via validateDecision.
- `resolveBoqCandidateMembers`, `loadConfirmedLinkedItems`, route-scoped
  ownership reads: bounded (governed caller / sweep-superset / single-item
  pre-read); the governed selection remains the single read site.
- `engineering-fact-freshness` superseded-only checks: the module proposes
  invalidation; currency is re-derived by consumers through row authorities
  (`technical-requirement-api.mjs:172-176`, promotion `:419-437`,
  `loadActiveSourceFacts` fail-closed). No consumer trusts the module's notion
  alone.
- Drawing readers: R4_OWNED (zero governing-predicate use; no consumer treats
  drawing evidence as cross-version governing).
- Background taxonomy seeding, learning-pack export, deprecated discovery:
  suggestion/training/deprecated paths, not decisions.
- 'Accepted' BOQ class: zero writers, zero live rows; inert.
- DFG-B (panel snapshot vs live evidence): presence gate + GET recompute is the
  stated design; fail-closed direction owned by panel-sizing GET.

## Duplicate-authority audit (explicit)

No competing current-evidence resolver was introduced in this phase. Reused:
`currentBoqEvidenceFrom` (quantity gate), `matchRunStaleness` +
`STALE_REQUIREMENT_PROFILE_REASON` + `currentRequirementProfileId` (pricing),
`currentSafetyDecision` export shared by line-decision and review-workflow
(duplicate deleted), `currentRun` (review sync). The only staleness definition
for match runs remains the one in `product-matching-api.mjs`, consumed in five
places.
