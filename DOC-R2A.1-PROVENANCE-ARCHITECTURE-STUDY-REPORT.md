# DOC-R2A.1 — Provenance Architecture Study Report

## 1. Executive Conclusion

**What exists today:** The AI Pricing Agent has a **fragmented but structurally sound provenance architecture** built around domain-specific extraction pipelines. Each major artifact type (BOQ Items, Technical Requirements, Drawing Assets, Product Identities, Supplier Quote Lines, Project Context Facts, Engineering Facts) carries rich immediate provenance — source document/version, extraction version, page/sheet/row/cell/clause coordinates, raw/normalized values, parser/model/rule versions, confidence, and reviewer/actor. Audit events and processing history provide system-level provenance.

**What is coherent:**
- Every extraction pipeline uses **versioned extraction tables** (`*_extraction_versions`) with `superseded_at` for temporal authority
- **Source location objects** (JSON) capture precise coordinates: page, sheet, row, cell, clause, bounding box
- **Fingerprinting** (input_fingerprint/output_fingerprint) enables idempotent re-extraction and staleness detection
- **Review decisions** (`*_review_decisions`) record actor, reason, previous/new values, timestamps
- **Engineering facts** (`engineering_facts` + `engineering_fact_provenance`) provide a cross-domain provenance layer for derived knowledge
- **Document classifications** now use canonical normalization (DOC-R1 closed)

**What is fragmented:**
- Provenance schemas are **per-domain** with no shared base type or generic relationship layer
- **Immediate parent links** exist (extraction → item), but **root document links** are inconsistent (some tables have `source_document_id`, others only `extraction_version_id`)
- **Multi-source reconciliation** (BOQ + Spec + Drawing → decision) relies on dedicated link tables (`boq_requirement_links`) rather than a unified model
- **Actor provenance** mixes system processors, AI models, and human reviewers without a unified actor model
- **Freshness/staleness** is detected per-table via `superseded_at` but no cross-artifact invalidation cascade
- **Confidence, authority, review state** are sometimes conflated (e.g., `approved_for_downstream` = 1 conflates review completion with downstream authorization)

**Biggest risks:**
1. **No generic cross-domain relationship model** — future R4/R7 reconciliation will require bespoke tables per combination
2. **Stale approved decisions can persist** — a human-approved BOQ item linked to a superseded requirement profile is not automatically invalidated
3. **Root document traceability gaps** — some artifacts cannot trace back to the original document version without multi-hop joins
4. **No canonical distinction** between explicit/derived/inferred evidence in the data model (though code distinguishes them)

**Recommended target model:** **Hybrid (Option C)** — Dedicated domain relationship tables for governance-critical links (BOQ↔Requirement, BOQ↔Drawing, Supplier↔Product) with a **shared provenance semantics layer** (common columns, FK patterns, fingerprint model) plus a **generic `artifact_lineage` table** only for truly cross-domain/adhoc relationships. This preserves referential integrity where it matters while enabling future extensibility.

---

## 2. Dynamic Subagent Work

No subagents were spawned. All investigation was performed by the primary agent through direct code/schema reading, grep searches, and test inspection.

---

## 3. Repository Provenance Inventory

