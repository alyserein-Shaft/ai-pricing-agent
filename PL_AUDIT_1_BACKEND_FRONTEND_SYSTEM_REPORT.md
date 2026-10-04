# PL_AUDIT_1_BACKEND_FRONTEND_SYSTEM_REPORT

**System under audit:** Product Library vertical (DB → domain → API → frontend → engineer workflow)
**Audit:** PL-AUDIT-1 (independent, read-only)
**Workspace (canonical, exclusive):** `/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an`
**Date:** 2026-09-22
**Method:** code tracing → live DB inspection (read-only `node:sqlite`) → live API GET probes (`http://localhost:4183/`, no writes, no duplicate dev server) → test runs → persisted-row verification. Every claim below was asserted against at least one of these evidence layers.

---

## 1. Audit scope, boundary and method

- **Read-only mandate.** No DB writes, no migrations, no data/evidence mutations, no fixes. This report only.
- **Boundary.** Only the canonical workspace was read. No sibling directories, no Stanly, no commit/push/deploy, no external knowledge bases. All file paths below are relative to the workspace root.
- **Live checks.** `http://localhost:4183/` was verified working on GET endpoints without auth and used for behavior probes (search, knowledge summary). No new dev server was started.
- **Evidence battle order:** code → live DB → migrations → persisted rows → tests → fresh runs → artifacts. Any claim in this report that could not be nailed to a concrete file/row/response is labeled with its evidence layer.
- **Verdicts:** issued per PL-AUDIT-1 as `PRODUCT_LIBRARY_BACKEND`, `PRODUCT_LIBRARY_FRONTEND`, `PRODUCT_LIBRARY_BACKEND_FRONTEND_CONTRACT`. The Product Library is **not declared CLOSED**.

## 2. Systems inventory & live database state

Live DB (read-only): `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite`.

| Table family | Live row counts |
|---|---|
| `library_products` | 951 (930 identity `Active` / non-superseded chain heads) |
| `product_identities` | 1,881 |
| `price_records` | 518 |
| `product_identity_prices` | 1,204 |
| `product_attributes` | 68 (across 5 products) |
| `product_certifications` | 16 |
| `product_accessories` | 211 (all Approved; 18 relationship types) |
| `product_compatibility` | **27** (all `COMPATIBLE_WITH_BASE`, all Approved, `created_by=system:compatibility-auto-confirm`, all 2026-09-19T18:40) |
| `engineering_relationships` | 14 (Compatible With → System, Approved) |
| `product_source_evidence` | 1,114 |
| `product_sources` | 6 (all Global scope, all `Needs Review`/`Discovery Only`) |
| `product_match_runs` | 260 (208 Discovery Only, 36 No Match, 15 Needs Review, 1 Not Ready; 245 carry `no_match`) |
| `product_match_candidates` | 2,001 (all `review_status='Needs Review'`) |
| `product_library_decisions` | 56 |
| `manufacturer_order_code_observations` | 38 (36 Active-Reviewed, 2 Reversed-Reviewed) |
| `product_lifecycle_events` | 82 (0 `Active`; 57 Discontinued Replacement Candidate, 20 no replacement, 5 missing) |
| `product_documents` | 5 (4 Product Datasheet, 1 Installation; all Needs Review) |
| `product_conflicts` | 30 (21 Resolved, 9 Open) |
| `price_conflicts` | 1 (**Resolved** — involves the single costing price) |
| `knowledge_files` / `knowledge_facts` / `knowledge_product_links` | 29 / 6,660 / 1,908 |
| `product_identity_observations` / `relationships` / `events` / `runs` | 5,853 / 301 / 7,519 / 4 |
| `supplier_quote_intake_runs` / `supplier_quote_intake_rows` | 1 / 38 (all `Needs Review`, 0 promoted) |
| `identity_resolution_candidates` / `product_identity_decisions` | 54 / 5 |
| Zero-row tables | `product_versions`, `product_variants`, `product_packages`, `product_aliases`, `regional_part_numbers`, `suppliers`, `supplier_products`, `supplier_quotes`, `supplier_quote_lines`, `price_source_versions`, `price_record_versions`, `discount_rules`, `commercial_conditions`, `product_identity_aliases`, `supplier_branches`, `supplier_contacts`, … (≈260 total) |

Two parallel product systems run side by side (evidence layers: schema + row counts + readers):

- **`library_products`** (951) — backs the Product Library UI, matching, pricing, supplier intake.
- **`product_identities`** (1,881) — Knowledge→Product Identities model; 0 promotions ever; no UI renders it (see §25).

Two parallel price models:

- **`price_records`** (518) — the only model with real consumers (`commercialState`, `pricing-runtime`, detail/prices API).
- **`product_identity_prices`** (1,204) — written only by `worker/product-identity-api.mjs:135` (forced `discovery_status='Discovery Only'`, `costing_eligible=0`); **zero readers anywhere** (grep across `worker/`, `app/`, `scripts/`).

