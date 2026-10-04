# DRAWING RECOVERY STEP 14.2 — STRUCTURE PARSE VERIFICATION

## 1. EXECUTIVE STATUS

**STRUCTURE_HALF_NOT_READY**.

The existing structural parser on T-00 (Fire Alarm legend sheet, `doc_0de6f58b`) does **not** produce per-symbol legend rows. Zero legend rows were created (legendRowCount: 0). The Fire Alarm legend text exists only in the output's Notes region as unstructured free-form text fragments, not as structured legend rows with symbol-cell geometry. The canonical geometry half needed for deterministic text↔geometry joining is absent. The join cannot proceed until the parser produces per-entry legend rows, which requires either a parser code change or an alternate code path.

## 2. PRE-RUN STATE (T-00, before parser execution)

| Item | Value |
|---|---|
| **Document** | `doc_0de6f58b-7b48-46a2-92d3-aaef230c92b0` |
| **Logical name** | `2401232-PC-AMS-DR-T-00-ZZZ-002.pdf` |
| **Project** | `project_c0123d91-c30b-4956-87cb-e473ef53f89d` |
| **Current version** | `ver_47d5b443-74a1-4643-a29f-c8f7b4fdc5e6` (v1) |
| **Quarantine status** | `Scan Hook Pending` |
| **Drawing status** | `UNKNOWN` |
| **Intake version** | `drawingIntake_57719080-1ce0-4a11-833a-311f213efcd1` (v1, Completed) |
| **Page dimensions** | 3370×2384 (landscape), rotation 0, coordinate_mode: Vector Coordinates Available |
| **Structural versions** | 0 (none) |
| **Structure tables** | 0 (none) |
| **Structure legend rows** | 0 (none) |
| **Structure rows** | 0 (none) |
| **Structure cells** | 0 (none) |
| **LegendDefinition proposals** | 26, all `Needs Review`, all with text+bbox in 2384×3370 portrait space, visual-run provenance |
| **Visual runs** | 0 (none) |
| **Extraction method** | `Visual Fire Alarm legend row transcription` |
| **H-proposals** | 2 (raw_label='H', HEAT DETECTOR) |
| **Legend entries (intake)** | 5 (in 1 legend), text-only, no geometry |

## 3. PARSER EXECUTION

| Item | Value |
|---|---|
| **Endpoint invoked** | `POST /api/documents/doc_0de6f58b-7b48-46a2-92d3-aaef230c92b0/drawing-structure/start` |
| **Parser version** | `drawing-structural-parser-1.6.0` |
| **Execution status** | Completed (status=Completed in output) |
| **Error/warnings** | None |
| **Idempotent** | false (new version created) |
| **Version created** | `drawingStructure_a178ba69-0697-493f-b3f9-3f1872671a8e`, version_number=1 |

## 4. NEW STRUCTURE VERSION OUTPUT

**1 structure version**, **1 table**, **2 rows**, **2 columns**, **2 cells**, **0 legend rows**, **3 regions**.

### Tables
- `drawingTable_ba8583f2-adcf-472d-a5c7-8f6d693a3776`, type: **Title Block**, page 1, bbox (1768.2, 2912.4, 615.8, 457.6), row_count=2, column_count=2, confidence=93

### Rows
- `drawingRow_1681a830-ef73-4996-a990-142f0e990e82`, row_number=1, bbox (1820.76, 3062.39, 229.85, 15.94), confidence=86, status: Complete
- `drawingRow_5327daf6-6bab-4b3e-a133-1c6425c81a1b`, row_number=2, bbox (2083.2, 3062.16, 248.08, 11.89), confidence=86, status: Complete

### Columns
- Column 1: header "PROJECT TITLE", width 229.85
- Column 2: header "SHEET TITLE", width 248.08

