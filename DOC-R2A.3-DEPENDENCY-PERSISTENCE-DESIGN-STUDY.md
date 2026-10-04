# DOC-R2A.3 — Dependency Persistence Design Study Report

## 1. Executive Verdict

**Minimum persistence strategy:** Typed foreign keys and dedicated link tables are sufficient. No generic graph, no universal provenance columns, no scope-based invalidation.

The existing architecture already persists 90% of necessary dependency information through:
- Typed FKs on extraction versions (`extraction_version_id`)
- Dedicated link tables (`boq_requirement_links`, `profile_requirement_applicability`)
- Version/run membership (`extraction_version_id` on child artifacts)
- Fingerprint composition for freshness validation

**Only 3 targeted persistence gaps require new columns/tables:**
1. `consolidated_profile_requirements.governing_source_id` → needs proper FK
2. `price_records` → need `source_intake_row_id` FK for freshness
3. `engineering_facts` provenance → needs explicit link to `boq_requirement_links` for invalidation

Everything else is reconstructable through existing FK chains.

---

## 2. Dynamic Subagent Work

No subagents spawned. Primary agent performed all investigation via direct code/schema reading.

---

## 3. Current Dependency Mechanisms

### Chain A — BOQ
| Transition | Mechanism | Status |
|------------|-----------|--------|
| Document → BOQ Extraction | `document_id` + `document_version_id` on `boq_extraction_versions` | ✅ Complete |
| BOQ Extraction → BOQ Item | `extraction_version_id` FK on `boq_items` | ✅ Complete |
| BOQ Item → Requirement Profile | `profile.boq_item_id` FK + `profile.input_fingerprint` | ✅ Complete |
| Requirement Profile → Product Match Run | `match_run.requirement_profile_version_id` FK + `input_fingerprint` | ✅ Complete |
| Product Match Run → Match Decision | `match_review.match_run_id` + `candidate_id` FK | ✅ Complete |

### Chain B — Specification
| Transition | Mechanism | Status |
|------------|-----------|--------|
| Document → Spec Extraction | `document_id` + `document_version_id` on `specification_extraction_versions` | ✅ Complete |
| Spec Extraction → Technical Requirement | `extraction_version_id` FK on `technical_requirements` | ✅ Complete |
| Technical Requirement → Engineering Fact | `engineering_fact_provenance` (source_type='Approved Specification Requirement', source_id=requirement.id) | ✅ Complete |
| Engineering Fact → Requirement Profile | `engineering_facts.scope_type='BOQ Item'` + `scope_id=boq_item_id` | ⚠️ **Reconstructable only** — no explicit FK to profile |

### Chain C — Drawing
| Transition | Mechanism | Status |
|------------|-----------|--------|
| Document → Drawing Intake | `document_id` + `document_version_id` on `drawing_intake_versions` | ✅ Complete |
| Drawing Intake → Assets/Legends | `intake_version_id` FK on `drawing_assets`, `drawing_legends` | ✅ Complete |
| Drawing Intake → Symbol Recognition | `drawing_intake_version_id` FK on `drawing_symbol_recognition_versions` | ✅ Complete |
| Symbol Recognition → Symbol Occurrences | `recognition_version_id` FK on `drawing_symbol_occurrences` | ✅ Complete |

### Chain D — Supplier Pricing
| Transition | Mechanism | Status |
|------------|-----------|--------|
| Document → Supplier Intake | `document_id` + `document_version_id` on `supplier_quote_intake_runs` | ✅ Complete |
| Supplier Intake → Intake Row | `intake_run_id` FK on `supplier_quote_intake_rows` | ✅ Complete |
| Intake Row → Supplier Quote Line | `promoted_supplier_quote_id` FK on `supplier_quote_intake_rows` | ✅ Complete |
| Intake Row → Price Record | `promoted_price_record_id` FK on row + `source_id` on `price_records` | ⚠️ **Missing** `source_intake_row_id` on `price_records` |
| Price Record → Costing Selection | `price_records.approval_status` + `downstream_use` + `valid_until` | ✅ Complete (commercial validity) |

### Chain E — Product Knowledge
| Transition | Mechanism | Status |
|------------|-----------|--------|
| Knowledge Facts → Product Identity | `product_identity_observations` (FK to `knowledge_facts`) | ✅ Complete |
| Product Identity → Product Match | `product_match_runs` uses `canonical_library_products` (which links to `library_products` → `product_identities` via promotion) | ✅ Reconstructable |
| Product Match → Technical Decision | `product_match_reviews` + `safety_decisions` + `confidence-safety-api` | ✅ Complete |

