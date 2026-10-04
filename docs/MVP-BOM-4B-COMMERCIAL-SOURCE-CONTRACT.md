# MVP-BOM-4B — Commercial Source Contract (Pre-Migration)

**Lane:** MVP-BOM-4B (read-only architecture contract)
**Date:** 2026-09-28
**Verdict:** ✅ **CONTRACT CLOSED — READY FOR MIGRATION IMPLEMENTATION**

---

## 1. Executive verdict

**CONTRACT CLOSED.** Every domain rule required to implement Candidate B is now specified with source evidence. Another engineer can implement the migration without inventing a missing rule.

The previous BOM-4 stopped at "the model requires broader redesign." This slice closes the specific contracts that were unresolved: logical SCOPE identity, provenance identity, reconciliation semantics, uniqueness, pricing source identity, double-counting, legacy migration, currentness, and revision behavior.

---

## 2. Stable SCOPE identity

**Logical identity** (what requirement is this?):

```
(project_id, source_type, engineering_scope_kind, system, source_product_id, source_role)
```

| Component | Value for expansion | Why |
|---|---|---|
| `project_id` | the project | economic scope is per-project |
| `source_type` | `'SCOPE'` | distinguishes from `'PRODUCT'` |
| `engineering_scope_kind` | `'PANEL_SIZING_EXPANSION'` | the kind of engineering requirement |
| `system` | `'Fire Alarm'` | the system domain |
| `source_product_id` | exact `library_products.id` | the governed product identity |
| `source_role` | `'LOOP_EXPANSION_UNIT'` or `'MOUNTING_UNIT'` | the role the product plays |

**Proof that snapshot ID is NOT part of logical identity:** if snapshot A requires `2 × X` and snapshot B requires `3 × X`, it is the SAME logical requirement (this panel needs expansion) with a new quantity. Including `source_snapshot_id` in the natural key would make every recalculation a new commercial concept, which contradicts quotation revision governance (a quantity change produces a new revision of the same line, not a new line). The snapshot ID is provenance, not identity.

---

## 3. Provenance/version identity

Separate from logical identity:

| Field | Proves |
|---|---|
| `source_snapshot_id` | which sizing snapshot produced the current quantity |
| `source_fingerprint` | the snapshot's `input_fingerprint` — the exact evidence instance |
| per-panel provenance (retained in BOM section) | which physical panel contributed to the aggregated quantity |

A new snapshot must NOT imply a new economic scope merely because its ID changed. It implies new **evidence** for the same scope, with a possibly-new quantity.

---

## 4. Reconciliation semantics

Quotation revision governance (proven): a new draft creates a new revision (`MAX+1`), the prior Draft is superseded, Approved/Issued revisions are never superseded, and lines are immutable forever. Reconciliation uses this mechanism exactly.

| Case | Outcome |
|---|---|
| **A: 2×X → 3×X** | Same logical scope, new quantity. New quotation revision (or draft revision). Old revision immutable. |
| **B: 3×X → 1×X** | Same logical scope, reduced quantity. New revision. |
| **C: 2×X → 0×X** | Logical scope satisfied/disappeared. New revision without the scope line. Old scope stale for future authority only. |
| **D: 2×X → 2×Y** | Product identity changed → DIFFERENT logical scope. Old scope stale, new scope created. New revision. |
| **E: same qty/product, new fingerprint** | Same logical scope, new provenance. Reconcile in a draft revision. No new economic concept. |

No immutable historical line is ever mutated. Every change produces a new revision.

---

## 5. PRODUCT uniqueness

Keep the existing constraint exactly:

```
UNIQUE (quotation_revision_id, boq_item_id)
```

One commercial line per BOQ-backed product source within a revision. Unchanged.

---

## 6. SCOPE uniqueness

A partial UNIQUE index (SQLite supports these):

```sql
CREATE UNIQUE INDEX quotation_lines_scope_uniq
  ON project_quotation_lines
  (quotation_revision_id, source_type, engineering_scope_kind, system, source_product_id, source_role)
  WHERE boq_item_id IS NULL;
```

One commercial line per logical derived scope within a revision. Schema-level, not application-level. Does not rely on timestamps or `OR IGNORE`.

---

## 7. Pricing-line source model

