# MVP-CLOSE-11 — Non-Silent Specification Clause Admission

**Date:** 2026-09-28
**Slice:** MVP-CLOSE-11 (implementation)
**Document audited/validated against:** `28 46 00 - Fire Detection and Alarm System - Rev 1.pdf` (sha256 `0f007f2b…80d03`, hash-verified)
**HEAD:** `029b426` · **Predecessor:** MVP-CLOSE-10

---

## 1. Executive verdict

# `CLOSED`

**No segmented specification clause can now disappear silently**, and the set of downstream-authoritative technical requirements is **byte-identical** to before the repair — proved, not asserted.

- Every segmented clause unit now receives exactly one explicit, reasoned admission outcome.
- The completeness invariant `detected = admitted + notAdmitted` holds by construction and is machine-checked.
- A non-admitted clause is stored on the **clause** record, never on a requirement, so it cannot reach the review queue, link candidates, understanding fingerprints, matching eligibility, or any authority gate.
- The admission **policy is unchanged**: C.3 and C.4 are still non-admitted. They are now visible, counted and reasoned.

Two implementation-time errors were made and corrected before this report; both are recorded in §10 rather than hidden.

---

## 2. Exact old loss boundary

```js
// app/domain/specification-extractor.mjs — the pre-repair gate
const requirementLike = type !== "Informational" || attributes.length || standards.length
  || manufacturers.length || compatibility.length || accessories.length;
if (!requirementLike || /copyright|table of contents|index of sections/i.test(sentence)) continue;
```

A segmented clause whose text carries no normative modal and yields no structured attribute/standard/manufacturer/compatibility/accessory was skipped with no row, no count, no audit event and no reconciliation. `classifyRequirementType` returns `Informational` as its default fallthrough, so a purely descriptive but *binding* sentence ("It operates from 100 to 4000 ft/min…") was judged not requirement-like and vanished.

MVP-CLOSE-10 measured the consequence on the governing document: **193 of 457 segmented clause units (42.2%)** produced no requirement row.

Page text and segmentation were verified complete and are **not** the boundary; persistence and lineage are faithful and are **not** the boundary.

---

## 3. Chosen persistence model

### `Candidate C — record the admission outcome on the existing `specification_clauses` row.`

Three nullable columns, no new table, no new rows:

| Column | Type | Meaning |
|---|---|---|
| `admission_status` | TEXT | `ADMITTED_REQUIREMENT` \| `NOT_ADMITTED` \| `NULL` (not recorded) |
| `admitted_requirement_count` | INTEGER | rows this clause unit emitted |
| `non_admission_reason` | TEXT | populated only for `NOT_ADMITTED` |

Plus index `spec_clauses_admission_status_idx (extraction_version_id, admission_status)`.

**Why this table.** `specification_clauses` is **already 1:1 with segmented clause units** (457 persisted rows for 457 segmented units — exact match), and a repository-wide audit found it is read by **exactly one** non-test site: the extraction inspection read at `worker/specification-extraction-api.mjs:333`. No downstream technical consumer touches it.

### Alternatives rejected

**Candidate A — persist as requirements typed `Informational` / `Needs Review`. Rejected on three independent authority-leakage paths:**

1. `currentTechnicalRequirementsFrom` (`worker/current-evidence-scope.mjs:331-371`) has **no** `review_status`, `requirement_type` or `approved_for_downstream` filter — currency is *purely lineage*. An `Informational` row would therefore **enter the current technical requirement set**.
2. `worker/engineering-knowledge-api.mjs:120` and `worker/spec-source-fact-promotion.mjs:104` both read `SELECT sequence, original_text FROM technical_requirements WHERE clause_id=? AND extraction_version_id=?`. Because `clause_id` is the known-degenerate 104-row group, 193 new rows would be swept into clause-keyed consumers.
3. The bulk auto-confirm route (`worker/spec-requirement-auto-confirm.mjs:239-247`) selects `review_status IN ('Needs Review','Pending Approval')`. New `Needs Review` rows would become **auto-confirm candidates** — 193 new rows queued for approval.

Candidate A would also pollute the requirement review queue and every requirement-count surface. The brief's warning was correct.

**Candidate B — a new separate extraction/clause artifact. Rejected as unnecessary duplication.** It would introduce a *second* source of truth for the same clause units that `specification_clauses` already records exactly, plus a new table, new reads, and a new authority question about which artifact is canonical.

**Rejected: representing non-admitted clauses as requirements with any typing.** Explicitly tested and excluded.

