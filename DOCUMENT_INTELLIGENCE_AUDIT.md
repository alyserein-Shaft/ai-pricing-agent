# AI Pricing Agent — Document Intelligence Audit and Implementation Baseline

Status: Verified against the local implementation  
Date: 1 August 2026  
Owner perspective: Principal AI Document Intelligence Architect

## 1. Executive judgment

The current product has a careful document intake and review interface, not a complete document-intelligence pipeline. It provides real hashing, duplicate detection, revision staging, manual roles, issue controls, a generic CSV BOQ parser, and three exact-fingerprint fire-alarm profiles. It does not provide general Excel/PDF/Word parsing, OCR, layout analysis, drawing understanding, immutable source storage, asynchronous jobs, or an AI matching index.

The immediate architectural decision is to preserve the existing review gates while replacing UI-owned, fingerprint-specific behavior with a versioned server-side document pipeline. Unsupported capabilities must remain explicit; registration, classification, extraction, validation, and approval are different states.

## 2. Verified current workflow

1. The browser receives selected `File` objects.
2. The client calculates SHA-256 over each complete file.
3. Same-name/different-content files are staged as revision candidates.
4. Duplicate content is rejected within the project intake.
5. A role is inferred mainly from filename or selected by the user.
6. Original bytes are discarded after the browser event.
7. Metadata, hashes, and product state are serialized into `localStorage`.
8. Exact known fingerprints expose embedded BOQ/specification/catalogue fixtures.
9. Generic CSV BOQ files are parsed into review candidates.
10. A human confirms issue metadata and accepts/excludes candidates before BOQ application.

## 3. What is real, partial, simulated, and absent

| Capability | Finding | Status |
|---|---|---|
| Upload selection | Browser file input accepts PDF, Excel, CSV, Word | Real but client-only |
| Integrity fingerprint | Browser SHA-256 | Real |
| Malware/virus validation | No scanner, quarantine service, or signature validation | Absent |
| Duplicate detection | Project-local fingerprint/name controls | Real but not tenant/global |
| Immutable file storage | Original bytes are not retained | Absent |
| Classification | Filename rules plus manual role | Partial |
| Excel parsing | Exact known workbook fixture only | Simulated profile; no general parser |
| CSV BOQ parsing | Required-column parser with row errors and ignored prices | Real, narrow |
| PDF parsing | No runtime parser | Absent |
| Word parsing | No runtime parser | Absent |
| OCR | No scan detection or OCR engine | Absent |
| Layout/table analysis | No engine; known tables are embedded | Absent |
| Specification extraction | Six embedded groups for one fingerprint | Simulated profile; not generalized |
| Drawing extraction | Filenames/categories only | Absent |
| Price-list extraction | One embedded Honeywell profile | Simulated profile; not generalized |
| Engineering entities | A few embedded product/requirement objects | Partial fixture |
| Relationships/citations | BOQ row and six clause anchors for known files | Real for fixture, absent generally |
| Review workflow | Human decisions, evidence, audit events, application gates | Real locally |
| Database | Drizzle existed with an empty schema | Absent before this baseline |
| APIs | No product document API | Absent |
| Background jobs | No queue, worker, retry, cancellation, or progress | Absent |
| Matching index | No search/vector/full-text document index | Absent |

## 4. Stage-by-stage gap analysis

| Stage | Current state | Missing logic / debt | Engineering and business risk | Recommended solution | Complexity | Priority |
|---|---|---|---|---|---|---|
| Upload | Client reads entire file to hash | No multipart upload, object retention, server checksum | 100 MB files exhaust browser memory; evidence disappears | Signed multipart object upload, server checksum, immutable version record | High | Critical |
| Integrity | SHA-256 and duplicate checks | Malware scan, MIME sniff, archive-bomb protection, PDF encryption/corruption | Unsafe or unreadable evidence enters workflow | Quarantine-first validation service with actionable codes | High | Critical |
| Classification | Filename/manual role | Content/layout classifier, confidence components, correction learning | Misrouted documents and false extraction | Deterministic metadata first, evaluated model second, mandatory correction | Medium | Critical |
| OCR | None | Scan detection, page quality, rotation/language, OCR artifacts | Scanned tender evidence is invisible | OCR only for pages without usable text; preserve page coordinates | High | High |
| Layout | None | Page blocks, reading order, headers/footers, title blocks | Tables and clauses lose structure | Coordinate-backed layout artifact per page | High | Critical |
| Tables | CSV only | PDF/Excel merged cells, sheet hierarchy, units, headers | Quantity and price corruption | Native Excel parser plus layout-aware PDF table extraction | High | Critical |
| Engineering sections | Six fixed requirements | General section taxonomy and applicability | Obligations omitted | Versioned engineering section/requirement schema | High | Critical |
| Metadata | Filename/manual issue fields | Title blocks, revision, issuer, page count, sheet names | Wrong revision/baseline | Extracted assertions with citations and human confirmation | Medium | Critical |
| Entities | Fixed fixtures | Manufacturer, model, standards, ratings, cable/accessories | Unsafe matching | Typed entity schema with normalized values and evidence | High | Critical |
| Relationships | Minimal anchors | BOQ-spec-drawing-product-supplier links | System cannot reconcile scope | Evidence graph over immutable versions and assertions | High | High |
| Validation | Strong UI gates | Server-authoritative schemas, reconciliation, processor QA | Client mutation and silent parser defects | Validation policies and quarantine/needs-review states | Medium | Critical |
| Storage | localStorage metadata | DB, object storage, retention, provenance | Loss, no collaboration, no audit authority | SQL metadata + object artifacts + checksums | High | Critical |
| AI matching availability | Embedded candidates | Search/index publication contract and reindexing | Extracted facts cannot be retrieved safely | Publish only validated assertions with source citations | Medium | High |

