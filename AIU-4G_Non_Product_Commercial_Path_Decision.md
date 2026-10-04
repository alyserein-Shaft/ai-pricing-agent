# AIU-4G — Non-Product Obligation Commercial Path Decision

**Mode:** READ-ONLY ARCHITECTURE / DOMAIN DECISION
**Result: 🔴 STRUCTURAL GAP.** Nothing implemented. No schema, no migration, no code, no Golden mutation.

---

## 1. Executive Verdict

**🔴 STRUCTURAL GAP** — the current architecture has a single product-centric commercial identity model. A non-product BOQ obligation has **no alternative identity** that can satisfy cost, pricing, readiness, and immutable quotation authorities. This is not a missing feature at one stage; it is a missing *root* that every commercial stage depends on.

The decisive evidence, independently verified against the live schema:

| Table | `product_id` | `candidate_id` | `safety_decision_id` |
|---|---|---|---|
| `pricing_lines` | **NOT NULL** | **NOT NULL** | **NOT NULL** |
| `project_quotation_lines` | **NOT NULL** | **NOT NULL** | (plus `manufacturer_name`, `part_number`, `pricing_line_id`, `commercial_approval_id` all NOT NULL) |

`pricing_cost_components` is productless in shape (`component_type`, `description`, `method`, `rate`, `amount_minor`) but is **hard-bound to a product-backed parent**: `pricing_line_id NOT NULL REFERENCES pricing_lines(id)`.

So non-material cost exists only as *composition on top of* a product, never as a commercial root.

---

## 2. Current End-to-End Product Assumption

```
current BOQ item
  → requirement profile (Understanding OPTIONAL, raw-BOQ fallback)
  → product_match_candidates            ← product identity originates here
  → library_products
  → safety / technical approval
  → price_records (product_id NOT NULL)
  → pricing_lines (product_id NOT NULL)
  → commercial approval
  → project_quotation_lines (product_id NOT NULL)
```

Every stage from matching onward is product-identity-bound. Requirements are the **only** stage that is not.

---

## 3. Product Matching Gate

**`BOQ_UNDERSTANDING_REQUIRED` is a sequencing prerequisite, not a product classifier.**

```js
// worker/product-matching-api.mjs:58
const currentUnderstanding = (db, itemId) => db.prepare(
  "SELECT ... FROM estimator_item_interpretations WHERE boq_item_id=? AND status IN ('COMPLETED','NEEDS_REVIEW') ..."
).bind(itemId).first();
// :239
if (!understandingRow) throw Object.assign(new Error("Run BOQ understanding before product matching."), { code: "BOQ_UNDERSTANDING_REQUIRED" });
```

- It inspects **only interpretation existence**, never whether the row is a product.
- The project-wide route is **indiscriminate**: `SELECT b.id ... WHERE b.project_id=? AND currentBoqItemPredicate("b")` (`:288-291`) — every current `Item`/`BOQ Item`.
- A thrown row becomes a **per-item FAILED** result; the batch continues (`:277-283`, pinned by `tests/ai-product-ranking.test.mjs:25`).
- **No existing bypass** excludes interface/service obligations while keeping them as ordinary current BOQ items. Structural rows (Header/Excluded) are excluded, but that is a row-type exclusion, not a scope exclusion.
- Downstream consumers have **no "no-match-by-design" state**: they emit `MATCH_RUN_REQUIRED` (`:317`), `No usable product candidate` (`app/domain/estimator-row-readiness.mjs:18-29`), `No technically viable candidate has been found` (`worker/boq-line-decision-api.mjs:181-185`), or `NO_CANDIDATES` (`app/domain/match-selection-status.mjs:43-45`).

**Contradiction:** the Fire Alarm taxonomy explicitly knows these are non-products — `elevator / HVAC / AHU / BMS interface: function without hardware identity` (`app/domain/fire-alarm-taxonomy.mjs:498-500`, structured `NO_PRODUCT_FAMILY` at `:515-517`) — but **no matching call site consumes that knowledge**.

---

## 4. Requirement Handling — the one stage that already works

Requirements are **not** blocked:

```js
// worker/technical-requirement-api.mjs:175-177
system: approvedSystem || item.system_value,
category: approvedCategory || item.category,
productFamily: approvedProductFamily || item.subcategory || item.category,
```

Understanding is **optional enrichment** here — unlike matching, where it is mandatory.

