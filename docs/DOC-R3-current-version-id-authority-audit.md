# DOC-R3 — `documents.current_version_id`: head pointer vs governing evidence

**Status:** audit complete; BOQ convergence implemented; drawing convergence owned by DOC-R4.
**Rule:** `current_version_id` is the LATEST RECORDED / HEAD POINTER. It is never
governing authority. Every production occurrence is classified below; anything
not on this list is a defect.

## The distinction

- **HEAD USE** — "which upload are we processing / displaying / indexing." The
  pipeline parses what was just uploaded; the document list shows the newest
  filename; the search index covers the latest recorded bytes. Correct.
- **GOVERNING EVIDENCE USE** — "which version's rows are served as evidence."
  Must resolve through `documentVersionGoverningPredicate`. Using the head here
  is the DOC-R3 section-9 defect.
- **HISTORICAL-AUDIT USE** — "which version did this past event touch."
  Provenance of an intake/decision event. Correct, and must never be rewritten
  to the governing version (that would falsify what was actually parsed).
- **AMBIGUOUS** — investigated below; none remain unclassified.

## Converged in DOC-R3 (were GOVERNING, now resolve through the shared authority)

| Location | Was | Now |
|---|---|---|
| `worker/boq-extraction-api.mjs` `currentExtraction` | `d.current_version_id = e.document_version_id` | `documentVersionGoverningPredicate("dv")` over the extraction's own version |
| `worker/specification-extraction-api.mjs` `currentExtraction` | hand-typed `superseded_at` ordering (already delegated before this audit) | `currentSpecificationExtraction` (shared authority) — verified, untouched |

Processing in the same files (`ownedDocument`, `headExtraction`, numbering,
same-version supersede, `normalize-preview` byte parsing) is HEAD USE and stays.

## HEAD USE — processing the upload (correct, keep)

| Location | Why the head is right |
|---|---|
| `worker/boq-extraction-api.mjs` `ownedDocument` (:32), `headExtraction`, `latestExtractionVersionNumber`, same-version supersede | Parsing/numbering/superseding runs of the uploaded bytes |
| `worker/specification-extraction-api.mjs` `ownedDocument` (:43) | Same, specification pipeline |
| `worker/specification-extraction-background.mjs` `jobDocument` (:19) | Background job continues the uploaded version's job |
| `worker/classification-api.mjs` `ownedDocument` (:22) | Classifier runs on the new upload |
| `worker/project-context-api.mjs` `executeProjectContextExtraction` (:432), `persistProjectContextExtraction` (:98, :123, :148), payload `:490` | Parsing the uploaded XLSX + recording which version was parsed (provenance); the read path (`document-api.mjs:523`) selects `superseded_at IS NULL` per document and never consults the head |
| `worker/supplier-price-intake-api.mjs` `:29, :49, :57, :74–75` | Commercial intake provenance: which upload was parsed, idempotency on `(project, version, fingerprint)` |
| `worker/supplier-price-memory.mjs` `:112, :122` | Same family, memory key names the parsed version |
| `worker/drawing-intake-api.mjs` `:6`, `drawing-extraction-api.mjs` `:55`, `drawing-legend-geometry-api.mjs` `:37`, `drawing-structural-parser-api.mjs` `:5`, `drawing-symbol-recognition-api.mjs` `:43, :115, :797` | Drawing pipelines parse the uploaded version |
| `worker/document-api.mjs` `:194` (upload), `:672` (restore) | These WRITE the head pointer; they define it |
| `scripts/sprint-1.3-ingest-fas-drawings.mjs` | One-off seed script names the uploaded version |

## HEAD USE — display / operational status (correct, keep)

| Location | Why the head is right |
|---|---|
| `worker/document-api.mjs` `getOwnedDocument` (:31), list query (:338) | Document header/list show the newest filename + the newest upload's processing status; evidence rows are never selected here (`bx`/`sx` are latest-run badges, not evidence) |
| `worker/dashboard-api.mjs` `:157–158` | "Is the newest upload still processing / did it fail" counters |
| `worker/technical-requirement-api.mjs` `:264` | `drawing_status` attribute of the newest upload (a version attribute, not evidence currency) |
| `worker/drawing-structural-review-api.mjs` `:132, :151` | `documentCurrentVersionId` display/staleness context passed alongside the structure's own version id |
| `worker/drawing-architecture-review-api.mjs` `:208` | `documentVersionId` names the version an intake was derived from (provenance in a response payload) |
| `worker/case-study-learning-api.mjs` `:41`, `worker/engineering-discovery-api.mjs` `:19` | Knowledge indexes cover the latest recorded bytes (search coverage, not a governance decision) |
| `worker/project-pricing-learning-api.mjs` `:19` | Source catalogue for the learning record; the BOQ rows in the same query already resolve through the governing authority |

## GOVERNING EVIDENCE USE owned by DOC-R4 (do NOT converge here)

These select *drawing evidence* (which structure/intake is "current" for review).
Drawing evidence does not feed matching, pricing, or BOQ evidence today — the
drawing review lineage is self-contained — and Requirement↔Drawing Evidence
reconciliation is explicitly DOC-R4's scope. Converging them now would implement
R4 before its architecture study, which is forbidden. R4 must resolve each
through the completed R3 authority model; the guard test pins the list so none
can be silently dropped or silently kept.

| Location | What it selects |
|---|---|
| `worker/drawing-structural-review-api.mjs` `:8` `currentStructure` | Structure derived from the head document version (`sv.document_version_id = d.current_version_id`) |
| `worker/drawing-architecture-review-api.mjs` `:97–102, :143` `projectArchitectureDocuments` | Intake derived from the head document version (`iv.document_version_id = d.current_version_id`) |

## Deliberately out of scope

- `worker/document-api.mjs.bak`, `worker/specification-extraction-background.mjs.golden-backup` —
  preserved byte-identical backups, not production code.
- `db/schema.ts` — the column definition, not a read.
- `version_number`/`uploaded_at`/`created_at DESC` ordering on analysis-run,
  job, event, and intake tables — run currency, not document-revision authority.
  Run versions are not document revisions and were never in DOC-R3's scope.

## Guard

`tests/current-version-id-authority.test.mjs` enforces this audit statically: no
head-anchored BOQ/specification evidence selection may exist, and the R4 list
above must be present-with-classification until R4 converges it.
