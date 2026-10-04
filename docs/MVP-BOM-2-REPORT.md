# MVP-BOM-2 — Preserve Expansion Identity into the Governed Commercial Flow

**Lane:** MVP-BOM-2 (implementation)
**Date:** 2026-09-28
**Defect closed:** BOM-002 — the resolved expansion product identity was discarded at the calculation boundary; only the number survived.

---

## 1. Identity-loss boundary and repair

**The boundary.** `app/domain/fire-alarm-panel-slc-sizing.mjs:41-47` aggregates the per-panel results into `projectTotal`, persisting only `requiredExpansionQuantity` and `mountingUnitQuantity` — both numbers. The exact resolved product identities are present one level down, in `panels[].expansionOptions.loopExpansionUnit.productId` and `.mountingUnit.productId`, and they ARE persisted in the snapshot's `calculation_json` (via `panelResults`). What was missing was any **consumer** that carried them into the BOM flow: `worker/boq-line-bom-api.mjs` is BOQ-item-centric and had no expansion path, and the quotation gate (`worker/quotation-line-authority.mjs:106-108`) only asked whether the number was greater than zero.

**The repair.**

1. **`worker/boq-line-bom-api.mjs`** — new `loadExpansionRequirement(db, projectId)` reader. It reads the current COMPLETED snapshot, and when the snapshot proves expansion is required it extracts the exact resolved product identities (loop expander + mounting unit) with their calculated quantities and full provenance (snapshot id, snapshot fingerprint, per-panel provenance). Quantities are aggregated **only by exact product identity**, with per-panel provenance retained. The section is explicitly labelled `CALCULATED_REQUIREMENT` — a suggested BOM line, **not** an approved, priced quotation line. `buildProjectBomSummary` now returns an `expansion` section alongside the per-line authority.

2. **`worker/quotation-line-authority.mjs`** — new `expansionCoverageBlockers`. When the snapshot proves expansion is required, the blocker clears only if every required expansion product is covered by a valid current commercial line for that exact product identity. The check is product-identity-based and never fabricates coverage. It fails closed on unreadable evidence, exactly as the existing gate does.

**What was NOT done.** No product was auto-selected, no price fabricated, no approval granted, no dummy product created. The expansion section is a calculated requirement; it becomes a real commercial line only through the existing matching/pricing/approval authority.

---

## 2. Files changed

| File | Change |
|---|---|
| `worker/boq-line-bom-api.mjs` | added `loadExpansionRequirement`; `buildProjectBomSummary` returns an `expansion` section |
| `worker/quotation-line-authority.mjs` | added `expansionCoverageBlockers`; `projectPanelSizingBlockers` clears the expansion blocker only on valid current commercial coverage |
| `tests/mvp-bom-2-expansion-identity.test.mjs` | **new** — 3 route regressions on the real active chain |

No schema, configuration, fixture or business-state change. No live project writes, approvals, price selection, quotation creation or export. No commits, pushes or deployments.

---

## 3. Identity / quantity / provenance path

```
panel sizing (worker/fire-alarm-panel-sizing-api.mjs)
  → loadExpansionPath resolves the two-hop chain to canonical productIds
  → calculateSlcExpansion computes the quantity
  → snapshot persists calculation_json with expansionOptions.{loopExpansionUnit,mountingUnit}.productId
       ↓
BOM read model (worker/boq-line-bom-api.mjs :: loadExpansionRequirement)
  → reads the current COMPLETED snapshot
  → extracts exact productId + partNumber + quantity per panel
  → aggregates by exact productId, retains per-panel provenance
  → returns status CALCULATED_REQUIREMENT (or NO_EXPANSION_REQUIRED)
       ↓
quotation gate (worker/quotation-line-authority.mjs :: expansionCoverageBlockers)
  → blocker clears only when every required productId has a valid current commercial line
```

**Currentness.** The section carries `snapshotId` and `snapshotFingerprint`. A sizing, allocation or evidence change produces a new snapshot (or a stale one), and the fingerprint changes — so stale expansion coverage is invalidated by the existing snapshot-fingerprint mechanism.

**Duplicate prevention.** The expansion section is derived from the snapshot, not stored, so a repeated generation cannot duplicate it. It is aggregated by exact product identity, and it never double-counts hardware already represented by a BOQ or accessory line because it is sourced from the sizing calculation, not from the BOQ.

---

## 4. Tests and inventory status

| Suite | Result |
|---|---|
| `tests/mvp-bom-2-expansion-identity.test.mjs` (new) | **3/3** |
| `tests/mvp-sizing-1-expansion-evidence-laziness.test.mjs` | **10/10** |
| `bom-001-r7-expansion-bridge` + `r7-panel-sizing-production` + `r7-panel-topology-completeness` + `r7-topology-concurrency` + `fire-alarm-panel-topology-sizing` + `fire-alarm-slc-capacity-calculator` | **88/88** |
| `quotation-authority` + `quotation-snapshot-export` + `migration-chain-verification` + `migration-baseline-safety` + `production-readiness` | **34/34** |
| `npm run build` | **passes** |

**Red phase** (before the BOM reader existed): `summary.expansion` was `undefined` — the identity did not reach the BOM.

**Inventory.** Both new test files are classified **SAFE** (they build isolated in-memory databases from the active migration chain and touch no real state). The inventory has grown from 402 to 410 files; the two files this lane added are SAFE and must be added to the recorded baseline. **This baseline update is a coordination item** — other lanes are actively adding files, so the baseline should be re-recorded once the tree settles, not forced now. No test was relabelled to obtain a green suite.

---

## 5. Which commercial gates remain, and why

The expansion blocker now clears only on valid current commercial coverage. **It still cannot clear in practice, and this is a real blocking contract, not a workaround:**

> A commercial line (`project_quotation_lines` / `pricing_lines`) requires a BOQ item. Expansion hardware is a sizing-derived product identity, not a BOQ item. So an expansion product cannot be covered by a commercial line under the current schema.

This is the exact representation contract the task asked to be reported before implementing a broader model. **Concrete minimal design** (not implemented):

- A `commercial_scope_lines` table (the expansion hardware is a scope line, not a BOQ line), with `line_type`, `product_id` (nullable for service-only lines), `quantity`, `unit`, `provenance_snapshot_id`, `provenance_fingerprint`, and a currentness predicate.
- A `line_type` discriminator on the quotation-line read path so a scope line can be quoted without a BOQ item.
- The expansion blocker clears when a current `commercial_scope_lines` row covers the exact product identity with a valid price and approval.

Until that model exists, the correct fail-closed behaviour is what this slice delivers: the blocker stays, and the BOM shows the exact product and quantity that must be covered.

---

## 6. Live project data untouched

Read-only verification after the work: `fire_alarm_panel_sizing_snapshots` = **0**, `project_quotation_lines` = **0**. No live writes were made; all new tests use isolated in-memory databases.

---

## 7. Recommended next slice (not executed)

**Implement the `commercial_scope_lines` model** described in §5 — the minimal design that lets a sizing-derived expansion product become a quotable, pricable, approvable commercial line without a BOQ item. This is the only thing that clears the expansion blocker in practice, and it is a new commercial model, deliberately not built inside this slice.

---

**STOPPED — MVP-BOM-2 complete.**
