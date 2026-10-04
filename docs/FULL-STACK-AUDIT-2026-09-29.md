# Full-Stack Audit — AI Pricing Agent

**Date:** 2026-09-29
**Mode:** READ-ONLY investigation (governing skill §2). No source edits, no migrations, no DB writes, no commits, no deploys, no server start.
**Runtime:** application was NOT started. No live D1 was read. No test suite was executed by me.
**Head of tree:** `main` @ `029b426`, shared dirty working tree (~800 uncommitted files, multi-lane).

## Evidence vocabulary

| Label | Meaning |
|---|---|
| VERIFIED FROM CODE | I or a delegated reviewer read the source and quoted file:line |
| VERIFIED FROM TEST | A test file exists and its assertion content was read (NOT that I ran it) |
| VERIFIED FROM DATABASE | Read from `drizzle-active/*.sql` (the active chain) — schema shape only |
| VERIFIED END-TO-END | **Not used anywhere in this report.** No runtime evidence was gathered. |
| PARTIAL | Some of the capability exists; the rest is missing or unwired |
| NOT FOUND | Absent after search |
| CANNOT VERIFY | Evidence lives in a prior report; I did not re-measure it |
| REPORTED | A number taken from an existing `docs/*.md` audit. **Not re-verified by me.** |

---

## 1. Executive Summary

**Answer to the audit question: the system cannot produce a technically reliable Fire Alarm quotation today. The blockage is not the absence of code — it is the absence of wired data plus three specific production defects.**

This is a mature, heavily-governed codebase, not a prototype. 317 tables, ~60 API route groups, 166 domain modules, 435 test files, real supersession/audit/fingerprint machinery, genuine fail-closed semantics in pricing and identity. That is unusual and valuable.

But three things are true simultaneously:

1. **The Fire Alarm chain is severed at step 7.** `app/domain/fire-alarm-preliminary-point-demand.mjs` has **zero importers in `app/` or `worker/`** — verified by grep: its only 12 references are in `tests/` (7) and `scripts/` (3), plus its own definition. VERIFIED FROM CODE.
2. **The preliminary-sizing endpoint can never succeed.** `worker/fire-alarm-preliminary-sizing-api.mjs:118` calls `createFireAlarmPreliminarySizingSnapshot({ command })` with no `dependencies`, but the writer dereferences `dependencies?.demand` at `app/domain/fire-alarm-preliminary-sizing-snapshot.mjs:145`. Every POST returns `PRELIMINARY_SIZING_CALCULATION_MALFORMED`. VERIFIED FROM CODE.
3. **A plug-in point ships as an empty stub.** `worker/quantity-source-decision-api.mjs:128` — `export const governedPrintedQuantityRows = async () => [];`. Drawing-derived quantity can therefore never be promoted. VERIFIED FROM CODE.

Beyond Fire Alarm specifically, four cross-cutting problems block a reliable quotation:

- **Currency conversion is a hardcoded constant.** `app/domain/pricing-engine.mjs:3` — `FIXED_USD_TO_SAR_RATE = 3.75`, and `convertCurrency` ignores its own `exchangeRate` argument. The governed `pricing_exchange_rates` table is written but never read. VERIFIED FROM CODE.
- **Authorization is structurally inert.** `worker/application-context.mjs:72` defaults every actor to `role: "Administrator"`; `worker/pricing-api.mjs:46` additionally fabricates `fullAccess: true, role: "Administrator"` when computing project authority, so `canApproveCommercialPrice` cannot deny. VERIFIED FROM CODE.
- **Commercial data visibility is UI-only.** `canViewCommercial` is computed client-side (`app/page.tsx:3406-3413`); the backend has no equivalent gate on `pricing-api` or `excel-export-api`. VERIFIED FROM CODE.
- **The frontend is one 30,492-line client component** with one route, holding all state, and renders hardcoded fixture data to users in at least six places. VERIFIED FROM CODE.

**What I did not do:** I did not open a `*.sqlite` file, did not read live D1, did not run the app, and did not run the test suite. Every live-state number in this report is marked REPORTED and comes from a prior `docs/*.md` audit. Treat them as claims, not measurements.

---

## 2. Repository Architecture

### Tree (important directories only)

```
ai-pricing-agent/
├── app/                  Next.js App Router frontend + ALL domain logic (166 modules)
│   ├── page.tsx          ⚠ 30,492 lines, "use client", the entire UI
│   ├── layout.tsx        server component, metadata/fonts only
│   ├── components/       23 .tsx files, 27 exported components
│   ├── document-parsers/ pdf-text, pdf-readiness, xlsx, xls
│   ├── domain/           166 files — pure business logic, no SQL, no worker imports
│   ├── lib/api-client.ts fetch wrapper (requestJson, projectApi, technicalApi, commercialApi)
│   └── chatgpt-auth.ts   UNUSED — not imported by page.tsx
├── worker/               103 files — ALL SQL and ALL HTTP handlers
│   └── index.ts          Cloudflare Worker entry; fetch() + queue() only
├── drizzle-active/       0000…0017 + manifest.json + meta/ — THE active chain
├── drizzle/              104 files — superseded; drizzle.config.ts points at drizzle-active
├── db/schema.ts          317 sqliteTable() definitions
├── tests/                435 node:test files + e2e/ (2 Playwright specs) + golden/ (10 fixtures)
├── scripts/              161 files — eval gates, live-DB audits, maintenance
├── docs/                 83 files — system packs, gap matrices, audit reports
├── graphify-out/         generated knowledge graph
├── artifacts/ outputs/ reports/ work/ tmp/ run/ inputs/   generated / local
├── faaf2b04….sqlite*     5 local Miniflare D1 snapshots (live-DB audit residue)
├── package.json          33 named test files in `npm test`; test:all covers 435
├── vite.config.ts        inline wrangler config; main: ./worker/index.ts
├── next.config.ts        EMPTY STUB — no options
├── playwright.config.ts  baseURL http://127.0.0.1:4173
├── AGENTS.md / opencode.json / skills-lock.json
└── ~40 root-level *.md   historical audit/delivery reports
```

### Architecture facts

| Fact | Evidence |
|---|---|
| Server framework | **Not Next.js server.** Vite 8 + `vinext` 0.0.50 (Next-on-Workers shim) + `@cloudflare/vite-plugin` + `@vitejs/plugin-rsc`. `package.json:42-64`, `vite.config.ts:106-117` |
| Runtime | Cloudflare Workers (workerd), `nodejs_compat`. Bindings: `ASSETS`, `DB` (D1), `FILES` (R2), optional `SPECIFICATION_QUEUE`, `AI`, `IMAGES`. `worker/index.ts:66-93` |
| Deploy config | **No `wrangler.toml`/`wrangler.jsonc` at root.** Config is an inline JS object in `vite.config.ts:18-72`. `tests/e2e/wrangler.golden.jsonc` is test-only. |
| API structure | **No `app/api` route directory exists.** ~60 `handle*Api(request, env)` calls in `worker/index.ts:116-280`; each returns `null` for non-match, first non-null wins |
| Domain/service layer | `app/domain/*.mjs` — pure, no SQL, no `worker/` imports. All mutation lives in `worker/*.mjs` |
| Data access | No ORM usage in hot path. Hand-written SQL via `env.DB.prepare/batch`. `drizzle-orm` is a dependency but only `drizzle-kit` generates |
| Authentication | **Not real.** `worker/application-context.mjs:12-47` ignores all headers/cookies; identity comes from `env.APP_USER_ID`/`APP_ORGANIZATION_ID` with localhost fallbacks |
| Background processing | Cloudflare Queue `SPECIFICATION_QUEUE` (`vite.config.ts:57-72`, consumer `worker/index.ts:108-110`) + `ctx.waitUntil` at 7–9 sites + `document_processing_runs` |
| Cron / scheduled | **NOT FOUND.** Worker exports only `fetch` and `queue`; no `scheduled()`, no `crons` key |
| Event system | **NOT FOUND.** No event bus, no pub/sub |
| Audit logging | ~30 per-subsystem `*_audit*` / `*_events` tables, each with its own writer. **No unified audit writer.** |
| Logging | **Two `console.*` calls in the entire worker layer.** No structured logger, no request-ID middleware. `worker/confidence-safety-api.mjs:108`, `worker/boq-ai-diagnostic-api.mjs:41` |

### Module classification (representative, by inspection not filename)

| Module | Class | Note |
|---|---|---|
| `worker/index.ts` + all `worker/*-api.mjs` | ACTIVE | Registered routes |
| `worker/specification-extraction-background.mjs.golden-backup` | **LEGACY** | Stray backup file in `worker/` |
| `app/domain/*` (166) | ACTIVE (subset) | ~9 never imported by any test; 1 is TEST-ONLY |
| `app/domain/document-intelligence.mjs` | **TEST-ONLY** | Full OCR pipeline model, unreachable from any route; only `tests/document-intelligence.test.mjs` |
| `app/domain/fire-alarm-preliminary-point-demand.mjs` | **PARTIAL — no production caller** | 7 test + 3 script importers, 0 in `app/`/`worker/` |
| `app/chatgpt-auth.ts` | **UNUSED** | Not imported by `app/page.tsx` |
| `app/components/workspaces/RfqAuthorityWorkspace.tsx` | **STUB** | Says "RFQ is not available in this version"; imported by nothing |
| `next.config.ts` | **STUB** | Empty |
| `drizzle/` (104 files) | **LEGACY** | `drizzle.config.ts:2` sets `out: './drizzle-active'` |
| `scripts/*.mjs` (161) | MIXED | Eval gates ACTIVE; many are one-off audits |
| `graphify-out/` | generated | Do not hand-edit |
| `faaf2b04….sqlite` (×5) | generated | Live-DB audit residue at repo root, not gitignored-relevant |

---

## 3. Backend Inventory

