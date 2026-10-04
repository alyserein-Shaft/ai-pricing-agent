# MVP-AUDIT-COMMERCIAL — Commercial MVP Journey Audit

**Lane:** MVP-AUDIT-COMMERCIAL (independent, read-only, supporting MVP closure)
**Date:** 2026-09-28
**Acceptance project:** `project_c0123d91-c30b-4956-87cb-e473ef53f89d` — Al Mousa School (Fire Alarm)
**Explicitly NOT the acceptance target:** Al Mousa School — Clean Golden Run (`project_ae5011b85…`) — a different entity, untouched.
**Canonical runtime observed:** `http://localhost:4183`
**Boundaries honoured:** no production source, schema, configuration, fixture or business-state change; no live approvals, linking, regeneration, pricing execution, quotation creation, exports or issue actions; no restart, commit, push, deployment, stash, reset or cleanup. One report file written; no other file touched.

---

## 1. Executive verdict

**What works (🟢):** the costing arithmetic and its fail-closed discipline are sound. Currency policy is exactly as established (SAR unchanged, USD ×3.75, everything else hard-refused). Price expiry is informational only. Discounts are scoped, never blanket. A missing price is a hard block with explicit codes and withheld totals — **no silent-zero risk**. Quotation approval and issue are CAS-pinned to evidence fingerprints. The Excel export reads the **pinned** Approved/Issued revision, not live data, and reconciles totals to zero tolerance. Quotation readiness enumerates every engineering-eligible line, so an in-scope line cannot be silently omitted.

**What blocks commercial MVP (🔴):** three independent blockers, none of which is a costing defect.

1. **Standalone service lines are impossible.** `project_quotation_lines` makes product identity mandatory — `candidate_id`, `product_id`, `manufacturer_name`, `part_number`, `product_description` are all `NOT NULL`, four with FKs to product tables. Services exist only as `pricing_cost_components` attached to a product pricing line. A BOQ item that is purely a service cannot be quoted.
2. **Expansion hardware cannot enter the quotation.** The expansion `productId` is resolved in panel sizing then discarded at the aggregation boundary (BOM-002). A Fire Alarm project with a capacity deficit is blocked from quotation by `PANEL_SIZING_EXPANSION_REQUIRED` yet cannot represent the module that fixes it.
3. **No UI for panel sizing.** The stage is API-only and unreachable by any user through the product (established in `docs/MVP-AUDIT-TECH-REPORT.md`, re-confirmed here).

**What remains unverified (🔵):** the entire commercial journey has **never been executed** on the acceptance project. Live state: 0 pricing runs, 0 pricing lines, 0 cost components, 0 pricing approvals, 0 quotation revisions, 0 quotation lines, 0 issues, 0 export jobs, 0 quantity-source decisions, 0 review decisions — against 90 `Final Estimation Review` queue items. Every commercial stage is therefore unproven at runtime, not proven broken.

**Cross-lane note:** blockers 2 and 3 are the same defects that block GOLDEN-001 on the Clean Golden Run. Fixing them is a prerequisite for both lanes.

---

## 2. Journey matrix

Evidence levels: **SRC** = source-traced · **TST** = isolated test · **LIVE** = live project data · **UI** = UI entry point

