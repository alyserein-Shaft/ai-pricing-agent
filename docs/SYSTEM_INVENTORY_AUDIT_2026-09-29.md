# System Inventory Audit — AI Pricing Agent

**Date:** 2026-09-29 · **Mode:** read-only · **Live DB:** `.wrangler/.../faaf2b04….sqlite` (463 MB, opened `{ readOnly: true }`, SHA-256 `2e432933…cec7`, unchanged before/after)

Labels used throughout: **VERIFIED FROM CODE** · **VERIFIED FROM TEST** · **VERIFIED FROM DATABASE** · **PARTIAL** · **NOT FOUND** · **CANNOT VERIFY**.

> **Correction to one delegated finding.** A sub-audit reported the live D1 snapshot was "ABSENT from this checkout" and that both golden gates would therefore fail closed. **That is wrong** — `fire-alarm-golden-evaluation-gate.mjs:41` points at exactly the file that exists (463 MB, 28 Sep). Verified directly. The underlying *pattern* observation stands: the gates fail closed if the snapshot is missing.

---

## 1. Executive Summary

**What this is.** A large, deeply-governed pre-sales engineering system: **315 tables**, **62 dispatched API modules**, **~180 domain modules**, **435 test files**, and a mature evidence/provenance discipline that is genuinely unusual — currency predicates, version chains, review decisions, audit events, and fail-closed gates are pervasive rather than bolted on.

**The decisive finding.** The pipeline is not blocked by missing capability. **It is blocked by a strict 8-gate AND-chain in `app/domain/presales-workflow-engine.mjs:37` that requires ~100% coverage of active BOQ items through every stage.** Running the real engine against the real Fire Alarm Golden project:

```
status            : In Progress        progress: 40%
readyForQuotation : false              currentStage: Requirement intelligence and classification
blockers:
  - requirementsReady  39 requirement profile(s) are not approved for matching.
  - selection           90 safety block(s) remain open.
  - supplier           108 BOQ item(s) lack eligible current prices.
  - quotation           Technical and commercial readiness gates must pass.
```

**The three binding facts:**

| # | Fact | Evidence |
|---|---|---|
| 1 | **0 of 39** requirement profiles are approved for matching. 108 items exist; **69 have no profile at all**. Sampled blocker: *"compatibilityTarget is required to define a safe Fire Alarm product search boundary"* + *"0 requirement sources are confirmed applicable"* | VERIFIED FROM DATABASE |
| 2 | **All 102** current safety decisions are blocked: 91 `Blocked` + 10 `Technical Approval Disabled`; **all 102** are `Price Approval Disabled`. **Zero** approved. | VERIFIED FROM DATABASE |
| 3 | **1 of 518** `price_records` is `Approved` + `Costing` + current. `suppliers` = 0, `supplier_quotes` = 0, `supplier_quote_lines` = 0. All 3 `pricing_runs` are `Pricing Blocked` — *"no supplier quote yet available."* | VERIFIED FROM DATABASE |

**So:** the quotation *machinery* is complete and heavily tested — BOQ → price → cost → selling price → approval → quotation line → XLSX is a working, fail-closed chain. What is missing is **evidence**: commercial price evidence, engineering approval, and product identity for the Fire Alarm catalogue. **This is a data-and-approval problem, not a code problem.**

---

## 2. Current Architecture

Single Cloudflare Worker (`worker/index.ts`, 297 lines) dispatching 62 `handle*Api` modules in order, each returning `null` when its route prefix does not match. Domain logic lives in `app/domain/*.mjs` as pure functions; persistence is D1 (SQLite) via a thin `env.DB.prepare().bind().run()/first()/all()/batch()` shim; R2 (`env.FILES`) holds document bytes; `env.AI` provides vision/LLM.

Three layers are cleanly separated and consistently respected:
- **Extraction** (documents → rows + evidence rows)
- **Governance** (version chains, review decisions, currency predicates, safety/approval)
- **Commercial** (pricing → costing → quotation → export)

---

## 3. Repository Inventory

| Area | Count | Notes |
|---|---:|---|
| `app/` | 212 files | UI + 18 fire-alarm domain modules, ~180 total |
| `worker/` | 108 files | 62 dispatched API modules |
| `tests/` | 435 `.test.mjs` + 4 subdirs | 33 `REAL_STATE`, 3 `SPAWNS_PROCESS` |
| `scripts/` | 161 | harnesses, golden gates, fixtures |
| `drizzle-active/` | 39 migrations | applied chain |
| `drizzle/` | 104 | full history |
| `docs/` | 83 | + ~50 root-level `*.md` reports |
| Live D1 | 463 MB, 315 tables | 23 projects |

**Maturity (representative, not exhaustive):**

