# Run 2026-10-03 — Semantic closure: token reading, F variant, HC, KGS basement

## A. TOKEN READING (asked before meaning)
- EV-TOK-001 | tokens | finding | HC is ONE raw pdf.js item of width 8.7pt on BOS and GRS, at a 5.60pt gap from its left neighbour against a sheet median adjacent-glyph gap of 23.56pt (BOS) and 24.68pt (GRS). A split H+C would show a much larger gap. HC_TOKEN_READING = CONFIRMED.
- EV-TOK-002 | tokens | finding | HC occurs exactly once per sheet and on NO other sheet (KGS 0, WLC 0). Both occurrences sit mid-row between an S to the left and an S to the right, in the same column position on both sheets.
- EV-TOK-003 | tokens | lesson | The sheets do NOT share one coordinate convention. BOS/GRS/KGS have a NEGATIVE-origin MediaBox (view -1685,-1192..1685,1192) with a y-flip; WLC has /Rotate 90 with swapped axes. Cropping a render at text-extraction coordinates lands in blank space. Always map through page.getViewport().transform.

## B. F VARIANT — RESOLVED BY SYMBOL GEOMETRY
- EV-F-001 | legend | finding | The ELV legend renders two F cells with DIFFERENT art: x=649 FIRE ALARM MANUAL STATION has a SOLID square enclosure; x=668 FIRE ALARM MANUAL STATION (WEATHER PROOF) has a DASHED square enclosure. The dashed enclosure is the project marker for weatherproof.
- EV-F-002 | legend | finding | The schedule-side F cells carry the SAME solid-vs-dashed distinction, so every F is attributable. Read directly from rendered per-cell contact sheets: BOS 4 solid / 4 dashed; GRS 5 solid / 3 dashed; KGS 5 solid / 3 dashed; WLC 3 solid / 1 dashed.
- EV-F-003 | legend | evidence | F_STANDARD_OCCURRENCES = 17, F_WEATHERPROOF_OCCURRENCES = 11, F_AMBIGUOUS_OCCURRENCES = 0 across BOS, GRS, KGS, WLC.
- EV-F-004 | legend | finding | No textual marker distinguishes the variants: no F occurrence has a WP or WEATHER token within 120pt on its row. The distinction is purely visual, so text-only pipelines cannot see it.
- EV-F-005 | legend | lesson | My automated pixel classifier is NOT RELIABLE. Three successive attempts gave 28/0, 0/28 and 28/0 (solid/dashed), each contradicting the rendered contact sheets. Root causes: scanning a fixed row reads gaps inside the glyph; picking the widest-coverage row picks the lead-in line; sub-viewport rendering returned blank. DO NOT TRUST the script at out/semantic-closure/classify-f-symbols.mjs. The contact-sheet readings in EV-F-002 are the trustworthy evidence.
- EV-F-006 | legend | flag | F_RESOLVED = YES by symbol geometry. The two conflicting approved rows are NOT wrong; they describe two different devices that share a code and are distinguished visually.

## C. BARE C / M / CE / D
- EV-BAR-001 | legend | finding | Bare C, M, CE, D are TRUE_STANDALONE_CELLs in the schedules, not split-compound artifacts. They occupy their own columns with the sheet's normal class-code spacing, and the rendered legend shows compounds as CIRCLE+LETTER (S D, S H), a single drawn cell, not two adjacent text cells.
- EV-BAR-002 | legend | finding | Therefore no global text-joining rule may be applied, and no bare C/M/CE/D can be reconstructed into a compound from the schedule side. They remain meaning-unknown, not reading-uncertain.
- EV-BAR-003 | legend | note | Bare M in the schedules collides with legend columns at x=1141 and x=1505 which are PAGING MICROPHONE and MICROPHONE in the AUDIOVISUAL table, a different table on the same sheet. Matching bare M to those would be a cross-table error.

## D. HC
- EV-HC-001 | legend | flag | HC_TOKEN_READING = CONFIRMED. HC_MEANING = HUMAN_REVIEW_REQUIRED. Not a split of H+C, not a compound, not a misspelling that project evidence corrects. No legend column, no project source.

## E. S H
- EV-SH-001 | legend | finding | S H = SMOKE AND HEAT COMBINED DETECTOR is geometrically proven on the ELV legend at x=629 (S y956 over H y966, description dx=-1). It exists in the legend but has NO approved governed row.
- EV-SH-002 | legend | note | SH_LEGEND_GOVERNED remains NO. I did not approve it: the governed legend review path writes through a review route keyed to an existing recognition run, and manufacturing an approval row outside that route is precisely the direct-SQL the task forbids. It is reported as a ready candidate for the governed reviewer.

