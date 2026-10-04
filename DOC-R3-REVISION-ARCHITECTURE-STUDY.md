# DOC-R3 — Revision / Addendum / Supersession Architecture Study Report

## 1. Executive Verdict

**STUDY COMPLETE** — The repository has a well-structured document/version foundation but lacks explicit revision/addendum semantics. The current model supports version chains via `supersedes_version_id` and `restored_from_version_id` but lacks:
- Addendum as a first-class concept
- Partial supersession (section/clause/row/region granularity)
- Effective-time vs recorded-time separation
- Document family grouping for related revisions/addenda
- Explicit addendum-to-parent-document relationship

**Recommended Target Model**: A lightweight revision/addendum layer that extends the existing version chain without disrupting R1/R2 achievements.

---

## 2. Dynamic Subagent Work

No subagents spawned. Primary agent performed all investigation via direct schema/code inspection and Golden project data analysis.

---

## 3. Current Repository Model

### Core Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `documents` | Logical document entity | `id`, `project_id`, `logical_name`, `document_type`, `current_version_id` |
| `document_versions` | Physical file upload + metadata | `id`, `document_id`, `version_number`, `sha256`, `revision`, `issue_date`, `issue_purpose`, `supersedes_version_id`, `restored_from_version_id`, `quarantine_status` |
| `document_audit_events` | Immutable audit trail | `action`, `old_value`, `new_value`, `reason`, `created_at` |

### Version Chain Semantics (Current)

```text
Document (logical entity)
  └─> document_versions (version chain)
       ├── version_number: sequential per document
       ├── supersedes_version_id → previous version (chain)
       ├── restored_from_version_id → for restore operations
       ├── revision: free-text revision identifier
       ├── issue_date: document's issue date
       ├── issue_purpose: addendum/revision/clarification/etc
       ├── supersedes_version_id → previous version
       └── restored_from_version_id → for restore operations
```

### Extraction Versions (Downstream)

Each extraction pipeline maintains its own version chain with `superseded_at`:

| Pipeline | Table | Supersession |
|----------|-------|--------------|
| BOQ | `boq_extraction_versions` | `superseded_at` |
| Specification | `specification_extraction_versions` | `superseded_at` |
| Drawing Intake | `drawing_intake_versions` | `superseded_at` |
| Symbol Recognition | `drawing_symbol_recognition_versions` | `superseded_at` |
| Supplier Quote | `supplier_quote_intake_runs` | `superseded_at` |

---

## 4. Document vs Version vs Revision vs Addendum

### Current Terminology (Inconsistent)

| Term | Current Usage |
|------|---------------|
| **Document** | Logical entity (`documents` table) — one per logical file |
| **Version** | Physical upload (`document_versions`) — sequential `version_number` per document |
| **Revision** | Free-text field on `document_versions.revision` — user-entered |
| **Addendum** | Not a first-class concept; sometimes used as `issue_purpose` value |

### Semantic Gaps

| Concept | Current State | Gap |
|---------|---------------|-----|
| **Document** | Logical container | ✅ Exists |
| **Version** | Sequential upload | ✅ Exists |
| **Revision** | Free-text `revision` field | ⚠️ No semantics |
| **Addendum** | `issue_purpose` free text | ❌ Not modeled |
| **Partial Supersession** | Not modeled | ❌ Missing |
| **Effective vs Recorded Time** | Not separated | ❌ Missing |

---

## 5. Current Gaps

### 1. No Addendum as First-Class Entity
- Addenda currently uploaded as new `document_versions` with `issue_purpose` = "Addendum"
- No explicit link to parent document being amended
- No partial supersession scope (full document assumed)

### 2. No Partial Supersession
- `supersedes_version_id` implies FULL document supersession
- No way to express: "Addendum A supersedes Section 4.2 only"
- Drawing/BOQ/Spec extractions always supersede entire extraction

### 3. No Effective-Time vs Recorded-Time Separation
| Timestamp | Current Location | Semantics |
|-----------|-----------------|-----------|
| `created_at` | All tables | Recorded time |
| `uploaded_at` | `document_versions` | Recorded time |
| `issue_date` | `document_versions` | Document's issue date (effective?) |
| `superseded_at` | Extraction versions | When superseded |
| `effective_from`/`effective_to` | `engineering_facts` only | Validity period |

