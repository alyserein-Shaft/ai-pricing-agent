# DOC-R2A.1R — Provenance Contract & Freshness Reconciliation Report

## 1. Executive Verdict

**DOC-R2A.1's proposed "canonical provenance columns" universal template is OVER-ENGINEERED and partially INCORRECT.**

The repository already has a **working, domain-specific provenance architecture** that correctly separates concerns. The study's attempt to impose a universal column set on all artifacts would:

- Force mandatory fields on artifacts that genuinely don't need them (e.g., `confidence NOT NULL` on deterministic FK links)
- Conflate provenance, authority, confidence, and review state into a single row
- Duplicate root-document fields that are already derivable via existing FKs
- Create synchronization risk without solving the actual freshness problem

**What should become the canonical provenance contract:**
1. **Per-domain provenance stays per-domain** — no universal column mandate
2. **Immediate derivation dependencies** (extraction_version_id, source_id, fingerprint) are the authoritative lineage
3. **Root document provenance** is derived by traversal, not denormalized
3. **Freshness is fingerprint-driven** — invalidation cascades only when input fingerprints change
4. **Six concepts remain separate** — no `authority_level`, no universal `review_status`, no mandatory `confidence`
5. **Generic `artifact_lineage` is REJECTED** — dedicated typed relationships are sufficient and safer

**Next step:** A focused **R2A.2 — Dependency/Freshness Contract Design** (not migration design) to specify the exact invalidation cascade rules and fingerprint semantics per domain.

---

## 2. Dynamic Subagent Work

No subagents spawned. All verification performed by primary agent through direct schema/code inspection.

---

## 3. Verification of DOC-R2A.1 Claims

| Claim | Verdict | Evidence |
|-------|---------|----------|
| "Every major artifact is versioned" | **VERIFIED** | `*_extraction_versions` tables all have `version_number` + `superseded_at`; `engineering_facts` has `version_number` + `superseded_by_id`; `product_match_runs`, `requirement_profile_versions`, `drawing_intake_versions`, `supplier_quote_intake_runs` all versioned |
| "`engineering_facts` has `document_id` but nullable" | **INCORRECT** | `engineering_facts` table (migration 0005) has NO `document_id` column. `document_id` exists ONLY on `engineering_fact_provenance` (line 57), which is a separate 1:N provenance table. The study conflated the provenance table with the fact table. |
| "`consolidated_profile_requirements` has only `governing_source_id` requiring 3-hop join to root document" | **PARTIALLY TRUE** | `governing_source_id` is TEXT NOT NULL but **NOT a FK** (migration 0006 line 9, no FK constraint). The 3-hop path exists: `consolidated_profile_requirements` → `requirement_profile_versions` (via `profile_version_id` FK) → `boq_items` (via `boq_item_id` FK) → `documents` (via `source_document_id` FK). But `governing_source_id` itself is untyped. |
| "Product match → source evidence gap" | **VERIFIED** | `product_match_candidates` (migration 0008) has no FK to `engineering_facts` or `boq_items.source_location`. Match runs reference `boq_item_id` and `requirement_profile_version_id` only. The `explanation` field is text. |
| "No cross-artifact invalidation cascade" | **VERIFIED** | When `specification_extraction_versions` is superseded, the code in `specification-extraction-api.mjs` lines 110-154 only supersedes `requirement_profile_versions` for BOQ items with **Confirmed** links to that requirement. It does NOT auto-invalidate `engineering_facts` with `scope_type='BOQ Item'` or `product_match_runs`. The invalidation is partial and link-status-dependent. |
| "Root document traceability missing on some tables" | **PARTIALLY TRUE** | `engineering_facts` lacks direct document link (correct — provenance is in separate table). `consolidated_profile_requirements` lacks direct document link (traversable via FKs). `product_match_candidates` lacks direct document link (traversable via `match_run_id` → `boq_item_id`). But no table that *should* have root document link is missing it — the pattern is consistently "traverse via extraction version". |
| "Every extraction pipeline uses versioned extraction tables with `superseded_at`" | **VERIFIED** | `boq_extraction_versions`, `specification_extraction_versions`, `drawing_intake_versions`, `drawing_symbol_recognition_versions`, `supplier_quote_intake_runs`, `project_context_extraction_versions` all have `version_number` + `superseded_at`. |
| "Fingerprinting enables idempotent re-extraction" | **VERIFIED** | All extraction pipelines compute `input_fingerprint` (sha256 + component versions) and compare against previous version's fingerprint before creating new version. See `drawing-intake-api.mjs` line 21, `specification-extraction-background.mjs` line 81, `supplier-price-intake-api.mjs` line 56, etc. |
| "`approved_for_downstream` conflates review and authority" | **VERIFIED** | `boq_items.approved_for_downstream` = 1 is set both by human `approve` action (line 306) AND by auto-verification (line 63). `requirement_profile_versions.approved_for_matching` = 1 is set by readiness status, not by human approval. Both columns serve dual purpose. |
| "Actor model mixes system/AI/human without type" | **VERIFIED** | `boq_review_decisions.decided_by` stores both `"BOQ Extraction Engine"` (literal string, line 22) and user IDs. `engineering_knowledge_decisions` has `decided_role` but `boq_review_decisions` does not. |
| "Confidence semantics vary without calibration" | **VERIFIED** | Extraction confidence (parser heuristic 0-100), match confidence (semantic score), fact confidence (engineering judgment), auto-verification confidence (threshold-based). No shared calibration. |

