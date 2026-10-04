# PL_REPAIR_2_DISCOVERY_SEMANTICS_CONTRACT_REPORT

**Status: PL_REPAIR-2 = COMPLETE**
**DATA MUTATIONS = NONE** (live D1 opened read-only only; only source files and tests changed — no products approved, no rows updated, no migrations)
**Next step: PL-REPAIR-3 — SEARCH NORMALIZATION (NOT STARTED — awaiting owner review)**

---

## 1. Complete flag consumer map (`approved_for_discovery`)

Every occurrence of `approved_for_discovery` / `approvedForDiscovery` / related vocabulary, traced
DB → domain → worker/API → frontend → matching → candidate discovery → ranking → pricing/commercial.

| # | File / function | R/W | Semantic meaning | Actual behavior | Blocks anything? |
|---|---|---|---|---|---|
| 1 | `worker/canonical-product-authority.mjs` — `CANONICAL_DISCOVERY_PRODUCT_PREDICATE` | read (constant) | Technical matching eligibility predicate | Canonical + `identity_status='Active'` + `review_status<>'Rejected'` + has `product_source_evidence` | Matching/supplier candidates — the ONLY gate. Does **not** contain the flag. |
| 2 | `worker/canonical-product-authority.mjs` — `DISCOVERY_READY_PRODUCT_PREDICATE` (**added by this repair**) | read (constant) | Contract predicate for the reviewed Discovery-index listing | `approved_for_discovery=1`, qualified by consumer alias | Only the curated `discovery=true` browse |
| 3 | `worker/product-price-library-api.mjs` `queryLibraryProducts` (line ~29) | read (SQL filter) | `discovery=true` browse = approved-for-discovery listing filter | `AND (?=0 OR c.<DISCOVERY_READY_PRODUCT_PREDICATE>)`; bind order unchanged | Filters ONLY the `?discovery=true` browse |
| 4 | `worker/product-price-library-api.mjs` `mapProduct` (line 15) and list SELECT (line ~41/63) | read | Row-level `approvedForDiscovery` from the **requested** row | Surfaced on every product row | Nothing; display only |
| 5 | `worker/product-price-library-api.mjs` `POST /api/products/:id/approve-discovery` (line ~552) | **write =1** | Governed human discovery-approval | Requires `canGovernGlobal` (Administrator/Library Manager) + substantive reason; atomically sets `review_status='Reviewed'`, `approved_for_discovery=1`; writes decision row `"Approved for Discovery"`; returns `costingEligible:false` | Grants the listing approval; **zero UI callers** — API-only |
| 6 | `worker/product-auto-review.mjs` `autoApproveDiscovery` (lines 273–327) | **write =1** | Deterministic policy auto-approval | Requires `review_status='Reviewed'` first; sets flag=1; decision row `"Auto-Approve Discovery"` (actor `system:product-library-auto-review`, role System); already-approved → idempotent `alreadyApproved:true` | Same listing approval; only ever invoked from local dev/write scripts |
| 7 | `worker/product-auto-review.mjs` `autoReviewProduct` (216–264) | write `review_status` only | Sets `Reviewed` WITHOUT the flag | Establishes `Reviewed` state; flag stays 0 until `autoApproveDiscovery` follows | Nothing |
| 8 | `worker/product-identity-api.mjs` `promoteProductIdentity` (107–115) | **write =0** (explicit) | Promotion creates Organization products | Creates `review_status='Needs Review'`, `approved_for_discovery=0`; every response carries `safety.approvedForDiscovery:false` | None — promotion never grants discovery approval |
| 9 | `worker/product-price-library-api.mjs` ingestion (138/161/282); `app/domain/product-price-library.mjs` (144); seeds | **write =0** | New products default not-listed | All create `'Needs Review', 0` | None |
| 10 | `app/page.tsx` product row (15322–15324) | read (label) | User-facing discovery badge | Pre-repair: `"Permitted use: Product discovery"` / `"Permitted use: Not approved for discovery"` — **repaired** to `"Discovery listing: Approved"` / `"Discovery listing: Not approved"` | Display only; never implied matching block after repair |
| 11 | `app/page.tsx` discovery panel `<a href="/api/library/products?discovery=true&q=…">` (12433) | read (param) | The single live UI consumer of the browse filter | Opens the canonical "Browse reviewed discovery index" | Only that curated browse |
| 12 | `worker/knowledge-product-repair.mjs` (158) | read/write (serialized safety) | Knowledge repair never grants discovery approval | Emits `approvedForDiscovery:false` in safety payload; never a gate | None |
| 13 | `worker/product-matching-api.mjs` `loadProducts` (117) | read | **Technical matching entry predicate** | Uses only `CANONICAL_DISCOVERY_PRODUCT_PREDICATE` — flag never referenced | NO flag gating (verified below) |
| 14 | `worker/supplier-price-intake-api.mjs` `canonicalSupplierProductCandidates` (100) | read | Supplier candidate discovery | Flag-independent, same authority | NO flag gating (test-asserted) |
| 15 | AI ranking (`ai-product-ranking-engine.mjs`), Knowledge search/resolver, pricing/costing, safety | — | — | **No occurrence of the flag anywhere** (see §7 consumer-map regression test) | NO flag gating |
| 16 | Scripts (probes/golden/discovery), tests | read/assert | Diagnostics + contract guards | `probe-pl1-*`, `stage4d-golden-product-discovery.mjs` (reads `=1`), `enrich-idp-heat-products.mjs` (counts), fixture setups | Read-only / test-only |