---

## 4. Admission outcome model

```js
export const CLAUSE_ADMISSION_ADMITTED   = "ADMITTED_REQUIREMENT";
export const CLAUSE_ADMISSION_NOT_ADMITTED = "NOT_ADMITTED";
export const CLAUSE_NON_ADMISSION_REASONS = {
  NO_CANDIDATE_SENTENCE: "NO_CANDIDATE_SENTENCE",
  NOT_REQUIREMENT_LIKE:  "NOT_REQUIREMENT_LIKE",
  EXCLUDED_PATTERN:      "EXCLUDED_PATTERN",
};
```

Every reason is **derived from the pre-existing gate**, none invented:

| Reason | Derivation | Reachability on the governing document |
|---|---|---|
| `NOT_REQUIREMENT_LIKE` | the `!requirementLike` conjunct | **192** of 193 |
| `NO_CANDIDATE_SENTENCE` | `sentenceSplit`'s `length >= 8` filter (`:63`) means the gate is never reached | **1** |
| `EXCLUDED_PATTERN` | the literal `copyright / table of contents / index of sections` list | 0 on this document; **reachable** and test-pinned |

Invariant enforced by construction: each clause starts `NOT_ADMITTED` and is promoted **only** by an actual `requirements.push`, so a clause can never be both, and an admitted clause never carries a reason.

**Auditability** is native: the source text, page span, path, kind, number, sequence and extraction version are *already* columns on the clause row, so `NOT_ADMITTED` records are self-contained with no new data model.

**Addressing is deliberately not pretended.** Per Phase 8, no hierarchical article/sub-clause identity is asserted. The clause row keeps whatever `number`/`page_from`/`page_to` the segmenter produced, including its known defects; this slice records provenance, it does not repair it.

---

## 5. Completeness accounting

Clause-unit metrics and requirement-row metrics are kept **deliberately separate** — MVP-CLOSE-10 measured 1.95 rows per admitted unit, so a clause-vs-row comparison would report phantom loss.

| Metric | Source | Meaning |
|---|---|---|
| `clauseUnitsDetected` | segmented clause units | denominator |
| `admittedClauseUnits` | units emitting ≥1 row | numerator A |
| `nonAdmittedClauseUnits` | units emitting 0 rows | numerator B |
| `technicalRequirementsEmitted` | requirement rows | **different unit** |
| `clauseAdmissionBalanced` | computed | `A + B === detected` |
| `clauseAdmissionStatus` | derived | `COMPLETE` \| `COMPLETE_WITH_NON_ADMITTED_CLAUSES` \| `INCOMPLETE_PROCESSING` |
| `clauseUnitsWithoutOutcome` | persisted read-back | rows whose status is `NULL` — reported **separately** from `NOT_ADMITTED` so the two can never be conflated |

Pre-existing keys `totalClausesDetected` and `totalRequirementsExtracted` are **preserved** and still mean what they meant; the new keys are additive.

**Persisted reconciliation is a read-back, not a claim.** `finalize` recomputes the accounting from `specification_clauses` after the write commits, so the stored summary is a genuine post-write verification. Critically, `finalize` **overwrites** the extractor's summary, so surfacing the metrics there was necessary — the extractor's own values would otherwise have been discarded.

**"Completed" is not redefined.** A `NOT_ADMITTED` clause is a *policy* outcome, not a processing failure, so the run `status` is untouched. Only a clause with **no recorded outcome at all** yields `INCOMPLETE_PROCESSING`, and that is an observability signal, not a status change.

---

## 6. Authority isolation proof

**Structural argument.** A non-admitted clause is written **only** to `specification_clauses`. `technical_requirements` is not touched. Therefore no link, profile, understanding input, matching input, engineering-knowledge fact or quotation input — all of which read requirements, never clauses — can observe it.

**Measured proof.** Two independent methods:

**(a) Differential against the true pre-repair module.** The pristine `HEAD` module was an invalid baseline (see §10), so the exact pre-edit working-tree module was reconstructed and both were run over the hash-verified PDF:

```
BEFORE requirement rows : 516
AFTER  requirement rows : 516
>>> TECHNICAL SET BYTE-IDENTICAL: YES
```

Field-by-field deep comparison across `sequence, originalText, normalizedRequirement, system, category, subcategory, requirementType, requirementCategory, attributes, standards, manufacturers, compatibility, accessories, crossReferences, condition, exception, ambiguities, confidence, confidenceState, reviewStatus, source` — all identical, same order. Pre-existing summary fields all `SAME`; `sections`, `conflicts`, `ambiguities`, `missingInformation` and the segmented `clauses` array all `SAME`.

