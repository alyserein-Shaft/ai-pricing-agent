# Drawing Intelligence Architecture Investigation Report

**Repository:** `ai-pricing-agent` (branch `main`)
**Workspace:** `/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an`
**Mode:** Read-only independent investigation
**Status:** Complete — findings documented, no code/schema/DB changes

---

## 1. Real Current Drawing Pipeline

The drawing intelligence pipeline is a 14-stage governed workflow that processes Fire Alarm engineering drawings from PDF intake through approved architecture versioning and Stage 4 bridge projection. The pipeline does **not** claim to extract quantities or geometric connections — these are explicitly out of scope.

### 1.1 Document Ingestion → Classification

1. **Upload session** → Object quarantine → Malware/type/size validation → Immutable document version
2. **Classification** (`classifyDrawingType`): Sheets classified as `Riser Diagram`, `Schematic / Single-Line`, `Legend / Notes`, `Cause & Effect`, `Detail`, `Schedule`, `Layout`, etc.
3. **Architecture-eligible sheets** are only `Riser Diagram` and `Schematic / Single-Line` — all other types are supporting sources
4. Text assets extracted from PDFs; Legend assets consumed separately as governed rows

### 1.2 Text/Asset Processing

- `extractArchitectureFacts()`: Deterministic extraction from Text assets on architecture-authoritative sheets
- `extractLayoutLegendFacts()`: Matches text against governed legend rows (T-00 FIRE ALARM symbols)
- `extractCrossSheetReferenceFacts()`: Detects `REFERENCES` relationships between sheets
- `detectArchitectureDiscrepancies()`: Signals missing references, ambiguous panel assignments

### 1.3 Key Restriction

> **No vector/line pipeline.** A connection fact requires an explicit textual statement. There is no geometric line inference. Bounding-box geometry is used ONLY for deterministic text-line reconstruction and spatial association (panel near building label).

### 1.4 PDF Building

- `buildDrawingPdf()`: Constructs PDFs from extracted canonical pages/blocks/tables
- Page coordinate citations and rotation are tracked but not used for connection inference

---

## 2. Architecture/Module Map

| Module | Owns | Key Files |
|---|---|---|
| **Drawing Intake** | Documents, versions, metadata, pages, assets | `worker/drawing-intake-api.mjs`, `app/domain/drawing-type-classifier.mjs` |
| **Drawing Structural Parser** | Architecture fact extraction from Text assets | `app/domain/drawing-architecture-intelligence.mjs` |
| **Legend Intelligence** | Governed legend rows, symbol definitions | `app/domain/drawing-legend-notes-intelligence.mjs`, `app/domain/symbol-cell-segmentation-engine.mjs` |
| **Symbol Recognition** | Symbol cell segmentation, API handling | `worker/symbol-cell-segmentation-api.mjs`, `worker/drawing-symbol-recognition-api.mjs` |
| **Architecture Adjudication** | 21→12 exception normalization, evidence-only rulings | `app/domain/drawing-architecture-adjudication.mjs` |
| **Decision Policy** | Hard decision ladder per fact type | `app/domain/drawing-architecture-decision-policy.mjs` |
| **Stage 4 Bridge** | Governed projection onto 8 consumer channels | `app/domain/drawing-architecture-bridge.mjs` |
| **Review API** | POST/GET endpoints for extraction, evaluation, adjudication | `worker/drawing-architecture-review-api.mjs` |
| **Requirement Evidence Engine** | Building device identity requirements | `app/domain/drawing-requirement-evidence-engine.mjs` |

### 2.1 Key Data Flows

```
Upload → Classification → Architecture Fact Extraction
       ↓                    ↓                ↓
  Legend Match          Cross-sheet refs  Adjudication (21→12)
       ↓                    ↓                ↓
  Layout-Link facts   Resolved references  Version promotion (v1→v2)
       ↓                                          ↓
Bridge Projection → 8 consumer channels (hard-gated)
```

---

## 3. AI/Vision Components

### 3.1 What Exists (Structural/Domain Only)

