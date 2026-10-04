# DOC-R2A.2 — Dependency & Freshness Architecture Study Report

## 1. Executive Verdict

**No universal freshness formula exists.** The repository's freshness semantics are correctly domain-specific. A single `recompute_fingerprint() == stored_fingerprint` formula would be incorrect for:

- **Human approval decisions** (immutable, never stale)
- **Deterministic FK links** (referential integrity only, no fingerprint)
- **Engineering facts** (versioned by explicit supersession, not fingerprint)
- **Requirement profiles** (fan-in dependencies require partial invalidation)

**The core architectural finding:** Freshness is **fingerprint-driven for generated artifacts** and **version-driven for governed artifacts**. The invalidation cascade must trace explicit dependency links (FKs, link tables, provenance tables), not scope proximity.

---

## 2. Dynamic Subagent Work

No subagents were spawned. All investigation performed by primary agent through direct code/schema reading.

---

## 3. Lifecycle Vocabulary (Repository-Grounded)

| Term | Repository Meaning | Where Applied |
|------|-------------------|---------------|
| **Current** | `superseded_at IS NULL` on versioned tables | `*_extraction_versions`, `*_runs`, `*_versions`, `engineering_facts` |
| **Fresh** | `current` AND `recomputed_input_fingerprint == stored_input_fingerprint` | Extraction versions, match runs, profile versions, symbol recognition |
| **Stale** | `current` BUT `recomputed_input_fingerprint != stored_input_fingerprint` | Match runs (`matchRunStaleness`), profile versions (auto-superseded on approval) |
| **Invalid** | Explicitly disqualified by governance rule | `review_status='Auto-Rejected Technical'`, `approval_status='Rejected'`, `status='Superseded'` on engineering_facts |
| **Superseded** | `superseded_at IS NOT NULL` — replaced by newer version in same lifecycle | All versioned tables |
| **Approved** | Governance decision: `review_status='Approved'` / `status='Approved'` / `action='approve'` | Human decisions on review tables |
| **Usable / Eligible** | `current` AND `fresh` AND `approved_for_downstream=1` AND `not invalid` | Downstream eligibility predicates |
| **Requires Review** | `current` AND `review_status IN ('Needs Review', 'Suggested')` | Governance proposals |

**These concepts remain separate in the data model.** No single status enum captures them all.

---

## 4. Universal Freshness Formula Decision

**REJECTED** — One formula does not fit all artifact classes.

### Artifact-Class Freshness Rules

| Artifact Class | Has Own Lifecycle? | Has Fingerprint? | Recomputable? | Exact Dependencies? | Freshness Rule |
|----------------|-------------------|------------------|---------------|---------------------|----------------|
| **Extraction Version** (BOQ, Spec, Drawing, Supplier, Project Context) | ✅ `superseded_at` | ✅ `input_fingerprint` + `output_fingerprint` | ✅ Yes (source bytes + versions) | Source doc sha256 + processor versions | `superseded_at IS NULL` ∧ `recompute == stored` |
| **BOQ Item** | ✅ Via extraction version | ❌ No own fingerprint | N/A | `extraction_version_id` FK | Fresh iff extraction version is fresh |
| **Technical Requirement** | ✅ Via extraction version | ❌ No own fingerprint | N/A | `extraction_version_id` + `clause_id` FKs | Fresh iff extraction version is fresh |
| **Requirement Profile** | ✅ `superseded_at` | ✅ `input_fingerprint` (composite) | ✅ Yes (inputs + ruleset) | BOQ item + links + requirements + facts + ruleset | `superseded_at IS NULL` ∧ `recompute == stored` |
| **Engineering Fact** | ✅ `version_number` + `superseded_by_id` | ❌ No fingerprint on fact | N/A | `engineering_fact_provenance.source_id` + `source_type` | Fresh iff `status='Active'` ∧ `superseded_by_id IS NULL` |
| **Product Identity** | ✅ `superseded_at` (org-level) | ✅ `input_fingerprint` on run | ✅ Yes (facts + ruleset) | Knowledge facts + ruleset | `superseded_at IS NULL` ∧ `recompute == stored` |
| **Product Match Run** | ✅ `superseded_at` | ✅ `input_fingerprint` (composite) | ✅ Yes (inputs + ruleset) | Profile + understanding + prices + ruleset | `superseded_at IS NULL` ∧ `requirement_profile_version_id == current` |
| **Symbol Recognition** | ✅ `superseded_at` | ✅ `input_fingerprint` + `output_fingerprint` | ✅ Yes (intake output + engine) | Intake output + engine version | `superseded_at IS NULL` ∧ `recompute == stored` |
| **Confirmed Link** (`boq_requirement_links`) | ✅ `superseded_at` | ❌ No fingerprint | N/A | `boq_item_id` + `requirement_id` FKs | Fresh iff `superseded_at IS NULL` ∧ `status='Confirmed'` |
| **Human Approval Decision** | ❌ Immutable | ❌ No fingerprint | N/A | N/A | **Never stale** — immutable audit |
| **Price Record** | ❌ No versioning | ❌ No fingerprint | N/A | `source_id` + `product_id` FKs | `approval_status='Approved'` ∧ `downstream_use='Costing Eligible'` ∧ `valid_until` check |

