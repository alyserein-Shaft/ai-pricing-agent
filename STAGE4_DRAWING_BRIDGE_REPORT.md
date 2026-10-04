# STAGE4_DRAWING_BRIDGE_REPORT

**Stage:** Stage 4 Drawing Bridge (exactly one bounded next stage after Step 14.8 = COMPLETE / READY_FOR_STAGE4_BRIDGE).
**Scope:** Workspace only `/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an`. No commit / push / deploy, no STANLY, no Product Library edits, no Pricing, no Quotation, no AI inference, no new Drawing extraction.
**Date:** 2026-09-22
**Status:** COMPLETE — STOPPED, awaiting owner review.

---

## 1. Current handoff path

The Stage 4 requirement/profile pipeline today is per-BOQ-item and spec-shaped:

```
drawing_symbol evidence (Stage 6A/9)      technical_requirements (0004, spec-derived)
        +                                         +
engineering_facts / engineering_relationships (0005 knowledge graph, project-scoped)
        |                                         |
        +------------ loadInputs (worker/technical-requirement-api.mjs) ------------+
                                                                                    v
                          buildTechnicalRequirementProfile (technical-requirement-engine.mjs)
                                    |                            |
                                    v                            v
               requirement_profile_versions / profile_requirement_applicability /
               consolidated_profile_requirements / profile_issues
                                    |
                                    v
                     runProductMatching (product-matching-engine.mjs, profile inputs)
```

The governed Drawing Architecture surface (0078 `drawing_architecture_approved_rows`/`approved_versions` + 0079 `drawing_architecture_exception_adjudications`/`drawing_architecture_stage4_readiness`) was project-scoped, versioned, adjudicated and declared `READY_FOR_STAGE4_BRIDGE`, but had **no downstream consumer** — the architecture worker only served review/approved/adjudication/readiness reads. That is the gap this stage closes, **without touching the matching engine and without a schema change**.

Critical handoff trap (preserved, not violated): `buildTechnicalRequirementProfile` folds `engineering_relationships` whose `relationshipType` matches `/compatible|interface|protocol/` into `profile.compatibility`. SLC / panel-network / interface architecture facts **must never** enter that channel — they would become invented product compatibility.

## 2. Exact bridge implemented

A governed, **read-only projection** (no new tables, no second knowledge store, no writes):

- **Domain:** `app/domain/drawing-architecture-bridge.mjs`
  - Governed taxonomy `BRIDGE_FACT_SEMANTICS`: fact type → exactly one explicit **downstream consumer channel** (PANEL_INVENTORY, CIRCUIT_BUS, PANEL_NETWORK, SYSTEM_INTERFACE, NAC_CIRCUIT, AREA_COVERAGE, LEGEND_LINKAGE, CROSS_SHEET_RESOLUTION).
  - `bridgeSemanticsFor(factType)` — hard constants `productCompatibility:false`, `protocol:false`, `matchingRole:"project-architecture-context"` on every bridged entry; `ARCHITECTURE_DISCREPANCY` → `null` (never bridged).
  - `projectArchitectureEvidence({ approvedVersion, adjudications, readinessRow, unresolvedCases })` — deterministic projection of the **current (non-superseded) approved version only**, resolving each row's adjudication (by review-case link, or FACP sheet-level fallback) into canonical target/panel identity with full provenance.
  - `buildDrawingArchitectureBridge(...)` — deterministic; `fingerprint` = SHA-256 over the canonical projection (`drawing-architecture-bridge-semantics-1.0.0`), so repeated evaluation is idempotent by construction.
- **Worker:** `GET /api/projects/:projectId/drawing-architecture/bridge` in `drawing-architecture-review-api.mjs`, composing the existing governed loaders (`loadApprovedVersion`, `loadAdjudications`, `loadReadinessRow`) + unresolved review cases. Read-only (405 on non-GET); adds `documentId/documentVersionId/structureVersionId` to the approved-row loader map for provenance.

The bridge reuses the existing architecture/readiness records **unchanged**; nothing is duplicated into `engineering_facts`/`engineering_relationships` or any other store, and product matching never reads the projection.

## 3. Evidence types bridged

All 14 governed architecture fact types with an explicit Stage 4 consumer channel:

| Fact type | Bridged as | Evidence count (live v2) |
|---|---|---|
| PANEL_EXISTS, PANEL_LABEL | PANEL_INVENTORY (panel identity / system confirmation context) | 13 |
| SLC_LOOP_EXISTS, PANEL_LOOP_RELATION, SLC_LOOP_SERVES_AREA, SLC_DEVICE_BRANCH | CIRCUIT_BUS (addressing topology context — **not protocol**) | 24 |
| PANEL_NETWORK_LINK, FIRE_ALARM_NETWORK_TOPOLOGY | PANEL_NETWORK (panel-to-panel topology context — **not product compatibility**) | 18 |
| INTERFACE_CONNECTED_TO_SYSTEM, EXTERNAL_SYSTEM_INTERFACE | SYSTEM_INTERFACE (interface boundary context) | 26 |
| NAC_CIRCUIT_EXISTS | NAC_CIRCUIT | 5 |
| PANEL_SERVES_AREA | AREA_COVERAGE | 8 |
| LAYOUT_LEGEND_LINK | LEGEND_LINKAGE (symbol↔legend provenance) | 25 |
| CROSS_SHEET_REFERENCE | CROSS_SHEET_RESOLUTION (reference provenance, adjudicated target) | 9 |

