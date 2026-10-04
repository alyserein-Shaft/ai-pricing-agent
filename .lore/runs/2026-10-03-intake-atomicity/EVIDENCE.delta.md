# Run 2026-10-03 — Drawing intake atomicity final repair

## A. D1 batch contract (disposable in-memory Miniflare ONLY)
- EV-DIA-001 | drawing-intake | finding | Real D1 batch() THROWS on a failing statement. Confirmed FK violation, NOT NULL violation, and empty batch all reject with D1_ERROR. Nothing is persisted. Batch is atomic.
- EV-DIA-002 | drawing-intake | finding | miniflare batch() behaviour matches the documented contract for the throwing shape. The non-throwing success:false shape was NOT observed on miniflare but is still guarded in the repair so a runtime difference cannot reintroduce false success.
- EV-DIA-003 | safety | finding | Canonical Al Mousa D1 was never used for a destructive or error-path probe after the user prohibition. All error-path work used in-memory Miniflare or a disposable byte-level copy, deleted per scenario. Canonical count was 32 before and 32 after probing.

## B. FALSE-201 ROOT CAUSE
- EV-DIA-004 | drawing-intake | finding | TRUE root cause is UNCHECKED BATCH RESULTS, not SQL arity. persist() did `await env.DB.batch(...)` and ignored the returned D1Result objects entirely, then unconditionally ran the Completed transition and returned 201.
- EV-DIA-005 | drawing-intake | finding | Reproduced on a disposable copy with a non-throwing batch: HTTP 201, status Completed, pages=1 assets=305 search=0. Extraction had produced 179 search entries, so the 201 was false.
- EV-DIA-006 | drawing-intake | finding | The existing test shim in tests/drawing-extraction-api.test.mjs wraps batch in BEGIN IMMEDIATE/COMMIT and REthrows, which is STRICTER than the non-throwing contract. That is why a passing suite never reproduced this defect. The shim was not weakened; a D1-faithful adapter was added alongside.
- EV-DIA-007 | drawing-intake | finding | A rejecting batch also left the intake stranded in Processing forever, because the raw rejection escaped as a 422 extraction failure and never reached a Failed-state transition.

## C. persist() REPAIR
- EV-DIA-008 | drawing-intake | fix | assertBatch() wraps every child batch. It validates result exists AND result.success === true for every statement, and converts BOTH a rejection and a success:false result into one canonical DRAWING_INTAKE_PERSISTENCE_FAILED error.
- EV-DIA-009 | drawing-intake | fix | Success is asserted positively. A result with no success property is treated as UNPROVEN and fails closed, because absence of a failure marker is not evidence of success. This was proven: node:sqlite run() returns only changes,lastInsertRowid with no success field.
- EV-DIA-010 | drawing-intake | fix | Diagnostics carry statement index, target table, driver code and driver message. Bound values are never included, so drawing text cannot leak. Asserted by a test.

## D. POST-WRITE INVARIANTS
- EV-DIA-011 | drawing-intake | fix | verifyPersistedChildren() queries the canonical tables directly before Completed and compares persisted vs expected for pages, assets, search entries and legends. It also verifies project_id, document_id and document_version_id on the parent row.
- EV-DIA-012 | drawing-intake | fix | Extraction producing zero children is accepted only when it genuinely produced none. An expected>0 actual=0 mismatch fails closed with an explicit reason.

## E. FAILURE LIFECYCLE
- EV-DIA-013 | drawing-intake | fix | A persistence failure marks the intake Failed via markIntakeFailed instead of leaving it Processing. Marking is best-effort and never masks the thrown error.
- EV-DIA-014 | drawing-intake | fix | Persistence failure returns HTTP 500 with code DRAWING_INTAKE_PERSISTENCE_FAILED, distinguished from extraction failure HTTP 422 DRAWING_INTAKE_FAILED. Never 201.

