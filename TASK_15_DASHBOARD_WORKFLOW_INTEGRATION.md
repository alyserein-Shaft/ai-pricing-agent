# Task 15 — Dashboard and Workflow Integration

Status: Complete (local implementation)

## 1. Current Dashboard and Navigation Audit

The previous Home dashboard, project cards, project strip, readiness percentage, and Action Queue were calculated from browser-local demo arrays. Real document, extraction, matching, safety, pricing, review, and export records already existed server-side, but the dashboard did not reconcile with them. Global and project context were visually related but operationally disconnected.

## 2. Target Dashboard Integration Architecture

Task 15 adds a versioned workflow domain model, a server aggregation API, durable read-model snapshots, formal metric definitions, and dashboard UI consumers. Canonical transactional tables from Tasks 3–14 remain authoritative. Dashboard snapshots are derived outputs and never overwrite source records.

## 3. Canonical Project Status Model

Workflow statuses are derived from current records. Supported derived states include Documents Pending/Processing, Extraction Review, Technical Requirements Review, Matching in Progress, Technical Review, Pricing in Progress, Commercial Review, Clarifications Pending, and Ready for Quotation. Only Won, Lost, On Hold, Archived, and Cancelled may manually override workflow derivation.

## 4. Workflow Stage Model

The model contains 12 stages: Project Setup, Document Upload, Document Classification, BOQ Extraction, Specification Extraction, Requirement Analysis, Product Matching, Technical Review, Pricing and Costing, Commercial Review, Export, and Quotation Readiness. Every stage has a status, progress, weight, owner, blocker/warning counts, next action, and filtered route.

## 5. Progress Calculation Model

Progress uses versioned stage weights totaling 100%. Stage completion is calculated from verified entity counts and workflow gates. Page visits, timers, and manually selected stages do not affect progress. Blocking safety, review, or clarification records prevent affected stages and quotation readiness from completing.

## 6. Dashboard Metric Registry

The registry defines metric ID, name, description, scope, source, formula, filters, exclusions, refresh strategy, permission, drill-down route, owner, version, and tests. Metrics without a defined source are not displayed.

## 7. Organization Dashboard Specification

The Home dashboard is now organization-scoped. It shows active, due-soon, overdue, blocked, processing, failed-job, review, missing-price, and quotation-ready counts from authorized projects. It provides a server-backed project list and a cross-project Action Queue.

## 8. Project Dashboard Specification

The project Overview displays server-derived identity, canonical status, progress, current workflow, documents, BOQ counts, matching and approval counts, role-aware commercial totals, next action, actionable queue, explained risks, and updated time.

## 9. Projects Page Specification

The operational project list uses authorized server records, supports search by project/client/tender identity, displays status, progress, current stage, BOQ and missing-price counts, risk, and exact next action. Pagination parameters are supported by the projects API.

## 10. Action Queue Model

Actions are generated from missing documents, failed jobs, unknown classification, extraction review, incomplete requirements, safety blocks, technical approval, missing price, blocking clarification, commercial approval, export readiness, and export failure. Each action carries project, type, priority, severity, reason, owner/role, blocker state, dates, and a filtered route.

## 11. Next Recommended Action Logic

The highest-priority action is selected by criticality, dependency order, workflow position, due date, and role. Critical safety, processing, or clarification blocks outrank routine work. A project-ready export action is created only after every readiness gate passes.

## 12. Project Risk Model

Risks are calculated for overdue or near-due low-progress projects, failed processing, technical safety conflicts, pricing gaps, and blocking clarifications. Every indicator includes severity, trigger, impact, affected module, owner, source, and recommended filtered action.

## 13. Role-Aware Dashboard Model

Project access is owner/member constrained. Commercial totals are returned only to Commercial Reviewer, Management, Administrator, or Project Manager roles. Other roles receive workflow and action information with an explicit commercial restriction state.

## 14. Project Navigation Model

Home and project dashboards are explicitly separated. Opening a project sets persistent project context; the project header, workflow ribbon, workspace lock, project dashboard, and module navigation use the selected project ID. The mobile navigation preserves the same context.

## 15. Deep-Linking Model

Actions and risks route to exact filtered workspaces, including failed documents, classification review, BOQ review, technical blocks, missing prices, clarification blockers, commercial review, and export failure/readiness. The URL records project, module, and filter parameters.

## 16. Refresh and Event Strategy

The dashboard refreshes every 15 seconds during normal work and every 5 seconds while processing is active. Navigation triggers an immediate refresh. This bounded polling approach is appropriate for the local worker and avoids premature WebSocket infrastructure.

## 17. Cache Strategy

Safety-critical responses use private `no-store` caching. Read-model records are source-versioned for reconciliation and history, not used to mask newer approval or safety states. Every dashboard request re-reads authoritative facts before returning status or readiness.

## 18. Database and Read-Model Changes

Migration `0013_smart_cable.sql` adds project dashboard profiles, workflow stage states, progress snapshots, metric definitions and snapshots, project risks, status history, and dashboard audit logs. All 14 migrations apply cleanly to a fresh database: 120 tables and 313 indexes with no foreign-key violations.

## 19. API Specification

Implemented operations include organization dashboard, metric registry, searchable/paginated project list, project dashboard, workflow, actions, risks, archive, restore, hold, resume, owner assignment, and protected soft delete. APIs enforce identity, project membership, management permissions, validation, private caching, and audit logging.

## 20. Frontend Changes

The existing shell is retained. The Home dashboard now consumes organization data; Project Overview consumes project data. The persistent workflow ribbon, status strip, action count, BOQ count, server badge, project cards, progress, next action, risk explanations, loading, empty, and error states are connected to server responses.

## 21. Security Review

Queries are isolated to owned or active-member projects. Organization aggregation includes only authorized projects. Commercial data is role-filtered server-side. Management mutations require a management role and reason. Permanent history loss is prevented when approvals or completed exports exist.

## 22. Performance Review

List results are bounded and paginated. Existing indexed project, document, processing, BOQ, review, pricing, safety, and export tables are used. Read snapshots support future incremental aggregation. Polling frequency is reduced when no processing is active.

## 23. Test Plan and Results

Unit coverage verifies progress, stage state, status derivation, readiness, action generation, deep links, risk explanations, role visibility, and metric definitions. Integration/static coverage verifies canonical table sources, route ordering, durable read models, project controls, soft-delete protection, and frontend server consumption. The full suite passes: 385 tests, 0 failures. Production build passes. Lint has no errors. Desktop and 390×844 browser checks show no horizontal overflow.

## 24. Implementation Summary

- Workflow engine: `app/domain/dashboard-workflow-engine.mjs`
- Dashboard API: `worker/dashboard-api.mjs`
- Worker routing: `worker/index.ts`
- Schema: `db/schema.ts`
- Migration: `drizzle/0013_smart_cable.sql`
- Interface: `app/page.tsx`, `app/globals.css`
- Tests: `tests/dashboard-workflow-engine.test.mjs`, `tests/dashboard-api.test.mjs`

## 25. Known Limitations

- Refresh uses bounded polling rather than SSE/WebSocket.
- Organization totals are calculated per authorized project request; a background materialized-view worker is deferred until scale requires it.
- The local application still contains legacy browser-only estimation modules for backward compatibility, but active Home and Project dashboard status/progress/actions no longer use them.
- Supplier-response counts remain limited to existing persisted supplier/review records; Task 15 does not implement supplier RFQ sending.
- The current UI exposes the core search and operational filters through deep links; a full multi-field project filter builder is not added.
- Task 16 has not been started.
