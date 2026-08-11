# AI Pricing Agent — Product Delivery Operating Model

Effective date: 1 August 2026  
Owner: Lead Technical Product Manager / Engineering Program Manager  
Product position: AI-powered pre-sales engineering platform, not a BOQ extraction utility

## 1. Product mission

Reduce the time required to produce technically defensible engineering quotations while improving pricing accuracy, review quality, and source traceability across Fire Alarm, CCTV, Access Control, Structured Cabling, AV, BMS, Low Current, Electrical, and MEP projects.

The platform must automate work without automating accountability. AI may propose, extract, compare, explain, and prioritize. It may not silently approve scope, compliance, price evidence, supplier award, or client output.

## 2. Product success measures

### Business outcomes

- Median time from tender receipt to reviewed quotation
- Estimator hours per project and per BOQ line
- Quotation throughput per estimator
- Win rate and gross-margin variance between estimate and delivered project
- Supplier response cycle time
- Percentage of quotations issued without post-issue correction

### Product outcomes

- Percentage of project documents correctly classified
- Percentage of extracted fields accepted without correction
- BOQ and specification citation coverage
- Percentage of BOQ lines with current, approved price evidence
- Percentage of product matches accepted, rejected, or changed by engineering
- Time spent in each workflow stage
- Number and age of unresolved review controls

### AI quality outcomes

- Precision, recall, and field-level accuracy by document type and discipline
- Citation correctness
- Match ranking quality and required-attribute violation rate
- Confidence calibration: observed accuracy by confidence band
- Unsupported-claim and unsafe-approval rate
- Human override rate and categorized override reason
- Model cost and latency per processed page/project

### Reliability outcomes

- Availability and job completion rate
- P50/P95 page processing time and interactive response latency
- Failed/retried/stalled background jobs
- Recovery point and recovery time objectives
- Authorization and cross-tenant isolation failures

## 3. Decision principles

1. Solve a verified user and business problem, not a screen request.
2. Preserve source provenance from ingestion through client output.
3. Prefer one authoritative workflow state over duplicate dashboard calculations.
4. Use human review at liability-bearing decisions.
5. Treat confidence as calibrated evidence, not visual decoration.
6. Separate technical compliance, commercial evidence, and approval authority.
7. Build shared domain capabilities before discipline-specific UI duplication.
8. Avoid premature microservices; establish modular domain boundaries first.
9. No production feature is complete without observability, security, accessibility, and QA.
10. Reject features that create apparent automation while hiding uncertainty or transferring risk to the estimator.

## 4. Priority framework

| Priority | Definition | Required response |
|---|---|---|
| Critical | Data loss, security/tenant breach, unsafe quotation, invalid approval, or release-blocking defect | Stop affected release; fix immediately; add regression and incident controls |
| High | Major workflow failure, inaccurate engineering/pricing output, or blocker to enterprise use | Commit to current or next sprint with named owner and dependency plan |
| Medium | Material efficiency, clarity, maintainability, or adoption improvement | Schedule against measured impact after Critical/High work |
| Low | Useful polish with limited measurable impact | Pull only when capacity remains or when bundled with related work |
| Future | Valid idea dependent on missing foundations or unproven demand | Keep in discovery; do not imply delivery commitment |

Priority is determined by severity, frequency, affected users/projects, reversibility, compliance/liability exposure, revenue impact, and dependency leverage—not stakeholder seniority.

## 5. Feature decision record

Every feature must be defined with all sections below before implementation.

### 1. Goal

State the user/business problem and the measurable change expected.

### 2. Business value

Identify affected personas, workflow cost, commercial impact, and success metric.

### 3. Current state

Reference verified behavior in the current product. Distinguish missing capability from incomplete or duplicate capability.

### 4. User story

As a specific role, I need a capability so that I can achieve an outcome.

### 5. UX flow

Define entry point, primary path, review/approval points, empty/loading/error states, keyboard/mobile behavior, and maximum reasonable steps.

### 6. Technical architecture

Define domain owner, application command/query, persistence, background work, integration boundary, observability, and failure behavior. Avoid placing new domain logic directly in the monolithic page component.

### 7. AI workflow

Define model task, input evidence, output schema, citations, confidence calculation, deterministic validation, human-review gate, fallback, prompt/model version, and evaluation dataset.

### 8. Database impact

Define entities, ownership/tenant keys, relationships, versions, constraints, retention, audit events, migration, and deletion policy.

### 9. API impact

Define commands, queries, idempotency, authentication/authorization, pagination, validation, error contract, rate limits, and versioning.

### 10. Edge cases

