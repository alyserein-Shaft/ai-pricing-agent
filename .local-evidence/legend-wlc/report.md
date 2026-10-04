# Legend-to-WLC investigation — 2026-09-15

## Outcome
Reference detection is real, but reference identity is unresolved. No legend was supplied to a model and no new symbol interpretation or legend relationship was created. The three-symbol sample is blocked by source identity, not fabricated.

## Source evidence
Project: project_c0123d91-c30b-4956-87cb-e473ef53f89d. WLC: doc_3f857096-3152-408f-9c86-9296e4142ced.

| Source | Literal / actual drawing number | Revision | Match basis |
|---|---|---|---|
| WLC reference note | 2401232-PC-AMS-T-00-ZZZ-002 | No target revision specified | Literal explicit reference |
| 2401232-PC-AMS-DR-T-00-ZZZ-002.pdf | 2401232-PC-AMS-DR-T-00-ZZZ-002 | 1, visually read from actual title block | Similar ELV title and numbering, but meaningful DR segment differs; NOT resolved |
| 2401232-PC-AMS-DR-E-00-ZZZ-002.pdf | 2401232-PC-AMS-DR-E-00-ZZZ-002 | 1, visually read from actual title block | DR and E/T differences; NOT a substitute |

All 15 active project register documents were inspected. No exact target exists after harmless formatting normalization. Both candidate revision fields are null in the register, although actual title blocks show revision 1. The ELV candidate is titled ELV LEGENDS, NOTES AND ABBREVIATIONS and has a distinct Fire Alarm System table alongside other ELV systems. This confirms candidate content, not its applicability to WLC.

Candidate ELV document: doc_0de6f58b-7b48-46a2-92d3-aaef230c92b0; version: ver_47d5b443-74a1-4643-a29f-c8f7b4fdc5e6; page 1.

Evidence files: register.json, elv-candidate.pdf, elv-title.png, elv-sheet.png, electrical-candidate.pdf, electrical-title.png. Prior WLC visual reference evidence remains in ../wlc-repair/reference-detail.png.

## Focused repair
Removed the resolver fallback that deleted DR. Resolution now requires a unique exact normalized drawing number; missing or ambiguous targets remain unresolved. Stale resolution explanations are cleared on failed resolution. Exact identity does not approve the reference or establish revision compatibility.

Found one persisted unreviewed deterministic WLC reference incorrectly marked Resolved by the old DR-removal rule. Corrected only its label/resolution evidence and update timestamp. Previous evidence and label are retained in the same row under resolutionCorrections, and the complete original row is in reference-row-before.json. No human review decisions were changed.

## Verification and limits
Focused automated tests passed (tests.txt). Fresh localhost:5173 API reads after the saved correction confirm Unresolved with a null target and retained correction history. Every other proposal and all visual runs are byte-for-byte equal as parsed JSON to the prior saved API response. Title, revision, FACP location, cable evidence, restrained circuit interpretation, review state, and raw model history remain unchanged. This is API persistence/reopening verification; no browser reload or model run was performed in this pass.

The existing LegendDefinition extraction/review pathway was inspected, but candidate row extraction and downstream visual integration were not performed because the referenced source cannot be established. No three-symbol support sample can honestly be claimed. Engineering approval remains pending.

## One manual step
Obtain an authoritative corrected reference or documented drawing-number equivalence confirming whether the WLC note targets the DR-containing ELV sheet, revision 1; otherwise supply the exact referenced drawing. Then resume Fire Alarm row extraction and evidence-backed visual matching.
