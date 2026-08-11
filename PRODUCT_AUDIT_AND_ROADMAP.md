# AI Pricing Agent — Verified Product Audit and Delivery Baseline

Status: Local prototype audit  
Audit date: 1 August 2026  
Target: Enterprise AI pre-sales engineering platform for construction systems

## 1. Executive summary

AI Pricing Agent is a strong, safety-conscious local prototype, not yet an enterprise SaaS product. It demonstrates a credible governed workflow from project intake through document review, technical matching, supplier RFQs, costing, validation, quotation approval, export, and audit history. The prototype is unusually careful about preventing historical catalogue prices, incomplete matches, stale supplier evidence, scope conflicts, and unreviewed technical requirements from silently becoming client prices.

Its principal limitation is architectural: almost the entire application, state model, workflow engine, and business logic live in a 2,954-line client component with 112 local state hooks. Persistence is browser `localStorage`; the database schema and hosting persistence bindings are empty; uploaded source bytes are not retained; authentication helpers exist but are not used by the product page; there are no product APIs, background jobs, AI services, tenant boundaries, or real multi-user approvals. Several “AI” results are deterministic, fingerprint-specific demo logic rather than a generalized extraction or reasoning pipeline.

The right next move is not to add more dashboard features. Release 1 must establish the enterprise foundation and preserve the prototype’s guardrails as domain rules. Only then should the team generalize document intelligence and matching.

## 2. Current product maturity

| Dimension | Maturity | Verified current state |
|---|---:|---|
| Product workflow | 3/5 | Eight governed stages and explicit blockers are implemented locally. |
| UX prototype | 3/5 | Broad end-to-end experience, responsive rules, empty/error states, and separate Home/Project dashboards. Information density remains high. |
| Domain safety | 4/5 | Strong controls for source validity, match readiness, scope conflicts, approvals, project ownership, and exports. |
| General AI capability | 1/5 | Known files are recognized by exact fingerprints; no model service, OCR pipeline, generalized specification analysis, or evaluation harness exists. |
| Architecture | 1/5 | Monolithic client component; no domain/application/infrastructure boundaries. |
| Data platform | 1/5 | Browser-local JSON persistence; empty Drizzle schema; no configured D1 or object storage. |
| Multi-user SaaS | 0/5 | No tenant model, authorization enforcement, server roles, collaboration, or server audit log. |
| Test discipline | 3/5 | 208 guardrail/rendering checks pass, but tests mainly assert source patterns and static behavior rather than service, browser, security, or load behavior. |
| Operations | 1/5 | Production artifact builds, but no application telemetry, job monitoring, backups, migrations, SLOs, or incident controls exist. |

Overall maturity: validated vertical prototype / pre-MVP, approximately TRL 4–5. It proves workflow and safety concepts but is not production-ready.

## 3. Verified implementation inventory

### Architecture and data flow

1. `app/page.tsx` is the client application, workflow engine, state store, calculation layer, document registry, matching logic, RFQ management, approval system, export service, and audit renderer.
2. State is restored from and saved to one browser `localStorage` payload.
3. Files are read in the browser. Names, hashes, classifications, and decisions are persisted; original file bytes are not included in backups.
4. Known BOQ, specification, and price-list behavior depends on exact SHA-256 fingerprints and embedded normalized datasets.
5. Generic BOQ support accepts CSV with System, Description, Unit, Quantity, and optional Technical Reference. Commercial columns are deliberately ignored.
6. Matching combines completeness gates with a small embedded historical Honeywell discovery library. Historical candidates cannot be directly approved.
7. Supplier responses are normalized locally and can become costs only after reviewed offer selection and award.
8. Calculations and quotation fingerprints are computed in the client. Final export requires the current approved fingerprint.
9. Exports are local CSV/JSON downloads. No PDF quotation composer, email delivery, ERP/CRM integration, or server archive exists.
10. The Cloudflare worker delegates requests to the app and supports image optimization only.

### Existing modules