At minimum: missing/duplicate/conflicting evidence; document revisions; stale prices; unsupported currency; partial supplier response; concurrency; role mismatch; large files; poor scans; model timeout; retry; cancellation; archived projects; cross-project data.

### 11. Acceptance criteria

Use observable Given/When/Then behavior. Include negative safety cases and audit evidence, not only the happy path.

### 12. QA checklist

- Domain and calculation unit tests
- API and persistence integration tests
- Authorization and tenant-isolation tests
- AI golden-set and adversarial evaluation
- Browser journey and visual regression
- Keyboard, screen-reader, responsive, and WCAG checks
- Performance and background-job behavior
- Logging, metrics, alerts, and error recovery
- Migration, backup, and rollback verification

### 13. Risks

Record business, technical, AI, security, operational, legal/liability, data, adoption, and delivery risks with owner and mitigation.

### 14. Release plan

Define feature flag, migration sequence, pilot cohort, monitoring window, rollback trigger, customer communication, support/runbook update, and release notes.

### 15. Future improvements

Record only genuinely deferred extensions. Do not use this section to defer required safety, accessibility, observability, or data integrity.

## 6. Definition of Ready

A backlog item is ready only when:

- The business goal and metric are explicit.
- Current behavior has been verified.
- Primary personas and decision owner are identified.
- UX flow covers empty, loading, error, review, and completion states.
- AI and non-AI responsibilities are separated.
- Data, API, security, audit, and observability impacts are understood.
- Dependencies and risks have named owners.
- Acceptance criteria and QA plan are testable.
- Complexity has been estimated by the delivery team.
- No unresolved decision could materially change the solution.

## 7. Definition of Done

A feature is done only when:

- Acceptance criteria pass in a production-like environment.
- Domain behavior and authorization are enforced server-side where required.
- AI quality meets its approved evaluation threshold and unsafe cases remain blocked.
- Source provenance and audit events are complete.
- Accessibility and responsive behavior are verified.
- Performance remains within the feature budget.
- Logs, metrics, alerts, and operational runbook are available.
- Migrations and rollback are tested.
- Documentation and release notes are complete.
- Product, engineering, design, QA, security, and the relevant engineering/commercial owner approve release readiness.

## 8. Sprint operating model

### Before sprint planning

- Product presents outcome, evidence, priority, and acceptance criteria.
- Engineering validates architecture, dependencies, sequence, and estimate.
- AI lead validates dataset, evaluation, confidence, and human-review design.
- Design validates the end-to-end flow rather than individual screens.
- QA defines risk-based coverage before commitment.

### During the sprint

- Track outcomes and blockers, not percentage complete.
- Demonstrate working vertical slices with real evidence.
- Record scope decisions in the feature decision record.
- Do not silently trade away tests, provenance, security, accessibility, or observability.

### Sprint review

- Demonstrate the user journey and negative safety cases.
- Review product metric instrumentation and AI evaluation results.
- Confirm acceptance criteria and remaining risks.
- Decide release, limited pilot, further work, or rejection.

### Retrospective

- Review escaped defects, rework, cycle time, blocked dependencies, AI overrides, and quality-gate failures.
- Add concrete process or architecture actions with owners.

## 9. Release readiness gates

| Gate | Required evidence |
|---|---|
| Product | Goal, metric, acceptance criteria, pilot/release scope |
| UX | Complete journey, empty/loading/error states, usability/accessibility review |
| Engineering | Architecture review, green lint/build/tests, migration and rollback |
| AI | Versioned prompt/model, evaluation results, calibrated confidence, provenance |
| Security | Authentication, authorization, data handling, threat review |
| Commercial | Calculation reconciliation, current price evidence, approved client terms |
| Operations | Logs, metrics, alerts, SLO impact, runbook, support readiness |
| Governance | Audit trail, decision owner, immutable approved revision |

No gate may be marked passed merely because a calculation runs or no error is displayed.

## 10. Current program decision

The verified audit in `PRODUCT_AUDIT_AND_ROADMAP.md` remains the delivery baseline. The current program priority is Release 1: enterprise foundation and trustworthy workflow.

The next sprint is Sprint 0 — Baseline and Architecture:

- Fix the existing red lint gate and portable test command.
- Extract and characterize pricing, evidence, approval, and workflow domain rules.
- Approve architecture, data, identity, authorization, and audit decisions.
- Define the canonical product metrics and event taxonomy.
- Establish a risk register and release-quality dashboard.

Generalized AI extraction and semantic matching remain planned, but should not begin as production features until durable document storage, tenant isolation, server workflow authority, and evaluation infrastructure exist.