**Reader/writer inventory (snake_case column):** files that mention the column are exactly
`canonical-product-authority.mjs`, `product-identity-api.mjs`, `product-price-library-api.mjs`,
`product-auto-review.mjs` (+ `knowledge-product-repair.mjs` in camelCase payload form only). A new
regression test (`J7`) re-scans the `worker/` directory and fails if any other file starts using it.

## 2. Live counts (read-only, canonical D1, 2026-09-22)

| Measure | Value |
|---|---|
| `library_products` total | 951 |
| `approved_for_discovery = 1` | **8** (all `review_status='Reviewed'`; 0 approved-not-Reviewed) |
| `approved_for_discovery = 0` | **943** |
| `review_status` distribution | Needs Review 943 / Reviewed 8 (no Rejected) |
| Canonical view rows with flag=1 | 11 (8 canonical products + 3 superseded requested rows `IDP-HEAT-IV.`, `IDP-HEAT-HT-IV.`, `IDP-HEAT-ROR-IV.` that resolve into approved canonical targets — the view inherits the terminal row; the browse returns them exactly as the normal canonical resolution behaves) |
| **Technically matchable** (`CANONICAL_DISCOVERY_PRODUCT_PREDICATE`) | **930** |
| Technically matchable AND not discovery-approved | **922** |
| Technically matchable AND discovery-approved | 8 |
| Default product list (no filter) | 951 |
| `discovery=true` browse | 11 (8 approved + 3 resolving superseded) |
| `price_records` `downstream_use='Discovery Only'` / `'Costing'` | 517 / 1 (D2 price dimension, separate) |
| `engineering_discovery_runs` | 0 (deprecated Engineering Graph consumer, no real rows) |

**Approved products (8):** `IDP-HEAT-IV`, `IDP-HEAT-HT-IV`, `IDP-HEAT-ROR-IV` (system auto-approve,
2026-09-19) and `2151`, `2151-CH`, `2151T`, `2351/EC`, `2351TEM` (human decisions, 2026-08-11).

**How approval was created (audit trail):** 6 human `"Approved for Discovery"` rows in
`product_library_decisions` — all by `local-development-user` (Administrator): 5 on 2026-08-11
(2151 family) + 1 repeat on 2026-09-18 — plus 3 system `"Auto-Approve Discovery"` rows
(2026-09-19), each immediately preceded by an `"Auto-Review"` row.

**Why only 8:** the governed human route has **zero app/UI callers** (API-only), and the automatic
route only runs when `scripts/stage4b-compatibility-governance-write.mjs` (a local dev write
script, not part of any running service) calls `autoReviewProduct` → `autoApproveDiscovery`.
Nothing in the running system grants further approvals.

## 3. Promotion path / governance (Part D)