| Stage | SRC | TST | LIVE | UI | Status |
|---|---|---|---|---|---|
| Approved product selection | 🟢 | 🟢 | 🔵 0 runs | 🟢 Pricing workspace | Unproven at runtime |
| Safety approval | 🟢 | 🟢 | 🔵 0 requests | 🟢 Matching workspace | Path proven; never executed |
| Panel sizing | 🟢 | 🟡 hand-seeded | 🔵 0 snapshots | 🔴 **none** | **Blocked: no UI + unconditional expansion evidence** |
| BOM generation | 🟢 | 🟡 read-model only | 🔵 | 🟢 Engineer Decision | Unproven; no persisted BOM lines |
| Accessory quantities | 🟢 | 🟡 | 🔵 0 selections | 🟢 | Unproven |
| Expansion quantities | 🔴 | 🔴 | 🔵 | 🔴 | **Blocked: BOM-002** |
| Quantity provenance | 🟢 | 🟢 | 🔵 0 decisions | 🟢 | Unproven |
| Price selection | 🟢 | 🟢 | 🔵 | 🟢 | Unproven |
| Costing / buildup | 🟢 | 🟢 | 🔵 0 lines | 🟢 | Unproven |
| Quotation draft | 🟢 | 🟡 | 🔵 0 revisions | 🟢 | Unproven |
| Quotation approval | 🟢 | 🟡 | 🔵 | 🟢 | Unproven |
| Governed Excel export | 🟢 | 🟡 | 🔵 0 jobs | 🟢 | Unproven |
| Issue | 🟢 | 🟡 | 🔵 0 issues | 🟢 | Unproven |
| Service lines | 🔴 | 🔴 | 🔵 | 🔴 | **Blocked: schema** |
| Revision | 🟢 | 🟡 | 🔵 | 🟢 (via re-draft) | Unproven |

---

## 3. Service representation verdict

**The claim is PROVEN: standalone service quotation lines are impossible.**

Exact DDL (`drizzle-active/0000_baseline_schema_0082.sql`, `project_quotation_lines`):

```
candidate_id          TEXT NOT NULL  REFERENCES product_match_candidates(id)
product_id            TEXT NOT NULL  REFERENCES library_products(id)
manufacturer_name     TEXT NOT NULL
part_number           TEXT NOT NULL
product_description   TEXT NOT NULL
pricing_run_id        TEXT NOT NULL  REFERENCES pricing_runs(id)
pricing_line_id       TEXT NOT NULL  REFERENCES pricing_lines(id)
commercial_approval_id TEXT NOT NULL REFERENCES pricing_approvals(id)
```

There is no `line_type` discriminator, no nullable product column, and no conditional constraint. A productless row cannot be inserted.

**How services are actually represented:** as `pricing_cost_components` (`component_type` classified by `classifyCostComponentType` into `MATERIAL`, `SERVICE_LABOUR`, `INSTALLATION`, `TESTING_COMMISSIONING`, `LOGISTICS`, `OVERHEAD`, `RISK_CONTINGENCY`, `SUBCONTRACT`, `OTHER_DIRECT_COST`), attached to a product pricing line. The costing read model summarises them into `serviceSubtotal`, `installationSubtotal`, `testingCommissioningSubtotal` (`worker/boq-line-cost-api.mjs:209,229,304,345`). UI: "Services & Other Costs" in `EngineerDecisionWorkspace.tsx:318-321`. Writer: `ADD_COST_COMPONENT` answer kind (`worker/boq-line-cost-api.mjs:535-540`).

**Consequence:** a BOQ line that is purely a service — "Installation of fire alarm system" with no product — cannot be quoted. Services can only ride along inside a product's cost buildup.

**A schema change IS required** for standalone service lines. A design already exists but is explicitly unimplemented: `AIU-4H-PRE_Atomic_Non_Product_Commercial_Architecture_Plan.md:197-218` proposes `boq_scope_dispositions`, `commercial_scope_lines`, `commercial_scope_line_costs` and a `line_type` discriminator — and states at line 256: *"No migration files created. Proposed only."*

**No dummy hardware products were proposed.** Concealing service costs inside a product rate would misstate product identity and is rejected.

---

## 4. Quotation state-transition table