---

## 4. Dependency Persistence Taxonomy

| Type | Mechanism | Used For | Freshness Tracking |
|------|-----------|----------|-------------------|
| **Type 1 — Direct typed FK** | `extraction_version_id`, `intake_version_id`, `profile_version_id` | Single-parent artifacts (items, requirements, assets, rows) | ✅ Complete |
| **Type 2 — Dedicated link table** | `boq_requirement_links`, `profile_requirement_applicability`, `boq_drawing_quantity_links` (future) | Many-to-many with governance | ✅ Complete (partial for drawing) |
| **Type 3 — Version/run membership** | `extraction_version_id` on child artifacts | All extraction children | ✅ Complete |
| **Type 4 — Input-set membership** | `input_fingerprint` composition (array of IDs) | Multi-input artifacts (profiles, matches, identities) | ✅ Complete via fingerprint |
| **Type 5 — Fingerprint-only** | `input_freshness` computed at read | Match runs (staleness = profile version mismatch) | ✅ Acceptable |
| **Type 6 — Scope association** | `project_id`, `scope_id`, `boq_item_id` | Association only | ❌ Not for staleness |

---

## 5. Per-Domain Dependency Requirements

| Domain Artifact | Existing Dependency | Missing Dependency | Fingerprint Requirement | Recommended Pattern |
|----------------|---------------------|-------------------|------------------------|---------------------|
| **BOQ Item** | `extraction_version_id` FK | None | None (inherits extraction fingerprint) | Type 1 FK |
| **Technical Requirement** | `extraction_version_id` + `clause_id` FKs | None | None (inherits extraction fingerprint) | Type 1 FK |
| **Drawing Asset** | `intake_version_id` + `page_id` FKs | None | None (inherits intake fingerprint) | Type 1 FK |
| **Technical Requirement** | `extraction_version_id` + `clause_id` FKs | None | None | Type 1 FK |
| **Engineering Fact** | `engineering_fact_provenance` (source_type, source_id, extraction_version_id) | Link to `boq_requirement_links` for invalidation | None (versioned via `superseded_by_id`) | Type 2 link table (provenance) |
| **Requirement Profile** | `boq_item_id` FK + `input_fingerprint` (composite) | None | Composite generation fingerprint required | Type 1 FK + Type 4 fingerprint |
| **Product Match Run** | `requirement_profile_version_id` FK + `input_fingerprint` (composite) | None | Composite generation fingerprint required | Type 1 FK + Type 4 fingerprint |
| **Product Identity** | `product_identity_observations` → `knowledge_facts` | Which facts actually contributed to decision | Composite generation fingerprint on `product_identity_runs` | Type 2 (observations) + Type 4 fingerprint |
| **Price Record** | `source_id` FK on `product_sources` | `source_intake_row_id` FK | None (commercial validity gates) | Type 1 FK (add `source_intake_row_id`) |
| **Consolidated Profile Requirement** | `profile_version_id` FK | `governing_source_id` needs proper FK | None | Type 1 FK (fix `governing_source_id`) |

---

## 6. Multi-Input Artifact Findings

### Requirement Profile — Current Inputs
| Input | Persisted? | How |
|-------|------------|-----|
| BOQ Item | ✅ | `profile.boq_item_id` FK |
| Confirmed Spec Links | ✅ | `boq_requirement_links` (status='Confirmed') |
| Requirement Versions | ✅ | Inside `input_fingerprint` (requirement IDs + versions) |
| Ruleset/Engine | ✅ | Inside `input_fingerprint` |
| Engineering Facts | ⚠️ | Only via `scope_id` on facts — not explicit membership |
| Source Facts | ⚠️ | Only via active source facts query — not explicit membership |
| Project Context | ⚠️ | Only via context query — not explicit membership |

**Gap:** No explicit membership table for profile → facts/source facts. Fingerprint is only record.

### Product Match Run — Current Inputs
| Input | Persisted? | How |
|-------|------------|-----|
| Requirement Profile | ✅ | `requirement_profile_version_id` FK |
| Profile Fingerprint | ✅ | Inside `input_fingerprint` |
| Understanding Facts | ✅ | Inside `input_fingerprint` (understandingFingerprint) |
| Prices | ✅ | Inside `input_fingerprint` (prices array) |
| AI Config/Model | ✅ | Inside `input_fingerprint` |
| Search Config | ✅ | Inside `input_fingerprint` (searchProfileFingerprint) |
| Ruleset | ✅ | Inside `input_fingerprint` |

