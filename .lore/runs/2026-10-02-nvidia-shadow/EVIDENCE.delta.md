# Run 2026-10-02 — NVIDIA shadow enablement + drawing claim layer

## Scope
- EV-NVID-001 | drawing-second-opinion | note | Own lane only: drawing intake / legend / schedule evidence / sizing consumption. NVIDIA = second opinion only. `AUTHORITATIVE_PARSER = NATIVE_ONLY` retained.

## 1. NVIDIA enabled (narrowly)
- EV-NVID-002 | drawing-second-opinion | note | Env: `NVIDIA_DOCUMENT_SHADOW_ENABLED=1`, `NVIDIA_DOCUMENT_SHADOW_ALLOWED_ROOTS=out/nvidia-shadow/al-mousa-fire-alarm`.
- EV-NVID-003 | drawing-second-opinion | note | `resolveTrustedProbeRoots` returns exactly 3 roots: the 2 pre-existing synthetic roots + the new staging root. The `.wrangler/state/v3/r2/` tree is NOT allowlisted.
- EV-NVID-004 | drawing-second-opinion | note | 5 sheets staged, each SHA-256 verified equal to `document_versions.sha256`.
- EV-NVID-005 | drawing-second-opinion | note | Security verifications:
- EV-NVID-006 | drawing-second-opinion | note | arbitrary R2 object -> REFUSED_OUTSIDE_ALLOWED_ROOTS
- EV-NVID-007 | drawing-second-opinion | note | traversal `../../../../etc/passwd` -> REFUSED_OUTSIDE_ALLOWED_ROOTS
- EV-NVID-008 | drawing-second-opinion | note | commercial classification -> REFUSED_RESTRICTED_PAYLOAD
- EV-NVID-009 | drawing-second-opinion | note | caller-supplied `allowedRoots:['/']` cannot widen server trust
- EV-NVID-010 | drawing-second-opinion | note | Classification vocabulary is CLOSED; correct value is `AUTHORIZED_PROJECT_DOCUMENT` (not a free-text label).

## 2. Rendering finding (cost me several wrong turns; record it)
- EV-NVID-011 | drawing-second-opinion | note | pdf.js in Node needs DOM globals. `app/domain/drawing-intake-engine.mjs` installs `DOMMatrix`/`ImageData`/`Path2D` STUBS before import — those stubs are enough for TEXT EXTRACTION but BREAK RENDERING (`path.moveTo is not a function`), because rendering constructs real paths. Fix: keep the DOMMatrix/ImageData stubs, use the REAL `Path2D` exported by `@napi-rs/canvas`. Do not replace DOMMatrix with the @napi-rs one — it regresses to "Invalid PDF structure".

## 3. Probe inline size limit is a real constraint
- EV-NVID-012 | drawing-second-opinion | note | Probe refuses images > 180,000 base64 chars. A 150-DPI A0 sheet is ~1.5M chars — rejected. Re-render with scale chosen from MEASURED output (0.32–0.42 fits). => Full-sheet OCR at that size is degraded (`LAARSS`, `CCHEAATC`, `SCCEENAT`, `archtachur`): character duplication + split subscripts, i.e. the known failure modes. Sheet identity still survives (`2401232 PC-KGS`). Region crops are required for usable advisory OCR; full-sheet advisory OCR must NOT be fed into reconciliation as it would manufacture false conflicts.

- EV-NVID-013 | drawing-second-opinion | note | All 3 NVIDIA components respond on all 5 sheets: `nemotron-ocr-v2` (text), `nemotron-page-elements-v3` (regions), `nemotron-table-structure-v1` (geometry).

## 4. Topology now PROVEN from native text (was engine inference)
- EV-NVID-014 | drawing-second-opinion | note | Every sheet prints its panel links as text. Previously I had only geometry + a BOQ-based inference. Native text gives positive proof:
- EV-NVID-015 | drawing-second-opinion | note | GRS: `FIRE ALARM CONTROL PANEL (F.A.C.P)`; `FROM MFACP @BOS` / `TO FACP @WLC`
- EV-NVID-016 | drawing-second-opinion | note | KGS: `MAIN FIRE ALARM CONTROL PANEL (M.F.A.C.P)`; `FROM FACP @ WLC` / `TO FACP @BOS`
- EV-NVID-017 | drawing-second-opinion | note | WLC: `F.A.C.P`; `FROM FACP @GRS` / `TO MFACP @ FCC ROOM KGS BUILDING`
- EV-NVID-018 | drawing-second-opinion | note | BOS: `F.A.C.P`; `FROM MFACP @KGS` / `TO FACP @GRS` => MFACP is hosted in the KGS FCC room. Confirms 1 MFACP + 6 FACP architecture. => Wording is NOT symmetric between sheets (GRS says "FROM MFACP @BOS" where BOS says "TO FACP @GRS"; BOS says "FROM MFACP @KGS" where KGS says "TO FACP @BOS"). PRESERVE, do not reconcile by rewriting either side.