| Artifact Category | Tables | Key Provenance Fields |
|-------------------|--------|----------------------|
| **Documents** | `documents`, `document_versions`, `document_processing_runs`, `processing_history`, `document_audit_events` | `sha256`, `version_number`, `object_key`, `revision`, `stage/status/progress`, `actor`, `from_status/to_status` |
| **Classification** | `document_classifications`, `classification_candidates`, `classification_evidence`, `classification_segments`, `classification_overrides`, `downstream_routing_handoffs`, `canonical_classifications (view)` | `model_version_id`, `primary_type`, `confidence`, `status`, `method`, `confirmed_by/confirmed_at`, `superseded_at` |
| **BOQ Extraction** | `boq_extraction_versions`, `boq_extraction_sources`, `boq_items`, `boq_extraction_evidence`, `boq_extraction_warnings`, `boq_review_decisions`, `boq_sections` | `parser_version/ruleset_version/ocr_version`, `input_fingerprint/output_fingerprint`, `source_location{sheet,row,cell}`, `raw_value/normalized_value`, `review_status`, `approved_for_downstream`, `decided_by/decided_at` |
| **Specification Extraction** | `specification_extraction_versions`, `specification_extraction_jobs/chunks/pages`, `specification_sections`, `specification_clauses`, `technical_requirements`, `requirement_evidence`, `requirement_attributes`, `requirement_standards`, `requirement_manufacturers`, `requirement_compatibility`, `requirement_review_decisions`, `requirement_ambiguities`, `requirement_missing_information` | `parser/model/prompt/ocr_version`, `input_fingerprint`, `source_location{page_from,page_to,sheet,clause,section}`, `original_text/normalized_requirement`, `extraction_method`, `confidence`, `review_status`, `approved_for_downstream` |
| **Drawing Intake** | `drawing_intake_versions`, `drawing_document_classifications`, `drawing_pages`, `drawing_metadata`, `drawing_assets`, `drawing_legends`, `drawing_legend_entries`, `drawing_search_entries`, `drawing_intake_audit_events` | `input_fingerprint/output_fingerprint`, `parser_version`, `page_number`, `bounding_box`, `coordinates_available`, `detection_confidence/method`, `review_status` |
| **Drawing Symbol Recognition** | `drawing_symbol_recognition_versions`, `drawing_symbol_definitions`, `drawing_symbol_source_geometries`, `drawing_symbol_occurrences`, `drawing_symbol_review_events` | `engine_version`, `input_fingerprint/output_fingerprint`, `definition_key`, `shape_signatures`, `geometry_fingerprint`, `occurrence_key`, `match_basis`, `reviewed_by/at/reason` |
| **Product Identity/Library** | `library_products`, `canonical_library_products`, `product_sources`, `product_source_evidence`, `price_records`, `product_manufacturers/brands/families`, `product_attributes`, `product_certifications`, `product_documents`, `manufacturer_order_code_observations`, `product_lifecycle_events`, `suppliers`, `supplier_quotes`, `supplier_quote_lines`, `product_identity_*` (org-level) | `source_type/authority/scope_type`, `checksum`, `source_location{sheet,row,page,cells}`, `normalized_part_number`, `approval_status/downstream_use`, `validity_state`, `review_status`, `source_intake_row_id` |
| **Supplier Price Intake** | `supplier_quote_intake_runs/rows/events`, `supplier_quotes`, `supplier_quote_lines`, `price_records`, `price_source_versions`, `price_record_versions` | `input_fingerprint`, `parser_version`, `source_location{sheet,row}`, `raw_values`, `mapping_basis/mapped_by/at`, `promoted_supplier_quote_id/price_record_id`, `review_status` |
| **Project Context** | `project_context_extraction_versions`, `project_context_facts`, `project_context_review_events` | `input_fingerprint`, `parser_version`, `source_location{sheet,row,cell,labelCell}`, `extracted_value/normalized_value`, `value_origin`, `confidence`, `review_status`, `reviewed_value/by/at/reason` |
| **Engineering Knowledge** | `engineering_facts`, `engineering_fact_provenance`, `engineering_relationships`, `engineering_knowledge_conflicts`, `engineering_knowledge_decisions`, `requirement_rules`, `requirement_rule_executions` | `entity_type/entity_id`, `predicate/value`, `fact_type`, `scope_type/scope_id`, `source_type/source_id`, `document_id/extraction_version_id`, `page/section/clause/row/cell/bounding_box`, `extraction_method/parser/model/prompt/rule_version`, `confidence`, `user_id/role/human_reason`, `version_number`, `effective_from/to`, `superseded_by_id` |
| **Requirement Profiles** | `requirement_profile_versions`, `consolidated_profile_requirements`, `profile_requirement_applicability`, `profile_issues`, `requirement_profile_decisions` | `engine_version/ruleset_version/model_version`, `input_fingerprint`, `governing_source_id`, `sources/attributes/standards/manufacturers`, `readiness_status`, `approved_for_matching`, `approved_by/at/reason` |
| **Matching/Pricing** | `product_match_runs/candidates/reviews`, `pricing_lines`, `pricing_learning_runs`, `pricing_journey_sources` | `match_method/confidence`, `source_location`, `approval_status`, `technical/commercial_approval_status`, `evidence_location` |

---

## 4. End-to-End Traceability Examples

### Chain A: Document → BOQ Extraction → BOQ Item → Grouping/Understanding → Requirement Profile

```
Document (sha256, version_id)
  └─→ BOQ Extraction Version (input_fingerprint = sha256|parser|ruleset|chunk)
        └─→ BOQ Item (source_location{sheet,row,column_mapping,rawValues})
              ├─→ BOQ Extraction Evidence (field-level: description/unit/quantity/itemNumber/manufacturer/partNumber)
              ├─→ BOQ Review Decision (actor, reason, previous/new values)
              └─→ Requirement Profile (input_fingerprint = boqItem+specLinks+ruleset)
                    └─→ Consolidated Profile Requirement (governing_source_id → BOQ Item ID)
```

