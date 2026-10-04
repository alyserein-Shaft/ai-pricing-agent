# MVP-BOM-3 — Governed Commercial Representation for Sizing-Derived Scope Lines

**Lane:** MVP-BOM-3 (architecture decision + representation proof)
**Date:** 2026-09-28
**Verdict:** 🔴 **BLOCKED — EXISTING MODEL REQUIRES BROADER REFACTOR**

---

## 1. Executive verdict

**BLOCKED — EXISTING MODEL REQUIRES BROADER REFACTOR.**

The representation problem is now fully proven from source. The smallest correct commercial representation is **Candidate B: generalize the existing commercial line** with a `source_type` discriminator, a nullable `boq_item_id`, and provenance. However, that model requires a **table-rebuild migration on `project_quotation_lines`** — a core, immutable quotation table — plus a change to the quotation **creation path**. That is a major quotation-domain redesign.

Per the task's explicit stop condition ("If the smallest correct solution turns out to require major quotation-domain redesign, STOP and report that boundary instead of implementing an uncontrolled architecture expansion"), this slice **reports the boundary and the concrete minimal design. It does not implement the broader model.**

What IS proven and in place (from MVP-BOM-2): the exact expansion product identity, calculated quantity, and full provenance reach the governed BOM flow as a `CALCULATED_REQUIREMENT`. What is missing is only the **commercial-line representation**, and that gap is a schema contract, not a code defect.

---

## 2. Architecture decision

### Chosen model: Candidate B — generalize the existing commercial line

Add to `project_quotation_lines` (and the pricing-line source abstraction):

| Column | Purpose |
|---|---|
| `source_type TEXT NOT NULL` | `'PRODUCT'` (BOQ-backed) or `'SCOPE'` (sizing-derived) |
| `boq_item_id` | **nullable** — NOT NULL only when `source_type='PRODUCT'` |
| `source_snapshot_id TEXT` | originating sizing snapshot id (provenance) |
| `source_fingerprint TEXT` | snapshot input fingerprint (currentness) |
| `source_product_id TEXT` | exact resolved product identity (never part-number text) |

Plus a table CHECK constraint:
```
(source_type='PRODUCT' AND boq_item_id IS NOT NULL AND source_product_id IS NOT NULL)
OR
(source_type='SCOPE' AND boq_item_id IS NULL AND source_product_id IS NOT NULL)
```

### Rejected alternatives

- **Candidate A — new `commercial_scope_lines` table.** Larger: a parallel table, a parallel FK, a parallel read path, and a second source of truth for "what is in this quotation." The existing read/export/UI/totals paths already work without `boq_item_id`, so a new table buys separation at the cost of duplication.
- **Candidate C — upstream BOM/scope entity.** The BOM read model is also BOQ-item-centric (`buildLineBomModel` iterates BOQ items). Representing expansion upstream would just move the same gap one layer earlier.

### Why Candidate B is the smallest correct solution

Every read, export, UI and totals consumer already works **without** `boq_item_id` (proven by Subagent C). The only things that require it are the DB constraint and the creation path. Generalizing the existing line reuses all of: pricing authority, approval authority, quotation eligibility, export, totals, and currentness. It changes only the constraint and the creation path.

---

## 3. Previous representation defect

Sizing resolves the expansion chain to a canonical product identity (`panels[].expansionOptions.loopExpansionUnit.productId` and `.mountingUnit.productId`) and a calculated quantity. The snapshot persists both in `calculation_json`. But:

- `sizeProjectSlcPanels` (`fire-alarm-panel-slc-sizing.mjs:41-47`) aggregates only `requiredExpansionQuantity` and `mountingUnitQuantity` — **numbers**.
- The BOM read model (`boq-line-bom-api.mjs`) is BOQ-item-centric and had no expansion path.
- The quotation gate (`quotation-line-authority.mjs:106-108`) asked only whether the number was greater than zero.

So the identity was resolved, persisted in the snapshot, and then **invisible to every commercial consumer**. MVP-BOM-2 closed the BOM half of this (the identity now reaches the BOM as `CALCULATED_REQUIREMENT`). The remaining gap is the commercial-line representation.

---

## 4. New representation path (the design, not implemented)

```
sizing (worker/fire-alarm-panel-sizing-api.mjs)
  → snapshot persists calculation_json with expansionOptions.{loopExpansionUnit,mountingUnit}.productId
  → BOM calculated requirement (worker/boq-line-bom-api.mjs :: loadExpansionRequirement)   [DONE in MVP-BOM-2]
  → commercial representation (source_type='SCOPE', boq_item_id=NULL, source_product_id, provenance)   [BLOCKED]
  → pricing (existing authority, by product_id)                                                [reused]
  → approval (existing authority)                                                              [reused]
  → quotation gate (coverage by product_id)                                                    [reused]
  → export (governed, reads quotation lines directly)                                          [reused]
```

The `CALCULATED_REQUIREMENT` → `Commercial Line` bridge is the missing step, and it is the step that requires the schema change.

---

## 5. Identity / quantity / provenance contract

A scope commercial line must carry at minimum:

| Field | Source |
|---|---|
| `source_type` | `'SCOPE'` |
| `source_product_id` | exact `library_products.id` from the snapshot's `expansionOptions` |
| `quantity` | calculated quantity, aggregated by exact product identity |
| `unit` | from the product/calculation |
| `source_snapshot_id` | originating `fire_alarm_panel_sizing_snapshots.id` |
| `source_fingerprint` | snapshot `input_fingerprint` |
| `project_id` | the project |