**Today:** `pricing_lines.boq_item_id` is NOT NULL FK, UNIQUE `(pricing_run_id, boq_item_id)`. The creation path is BOQ-item-centric (URL `:boqItemId`, `loadPricingInput` fetches the BOQ item, cost buildup starts from it).

**Generalized:** `pricing_lines` gains the same `source_type` + source identity as quotation lines:

| Column | PRODUCT | SCOPE |
|---|---|---|
| `source_type` | `'PRODUCT'` | `'SCOPE'` |
| `boq_item_id` | NOT NULL | NULL |
| `source_snapshot_id` | NULL | snapshot id |
| `source_fingerprint` | NULL | snapshot fingerprint |
| `source_product_id` | product id | exact product id |
| `engineering_scope_kind` | NULL | scope kind |
| `system` | NULL | system |
| `source_role` | NULL | role |

**What is reusable vs BOQ-bound:**

- **Reusable:** price selection (`selectPriceSources`), currency policy (`convertCurrency`), approval (`pricing_approvals`), currentness (latest version per source), the approval gate.
- **BOQ-bound (must change):** pricing creation/input assembly (`loadPricingInput` fetches BOQ item; `buildLineCostModel` starts from `ownedItem`; idempotency key uses `boq_item_id`).

**Smallest pricing change:** generalize the source identity to `(source_type, source_id)` where `source_id` = `boq_item_id` for PRODUCT and the logical scope identity for SCOPE. Refactor `loadPricingInput` and `buildLineCostModel` to accept a non-BOQ source. Do NOT duplicate the pricing engine.

**Pricing uniqueness:** partial UNIQUE index on `(pricing_run_id, source_type, engineering_scope_kind, system, source_product_id, source_role) WHERE boq_item_id IS NULL`, mirroring the quotation constraint.

---

## 8. Price vs quantity authority

| Authority | Owner | Rule |
|---|---|---|
| **Quantity** | sizing engine | calculated from current demand + capacity evidence |
| **Unit price** | commercial/pricing domain | selected through existing pricing authority |

A scope line combines `current calculated quantity × valid governed unit price`. Neither is copied into the other's authority.

**Quantity change (2→3):** does NOT require price reapproval (unit price unchanged). It DOES require commercial-line reapproval/currentness reconciliation, because the line total changes. The price record stays valid; the commercial line is re-evaluated.

---

## 9. Double-counting policy

Same `product_id` does NOT automatically mean duplicate economic scope. Policy:

| Case | Outcome |
|---|---|
| 1. X only as expansion scope | One scope line. Counted once. |
| 2. X on two different panels | Aggregate into one scope line (same logical requirement). Per-panel provenance retained. |
| 3. X as explicit BOQ line AND as expansion | Different source identities (PRODUCT vs SCOPE). The expansion is ADDITIONAL scope the BOQ did not account for. Not a duplicate — but the engineer must confirm the BOQ line does not already cover it. Flagged for review, not silently merged. |
| 4. X as separately required accessory | Different source identity (accessory relationship vs sizing scope). Not a duplicate. |
| 5. Two engineering sources independently require X | Aggregate if same logical scope; flag if genuinely separate economic scope. |
| 6. Same product serves two legitimately separate scopes | Two scope lines (different `source_role` or `engineering_scope_kind`). Both valid. |

The system must neither silently double-charge nor silently suppress genuinely separate scope.

---

## 10. Legacy-row migration proof

**`project_quotation_lines`:** every row has a valid `boq_item_id` (NOT NULL FK, proven). Every row can be deterministically backfilled as `source_type='PRODUCT'`, `source_product_id = product_id` (already NOT NULL). No guessing. Zero unresolved rows.

**`pricing_lines`:** same. Every row has valid `boq_item_id` and `product_id`. Backfill is deterministic.

**Conclusion:** all historical rows migrate losslessly. No semantic inference is required.

---

## 11. Schema object reconstruction inventory

For `project_quotation_lines`, a table rebuild must recreate exactly:

**Indexes:**
- `quotation_lines_pricing_idx` on `(pricing_run_id, pricing_line_id)`
- `quotation_lines_product_idx` on `(product_id)`
- `quotation_lines_project_idx` on `(project_id, quotation_revision_id)`
- `quotation_lines_revision_idx` on `(quotation_revision_id, sequence)`