**Traceability:** ✅ Complete — every hop has explicit FKs and source_location. Root document traceable via `source_document_id` → `document_versions` → `documents`.

### Chain B: Specification → Extracted Requirement → Requirement Intelligence → Engineering Fact

```
Document (sha256, version_id)
  └─→ Specification Extraction Version (input_fingerprint = sha256|parser|ruleset|model|prompt)
        └─→ Technical Requirement (source_location{page_from,page_to,clause,section}, extraction_method, parser/model_version)
              ├─→ Requirement Evidence (source_clause, original_text, extraction_method, confidence)
              ├─→ Requirement Attributes (source_location→requirement.source)
              └─→ Engineering Fact (entity_type="Technical Requirement", scope_type="Project/BOQ Item")
                    └─→ Engineering Fact Provenance (source_type="Approved Specification Requirement", document_id, extraction_version_id, page, section, clause, parser/model_version)
```

**Traceability:** ✅ Strong — requirement → engineering_fact link includes full coordinate provenance. Root document via `source_document_id` on requirement.

### Chain C: Drawing → Extraction → Visual Evidence → Symbol/Device Interpretation → Verification

```
Document (sha256, version_id)
  └─→ Drawing Intake Version (input_fingerprint = sha256|parser)
        ├─→ Drawing Pages (page_number, width/height, coordinate_mode, classifications)
        ├─→ Drawing Assets (page_id, asset_type, text_content, bounding_box, coordinates_available, detection_confidence/method)
        ├─→ Drawing Legends/Entries (page_id, legend_version, entry_type, label, description, confidence)
        └─→ Symbol Recognition Version (input_fingerprint, engine_version)
              ├─→ Symbol Definitions (definition_key, shape_signatures, source_page, bounding_box, geometry_fingerprint)
              ├─→ Symbol Occurrences (definition_id, occurrence_key, page_number, bounding_box, shape_signature, match_basis, confidence)
              └─→ Symbol Review Events (actor, action, reason)
```

**Traceability:** ✅ Strong — geometry fingerprints, page coordinates, and versioned recognition runs. Root document via `document_id` on intake version.

### Chain D: Requirement → Product Identity → Product Match → Technical Decision

```
Technical Requirement (approved_for_downstream=1)
  └─→ Requirement Profile (input_fingerprint)
        └─→ Product Match Run (engine_version, ruleset_version)
              ├─→ Product Match Candidate (match_method, confidence, explanation)
              ├─→ Product Match Review (action, reason, actor, evidence)
              └─→ Engineering Fact (entity_type="BOQ Item", predicate="Product Identity", scope_id=boq_item_id)
                    └─→ Engineering Fact Provenance (source_type="Approved AI Understanding", source_id=match_candidate_id)
```

**Traceability:** ✅ Good — match → fact provenance captures the decision chain. Gap: `product_match_candidates` doesn't directly FK to `engineering_facts` (uses `match_run_id` + candidate sequence).

### Chain E: Supplier Document → Extracted Price → Product → Price Record → Costing Selection

```
Document (sha256, version_id)
  └─→ Supplier Quote Intake Run (input_fingerprint = sha256|parser_version)
        └─→ Supplier Quote Intake Row (source_location{sheet,row}, raw_values, mapping_basis, mapped_by/at)
              ├─→ Promoted → Supplier Quote Line (source_intake_row_id)
              ├─→ Promoted → Price Record (source_id, source_location, provenance{projectId,supplierId,quoteId,lineId,sheet,row,itemNumber,rawValues,mappingBasis,actor,approvalAt})
              └─→ Costing Selection (approval_status="Approved", downstream_use="Costing Eligible")
```

**Traceability:** ✅ Strong — intake row → quote line → price record chain with full provenance JSON. Root document via `document_id` on intake run.

---

## 5. Golden Project Findings

Using `Al Mousa School — Clean Golden Run` (Fire Alarm MVP v1 baseline):

