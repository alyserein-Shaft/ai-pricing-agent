# MVP-CLOSE-15 — Extraction-Time System Authority Containment

## 1. Executive verdict

**`CLOSED — EXTRACTION-TIME SYSTEM AUTHORITY LEAK CONTAINED`**

The last live instance of the CLOSE-14 Leak 4 pattern is closed. Three call
sites had been hand-typing the identical, **completely ungoverned** project
system read. All three now share one definition, so the ungoverned literal no
longer exists anywhere in the repository.

```
grep -rn "DISTINCT system FROM technical_requirements" worker app   ->  no matches
```

The two extraction-background sites were the reported defect; the third site
(`engineering-knowledge-api.mjs`, already gated inline by CLOSE-14) was
collapsed onto the same helper so the rule cannot drift apart again.

---

## 2. Two reproduced reads

Both in `worker/specification-extraction-background.mjs`, byte-identical:

```sql
SELECT DISTINCT system FROM technical_requirements
 WHERE project_id=? AND system IS NOT NULL
   AND system NOT IN ('Unknown','Unspecified')
```

| Site | Function | What the set decides |
|---|---|---|
| `createSpecificationJob` (was `:70`) | extraction job creation | SINGLE vs MULTI system → whether page relevance may be filtered by system **at all**. Persisted as `specification_extraction_jobs.project_system`. |
| `processSpecificationJob` (was `:273`) | chunk processing | `candidateSystems` passed to the extractor as open-ended candidate-recognition context — which systems the extractor will even look for. |

Neither had a currency filter or a review filter. This is **strictly worse**
than the copy CLOSE-14 already closed, which at least had the canonical
predicates inlined.

---

## 3. Runtime impact before

Reproduced at **runtime**, not by string inspection. The test invokes the real
exported `createSpecificationJob` against a real in-memory database built by
replaying the active migration chain, then reads back the persisted
`specification_extraction_jobs.project_system`. That value is later handed to
`mapSpecificationPages()` during chunk processing, so it is production
behaviour, not a diagnostic.

**Primary proof** — project with exactly one approved `Fire Alarm` requirement
plus one unreviewed `CCTV` requirement:

| | persisted `project_system` | consequence |
|---|---|---|
| Before repair | `Unspecified` | project inferred as **multi-system**, so the system-based page-relevance filter was silenced for the whole document |
| After repair | `Fire Alarm` | single-system inference, filter active |

**Four further runtime confirmations, all before-repair failures:**

- a `Needs Review` requirement's system seeded extraction
- a `Pending Approval` requirement's system seeded extraction
- `Approved` + `approved_for_downstream=0` seeded extraction
- a **retired** (superseded-extraction) approved requirement's system seeded
  extraction
- with zero governed systems, the governed `system_domain` fallback was
  **replaced** by an unreviewed requirement's system

Red phase: **7 of 13 fail** against the pre-repair reads; 13/13 after.

---

## 4. Canonical repair

One shared reader in the canonical authority module, `worker/current-evidence-scope.mjs`:

```js
export const currentApprovedProjectSystems = async (db, projectId, calendar) => {
  const rows = await db.prepare(
    `SELECT DISTINCT r.system AS system
       FROM ${currentTechnicalRequirementsFrom("r", calendar)}
      WHERE r.project_id = ?
        AND r.system IS NOT NULL
        AND r.system NOT IN ('Unknown','Unspecified')
        AND ${currentTechnicalRequirementEligibleForEngineeringPredicate("r")}
      ORDER BY r.system`,
  ).bind(projectId).all();
  return (rows.results || []).map((row) => row.system);
};
```

It composes the **CLOSE-14 canonical definitions** — no new authority literal was
introduced. Design points:

- **Currency and eligibility both applied**, via the existing predicates, not
  re-derived here.
- `'Unknown'`/`'Unspecified'` excluded centrally**, because "the project covers a
  system called Unknown" is never true and three sites had each been repeating
  that judgement separately.