**(b) Runtime isolation on the isolated chain.** After a real `processSpecificationJob` run:

| Assertion | Result |
|---|---|
| `technical_requirements` rows | **3** — only admitted clauses |
| any `NOT_ADMITTED` text present in `technical_requirements` | **0** |
| fabricated rows representing rejected clauses | **0** |
| `currentTechnicalRequirementsFrom` result | **3** — exactly the admitted set, identical ids |
| linkable rows via the current-requirements join | **0** |
| requirement rows with a null `review_status` | **0** — review queue not polluted |
| `approved_for_downstream` on any new row | **0** |

**Understanding fingerprints / Item F / matching.** Not re-measured, and deliberately not claimed. No requirement row was added, removed or altered, so no link candidate, profile input, understanding input or matching input can change. Item F's state is untouched by construction, and MVP-CLOSE-9's finding — that its `compatibilityTarget` blocker is unresolvable from the specification — is unaffected: C.3 and C.4 are still non-admitted, and neither would have satisfied that blocker.

---

## 7. Pages 11–14 reproduction, before/after

| Metric | Before | After |
|---|---|---|
| Clause units starting on pages 11–14 | 41 | 41 |
| Emitting ≥1 requirement row | 25 | 25 |
| Emitting zero rows (unrecorded) | **16** | **0** |
| Explicitly `ADMITTED_REQUIREMENT` | *(not recorded)* | **25** |
| Explicitly `NOT_ADMITTED` | *(not recorded)* | **16** |
| Every unit has an outcome | **false** | **true** |
| Every `NOT_ADMITTED` has a reason | **false** | **true** |
| Requirement rows emitted | 69 | **69** |

Per-clause outcomes for the MVP-CLOSE-10 subject clauses:

| Clause | Before | After | Reason |
|---|---|---|---|
| C.1 air-duct detector type/enclosure | 1 row | 1 row, `ADMITTED_REQUIREMENT` | — |
| C.2 UL 268A housing / twist-lock base | 1 row | 1 row, `ADMITTED_REQUIREMENT` | — |
| **C.3** air velocity 100–4000 ft/min; sensor cover | **0 rows, no trace** | `NOT_ADMITTED` | `NOT_REQUIREMENT_LIKE` |
| **C.4** test method; sampling tubes 3/5/10 ft; 12–18 AWG | **0 rows, no trace** | `NOT_ADMITTED` | `NOT_REQUIREMENT_LIKE` |
| `Duct Smoke Detector:` heading | 0 rows, no trace | `NOT_ADMITTED` | `NOT_REQUIREMENT_LIKE` |
| `Alarm horns` equipment-name unit | 0 rows, no trace | `NOT_ADMITTED` | `NOT_REQUIREMENT_LIKE` |
| `Emergency evacuation elevators…` (life-safety) | 0 rows, no trace | `NOT_ADMITTED` | `NOT_REQUIREMENT_LIKE` |
| `Addressable relay modules…` (compatibility) | 0 rows, no trace | `NOT_ADMITTED` | `NOT_REQUIREMENT_LIKE` |

---

## 8. C.3/C.4 result

**Visible but non-authoritative — exactly as intended.**

- Present as `NOT_ADMITTED` clause records with verbatim source text, page span and reason.
- **Zero** rows in `technical_requirements`; absent from `currentTechnicalRequirementsFrom`; not linkable; not downstream-eligible; not technical or compatibility evidence; not pricing evidence.
- The admission policy is unchanged, so they remain non-admitted after this slice. The difference is that the decision is now recorded rather than silent.

---

## 9. Historical compatibility

- All three columns are **nullable with no default**, verified via `pragma_table_info` on the real chain.
- A pre-existing clause row reads back as `admission_status = NULL` — meaning *"outcome not recorded"* — and is **not** rewritten. Proven by a test that seeds a legacy clause row and reads it back unchanged.
- **`NULL` is fail-safe**: it is neither `ADMITTED_REQUIREMENT` nor `NOT_ADMITTED`, so it can never be counted as admitted and can never grant authority. Asserted directly.
- Persistence binds `?? null`, so a caller running pre-repair extractor code against the new schema stores `NULL` rather than mislabelling clauses as admitted.
- **No backfill, no re-extraction, no historical mutation.** The live database still has **0** admission columns — the migration was never applied to live data.

---

## 10. Tests