## F. ACCEPTANCE TESTS
- EV-DIA-015 | drawing-intake | test | tests/drawing-intake-atomicity.test.mjs, 10/10 pass. Covers positive under both batch shapes, negative throwing, negative success:false, negative silent-drop, missing success flag, failure lifecycle, and document/version binding.
- EV-DIA-016 | drawing-intake | test | Mutation proven. Removing assertBatch wrapper => 4 failures. Removing post-write verification => 1 failure. Skipping only the search-entry child writes => 3 failures. Weakening success!==false to success===true => 1 failure after the new guard test. Dropping markIntakeFailed => 1 failure.
- EV-DIA-017 | drawing-intake | lesson | The test harness needed two corrections before it tested anything real: identity is SERVER-configured via APP_USER_ID/APP_ORGANIZATION_ID and request headers are deliberately ignored, and project_members needs status and revoked_at columns for resolveProjectAuthority. Passing identity headers produced a 404 that looked like a handler failure.
- EV-DIA-018 | drawing-intake | note | drawing-extraction-api (10 fail) and drawing-intake-engine (1 fail) fail because drizzle/ is entirely absent from the shared dirty tree, 81 migrations deleted by another lane. Neither imports the changed code path and neither reaches persist(). Pre-existing, not a regression from this change.

## G. GOVERNED INTAKE (legitimate canonical writes, after tests passed)
- EV-DIA-019 | drawing-intake | evidence | GRS intake drawingIntake_7ddfc0f7-6e6b-4494-b9d0-af10cd6bc188, document doc_232a1706, version ver_8642f321, HTTP 201 Completed, pages=1 assets=305 search=179 classifications=3 metadata=1 legends=0 audit=1. Source sha256 de83180667b7b396261434fa2d291ed006cf5ae17e6b8be7789a3e542094f5f4, 557062 bytes. Binding verified.
- EV-DIA-020 | drawing-intake | evidence | KGS intake drawingIntake_f53fc7da-3ee2-4e4c-9fd0-5caf9c7093e4, document doc_a1b176a5, version ver_80a3a240, HTTP 201 Completed, pages=1 assets=291 search=172 classifications=3 metadata=1 legends=0 audit=1. Source sha256 3b33f10f9c30b6895f6af88eb491eb8704c81f42dc1384dd48dc30eab78dae03, 553080 bytes. Binding verified.
- EV-DIA-021 | drawing-intake | evidence | Also ingested the four referenced sources: ELV legend AMS-DR-T-00-ZZZ-002 (assets=506), AMS-T-93-ZZZ-001 (96), GRS-T-94 (65), KGS-T-91 (113). Canonical intakes went 32 to 38, all Completed, zero FK violations.

## H. ELV LEGEND SOURCE - LOCATED BY GEOMETRY
- EV-DIA-022 | drawing-intake | finding | The note "1. FOR ELV LEGENDS, GENERAL NOTES & ABBREVIATIONS REFER" is a WRAPPED line. Its continuation sits at x=1385 y=644 directly below the note at x=1376 y=653, and reads "DWG NO. 2401232-PC-AMS-T-00-ZZZ-002". That is the reference target, established from geometry rather than filename guessing.
- EV-DIA-023 | drawing-intake | finding | That drawing is document doc_5244a162, version ver_7bed68bc, 346120 bytes, sha256 a79cc10d1bc8bb3b4270c240137b289577c7d3977cc9f7bcaf2b2500cad4e400.