| Question | BOQ Item | Technical Requirement | Drawing-Derived | Product Match | Price Record |
|----------|----------|----------------------|-----------------|---------------|--------------|
| Source document known? | ✅ Yes (`source_document_id`) | ✅ Yes (`source_document_id`) | ✅ Yes (`document_id` on intake) | ✅ Via BOQ Item | ✅ Yes (`source_id` → `product_sources`) |
| Source version known? | ✅ Yes (`evidence_document_version_id`) | ✅ Yes (`document_version_id` on extraction) | ✅ Yes (`document_version_id`) | ✅ Via BOQ Item | ✅ Yes (`document_version_id` on `product_sources`) |
| Exact location known? | ✅ `source_location{sheet,row,cells}` | ✅ `source_location{page,clause,section}` | ✅ `page_number`, `bounding_box` | ⚠️ Partial (via BOQ item location only) | ✅ `source_location{sheet,row}` on intake row |
| Raw observation retained? | ✅ `original_raw_values` + `boq_extraction_evidence.raw_value` | ✅ `original_text` + `requirement_evidence.original_text` | ✅ `drawing_assets.text_content` + `drawing_legend_entries` | ⚠️ Match explanation only, not raw source | ✅ `supplier_quote_intake_rows.raw_values` |
| Derivation known? | ✅ Deterministic parser (BOQ_ENGINE_VERSION) | ✅ `extraction_method` + parser/model versions | ✅ `detection_method` + `engine_version` | ✅ `match_method` + engine/ruleset versions | ✅ Deterministic parser (intake) + promotion logic |
| Immediate parents known? | ✅ `extraction_version_id` | ✅ `extraction_version_id` + `clause_id` | ✅ `intake_version_id` + `page_id`/`legend_id` | ✅ `match_run_id` + `candidate_id` | ✅ `intake_run_id` + `source_intake_row_id` |
| Fingerprint/freshness known? | ✅ `input_fingerprint` on extraction | ✅ `input_fingerprint` on extraction | ✅ `input_fingerprint`/`output_fingerprint` | ✅ Profile `input_fingerprint` | ✅ `input_fingerprint` on intake run |
| Authority known? | ✅ `review_status` + `approved_for_downstream` | ✅ `review_status` + `approved_for_downstream` | ✅ `review_status` (Needs Review/Reviewed) | ✅ `review_status` + `action` (Approved/Selected) | ✅ `approval_status` + `downstream_use` |
| Reviewer known? | ✅ `decided_by` on `boq_review_decisions` | ✅ `reviewed_by` on `requirement_review_decisions` | ✅ `reviewed_by` on `drawing_symbol_review_events` | ✅ `actor_user_id` on `product_match_reviews` | ✅ `reviewed_by` on `price_records` |

**Summary:** Golden records demonstrate **strong per-domain provenance** with minor gaps in cross-domain links (match → raw source, product match → drawing evidence).

---

## 6. Provenance vs Authority vs Confidence vs Review vs Freshness

| Concept | Current Representation | Boundary Issues Found |
|---------|------------------------|----------------------|
| **Provenance** | `source_location`, `engineering_fact_provenance`, `input_fingerprint`, audit events | Well-separated in data model |
| **Authority** | `classification_status="Manually Confirmed"`, `approval_status="Approved"`, `downstream_use="Costing Eligible"`, `review_status="Approved/Accepted/Auto Verified"` | **Conflated with review state** — `approved_for_downstream=1` used as both "review complete" and "authorized for downstream" |
| **Confidence** | `confidence` (0-100) on extractions, facts, matches, symbols | Separate column, but sometimes used as proxy for authority (e.g., high confidence → auto-verified) |
| **Review State** | `review_status` enums (Needs Review/Approved/Rejected/Auto Verified/Merged) | **Mixed with authority** — `Auto Verified` is a machine state, not human review |
| **Freshness** | `superseded_at` on versioned tables, `input_fingerprint` comparison | Per-table only; no cross-artifact invalidation when upstream superseded |

**Key finding:** The system correctly **stores** these as separate columns, but **application logic sometimes conflates them** (e.g., `boqApprovalReadiness()` treats `review_status === "Auto Verified"` + `approved_for_downstream=1` as downstream-ready, mixing machine confidence with authorization).

---

## 7. Existing Provenance Strengths