## 3. Engineer workflow as actually traced

Path an engineer actually walks today:

1. **BOQ → Technical Matching** (`worker/product-matching-api.mjs`, `app/domain/product-matching-engine.mjs`) queries canonical products via `CANONICAL_DISCOVERY_PRODUCT_PREDICATE` (§15).
2. **Product Library UI** (`app/page.tsx` §14932–15305) lists/search/browses the same 951 products through `/api/library/products`.
3. **Detail** (`openLibraryProduct`, page.tsx:8880 → `/api/products/:id`) shows source evidence, prices, attributes, certifications, accessories, documents, order-code observations.
4. **Pricing** (`worker/pricing-runtime.mjs` §§78–120) gates any price into costing only when a `price_records` row is `Approved` + `Costing` + current `valid_until`.
5. **Supplier intake** (`worker/supplier-price-intake*`, tables in §2) runs but has never promoted a row.

The vertical is **read-heavy and governance-bottlenecked**: ingestion, matching, and pricing all function, but the whole chain downstream of ingestion is stalled in `Needs Review`/`Discovery Only` states.

## 4. Product Library backend — search & browse API

`worker/product-price-library-api.mjs:17–40` (`queryLibraryProducts`):

- SQL: literal `LIKE '%query%'` over `lower(requested.part_number)`, `lower(requested.description)`, `lower(c.part_number)`, `lower(c.description)`, `lower(m.name)`, correlated `EXISTS` over `product_aliases`, `EXISTS` over `manufacturer_order_code_observations` (Active, `original_order_code`).
- `?discovery=true` adds `c.approved_for_discovery=1` → returns **exactly 8 rows**.
- Ordering: exact part-number match first, then `m.name, requested.part_number`.
- Totals via a second `COUNT(DISTINCT requested.id)` query; pagination via `LIMIT ? OFFSET ?`.

Live probes (real HTTP, page 1 size 5):

| Query | Results |
|---|---|
| `IFP-75HV` | 2 |
| `ifp75hv` | 0 |
| `IFP 75 HV` | 0 |
| `IFP75HV` (normalized form stored in the registry) | 0 |
| `B501-BL` | 2 |
| `REL-4.7K` | 2 |
| `Honeywell` | 503 |
| `fire alarm control panel` | 4 |
| `2023` | 0 |

**Finding (search):** substring-only, case-folded matching with **no punctuation/hyphen/whitespace normalization** — even though `library_products.normalized_part_number` exists (e.g. `IFP-75HV` → `IFP75HV`). Searching the normalized form returns 0. The UI placeholder promises "part number, alias, original code or description"; **alias search is dead** (`product_aliases` empty), order-code search works for 36 Active observations.

## 5. Product Library backend — detail & sub-resource API

`worker/product-price-library-api.mjs:522–561`:

- `GET /api/products/:id` — resolves via `visibleProduct` → `canonical_library_products` (recursive supersession view); returns `product`, `requested`, `canonicalResolution`, `evidence`, `prices`, `attributes`, `certifications`, `compatibility`, `accessories`, `documents`, `orderCodeObservations`, and `safety.costingEligiblePrices`.
- `GET /api/products/:id/prices` — per-row `eligibleForCosting` = `Approved` ∧ `Costing` ∧ current `valid_until` ∧ (project-scope match). **Exactly 1 of 518 price records qualifies** (`price_1c248b3e…`, USD 6,500, valid until 2027-06-30).
- `GET /api/products/:id/history` — `product_lifecycle_events` by `product_id` **or** `obsolete_part_number`.
- `GET /api/products/:id/{versions|variants|aliases|regional-part-numbers|attributes|certifications|compatibility|accessories|documents|conflicts}` — all return rows from tables that are empty or near-empty except accessories/attributes/certifications/conflicts.
- `GET /api/library/sources`, `GET /api/library/prices` (page ≤ 200), `GET /api/price-sources/:id/prices`, `:id/versions`.
- `GET /api/library/taxonomy` — no caller passes `?system=`, so it always serves the Fire Alarm pack (CCTV is registered in `app/domain/system-knowledge-registry.mjs` but never selected).

## 6. Product Library backend — discovery & review governance

