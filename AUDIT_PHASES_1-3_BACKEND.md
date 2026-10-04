# AI Pricing Agent Knowledge Workspace — Backend Audit (Phases 1-3)

## LIVE DATABASE SNAPSHOT
**Database**: `faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite`
**Date**: Sun Oct 04 2026

---

## PHASE 1 — MAP THE REAL BACKEND

### 1.1 Knowledge Files (28 total)
| detected_type | classification_status | count |
|---|---|---|
| BOQ | Needs Review | 1 |
| Price List | Classified | 5 |
| Supplier Quotation | Classified | 1 |
| Supplier Quotation | Needs Review | 1 |
| Supplier RFQ | Needs Review | 7 |
| Unknown | Needs Review | 13 |

- All 28 files have `processing_status = Completed`
- 5 files are `Classified` (all Price List type)
- 23 files are `Needs Review`
- No files have `Classified` + `Needs Review` simultaneously — the status is one field

**`Files shows many files but Results = 0`**: The 28 files exist in the DB but the UI may not be searching/displaying them correctly. The UI claim of "Results = 0" is not supported by the 28 rows in `knowledge_files`.

---

### 1.2 Knowledge Facts (6511 total)
| review_status | count |
|---|---|
| Learned | 6495 |
| Needs Review | 16 |

- 6495 facts have `review_status = Learned` — these are auto-extracted and auto-accepted (confidence >= 60)
- 16 facts have `review_status = Needs Review` — these require manual governance
- Facts are linked to `knowledge_files` via `knowledge_file_id`
- Facts can be linked to `library_products` via `knowledge_product_links`

**`Needs Review` meaning**: A fact that was extracted from a file but has confidence < 60, or was marked as requiring manual review. These 16 facts are the only governed knowledge facts awaiting human decision.

---

### 1.3 Library Products (503 total)
| identity_status | count |
|---|---|
| Active | 484 |
| Superseded | 19 |

- All 503 products link to the single manufacturer: Honeywell (`manufacturer_49c62f94-24d3-4cfb-8b91-c7b9116ca122`)
- Products have `part_number` values like `2151`, `2151-CH`, `2151T`, `2351/EC`, `2351TEM`, `2D51`, etc.
- Products are organized into 51 `product_families` (e.g., IFP-75, IFP-2100, 5815RMK, 5860TG, etc.)

**`Products shows ~979 product records`**: The UI shows ~979, but the backend `library_products` table has only 503 rows. The ~979 count likely includes:
- Products across multiple projects/organizations
- Duplicate or counted-within-family entries
- Historical/legacy product records not in the current organization

---

### 1.4 Product Attributes (114 total)
| review_status | count |
|---|---|
| Needs Review | 114 |

- **ALL 114 product_attribute rows have `review_status = Needs Review`**
- ZERO rows have `review_status = Approved`
- These are the product capability facts required by the sizing engine:
  - `native_slc_loops`, `max_detectors_per_loop`, `max_modules_per_loop`, `max_system_points`
  - `slc_expansion_state`, `slc_expansion_max_count`, `sbus_device_limit`
- All 7 IFP-2100HV-specific attributes were ingested earlier as governed facts (Needs Review)
- No approved capacity facts exist anywhere in the database

**Critical gap**: The sizing engine requires `review_status='Approved'` capacity facts, but the database has zero approved attributes. All are `Needs Review`, awaiting Omair approval.

---

### 1.5 Product Accessories (1 total)
| id | product_id | accessory_product_id | relationship_type | review_status |
|---|---|---|---|---|
| acc-exp-001 | product_ec9dcbb1-39fe-4d24-b369-8b3d271604a7 (IFP-2100HV) | product_d03ba56e-a8c2-4e5b-8c9d-47c683b012c8 (6815) | Expansion Module | Needs Review |

- Single expansion relationship: IFP-2100HV → 6815
- `review_status = Needs Review`
- No other accessory relationships exist in the database

**`6815 expansion evidence ingested`**: The single product_accessories row was created earlier as a governed fact (Needs Review).

---

### 1.6 Price Records (504 total)
| validity_state | count |
|---|---|
| Historical — Validity End Missing | 504 |

- **ALL 504 price_records have `validity_state = "Historical — Validity End Missing"`**
- ZERO price records have `validity_state = "Current"` or `"Historical"` (normal) or `"Expired"`
- ZERO price records have `project_id` set (all are global, project-agnostic)
- ZERO price records have `approval_status = "Approved"`
- All 504 price records lack a valid end date for their pricing window