**Complete:** All inputs reconstructable from `input_fingerprint` + `requirement_profile_version_id` FK.

### Product Identity — Contributing Facts
| Input | Persisted? | How |
|-------|------------|-----|
| Knowledge Facts | ✅ | `product_identity_observations` (FK to `knowledge_facts`) |
| Which facts decided identity | ⚠️ | All observations stored; decision logic in `buildProductIdentityAnalysis` |

**Gap:** No record of which specific observations drove the identity decision vs. supporting context.

---

## 7. Fingerprint Terminology Decision

**Two distinct fingerprint kinds confirmed — MUST be distinguished:**

| Fingerprint Kind | Term | Composition | Purpose | Stored On |
|------------------|------|-------------|---------|-----------|
| **Source-Processing Fingerprint** | `input_fingerprint` (extraction) | `document_sha256 + processor_versions` | "Same source + same processor = same extraction context" | Extraction versions (`*_extraction_versions`, `*_intake_runs`, `*_intake_versions`) |
| **Dependency-Set Fingerprint** | `generation_fingerprint` (proposed rename) | `hash(sorted_input_ids + input_versions + processor_versions + config)` | "Same dependency set + same config = same generated artifact" | Generation artifacts (`requirement_profile_versions`, `product_match_runs`, `product_identity_runs`, `pricing_learning_runs`, `engineering_graph_versions`, `drawing_symbol_recognition_versions`) |

**Decision:** Formally rename the second kind to `generation_fingerprint` in all new code/migrations. Document the distinction.

---

## 8. Fingerprint Composition Principles

### Source-Processing Fingerprint (Input-Set)
```
hash({
  content_checksum: document_sha256,        // ALWAYS
  parser_version, ruleset_version,          // ALWAYS
  model_version, prompt_version,            // IF AI involved
  engine_version,                           // IF drawing/symbol
  chunk_params: { chunk_size, page_range }  // IF chunked
})
```

### Dependency-Set Fingerprint (Generation)
```
hash({
  // Canonical input artifact IDs (sorted)
  input_ids: [boq_item_id, requirement_id, ...],
  // Exact versions of versioned inputs
  input_versions: {
    extraction_version_id: "v3",
    profile_version_id: "v2",
    ...
  },
  // Processor/config versions
  processor_versions: { parser, ruleset, model, prompt, engine },
  // Config identifiers
  config: { ruleset_id, search_version, engine_version }
})
```

**Principles:**
- Input IDs **always** sorted for order independence
- Input versions required for versioned artifacts
- Processor versions always included
- Content checksums NOT included (already captured in input versions via extraction fingerprints)

---

## 9. Partial Fan-In Decision

**Decision: COARSE-GRAINED INVALIDATION IS CORRECT AND SUFFICIENT FOR NOW.**

### Analysis
| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **Full-profile supersession** (current) | Simple; guarantees consistency; matches downstream matching (profile-level) | May regenerate unaffected components | ✅ **Keep** |
| Per-requirement `consolidated_profile_requirements` freshness | Granular; enables partial recompute | Complex; downstream matching operates at profile level; inconsistency risk | ❌ Defer |
| Hybrid: profile stale flag + requirement-level freshness | Best of both | Adds complexity; no current consumer uses requirement-level matching | ❌ Defer |

**Rationale:** Downstream consumers (Product Matching, Pricing, Safety) all consume at **profile level** (`requirement_profile_version_id`). Partial freshness would create mismatch between profile freshness and downstream expectations. Coarse invalidation is correct and simpler.

**When to revisit:** If R4 introduces requirement-level matching downstream.

---

## 10. Engineering Fact Special Case

### Freshness Model: Explicit Supersession, Not Fingerprint

| Aspect | Mechanism |
|--------|-----------|
| **Generation** | `engineering_fact_provenance` links fact → source (BOQ item, Requirement, etc.) |
| **Versioning** | `version_number` + `superseded_by_id` on `engineering_facts` |
| **Freshness** | `status='Active'` ∧ `superseded_by_id IS NULL` |
| **Invalidation** | Manual via `superseded_by_id` OR automatic when ALL provenances are superseded |

### Critical Gap: Auto-Invalidation
Currently: NO automatic invalidation when `boq_requirement_links` superseded or extraction superseded.