| Module | Maturity | Evidence |
|---|---|---|
| `fire-alarm-*.mjs` (18) | **IMPLEMENTED** | 6C3A 67 tests, 6C3A1 27, 6C3B 21, all real-schema |
| `pricing-engine.mjs` | **IMPLEMENTED** | ~19 direct engine tests + ~10 API/authority suites |
| `presales-workflow-engine.mjs` | **IMPLEMENTED** | the 8-gate chain; unit-tested |
| Drawing intake/structure/symbol modules | **IMPLEMENTED** | 48 drawing test files (6 excluded as `REAL_STATE`) |
| `engineering_discovery_*` (7 tables) | **UNUSED** | 0 rows across all 7 |
| `knowledge_promotions` | **UNUSED** | 0 rows |
| `pricing_shared_costs` / `pricing_cost_allocations` | **UNUSED** | schema only; `docs/pricing-shared-costs-status.md` confirms |
| `pricing_exceptions`, `discount_rules` | **UNUSED** | no writer, no reader |
| `product_identity_promotions` | **UNUSED** | 0 rows — promotion has never succeeded |
| `fire_alarm_panel_sizing_snapshots` | **UNUSED** | 0 rows |
| `project_quotation_*` (5 tables) | **IMPLEMENTED but never run** | full writer exists; 0 rows |
| `compareEvidenceForConflict` (drawing) | **DEAD** | exported, **no production caller**; test-only |
| `governedPrintedQuantityRows` | **HARD REFUSAL** | `return []` by design — drawing quantity is non-functional *on purpose* |
| `engineering-standards`, `standards_bodies`, `engineering_attribute_definitions`, `engineering_unit_definitions` | **UNUSED** | 0 rows |

---

## 4. End-to-End Pipeline

`app/domain/presales-workflow-engine.mjs:37` is the spine. Every stage below is **AND-chained to 100% of `activeItems`** (`activeBoqItems`, 108 for the Fire Alarm project):

```
docsReady        = documents>0 && resolved==documents && !processing && !failedJobs
boqReady         = boqItems>0 && !extractionReview && !possibleDuplicates
specReady        = specificationExtractions>0
requirementsReady= boqReady && !noApplicableScope && requirementProfiles>=activeItems && !requirementReview
matchesReady     = requirementsReady && matchedItems>=activeItems && !openSafetyBlocks
technicalReady   = matchesReady && technicalApproved>=activeItems && !technicalPending && !blockingClarifications
pricingReady     = technicalReady && pricedItems>=activeItems && !missingPrices
commercialReady  = pricingReady && commercialApproved>=activeItems && !commercialPending && !blockingClarifications
finalReviewReady = commercialReady && finalReviewApproved>=activeItems && !finalReviewPending
quotationReady   = finalReviewReady && !noApplicableScope && !openSafetyBlocks && !failedJobs
```

| # | Stage | Status | Key file / function | Live evidence |
|---:|---|---|---|---|
| 1 | Project creation | **WORKING** | `worker/organization-api.mjs`, `projects` | 23 projects |
| 2 | Document ingestion | **WORKING** | `worker/document-api.mjs:740` → R2 | 266 docs / 266 versions |
| 3 | BOQ ingestion | **WORKING** | `app/domain/boq-extractor.mjs` | 5,404 items, 16,189 evidence rows |
| 4 | Specification ingestion | **WORKING** | `app/domain/specification-extractor.mjs` (native PDF/DOCX) | 23,622 clauses, 68,445 chunk entities |
| 5 | Drawing ingestion | **WORKING (PDF only)** | `app/domain/drawing-intake-engine.mjs:154` | 8,734 assets; **no CAD parser** |
| 6 | Drawing classification | **WORKING** | `drawing-intake-engine.mjs:10`, `drawing-type-classifier.mjs:24` | 111 classified, 6 types |
| 7 | Drawing extraction | **WORKING WITH LIMITATIONS** | 8,734 `drawing_structure_cells`; text-only connectivity | see §6 |
| 8 | Clause extraction | **WORKING** | `specification-extractor.mjs` | 19,893 requirements, 19,893 evidence rows |
| 9 | BOQ item extraction | **WORKING** | `boq-extractor.mjs` | 5,404 items |
| 10 | Device classification | **WORKING WITH LIMITATIONS** | `fire-alarm-taxonomy.mjs`, `fire-alarm-family-taxonomy.mjs` | 34/90 FA families resolved |
| 11 | Cross-document reconciliation | **PARTIAL** | `identity-resolution-engine.mjs` | 1 run, 27 proposals |
| 12 | Drawing→BOQ linking | **PARTIAL** | `drawing-quantity-evidence-engine.mjs:124 resolveGovernedLink` | **0** `boq_items.drawing_reference` populated |
| 13 | Spec→BOQ linking | **WORKING WITH LIMITATIONS** | `boq_requirement_links` | 104 links / 40 items; **4 Confirmed**, 92 Suggested |
| 14 | Device family resolution | **WORKING WITH LIMITATIONS** | `fire-alarm-device-evidence-resolver.mjs` | 34/90 |
| 15 | Equipment identity resolution | **WORKING** | `identity-resolution-engine.mjs` | 1,881 identities, 5,853 observations |
| 16 | Quantity reconciliation | **WORKING** | `boq_quantity_source_decisions` | **2** rows — 106 items unresolved |
| 17 | Technical compliance | **WORKING** | `fire-alarm-compliance-evidence-policy.mjs` | 3,003 `requirement_standards` |
| 18 | Address/SLC calculation | **PARTIAL** | `fire-alarm-slc-resource-classifier.mjs` | 24 roles established, **0 points** |
| 19 | Panel/loop sizing | **WORKING, BLOCKED** | `fire-alarm-panel-slc-sizing.mjs` | 0 snapshots; needs a pool state |
| 20 | Accessory/BOM completion | **WORKING** | `bom-component-model.mjs` | 211 `product_accessories` |
| 21 | Manufacturer/model selection | **PARTIAL** | `product_matching*` | **0** FA BOQ items carry manufacturer/part_number |
| 22 | Cost lookup | **WORKING, BLOCKED** | `pricing-engine.mjs` | 1/518 costing-eligible |
| 23 | Supplier quotation handling | **IMPLEMENTED, NO DATA** | `supplier-price-intake-api.mjs` | **0 suppliers, 0 quotes** |
| 24 | Labour/installation costing | **PARTIAL** | generic cost component only | no rate library |
| 25 | Markup/margin | **IMPLEMENTED** | `pricing-engine.mjs:158 sellingPrice` | default **0%** — see §12 |
| 26 | Approval workflow | **WORKING** | `review-workflow`, `presales-workflow-api` | 326 `review_queue_items`, 326 `review_audit_log` |
| 27 | Quote generation | **IMPLEMENTED, NEVER RUN** | `presales-workflow-api.mjs:52` | 0 revisions |
| 28 | Revision management | **IMPLEMENTED** | `revision_number`, `quotation_fingerprint`, `superseded_at` | 0 rows |
| 29 | Audit trail | **WORKING** | `document_audit_events` 2,122; `product_library_decisions` 56 | |
| 30 | Final export | **WORKING (XLSX only)** | `worker/xlsx-cost-sheet.mjs` (hand-built OOXML + `fflate`) | 0 jobs |

