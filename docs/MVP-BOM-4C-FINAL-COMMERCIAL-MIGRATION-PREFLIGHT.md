# MVP-BOM-4C — Final Commercial Migration Preflight

**Lane:** MVP-BOM-4C (read-only preflight)
**Date:** 2026-09-28
**Verdict:** 🔴 **BLOCKED — CANDIDATE AUTHORITY UNRESOLVED** (with a second blocking defect: a broken `superseded_at` query)

---

## 1. Executive verdict

**BLOCKED — CANDIDATE AUTHORITY UNRESOLVED.**

Both preflight questions are now answered from source, and the answer to the first is a hard blocker:

1. **Can a SCOPE quotation line legally exist without a `product_match_candidate`?** **No — not under the current schema.** `project_quotation_lines.candidate_id` is `NOT NULL REFERENCES product_match_candidates(id)`. A SCOPE line has no matching candidate (its product identity comes from engineering/sizing authority, not matching). Creating a fake candidate is explicitly forbidden. Therefore `candidate_id` **must** become nullable for SCOPE, with a CHECK constraint.

2. **What must be preserved/generalized on `pricing_lines`?** Complete inventory in §7. The rebuild must preserve: 26 columns, 7 FKs, 1 UNIQUE index, 0 triggers, 0 CHECKs — and add the generalized source identity.

**Second blocking defect (new, must be fixed before migration):** `worker/quotation-line-authority.mjs:145` queries `pricing_lines ... AND superseded_at IS NULL`, but **`pricing_lines` has no `superseded_at` column** (verified: 0 occurrences in the DDL). The expansion coverage check throws `no such column: superseded_at` at runtime. This is a latent defect in MVP-BOM-2 that must be repaired before the table rebuild.

---

## 2. Candidate semantics

**What `candidate_id` proves:** matching-decision provenance — it links a commercial line to the `product_match_candidates` row that selected the product for a BOQ item.

**Is it product identity authority?** **No.** Product identity authority is `product_id` (FK to `library_products`). `candidate_id` is traceability to *how* a BOQ product was selected.

**Is it matching-decision provenance?** **Yes.** It records which matching candidate was chosen.

**Is it merely traceability?** **Yes, for PRODUCT lines.** No authority gate reads `candidate_id` as a precondition. The gates read `product_id`, `safety_decision_id`, `pricing_run_id`, `commercial_approval_id`.

**Which readers use it?** `loadPricingInput` (fetches candidate + match run + product), `pricing-authority.mjs` (reads candidateId for approval linkage), `presales-workflow-api.mjs` (INSERT), `quotation-line-authority.mjs` (line object). All are creation/path reads, not authority gates.

**Which authority gates require it?** **None.** No gate rejects a line because `candidate_id` is null.

**Does export use it?** **No.** Governed export reads quotation lines directly; `boq_item_id` appears only in the fingerprint input (a null serializes as `null` without breaking).

**Does pricing require it?** **At creation, yes** (`loadPricingInput` fetches the candidate). **As an authority gate, no.**

**Does approval require it?** **No.** Approval reads `commercial_approval_id` and `pricing_run_id`.

**Can a line be valid with authoritative `product_id` but no candidate?** **Semantically yes** — the product is authoritative through sizing/engineering authority. **Schema no** — `candidate_id` is NOT NULL.

---

## 3. SCOPE product authority

**Source chain (verified):**
```
product_accessories (relationship_type='Expansion Module', Approved, current)
  → library_products.id (identity_status='Active')
  → loadExpansionPath resolves panel → mounting → loop
  → calculateSlcExpansion computes the quantity
  → snapshot persists calculation_json with expansionOptions.{loopExpansionUnit,mountingUnit}.productId
  → BOM CALCULATED_REQUIREMENT (worker/boq-line-bom-api.mjs)
```

