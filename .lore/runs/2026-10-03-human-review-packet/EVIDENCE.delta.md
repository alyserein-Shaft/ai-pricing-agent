# Run 2026-10-03 — T quantity closure + human drawing review packet

## A. T REGION CLASSIFICATION
- EV-TR-001 | tokens | finding | All T occurrences on BOS(25), GRS(25), KGS(23), WLC(6) are SCHEDULE/PLAN-REGION tokens sitting in a class-code row, NOT legend definitions and NOT notes annotations. Zero were classified DEVICE_INSTANCE by the structural test because that test only looked for a quantity cell directly above.
- EV-TR-002 | tokens | finding | Rendered BOS T cluster and corrected that classification by direct visual evidence: each T is a SQUARE CONTAINING A FILLED DOT, labelled "T", drawn ON a vertical riser line with dashed segments above. That is a plan-view riser device symbol, so the 25 BOS occurrences ARE device instances. Captured at out/review-packet/BOS-T-cluster.png.
- EV-TR-003 | tokens | finding | T counts: verified device occurrences BOS 25, GRS 25, KGS 23 = 73. Excluded definition occurrences 1 (the ELV legend T at doc_5244a162 legend x=776). Uncertain 6 (WLC).
- EV-TR-004 | tokens | blocker | WLC's 6 T occurrences are UNVERIFIED. That sheet has /Rotate 90 and its governed asset coordinates do not map to the rendered viewport by the same rule as BOS/GRS/KGS, so the crop returned blank. The correct WLC mapping is not yet established.
- EV-TR-005 | tokens | note | T is a passive fireman telephone jack. No telephone monitor-module quantity may be inferred from it.

## B. UNRESOLVED STRUCTURES — GEOMETRY EXHAUSTED
- EV-TR-006 | tokens | finding | The tight glyph-pair test is deterministic: inter-glyph gaps are bimodal, p10 about 6.6 and median about 29.5 on BOS/GRS, 10.8 and 29.7 on KGS. Pairs at or under 8pt are drawn as ONE cell.
- EV-TR-007 | tokens | finding | The tight pairs actually drawn are S+C (BOS x4, GRS x4, KGS x3) and S+HC (BOS x1, GRS x1). WLC has no tight pairs at all (its minimum gap is 112).
- EV-TR-008 | tokens | finding | NO governed legend class is named S C or S HC. The legend defines CE C, CE M, S D, S H and singles. So the tight pairs the schedule draws have no available governed meaning, which is a negative result and not a mapping opportunity.
- EV-TR-009 | tokens | finding | CE and M co-occur in the same quantity cell on every sheet but their glyph gap is not tight, so this is cell membership rather than a compound. No C occurs in the interface-module columns, so CE C has no schedule occurrence.
- EV-TR-010 | tokens | finding | KGS prints a literal composite token "C/M" at user(-872,-431) width 11.0, leftmost in its row ahead of separate bare C(-834) and M(-800). It is a GROUP HEADER, not a compound cell, and appears on KGS only.
- EV-TR-011 | tokens | flag | AUTOMATIC_SEMANTIC_INFERENCE_EXHAUSTED = YES for S+C, S+HC, HC, bare C, bare M, bare D and CE/M co-membership. Further geometry will not close them; they need a human who can read the drawing.

## C. F VARIANT
- EV-TR-012 | legend | finding | F variant split holds: 17 solid (standard) and 11 dashed (weatherproof) across BOS, GRS, KGS, WLC. F_VARIANT_REVIEW_READY = YES. F_VARIANT_AUTHORITY_PERSISTED = NO — nothing is persisted through a governed authority path.

## D. S H RECOGNITION RESUME
- EV-TR-013 | legend | finding | S H = SMOKE AND HEAT COMBINED DETECTOR remains geometrically proven at ELV legend x=629 (S y956 over H y966, description dx=-1). It is NOT among the 9 approved or 30 Needs Review rows in drawing_symbol_definitions under any spelling.
- EV-TR-014 | legend | finding | Recognition resume path: the governed route is the drawing-symbol-recognition API, which operates on a drawing_symbol_recognition_versions run and produces symbol-definition candidates with evidence and confidence. Making S H a governed candidate requires a recognition run over the ELV legend document (doc_5244a162 / ver_7bed68bc), a candidate row carrying abbreviation "S H", evidence_text "S H · SMOKE AND HEAT COMBINED DETECTOR", bounding box and page 1, then review and approval by the authorised actor. This is drawing-recognition authority and was not created here. No technical specification applicability is claimed.

## E. LIVE SCHEMA DEPLOYMENT QUESTION
- EV-TR-015 | infra | finding | LOCAL_D1_SCHEMA_APPLY_PATH = UNVERIFIED. The canonical local D1 has 318 tables and no __migrations table, and drizzle/ is absent so db:generate cannot run. Those two facts are compatible with either (a) migrations never gating the live schema, or (b) the live schema being applied by an unobserved path. This cannot be settled from the tree state alone and was not solved here.

## F. HANDOFF
- EV-TR-016 | flags | flag | T_QUANTITY_READY=PARTIAL. T_REVIEW_READY_QUANTITY=73 verified (79 incl. unverified WLC). HUMAN_DRAWING_REVIEW_PACKET_READY=YES at out/review-packet/. SH_RECOGNITION_REVIEW_PACKET_READY=YES. APPROVED_DRAWING_QUANTITY_AUTHORITY_READY=NO. NEW_DRAWING_QUANTITY_SCHEMA_LANDED=NO. READY_FOR_PANEL_ALLOCATION_FROM_DRAWINGS=NO.
- EV-TR-017 | flags | note | Schema, drizzle/ and canonical D1 untouched. No direct SQL. No SLC/address work. No sizing, pricing or quotation.