---

## 5. Database / Data Models

**315 tables.** Notable structure:

| Group | Tables | Notes |
|---|---:|---|
| Documents | `documents`, `document_versions`, `document_classifications`, `document_processing_runs`, `document_audit_events`, `document_supersessions` (0) | full revision + classification + audit |
| BOQ | `boq_items` (49 cols), `boq_sections` (**0**), `boq_extraction_*`, `boq_requirement_links`, `boq_review_decisions` | |
| Specification | `specification_clauses`, `specification_sections`, `specification_chunk_entities`, `specification_extraction_versions/jobs/pages/checkpoints` | deep extraction chain |
| Requirements | `technical_requirements` (19,893), `requirement_evidence` (19,893), `requirement_profile_versions` (575), `requirement_review_decisions` (148) | 1:1 evidence coverage |
| Drawing | **56 tables** | intake, structure, symbols, legends, architecture review |
| Product | `library_products` (951), `product_identities` (1,881), `product_families` (44), `product_manufacturers` (17), **`product_brands` (1)** | |
| Commercial | `price_records` (518), `pricing_*` (25 tables), `suppliers` (0), `supplier_quotes` (0), `project_quotation_*` (0) | |
| Governance | `review_queue_items`, `safety_decisions`, `safety_blocks` (456), `*_audit_events` | |

**Orphaned / never-written:** `engineering_discovery_*` (7), `engineering_standards`, `engineering_graph_*` (3), `knowledge_promotions`, `product_aliases`, `product_variants`, `product_versions`, `product_packages`, `regional_part_numbers`, `review_*` (9 tables, 6 at 0 rows), `safety_overrides`, `boq_sections`, `document_supersessions`, `standards_bodies`, `supplier_branches/contacts/products`, `excel_export_*` (all 0).

**⚠ Two competing product tables.** `library_products` (951) and `canonical_library_products` are both live. The **quotation** path reads `library_products` (`quotation-line-authority.mjs:266`); matching/pricing/costing read `canonical_library_products`. A product present only in the canonical table produces `PRODUCT_SNAPSHOT_REQUIRED` and **permanently blocks the quotation**. Reachable defect.

---

## 6. Drawing Intelligence

Two verified vocabularies (**VERIFIED FROM CODE**):

```
DRAWING_CLASSIFICATIONS (intake, drawing-intake-engine.mjs:10)
  Floor Plan · Riser Diagram · Single Line Diagram (SLD) · Wiring Diagram · Device Layout
  Legend Sheet · Installation Detail · Typical Detail · Sequence of Operation
  Notes Sheet · Schedule · Mixed Drawing · Unknown

DRAWING_TYPE_BUCKETS (intelligence, drawing-type-classifier.mjs:24)
  Layout · Riser Diagram · Schematic / Single-Line · Legend / Notes
  Cause & Effect · Detail / Enlarged Detail · Schedule · Unknown / Mixed
```