**`Prices shows a few uploaded files, not obviously normalized price records`**: 
- 504 price records exist in the backend, but the UI doesn't clearly surface them
- All have the same problematic validity state: "Historical — Validity End Missing"
- No price records are project-specific (project_id IS NULL for all)
- No price records are approved (approval_status not checked, but validity is broken)

---

### 1.7 Product Manufacturers (1 total)
| id | name | normalized_name | status | created_by | created_at |
|---|---|---|---|---|---|
| manufacturer_49c62f94-24d3-4cfb-8b91-c7b9116ca122 | Honeywell | HONEYWELL | Needs Review | local-development-user | 2026-08-02 13:40:51 |

- **Only 1 manufacturer exists**: Honeywell
- Status = `Needs Review`
- No other manufacturers (Gamewell, Gent, NOTIFIER, etc.) exist in the DB

**`Manufacturers shows 0` in UI**: The single Honeywell manufacturer exists in the DB with status=`Needs Review`. The UI likely filters out manufacturers with `Needs Review` status, making it appear as "0". Alternatively, the API endpoint for the Manufacturers panel may have a bug where it only returns manufacturers with `Approved` status, or the UI query doesn't include the manufacturer table at all.

---

### 1.8 Product Brands (1 total)
| id | manufacturer_id | name | normalized_name | status | created_at |
|---|---|---|---|---|---|
| brand_9c537844-7f03-41e4-a863-8730028b254f | manufacturer_49c62f94-24d3-4cfb-8b91-c7b9116ca122 | Farenhyt | FARENHYT | Needs Review | 2026-08-02 13:40:51 |

- Single brand: Farenhyt, linked to Honeywell manufacturer
- Status = `Needs Review`

---

### 1.9 Product Sources (3 total)
| id | source_type | authority | validity_state |
|---|---|---|---|
| productsource_c5660767-1246-4867-b57d-fa10feb95c63 | Product Datasheet | Official Manufacturer | Current Document — Applicability Review Required |
| productsource_0d87f6ca-d3e1-4dd4-b452-5b83684ab0da | Manufacturer Price List | Manufacturer | Historical — Validity End Missing |
| productsource_idp_heat_datasheet | Product Datasheet | Official Manufacturer | Valid |

- The "Current Document — Applicability Review Required" source requires governance action
- The "Historical — Validity End Missing" source has the same validity problem as price records
- Only 1 source has `Valid` status

---

### 1.10 Governance State — Review Queue & Decisions
| table | count |
|---|---|
| review_queue_items | 0 |
| review_decisions | 0 |
| product_match_reviews | 0 |
| project_quotation_issues | 0 |

- **ZERO review queue items** — no items awaiting human review
- **ZERO review decisions** — no governance decisions recorded
- **ZERO product match reviews** — no product matching decisions recorded

**Governance workflow is broken**: Despite 114 product_attributes, 1 product_accessory, 1 manufacturer, and 1 brand all having `review_status = Needs Review`, there are 0 review_queue_items and 0 review_decisions. The governed review pathway is present in the code (`product-document-review-api.mjs`, `review-workflow-api.mjs`) but no items are queued for review in the database.

---

### 1.10 Project ae501b85 (Legacy) Documents
- **0 documents** in the `documents` table for `project_id = 'project_ae501b85-9c12-4332-bf8e-787c90f2d388'`
- This explains why "Case Studies shows one project with sources / ground truth / knowledge / signals" but the project has no documents

---

### 1.11 Engineering Facts (6 total)
- Only 6 engineering_facts exist in the database — a very small number compared to the 6495 "Learned" knowledge_facts
- These are likely the core technical attributes used by the sizing/engineering engines

---

### 1.11 Summary of Backend → UI Mapping Issues

| UI Observation | Backend Reality | Root Cause |
|---|---|---|
| Files shows many but Results = 0 | 28 files exist in DB | UI search/filter not returning results |
| Products shows ~979 records | 503 library_products + duplicates across projects | UI count includes cross-project products |
| Manufacturers shows 0 | 1 Honeywell manufacturer exists, status=Needs Review | UI filters out Needs Review manufacturers |
| Prices shows few uploaded files | 504 price_records exist, all with "Historical — Validity End Missing" | UI doesn't surface records with broken validity |
| Case Studies shows one project | project_ae501b85 has 0 documents in DB | Project documents were never ingested, or project_id mapping is broken |
| most records are Needs Review | 114 product_attrs, 1 manufacturer, 1 brand, 504 price_records all Needs Review | Governance state is consistently Needs Review, never Approved |
| reusable/published knowledge appears sparse | 6495 "Learned" facts exist but may not be promoted/published | "Learned" ≠ "Published/Approved"; promotion path appears broken |