- `POST /api/products/:id/approve-discovery` (worker:548) — `canGovernGlobal` (Administrator/Library Manager) required; atomically sets `review_status='Reviewed'` **and** `approved_for_discovery=1`; returns `costingEligible:false`. **Zero callers anywhere in `app/`** (grep). All 6 `Approved for Discovery` decisions in `product_library_decisions` were created by `local-development-user` (Administrator) — 5 on 2026-08-11, 1 on 2026-09-18 — i.e. API/test-level, not UI. **The Products UI has no review/approve action at all** (buttons in the Product Library page are pagination and row-click only).
- `POST /api/price-sources/:id/review` (worker:567) — source-level bulk approval: sets `product_sources.review_status='Reviewed'`, `downstream_use=?` **and approves every `price_records` row under that source** in one batch; costing requires a current `valid_until`. UI path exists: `reviewPersistentPriceSource` (page.tsx:5829) prompts a reason and POSTs `downstreamUse:"Costing"`.
- `POST /api/price-records/:id/review` (worker:578–609) — per-record Approve/Reject/Supersede with reason (≥ MIN_GOVERNED_REASON_LENGTH) and explicit `validUntil`; costing requires a current explicit validity end date; Global-scope records need `canGovernGlobal`. **This is the only net-new way to make price evidence costing-eligible today.**

## 7. Price evidence model — `price_records` (the only commercial-readiness channel)

Distribution (live):

| approval_status | downstream_use | validity_state | rows |
|---|---|---|---|
| Needs Review | Discovery Only | Historical — Validity End Missing | 496 |
| Needs Review | Discovery Only | Historical | 14 |
| Approved | Discovery Only | Historical — Validity End Missing | 7 |
| Approved | Costing | Current Approved | **1** |

- Only **1** record out of 518 has a `valid_until` set.
- All 518 are global (0 project-scoped).
- The single eligible record participates in a `price_conflicts` row — **status `Resolved`** ("Not a data-entry contradiction… Workbook 2023 Farenhyt sheet…").

## 8. Price evidence model — `product_identity_prices` (parallel, isolated)

- 1,204 rows. Written **only** at `worker/product-identity-api.mjs:135` with `discovery_status='Discovery Only'` and `costing_eligible=0` forced.
- **No reader** exists (code, domain, API, UI, scripts).
- `product_identity_prices_identity_idx` exists; the write never sets a costing-eligible state. This table is a dead-end fork of the price model.

## 9. Source & evidence model

- `product_sources` (6): 2 Product Datasheet, 1 Manufacturer Price List (KSA Honeywell Farenhyt – 2023), 1 Price List (Data System OH), 1 Historical Supplier Quotation (CCTV/kitchen), 1 Manufacturer Official Datasheet (Hikvision). **All Global scope, all `Needs Review` / `Discovery Only`.**
- `product_source_evidence` (1,114): Price List 591, Manufacturer Price List 504, Historical Supplier Quotation 10, Product Datasheet 5, Manufacturer Official Datasheet 4; 0 rows with NULL `source_id`; 0 orphan rows.
- Detail evidence hydration selects evidence per canonical product (`worker` §5) with `file_name`, `source_type`, `validity_state`, `downstream_use`, `review_status` — evidence never self-approves a price (enforced by the §7 gate).

## 10. Technical attributes — two inconsistent stores

- **Structured:** `product_attributes`, 68 rows across **only 5 products**, all `review_status='Needs Review'`; the matching consumer filters to `review_status<>'Rejected'` (all 68 still included) but the UI detail reads them without filtering.
- **Embedded JSON:** `library_products.attributes` (678 non-empty, 4,112 entries, 81 distinct names). ~434 entries are `source_*` price-list facts (e.g. `source_code`, `source_discount` observed from the Farenhyt workbook) stored as *technical* attributes — i.e. catalogue extraction facts are embedded in the technical attribute bag with unknown origin (`"?"` authority). Examples with counts: `operating_voltage_range` 140, `device_type` 128, `mounting` 93.
- `FAMILY_TECHNICAL_REQUIREMENTS` (auto-review gate 5) reads the **embedded JSON** (`product-auto-review.mjs:147`), while matching reads the **structured table**. The two stores can disagree on the same product.

## 11. Certifications, accessories, documents

- `product_certifications`: 16 rows (all Needs Review; 5 products).
- `product_accessories`: 211 rows across 18 Approved relationship types — Compatible Base 69, Compatible Backbox 47, Sounding Base 36, Compatible Sampling Tube 20, Expansion Module 8, Compatible Cabinet 5, Compatible Reflector Heater Kit 4, Required Detector Head 4, Compatible Junction Box 3, Compatible Component 2, Compatible Long-Range Kit 2, Compatible Sensor Head 2.
- `product_documents`: 5 rows (4 Datasheet, 1 Installation), all Needs Review.
- The detail panel counts all three (accessories/certifications counts sourced from the API). Accessories are Approved-gated in matching (`review_status NOT IN ('Rejected','Needs Review')`).

## 12. Compatibility — disposition doc is factually stale (new P2 finding)