**Key insight:** `superseded_at` is a **lifecycle** marker, not a freshness marker. Freshness is a **derived** property for generated artifacts.

---

## 5. Dependency Inventory

| Parent → Child | Type | Persistence | Fingerprint Component | Current Behavior on Parent Change |
|----------------|------|-------------|----------------------|-----------------------------------|
| **BOQ Extraction Version → BOQ Item** | Explicit | FK `extraction_version_id` | Extraction version `input_fingerprint` | New extraction version supersedes old; items get new version |
| **BOQ Item → Requirement Profile** | Explicit | `profile.boq_item_id` FK + `input_fingerprint` includes `boqItem` | `boqItem` object in fingerprint | Profile `superseded_at` set on BOQ re-extraction (if Confirmed links exist) |
| **Spec Extraction Version → Technical Requirement** | Explicit | FK `extraction_version_id` | Extraction version `input_fingerprint` | New extraction supersedes old; requirements get new version |
| **Technical Requirement → Engineering Fact** | Explicit | `engineering_fact_provenance` (source_type='Approved Specification Requirement', source_id=requirement.id) | Not on fact; provenance has `extraction_version_id` | Fact NOT auto-invalidated (gap) — requires explicit supersession |
| **Technical Requirement → Requirement Profile** | Explicit | `boq_requirement_links` (FK `requirement_id`) + `profile.input_fingerprint` includes requirements | `requirements` array in fingerprint | Profile `superseded_at` set on requirement approval (lines 238-244) |
| **BOQ Item → Product Match Run** | Explicit | FK `boq_item_id` + `requirement_profile_version_id` | `item.current_values` + `profileFingerprint` | Match run staleness = `run.requirement_profile_version_id != currentProfileId` |
| **Drawing Intake → Symbol Recognition** | Explicit | FK `drawing_intake_version_id` on recognition version | Recognition `input_fingerprint` includes intake output | New intake supersedes old; recognition `input_fingerprint` changes |
| **Symbol Recognition → Symbol Occurrence** | Explicit | FK `recognition_version_id` + `definition_id` | Not on occurrence; recognition version has fingerprint | New recognition supersedes old occurrences |
| **Supplier Intake Run → Intake Row** | Explicit | FK `intake_run_id` | Run `input_fingerprint` (sha256 + version) | New intake run supersedes old rows |
| **Supplier Intake Row → Price Record** | Explicit | `promoted_price_record_id` FK on row; `source_id` on price record | Not on price record; provenance JSON on price record | Price record NOT auto-invalidated (gap) |
| **Engineering Fact → Requirement Profile** | Reconstructable | `engineering_facts.scope_id` = BOQ item id | Not on fact | Fact NOT auto-invalidated (gap) |
| **Requirement Profile → Consolidated Profile Requirement** | Explicit | FK `profile_version_id` + `governing_source_id` (text, not FK) | Not on consolidated | Consolidated NOT auto-invalidated (gap) |