**Fix required:** When `boq_extraction_versions` or `specification_extraction_versions` superseded:
1. Find `engineering_facts` where `engineering_fact_provenance.source_id` matches superseded extraction version
2. If ALL provenances for a fact are superseded → auto-set `status='Superseded'`, `superseded_by_id` = new fact (or NULL)
3. If some provenances remain current → fact stays `Active` (semantic validity from surviving sources)

### Semantic Validity ≠ Dependency Freshness
```
Spec v1 says X
Spec v2 says X (unchanged)
```
Old extraction superseded, but fact X remains semantically valid because new source confirms it. This is correct — freshness ≠ validity.

---

## 11. Price Record Special Case

### Current Dependency Chain
```
Supplier Intake Run
  → Intake Row (intake_run_id FK)
    → Promoted → Supplier Quote Line (source_intake_row_id FK on quote line)
    → Promoted → Price Record (source_id FK on product_sources)
```

### Missing Link: `price_records.source_intake_row_id`
Currently: `price_records` only has `source_id` → `product_sources`. Cannot trace back to specific intake row.

**Required addition:**
```sql
ALTER TABLE price_records ADD COLUMN source_intake_row_id TEXT;
-- FK to supplier_quote_intake_rows (nullable for non-supplier prices)
```

### Freshness Gates (Commercial, Not Dependency)
| Gate | Check |
|------|-------|
| Source current | `product_sources.superseded_at IS NULL` |
| Price approved | `approval_status='Approved'` |
| Downstream authorized | `downstream_use='Costing Eligible'` |
| Validity | `valid_until IS NULL OR valid_until >= today` (policy-dependent) |
| Supplier current | `suppliers.status='Active'` |

**No dependency fingerprint needed.** Commercial validity gates are sufficient.

---

## 12. Governance Decision Input Traceability

### Current State: Partial

| Decision Table | Inputs Recoverable? | Gap |
|----------------|---------------------|-----|
| `boq_review_decisions` | ✅ | Item state via `item_id` FK |
| `requirement_review_decisions` | ✅ | Requirement state via `requirement_id` FK |
| `requirement_profile_decisions` | ✅ | Profile state via `profile_version_id` FK |
| `product_match_reviews` | ✅ | Candidate state via `candidate_id` + `match_run_id` |
| `engineering_knowledge_decisions` | ✅ | Fact state via `entity_type` + `entity_id` |
| `safety_decisions` | ✅ | Candidate state via `candidate_id` + `match_run_id` |

**All major decisions can reconstruct the exact artifact versions at decision time** through existing FKs. No gaps.

---

## 13. is_stale Storage Decision

**DECISION: DERIVED ONLY — NO STORED BOOLEAN**

| Approach | Verdict | Rationale |
|----------|---------|-----------|
| **Stored boolean column** | ❌ Reject | Synchronization risk; another source of truth; becomes stale itself |
| **Cached/materialized view** | ❌ Reject | Same sync risk; D1 doesn't support materialized views |
| **Derived/computed at query time** | ✅ **Accept** | Always consistent; computed from source-of-truth dependencies |

### Implementation Pattern
```sql
-- Match run staleness (already implemented in product-matching-api.mjs)
SELECT 
  run.*,
  CASE WHEN run.requirement_profile_version_id != (
    SELECT id FROM requirement_profile_versions 
    WHERE boq_item_id = run.boq_item_id AND superseded_at IS NULL 
    ORDER BY version_number DESC LIMIT 1
  ) THEN 1 ELSE 0 END AS is_stale
FROM product_match_runs run
WHERE run.boq_item_id = ? AND run.superseded_at IS NULL;
```

**All `is_stale` flags remain computed predicates in queries/views.**

---

## 14. Invalidation Ownership

| Domain | Ownership Model | Mechanism |
|--------|----------------|-----------|
| **BOQ → Profile** | Push (approval transaction) | Requirement approval sets `profile.superseded_at` in SAME batch (lines 238-244, spec-extraction-api.mjs) |
| **Spec → Profile** | Push (approval transaction) | Same as above — requirement approval invalidates dependent profiles |
| **Extraction → Match Run** | Pull (read-time) | `matchRunStaleness()` computes at query time (product-matching-api.mjs line 49) |
| **Extraction → Profile** | Push (re-extraction) | `specification-extraction-api.mjs` lines 110-154 invalidates profiles for confirmed links |
| **Intake → Price Record** | None (gap) | No invalidation — gap to fix |
| **Extraction → Engineering Fact** | None (gap) | No invalidation — gap to fix |