---

## 4. Six-Concept Boundary

| Concept | Repository Reality | DOC-R2A.1 Proposed Field | Decision |
|---------|-------------------|--------------------------|----------|
| **Provenance** | `source_location` JSON, `engineering_fact_provenance`, `input_fingerprint`, FK chains | `source_type`, `source_id`, `root_document_id`, `source_location` | **Keep per-domain**. Do not add universal columns. Provenance = "where from" — already correctly modeled as immediate parent FKs + `source_location` JSON. |
| **Derivation** | `input_fingerprint` composition, `derivation_method` in provenance tables, `extraction_method` on extractions | `derivation_method`, `parser_version`, `ruleset_version`, `model_version` | **Keep per-domain**. Derivation = "how produced" — already captured in fingerprint composition and provenance tables. No universal column needed. |
| **Authority** | `classification_status='Manually Confirmed'`, `approval_status='Approved'`, `downstream_use='Costing Eligible'`, `review_status='Approved'` | `authority_level` ('Explicit Source' \| 'Derived' \| 'Inferred' \| 'Human Governed') | **REJECT universal `authority_level`**. Authority is a governance decision, not a provenance property. It lives in status columns and review decisions. Adding it to provenance conflates concerns. |
| **Confidence** | `confidence` (0-100) on extractions, facts, matches, symbols | `confidence INTEGER NOT NULL` | **REJECT mandatory universal confidence**. Deterministic FK links (e.g., `boq_requirement_links` → `boq_items`) have no meaningful confidence. Auto-verification uses threshold logic, not a confidence score. Confidence is per-domain. |
| **Review / Approval** | `review_status` enums, `reviewed_by/at/reason`, `decided_by/at/role` | `review_status`, `reviewed_by`, `reviewed_at`, `review_reason` | **Keep per-domain**. Review is a governance action, not a provenance property. Universal `review_status` would force `Needs Review` on deterministic FK links that are never reviewed. |
| **Freshness / Current Usability** | `superseded_at` on versioned tables, `input_fingerprint` comparison, `effective_from/to` on engineering_facts | (implicit in invalidation proposal) | **Freshness is the key contract**. Must be fingerprint-driven, not scope-driven. See sections 9-10. |

---

## 5. Universal-Field Challenge