**Is this equivalent to matching-candidate authority?** **Fundamentally different.** Matching-candidate authority is BOQ-item → matching run → candidate → selected product. SCOPE authority is engineering relationship → sizing expansion resolution → canonical product identity → calculated requirement. Different source, different authority path, different provenance.

**The system must not create a fake matching candidate.** The product is authoritative through sizing; representing that truth directly (nullable `candidate_id`, `source_product_id` authoritative) is the correct model.

---

## 4. Candidate contract

### Candidate Contract B — `candidate_id` nullable for SCOPE

| source_type | `candidate_id` | product authority |
|---|---|---|
| `PRODUCT` | NOT NULL FK | `product_id` (from matching candidate) |
| `SCOPE` | NULL | `source_product_id` (from sizing/engineering authority) |

**CHECK constraint:**
```sql
CHECK (
  (source_type='PRODUCT' AND candidate_id IS NOT NULL AND boq_item_id IS NOT NULL)
  OR
  (source_type='SCOPE' AND candidate_id IS NULL AND boq_item_id IS NULL AND source_product_id IS NOT NULL)
)
```

**Why not Contract A (candidate remains mandatory):** no governed product candidate naturally exists for SCOPE. Fabricating one is forbidden.

**Why not Contract C (replace with generalized selection authority):** no existing abstraction supports this without broad redesign. Contract B is the smallest correct change.

---

## 5. `source_product_id` vs `product_id`

| Field | Meaning |
|---|---|
| `source_product_id` | the product **engineering says** this derived requirement requires |
| `product_id` | the product **commercially selected** for quotation |

**For current panel-expansion behavior, must they be equal?** **Yes.** The sizing engine resolved the exact product; no commercial substitution is authorized without a governed process that does not exist.

**If substitution is prohibited:** enforce equality via CHECK (`source_type='SCOPE' AND source_product_id = product_id`).

**If substitution is permitted:** it requires a governed substitution authority (not invented here). It would **not** change logical SCOPE identity (which is defined by `source_product_id`), but it would change which product is quoted. No such authority exists, so substitution is prohibited.

---

## 6. Final quotation PRODUCT/SCOPE CHECK rules

```sql
-- PRODUCT
(source_type = 'PRODUCT' AND boq_item_id IS NOT NULL
 AND candidate_id IS NOT NULL AND product_id IS NOT NULL)

-- SCOPE
(source_type = 'SCOPE' AND boq_item_id IS NULL AND candidate_id IS NULL
 AND source_product_id IS NOT NULL AND product_id IS NOT NULL
 AND source_product_id = product_id
 AND engineering_scope_kind IS NOT NULL AND system IS NOT NULL
 AND source_role IS NOT NULL AND source_snapshot_id IS NOT NULL
 AND source_fingerprint IS NOT NULL)
```

---

## 7. Current `pricing_lines` schema inventory

**DDL** (`drizzle-active/0000_baseline_schema_0082.sql:3362-3400`): 26 columns — `id, pricing_run_id, project_id, boq_item_id, candidate_id, product_id, safety_decision_id, selected_price_record_id, version_number, status, quantity, unit, source_currency, project_currency, original_list_price_minor, net_material_unit_minor, material_total_minor, direct_cost_minor, total_cost_minor, gross_selling_minor, customer_discount_minor, net_selling_minor, vat_minor, final_value_minor, margin_basis_points, markup_basis_points, output, explanation, approval_ready, created_at`.

**NOT NULL:** all except `selected_price_record_id`, `source_currency`.

**FKs (7):** `pricing_run_id`→`pricing_runs(id)`, `project_id`→`projects(id)`, `boq_item_id`→`boq_items(id)`, `candidate_id`→`product_match_candidates(id)`, `product_id`→`library_products(id)`, `safety_decision_id`→`safety_decisions(id)`, `selected_price_record_id`→`price_records(id)`.

**UNIQUE:** `pricing_lines_run_item_idx` on `(pricing_run_id, boq_item_id)`.

**CHECKs:** none.