| From | To | Route | Prerequisites | Error codes |
|---|---|---|---|---|
| — | `Draft` | `POST /api/projects/:id/presales-workflow/quotation/draft` (`presales-workflow-api.mjs:52`) | `workflow.readyForQuotation`; `lineAuthority.ready`; line count + subtotal reconciliation | `QUOTATION_READINESS_BLOCKED`, `QUOTATION_LINE_AUTHORITY_BLOCKED`, `QUOTATION_TOTAL_RECONCILIATION_FAILED` |
| `Draft` | `Approved` | `POST .../quotation/approve` (`:240`) | `canApproveQuotation(role)`; `readyForQuotation`; `evidence_fingerprint === sourceFingerprint`; `quotation_fingerprint === payload.quotationFingerprint`; `status === 'Draft'`; reason ≥ 5 | `QUOTATION_APPROVAL_ROLE_REQUIRED` (403), `QUOTATION_STALE`, `QUOTATION_STATUS_INVALID`, `QUOTATION_REASON_REQUIRED`, `QUOTATION_APPROVAL_STALE` |
| `Approved` | `Issued` | `POST .../quotation/issue` (`:241`) | `canApproveQuotation(role)`; `status === 'Approved'`; `exportEligibleForQuotationIssue(...)` | `QUOTATION_ISSUE_ROLE_REQUIRED` (403), `QUOTATION_NOT_APPROVED`, `GOVERNED_EXPORT_REQUIRED`, `QUOTATION_ISSUE_STALE` |
| `Draft` | superseded | `POST .../quotation/draft` (`:166`) | — | — |

**Approval authority:** `canApproveQuotation` (`worker/project-authority.mjs:27`) accepts 6 roles — `Commercial Reviewer`, `Commercial Manager`, `Commercial Approver`, `Project Manager`, `Management`, `Administrator` (`app/domain/project-roles.mjs:61-68`). Reason ≥ 5 chars (`MIN_GOVERNED_REASON_LENGTH`).

**True blocking gate vs. version-lock query:** `canApproveQuotation` is the true authority gate (403). The fingerprint comparison is a CAS freshness check (409 `QUOTATION_STALE`) — it prevents approving a quotation that no longer matches current evidence. It is not an authority gate and must not be treated as one.

**Version pinning:** `quotationEvidenceFingerprint` (`worker/quotation-evidence.mjs:82`) is SHA-256 of the canonical manifest (project, scenario, currency, panel-sizing authority, per-item requirement/match/safety/technicalApproval/pricing/commercialApproval/finalReview). `quotation_fingerprint` (`presales-workflow-api.mjs:93-114`) additionally covers totals, per-line versions, VAT basis and terms. Approve and issue both CAS on both fingerprints. After issue, an upstream change makes a **new** export job ineligible (`EXPORT_EVIDENCE_STALE`); the issued revision itself is immutable.

**Required project/customer/contact info:** all optional with system defaults (`app/domain/quotation-authority.mjs:40-53`) — `validityDays` 30, `warrantyMonths` 12, `delivery`/`paymentTerms` "Unknown", `exclusions` `[]`, `client` from project then "Unknown". Only `projectName` and `currency` are mandatory (presenter throws `QUOTATION_HEADER_SNAPSHOT_REQUIRED`). Contact title/name come from the current Confirmed NPQ profile and are null when absent.

---

## 5. Costing and Excel correctness findings

**Costing schema:** `pricing_cost_components`, `pricing_cost_allocations`, `pricing_lines`, `pricing_discount_applications`, `pricing_runs`, `pricing_shared_costs`, `pricing_exchange_rates` — all in the 0082 baseline. `pricing_lines` has FKs to `product_match_candidates`, `library_products`, `safety_decisions`, `price_records` and `UNIQUE(pricing_run_id, boq_item_id)`.

**Price selection** (`selectPriceSources`, `app/domain/pricing-engine.mjs:83-115`): requires project match, quantity ≥ minimum, region match, `approvalStatus === "Approved"`, validity gate open, and `downstreamUse === "Costing"`. Ranked by precedence; the top eligible is "Recommended" but `requiresExplicitSelection: true` — **never auto-selected**. Only an explicitly selected source prices; otherwise `PRICE_SOURCE_SELECTION_REQUIRED` / `CURRENT_PRICE_SOURCE_REQUIRED`.

**Price authority:** `loadPricingInput` (`worker/pricing-runtime.mjs:75-84`) resolves the candidate through `product_match_runs` to `canonical_library_products`, enforcing a non-rejected candidate, a non-superseded run that is the MAX version for the BOQ item. Prices load `WHERE r.product_id=? AND (r.project_id IS NULL OR r.project_id=?)` — the price must belong to the approved candidate's product. The engineer's choice is persisted as `engineering_facts` predicate `'Cost Price Source Selection'`.