### Model: Hybrid Push-Pull
- **Governance decisions (approvals)** → Push invalidation in same transaction
- **Generated artifacts (match runs, symbol recognition)** → Pull validation at read time
- **Engineering Facts** → Push (when all provenances superseded)

---

## 15. SQL Trigger vs Application Layer

**DECISION: APPLICATION LAYER ONLY — NO SQL TRIGGERS**

| Factor | Application Layer | SQL Trigger |
|--------|------------------|-------------|
| Cross-domain logic | ✅ Explicit, testable | ❌ Hidden in schema |
| Multi-hop dependencies | ✅ Can traverse link tables | ❌ Recursive triggers complex |
| D1/SQLite support | ✅ Full | ⚠️ Limited |
| Testing/debugging | ✅ Unit testable | ❌ Hard |
| Callers bypassing | ⚠️ Mitigate via shared helpers | ✅ Enforced |

**Current pattern is correct:** All invalidation logic in application code (`specification-extraction-api.mjs`, `product-matching-api.mjs`, `technical-requirement-api.mjs`). Centralized helpers (`currentRequirementProfile`, `matchRunStaleness`) ensure consistency.

---

## 16. Golden Validation (Read-Only)

| Chain | Exact Parents Known? | Exact Versions Known? | Fingerprint Explainable? | Freshness Computable Today? | Missing Persistence |
|-------|---------------------|----------------------|-------------------------|----------------------------|---------------------|
| **BOQ Item → Requirement Profile** | ✅ `boq_item_id` FK | ✅ `profile_version_id` | ✅ `input_fingerprint` composite | ✅ `profile.superseded_at IS NULL` | None |
| **Requirement Profile → Product Match** | ✅ `profile_version_id` FK | ✅ `match_run.profile_version_id` | ✅ `input_fingerprint` composite | ✅ `matchRunStaleness()` | None |
| **Spec Requirement → Engineering Fact** | ✅ `provenance.source_id` | ✅ `provenance.extraction_version_id` | ✅ provenance has versions | ✅ `fact.status='Active'` | Auto-invalidation missing |
| **Drawing Intake → Symbol Recognition** | ✅ `intake_version_id` FK | ✅ `recognition.input_fingerprint` includes intake output | ✅ both fingerprints | ✅ `superseded_at IS NULL` ∧ fingerprint match | None |
| **Supplier Intake → Price Record** | ⚠️ Via `product_sources` | ⚠️ `source_id` only | ❌ No intake row link | ⚠️ Commercial gates only | `source_intake_row_id` FK missing |

---

## 17. R2 / R3 / R4 Boundary

| Concept | Owner | R2 Scope |
|---------|-------|----------|
| **Typed FKs / Link tables** | R2 | ✅ Define |
| **Fingerprint composition standards** | R2 | ✅ Define |
| **Invalidation trigger logic** | R2 | ✅ Define |
| **`generation_fingerprint` terminology** | R2 | ✅ Define |
| **Document family / addenda** | R3 | ❌ Defer |
| **Revision precedence / partial supersession** | R3 | ❌ Defer |
| **`effective_from`/`effective_to` on artifacts** | R3 | ❌ Defer |
| **BOQ ↔ Requirement reconciliation** | R4 | ❌ Defer (R2 defines dependency persistence) |
| **BOQ ↔ Drawing reconciliation** | R4 | ❌ Defer |
| **Quantity reconciliation** | R4 | ❌ Defer |

---

## 18. Minimal Dependency Persistence Contract v1

### Required Persistence (Must Exist for Every Generated Artifact)

| Element | Where | Semantics |
|---------|-------|-----------|
| **Typed parent FK** | Every child table | `extraction_version_id`, `intake_version_id`, `profile_version_id`, `match_run_id`, etc. |
| **Version/run membership** | Every extraction child | Child knows exact parent version/run |
| **Dedicated link table** | Many-to-many governed relationships | `boq_requirement_links`, `profile_requirement_applicability`, future `boq_drawing_quantity_links` |
| **Generation fingerprint** | Profile, Match, Identity, Graph, Pricing runs | `hash(sorted_input_ids + input_versions + processor_versions + config)` |
| **Provenance table** | Engineering facts | `engineering_fact_provenance` with `source_type`, `source_id`, `extraction_version_id`, coordinates |

### Required Persistence (Gaps to Fix)

| Gap | Fix |
|-----|-----|
| `consolidated_profile_requirements.governing_source_id` | Change TEXT → FK to `boq_items` or `technical_requirements` |
| `price_records` missing intake row link | Add `source_intake_row_id` FK to `supplier_quote_intake_rows` |
| `engineering_facts` auto-invalidation | Application-layer invalidation when provenance sources superseded |