But the profile is still **product-search-shaped**: `productFamily` is a blocking readiness field (`app/domain/technical-requirement-engine.mjs:195, 206-213, 241-247`), so a productless row yields `Missing Critical Information`, never a positive "obligation satisfied" state. `Not Applicable` exists in `READINESS_STATUSES` (`:64`) but **no code path ever selects it** for an obligation.

Interface/integration **is** representable as a requirement: `relationshipType: "Interface"` (`app/domain/specification-extractor.mjs:313-326`), `REQUIREMENT_CATEGORIES` includes Functional/Installation/Testing/Commissioning (`:15`). And `requirement-scope-role-routing.mjs:54-55` already defines non-product roles (`INSTALLATION_COMPLIANCE`, `TESTING_COMMISSIONING`, `MAINTENANCE_SERVICE`, `COMMERCIAL`…) — but it is **advisory, tests-only, with no runtime consumer** (`:6-11`).

---

## 5. BOM Capability

There is **no persisted project BOM**. The live BOM is a **derived read model** rooted at one primary `library_products` product (`worker/boq-line-bom-api.mjs:45-77, 100-133`).

With no primary product it returns `BOM_NOT_APPLICABLE` (`app/domain/bom-component-model.mjs:150-165`) — and `BOM_NOT_APPLICABLE` is a **deferral state, not an exemption**: `buildLineCostModel` proceeds only on `BOM_READY` (`worker/boq-line-cost-api.mjs:192-211`).

**Service/labor/interface/allowance/commissioning have no BOM identity.** `product_accessories.accessory_product_id` and `product_package_components.component_product_id` are both NOT NULL.

---

## 6. Costing / Pricing Capability

- **Every authoritative price requires a library product.** `price_records.product_id NOT NULL`; lookup is `WHERE r.product_id=?` (`worker/pricing-runtime.mjs:66-101`).
- **"Manual price" is manual *product price evidence*, not a productless commercial line** — it requires `candidateId` + `productId` + matching approved technical product (`app/domain/pricing-engine.mjs:299`; `worker/pricing-api.mjs:824-849`).
- `supplier_quote_lines.product_id` **is nullable** — so productless commercial *evidence* can be stored. But the intake path adds `UNMAPPED` unless productId + mapping actor + mapping basis are all present (`app/domain/supplier-price-intake.mjs:111-125`), so it cannot reach costing.
- `calculateCostComponent` supports `Fixed | Per Item | Percentage | Hours` without a product (`app/domain/pricing-engine.mjs:93-102`) and cost components persist with `serviceSubtotal` (`worker/boq-line-cost-api.mjs:168-172, 260-266`). **But** `COST_READY` requires `materialCostComputed` (`app/domain/cost-buildup-model.mjs:82-87`) — so **service-only cost is not ready**. Service can only ride on top of material.
- `pricing_shared_costs` exists in schema but has **no live runtime path**.

**Verdict: existing non-material capability is subordinate cost composition, not an alternative commercial root.**

---

## 7. Quotation Capability

`loadCanonicalQuotationLines` iterates **every** current BOQ item and requires a canonical `pricing_lines` row, a current `Commercial Price` approval, a valid product snapshot, manufacturer, part number, and governed quantity (`worker/quotation-line-authority.mjs:28-138`).

Readiness: `blockers.length === 0 && lines.length === boqItems.length` (`:141-154`). Draft creation enforces the same all-items rule (`worker/presales-workflow-api.mjs:51-66`).

**Can quotation represent "Interface with elevator system — LS — SAR X" with no product identity? No.** Blocked at three independent layers:
1. No product-backed pricing line can exist.
2. `project_quotation_lines` requires product/candidate/manufacturer/part/pricing/commercial-approval (all NOT NULL).
3. `quotation-presenter.mjs:64-69` rejects non-numeric or non-positive quantity — and raw textual `LS` can become `null` upstream (`worker/quantity-source-decision-api.mjs:35-40`), so even the quantity needs a reviewed numeric decision.

No manual, allowance, service, or productless quotation-line concept exists. The AI quotation feature is **read-only advisory** and cannot create lines (`worker/ai-quotation-api.mjs:11-33`).

---

## 8. Existing Non-Product Mechanisms (partial, none runtime-enforced)