## 5. Implemented foundation in this release

### Domain processing contract

`app/domain/document-intelligence.mjs` now defines:

- Supported document classifications
- The complete 13-stage pipeline
- User-facing processing states
- Stable actionable error codes
- Deterministic classification with declared-intent precedence
- Upload envelope validation for format, size, emptiness, and SHA-256
- Idempotent processing-run creation
- Stage advancement with optional OCR skipping
- Retry exhaustion and terminal failure behavior
- Cooperative cancellation
- A structured engineering extraction envelope
- Citation and engineering-table validation

This is processing orchestration logic, not a claim that OCR/parsers already exist.

### Persistence contract

`db/schema.ts` now defines the first authoritative document-intelligence tables:

- `documents`: project-owned logical document
- `document_versions`: immutable bytes, checksum, issue metadata, quarantine state
- `document_processing_runs`: stage, status, progress, attempts, cancellation, errors
- `document_artifacts`: versioned OCR/layout/table/extraction object artifacts
- `document_assertions`: typed engineering facts with confidence, review state, and source region
- `processing_logs`: structured operational job logs

Original bytes and large artifacts belong in object storage; SQL stores keys, checksums, status, and queryable assertions.

## 6. Target processing architecture

```mermaid
flowchart LR
  U["Signed multipart upload"] --> O["Quarantined object version"]
  O --> V["Integrity and malware validation"]
  V --> Q["Durable processing queue"]
  Q --> C["Classification worker"]
  C --> P["Format router"]
  P --> X["Native text / spreadsheet parser"]
  P --> R["Selective OCR worker"]
  X --> L["Layout and table artifacts"]
  R --> L
  L --> E["Engineering extraction"]
  E --> G["Relationship and validation policies"]
  G --> H["Human review"]
  H --> I["Validated matching index"]
```

## 7. Required service boundaries

- Upload API: creates document/version, supplies object upload session, finalizes checksum.
- Integrity worker: MIME sniffing, antivirus, password/corruption/archive validation.
- Orchestrator: leases jobs, advances stages, handles retries/cancellation/dead letters.
- Format adapters: PDF, Excel, Word, image, email, ZIP; never flatten native structure prematurely.
- OCR adapter: page-selective and coordinate-preserving.
- Engineering extractor: emits schema-validated assertions and relationships with citations.
- Validation service: reconciles page counts, table totals, units, duplicates, and required metadata.
- Review API: records corrections separately from model output.
- Index publisher: publishes only allowed reviewed/validated assertions to matching.

## 8. Safety and quality rules

- A filename classification is always reviewable and never authoritative evidence.
- Uploaded, completed, needs review, and approved are distinct states.
- OCR is skipped when native text/layout is usable.
- Every extracted engineering fact retains document version, page, region, and source text.
- Tables retain rows, columns, merged-cell semantics, units, headers, hierarchy, and regions.
- Model output never overwrites raw parser artifacts.
- Corrections are append-only review decisions and training/evaluation candidates.
- Matching cannot consume failed, quarantined, unvalidated, or superseded versions.
- Retries require idempotency keys and cannot duplicate assertions/artifacts.
- Cancellation is cooperative; immutable artifacts already written remain traceable.

## 9. Migration plan

### DI-1 — Durable intake

Create D1 migrations, R2 bindings, upload/finalize APIs, quarantine validation, and processing-run creation. Migrate local fixtures as explicit sample-project seeds. Do not migrate original bytes because the browser never stored them.

### DI-2 — Native BOQ and specification parsing

Implement Excel workbook parsing with sheet/cell/merged-range provenance and PDF native-text/layout parsing. Route the existing CSV parser through the same extraction-envelope contract.

### DI-3 — Selective OCR and engineering extraction

Add page scan detection, OCR adapter, requirement/entity schemas, citations, and evaluated fire-alarm extractors. Preserve raw/native/OCR artifacts independently.

### DI-4 — Drawings and cross-document reconciliation

Add title-block, legend, symbol, schedule, and revision extraction; then human-verified counts/topology and BOQ/spec/drawing conflict records. Do not claim autonomous drawing takeoff before evaluation thresholds are met.

### DI-5 — Matching publication and scale

Publish reviewed assertions to retrieval, add catalogue ingestion, concurrency limits, 100 MB multipart uploads, 1,000-page chunking, backpressure, dead-letter operations, metrics, and quality dashboards.

## 10. Definition-of-done status

Not complete. The orchestration and persistence contracts now exist, but production completion still requires object storage, APIs, queue workers, real format adapters, OCR, engineering extraction, review persistence, matching publication, observability, load tests, and quality evaluation. The product must not claim automatic document understanding until those adapters and acceptance tests pass.

## 11. Native parser increment

The first DI-2 adapters are now implemented below the UI:

- Native XLSX/Open XML parsing over ZIP packages
- Worksheet, row, cell, style-index, and merged-range preservation
- BOQ table detection using controlled header aliases
- Candidate extraction with exact sheet, row, and cell references
- Fail-closed behavior for corrupt/encrypted/non-XLSX packages
- PDF header, encryption, page-object, text-operator, and image-object inspection
- Native-text versus selective-OCR routing without claiming OCR execution
- Format-specific processing plans
- Matching publication policy requiring completed processing, accepted integrity state, current version, human-accepted assertions, and source-region provenance

Still missing from DI-2: full PDF content/layout extraction, Word parsing, formula evaluation, chart/drawing objects, advanced multi-row/merged BOQ headers, and production-scale streaming. Selective OCR remains a routing decision only until an OCR adapter is configured and evaluated.