### Dependency Classification

| Category | Examples | Eligible for Auto-Freshness Impact? |
|----------|----------|-------------------------------------|
| **Explicit Dependency** | FK, link table, provenance row, fingerprint component | ✅ Yes |
| **Reconstructable Dependency** | `engineering_facts` via `scope_id` + `scope_type` | ⚠️ Only if provenance link exists |
| **Probable Association** | Same project, same product, same BOQ item scope | ❌ No |
| **No Dependency** | Unrelated artifacts | ❌ No |

---

## 6. Fingerprint Taxonomy

| Fingerprint Kind | Composition | Stored On | Semantics | Current Usage Consistency |
|-----------------|-------------|-----------|-----------|---------------------------|
| **Content Checksum** | `document_versions.sha256` | `document_versions` | Source bytes identity | ✅ Consistent — all extraction pipelines start here |
| **Input-Set Fingerprint** | `sha256 + processor_versions` (BOQ/Spec/Project Context) or `sha256:version` (Supplier/Project Context) or `sha256 + parser` (Drawing) | `*_extraction_versions`, `*_intake_runs`, `*_intake_versions` | Exact inputs used | ⚠️ **Inconsistent composition** — some include parser/ruleset/model/prompt, others only sha256+version |
| **Processor/Config Fingerprint** | Parser/ruleset/model/prompt/engine versions | Embedded in input-set fingerprint | Processor identity | ✅ Included in input-set fingerprint |
| **Output Fingerprint** | `hash(extraction_output)` | `drawing_intake_versions`, `drawing_symbol_recognition_versions`, `drawing_structure_versions`, `drawing_legend_geometry_versions` | Generated content identity | ✅ Consistent — used for idempotency |
| **Composite Generation Fingerprint** | Hash of (all input IDs + versions + processor versions + ruleset) | `requirement_profile_versions`, `product_match_runs`, `product_identity_runs`, `pricing_learning_runs`, `engineering_discovery_runs`, `engineering_graph_versions` | Complete generation identity | ✅ Consistent pattern — all inputs + versions + config |
| **Decision Fingerprint** | Hash of (decision inputs) | `product_match_reviews.evidence.decisionFingerprint`, `pricing_learning_runs` | Decision identity | ⚠️ Ad-hoc, not standardized |

**Critical Finding:** The term `input_fingerprint` is **overloaded** — sometimes means "input-set fingerprint" (extraction versions), sometimes "composite generation fingerprint" (profile/match runs). They are semantically different.

---

## 7. IDs vs Values Inside Fingerprints

### Current Behavior Analysis

| Scenario | Current Behavior | Correct? |
|----------|------------------|----------|
| **Same parent ID, value changes** (re-extraction) | New extraction version → new `input_fingerprint` (sha256 changes) → child fingerprint changes | ✅ Correct |
| **New parent ID, identical content** (re-upload same file) | Same sha256 → same extraction `input_fingerprint` → idempotent (no new version) | ✅ Correct |
| **Processor version changes, source unchanged** | New extraction version → new `input_fingerprint` (parser version in hash) → child fingerprint changes | ✅ Correct |
| **Ruleset/model changes, source unchanged** | New profile/match run → new `input_fingerprint` (ruleset in hash) → new version | ✅ Correct |

### Fingerprint Composition Requirements

**For composite generation fingerprints (profiles, matches, identities):**
```
hash({
  // Exact input artifact IDs
  input_ids: { boq_item_id, profile_version_id, ... },
  // Input artifact versions (for those with versions)
  input_versions: { extraction_version_id: v, profile_version: n, ... },
  // All processor/config versions
  processor_versions: { parser, ruleset, model, prompt, engine },
  // Config identifiers
  config: { ruleset_id, search_version, ... }
})
```

**For input-set fingerprints (extraction versions):**
```
hash({
  content_checksum: document_sha256,
  parser_version, ruleset_version, model_version, prompt_version, engine_version,
  chunk_params: { chunk_size, page_range } // if applicable
})
```

---

## 8. Exact-Input Persistence

