# PL-REPAIR-1 — PRODUCT STATUS TRUTHFULNESS REPORT

- **Repair ID:** PL-REPAIR-1
- **Title:** PRODUCT STATUS TRUTHFULNESS
- **Scope:** FRONTEND + API CONTRACT REPAIR ONLY (no governance change, no eligibility change, no approval-count increase, no data mutations)
- **Status:** **COMPLETE**
- **Next step:** **PL-REPAIR-2** (one and only one next step — not auto-started; see "Next Step")
- **Date:** 2026-09-22
- **Data mutations:** **NONE** (all backend access was read-only; only frontend/API-contract/test code changed)

---

## 1. Executive summary

The Product Library UI made two fabricated claims about persisted backend state:

1. **F1 — Product list rows** (`app/page.tsx`): every row rendered `<small>Blocker: No commercial approval</small>` regardless of that product's actual approval/costing state. For the one product with an approved, current, Costing-dedicated price (IDP-PHOTO-IV), this labelled an eligible product as blocked.
2. **F2 — Product detail price rows** (`app/page.tsx`): every price rendered a fixed "Historical / Discovery Only" + "No validity end · Not approved for costing" label, regardless of the price record's actual `approval_status`, `downstream_use`, `valid_until`, `validity_state`, and `eligibleForCosting`. The same hardcoded claim also appeared in the **Price Sources** module source-document cards.

Both hardcodes are removed. The UI now derives every commercial/period/approval label from authoritative backend fields, and the Product Library **list API now reports per-product read-only price aggregates** (`priceEvidenceCount`, `costingEligiblePrices`) so product rows can display a truthful Commercial dimension. Nothing was written to the database; no approval was granted; no eligibility was changed.

---

## 2. Hardcoded paths (located in Part A trace)

| # | File | Line (before) | Hardcoded text |
|---|------|---------------|----------------|
| 1 | `app/page.tsx` | 15058 | `<small>Blocker: No commercial approval</small>` (product list row) |
| 2 | `app/page.tsx` | 15193 | `<strong>Historical prices</strong>` (detail section header — implied all prices historical) |
| 3 | `app/page.tsx` | 15201–15205 | `<span className="review-blocked">Historical / Discovery Only</span>` + `<small>No validity end · Not approved for costing</small>` (detail price row) |
| 4 | `app/page.tsx` | 16829–16835 | "Historical manufacturer list evidence · no validity end recorded." + "Historical / Discovery Only · Not approved for costing" (Price Sources source-document card) |

All four compile-time strings were removed from runtime rendering. The only remaining occurrences of the phrase are in the legitimate state-driven presentation module `app/components/workspaces/commercial-models.mjs` (`pricingSourcePresentation`), which derives its label from actual `historical`/`eligible` flags rather than hardcoding — out of scope and correct.

---

## 3. Authoritative backend fields (Part A)

### 3.1 Product row (per product in `queryLibraryProducts`)

| UI dimension | Authoritative field |
|--------------|---------------------|
| Review | `requested_review_status` → `reviewStatus` (row), fallback `review_status` |
| Discovery (permitted use) | `requested_approved_for_discovery` → `approvedForDiscovery` |
| Lifecycle | `lifecycle_status` + `product_lifecycle_events` `lifecycle_evidence_supported` |
| Identity | `resolvesToCanonical` + `canonicalPartNumber` |
| **Commercial (new)** | **`priceEvidenceCount`** (count of `price_records` for canonical `c.id`) and **`costingEligiblePrices`** (count where `approval_status='Approved' AND downstream_use='Costing' AND valid_until IS NOT NULL AND valid_until >= today`) |

### 3.2 Price row (per price record, detail API)

| Label | Authoritative field |
|-------|---------------------|
| Currency + amount | `currency`, `amount` (minor units) |
| Period (CURRENT/HISTORICAL) | `validity_state` (e.g. "Historical — Validity End Missing", "Historical", "Current Approved", "Project-Specific Approved") and `valid_until` |
| Costing eligibility | `eligibleForCosting` (computed in detail handler = `Approved ∧ Costing ∧ valid_until set ∧ valid_until ≥ today`) |
| Approval | `approval_status` ("Approved", "Needs Review", "Rejected", "Superseded") |
| Permitted use | `downstream_use` ("Costing" / "Discovery Only") |
| Evidence | `file_name`, `approval_status`, `validity_state` |