| Concept | Location | Status |
|---|---|---|
| `NO_PRODUCT_FAMILY` interface/elevator/HVAC/BMS gaps | `fire-alarm-taxonomy.mjs:489-518` | domain knowledge, not consumed at matching |
| Non-product scope roles | `requirement-scope-role-routing.mjs:54-65` | advisory, **no runtime consumer** |
| Pilot service/composite exclusion | `boq-understanding-pilot.mjs:92-94, 197-212` | selection-only, not a commercial exemption |
| `relationshipType: "Interface"` | `specification-extractor.mjs:313-326` | representable in requirements |
| `Not Applicable` readiness status | `technical-requirement-engine.mjs:64` | in enum, **never selected** |
| `COST_NOT_APPLICABLE` | `cost-buildup-model.mjs:74-87` | deferral ("BOM not ready"), **not** zero-cost |
| `BOM_NOT_APPLICABLE` | `bom-component-model.mjs:150-165` | deferral, **not** exemption |
| `pricing_cost_components` | schema, `boq-line-cost-api.mjs:515-522` | productless shape, product-bound parent |
| `supplier_quote_lines.product_id` nullable | `db/schema.ts:503` | storable evidence, `UNMAPPED` for costing |

**The semantic building blocks exist and are scattered. None is a runtime-enforced commercial root.**

---

## 9. Golden 12-Row Reality

The 12 rows are `unit: LS`, qty 1, system `Fire Alarm`, in three groups of 4:
- `Control and monitor element … interfacing with access doors…`
- `Control of HVAC equipment … interfacing with BMS system`
- `Signals to elevators with all required accessories`

None is priceable today: no understanding → `BOQ_UNDERSTANDING_REQUIRED` at matching; even past that, no product → `BOM_NOT_APPLICABLE` → `COST_NOT_APPLICABLE` → pricing rejected → quotation line impossible.

They remain **legitimate scope** and are correctly retained in the all-items denominator, so they block quotation readiness — a fail-closed state, not a silent drop. **That is the one thing the current architecture gets right.**

---

## 10. Architecture Options Considered

| Option | Semantics | Provenance/Audit | BOM | Pricing | Quotation | Schema | Verdict |
|---|---|---|---|---|---|---|---|
| **A** Disposition → bypass matching → dedicated service path | Correct | New table | Needs service root | Needs productless line | Needs productless line | **Large** | viable, expensive |
| **B** Disposition → non-product BOM/service line → costing | Correct | New table | Needs BOM root | `COST_READY` needs material | Needs line | **Large** | more work than A |
| **C** Disposition → manual commercial line → quotation | Weakest semantics | New table | bypassed | New productless pricing | Needs line | **Medium-Large** | inferior to A |
| **D** Existing path already supports it | — | — | ❌ | ❌ | ❌ | — | **Disproven** |

**Option A is the smallest semantically correct shape**, but it is not small: it requires a productless commercial identity through BOM, pricing, and quotation, plus a matching exemption and a workflow denominator change.

---

## 11. Selected Architecture

**Option A**, explicitly: *governed non-product disposition → matching exemption → first-class productless commercial line (service/interface/lump-sum) → pricing → quotation*, with product and non-product commercial semantics kept distinct.

This is the only option that satisfies all 10 decision criteria: it keeps BOQ scope, avoids fabricated Understanding and fake product identities, preserves functional requirements, allows governed pricing, includes the obligation in quotation, traces provenance to BOQ, lets completion terminate truthfully, keeps matching strict for real products, and separates the two commercial semantics.

**It is an architectural extension, not a patch.**

---

## 12. Implementation Ordering Decision

# → **C. One atomic slice must introduce both.**

Neither is safe alone:
- **Disposition alone (B)** creates the AIU-4F contradiction: "no product understanding needed" while commercial still demands product matching.
- **Commercial path alone (A)** builds a service/interface commercial line with no governed way to decide *which* rows qualify — and AIU-4E proved absence-of-evidence is not proof of non-product, so an unguarded path risks misclassifying real products.

The disposition and its commercial path must land together, atomically, with the matching exemption and workflow denominator change in the same slice.

---

## 13. Completion Authority Consequence

Only once downstream scope is preserved does this become truthful:

```
eligible = analysis/review debt + terminalProductReviewed + terminalNonProduct
```

- `terminalNonProduct` clears `NOT_ANALYZED` debt, produces **no** interpretation and **no** approved fact, and is **excluded** from `approvedCoverage`.
- It must **not** be added while the commercial path is missing — that is exactly the false-green AIU-4F refused to create.