| Derived Artifact | Can Answer "Exact Versions Used?" | How |
|-----------------|-----------------------------------|-----|
| **Extraction Version** | ✅ Yes | `document_version_id` FK + `input_fingerprint` (sha256 + versions) |
| **BOQ Item** | ✅ Yes | `extraction_version_id` FK → extraction version |
| **Technical Requirement** | ✅ Yes | `extraction_version_id` FK + `clause_id` FK |
| **Requirement Profile** | ✅ Yes | `input_fingerprint` includes exact `boq_item_id`, `links`, `requirements` arrays with IDs; `requirement_profile_version_id` on profile |
| **Engineering Fact** | ✅ Yes | `engineering_fact_provenance` has `source_type`, `source_id`, `extraction_version_id`, `document_id`, `document_version_id` |
| **Product Match Run** | ✅ Yes | `input_fingerprint` includes `profileId`, `profileFingerprint`, `understandingFingerprint`, `prices`, `candidateFingerprint` |
| **Product Identity** | ✅ Yes | `product_identity_runs.input_fingerprint` = `rulesetVersion:sorted(fact.id, fact.normalized_value, fact.source_location)` |
| **Drawing Symbol Recognition** | ✅ Yes | `input_fingerprint` includes intake output; `output_fingerprint` for idempotency |
| **Consolidated Profile Requirement** | ⚠️ Partial | `governing_source_id` is TEXT not FK; `profile_version_id` FK only |
| **Price Record** | ⚠️ Partial | `source_id` FK + `provenance` JSON (has raw IDs) but no fingerprint |

**Gap:** `consolidated_profile_requirements.governing_source_id` is untyped TEXT, not FK. `price_records` lack fingerprint for exact traceability.

---

## 9. Fan-In Semantics

### Requirement Profile (Fan-In)
```
Inputs: BOQ Item v3
       + Requirement A v2 (Confirmed link)
       + Requirement B v1 (Confirmed link)
       + Engineering Facts (scope_type='BOQ Item', scope_id=item)
       + Source Facts (active)
       + Ruleset v5
```
**Current behavior:** ANY input change → entire profile `superseded_at` + new version generated.
- **Partial recomputation?** No — entire profile regenerated
- **Granularity?** Profile-level only
- **Partial invalidation?** Not supported — all-or-nothing

### Product Match Run (Fan-In)
```
Inputs: Requirement Profile v3
       + Understanding Facts (approved)
       + Price Records (approved)
       + Search Config v2
       + AI Config v1
```
**Current behavior:** ANY input change → new match run (new `input_fingerprint`). Staleness detected at READ time via `requirement_profile_version_id` mismatch.

### Drawing + BOQ + Spec Reconciliation (Future Fan-In)
No dedicated table exists. Would need `drawing_requirement_links` + `boq_drawing_quantity_links` + reconciliation artifact.

---

## 10. Fan-Out / Change Impact

### Technical Requirement (Fan-Out)
```
Changed Requirement v3
    ↓
boq_requirement_links (Confirmed) → Requirement Profiles (auto-superseded via approval)
    ↓
Product Match Runs (stale at read time via profile version mismatch)
    ↓
Safety Decisions (bound to match run candidates)
    ↓
Pricing Lines (bound to match run)
```
**Discovery mechanism:** Domain-specific queries, not generic graph. `loadConfirmedLinkedItems` finds affected BOQ items.

### BOQ Extraction (Fan-Out)
```
Changed BOQ Extraction v2
    ↓
BOQ Items (new extraction version)
    ↓
Requirement Profiles (if Confirmed links to requirements)
    ↓
Engineering Facts (scope_type='BOQ Item', scope_id) — NOT auto-invalidated (gap)
    ↓
Product Match Runs (via profile)
```

### Supplier Quote Intake (Fan-Out)
```
New Supplier Intake Run
    ↓
Intake Rows (review_status='Needs Review')
    ↓
Promoted → Supplier Quote Lines
    ↓
Promoted → Price Records (provenance JSON only)
```
Price records NOT auto-invalidated when intake re-run.

---

## 11. Historical Approvals Contract

