# Run 2026-10-03 — Legend semantics reconciliation + KGS parser repair

## A. LEGEND CONTRADICTION RESOLVED — MY EARLIER FINDING WAS WRONG
- EV-LEG-001 | legend | correction | My prior report said the ELV legend contains codes but NO descriptive text beside them, and that no project source defines S/H/C/M/CE/D/F/HC/T. That was WRONG. The descriptions ARE on the sheet, in a separate band at y=1025-1040, while the codes sit at y=945-975. My earlier check only looked for text at the same y as the code.
- EV-LEG-002 | legend | finding | The legend is a TWO-BAND TABLE: a code band (y 945-975) and a description band (y 1025-1040). Pairing is by COLUMN. Every approved mapping measured dx between -2 and +1, i.e. exact column alignment. That is geometric proof.
- EV-LEG-003 | legend | finding | Descriptions confirmed present on the ELV sheet: SMOKE DETECTOR, HEAT DETECTOR, DUCT DETECTOR, SMOKE AND HEAT COMBINED DETECTOR, FIRE ALARM MANUAL STATION, FIRE ALARM MANUAL STATION (WEATHER PROOF), LOOP POWERED STROBE, LOOP POWERED STROBE WITH SOUNDER, LOOP POWERED STROBE WITH SOUNDER (WEATHER PROOF TYPE), FIREMAN TELEPHONE JACK, SPEAKER CEILING MOUNTED, SPEAKER WALL MOUNTED, ZONE INTERFACE MODULE, FIREMAN TELEPHONE CONTROL PANEL, FIRE ALARM REPEATER PANEL, MAIN FIRE ALARM CONTROL PANEL, INTERFACE MODULE CONTROL, INTERFACE MODULE MONITORING, DOOR CONTACT, AMPLIFIER, PAGING MICROPHONE, CEILING SPEAKER, WALL MOUNTED SPEAKER, FIRE MAN PAGING MICROPHONE.
- EV-LEG-004 | legend | finding | The 2026-09-24 approval (9 distinct approved rows, conf 98, reviewer local-development-user) is SOUND. Approval plus column-aligned geometry agree on every mapping that is not genuinely ambiguous.

## B. AUTHORITY CLASSIFICATION (new module)
- EV-LEG-005 | legend | code | app/domain/fire-alarm-legend-class-semantics.mjs holds four states: GOVERNED_AND_PROVEN, GOVERNED_BUT_PROVENANCE_WEAK, CONFLICTED, UNRESOLVED. Only GOVERNED_AND_PROVEN may drive deterministic schedule semantics. 15/15 tests, 4 mutations each produce failures.
- EV-LEG-006 | legend | finding | GOVERNED_AND_PROVEN (7): S=SMOKE DETECTOR, H=HEAT DETECTOR, T=FIREMAN TELEPHONE JACK, WP=LOOP POWERED STROBE WITH SOUNDER (WEATHER PROOF TYPE), CE C=INTERFACE MODULE CONTROL, CE M=INTERFACE MODULE MONITORING, S D=DUCT DETECTOR.
- EV-LEG-007 | legend | finding | F is CONFLICTED. Bare F occupies TWO legend columns: x=649 FIRE ALARM MANUAL STATION and x=668 FIRE ALARM MANUAL STATION (WEATHER PROOF). Two approved rows disagree on the description. The code alone cannot say which. No supersession performed; a governed supersession decision is required.
- EV-LEG-008 | legend | finding | Bare C, M, CE, D are UNRESOLVED. Each appears on the sheet ONLY inside a compound (CE C, CE M, S D) or as an unrelated AV token (M = PAGING MICROPHONE at x=1141/1505). No approved mapping exists for a bare one and none was invented.
- EV-LEG-009 | legend | finding | HC is UNRESOLVED. One occurrence in BOS, no legend column, no project definition.
- EV-LEG-010 | legend | finding | S H (SMOKE AND HEAT COMBINED DETECTOR, x=629) also exists as a compound in the legend but was NEVER approved. Recorded as NOT APPROVED.

## C. COMPOUND TOKENS
- EV-LEG-011 | legend | finding | Compound legend cells stack two letters in ONE symbol cell sharing ONE description. Letter SET is what geometry proves.
- EV-LEG-012 | legend | finding | Letter ORDER is NOT recoverable from geometry. On the real sheet S D reads top-down (S y956, D y966) but CE C reads bottom-up (CE y954, C y966). Neither alphabetical nor vertical order reproduces the governed spellings. Matching is therefore by letter SET, with the governed spelling carried verbatim.
- EV-LEG-013 | legend | finding | A compound is never decomposed into bare letters. CE C resolves to INTERFACE MODULE CONTROL even though bare CE and bare C are both UNRESOLVED; decomposing would lose a proven device and invent two.