| Aspect | Evidence |
|---|---|
| Source state | `review_status='Needs Review'`, `approved_for_discovery=0` (ingestion, promotion, seeds all create this) |
| Promotion that can set the flag | ① `POST /api/products/:id/approve-discovery` — human, requires `canGovernGlobal` (Administrator/Library Manager) + substantive reason (≥ `MIN_GOVERNED_REASON_LENGTH`); ② `autoApproveDiscovery` — deterministic policy, requires `review_status='Reviewed'` first |
| Eligibility conditions | ① none beyond role + reason; ② identity Active, no supersession, no unresolved duplicate, family governed, required technical facts source-backed, authoritative sources recorded, no evidence conflict, no project inference (the full gate list in `evaluateProductAutoReview`) |
| Review requirements | Human route is itself the review (sets `Reviewed` + flag atomically); auto route requires `Reviewed` before it will set the flag |
| Actor | Human: Administrator/Library Manager (`local-development-user` in live data). Automatic: `system:product-library-auto-review` / role `System` |
| Audit trail | `product_library_decisions` — `"Approved for Discovery"` (prev `{"approved":false}` → new `{"approved":true}`) and `"Auto-Approve Discovery"` (prev `Not Approved` → `Approved`), with decided_by/decided_role/decided_at |
| Idempotency | Auto path: returns `alreadyApproved:true` when flag already 1. Human route is reason-gated POST (no idempotency key), last-write-wins on the decision row |
| Product-level or evidence-level | **Product-level** (column on `library_products`); price evidence has its own orthogonal `price_records.approval_status/downstream_use` governance |
| Relationship to `Needs Review` / `Reviewed` | `Needs Review` = not yet business-reviewed. `Reviewed` = business review complete (set by human route or `autoReviewProduct`). `approved_for_discovery=1` requires `Reviewed` (both writers enforce it) and is a strictly stronger listing approval. `Rejected` is a separate identity-integrity signal that still excludes from technical matching |

## 4. Exact Discovery definition (Part C/H)

**`approved_for_discovery` means:** *business-review approval for a canonical product to be listed
in the curated reviewed Discovery index* (the `?discovery=true` canonical product browse). It is a
**listing/review badge**, not a technical-capability flag, not a matching gate, not a commercial
flag. Option **E** ("passed a specific human review/promotion gate"), with option **A** as its one
consumer effect: a listed product may appear in the curated reviewed-discovery browse. B (technical
matching), C (recommend to engineer), D (Knowledge search) are all **excluded by code**; F
(dead/legacy) is **excluded** — real consumers exist (`discovery=true` filter, DB index
`library_products_discovery_idx (approved_for_discovery, lifecycle_status)`, row label), although
the flag's write path is unreachable from the UI.

**`DISCOVERY_READY` (contract, Part H):**

```
DISCOVERY_READY =
  review_status = 'Reviewed'            -- business review complete
  AND approved_for_discovery = 1        -- governed listing approval (human route or auto policy)
```

- **INPUTS:** canonical product id; `library_products` review state.
- **OUTPUT:** eligible for the reviewed Discovery index browse (`discovery=true` canonical list) and for the row badge `Discovery listing: Approved`.
- **BLOCKING CONDITIONS:** only filters the curated `discovery=true` browse; always false for `Needs Review` rows.
- **NON-BLOCKING CONDITIONS:** technical matching, supplier candidate discovery, AI ranking, Knowledge search, pricing/costing eligibility, safety — all remain available to discovery-unlisted products.
- **CONSUMERS:** `queryLibraryProducts(discovery=true)`; product-row badge; diagnostic scripts.

## 5. Discovery vs Match Ready (Part E/F)

```
MATCH_READY (TECHNICALLY_MATCHABLE) =
  CANONICAL_DISCOVERY_PRODUCT_PREDICATE:
  requested_product_id = id            -- canonical, non-superseded
  AND identity_status  = 'Active'
  AND review_status   <> 'Rejected'    -- identity/data-integrity signal only
  AND EXISTS product_source_evidence   -- real ingestion provenance
```