- EV-NVID-019 | drawing-second-opinion | note | AMS-T-93-ZZZ-002: 3 panel blocks, each anchored on a drawn panel title, each with a vertically-paired FROM/TO at constant x (dx=71, dy=±213/232). Blocks resolve to links GRS~KGS, BOYS~KGS, BOYS~WLC. Block 1 and Block 3 are now identified by positive printed evidence, not by BOQ inference.

## 5. New module: app/domain/drawing-second-opinion-claims.mjs
- EV-NVID-020 | drawing-second-opinion | note | Closed claim vocabulary (12 types), closed reconciliation vocabulary (CORROBORATED / PARTIALLY_CORROBORATED / CONFLICT / INSUFFICIENT_EVIDENCE). Rules enforced:
- EV-NVID-021 | drawing-second-opinion | note | advisory-only can NEVER corroborate, at any confidence
- EV-NVID-022 | drawing-second-opinion | note | conflicts retain BOTH readings; higher advisory confidence does not decide
- EV-NVID-023 | drawing-second-opinion | note | nothing promotes; only PROPOSED
- EV-NVID-024 | drawing-second-opinion | note | evidence provenance is DERIVED, not trusted from caller Tests 20/20, mutation-proven (4 mutations each produce failures).

## 6. Design mistakes I made and corrected (worth not repeating)
- EV-NVID-025 | drawing-second-opinion | note | a. Bucketing by claim VALUE meant a conflict (same subject, different values) could never land in one bucket. Added `claimSubject` — the identity of the THING. b. Cross-sheet native agreement was being reported as INSUFFICIENT_EVIDENCE. That is wrong: two independent native sheets agreeing IS corroboration, but of a different kind, so it gets its own basis `NATIVE_CROSS_SHEET_AGREEMENT`, and requires distinct provenance (`distinctProvenance`) so one sheet repeating itself cannot launder a claim. c. Schematic block clustering by distance merged two AMS002 blocks and silently lost a link. Anchor blocks on the DRAWN PANEL TITLE instead. d. Edge lines like "TO FACP @WLC BUILDING" match a panel-title regex, so they anchored to themselves at distance 0. Exclude edge lines from anchors. e. Block objects must carry `anchor` through, else the caller's identity-based lookup finds nothing. f. Emitting both of a block's lines as separate claims made ONE block look like two independent corroborating readings. One claim per block. g. Keying topology claim VALUE on printed wording manufactured false conflicts between sheets. Value = link pair key; wording retained as evidence.

## 7. Current reconciled result (native only; no advisory evidence admitted)
- EV-NVID-026 | drawing-second-opinion | note | 3 CORROBORATED (cross-sheet): BOYS~KGS, GRS~WLC, KGS~WLC 5 INSUFFICIENT_EVIDENCE (single sheet): BOS~GRS, BOS~KGS, BOYS~GRS, BOYS~WLC, GRS~KGS 0 CONFLICT. `claimBatchBlockers` = NOT_CORROBORATED:TOPOLOGY_RELATION — correctly refuses to treat this as sufficient for sizing.

## 8. GRS/KGS layout finding
- EV-NVID-027 | drawing-second-opinion | note | GRS and BOS have IDENTICAL class-code histograms (S:15 H:7 CE:11 C:5 M:10 T:25 F:8 HC:1 D:1) and 304 native text items each — same template family. GRS is a LEVEL_COLUMN_STACK like WLC (level headers BASEMENT01..ROOF02 at x=-963), NOT the BOS LEVEL_BAND_SUBTOTAL layout. NOTE `T` (25 occurrences) is a code my schedule parser does NOT handle — needs investigation before GRS parsing is trusted.

## 9. Flags
- EV-NVID-028 | drawing-second-opinion | note | POST_DELIVERY_NVIDIA_KEY_ROTATION_REQUIRED = YES (recorded once; not a blocker) NVIDIA_OUTBOUND_READY = YES NVIDIA_DRAWING_SECOND_OPINION_USED = YES (probe only; no evidence admitted) DRAWING_CLAIM_RECONCILIATION_READY = YES DRAWING_INTAKE_ATOMIC = NO (unchanged; still to fix) DRAWING_QUANTITY_EVIDENCE_READY = NO PANEL_ALLOCATION_READY = NO ALL_REQUIRED_PANEL_SIZING_CURRENT = NO

## 10. Still blocked / not done
- EV-NVID-029 | drawing-second-opinion | note | Native intake 201-with-zero-children atomicity: NOT fixed this turn.
- EV-NVID-030 | drawing-second-opinion | note | Class-code semantics S/H/C/M/CE/D/F/HC still unmapped. Sheets only say "FOR ELV LEGENDS ... REFER" to another document; the legend itself is not on these 5 sheets.
- EV-NVID-031 | drawing-second-opinion | note | `T` code unhandled by the schedule parser.
- EV-NVID-032 | drawing-second-opinion | note | No advisory OCR admitted into any claim (degraded at legal payload size).