**Triggers:** none.

**Referenced by (FK → pricing_lines.id):** `pricing_cost_components.pricing_line_id`, `pricing_cost_allocations.pricing_line_id`, `pricing_discount_applications.pricing_line_id`, `pricing_audit_events.pricing_line_id`.

**Creation route:** `worker/pricing-runtime.mjs:287` INSERT, `boq_item_id` bound from the `:boqItemId` URL parameter.

**Update/version route:** `persistRun` idempotency at `:243` uses `(scenario_id, boq_item_id, input_fingerprint)`; a new version is a new row.

**Approval relationship:** `pricing_approvals` (approval_type='Commercial Price', status='Approved', entity_version matched to `pricing_runs.version_number`).

**Currentness/version rules:** `CURRENT_PRICING_PREDICATE` (`pricing-authority.mjs`) — latest version per BOQ item per scenario with `approval_ready=1` and valid status.

---

## 8. Pricing BOQ-dependency inventory

| Dependency | Classification |
|---|---|
| `boq_item_id` in INSERT | creation-only |
| `boq_item_id` in idempotency key | creation-only |
| `loadPricingInput` fetching BOQ item | BOQ-bound (must change for SCOPE) |
| `buildLineCostModel` starting from `ownedItem` | BOQ-bound (must change for SCOPE) |
| `currentBoqEvidenceFrom` / `currentBoqEligibleForEngineeringPredicate` | PRODUCT-only input |
| `selectPriceSources` (price_records by product_id) | **reusable** for SCOPE |
| `convertCurrency` | **reusable** |
| `pricing_approvals` | **reusable** |
| `CURRENT_PRICING_PREDICATE` | must be generalized to source identity |

---

## 9. Generalized pricing input

For SCOPE, the input must come from sizing, not BOQ:

| Field | SOURCE for SCOPE |
|---|---|
| `project_id` | project |
| `product_id` | exact resolved product from snapshot |
| `quantity` | calculated quantity from sizing |
| `unit` | from product/calculation |
| `manufacturer` | from product |
| `part_number` | from product |
| `description` | from sizing requirement |
| supplier price candidates | `price_records` by `product_id` (reusable) |
| currency | project currency (reusable) |
| `boq_item_id` | NULL |
| `candidate_id` | NULL |
| `safety_decision_id` | NULL (or a sizing-derived safety reference) |
| `requirement_profile_version_id` | NULL |
| `match_run_id` | NULL |

---

## 10. Cost buildup generalization

`buildLineCostModel` (`boq-line-cost-model.mjs`) starts from `ownedItem` (BOQ item). For SCOPE there is no BOQ item.

**Smallest change:** introduce a normalized pricing input contract `(product_id, quantity, unit, manufacturer, part_number, description, currency)` and refactor `buildLineCostModel` to accept it. Do NOT duplicate the pricing engine. Do NOT create `buildLineCostModelForScope` unless a proven semantic reason exists.

---

## 11. Pricing identity / versioning

1. **Does changing quantity create a new pricing line version?** Yes — the idempotency key includes `input_fingerprint`, which includes quantity. A new quantity produces a new row (new version).
2. **Does unchanged unit price remain approved?** Yes — the price record is unchanged; only the commercial line total changes.
3. **Does a new source fingerprint make pricing stale?** It makes **commercial coverage** stale, not product/unit-price authority. The unit price stays valid; the commercial line must be re-evaluated.
4. **What does `pricing_input_fingerprint` contain today?** The pricing input: product, quantity, unit, price source, currency. For SCOPE it must additionally include sizing provenance (snapshot id + fingerprint).

---

## 12. Full pricing reconstruction checklist

**Table:** `pricing_lines` — 26 columns, 7 FKs, 1 UNIQUE index, 0 triggers, 0 CHECKs.

**Indexes:** `pricing_lines_candidate_idx (candidate_id, created_at)`, `pricing_lines_project_status_idx (project_id, status)`, `pricing_lines_run_item_idx UNIQUE (pricing_run_id, boq_item_id)`.