| Capability | State | Evidence |
|---|---|---|
| Title block | **WORKING** | 11 fields incl. `drawingNumber`, `revision`, `scale` (`drawing-structural-parser.mjs:237`) |
| Sheet title/number | **WORKING / PARTIAL** | `resolveDrawingTitle`; no separate `sheetNumber` field despite being listed as required |
| Device symbols | **WORKING (vector)** | `recognizeDrawingSymbols` reads PDF `constructPath`; 4,054 occurrences, 116 definitions |
| Device tags | **WORKING** | `/^([A-Z]{2,6})[-\s]?(\d{1,3})$/` (`drawing-layout-intelligence.mjs:22`) |
| Legends | **WORKING** | 19 legends, 56 entries, 26 approved geometry links |
| General notes | **WORKING** | `NUMBERED_NOTE` regex + bare-number pass |
| Cross-sheet refs | **WORKING (edges only)** | `drawing-cross-sheet-references.mjs:148`; no rule propagation |
| Riser connectivity | **PARTIAL — text only** | `TO <X>` regex. **No vector/line pipeline** (declared in 3 module headers) |
| Schematic connectivity | **PARTIAL** | `INTERFACE TO <system>`; always `Needs Review` |
| Panel relationships | **WORKING** | 386 approved rows; `MFACP` campus-wide rules, "only MFACP may take LOCATED_AT" |
| Device placement | **WORKING** | bounding boxes + coordinate mapper |
| Cause & Effect | **PARTIAL** | matrix headers + verbs; **grid cells with no text are invisible** |
| Details / Schedules | **WORKING** | |
| Panel I/O | **NOT FOUND** | `FIELD_AUTHORITY_TABLE.PanelIO` exists, no producer |
| Floor/zone, mounting, compatibility hints, notes→requirements | **NOT FOUND** | self-declared `wired: false` in `drawing-requirement-evidence-engine.mjs:36-39` |

**Cross-sheet applicability (§9): references only, never rule inheritance.** `applicabilityStatus` starts `"Scoped to current sheet"` and only widens when the note *names a system*. Legends are `system ? [system,"same sheet"] : ["same sheet"]`. Asserted negatively by `drawing-cross-sheet-references.test.mjs:16`. **No implicit whole-sheet inheritance found.**

**Drawing→BOQ: no FK exists.** `boq_items.drawing_reference` is a text column populated from the BOQ's own text, **never joined to any drawing table**; 0/108 populated. The real link is `resolveGovernedLink` requiring an **APPROVED** understanding-review row + system + family match. `drawing-requirement-impact-api.mjs:8-11` states it "writes nothing."

**Discrepancy detection: PARTIAL.** Implemented: cross-sheet unresolved reference, ambiguous panel assignment, cross-sheet panel-location conflict, drawing-count vs BOQ quantity, BOQ vs drawing family conflict, intra-document field disagreement. **NOT FOUND:** device-count comparison across Layout vs Riser vs Schedule. The generic `compareEvidenceForConflict` is **dead code** — exported, no production caller.

---

## 7. Specification Intelligence

Fully implemented. `technical_requirements` 19,893 rows, each with a 1:1 `requirement_evidence` row (19,893). Clause path, page refs, `originalClauseText`, conditions/exceptions, extraction versions, and a governed review workflow (`requirement_review_decisions`, 148 rows) all present. Supersession is authoritative, not filename-based (`worker/current-evidence-scope.mjs`).

**Live governance state (current extraction, Fire Alarm project):** 1 `Approved`/afd=1, 488 `Needs Review`, 24 `Pending Approval`. The single approved clause is a product-compliance feature list, not an addressability obligation.

**Clause comparison and carry-forward:** `app/domain/fire-alarm-addressability-clause-evidence.mjs` provides field-by-field semantic comparison (21 tests). **No approval-inheritance mechanism exists and none is needed** — re-evaluation of the current row is the canonical path.

---

## 8. BOQ Intelligence

**Preservation (Fire Alarm project, 108 items):**

| Field | Populated |
|---|---|
| `item_number` | 108/108 |
| `description` | 108/108 |
| `original_raw_values` / `current_values` / `source_location` | 108/108 |
| `original_unit` / `original_quantity` / `numeric_quantity` | 90/108 |
| `system_value` | 98/108 |
| **`manufacturer`** | **0/108** |
| **`part_number`** | **0/108** |
| **`drawing_reference`** | **0/108** |
| `subcategory` | 1/108 |

**States (exact values):** `boq_items.review_status` ∈ `Needs Review` (4,795) · `Approved` (304) · `Auto Verified` (293) · `Merged` (8) · `Classified` (4).
`boq_extraction_versions.status` ∈ `Completed` (3) · `Failed` (7) · `Needs Review` (50).
`boq_requirement_links.status` ∈ `Suggested` (92) · `Needs Review` (8) · `Confirmed` (4).

**⚠ 96% of spec→BOQ links are unconfirmed**, which is the direct cause of *"0 requirement sources are confirmed applicable"* in the profile blockers.

---

## 9. Device / Equipment Intelligence

**Two taxonomies, both real:**

1. `product_families` (44 rows) + `engineering_domain` — the canonical commercial taxonomy. **VERIFIED FROM DATABASE**
2. `app/domain/fire-alarm-taxonomy.mjs` — category → family lists. **VERIFIED FROM CODE**
3. `engineering_taxonomy_terms` (38 rows) — PROTOCOL / CIRCUIT_BUS / TOPOLOGY / **PANEL_ROLE** / GUARD_STANDARD / GUARD_VENDOR / AMBIGUOUS, with `synonyms`. **VERIFIED FROM DATABASE**

