# MVP-SIZING-1 — Require Expansion Evidence Only When Expansion Is Needed

**Lane:** MVP-SIZING-1 (implementation)
**Date:** 2026-09-28
**Defect closed:** D-F / B4 — the panel-sizing dependency loader demanded the two-hop Expansion Module accessory chain and an Approved `added_slc_loops` attribute for **every** physical panel, eagerly, before any capacity arithmetic ran.

---

## 1. Root cause and exact repair

**Root cause.** `worker/fire-alarm-panel-sizing-api.mjs:379-382` loaded capacity evidence and the expansion path together in one eager `Promise.all`, once per panel, with no condition and no demand/capacity argument:

```js
const [{ panelCapacity, evidence: capacityEvidence }, expansion] = await Promise.all([
  loadCapacityEvidence(db, product.id, panel.panelId),
  loadExpansionPath(db, product.id, panel.panelId),   // unconditional
]);
```

`loadExpansionPath` structurally *cannot* know whether expansion is needed, so a panel whose verified native capacity already satisfied its validated allocations was still forced to produce expansion hardware it did not need. A second, independent unconditional gate sat in the engine at `app/domain/fire-alarm-panel-sizing-snapshot.mjs:229-231`.

**The repair, in three parts:**

1. **`app/domain/fire-alarm-slc-capacity-calculator.mjs`** — extracted Steps 1-5 (demand validation, native-capacity validation, CONFLICT, CAPACITY_EXCEEDED, required-loops, and the `requiredAdditionalLoops === 0` branch) into a new exported pure function `assessExpansionNeed({ demand, panelCapacity })`. It is the **single authority** for "is expansion needed" and is deliberately free of `expansionOptions`. `calculateSlcExpansionExpansion` now calls it first and proceeds to Step 6 (expansion sizing) **only** when the status is `EXPANSION_REQUIRED`; every other terminal status is returned complete. No arithmetic is duplicated.

2. **`worker/fire-alarm-panel-sizing-api.mjs`** — `loadPanelDependency` now loads capacity evidence (always required), derives the panel's own allocated demand, calls `assessExpansionNeed`, and loads the expansion chain **only when `requiredAdditionalLoops > 0`**. When expansion is not needed it returns `expansionOptions: null` plus the `expansionNeed` assessment.

3. **`app/domain/fire-alarm-panel-sizing-snapshot.mjs`** — `validatePanelDependency` derives the need itself via `assessExpansionNeed` (never from a client flag), cross-checks the loader's assessment against its own derivation, and requires expansion evidence **only when `need.status === "EXPANSION_REQUIRED"`**. A panel that fits natively, or one whose evidence is missing, contradictory or over-ceiling, is never asked for expansion hardware.

**Exactly-one accessory behavior preserved.** `exactExpansionRelationships` is unchanged: it fails `AMBIGUOUS_EXPANSION_RELATIONSHIP` unless there is exactly one current Approved `Expansion Module` relationship per hop. When expansion is required, the chain is still walked and still fails closed on 0 or >1 matches, on rejected/stale relationships, and on missing `added_slc_loops`.

**No circular dependency.** `panelDemandFromAllocations` reads only the allocation dependencies and the command's allocations; `assessExpansionNeed` reads only demand and panel capacity. Neither requires expansion evidence, so demand can be established before the chain is loaded.

**Fingerprinting and currentness preserved.** The dependency fingerprint covers `dependencies`, which now carries the conditional `expansionOptions` and the `expansionNeed` assessment. The post-write read-back revalidation (`revalidatePanelSizingWrite`) and the GET-path staleness check both re-run `loadDependencies` and compare fingerprints, so a capacity or allocation change after the write is still detected.

---

## 2. Files changed

| File | Change |
|---|---|
| `app/domain/fire-alarm-slc-capacity-calculator.mjs` | extracted `assessExpansionNeed`; `calculateSlcExpansion` delegates to it |
| `app/domain/fire-alarm-panel-sizing-snapshot.mjs` | added `panelDemandFromAllocations`; expansion gate now conditional on a derived need; added `anyCapacityExceeded` to the project-total check |
| `worker/fire-alarm-panel-sizing-api.mjs` | `loadPanelDependency` assesses need and loads expansion conditionally |
| `tests/mvp-sizing-1-expansion-evidence-laziness.test.mjs` | **new** — 10 route regressions on the real active chain |

No schema, configuration, fixture or business-state change. No live project POSTs, snapshots, approvals or database mutations. No commits, pushes or deployments.

---

## 3. Failing-before / passing-after evidence

**Red phase** (before the source fix, with the new test file): the core test failed with exactly the target defect —