- Home dashboard / project portfolio
- Project dashboard and project-isolated workspaces
- Project setup and tender context
- Documents, role-first intake, revision metadata, evidence map
- BOQ extraction review and generic CSV import
- Technical requirement review and evidence recording
- Product discovery and lifecycle review
- Cost management and manual price controls
- Supplier RFQ creation, export, response normalization, bid award
- Pricing validation and owner-routed blockers
- Client terms, scope deviation, quotation approval, revision fingerprinting
- Reports, draft/final export, audit register, local backup/restore
- Local working-role handoffs

### Features that are absent rather than incomplete

- Persistent database and object storage
- Tenant, organization, user, permission, and project membership model
- Real user authentication enforcement
- Server APIs and service layer
- OCR, document parsing workers, queues, and extraction versioning
- LLM/model gateway, prompt/version management, evaluations, and usage controls
- General product catalogue ingestion and semantic retrieval
- Drawing takeoff and cross-document quantity reconciliation
- Supplier portal, outbound communications, and response ingestion
- Configurable cost libraries, labor norms, logistics, taxes, and regional rules
- Reusable quotation templates and generated PDF/DOCX packages
- Integrations with CRM, ERP, email, document management, and accounting
- Operational logging, metrics, tracing, alerting, retention, and disaster recovery

## 4. Current workflow

Home portfolio → create/open project → register controlled documents → review extraction → review technical requirements → discover/match products → obtain supplier evidence/RFQs → review costs → validate controls → approve exact quotation revision → export client-safe issue package.

This is directionally correct for a pre-sales engineering platform. The weakness is that each stage is implemented as local UI state rather than durable workflow entities and server-enforced transitions.

## 5. Audit findings