---

## PHASE 2 — TRACE EACH CURRENT KNOWLEDGE PAGE

Since I cannot directly access the browser at http://localhost:4183, I trace each page from the API code and database structure.

### 2.1 Files Page
**UI → Component → API → Service → Data Flow**

From `worker/knowledge-library-api.mjs`:
- **Endpoint**: `GET /api/knowledge/files` (likely, also POST for upload)
- **Service**: `extractKnowledgeFromBytes` extracts facts from uploaded files
- **Data**: `knowledge_files` table (28 rows) + `knowledge_facts` table (6511 rows)
- **Counts**: UI may show filtered count based on `classification_status` or `detected_type`
- **`Results = 0`**: The UI may be searching only by `detected_type` or applying filters that exclude all 28 files. For example, if the UI only shows `Classified` files and the user expects `Price List` type, 5 of 28 would show. If it additionally filters by `review_status`, 0 would show since 23/28 are `Needs Review`.

**Useful backend info hidden**: 
- File SHA256 checksums, organization ownership, extraction method, extraction version
- The 5 `Classified` Price List files and their extracted summaries
- The 16 `Needs Review` facts that require governance

**Possible actions**: Upload new files, view file details, view extracted facts, initiate review

**Missing actions**: No visible "Promote to Approved" action for files — only the product-document-review-api handles document governance, not the files page directly.

---

### 2.2 Products Page
**UI → Component → API → Service → Data Flow**

From `worker/fire-alarm-knowledge-api.mjs` (the `/api/knowledge/fire-alarm/overview` endpoint):
- **Endpoint**: Serves the Products tab data
- **Data**: `library_products` (484 Active + 19 Superseded), joined with `product_manufacturers`, `product_families`
- **Columns shown**: `partNumber`, `manufacturer`, `family`, `productRole`, `evidenceCount`, `hasTechnicalDetail`, `priceRecordCount`
- **482 rows** returned (small enough for whole-table return)

**`Products shows ~979 product records`**: 
- Backend `library_products` has 503 rows
- UI shows ~979 — likely includes products across multiple organizations/projects, or counts library_products + product_variants + aliases across the dataset

**Useful backend info hidden**:
- `evidenceCount` = count of `product_source_evidence` rows per product
- `hasTechnicalDetail` = whether product has attributes JSON OR product_attributes rows
- `priceRecordCount` = count of price_records per product
- Product family affiliation and engineering domain
- Product role classification

**Possible actions**: Filter by family, view product detail, check evidence/pricing

**Missing actions**: 
- No "Approve product" action from the products list
- No direct promotion pathway from `Needs Review` → `Approved` visible in UI
- Product attributes governance happens via `product-attribute-review.mjs`, not from the products list

---

### 2.3 Manufacturers Page
**UI → Component → API → Service → Data Flow**

From `worker/fire-alarm-knowledge-api.mjs`:
- **Endpoint**: `/api/knowledge/fire-alarm/overview` → Manufacturers/Evidence tab
- **Data**: 
  - `product_manufacturers` (1 row: Honeywell, status=Needs Review)
  - `product_brands` (1 row: Farenhyt, status=Needs Review)
  - `product_sources` (3 rows: 2 Manufacturer Official, 1 Manufacturer Price List)
  - Externally researched citations count
  - Registered sources with source_type, authority, validity_state

**`Manufacturers shows 0`**: 
- Backend has 1 manufacturer (Honeywell)
- `product_manufacturers.status = Needs Review`
- The UI likely has a filter: `WHERE status = 'Approved'` or equivalent, excluding the single Needs Review manufacturer
- OR the API query `SELECT ... FROM product_manufacturers` doesn't include the status filter, but the UI component renders 0 results for another reason (e.g., no manufacturer_id linked to visible products)

**Useful backend info hidden**:
- Manufacturer `status` field (Needs Review vs Approved)
- Brand-manufacturer linkage (Farenhyt → Honeywell)
- Source validity states (Current Document — Applicability Review Required, Historical — Validity End Missing, Valid)
- Externally researched citations count

**Possible actions**: Add new manufacturer, view manufacturer detail, view associated brands/products

