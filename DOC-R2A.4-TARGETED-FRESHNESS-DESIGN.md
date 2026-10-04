# DOC-R2A.4 — Targeted Freshness Implementation Design Report

## 1. Executive Verdict

**GO — TARGETED R2 IMPLEMENTATION CAN BEGIN**

Three gaps confirmed with implementation-ready designs. All changes are minimal, scoped, and justified by repository evidence. No R3/R4 dependencies block these fixes.

---

## 2. Dynamic Subagent Work

No subagents spawned. Primary agent performed all verification via direct schema/code inspection.

---

## 3. Re-verification of Three Candidate Gaps

| Gap | Verdict | Evidence | Requires Persistence Change? |
|-----|---------|----------|------------------------------|
| **Gap A: `consolidated_profile_requirements.governing_source_id`** | **VERIFIED** | `governingSourceId` in `consolidateRequirements()` (technical-requirement-engine.mjs:162) is always `governing.id` where `governing` is a `technical_requirements` row. `sourceType` is hardcoded `"Specification"` in loadInputs (technical-requirement-api.mjs:85). Never null. | **YES** — Add FK to `technical_requirements` |
| **Gap B: `price_records` → supplier intake row** | **VERIFIED** | Promotion chain: `supplier_quote_intake_rows` → `supplier_quote_lines` (has `source_intake_row_id`) → `price_records` (only `source_id` to `product_sources`, `source_location` JSON). NO `source_intake_row_id` on `price_records`. | **YES** — Add `source_intake_row_id` FK to `supplier_quote_intake_rows` |
| **Gap C: Engineering Facts freshness** | **VERIFIED** | Facts published via `publishApprovedEngineeringKnowledge` (engineering-knowledge-api.mjs:16) create provenance rows with `extraction_version_id`. NO auto-invalidation when extraction superseded. `engineering_facts` has `status`/`superseded_by_id` but no auto-invalidation logic. | **YES** — Add application-layer invalidation trigger |

---

## 4. Governing Source Semantics (Gap A)

### Current Behavior
- `governing_source_id` in `consolidated_profile_requirements` = `governing.id` from `consolidateRequirements()` 
- `governing` = highest-precedence requirement in a consolidated group (sorted by `statusAwareSourceAuthority`)
- Input `requirements` array ONLY contains `technical_requirements` rows (from `boq_requirement_links` join)
- `sourceType` is hardcoded `"Specification"` for all entries
- `governingSourceId` is NEVER null (group always has ≥1 entry)
- All entries in a group share `sourceType: "Specification"`

### Design Decision: Option A — Real FK to `technical_requirements`

```sql
ALTER TABLE consolidated_profile_requirements 
ADD CONSTRAINT fk_governing_source 
FOREIGN KEY (governing_source_id) 
REFERENCES technical_requirements(id) ON UPDATE NO ACTION ON DELETE NO ACTION;
```

**Why not other options:**
- Option B (typed columns): Only one source type exists
- Option C (authority ≠ dependency): It IS the governing dependency for the consolidated requirement
- Option D (existing sufficient): No FK = no referential integrity

**Migration:** Add FK constraint only. No data backfill needed (values already valid).

---

## 5. Price Record Dependency Design (Gap B)

### Current Chain
```
Document Version
→ Supplier Quote Intake Run (supplier_quote_intake_runs)
→ Supplier Quote Intake Row (supplier_quote_intake_rows, id = row.id)
→ Supplier Quote Line (supplier_quote_lines, source_intake_row_id = row.id)
→ Price Record (price_records, source_id → product_sources, source_location = provenance JSON)
```

### Missing Link
`price_records` has:
- `source_id` → `product_sources` (FK)
- `source_location` = provenance JSON (contains `sheet`, `row`, `itemNumber` but unqueryable)

Missing: **Direct FK to `supplier_quote_intake_rows`**

### Design Decision: Option A — Direct FK

```sql
ALTER TABLE price_records 
ADD COLUMN source_intake_row_id TEXT;

ALTER TABLE price_records
ADD CONSTRAINT fk_price_intake_row
FOREIGN KEY (source_intake_row_id)
REFERENCES supplier_quote_intake_rows(id) 
ON UPDATE NO ACTION ON DELETE NO ACTION;
```