No clear separation between:
- **Recorded time**: When system learned of the change
- **Effective time**: When change takes effect per document

### 4. No Document Family / Revision Group
- No grouping of related revisions/addenda
- Each document is independent; no "revision family" concept
- R4 reconciliation needs to know: "Which BOQ revision is current for this project?"

---

## 6. Full Supersession Semantics

### Current Behavior
- `supersedes_version_id` on `document_versions` → full document chain
- `superseded_at` on extraction versions → full extraction replacement
- R2 freshness: `superseded_at IS NULL` = current

### Proposed Semantics
| Scope | Mechanism | Use Case |
|-------|-----------|----------|
| **FULL_DOCUMENT** | `supersedes_version_id` + `superseded_at` | New revision replaces entire doc |
| **PARTIAL** | New link table with scope | Addendum amends section/clause |

### Proposed Supersession Types

```typescript
type SupersessionScope = 
  | 'FULL_DOCUMENT'
  | 'SECTION'           // e.g., Spec Section 4.2
  | 'CLAUSE'            // Spec clause 4.2.1
  | 'BOQ_ROW'           // Specific BOQ item
  | 'DRAWING_REGION'    // Drawing sheet/area
  | 'EVIDENCE_ENTITY'   // Specific symbol/occurrence
```

---

## 7. Partial Supersession Semantics

### Requirement
R4 reconciliation needs to know: "Does Addendum A supersede the BOQ row that Requirement R linked to?"

### Proposed Model: Explicit Supersession Links

```sql
CREATE TABLE document_supersessions (
  id TEXT PRIMARY KEY,
  superseding_version_id TEXT NOT NULL,    -- new version/addendum
  superseded_version_id TEXT NOT NULL,     -- old version
  scope_type TEXT NOT NULL,                -- 'FULL_DOCUMENT' | 'SECTION' | 'CLAUSE' | 'BOQ_ROW' | 'DRAWING_REGION' | 'EVIDENCE_ENTITY'
  scope_id TEXT,                           -- section_id, clause_id, boq_item_id, drawing_region_id
  supersession_type TEXT NOT NULL,         -- 'REVISION' | 'ADDENDUM' | 'CLARIFICATION' | 'CORRECTION'
  effective_from TEXT,                     -- when change takes effect
  effective_to TEXT,                       -- when superseded by later change
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (superseding_version_id) REFERENCES document_versions(id),
  FOREIGN KEY (superseded_version_id) REFERENCES document_versions(id)
);
```

### Semantics
| Scope | R2 Freshness Impact |
|-------|---------------------|
| FULL_DOCUMENT | Supersedes entire extraction chain |
| SECTION/CLAUSE | Invalidates only requirements in that section |
| BOQ_ROW | Invalidates only that BOQ item + dependent profiles |
| DRAWING_REGION | Invalidates only symbols in that region |

---

## 8. Recorded Time vs Effective Time

### Current State (Conflated)

| Timestamp | Table | Actual Meaning | Should Be |
|-----------|-------|---------------|-----------|
| `created_at` | All | Recorded | **Recorded** ✅ |
| `uploaded_at` | `document_versions` | Recorded | **Recorded** ✅ |
| `issue_date` | `document_versions` | Ambiguous | **Effective From** ⚠️ |
| `superseded_at` | Extraction versions | When superseded | **Effective To** ⚠️ |
| `effective_from`/`to` | `engineering_facts` | Validity | **Effective** ✅ |

### Proposed Clean Separation

| Concept | Field | Meaning |
|---------|-------|---------|
| **Recorded** | `created_at` / `uploaded_at` | When system learned of artifact |
| **Effective From** | `effective_from` | When artifact becomes governing |
| **Effective To** | `effective_to` / `superseded_at` | When artifact stops being governing |
| **Issue Date** | `issue_date` | Document's own date (may differ from effective) |

### Example
```
Document v1 uploaded Jan 1 → recorded Jan 1, effective Jan 1
Addendum A uploaded Jan 15, effective Feb 1 → recorded Jan 15, effective Feb 1
Addendum A supersedes v1 Section 4.2 → v1 Section 4.2 effective_to = Feb 1
```

---

## 9. Governing-Version Selection