**Total: 128 evidence entries = the full approved v2** (every v2 fact has a governed consumer; no fact is dropped, none is turned into capability). The 12 adjudication decisions and the governed readiness ride the bridge verbatim.

## 4. Evidence types intentionally NOT bridged

- **ARCHITECTURE_DISCREPANCY** — a review artifact folded 1:1 into its CROSS_SHEET_REFERENCE exception (Step 14.8 design); it is surfaced only as non-blocking unresolved context (9 live rows → `UNKNOWN_PROJECT`), never as evidence.
- **No protocol / product-compatibility vocabulary** is ever emitted: no FlashScan, no CLIP, no `compatibility` array, no `compatibilityTarget`. Only the boolean field name `productCompatibility` (always `false`) appears.
- Nothing crosses into `engineering_facts`, `engineering_relationships`, `technical_requirements`, `requirement_profile_*`, or any Product Library surface.

## 5. Provenance behavior

Every bridged evidence entry preserves:
- **Drawing/sheet:** `sourceDrawingNumber`, `sourcePage`, `sourceRegion`, `sourceFragmentIds`
- **Source evidence:** `evidenceFingerprint` (SHA-256), `parserVersion`, snapshot-bearing revision
- **Governance:** `documentId`, `documentVersionId`, `structureVersionId`, `reviewCaseId`, `reviewActorId`, `reviewReason`
- **Architecture version:** `architectureVersion` = the current approved version number (2)
- **Adjudication decision:** for resolved rows — `decisionState`, `decisionPolicyVersion`, `stage4BlockingClass`, plus canonical resolution (`canonicalTargetDrawingNumber` = registered `2401232- PC- AMS- DR- T-00-ZZZ-002` for the 9 DR-less cross-sheet citations; `canonicalPanelIdentity` = `FACP @BOS BUILDING` / `@GRS BUILDING` / `@WLC BUILDING` + `canonicalBuildingAssetCode` for the 3 generic FACP panels).

Superseded v1 (116 rows, `superseded_at` set) is never projected: with no current version the bridge reports `NO_CURRENT_ARCHITECTURE_VERSION` with empty evidence rather than fabricating current facts from history.

## 6. Golden result (Al Mousa School + frozen baselines)

- **Live bridge projection** (Al Mousa, project `c0123d91-c30b-4956-87cb-e473ef53f89d`, read-only): status `READY_FOR_STAGE4_BRIDGE`, v2, 128 evidence entries, 12 adjudications, 9 unresolved non-blocking; **zero** protocol/compatibility claims, **zero** FlashScan/CLIP tokens; FACP identities resolve to BOS/GRS/WLC. Evidence artifact: `outputs/system-audit/STAGE4_DRAWING_BRIDGE_LIVE_EVIDENCE.json` (fingerprint `e8f406446ff44cf0836a46821b2f44bc5b1764b4b0c9bf97bf2c9a8e0f9916c4`; two independent runs → identical fingerprint = live idempotency).
- **SLC remains CIRCUIT_BUS / project architecture evidence** (24 entries), **panel relationships remain project architecture evidence** (18 entries): both `protocol:false`, `productCompatibility:false`.
- **No FlashScan/CLIP compatibility invented:** bridge serialization contains no such tokens; matching engine never sees the projection.
- **Golden Heat Detector decision unchanged:** `scripts/fire-alarm-golden-evaluation-gate.mjs` → **GATE PASSED** (Central Kitchen + Opera Block frozen baselines; 0 true matching errors, 0 false resolves). Bridge test 7 re-runs the golden 4W scenario with the bridge present: attributes still pass, FlashScan compatibility comparison preserved, no SLC comparison invented.
- **Product Library gap remains a Product Library gap:** `scripts/al-mousa-stage4d4-validation.mjs` (read-only, live) — heat detector C stays `ENGINEER_EXCEPTION` (never auto-rejected), `AL_MOUSA_AUTO_REJECT_ELIGIBLE = 0`, zero writes. The blocker is library-side, unchanged.
- Pre-existing working-tree condition (unrelated, documented): `app/domain/product-matching-engine.mjs` carries a pre-existing 179-line uncommitted modification (Document Intelligence S1 / TM7 / Stage 4D work); `tests/golden-heat-detector-4w-closure.test.mjs` (untracked, imports only the engine) has 3 failing sub-tests (7/8/10) driven by that modification. None of this stage's files are on that path.