### Immutable Decision + Derived Freshness

| Decision Table | Immutable? | Freshness Derived? |
|----------------|------------|-------------------|
| `boq_review_decisions` | ✅ Yes | Derived: `item.review_status='Approved'` ∧ `approved_for_downstream=1` ∧ item fresh |
| `requirement_review_decisions` | ✅ Yes | Derived: `requirement.review_status='Approved'` ∧ `approved_for_downstream=1` ∧ requirement fresh |
| `requirement_profile_decisions` | ✅ Yes | Derived: `profile.superseded_at IS NULL` ∧ `approved_for_matching=1` |
| `product_match_reviews` | ✅ Yes | Derived: `candidate.review_status IN ('Approved','Selected')` ∧ match run fresh |
| `engineering_knowledge_decisions` | ✅ Yes | Derived: `fact.status='Active'` ∧ `superseded_by_id IS NULL` |
| `product_match_reviews` (auto-reject) | ✅ Yes | `action='Auto-Rejected Technical'` never changes |

### Computed Current-State Flags

| Reader Query | Computed Flag |
|--------------|---------------|
| `currentBoqEligibleForEngineeringPredicate` | `review_status IN ('Approved','Accepted','Auto Verified')` ∧ `approved_for_downstream=1` ∧ item fresh |
| `matchRunStaleness` | `run.requirement_profile_version_id != currentProfileId` |
| `requirementProfile` current | `superseded_at IS NULL` |
| `engineering_facts` current | `status='Active'` ∧ `superseded_by_id IS NULL` |

**All approvals remain immutable.** Freshness is a **computed predicate** at query time, not a stored mutation on the decision row.

---

## 12. Stale vs Superseded Decision

| Concept | Meaning | Trigger |
|---------|---------|---------|
| **Superseded** | A newer version explicitly replaced this artifact in its versioned lifecycle | New extraction/run/version created with `superseded_at` on previous |
| **Stale** | Artifact is current (`superseded_at IS NULL`) but its inputs no longer match the recorded fingerprint | Fingerprint mismatch at read time (match run) OR auto-superseded on upstream approval (profile) |
| **Invalid** | Explicitly disqualified by governance/safety rule | `review_status='Auto-Rejected Technical'`, `status='Superseded'` on engineering_facts, `approval_status='Rejected'` |

**Rule:** Supersession = explicit replacement. Staleness = dependency drift detected. They are **not synonyms**.

---

## 13. Invalidation Contract

### When "Invalid" Applies
- Source explicitly withdrawn (`document.deleted_at` set)
- Governing document superseded with incompatible change
- Dependency deleted (`FK` target gone)
- Engineering decision revoked (`engineering_facts.status='Superseded'`)
- Safety/authority rule blocks use (`review_status='Auto-Rejected Technical'`)
- Corrupted extraction (`error_code` set on extraction version)
- Model/ruleset formally rejected (`status='Rejected'` on processor version)

**Ordinary dependency drift (staleness) is NOT "invalid".**

---

## 14. Current Usability Contract

```
USABLE =
  current (superseded_at IS NULL)
  AND fresh (fingerprint matches OR no fingerprint)
  AND authorized (approved_for_downstream=1 OR approved_for_matching=1 OR approval_status='Approved'+downstream_use='Costing Eligible')
  AND not invalid (review_status NOT IN ('Rejected','Auto-Rejected Technical','Superseded'))
  AND domain-specific additional conditions
```

| Domain | Additional Conditions |
|--------|----------------------|
| **BOQ Item** | `review_status IN ('Approved','Accepted','Auto Verified')` |
| **Technical Requirement** | `review_status='Approved'` ∧ `approved_for_downstream=1` |
| **Requirement Profile** | `readiness_status IN ('Ready for Matching','Ready with Warnings','Approved')` ∧ `approved_for_matching=1` |
| **Product Match Candidate** | `review_status IN ('Approved','Selected')` ∧ match run fresh |
| **Price Record** | `approval_status='Approved'` ∧ `downstream_use='Costing Eligible'` ∧ `valid_until` check (or currency gate removed per policy) |
| **Drawing Asset/Occurrence** | `review_status IN ('Reviewed','Approved')` ∧ intake/recognition fresh |