**FACP vs MFACP are correctly distinguished** (VERIFIED FROM DATABASE + CODE):
```
compat-term-facp   PANEL_ROLE  FACP   synonyms: ["Fire Alarm Control Panel","F.A.C.P."]
compat-term-mfacp  PANEL_ROLE  MFACP  synonyms: ["Main Fire Alarm Control Panel","Main FACP"]
```
Plus `drawing-architecture-intelligence.mjs:109-115` maps `(MFACP)`, `campus-wide FIRE ALARM CONTROL PANEL` → `MFACP`, and **"Only MFACP may take a LOCATED_AT assignment"** (`:448`).

**Alias framework exists** at the *term* level (`synonyms`) but **NOT** for product brands: `product_brands` has **no alias table**, and `product_aliases` / `product_identity_aliases` are both 0 rows.

**Identity layers are genuinely separate** (VERIFIED FROM CODE, `identity-resolution-engine.mjs`): textual alias → observation; device family → taxonomy; physical equipment → identity key; SKU → `library_products`. `identity-resolution-engine.mjs:160` refuses cross-scope merging (`IDENTITY_SCOPE_CONFLICT`).

**Live gap:** `product_brands` has **1 row** (Honeywell/Farenhyt). Gamewell-FCI and Gent are absent, and `promoteProductIdentity` never writes `brand_id` — every promoted product would land with `brand = NULL`. **VERIFIED FROM CODE + TEST.**

---

## 10. SLC & Panel Intelligence

**VERIFIED FROM DATABASE — the decisive schema fact: there is no SLC-consumption column anywhere in 315 tables.** A scan for `units_per_device | points_per_device | address_count | channel_count | slc_address` across every table returned **zero matches**.

The `1 device = 1 address` assumption exists in exactly two hardcoded places, both in `app/domain/fire-alarm-slc-resource-classifier.mjs:215,221`:
```js
unitsPerDevice: 1, demandUnits: resolveSlcDemandQuantity(quantity, 1).total
```
It is **family-based** (not manufacturer-, model- or protocol-based) and has **test authority only** — no data authority.

**Separation that does exist:** physical quantity (`boq_items.numeric_quantity`) · quantity decision (`boq_quantity_source_decisions`, **2 rows**) · SLC role (`slcRole`) · point demand (`pricing`-independent). **Not modelled separately:** input points vs output points vs loop load as distinct quantities.

**Panel sizing is implemented and wired** (`POST /api/projects/:id/fire-alarm/panel-sizing`, writer at `:604`, engine `fire-alarm-panel-sizing-snapshot-1.1.0`) but requires `SLC_DETECTOR_POOL`/`SLC_MODULE_POOL` (`:141`) — so it **fails closed for every Fire Alarm population today**, hence 0 snapshots.

---

## 11. Governance & Approval

This is the system's strongest area. 20+ review/approval mechanisms, all with audit rows.

| Mechanism | Implementation |
|---|---|
| `safety_decisions` (102) | `safety_state` ∈ `Missing Critical Information` (82) · `Discovery Only` (10) · `Blocked` (10); `technical_eligibility` ∈ `Blocked` (91) · `Technical Approval Disabled` (10) — **zero approved** |
| `safety_blocks` (456) | `overridable` flag; `safety_overrides` = 0 |
| Requirement review | `requirement_review_decisions` (148); project-ownership authorization, CAS-guarded |
| BOQ review | `boq_review_decisions` (793) |
| Product library | `product_library_decisions` (56); `Library Manager`/`Administrator` |
| Price approval | `pricing_approvals` (0) |
| Quotation approval | role-gated + fingerprint-staleness guarded |
| Auto-confirm | `spec-requirement-auto-confirm.mjs` (12 gates) — **re-evaluation, never inheritance** |

**Confidence thresholds:** `spec-requirement-auto-confirm` 12 gates; price-conflict tolerance 2%; point threshold 2,000 (`fire-alarm-ecosystem-policy.mjs:57`, explicitly "internal, never a certified maximum").

**Overrides are audited** where they exist; the E2E spec exercises a *governed engineer-exception override*.

**Do approvals survive re-extraction?** **No, by design.** Currency predicates (`currentTechnicalRequirementsFrom`, `CURRENT_PRICING_PREDICATE`, `CURRENT_PRICING_LINE`) exclude superseded rows, and `pricing-input-authority.test.mjs` explicitly asserts superseded extraction/match-run/scenario/run are all rejected. **This is correct but is exactly why the Fire Alarm project is blocked** — a re-extraction reset 488 requirements to `Needs Review`.

---

## 12. Pricing

**The engine is real and complete** (`app/domain/pricing-engine.mjs`, `pricing-engine-1.1.0`, ruleset `pricing-rules-2026-08-02`):