- **No LLM calls** in the core drawing pipeline. All extraction is deterministic via AST/pattern matching.
- **No API keys required.** Graphify ran with 0 input/output tokens — pure code extraction.
- **Symbol recognition** is structural: `handleDrawingSymbolRecognitionApi` processes extracted Text assets, not raw pixel vision.
- **Geometry used deterministically:** bbox center distance for nearest-building assignment, band-based text reconstruction, shared-evidence-line detection for panel-loop relations.

### 3.2 What's Absent

- **No OCR for image-only pages** — image assets are not processed; pipeline explicitly requires Text assets
- **No learned symbol comparison** — symbol matching is via governed legend abbreviations, not learned embeddings
- **No vector/line inference** — connections require explicit text; no geometric connectivity claims

---

## 4. Data Model

### 4.1 Core Tables (D1 Schema)

- `drawing_assets`: Text/Legend assets with `text_content`, `bounding_box`, `page_id`
- `drawing_intake_versions`: Per-document version tracking, `status` = Completed/Active/Superseded
- `drawing_metadata`: `drawing_number`, `sheet_name`, `discipline`, `scale`
- `drawing_structure_approved_versions` / `drawing_structure_approved_rows`: **Governed T-00 legend rows** (15 confirmed MFACP/Detector/Station abbreviations)
- `drawing_architecture_review_cases`: Per-fact candidate cases with fingerprints, decision state
- `drawing_architecture_approved_versions`: Promoted versions (v1=116 rows → v2=128 rows)
- `drawing_architecture_approved_rows`: Per-fact approved rows tied to approved version
- `drawing_architecture_exception_adjudications`: 12 unique exceptions with decision fingerprints
- `drawing_architecture_stage4_readiness`: Single row tracking architecture status + stage-4 readiness

### 4.2 Fact Type Inventory (42+ types)

Key architecture facts extracted from riser/schematic sheets:

| Fact Type | Evidence Kind | Authority |
|---|---|---|
| PANEL_EXISTS | EXPLICIT | PRIMARY/SECONDARY |
| PANEL_LABEL | EXPLICIT | PRIMARY/SECONDARY |
| SLC_LOOP_EXISTS | EXPLICIT | PRIMARY |
| SLC_LOOP_SERVES_AREA | DERIVED | PRIMARY/SECONDARY |
| SLC_DEVICE_BRANCH | DERIVED | PRIMARY/SECONDARY |
| NAC_CIRCUIT_EXISTS | EXPLICIT | PRIMARY/SECONDARY |
| PANEL_SERVES_AREA | DERIVED | PRIMARY/SECONDARY (nearest-building geom) |
| PANEL_LOOP_RELATION | DERIVED | shared evidence line |
| INTERFACE_CONNECTED_TO_SYSTEM | EXPLICIT | PRIMARY/SECONDARY |
| EXTERNAL_SYSTEM_INTERFACE | EXPLICIT | PRIMARY/SECONDARY (Civil Defence) |
| PANEL_NETWORK_LINK | EXPLICIT | PRIMARY/SECONDARY |
| FIRE_ALARM_NETWORK_TOPOLOGY | DERIVED | requires ≥2 building assignments + ≥1 campus link |
| CROSS_SHEET_REFERENCE | EXPLICIT | PRIMARY |
| LAYOUT_LEGEND_LINK | EXPLICIT | SECONDARY (governed legend rows only) |

### 4.3 Bridge Channel Mapping (BRIDGE_FACT_SEMANTICS)

Every fact type maps to exactly one of 8 channels with `productCompatibility: false`, `protocol: false`:

| Fact Type | Channel |
|---|---|
| PANEL_EXISTS, PANEL_LABEL | PANEL_INVENTORY |
| SLC_LOOP_EXISTS, PANEL_LOOP_RELATION, SLC_LOOP_SERVES_AREA, SLC_DEVICE_BRANCH | CIRCUIT_BUS |
| NAC_CIRCUIT_EXISTS | NAC_CIRCUIT |
| PANEL_SERVES_AREA | AREA_COVERAGE |
| PANEL_NETWORK_LINK | PANEL_NETWORK |
| FIRE_ALARM_NETWORK_TOPOLOGY | PANEL_NETWORK |
| INTERFACE_CONNECTED_TO_SYSTEM, EXTERNAL_SYSTEM_INTERFACE | SYSTEM_INTERFACE |
| LAYOUT_LEGEND_LINK | LEGEND_LINKAGE |
| CROSS_SHEET_REFERENCE | CROSS_SHEET_RESOLUTION |

→ **ARCHITECTURE_DISCREPANCY** → never bridged (folded 1:1 into CROSS_SHEET_REFERENCE exception)

---

## 5. Review/Governance Flow

### 5.1 Normal Workflow

```
POST /review/initialize
  → buildCandidateSets → extractArchitectureFacts + extractCrossSheetReferenceFacts + extractLayoutLegendFacts
  → store drawing_architecture_review_cases (status: Needs Review)

POST /review/evaluate (dry-run)
  → decideArchitectureFact (hard ladder: STALE → REJECTED → Engineer-review → Confirmed)
  → wouldConfirm, wouldRequireEngineer, wouldReject counts

POST /review/deterministic-confirm
  → promote eligible cases → UPDATE review_cases status=Approved
  → promoteApprovedArchitectureVersion (v1→v2 promotion)

POST /adjudication/evaluate (dry-run)
  → normalizeExceptionInventory (21→12)
  → adjudicateCrossSheetReference / adjudicateGenericFacp
  → recomputeArchitectureStatus + stage4 readiness

POST /adjudication/apply
  → persist adjudication rows (supersede-on-change, history kept)
  → write stage4_readiness row
  → approve primary review case per exception
  → promote next version (live: v1=116 → v2=128, idempotent on re-run)
```

### 5.2 Key Governance Invariants

- **Fingerprint guard:** `input_fingerprint`/`output_fingerprint` on `drawing_architecture_approved_versions`; same fingerprints → no re-promotion (idempotent)
- **Never a guess:** Adjudication always requires evidence; `MULTIPLE_CANDIDATE_TARGETS` → ENGINEER_REVIEW_REQUIRED; `NO_REGISTER_TARGET` → same
- **Strong-evidence ladder for FACP:** CONFIRMED_SAME_PANEL requires ≥1 observation + ≥3 strong anchors (unique topology, explicit building area, cross-sheet identity, source→target connections, loop ownership, served area anchors)
- **Bridge never feeds product matching:** All 8 channels have `productCompatibility: false`, `protocol: false` hard-constants
- **Unresolved evidence → UNKNOWN_PROJECT** (non-blocking, never FAIL)

### 5.3 Stage 4 Readiness

Single row in `drawing_architecture_stage4_readiness`:
- `architectureStatus`: COMPLETE / PARTIAL
- `stage4Readiness`: READY_FOR_STAGE4_BRIDGE / PARTIAL_NOT_READY
- Counts: unique_exception_count, cross_sheet_reference_count, generic_facp_count, remaining_engineer_review_required, remaining_confirm_project_reference, remaining_confirm_same_panel, resolved_count, mirrored_discrepancy_resolved

Current state (post-v2 promotion): COMPLETE / READY_FOR_STAGE4_BRIDGE, unique=12, resolved=12, mirrored_discrepancy_resolved=9, engineerReview=0

---

## 6. Downstream Connections

### 6.1 Bridge → Stage 4 Requirement Context

- **Verified read-only projection:** `GET /api/projects/:projectId/drawing-architecture/bridge` returns 128 evidence entries across 8 channels
- **PANEL_INVENTORY (13):** Panel identity / system confirmation context
- **CIRCUIT_BUS (24):** SLC loop addressing topology — **SLC is NOT protocol**
- **PANEL_NETWORK (18):** Panel-to-panel network topology — **not product compatibility**
- **SYSTEM_INTERFACE (26):** External system interface boundary
- **NAC_CIRCUIT (5):** Notification appliance circuit
- **AREA_COVERAGE (8):** Area / zone coverage
- **LEGEND_LINKAGE (25):** Symbol ↔ legend provenance
- **CROSS_SHEET_RESOLUTION (9):** Reference resolution provenance