---

## 14. Authorization / Capability Finding — **🟡 governance debt (systemic, not Understanding-specific)**

Verified read-only:
- Understanding review authorization is `access()`: project **owner or any active member** in the same organization (`worker/estimator-understanding-review-api.mjs:32`). There is **no role check** — pinned by `tests/estimator-understanding-review.test.mjs:343` (`assert.doesNotMatch(api, /ENGINEER_ROLES|UNDERSTANDING_REVIEW_FORBIDDEN/)`).
- System auto-approval is **narrower**: restricted to the project **owner** plus an eligibility-guarded row (`:397-414`).
- **Systemic, not specific to Understanding.** `required_role` exists in `review_queue_items` (e.g. `'Senior Technical Reviewer'` in `worker/review-workflow-api.mjs:80`) but is **advisory data, not an enforced check**. Many read APIs take `role` and merely branch for display.

**Classification: 🟡 governance debt → 🔵 broader auth slice.** It does **not** block the commercial architecture, but it is a prerequisite for trusting *who* may assign a non-product disposition.

---

## 15. Schema / Migration Implications

If Option A proceeds, schema work is **unavoidable**. Required changes:

| Change | Why existing structures cannot represent it |
|---|---|
| **New append-only applicability-disposition table** | `estimator_understanding_review_versions` requires `interpretation_id NOT NULL REFERENCES estimator_item_interpretations(id)` and `canonical_interpretation NOT NULL` — a never-analyzed row cannot hold a review version |
| **`pricing_lines` product identity relaxable** | `product_id`, `candidate_id`, `safety_decision_id` all NOT NULL (verified live) |
| **`project_quotation_lines` product identity relaxable** | `product_id`, `candidate_id`, `manufacturer_name`, `part_number`, `pricing_line_id`, `commercial_approval_id` all NOT NULL (verified live) |
| **Workflow denominator / matching exemption** | `matchesReady/technicalReady/pricingReady` all compare against total `boqItems` (`app/domain/presales-workflow-engine.mjs:20`) |

**Migration risk is currently high:** the working tree carries ~578 changed files, and the Drizzle journal is stale with no wired migration runner (`scripts/apply-0080-onboarding-d-contact-title.mjs:6-17`). **Implementation should wait for tree stabilization** and an explicitly authorized migration plan.

No schema was edited.

---

## 16. Smallest Sufficient Next Slice

**AIU-4H — Governed Non-Product Commercial Path (atomic, Option A).**

It is the smallest sufficient unit because, per §12, the disposition and its commercial path cannot be safely separated. It must deliver, as one reviewed change:
1. the governed non-product disposition (append-only, attributable, reversible);
2. the matching exemption for dispositioned rows;
3. a productless commercial line path through pricing to quotation;
4. the workflow denominator change;
5. completion-authority integration (`terminalNonProduct`) **last**, once scope is preserved.

**It must not start until (a) the migration plan is authorized, and (b) the capability/auth slice defines who may assign a non-product disposition.** AIU-4F and AIU-4D remain blocked until AIU-4H lands.

**Not implemented.**

---

## 17. What Was Changed

**Nothing.**

This was a read-only architecture and domain decision. No source, schema, migration, test, or configuration was modified. No AI run, no review, no auto-approval. No commit, push, deploy, or restart.

### Golden state verification — partially blocked, reported honestly

- At the **start** of AIU-4G, the Golden D1 was read successfully: 108 BOQ rows, 82 eligible, 26 interpretations, **0 review versions, 0 review events**, 2 runs.
- During this read-only investigation the database file's mtime advanced to `Sep 24 23:14` and subsequent read-only opens began failing with `unable to open database file (14)` — a **transient lock held by a concurrent writer**, not a change made by this task. All AIU-4G access used `sqlite3 -readonly` and a `{ readOnly: true }` shim that refuses `run()`/`batch()`.
- A final re-check confirmed `interp = 26` (unchanged). The review-version/event/run counts could **not** be re-read at the moment of reporting due to that lock, so their post-task values are **unverified by me** rather than asserted.
- **Implication for §15:** the Golden D1 is being actively written by another process during this session. This is direct, current evidence that migration and implementation work in this tree must wait for stabilization — reinforcing, not weakening, the §16 recommendation.

**STOP.**