- **Sorted for determinism.** Two callers reduce this set to a single value
  (`length === 1`), which must not depend on SQLite scan order.
- **Empty project id yields `[]`**, so a caller can never accidentally read a
  cross-project set.

`engineering-knowledge-api.mjs` was moved off its inlined literal onto the same
helper, so all three call sites share one definition and a structural test
asserts none can reintroduce the raw read.

---

## 5. Positive multi-system regression

Explicitly guarded, because a narrowing that collapsed real multi-system
projects would be a serious regression of its own:

- **one current approved system** → inferred as single-system (`Fire Alarm`) ✅
- **two genuinely approved systems** → deliberately left as
  `Unspecified`/multi-system, preserving the pre-existing Wave 4 contract that in
  a multi-system project the legacy `system_domain` fallback must not filter out
  other systems' pages ✅
- **zero governed systems** → the governed `system_domain` fallback still applies
  ✅ (a project whose requirements are all still under review keeps its system
  context)
- an **unreviewed second system no longer flips** a single-system project to
  multi-system ✅

---

## 6. Negative authority cases

Each excluded from extraction-time inference, proven at runtime:

| Case | Excluded |
|---|---|
| `Needs Review` | ✅ |
| `Pending Approval` | ✅ |
| `Approved` + `approved_for_downstream=0` | ✅ |
| retired / superseded extraction | ✅ |
| historical extraction version | ✅ (via the same currency gate) |
| `Unknown` / `Unspecified` / NULL system | ✅ |
| another project's requirements | ✅ (canonical join requires document ownership) |

The `approved_for_downstream=0` case confirms the two conjuncts remain
independent — a flag-only authorisation is not authority.

---

## 7. Candidate isolation

A `REQUIREMENT_CANDIDATE` remains clause-level only. Asserted: no
`technical_requirements` row is materialised for the candidate clause, and it
cannot introduce a system into extraction. No candidate promotion was performed
or simulated.

---

## 8. Tests

**New:** `tests/mvp-close-15-extraction-system-authority.test.mjs` — 13 tests.

- Red phase proven: **7/13 fail** against the pre-repair reads; **13/13** after.
- Real-schema fixture replaying the active migration chain.
- Runtime reproduction through the real exported `createSpecificationJob`.
- A structural test asserts both extraction sites call the shared reader and
  that the raw literal cannot return in three production modules.

**Regression scope — all green:**

| Suite | Result |
|---|---|
| `mvp-close-15-extraction-system-authority` (new) | 13/13 |
| `mvp-close-14-requirement-authority-containment` | 17/17 |
| `specification-clause-admission-outcome` (CLOSE-13 candidates) | 16/16 |
| `specification-extractor` | 32/32 |
| `spec-auto-confirm` | 19/19 |
| `specification-current-version-authority` | 4/4 |
| `specification-requirement-lineage-authority` | 11/11 |
| `current-evidence-scope` | 7/7 |
| `engineering-knowledge` | 21/21 |
| `engineering-knowledge-api` | 10/10 |
| `technical-requirement-engine` | 19/19 |
| `governance-authority-gaps` | 7/7 |
| `source-fact-and-auto-confirm-authority` | 17/17 |
| `npm test` | **519/519** |
| `npm run test:knowledge` | **52/52** |
| `npm run lint` (touched files) | **0 errors**, 3 pre-existing warnings |
| `npm run build` | passes |

No extraction heuristic, recovery mechanism, catch-all, parent-rescue,
segmentation, addressing, or clause_id structure was changed. The only edits
are the two system reads plus the consolidation of the third site.

---

## 9. Files changed

**Production (3):**
- `worker/current-evidence-scope.mjs` — added `currentApprovedProjectSystems`
- `worker/specification-extraction-background.mjs` — both sites now use it
- `worker/engineering-knowledge-api.mjs` — third site moved onto the same helper

