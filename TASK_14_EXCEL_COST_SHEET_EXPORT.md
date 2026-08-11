# Task 14 — Excel Cost Sheet Export

Status: Complete (local implementation)

## 1. Current-state audit

The previous reporting flow was browser-oriented and did not create a governed, persistent, multi-sheet Excel cost sheet. It lacked locked source versions, export readiness checks, immutable history, reconciliation, role controls, downloadable server artifacts, and safe client-facing output.

## 2. Architecture

Task 14 adds a domain export engine, server-side workbook generator, authenticated export API, persistent export records, private object storage, reconciliation records, audit events, and a Reports workspace. Project records remain authoritative; the workbook is an output, not a second source of truth.

## 3. Workbook structure

The complete workbook supports these sheets:

1. Cover
2. Project Summary
3. Detailed Cost Sheet
4. BOQ Source
5. Technical Compliance
6. Product Alternatives
7. Cost Breakdown
8. Supplier and Price Sources
9. Clarifications and Risks
10. Review and Approval
11. Assumptions
12. Export Metadata (hidden)

Sheet inclusion is controlled by export mode. Client-safe output omits internal-only sheets and fields while it is generated.

## 4. Detailed cost columns

The canonical detailed row model contains 78 fields covering BOQ identity, source location, classification, technical requirements, selected product, manufacturer/model, match and safety status, quantity and unit, currency, material and labor components, accessories, logistics, overhead, contingency, cost, markup, margin, selling price, VAT, totals, supplier/source validity, review decisions, risks, assumptions, and version identifiers.

## 5. Technical compliance

The Technical Compliance sheet exposes requirements, evidence, source references, product response, compliance status, exceptions, confidence, and reviewer state. Missing or failed mandatory evidence remains visible and can block approved export.

## 6. Product alternatives

Alternative products are kept separate from the selected product. Their rank, manufacturer, model, match score, technical result, commercial availability, price, currency, source, and selection status are exported without presenting an alternative as approved.

## 7. Cost breakdown

Material, labor, equipment, accessories, logistics, overhead, contingency, and tax are separated. Supplier discounts remain scoped to applicable material rather than reducing unrelated services.

## 8. Supplier and price sources

Price provenance includes supplier/source, reference, source location, currency, effective date, validity date, and eligibility. Discovery-only or expired pricing is not silently promoted into approved costing.

## 9. Clarifications and risks

Open clarifications, owners, due dates, risk level, blocking state, and resolution status are exported. Unresolved blocking records prevent an Approved workbook.

## 10. Review and approval

Technical and commercial decisions, conditions, reviewer identity, decision time, and workflow readiness are shown. Approval status is derived from persisted review records, not a workbook checkbox.

## 11. Export metadata

The hidden metadata sheet records export ID, project and export mode, generation time, template version, locked project/data versions, reconciliation state, and content hash-related identifiers. It supports traceability but is not treated as encryption.

## 12. Templates and mappings

A built-in approved cost-sheet template and canonical field mappings are available through the API. The data model supports additional versioned templates and mappings without changing project source records.

## 13. Formulas

Detailed line totals and workbook grand totals use deterministic formulas. Authoritative server calculations are also recorded so reconciliation can compare workbook totals with the priced project snapshot. Missing values remain blank rather than being invented as zero.

## 14. Formatting

The workbook includes consistent title and header styles, currency and percentage formats, status colors, frozen panes, filters, practical column widths, print settings, and an executive summary. The supplied company workbooks informed construction-estimation conventions while the output remains normalized to this product's domain model.

## 15. Reconciliation

Material, service, total cost, selling value, VAT, final total, and line counts are reconciled against the locked project snapshot. Results and variances are persisted. Approved export fails closed when reconciliation or readiness fails.

## 16. Readiness rules

Draft exports may be generated with explicit warnings. Technical and Commercial modes require progressively stronger data. Approved mode requires complete quantities and eligible pricing, resolved blocking clarifications, required approvals, safe product matches, locked versions, and passed reconciliation. Client-safe mode applies protected-field exclusions during generation.

## 17. Versioning and history

Every export locks the relevant project/data versions, records its mode and template version, receives a sanitized versioned filename, and is stored as an immutable historical artifact. APIs support history, metadata, download, comparison, supersession, cancellation, and reconciliation.

## 18. Database changes

Task 14 adds export templates, template mappings, export jobs, export files, reconciliations, and export audit-log tables. Migration `0012_smiling_major_mapleleaf.sql` applies cleanly with all earlier migrations and no foreign-key violations.

## 19. API

The API supports template discovery; project preview, validation, export creation, and history; plus export status, metadata, private download, cancellation, supersession, reconciliation, and comparison. Authentication, project access, roles, version locking, and idempotency are enforced server-side.

## 20. Processing job

Workbook creation is server-side and deterministic. The generated bytes are hashed with SHA-256 and stored privately. In the local worker the job completes synchronously; the persisted queued/running/completed model allows a separate durable queue worker to be introduced when operational scale requires it.

## 21. Frontend

The Reports module now provides export-mode guidance, readiness and warning visibility, locked-version preview, expected sheet set, governed export creation, and immutable history/download access. It does not rely on client-side CSV generation.

## 22. Security

Downloads require authentication and project authorization, use private storage, disable caching, set content-type and content-disposition safely, and include a content hash. Spreadsheet formula-injection prefixes are neutralized. Client-safe protected fields are excluded rather than merely hidden.

## 23. Verification

- Full automated suite: 369 passed, 0 failed.
- Production build: passed.
- Lint: passed.
- Fresh database migration: 13 migrations applied, 112 tables, 292 indexes, no foreign-key violations.
- Workbook inspection: all 12 sheets rendered and visually checked.
- Formula-error scan: no formula errors found.
- Summary reconciliation: passed for the representative reference workbook.

## 24. Delivered files

- Domain rules: `app/domain/excel-export-engine.mjs`
- Workbook generator: `worker/xlsx-cost-sheet.mjs`
- Export API: `worker/excel-export-api.mjs`
- Worker routing: `worker/index.ts`
- Schema and migration: `db/schema.ts`, `drizzle/0012_smiling_major_mapleleaf.sql`
- Reports UI: `app/page.tsx`, `app/globals.css`
- Tests: `tests/excel-export-engine.test.mjs`, `tests/excel-export-api.test.mjs`
- Reference workbook: `outputs/task-14/AI-Pricing-Agent_Task14_Reference_CostSheet.xlsx`

## 25. Deliberate limitations and boundary

- The local worker currently generates exports synchronously; a separate durable queue consumer is not yet deployed.
- The workbook provides transparent totals and a governed snapshot, not an unrestricted editable scenario-planning model.
- The included reference workbook uses representative governed sample data; exports initiated from Reports use actual persisted project records.
- Export metadata is hidden for usability, not encrypted. Client-safe protection is achieved by excluding restricted data at generation.
- Generation is deterministic and suitable for normal project workbooks, but it does not yet stream extremely large datasets row-by-row.
- Task 15 has not been started.