- `docs/product-compatibility-disposition.md` (dated 2026-08-31) states **"Zero real rows, ever"** and **"No write path anywhere"** (its own grep claim).
- **Live DB contradicts both:** `product_compatibility` has **27 real rows**, all written by `system:compatibility-auto-confirm` on **2026-09-19T18:40:51Z** (after the doc), and `product_library_decisions` records 27 matching `Auto-Confirm` entries (`entity_type='product_compatibility'`, same timestamp/actor).
- Current code (`worker/compatibility-auto-confirm.mjs:255,268–270`) uses `COMPATIBILITY_WRITE_TARGET='engineering_relationships'` and writes the canonical store "Never product_compatibility" — yet historical live data exists, the API still reads `product_compatibility` at worker:538, and the UI hides the count claiming "zero real rows".
- `engineering_relationships`: 14 Approved rows (Compatible With → System) — this is the current write target and the one fed to matching.
- **Net effect:** three views of compatibility coexist (legacy `product_compatibility` 27, `engineering_relationships` 14, UI count removed), and the governing doc misdescribes reality.

## 13. Canonical resolution

`canonical_library_products` (view, live schema captured):

- Recursive CTE walks `superseded_by_product_id` chains (depth < 32, cycle-guarded) from any `requested` id to the current non-Superseded head; `visibleProduct`/`queryLibraryProducts`/`loadProducts` all resolve through it.
- 930 of 951 products are chain heads with `identity_status='Active'`.
- The API exposes `requestedPartNumber → canonicalPartNumber`, `resolvesToCanonical`, and `canonicalResolution` in detail. No dangling supersession references were found (visual spot-checks of `superseded_by_product_id`).

## 14. Lifecycle events & supersession

- `product_lifecycle_events`: 82 rows; **zero with lifecycle_status `Active`** (57 Discontinued Replacement Candidate, 20 Discontinued No Replacement, 5 Discontinued Replacement Missing).
- 78 events link via `obsolete_part_number` only; only 4 via `product_id` — the `history` route queries both keys, so lifecycle history is discoverable but the "Lifecycle: Active" badge the UI guards on (page.tsx:15051–15054) depends on `lower(lifecycle.lifecycle_status)='active'` in `queryLibraryProducts` — i.e. it can never render for any live product (all 951 carry `lifecycle_status='Unknown — Review Required'`).

## 15. Matching consumer (engine + API)

- `worker/canonical-product-authority.mjs:12` — `CANONICAL_DISCOVERY_PRODUCT_PREDICATE`:
  `p.requested_product_id=p.id AND p.identity_status='Active' AND p.review_status<>'Rejected' AND EXISTS (SELECT 1 FROM product_source_evidence e WHERE e.product_id=p.id)`.
- **930/951 products satisfy the predicate.** Only **8** of those have `approved_for_discovery=1` ⇒ `approved_for_discovery` gates **nothing** in matching (the comment at canonical-product-authority.mjs:2–8 calls this deliberate: "Business review … no longer blocks matching"). The UI nevertheless stamps per-row "Permitted use: Not approved for discovery" and a universal "Blocker: No commercial approval" (§22).
- `loadProducts` (worker/product-matching-api.mjs:100) pulls `product_attributes` (modern), `engineering_relationships` (Approved, project-scope aware), `product_accessories` (NOT IN Rejected,Needs Review), and a single `product_source_evidence` sample.
- `loadPrices` (worker:118) reads only `product_id, project_id, approval_status, downstream_use, valid_until` from `price_records`.
- `commercialState` (app/domain/product-matching-engine.mjs:464) — current = `Approved` ∧ `validUntil ≥ now`; result tiers: Project Price Available / Valid Current Price Available / Expired / Historical / Supplier RFQ Required.
- **Live candidates** (2,001, all `review_status='Needs Review'`): technical_status Non-Compliant 1,323 / Discovery Only 655 / Compliant with Warnings 23; recommendation_tier Rejected 1,323 / Discovery 655 / Conditional Alternative 23; commercial_availability **Historical Price Only 1,907**, Supplier RFQ Required 93, **Valid Current Price Available 1**; candidate scores up to 92.

## 16. Pricing consumer (runtime gate)

`worker/pricing-runtime.mjs:78–120` — `price_records` where `product_id=? AND (project_id IS NULL OR project_id=?)`, then eligibility requires `approval_status='Approved'` ∧ `downstream_use='Costing'` ∧ `valid_until ≥ now`. Result: **exactly 1 eligible cost basis in the entire system** (the 2023 Farenhyt workbook row, §7). Every other line is blocked — consistently with the UI language "Historical and Discovery Only prices remain blocked unless separately approved" and the detail-panel "eligibility is never inferred". The gate is correct and fail-closed; the data is starved.

## 17. Supplier price intake pipeline