**Tests (2):**
- `tests/mvp-close-15-extraction-system-authority.test.mjs` (new, 13)
- `scripts/test-classification-baseline.json` (drift re-recorded, 415 files)

No other lane's file was touched. In particular `docs/MVP-BOM-5-*.md` and
`tests/mvp-bom-5-scope-schema.test.mjs` are the concurrent commercial lane's
and were read only for the drift-gate safety review, never modified.

**On the drift baseline:** the gate flagged two new SAFE files — mine, and
`tests/mvp-bom-5-scope-schema.test.mjs` from the concurrent BOM-5 lane. Rather
than re-record blindly, I reviewed that file: in-memory databases only, no
network, subprocess or filesystem access, so SAFE is factually correct. I did
not validate its *behaviour* — it is another lane's in-flight work (see §11).

---

## 10. Business-state writes

**None.** No live extraction, D1 access, requirement mutation, approval, link
creation, profile regeneration, or matching run. The only database writes are
into throwaway `:memory:` SQLite instances created and discarded by the new
test. No commit, push, deploy, restart, reset, clean, stash or revert.

---

## 11. test:all

Drift gate passes (415 files). **3981 tests, 3952 pass, 15 fail.** All 15 are
attributable and none are mine:

| Count | Suite | Attribution |
|---|---|---|
| 12 | `mvp-bom-5-scope-schema` | The **concurrent commercial lane's own in-flight work**. Their test file's own header documents the expected failure: "on the pre-0015 active chain these SCOPE acceptance tests fail because the generalized source identity does not exist". They are testing the SCOPE migration this lane has not yet landed. Verified independent of this slice: the file imports only the active-chain helper and its own fixtures, and references **none** of the three modules changed here. |
| 2 | `boq-line-bom-summary` | Proven **pre-existing** by A/B in MVP-CLOSE-14 with every production change reverted (0 pass / 2 fail either way). |
| 1 | `review-workflow-atomic` (R8) | Proven **pre-existing** by the same A/B (27 pass / 1 fail either way). |

Deliberately **not** re-run under revert to re-prove the BOM-5 twelve: the
concurrent lane is actively working in this tree, and temporarily reverting
production files could corrupt their run. Static import analysis plus their own
documented expectation is the safe form of proof here.

---

## 12. Remaining technical-governance defects

Carried forward from CLOSE-14, all still open and all still out of scope:

1. `worker/engineering-discovery-api.mjs:20` — `approved_for_downstream=1`
   without `review_status`. Deprecated module, zero rows, no UI.
2. `worker/engineering-knowledge-api.mjs` `propagate-system-wide` — approval
   enforced in JS with `!requirement.approved_for_downstream` rather than the
   canonical predicate, and a weaker truthiness test than the sibling path.
3. `worker/technical-requirement-api.mjs:48` —
   `loadApprovedIntelligenceAttributes` does not filter
   `requirement_profile_versions` on `superseded_at IS NULL`.
4. `worker/engineering-knowledge-api.mjs` links list — joins raw
   `technical_requirements`, so a retired requirement's text can appear on a
   current link. Left **display-visible on purpose**: a reviewer must be able to
   see and dismiss links they are responsible for.
5. CLOSE-10 lifecycle defects: approve CAS may report success after a lost
   compare-and-swap; reject/restore may not regenerate profiles.
6. The 16 remaining false negatives, `parseAccessory`, specification
   hierarchy/addressing, and the 59 orphan approvals.

Extraction-time system authority is now fully contained; no ungoverned
requirement read remains in the extraction path.

---

## 13. Next slice

**Move the `propagate-system-wide` approval check onto the canonical predicate
(defect 2).** It is the last place where requirement approval is decided by a
hand-written JS comparison instead of the canonical contract, it sits in the
same module CLOSE-14/15 already touched, and it is a contained change with an
existing suite (`engineering-knowledge-api`) to prove it.