| ID | Priority | Finding | Business impact | Engineering impact | Recommended solution | Complexity |
|---|---|---|---|---|---|---|
| A-01 | P0 | Browser-local persistence is the system of record. | Data loss, no collaboration, no enterprise trust. | No concurrency, transactions, retention, recovery, or server authority. | Introduce tenant-aware relational storage plus object storage; migrate the domain entities before adding features. | XL |
| A-02 | P0 | Authentication helpers are not wired into the product page; roles are local context only. | Any user with browser access can impersonate an approver. | No server authorization or separation of duties. | Enforce sign-in, organizations, project memberships, RBAC/ABAC, and server-side approval policies. | XL |
| A-03 | P0 | No generalized AI or extraction service exists. | Product cannot reliably support new construction packages. | Fingerprint-specific logic does not scale beyond demo evidence. | Build versioned ingestion, OCR/parsing, schema extraction, citations, confidence, human review, and evaluation services. | XL |
| A-04 | P0 | Domain logic is concentrated in one 2,954-line client component with 112 state hooks. | Delivery slows and regression risk increases. | High coupling, difficult testing, unstable renders, weak reuse. | Extract domain types/rules, application commands, repositories, calculation services, and module components incrementally. | XL |
| A-05 | P0 | Lint currently reports 15 errors and 10 warnings. | Signals an unreliable release gate. | Impure render-time dates, effect-driven state updates, missing dependencies, and dead code can create inconsistent UI behavior. | Make lint zero-error; inject clocks/IDs into actions; remove derived state effects; fix dependencies and dead code. | M |
| A-06 | P0 | Uploaded source bytes are not retained in the backup or a governed repository. | Audit evidence cannot be independently reproduced. | Hash/name records can outlive unavailable originals. | Store immutable source versions in object storage with malware scanning, metadata, checksums, and retention policy. | L |
| A-07 | P0 | Client-side approvals and audit hashes are not authoritative. | Quotation approval is not defensible as an enterprise control. | Browser data can be modified; timestamps are local and signatures are absent. | Create append-only server audit events, trusted timestamps, signed approval records, and immutable revision snapshots. | L |
| A-08 | P1 | The product identity and metadata still describe BOQ analysis rather than AI pre-sales engineering. | Weak positioning and unclear buying story. | Navigation/domain naming can drift from target capabilities. | Establish information architecture and product vocabulary around projects, engineering, sourcing, commercial review, and outputs. | S |
| A-09 | P1 | Navigation remains broad and dense despite Home/Project separation. | New users may not understand the next decision. | Many module states and overlays increase UI maintenance. | Use role-based landing views, progressive disclosure, consistent task queues, breadcrumbs, and saved filters. | M |
| A-10 | P1 | Document intelligence is file-presence/fingerprint oriented. | No scalable value on arbitrary tenders. | No page blocks, tables, entities, relationships, extraction versions, or reviewer corrections dataset. | Build canonical document/page/block/extraction schemas and review UI with field-level provenance. | XL |
| A-11 | P1 | Matching has safe gates but limited retrieval and reasoning. | Low automation and limited product coverage. | Embedded candidates cannot support multi-vendor catalogues or equivalents. | Add normalized product ontology, hybrid retrieval, requirement-to-attribute comparison, explainable scoring, and deviation workflow. | XL |
| A-12 | P1 | Costing is materials-oriented and project-specific. | Cannot model complete construction offers across trades. | No configurable labor assemblies, productivity, wastage, logistics, overhead, escalation, or location factors. | Create versioned cost books, assemblies, rate sources, landed-cost engine, allowances, and scenario comparison. | XL |
| A-13 | P1 | Supplier RFQs are CSV downloads; nothing is transmitted or synchronized. | Procurement cycle remains manual and opaque. | No communication status, supplier identity, response parsing, or reminders. | Add supplier contacts, approval-to-send, email/portal delivery, response ingestion, comparison, and award integration. | L |
| A-14 | P1 | Quotation output is CSV and browser preview. | Client deliverables are not commercially presentable. | No templating, document rendering, attachment pack, numbering, or immutable issue archive. | Build template-driven PDF/DOCX generation and an issued-document register tied to approvals. | L |
| A-15 | P1 | Testing over-relies on source-regex assertions. | High pass count may overstate behavioral confidence. | Refactors can fail tests without behavior change; integrations remain untested. | Add domain unit tests, API integration tests, migration tests, Playwright journeys, accessibility, security, and load tests. | L |
| A-16 | P1 | No observability or operational controls exist. | Failures and AI quality regressions will be invisible. | No logs, traces, metrics, SLOs, audit monitoring, or cost telemetry. | Establish structured logging, tracing, business metrics, model metrics, dashboards, alerts, and runbooks. | L |
| A-17 | P2 | Duplicate concepts exist across Overview, Review, workflow ribbon, project strip, and action queues. | Users repeatedly see similar status without a single source of truth. | Multiple derived presentations can disagree. | Define one workflow/readiness service and tailor summaries by context instead of recalculating in UI. | M |
| A-18 | P2 | Default fire-alarm project data is embedded in production UI state. | New users can mistake demo evidence for their project. | Demo fixtures and application code are coupled. | Move fixtures to explicit sample-project seeds and create a truly empty first-run state. | M |
| A-19 | P2 | Accessibility is partially addressed but unverified. | Enterprise and public-sector adoption risk. | No automated WCAG checks or keyboard/screen-reader test plan. | Target WCAG 2.2 AA, add semantic/dialog focus rules, axe checks, keyboard journeys, and contrast verification. | M |
| A-20 | P2 | Performance will degrade with large BOQs and document sets. | Real tenders may become slow or unusable. | All state serializes to localStorage and most views render client-side arrays. | Server pagination, indexed queries, virtualized tables, background processing, caching, and performance budgets. | L |

## 6. Duplicate, broken, and incomplete features

### Duplicate

- Status/readiness appears in the portfolio, project dashboard, workflow ribbon, project strip, validation, and quotation gate.
- Technical matching, matching diagnostics, costing exceptions, and review controls overlap.
- Settings, client terms, and commercial approval share concepts but do not yet use one durable commercial revision object.

### Broken or release-blocking

- Lint is red: 15 errors and 10 warnings.
- `npm test` depends on GNU `timeout`, which is unavailable in the current macOS environment; the underlying tests and build pass when invoked directly.
- Authentication is not enforced.
- The configured database schema and hosting binding are empty.

### Incomplete

- File upload registers evidence but only known fingerprints receive rich extraction.
- Audit chaining is explicitly local and mutable, not a signed server ledger.
- Supplier workflow stops at local file export/import.
- Reports lack executive, technical compliance, bid comparison, profitability, and issued-document packages.
- Roles communicate responsibility but do not authenticate people or enforce permissions.

## 7. Target product and module gap analysis