---

## 15. Reprocessing / Review Policy Boundary

| Staleness Detected On | Remediation Policy |
|----------------------|-------------------|
| **Match Run** (stale at read) | Queue new match run (`status='Queued'`); engineer reviews new candidates |
| **Requirement Profile** (superseded on approval) | Auto-regenerate profile (`refreshRequirementApprovalProfiles`); if fails, mark failed, engineer re-triggers |
| **Extraction Version** (superseded) | New extraction auto-queued on document re-upload; engineer can manually trigger |
| **Drawing Symbol Recognition** (intake changed) | New recognition auto-queued; engineer reviews new symbols |
| **Engineering Fact** (scope changed) | **No auto-invalidation** — requires explicit `superseded_by_id` (gap) |
| **Price Record** (intake re-run) | **No auto-invalidation** — requires manual review (gap) |

**Policy:** Freshness layer identifies impact. It does NOT automatically decide all remediation. Deterministic reprocessing is queued; governance decisions require human action.

---

## 16. Change-Impact Model (Conceptual)

```
Changed Requirement R1 (v2 → v3, approved)
    │
    ├─→ boq_requirement_links (Confirmed, scope_id=BOQ Item B1)
    │      │
    │      └─→ Requirement Profile for B1 (superseded_at set, new version queued)
    │            │
    │            ├─→ Product Match Run for B1 (stale at read: profile version mismatch)
    │            │      └─→ Safety Decisions (bound to old match run candidates)
    │            │            └─→ Pricing Lines (bound to match run)
    │            │
    │            └─→ Engineering Facts (scope_type='BOQ Item', scope_id=B1)
    │                   └─→ NOT auto-invalidated (gap)
    │
    └─→ boq_requirement_links (Confirmed, scope_id=BOQ Item B2)
           │
           └─→ Requirement Profile for B2 (same cascade)
```

**Output for engineer:**
- Affected artifact: Requirement Profile v3 for B1
- Dependency path: R1 (Confirmed link) → Profile v3
- Why affected: R1 approved, Confirmed link exists
- Current freshness: Profile superseded (new version queued)
- Current approval: Profile was `approved_for_matching=1`
- Recommended action: Wait for auto-regeneration, then re-run matching

---

## 17. Golden Change Simulations (Read-Only)

### Scenario 1: Specification Requirement Changes (R1 v2→v3 approved)
**Direct dependents:** Requirement Profiles for BOQ items with Confirmed links to R1
**Indirect dependents:** Product Match Runs, Safety Decisions, Pricing Lines
**Stale:** Profiles (auto-superseded), Match Runs (stale at read)
**Historically intact:** Approval decisions on R1, Confirmed link rows
**Requires recompute:** Profiles (auto), Match Runs (engineer triggers)

### Scenario 2: BOQ Quantity Changes (B1 re-extracted v2→v3)
**Direct dependents:** Requirement Profiles (if Confirmed links exist)
**Indirect dependents:** Product Match Runs, Engineering Facts (scope_type='BOQ Item')
**Stale:** Profiles (auto-superseded), Match Runs
**Engineering Facts:** NOT auto-invalidated (gap — requires explicit supersession)
**Requires recompute:** Profiles (auto), Match Runs (engineer triggers)

### Scenario 3: Drawing Intake Version Changes (re-analyzed)
**Direct dependents:** Symbol Recognition (input_fingerprint includes intake output)
**Indirect dependents:** Symbol Occurrences, Drawing Extraction Proposals
**Stale:** Recognition (new version), Occurrences (new recognition version)
**Historically intact:** Previous recognition version, approved geometry versions
**Requires recompute:** Recognition (auto on new intake), engineer reviews new symbols

### Scenario 4: Product Knowledge Fact Changes (new fact added)
**Direct dependents:** Product Identity (next materialization run)
**Indirect dependents:** Product Match Runs (via product identity), Pricing
**Stale:** Identity (next run new fingerprint), Match Runs (if re-run)
**Historically intact:** Previous identity versions, previous match runs
**Requires recompute:** Identity (engineer triggers or scheduled), Match Runs (engineer triggers)