## I. CLASS SEMANTICS - STILL UNRESOLVED, AND NOW EXHAUSTIVELY
- EV-DIA-024 | drawing-intake | finding | The ELV legend sheet carries the codes S H C M CE D F T and also A TP DC FB1 ZIM FTCP FARP MFACP in its SYMBOL legend table at y 945-975, but it supplies NO descriptive text for them. Nearest-right-text yields only adjacent codes, never a meaning.
- EV-DIA-025 | drawing-intake | finding | The project specification 28 46 00 Rev 1 has an ABBREVIATIONS table on page 6 with 12 entries (CACF, MFACP, FACP, DGP, SLC, NAC, CPU, LED, LCD, GUI, RAU, FSCS). It defines PANEL and SYSTEM acronyms only. It contains zero bare S/H/C/M/CE/D/F/HC/T tokens.
- EV-DIA-026 | drawing-intake | finding | An exhaustive scan of all 21 project documents for a CODE-separator-meaning pattern returned 6 hits, all manufacturer manual text (S = SLC OUT terminals, T-tapping of SLC wiring). None is a project device-class definition.
- EV-DIA-027 | drawing-intake | finding | CONCLUSION: the class-code meanings are NOT present in any Al Mousa project source. Inferring S=smoke, H=heat, M=manual call point etc. from general fire-alarm convention is explicitly forbidden and was NOT done. DRAWING_CLASS_SEMANTICS_READY remains NO on evidence grounds, not effort grounds.
- EV-DIA-028 | drawing-intake | finding | Code T is now understood structurally even though semantically unresolved. It appears 25 times in BOS and 23 in KGS, always as a schedule class code in the same column position as S H C M CE D F, and once in the ELV legend symbol table. It is a schedule class code, not a marker. The parser must not add it until meaning is governed.

## J. SCHEDULE / QUANTITY STATE
- EV-DIA-029 | drawing-intake | evidence | Governed parser over all 9 ingested drawing sheets: BOS LEVEL_BAND_SUBTOTAL printed 560 component 568 disc 5; GRS LEVEL_BAND_SUBTOTAL printed 574 component 578 disc 5; KGS LEVEL_BAND_SUBTOTAL printed 23 component 522 disc 5; WLC LEVEL_COLUMN_STACK with no resolvable subtotal; AMS and T-9x sheets UNSUPPORTED_LAYOUT.
- EV-DIA-030 | drawing-intake | finding | KGS printed=23 vs component=522 is a 22x discrepancy and is almost certainly a parser defect, not a drawing discrepancy. Raw Nos. tokens in KGS sum to 1281 against 67 tokens in GRS and 1264 in BOS, so the quantities exist. This needs investigation before KGS quantities can be trusted. Recorded, NOT normalised.
- EV-DIA-031 | drawing-intake | finding | drawing_quantity_evidence_coverage still holds exactly 1 Partial row. No sheet was marked complete, correctly, because class semantics and the KGS discrepancy are unresolved.
- EV-DIA-032 | drawing-intake | finding | SLC population re-read from current authority: all items UNRESOLVED except one NOT_SLC family, SLC detector and module pools still empty, expected distribution 21 UNRESOLVED and 4 NOT_SLC_ADDRESS. Owned by Agent 3. 84 BOQ items approved_for_downstream.

## K. FLAGS
- EV-DIA-033 | drawing-intake | flag | D1_BATCH_FAILURE_MODE=THROWS (observed on miniflare); repair guards both shapes.
- EV-DIA-034 | drawing-intake | flag | DRAWING_INTAKE_ATOMIC=YES. FALSE_201_PATH_ELIMINATED=YES. GRS_KGS_INTAKE_READY=YES. ELV_LEGEND_SOURCE_RESOLVED=YES.
- EV-DIA-035 | drawing-intake | flag | DRAWING_CLASS_SEMANTICS_READY=NO (no project evidence exists). DRAWING_QUANTITY_EVIDENCE_READY=NO. SLC_RESOURCE_POPULATION_READY=NO. PANEL_ALLOCATION_READY=NO. ALL_REQUIRED_PANEL_SIZING_CURRENT=NO. READY_FOR_DOWNSTREAM_COMMERCIAL=NO.
- EV-DIA-036 | drawing-intake | note | AMS block identity: Block 1 = FROM MFACP@GRS / TO FACP@KGS, Block 2 = FROM MFACP@KGS / TO FACP@BOYS, Block 3 = FROM MFACP@BOYS / TO FACP@WLC. All three resolve to complete printed links. No human clarification is needed.