| Domain | Files | Main entry | Tables | APIs | Status |
|---|---|---|---|---|---|
| Projects | `worker/dashboard-api.mjs`, `organization-api.mjs` | `handleDashboardApi` | `projects`, `project_members`, `project_dashboard_profiles` | `/api/projects*` | ACTIVE |
| Documents | `worker/document-api.mjs` | `handleDocumentApi` | `documents`, `document_versions`, `document_families`, `document_supersessions`, `document_processing_runs`, `processing_history`, `document_audit_events` | `/api/projects/:id/documents` | ACTIVE |
| Classification | `worker/classification-api.mjs` | `handleClassificationApi` | `document_classifications` | `…/classification/*` | ACTIVE |
| BOQ | `worker/boq-extraction-api.mjs` | `handleBoqExtractionApi` | `boq_items`, `boq_sections`, `boq_extraction_versions`, `boq_extraction_evidence`, `boq_extraction_warnings`, `boq_review_decisions` | `…/boq-extraction/*`, `/api/boq-items/*` | ACTIVE |
| Specifications | `worker/specification-extraction-api.mjs`, `-background.mjs`, `spec-source-fact-promotion.mjs` | `handleSpecificationExtractionApi` | `specification_extraction_versions`, `specification_clauses`, `technical_requirements`, `specification_revision_comparisons` | `…/specification-extraction/*` | ACTIVE |
| Drawings | 55 `drawing_*` tables; ~14 worker modules | `handleDrawingIntakeApi` … `handleDrawingArchitectureReviewApi` | `drawing_*` | `…/drawing-intake`, `…/drawing-structure`, `…/drawing-extraction`, `…/drawing-symbol-recognition`, `…/drawing-architecture/*` | ACTIVE (largest subsystem) |
| Technical requirements | `worker/technical-requirement-api.mjs` | `handleTechnicalRequirementApi` | `requirement_profile_versions`, `requirement_intelligence_facts`, `requirement_applicability`, … | `…/requirement-profile/*`, `/api/requirement-*` | ACTIVE |
| Engineering knowledge | `worker/engineering-knowledge-api.mjs`, `-graph-api.mjs`, `-classification-api.mjs` | `handleEngineeringKnowledgeApi` | `engineering_facts`, `engineering_graph_relationships`, `engineering_taxonomy`, `engineering_units`, `engineering_standards` | `…/engineering-knowledge/*` | ACTIVE |
| Knowledge library | `worker/knowledge-library-api.mjs` | `handleKnowledgeLibraryApi` | `knowledge_files`, `knowledge_facts`, `knowledge_product_links` | `/api/knowledge/*` | ACTIVE |
| Product identity | `worker/product-identity-api.mjs` | `handleProductIdentityApi` | `product_identities`, `product_identity_observations`, `product_identity_reviews`, `product_identity_promotions`, `product_source_evidence` | `/api/product-identities*` | ACTIVE (12/15 real-chain suite — see §21) |
| Product/price library | `worker/product-price-library-api.mjs` | `handleProductPriceLibraryApi` | `library_products` (table), `canonical_library_products` (VIEW), `price_records`, `suppliers`, `product_sources` | `/api/library/*`, `/api/products/:id/*` | ACTIVE |
| Brand registry | `worker/product-brand-registry-api.mjs`, `canonical-product-brand.mjs` | `handleProductBrandRegistryApi` | `product_brands` (1 row) | `POST/GET /api/product-brands/ensure` | ACTIVE but **GET has no auth** |
| Product matching | `worker/product-matching-api.mjs` | `handleProductMatchingApi` | `match_candidates`, `compatibility_relationships` | `/api/match-candidates/*`, `…/matching*` | ACTIVE |
| Safety / confidence | `worker/confidence-safety-api.mjs` | `handleConfidenceSafetyApi` | `safety_decisions`, `safety_overrides`, `safety_blocks`, `safety_warnings` | `…/safety/*`, `/api/safety/overrides/*` | ACTIVE |
| Pricing | `worker/pricing-api.mjs`, `pricing-runtime.mjs`, `pricing-authority.mjs` | `handlePricingApi` | `pricing_runs`, `pricing_lines`, `pricing_cost_components`, `pricing_approvals`, `pricing_exchange_rates` | `/api/pricing/*` | ACTIVE |
| Supplier intake | `worker/supplier-price-intake-api.mjs` | `handleSupplierPriceIntakeApi` | `suppliers`, `supplier_quotes`, `price_records` | `…/supplier-price-intake/*` | ACTIVE |
| **Supplier / RFQ** | — | — | — | — | **NOT FOUND** (backend removed) |
| Review workflow | `worker/review-workflow-api.mjs` | `handleReviewWorkflowApi` | `review_queue_items`, `review_decisions`, `review_audit_log`, `review_assignments` | `/api/reviews/*` | ACTIVE |
| Quotation | `worker/quotation-api.mjs`, `quotation-line-authority.mjs`, `quotation-presenter.mjs`, `presales-workflow-api.mjs` | `handleQuotationApi` / `handlePresalesWorkflowApi` | `project_quotation_revisions`, `project_quotation_lines`, `project_quotation_decisions`, `project_quotation_issues` | `…/presales-workflow/quotation/*`, `…/quotations/:rev` | ACTIVE |
| Excel export | `worker/excel-export-api.mjs`, `xlsx-cost-sheet.mjs` | `handleExcelExportApi` | `excel_export_jobs`, `excel_export_audit_log` | `/api/excel-exports/*` | ACTIVE |
| Fire alarm sizing | `worker/fire-alarm-panel-sizing-api.mjs`, `fire-alarm-preliminary-sizing-api.mjs` | both handlers | `fire_alarm_panel_sizing_snapshots`, `fire_alarm_preliminary_sizing_snapshots` | `…/fire-alarm/panel-sizing`, `…/preliminary-sizing` | PARTIAL — see §13 |
| Case studies | `worker/case-study-learning-api.mjs` | `handleCaseStudyLearningApi` | `case_studies`, `case_sources` | `/api/case-studies/*` | ACTIVE |
| Users / auth | `worker/auth-context-api.mjs`, `application-context.mjs` | `handleAuthContextApi` | **no users table** | `/api/auth/session` | **STUB** (single-user) |
| Audit log | — | — | 30+ tables | **no unified `/api/audit`** | PARTIAL |

---

## 4. Frontend Inventory

**Framework:** Next.js 16.2.6 App Router semantics, executed by vinext/Vite on Workers, React 19 RSC. `layout.tsx` is a server component; `page.tsx` is `"use client"`.

**Routing: one route.** `find app -name 'page.tsx'` → **1 result**. No `app/api`, no `route.ts`. "Navigation" is an `activeModule` state variable plus query strings (`?project=&workspace=&section=&scenario=`) pushed via `history.pushState` (`app/page.tsx:3505-3574, 3640-3668`).

**State management: none.** No zustand/jotai/redux/`createContext`/`useReducer` anywhere in `app/**/*.tsx`. All state is local `useState` inside a single `Home()` component. `localStorage` exists but persistence is disabled: `const browserBusinessPersistenceEnabled = false` (`app/page.tsx:2266`).

**API client:** `app/lib/api-client.ts` — `requestJson`, `commandThenRefresh`, `projectApi`/`technicalApi`/`commercialApi`. But ~160 additional `fetch()` calls bypass it inline in `page.tsx`.