### Scenario 5: Supplier Quote Replaced (new intake run)
**Direct dependents:** Intake Rows (new run), Promoted Quote Lines, Promoted Price Records
**Indirect dependents:** Costing Selection, Pricing Lines
**Stale:** Previous intake run, previous price records (if re-promoted)
**Historically intact:** Previous intake run, audit events, review decisions
**Requires recompute:** Engineer reviews new intake, promotes new prices

---

## 18. External Evidence

### Repository Evidence (Primary)
- Fingerprint-driven idempotency on all generation pipelines
- `superseded_at` for lifecycle, fingerprint comparison for freshness
- Domain-specific invalidation (profiles on approval, match runs at read)
- Immutable audit/decision rows
- Explicit FK/link/provenance dependency tracking

### External Evidence (Alignment Only)
| Source | Principle | Repository Alignment |
|--------|-----------|---------------------|
| **W3C PROV** | `wasGeneratedBy`, `wasDerivedFrom`, `wasInvalidatedBy` | Matches: `engineering_fact_provenance` (derivation), `superseded_at` (invalidation) |
| **NASA Traceability** | Forward/backward traceability, change impact analysis | Matches: `loadConfirmedLinkedItems` (forward), `matchRunStaleness` (backward) |
| **D1/SQLite FKs** | Referential integrity for identity | Matches: Typed FKs on all domain relationships |
| **Temporal Tables (SQL:2011)** | System-versioning | Matches: Manual `superseded_at` pattern (D1 limitation) |

**No external theory overrides repository facts.** The hybrid model emerges from repository patterns.

---

## 19. Minimal Dependency Contract v1 (Semantics Only)

### Required for Every Generated Artifact
1. **Explicit parent FKs** — typed, enforced (`extraction_version_id`, `profile_version_id`, `intake_version_id`, etc.)
2. **Composite generation fingerprint** — `hash(input_ids + input_versions + processor_versions + config)`
3. **Exact-input traceability** — `input_fingerprint` decomposable to (input IDs + versions + config)
3. **Source location** — domain-appropriate JSON coordinates

### Required for Every Governance Artifact
1. **Immutable decision row** — `actor_id`, `actor_role`, `action`, `previous_value`, `new_value`, `reason`, `decided_at`
2. **No fingerprint** — referential integrity only

### Required for Cross-Domain Knowledge
1. **Provenance table** — `fact_id` FK + `source_type` + `source_id` + coordinates + processor versions + actor

### Freshness Contract
- **Generated artifacts:** Fresh = `current` ∧ `recompute_fingerprint() == stored_fingerprint`
- **Governance artifacts:** Fresh = `current` ∧ `not_invalid`
- **Knowledge facts:** Fresh = `status='Active'` ∧ `superseded_by_id IS NULL`

### Non-Requirements
- ❌ Universal `source_type`/`source_id` polymorphic columns
- ❌ `root_document_id` denormalization
- ❌ Universal `confidence` NOT NULL
- ❌ Universal `review_status` enum
- ❌ Generic `artifact_lineage` table

---

## 20. Minimal Freshness Contract v1 (Semantics Only)

### Core Definitions
```
CURRENT(artifact)    := artifact.superseded_at IS NULL
FRESH(artifact)      := CURRENT(artifact) ∧ 
                         (artifact.input_fingerprint IS NULL ∨ 
                          recompute_input_fingerprint(artifact) == artifact.input_fingerprint)
STALE(artifact)      := CURRENT(artifact) ∧ ¬FRESH(artifact)
INVALID(artifact)    := artifact.review_status IN ('Rejected','Auto-Rejected Technical','Superseded')
                       ∨ artifact.approval_status = 'Rejected'
                       ∨ artifact.status = 'Superseded'
USABLE(artifact)     := CURRENT(artifact) ∧ FRESH(artifact) ∧ 
                         artifact.authorized_for_downstream ∧ ¬INVALID(artifact)
```