| Module | Current state | Target state | Missing work | Priority / effort | Dependencies / risks |
|---|---|---|---|---|---|
| Home & portfolio | Local project cards and readiness | Tenant portfolio, ownership, due dates, risk, workload, search | Server projects, memberships, query service, notifications | P1 / L | Identity and data foundation; avoid vanity metrics. |
| Project creation | Two-step local setup | Templates, disciplines, locations, tender timeline, stakeholders, governance | Project schema, templates, permissions, duplicate detection | P1 / M | Tenant/RBAC. |
| Documents | Local registration, hashes, roles, revisions | Immutable document repository with versions, OCR state, issue control | Object storage, scanning, parsers, document model | P0 / XL | Security, storage cost, regional data residency. |
| Extraction | Known fingerprints + generic BOQ CSV | General table/text/drawing extraction with citations and reviewer corrections | Workers, schemas, model routing, evaluation, correction capture | P0 / XL | Documents, queues, model governance. |
| Technical analysis | Six fire-alarm requirements and manual evidence | Multi-discipline requirements graph, conflicts, submittal/compliance matrix | Ontology, clause extraction, requirement versioning | P1 / XL | Extraction quality; liability. |
| Product matching | Safe embedded discovery candidates | Multi-vendor catalogue retrieval, compatibility, alternatives, explainability | Catalogue pipeline, attributes, hybrid search, scoring, evaluations | P1 / XL | Product data quality and licensing. |
| Cost management | Client calculations and supplier-backed prices | Assemblies, labor, logistics, overhead, scenarios, regional cost books | Cost engine, versioned rates, scenario model | P1 / XL | Finance rules, permissions, currency evidence. |
| Supplier RFQs | Local CSV package and response review | Approved outbound RFQs, supplier portal/email, reminders, normalized offers | Contacts, communication service, response ingestion | P1 / L | Security, email reputation, legal approval. |
| Review & approvals | Strong local blockers and fingerprints | Server policy engine, assignments, comments, e-signature-grade decisions | Workflow service, RBAC, immutable snapshots | P0 / XL | Identity, audit, legal requirements. |
| Quotation | Browser preview and CSV | Branded, configurable PDF/DOCX proposal with alternates and attachments | Template service, renderer, document numbering | P1 / L | Approved revision and storage. |
| Reports | Local operational summaries and CSV audit | Portfolio, engineering, sourcing, margin, cycle-time, AI quality reports | Analytics model, event pipeline, permissions | P2 / L | Stable transactional model first. |
| Settings | Project-local commercial fields | Organization policies, project overrides, catalogs, workflows, templates | Configuration hierarchy and policy validation | P1 / L | Tenant model and audit. |

## 8. Release roadmap

### Release 1 — Enterprise foundation and trustworthy workflow

Objective: turn the prototype into a secure, durable multi-user application without weakening its guardrails.

Features: organization/user/project model; authentication and RBAC; relational schema; immutable document storage; server audit events; domain service extraction from the client; workflow state machine; zero-error lint/build/test gates; empty and sample workspaces.

Dependencies: hosting database/object storage decisions, identity integration, migration strategy, architecture decision records.

Risks: rewriting too much at once; losing prototype behavior; underestimating approval/audit requirements.

Definition of Done: two users in one organization can collaborate on an isolated project; permissions are enforced server-side; project and source data survive devices; approvals are immutable and revision-bound; guardrail behavior has domain and end-to-end tests; lint and CI are green.

### Release 2 — General document intelligence

Objective: ingest arbitrary construction tender packages and produce reviewable structured evidence.

Features: upload pipeline; malware scanning; OCR/layout/table extraction; document classification; pages/blocks/citations; BOQ candidate extraction; specification requirements; revision comparison; review corrections; model/prompt registry; evaluation dataset.

Dependencies: Release 1 data/storage/jobs; selected OCR and model providers; annotated benchmark documents.

Risks: poor scans, complex Excel, drawing scale, prompt injection, hallucinated fields, processing cost.

Definition of Done: benchmark packages meet agreed field/citation accuracy; every extracted value has page/cell provenance; low-confidence values require review; corrections are versioned; no extraction automatically approves scope or price.

### Release 3 — Engineering matching, costing, and sourcing

Objective: convert reviewed requirements into explainable compliant solutions and current costs.

