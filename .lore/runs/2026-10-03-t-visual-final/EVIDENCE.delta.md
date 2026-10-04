# Run 2026-10-03 — Final T visual verification attempt + review package

## A. T CONFIDENCE CORRECTED
- EV-FT-001 | tokens | correction | Previous report called all 73 occurrences "verified". That was wrong and is corrected. T_VISUALLY_VERIFIED = 25 (BOS only). T_STRUCTURALLY_CORROBORATED = 48 (GRS 25 + KGS 23). T_UNVERIFIED = 6 (WLC).
- EV-FT-002 | tokens | finding | BOS visual verification stands: BOS-T-cluster.png shows each T as a square containing a filled dot, labelled T, drawn on a vertical riser line with dashed segments above. Plan-view riser device symbol, not legend and not annotation.

## B. GRS / KGS VISUAL VERIFICATION NOT ACHIEVED
- EV-FT-003 | tokens | blocker | Rendered GRS and KGS T regions twice each, at governed coordinates and at clamped/clamped-variants. All crops returned BLANK. The governed asset coordinates do not map to the rendered viewport for these sheets, so the mapping was not proven and no classification was asserted from them.
- EV-FT-004 | tokens | blocker | WLC likewise unverified. WLC is /Rotate 90 with viewport.transform [0,1,1,0,0,0] (axes swapped) and page.view [0,0,2384,3370]. Its mapping was not established either. All six WLC T occurrences remain UNVERIFIED per the instruction not to guess.

## C. ROOT CAUSE OF THE RENDER FAILURES (established, not resolved)
- EV-FT-005 | infra | finding | drawing_assets.bounding_box and the pdf.js render viewport are in DIFFERENT coordinate spaces on these sheets. BOS/GRS/KGS page.view = [-1685.28,-1192.08,1685.28,1192.08] (negative origin); WLC page.view = [0,0,2384,3370] with /Rotate 90. The intake engine normalises asset boxes; that normalisation is NOT the pdf.js viewport transform.
- EV-FT-006 | infra | finding | A single crop (BOS T at governed 2087..2200, 1090..1276) rendered correctly, so SOME governed coordinates behave as viewport-space while others do not. The distinguishing rule was NOT determined. This is an unresolved infrastructure question, recorded rather than papered over.
- EV-FT-007 | infra | finding | Blank crops are INVALID evidence, not evidence of absence. All blank artifacts were moved to out/review-packet/INVALID/ with a README recording the root cause, so a later reader cannot mistake them for negative findings.

## D. PACKAGE
- EV-FT-008 | review | evidence | out/review-packet/FINAL-REVIEW-PACKAGE.md is the reviewer-facing package. Valid visual evidence only: BOS-T-cluster.png, BOS-F-contact.png, legend-f-pair.png. It states up front that no visual verification exists for GRS, KGS or WLC.
- EV-FT-009 | review | evidence | Seven unresolved decisions A-G each carry sheet/count/structure/available governed candidates/why-deterministic-mapping-failed, a decision form with four unselected options plus reviewer reason, and a quantity unlock matrix stating explicitly that the decision affects PHYSICAL DRAWING QUANTITY only and does not determine SLC address demand, product selection, panel allocation or panel sizing.
- EV-FT-010 | review | flag | NO semantic answer is proposed for any unresolved structure. AUTOMATIC_SEMANTIC_INFERENCE_EXHAUSTED = YES.
- EV-FT-011 | flags | flag | T_QUANTITY_READY = PARTIAL. T_VISUALLY_VERIFIED_DEVICE_QTY = 25. T_STRUCTURAL_ONLY_QTY = 48. T_UNVERIFIED_QTY = 6. WLC_COORDINATE_MAPPING_VERIFIED = NO. F_VARIANT_AUTHORITY_PERSISTED = NO. SH_GOVERNED_RECOGNITION = NO. APPROVED_DRAWING_QUANTITY_AUTHORITY_READY = NO. READY_FOR_PANEL_ALLOCATION_FROM_DRAWINGS = NO.
- EV-FT-012 | flags | note | LOCAL_D1_SCHEMA_APPLY_PATH remains UNVERIFIED. drizzle/, db/schema.ts, canonical D1 and migrations untouched. No direct SQL, no SLC/address work, no sizing, pricing or quotation.