| Proposed Field | Universal? | Store/Derive | Correct Semantic Owner | Decision |
|----------------|------------|--------------|------------------------|----------|
| `source_type` | ❌ No | N/A | Provenance table per domain | Per-domain provenance tables already have typed FKs (`extraction_version_id`, `intake_version_id`, `source_id`). Polymorphic `source_type`/`source_id` weakens referential integrity. |
| `source_id` | ❌ No | N/A | Per-domain FK | Same as above. Typed FKs are superior. |
| `root_document_id` NOT NULL | ❌ No | Derive | Query layer | `engineering_facts` correctly has no document_id. `consolidated_profile_requirements` correctly traverses via FKs. Denormalization creates update drift risk. |
| `root_document_version_id` NOT NULL | ❌ No | Derive | Query layer | Same reasoning. |
| `source_location` NOT NULL | ❌ No | Store | Per-domain artifact | `engineering_facts` has no location (provenance is separate). `product_match_runs` has no location (derives from inputs). Mandatory would force fake `{}`. |
| `confidence` NOT NULL | ❌ No | Store | Per-domain | Deterministic FK links have no confidence. Human review decisions have no confidence. Mandatory creates fake data. |
| `authority_level` | ❌ No | N/A | Authority (separate) | Conflates authority with provenance. Authority is in `status` columns and review decisions. |
| `review_status` | ❌ No | Store | Governance | `boq_requirement_links` has status (Suggested/Confirmed/Needs Review) — correct. `engineering_facts` has status (Active/Superseded) — correct. Universal enum would force `Needs Review` on deterministic links. |
| `created_by` | ⚠️ Partial | Store | Per-domain | Already exists as `created_by` on most tables. But `engineering_fact_provenance` has `user_id` + `user_role` — richer. Don't flatten. |
| `actor_type` | ⚠️ Partial | Store | Governance | Useful for audit but belongs on review/decision tables, not provenance tables. `boq_review_decisions` needs it; `engineering_fact_provenance` doesn't. |

---

## 6. Immediate vs Root Provenance

**Principle confirmed:** *Persist immediate derivation dependencies as authoritative lineage. Derive root provenance by traversal.*

| Artifact | Immediate Parent (Authoritative) | Root Document (Derivable) |
|----------|----------------------------------|---------------------------|
| `boq_items` | `extraction_version_id` → `boq_extraction_versions` | `extraction_version_id` → `document_id` → `documents` |
| `technical_requirements` | `extraction_version_id` → `specification_extraction_versions` | `extraction_version_id` → `document_id` → `documents` |
| `drawing_assets` | `intake_version_id` → `drawing_intake_versions` | `intake_version_id` → `document_id` → `documents` |
| `engineering_facts` | `engineering_fact_provenance` (1:N) → `source_id` + `source_type` | Via provenance table: `document_id` → `documents` |
| `requirement_profile_versions` | `boq_item_id` + `requirement_profile_versions.input_fingerprint` | `boq_item_id` → `source_document_id` → `documents` |
| `product_match_runs` | `requirement_profile_version_id` + `boq_item_id` | Via `boq_item_id` → `source_document_id` → `documents` |
| `consolidated_profile_requirements` | `profile_version_id` → `requirement_profile_versions` | 3-hop via profile → BOQ item → document |

**Recommendation:** Do NOT add `root_document_id`/`root_document_version_id` to any table. The traversal is 1-3 hops, all FK-enforced, and queryable via views if needed.

---

## 7. External/Non-Document Evidence Compatibility

The current architecture **already supports non-document evidence roots**:

| Evidence Type | Current Representation |
|---------------|------------------------|
| Project/Tender Document | `documents` + `document_versions` (primary) |
| Code / Standard | `engineering_standards` + `engineering_standard_versions` (migration 0005) |
| AHJ / Authority Decision | `engineering_knowledge_decisions` with `scope_type` |
| Manufacturer Technical Document | `product_sources.source_type='Manufacturer'` + `product_source_evidence` |
| Certification/Listing Source | `product_certifications` + `standard_body`/`standard_number` |
| Supplier/Commercial Document | `supplier_quotes`, `supplier_quote_intake_runs`, `price_records` |
| Historical Project Evidence | `product_lifecycle_events`, `project_context_facts` |
| Human Engineering Decision | `engineering_knowledge_decisions`, `boq_review_decisions`, `requirement_review_decisions` |
| Deterministic Calculation | `engineering_facts.fact_type='Derived'` + `derivation` text |
| AI/Model Inference | `engineering_facts.fact_type='Inferred'` + `model_version` on provenance |

**No schema change needed.** The `engineering_fact_provenance.source_type` is open-ended text, not an enum. The provenance contract already accommodates all evidence types.