**Population at promotion time** (supplier-price-intake-api.mjs:162):
```javascript
// Add to price_records INSERT:
source_intake_row_id = row.id  // row = supplier_quote_intake_rows
```

**Why not other options:**
- Option B (FK to quote line only): Adds indirection; quote line → intake row is 1:1 but extra hop
- Option C (existing chain sufficient): Provenance JSON is unqueryable; no FK integrity
- Option D (separate provenance table): Over-engineering; single FK is sufficient

---

## 6. Engineering Fact Freshness Semantics (Gap C)

### Current State
- Facts published via `publishApprovedEngineeringKnowledge()` create:
  - `engineering_facts` row: `status='Active'`, `superseded_by_id=NULL`
  - `engineering_fact_provenance` rows: `source_type` ∈ {'Approved BOQ Extraction', 'Approved Specification Requirement'}, `extraction_version_id`
- NO auto-invalidation when upstream extraction superseded
- Fact stays `Active` until explicit `superseded_by_id` set

### Semantic Analysis

| Case | Provenance A | Provenance B | Fact Validity | Current Behavior |
|------|--------------|--------------|---------------|------------------|
| Spec v1=X, Spec v2=X | Superseded | Current | **Valid** | Stays Active ✓ |
| Spec v1=X, Spec v2=Y | Superseded | Current | **Conflict** | Stays Active ✗ |
| Spec=X, AHJ=X | Superseded | Current | **Valid** | Stays Active ✓ |
| Two required inputs, one changes | Current | Superseded | **Invalid** | Stays Active ✗ |

### Design Decision: **Support Freshness** (not Source-Currentness)

**Rule:** An engineering fact is FRESH iff:
1. `status='Active'` AND `superseded_by_id IS NULL` (own lifecycle current)
2. **AND** at least one provenance source is:
   - `source_type` = 'Approved BOQ Extraction' AND `extraction_version_id` points to CURRENT (non-superseded) extraction
   - OR `source_type` = 'Approved Specification Requirement' AND requirement's extraction version is CURRENT
   - OR `source_type` ∈ {'AHJ Decision', 'Code/Standard', 'Manufacturer Technical'} (non-extraction authorities — always "current" unless explicitly revoked)

**Invalidation Trigger (Push, same transaction):**
When `*_extraction_versions.superseded_at` is set:
```javascript
async function invalidateDependentEngineeringFacts(db, supersededExtractionId) {
  // 1. Find facts with provenances pointing to superseded extraction
  const affectedFactIds = await db.prepare(`
    SELECT DISTINCT efp.fact_id
    FROM engineering_fact_provenance efp
    WHERE efp.extraction_version_id = ?
      AND efp.source_type IN ('Approved BOQ Extraction', 'Approved Specification Requirement')
  `).bind(supersededExtractionId).all();

  // 2. For each fact, check if ANY provenance remains current
  for (const {fact_id} of affectedFactIds.results) {
    const currentProvenances = await db.prepare(`
      SELECT COUNT(*) as cnt
      FROM engineering_fact_provenance efp
      JOIN boq_extraction_versions bev ON bev.id = efp.extraction_version_id
      WHERE efp.fact_id = ?
        AND efp.source_type IN ('Approved BOQ Extraction', 'Approved Specification Requirement')
        AND bev.superseded_at IS NULL
    `).bind(fact_id).first();

    // If NO current extraction provenances AND no non-extraction provenances
    const nonExtractionProvs = await db.prepare(`
      SELECT COUNT(*) as cnt
      FROM engineering_fact_provenance efp
      WHERE efp.fact_id = ?
        AND efp.source_type NOT IN ('Approved BOQ Extraction', 'Approved Specification Requirement')
    `).bind(fact_id).first();

    if (currentProvenances.cnt === 0 && nonExtractionProvs.cnt === 0) {
      // ALL provenances superseded → supersede the fact
      await db.prepare(`
        UPDATE engineering_facts 
        SET status='Superseded', superseded_by_id=?, change_reason='All source extractions superseded'
        WHERE id=? AND status='Active'
      `).bind(newFactId || null, fact_id).run(); // newFactId = null if no replacement
    }
  }
}
```