1. **Universal versioning** — Every major artifact table has `version_number` + `superseded_at` for temporal authority
2. **Precise source coordinates** — `source_location` JSON objects capture page/sheet/row/cell/clause/bounding_box consistently
3. **Fingerprint-driven idempotency** — `input_fingerprint` (sha256 + parser/ruleset/model versions) enables safe re-extraction
4. **Decision audit trail** — Every governed mutation writes `*_review_decisions` with actor, reason, before/after values
5. **Cross-domain engineering facts** — `engineering_facts` + `engineering_fact_provenance` provide a unified layer for derived knowledge with full provenance
6. **Canonical classification** — DOC-R1 normalized document types eliminate alias ambiguity in provenance queries
7. **Processing history** — `document_processing_runs` + `processing_history` track every pipeline stage with actor/timestamp
8. **Explicit extraction evidence** — `boq_extraction_evidence`, `requirement_evidence` store field-level raw→normalized mappings

---

## 8. Provenance Gaps

### 🔴 Correctness / Traceability Blockers

| Gap | Impact |
|-----|--------|
| **No cross-artifact invalidation cascade** | When a Specification Extraction is superseded, linked `boq_requirement_links` and `engineering_facts` with `scope_type="BOQ Item"` are not automatically marked stale — downstream decisions may use stale inputs |
| **Root document traceability missing on some tables** | `engineering_facts` has `document_id` but nullable; `consolidated_profile_requirements` has only `governing_source_id` (BOQ Item ID) — requires 3-hop join to root document |
| **Product match → source evidence gap** | `product_match_candidates.explanation` is text; no FK to source `boq_items.source_location` or `technical_requirements.source_location` |
| **No generic relationship model for multi-source reconciliation** | BOQ+Spec+Drawing reconciliation requires bespoke tables per combination |

### 🟡 Important Architectural Gaps

| Gap | Impact |
|-----|--------|
| **Authority/Review conflation** | `approved_for_downstream` = 1 means both "human reviewed" AND "authorized for pricing/matching" — cannot distinguish |
| **Actor model fragmentation** | System processors (`"BOQ Extraction Engine"`), AI models, and human users all use `decided_by`/`actor_user_id` text fields with no type discrimination |
| **Confidence semantics vary** | Extraction confidence (parser), match confidence (semantic), fact confidence (engineering judgment) — no unified scale or calibration |
| **No explicit/derived/inferred classification in data** | Code distinguishes them but schema stores all in same tables/columns |
| **Effective time vs recorded time** | `effective_from`/`effective_to` exist on `engineering_facts` and `engineering_relationships` but not on BOQ items, requirements, price records |

### 🔵 Hardening Opportunities

| Gap | Impact |
|-----|--------|
| **source_location schema not enforced** | JSON blob — no validation that required keys (sheet/row/page) exist per domain |
| **Fingerprint composition inconsistent** | Some use `sha256|parser|ruleset`, others add `model|prompt|chunk` — no standard |
| **No lineage depth limit** | Deep derivation chains possible without explicit depth tracking |
| **Drawing symbol geometry provenance** | `drawing_symbol_source_geometries.geometry_fingerprint` exists but not linked to asset detection confidence |

---

## 9. Fingerprint & Staleness Findings

| Artifact | Fingerprint Inputs | Invalidated By | Auto-Invalidation | Human Decision Staleness |
|----------|-------------------|----------------|-------------------|-------------------------|
| BOQ Extraction | `sha256|parser|ruleset|chunk` | Document re-upload, parser upgrade | ✅ On re-extraction (new version supersedes) | ❌ `review_status="Approved"` persists on superseded version |
| Spec Extraction | `sha256|parser|ruleset|model|prompt|chunk` | Document re-upload, any version upgrade | ✅ Same | ❌ Same — approved requirements on old version not invalidated |
| Drawing Intake | `sha256|parser` | Document re-upload, parser upgrade | ✅ Same | ❌ Review status on old intake version persists |
| Symbol Recognition | `input_fingerprint` (includes intake output_fingerprint) | Intake re-run, engine upgrade | ✅ Same | ❌ Reviewed symbols on old version persist |
| Product Identity | `rulesetVersion + sorted(fact.id, fact.normalized_value, fact.source_location)` | Knowledge library change, ruleset change | ✅ New run with new fingerprint | ⚠️ Reviewed identities not auto-invalidated |
| Requirement Profile | `boqItem + specLinks + ruleset + engine` | BOQ re-extraction, spec re-extraction, ruleset change | ✅ New profile version | ❌ `approved_for_matching` persists on superseded profile |
| Engineering Fact | Versioned via `version_number` + `effective_from/to` | Explicit supersession via `superseded_by_id` | ❌ Manual only | ✅ Versioning model handles this correctly |

**Critical finding:** Human-approved decisions on **superseded extraction versions remain valid in the data model** — the system creates new versions but does not cascade invalidation to dependent artifacts (requirement profiles, engineering facts, match decisions). This is a correctness risk for R4/R7.