`tests/specification-clause-admission-outcome.test.mjs` — **10/10 pass**. Every test runs on an isolated in-memory database built from the **real ordered migration chain** and the **real extractor/handler**; none touches live state or the Golden project.

| # | Class | Test |
|---|---|---|
| 1 | Loss observability | C.3/C.4-like binding clauses survive as `NOT_ADMITTED` with reason + retained provenance, and are **not** requirements |
| 2 | **Failing-before** | The historical gate is inlined verbatim; it emits 3 requirements and leaves **10 clause units with no recorded outcome at all**; the repaired code accounts for all 13 and emits the same 3 |
| 3 | Legitimate rejection | Headings and equipment-name units are `NOT_ADMITTED` and gain no requirement authority |
| 4 | Reason derivation | All three reasons reachable; an admitted clause never carries a reason |
| 5 | Admitted behaviour | Admitted set is **deep-equal** to the historical gate's output, same content and order; requirement sequence unchanged |
| 6 | Completeness | `13 = 3 + 10`; `clauseUnitsDetected ≠ technicalRequirementsEmitted` asserted explicitly; pre-existing summary keys preserved |
| 7 | Authority isolation | End-to-end `processSpecificationJob`: 13 clause rows all with outcomes; 3 requirements; no rejected text in requirements; `currentTechnicalRequirementsFrom` = admitted set; 0 linkable; 0 null-status rows |
| 8 | Persisted accounting | Extraction `status = "Completed"` (not redefined) while summary reconciles 13/3/10/0-unrecorded and is balanced |
| 9 | Historical compat | Legacy row readable, `NULL` outcome fail-safe, no rewrite required, columns present and nullable |
| 10 | Review/read surface | Real `handleSpecificationExtractionApi` GET: unfiltered returns 13 with status+text+page+version+reason; `?admissionStatus=NOT_ADMITTED` returns exactly 10; admitted filter returns 3; the two partition the corpus; the rejected clauses are **not** reachable via the requirements read |

### Regression runs

| Suite | Result |
|---|---|
| New suite | **10/10 pass** |
| 9 affected specification suites (extractor, jobs, terminal execution, lineage, approval, current-version, auto-confirm, large-spec) | **97 pass, 0 fail, 1 pre-existing skip** (98 tests) |
| `npm run test:knowledge` | **52/52 pass** |
| `npm test` (default) | **519/519 pass** |
| `npx eslint` on all 5 changed files | **0 errors**, 2 warnings — both pre-existing (`force` at `:23`, `stamp` at `:82`, present at HEAD, untouched lines) |
| `npm run build` | **Build complete**, Sites artifact validated |

---

## 11. Files changed

**By this slice:**

| File | Change | Was already dirty? |
|---|---|---|
| `app/domain/specification-extractor.mjs` | admission recording, reason vocabulary, summary metrics, `clauseAdmission` output | **Yes** — pre-existing uncommitted work |
| `worker/specification-extraction-background.mjs` | persist outcome on clause rows; `finalize` read-back reconciliation | **Yes** |
| `worker/specification-extraction-api.mjs` | `admissionStatus` filter on the existing clauses read | **Yes** |
| `db/schema.ts` | 3 nullable columns + index on `specificationClauses` | **Yes** |
| `drizzle-active/0013_specification_clause_admission_outcome.sql` | **NEW** migration (3 nullable `ADD` + 1 index) | — |
| `drizzle-active/meta/0013_snapshot.json` | **NEW** drizzle-kit snapshot | — |
| `drizzle-active/meta/_journal.json` | appended entry `idx 13` | — |
| `tests/specification-clause-admission-outcome.test.mjs` | **NEW** — 10 tests | — |
| `scripts/test-classification-baseline.json` | **+1 line** (own file only) | untracked (my earlier file) |
| `docs/MVP-CLOSE-11-NON-SILENT-CLAUSE-ADMISSION.md` | **NEW** (this report) | — |

**Important disclosure.** Four of the files above were **already carrying uncommitted work from earlier slices** when this slice began. `app/domain/specification-extractor.mjs` alone had **330 insertions / 28 deletions** relative to `HEAD` before I touched it, and its pre-repair behaviour (516 requirements) differs from `HEAD`'s (458). `db/schema.ts` (+409), `worker/specification-extraction-api.mjs` (+236) and `worker/specification-extraction-background.mjs` (+73) likewise contain substantial pre-existing hunks. **This slice's own diff therefore cannot be isolated with `git diff` alone**; its footprint is the admission-specific hunks, all of which are commented as such in place. The entire `drizzle-active/` chain is untracked in git (a pre-existing condition), so git collapses it to a single `??` entry — which is why the dirty count moved 759 → 760, exactly my one new git-visible test file.