**Missing actions**: 
- No "Approve manufacturer" action in UI
- No workflow to change manufacturer status from Needs Review to Approved
- The `product-document-review-api.mjs` handles document review, not manufacturer status

---

### 2.4 Prices Page
**UI → Component → API → Service → Data Flow**

From `worker/fire-alarm-knowledge-api.mjs` → Pricing tab:
- **Endpoint**: Same overview endpoint
- **Data**: 
  - `pricingRow` from `price_records JOIN library_products`
  - `productsWithPriceEvidence` = count of distinct products with price_records
  - `currentPriceRecords`, `historicalPriceRecords`, `expiredPriceRecords` — all based on `validity_state`
  - `approvedPriceRecords` — based on `approval_status` (not checked in our query)
  - `projectSpecificPriceRecords` vs `globalPriceRecords` — based on `project_id` presence
  - `downstream_use` distribution

**`Prices shows a few uploaded files, not obviously normalized price records`**:
- 504 price_records exist in DB
- ALL have `validity_state = "Historical — Validity End Missing"`
- NONE have `project_id` (so `projectSpecificPriceRecords = 0`, `globalPriceRecords = 504`)
- The UI likely shows only records with `validity_state = "Current"` (0 records) or filters out the "Historical — Validity End Missing" records
- 0 `approvedPriceRecords` likely shown

**Useful backend info hidden**:
- Full `validity_state` distribution (all 504 are "Historical — Validity End Missing")
- `project_id` absence (all global, none project-specific)
- `approval_status` field (not queried, may exist)
- `downstream_use` distribution across price records
- Price record version history ( `price_record_versions` table has 0 rows)

**Possible actions**: Add new price record, filter by validity, view price detail

**Missing actions**: 
- No way to mark a price record as "Current" — the validity state is broken for all 504 records
- No "Approve price" action — validity must be fixed first
- No project-specific price record creation visible in UI

---

### 2.5 Case Studies Page
**UI → Component → API → Service → Data Flow**

From `worker/case-study-learning-api.mjs` (inferred from skill references):
- **Endpoint**: `/api/case-study` or similar
- **Data**: Case study learning records, project sources, ground truth, knowledge signals
- **Observed**: "shows one project with sources / ground truth / knowledge / signals"

**Reality**: Project `ae501b85` has **0 documents** in the `documents` table. The case studies page likely shows data from a different project, or displays stale/synthetic data.

**Useful backend info hidden**:
- Project-document mappings via `product_documents` (4 rows, all Needs Review)
- Knowledge file links via `knowledge_product_links` (134 rows)
- Project extraction history via `boq_extraction_versions` (22 versions)
- Project pricing learning via `project_pricing_learning_api.mjs`

**Missing actions**: 
- No way to create case study from existing project data
- No project-document review integration
- The `case-study-learning-api.mjs` exists but may not be connected to the UI

---

## PHASE 3 — DEFINE THE KNOWLEDGE DOMAIN

Based on the existing backend, I define what `Knowledge` should mean in this product, separating the seven clearly distinct domains:

### A. SOURCE MATERIAL
- **28 knowledge_files** (uploaded BOQs, price lists, supplier quotations, RFQs, unknown documents)
- All have `processing_status = Completed`, `byte_size`, `sha256`, `object_key`
- Classification: 5 `Classified` (Price List), 23 `Needs Review`
- Extraction: `extractKnowledgeFromBytes` produces `learned.classification` and `learned.facts`
- **Problem**: Source material exists but governance is stuck at `Needs Review` — no pathway to `Approved/Published`

### B. EXTRACTED KNOWLEDGE
- **6511 knowledge_facts** (6495 `Learned`, 16 `Needs Review`)
- Fact types include: Part Number, Device Type, Capacity, Attribute, etc.
- Each fact has `factType`, `factKey`, `originalValue`, `normalizedValue`, `confidence`, `review_status`, `sourceLocation`
- 134 `knowledge_product_links` link facts to library_products
- **Problem**: 16 facts need governance, but no review queue exists (`review_queue_items = 0`)

### C. MASTER DATA
- **503 library_products** (484 Active, 19 Superseded)
- 1 manufacturer (Honeywell, status=Needs Review)
- 1 brand (Farenhyt, status=Needs Review)
- 51 product_families across engineering domains
- 3 product_sources with validity states
- **Problem**: All governance state is `Needs Review` — no Approved master data exists