---

## 10. Temporal / Revision Compatibility

| Temporal Concept | Current Support | Gap for R3 (Revision/Addendum) |
|------------------|-----------------|-------------------------------|
| **Recorded time** (`created_at`, `classified_at`, `decided_at`) | ✅ Universal on all tables | — |
| **Effective time** (`effective_from`, `effective_to`) | ⚠️ Only on `engineering_facts`, `engineering_relationships`, `engineering_standard_versions` | Missing on BOQ items, requirements, price records, product identities |
| **Supersession** (`superseded_at`, `superseded_by_id`) | ✅ Universal on versioned extraction tables | — |
| **Revision tracking** | `document_versions.revision`, `document_versions.issue_date` | No linkage from extraction artifacts to document revision |
| **Addendum/change detection** | Fingerprint comparison on re-extraction | No semantic diff — only full re-extraction |
| **Point-in-time queries** | Possible via `superseded_at` + `created_at` | Complex multi-table joins required |

**Compatibility assessment:** Current architecture **can support R3** but requires:
1. Adding `effective_from`/`effective_to` to BOQ items, requirements, price records
2. Linking extraction versions to `document_versions.revision` (already have `document_version_id`)
3. Defining revision semantics for `engineering_facts` (already has versioning)

---

## 11. Actor / Decision Traceability

| Actor Type | Current Representation | Can Answer "Who Created Me?" | Can Answer "Who Approved Me?" |
|------------|----------------------|------------------------------|-------------------------------|
| Deterministic Processor | `"BOQ Extraction Engine"`, `"Classification Worker"`, `processor_version` | ✅ `decided_by` / `actor` fields | N/A (not an approver) |
| AI Model | `model_version` in extraction, `modelVersion` in facts | ✅ Via extraction version | N/A |
| User (Engineer/Reviewer) | `user_id` / `actor_user_id` / `decided_by` / `reviewed_by` | ✅ | ✅ Via `reviewed_by` / `decided_by` |
| Technical Manager | Same as user (role in `decided_role`) | ✅ | ✅ |
| Automated Approval | `"BOQ Extraction Engine"` with `action="auto-verify"` | ✅ | ⚠️ Conflated with system processor |

**Gap:** No `actor_type` column to distinguish human vs system vs AI. `decided_role` exists on `engineering_knowledge_decisions` and `product_library_decisions` but not on BOQ/spec review decisions.

---

## 12. Architecture Alternatives

### Option A — Generic Provenance Graph
```sql
artifact_lineage (
  source_type, source_id, target_type, target_id,
  relationship, metadata, created_at
)
```

| Criterion | Assessment |
|-----------|------------|
| Referential Integrity | 🔴 **Weak** — no FK enforcement across polymorphic types |
| Queryability | 🟡 Flexible but requires dynamic SQL or application-layer joins |
| Auditability | 🟡 Single table but metadata JSON opaque |
| Extensibility | 🟢 Trivial to add new relationship types |
| Debugging | 🔴 Hard — no schema guidance |
| Migration Complexity | 🟢 Low — one table |
| Engineering Governance | 🔴 **Poor** — governance rules cannot be encoded in schema |
| R4/R7 Needs | 🟢 Natural fit for arbitrary reconciliation |

### Option B — Dedicated Domain Relationships
```sql
boq_requirement_links, drawing_requirement_links, boq_drawing_quantity_links, supplier_quote_product_links, ...
```

| Criterion | Assessment |
|-----------|------------|
| Referential Integrity | 🟢 **Strong** — real FKs to domain tables |
| Queryability | 🟢 Direct joins, indexes per domain |
| Auditability | 🟢 Explicit columns, review/decision columns per table |
| Extensibility | 🟡 New table per relationship type |
| Debugging | 🟢 Clear schema per domain |
| Migration Complexity | 🟡 Moderate — multiple tables |
| Engineering Governance | 🟢 **Excellent** — status, confidence, reviewer per domain |
| R4/R7 Needs | 🟡 Requires new table per new reconciliation type |

### Option C — Hybrid (Recommended)
- **Dedicated tables** for governance-critical, high-volume, fixed-schema relationships:
  - `boq_requirement_links` (already exists, strong model)
  - `boq_drawing_quantity_links` (future)
  - `supplier_quote_product_links` (already implicit via `promoted_price_record_id`)
  - `drawing_requirement_links` (future)