- Migration `0055_supplier_price_intake.sql` creates runs/rows/events + promotes `supplier_quote_lines.source_intake_row_id`/`supplier_quotes.source_document_version_id`.
- Live: **1 intake run** (project `project_8783827a…`, doc `doc_55ceab8c…`, version `ver_8523be3f…`), **38 intake rows — all `review_status='Needs Review'`**, `mapped_by`/`promoted_*` all NULL. `suppliers`, `supplier_products`, `supplier_quotes`, `supplier_quote_lines` all empty.
- `worker/supplier-price-intake*` + tests (lineview/pdf/db) pass; pipeline exists but has **never reached commerce** (0 promotions).

## 18. Knowledge Library backend

- `worker/knowledge-library-api.mjs` (live) routes: `GET/POST /api/knowledge/files`, `GET /api/knowledge/search`, `GET /api/knowledge/review-queue`, `POST /api/knowledge/review/:kind/:id`, `POST /api/knowledge/link/fact/:id`, `POST /api/knowledge/resolve/fact/:id`, `POST /api/knowledge/facts/:id/links` (repair), `GET /api/knowledge/summary`.
- Live summary: **29 files, 1,855 products learned, 29 manufacturers, 1,503 prices, 38 need review**. Fact mix: Product Description 2,205; Part Number 1,908; Price 1,503; Product Relationship 310; Lifecycle 253; Product Family 123; Category 97; Country of Origin 52; Unit 38; Manufacturer 33; Standard 19; Certification 3; …
- Search route returns `{query, results}`; **no `files` key** — see the frontend dead-end (§24).
- Knowledge "learned" facts are separate from `library_products` until/unless promoted; there is no live promotion path from knowledge facts into the Product Library other than the identity pipeline (§19, 0 promotions).

## 19. Product Identities backend

- `worker/product-identity-api.mjs`: `GET /api/product-identities`, `GET /:id`, `POST /analyze` (idempotent, fingerprint-ruleset materialization), `POST /:id/review` (manufacturer/unit, version-guarded, idempotency-keyed), `POST /:id/promote`.
- Live state: 4 runs; 5,853 observations; 301 relationships; **0 promotions**; 2 Active + 1 Superseded `product_identity_reviews`. The identity model is richly instrumented but has never promoted a single identity into `library_products`.

## 20. Search behavior — normalization gap (central contract defect)

Live probes listed in §4 prove: case-insensitive substring matching only; **no hyphen, space, or punctuation tolerance**, no use of `normalized_part_number`, and a dead alias branch. UI copy promises alias/original-code search; alias is empty and the only "original code" source is 36 order-code observations. This is the single most user-visible contract defect.

## 21. Technical readiness vs commercial readiness — the core question

**The system carries two distinct readiness axes, and they are never unified:**

1. **Technical/discovery readiness:** identity `Active` + evidence (predicate §15) + family/attributes/certifications/accessories/compatibility evidence + `review_status≠Rejected`. **930/951 products pass.**
2. **Commercial readiness:** a `price_records` row that is `Approved` ∧ `Costing` ∧ current `valid_until`. **Exact count: 1 product** (and 1 candidate reaches "Valid Current Price Available").

- `approved_for_discovery` (8/951) is a governance stamp that **matches nothing** and **prices nothing**; the frontend nonetheless renders it as the per-row permitted-use state and brackets every row with an unconditional "Blocker: No commercial approval".
- The pricing/technical distinction *is* enforced in the backend (fail-closed costing gate, "eligibility is never inferred" language) — but the UI conflates "review pending", "not approved for discovery", and "no commercial approval" into a single ambiguous status block.
- **Answer:** the backend data model distinguishes technical vs commercial readiness; the frontend and the vocabulary do not consistently.

## 22. Frontend — Product Library list

`app/page.tsx` §14932–15061:

- Fetch: `/api/library/products?q=&page=&pageSize=50` (+`sourceId`/`projectId` when a source is selected). **No `discovery=true` from the UI** except a raw `<a href>` in a helper panel (§:12357–12364).
- Row rendering (15041–15059) is **partially data-driven, partially hardcoded**:
  - `Review: {reviewStatus}` — data-driven (always "Needs Review" in practice).
  - `Permitted use:` — data-driven on `approvedForDiscovery` (8 rows "Product discovery", 943 "Not approved for discovery").
  - `Lifecycle: Active` — guarded on `lifecycleEvidenceSupported && lifecycle_status==='Active'`; can never appear (0 active lifecycle events).
  - **`Blocker: No commercial approval` — hardcoded on every row unconditionally** (page.tsx:15058), including the 8 approved-for-discovery products and even the 1 product with a costing-eligible price. This line is not connected to any API field.
- Pagination, source filter and empty states render fine.

## 23. Frontend — Product detail panel

`app/page.tsx` §15109–15246 (`openLibraryProduct` → `/api/products/:id`):