```
✖ native capacity sufficient + no expansion evidence -> NO_EXPANSION_REQUIRED
  expected 201, got 409: {"code":"AMBIGUOUS_EXPANSION_RELATIONSHIP",
  "message":"Exact product product-panel must have one current Approved Expansion Module relationship."}
```

The conflict and capacity-exceeded cases also failed in the red phase because the eager expansion load preempted the engine's own ceiling/conflict checks.

**Green phase** (after the fix): **10/10 pass.**

---

## 4. Behaviour matrix (all proven by the new route tests)

| Case | Result |
|---|---|
| Native capacity sufficient + no expansion evidence | 🟢 201 `NO_EXPANSION_REQUIRED`, `requiredExpansionQuantity: 0`, `expansionOptions: null` |
| Expansion required + missing evidence | 🟢 409 `AMBIGUOUS_EXPANSION_RELATIONSHIP` (exactly-one check, 0 matches) |
| Expansion required + complete valid evidence | 🟢 201 `EXPANSION_REQUIRED`, `requiredExpansionQuantity: 1`, `selectedExpansionType: "6815"` |
| Ambiguous expansion relationship (>1 match) | 🟢 409 `AMBIGUOUS_EXPANSION_RELATIONSHIP` |
| Rejected expansion relationship | 🟢 409 `AMBIGUOUS_EXPANSION_RELATIONSHIP` |
| Missing capacity evidence | 🟢 409 `APPROVED_CAPACITY_EVIDENCE_REQUIRED` — never "no expansion" |
| Conflicting capacity evidence (per-loop capacity 0 with demand) | 🟢 409 `PANEL_SIZING_CALCULATION_CONFLICT` |
| Capacity/system-point ceiling exceeded | 🟢 409 `PANEL_SIZING_CALCULATION_CONFLICT` |
| Mixed multi-panel (one fits, one needs expansion) | 🟢 201 — each panel assessed separately; panel 1 `NO_EXPANSION_REQUIRED` with `expansionOptions: null`, panel 2 `EXPANSION_REQUIRED` with quantity 1 |
| Capacity changed after the write | 🟢 GET reports `status: "STALE"`, `snapshot.current: false`, and differing stored/current fingerprints |

**Unknown demand, incomplete allocations, missing capacity and conflicting topology never become "no expansion required"** — each fails closed with its own code.

---

## 5. Shared business data and unrelated work untouched

- `fire_alarm_panel_sizing_snapshots` in the live local D1: **still 0 rows** (verified read-only after the work).
- No live project POSTs, snapshots, approvals or database mutations were made; the new tests build isolated in-memory databases from the active migration chain.
- The only files modified are the four listed above. All other dirty work (Understanding lanes, ledger, docs) is preserved.
- `npm run build` passes.

---

## 6. Verification

| Suite | Result |
|---|---|
| `tests/mvp-sizing-1-expansion-evidence-laziness.test.mjs` (new) | **10/10** |
| `r7-panel-sizing-production` + `r7-panel-topology-completeness` + `r7-topology-concurrency` + `bom-001-r7-expansion-bridge` + `fire-alarm-panel-topology-sizing` + `fire-alarm-slc-capacity-calculator` + `stage4d1-live-calculation-wiring` | **92/92** |
| `calculation-requirement-engine` + `engineering-dossier-engine` + `migration-chain-verification` + `migration-baseline-safety` + `production-readiness` + `fire-alarm-taxonomy-integration` | **113/113** |
| `npm run build` | **passes** |

No checks were removed and no tests reclassified to make a suite pass.

---

## 7. Remaining sizing / BOM / UI blockers (unchanged, out of scope)

| Blocker | Status |
|---|---|
| **BOM-002** — expansion `productId` discarded at the calculation boundary | Still open. Explicitly excluded from this slice. |
| **No UI for panel sizing** | Still open. The stage remains API-only and unreachable by a user. |
| **Unconditional expansion evidence** | **CLOSED by this slice.** |
| **Capacity ceiling not enforced end-to-end** | **Fixed as a consequence** — the eager load had been masking it; `anyCapacityExceeded` is now checked. |

---

## 8. Recommended next slice (not executed)

**Propagate the expansion `productId` into a governed BOM/costing/quotation line (BOM-002).** The identity is now resolved and available at the assessment boundary; the smallest correct change is to carry it through the calculation output into a real priced line at the calculator's proven quantity, so a capacity deficit can be priced rather than merely blocked. This preserves BOM-001's fail-closed gate (the blocker clears only against a real priced line) and does not auto-select a product.

---

**STOPPED — MVP-SIZING-1 complete.**