**Key principle:** Fact becomes stale only when **ALL** extraction-based provenances are superseded AND no authoritative non-extraction provenance exists.

---

## 7. Fingerprint Terminology

### Formal Distinction (No Migration Required)

| Kind | Standard Term | Purpose | Current Fields |
|------|---------------|---------|----------------|
| **Source-Processing Fingerprint** | `input_fingerprint` | "Same source + same processor = same extraction context" | Extraction versions: `boq_extraction_versions`, `specification_extraction_versions`, `drawing_intake_versions`, `supplier_quote_intake_runs`, `project_context_extraction_versions` |
| **Dependency-Set Fingerprint** | `generation_fingerprint` | "Same dependency set + same config = same generated artifact" | Generation artifacts: `requirement_profile_versions`, `product_match_runs`, `product_identity_runs`, `pricing_learning_runs`, `engineering_graph_versions`, `drawing_symbol_recognition_versions` |

### Standardization Action
- **Documentation only** — no schema migration
- Update code comments and new field names to use `generation_fingerprint` for dependency-set fingerprints
- Existing `input_fingerprint` fields on generation artifacts are legacy naming; document the distinction

---

## 8. Fingerprint Composition Standard

### Source-Processing Fingerprint (`input_fingerprint` on extraction versions)
```
hash({
  content_checksum: document_sha256,        // ALWAYS
  parser_version, ruleset_version,          // ALWAYS
  model_version, prompt_version,            // IF AI involved
  engine_version,                           // IF drawing/symbol
  chunk_params: { chunk_size, page_range }  // IF chunked
})
```

### Dependency-Set Fingerprint (`generation_fingerprint` on generation artifacts)
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

### Principles
- Input IDs **always sorted** for order independence
- Input versions required for versioned artifacts
- Processor versions always included
- Content checksums NOT included (captured in input versions via extraction fingerprints)

---

## 9. Freshness Helper Contracts

### Conceptual Signatures (No Implementation)

| Helper | Input | Output |
|--------|-------|--------|
| `requirementProfileFreshness(profileId)` | `profileId` | `{freshness: 'Fresh'\|'Stale', reasons: [...], changedDependencies: [...]}` |
| `productMatchRunFreshness(matchRunId)` | `matchRunId` | `{freshness, reasons, changedDependencies}` |
| `engineeringFactFreshness(factId)` | `factId` | `{freshness, reasons, staleProvenances: [...], currentProvenances: [...]}` |
| `priceRecordFreshness(priceRecordId)` | `priceRecordId` | `{freshness, reasons, commercialValidity: {...}}` |

### Computation Logic
- **Profile:** `profile.superseded_at IS NULL` ∧ `recompute_generation_fingerprint() == profile.generation_fingerprint`
- **Match Run:** `run.superseded_at IS NULL` ∧ `run.requirement_profile_version_id == currentProfileId`
- **Engineering Fact:** `fact.status='Active'` ∧ `superseded_by_id IS NULL` ∧ `has_current_provenance(fact_id)`
- **Price Record:** `pr.approval_status='Approved'` ∧ `pr.downstream_use='Costing Eligible'` ∧ `valid_until IS NULL OR valid_until >= today` ∧ `source_intake_row` current

---

## 10. Detection vs Reaction Boundary

| Layer | Responsibility |
|-------|----------------|
| **Freshness Detection** (R2) | Compute staleness, identify changed dependencies, explain WHY |
| **Reaction Policy** (Downstream) | Queue recompute, block downstream, warn, request review |

**R2 provides:** Detection + explanation + changed dependency list
**Downstream decides:** Whether to auto-recompute, require human review, or just warn

---

## 11. Application-Layer Change Origins & Trigger Design

