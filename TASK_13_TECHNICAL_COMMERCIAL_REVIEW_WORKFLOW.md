# Task 13 — Technical and Commercial Review Workflow

Status: Complete. Migration, build, lint, focused tests, full regression tests and clean-database migration verification pass. Task 14 has not started.

## 1. Current Review Workflow Audit

The existing Review screen already presented useful dossier and exception controls, source ownership, technical evidence, price validity, exchange-rate, commercial-term and scope-alignment checks. Those controls were mostly derived from browser state and did not provide one durable queue, reviewer assignment, immutable decisions, version locking, dependencies, conditions, clarification records or server-computed quotation readiness. Task 13 preserves that useful screen and adds the authoritative workflow above it.

## 2. Target Review Architecture

`review-workflow.mjs` owns deterministic status, priority, decision, bulk-action and readiness rules. `review-workflow-api.mjs` reloads project membership, current safety, current pricing, technical decisions, dependencies and versions before every action. D1 stores workflow state and immutable history. The existing Review page consumes the API but cannot authorize decisions itself.

## 3. Review Queue Model

Queue records retain project and BOQ scope, review type, calculated priority and score, severity, controlled status, assignee, required role, due date, blocking state, source module, reason, required decision, approval level, safety state, entity version, review version and escalation state. Queue synchronization creates items only from persisted BOQ/safety/pricing exceptions and is idempotent for active items.

## 4. Review Type Model

The model accepts all specification-defined review types. Initial automatic synchronization creates `Final Estimation Review` items spanning current safety and pricing evidence; specialized modules can create narrower review types without schema changes.

## 5. Status Transition Model

All 16 controlled statuses are implemented with explicit allowed transitions. Premature `Open → Approved`, closed-item mutation and out-of-order work are rejected. Reopen and supersede paths preserve history.

## 6. Assignment and Priority Model

Assignments retain primary/backup type, role, team, deadline, SLA, assigner and effective dates. Priority combines safety, severity, blocking impact, deadline, value, confidence, margin exception and supplier dependency; it is not a cosmetic manual label.

## 7. Technical Approval Model

Technical decisions require a Senior Technical Reviewer, Technical Manager or Admin, current review version, substantive reason, eligible current Safety decision, resolved blocking dependencies and valid evidence/conditions. Discovery-only or safety-blocked candidates cannot be approved.

## 8. Commercial Approval Model

Commercial, cost, margin and price decisions require a Commercial Reviewer, Commercial Manager, Management or Admin. The server requires an earlier technical approval and current approval-ready pricing before accepting commercial approval.

## 9. Conditional Approval Model

Conditional decisions require explicit description, owner and due date. Conditions are separate persistent records and remain open until independently verified and closed. Open conditions prevent completion.

## 10. Approval Level Model

Queue items carry approval levels 1–5. Required roles and step records allow standard review, warnings, technical exceptions, commercial exceptions and management approval. Every decision copies its applicable approval level into immutable history.

## 11. Sequential and Parallel Approval Design

Approval steps store group, order, sequential/parallel mode, role, required approval count, status, decision actor and expiry. Final state is derived only after required branches complete; the model supports one, two, majority, unanimous and role-specific configurations.

## 12. Conflict Resolution Workflow

Conflict resolution retains both original sources as structured evidence, the conflict type, chosen resolution, substantive reason, project-exception scope and resolver. Neither source is overwritten.

## 13. Clarification Workflow

Clarifications persist question, recipient, priority, due date, affected entities, status, response and resolution. Creating one moves the review to `Waiting for Clarification`; recording a response signals recalculation. External sending remains out of scope.

## 14. Manual Price Review Workflow

Manual-price decisions flow through the same commercial role, reason, technical-order, pricing-safety, version and audit controls. Existing Task 12 validation remains authoritative and is not duplicated.

## 15. Override Review Workflow

Task 11 safety overrides remain authoritative. Task 13 reviews their resulting safety state and approval level; non-overridable blocks remain impossible to bypass. Escalations are explicit, blocking, versioned and audited.