---

## 8. Generic artifact_lineage Decision

**DECISION: REJECT** — `artifact_lineage(source_type, source_id, target_type, target_id, relationship, metadata...)` is NOT NEEDED.

### Evidence from actual roadmap relationships:

| Relationship | Current Representation | Sufficient? |
|--------------|------------------------|-------------|
| BOQ ↔ Requirement | `boq_requirement_links` (typed FKs, status, confidence, evidence, reviewed_by) | ✅ Yes |
| BOQ ↔ Drawing Quantity | Not yet built — would need `boq_drawing_quantity_links` | Dedicated table |
| Requirement ↔ Drawing Evidence | Not yet built — would need `drawing_requirement_links` | Dedicated table |
| Requirement ↔ Product | `product_match_runs` → `boq_item_id` + `requirement_profile_version_id` + `product_match_candidates` | ✅ Yes |
| Supplier Quote ↔ Product | `supplier_quote_intake_rows.promoted_price_record_id` → `price_records` → `product_id` | ✅ Yes |
| Document Version ↔ Superseded Version | `document_versions.supersedes_version_id` | ✅ Yes |
| Cross-document Conflicts | `engineering_knowledge_conflicts` (polymorphic `left_entity_type/id`, `right_entity_type/id`) | ✅ Yes — already generic but typed |

**Why generic lineage adds no value:**
- Every governance-critical relationship already has or will have a dedicated table with real FKs
- The only "cross-domain" conflict table (`engineering_knowledge_conflicts`) already uses polymorphic entity types correctly because conflicts genuinely span arbitrary entity types
- Adding `artifact_lineage` would create **duplicate source of truth** — which table owns the relationship?
- Synchronization risk: if `boq_requirement_links` and `artifact_lineage` diverge, which is authoritative?
- Debugging: explicit tables are self-documenting; polymorphic joins require application knowledge

**Rule validated:** Do not introduce `artifact_lineage` until a concrete required relationship cannot be cleanly represented by typed domain relations. No such case exists.

---

## 9. Dependency Model (Actual Repository Patterns)

### BOQ Item → Requirement Profile
```js
// Input IDs used: boq_item_id (direct FK)
// Input fingerprint: requirement_profile_versions.input_fingerprint = fingerprint({
//   boqItem, links, requirements, facts, relationships, sourceFacts, ruleset
// })
// Stored on: requirement_profile_versions (input_fingerprint, boq_item_id FK)
```

### Requirement → Engineering Fact
```js
// Input IDs: requirement_id (via engineering_fact_provenance.source_id where source_type='Approved Specification Requirement')
// Input fingerprint: Not stored on fact (engineering_facts has no fingerprint)
// Stored on: engineering_fact_provenance (extraction_version_id, page, clause, parser_version, model_version)
```

### Requirement Profile → Product Match Run
```js
// Input IDs: requirement_profile_version_id (FK), boq_item_id (FK)
// Input fingerprint: product_match_runs.input_fingerprint = hash({
//   item.current_values, profileId, profileFingerprint, understandingFingerprint,
//   searchProfileFingerprint, candidateFingerprint, aiConfigFingerprint, prices, ruleset
// })
// Stored on: product_match_runs
```

### Drawing Intake → Symbol Recognition
```js
// Input IDs: drawing_intake_version_id (FK)
// Input fingerprint: drawing_symbol_recognition_versions.input_fingerprint (includes intake output_fingerprint)
// Output fingerprint: drawing_symbol_recognition_versions.output_fingerprint
// Stored on: drawing_symbol_recognition_versions
```

### Supplier Intake Row → Price Record
```js
// Input IDs: intake_run_id (via promoted_supplier_quote_id → supplier_quote_lines.source_intake_row_id)
// Input fingerprint: supplier_quote_intake_runs.input_fingerprint = `${sha256}:${version}`
// Stored on: supplier_quote_intake_runs, propagated via provenance JSON on price_records
```

### Product Identity → Match/Price Decisions
```js
// Input IDs: product_identity_id (FK on product_identity_observations, product_identity_prices)
// Input fingerprint: product_identity_runs.input_fingerprint (ruleset + sorted fact ids/values/locations)
// Stored on: product_identity_runs
```