## 7. Tests

New governed suite `tests/Drawing-architecture-stage4-bridge.test.mjs` — **10/10 green** against the live-parity fixture corpus:

| # | Proves |
|---|---|
| 0 | Governed taxonomy locks every fact type to one consumer channel; ARCHITECTURE_DISCREPANCY never bridged |
| 1 | approved/current architecture **v2 is consumable** (128 rows) and reaches the Stage 4 project context (incl. FACP identities) |
| 2 | **superseded v1 is not used** as current evidence (NO_CURRENT_ARCHITECTURE_VERSION, empty evidence) |
| 3 | **provenance survives** (drawing, sheet, source evidence, version, adjudication decision) |
| 4 | **unresolved drawing evidence stays non-blocking** (9 discrepancies → UNKNOWN_PROJECT, blocking:false, readiness unchanged) |
| 5 | **SLC is not protocol** (CIRCUIT_BUS, no FlashScan/CLIP) |
| 6 | **panel relationship is not product compatibility** (no compatibility surface emitted) |
| 7 | **Golden intact** (4W decision unchanged; bridge emits no matching-engine surface) |
| 8 | **repeated bridge evaluation is idempotent** (byte-identical + stable fingerprint, incl. after idempotent re-apply) |
| 9 | **read-only**: zero writes, zero new tables (7-table architecture surface unchanged) |

Regression (directly relevant Drawing + Stage 4 handoff suites):
- Architecture suite: `drawing-architecture-review.test.mjs` + `Drawing-architecture-adjudication.test.mjs` + bridge suite — **green**.
- Broader sweep (requirement-intelligence-engine, requirement-approval-eligibility, requirement-profile-staleness, technical-requirement-review-workspace, drawing-requirement-impact-api, drawing-cross-sheet-references, drawing-fact-decision-promotion, drawing-discrepancy-detection, drawing-requirement-evidence-engine, technical-requirement-drawing-handoff, technical-requirement-engine, requirement-intelligence-matching-handoff, requirement-profile-understanding-handoff, database-authority): **113/113 green** in one run, **107/110** in the combined run where the only 3 failures are the pre-existing golden engine-behavior tests described in §6.
- Live end-to-end: Golden gate PASSED; Stage 4D4 read-only validation unchanged.

## 8. Files changed

| File | Change |
|---|---|
| `app/domain/drawing-architecture-bridge.mjs` | **NEW** — governed read-only bridge projection (taxonomy, semantics, fingerprint) |
| `worker/drawing-architecture-review-api.mjs` | bridge route added (`GET …/drawing-architecture/bridge`, read-only); approved-row loader now carries document/version/structure ids; header docs |
| `tests/fixtures/drawing-architecture-fixture.mjs` | `archBridgePath` helper |
| `tests/Drawing-architecture-stage4-bridge.test.mjs` | **NEW** — governed bridge suite (tests 0–9) |
| `outputs/system-audit/STAGE4_DRAWING_BRIDGE_LIVE_EVIDENCE.json` | **NEW** — verbatim live bridge evidence artifact |

No migration was added; no tracked file was modified by this stage; the 0078/0079 surface remains the single source of truth.

## 9. Data mutations

**None.** The bridge is a pure projection over the existing governed records. The live D1 was opened read-only; `AL_MOUSA_*`/Golden runs wrote nothing; the bridge route performs zero writes; no rows, tables, or profiles changed. Net authority count remains 310 migration-sourced tables.

## 10. Bridge status

**COMPLETE** — no STOP condition triggered: the existing Stage 4 data model already holds the governed Drawing Architecture records (project-scoped, versioned, adjudicated, provenance-complete), so the minimum bridge required no schema change and no second knowledge store. All 8 task requirements are proven by tests; Golden result preserved; final state:

```
STAGE4_DRAWING_BRIDGE         = COMPLETE
BRIDGE_SUPERSEDED_V1          = NOT_USED
BRIDGE_PROVENANCE             = PRESERVED
BRIDGE_UNRESOLVED             = NON_BLOCKING_UNKNOWN_PROJECT
SLC_BRIDGED_AS                = CIRCUIT_BUS (not protocol)
PANEL_RELATION_BRIDGED_AS     = PANEL_NETWORK (not product compatibility)
FLASHSCAN_CLIP_INVENTED       = NONE
GOLDEN                        = INTACT
PRODUCT_LIBRARY_GAP           = UNCHANGED
```

## 11. Exactly ONE next step

**Wire the bridge projection as an explicit, declared input to Stage 4 requirement *context* consumers** — e.g., surface `GET …/drawing-architecture/bridge` alongside the requirement-profile context so profile/issue triage can cite governed panel identity, circuit-bus, and interface evidence for the Fire Alarm items (Heat detector, Combined smoke-heat, Main FACP) — keeping it strictly read-side and never feeding `runProductMatching` inputs.

---

**STOPPED — awaiting owner review.**