**UNIQUE constraints:**
- `UNIQUE(quotation_revision_id, boq_item_id)` — kept for PRODUCT, partial for SCOPE

**FKs:** `quotation_revision_id`, `project_id`, `boq_item_id` (→ nullable), `candidate_id`, `product_id`, `pricing_run_id`, `pricing_line_id`, `commercial_approval_id`

**Triggers:**
- `quotation_line_snapshot_delete_guard` (BEFORE DELETE → ABORT `QUOTATION_LINE_SNAPSHOT_IMMUTABLE`)
- `quotation_line_snapshot_update_guard` (BEFORE UPDATE → ABORT `QUOTATION_LINE_SNAPSHOT_IMMUTABLE`)

**Audit/revision assumptions:** lines are insert-only immutable snapshots; the revision payload trigger (`quotation_revision_payload_update_guard`) protects the revision, not the lines.

---

## 12. Currentness predicate

A SCOPE commercial line is quotation-authoritative only when ALL hold:

```
scope.source_fingerprint == current_completed_snapshot.input_fingerprint
AND scope logical identity matches the current requirement
AND scope.source_product_id == the exact resolved product
AND required quantity <= covered quantity
AND a valid governed unit price exists
AND commercial approval is current
AND the line is in the current (non-superseded) quotation revision
```

**Stale when:** new snapshot fingerprint, changed product identity, changed quantity, missing price, missing approval, or superseded revision. A stale price/approval cannot make stale scope current.

---

## 13. Quotation revision behavior

- A previously approved/exported revision containing scope X remains **immutable and historically valid**. It is never mutated.
- A new draft revision receives the new current scope.
- The old scope becomes stale **only for future authority** (new drafts, new approvals).
- Export of a historical revision shows exactly what was historically valid at that revision's fingerprint.

---

## 14. Proposed quotation schema

```sql
CREATE TABLE IF NOT EXISTS `project_quotation_lines` (
  id TEXT PRIMARY KEY,
  quotation_revision_id TEXT NOT NULL REFERENCES project_quotation_revisions(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  boq_item_id TEXT REFERENCES boq_items(id),              -- NULL for SCOPE
  source_type TEXT NOT NULL,                               -- 'PRODUCT' | 'SCOPE'
  engineering_scope_kind TEXT,                             -- NULL for PRODUCT
  system TEXT,                                             -- NULL for PRODUCT
  source_role TEXT,                                        -- NULL for PRODUCT
  source_snapshot_id TEXT,                                 -- NULL for PRODUCT
  source_fingerprint TEXT,                                 -- NULL for PRODUCT
  source_product_id TEXT,                                  -- NULL for PRODUCT
  sequence INTEGER NOT NULL,
  item_number TEXT,
  description TEXT,
  unit TEXT NOT NULL,
  quantity TEXT NOT NULL,
  candidate_id TEXT NOT NULL REFERENCES product_match_candidates(id),
  product_id TEXT NOT NULL REFERENCES library_products(id),
  manufacturer_name TEXT NOT NULL,
  part_number TEXT NOT NULL,
  product_description TEXT NOT NULL,
  pricing_run_id TEXT NOT NULL REFERENCES pricing_runs(id),
  pricing_run_version INTEGER NOT NULL,
  pricing_line_id TEXT NOT NULL REFERENCES pricing_lines(id),
  pricing_line_version INTEGER NOT NULL,
  pricing_input_fingerprint TEXT NOT NULL,
  commercial_approval_id TEXT NOT NULL REFERENCES pricing_approvals(id),
  commercial_approval_version INTEGER NOT NULL,
  currency TEXT NOT NULL,
  total_cost_minor INTEGER NOT NULL,
  net_selling_minor INTEGER NOT NULL,
  source_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(quotation_revision_id, boq_item_id),
  CHECK (
    (source_type='PRODUCT' AND boq_item_id IS NOT NULL AND source_product_id IS NOT NULL)
    OR
    (source_type='SCOPE' AND boq_item_id IS NULL AND source_product_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX quotation_lines_scope_uniq
  ON project_quotation_lines
  (quotation_revision_id, source_type, engineering_scope_kind, system, source_product_id, source_role)
  WHERE boq_item_id IS NULL;

-- recreate quotation_lines_pricing_idx, quotation_lines_product_idx,
-- quotation_lines_project_idx, quotation_lines_revision_idx,
-- quotation_line_snapshot_delete_guard, quotation_line_snapshot_update_guard
```