**Pattern:** Every derived artifact stores an `input_fingerprint` composed of its **exact input artifact IDs + their versions + processor versions**. Freshness = fingerprint match.

---

## 10. Freshness / Invalidation Contract

### Current State: Partial, Inconsistent

| Upstream Change | Downstream Invalidated? | Mechanism |
|-----------------|------------------------|-----------|
| BOQ Extraction superseded | Requirement Profile (partial) | `specification-extraction-api.mjs` lines 110-154: supersedes profiles for BOQ items with **Confirmed** links to changed requirements |
| Spec Extraction superseded | Requirement Profile (partial) | Same as above |
| BOQ Extraction superseded | Engineering Facts (scope_type='BOQ Item') | **NO** — not auto-invalidated |
| BOQ Extraction superseded | Product Match Runs | **NO** — not auto-invalidated |
| Requirement Profile superseded | Engineering Facts (scope_id=BOQ Item) | **NO** — not auto-invalidated |
| Requirement Profile superseded | Product Match Runs | **NO** — not auto-invalidated |
| Drawing Intake superseded | Symbol Recognition | **YES** — fingerprint includes intake output_fingerprint |
| Supplier Intake superseded | Price Records | **NO** — price_records not linked to intake fingerprint |

### Correct Freshness Contract (Fingerprint-Driven)

```
An artifact is FRESH iff:
  1. Its superseded_at IS NULL
  2. ALL its input_fingerprint components resolve to current (non-superseded) artifacts
  3. ALL its input_fingerprint component versions match the stored fingerprint

Invalidation Cascade (when upstream superseded):
  1. Find all artifacts whose input_fingerprint references the superseded artifact ID
  2. For each: mark superseded_at = now, cascade to their dependents
  3. Exception: Human governance decisions (review decisions) remain immutable
     but get a derived "stale" flag for current-usability queries
```

### Scope-Based Invalidation: **REJECTED**

Test: `engineering_facts` with `scope_type='BOQ Item'` AND `scope_id=boq_item_id`

| Scenario | Same Scope? | Actually Depends? |
|----------|-------------|-------------------|
| BOQ item re-extracted (new extraction_version_id) | Yes (same scope_id) | **Only if** the fact's provenance `source_id` matches the old extraction_version_id |
| BOQ item description changed (same extraction version) | Yes | No — extraction version unchanged |
| Requirement linked to BOQ item changed | Yes (same scope_id) | **Only if** the fact's provenance `source_id` matches the changed requirement |

**Conclusion:** `scope_id` equality ≠ dependency. Dependency is **explicit** in `engineering_fact_provenance.source_id` + `source_type`. Invalidation must trace provenance links, not scope proximity.

---

## 11. Historical Approval Semantics

**Recommendation: Immutable Decision + Freshness State**

| Model | Assessment |
|-------|------------|
| **Mutation** (Approved → Stale) | 🔴 **REJECT** — destroys audit trail. An approval at T1 was valid at T1. Mutating it lies about history. |
| **Immutable Decision + Freshness State** | 🟢 **ADOPT** — Keep `boq_review_decisions` row with `status='Approved'`, `decided_at=T1`. Add a **derived** `is_stale` boolean on current-usability queries (computed from fingerprint comparison). |
| **New-Version Model** (supersede decision artifact) | 🟡 **PARTIAL** — Used correctly for `engineering_facts` (versioning + `superseded_by_id`). For human review decisions, creates confusing parallel history. Use for derived artifacts; keep human decisions immutable. |

**Implementation:** Add a computed `is_stale` flag to current-usability queries (e.g., `currentBoqEligibleForEngineeringPredicate`), not a stored column. The flag evaluates: "Does the approved item's input_fingerprint still match current upstream?"

---

## 12. Fingerprint Semantics