**Concurrent-agent files identified and not touched:** `app/domain/fire-alarm-panel-sizing-snapshot.mjs`, `app/domain/fire-alarm-slc-capacity-calculator.mjs`, `worker/fire-alarm-panel-sizing-api.mjs`, `worker/boq-line-bom-api.mjs`, `worker/quotation-line-authority.mjs`, `tests/mvp-sizing-1-expansion-evidence-laziness.test.mjs`, `tests/mvp-bom-2-expansion-identity.test.mjs`, `docs/MVP-BOM-2-REPORT.md`, `docs/MVP-BOM-3-COMMERCIAL-SCOPE-REPRESENTATION.md`.

**Legacy synchronous path deliberately not modified.** `worker/specification-extraction-api.mjs:71` writes clause rows from a code path that is hard-disabled at `:90` (`throw … LEGACY_SYNCHRONOUS_EXTRACTION_DISABLED`). Modifying unreachable code adds risk without benefit; it is recorded here instead.

---

## 12. Business-state writes

# `none`

Verified after the slice — live D1 byte-for-byte identical to the MVP-CLOSE-9/10 baseline:

```
boq_requirement_links         3195   (active 1963)
engineering_knowledge_decisions  115
requirement_profile_versions     575
technical_requirements        19893
specification_clauses         23622
admission columns on LIVE specification_clauses : 0   <- migration NOT applied to live
requirement 100207  Needs Review / adv=0
```

Dev server PID 66503 (`:4183`) started 2026-09-27 18:36:56 — **never restarted**. No live re-extraction, no requirement creation, approval, link, profile regeneration, matching run, or historical backfill. All extraction runs in this slice executed against isolated in-memory databases.

---

## 13. Test-inventory status

`npm run test:all` is **RED on the REL-003 drift gate** — unchanged in substance from MVP-CLOSE-9/10, and **not** caused by this slice:

```
+ tests/mvp-bom-2-expansion-identity.test.mjs|SAFE
+ tests/mvp-sizing-1-expansion-evidence-laziness.test.mjs|SAFE
```

Both belong to other agents. **My own test file is classified and does not appear in the drift list.** Exactly one line was added to `scripts/test-classification-baseline.json`; `--write-baseline` was **not** run, because it would have silently classified both other agents' files and destroyed the ownership signal the gate exists to provide. Resolving the remaining drift requires those agents to classify their own tests.

---

## 14. Remaining defects

Kept deliberately separate — **none** is addressed by this slice, and none is a side effect of it.

**Admission policy quality**
- The gate is **uncalibrated**: it discards genuine binding technical clauses (e.g. "Emergency evacuation elevators will operate according to the Saudi Building Code", a relay-module compatibility clause, cable specifications) with the same silence as article headings. MVP-CLOSE-10 measured 2 of 41 audited-scope units (4.9%) as unambiguously technical; the document-wide figure is now finally measurable from the persisted rejected corpus.
- `EXCLUDED_PATTERN` is reachable but occurs 0 times on the governing document.
- A non-admitted **sentence inside an admitted clause** is not individually recorded — only the clause-unit outcome is. MVP-CLOSE-10 noted 1.95 rows per unit, so this is a real granularity limit.
- **Segmentation-stage loss is still invisible.** `flush()` (`:333`) drops a clause whose seeded heading text is empty *before* it enters `structure.clauses`, so it can never receive an outcome. The accounting covers post-segmentation units only.

**Hierarchical addressing** (all from MVP-CLOSE-10 §9, untouched)
- `article` is a byte-for-byte copy of `clause` in **100%** of rows; 42 distinct values address 513 requirements.
- The parent article label is destroyed by `hierarchy.splice()` and, per MVP-CLOSE-10 §3.2, is not recoverable from the text at all — depth requires coordinates that are provably ambiguous.
- **Zero leading whitespace** survives page-text extraction.

**`clause_id` resolution**
- Resolved by a document-wide first match on a bare clause number; **104 rows** (20.3%) share one clause; top 5 ids carry 58.9%. Unchanged — and the reason Candidate A was rejected.

**Page spans**
- `pageFrom` records the clause span, not the sentence page: 84 rows multi-page, **0** rows with `pageFrom` 12 or 13, largest bucket `11 -> 14` with 33 rows.