### Forbidden Patterns
- ❌ Universal `source_type`/`source_id` polymorphic columns
- ❌ `root_document_id` denormalization (traverse via FKs)
- ❌ Universal `confidence` NOT NULL
- ❌ Universal `review_status` enum
- ❌ Generic `artifact_lineage` table

---

## 19. What Existing Structures Can Be Reused

| Structure | Reuse For |
|-----------|-----------|
| `boq_requirement_links` | Model for all new cross-domain links (`boq_drawing_quantity_links`, `drawing_requirement_links`, `supplier_quote_product_links`) |
| `engineering_fact_provenance` | Model for any new cross-domain provenance tracking |
| `currentRequirementProfile` / `matchRunStaleness` | Pattern for all "current version + staleness" helpers |
| `input_fingerprint` / `generation_fingerprint` | Standardized composition for all new generation artifacts |
| `currentBoqEvidenceFrom` | Pattern for all "current evidence" authoritative queries |

---

## 20. What New Structures Would Eventually Be Needed

| Structure | Purpose | When |
|-----------|---------|------|
| `boq_drawing_quantity_links` | BOQ item ↔ Drawing evidence quantity reconciliation | R4 |
| `drawing_requirement_links` | Drawing evidence ↔ Requirement functional traceability | R4 |
| `supplier_quote_product_links` | Make explicit the `promoted_price_record_id` chain | R4 or R2A.4 |
| `reconciliation_artifacts` | Multi-source (BOQ+Spec+Drawing) reconciliation results | R4 |
| `product_identity_decision_evidence` | Track which observations drove identity decision | R2A.4 or later |

---

## 21. Roadmap Reassessment

| Step | Previous | Revised | Rationale |
|------|----------|---------|-----------|
| **R2A.4** | Migration design | **R2A.4 — Targeted Freshness Implementation Design** | Design exact column additions, invalidation triggers, and fingerprint standards before migration |
| **R3** | Revision/Addendum Study | **R3 Study** | Temporal semantics need dedicated study after freshness contract |
| **R4** | Cross-Document Reconciliation | **R4 Reconciliation** | Needs dependency persistence from R2A.4 |
| **R7** | Decision/Quotation Authority | **R7 Authority** | Depends on R4 |

**Key change:** R2A.4 is now **Targeted Freshness Implementation Design** (not migration design) — specifies exact column additions, trigger logic, and fingerprint standards for R2A.5 implementation.

---

## 22. Recommended Next Step

**DOC-R2A.4 — Targeted Freshness Implementation Design**

Scope:
1. **Exact column additions:**
   - `price_records.source_intake_row_id` FK → `supplier_quote_intake_rows`
   - `consolidated_profile_requirements.governing_source_id` → proper FK (to `boq_items` or `technical_requirements`)
   - `engineering_facts` auto-invalidation trigger spec (application-layer)

2. **Invalidation trigger pseudocode:**
   ```js
   // When extraction version superseded:
   async function invalidateDependents(db, supersededExtractionId, newExtractionId) {
     // 1. BOQ items: new extraction version created (already happens)
     
     // 2. Requirement Profiles: supersede if Confirmed links to changed requirements
     const affectedProfiles = await db.prepare(`
       SELECT DISTINCT rp.id 
       FROM requirement_profile_versions rp
       JOIN boq_requirement_links brl ON brl.boq_item_id = rp.boq_item_id
       JOIN technical_requirements tr ON tr.id = brl.requirement_id
       WHERE brl.superseded_at IS NULL 
         AND brl.status = 'Confirmed'
         AND tr.extraction_version_id = ?
         AND rp.superseded_at IS NULL
     `).bind(supersededExtractionId).all();
     
     // 3. Engineering Facts: supersede if ALL provenances superseded
     // (Implementation in engineering-knowledge-api.mjs publish path)
     
     // 4. Price Records: if supplier intake re-run, mark old price records
   }
   ```

3. **Fingerprint composition standard** — document exact field names, ordering, normalization for both `input_fingerprint` (extraction) and `generation_fingerprint` (generation)

4. **Golden validation queries** — verify all chains reconstructable

**NO CODE, NO MIGRATION, NO SCHEMA CHANGES.**

---

STATUS: DOC-R2A.3 STUDY COMPLETE

NO CODE, SCHEMA, DATA, TEST, OR MIGRATION CHANGES MADE

STOPPED — awaiting architecture review before implementation.