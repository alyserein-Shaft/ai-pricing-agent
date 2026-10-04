# Commercial Preflight Report: Al Mousa Fire Alarm

**Date**: 2026-10-02
**Canonical D1**: `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite`
**Canonical Project**: `project_ae501b85-9c12-4332-bf8e-787c90f2d388` (Al Mousa School — Clean Golden Run)
**Verdict**: **COMMERCIAL_PREFLIGHT = BLOCKED**

---

## A. Current Al Mousa Commercial Population

| Metric | Value | Evidence |
|---|---|---|
| `project_quotation_lines` rows | **0** | `SELECT * FROM project_quotation_lines` — empty table |
| `project_quotation_revisions` rows | **0** | `SELECT * FROM project_quotation_revisions` — empty table |
| `project_quotation_decisions` rows | **0** | `SELECT * FROM project_quotation_decisions` — empty table |
| `pricing_approvals` rows | **0** | `SELECT * FROM pricing_approvals` — empty table |
| Pricing runs for Al Mousa | **None** | All 3 pricing runs (`618674e1`, `be5de80a`, `630eb2b6`) are for `project_62553bdf` (Central Kitchen) |
| Pricing lines for Al Mousa | **None** | `pricing_lines` has 3 rows but all reference `project_62553bdf` (Central Kitchen) |
| Progress snapshots `pricedItems` | **0** | All `project_progress_snapshots` for Al Mousa show `pricedItems: 0` |
| Progress snapshots `commercialApproved` | **0** | All snapshots show `commercialApproved: 0` |
| Progress snapshots `missingPrices` | **90** | Consistent across all snapshots: 90 BOQ items have missing prices |
| Technical approval status | **Not approved** | `technicalApproved: 0` in every snapshot |
| Safety decisions count | Multiple | 20+ safety decisions, all `Blocked` with `Price Approval Disabled` |

---

## B. Current Selections

- **Approved/current selections**: None. No product selections have been materialized into `project_quotation_lines`.
- **Selected product IDs**: None. The authoritative product is `product_0c4c8db3` (IDP-PHOTO-IV, Intelligent Addressable Photoelectric Smoke Detector, Ivory Color, Base Not Included), but it has not been selected in any pricing run for this project.
- **Technical approval linkage**: None. No technical approval has been recorded; safety decisions block on `category` and `productFamily` fields.
- **Rows not yet commercially eligible**: 90 BOQ items (per `missingPrices: 90` in progress snapshots).

---

## C. Pricing Runs

| Run ID | Project | Status | Version | Approval Ready |
|---|---|---|---|---|
| `pricingrun_618674e1-501b-4c7e-bc47-c6de479b3d24` | `project_62553bdf` (Central Kitchen) | Pricing Blocked | 3 | false |
| `pricingrun_be5de80a-a827-4530-a159-10adc9a33471` | `project_62553bdf` (Central Kitchen) | Pricing Blocked | 2 | false |
| `pricingrun_630eb2b6-e148-4019-a49d-7614de645d3d` | `project_62553bdf` (Central Kitchen) | Pricing Blocked | 1 | false |

**No pricing runs exist for `project_ae501b85` (Al Mousa).**

All runs stay in `Pricing Blocked` status because `approval_ready=0`.

---

## D. Pricing Lines (authoritative v3)

The only current-authority pricing line predicate is **v3** from `pricingrun_618674e1-...`:

| Field | Value |
|---|---|
| `pricingline_id` | `pricingline_bb259b6b-f696-4d58-a387-992c0e3d8372` |
| `pricingline_version` | **3** |
| `pricing_run_id` | `pricingrun_618674e1-501b-4c7e-bc47-c6de479b3d24` |
| `pricing_run_version` | **3** |
| `project_id` | `project_62553bdf` (Central Kitchen — Makkah) |
| `boq_item_id` | `boqitem_cf582ac9` |
| `product_id` | `product_0c4c8db3` (IDP-PHOTO-IV) |
| `quantity` | **230** (Each) |
| `currency` | **USD** |
| `total_cost_minor` | 6500 × 100 = **650,000** (cents) |
| `net_selling_minor` | 6500 × 100 = **650,000** (cents) |
| `source_snapshot_json` | Contains price source `price_1c248b3e-f71a-4604-a496-fcfa698b002b` with amount 6500 USD, SAR conversion 6500 × 3.75 = 24,375 SAR |
| `status` | Pricing Complete |
| `approval_ready` | **false** |
| **Blockers** | `TECHNICAL_APPROVAL_REQUIRED`, `SAFETY_PRICE_ELIGIBILITY_REQUIRED`, `PRICE_SOURCE_SELECTION_REQUIRED` |