### Cells
- Cell (1,1): raw+reconstructed = "QUALITY CARE EDUCATION COMPANY ALMOOSA K12"
- Cell (2,2): raw+reconstructed = "PROJECT NUMBER 2401232 STAGE 5 AO SOURCE FILE <2401232-PC-AMS-M3-E-ZZ-ZZZ-001 >"

### Headers
- Header col2: type "drawingTitle", raw "SHEET TITLE"
- Header col1: type "projectName", raw "PROJECT TITLE"

### Legend Rows
- **count: 0** — no per-symbol legend rows produced

### Regions (3)
1. **Callout** (region_key p1:Callout:fc5f1711): Text about HDMI, USB-C, XLR, power duplex, compartment floor box. Confidence 80.
2. **Notes** (region_key p1:Notes:1a81bbd8): Full text starting "GENERAL NOTES\n1.\n2.\n...\n35.\n36.\n...MOC CONNECTION\n1.\nDESCRIPTION\nDESCRIPTION\nLIGHTING CONTROL PANEL\nFOR INTERCOM\nPROJECTOR\nFOR CAMERA\nFOR FIRE ALARM CONTROL PANEL\nACCESS CONTROL PANEL\nFOR BMS\nFOR DIGITAL SIGNAGE..." (35+ numbered items, description fragments). Confidence 84.
3. **Title Block** (region_key p1:Title Block:ba527a4f): SCALE, CLIENT, PROJECT TITLE, SHEET TITLE, DRAWING NUMBER. Confidence 93.

## 5. FIRE ALARM LEGEND DETECTION

The parser **did not identify** the Fire Alarm legend as a structured legend table. The output table is type "Title Block", not "Legend". 

- No SYMBOL/DESCRIPTION headers were detected
- No per-symbol legend rows were produced (legendRowCount: 0)
- The Fire Alarm legend text IS present in the **Notes region** as unstructured text fragments (35+ items including references to "FIRE ALARM CONTROL PANEL", various descriptions, and legend-entry-like text)

**H = HEAT DETECTOR** trace:
- **Proposal side**: 2 proposals with raw_label='H', both HEAT DETECTOR, in 2384×3370 portrait space with rotation 90°, from visual-run `drawingCandidateRun_03781c60-15a8-4eab-97ca-6d37a1ff9f8b` (6 runs) and `drawingCandidateRun_70cc7176-8fee-4e04-ac8e-2ca6204df210` (20 runs). Bbox (575.9, 897.9, 19.1, 366.2) and symbol bbox (575.9, 943.6, 19.1, 41.2). Proposal text "HEAT DETECTOR", section "FIRE ALARM SYSTEM".
- **Structure side**: **NOT FOUND** — no structure legend rows exist. The Notes region contains text fragments that reference fire alarm system content, but these are not structured as legend rows with symbol-cell geometry. No SYMBOL/DESCRIPTION headers were detected in the table reconstruction.

**Classification**: `STRUCTURE_NOT_FOUND` for per-entry legend rows.

## 6. GEOMETRY QUALITY

| Aspect | Result |
|---|---|
| Proper per-symbol legend rows | **ABSENT** (legendRowCount: 0) |
| Mega-rows containing multiple entries | N/A (no legend rows at all) |
| Fragmented cells | 2 title-block cells only |
| No meaningful legend structure | **CONFIRMED** |

The parser produced a Title Block table with 2 rows/2 columns/2 cells, 3 regions (Callout/Notes/Title Block), and zero legend rows. The Notes region contains fire alarm–related text but as unstructured fragments without SYMBOL/DESCRIPTION header classification.

## 7. PROPOSAL VS STRUCTURE COMPARISON (READ ONLY)