| Change Origin | Write Path | Trigger Action |
|---------------|------------|----------------|
| Requirement approval/rejection | `specification-extraction-api.mjs` lines 238-244 | Supersede dependent profiles (push, same batch) |
| Spec extraction superseded | `specification-extraction-api.mjs` lines 110-154 | Supersede profiles with Confirmed links |
| BOQ extraction superseded | `boq-extraction-api.mjs` line 122 | New extraction version created; profiles invalidated via link check |
| Supplier intake promotion | `supplier-price-intake-api.mjs` line 162 | Set `price_records.source_intake_row_id` |
| Extraction superseded (any) | Centralized helper | Invalidate dependent engineering facts (new) |

### Pseudocode: Centralized Invalidation Helper
```javascript
async function invalidateDownstreamOnExtractionSuperseded(db, supersededExtractionId, newExtractionId) {
  const extraction = await db.prepare("SELECT * FROM * WHERE id=?").bind(supersededExtractionId).first();
  
  if (extraction.type === 'BOQ') {
    // 1. Profiles with Confirmed links to requirements from this extraction
    await supersedeProfilesWithLinksToExtraction(db, supersededExtractionId);
    
    // 2. Engineering facts with provenance to this extraction
    await invalidateEngineeringFactsWithProvenance(db, supersededExtractionId);
  }
  
  if (extraction.type === 'Specification') {
    // 1. Profiles with Confirmed links to changed requirements
    await supersedeProfilesWithLinksToExtraction(db, supersededExtractionId);
    
    // 2. Engineering facts
    await invalidateEngineeringFactsWithProvenance(db, supersededExtractionId);
  }
  
  if (extraction.type === 'Supplier Quote') {
    // Price records from this intake run
    await invalidatePriceRecordsFromIntakeRun(db, supersededExtractionId);
  }
}
```

---

## 12. Transaction Boundaries & Idempotency

| Trigger | Transaction | Failure Handling |
|---------|-------------|------------------|
| Requirement approval → Profile supersession | **Same batch** (spec-extraction-api.mjs:238-244) | Fails → approval fails |
| Extraction supersession → Profile supersession | **Same batch** (spec-extraction-api.mjs:110-154) | Fails → extraction supersession fails |
| Engineering fact invalidation | **Same batch** as extraction supersession | Best-effort (logged, not blocking) |
| Price record FK population | **Same batch** as promotion | Fails → promotion fails |

**Idempotency:** All invalidation uses `WHERE superseded_at IS NULL` guards. Re-running is safe.

---

## 13. Stored vs Derived State

| State | Persisted | Derived |
|-------|-----------|---------|
| `superseded_at` | ✅ | — |
| `generation_fingerprint` | ✅ | — |
| `source_intake_row_id` (price) | ✅ | — |
| `governing_source_id` FK | ✅ | — |
| `is_stale` | ❌ | ✅ Computed at query time |
| `fresh` / `stale` | ❌ | ✅ Computed |
| `usable` | ❌ | ✅ Computed |

**No stored boolean flags.** All freshness/usability computed at read time.

---

## 14. Golden Validation Plan (Read-Only)

| Scenario | Validation Query | Expected |
|----------|------------------|----------|
| **A: Requirement change → Profile stale** | `SELECT * FROM requirement_profile_versions WHERE superseded_at IS NOT NULL AND boq_item_id IN (SELECT boq_item_id FROM boq_requirement_links WHERE requirement_id = ?)` | Affected profiles have `superseded_at` set |
| **B: Profile change → Match run stale** | `SELECT * FROM product_match_runs WHERE requirement_profile_version_id != (SELECT id FROM requirement_profile_versions WHERE boq_item_id = ? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1)` | Match runs show `stale=true` via `matchRunStaleness()` |
| **C: Supplier intake change → Price record detectable** | `SELECT * FROM price_records WHERE source_intake_row_id IN (SELECT id FROM supplier_quote_intake_rows WHERE intake_run_id = ?)` | Affected price records identifiable |
| **D: Engineering fact source change → Provenance impact** | `SELECT * FROM engineering_facts ef JOIN engineering_fact_provenance efp ON efp.fact_id=ef.id WHERE efp.extraction_version_id = ? AND ef.status='Active'` | Facts with superseded provenances flagged |

**All queries are read-only against Golden.**

---

## 15. R3 Dependency Analysis