```js
// pricing-engine.mjs:158 sellingPrice
"Target Margin": gross = cost / (1 - rate/100)   // throws INVALID_MARGIN if rate >= 100
"Markup":        gross = cost * (1 + rate/100)
margin = profit/gross*100   // margin on SELLING price
markup = profit/cost*100    // markup on COST
MINIMUM_MARGIN_BREACH if (margin < minimumMargin || margin < 0) && !authorizedException
```

| Concept | State |
|---|---|
| material / unit cost, accessories costing, VAT, markup, margin, discount, selling price | **IMPLEMENTED** |
| currency | **IMPLEMENTED** — USD/SAR only |
| exchange rate | **PARTIAL / INERT** — `pricing_exchange_rates` is fully governed (POST route, versioning, `loadApprovedExchangeRateRow`, `CONFIRM_EXCHANGE_RATE`) but `convertCurrency` **ignores its `exchangeRate` argument** and `loadPricingInput` sets `exchangeRate: null`. **Every conversion is the hardcoded `FIXED_USD_TO_SAR_RATE = 3.75`.** |
| multiple supplier quotes | **PARTIAL** — `MULTIPLE_PRICE_EVIDENCE`/`PRICE_CONFLICT` detected, `price_conflicts` table exists, but **no comparison surface**, and the `reliability` tie-breaker is always 0 (no writer emits that key) |
| freight / labour / testing / engineering / warranty / overhead / contingency | **PARTIAL** — user-entered cost components only; **no rate library, no productivity norms** |

**Can a BOQ item reach a reliable selling price?** **The code path is complete; the inputs are absent.** Two governed writers can make a price costing-eligible (supplier-quote approval; price-record review) and **neither has ever been used**: 1 of 518 records qualifies, 0 suppliers exist.

**⚠ Effective commercial default is 0%.** `ensureDefaultScenario` stores `settings='{}'`, and the only UI that sets `sellingRule` is a one-shot scenario-creation dialog. **There is no editor for markup, margin, discount or VAT on an existing scenario.** A project that skips that dialog prices and approves at zero margin with zero VAT.

---

## 13. Quotation Generation

**The lifecycle is fully implemented** in `worker/presales-workflow-api.mjs`:

```
POST /api/projects/:id/presales-workflow/quotation/draft    (:52)
POST …/quotation/approve                                     (:266)  role-gated + fingerprint-staleness
POST …/quotation/issue                                       (:267)  requires a governed export bound to this quotation
GET  /api/projects/:id/quotations/{revisionId}                (quotation-api.mjs — read-only presenter)
```

Draft requires `readyForQuotation`, then `loadCanonicalQuotationLines` per item, then exact `lineCount`/`subtotalMinor` reconciliation, then a SHA-256 `quotation_fingerprint`. `project_quotation_lines` is **DB-immutable** via triggers. `buildClientQuotationModel` deliberately strips cost/margin/supplier/authority.

**Quotation-line trace — PRODUCT path COMPLETES (18 hops, all verified):**
BOQ item → `currentBoqEvidenceFrom` → `currentSelectedQuantity` → match candidate → safety decision → technical approval → price evidence → `priceEligibility` gate → `buildLineCostModel` (Full-BOM) → `selectPriceSources` → `convertCurrency` → `applyDiscounts` → `calculatePricingLine` → `calculateCommercialPricing` → `persistRun` (locks `authoritativeCost`) → commercial approval → `loadCanonicalQuotationLines` → totals reconciliation → draft/approve/issue.

**The trace BREAKS in two places:**

1. **SCOPE (engineering-expansion) path.** `loadScopePricingInput`, `resolveScopePricingRequirements`, `buildScopeAuthoritativeCost` (`worker/scope-pricing-input.mjs`) are called **only from tests**. No production route creates a SCOPE pricing line, and `quotation-line-authority.mjs` only iterates BOQ items. The read side is live; the write side does not exist.
2. **Everywhere, in practice**, because no item reaches the first hop's gate.

**Export:** XLSX only — hand-built OOXML zipped with `fflate`, routed via `excel_export_jobs` → R2 → download. **PDF and DOCX generation: NOT FOUND** (`pdfjs-dist` is a *reader*; `docx` is an accepted *upload* type). **No `quote_number` column** — only `project_quotation_issues.issue_reference`, defaulted to `Q-{projectId}-R{revision}`. **No quotation document template**; prose exists only as a non-authoritative AI advisory (13 sections).

---

## 14. Tests & Golden Sets

**435 `.test.mjs` files**, run with **`node --test`** (no vitest/jest). Runner is `npm test` = build + **33 explicitly-listed files (7.6%)**; `npm run test:all` = `scripts/authoritative-test-inventory.mjs --run --verify-drift` over 399 safe files.

**The drift gate is membership-only** — it stores no expected test *count* and no pass/fail expectation, and scans non-recursively, so a new `.test.mjs` in `tests/e2e/` would not appear at all. **VERIFIED FROM CODE.**

**Fixtures — three strategies:** (a) hand-written `CREATE TABLE` + `:memory:` (most common; the repo itself notes these "silently drifted"); (b) **real migration chain replayed** via `tests/fixtures/active-chain-fixture.mjs` (~25+ suites — the higher-fidelity pattern); (c) real project data — 10 files hardcode the absolute `.wrangler` path, all `REAL_STATE`-excluded.