**Currency policy** (`convertCurrency`, `pricing-engine.mjs:132-139`): SAR→SAR rate 1; USD→SAR ×3.75 (`FIXED_USD_TO_SAR_RATE`); **any other source currency or any non-SAR project currency throws `UNSUPPORTED_CURRENCY`**. No FX table is consulted. ✅ matches established policy.

**Price expiry:** informational only. In costing mode (`allowExpiredOrMissingValidity: true`) only `"Future"` and `"Rejected"` block; an eligible-but-expired source is shown as `Eligible — Expired`, never relabelled. ✅

**Discounts:** scoped, never blanket. `applyDiscounts` (`:117-130`) applies only client/scenario-supplied discounts, each gated on `scope === "Material"`, `projectId`, `manufacturer`, `sourceId` and a future `validUntil`. Supplier quote discounts are baked into `net_price_minor` at intake. ✅

**Buildup formula:** `materialTotal = round(discounted.net × quantityMultiplier, precision)` (`:305`). Components: `Fixed`→rate, `Per Item`→rate×qty, `Percentage of Material`→material×rate/100, `Percentage of Direct Cost`→directCost×rate/100, `Hours`→rate×qty. `directCost = round(materialTotal + Σ(non-indirect), precision)`; `totalCost = round(directCost + indirect, precision)`.

**Markup vs margin:** distinct formulas — markup = profit/cost, margin = profit/gross (`:160-164`). In costing proper a neutral `sellingRule: {method:"Markup", rate:0, minimumMargin:0}` is **forced** (`worker/boq-line-cost-api.mjs:259`, `worker/pricing-api.mjs:716`) — costing never computes a real selling price. Rounding: half-up `Math.round((value + EPSILON) × 10^p)/10^p` at precision 2 for money; margin/markup stored as integer basis points.

**Silent-zero risk: NONE.** A missing price yields `PRICE_MISSING` with `netUnitCost/extendedCost: null`; `aggregateMaterialCost` returns `totalMaterialCost: null` plus an explicit `missingComponents` list; `buildProjectCostSummary` withholds `projectTotalCost` unless `incompleteLines.length === 0`. ✅

**Invalidation:** cost-lock freshness is deep-compared at approval (`assertCommercialCostFreshness`, `commercial-pricing-authority.mjs:101-145`) → `STALE_PRICING_COST`. Stale run/version → `STALE_PRICING_RUN` / `STALE_PRICING_VERSION`. Profile regeneration → `REQUIREMENT_PROFILE_CHANGED`. `buildLineCostModel` is a read model and re-prices on every GET. Idempotent replay on identical `input_fingerprint`.

**Excel export:** sheets are Cover, Project Summary, Detailed Cost Sheet, BOQ Source, Technical Compliance, Product Alternatives, Clarifications and Risks, Review and Approval, Assumptions, Export Metadata. Governed modes (`Approved Cost Sheet`, `Client-Safe Export`) require an approved quotation. **The export reads the pinned revision** — `status IN ('Approved','Issued') AND superseded_at IS NULL` (`excel-export-api.mjs:68`) — not live data, and verifies `evidence_fingerprint === currentEvidenceFingerprint`, line validity, metadata reconciliation and zero-tolerance totals. Cells write **both** formula and cached value (`worker/xlsx-cost-sheet.mjs:6`) with `fullCalcOnLoad="1" forceFullCalc="1"`, so Excel recalculates and non-calculating tools read the cached value. No misrepresentation detected.

**Export gaps:** terms (validity, warranty, delivery, payment, exclusions) are **not** written to the workbook — they appear only in the Quotation workspace preview. Expansion hardware is not a line. Non-governed modes (Draft/Technical/Commercial Review) permit export with warnings.

**Coverage completeness:** `loadCanonicalQuotationLines` iterates **every** engineering-eligible BOQ item and requires canonical pricing, commercial approval, product snapshot and valid selected quantity for each. `ready = blockers.length === 0 && lines.length === boqItems.length`. An in-scope line **cannot** be silently omitted. Non-eligible items (Rejected/Merged/`approved_for_downstream=0`) are excluded by deliberate scope decision and do not block — consistent, not a silent omission.