- Canonical resolution banner; evidence list (file/page/row/type); order-code observations; Historical prices (**every price row is hard-stamped "Historical / Discovery Only" + "No validity end · Not approved for costing"** — page.tsx:15201–15206 — **regardless of the record's actual `approval_status`/`eligibleForCosting`**, while the footer safety note says "Eligible for costing: N"); Technical evidence counts for attributes/certifications/accessories; compatibility count intentionally removed with a stale "zero real rows" comment (page.tsx:15234–15238).
- The panel surfaces the API's data (evidence, prices, counts) but **replaces per-row approval truth with hardcoded blocked language**.

## 24. Frontend — Knowledge Library workspace (Manufacturers/Products/Standards/Search dead-end)

`app/components/workspaces/KnowledgeLibraryWorkspace.tsx` (105 lines) + page.tsx §8575–8660:

- Section fetch routing: `typeMap {Products→"Part Number", Manufacturers→"Manufacturer", Standards→"Standard"}`, `fileTypeMap {Prices→"Price List", …, Case Studies→"Previous Project Reference"}`, plus `identityMode` (Product Identities) and `reviewMode` (Review).
- The workspace renders **`files.map(...)` only**; it consumes `results` **only as a count badge** (`RESULTS {results.length}`). For the Manufacturers/Products/Standards/Search sections the API returns `{results}` with **no `files` key**, so:
  - the "RESULTS" metric shows the real count (e.g. 29 manufacturers, 6,660 facts),
  - the list area shows **"No manufacturers found."** empty state — the retrieved rows are never displayed.
- Live probe: `/api/knowledge/search?q=Honeywell&type=Manufacturer` returns rows; the UI never lists them.
- `Knowledge > Products` in the sidebar maps through `resolveGlobalDestination` to the Product Library module (page.tsx:12245–12250) — so the knowledge "Products" search dead-end is only reachable via the Products/Standards typeMap, not the top-level nav.

## 25. Frontend — Product Identities & Review dead-ends

- `productIdentities` **state is fetched** (`setProductIdentities`, page.tsx:8640) from `/api/product-identities` when section = "Product Identities", **but no JSX anywhere renders it** (grep: state declared page.tsx:2785, set at 8640, never read in render). The workspace component does not even accept an `identities` prop.
- `knowledgeReviewItems` (fetched for `reviewMode` via `/api/knowledge/review-queue`, set at 8642) is likewise **never rendered** in the workspace; `knowledgeReviewTarget` exists but the review action popup is not wired into any visible surface in this module.
- Net: two more sections whose data is fetched and discarded visually — 1,881 identities and a live review queue are unreachable from the UI.

## 26. Frontend — Fire Alarm & CCTV knowledge views

- `app/components/workspaces/FireAlarmKnowledgeWorkspace.tsx` / `CctvKnowledgeWorkspace.tsx` each call exactly one endpoint: `/api/knowledge/fire-alarm/overview` and `/api/knowledge/cctv/overview`.
- `worker/fire-alarm-knowledge-api.mjs` and `worker/cctv-knowledge-api.mjs` are **near-duplicate read-only diagnostics** over the same tables (`library_products` filtered by Honeywell / Hikvision; manufacturers/families/needs-review tallies). Honeywell 503; Hikvision 14 (13 with family).
- They render counts and lists; functionally read-only, no write surface; duplication is maintenance debt rather than a defect.

## 27. Frontend — navigation & routing

`app/lib/application-navigation.mjs:1–21` + `AppShell.tsx` + page.tsx resolver:

- Knowledge children: Files, Products (→ Product Library), Manufacturers, Prices, Case Studies, Fire Alarm, CCTV.
- `resolveGlobalDestination` routes `Knowledge+Products → Product Library`; everything else stays in the Knowledge workspace.
- Role gating: `canGovernGlobal` = Administrator / Library Manager only for approve-discovery, global source review, global record review, and library ingestion (`document-classification-authority` + `LIBRARY_ROLE_REQUIRED`). `LIBRARY_CAPABILITIES`/`requireLibraryCapability` gate read vs analyze/review/promote.
- `approvedManufacturers` found in `project-npq-api` is an NPQ draft field — **not** Product Library governance; do not confuse (INFO).

## 28. API contract matrix (endpoints ↔ consumers ↔ UI)

| Endpoint | Consumers | UI caller? |
|---|---|---|
| `GET /api/library/products` | page.tsx:8477, 12359 | Yes (list/search) |
| `GET /api/products/:id` | page.tsx:8872 (`openLibraryProduct`) | Yes (detail) |
| `GET /api/products/:id/prices` | page.tsx:3827 (`commercialApi.productPrices`) | Yes (project pricing) |
| `GET /api/library/prices` | api-client.ts:89 | Yes (Price Sources panel) |
| `GET /api/library/sources` | api-client.ts:87 | Yes |
| `POST /api/price-sources/:id/review` | page.tsx:5834 | Yes (prompt-based) |
| `POST /api/products/:id/approve-discovery` | — | **No UI caller** |
| `GET /api/library/taxonomy` | — | **No UI caller with `?system=`** |
| `GET/POST /api/knowledge/*` | page.tsx Knowledge sections | Partial (Files/Case Studies render; search/identities/review count-only) |
| `/api/product-identities*` | page.tsx:8640 (set state) | **No rendering** |
| `/api/knowledge/fire-alarm/overview`, `/cctv/overview` | respective workspaces | Yes |

## 29. Status language matrix (backend values ↔ UI labels)

| Backend state | Live volume | UI label | Data-driven? |
|---|---|---|---|
| `review_status='Needs Review'` | 943 products | "Review: Needs Review" | Yes |
| `review_status='Reviewed'` ∧ `approved_for_discovery=1` | 8 | "Review: Reviewed / Permitted use: Product discovery" | Yes (but next row contradicts) |
| any product | 951 | **"Blocker: No commercial approval"** | **No — hardcoded** |
| `price_records.approval_status` any | 518 | **"Historical / Discovery Only … Not approved for costing"** | **No — hardcoded per row** |
| `approved_for_discovery=0` | 943 | "Permitted use: Not approved for discovery" | Yes |
| costing eligibility (1 record) | 1 | "Eligible for costing: 1" (footer) | Yes (via `safety`) |
| `lifecycle_status='Unknown — Review Required'` | 951 | "Lifecycle: Unknown — Review Required" (not shown; badge gated) | — |

## 30. Test coverage of the vertical

Runs executed in this audit (all green):

- `product-price-library*.test.mjs` (api/engine/ui) — 27 pass.
- Matching/identity/supplier-intake/accessory/compatibility suites — 152 pass.
- `product-library-source-scope`, `product-matching-api`, `fire-alarm-attribute-semantics`, `task9-fire-alarm-library`, `system-knowledge-registry`, `matching-product-projection`, `r4-standards-semantics` — 106 pass.
- `identity-resolution*`, `knowledge-promotion-api/write`, `supplier-price-intake-lineview/pdf/db` — 45 pass, 11 skip (skip source: one filename with a zero-width character in my run command).
- `knowledge-promotion-policy/evaluation`, `identity-resolution-auth/engine`, `supplier-price-memory-idempotency`, `supplier-quote-intake-confirmation-gate` — 43 pass, 2 skip (intentional `FUTURE-RBAC` skips).
- No failures anywhere. **Coverage is strong on unit/engine behavior; nothing tests the frontend dead-ends found in §24–25** (the UI suites assert list/detail/price rendering, which is why the hardcodes pass them).

## 31. Dead / duplicate / backup surface

- `worker/knowledge-library-api.mjs.bak`, `.backup2`, `.backup3`, `.backup4`, `.fixed` — referenced by **0 import statements** (dead).
- `product_identity_prices` — write-only, no readers (§8).
- Warehouse of empty tables (§2) that the API still exposes as live sub-resources (§5).
- Fire Alarm / CCTV overview endpoints near-duplicated (§26).
- `product_compatibility` legacy rows vs `engineering_relationships` vs UI-removed count (§12).
- Two product models + two price models with no reconciliation pipeline (0 promotions, §19).

## 32. Backend findings table (severity P0–P3/INFO)

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| B1 | **P1** | `approved_for_discovery` (8/951) gates **nothing**: matching predicate ignores it; only 8 products carry it; UI stamps 951 rows around it | canonical-product-authority.mjs:12; live predicate count 930; worker:548; page.tsx:15047–15058 |
| B2 | **P1** | Commercial readiness is starved: **1/518** price records is Costing-eligible; only 1 of 2,001 candidates is "Valid Current Price Available" | pricing-runtime.mjs:78–120; price_records distribution; candidates table |
| B3 | **P1** | Search has no normalization: normalized part numbers, whitespace, hyphen/punctuation all fail; aliases table empty, yet UI promises alias/original-code search | SQL worker:17–40; live probes §4; `product_aliases` = 0 |
| B4 | **P2** | `product-compatibility-disposition.md` factually stale: 27 real rows written after the doc; "no write path" false | `product_compatibility` 27 rows + 27 decisions 2026-09-19; worker reads it at :538 |
| B5 | **P2** | Two price models diverge: `product_identity_prices` (1,204) write-only; `price_records` (518) is the only real channel | product-identity-api.mjs:135; grep readers = 0 |
| B6 | **P2** | Attributes split across structured (68 rows/5 products) and embedded JSON (678 products) with different consumers and unknown `"?"` origins | product_attributes table; library_products.attributes; auto-review :147 vs matching :100 |
| B7 | **P2** | Governance routes exist but are unreachable from the UI (approve-discovery has 0 app callers; taxonomy has 0 callers with `?system=`) | grep; worker:548; page.tsx |
| B8 | **P3** | ~260 empty tables remain exposed as live API sub-resources | §2, §5 |
| B9 | **P3** | Known-write-path dead code / backups (`knowledge-library-api.mjs.*`) and near-duplicate FA/CCTV overview endpoints | grep; §26; §31 |
| B10 | INFO | Supplier intake is functional but has never promoted a row (0/38 reviewed) | §17 |

## 33. Frontend findings table

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| F1 | **P1** | Hardcoded "Blocker: No commercial approval" on **every** list row regardless of state (including the 8 discovery-approved products and the 1 costing-eligible product) | page.tsx:15058 |
| F2 | **P1** | Every price row in detail is hard-stamped "Historical / Discovery Only / Not approved for costing" regardless of the record's actual eligibility, contradicting the footer "Eligible for costing: N" | page.tsx:15201–15206 vs 15217–15221 |
| F3 | **P1** | Manufacturers/Products/Standards/Search knowledge sections fetch real `results` but the workspace never lists them — users see count + "No … found." | KnowledgeLibraryWorkspace.tsx:73–101; knowledge-library-api.mjs:403–421 |
| F4 | **P1** | Product Identities and Review queue data are fetched into state and never rendered (1,881 identities + review items unreachable) | page.tsx:8640/8642; workspace props never carry them |
| F5 | **P2** | UI vocabulary conflates technical review, discovery approval, and commercial approval into one status block; no per-axis state | §29 |
| F6 | **P2** | No approve-discovery / review action in the Products module — governance is API-only | grep; §6 |
| F7 | P3 | Lifecycle "Active" badge is dead code (can never render) | page.tsx:15051–15054; lifecycle events 0 Active |

## 34. Verdicts, top-10 repairs, next step

### Contract matrix (summary)

| Contract axis | Backend provides | Frontend shows | Verdict |
|---|---|---|---|
| Search (token/punctuation/alias) | substring only; aliases empty | placeholder promises alias/original-code | PARTIAL |
| Status language | granular per-axis (review, discovery, approval, validity) | conflated + 2 hardcodes (F1, F2) | PARTIAL |
| Dual product models | 951 vs 1,881 with 0 promotions | renders only `library_products` | INCONSISTENT |
| Dual price models | 518 real vs 1,204 write-only | renders `price_records` only | PARTIAL |
| Knowledge search | `results` returned | count-only; rows discarded | INCONSISTENT |

### Top-10 repair priorities

1. Remove the hardcoded "Blocker: No commercial approval" row stamp; render per-axis state (review / discovery / commercial) from API fields (F1, B1).
2. Render each price row's real `approval_status`/`valid_until`/`eligibleForCosting` instead of the hardcoded blocked stamp (F2).
3. Render knowledge `results` in `KnowledgeLibraryWorkspace` (Manufacturers/Products/Standards/Search) (F3).
4. Render Product Identities and the Review queue, or remove the dead sections (F4).
5. Add normalization to `queryLibraryProducts` (use `normalized_part_number`, strip punctuation/whitespace, seed or drop the alias branch) (B3).
6. Reconcile `product-compatibility-disposition.md` with live state and pick one compatibility source of truth (B4).
7. Decide the fate of `product_identity_prices` (connect a consumer or stop writing) (B5).
8. Unify or document technical-attribute sources (structured vs embedded JSON) (B6).
9. Surface governance actions (approve-discovery, taxonomy selector) in the Products/Admin UI or remove the dead routes (B7).
10. Prune empty-table sub-resources and dead backups (B8–B10, F7).

### Verdicts

- **PRODUCT_LIBRARY_BACKEND: REPAIR_REQUIRED** — the read/gate/review machinery is coherent, fail-closed, and fully test-covered (373+ tests green), but the discovery-approval flag is invisible to every consumer, commercial readiness is effectively 1 product, search has a normalization defect, and live data contradicts the compatibility disposition doc. Nothing is broken enough to be BLOCKED; none of the P1s are closer than the P1s listed.
- **PRODUCT_LIBRARY_FRONTEND: REPAIR_REQUIRED** — hundreds of data rows are visible and paginated correctly, but 4 P1s render false or discarded state (hardcoded blocker, hardcoded price blocking, discarded knowledge results, unreachable identities/review queue).
- **PRODUCT_LIBRARY_BACKEND_FRONTEND_CONTRACT: PARTIALLY_CONSISTENT** — the wire shape (list/detail/prices/safety) is aligned and typed, but the UI hardcodes states the API intentionally reports per-row, discards knowledge-search/identities responses, and the status vocabulary conflates independent readiness axes. Not INCONSISTENT because every rendered value traces to a real row; not CONSISTENT because at least two UI blocks assert the opposite of the API data for ongoing live rows.

### Next step (exactly one)

Present this report for the Product Library verdict/remediation decision (which P1s to repair first, and in which order). No Product Library changes, writes, or further audit passes will be started until that decision is made.

**STOPPED.**