### 6.2 What the Bridge Does NOT Touch

- **No product compatibility** — all channels have `productCompatibility: false`
- **No protocol vocabulary** — all channels have `protocol: false`
- **No FlashScan/CLIP** — never emitted in bridge output
- **No technical-requirement-profile folding** — SLC/panel-network/interface facts remain architecture evidence, not product surface
- **No pricing/quotation writes** — bridge performs zero writes; golden/heat-detector decision unchanged

### 6.3 Consumer Reality (from Audit)

> "The bridge is produced and GET-exposed, but NO Stage 4 consumer reads it." Only `drawing-architecture-review-api.mjs` calls the bridge-building functions; no profile/matcher/requirement-context module references the bridge endpoint. This is the acknowledged gap — the bridge is projection-ready but consumer-wiring is the next step.

---

## 7. What Currently Works (🟢)

| Capability | Status | Evidence |
|---|---|---|
| PDF text extraction on architecture sheets | 🟢 | `extractArchitectureFacts` runs deterministically |
| Panel existence & labeling | 🟢 | 13 PANEL_INVENTORY entries in bridge |
| SLC loop existence | 🟢 | 24 CIRCUIT_BUS entries in bridge |
| Loop serves-area assignment | 🟢 | Deterministic nearest-building with distance threshold |
| Cross-sheet reference detection | 🟢 | DR-less convention + corpus proof validated |
| Legend matching against T-00 rows | 🟢 | 25 LEGEND_LINKAGE entries in bridge |
| Adjudication 21→12 normalization | 🟢 | Verified deterministic; all 12 exceptions stably resolved |
| Version promotion v1→v2 | 🟢 | Fingerprint-guarded; idempotent re-runs |
| Bridge projection 128 entries | 🟢 | All 8 channels populated; zero protocol/compat leakage |
| Golden Heat Detector preservation | 🟢 | Bridge test 7: gate passed, no matching-engine surface change |
| Strict "never a guess" adjudication | 🟢 | MULTIPLE_CANDIDATE_TARGETS → ENGINEER_REVIEW_REQUIRED never bypassed |

---

## 8. What is Partial / Limited (🟡)

| Capability | Limitation | Notes |
|---|---|---|
| Symbol comparison across drawings | Structural only | `handleDrawingSymbolRecognitionApi` processes extracted text, not pixel-level comparison; governed legend rows are the identity authority |
| Coordinate/geometry inference | Bbox used only for spatial assignment | Nearest-building assignment uses distance ≤200 units; no line or connection inference from geometry |
| Quantity takeoff | Not implemented | Pipeline explicitly states "no quantity claim without explicit takeoff evidence" — counts are not extracted |
| OCR for image-only pages | Not supported | Text assets required; image pages would need transcription (Step 2.5 in graphify) |
| Cross-discipline panel resolution | T-00/E-00 guard only | `disciplineSeriesFromDrawingNumber` guards T-00 vs E-00 but not broadly applied |
| Direct legend-aware symbol detection | Legend rows only | `extractLayoutLegendFacts` only matches governed rows; no ad-hoc symbol identification |
| Fire alarm system across disciplines | Domain-scoped | `scope: FIRE_ALARM` but discipline guards prevent E-00 citations for T-00 references |

---

## 9. What is Missing (🔴)

| Missing Capability | Impact | Why It's Absent |
|---|---|---|
| Quantity/takeoff extraction | Cannot answer "how many panels/loops/circuits" from drawings | Explicitly out of scope; pipeline produces evidence facts but no counts |
| Geometric line/connection inference | Cannot trace connectivity between symbols | Hard rule: "connection fact requires an explicit textual statement" |
| Image/OCR processing | Missing entirely for image-only drawings | Pipeline requires Text assets; would require Step 2.5 video/audio transcription |
| Adjudication for non-FACP panels | Only FACP strong-evidence ladder implemented | Other fact types have simpler rules; no multi-entity identity resolution |
| Dynamic legend governance | Governed rows are static (15 T-00 entries) | No mechanism for adding/removing legend rows at runtime |
| Multi-project discipline resolution | Project-specific `-DR-` convention | Convention is project-observed (22 DR-less, 0 DR); not generalized |

