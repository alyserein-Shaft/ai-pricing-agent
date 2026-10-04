# R7 CHECKPOINT — Files source drill-down (no fabricated `Unclassified`) — 🟢 CLOSED

Canonical repo HEAD `029b426...` · runtime :4183 · no commits made.

## Defect proven (per slice)

At the RE-EVALUATION gate, live probes showed the knowledge files API payload
carries `detected_type`, `classification_status`, `classification_confidence`,
`processing_status`, `secondary_types`, and a per-file `summary` — but the
workspace files branch consumed keys that **do not exist in the payload at all**:

- `file.document_type || file.source_type || "Unclassified"` → every one of the
  29 files rendered **"Unclassified"** (a fabricated document category).
- `file.downstream_use || "Discovery Only"` → **"Permitted use: Discovery
  Only"** on all 29 files (a fabricated governance claim; `downstream_use` is not
  a knowledge_files column).

The truthful data was already in the payload: `detected_type` ("Supplier
Quotation", "Price List", …), `secondary_types`, classification evidence, and
per-file learning counts in `summary` (`productsLearned`, `pricesDiscovered`,
`itemsRequiringReview`, or quotation metadata incl. a real `downstreamUse`).

The review-item fallback `item.item_type || "Unclassified"` was inert (the
review-queue API always supplies `item_type`, mapped to "Unknown" when real) but
was the same fabricated category waiting to fire.

## Implementation (smallest sufficient — backend untouched)

### app/components/workspaces/KnowledgeLibraryWorkspace.tsx — files branch
Replaced the fabricated renders with the truthful source drill-down:
- Type line: `detected_type` (or legacy `document_type`/`source_type` if ever
  present) with `secondary_types` joined, or honest fallback **"Document type
  not classified"** — a true statement, never a fake category.
- `Permitted use:` rendered **only** when `file.downstream_use` or
  `summary.downstreamUse` actually carries a value (real value shown).
- Classification line gains `· confidence {N}%` from
  `classification_confidence` when present.
- New drill-down line: per-file evidence counts from `summary` —
  `{N} products learned · {M} prices discovered · {K} items requiring review`,
  or the honest "Source registered" when the file summary carries no counts.
- Review-item fallback: `item.item_type || "Not classified"` (neutral, honest).

## Evidence

- Focused contract test `tests/knowledge-files-source-truth-contract.test.mjs`:
  6/6 PASS (files branch uses `detected_type` and "Document type not classified",
  never the string "Unclassified"; secondary types; "Permitted use" only from
  real payload values; summaryCount drill-downs; review fallback neutral; files
  API serves the fields the UI consumes).
- Guards: KN-UX + release-1-app-shell + R1–R6 contracts + workflow-reconciliation
  + release-0-1-product-truth = **92/92 PASS**.
- `npm test`: 508/508 PASS.
- ESLint workspace: clean (same 6 pre-existing page.tsx errors elsewhere, none in
  R7 regions). `tsc --noEmit`: zero workspace errors.

## Runtime :4183

Playwright **7/7 PASS**:
- Files section: rows show "Supplier Quotation"/"Price List" detected types,
  secondary types, "N products learned · M prices discovered · …" drill-downs;
  no "Unclassified" anywhere. "Permitted use: Discovery Only" appears only for
  the one file whose summary genuinely carries `downstreamUse` (SO26 quotation).
- Prices section: rows show "Price List" (not Unclassified); PRICES metric still
  1503.
- Review section: item rows keep real types (Supplier RFQ / Unknown), no
  Unclassified.
- Screenshot: `.local-evidence/kn-r7-files.png`.

## Repo safety

R7 changed: `M app/components/workspaces/KnowledgeLibraryWorkspace.tsx`,
`?? tests/knowledge-files-source-truth-contract.test.mjs`. Nothing committed; no
live mutation.

## Exit decision

R7 CLOSED 🟢. KN-PRODUCT-CLOSE complete — deliver the consolidated final report.