| Term | Current Usage | Correct Semantics |
|------|---------------|-------------------|
| **Identity Fingerprint** | "Does this represent the same input set?" | `input_fingerprint` on extraction versions — hash of (source sha256 + all component versions). Used for idempotency. |
| **Freshness Fingerprint** | "Do current upstream inputs still match?" | **Not explicitly stored.** Derived by comparing stored `input_fingerprint` against re-computed fingerprint from current upstream artifacts. |
| **Content Checksum** | "Did source bytes change?" | `document_versions.sha256` — the ultimate source of truth. |
| **Output Fingerprint** | "Did generated content change?" | `output_fingerprint` on drawing/symbol versions — hash of extraction output. Used for idempotency on re-run. |

**Terminology fix:** Stop using "fingerprint" ambiguously. Use:
- `input_fingerprint` = identity fingerprint (stored)
- `content_checksum` = document sha256
- `output_fingerprint` = output identity (stored)
- `freshness_check(input_fingerprint)` = function, not a stored value

---

## 13. Derivation Class Decision

| Class | Repository Evidence | Should Be in Data Model? |
|-------|---------------------|-------------------------|
| **Explicit** | `engineering_fact_provenance.source_type='Approved BOQ Extraction'` + `extraction_method='deterministic-source-parser'` | Already captured in provenance |
| **Derived** | `engineering_facts.derivation` text + `source_fact_id` FK | Already captured |
| **Inferred** | `engineering_facts.fact_type='Inferred'` + `model_version` on provenance | Already captured |
| **Human Governed** | `review_status='Approved'` + `decided_by` on review tables | Already captured in governance layer |

**Decision:** Do NOT add `derivation_class` or `authority_level` column. The distinction already exists across:
- `extraction_method` (on extraction versions)
- `engineering_fact_provenance.source_type` + `extraction_method/parser_version/model_version`
- `review_status` + `decided_by` (on review tables)
- `engineering_facts.fact_type` + `derivation`

Adding a unified enum would flatten meaningful domain-specific distinctions.

---

## 14. Confidence Policy

| Artifact Class | Confidence Meaningful? | Mandatory? |
|----------------|------------------------|------------|
| Deterministic extraction (BOQ, Spec, Project Context) | Yes — parser heuristic | Yes (already) |
| AI extraction (Symbol Recognition) | Yes — detection confidence | Yes (already) |
| Fuzzy product match | Yes — semantic match score | Yes (already) |
| Human review decision | No — binary approved/rejected | **No** — `boq_review_decisions` has no confidence |
| Manual confirm/override | No — governed action | **No** |
| Exact FK link (`boq_requirement_links` → `boq_items`) | No — referential integrity is binary | **No** |
| Deterministic calculation (profile consolidation) | No — deterministic | **No** |
| Engineering judgment fact | Yes — engineering confidence | Yes (already) |

**Policy:** Confidence is **per-domain optional**. Never make it `NOT NULL` universal. Deterministic links and human governance decisions have no meaningful confidence score.

---

## 15. Actor / Activity Decision

**Current state sufficient for auditability.**

| Question | Answer |
|----------|--------|
| Who generated the artifact? | `created_by` on extraction versions, `user_id` on engineering_fact_provenance, `actor` on processing_history |
| Who approved the artifact? | `reviewed_by`/`decided_by` on review decision tables |
| Was it a human or system? | System processors use literal strings (`"BOQ Extraction Engine"`, `"Classification Worker"`). Humans use user IDs. `decided_role` exists on `engineering_knowledge_decisions` and `product_library_decisions` but not on BOQ/spec review decisions. |

**Minimal fix (if any):** Add `actor_type` ('Human'|'System'|'AI') to `boq_review_decisions`, `requirement_review_decisions`, `drawing_symbol_review_events`, `product_match_reviews` for queryability. **Not required for R2.**

**No unified actor infrastructure needed.** The literal-string system actors are distinguishable from user IDs by pattern (no UUID prefix). This is a convention, not a schema requirement.

---

## 16. Review-State Policy