Features: product ontology/catalogues; requirement-to-attribute matching; alternatives/deviations; assemblies; cost books; current quotation ingestion; landed cost; scenarios; supplier RFQs; bid leveling; notifications.

Dependencies: reviewed technical evidence, catalogue agreements, cost policy, supplier/contact data.

Risks: equivalence liability, obsolete products, regional price variance, supplier data quality.

Definition of Done: match scores are explainable and evaluated; required attributes cannot be bypassed; costs trace to current sources; deviations have engineering approval; sourcing cycle is auditable end to end.

### Release 4 — Commercial outputs, integrations, and scale

Objective: produce enterprise-ready proposals and integrate the pre-sales operating system.

Features: branded quotation templates; PDF/DOCX packages; alternates/options; issued-document register; CRM/ERP/DMS/email integrations; portfolio analytics; SSO/SCIM; retention/data residency; performance and reliability controls.

Dependencies: stable workflow/data contracts; customer template and integration requirements.

Risks: customization sprawl, integration variance, reporting over transactional workloads.

Definition of Done: approved revision generates a reproducible client package; external IDs and sync states are auditable; SLOs and recovery objectives are met; enterprise security review passes.

## 9. Prioritized backlog

| Epic / feature | User story | Acceptance criteria | Priority | Complexity | Dependencies | Technical notes / QA |
|---|---|---|---|---|---|---|
| Platform / Domain extraction | As an engineer, I need domain rules independent of React so behavior is testable and reusable. | Pricing, evidence, approval, and workflow rules run as pure services with parity tests. | P0 | L | None | Characterization tests; deterministic clock/ID ports. |
| Platform / Data model | As a user, I need projects and decisions to persist across devices. | Versioned schema supports organizations, users, projects, documents, BOQ, requirements, products, quotes, RFQs, approvals, and audit events. | P0 | XL | Architecture ADR | Migration, constraints, tenancy tests, backup/restore test. |
| Security / RBAC | As an approver, I need decisions restricted to authorized people. | Server denies unauthorized read/write/approve/export actions; UI mirrors policy. | P0 | L | Identity/data | Permission matrix, negative tests, tenant escape tests. |
| Documents / Immutable sources | As an estimator, I need every decision tied to retrievable source evidence. | Versioned files, checksum, issue metadata, scan status, and citations are retained. | P0 | L | Object storage | Malware, size/type, retention, download authorization tests. |
| Workflow / Durable state machine | As a project lead, I need stage readiness to be consistent everywhere. | One server workflow/readiness result drives portfolio, project, review, and approvals. | P0 | L | Domain/data | Transition and concurrency tests. |
| Quality / Release gates | As engineering leadership, I need reliable releases. | Zero lint errors/warnings; CI runs unit, integration, browser, accessibility, and artifact tests. | P0 | M | Domain extraction | macOS/Linux parity; deterministic test clock. |
| AI / Extraction pipeline | As an estimator, I need arbitrary BOQs and specifications extracted with citations. | Versioned jobs return structured candidates, confidence, citations, and review state; no auto-approval. | P1 | XL | Documents/jobs | Golden datasets, precision/recall, adversarial files. |
| AI / Matching engine | As an engineer, I need compliant product candidates and explicit deviations. | Required attributes gate candidates; score components and sources are visible; alternatives never imply approval. | P1 | XL | Ontology/catalogues | Offline evaluation by discipline; obsolete-product tests. |
| Cost / Cost engine | As a commercial estimator, I need complete installed cost scenarios. | Materials, labor, services, logistics, allowances, exchange rate, tax, overhead, and margin are versioned and reconciled. | P1 | XL | Data/policies | Decimal arithmetic, currency, rounding, scenario regression. |
| Sourcing / RFQ lifecycle | As procurement, I need controlled outbound RFQs and comparable responses. | Approved package sends through configured channel; delivery/response state and normalized offers are auditable. | P1 | L | Contacts/comms | Approval-to-send, bounce, attachment, duplicate response tests. |
| Output / Proposal generation | As commercial approver, I need a branded immutable client package. | Current approved revision generates deterministic PDF/DOCX with terms, qualifications, options, and attachments. | P1 | L | Workflow/storage | Visual regression, page breaks, totals, fingerprint tests. |
| Operations / Observability | As operations, I need to detect failures, latency, cost, and AI quality drift. | Structured logs, traces, job/model metrics, dashboards, alerts, and runbooks exist. | P1 | L | Service architecture | PII redaction, alert drills, SLO review. |