---

## 10. Implemented But Disconnected

| Feature | Implemented | Disconnected From |
|---|---|---|
| Stage 4 bridge projection | 🟢 Fully implemented | No Stage 4 consumer reads it (acknowledged gap) |
| Adjudication 21→12 normalization | 🟢 Fully implemented | No auto-application to new corpora without re-run |
| Bridge fingerprint idempotency | 🟢 Stable SHA-256 fingerprint | No consumer wiring to assert on |
| Governed legend rows (15 T-00) | 🟢 Stored in DB | Not exposed via API for downstream editing |
| Decision ladder (STALE→REJECTED→Review→Confirmed) | 🟢 Code complete | No UI workflow built around the ladder states |
| DR-less citation convention proof | 🟢 Corpus validated (22/0) | Not generalized beyond this project |

---

## 11. Major Reliability/Freshness Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Intake version drift | Medium | Facts become stale if `intakeVersionId` changes without re-extraction | Fingerprint guard in promotion, but depends on correct tracking |
| DR-less citation convention break | Low | Reference adjudication collapses if corpus cites `-DR-` forms | Project-specific convention; 22 DR-less / 0 DR is stable observation |
| FACP identity ambiguity | Medium | Generic FACP symbols without location evidence require engineer review | Strong-evidence ladder is strict (≥3 anchors required); weak evidence → ENGINEER_REVIEW_REQUIRED |
| Superseded version propagation | Low | v1→v2 promotion could diverge if fingerprints mismatch | Fingerprint guard: same input/output → no re-promotion |
| Legend row governance | Medium | If T-00 rows change, all downstream depends on re-extraction | No auto-update; governed rows must be manually maintained |
| Cross-project generalization | Low | `-DR-` convention, discipline guards are project-observed | Not designed for multi-project use; each project has its own convention |

---

## 12. Minimum Implementation Sequence to Trustworthy Drawing-Driven Decisions

To reach a state where drawing evidence can drive engineering decisions with trustworthy evidence, implement in this order:

### Phase 1 — Foundation (Already Complete)
1. ✅ Document upload + classification (riser/schematic detection)
2. ✅ Text extraction from PDFs on architecture-authoritative sheets
3. ✅ Panel existence/label extraction with explicit identity patterns
4. ✅ Loop existence and serves-area assignment with deterministic geometry
5. ✅ Cross-sheet reference detection with DR-less convention
6. ✅ Governed legend row matching (T-00 FIRE ALARM symbols)
7. ✅ Adjudication 21→12 exception normalization (evidence-only)
8. ✅ Version promotion v1→v2 with fingerprint guard
9. ✅ Bridge projection 128 entries across 8 hard-gated channels

### Phase 2 — Missing Capabilities (Not Yet Implemented)
10. 🟡 Quantity/takeoff evidence (explicit NOT implemented — "no quantity claim without explicit takeoff")
11. 🟡 Geometric connection inference (explicitly ruled out — "connection fact requires explicit textual statement")
12. 🟡 Image/OCR processing for image-only pages

### Phase 3 — Consumer Wiring (Acknowledged Gap)
13. 🟡 Wire bridge as read-only input to Stage 4 requirement/context consumers (bridge is projection-ready; no profile/matcher currently reads it)
14. 🟡 Add legend governance API (currently stored in DB only; no edit/update surface)
15. 🟡 Multi-project generalization (currently project-specific `-DR-` convention and discipline guards)

### Phase 4 — Confidence Enhancements
16. 🟡 Freshness monitoring (currently manual re-run; no auto-detection of stale evidence)
17. 🟡 Cross-discipline panel resolution beyond T-00/E-00 guard
18. 🟡 Audit trail for bridge evaluations (fingerprints tracked but not surfaced in consumer UI)