- **Shared provenance semantics** enforced by convention/migration lint:
  - `source_type`, `source_id`, `target_type`, `target_id` (or domain-specific FKs)
  - `link_method`, `confidence`, `evidence` (JSON)
  - `status` (Suggested/Confirmed/Needs Review/Rejected)
  - `scope_type`, `scope_id` (for scoping to BOQ Item/Project)
  - `reviewed_by`, `reviewed_at`, `review_reason`
  - `version_number`, `previous_version_id`, `superseded_at`
  - `created_by`, `created_at`
- **Generic `artifact_lineage` table** ONLY for:
  - Ad-hoc cross-domain links not yet warranting dedicated table
  - Temporary exploration relationships
  - Audit/analysis metadata

---

## 13. External Research Findings

### W3C PROV (PROV-O, PROV-DM)
- **Entities/Activities/Agents** model maps well to our `engineering_facts` (entities), extraction runs (activities), users/processors (agents)
- **Derivation** (`prov:wasDerivedFrom`) matches our `engineering_fact_provenance.source_id` + `source_type`
- **Recommendation:** Adopt PROV terminology (`wasGeneratedBy`, `wasDerivedFrom`, `wasAttributedTo`) for column naming consistency in future provenance tables

### NASA Systems Engineering Handbook (Traceability)
- **Forward/Backward traceability** required: Requirements → Design → Test → Verification
- Our `boq_requirement_links` + `engineering_facts` + `requirement_profile_versions` already implement this pattern
- **Gap:** No automated traceability matrix generation — would need cross-table query layer

### Requirements Traceability (ISO/IEC/IEEE 24765, CMMI)
- **Bi-directional traceability** between requirements and artifacts
- Our `boq_requirement_links.status` (Suggested/Confirmed/Needs Review) aligns with traceability link states
- **Recommendation:** Add `traceability_type` (forward/backward/both) to link tables

### Relational Temporal Data (SQL:2011, Temporal Tables)
- **System-versioned tables** (SQL:2011) would automate `superseded_at` management
- **D1/SQLite limitation:** No native temporal tables — current manual `superseded_at` pattern is correct for this platform
- **Bi-temporal** (valid time + transaction time) needed for R3 — our `effective_from`/`effective_to` + `created_at`/`superseded_at` on `engineering_facts` is a manual bi-temporal model

### Key Separation Principle (Repository Fact vs External Theory)
| Repository Fact | External Guidance Applied |
|-----------------|--------------------------|
| Per-domain versioned tables with `superseded_at` | Matches temporal table pattern for D1 |
| `engineering_facts` as cross-domain knowledge layer | Aligns with PROV Entity + derivation |
| Dedicated link tables (`boq_requirement_links`) | Matches CMMI traceability link model |
| Fingerprint = sha256 + component versions | Standard content-addressable versioning |

**No external theory overrides repository facts.** The hybrid model (Option C) emerges from the repository's own successful patterns.

---

## 14. Recommended Provenance Architecture

### Target Semantics (No Implementation)

**1. Canonical Provenance Columns (enforced on all new provenance tables):**
```sql
-- Immediate source
source_type TEXT NOT NULL,           -- 'BOQ Extraction' | 'Specification Requirement' | 'Drawing Asset' | ...
source_id TEXT NOT NULL,             -- FK to source artifact (polymorphic by source_type)
-- Root source (denormalized for queryability)
root_document_id TEXT NOT NULL,      -- FK to documents
root_document_version_id TEXT NOT NULL, -- FK to document_versions
-- Location
source_location JSON NOT NULL,       -- {page, sheet, row, cell, clause, section, bounding_box, ...}
-- Derivation
derivation_method TEXT NOT NULL,     -- 'Deterministic Parser' | 'AI Model' | 'Human Review' | 'Rule Engine' | 'Composite'
parser_version TEXT, ruleset_version TEXT, model_version TEXT, prompt_version TEXT, engine_version TEXT,
-- Confidence & Authority
confidence INTEGER NOT NULL,         -- 0-100, calibrated per domain
authority_level TEXT NOT NULL,       -- 'Explicit Source' | 'Derived' | 'Inferred' | 'Human Governed'
-- Review/Decision
review_status TEXT NOT NULL,         -- 'Needs Review' | 'Approved' | 'Rejected' | 'Auto Verified' | 'Superseded'
reviewed_by TEXT, reviewed_at TEXT, review_reason TEXT,
-- Versioning
version_number INTEGER DEFAULT 1,
previous_version_id TEXT,
superseded_at TEXT,
-- Actor
created_by TEXT NOT NULL,            -- FK to users (human) or system identifier
actor_type TEXT NOT NULL,            -- 'Human' | 'System Processor' | 'AI Model'
created_at TEXT DEFAULT CURRENT_TIMESTAMP
```