## D. T RESOLVED
- EV-LEG-014 | legend | finding | T = FIREMAN TELEPHONE JACK, GOVERNED_AND_PROVEN, dx=-1, aligned to the legend column at x=776/777. Matches the 25 BOS occurrences.
- EV-LEG-015 | legend | finding | T carries addressImplication=NO_SLC_ADDRESS. A telephone jack is a passive field device. It must NOT be read as a module address or a monitor-module quantity.

## E. KGS PARSER ROOT CAUSE
- EV-KGS-001 | schedule | finding | The old rule was: the FIRST quantity cell with no class codes beneath it is the printed row total. That is only correct when a floor prints exactly ONE unattributed quantity.
- EV-KGS-002 | schedule | finding | KGS prints TWO on every floor: a small per-class quantity (2, 9, 4, 4) and the real row total (144, 185, 120, 115, 46). Measured: KGS GROUND FLOOR bare cells are 9 at (x-867,y76) and 185 at (x-632,y77). BOS prints only one. Position-first took 9, which is how a sheet whose quantity cells sum to 1281 reported a printed total of 23.
- EV-KGS-003 | schedule | fix | The rule is now geometric: the printed row total is the unattributed cell OUTSIDE the horizontal span of that floor's class-attributed subtotals (slack 12). Validated on every floor of BOS, GRS and KGS: a unique candidate exists everywhere.
- EV-KGS-004 | schedule | fix | Deliberately NOT used: pick the largest value. That is a value heuristic and would silently absorb a genuine drawing discrepancy. Mutation-tested.
- EV-KGS-005 | schedule | fix | Ambiguity returns null, and the floor is marked unresolved. Unattributed cells are retained on the floor object as unattributedQuantities for inspection, never summed.
- EV-KGS-006 | schedule | evidence | KGS after repair: BASEMENT 144/57 (delta 87, unresolved, PRESERVED), GROUND FLOOR 185/184, LEVEL 01 120/120, LEVEL 02 115/115, ROOF 01 46/46. The same plus-or-minus 0-to-2 pattern as BOS and GRS.
- EV-KGS-007 | schedule | evidence | BOS and GRS are unchanged by the repair: BOS 144/143, 131/133, 121/123, 118/120, 46/47; GRS 150/145, 130/132, 121/123, 124/126, 49/50.
- EV-KGS-008 | schedule | test | tests/fire-alarm-device-schedule-row-total.test.mjs 9/9 using the REAL measured KGS, BOS and GRS geometry. Mutations: revert to first-bare-cell gives 4 failures; largest-value rule gives 1; drop ambiguity-to-unresolved gives 2.

## F. TESTS
- EV-TST-001 | tests | evidence | 42/42 across legend semantics, row-total repair, schedule parser and intake atomicity. No broad repo test, build or lint was run, per instruction.

## G. PANEL TOPOLOGY RE-BOUND TO GOVERNED INTAKE
- EV-TOP-001 | topology | finding | All four per-building links are CROSS-SHEET CORROBORATED from current governed drawing_assets with exact asset ids and bboxes: BOS~GRS (GRS:FROM BOS:TO), BOS~KGS (KGS:TO BOS:FROM), GRS~WLC (GRS:TO WLC:FROM), KGS~WLC (KGS:FROM WLC:TO). Zero conflicts, zero single-sheet links. The four-building loop closes.
- EV-TOP-002 | topology | finding | PANEL-CLASS WORDING IS INCONSISTENT ON 3 OF 4 LINKS and is PRESERVED, not reconciled. BOS~GRS printed as both MFACP and FACP; BOS~KGS as both FACP and MFACP; KGS~WLC as both FACP and MFACP. Each building sheet calls its own incoming source MFACP while the partner calls the same link FACP.
- EV-TOP-003 | topology | finding | The MFACP is printed as hosted in the KGS FCC room: WLC prints TO MFACP @ FCC ROOM KGS BUILDING. Consistent with the 1 MFACP plus 6 FACP architecture. Not reopened.
- EV-TOP-004 | topology | lesson | My first cross-sheet script had TWO bugs that both under-reported corroboration: a typo mapping KGS to GGS, and a LIKE pattern that matched the KGS T-91 sheet instead of T-93 so KGS edges were never read. Corrected to 4/4 corroborated. Worth re-reading lookup results before trusting a count.