### Current Logic
- `documents.current_version_id` → latest uploaded version
- Extraction: `superseded_at IS NULL` + latest `version_number`

### Problems
1. No distinction between "latest uploaded" and "currently effective"
2. Addendum with future effective date becomes "current" immediately
3. No concept of "baseline" + active addenda

### Proposed: Effective-Version Resolution

```sql
-- Current governing version for a document at time T
SELECT * FROM document_versions
WHERE document_id = ?
  AND superseded_at IS NULL
  AND (effective_from IS NULL OR effective_from <= T)
  AND (effective_to IS NULL OR effective_to > T)
ORDER BY effective_from DESC, version_number DESC
LIMIT 1;
```

### For Extraction Versions (R2 Integration)
```sql
-- Current extraction version considers document effective versions
SELECT * FROM boq_extraction_versions
WHERE document_id = ?
  AND superseded_at IS NULL
  AND document_version_id IN (
    SELECT id FROM document_versions 
    WHERE document_id = ? AND superseded_at IS NULL
      AND (effective_from IS NULL OR effective_from <= T)
  )
ORDER BY version_number DESC LIMIT 1;
```

---

## 10. Historical Preservation

### Principles (Already Enforced)
1. **Never mutate historical rows** — `superseded_at` only, never UPDATE old rows
2. **Audit trail immutable** — `document_audit_events` append-only
3. **Version chain preserved** — `supersedes_version_id` chain intact
4. **Extraction history preserved** — `superseded_at` chain on extraction versions

### R3 Must Not Break
- ✅ `document_audit_events` append-only
- ✅ `superseded_at` only set once, never cleared
- ✅ `version_number` never reused or rewritten
- ✅ `supersedes_version_id` chain immutable

### New Tables Must Follow
- `document_supersessions` append-only
- Addenda as new `document_versions` (never mutate parent)

---

## 11. R2 Freshness Integration

### Current R2 Freshness (Per Artifact)
| Artifact | Freshness Rule |
|----------|----------------|
| Extraction | `superseded_at IS NULL` AND fingerprint match |
| Profile | `superseded_at IS NULL` AND fingerprint match |
| Match Run | `requirement_profile_version_id == currentProfileId` |
| Engineering Fact | `status='Active'` AND `has_current_provenance` |
| Price Record | Commercial gates + `source_intake_row_id` current |

### R3 Impact on R2 Freshness
| R3 Change | R2 Impact |
|-----------|-----------|
| Document effective dates | Extraction freshness must check document `effective_from/to` |
| Partial supersession | Engineering fact invalidation becomes scope-aware |
| Addendum effective date | Match run staleness considers document effective dates |

### Required R2 Adaptations (Minimal)
1. `matchRunStaleness()` → also check document `effective_from/to`
2. `invalidateEngineeringFactsOnExtractionSuperseded()` → scope-aware
3. `currentRequirementProfile()` → consider document `effective_from/to`

---

## 12. Golden Project Findings

### Al Mousa School — Clean Golden Run

| Metric | Value |
|--------|-------|
| Documents | 266 |
| Document Versions | 266 (1 per doc) |
| Multi-version documents | 0 |
| Documents with `supersedes_version_id` | 0 |
| Documents with `revision` populated | 0 |
| Documents with `issue_purpose` populated | 0 |

**Observation**: Golden project uses single-version documents only. No revision/addendum history exists in Golden data.

### Implication
- Current test coverage for revision/addendum = **zero**
- R3 implementation must create test fixtures for revision/addendum scenarios
- Golden validation must be extended with revision/addendum test cases

---

## 13. Architecture Alternatives

### Option A: Document Family Table
```sql
CREATE TABLE document_families (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  base_document_id TEXT,
  name TEXT,
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```
- **Pros**: Explicit grouping, easy queries
- **Cons**: New entity, migration complexity

### Option B: Version Chain Only (Current + Supersession Links)
- Use `supersedes_version_id` + new `document_supersessions` table
- No new `document_families` table
- **Pros**: Minimal schema change, leverages existing chain
- **Cons**: Querying "all revisions of doc X" requires recursive CTE

### Option C: Hybrid (Recommended)
- Add `document_family_id` to `documents` (nullable)
- `document_supersessions` for partial supersession
- Families created lazily when first addendum added

---

## 14. Recommended Target Model