**Golden sets:** 18 `golden-*.test.mjs` (GOLDEN-2 → 7A3M); `tests/drawing-golden-set.test.mjs` against 4 real Al Mousa sheets; `tests/golden/*.fixture.mjs` (Central Kitchen FA + CCTV, Opera Block issued quotation, 4 sheet fixtures); 2 Playwright specs (`@golden-smoke`, `@golden-full` — the latter is a 575-line full governed journey including `QUOTATION_READINESS_BLOCKED` 409 assertions and a real XLSX download).

**Skips: only 2 test cases** repo-wide (`FUTURE-RBAC`, empty bodies). The 11 skips in `identity-resolution-governance.test.mjs` are from a concurrent lane, reason-stated.

**Untested / under-tested:**
| Capability | State |
|---|---|
| PDF / Word quotation export | **NOT FOUND** — no capability, so no test |
| Supplier-quote side-by-side comparison | **NOT COVERED** — no such test |
| Drawing→BOQ-item linking | **NOT COVERED** — and by design no persisted link exists |
| Riser connectivity | **1 file, and it is `REAL_STATE`-excluded** |
| Cause & Effect | **2 files, primary one `REAL_STATE`-excluded** |
| Layout vs Riser vs Schedule count reconciliation | **NOT COVERED** — no capability |

**⚠ 6 key drawing suites are `REAL_STATE`-excluded** from the safe run, including the *entire* architecture-fact suite and the type-classifier suite — because the detector regex matches the *string* `"Al Mousa"` in a comment. A pure-domain file is silently excluded. **Real coverage regression risk.**

---

## 15. Capability Matrix

| Capability | Exists | Works E2E | Tested | Prod Ready | Evidence | Main Gap |
|---|---|---|---|---|---|---|
| Document Intake | YES | YES | YES | PARTIAL | 266 docs; 58 Classified / 119 Manually Confirmed / 72 Unknown | 72 docs unclassified |
| BOQ Extraction | YES | YES | YES | YES | 5,404 items, 16,189 evidence | 18/108 missing unit+qty |
| Specification Extraction | YES | YES | YES | YES | 23,622 clauses, 19,893 requirements | 488/513 unreviewed |
| Drawing Intake | YES | YES | YES | PARTIAL | PDF only, 8,734 assets | **no CAD (DWG/DXF)** |
| Drawing Classification | YES | YES | YES | YES | 2 vocabularies, 111 classified | fixed confidences (68/78/90) |
| Legend Intelligence | YES | PARTIAL | YES | PARTIAL | 19 legends, 26 approved links | 0/90 populations have sheet scope |
| Riser Intelligence | PARTIAL | NO | 1 file, excluded | NO | text-only `TO <X>` regex | **no vector connectivity** |
| Schematic Intelligence | PARTIAL | NO | thin | NO | `INTERFACE TO` regex | always `Needs Review` |
| Layout Intelligence | YES | PARTIAL | YES | PARTIAL | 4,054 occurrences, device tags | never produces connectivity (by design) |
| Cause & Effect Intelligence | PARTIAL | NO | 2 files | NO | matrix headers + verbs | **grid cells invisible** |
| Detail Intelligence | YES | PARTIAL | YES | PARTIAL | `drawing-detail-intelligence` | — |
| Cross-Sheet References | YES | YES | YES | YES | edges + scoped applicability | edges only, no inheritance |
| Drawing Discrepancy Detection | PARTIAL | PARTIAL | synthetic only | NO | 6 mechanisms | `compareEvidenceForConflict` dead; no Layout/Riser/Schedule count compare |
| Clause Governance | YES | YES | YES | YES | 19,893 reqs, 148 decisions, 27 tests | 488 unreviewed (needs human) |
| Device Family Classification | YES | PARTIAL | YES | PARTIAL | 34/90 FA families | 56 unresolved |
| Equipment Identity | YES | YES | YES | PARTIAL | 1,881 identities | brand_id never written |
| BOQ-Drawing Reconciliation | PARTIAL | NO | NO | NO | `resolveGovernedLink` | **0/108 drawing_reference; no FK** |
| BOQ-Spec Reconciliation | YES | PARTIAL | YES | PARTIAL | 104 links / 40 items | **only 4 Confirmed** |
| Quantity Reconciliation | YES | PARTIAL | YES | NO | 2 decisions | 106/108 unresolved |
| SLC Calculation | PARTIAL | NO | YES | NO | roles established, 0 points | **no consumption column in 315 tables** |
| Panel Sizing | YES | NO | YES | NO | engine 1.1.0, 0 snapshots | needs a pool state; 24/24 refused |
| Accessory Completion | YES | PARTIAL | YES | PARTIAL | 211 product accessories | BOQ-side incomplete |
| Product/SKU Selection | PARTIAL | NO | YES | NO | 1,327/2,011 candidates Non-Compliant | **0/108 items have manufacturer/part** |
| Pricing | YES | NO | YES | NO | engine complete | **1/518 costing-eligible; 0% default margin** |
| Supplier Quotes | YES | NO | YES (intake only) | NO | intake + approval implemented | **0 suppliers, 0 quotes** |
| Approval Workflow | YES | YES | YES | YES | 20+ mechanisms, 326 audit rows | 0 items approved end-to-end |
| Audit Trail | YES | YES | YES | YES | 2,122 doc + 56 library + 326 review events | — |
| Quote Generation | YES | NO | YES | NO | full draft/approve/issue | **0 revisions; gate never satisfied** |
| Quote Revisioning | YES | NO | YES | NO | fingerprint + supersede | never exercised |
| Final Export | PARTIAL | NO | YES | PARTIAL | XLSX wired | **no PDF/Word** |