- **Answer to Part E (should `approved_for_discovery` gate Technical Matching?): NO.**
  Supporting evidence: `worker/canonical-product-authority.mjs` comment (business review "no longer
  blocks matching from running at all"); `product-matching-api.mjs loadProducts` binds only the
  canonical predicate; `tests/product-matching-api.test.mjs` and `tests/contract J1/J2` assert the
  matching predicate never contains the flag; `tests/supplier-price-intake-db.test.mjs` asserts
  technical discoverability "must not depend on the separate approved_for_discovery business-review
  flag"; live count 930 matchable vs 8 approved — gating would silently convert **930 → 8**,
  which no governance evidence intends.
- **Part F:** the two pathways already exist in the architecture and are now named explicitly:
  DIRECT/TECHNICAL MATCHING (identity + technical evidence, no flag) vs REVIEWED DISCOVERY LISTING
  (`discovery=true` browse, flag-gated), plus supplier intake candidate discovery (no flag).
  **No new pathway was implemented** — the repository already supported, and the contract now
  documents, the `DIRECT_MATCH_ELIGIBILITY` vs `DISCOVERY_ELIGIBILITY` split.

## 6. Discovery vs Commercial (Part C / J6)

`COMMERCIAL_READY` / pricing eligibility is a **separate axis** on `price_records`:
`approval_status='Approved' AND downstream_use='Costing' AND valid_until IS NOT NULL AND valid_until >= date('now')`
(1 costing-eligible price live). `approve-discovery` explicitly returns `costingEligible:false`;
no code path ties the product flag to price approval. Proven behaviorally: a discovery-unapproved
product with one approved costing price shows `costingEligiblePrices=1` while staying out of the
discovery browse (contract test J6).

## 7. Previous inconsistency (Part G)

- The product-row badge `"Permitted use: Not approved for discovery"` **implied a use permission**
  and could be read as "this product cannot be technically matched or used". That is false: the
  product remains fully matchable (930 technique; 922 of those are unlisted), rankable, knowledge-searchable and commercially representable.
- The word "Permitted use" is this system's established term for the **price/source evidence**
  `downstream_use` dimension (`Permitted use: Discovery Only` on sources/price rows) — applying it
  to the product-level review flag conflated the two distinct "Discovery" concepts (D1 product
  listing badge vs D2 price-evidence permitted use), and a third (D3 understanding-level
  `discoveryReadiness`) also uses the word. The badge now states exactly what the flag is.
- Minor latent inconsistency documented (not changed): the browse returns the canonical-side flag
  (11 view rows) while the row badge reports the requested-row flag, so the 3 superseded requested
  rows (`.PN` variants) show `Discovery listing: Not approved` while resolving to an approved
  canonical — consistent with the list API's normal requested-vs-canonical resolution behavior.

## 8. Implementation (Part I — smallest necessary repair)

Current behavior already conformed to the proven contract; only terminology + single-sourcing needed repair:

1. **Centralized the discovery predicate.** `worker/canonical-product-authority.mjs` now exports `DISCOVERY_READY_PRODUCT_PREDICATE = "approved_for_discovery=1"` (with the full contract comment), and `queryLibraryProducts` uses it in the `discovery=true` filter — the flag now has **one** named expression in the same authority file as the technical predicate it must never converge with. Filter semantics and bind order unchanged.
2. **UI wording.** Product-row badge (app/page.tsx):
   - BEFORE: `"Permitted use: Product discovery"` / `"Permitted use: Not approved for discovery"`
   - AFTER:  `"Discovery listing: Approved"` / `"Discovery listing: Not approved"`
3. No matcher change, no approval write, no migration, no enrichment. The `approve-discovery` /
   `autoApproveDiscovery` write paths were audited only (their behavior already matches the contract).

## 9. UI wording result

- Product-row badge now reads `Discovery listing: Approved` / `Discovery listing: Not approved`.
- It can no longer be parsed as "cannot be technically matched" or "cannot be used".
- The `Review: …` line, the `Commercial: …` line and the Discovery listing line remain independent
  badges derived from independent backend fields in the same row (orthogonality proven by test).

## 10. Focused tests (Part J)

`tests/discovery-semantics-contract.test.mjs` (new, 6 tests):

- **J1/J2** — MATCH_READY predicate never includes the flag; flag=false implies no technical invalidity (fixture-evaluated: flag=0 product matches, Rejected product does not; flag=1 makes a product discovery-listed).
- **J3/J4/J5** — `queryLibraryProducts({discovery:true})` returns only the discovery-approved product; the discovery-approved product is reported approved; the unapproved product is excluded from the browse but present in the default list.
- **J6** — commercial independence: discovery-unapproved product with an approved costing price → `priceEvidenceCount=1`, `costingEligiblePrices=1`, still absent from the discovery browse; listed product with no prices → 0/0.
- **J1/J2 regression** — `product-matching-api.mjs` and `supplier-price-intake-api.mjs` never mention the flag; `knowledge-product-repair.mjs` only ever reports it false.
- **J7** — consumer-map closure: re-scan of `worker/*.mjs` allows only the four governed files (+ camelCase knowledge payload) to mention the column.
- **Part G** — new badge wording present; both falsehoods absent; discovery-listing and Commercial lines render from independent fields.

Updated in place: `tests/product-price-library-ui.test.mjs` (badge assertions flipped to new wording),
`tests/product-matching-api.test.mjs` (authority assertions scoped to the `CANONICAL_*` predicate).

**Focused run (10 Product Library/Prices/contract/matching files): 89 tests, 78 pass, 0 fail, 11 intentional skips**
(the 11 skips are documented retirements in `identity-resolution-governance.test.mjs` for the single-user MVP).

## 11. Wider regression

Full suite: **3418 tests, 3392 pass, 14 skipped, 12 fail — all 12 pre-existing and independent of
PL-REPAIR-2** (no failing test references the changed modules/strings):
- 3 × `mock.module is not a function` Node-harness failures (`knowledge-library-link-factid`, `knowledge-product-repair-route`, `knowledge-product-resolver-runtime`) — environment requires a module-mock flag; failures occur before any assertion.
- 2 × stale `pricing` scenario currency/override label assertions (untouched area).
- 2 × proposal-extraction API assertions (untouched area).
- `GOLDEN SET INTEGRATION` (requires live services), `Exception-based review foundation`, org-scope
  `dashboard`/`project-search` servers, and `stage4-workflow-recovery` action-queue stale assertion
  (`openDashboardRoute(projectId, action.route)` vs the code's intentional `action.projectId`).
- Per the repair brief, unrelated failures were **not** fixed.

## 12. Files changed

1. `worker/canonical-product-authority.mjs` — added `DISCOVERY_READY_PRODUCT_PREDICATE` + contract comment.
2. `worker/product-price-library-api.mjs` — imports and uses the shared predicate in the `discovery=true` filter (semantics/bind order unchanged).
3. `app/page.tsx` — product-row discovery badge wording (~15322–15324).
4. `tests/discovery-semantics-contract.test.mjs` — NEW, 6 contract tests.
5. `tests/product-price-library-ui.test.mjs` — badge-wording assertions updated.
6. `tests/product-matching-api.test.mjs` — authority assertions scoped to the matching predicate.

(Report + `/tmp/pl-repair2-audit.mjs` validation script are artifacts, not product code.)

## 13. Data mutations

**DATA MUTATIONS = NONE.** Live D1 opened read-only (Node `DatabaseSync { readOnly: true }`); no
products approved; no discovery approvals; no commercial approvals; no migrations; no seeds; no
bulk approval. Only working-tree source/test files changed (not committed; workspace has no git repo).

## 14. Status

**PL_REPAIR-2 = COMPLETE**

- `approved_for_discovery` has one explicit semantic definition (§4).
- Every consumer follows it (consumer map §1, closure test J7).
- Technical Matching is not coupled to Discovery (§5, 930 safely intact).
- UI language reflects the true meaning (§9).
- Promotion governance is understood (§3).
- No bulk data approval occurred (§13, 8 remains 8).

## 15. Next step

**NEXT STEP = PL-REPAIR-3 — SEARCH NORMALIZATION**

NOT STARTED AUTOMATICALLY.

**STOPPED — awaiting owner review.**