| Proposed Fix | Independent of R3? | Why |
|--------------|-------------------|-----|
| `consolidated_profile_requirements.governing_source_id` FK | ✅ **Independent** | Uses existing `technical_requirements` IDs; no revision/addendum semantics |
| `price_records.source_intake_row_id` FK | ✅ **Independent** | Uses existing `supplier_quote_intake_rows` IDs; no revision semantics |
| Engineering fact invalidation trigger | ✅ **Independent** | Uses existing `extraction_version_id` + `superseded_at`; no revision semantics |
| `generation_fingerprint` terminology | ✅ **Independent** | Documentation only |
| Freshness helper contracts | ✅ **Independent** | Computed predicates on existing data |

**All fixes are R3-independent.** They use current artifact versioning (`superseded_at`), not document revision semantics.

---

## 16. R4 Dependency Analysis

| Proposed Fix | R4 Dependency? | Why |
|--------------|----------------|-----|
| `governing_source_id` FK | ❌ | Prerequisite for R4 traceability but stands alone |
| `price_records.source_intake_row_id` | ❌ | Prerequisite for R4 costing traceability but stands alone |
| Engineering fact invalidation | ❌ | Prerequisite for R4 knowledge consistency but stands alone |
| `generation_fingerprint` terminology | ❌ | Documentation |

**None require R4.** They are prerequisites that enable R4 but work independently.

---

## 17. Minimal Future Implementation Slices

| Slice | Scope | Dependencies | Order |
|-------|-------|--------------|-------|
| **R2A.4.1** | Add `governing_source_id` FK constraint | None | 1 |
| **R2A.4.2** | Add `price_records.source_intake_row_id` FK + populate at promotion | None | 1 (parallel) |
| **R2A.4.3** | Engineering fact invalidation trigger on extraction supersession | R2A.4.1, R2A.4.2 (for complete provenance) | 2 |
| **R2A.4.4** | `generation_fingerprint` terminology documentation + helper function stubs | R2A.4.1, R2A.4.2, R2A.4.3 | 3 |
| **R2A.4.5** | Freshness helper functions (`requirementProfileFreshness`, etc.) | R2A.4.1-4 | 4 |

**Slices 1 & 2 can run in parallel.** Slice 3 depends on 1+2 for complete provenance. Slice 4 documents the terminology. Slice 5 builds on all prior.

---

## 18. Architecture Risks Remaining

| Risk | Severity | Mitigation |
|------|----------|------------|
| Engineering fact invalidation false positives | 🟡 Medium | Conservative rule: only invalidate if ALL extraction provenances gone AND no authoritative non-extraction provenance |
| Price record FK not backfilled for historical data | 🟡 Medium | New records get FK; historical records remain queryable via provenance JSON |
| Fingerprint composition drift across domains | 🟡 Medium | Standardize composition in R2A.4.4 documentation |
| `is_stale` computed cost at scale | 🔵 Low | Indexes on `superseded_at` + FK columns make checks fast |

---

## 19. Go / No-Go Decision

**GO — TARGETED R2 IMPLEMENTATION CAN BEGIN**

All three gaps are:
- ✅ Verified against current source/schema
- ✅ R3-independent
- ✅ R4-enabling but not R4-dependent
- ✅ Minimal persistence changes (2 FKs + 1 trigger)
- ✅ Derived freshness (no stored booleans)
- ✅ Testable via Golden read-only queries

---

## 20. Recommended Next Step

**DOC-R2A.5 — Implementation Slice R2A.4.1 & R2A.4.2 (Parallel)**

Execute the two FK additions as the first implementation slice:
1. `consolidated_profile_requirements.governing_source_id` FK → `technical_requirements`
2. `price_records.source_intake_row_id` FK → `supplier_quote_intake_rows` + promotion-time population

Then proceed to R2A.4.3 (engineering fact invalidation trigger).

---

STATUS: DOC-R2A.4 DESIGN COMPLETE

NO CODE, SCHEMA, DATA, TEST, OR MIGRATION CHANGES MADE

IMPLEMENTATION: GO

STOPPED — awaiting architecture review before implementation.