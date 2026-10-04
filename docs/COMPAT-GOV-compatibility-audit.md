# COMPAT-GOV — Compatibility Governance Audit & Closure Report

## Recovered existing scope

- Canonical store: `engineering_relationships` (14 live rows: detector↔base,
  detector↔panel, all Honeywell Doc 350285 Rev H via auto-confirm).
- `product_compatibility` deprecated 2026-08-31 (zero rows, no writes, enforced
  by tests) — untouched.
- Auto-confirm governance: 6 gates + policy version + system actor + audit row.
- Matching consumes Approved compat as a ranking signal for unclassified
  products only; profiles include Active/Approved/Confirmed.
- Panel↔detector, protocol, base↔detector live as relationship rows with
  documented-evidence conditions (incl. protocol field); detector-base also as
  derived accessory requirements; certifications in `product_certifications`
  (Unverified/display); accessories in `product_accessories` with own review.

## Closed gaps

### 1. Resolution vocabulary (was: three ad-hoc strings, order-dependent)
`evaluateCompatibility` now additionally returns `compatibilityState`:
CONFIRMED / NOT_COMPATIBLE / CONFLICTING / UNKNOWN, with historical
`result`/`pass`/`blocking` untouched. Conflicting offers (compatible +
incompatible for one target) previously resolved by array order; now
incompatibility wins (fail-closed) and `conflicting: true` records the
dispute. No UNKNOWN→compatible/incompatible path exists by construction.
Tests: `tests/compat-governance.test.mjs` (4).

### 2. Currency at read (relationships floated free of identity lifecycle)
Both live consumers joined `status='Approved'` with project scoping but never
checked whether either end product is still current. Now both the matching
loader (`product-matching-api.mjs`) and the profile loader
(`technical-requirement-api.mjs`) require Product-type targets to resolve to
`identity_status='Active'` + `superseded_by_product_id IS NULL` in
`canonical_library_products`. Family targets carry no identity lifecycle and
pass through (documented). Tests: same file (2, via the real loaders).

### 3. Auto-confirm conflict-blindness (from UNRESOLVED-SEMANTICS)
Gate 3 queried same-triple duplicates only; now refuses same-pair
different-type Approved rows. Test: `worker/__tests__/
compatibility-auto-confirm.test.mjs` (10/10 with the new refusal test).

## Audited, no change (with reason)

- **Accessories/certifications:** own tables, own review/display paths; no
  silent-grant path found. A unified compat review lifecycle would be a new
  feature, not a gap close.
- **NOT_APPLICABLE / CONFIRMED_WITH_CONDITIONS states:** no data behind them
  (conditions JSON is evidence provenance, not terms; no applicability flag).
  Vocabulary documents their absence rather than inventing them.
- **Manufacturer/family-name inference:** guarded at the vocabulary choke
  (`GUARD_VENDOR`, persistence NEVER) and bounded to ranking signals at the
  matching boundary; family-tier ranking is governed taxonomy, not compat.
- **Borrowed evidence (global/family rows):** global rows (`project_id IS
  NULL`) are universal-by-design and project-scoped at read; family targets
  match family-level requirement targets directly (not silently expanded to
  members).
- **System-vs-human Approved indistinguishability:** no consumer requires
  specifically-human compat approval (pricing requires human Technical/Price
  approvals, never compat status); latent only.

## What was verified absent

- No writes to the deprecated table; no compat path bypassing the 6 gates;
  no UNKNOWN treated as compatible or incompatible; no manufacturer-alone
  persistence; no duplicate currency predicate introduced.