---

## 13. Final Verdict

**DRAWING INTELLIGENCE PARTIAL**

### Rationale

The core drawing intelligence pipeline is **solid and end-to-end for its scoped purpose**: Fire Alarm engineering drawings from riser/schematic sheets can be classified, facts extracted, adjudicated, and projected onto 8 governed evidence channels with hard incompatibility prohibitions. The adjudication logic is strict (never a guess), the bridge projection is deterministic and idempotent, and the golden Heat Detector decision is preserved across all stages.

However, the pipeline **does not** implement:
- **Quantity/takeoff extraction** (explicitly out of scope but is the most common user ask)
- **Geometric connection/inference** (connections require explicit text, not geometric inference)
- **Image/OCR processing** (not supported; Text assets required)
- **Cross-project generalization** (project-specific conventions)

The architecture is **ready for fire-alarm drawing-driven decisions** within its scope (panel identity, loop topology, cross-sheet references, legend linkage), but **unsafe** if used for quantity claims, connectivity inference, or multi-discipline generalization without explicit evidence.

### Key Distinctions (reiterated per requirements)

1. ✅ **Reading a legend** → WORKS (governed row matching, 25 LEGEND_LINKAGE entries in bridge)
2. ✅ **Extracting a legend symbol** → WORKS (symbol definitions in governed rows, segmentSymbolCell segmentation)
3. ❌ **Comparing a candidate symbol** → PARTIAL (structural matching only; no cross-drawing comparison)
4. ❌ **Detecting symbols across actual drawings** → PARTIAL (extracted text/assets only; no pixel-level or structural comparison across full drawings)
5. ❌ **Knowing their coordinates/location** → PARTIAL (bbox tracked but used only for nearest-building assignment, not general location queries)
6. ❌ **Counting them** → 🔴 NOT IMPLEMENTED (no quantity takeoff capability)
7. ❌ **Turning detections into governed engineering evidence** → PARTIAL (evidence facts extracted but no quantity/count evidence)
8. ❌ **Using that evidence downstream** → PARTIAL (bridge projection works but no consumer wiring; not fed to product matching)

---

## 14. Graphify Discovery Summary

Graphify was run on the repository and produced:

- **7415 nodes · 16443 edges · 439 communities**
- **7 files · ~1,828,475 words** (mixed code, docs, configs)
- **Token cost: 0 input · 0 output** (pure structural extraction)
- **1% INFERRED** (169 edges, avg confidence 0.85)

Key drawing-related communities discovered:
- **Community 168** (6 nodes): Drawing architecture bridge — `bridgeSemanticsFor`, `buildDrawingArchitectureBridge`, `BRIDGE_CONSUMER_CHANNELS`, `BRIDGE_FACT_SEMANTICS`
- **Community 101** (nodes): Drawing architecture intelligence — `extractArchitectureFacts`, `resolveCrossSheetPanelIdentities`, `detectArchitectureDiscrepancies`
- **Community 119** (nodes): Drawing adjudication — `adjudicateCrossSheetReference`, `adjudicateGenericFacp`, `normalizeExceptionInventory`
- **Community 35** (nodes): Stage 4 drawing architecture context — `buildStage4DrawingArchitectureContext`, `bootstrapBridged`
- **Community 169** (nodes): Legend notes intelligence — `buildLegendDefinitionProposals`, `buildLegendNotesIntelligence`
- **Community 170** (nodes): Symbol cell segmentation — `segmentSymbolCell`, `handleSymbolCellSegmentationApi`
- **Community 177** (nodes): Drawing symbol recognition — `handleDrawingSymbolRecognitionApi`, `drawing_symbol_engine_version`
- **Community 194** (nodes): Decide drawing fact — `decideDrawingFact`, `isAutoConfirmEligible`
- **Community 210** (nodes): Drawing requirement evidence engine — `buildDrawingDeviceIdentityRequirement`, `buildDrawingRequirementEntries`

Graph health: OK — no dangling/missing/collapsed edges detected in the diagnostic run.

---

STOPPED