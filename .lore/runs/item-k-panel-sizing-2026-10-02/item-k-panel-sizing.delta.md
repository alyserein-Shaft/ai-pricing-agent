# Fire Alarm Panel Sizing — Al Mousa "Item K" — Run Delta

**Run ID:** `item-k-panel-sizing-2026-10-02`
**Project:** `project_ae501b85-9c12-4332-bf8e-787c90f2d388`
**Verdict:** `ITEM_K_GOVERNED_PANEL_SIZING_BLOCKED`
**Writes performed:** none (0 rows in `fire_alarm_panel_sizing_snapshots` and
`fire_alarm_preliminary_sizing_snapshots`, before and after).

## Findings

1. **The governed panel-sizing record has no per-BOQ-item granularity.**
   `fire_alarm_panel_sizing_snapshots` columns are
   `(id, project_id, version_number, input_fingerprint, engine_version, status, input_json,
   calculation_json, dossier_json, reason, created_by, created_at)`. No `boq_item_id`.
   The route is `POST /api/projects/:projectId/fire-alarm/panel-sizing` — project-scoped.
   The engine's own fail-closed completeness contract
   (`assertSlcPoolAllocationsAreComplete` → `SLC_POOL_ITEM_UNALLOCATED`) requires **every**
   current SLC-pool BOQ item to be allocated, and `architecture.requiredPanelIdentities`
   requires **every** approved physical panel to be sized. A per-item sizing record is
   therefore not a representable state; the only representable state is one project-wide snapshot.

2. **"Item K" is not a unique identity.** Six BOQ rows carry `item_number='K'` in source
   document `73e6-64c6-…`:
   `9ead7b88` fireman telephone jack (Auto Verified) ·
   `12c228fc` FACP (Approved) · `ea32d5b0` CWZ cable (Auto Verified) ·
   `1e1926c7` FACP (Merged) · `992b9efd` FACP (Approved) · `450c453b` FACP (Auto Verified).
   Three are current panels. Canonical panel set is 7 lines: 1 MFACP (`7218b8d7`, item G)
   + 6 FACP (`534f049e`, `07b9ab12` item D; `12c228fc`, `992b9efd`, `450c453b` item K).

3. **The governed sizing path is unlanded and non-loadable.** Both
   `worker/fire-alarm-panel-sizing-api.mjs` and
   `app/domain/fire-alarm-panel-sizing-snapshot.mjs` are **untracked** (`??`) in the shared
   tree. Their 53-module import graph has **8 named imports that do not resolve**:
   `assessExpansionNeed` (not exported by `fire-alarm-slc-capacity-calculator.mjs` and not
   defined anywhere in `app/` or `worker/`); `resolveFireAlarmAttributeAlias` (exported by
   `worker/product-attribute-review.mjs`, not `fire-alarm-taxonomy.mjs`);
   `currentBoqEligibleForEngineeringPredicate` (only `currentBoqItemPredicate` exists);
   `currentRun` + `matchRunStaleness` (not exported by `product-matching-api.mjs`);
   `loadStage4DrawingArchitectureContext` (not exported by `technical-requirement-api.mjs`);
   `currentSymbolRecognitionVersion` (not exported by `drawing-symbol-recognition-api.mjs`).
   `node --test tests/r7-panel-sizing-production.test.mjs` fails at module load on
   `assessExpansionNeed`.

4. **The route is not wired.** `handleFireAlarmPanelSizingApi` is imported/called nowhere in
   `worker/index.ts`; `GET /api/projects/:projectId/fire-alarm/panel-sizing` returns
   `404 API_NOT_FOUND`. `tests/r7-panel-sizing-production.test.mjs:677` asserts that wiring.
   The served `dist/server/index.js` (03:21:35) predates `worker/index.ts` (03:30:18).

5. **No Approved primary product selection exists for any panel.** All 50 panel match
   candidates across the 6 current panel lines are `Needs Review`; zero `Approved`.
   First gate in `loadPanelDependency` → `CURRENT_APPROVED_PANEL_SELECTION_REQUIRED`.

6. **The NOTIFIER N16 basis is not the project's current authority.** Every panel match
   candidate is Farenhyt (`IFP-2100HVB`, `IFP-75HVB`, `IFP-75B`, `RFP-2100HVB`, …).
   `NOTIFIER INSPIRE N16e` exists as `library_products.part_number='N16e'`
   (`review_status='Reviewed'`, `identity_status='Active'`) with **zero** `product_attributes`
   rows and **zero** match candidacy in Al Mousa.
   The only Approved current capacity evidence is on Farenhyt `IFP-2100HV`:
   `native_slc_loops=1`, `max_detectors_per_loop=159`, `max_modules_per_loop=159`,
   `max_system_points=2100`.

7. **The 11-loop precedent is not a governed record.** Both sizing snapshot tables hold 0 rows
   for this project. The figure originates from `scripts/size-al-mousa-fire-alarm-panel.mjs`
   (2025-09-30), whose own header states it deliberately bypasses governed `boq_items` in
   favour of a hand-authored census fixture because of four coexisting current extraction
   versions. That duplication is now resolved — exactly one current extraction version
   (v1 `Completed`), 108 rows / 90 BOQ Item / **82 canonical** — so a governed recompute is
   now well-defined in principle.

8. **The one prerequisite that passes:** `drawing_architecture_stage4_readiness` v1 =
   `architecture_status COMPLETE`, `stage4_readiness READY_FOR_STAGE4_BRIDGE`;
   `drawing_architecture_approved_versions` v2 `Active`.

## Prior Lore Tension

- `DEC-2026-10-02-7a55` (governed panel count 7 = 6 FACP + 1 MFACP) is confirmed and is
  consistent with finding 2.
- `DEC-2026-10-02-7a15` (multi-point modules under-count up to 10×) remains open and is
  upstream of any future governed recompute of the module loop count.
- `ARCH-2026-10-01-8d16` (Expansion Hardware is a TERMINAL, non-promotable fact type) means
  `added_slc_loops` evidence — required by `loadLoopExpansionEvidence` — has no governed
  promotion path, so expansion will fail closed at `APPROVED_EXPANSION_EVIDENCE_REQUIRED`
  even after selection and capacity are resolved.