### Schema Changes (Minimal, Additive)

```sql
-- 1. Document Family (nullable)
ALTER TABLE documents ADD COLUMN document_family_id TEXT;
-- FK to new document_families table (created lazily)

-- 2. Effective-time on document_versions
ALTER TABLE document_versions ADD COLUMN effective_from TEXT;
ALTER TABLE document_versions ADD COLUMN effective_to TEXT;

-- 3. Supersession link table (supports partial)
CREATE TABLE document_supersessions (
  id TEXT PRIMARY KEY,
  superseding_version_id TEXT NOT NULL REFERENCES document_versions(id),
  superseded_version_id TEXT NOT NULL REFERENCES document_versions(id),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('FULL_DOCUMENT','SECTION','CLAUSE','BOQ_ROW','DRAWING_REGION','EVIDENCE_ENTITY')),
  scope_id TEXT,  -- section_id, clause_id, boq_item_id, etc.
  supersession_type TEXT NOT NULL CHECK (supersession_type IN ('REVISION','ADDENDUM','CLARIFICATION','CORRECTION')),
  effective_from TEXT,
  effective_to TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 4. Document families (created lazily)
CREATE TABLE document_families (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  base_document_id TEXT NOT NULL REFERENCES documents(id),
  name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### Migration Strategy (Additive Only)
1. Add nullable columns (`effective_from`, `effective_to`, `document_family_id`)
2. Create new tables (`document_supersessions`, `document_families`)
3. Backfill: existing documents get `document_family_id` = their own id (self-family)
4. No data migration for existing single-version docs

---

## 15. Required vs Optional Persistence

| Element | Required | Optional | Rationale |
|---------|----------|----------|-----------|
| `effective_from`/`effective_to` on `document_versions` | ✅ | | Core temporal model |
| `document_supersessions` table | ✅ | | Partial supersession support |
| `document_family_id` on `documents` | ✅ | | Revision grouping |
| `document_families` table | ⚠️ | Can derive from `supersedes_version_id` chain | Lazy creation OK |
| Addendum as separate `document_type` | ⚠️ | Can use `issue_purpose='Addendum'` | Existing field sufficient |
| Partial supersession scope on extractions | 🔜 | R4 dependency | R4 will need this |

---

## 16. R4 Readiness

### What R4 Needs from R3

| R4 Need | R3 Provides |
|---------|-------------|
| "Which BOQ revision is governing?" | `effective_from/to` + `superseded_at` chain |
| "Does Addendum A supersede BOQ row X?" | `document_supersessions` with `scope_type='BOQ_ROW'` |
| "Is Spec Section 4.2 current?" | `document_supersessions` with `scope_type='CLAUSE'` |
| "Which Drawing revision is current?" | `effective_from/to` on drawing intake versions |

### R4 Can Start After R3
- Core schema in place
- Partial supersession model defined
- Effective-time model established

---

## 17. Open Decisions

| Decision | Options | Recommendation |
|----------|---------|----------------|
| Addendum as separate `document_type` vs `issue_purpose` | 1. New type `Addendum` 2. `issue_purpose='Addendum'` | Option 2 — reuse existing field |
| `document_families` mandatory | 1. Required 2. Lazy/optional | Option 2 — lazy creation |
| `effective_from` default | 1. `uploaded_at` 2. `issue_date` 3. NULL = immediate | Option 1 — `uploaded_at` default |
| Partial supersession scope on extractions | R3 scope | R4 scope — defer exact scope enum to R4 |

---

## 18. Recommended Next Step

**DOC-R3A.1 — Revision/Addendum Schema Design**

Scope:
1. Finalize `document_versions` effective-time columns (`effective_from`, `effective_to`)
2. Design `document_supersessions` table with scope enum
3. Add `document_family_id` to `documents`
4. Define migration sequence (additive, backward-compatible)
5. Validate against Golden project (no multi-version docs → safe)
6. Define R3A.2 — R2 integration layer (freshness helpers with effective-time)

**NO CODE, SCHEMA, DATA, OR MIGRATION CHANGES MADE.**

---

STATUS: DOC-R3 STUDY COMPLETE

NO CODE, SCHEMA, DATA, TEST, OR MIGRATION CHANGES MADE

STOPPED — awaiting architecture review before DOC-R3A.1 design.