| Screen | Route | Data source | API | Status |
|---|---|---|---|---|
| Sign-in gate | `/` | `/api/auth/session` | auth/session | FULLY FUNCTIONAL (hard stop on failure, `page.tsx:19229-19260`) |
| Home dashboard | `?workspace=Home` | dashboard/organization | dashboard/organization | FULLY FUNCTIONAL |
| Project register | `?workspace=Projects` | dashboard | dashboard/organization | FULLY FUNCTIONAL |
| New project wizard | modal | POST onboard | projects/onboard | FULLY FUNCTIONAL |
| Project overview | `?workspace=Overview` | dashboard+workflow+readiness+bom/cost | 6 APIs | FULLY FUNCTIONAL |
| Document upload | Documents | XHR | projects/:id/documents | FULLY FUNCTIONAL |
| Document status/classification | Documents | managedDocuments | classification/*, history, versions/restore | FULLY FUNCTIONAL |
| Project context | `?workspace=Project Context` | own fetch | project-context, /extract | FULLY FUNCTIONAL |
| BOQ review | `?workspace=BOQ` | extractedBoqItems | boq-extraction/*, bulk-review | FULLY FUNCTIONAL |
| AI understanding review | `?workspace=AI Understanding Review` | own fetch | estimator-understanding-review/* | FULLY FUNCTIONAL |
| Technical matching | `?workspace=Technical Matching` | matching/candidates | boq-items/matching/*, safety/* | FULLY FUNCTIONAL |
| Engineer decision drawer | drawer | own fetch | boq-items/:id/cost,bom,decision | FULLY FUNCTIONAL |
| Technical review | `?workspace=Technical Review` | workflow stages only | **none** | PARTIAL — summary only, no review list |
| Commercial review / action queue | `?workspace=Commercial Review` | reviewQueue | reviews/queue,summary,sync, /:id/* | FULLY FUNCTIONAL |
| Drawing visual review | modal | drawing-extraction + PDF preview | drawing-extraction/*, preview | FULLY FUNCTIONAL |
| Drawing intake/structure/symbols | modals | many | drawing-intake/structure/symbol-*/legend-geometry/occurrence-* | FULLY FUNCTIONAL (very large) |
| Specification review | drawer | technicalRequirements | specification-extraction/requirements, requirement actions | FULLY FUNCTIONAL |
| **Unresolved items** | — | — | — | **NOT FOUND** as a screen |
| **Device review** | — | — | — | **NOT FOUND** |
| **Approval queue** | — | — | — | **NOT FOUND** as a standalone screen (folded into Commercial Review) |
| Pricing / costing | `?workspace=Costing` | PricingWorkspace props | pricing scenarios/items/calculate/manual-price | FULLY FUNCTIONAL |
| Supplier quotations | `?workspace=Price Sources` | SupplierPriceIntakeWorkspace | supplier-price-intake/* | PARTIAL — intake real, **surrounding cards hardcoded** |
| **Supplier RFQs** | `?workspace=Supplier RFQs` | none | none | **NOT IMPLEMENTED** — "not available in this version" (`page.tsx:18177-18193`) |
| Quote builder | `?workspace=Quotation` | workflow + server quotation | quotation/{draft,approve,issue} | FULLY FUNCTIONAL |
| Quote preview | within Quotation | clientQuotation | quotations/:rev | FULLY FUNCTIONAL (on-screen only, no file) |
| Export (Excel) | `?workspace=Reports` | templates + history | excel-exports/* | FULLY FUNCTIONAL |
| **Audit / Activity** | `?workspace=Activity` | **local state only** | **none** | **MOCK DATA** — 3 hardcoded AlMoosa events, no server audit API exists |
| Knowledge library | `?workspace=Knowledge` | props | knowledge/*, product-identities | FULLY FUNCTIONAL |
| Product library | `?workspace=Product Library` | libraryProducts | library/products, products/:id | FULLY FUNCTIONAL |
| Fire Alarm knowledge | Knowledge›Fire Alarm | own fetch | knowledge/fire-alarm/overview | FULLY FUNCTIONAL |
| CCTV knowledge | Knowledge›CCTV | own fetch | knowledge/cctv/overview | FULLY FUNCTIONAL |
| Pricing memory | `?workspace=Pricing Memory` | props | pricing-learning/*, pricing-memory/cards | FULLY FUNCTIONAL |
| Administration | `?workspace=Administration` | authSession only | none beyond session | **STATIC UI** |
| **Panel sizing / loop sizing** | — | — | — | **NOT FOUND** — no frontend caller for either Fire Alarm sizing route |

### Mock data rendered to users (VERIFIED FROM CODE)

| Fixture | Location | Rendered at |
|---|---|---|
| 22 fire-alarm BOQ lines with `unitCost: 0`, `supplier: "Awaiting technical selection"` | `app/page.tsx:1698-1759` | seeded `:2435` |
| 6 specification requirements with fabricated page/clause anchors | `app/page.tsx:1592-1635` | `:25090-25102` |
| 6 zero-cost panel assembly rows | `app/page.tsx:1641-1696` | `:16944` |
| 6 "2023 Farenhyt" candidate prices | `app/page.tsx:1814-1892` | hidden in favour of API `:13233-13275` |
| 3 AlMoosa audit events, project id `"almoosa-k12-fire-alarm"` | `app/page.tsx:3417-3446` | `:18949-19008` |
| Price-source cards ("BOQ.xlsx · 21 lines", "Honeywell Farenhyt KSA 2023 · 504 rows") | `app/page.tsx:18305-18344` | rendered unconditionally |
| 11 dead UI branches gated by `Boolean(0)` / `{false && …}` | `page.tsx:16661,16710,17405,17431,19978,21048,26130,26411,14092,14111,15458` | unreachable |

---

## 5. Database Inventory

**Active chain:** `drizzle-active/0000_baseline_schema_0082.sql` … `0017_fire_alarm_preliminary_sizing_snapshots.sql`. `drizzle.config.ts:2-3` — `out: './drizzle-active'`, `schema: './db/schema.ts'`. **`drizzle/` is NOT the runtime chain.** `MIGRATION_VERSION = "0017_fire_alarm_preliminary_sizing_snapshots"` (`app/domain/production-readiness.mjs:24`).

**317 tables** (`db/schema.ts` sqliteTable count = `drizzle-active/manifest.json:9` businessTables = 317). Table-name parity confirmed; **column-level parity CANNOT VERIFY** (no head-to-head diff performed).

### Named-entity existence (VERIFIED FROM DATABASE)

| Present | Absent (NOT FOUND — no CREATE TABLE anywhere in the chain) |
|---|---|
| `projects`, `project_members`, `documents`, `document_versions`, `document_families`, `document_supersessions`, `document_processing_runs`, `boq_items`, `boq_sections`, `boq_extraction_evidence`, `boq_review_decisions`, `boq_quantity_source_decisions`, `specification_clauses`, `technical_requirements`, `estimator_item_interpretations`, `estimator_understanding_field_reviews`, `library_products`, `price_records`, `product_sources`, `product_source_evidence`, `product_identities`, `product_identity_observations`, `product_identity_reviews`, `product_identity_promotions`, `product_brands`, `product_manufacturers`, `suppliers`, `supplier_quotes`, `pricing_runs`, `pricing_lines`, `pricing_cost_components`, `pricing_approvals`, `pricing_exchange_rates`, `project_quotation_revisions`, `project_quotation_lines`, `project_quotation_decisions`, `review_queue_items`, `review_decisions`, `review_audit_log`, `safety_decisions`, `safety_overrides`, `match_candidates`, `excel_export_jobs`, `fire_alarm_panel_sizing_snapshots`, `fire_alarm_preliminary_sizing_snapshots` | **`users`**, `opportunities`, **`devices`**, **`device_families`**, **`equipment`**, **`equipment_aliases`**, **`skus`**, **`panels`**, **`loops`**, **`addresses`**, **`slc`** |

**The `device` / `equipment` / `panel` / `loop` / `address` / `slc` tables do not exist.** The domain model is BOQ rows → interpretation → product, with no physical-inventory table.

### Orphaned tables (declared in schema, zero code references)

`case_learning_evaluations`, `dashboard_metric_snapshots`, `requirement_rules`, `requirement_profile_comparisons`, `engineering_attribute_definitions`, `library_permission_grants`, `library_security_principals`, `price_record_versions`.
PARTIAL: `project_status_history` (only in a migration-presence list), `requirement_rule_executions` (write-only).

### Integrity weaknesses

| Issue | Detail |
|---|---|
| Referential actions inert | All baseline FKs are `ON UPDATE no action ON DELETE no action` (0000:34-35) — deletes rely on app logic |
| Only 44 CHECK constraints in 317 tables | Unconstrained: `pricing_lines.status`, `review_queue_items.status`, `safety_decisions.safety_state`, **`boq_items.review_status`** |
| Soft delete inconsistent | 24 tables have `deleted_at`; no `is_deleted`; versioned tables use `superseded_at`; code filters both |
| Immutability is trigger-based, not structural | 47 triggers; `0003_review_decision_immutability.sql` blocks UPDATE/DELETE on `review_decisions`/`review_audit_log` |
| JSON columns | 108 JSON-ish columns in the baseline alone. `pricing_lines.output`, `pricing_runs.locked_versions` are opaque — line-level reasoning is not queryable |
| VIEWs | `canonical_classifications` (0000:6645), `canonical_library_products` (0000:6684, recursive CTE over `library_products`) |

### Duplicate concepts (VERIFIED FROM DATABASE)

- `library_products` (table) vs `canonical_library_products` (VIEW) — **and code reads both, inconsistently** (§13)
- `pricing_lines` vs `project_quotation_lines` — same commercial row, two authorities
- `product_identities*` vs `product_reference_registry*` / `_v2` / `identity_dependency_providers`
- `document_versions` chain vs `document_families`/`document_supersessions`
- `engineering_fact_provenance` vs `engineering_discovery_sources`; `engineering_relationships` vs `engineering_graph_relationships`
- `requirement_intelligence_facts` rebuilt twice for authority (0010:43, then 0011:34)

### Known facts verified

| Claim | Verdict |
|---|---|
| `document_versions` has `original_filename`, **not** `file_name` | VERIFIED — 0000:662-663 |
| `knowledge_files.file_name` exists | VERIFIED — 0000:2864, `UNIQUE(organization_id, sha256)` |
| No `users` table | VERIFIED |
| `canonical_library_products` is a VIEW | VERIFIED — 0000:6684 |

---

## 6. API Inventory

~60 route groups, dispatched in `worker/index.ts:116-280`. Full per-route table is too long to repeat; the structural findings matter more.

| Concern | Finding |
|---|---|
| Total route groups | ~60 `handle*Api` registrations |
| `app/api` routes | **NONE.** All API lives in `worker/` |
| **Unauthenticated routes** | `GET /api/health/live`, `GET /api/health/ready` (intentional); `GET|POST /api/dev/boq-ai/native-smoke` and `POST /api/dev/ai-presales-agent/native-smoke` (localhost + env flag only); **`GET /api/product-brands/ensure?manufacturerId=` — NO AUTH, reads `product_brands` before any identity resolution** (`worker/product-brand-registry-api.mjs:39-51`) |
| **Mutating routes with no capability gate** | `worker/excel-export-api.mjs` — POST exports, cancel, supersede, compare. Only `resolveApplicationContext` + project ownership. Also writes a fabricated `actorRole = "Project User"` into every audit row (`:12,19`) |
| **Zero capability checks** | `worker/quotation-api.mjs` — grep for `denied\|403\|capability\|role` returns nothing |
| Only 7 of ~100 worker API modules import `requireLibraryCapability` | `worker/library-auth.mjs:51-54` |
| Schema validation library | **NONE.** No zod/yup/valibot/ajv/joi. Hand-rolled per-field checks |
| Validation that exists | Document upload (strong: extension, MIME, magic bytes, 100 MB), reason-length on governed decisions, `Number.isSafeInteger` on money minors, optimistic `entityVersion`, idempotency keys |
| Raw `await request.json()` with no validation | `pricing-api.mjs:108,402`, `confidence-safety-api.mjs:116,120,124,139`, `product-matching-api.mjs:352,353,357`, `review-workflow-api.mjs:165,284`, `drawing-architecture-review-api.mjs:1045` (passed straight to engine), `presales-workflow-api.mjs:11` (swallows parse errors → `{}`) |
| Error envelope | Dominant `{error:{code,message}}`. **Four divergent variants:** excel-export adds `technicalDetails/stage/suggestedAction/retryable/supportReference`; review-workflow adds `technicalDetails/affectedItem/requiredAction`; document-api adds `suggestedAction` + `requestId`; health returns health objects |
| Swallowed background errors | `ctx.waitUntil(... .catch(() => undefined))` at 7 sites — user gets `202`, failure discoverable only by polling the job row |
| Pagination | Present on ~12 list routes. `limit` capped 200, `pageSize` capped 100 |
| Client-side **sorting** | Only `/api/knowledge/files` (`sort`). Everywhere else `ORDER BY` is hard-coded — **PARTIAL** |
| Unbounded reads | `SELECT * FROM technical_requirements/boq_items … ORDER BY sequence` with no LIMIT in both CSV exports (`specification-extraction-api.mjs:347`, `boq-extraction-api.mjs:479`) |
| Frontend calls to missing APIs | **NONE FOUND** |
| Duplicate APIs | None found |
| Deprecated APIs | None flagged in code |
| TODO/stub branches in handlers | **NOT FOUND** |

**Apis that exist but the frontend never calls** (partial list, all VERIFIED FROM CODE):
`POST/GET /api/product-brands/ensure` · `POST /api/projects/:id/fire-alarm/panel-sizing` · `POST /api/projects/:id/fire-alarm/preliminary-sizing` · `GET /api/identity-resolution/*` · `POST /api/compatibility/relationships/auto-confirm` · `POST /api/projects/:id/engineering-discovery/run|recalculate` · `POST /api/requirements/:id/propagate-system-wide` · `POST /api/excel-exports/:jobId/rerun|supersede|reconcile|compare` · `GET /api/knowledge/facts/:id/links` · `POST /api/safety/overrides/:id/decide` (an override route with no UI entry point).

---

## 7. Frontend/Backend Integration

| # | Workflow | State | Evidence / break |
|---|---|---|---|
| 1 | Create project | **CONNECTED** | `POST /api/projects/onboard` → `worker/dashboard-api.mjs:679-766` |
| 2 | Upload BOQ | **CONNECTED** | `POST /api/projects/:id/documents` → `worker/document-api.mjs:44,177` → R2 |
| 3 | Upload specification | **CONNECTED** | same route; extraction gated on `Manually Confirmed` classification |
| 4 | Upload drawing | **CONNECTED** | same route; `drawing-intake-api.mjs:18` requires `primary_type="Drawing"` **and** `classification_status="Manually Confirmed"` |
| 5 | Start extraction | **CONNECTED** | `…/boq-extraction/start` → `ctx.waitUntil` → 202. User must then poll |
| 6 | View extraction results | **CONNECTED** | paginated `…/boq-extraction/items?page&limit` |
| 7 | Review unresolved items | **PARTIAL** | BOQ `Needs Review` rows are listed and approvable, but there is **no dedicated unresolved-items screen** |
| 8 | Approve/reject result | **CONNECTED** | `/api/boq-items/:id/approve|reject` → `boq_review_decisions` |
| 9 | Set device family | **PARTIAL** | Field decision on `system`/`category`/`productFamily` only; **no standalone device-family screen** |
| 10 | Add pricing | **CONNECTED** | `/api/pricing/items/:id/calculate`, `manual-price` |
| 11 | Build quote | **CONNECTED (code)** | `presales-workflow/quotation/draft` — but the AND-chain gate makes it unreachable in live data (§13) |
| 12 | Approve quote | **CONNECTED (code)** | guard `status!=="Draft"` → `QUOTATION_STATUS_INVALID` |
| 13 | Export quote | **PARTIAL** | Excel only. No PDF/DOCX/quotation file exists |

**Broken integration points:**
1. `fire-alarm-preliminary-point-demand.mjs` — no production caller (VERIFIED).
2. `fire-alarm-preliminary-sizing-api.mjs:118` — missing `dependencies` → every POST 422 (VERIFIED).
3. `worker/quantity-source-decision-api.mjs:128` — `governedPrintedQuantityRows = async () => []` (VERIFIED).
4. `?workspace=Activity` audit view — frontend-only mock; no server audit API (VERIFIED).
5. `canViewCommercial` — UI-only; backend has no gate (§8).
6. `fire-alarm-preliminary-sizing` and `fire-alarm/panel-sizing` — backend only, no frontend caller (BACKEND ONLY).
7. `app/chatgpt-auth.ts` — frontend auth helper never wired (FRONTEND ONLY, unused).

---

## 8. BOQ System

| Capability | Status | Evidence |
|---|---|---|
| Upload BOQ | YES | `worker/document-api.mjs:741` |
| Parse XLS/XLSX/CSV/PDF | YES | `app/domain/boq-extractor.mjs:643-650` |
| Identify sheets/tabs | YES | `:408,596,84` (incl. merged ranges, frozen rows) |
| Detect headers | YES | `:352,371,595` |
| Extract item number / description / unit / quantity / price | YES | `:157,165` |
| Preserve original row | YES | `boq_items.original_quantity`, `original_raw_values` |
| Preserve source location | YES | per-cell sheet/page/row/cells/formula/bbox, `:579`; `boq_extraction_evidence` |
| Detect duplicates | YES | `:624-630` — forces `Needs Review`, **caps confidence at 69** (tested: `tests/boq-extractor.test.mjs:64`) |
| Detect unresolved items | YES | `:578,628` — `review_status='Needs Review'` + `approved_for_downstream=0` |
| Classify system | YES | `:244,290,575` |
| Classify device family | **PARTIAL** | `boq_items.category` is a deterministic *physical* label ("Control Panel"), not the governed taxonomy family. Governed family only via `estimator_item_interpretations.productFamily` |
| Link to drawing | **PARTIAL** | Only `boq_quantity_source_decisions(recognition_version_id, definition_key)` — quantity provenance, not a general item link |
| Link to specification | YES | `technical_requirements.clause_id` → `specification_clauses` |
| Link to pricing | YES | `pricing_lines` ← BOQ item |
| Row types | 14 governed row types | `:9,381` |
| Auto-verification | Conservative: confidence ≥ 90 **and** zero blocking warnings **and** readiness ready | `:572,578`; `boq-extraction-api.mjs:108-124` |
| Eligibility gate | BOQ + `Manually Confirmed` classification only; auto-confidence explicitly rejected as a substitute | `boq-extraction-api.mjs:72` |

**Review operations:** update, restore, row-type, approve, reject, split, merge (merge forces `Merged`, downstream 0) — `boq-extraction-api.mjs:284,317,385`.

---

## 9. Drawing Intelligence

**The largest and best-tested subsystem.** 55 `drawing_*` tables, ~14 worker modules, 16 domain engines, real golden fixtures pinning real page/asset IDs.

### Sheet type classification — `classifyDrawingType`, `app/domain/drawing-type-classifier.mjs:24-130`

Buckets: `Layout`, `Riser Diagram`, `Schematic / Single-Line`, `Legend / Notes`, `Cause & Effect`, `Detail / Enlarged Detail`, `Schedule`, `Unknown / Mixed`. Title-block wins over intake classification; `Cause & Effect` is tested first (`:36-46`). Tested: `tests/drawing-type-intelligence.test.mjs`.

### Extraction capabilities

| Capability | Module + function | Test | Fixture |
|---|---|---|---|
| Title block, sheet number, sheet title | `drawing-intake-engine.mjs::extractTitleBlockFields` | `tests/drawing-title-block.test.mjs` | golden |
| Device tags, locations, device counts | `drawing-layout-intelligence.mjs::buildLayoutIntelligence` | `drawing-extraction-intelligence-integration.test.mjs` | `fcc-room-details` |
| Connections, cables, panels, riser relationships, interfaces, device codes | `drawing-riser-schematic-intelligence.mjs::buildRiserSchematicIntelligence` | same | `kgs-fire-alarm-schematic` |
| Cause & effect matrix | `drawing-cause-effect-intelligence.mjs::buildCauseEffectIntelligence` | same | `ams-cause-and-effect` |
| Details, installation requirements | `drawing-detail-intelligence.mjs::buildDetailIntelligence` | same | `fcc-room-details` |
| Legends, general notes | `drawing-legend-notes-intelligence.mjs::buildLegendNotesIntelligence` | same | `ams-elv-legend-notes` |
| Schedules, callouts, panel candidates | `drawing-general-extraction-engine.mjs::buildGeneralDrawingExtractionProposals` | `drawing-general-extraction-engine.test.mjs` | golden |
| Device symbols/occurrences | `worker/drawing-symbol-recognition-api.mjs` | `drawing-symbol-recognition-engine.test.mjs` | golden |

**OCR: NOT FOUND.** No OCR library in `package.json`. `SPEC_OCR_VERSION = "not-configured"`, `BOQ_OCR_VERSION = "not-configured"`. A scanned PDF classifies as `Unknown` / `Needs Review` with `error.code: "OCR_REQUIRED"` (`document-classifier.mjs:171,240`); BOQ/spec extraction **throws** `OCR_REQUIRED` rather than returning empty (`boq-extractor.mjs:609`, `specification-extractor.mjs:586,621`). This fails honestly — it does not silently produce empty output. Good behaviour, but it means image-only tenders are unusable.

---

## 10. Cross-Sheet Intelligence

| Question | Answer | Evidence |
|---|---|---|
| Detection | `detectCrossSheetReferences({...})` | `app/domain/drawing-cross-sheet-references.mjs:148` |
| Sheet ID resolution | `resolveCrossSheetReferenceTargets(refs, registry)` | `:193` |
| Exact matching | `normalizeForExactMatch` = trim + uppercase + collapse whitespace + collapse `--` | `:191,194,196` |
| Never auto-resolves | Test asserts a reference is never auto-verified — always `Needs Review` | `tests/drawing-cross-sheet-references.test.mjs` |
| Storage | `drawing_extraction_proposals` with `proposalType:"CrossSheetReference"`, fields in an `evidence` JSON column. **No dedicated reference table** | `db/schema.ts:847` |
| Reference graph | `drawing_architecture_review_cases` via `extractCrossSheetReferenceFacts` → `factType:"CROSS_SHEET_REFERENCE"`, `relation:"REFERENCES"`, `factKey` composed from subject/target | `drawing-architecture-intelligence.mjs` |
| Legend propagation | **EXPLICIT ONLY.** `drawing_recognition_legend_contexts`; `establishLegendContext` requires a reason ≥ `MIN_GOVERNED_REASON_LENGTH`; code comment: *"deliberately NO implicit or project-wide geometry lookup anywhere"* | `worker/drawing-symbol-recognition-api.mjs:67-75,83,86` |
| Note propagation | NOT FOUND |
| Rule propagation | NOT FOUND |

**REFERENCE LINK vs RULE INHERITANCE — the decisive answer:**

The system implements **REFERENCE LINK only**. A sheet records that it points at another sheet, and the pointer's `applicabilityStatus` is either `"Scoped to current sheet"` or `` `Scoped to ${system} drawings` `` — never project-wide (`drawing-cross-sheet-references.mjs:165-183`). **Automatic RULE INHERITANCE across sheets is not implemented**, by explicit design. Legend geometry can only be applied to another sheet through a human-created, reason-bearing, superseded-on-replacement governed context.

---

## 11. Specification Intelligence

| Field | Present | Where |
|---|---|---|
| Clause extraction / number / path / page / original text | YES | `specification_clauses` (`db/schema.ts:282`); `segmentSpecification` `app/domain/specification-extractor.mjs` |
| Normalized meaning | YES | `technical_requirements.normalized_requirement` (`db/schema.ts:310`) |
| System / category / domain | YES | same table |
| Version id / clause id | YES | `specification_extraction_versions`, `specification_clauses.id` |
| Clause admission | YES | `CLAUSE_ADMISSION_*` states + `CLAUSE_NON_ADMISSION_REASONS`; tested `tests/specification-clause-admission-outcome.test.mjs` |
| Review / approval | YES | `reviewStatus`, `approvedForDownstream`, `batchAutoConfirmSpecRequirements` |
| Version governance | YES | `specification_extraction_versions.version_number` + `superseded_at` |
| Revision comparison | **PARTIAL** | see below |
| Semantic comparison | **PARTIAL — not wired** | see below |

### Lifecycle trace

upload → `scheduleAutomaticClassification` (only automatic step, `document-api.mjs:271`) → human confirms classification → `SPECIFICATION_CLASSIFICATION_CONFIRMATION_REQUIRED` gate (`specification-extraction-api.mjs:93`) → `createSpecificationJob` → `processSpecificationJob` (Queue) → `executeSpecificationExtraction` → `segmentSpecification` → clauses + requirements persisted → review/auto-confirm → `compareSpecificationRevisions`.

**The comparison step is weaker than it looks.** `worker/specification-extraction-api.mjs:346` adapts DB rows by hard-setting `attributes: []`, `standards: []`, `manufacturers: []`, then calls `compareSpecificationRevisions` (`app/domain/specification-extractor.mjs:750`). With those arrays forced empty, the production comparison effectively detects changes in `normalized_requirement` (and sequence/clause key) only. A **real** semantic comparator exists — `semanticCompareRequirementVersions` in `app/domain/fire-alarm-addressability-clause-evidence.mjs:210`, with obligation/qualifier/weakening classification — but it is exercised only by tests and scripts, never by the API.

---

## 12. Device Family Intelligence

Canonical taxonomy: `FIRE_ALARM_TAXONOMY`, **7 categories** — Control Equipment, Detection Devices, Notification Devices, Modules and Interfaces, Manual Initiation, Power and Batteries, Accessories. `app/domain/fire-alarm-taxonomy.mjs:5-36`.

Classification is **strict, not probabilistic**: EXACT_PHRASE / TOKEN_MATCH scoring; token overlap is explicitly never sufficient (`:843,854-862,1132-1139`). Match classes include `PARENT_CHILD`, `AMBIGUOUS`, `RELATED_NOT_EQUIVALENT` — the latter two never resolve identity (`:1220-1225`).

| Device | Outcome | Status |
|---|---|---|
| Smoke / Heat / Multi-Sensor Detector | resolve to Detection Devices families | YES |
| Manual Call Point, Pull Station | **two distinct families** sharing one synonym group | PARTIAL — deliberate |
| Sounder / Strobe / Sounder Strobe | resolve; `Sounder/Strobe` ↔ `Sounder Strobe` alias | YES |
| Monitor / Control / Relay Module | resolve to Modules and Interfaces | YES |
| **FACP** | → `Fire Alarm Control Panel` | YES |
| **Power Supply** | → `Fire Alarm Power Supply` / `Booster Power Supply` **only with a qualifier**; bare term is not a family | PARTIAL |
| **Network Panel** | **NOT FOUND** — 0 matches in `app/domain` | NOT FOUND |
| **MFACP** | **NOT FOUND as a taxonomy family.** Exists only as a distinct drawing subject and a PANEL_ROLE term (`drawing-architecture-intelligence.mjs:109-115`) | NOT FOUND in taxonomy |
| **Repeater, Annunciator, Interface Module** | partial coverage only | PARTIAL |
| **Horn** | no family; compound-only and ambiguous (`:511,524`) | gap |
| Mounting Base | not a standalone family | verified gap |

`KNOWN_REQUIREMENT_FAMILY_GAPS` (`:515-528`) declares cable, conduit, interfaces, bare batteries, horn. Aliases are **hardcoded dictionary + governed match classes**, not AI-generated and not DB-driven.

---

## 13. Equipment / Alias Resolution

The system **does** distinguish the concepts — but across different tables, not one model:

| Concept | Where it lives |
|---|---|
| Alias | `product_aliases` (library products), `product_identity_aliases` (identities, FK to knowledge fact, default `Needs Review`) — `db/schema.ts:600,1010` |
| Device Family | `fire-alarm-taxonomy.mjs` — hardcoded, frozen |
| Equipment Type | `product_families` — `db/schema.ts:496` |
| Physical Entity | **NOT FOUND** — no device/inventory table |
| Product SKU | `library_products` + `canonical_library_products` VIEW |

**Identity ruleset** `product-identity-v1.1` (`app/domain/product-identity-engine.mjs:1-9`), 6 rules: isolate unknown-manufacturer observations; group only on exact manufacturer + complete code; preserve punctuation; attach (never replace) explicit aliases; discovery-only prices; preserve conflicts. Identity key = `manufacturer|CODE`, else `source:file|CODE` (`:26`).

**FACP vs MFACP are NOT merged** — explicitly separate drawing subjects, and only MFACP may take `LOCATED_AT` (`drawing-architecture-intelligence.mjs:109-115,448-449`).

**Merge rules that could wrongly merge two devices:** the risk is in `familiesAreSynonyms` used for BOQ↔drawing linking (`drawing-quantity-evidence-engine.mjs:124-135`) and in the identity key itself — `manufacturer|CODE` will merge two observations into one identity if the code is identical and the manufacturer string normalizes identically, regardless of whether they are physically different variants. Manufacturer normalization is alias-based only (`app/domain/manufacturer-identity.mjs:24-27`): `HONEYWELL FIRE SYSTEMS`/`HONEYWELL FIRE` → `Honeywell`. There is **no brand table** in that path.

---

## 14. SLC & Panel Logic

| Concept | Modelled? | Evidence |
|---|---|---|
| Physical quantity | YES | `app/domain/excel-export-engine.mjs:55-78`; `fire-alarm-preliminary-point-demand.mjs:115-168` |
| Address quantity | **NOT FOUND as a field** — only an evidence attribute name at `fire-alarm-slc-resource-classifier.mjs:112` |
| SLC points | YES | `classifyFireAlarmSlcItem` `:186-251` |
| Input points | **NOT FOUND** — only `SLC_DETECTOR_POOL`; module sub-kind explicitly not modelled (`fire-alarm-preliminary-point-demand.mjs:20-22`) |
| Output points | **NOT FOUND** — same |
| Loop load | YES | `fire-alarm-slc-capacity-calculator.mjs:110-118` |
| Panel capacity | YES in code | `:78-85` |

### The 1:1 rule — exactly two places, both hardcoded

```js
// app/domain/fire-alarm-slc-resource-classifier.mjs:215
"Governed addressable detector family contributes one SLC detector point per device."
consumptionAuthority: "ESTABLISHED_ONE_POINT_PER_DEVICE", unitsPerDevice: 1
// :221 — identical rule for module families
```

Membership is decided by two literal `Set`s (`:58-71`). The module **explicitly refuses** to generalise: `fire-alarm-slc-resource-classifier.mjs:234` — *"one address per device is not assumed from industry convention"*; multi-address devices fail closed at `:194`.

**SLC consumption is family-name-based and hardcoded — not manufacturer, model, or protocol.** For every governed family outside those two sets, the classifier returns `SLC_ROLE_ESTABLISHED` with `demandUnits: null, consumptionAuthority: null` (`:164-184`) — i.e. correctly *unknown*, not zero.

### Panel & loop sizing

| Capability | Status | Function |
|---|---|---|
| Expansion/loop need | YES | `assessExpansionNeed({demand,panelCapacity})` `fire-alarm-slc-capacity-calculator.mjs:67-158` — returns `{status, requiredDemand, nativeCapacity, remainingDemand, requiredAdditionalLoops, selectedExpansionType, requiredExpansionQuantity, capacityAfterExpansion, headroom, calculationTrace, missingInputs}` |
| Devices per loop | YES — two **non-summable** pools, `MAX` not `SUM` | `:110-115` |
| Spare capacity | **NOT FOUND** — `headroomPolicy: "NONE_SPECIFIED"` | `:137,154` |
| Address limits | YES | `systemPointCeiling` → `CAPACITY_EXCEEDED` |
| Power limits / NAC | YES | `NAC_RULE` `app/domain/calculation-requirement-engine.mjs:199-234` |
| Battery sizing | YES | `BATTERY_RULE` `:164-197` |
| Network sizing | YES | `NETWORK_RULE` `:236-244` |
| Expansion cards | YES | `calculateSlcExpansion` `:160-208` |
| Panel selection | **NOT FOUND** — `resolveFireAlarmEcosystem` returns a compatibility *family* only and explicitly never selects a model (`fire-alarm-ecosystem-policy.mjs:9-13,53-74`). It is also **test-only** — no production importer |
| UI for any of the above | **NOT FOUND** — no frontend caller for `fire-alarm/panel-sizing` |

### The capacity chain is unreachable — three independent reasons

1. `assessExpansionNeed` requires six inputs or returns `INSUFFICIENT_EVIDENCE` with `missingInputs` (`:74-90`).
2. `worker/fire-alarm-panel-sizing-api.mjs:219-248` loads `panelCapacity` **only** from `product_attributes` rows with `review_status='Approved'`; absent → `APPROVED_CAPACITY_EVIDENCE_REQUIRED` (`:245`).
3. `assessSizingReadiness` (`fire-alarm-panel-capability-normalization.mjs:351`) requires `["BASE_SLC_LOOPS","PER_LOOP_DETECTORS","PER_LOOP_MODULES","MAX_SLC_LOOPS","SYSTEM_POINT_CEILING"]`. `MAX_SLC_LOOPS` appears **only** at `:202` and `:351` — as a required name with no populating source anywhere. `SYSTEM_POINT_CEILING` is deliberately **excluded from the attribute map** at `:207-215`.

**A live contradiction worth flagging:** `fire-alarm-panel-sizing-api.mjs:224` treats `max_system_points` **as** `systemPointCeiling`, while `fire-alarm-panel-capability-normalization.mjs:354` explicitly refuses nameplate points as a ceiling (`:210` maps it to `SYSTEM_NAMEDPLATE_POINTS`). Two components disagree about what the same attribute means.

---

## 15. Pricing Engine

`app/domain/pricing-engine.mjs` (v1.1.0). Formulas are backend-only; the frontend reads results verbatim (`PricingWorkspace.tsx:23`) — **no duplicated calculation logic** (good).

| Concept | Status |
|---|---|
| Material / product cost | YES `:305-306,325` |
| Manufacturer / supplier / historical price precedence | YES `:83` |
| Multiple supplier quotes | PARTIAL — ranked `price_records`; no side-by-side comparison view |
| Quote validity | YES `:60-67` — `Valid`/`Expiring Soon`/`Expired`/`Future`/`Rejected`/`No Validity Provided` |
| Currency | YES `:132-139` |
| **Exchange rate** | **HARDCODED 3.75** — see below |
| Freight / customs | Component types only `:11` |
| Tax | **VAT only** `:229-238` |
| Labor / installation / testing / commissioning / programming / engineering | Component taxonomy `:6-15`; methods Fixed/Per Item/%Material/%Direct/Hours `:147-156` |
| Accessories / warranty | YES (table + export) |
| Overhead / contingency | YES `:12-13,306` |
| Markup / margin / discount / selling price | YES `:117-130,158-166` |

### Verbatim formulas

```js
// app/domain/pricing-engine.mjs:160-165
if (method === "Target Margin") { if (rate >= 100) throw ...; gross = cost / (1 - rate/100); }
else if (method === "Markup") gross = cost * (1 + rate/100);
else if (method === "Fixed") gross = number(fixedPrice, "INVALID_FIXED_PRICE");
const profit = round(gross - cost, precision),
      margin = gross ? round(profit/gross*100, 4) : 0,
      markup = cost  ? round(profit/cost*100, 4)  : 0;

// :198-238
const customerDiscountAmount = round(sale.gross * discountPercentage/100, precision);
const netSelling = round(sale.gross - customerDiscountAmount, precision);
const resultingMargin = netSelling ? round((netSelling - cost)/netSelling*100, 4) : -100;
const vat = round(netSelling * vatRate/100, precision);
const finalValue = round(netSelling + vat, precision);
```

### ⚠ Exchange rate is a hardcoded constant

```js
// app/domain/pricing-engine.mjs:3
export const FIXED_USD_TO_SAR_RATE = 3.75;
```

`convertCurrency` multiplies by this constant and **ignores its own `exchangeRate` parameter** (`:137-138`). `loadPricingInput` passes `exchangeRate: null`. A `pricing_exchange_rates` table exists and is written by `worker/pricing-api.mjs:432` — and is **never read**. Asserted as intended behaviour by `tests/r6-fixed-usd-sar-normalization.test.mjs:72-74`.

### Fail-closed behaviour (good)

- No `DEFAULT_PRICE`/`fallbackPrice` anywhere in `app/domain`.
- Missing price → blockers `PRICE_SOURCE_SELECTION_REQUIRED` / `CURRENT_PRICE_SOURCE_REQUIRED` (`pricing-engine.mjs:295-296`), never a silent 0.
- `summarizeCostComponents` returns `null`, not 0 (`:39-41`).
- **One default relaxes rather than fails closed:** expired / no-validity price sources are marked `"Eligible"` on a relaxed path (`:75,93,107,264-267`). It is explicitly labelled, but it is a permissive default on commercially sensitive data.

---

## 16. Supplier Workflow

| Capability | Backend | Frontend |
|---|---|---|
| Supplier master | table only (`db/schema.ts:589`) | **NOT FOUND** — no CRUD screen |
| RFQ creation / items / responses | **NOT FOUND** — zero `rfq` matches in `worker/` or `db/` | **NOT IMPLEMENTED** |
| Quotation (supplier's) upload | YES — `worker/supplier-price-intake-api.mjs:20,170` | YES — `SupplierPriceIntakeWorkspace.tsx:39` |
| Supplier PDF parsing | YES — `app/domain/supplier-price-pdf.mjs:1-70` | — |
| Price comparison | PARTIAL — source ranking only | no interactive view |
| Technical compliance | YES — `xlsx-cost-sheet.mjs:35` | YES |
| Commercial compliance | YES — `pricing_approvals.approval_type='Commercial Price'` | YES |
| Supplier selection | YES — `worker/primary-selection-authority.mjs` | — |
| Approval | YES | YES |
| Quote expiry | YES — `supplier_quotes.valid_until`; enforced `pricing-engine.mjs:60-67` | — |

`app/components/workspaces/RfqAuthorityWorkspace.tsx` is a **stub that states RFQ is disabled** (`:8,12-17`) and is imported by nothing. The RFQ subsystem was removed from the backend but its UI placeholder remains.

---

## 17. Approval / Governance

### Actual implemented state values (extracted, not proposed)

| Column | Values | Enforced by |
|---|---|---|
| `boq_items.review_status` | `Needs Review`, `Approved`, `Rejected`, `Merged`, `Auto Verified`, `Accepted` | **app code only** |
| `technical_requirements.review_status` | `Needs Review`, `Pending Approval`, `Approved` | app code only |
| review queue `status` | 16 values, `Not Started`…`Approved with Conditions`, `Escalated`, `Superseded`, `Cancelled` (`review-workflow.mjs:7-8`) | app code only |
| `safety_decisions.safety_state` | `Missing Critical Information`, `Conflict Blocking`, `Discovery Only`, `Blocked`, `Approval Ready with Warnings`, `Approval Ready` | app code only |
| `pricing_lines.status` | written: `Draft Price`, `Needs Review`, `Pricing Blocked`. **Never written: `Invalid`, `Expired`, `Rejected`** — three dead defensive filters | app code only |
| `pricing_approvals.status` | `Approved`, `Rejected` | app code only |
| `product_identity_reviews.status` | `Pending`, `Active` | **DB CHECK** |
| `estimator_understanding_field_reviews.decision` | `CONFIRMED`, `EDITED`, `REJECTED`, `UNRESOLVED` | **DB CHECK** (`drizzle-active/0012_military_havok.sql:40-58`) |
| `project_quotation_revisions.status` | `Draft` → `Approved` → `Issued` | app code + transitions |

Only **3 of 10** approval-state columns have DB CHECK constraints. The two that gate downstream flow most (`boq_items.review_status`, `pricing_lines.status`) are application strings only.

### Who can approve

11 project roles (`app/domain/project-roles.mjs:25-37`): Estimator, Project Manager, Engineering Reviewer, Technical Reviewer, Senior Technical Reviewer, Technical Manager, Commercial Reviewer, Commercial Manager, Commercial Approver, Management, Administrator.
Library ranks (`worker/library-auth.mjs:4-9`): Library Viewer 10, Reviewer 20, Manager 30, Administrator 40; `read`→Viewer, `analyze`/`review`→Reviewer, `approve`/`apply`/`reverse`→Manager.

**⚠ In the deployed configuration, none of this can deny anyone:**
- `worker/application-context.mjs:15-24` — 503 unless `APP_ACCESS_MODE === "single-user"`.
- `worker/application-context.mjs:72` — `applicationActor(context, role="Administrator")`; `:79` `fullAccess: role === "Administrator"`.
- `worker/pricing-api.mjs:46` — `resolveProjectAuthority(db, { projectId, actor: { id: userId, fullAccess, role: "Administrator" } })`. When the membership row is missing, `worker/project-authority.mjs:49-51` grants Administrator.
- Consequence: `actorRole` is `"Administrator"` → `canApproveCommercialPrice` **always passes**.

`project_members.role` has a CHECK constraint that does **not** reference the role vocabulary (`drizzle/0024:6`).

### Human override

| Override | Reason enforced? | Evidence |
|---|---|---|
| Safety override | **YES** — reason + technicalJustification ≥ 10 chars, plus evidence/scope/expiry; non-overridable blocks rejected | `confidence-safety-engine.mjs:167`; `reason-governance.mjs:32` |
| Classification override | YES ≥ 5 | classification route |
| BOQ approve/reject/update | YES ≥ 5, writes `boq_review_decisions` | `boq-extraction-api.mjs` |
| Warning acknowledgement | YES ≥ 5 | `confidence-safety-api.mjs` |
| **Product match reject** | **WEAKER** — `notes.length >= 5` **OR** a `reasonCode` | `product-matching-api.mjs:357` |
| **Review-workflow decision** | **INLINE divergent check**, not the shared constant | `app/domain/review-workflow.mjs:156` |
| Understanding bulk review | **Prohibited by design** (`BULK_UNDERSTANDING_REVIEW_PROHIBITED`) | `estimator-understanding-review-api.mjs:611` |

Three reason-length regimes (5, 10, inline-10) coexist. No single governance constant.

---

## 18. Quotation Engine

**Yes — a real, governed, immutable, persisted quotation exists.** `project_quotation_revisions` (`db/schema.ts:1061`) + `project_quotation_lines` (`:1056`) + decisions (`:1052`) + issues (`:1054`).

| Field | Status |
|---|---|
| Quote number | YES — `issue_reference`; default `Q-${project.id}-R${revision}` (`presales-workflow-api.mjs:267`) |
| Project / Customer | YES — `quotation-presenter.mjs:130-131` |
| Revision | YES — `:129` |
| Line items / Description | YES — `:76` |
| Manufacturer | YES — `:77` |
| Model | PARTIAL — only `partNumber` (`:78`) + `productDescription` (`:79`); no distinct model field |
| Quantity / Unit | YES — `:80-81` |
| Unit cost | table only, not presented |
| Unit selling price / Total / VAT | YES — `:83-86,155-158` |
| Discount | PARTIAL — workbook only, not in the client quotation |
| **Margin** | **NOT FOUND in the quotation** (present in pricing lines + Excel) |
| Assumptions | PARTIAL — AI advisory only (`ai-quotation-engineer.mjs:7`) |
| Exclusions / Validity / Delivery / Payment terms / Warranty | YES — `:39-59` |

**Actual lifecycle: `Draft` → `Approved` → `Issued`, plus `superseded_at` tombstoning.** There is **no `Review` and no `Revised` state.** Guards: `:266` `status!=="Draft"` → `QUOTATION_STATUS_INVALID`; `:267` `status!=="Approved"` → `QUOTATION_NOT_APPROVED`. AI advisory is explicitly non-authoritative — a forbidden-key regex blocks it from setting `quotationIssued`/`quotationApproved` (`ai-quotation-engineer.mjs:9`).

**⚠ The gate is an AND-chain over every active item.** `app/domain/presales-workflow-engine.mjs:37` requires `technicalApproved >= activeItems`, `pricedItems >= activeItems`, etc. There is **no partial-quotation path**. If one line is blocked, no quotation can be drafted.

---

## 19. Export System

| Format | Renderer | Usable? |
|---|---|---|
| **Excel (.xlsx)** | `buildCostSheetXlsx` `worker/xlsx-cost-sheet.mjs:28-40` (raw OOXML via `fflate`); model `app/domain/excel-export-engine.mjs:79-120` | **YES** — real file, persisted to R2 + reconciliation row. Tested |
| **CSV — BOQ** | inline | YES |
| **CSV — requirements / pricing** | inline | YES (unbounded) |
| **PDF** | **NOT FOUND** — every `application/pdf` reference is *upload parsing*, never generation | NO |
| **Word (.docx)** | **NOT FOUND** — parsed on input only | NO |
| Technical proposal | **NOT FOUND** as a generator; only a *classifier label* for uploads | NO |
| Commercial proposal | **NOT FOUND** | NO |
| **Quotation document file** | **NOT FOUND** — the quotation is rendered **only in-browser** from JSON. No download button, no writer | NO |

Mode gating exists: `validateExportReadiness` (`excel-export-engine.mjs:94-100`), `EXPORT_MODES` (`:1`), `Client-Safe` column stripping (`:21-22,89`), and issue is gated on a current export job (`presales-workflow-api.mjs:267`).

---

## 20. Roles & Permissions

| Role | Backend permissions | Frontend access | Approval rights |
|---|---|---|---|
| Administrator | everything | all | all (and is the *default* in single-user mode) |
| Project Manager | owner authority | all | via authority set |
| Management / Technical Manager / Senior Technical Reviewer | technical set | all | technical |
| Technical Reviewer / Engineering Reviewer | technical set | all | technical |
| Commercial Approver / Commercial Manager | commercial set | gated by `canViewCommercial` (UI only) | commercial |
| Commercial Reviewer | commercial | gated | commercial |
| Estimator | — | all | — |
| **Finance** | **NOT FOUND** | — | — |
| **Sales** | **NOT FOUND** | — | — |
| **Procurement** | **NOT FOUND** | — | — |

### Authorization gaps

| # | Issue | Evidence |
|---|---|---|
| 1 | **`pricing-api` grants implicit Administrator on any project** — a fabricated `{fullAccess:true, role:"Administrator"}` actor; `canApproveCommercialPrice` therefore cannot deny | `pricing-api.mjs:46` + `project-authority.mjs:49-51` |
| 2 | **Commercial visibility is UI-only.** `canViewCommercial` is client-side (`app/page.tsx:3406-3413`); the backend's broader list at `dashboard-workflow-engine.mjs:100` only strips summary `totals` — **line-level cost and margin are still returned**. `pricing-api` and `excel-export-api` have **no** commercial gate | as cited |
| 3 | `excel-export-api` mutating routes have no capability gate and write a fabricated `actorRole` | `excel-export-api.mjs:12,231,248,254` |
| 4 | `quotation-api.mjs` has zero capability/role checks | whole file |
| 5 | `GET /api/product-brands/ensure` reads library data with no identity check | `product-brand-registry-api.mjs:39-51` |
| 6 | Only 7 of ~100 worker API modules import `requireLibraryCapability` | `library-auth.mjs:51-54` |
| 7 | Backend permissions not reflected in frontend: the 11 `Boolean(0)`-gated UI branches | §4 |
| 8 | UI hiding without backend protection: `canViewCommercial` | §20.2 |

---

## 21. Audit Trail & Versioning

### Can the system answer these?

| Question | Answer | Mechanism |
|---|---|---|
| Why was this BOQ item classified as this family? | **YES** | `boq_extraction_evidence(item_id, field_name, source_location)` + `estimator_item_interpretations` / `canonical_interpretation` |
| What drawing supports it? | **PARTIAL** | only `boq_quantity_source_decisions(recognition_version_id, definition_key)` — quantity provenance, not a general item link |
| What specification clause supports it? | **YES** | `technical_requirements.clause_id` → `specification_clauses` |
| Who approved it? | **YES, but the actor is a bare string** | `review_decisions.decided_by` / `decided_role`; **no `users` table** to resolve it |
| Which manufacturer/model was selected? | **PARTIAL** | `match_candidates` + `library_products`; no `family_id` resolution, `brand_id` largely NULL |
| What supplier price was used? | **YES** | `pricing_lines.selected_price_record_id` → `price_records` |
| How was the selling price calculated? | **YES** | `pricing_cost_components` stores method/formula/rate/quantity/amount per component (`pricing-runtime.mjs:361-379`) |
| Which quotation revision contains it? | **YES** | `project_quotation_lines` carries `boq_item_id`, `candidate_id`, `product_id`, `pricing_line_id`, `commercial_approval_id` |

Traceability is genuinely good at the line level. The weak link is **actor identity** (no users table) and the **BOQ↔drawing link**.

### Versioning

| Mechanism | Status |
|---|---|
| `superseded_at` / `superseded_by_run_id` | pervasive, verified |
| Immutability triggers | present (47 triggers) |
| `pricing_lines.version_number`, `pricing_runs.version_number`, latest-wins | verified |
| Input fingerprints (`pricing_runs.input_fingerprint`, `source_fingerprint`) | verified |
| Old results preserved | **YES** — document versions are never deleted; only `documents.current_version_id` moves |
| New upload invalidates old results? | superseded, not destroyed; `document_supersessions` scope is fine-grained (`FULL_DOCUMENT|SECTION|CLAUSE|BOQ_ROW|DRAWING_REGION|EVIDENCE_ENTITY`) |
| Review decisions carry forward | only via explicit `APPROVE_INTERPRETATION` / `EDIT_AND_APPROVE`; no automatic reuse |
| **User warned of stale decisions** | **PARTIAL.** Backend emits `matchStale`/`quotationStale` booleans and `STALE_REVIEW_VERSION` error; **`STALE_` appears nowhere as an error code in any `.tsx`** — only a CSS-class map at `EngineerDecisionWorkspace.tsx:27` |

---

## 22. Testing & Golden Sets

| Layer | Location | Count |
|---|---|---|
| node:test unit/integration | `tests/*.test.mjs` | **435** |
| Co-located worker tests | `worker/__tests__/*.test.mjs` | 6 |
| Playwright | `tests/e2e/golden-smoke.spec.ts`, `golden-full-journey.spec.ts` | 2 |
| Golden fixtures | `tests/golden/*.fixture.mjs` + `fa-architecture-real-assets.json` | 10 |
| Evaluation gates | `scripts/fire-alarm-golden-evaluation-gate.mjs`, `cctv-golden-evaluation-gate.mjs` | 2 |

### ⚠ `npm test` covers 7.6% of the suite

- `npm test` names **33** test files. 435 exist.
- `test:all` runs the authoritative inventory with a recorded baseline: **399 SAFE, 33 REAL_STATE, 3 SPAWNS_PROCESS**, 3,853 tests.
- **368 safe test files never run in the default `npm test`.**
- 2 of the 33 listed files are in the *excluded* set, so the real overlap is **31/399 = 7.8%**.

### High-risk modules with zero executing test

**26 `worker/*.mjs` modules are never imported in-process by any test.** Twelve of those are only *source-text asserted* (readFileSync + regex — never executed): `ai-quotation-api`, `document-classification-authority`, `drawing-legend-geometry-api`, `engineering-classification-api`, `engineering-discovery-api`, `engineering-knowledge-graph-api`, `estimator-readiness-api`, `occurrence-spatial-clustering-api`, `production-readiness-api`, `project-npq-api`, `supplier-price-memory`, `symbol-cell-segmentation-api`, `symbol-signature-matching-api`.

**14 have no test reference at all**, including: `product-brand-registry-api.mjs`, `fire-alarm-preliminary-sizing-api.mjs`, `fire-alarm-knowledge-api.mjs`, `case-study-learning-api.mjs`, `cctv-knowledge-api.mjs`, `ai-presales-agent-diagnostic-api.mjs`, `ai-quotation-api.mjs`, `pipeline-orchestration.mjs`, `product-auto-review.mjs`, `historical-learning-pack-import.mjs`, `drawing-candidate-comparison.mjs`, `drawing-visual-understanding-provider.mjs`, `knowledge-product-resolver-runtime.mjs`, `engineering-classification-api.mjs`.

9 `app/domain/*.mjs` are never imported by any test: `engineering-assurance`, `price-evidence`, `quotation-fingerprint`, `cctv-taxonomy`, `cctv-product-attribute-extraction`, `candidate-comparison-pilot-cases`, `drawing-structure-review-attribution`, `drawing-visual-evidence`, `runtime`.

### ⚠ Hand-authored schemas still in tests

Despite `MODULE_MOCKS` and `CHAIN_FIXAxture` classes existing precisely to replace them, **zero test files carry either label** in `scripts/test-classification-baseline.json`. Tests still rolling their own `CREATE TABLE`:

`governance-authority-gaps` (~60 tables) · `document-downstream-api` (~40) · `identity-resolution-governance` (~34) · `excel-export-commercial-approval-authority` (~30) · `dashboard-technical-/commercial-approval-authority` (~28 each) · `symbol-takeoff-e2e` (22) · `drawing-structure-review-initialize` (~24) · `safety-matching-integration` (20) · `gov-001-override-unblocks-approval` + `golden-2-governed-primary-panel-selection` (~20 each) · `supplier-price-intake-db` (17) · `text-tag-document-identity` (13) · `recognition-legend-context` (13) · `supplier-quote-intake-confirmation-gate` (11) · `stage4d1/2/3-live-calculation-wiring` (5 each) · `stage4d4-auto-reject-policy` (4) · `spec-auto-confirm` (3) · `product-library-search-normalization` (2) · `safety-technical-approval-authority` (1).

The repo-intentional counter-example is `tests/document-duplicate-revision.integration.test.mjs:8`, whose comment records that it *used to* hand-roll a ~45-table approximation and now uses the real chain via `tests/helpers/active-chain.mjs`.

**Consequence: a green test on any of the above proves the fake schema, not production.**

### Skipped / conditional tests

- `test.skip` ×2 — `FUTURE-RBAC` (`tests/identity-resolution-auth.test.mjs:41-42`)
- `t.skip` ×22 — on missing dev D1 / missing Al Mousa fixture / missing real drawing sources
- `t.skip` ×21 — on missing real drawing sources (Opera, Central Kitchen, MARAFY, T-00, E-00, raster)
- Env-gated ×1 — `QA_LARGE_SPEC_DB`/`QA_LARGE_SPEC_PDF` + `QA_FULL_RUN=1`
- `.only(` / `todo:` / `describe.skip` — **0 found** (good)

### What the Fire Alarm gate actually measures

`scripts/fire-alarm-golden-evaluation-gate.mjs:266-275` asserts only: zero load errors (fails closed if the D1 snapshot is missing), `trueMatchingErrorCount === 0`, `falseResolveCount === 0`, `crossFamilyRankingErrorCount === 0`, Central Kitchen candidate discovery == 17/17, and all Central Kitchen family classifications correct.

It calls `runProductMatching({profile, products, prices: []})` (`:102,127`) — **`prices` is an empty array**. It reads live D1 profiles for Central Kitchen and synthesizes a description-only profile for Opera. **It never touches pricing, approval, quantity, sizing, quotation, or export.**

**It is a matching-regression gate. It does not prove a quotation can be produced.**

The CCTV gate is structurally identical (`cctv-golden-evaluation-gate.mjs:168-200`).

### e2e

`playwright.config.ts` — `baseURL: http://127.0.0.1:4173` (**not 4183**), `testDir: ./tests/e2e`, `channel: chrome`, `workers: 1`, `retries: 0`, webServer `npm run dev`. The full journey spec (575 lines) covers upload→…→quotation→export→issue and writes to `${HOME}/Desktop/AI-Pricing-Agent-Golden-Engineer-Review` — **outside the repo**. Neither spec is in `npm test` or `test:all`.

---

## 23. Full-Stack Gaps

### Frontend exists, backend missing
- `?workspace=Activity` audit view — **no audit API exists at all**
- `app/chatgpt-auth.ts` — auth helper never wired
- Hardcoded BOQ/requirement/price/audit fixtures have no API behind them

### Backend exists, frontend missing
- `POST/GET /api/product-brands/ensure`
- `POST /api/projects/:id/fire-alarm/panel-sizing` — **no UI at all for panel or loop sizing**
- `POST /api/projects/:id/fire-alarm/preliminary-sizing`
- `/api/identity-resolution/*` (7 routes)
- `POST /api/compatibility/relationships/auto-confirm`
- `POST /api/projects/:id/engineering-discovery/run|recalculate`
- `POST /api/requirements/:id/propagate-system-wide`
- `POST /api/safety/overrides/:id/decide` — an override with no entry point
- `excel-exports` rerun / supersede / reconcile / compare
- 11 `Boolean(0)`-gated UI branches

### API exists but unused
- `governedPrintedQuantityRows` plug-in → returns `[]`; no drawing-derived quantity is ever promoted
- `app/domain/fire-alarm-preliminary-point-demand.mjs` — 0 production importers
- `app/domain/document-intelligence.mjs` — 0 production importers (TEST-ONLY)
- `app/domain/fire-alarm-ecosystem-policy.mjs::resolveFireAlarmEcosystem` — 0 production importers
- `app/domain/fire-alarm-addressability-clause-evidence.mjs::semanticCompareRequirementVersions` — not wired to the production compare endpoint
- `pricing_exchange_rates` table — written, never read
- `RfqAuthorityWorkspace.tsx` — imported by nothing

### DB model exists but no application logic
`case_learning_evaluations`, `dashboard_metric_snapshots`, `requirement_rules`, `requirement_profile_comparisons`, `engineering_attribute_definitions`, `library_permission_grants`, `library_security_principals`, `price_record_versions`; plus `project_status_history` (presence-list only) and `requirement_rule_executions` (write-only).

### Feature exists only as static/mock UI
`?workspace=Activity` (3 hardcoded events) · Price Sources hardcoded cards · Administration (session-derived, read-only) · Supplier RFQs (disabled stub) · 6 fixture arrays in `page.tsx`.

### Backend feature has no engineer-facing interface
Panel & loop sizing · SLC/point demand · brand registry · identity promotion · identity resolution · compatibility auto-confirm · safety override · the entire `UNRESOLVED` decision vocabulary in the understanding review (the UI has no unresolved-items control).

---

## 24. Unresolved BOQ Workflow

**There is no BOQ status literally named "Unresolved."** The mechanism is `review_status='Needs Review'` + `approved_for_downstream=0` + `confidence_state='Needs Review'` (`boq-extractor.mjs:578,628`).

| Question | Answer |
|---|---|
| What creates it | duplicates (`:624-630`, confidence capped at 69) · approval-readiness failure (`:201-242`) · low confidence / any blocking warning (`:572,578`) · estimate-vs-BOQ `unresolvedAnchors` (`:198-218`) |
| Where stored | `boq_items.review_status`, `approved_for_downstream`; reasons in `boq_review_reasons.mjs:43-116` |
| Frontend display | label + prioritized reason list (`app/page.tsx:15890-15895`) — **but no dedicated unresolved screen** |
| Engineer can resolve? | **YES** — `/api/boq-items/:id/{approve,reject,update,split,merge,not-duplicate,restore}` |
| Where saved | `boq_review_decisions(action, previous_value, new_value, reason, decided_by)` |
| Downstream effect | only `review_status IN ('Approved','Accepted','Auto Verified') AND approved_for_downstream=1` feeds downstream (`current-evidence-scope.mjs:256`) |
| Audited | YES |
| Previous resolutions reused | **NOT FOUND** — no learning/reuse path. Historical learning is dataset-scoped and explicitly isolated from live tables (`tests/historical-boq-learning.test.mjs:20,33`) |
| Price recalculated on resolve | **NOT FOUND** — the cascade runs exactly two stages (Requirement Profile → Product Matching), `pipeline-orchestration.mjs:68-69`. No pricing trigger |

### Actual unresolved categories present in code (not invented)

Line-level derived states, recomputed not stored (`boq-line-decision-model.mjs:98-149`):
`AI_REVIEW_REQUIRED` · `STALE_RECALCULATING` · `RECALCULATION_FAILED` · `TECHNICAL_DECISION_REQUIRED` · `NO_MATCH` · `TECHNICALLY_READY`

BOM blockers (`worker/boq-line-bom-api.mjs:238-258`), default `BOM_EVIDENCE_INCOMPLETE`.

Field-level (the only literal `UNRESOLVED`, DB-CHECKed): `estimator_understanding_field_reviews.decision ∈ {CONFIRMED, EDITED, REJECTED, UNRESOLVED}`. **An `UNRESOLVED` decision grants no authority** — the resolver returns only CONFIRMED/EDITED (`estimator-understanding-review-api.mjs:223-229`). Field scope is only `system`, `category`, `productFamily` (`:210`).

Other real codes: `UNRESOLVED_SYSTEM_CONSTRAINT` (`app/domain/auto-reject-policy.mjs:59,194`), `NPQ_DELIVERY_SCOPE_UNRESOLVED` (`page.tsx:53`).

### Engineer review UX gaps

| Capability | Status |
|---|---|
| See sheet/page/row provenance | YES — `AiUnderstandingReviewWorkspace.tsx:208,215` |
| **Cell-level** source locator | **NOT FOUND** — no cell reference in any `.tsx` |
| Open drawing reference | YES — `app/page.tsx:17181-17186` |
| **Open specification clause** | **NOT FOUND** — no `clauseId` handler in any `.tsx` |
| **Compare conflicting sources side by side** | **NOT FOUND** |
| Select device family | YES (via understanding field review) |
| Enter an engineering reason | PARTIAL — `window.prompt` (`AiUnderstandingReviewWorkspace.tsx:163`), no structured form |
| **Bulk approve safe decisions** | **Deliberately prohibited** — UI badge "No bulk approval" + server guard `BULK_UNDERSTANDING_REVIEW_PROHIBITED` |
| **Filter to only unresolved** | **NOT FOUND** |
| See quotation impact | PARTIAL — a notice, not a diff (`:182`) |

**Assessment: the UI exposes raw technical data with a review action attached, rather than supporting engineering judgement.** No clause access, no cell-level evidence, no conflict comparison, no unresolved filter, and reason capture is a browser prompt.

---

## 25. Capability Matrix

| Capability | Backend | Frontend | DB | API | Tested | End-to-End | Production Ready | Evidence | Gap |
|---|---|---|---|---|---|---|---|---|---|
| Project Intake | YES | YES | YES | YES | YES | PARTIAL | YES | `dashboard-api.mjs:679` | — |
| Document Upload | YES | YES | YES | YES | YES | YES | YES | `document-api.mjs:44` | 100 MB buffered before reject (`:85-88`) |
| BOQ Extraction | YES | YES | YES | YES | YES | YES | YES | `boq-extractor.mjs:588` | — |
| Specification Extraction | YES | YES | YES | YES | YES | PARTIAL | PARTIAL | `specification-extractor.mjs` | OCR absent; no auto-trigger |
| Drawing Extraction | YES | YES | YES | YES | YES | PARTIAL | PARTIAL | 16 engines | OCR absent for raster |
| Drawing Classification | YES | YES | YES | YES | YES | YES | YES | `drawing-type-classifier.mjs:24` | — |
| Legend Intelligence | YES | YES | YES | YES | YES | — | PARTIAL | `drawing-legend-notes-intelligence.mjs` | **Explicit context only, no inheritance** |
| Layout Intelligence | YES | YES | YES | YES | YES | — | YES | `drawing-layout-intelligence.mjs` | — |
| Riser Intelligence | YES | YES | YES | YES | YES | — | YES | `drawing-riser-schematic-intelligence.mjs` | — |
| Schematic Intelligence | YES | YES | YES | YES | YES | — | YES | same | — |
| Cause & Effect | YES | YES | YES | YES | YES | — | YES | `drawing-cause-effect-intelligence.mjs` | — |
| Detail Intelligence | YES | YES | YES | YES | YES | — | YES | `drawing-detail-intelligence.mjs` | — |
| Cross-Sheet References | YES | **NO** | PARTIAL | YES | YES | — | PARTIAL | `drawing-cross-sheet-references.mjs:148` | **No UI; no rule inheritance by design** |
| Clause Governance | YES | PARTIAL | YES | YES | YES | — | PARTIAL | `specification_clauses` | **Cannot open a clause in UI** |
| BOQ Classification | YES | YES | YES | YES | YES | YES | YES | `boq-extractor.mjs:381` | — |
| Device Families | YES | PARTIAL | **NO TABLE** | — | YES | — | PARTIAL | `fire-alarm-taxonomy.mjs` | 7 categories; no Network Panel/MFACP; no DB table |
| Alias Resolution | YES | PARTIAL | YES | YES | YES | — | PARTIAL | `product-identity-engine.mjs` | No brand table in identity path |
| Equipment Identity | YES | NO | **NO TABLE** | YES | YES | — | PARTIAL | `product-identity-v1.1` | No physical-entity model |
| BOQ-Drawing Linking | PARTIAL | **NO** | PARTIAL | — | — | — | **NO** | `boq_quantity_source_decisions` | quantity provenance only |
| BOQ-Spec Linking | YES | **NO** | YES | — | YES | — | PARTIAL | `technical_requirements.clause_id` | no UI to open |
| Unresolved BOQ Review | YES | **NO SCREEN** | YES | YES | YES | — | PARTIAL | `boq-extractor.mjs:578` | no filter, no dedicated view |
| Quantity Reconciliation | YES | PARTIAL | YES | YES | YES | — | PARTIAL | `quantity-source-decision-api.mjs:64` | **`governedPrintedQuantityRows` returns `[]`** |
| SLC Calculation | YES | **NO** | NO | NO | YES | — | **NO** | `fire-alarm-slc-resource-classifier.mjs:186` | 1:1 hardcoded; no production caller |
| Panel Sizing | PARTIAL | **NO** | YES | YES | YES | — | **NO** | `fire-alarm-panel-sizing-api.mjs:543` | `MAX_SLC_LOOPS`/`SYSTEM_POINT_CEILING` unpopulated; `dependencies` missing at `:118` |
| Product Selection | YES | YES | YES | YES | YES | YES | PARTIAL | `product-matching-api.mjs` | `brand_id`/`family_id` unresolved |
| Pricing | YES | YES | YES | YES | YES | PARTIAL | PARTIAL | `pricing-engine.mjs` | **FX hardcoded 3.75**; no cost→pricing cascade |
| Supplier Quotes | YES | PARTIAL | YES | YES | YES | — | PARTIAL | `supplier-price-intake-api.mjs` | no RFQ, no comparison view, no supplier master UI |
| Engineer Approval | YES | YES | PARTIAL | YES | YES | PARTIAL | **NO** | `application-context.mjs:72` | every actor is Administrator |
| Audit Trail | YES | **MOCK** | YES | **NO API** | YES | — | PARTIAL | 30+ tables, no reader | **no audit endpoint exists** |
| Quote Generation | YES | YES | YES | YES | YES | — | PARTIAL | `presales-workflow-api.mjs:193-267` | AND-chain over all items; no partial path |
| Quote Revision | YES | YES | YES | YES | YES | — | PARTIAL | `superseded_at` | — |
| Export | PARTIAL | YES | YES | YES | YES | PARTIAL | PARTIAL | `xlsx-cost-sheet.mjs:28` | **Excel/CSV only — no PDF, DOCX, or quotation file** |

---

## 26. Quotation Readiness

### Can the system produce a technically reliable Fire Alarm quotation today?

**No.** The quotation renderer, approver, and exporter are all implemented and all reachable. What is missing is the **data** that the governance layer correctly refuses to accept.

### Already working

- Project intake, membership, dashboard, workflow stage machine
- Document upload with genuine hardening: extension allow-list, MIME↔extension cross-check, **magic-byte validation**, 100 MB cap, encrypted-PDF reject, zip-traversal reject, corrupt-XLSX detect (`document-management.mjs:73-103`)
- Versioning with true preservation (versions are never deleted), `document_supersessions` with six scopes, and a working restore route
- BOQ extraction: 14 row types, per-cell source location, duplicate detection that caps confidence at 69, lump-sum/range/formula quantity handling that **preserves unknown rather than coercing to 0**
- Drawing intelligence — the most complete subsystem: 10 sheet types, 16 extraction engines, real golden fixtures on real asset IDs
- Specification extraction, clause admission, review, auto-confirm
- Product identity with a real 6-rule ruleset, review guards, and promotion provenance
- Pricing engine with genuine fail-closed semantics, per-component formula persistence, and a margin/overhead/contingency/tax model
- Quotation authority with immutable lines carrying full lineage back to BOQ item, candidate, product, pricing line, and commercial approval
- Excel export producing a real workbook with live formulas, R2-persisted, issue-gated

### Partially working

- Product matching: works, with a confidence ceiling that refuses "High" without evidence
- Supplier intake: real PDF parsing and price-record promotion; no RFQ, no comparison view
- Knowledge library and product library review
- Cross-sheet references: detected, stored, adjudicated — but with no UI and no rule inheritance

### Manual intervention required

- **Confirming document classification** before any extraction will start (BOQ, spec, drawings all gate on `Manually Confirmed`)
- **Every single safety override** — a reason ≥10 chars plus evidence, scope, expiry
- **Every price decision** — nothing auto-selects; blocked lines need a human
- **Quotation draft** — the AND-chain over all active items has no partial path
- Review decisions are not reused; every item is re-decided

### Critical missing components

1. **Governed addressability = 0.** The SLC classifier requires `addressing === "addressable"` (`fire-alarm-slc-resource-classifier.mjs:214,220`). The only producer requires the literal phrase "individually addressable" in the specification text, and the applicability layer that would attach it has **no production writer**. The SLC chain therefore yields nothing.
2. **Panel capacity data.** `MAX_SLC_LOOPS` and `SYSTEM_POINT_CEILING` are required names with no populating source (`fire-alarm-panel-capability-normalization.mjs:202,351`; `SYSTEM_POINT_CEILING` deliberately excluded from the attribute map at `:207-215`). Zero panels can reach `SIZING_READY`.
3. **SLC consumption.** `unitsPerDevice: 1` is a literal (`:215,221`) with no data source; every other governed family correctly returns `demandUnits: null`.
4. **A quantity producer.** `governedPrintedQuantityRows = async () => []`.
5. **A point-demand producer.** `fire-alarm-preliminary-point-demand.mjs` has 0 production importers.
6. **A working preliminary-sizing POST.** `:118` omits `dependencies`; every request 422s.

### Frontend blockers

- **No panel-sizing or loop-sizing screen exists at all**
- **No unresolved-items screen** — no filter to "only unresolved"
- **No cell-level source viewer** and **no way to open a specification clause** — an engineer cannot inspect the evidence for a classification
- **No conflicting-source comparison view**
- Reason capture is `window.prompt`
- `?workspace=Activity` shows 3 hardcoded events because no audit API exists
- Hardcoded fixtures render in at least six places, including 22 zero-cost BOQ lines and 6 fabricated specification requirements with invented page/clause anchors

### Backend blockers

- **Authorization is structurally inert** — `applicationActor` defaults every actor to Administrator; `pricing-api:46` compounds it
- **Commercial visibility is UI-only** — cost and margin are returned by the API to any project member
- **`excel-export-api` mutating routes have no capability gate** and write a fabricated role
- **FX hardcoded at 3.75**; the governed rate table is inert
- **N+1 on the synchronous export path** — `quotation-evidence.mjs:36-53` issues ~7 sequential queries per BOQ item
- **Background failures are invisible** — 7 sites swallow errors; the user gets `202` and must poll

### Data blockers

*(REPORTED — from `docs/SYSTEM_INVENTORY_AUDIT_2026-09-29.md`, `docs/fire-alarm-gap-matrix.md`, `docs/GOLDEN-7A*`. I did not re-measure.)*

- 1,040 product identities with `manufacturer = NULL`
- 1 brand row (Farenhyt) against 951 canonical products; Gamewell-FCI / Gent / Simplex = 0 governed products
- 34 of 50 families populated; 16 with zero coverage
- 5 of 482 products have modern `product_attributes`; 0 of 10 Fire Alarm panels are `approved_for_discovery`
- 0 price records with `validity_state='Current'`; 0 suppliers
- 0 of 39 requirement profiles approved; governed addressability 0
- 0 quotations, 0 promotions, 0 reviews, 0 organization-library products
- 0 of 108 BOQ items carry manufacturer, part number, or drawing reference

### Engineering approval dependencies

- The AND-chain (`presales-workflow-engine.mjs:37`) means **one blocked line blocks the entire quotation**
- `compatibilityTarget` is undefined for Fire Alarm panels, so compatibility classification returns `INSUFFICIENT_EVIDENCE`
- Quotation issue requires a current, approval-gated export job
- AI advisory is correctly non-authoritative

### Pricing dependencies

- A valid, current, approved price record per line — 0 currently exist per the reported census
- Currency conversion is a fixed constant, so any non-USD/SAR-3.75 figure is wrong by construction
- No `branded_costing_eligible` product, no supplier to quote
- Margin is computed but **not shown on the quotation**

---

## 27. KEEP / FIX / BUILD

### KEEP — do not touch

| Item | Why |
|---|---|
| Document upload hardening | Extension + MIME + magic bytes + container checks + traversal reject. Genuinely strong. |
| Supersession + version preservation | Versions are never deleted; six-scope supersession; working restore. |
| BOQ quantity semantics | Lump sum / range / formula preserved as typed; unknown stays unknown. Never coerced to 0 at the commercial boundary. |
| `boq_extraction_evidence` per-cell provenance | This is the backbone of engineering traceability. |
| Pricing fail-closed blockers | `PRICE_SOURCE_SELECTION_REQUIRED`, `CURRENT_SELECTED_QUANTITY_REQUIRED`. Correct. |
| `pricing_cost_components` formula persistence | Answers "how was this price calculated" exactly. |
| Quotation line lineage | `boq_item_id → candidate_id → product_id → pricing_line_id → commercial_approval_id`. |
| Identity ruleset `product-identity-v1.1` | 6 rules, explicit about not coercing. |
| Drawing intelligence engines | Best-tested, most complete subsystem. |
| Capability-normalization fail-closed design | `SYSTEM_NAMEDPLATE_POINTS` ≠ `SYSTEM_POINT_CEILING` is the right call. |
| AI advisory non-authority guard | Forbidden-key regex on issue/approve. |
| `canonical-product-brand.mjs` + `normalizeBrandName` | Correct authority split (manufacturer ≠ brand). |
| Explicit-only legend contexts | The refusal to auto-propagate geometry is a governance strength, not a gap. |
| Active migration chain discipline | `drizzle-active` is the single source of truth; `drizzle/` correctly marked superseded. |

### FIX — defects, not new features

| # | Item | Evidence | Severity |
|---|---|---|---|
| 1 | Preliminary-sizing POST omits `dependencies` → **every call 422s** | `fire-alarm-preliminary-sizing-api.mjs:118` vs `fire-alarm-preliminary-sizing-snapshot.mjs:145` | **CRITICAL** |
| 2 | `pricing-api` fabricates an Administrator actor → commercial approval can never be denied | `pricing-api.mjs:46` + `project-authority.mjs:49-51` | **CRITICAL** |
| 3 | FX hardcoded 3.75; `convertCurrency` ignores its parameter; `pricing_exchange_rates` never read | `pricing-engine.mjs:3,137-138` | **CRITICAL** |
| 4 | Commercial visibility is UI-only; cost/margin returned to any project member | `app/page.tsx:3406` vs `pricing-api.mjs:638` | **CRITICAL** |
| 5 | `governedPrintedQuantityRows = async () => []` | `quantity-source-decision-api.mjs:128` | **CRITICAL** |
| 6 | `applicationActor` defaults every actor to Administrator | `application-context.mjs:72` | **CRITICAL** |
| 7 | `fire-alarm-preliminary-point-demand.mjs` has no production importer | 12 refs, all in tests/scripts | **HIGH** |
| 8 | Component disagreement on `max_system_points` (worker treats it as a ceiling; normalizer refuses it) | `fire-alarm-panel-sizing-api.mjs:224` vs `fire-alarm-panel-capability-normalization.mjs:354` | **HIGH** |
| 9 | `GET /api/product-brands/ensure` has no auth | `product-brand-registry-api.mjs:39-51` | **HIGH** |
| 10 | `excel-export-api` mutating routes ungated + fabricated `actorRole` | `excel-export-api.mjs:12,231,248,254` | **HIGH** |
| 11 | Production semantic clause comparator not wired to the compare endpoint (empty arrays forced) | `specification-extraction-api.mjs:346` | MEDIUM |
| 12 | N+1: ~7 sequential queries per BOQ item on the synchronous export path | `quotation-evidence.mjs:36-53` | MEDIUM |
| 13 | 7 background sites swallow errors; failure invisible behind `202` | e.g. `boq-extraction-api.mjs:442` | MEDIUM |
| 14 | Product-match reject accepts a `reasonCode` instead of a reason | `product-matching-api.mjs:357` | MEDIUM |
| 15 | Three divergent reason-length regimes (5 / 10 / inline-10) | `reason-governance.mjs:22,32`; `review-workflow.mjs:156` | MEDIUM |
| 16 | Unbounded `SELECT *` in both CSV exports | `specification-extraction-api.mjs:347`; `boq-extraction-api.mjs:479` | MEDIUM |
| 17 | 100 MB cap enforced after full buffering | `document-api.mjs:85-88` | MEDIUM |
| 18 | Hardcoded real-world constants: geometry UUID, "exactly 62 observations" | `occurrence-spatial-clustering-api.mjs:8`; `symbol-signature-matching-api.mjs:82` | MEDIUM |
| 19 | `pricing_lines.status` filter reads 3 values nothing ever writes | `pricing-authority.mjs:6` | LOW |
| 20 | Expired/no-validity prices marked `"Eligible"` on a relaxed path | `pricing-engine.mjs:93,107` | LOW |
| 21 | 8 orphaned tables; `requirement_rule_executions` write-only | §5 | LOW |
| 22 | `drizzle/` (104 files) and `next.config.ts` (empty) still present; stray `.golden-backup` in `worker/` | §2 | LOW |
| 23 | No `stale` error code surfaces in the UI despite backend flags | §21 | LOW |
| 24 | 2 `console.*` calls are the entire worker logging | §2 | LOW |
| 25 | Dependency/version drift: `package.json` lists 6 deps; AI model ids + timeouts hardcoded in 2 providers | `boq-understanding-provider.mjs:3-6` | LOW |

### BUILD — genuinely absent

| # | Item | Why it is new work |
|---|---|---|
| 1 | **Governed addressability producer** | Nothing writes it; the SLC chain is inert without it |
| 2 | **Capacity evidence for real panels** (`MAX_SLC_LOOPS`, `SYSTEM_POINT_CEILING`) | Requires manufacturer documentation acquisition — an external dependency |
| 3 | **Unresolved-items screen** with an unresolved-only filter | No backend work needed — the data and mutations already exist |
| 4 | **Cell-level source viewer** | The evidence is already persisted per-cell; this is a UI reader |
| 5 | **Open-clause action from BOQ review** | `technical_requirements.clause_id` already links them |
| 6 | **Conflicting-source comparison view** | Data exists; no comparison UI |
| 7 | **Structured reason form** replacing `window.prompt` | Server already validates reason length |
| 8 | **Audit read API** | 30+ audit tables exist; no reader endpoint. This unblocks the whole Activity screen |
| 9 | **Panel/loop sizing UI** | API exists; nothing consumes it |
| 10 | **PDF / DOCX / quotation document writer** | No generator exists for any format except XLSX/CSV |
| 11 | **RFQ subsystem** (removed from backend; only a disabled stub remains) | Net-new |
| 12 | **Supplier master + bid comparison** | Table exists read-only; no CRUD, no comparison |
| 13 | **Unify the remaining fake test schemas** | `MODULE_MOCKS`/`CHAIN_FIXTURE` classes exist but 0 files use them |
| 14 | **Multi-user identity** | `users` table does not exist; all auth is a single hardcoded identity |
| 15 | **Fire Alarm ecosystem resolution in production** | `resolveFireAlarmEcosystem` is test-only |

---

## 28. Recommended Next Action

**Do not start with unresolved BOQ closure.** The audit shows unresolved-BOQ closure is ~85% KEEP/FIX and is genuinely the cheapest real win, but it will not move quotation readiness, because the Fire Alarm chain breaks *downstream* of it at addressability and panel capacity — both of which require manufacturer documentation that is not in the repository.

Recommended order, smallest sufficient first:

**Step 1 — Fix the four CRITICAL defects (no new capability, no schema change, no data).**
`fire-alarm-preliminary-sizing-api.mjs:118` missing `dependencies` · `pricing-api.mjs:46` implicit Administrator · `pricing-engine.mjs:3` hardcoded FX · `canViewCommercial` server-side gate. Each is a one-to-three-line change with an existing test surface. Until #1 is fixed, a Fire Alarm route is *provably* incapable of returning 200.

**Step 2 — Build the three missing screens from data that already exists.**
Unresolved-items view with an unresolved-only filter (mutations exist at `/api/boq-items/:id/{approve,reject,...}`) · cell-level source viewer (evidence exists in `boq_extraction_evidence`) · open-clause action (link exists in `technical_requirements.clause_id`). This is the Step-2 milestone in §27, and it is mostly reader work, not new domain logic.

**Step 3 — Then, and only then, attack the data blockers.**
Governed addressability producer, then capacity evidence. Both need real manufacturer documentation. Start that acquisition **in parallel** with steps 1–2 because it is an external dependency with a long lead time, and note from the reported census that Simplex has no knowledge document at all.

**Step 4 — Add an audit read API.**
30+ audit tables already record who approved what and why. There is no reader. This is the single highest-leverage backend addition for engineering trust, and it removes a mock-data screen.

**Do not** broaden `npm test` to the full 399-file safe surface until the fake-schema tests in §22 are migrated — running 368 currently-unrun files against hand-rolled schemas will produce noise, not confidence. Migrate the ~20 files with hand-authored `CREATE TABLE` blocks to `tests/helpers/active-chain.mjs` first, then widen.

---

## Appendix — what this audit did NOT establish

- **No runtime evidence whatsoever.** The application was never started; no browser was driven; no API was called.
- **No database evidence beyond schema text.** No `*.sqlite` file was opened and live D1 was not queried. Every live-state number is REPORTED from a prior `docs/*.md` audit and is unverified by me.
- **No test was executed by me.** "Tested" in this report means a test file exists and its assertions were read — not that it passes. (Separately, the last time I ran them, `npm test` was 519/519 green; `test:all` also showed A1/A2 fire-alarm taxonomy failures from a concurrent lane, not mine.)
- **Column-level `db/schema.ts` ↔ migration parity** was not diffed; only table-name parity (317 = 317) was confirmed.
- **The exact FK count** was not computed.
- **Commit/push/deploy/restart:** none performed. Live D1: read-only, and in fact not read at all.