## 16. Dependency Model

Dependencies link each review to clarification, supplier, evidence, specification, technical, commercial, pricing, manager or conflict work. Any blocking dependency not marked `Completed` prevents approval and completion.

## 17. Project Review Summary Model

The server returns totals for open, in-review, waiting, approved, conditional, rejected, blocked, escalated and overdue records. Values come from D1 review rows, not browser counters.

## 18. Final Estimation Readiness Model

Readiness is server-computed as Not Ready, Technical Review Required, Commercial Review Required, Clarifications Pending, Supplier Pricing Pending, Exceptions Pending, Ready with Warnings, Ready for Quotation or Rejected. Safety blocks, pricing gaps, clarifications, decisions and conditions determine the result; the frontend cannot submit a readiness value.

## 19. Database Changes

Migration `0011_chilly_joseph.sql` adds queue items, assignments, immutable decisions, approval steps, approval conditions, dependencies, clarifications, conflict resolutions, comments, attachments, notifications and immutable audit records. Applying all migrations to a clean database produces 106 tables and 273 indexes with no foreign-key violations.

## 20. API Specification

Implemented routes cover queue list/search/filter, exception synchronization, detail workspace, assignment, start, technical/commercial decision, comment, evidence, clarification creation/response, conflict resolution, escalation, completion, reopen, history, project summary, quotation readiness and safety-controlled bulk assignment. All routes authenticate, isolate projects, resolve durable roles, use prepared statements, validate current versions and return structured actionable errors.

## 21. Frontend Changes

The existing Review page now opens with a responsive server-controlled queue, real project metrics, quotation readiness, status/search filters, priority and safety visibility, approval authority, version state, decision reasons and working Start, Request changes, Approve and Escalate actions. The prior engineering dossier and detailed validation controls remain intact below it.

## 22. Notification Events

The durable notification entity supports assignment, due-soon, overdue, changes-requested, approval, rejection, clarification, conflict, escalation and condition-due events. This task persists internal event delivery state; external delivery is deferred as required.

## 23. Security Review

Project access is checked through ownership or active membership. Decision roles come from `project_members`, never a client role header. Commercial and technical approvals have distinct role gates. Every critical action revalidates safety, pricing, dependencies and versions. Audit history is append-only; delete fields are soft-delete markers; attachments remain linked to governed document IDs and project scope.

## 24. Test Plan

Unit coverage verifies status transitions, priority, technical and commercial rules, conditional approval, dependency blocking, bulk safety, readiness and summaries. API/static integration verifies anonymous rejection, complete persistence, role/version/safety controls, audit and route order. The full Tasks 3–12 suite remains a release gate.

## 25. Implementation Summary

Key files are `app/domain/review-workflow.mjs`, `worker/review-workflow-api.mjs`, `worker/index.ts`, `db/schema.ts`, `drizzle/0011_chilly_joseph.sql`, `app/page.tsx`, `app/globals.css`, `tests/review-workflow.test.mjs` and `tests/review-workflow-api.test.mjs`. Verification result: build passes, lint passes and all 356 tests pass.

## 26. Known Limitations

- Initial queue synchronization creates one cross-domain final-estimation exception per persisted BOQ item; future source modules can create the narrower review types already supported by the schema.
- The API supports comments, evidence, clarification and conflict workflows; the first UI slice emphasizes the primary queue and decisions. Detailed side panels can be expanded without changing authority or persistence.
- Notification records are internal only; external email, supplier sending and RFQ communication remain later-task work.
- Task 14 professional Excel export has deliberately not started.

## Acceptance and mandatory regressions

The implementation rejects discovery-only/safety-blocked approval, commercial approval before technical approval, missing reasons, unresolved dependencies, stale versions, unauthorized roles, invalid conditions and incompatible bulk actions. Every persisted action creates an immutable audit record; project metrics and quotation readiness are computed from durable records.