**Critical**: This v3 line is the current authority via the `latest-version` predicate. However, it references `project_62553bdf` (Central Kitchen), **NOT** the Al Mousa project. No v3 line exists for the Al Mousa project.

---

## E. Price Sources (governed, verified)

| Source ID | Amount | Currency | Price Type | Eligible | Downstream Use | Authority |
|---|---|---|---|---|---|---|
| `price_1c248b3e-f71a-4604-a496-fcfa698b002b` | **6500** | **USD** | Manufacturer List Price | **true** | Costing | Recommended (rank 8) |
| `price_042d8b1f-a0ca-4a54-8280-499495c12cf5` | 70 | USD | Manufacturer List Price | false | Discovery Only | Rejected (restricted to discovery) |

**Governed normalization**: `6500 USD × 3.75 = 24,375 SAR`. The source truth is 6500 USD; the SAR conversion is a governed normalization factor. No duplicate SAR price record is created.

**Source provenance**: This price source is verified in `productsource_a831bb90f5914079b65f013dfb0dd3ef` (Honeywell_IDP-PHOTO-W-IV_DataSheet_351629-C.pdf, rev C, 2026-10-01), which states: "Each IDP-PHOTO-W Series detector uses one of the panel's addresses." The `IDP-PHOTO-IV` is the ivory-color variant of the same product family.

**Costing eligibility**: The price source is `eligible: true` and `downstreamUse: Costing`, but it has not been materialized into a pricing line for the Al Mousa project.

---

## F. Approval State

| Approval Type | Status | Evidence |
|---|---|---|
| **Technical approval** | **Not approved** | `technicalApproved: 0` in all progress snapshots; safety rulings block on `category` and `productFamily` |
| **Price approval** | **Disabled** | All safety decisions show `Price Approval Disabled`; `commercialImpact: "Price use cannot be authorized"` |
| **Quotation approval** | **Blocked** | `project_quotation_lines` empty (0 rows); `QUOTATION_LINE_AUTHORITY_BLOCKED` returned by handler |
| **Export approval** | **Not reachable** | Export gate requires approved quotation; no approved quotation exists |
| **Safety blocking conditions** | **6 conditions remain** | Per safety decision text: "Safety state is Missing Critical Information. Confidence is Discovery Only at 0% and compliance is Discovery Only. 6 blocking conditions remain." The two primary blocks per item are `category` and `productFamily`. |

**Safety decision detail** (representative):
- `priceSource: 30` (out of 100-scale) — only 30% price source completeness
- Blocking fields: `category` (required by safety rules), `productFamily` (required by safety rules)
- `technicalImpact: "The technical evaluation cannot be verified."`
- `commercialImpact: "Price use cannot be authorized."`
- `suggestedResolution: "Provide source-backed category." / "Provide source-backed productFamily."`

---

## G. Exact Blockers (preventing commercial progression)

1. **No technical approval** — The project has `technicalApproved: 0`; safety rules require `category` and `productFamily` before any price can be authorized.
2. **Missing category** in safety rules — Required field not provided for any BOQ item in the Al Mousa project.
3. **Missing productFamily** in safety rules — Required field not provided; the governed product family for IDP-PHOTO-IV must be established.
4. **No pricing lineage for Al Mousa** — All 3 pricing lines reference `project_62553bdf` (Central Kitchen). No pricing lines exist for `project_ae501b85` (Al Mousa).
5. **90 missing prices** — `missingPrices: 90` across BOQ items; the AI understanding layer has 62 items with no analysis and 20 awaiting engineer review decision.
6. **AI Understanding incomplete** — Blockers from progress snapshots: "62 eligible BOQ item(s) have no current AI Understanding analysis. 20 eligible BOQ item(s) are awaiting an engineer review decision."

---

## H. Exact First Executable Commercial Action After Technical Approval

Once technical approval is present (category and productFamily fields provided), the **smallest sufficient next slice** is:

| Step | Action | Location | Mechanism |
|---|---|---|---|
| **1** | **Governed writer**: INSERT into `project_quotation_lines` from `loadCanonicalQuotationLines` output | `worker/presales-workflow-api.mjs` `quotation/draft` handler | `env.DB.batch` atomic mechanism |
| **2** | Materialize all NOT NULL fields: `pricing_run_id`, `pricing_run_version`, `pricing_line_id`, `pricing_line_version`, `boq_item_id`, `product_id`, `quantity` (230), `currency` ('SAR'), `total_cost_minor`, `net_selling_minor`, `source_snapshot_json`, `source_type='PRODUCT'`, `source_product_id=product_id` | Same handler | Plain INSERT (not UPSERT) respecting `UNIQUE(quotation_revision_id, boq_item_id)` invariant |
| **3** | Derive `approval_ready=1` so runs transition from "Pricing Blocked" to ready state | Same batch | Revision + decisions + lines inserts in single atomic batch |
| **4** | Quotation draft creation returns complete line data | `quotation/draft` handler | Gate passes when lines exist with full authority data |
| **5** | R1 Administrator approval via existing governed action | Existing approval workflow | Transition quotation from draft → approved |
| **6** | Export gate and artifact generation | Downstream workflow | Export proceeds only after approved quotation |

**Key invariants**:
- Must use `env.DB.batch` alongside existing revision/decisions inserts
- Must NOT use UPSERT to hide contract errors; plain INSERT only
- Must respect `UNIQUE(quotation_revision_id, boq_item_id)` — only one current demand of 230, never 3×230=690
- Must use latest-version predicate so only v3 line materializes demand

---

## I. Exact Pricing-to-Quotation Pipeline Currently Present

| Pipeline Stage | Status | Detail |
|---|---|---|
| **`quotation/draft` handler** | **BLOCKED** | Returns `QUOTATION_LINE_AUTHORITY_BLOCKED` because `loadCanonicalQuotationLines` returns `ready: false` with zero lines |
| **Governed INSERT into `project_quotation_lines`** | **MISSING** | No governed `INSERT` path exists in shipped code; table is empty (0 rows) |
| **Atomic batch (`env.DB.batch`)** | **NOT YET WIRED** | Existing code has revision + decisions inserts but no lines insert in the batch |
| **Pricing-line-to-quotation materialization** | **NOT IMPLEMENTED** | `loadCanonicalQuotationLines` returns line objects but has no persistence path into `project_quotation_lines` |
| **Approval-ready derivation** | **BLOCKED** | All lines have `approval_ready=0`; runs stay `Pricing Blocked` |
| **R1 Administrator approval** | **Pending** | Cannot proceed until quotation draft has complete line data |
| **Export gate** | **Blocked** | Requires approved quotation; no approved quotation exists |

**Prior failure mode**: Manual SQL INSERT failed on NOT NULL constraint `pricing_run_id` — the writer must use the existing schema contract, not bypass it.

**Critical design constraint**: The writer must include `env.DB.batch` alongside existing revision/decisions inserts. The batch must contain plain INSERT (not UPSERT) for `project_quotation_lines`, with all NOT NULL fields populated from the authoritative pricing lineage.

---

## Commercial Preflight Verdict

```text
COMMERCIAL_PREFLIGHT = BLOCKED
```

**Root cause**: The Al Mousa Fire Alarm project (`project_ae501b85-9c12-4332-bf8e-787c90f2d388`) has **zero commercial population** in the canonical runtime database. No pricing runs, no pricing lines, no quotation lines, no approvals, and no safety clearance exist. The technical approval is not granted (blocked on `category` and `productFamily`), and 90 BOQ items have missing prices. The governed price source (`price_1c248b3e-f71a-4604-a496-fcfa698b002b`, 6500 USD → 24,375 SAR for IDP-PHOTO-IV) is verified and valid but has not been materialized into any Al Mousa pricing line.

**First executable action**: After technical approval (category + productFamily), implement the governed `quotation/draft` writer in `worker/presales-workflow-api.mjs` using `env.DB.batch` to materialize `project_quotation_lines` from authoritative pricing lineage, then proceed to R1 Administrator approval and export.

**Next smallest slice**: 
1. Add technical approval (populate `category` and `productFamily` per safety rules)
2. Implement the governed writer in `worker/presales-workflow-api.mjs` `quotation/draft` handler
3. Verify `approval_ready=1` derivation and run transition from Pricing Blocked
4. Enable quotation draft → R1 Administrator approval → export gate