## F. KGS BASEMENT DISCREPANCY
- EV-KB-001 | schedule | finding | KGS BASEMENT 01: printed 144, component sum 57, delta 87. Band quantities are 2,2,1,9,5,2,2,1,33,2,144 (sum 203). Nine class-attributed subtotals sum to 57; two 2Nos. cells are unattributed; 144 is the selected row total.
- EV-KB-002 | schedule | finding | RULED OUT: the parser 900pt horizontal band window. Only ONE cell (6Nos. at x=127) is dropped, worth 6, not 87. Floors that reconcile exactly drop MORE (GROUND FLOOR drops 46, LEVEL 01 drops 33), so window truncation is not the anomaly.
- EV-KB-003 | schedule | finding | RULED OUT: compound handling, since compounds CE M and CE C are attributed normally on this same floor.
- EV-KB-004 | schedule | evidence | The gap remains an unexplained, preserved discrepancy. Neither 144 nor 57 was altered. No subset of the band quantities sums to 144 other than the trivial whole set.

## G. QUANTITY EVIDENCE MODEL LIMITATION
- EV-QM-001 | quantity | finding | drawing_quantity_evidence_coverage is a SINGLE aggregate row per (project_id, recognition_version_id) with columns id, project_id, recognition_version_id, coverage_state, reason, set_by, created_at. It CAN carry coverage_state = Partial (COVERAGE_STATES includes Partial, default Partial).
- EV-QM-002 | quantity | finding | It CANNOT carry the required partial-authority payload: no per-class INCLUDED_CLASS_CODES or EXCLUDED_UNRESOLVED_CLASS_CODES, no printed vs component totals per class, no per-sheet rows, no discrepancy or unresolved-cell columns. There is no per-class quantity evidence store anywhere in the 318-table canonical D1.
- EV-QM-003 | quantity | flag | DRAWING_QUANTITY_EVIDENCE_READY = NO for per-class partial authority. The existing single row remains truthfully Partial and was NOT modified. Writing a Partial row claiming proven-class quantities would be false authority the model cannot represent.

## H. NOTIFICATION ARCHITECTURE
- EV-NOT-001 | notification | finding | The project carries both NAC LOOP / conventional NAC evidence and LOOP POWERED STROBE WITH SOUNDER legend and cable evidence. WP is GOVERNED_AND_PROVEN as a device class. Whether a loop-powered appliance consumes an SLC address is NOT established by any project source, so strobe address demand is left unresolved in BOTH directions.
- EV-NOT-002 | notification | flag | LOOP_POWERED_NOTIFICATION_ARCHITECTURE = CONFLICT. This does not block the unrelated proven classes (S, H, T, CE C, CE M, S D).

## I. CURRENT SLC AUTHORITY (final re-read)
- EV-SEM-A3-001 | authority | finding | No persisted per-item SLC/address authority exists. Zero tables match slc, address, resource_pool or loop_alloc across all 318 tables, and NO column anywhere matches address-per / address_demand / pool. CURRENT_DETECTOR_POOL_AUTHORITY = EMPTY, CURRENT_MODULE_POOL_AUTHORITY = EMPTY, CURRENT_NOT_SLC_AUTHORITY = EMPTY. SLC_AUTHORITY_PERSISTENCE_BLOCKER = YES.
- EV-SEM-A3-002 | authority | finding | The persistence contract Agent 3 must satisfy: BOQ_ITEM_ID, DEVICE_OR_FAMILY, PHYSICAL_QTY, RESOURCE_POOL, ADDRESSES_PER_UNIT, TOTAL_ADDRESS_DEMAND, SOURCE, EVIDENCE_PROVENANCE, REVIEW_AUTHORITY, VERSION_CURRENTNESS. Physical quantity must stay separate from address demand.
- EV-SEM-A3-003 | authority | finding | Preserved address rules: Fireman Telephone Jack = physical device, 0 SLC addresses (now GOVERNED_AND_PROVEN as T). Door contact = passive, interface address separate. Combined monitor/relay = address demand from enabled addressed channels, not unit count. Manual station address pool only where manufacturer evidence supports it.

## J. PANEL TECHNICAL SELECTION (final re-read)
- EV-PAN-001 | selection | finding | All 7 panel BOQ items have a current match run (status Needs Review, 10 candidates each). NONE has a Technical approval: safety_approval_requests = 0.
- EV-PAN-002 | selection | finding | Per panel technical_eligibility: 1 FACP (boqitem_534f049e) = Human Review Required, Approval Ready with Warnings. The other 5 FACP and the MFACP = Technical Approval Disabled, safety Blocked, compliance Non-Compliant. The 7th item is Merged, approved_for_downstream=0, no match run, no safety decision.
- EV-PAN-003 | selection | flag | CURRENT_PANEL_SELECTION_READY_FOR_SIZING = NO. No panel has a granted Technical approval.

## K. FINAL STATE
- EV-FIN-001 | flag | FINAL_STATE_READ_AT = 2026-10-02T22:21:35Z. CURRENTNESS_STATUS = CURRENT (re-read immediately before reporting).
- EV-FIN-002 | flag | Sizing NOT executed. Gate matrix: Technical panel selection NO, drawing quantity authority NO (model cannot represent it), SLC address authority NO (never persisted), panel allocation NO. No snapshot manufactured.