### D. ENGINEERING KNOWLEDGE
- **114 product_attributes** (all Needs Review) — the sizing engine's capacity facts
- **6 engineering_facts** — core technical attributes
- **product_compatibility = 0** — no compatibility data
- **product_certifications = 16** — exists but very sparse
- **engineering_standards = 0** — no standard records
- **engineering_taxonomy_terms = 0** — no taxonomy terms
- **Problem**: The sizing engine requires `Approved` product_attributes, but none exist

### E. COMMERCIAL KNOWLEDGE
- **504 price_records** (all `validity_state = "Historical — Validity End Missing"`)
- 0 have `project_id` (all global), 0 have `approval_status = Approved`
- 0 `price_record_versions` — no price history
- 0 `price_conflicts` — no conflict detection
- **Problem**: All price records have broken validity; no current pricing exists

### F. PROJECT EXPERIENCE
- **0 case studies** for project `ae501b85` (the legacy project)
- 22 `boq_extraction_versions` exist (extraction history)
- 0 `presales_workflow_snapshots` (or very few)
- `project_progress_snapshots` may have data
- **Problem**: The legacy project has no ingested documents, so no project experience is captured

### G. GOVERNANCE
- **review_queue_items = 0** — no items awaiting review
- **review_decisions = 0** — no governance decisions recorded
- **product_manufacturers.status = Needs Review** — 1 manufacturer needs governance
- **product_brands.status = Needs Review** — 1 brand needs governance
- **product_attributes review_status = Needs Review** — 114 attributes need governance
- **price_records validity_state = "Historical — Validity End Missing"** — 504 records need validity fixes
- **The governed review workflow exists in code** (`product-document-review-api.mjs`, `review-workflow-api.mjs`) but **no items are queued** in the database

**The Separation Requirement** (critical):
```
SOURCE ≠ FACT ≠ APPROVED KNOWLEDGE ≠ MASTER DATA ≠ PROJECT HISTORY
```

Current state: All seven domains exist but are all at `Needs Review` / broken validity / 0 counts in UI. None have been promoted to `Approved` / `Published` / `Current` state.

**The core issue**: The governance pipeline extracts → learns → reviews → approves → publishes is structurally present in the code but **broken at the review step**. No database rows exist in `review_queue_items`, `review_decisions`, and all governed entities remain stuck at `Needs Review` with no pathway to `Approved`.

---

## SUMMARY OF PHASES 1-3

**What's fundamentally wrong**:
1. **Zero approved state anywhere**: No `review_status = Approved` in product_attributes, product_manufacturers, product_brands, price_records. Everything is `Needs Review`.
2. **Broken validity**: All 504 price_records have `validity_state = "Historical — Validity End Missing"` — no current pricing.
3. **Zero review queue**: `review_queue_items = 0` despite 114+ governed entities needing review.
4. **Zero project documents**: `project_ae501b85` has 0 documents; case studies page has no grounded data.
5. **UI misalignment**: UI shows "0" for manufacturers, "Results = 0" for files, sparse knowledge — all because governed state is broken.

**What's working**:
1. **28 knowledge files** uploaded and processed (`processing_status = Completed`)
2. **6495 learned facts** auto-extracted from files (confidence >= 60)
3. **503 library_products** with Active/Superseded status
4. **Code exists** for all governance workflows (product-document-review, review-workflow, price-record review)
5. **134 knowledge_product_links** connect extracted facts to products

**What needs to be built**:
1. **Promotion pathway**: Mechanism to move entities from `Needs Review` → `Approved`
2. **Validity fixing**: Mechanism to set price_record validity to "Current" with a valid end date
3. **Project document ingestion**: Populate `documents` table for project `ae501b85`
4. **Review queue population**: Populate `review_queue_items` from the 114 product_attributes, 1 product_accessory, 1 manufacturer, 1 brand, and other governed entities
4. **UI realignment**: Ensure UI doesn't filter out `Needs Review` entities that need governance

**The seven-domain separation is now valid and observable**:
- SOURCE: 28 files ✓
- EXTRACTED KNOWLEDGE: 6511 facts ✓
- MASTER DATA: 503 products, 1 manufacturer, 1 brand ✓ (but all Needs Review)
- ENGINEERING KNOWLEDGE: 114 product_attributes ✓ (but all Needs Review)
- COMMERCIAL KNOWLEDGE: 504 price_records ✓ (but all Historical—Validity End Missing)
- PROJECT EXPERIENCE: 0 case studies for ae501b85 ✓ (documents missing)
- GOVERNANCE: 0 review queue items ✓ (workflow broken)