---

## 6. Deduplicated blockers

| # | Blocker | Class | Evidence |
|---|---|---|---|
| B1 | Standalone service quotation lines impossible | **Proven defect (schema)** | `project_quotation_lines` product columns all NOT NULL + FK; no discriminator |
| B2 | Expansion hardware cannot enter BOM/costing/quotation | **Proven defect (BOM-002)** | `productId` resolved at `fire-alarm-panel-sizing-api.mjs:291-325`, discarded at `fire-alarm-panel-sizing.mjs:41-47`; BOM API has no expansion path |
| B3 | No UI for panel sizing | **Proven defect (missing implementation)** | no component/button/workspace; dispatched only at `worker/index.ts:136-137` |
| B4 | Unconditional expansion evidence | **Proven defect (D-F, upstream)** | `fire-alarm-panel-sizing-api.mjs:381` eager per-panel `loadExpansionPath`; duplicate gate `snapshot:229-231` |
| B5 | `discount_rules` is schema-only | **Proven defect (dead table)** | zero runtime consumers repo-wide; supplier discounts baked into `net_price_minor` at intake |
| B6 | `CONFIRM_EXCHANGE_RATE` is a dead end | **Proven defect** | `convertCurrency` signature `({amount, sourceCurrency, projectCurrency, precision})` accepts **no rate**; throws for any non-USD/SAR source |
| B7 | Terms/exclusions absent from Excel export | **Proven defect (missing implementation)** | `excel-export-engine.mjs:117-130` produces a simplified row set without terms |
| B8 | No UI to add/edit quotation lines or service lines | **Missing implementation (by design)** | lines are immutable snapshots; re-draft required |
| B9 | Entire commercial journey unexecuted on acceptance project | **Missing execution/data** | 0 runs/lines/components/approvals/revisions/lines/issues/exports/decisions |
| B10 | 90 Final Estimation Review items open, 0 decisions | **Missing execution/data** | live count |
| B11 | `engineering_facts` lacks UNIQUE on `(entity_id, predicate)` | **Unverified concern (data integrity)** | multiple Active rows per predicate possible; reader keys on `relationshipType` |
| B12 | `quotation-fingerprint.mjs` FNV-1a unused by server | **Unverified concern (dead code)** | server uses SHA-256 `digest()`; FNV-1a is client-side only |

**Not blockers (cleared):** silent-zero (none), currency policy (correct), price expiry (informational), discount blanket assumption (refuted), export reading live data (refuted — it reads the pinned revision), in-scope line silently omitted (refuted).

---

## 7. Smallest proposed repair slices (none implemented)

| Blocker | Smallest slice | Exit test |
|---|---|---|
| B4 | Make expansion loading lazy: move `loadExpansionPath` out of the `Promise.all` at `:379-382` into a post-`calculateSlcExpansion` branch running only when `requiredAdditionalLoops > 0`; relax the duplicate gate at `snapshot:229-231` to accept a null path when the calculator returned `NO_EXPANSION_REQUIRED`. Preserve `AMBIGUOUS_EXPANSION_RELATIONSHIP`. | Native-satisfying demand with **no** expansion chain → 201 `NO_EXPANSION_REQUIRED`; deficit with no chain → fail closed |
| B2 | Propagate the already-resolved `productId` through the calculation output into a governed BOM/costing/quotation line at the calculator's proven quantity. Do not auto-select. | Expansion product appears as a priced line; `PANEL_SIZING_EXPANSION_REQUIRED` clears only against a real priced line |
| B3 | Add a panel-sizing action to the Fire Alarm workspace calling the existing route. | UI action reaches the route; governed error codes surface |
| B1 | Implement the already-designed `line_type` discriminator + `commercial_scope_lines` from `AIU-4H-PRE…:197-218`. | A service-only BOQ line produces a quotation line with null product identity and is priced and exported |
| B5 | Either wire `discount_rules` into `applyDiscounts` or drop the table. | A governed supplier discount applies only within its scope |
| B6 | Either accept a rate in `convertCurrency` or stop offering `CONFIRM_EXCHANGE_RATE` for non-USD/SAR. | A confirmed rate is used, or the action is not offered |
| B7 | Add a Terms & Conditions sheet to the governed export. | Exported workbook contains validity, warranty, delivery, payment terms and exclusions |
| B11 | Add `UNIQUE(entity_id, predicate)` or enforce in the writer. | A duplicate Active selection is refused |

