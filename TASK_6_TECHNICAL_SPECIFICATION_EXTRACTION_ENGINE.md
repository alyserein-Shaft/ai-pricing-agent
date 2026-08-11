# Task 6 — Technical Specification Extraction Engine

## 1. Current-state audit

The product previously contained a small hard-coded fire-alarm requirement showcase. It was not a durable extraction result and could not support arbitrary specifications. Task 6 introduces the authoritative, project-isolated path; the legacy showcase remains isolated for backward compatibility.

## 2. Target architecture

Confirmed Technical Specification classification schedules an asynchronous worker. The worker reads the immutable document version, reconstructs source pages, detects the specification hierarchy, extracts candidate requirements, validates them, writes an append-only extraction version, and exposes human review and approved-requirement APIs.

## 3. Supported sources

- PDF: coordinate-aware PDF.js text extraction with page and line reconstruction; the lightweight stream reader remains a fast path.
- DOCX: native OOXML paragraph and rendered-page-break extraction.
- TXT/CSV: plain-text clause extraction for controlled imports.
- Scanned PDF: returns `OCR_REQUIRED` when no approved OCR provider is configured.
- Legacy DOC: returns `LEGACY_DOCUMENT_CONVERTER_REQUIRED` rather than inventing content.

The portable PDF parser is vendored as `vendor/pdfjs-dist-5.6.205.tgz`; installation does not depend on a machine-specific cache.

## 4. Hierarchy model

The parser preserves Division, Section, Part, Article, Clause and heading paths. Every requirement retains page range, section, part, article, clause, full clause path and original clause text.

## 5. Requirement model

Requirement strength supports mandatory, prohibited, conditional, preferred, optional, informational, approved-equivalent and review states. Categories include functional, performance, capacity, compliance, standards, compatibility, environmental, electrical, installation, testing, commissioning, warranty, documentation, training, maintenance, manufacturer, accessories and other engineering constraints.

## 6. Structured technical facts

The deterministic extractor identifies IP/IK ratings, voltage, current, power, capacity, temperature ranges, warranty duration and bandwidth with original value, normalized value, unit, operator, confidence and source. Unknown values remain absent.

## 7. Standards and manufacturers

Standards retain body, number, part, year, original text and obligation status. Manufacturer references retain status such as approved, prohibited, preferred, basis of design or equivalent subject to approval. Named products are never treated as approved solely because they appear in text.

## 8. Compatibility and accessories

Explicit interface and compatibility statements are modeled separately from required accessories. Each relationship keeps its source requirement and confidence. Derived accessories are visibly distinguished from explicit obligations.

## 9. Ambiguity, conflict and missing information

Vague phrases such as “as required,” “suitable,” “complete system,” and “all required accessories” create blocking clarification records. Contradictory normalized technical values create conflict records. Domain-critical missing fields create explicit missing-information records with technical impact, commercial impact and a clarification question.

## 10. Confidence and review

Confidence combines obligation language, clause anchoring, structured evidence and ambiguity penalties. Human approval is a separate state. Low-information or ambiguous statements cannot become approved downstream requirements automatically.

## 11. Persistence and versioning

Migration `drizzle/0004_rich_norman_osborn.sql` adds extraction versions, sections, clauses, technical requirements, attributes, standards, manufacturers, compatibility, accessories, ambiguities, conflicts, missing information, evidence, review decisions and revision comparisons. Reruns supersede a current extraction but never overwrite history.

## 12. API surface

Document endpoints support start, rerun, status, summary, sections, clauses, requirements, evidence, warnings, missing information, ambiguities, conflicts, history, revision comparison, safe CSV export and approved requirements. Requirement endpoints support detail, edit, restore, approve, reject, clarification and evidence. Conflict resolution requires a substantive reason. Every endpoint enforces project ownership.

## 13. Queue integration

High-confidence Technical Specification classification schedules extraction automatically. Manual confirmation or override to Technical Specification does the same. BOQ and specification downstream routes remain separate.

## 14. User experience

The project document area now includes a focused Technical Specification Requirements launcher showing extraction state, candidate count, review count and conflict count. Reviewers can start/rerun extraction, inspect requirements and conflicts, open source evidence and export the staged extraction. It does not change BOQ quantities or prices.

## 15. Revision comparison

Comparisons report added, removed and changed source-linked requirements between immutable extraction versions. Historical values and both source versions remain available.

## 16. Security and trust controls

Files are treated as data, never executed. APIs are owner-scoped. Original and edited values are stored independently. Manual actions create decision and audit records. CSV export neutralizes spreadsheet-formula prefixes. OCR and legacy conversion fail closed until approved providers exist.

## 17. Verification evidence

- Seven focused Task 6 tests pass: hierarchy/provenance, requirement strength, structured extraction, ambiguity/missing data, conflicts, DOCX/OCR behavior and revision comparison.
- The complete release suite passes: 267 tests, zero failures.
- Build and lint pass.
- The supplied 31-page fire-alarm specification was processed directly: 31 pages, 489 detected hierarchy nodes, 457 clause records and 458 requirement candidates using `pdfjs-coordinate-layout`.
- The real-file run found 114 standards references, eight compatibility rules, 56 accessory references, eight ambiguities, nine possible conflicts and one domain-critical missing field. It routed 431 candidates to human review instead of auto-approving uncertain content.

## 18. Known limitations and Task 7 gate

No OCR provider is configured, so scanned specifications require OCR or a text-searchable source. Legacy DOC requires sandboxed conversion. PDF text reconstruction preserves page coordinates but not highlighted word bounding boxes in the current review UI. Semantic conflict detection is deliberately conservative and may surface false positives across distinct equipment clauses; these remain review records, not conclusions.

Task 6 is complete and accepted for the supplied text-searchable specification. Task 7 may now build the canonical engineering knowledge model from approved, source-proven facts only.