**Classification**
- **76.8%** of audited-scope requirements have `system = "Unknown"`; only **1.0%** have a `requirement_compatibility` row; **73.5%** have no child rows at all. This, not the C.3/C.4 loss, is the dominant reason Item F could not be unblocked.

**Approve CAS** — `meta.changes` occurs 0 times; a lost CAS can still return 200.

**Reject/restore regeneration** — the profile cascade is gated on `approve` only, so un-approving revokes downstream eligibility without regenerating.

**59 approval recovery** — untouched, and still blocked: the corpus is provably incomplete, all 59 carry degenerate addresses, and 5 carry malformed text.

**Also carried forward:** stale Discovery Only match run; no per-pair requirement-link creation route; `spec-ai-escalation-v1` is a dead constant with no escalation path.

---

## 15. Next smallest slice

**One bounded, read-only slice: measure the now-persisted rejected corpus and classify every `NOT_ADMITTED` clause unit as either a genuine technical requirement, a heading/trivia unit, or a segmenter artefact — then report the exact technical-loss count document-wide.**

Method: query the `NOT_ADMITTED` rows this slice now persists (all 193 on the governing document, each with reason, page span and verbatim source text), classify each against the source page text, and report:
- the exact number and share of genuinely binding technical requirements lost;
- the per-reason breakdown;
- whether any loss is attributable to segmentation rather than admission.

**Why this one.** It is the only next step that is (a) purely read-only, (b) possible *only* because this slice created the artifact it consumes, and (c) decisive for two open decisions. It answers the question MVP-CLOSE-10 could only sample — *"is the 42.2% discard rate mostly trivia or mostly real technical evidence?"* — and that answer gates both whether the admission predicate should ever be widened and whether any subset of the 59 stranded approvals is recoverable. Doing the measurement before touching the predicate is the whole discipline this chain has been enforcing.

**Explicitly not this slice:** widen or narrow the `requirementLike` predicate; admit C.3/C.4; repair addressing, `clause_id` or page spans; recover the 59 approvals; re-extract live; touch classification.

---

## 16. Implementation-time errors, disclosed

Both were caught before the report was written; neither reached a passing test run or the live system.

**1. Wrong differential baseline (the more serious one).** The first proof diffed the repaired module against `git show HEAD:app/domain/specification-extractor.mjs` and reported **BEFORE 458 / AFTER 516 — "TECHNICAL SET BYTE-IDENTICAL: NO"**. That looked like a regression. It was not: the file was **already dirty** before this slice, and `HEAD` is an older extractor that legitimately emits 458 rows (matching persisted extraction **v1**, versus the working tree's 516 matching **v2/v3**). Acting on that "NO" would have meant reporting a fabricated regression. The correct baseline — the exact pre-edit working-tree module — was reconstructed by reverse-applying this slice's single edit, with an abort guard on the marker count, and the proof was re-run: **516 = 516, byte-identical.** The lesson is recorded because the same file was already found dirty during MVP-CLOSE-10 and was not checked at slice start.

**2. A `//` comment broke a minified source file.** The read-surface edit inserted a `//` comment into `worker/specification-extraction-api.mjs`, which is written as very long single lines — the comment swallowed the remainder of the line and produced `SyntaxError: Unexpected end of input`. Caught immediately by `node --check`; converted to a `/* */` block comment.

**Also corrected:** the Phase-0 case matcher initially tested case-sensitive regexes against normalized text and reported all eight fixture cases as "NOT FOUND"; fixed to match raw clause text before any conclusion was drawn.

**Discarded rather than published:** a per-article attribution table from MVP-CLOSE-10 (headingless clauses have no recoverable stream position) and a "465 fragments" count (regex `[a-z]\.$` matched any word-final period). Neither appears in this report or the previous one.

---

## 17. Final statement

> No admission-policy change, live re-extraction, requirement approval, requirement link, profile regeneration, matching run, historical backfill, schema mutation on live data, commit, push, deployment, restart, or unrelated business-state mutation was performed.

The live database still has **zero** admission columns — the migration exists as a source artifact and was applied only to isolated test databases built from the migration chain. The admission predicate, its thresholds, the ambiguity logic, the classification heuristics and the source-clause interpretation are all unchanged: C.3 and C.4 are still non-admitted, exactly as the policy requires. What changed is that the decision is now recorded, counted, reasoned and inspectable.

**No segmented specification clause can disappear silently. The set of downstream-authoritative technical requirements did not change by a single field.**