**Dependency order:** B4 → B2 → B3 (sizing reachable, then representable, then usable). B1 is independent and larger. B5/B6/B7 are independent and small.

---

## 8. Full acceptance checklist

Full acceptance requires **every** in-scope line to pass, not one BOM row or one priced selection.

- [ ] Every engineering-eligible BOQ line has a current selected quantity (`boq_quantity_source_decisions`)
- [ ] Every line has a current requirement profile classifying it into an exact SLC pool or a documented non-SLC scope
- [ ] Every line has an Approved primary product selection with a non-stale match run
- [ ] Every line has a current safety decision with an Approved Technical safety approval request
- [ ] Every line has an eligible, explicitly selected, Approved price with `downstreamUse = "Costing"`
- [ ] Every line's cost buildup completes with no `PRICE_MISSING` and no missing components
- [ ] Every line's material and service subtotals reconcile to the project total
- [ ] Every accessory quantity is derived from the primary quantity with a documented rule
- [ ] Every expansion requirement is either proven unnecessary or represented as a priced line
- [ ] A governed panel-sizing snapshot exists, is current, and is read by `projectPanelSizingBlockers`
- [ ] A quotation draft is created with every in-scope line present and no silent omission
- [ ] The draft reconciles line count and subtotal exactly
- [ ] Approval CAS-pins both evidence fingerprints
- [ ] The governed Excel export reads the pinned revision and reconciles to zero tolerance
- [ ] The export contains materials, services, accessories, terms, exclusions and identity details
- [ ] Issue is permitted only after a governed export
- [ ] Every service line is representable (B1) — **currently fails**
- [ ] Every expansion line is representable (B2) — **Currently fails**
- [ ] Every stage is reachable from the UI (B3) — **Currently fails**

---

## 9. Recommended next commercial execution slice

**Slice: make panel sizing reachable and representable (B4 + B2 + B3), in that order.**

Rationale: B4 is the smallest change that unblocks any Fire Alarm sizing at all, and it is a prerequisite for B2 and B3. B2 is the smallest change that lets a capacity deficit be priced rather than merely blocked. B3 is the smallest change that lets a user reach the stage. Together they convert "blocked with no path" into "reachable, governed, and priced" — without relaxing any gate, without auto-selecting a product, and without dummy hardware.

B1 (service lines) is larger and independently designed; it should follow, not block, the sizing slice. B5/B6/B7 are small independent cleanups that can land in parallel.

**This slice is not executed.**

---

## 10. Report path and evidence limitations

**Report:** `docs/MVP-AUDIT-COMMERCIAL-REPORT.md`

**Limitations:**
1. **No test suite was executed.** Every candidate suite builds its own temp database, but proving isolation from the shared runtime and live data was not established to my satisfaction, so execution was skipped in favour of source reading. No claim here rests on an executed test.
2. **Live counts are a 2026-09-28 snapshot** on a live database with a concurrent lane (MVP-CLOSE-4) writing. They evidence current state, not a stable fixture, and are not regression claims.
3. **Zero rows means absent persisted execution, not broken code.** The commercial journey has simply never been run on the acceptance project; this audit distinguishes that from defect wherever the source allows, but cannot prove which commercial actions a human may or may not have attempted.
4. **Engineering/manufacturer research was not performed:** no concrete technical uncertainty required it, and no fact was approved or persisted.
5. `worker/technical-requirement-api.mjs:495` is a minified over-long line; its sub-branch detail rests on string-presence oracles. The commercial paths traced here are in separate, normally-formatted files and were read directly.

---

**STOPPED — MVP-AUDIT-COMMERCIAL complete; read-only audit.**