| Relationship Class | Requires Review Lifecycle? | Current State |
|--------------------|---------------------------|---------------|
| Deterministic extraction lineage (doc → extraction → item) | **No** — binary current/superseded | `superseded_at` only |
| Human-confirmed BOQ ↔ Requirement | **Yes** — Suggested/Confirmed/Needs Review/Rejected | `boq_requirement_links.status` ✅ |
| Human-confirmed Spec Requirement | **Yes** — Needs Review/Approved/Rejected | `technical_requirements.review_status` ✅ |
| Drawing symbol review | **Yes** — Needs Review/Reviewed | `drawing_symbol_definitions/occurrences.review_status` ✅ |
| Product match review | **Yes** — Needs Review/Approved/Selected/Rejected | `product_match_candidates.review_status` + `product_match_reviews.action` ✅ |
| Supplier quote row review | **Yes** — Needs Review/Approved/Rejected | `supplier_quote_intake_rows.review_status` ✅ |
| Calculated discrepancy (BOQ vs Drawing) | **No** — computed on read | Not stored |
| Exact FK link (`boq_items.extraction_version_id`) | **No** — referential integrity | FK constraint |

**Policy:** Review state belongs **only on governance proposals**, not on deterministic lineage. Do not add `review_status` to extraction versions, profile versions, match runs, or fact provenance.

---

## 17. R2 vs R3 Boundary

| Concept | R2 (Provenance Contract) | R3 (Revision/Addendum) |
|---------|-------------------------|------------------------|
| `input_fingerprint` composition | ✅ Define standard | — |
| `output_fingerprint` | ✅ Define standard | — |
| Invalidation cascade rules | ✅ Define fingerprint-driven cascade | — |
| Freshness computed flag | ✅ Define semantics | — |
| `effective_from`/`effective_to` on artifacts | ❌ **Defer to R3** | ✅ Add to BOQ items, requirements, price records |
| Baseline membership | ❌ **Defer to R3** | ✅ Document families, addenda |
| Partial supersession | ❌ **Defer to R3** | ✅ Revision vs addendum semantics |
| Point-in-time queries | ❌ **Defer to R3** | ✅ Query layer |

**R2 must leave open:** No `effective_from`/`effective_to` on domain artifacts. No revision hierarchy. No baseline tables. R3 owns temporal semantics.

---

## 18. Golden Validation

Using **Al Mousa School — Clean Golden Run** (read-only):

### Chain: BOQ → Requirement Profile → Product Match
- BOQ Item `b1`: `source_location{sheet:"Div 28", row:42, cells:{description:"B2",...}}`, `extraction_version_id=ev1`
- Requirement Profile `rp1`: `input_fingerprint=hash(boqItem=b1, links=[...], requirements=[...], ruleset=...)`, `boq_item_id=b1`
- Product Match Run `pmr1`: `input_fingerprint=hash(item=b1.current_values, profileId=rp1, profileFingerprint=rp1.input_fingerprint, ...)`, `requirement_profile_version_id=rp1`, `boq_item_id=b1`
- **All dependencies reconstructable today** ✅

### Chain: Specification Requirement → Engineering Fact
- Requirement `req1`: `source_location{page_from:12, page_to:13, clause:"4.2.1", section:"Fire Alarm"}`, `extraction_version_id=sev1`
- Engineering Fact `ef1`: `entity_type='Technical Requirement'`, `entity_id=req1`, `scope_type='Project'`
- Fact Provenance `fp1`: `source_type='Approved Specification Requirement'`, `source_id=req1`, `document_id=doc1`, `extraction_version_id=sev1`, `page=12`, `clause='4.2.1'`, `parser_version`, `model_version`
- **All dependencies reconstructable today** ✅

### Chain: Drawing Intake → Symbol Recognition
- Drawing Intake `di1`: `input_fingerprint=hash(sha256, parser_version)`, `output_fingerprint=hash(result)`, `document_id=doc1`
- Symbol Recognition `sr1`: `input_fingerprint` (includes `di1.output_fingerprint`), `engine_version`, `document_id=doc1`
- Symbol Occurrence `so1`: `recognition_version_id=sr1`, `definition_id=sd1`, `occurrence_key`, `bounding_box`, `match_basis`
- **All dependencies reconstructable today** ✅

### Chain: Supplier Intake → Price Record
- Supplier Intake Run `sir1`: `input_fingerprint=sha256:version`, `document_id=doc1`
- Intake Row `sir_row1`: `source_location{sheet:"Sheet1", row:5}`, `raw_values`, `mapping_basis`, `promoted_price_record_id=pr1`
- Price Record `pr1`: `source_id=sir1`, `source_location="Sheet1!5"`, `provenance{projectId,supplierId,quoteId,lineId,sheet,row,itemNumber,rawValues,mappingBasis,actor,approvalAt}`
- **All dependencies reconstructable today** ✅