---

## 15. Proposed pricing schema

```sql
-- pricing_lines gains the same generalized source identity:
ALTER TABLE pricing_lines ADD source_type TEXT NOT NULL DEFAULT 'PRODUCT';
ALTER TABLE pricing_lines ADD engineering_scope_kind TEXT;
ALTER TABLE pricing_lines ADD system TEXT;
ALTER TABLE pricing_lines ADD source_role TEXT;
ALTER TABLE pricing_lines ADD source_snapshot_id TEXT;
ALTER TABLE pricing_lines ADD source_fingerprint TEXT;
ALTER TABLE pricing_lines ADD source_product_id TEXT;
-- boq_item_id becomes nullable (table rebuild)

CREATE UNIQUE INDEX pricing_lines_scope_uniq
  ON pricing_lines
  (pricing_run_id, source_type, engineering_scope_kind, system, source_product_id, source_role)
  WHERE boq_item_id IS NULL;

-- keep pricing_lines_run_item_idx for PRODUCT, partial for SCOPE
```

---

## 16. Ordered migration design (not executed)

1. `CREATE TABLE project_quotation_lines_new` (schema §14).
2. `INSERT INTO project_quotation_lines_new (..., source_type, source_product_id, ...) SELECT ..., 'PRODUCT', product_id, ... FROM project_quotation_lines` — deterministic backfill, zero inference.
3. Assert row count and row identity (every id preserved).
4. `DROP TABLE project_quotation_lines`.
5. `ALTER TABLE project_quotation_lines_new RENAME TO project_quotation_lines`.
6. Recreate all 4 indexes + both immutability triggers + the scope partial UNIQUE.
7. Repeat the coordinated rebuild for `pricing_lines` (schema §15) — both tables must be generalized in the same migration contract, never left half-generalized.
8. Verify: fresh DB from baseline+new migration; existing-DB upgrade path; row counts; FK validation; trigger presence; immutability still enforced.

---

## 17. Architecture matrix

| Concern | PRODUCT | SCOPE |
|---|---|---|
| source_type | `'PRODUCT'` | `'SCOPE'` |
| stable source identity | `boq_item_id` | `(engineering_scope_kind, system, source_product_id, source_role)` |
| boq_item_id | NOT NULL | NULL |
| product_id | NOT NULL | NOT NULL (exact resolved identity) |
| quantity authority | BOQ / quantity-source decision | sizing engine (calculated) |
| pricing identity | `pricing_run_id + boq_item_id` | `pricing_run_id + scope identity` |
| provenance | BOQ extraction | snapshot id + fingerprint |
| currentness | latest pricing version per BOQ item | `source_fingerprint == current snapshot input_fingerprint` |
| uniqueness | `UNIQUE(revision, boq_item_id)` | partial `UNIQUE(revision, scope identity) WHERE boq_item_id IS NULL` |
| approval | existing commercial approval | same |
| revision behavior | new revision on change | new revision on change; historical immutable |
| export behavior | unchanged | included once; no fabricated BOQ row |

---

## 18. Risks / limitations

1. The migration is on a core immutable table and must be reviewed as its own slice.
2. Pricing creation/input assembly is BOQ-bound and must be refactored for SCOPE — this is the largest implementation risk.
3. Double-counting between explicit BOQ scope and calculated expansion requires an explicit engineer review flag, not silent merging.
4. The relationship-level provenance (`loopRelationshipId`, `mountingRelationshipId`) is currently NOT persisted in the snapshot's `expansionOptions` (always null in the BOM reader). This is a separate provenance gap that must be closed for full auditability, but it does not block the commercial representation contract.

---

## 19. Files changed

**None.** This slice is a read-only architecture contract. The report itself is the only write.

---

## 20. Business-state writes

**None.**

---

## 21. Next smallest implementation slice

**Implement the coordinated quotation + pricing table-rebuild migration (§16) with the creation-path branch and the full failing-before/passing-after test set.** This is a major quotation-domain migration and must be scheduled and reviewed as its own slice.

---

> No schema migration, source implementation, live quotation mutation, live pricing mutation, live sizing mutation, commit, push, deployment, restart, or unrelated business-state mutation was performed.