### 3.3 Price Sources card (per managed price document)

- `importedSourceForDocument(document)` → `DurableLibrarySource` (`review_status`, `downstream_use`, `validity_state`, `valid_until`, `source_type`, `project_id`, `checksum`, `document_version_id`).
- The card was previously showing manufactured "Historical / Discovery Only · Not approved for costing"; it now shows the source's actual review/permitted-use/period state, or a neutral "not yet imported" state when no durable source matches.

---

## 4. Product-row mapping (Part B)
### Before
```
Review: {reviewStatus || review_status || "Needs Review"}
Permitted use: Product discovery | Not approved for discovery
Lifecycle: Active                        (only when evidence + Active)
Resolves to {canonicalPartNumber}        (only when resolvesToCanonical)
Blocker: No commercial approval          ← fabricated for every row
```
### After (rules 1–5 applied; explicit Review/Discovery/Commercial dimensions)
```
Review: {reviewStatus || review_status || "Needs Review"}
Permitted use: Product discovery | Not approved for discovery
Lifecycle: Active                        (only when evidence + Active)
Resolves to {canonicalPartNumber}        (only when resolvesToCanonical)
Commercial: Costing eligible             (costingEligiblePrices > 0)
Commercial: No approved costing price    (priceEvidenceCount > 0 ∧ costingEligiblePrices = 0)
Commercial: No price evidence            (priceEvidenceCount = 0)
Commercial status unavailable            (aggregates absent — defensive fallback)
```

- Rule 1 (missing commercial state shown accurately): "No approved costing price" / "No price evidence".
- Rule 2 (approval exists ⇒ no "No commercial approval"): "Commercial: Costing eligible".
- Rule 3 (commercial ≠ technical): the Commercial line never mentions technical readiness; Review/Lifecycle stay separate.
- Rule 4 (no inference): the list aggregates count persisted `price_records` directly — same predicate as detail `eligibleForCosting`. The safety flags `commercialApprovalInferred: false` / `priceEligibilityInferred: false` remain untouched because the backend still never *infers* commercial state from identity/matching.
- Rule 5 (no manufactured blocker): the word "Blocker" no longer appears as a commercial status.

**API contract change (read-only, additive):** `queryLibraryProducts` result SELECT adds two correlated subqueries keyed on canonical `c.id`:
```sql
(SELECT COUNT(*) FROM price_records price_evidence
  WHERE price_evidence.product_id=c.id) price_evidence_count,
(SELECT COUNT(*) FROM price_records costing_eligible
  WHERE costing_eligible.product_id=c.id
    AND costing_eligible.approval_status='Approved'
    AND costing_eligible.downstream_use='Costing'
    AND costing_eligible.valid_until IS NOT NULL
    AND costing_eligible.valid_until >= date('now')) costing_eligible_price_count
```
Mapping in the product object: `priceEvidenceCount: Number(row.price_evidence_count || 0)`, `costingEligiblePrices: Number(row.costing_eligible_price_count || 0)`. `date('now')` (SQLite, UTC) matches the worker's `today()` = `new Date().toISOString().slice(0,10)` (UTC) — consistent with the detail `eligibleForCosting` predicate. No `?` placeholders were added to the SELECT list, so the existing `...sourceBindings, ...commonBindings, q, safePageSize, offset` bind order is unchanged.

---

## 5. Price-row mapping (Part C)
### Before
```
<b>{currency} {amount}</b>
<span className="review-blocked">Historical / Discovery Only</span>
<small>No validity end · Not approved for costing</small>
<small>{file_name} · {approval_status} · {validity_state}</small>
```
Section header: "Historical prices".
### After
```
<b>{currency} {amount}</b>
<span className={eligibleForCosting ? "review-ready" : "review-blocked"}>
  Costing eligible | Not costing eligible
</span>
<small>{period} · {approval} · {downstream_use}</small>
<small>{file_name} · {approval_status} · {validity_state}</small>
```
Section header: "Prices".