## 10. Sprint plan

Assumption: two-week sprints, one cross-functional squad. Re-estimate after architecture discovery.

### Sprint 0 — Baseline and architecture

Goal: freeze verified behavior and decide the target architecture.  
Tasks: architecture decision records; domain inventory; permission matrix; data classification; characterization tests; fix lint and test runner portability.  
Deliverables: signed architecture baseline, risk register, green quality gate.  
QA: existing 208 checks plus deterministic domain characterization.  
Release note: internal engineering baseline only.

### Sprint 1 — Domain core and project persistence

Goal: move project, workflow, evidence, and calculation rules behind typed application services.  
Tasks: domain packages; schema v1; repositories; project APIs; migration seed; tenant scoping.  
Deliverables: durable projects and empty/sample workspace separation.  
QA: schema constraints, API contract, tenant isolation, calculation parity.

### Sprint 2 — Identity, authorization, and audit

Goal: establish trustworthy collaboration and approvals.  
Tasks: sign-in enforcement; memberships; RBAC; server audit events; revision snapshots; approval policy.  
Deliverables: authenticated role-specific workflow.  
QA: authorization negatives, cross-tenant attacks, immutable approval tests.

### Sprint 3 — Document repository and processing jobs

Goal: safely retain and process project evidence.  
Tasks: object storage; upload sessions; scanning; document versions; processing queue; status UI.  
Deliverables: immutable source register and job observability.  
QA: malformed/oversized/malicious files, retry/idempotency, access control.

### Sprint 4 — General BOQ and specification extraction

Goal: produce cited candidates from non-demo packages.  
Tasks: parsers/OCR; extraction schemas; citations; confidence; reviewer corrections; benchmark harness.  
Deliverables: reviewable BOQ and requirement candidates.  
QA: golden packages, accuracy thresholds, prompt-injection suite, low-confidence gates.

### Sprint 5 — Catalogue and matching foundation

Goal: create explainable multi-vendor product discovery.  
Tasks: catalogue ingestion; ontology; hybrid retrieval; attribute comparison; lifecycle/deviation model.  
Deliverables: evaluated candidate-ranking service.  
QA: missing required attributes, obsolete products, false-equivalence cases.

### Sprint 6 — Installed cost and sourcing

Goal: calculate complete project scenarios from current evidence.  
Tasks: assemblies; rate books; landed cost; RFQ send/receive; bid leveling; award.  
Deliverables: source-backed installed-cost scenario and procurement workflow.  
QA: decimals, rounding, freight allocation, expiry, replacement, concurrency.

### Sprint 7 — Commercial package and pilot readiness

Goal: issue a professional governed quotation for a pilot project.  
Tasks: template engine; PDF/DOCX renderer; issue register; accessibility; telemetry; performance; recovery drill.  
Deliverables: pilot-ready release candidate.  
QA: end-to-end tender journey, visual regression, authorization, load, backup/restore, security review.  
Release note: first controlled pilot of the AI pre-sales engineering platform.

## 11. Product operating rules

1. No AI output changes scope, compliance, price, award, or client output without an explicit human decision.
2. Every extracted or generated assertion must retain source provenance and processing version.
3. Confidence is calibrated by task and evidence; it is never a decorative label.
4. Historical catalogues support discovery, not current commercial approval.
5. Project/tenant ownership is enforced by the server, never inferred from UI state.
6. One workflow/readiness service supplies every dashboard and gate.
7. “Passed” means the business control is satisfied, not merely that a formula executed.
8. Demo fixtures remain visibly separate from production workspaces.
9. New feature proposals must include business goal, current state, gap, UX, technical/AI/data/API impact, risks, acceptance criteria, QA, and release plan.

## 12. Immediate recommendation

Do not begin Release 2 AI work yet. Start Sprint 0 and Sprint 1. The first implementation objective is to extract and preserve the existing safety rules while introducing durable project data, identity boundaries, and a single authoritative workflow service. This creates the platform on which generalized document intelligence can be built safely.