| Dataset | Key Fields |
|---|---|
| **Existing proposals** (26 LegendDefinition) | page=1, 2384×3370 portrait, rotation 90°, text (e.g. "H = HEAT DETECTOR"), bbox, symbol bbox, confidence from visual-run, provenance (run id, model, page, rotation) |
| **New structure output** | 1 Title Block table, 2 rows/2 cols/2 cells, 0 legend rows, 3 regions (Callout/Notes/Title Block), Notes contains fire alarm text fragments but unstructured, native 3370×2384 landscape, rotation 0 |
| **Overlap** | None — the two datasets contain complementary text (proposals have labeled legend entries; structure has Notes with free-form text) but **zero shared geometry rows**. No document holds both representations. |

## 8. DETERMINISTIC JOIN ASSESSMENT

**BOTH_HALVES_PRESENT**: ❌ No. Zero legend rows produced by the parser. The structure half for the join is absent.

**STRUCTURE_PRESENT_BUT_BAD_GRANULARITY**: ⚠️ Partially — the Notes region has fire alarm text fragments, but these are not structured as per-symbol legend rows with symbol-cell geometry. The parser would need a code change to produce such rows.

**STRUCTURE_PRESENT_BUT_TEXT_MISSING**: ❌ No — text is present in the Notes region.

**STRUCTURE_NOT_FOUND**: ✅ **CONFIRMED** — no per-symbol legend rows exist in the structural output.

## 9. IDENPOTENCY / VERSIONING

- New structure version created: v1 (fingerprint f13bcf7fb68e454aae246db34ef170c41597792b75e4e43cc2118ec6088f8b98)
- Input fingerprint: 1c0121b2e2844ed579bb883fb4c0170df2d747d2004bfb3fbe62456b95dde92e
- Parser is deterministic on same input (idempotent check runs on next invocation)
- No downstream recomputation triggered by this step alone
- The new version coexists with prior (none existed), does not supersede anything

## 10. DOWNSTREAM STALENESS RISK

- **Low for this step alone**: The structure parser is a read-pipeline stage; inserting a new version with fingerprints changes downstream profile inputs, but no profile/matching recompute was triggered.
- **Content gap**: The absence of legend rows means the drawing→profile→matching path still receives zero drawing evidence from T-00. The new version's fingerprints differ from the "no-version" baseline, which could cause fingerprint-mismatch detections in later profile recomputes.
- **No ad-hoc SQL or governance mutations were performed**.

## 11. DECISION GATE

**STRUCTURE_HALF_NOT_READY**

Reason: The existing structural parser on T-00 does not produce per-symbol legend rows. legendRowCount: 0. The Fire Alarm legend text exists only in the Notes region as unstructured text fragments, not as canonical legend rows with symbol-cell geometry. The deterministic text↔geometry join cannot be established without the geometry half.

The structural parser limitation: it classifies tables by type (Title Block vs Legend) and only produces legend rows when SYMBOL/DESCRIPTION headers are detected in the table reconstruction. For this Fire Alarm sheet, the parser detected a Title Block and a Notes region but did not trigger the legend-row code path. Fixing this would require either:
1. A parser code change to recognize and structure the Notes-region fire alarm legend as legend rows, OR
2. An alternate code path that extracts legend rows from the Notes-region text using a different heuristic.

Neither option is implemented or tested as part of this read-only verification.

## 12. SINGLE NEXT RECOMMENDED ACTION

**Do not proceed to inverse coordinate mapper, join logic, review initialization, or any governed mutation** until the structural parser produces per-symbol legend rows for T-00 (or an alternate code path is implemented). The read-only verification in Step 14.1 already established LEGEND_JOIN_NOT_SAFE; Step 14.2 confirms the structure half remains unavailable. The path to LEGEND_JOIN_READY requires a parser extension or code change before any join automation can work.

If the team determines that producing legend rows from the Notes-region fire alarm text is a priority, the next step would be to examine `app/domain/drawing-structural-parser.mjs` for the legend-row production code block (around lines 82-93 and 154) and determine whether a targeted change could add legend-row output for sheets where the table type is not "Legend" but the Notes region contains legend-text. This would be a code change, not a data change, and belongs to the engineering team — not part of this read-only audit.

**End of report.**