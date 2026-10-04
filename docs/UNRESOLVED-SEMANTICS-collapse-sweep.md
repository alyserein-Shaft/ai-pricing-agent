# UNRESOLVED-SEMANTICS — Collapse Sweep & Closure Report

## Scope reconstruction

No canonical UNRESOLVED-SEMANTICS spec exists in the repository (only scattered
state strings). Scope executed per the program directive: prevent unresolved
engineering meaning from silently becoming resolved downstream truth, across
the states Unknown / Needs Review / Missing Evidence / Ambiguous / Conflicting
/ Authority Required / Not Applicable / Explicit Zero / No Evidence. A parallel
read-only sweep audited every production path feeding pricing, quotation,
matching, approvals, quantities, profiles, exports, and panel sizing for the
forbidden collapses (→ false / zero / approved / compliant / countable /
pricing-eligible / quote-ready).

## Closed: auto-confirm was conflict-blind (REAL)

`evaluateCompatibilityAutoConfirmation` Gate 3 ("no_conflicting_source")
queried only same-triple `Approved` duplicates. A governed conflicting
statement about the same pair (different relationship type) was never looked
for, yet the write minted `status='Approved'`, flowing to matching → safety →
pricing. Closed: Gate 3 now refuses on any same-pair Approved row of a
different type ("no duplicate" ≠ "no conflict"), with a dedicated test
proving no write occurs over disputed evidence.
(`worker/compatibility-auto-confirm.mjs`, `worker/__tests__/compatibility-auto-confirm.test.mjs` 10/10.)
Live check: sole writer is auto-confirm itself; 14/14 live rows are
Approved/Compatible-With — no live mis-approval found; the hole was structural.

## Hardened: fail-open status regexes (defense in depth)

- `confidence-safety-engine.mjs:85` and `product-matching-engine.mjs:578`:
  `/reviewed|verified/i` matched "Unreviewed"/"Unverified", promoting
  productIdentity 60→100 and adding ranking score. Bounded to word boundaries.
  Strictly conservative (whole-word Reviewed/Verified still match); live values
  are clean (943 Needs Review / 8 Reviewed). Human Technical-approval gate
  (role, blocks, warnings, version, reason) remains the enforcement.
- Deliberately untouched: the `approved|required|basis` manufacturer-scope
  regex — narrowing it would WIDEN scope (fail-open); over-match there fails
  closed and is contained downstream.

## Verified absent/ bounded (with gates quoted in the sweep)

- Missing→zero: `currentSelectedQuantity` null-never-zero; price nulls;
  excel `sum()` coercion blocked for Approved Cost Sheet by
  `validateExportReadiness`, warning-carrying otherwise; xlsx cached values
  subordinate to formulas + server reconciliation; commercial totals disclose
  included/excluded counts.
- Unapproved→eligible: every price selection requires (Approved, Costing);
  manual prices land Discovery-Only with receipt messaging.
- Stale→fresh: approval-time 409, pricing REQUIREMENT_PROFILE_CHANGED,
  panel STALE check, quantity STALE→null, export STALE→null-no-fallback.
- Unknown→compatible/incompatible: no UNKNOWN compat state exists; absence is
  neutral in matching, blocking-missing-info in profiles — asymmetric but
  fail-closed in both directions.
- AI-hypothesis→fact: Pending Review facts gated out of profile input
  (GOV-AUTH-1); publish mints Active only from approved sources; review
  surfaces show pending items explicitly as pending.
- Fail-open boolean coercions: `review-workflow-api.mjs:124` over-blocks
  (wrong direction for this mission); `aggregateProjectPricing` discloses
  priced/unpriced counts.
- Quotation: fingerprint compare-and-set + per-line commercial approval +
  cost-freshness recheck; no unresolved path to quote-ready found.

## Principle restated for future work

`No conflicting evidence ≠ requirement confirmed. No recognized occurrence ≠
quantity zero. No compatibility evidence ≠ incompatible (and ≠ compatible).
AI hypothesis ≠ governed project fact.` Every collapse direction in this
codebase currently fails closed or discloses; this report is the pin — a new
collapse must fail a gate added alongside it, not be found by the next sweep.