**2. Domain Relationship Tables (Dedicated, with above columns + domain FKs):**
- `boq_requirement_links` ← **keep, enhance** with canonical provenance columns
- `boq_drawing_quantity_links` ← **new** for R4 quantity reconciliation
- `drawing_requirement_links` ← **new** for R4 spatial↔functional traceability
- `supplier_quote_product_links` ← **new** (make explicit the `promoted_price_record_id` chain)
- `requirement_product_links` ← **new** for requirement→product identity traceability

**3. Generic `artifact_lineage` Table (Sparse, for cross-domain only):**
```sql
artifact_lineage (
  id, source_type, source_id, target_type, target_id,
  relationship, metadata,  -- JSON for flexible attributes
  created_by, actor_type, created_at
)
```
- **FKs NOT enforced** (polymorphic)
- **Only for** relationships not covered by dedicated tables
- **Audit-only** — not for governance decisions

**4. Cross-Artifact Invalidation Protocol:**
- When `*_extraction_versions.superseded_at` is set:
  - Auto-expire `approved_for_downstream` on dependent items
  - Cascade `status='Superseded'` to `engineering_facts` with matching `scope_id`
  - Invalidate `requirement_profile_versions` with matching `input_fingerprint` components
  - Mark `product_match_candidates` stale if dependent extraction version superseded

**5. Actor Model Unification:**
- Add `actor_type` to all `*_review_decisions` tables
- System processors registered in `system_processors` table (id, name, version)
- AI models registered in `ai_models` table (id, provider, model, version)

---

## 15. Impact on Roadmap

| Roadmap Item | Current Order | Re-evaluated Order | Rationale |
|--------------|---------------|-------------------|-----------|
| **R2** Provenance Contract | 1 | 1 | Foundation for all downstream work |
| **R3** Revision/Addendum Semantics | 2 | 2 | Requires effective-time on artifacts (enables R4 correctly) |
| **R4** Cross-Document Reconciliation | 3 | 3 | Needs dedicated link tables + invalidation protocol from R2 |
| **R7** Decision/Quotation Authority | 4 | 4 | Depends on R4 reconciliation output |
| **R5/R6** (Legacy/UI) | 5/6 | 5/6 | Unchanged — parallel track |

**Key change:** R2 must deliver the **invalidation protocol** and **canonical provenance columns** before R4, otherwise R4 reconciliation will inherit stale-decision bugs.

---

## 16. Open Architectural Decisions

| Decision | Options | Recommendation | Blocking? |
|----------|---------|----------------|-----------|
| **Confidence calibration** | Per-domain 0-100 vs unified scale with domain weights | Keep per-domain; add `confidence_calibration` metadata table | No |
| **Explicit/Derived/Inferred enum** | Add `derivation_class` column to provenance tables | Add to new tables; backfill via migration for existing | No (can be added later) |
| **Effective time on all artifacts** | Add `effective_from`/`effective_to` to BOQ items, requirements, price records | Do in R3 (revision semantics) — not R2 | Yes (R3 dependency) |
| **Actor type column** | Add `actor_type` to all review/decision tables | Do in R2 — low cost, high value | No |
| **Generic lineage table vs pure dedicated** | Hybrid (C) vs pure dedicated (B) | Hybrid — generic only for truly ad-hoc | No |
| **PROV-O alignment** | Rename columns to `wasGeneratedBy`, `wasDerivedFrom`, `wasAttributedTo` | Adopt terminology in new tables; don't rename existing | No |

---

## 17. Recommended Next Study or Implementation Step

**Next: DOC-R2A.2 — Canonical Provenance Columns Migration Design**

- Define exact column additions for each existing provenance table
- Design backfill strategy for `root_document_id`, `root_document_version_id`
- Specify invalidation cascade triggers (SQL or application-layer)
- Prototype on `boq_requirement_links` (highest value, already exists)
- Validate with Golden project traceability queries

**Do NOT execute.** Awaiting architecture review.

---

STATUS: DOC-R2A.1 STUDY COMPLETE

NO CODE, SCHEMA, DATA, OR MIGRATION CHANGES MADE

STOPPED — awaiting architecture review before implementation.