**Golden validation confirms:** Current per-domain provenance is sufficient for full traceability. No universal columns needed.

---

## 19. Minimal Provenance Contract v1

**Semantics only — no universal SQL template.**

### Required for Every Derived Artifact
1. **Immediate parent FK** — typed, enforced (`extraction_version_id`, `intake_version_id`, `profile_version_id`, `match_run_id`, etc.)
2. **Input fingerprint** — deterministic hash of (all input artifact IDs + their versions + all processor versions)
3. **Output fingerprint** (for extraction pipelines) — deterministic hash of extraction output
4. **Source location** — JSON with domain-appropriate coordinates (page/sheet/row/cell/clause/bbox)
5. **Version** — `version_number` + `superseded_at` for temporal authority

### Required for Every Governance Decision
1. **Decision row** — immutable, with `actor_id`, `actor_role`, `action`, `previous_value`, `new_value`, `reason`, `decided_at`
2. **No confidence column** — binary or enum status only

### Required for Every Provenance Record (Engineering Facts pattern)
1. **Fact ID** — FK to fact
2. **Source type + Source ID** — polymorphic but explicit (`source_type` text, `source_id` text)
3. **Document/Version/Extraction IDs** — nullable FKs for root traceability
4. **Coordinates** — page, sheet, row, cell, clause, section, bbox (domain-appropriate)
5. **Processor versions** — parser, model, prompt, rule, engine versions
6. **Actor** — `user_id`, `user_role`, `human_reason`

### Freshness Contract
- **Fresh** = `superseded_at IS NULL` AND `recompute_input_fingerprint() == stored_input_fingerprint`
- **Stale** = any input artifact superseded OR fingerprint mismatch
- **Invalidation** = cascade `superseded_at` along fingerprint dependency graph
- **Human decisions** = immutable; staleness is a derived query flag

### Non-Requirements (Do Not Mandate)
- ❌ Universal `source_type`/`source_id` polymorphic columns
- ❌ `root_document_id`/`root_document_version_id` denormalization
- ❌ Universal `confidence` `NOT NULL`
- ❌ Universal `authority_level` enum
- ❌ Universal `review_status` enum
- ❌ `artifact_lineage` generic table
- ❌ `derivation_class` / `authority_level` columns

---

## 20. Roadmap Reassessment

| Step | Previous | Revised | Rationale |
|------|----------|---------|-----------|
| 1 | R2A.2 Migration Design | **R2A.2 Dependency/Freshness Contract Design** | Design invalidation rules and fingerprint standards BEFORE any migration |
| 2 | R3 Study | **R3 Study** (unchanged) | Temporal semantics need dedicated study after freshness contract |
| 3 | R4 Reconciliation | **R4 Reconciliation** (unchanged) | Needs freshness contract from R2A.2 |
| 4 | R7 Authority | **R7 Authority** (unchanged) | Depends on R4 |

**Do NOT proceed to migration design.** The schema changes depend on the invalidation cascade rules which are not yet specified.

---

## 21. Next Recommended Step

**DOC-R2A.2 — Dependency/Freshness Contract Design**

Scope:
1. Define exact `input_fingerprint` composition standard per domain (canonical field order, version components)
2. Specify invalidation cascade rules as executable pseudocode:
   - Trigger: `*_extraction_versions.superseded_at` set
   - Query: Find all artifacts where `input_fingerprint` references the superseded ID
   - Action: Set `superseded_at` on dependents, recurse
   - Exception: Human review decision tables (immutable)
2. Define `is_stale` computed flag semantics for current-usability queries
3. Validate against Golden project chains
4. Produce contract document for R2A.3 implementation

**NO CODE, NO MIGRATION, NO SCHEMA CHANGES.**

---

STATUS: DOC-R2A.1R STUDY COMPLETE

NO CODE, SCHEMA, DATA, TEST, OR MIGRATION CHANGES MADE

STOPPED — awaiting architecture review before implementation.