Derivation helpers (module-level in `app/page.tsx`):
- `libraryPricePeriod(price)` → `"Current"` / `"Historical"` / `"Validity unrecorded"` from `validity_state` (contains "Historical" ⇒ Historical; "Current Approved"/"Current" ⇒ Current) then `valid_until` vs today, else `"Validity unrecorded"`.
- `libraryPriceApprovalLabel(price)` → `"Approved"` when `approval_status === "Approved"`, else `"Not approved · {status}"` (status always from backend).
- `libraryPriceDownstreamUse(price)` → `"Costing"` / `"Discovery Only"` from `downstream_use` (fallback "Discovery Only" only when backend field absent).

### Price Sources card (same violation class, fixed)
Before: hardcoded "Historical manufacturer list evidence · no validity end recorded." and "Historical / Discovery Only · Not approved for costing".
After: derived from `importedSourceForDocument(document)` when present — `Review: {review_status || "Needs Review"} · Permitted use: {downstream_use || "Discovery Only"} · {libraryPricePeriod(importedSource)}` with a cost badge keyed on `downstream_use === "Costing"` and period `"Current"`; when no imported durable source exists the card shows the neutral Part-F state "Registered price document — not yet imported to the Product Library." and "Not imported · no price state".

---

## 6. Representative-product validation (Part E)

Validated against the **live D1 database (read-only)** using the exact subquery predicates added to `queryLibraryProducts`, and the exact `app/page.tsx` derivation helpers, for the five representative products (script: `/tmp/pl-repair-validate.mjs`).

| Product | Backend state | New product-row label | New price-row labels |
|---------|---------------|------------------------|----------------------|
| **IFP-75** (`product_d21d8928`) | 0 price records | **Commercial: No price evidence** | "No price evidence is linked." (truthful empty state retained) |
| **IDP-HEAT-ROR-IV** (`product_161c27bf`) | 2 prices, both Needs Review / Discovery Only / Historical — Validity End Missing; 0 costing-eligible | **Commercial: No approved costing price** | Historical · Not approved · Needs Review · Discovery Only (×2) |
| **IDP-PHOTO-IV** (`product_0c4c8db3`) | 2 prices; `price_1c248b3e`: Approved / Costing / Current Approved / valid 2027-06-30 (costing-eligible); `price_042d8b1f`: Approved / Discovery Only / Historical | **Commercial: Costing eligible** | `price_1c248b3e` → **Current · Approved · Costing**; `price_042d8b1f` → Historical · Approved · Discovery Only |
| **IDP-PHOTO-R-IV** (`product_0baa64c8`) | 2 prices, Needs Review / Discovery Only / Historical | **Commercial: No approved costing price** | Historical · Not approved · Needs Review · Discovery Only (×2) |
| **IDP-PHOTO-IV.** (superseded requested `product_918ff5e3` → canonical `product_0c4c8db3`) | requested row resolves to the same canonical as IDP-PHOTO-IV; list aggregates keyed on `c.id` | **Commercial: Costing eligible** (same as canonical head) | Same price set as IDP-PHOTO-IV |

Every derived label matches the persisted backend state; no label contradicts a record, and the costing-eligible product is never shown as "blocked" or "No commercial approval".

---

## 7. Files changed

| File | Change |
|------|--------|
| `worker/product-price-library-api.mjs` | `queryLibraryProducts`: added read-only `price_evidence_count` / `costing_eligible_price_count` correlated subqueries (keyed on canonical `c.id`) and mapped `priceEvidenceCount` / `costingEligiblePrices` into each product row. Bind order unchanged. |
| `app/page.tsx` | `LibraryProduct` type gained optional `priceEvidenceCount` / `costingEligiblePrices`. Added module-level helpers `libraryPriceCurrentDate`, `libraryPricePeriod`, `libraryPriceApprovalLabel`, `libraryPriceDownstreamUse`. Replaced product-row blocker with derived Commercial dimension. Retitled detail section header to "Prices" and derived each price row from backend state. Derived Price Sources card from `importedSourceForDocument` source state with neutral not-imported fallbacks. |
| `tests/product-price-library-ui.test.mjs` | Flipped the blocker assertion to `doesNotMatch` and added 7 focused tests (Part G proofs below). |
| `tests/product-library-source-scope.test.mjs` | Fixture now creates `price_records` (required by the new list subqueries) and seeds an Approved/Costing/current price + a Discovery-Only historical price on canonical `product-1`; added a test asserting `priceEvidenceCount=2`, `costingEligiblePrices=1` for `PART-001` and `0/0` for a product with no prices. |