---

## 16. What Blocks a Fire Alarm Quotation Today

### Critical blockers

1. **The AND-chain demands 100% coverage.** `presales-workflow-engine.mjs:37` requires *every* active item to be profiled, matched, technically approved, priced, commercially approved and finally reviewed. **No partial quotation path exists.** With 108 items and 0 approved, this is arithmetically unreachable.
2. **Engineering approval is 0-for-108.** 39 profiles (0 approved), 69 items have no profile. Root causes, in order: `compatibilityTarget` undefined (blocks the match boundary); 0 confirmed requirement links (96% of `boq_requirement_links` are only `Suggested`); and 488 of 513 current requirements still `Needs Review` — including the one clause that would govern addressability.
3. **90 open safety blocks; 0 approved safety decisions.** `technical_eligibility` is `Blocked` (91) or `Technical Approval Disabled` (10) for every current decision, so `technicalApproved >= activeItems` can never hold.
4. **No commercial price evidence.** 0 suppliers, 0 supplier quotes, 1 of 518 price records costing-eligible, 0 `pricing_approvals`. `pricedItems` = 0 of 108, `missingPrices` = 108. **This is a procurement/ingest gap, not a code gap** — the two governed writers exist and work.
5. **Two competing product tables.** The quotation reads `library_products`; matching/pricing read `canonical_library_products`. A canonically-present product can raise `PRODUCT_SNAPSHOT_REQUIRED` and block permanently.
6. **Zero-fire-alarm-attribute bootstrap.** 0/108 BOQ items carry manufacturer, part_number or drawing_reference — so no commercial identity can even be attempted.

### Engineering review dependencies (system can proceed, needs an engineer)

- 488 unreviewed technical requirements, incl. the system-wide addressability clause.
- 31 profiles `Missing Critical Information`, 4 `Classification Required`, 3 `Needs Technical Review`.
- 56 of 90 populations have no governed device family; the live families are `INFERRED` at 70% confidence.
- **SLC point consumption is unevidenced repository-wide.** No table records it; the 1:1 rule is a literal in the classifier. This blocks panel sizing, which requires a pool state.
- 0 `fire_alarm_panel_sizing_snapshots`; the route exists and fails closed correctly.

### Commercial dependencies

- Supplier registration and quote ingestion (the pathway is implemented and gated on a *manually confirmed* `Supplier Quotation` classification).
- Margin/markup/VAT policy: **no editor exists after scenario creation**, and the default is 0% / 0% / 0%.
- FX: governed but **inert** — every conversion is the hardcoded 3.75.
- Two supplier quotes for the same product are never compared.

### Nice-to-have

- PDF/Word quotation export (XLSX only today).
- Layout-vs-Riser-vs-Schedule count reconciliation; the generic conflict detector is dead code.
- C&E grid-cell understanding; riser vector connectivity.
- A `quote_number` column and a real quotation template.
- Costing SCOPE (engineering-expansion) write path.
- Narrowing the `REAL_STATE` classifier so comment text doesn't silently exclude pure-domain suites.

---

## 17. Recommended Next Step

**Do not write more pipeline code.** The quotation path is complete; the evidence is missing. The next slice should be the smallest one that makes a *single* BOQ line provably traceable end-to-end, so the AND-chain can be observed working rather than argued about.

**Proposed: a 10-item Fire Alarm vertical slice, driven by two humans, not by new modules.**

1. Choose ~10 BOQ items from one real panel (the 24 attachment-eligible field-device populations are the natural candidate).
2. A human approves the current system-addressability clause and the linked requirements — resolving the `Needs Review` state that gates stage 4.
3. Define `compatibilityTarget` for Fire Alarm so matching has a boundary, and confirm the ~104 requirement links.
4. Approve the resulting requirement profiles and safety decisions for those 10 items only.
5. Ingest **one real supplier quotation**, approve the rows, and set a real margin/markup/VAT policy.
6. Run pricing → approve → quotation draft for those 10, and let the export produce the XLSX.

**Success criterion:** one quotation revision with ≥1 issued line, every gate proven on real data, and a measured count of what remains per item. That converts this audit's "PARTIAL" column into evidence, and it will show precisely which of blockers 1–6 are structural versus per-item.

**Explicitly not now:** new tables, new applicability rules, relaxing the AND-chain, or a PDF exporter. The gate chain is the most defensible thing in this codebase; weakening it before proving it works would trade the system's main strength for a demo.