## H. AGENT 3 CURRENT STATE (re-read, not assumed)
- EV-A3-001 | authority | finding | No per-BOQ-item SLC address classification table exists in the canonical D1. There is no table matching slc, address or resource. engineering_classification_decisions holds only 2 rows for Al Mousa, both document-level (Equipment Category, Device Type), not per-item addresses.
- EV-A3-002 | authority | finding | CURRENT_DETECTOR_POOL_AUTHORITY = EMPTY. CURRENT_MODULE_POOL_AUTHORITY = EMPTY. CURRENT_NOT_SLC_AUTHORITY = EMPTY at persistence level. CURRENT_UNRESOLVED_ADDRESS_DEMAND = all 84 approved_for_downstream BOQ items.
- EV-A3-003 | authority | note | The read-only packet tool still reports current governed state as all 81 UNRESOLVED, expected distribution 31 MODULE_ADDRESS, 21 UNRESOLVED, 17 DETECTOR_ADDRESS, 11 EXCLUDED. That is Agent 3's expected output, NOT current persisted authority. Not written by me.
- EV-A3-004 | authority | evidence | fire_alarm_panel_sizing_snapshots 0 rows, fire_alarm_preliminary_sizing_snapshots 0 rows, drawing_quantity_evidence_coverage 1 Partial row, boq_quantity_source_decisions 6 rows. Sizing remains correctly blocked.

## I. drizzle/ SHARED-TREE DIAGNOSIS (read-only)
- EV-DRZ-001 | tree | finding | DRIZZLE_TREE_STATE = 81 tracked files at HEAD, all 81 staged as DELETED in the working tree, directory absent from disk. git ls-tree HEAD drizzle/ returns 81 files; git status --porcelain drizzle/ returns 81 D entries.
- EV-DRZ-002 | tree | finding | Deletion is TRACKED-INDEX (staged as D), not worktree-only and not untracked. Safe recovery path therefore exists for whoever owns it, but it is NOT mine to execute.
- EV-DRZ-003 | tree | finding | AFFECTED_TESTS = 49 test files reference drizzle/. Confirmed failures in this lane: tests/drawing-extraction-api.test.mjs (ENOENT drizzle/0074_drawing_visual_runs.sql) and tests/drawing-intake-engine.test.mjs (ENOENT drizzle/0032_drawing_intake_founda...). Neither imports the code I changed and neither reaches persist().
- EV-DRZ-004 | tree | finding | OWNER = UNKNOWN. No lane can be proven from the tree state. db/schema.ts still declares the drawing tables and db:generate uses drizzle-kit, so the schema source of truth survives; only the generated migration files are gone.
- EV-DRZ-005 | tree | finding | SAFE_NEXT_ACTION = the owning lane restores the 81 files from the index. Not attempted here, per instruction.
- EV-DRZ-006 | tree | note | The canonical D1 already has 318 tables and no __migrations table, so the live schema does not depend on these files being present to serve requests. Only tests that read the .sql files fail.

## J. QUANTITY EVIDENCE
- EV-QTY-001 | quantity | finding | DRAWING_QUANTITY_EVIDENCE_READY remains NO. Quantity evidence is NOT produced, because only 7 of the observed schedule class codes are GOVERNED_AND_PROVEN and F, CE, C, M, D, HC are not. Writing evidence now would require promoting unproven codes.
- EV-QTY-002 | quantity | finding | drawing_quantity_evidence_coverage still holds exactly 1 Partial row. Preserved truthfully.
- EV-QTY-003 | quantity | note | 4 of 5 KGS floors now reconcile exactly, so the quantity evidence has materially better inputs than before, but coverage is still NOT complete because of the unresolved classes and the KGS basement delta of 87.

## K. FLAGS
- EV-FLG-001 | flag | LEGEND_SEMANTICS_GOVERNED = YES (7 of 9 approved mappings proven; the 2 F rows need a governed supersession decision). CODE_T_GOVERNED = YES. COMPOUND_LEGEND_MATCHING_READY = YES. HC_RESOLVED = NO.
- EV-FLG-002 | flag | KGS_PARSER_ROOT_CAUSE_FOUND = YES. KGS_SCHEDULE_PARSER_READY = YES for LEVEL_BAND_SUBTOTAL.
- EV-FLG-003 | flag | PANEL_TOPOLOGY_CROSS_SHEET_RESULT = CONSISTENT (4/4 corroborated, 0 conflicts; panel-class wording disagreement preserved separately).
- EV-FLG-004 | flag | DRAWING_QUANTITY_EVIDENCE_READY = NO. SLC_ADDRESS_DEMAND_READY = NO. PANEL_ALLOCATION_READY = NO. ALL_REQUIRED_PANEL_SIZING_CURRENT = NO. STOPPED BEFORE SIZING as instructed.