**Data mutations: NONE.** No INSERT/UPDATE/DELETE against any database; no approvals granted; no migrations; no eligibility changes. `product_identity_prices` (1,204 records) not touched.

---

## 8. Focused tests (Part G — 8 proofs)

1. **No fabricated blocker:** `assert.doesNotMatch(page, /Blocker: No commercial approval/)` (flipped) + `assert.doesNotMatch(page, /"Blocker"/)`.
2. **Row derives commercial from persisted aggregates:** `page` matches `typeof product.costingEligiblePrices === "number"`, `priceEvidenceCount === 0`, and uses both `product.costingEligiblePrices` / `product.priceEvidenceCount` ≥ 1×.
3. **Row vocabulary complete:** matches all four states — `"Commercial: Costing eligible"`, `"Commercial: No approved costing price"`, `"Commercial: No price evidence"`, `"Commercial status unavailable"`.
4. **No hardcoded price-row claim:** `doesNotMatch` for `No validity end · Not approved for costing` and the fixed `Historical / Discovery Only` span; price rows call `libraryPricePeriod`, `libraryPriceApprovalLabel`, `libraryPriceDownstreamUse`.
5. **CURRENT/HISTORICAL derivation:** `libraryPricePeriod` present with `"Historical"`, `"Current"`, `"Validity unrecorded"`, driven by `validity_state` and `valid_until`; detail section titled `<strong>Prices</strong>` (no `Historical prices`).
6. **Costing/approval derivation:** `eligibleForCosting ? "Costing eligible" : "Not costing eligible"`; `libraryPriceApprovalLabel` maps `"Approved"` vs `` `Not approved · ${status}` ``; raw `price.approval_status` still reaches the evidence line.
7. **Price Sources card derived:** `importedSourceForDocument(document)` used; `doesNotMatch` for the two old card hardcodes; `"Registered price document — not yet imported to the Product Library."` and `"Not imported · no price state"` neutral states; badge keyed on `importedSource?.downstream_use === "Costing"`.
8. **API contract proof (runtime):** `product-library-source-scope.test.mjs` exercises `queryLibraryProducts` against an in-memory fixture with `price_records`, asserting per-product aggregates equal the persisted rows (`2` evidence, `1` costing-eligible).

Empty/absent states (Part F) are covered by proofs 3/7 plus retained `"No price evidence is linked."` and `"Commercial status unavailable"` / `"Validity unrecorded"` / not-imported fallbacks.

---

## 9. Regression

Run (Product Library frontend/API and direct dependents):

- `tests/product-price-library-ui.test.mjs` — **12/12 pass** (incl. 7 new/focused)
- `tests/product-library-source-scope.test.mjs` — **pass** (incl. new aggregate test, existing source-scope/pagination/fails-closed intact)
- `tests/product-price-library-api.test.mjs` — **pass** (incl. safety-gate `matchingPerformed: false`, PRICE_VALIDITY_REQUIRED gates, 503 fail-closed)
- `tests/product-price-library.test.mjs` + `tests/pricing-api.test.mjs` — **24/24 pass** (real Honeywell workbook domain checks, `pricingSourcePresentation` untouched)
- Worker-dependent regression (`document-classification-authority`, `system-knowledge-registry`, `ifp75-datasheet-ingestion`, `product-accessory-relationships`, `product-compatibility-deprecation`, `task9-phase1-reconciliation`, `task9-fire-alarm-library`, `6815-persistence-safety`) — **111/111 pass**

Total: **160/160 pass, 0 fail.** No unrelated failures introduced; unrelated suites were not modified.

---

## 10. Status

**COMPLETE** — PL-REPAIR-1 is finished. F1 and F2 hardcodes are removed, per-product and per-price commercial state is displayed from authoritative backend fields, the list API contract carries read-only price aggregates, the Price Sources card hardcode (same violation class) is also fixed, no data was mutated, and focused tests + regression are green.

## Next Step (exactly one)

**PL-REPAIR-2 — COMMERCIAL COVERAGE AND APPROVALS** (deferred per mission scope): address commercial coverage / approvals as a governed follow-up — e.g., the source-review flow's costing approval requirements, coverage of the 8 discovery-approved products, and the 1 current Costing-eligible price — as a separate repair. **PL-REPAIR-2 is NOT started in this session.**

---
*STOPPED — PL-REPAIR-1 scope complete; no further auto-progression.*