**FKs:** `pricing_run_id`, `project_id`, `boq_item_id` (→nullable), `candidate_id`, `product_id`, `safety_decision_id`, `selected_price_record_id`.

**Triggers:** none.

**Versioning constraints:** `pricing_lines_run_item_idx` UNIQUE — must become partial for SCOPE.

**Approval dependencies:** `pricing_approvals` (Commercial Price, Approved, entity_version).

**Recreated schema objects:** all 26 columns, 7 FKs, 3 indexes (1 UNIQUE), 0 triggers, plus new source identity columns + partial SCOPE UNIQUE + CHECK.

---

## 13. Legacy pricing backfill proof

Every existing `pricing_lines` row has valid `boq_item_id` (NOT NULL FK) and `product_id` (NOT NULL FK). Backfill: `source_type='PRODUCT'`, `source_product_id=product_id`, SCOPE fields NULL. **Row count: all. Valid backfill: all. Unresolved: 0.**

---

## 14. Coordinated migration dependency order

`project_quotation_lines.pricing_line_id` references `pricing_lines.id`. Therefore:

1. **Rebuild `pricing_lines` FIRST** (new table with same ids, generalized source identity).
2. **Then rebuild `project_quotation_lines`** (same `pricing_line_id` values, generalized source identity).

This preserves the FK `pricing_line_id → pricing_lines.id`. Both rebuilds form **one coordinated migration contract** — never leave one table generalized and the other BOQ-only.

**SQLite procedure:** the project uses a table-rebuild pattern (create new, copy, drop old, rename) inside a transaction, as seen in `fire-alarm-panel-sizing-api.mjs` and `boq-extraction-api.mjs`. Foreign keys are disabled during the rebuild and re-enabled after, with `PRAGMA foreign_key_check` validation.

---

## 15. Updated architecture matrix

| Concern | PRODUCT | SCOPE |
|---|---|---|
| source_type | `'PRODUCT'` | `'SCOPE'` |
| stable source identity | `boq_item_id` | `(engineering_scope_kind, system, source_product_id, source_role)` |
| boq_item_id | NOT NULL | NULL |
| candidate_id | NOT NULL | NULL |
| source_product_id | = product_id | = product_id (engineering-required) |
| commercial product_id | `product_id` | `product_id` |
| substitution allowed? | via matching | prohibited (CHECK enforces equality) |
| pricing input source | BOQ item + candidate | sizing snapshot + resolved product |
| pricing fingerprint | product/qty/unit/price/currency | + sizing provenance |
| pricing approval effect of qty change | new version, price stays approved | same |
| candidate authority | matching candidate | engineering/sizing authority |

---

## 16. Remaining risks

1. **The `superseded_at` query defect** (`quotation-line-authority.mjs:145`) must be fixed before or during the migration — the expansion coverage check currently throws.
2. **Pricing creation/input assembly** is BOQ-bound and must be refactored for SCOPE — the largest implementation risk.
3. **Relationship-level provenance** is not persisted in the snapshot's `expansionOptions` (always null) — a separate gap to close for full auditability.
4. **Double-counting** between explicit BOQ scope and calculated expansion requires an explicit engineer review flag.

---

## 17. Files changed

**None.** This slice is a read-only preflight. The report itself is the only write.

---

## 18. Business-state writes

**None.**

---

## 19. Next implementation slice

**Fix the `superseded_at` query defect, then implement the coordinated `pricing_lines` + `project_quotation_lines` table-rebuild migration with the generalized source identity, creation-path branch, and the full failing-before/passing-after test set.** This is a major quotation-domain migration and must be scheduled and reviewed as its own slice.

---

> No schema migration, source implementation, candidate creation, quotation mutation, pricing mutation, live sizing mutation, commit, push, deployment, restart, or unrelated business-state mutation was performed.