### Invalidation Cascade (Fingerprint-Driven)
```
TRIGGER: upstream_artifact.superseded_at set to T
ACTION:
  FOR each dependent_artifact WHERE 
       dependent_artifact.input_fingerprint references upstream_artifact.id
       AND dependent_artifact.superseded_at IS NULL:
    SET dependent_artifact.superseded_at = T
    RECURSE on dependent_artifact
EXCEPTION: Human decision tables (review_decisions, approvals) — immutable
```

### What Must Be Persisted vs Derived

| Semantic | Persist | Derive | Per-Domain |
|----------|---------|--------|------------|
| `superseded_at` | ✅ | — | — |
| `input_fingerprint` / `output_fingerprint` | ✅ | — | Composition per domain |
| `current` | — | ✅ (`superseded_at IS NULL`) | — |
| `fresh` | — | ✅ (fingerprint comparison) | Recompute logic per domain |
| `stale` | — | ✅ (`current ∧ ¬fresh`) | — |
| `invalid` | ✅ (explicit status) | — | — |
| `usable` | — | ✅ (computed predicate) | Domain-specific additions |
| `approved` | ✅ (decision row) | — | — |
| `requires_review` | — | ✅ (computed) | Domain-specific |

---

## 20. Remaining Architectural Gaps

### 🔴 Correctness Blockers
1. **Engineering Facts not auto-invalidated** when BOQ/Spec extraction superseded — `scope_id` match ≠ dependency
2. **Price Records not auto-invalidated** when Supplier Intake re-run
2. **Consolidated Profile Requirements** not auto-invalidated when Profile superseded
3. **Partial fan-in invalidation** not supported — entire Profile superseded even if one requirement changes

### 🟡 Important Gaps
1. **Fingerprint composition not standardized** — extraction vs composite generation use different patterns
2. **No partial Profile recomputation** — all-or-nothing regeneration
3. **No reverse dependency index** — fan-out discovery requires domain-specific queries
4. **`governing_source_id` untyped** on consolidated requirements

### 🔵 Hardening
1. Standardize fingerprint composition terminology (input-set vs composite-generation)
2. Add `decided_role` to BOQ/Spec review decisions (actor type)
3. Make `governing_source_id` a proper FK

---

## 21. Roadmap Reassessment

| Step | Previous | Revised | Rationale |
|------|----------|---------|-----------|
| **R2A.3** | Dependency/Freshness Contract Design | **R2A.3 — Dependency Persistence Design** | Design exact FK/provenance columns and invalidation triggers BEFORE migration |
| **R3** | Revision/Addendum Study | **R3 Study** | Temporal semantics need dedicated study after freshness contract |
| **R4** | Cross-Document Reconciliation | **R4 Reconciliation** | Needs freshness contract + dependency persistence from R2A.3 |
| **R7** | Decision/Quotation Authority | **R7 Authority** | Depends on R4 |

**Do NOT proceed to migration design.** The schema changes depend on the exact FK/provenance columns and invalidation trigger logic which are not yet specified.

---

## 22. Recommended Next Step

**DOC-R2A.3 — Dependency Persistence Design**

Scope:
1. Define exact FK/provenance column additions for each domain table (standardized `source_type`/`source_id` pattern where polymorphic needed, typed FKs where fixed)
2. Specify invalidation trigger logic as executable pseudocode (SQL or application-layer):
   - Trigger: `*_extraction_versions.superseded_at` set
   - Query: Find dependents via explicit FK/link/provenance where `input_fingerprint` references superseded ID
   - Action: Set `superseded_at` on dependents, recurse
   - Exception: Human decision tables (immutable)
3. Define `is_stale` computed flag semantics for current-usability views
4. Standardize fingerprint composition terminology and fields
5. Validate against Golden project dependency chains
6. Produce contract document for R2A.4 implementation

**NO CODE, NO MIGRATION, NO SCHEMA CHANGES.**

---

STATUS: DOC-R2A.2 STUDY COMPLETE

NO CODE, SCHEMA, DATA, TEST, OR MIGRATION CHANGES MADE

STOPPED — awaiting architecture review before implementation.