**Currentness rule:** the line is valid only while `source_fingerprint` equals the current snapshot's `input_fingerprint`. A new snapshot version changes the fingerprint and invalidates the line. This reuses the existing snapshot currentness model exactly — no competing definition.

---

## 6. Duplicate-prevention contract

Structural natural identity for one logical derived requirement:

```
(project_id, source_type, source_snapshot_id, source_product_id)
```

Repeated BOM generation or reconciliation derives the same identity and must not create a second line. Quantities are aggregated **only** when product identity, unit and scope are compatible; per-panel provenance is retained. Expansion hardware already represented by a BOQ or accessory line is not double-counted — the identity check is by `source_product_id`, and the BOM expansion section is derived from the snapshot, not stored.

---

## 7. Commercial authority — what still stands

A scope line is **not** quotation-authoritative merely because it exists. It must pass the same gates as a product line:

- **Product authority** — exact `source_product_id`, resolved from the snapshot, never from part-number text.
- **Price authority** — a valid current price for that product, selected through existing pricing authority. No fabricated price.
- **Approval** — required commercial approval. No automatic approval.
- **Currentness** — `source_fingerprint` must match the current snapshot.
- **Quotation eligibility** — the line must be present, priced and approved.

The existing `expansionCoverageBlockers` already checks coverage by `product_id` against `pricing_lines` with `status='Approved'`. Under Candidate B, a scope line would satisfy that check like any other priced, approved line.

---

## 8. Quotation / export behavior

**Before:** the expansion blocker could never clear, because no commercial line could represent the expansion product. Golden was hard-blocked.

**After (design):** the blocker clears only when every required expansion product has a valid current commercial line (priced + approved + current provenance). Partial or stale coverage keeps the blocker. Export reads quotation lines directly and would include a scope line without any fabricated BOQ row. Legacy BOQ-backed lines are unchanged.

---

## 9. Schema / migration

**Required, and the reason this slice stops:**

`project_quotation_lines` is a core, immutable quotation table (immutability triggers at `drizzle-active/0000_baseline_schema_0082.sql:6862-6872`, UNIQUE `(quotation_revision_id, boq_item_id)`). Making `boq_item_id` nullable and adding `source_type` + provenance requires a **table rebuild** (SQLite cannot drop a NOT NULL constraint via ALTER TABLE):

1. `CREATE TABLE project_quotation_lines_new (... source_type ..., boq_item_id TEXT ..., source_snapshot_id TEXT, source_fingerprint TEXT, source_product_id TEXT, CHECK ...)`.
2. `INSERT INTO ... SELECT ...` (preserve every existing row; all existing rows are `source_type='PRODUCT'`).
3. `DROP TABLE project_quotation_lines`.
4. `ALTER TABLE project_quotation_lines_new RENAME TO project_quotation_lines`.
5. Recreate all indexes and both immutability triggers.

This is a major quotation-domain migration on a core immutable table. It is the explicit stop condition.

---

## 10. Tests

No new tests written for this slice — the representation is blocked on the schema contract, and a test cannot prove a model that does not exist yet. The MVP-BOM-2 tests (3/3) and MVP-SIZING-1 tests (10/10) continue to pass and prove the BOM-side contract that the commercial representation must consume.

---

## 11. Files changed

**None.** This slice is an architecture decision and a reported boundary. No source, schema, configuration, fixture or business-state file was modified.

---

## 12. Live business-state writes

**None.**

---

## 13. Test inventory status

Unchanged. No new test files were added by this slice, so there is no classification to record and no baseline drift to coordinate.

---

## 14. Remaining limitations

1. **The commercial-line representation does not exist.** The expansion product cannot be quoted, priced, approved or exported under the current schema. This is the blocking contract.
2. **The blocker cannot clear in practice** until the schema change lands. The fail-closed behaviour is correct, but it means a Fire Alarm project with a capacity deficit cannot produce a quotation.
3. **The design is proven but not implemented.** Candidate B is the smallest correct model; implementing it is a dedicated quotation-domain migration that should be scheduled and reviewed as its own slice.

---

## 15. Next smallest slice (not executed)

**Implement Candidate B as a dedicated, reviewed quotation-domain migration:**

1. Table-rebuild migration on `project_quotation_lines` adding `source_type`, nullable `boq_item_id`, `source_snapshot_id`, `source_fingerprint`, `source_product_id`, and the CHECK constraint; preserve all existing rows as `source_type='PRODUCT'`; recreate indexes and immutability triggers.
2. A creation-path branch in `presales-workflow-api.mjs` / `quotation-line-authority.mjs` that builds a `source_type='SCOPE'` line from the BOM `CALCULATED_REQUIREMENT`, carrying exact product identity, quantity, unit and snapshot provenance.
3. Failing-before/passing-after tests for: expansion required → exact product represented without a BOQ item; ordinary BOQ line unchanged; no fabricated identity; currentness invalidation on a new snapshot fingerprint; duplicate prevention on repeated reconciliation; partial quantity does not clear the blocker; valid approved coverage clears it.

This is a major quotation-domain change and must be scheduled and reviewed as its own slice, not folded into expansion work.

---

**STOPPED — MVP-BOM-3 complete (blocked on the explicitly documented representation contract).**

No commit, push, deployment, dev-server restart, live approval, live price selection, or unrelated business-state mutation was performed.
