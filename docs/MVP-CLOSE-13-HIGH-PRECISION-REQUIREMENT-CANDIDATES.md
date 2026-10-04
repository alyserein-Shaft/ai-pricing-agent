# MVP-CLOSE-13 — High-Precision Requirement Candidate Recovery Without Authority Leakage

**Slice:** MVP-CLOSE-13
**Project under investigation:** Al Mousa School acceptance (`project_c0123d91-c30b-4956-87cb-e473ef53f89d`)
**Governing document:** 28 46 00 Fire Detection and Alarm, hash-verified PDF (sha256 `0f007f2b…bb80d03`, 421,811 bytes)
**Predecessor:** MVP-CLOSE-12 (rejected-clause corpus measurement)
**Date:** 2026-09-28

---

## 1. Executive verdict

```
CLOSED — HIGH-PRECISION CANDIDATES RECOVERED WITHOUT AUTHORITY
```

MVP-CLOSE-12 measured 64 genuine technical requirements being discarded by the
admission gate, decomposed into four deterministic grammatical mechanisms. This
slice recovers **58 clause units as governed review candidates — 48 of them
genuine technical clauses (82.8% precision)** — and admits **zero** of them as
technical requirements.

The authoritative technical-requirement set is **byte-identical**: 516 rows before,
516 rows after, identical in sequence, text, normalisation, requirement type,
category, confidence and review status, verified by a differential run of the
pre-CLOSE-13 and post-CLOSE-13 extractors over the real document.

The reason direct admission was prohibited is not a design preference. It is
measured. **Phase 1 proves that no `technical_requirements` row can be created in
any review state without becoming authority** — a recovered `Needs Review` row is
in the current technical set, is auto-confirm eligible, and — most seriously — is
picked up by a `clause_id`-keyed scan that has no review filter at all, which
flipped a link suggestion to `eligible:true` and minted a **Confirmed link with no
human in the loop**.

---

## 2. CLOSE-12 benchmark reproduction

Reproduced before any policy change, from the hash-verified PDF:

| Metric | CLOSE-12 reference | Reproduced | Match |
|---|---|---|---|
| Detected clause units | 457 | 457 | yes |
| Admitted clause units | 264 | 264 | yes |
| NOT_ADMITTED clause units | 193 | 193 | yes |
| Emitted technical requirement rows | 516 | 516 | yes |
| `detected = admitted + notAdmitted` | true | true | yes |

The extractor fingerprint at slice start was
`336ec9c642af1ac5929dd78dfef5d066ad6f37262ae50d2f01e8c6e76cb5fb78`, byte-identical
to the MVP-CLOSE-12 freeze, so an identical reproduction was required and any
divergence would have meant drift. There was none.

---

## 3. Authority-leak proof

**Question:** can a newly recovered, unreviewed requirement safely live in
`technical_requirements` before governed promotion?

### Answer: **NO**

Executed, not assumed. Four variants were seeded into an isolated database built
from the real ordered migration chain, and each consumer's real predicate was run
against them.

| Variant (`requirement_type` / `review_status`) | In `currentTechnicalRequirementsFrom` | In review read | Auto-confirm eligible | Reachable by `clause_id` readers |
|---|---|---|---|---|
| (a) Informational / Needs Review | **YES** | YES | YES | YES |
| (b) Mandatory / Needs Review | **YES** | YES | YES | YES |
| (c) Mandatory / Pending Approval | **YES** | YES | YES | YES |
| (d) Informational / Pending Approval | **YES** | YES | YES | YES |

`approved_for_downstream=0` buys nothing. Three independent leaks:

**Leak 1 — bulk auto-confirm promotes without per-requirement human action.**
`findEligibleSpecRequirements` (`worker/spec-requirement-auto-confirm.mjs:341-356`)
selects `review_status IN ('Needs Review','Pending Approval')` over the currency
set. `requirement_type` is not a filter, so Mandatory recovered clauses pass. One
project-wide POST with a run-level reason executes the CAS at `:239-247`, writing
`review_status='Approved', approved_for_downstream=1`. The engine's own CAS sets
`approved_for_downstream` to 1 regardless of how the row was seeded.

**Leak 2 — the `clause_id` sibling scan has no review filter at all (all four
variants).** `worker/engineering-knowledge-api.mjs:120` and
`worker/spec-source-fact-promotion.mjs:104` both run:

```sql
SELECT sequence, original_text FROM technical_requirements
WHERE clause_id=? AND extraction_version_id=? AND sequence<=?
```

A new unreviewed row's clause text is inherited as the effective family/category
context of a *different, already-Approved* requirement. Executed result:
`shouldAutoConfirmRequirementLink` flipped from `eligible:false` to
`eligible:true`, so `suggest-links` minted a Confirmed link with no human in the
loop. This affects **Informational** rows too.

**Leak 3 — `batchPromoteSourceFacts` mints authority from unreviewed rows.**
`worker/spec-source-fact-promotion.mjs:331-333` scans the current set with no
review filter and produced a governed `Source Fact` from the unreviewed row in
every variant.

**Correcting my own Phase 1 reading.** My initial isolated proof concluded that
linkability was safely gated behind `approved_for_downstream=1` plus a Confirmed
link. That was incomplete. The `clause_id` path (Leak 2) reaches linkability
without that gate, so no status combination is safe.

**Proven safe consumers** (executed, all four variants): the BOQ understanding
input fingerprint, which is triple-gated on `Confirmed` link ∧
`approved_for_downstream=1` ∧ `review_status='Approved'`; and product matching,
which performs no direct requirement read at all.

**Root shape.** `currentTechnicalRequirementsFrom` (`worker/current-evidence-scope.mjs:331-365`)
is a *currency* predicate and correctly filters on none of the three review fields.
The defect is that the review-state gate is re-typed independently at each consumer,
and three consumers omit or invert it.

---

## 4. Candidate persistence model

Candidates live **entirely at clause level**, extending the MVP-CLOSE-11 admission
outcome model. No `technical_requirements` row is created to represent a candidate.

`specification_clauses.admission_status` now carries three states:

| State | Meaning | Authority |
|---|---|---|
| `ADMITTED_REQUIREMENT` | Clause emitted ≥1 technical requirement row | Pre-existing governed behaviour |
| `REQUIREMENT_CANDIDATE` | Real clause, matches a measured mechanism, **not** a requirement | Review signal only. Not linkable, not fingerprint input, not matching evidence, not approved |
| `NOT_ADMITTED` | Rejected: structural heading, prose, descriptive catch-all | Audit evidence only |

Supporting column: `specification_clauses.candidate_mechanism`, nullable with **no
default**, holding `PASSIVE_PRESENT` / `FUTURE_REQUIREMENT` / `IMPERATIVE` /
`CAPABILITY`. A NULL means "never analysed for a mechanism" and can never be
mistaken for a candidate.

`admitted_requirement_count` stays 0 for a candidate, and
`non_admission_reason` is retained on candidates so the reason the clause was *not*
admitted as a requirement remains visible alongside the positive review signal.

**Schema cost:** one column, one nullable, no index, no CHECK, no destructive
statement. The existing `(extraction_version_id, admission_status)` index already
serves the primary candidate query.

---

## 5. Four recovery mechanisms

`classifyRequirementCandidate()` is a pure, total, exported function in
`app/domain/specification-extractor.mjs`, evaluated **only on the rejection path**
after the gate has already decided to reject. `requirementLike` is left
byte-identical, so the classification cannot admit anything.

| Mechanism | Construction | Example |
|---|---|---|
| `PASSIVE_PRESENT` | copula + participle; plural subject + engineering verb; `permits/enables/offers/supports/provides` | "passwords protect access" |
| `FUTURE_REQUIREMENT` | modal-free future tense | "will interrupt power" |
| `IMPERATIVE` | sentence-initial bare action verb | "Install all detectors" |
| `CAPABILITY` | `can` / `cannot` / `is able to` | "can store records" |

**Overlap is deterministic.** Precedence is
`PASSIVE_PRESENT > FUTURE_REQUIREMENT > IMPERATIVE > CAPABILITY`, first match wins,
assignment is guarded by `!outcome.candidateMechanism`, and the benchmark confirms
**58/58 candidates carry exactly one mechanism**. No clause is double counted.

**No vocabulary expansion.** No manufacturer, standard, body or compatibility
keyword was added. MVP-CLOSE-12 §8b proved the gate is already vocabulary-driven —
20 identical `X - Expansion.` lines split 16 rejected / 4 admitted purely on
hard-coded literals, with `NFPA - …` admitted and `SBC - Saudi Building Code.`
rejected. Grammatical detection is the part that generalises.

**No C.3/C.4 special-casing.** No literal text hack. Both are recovered because
their grammatical mechanism is handled generally.

### Calibration was measured, not guessed

Four `PASSIVE_PRESENT` variants were measured against the 64 labelled technical units:

| Variant | Technical recovered | Non-technical | Descriptive-C | Precision |
|---|---|---|---|---|
| **shipped (broad copula frame)** | **26/64** | 3 | 0 | **90%** |
| drop bare copula | 9/64 | 1 | 0 | 90% |
| engineering-participle list | 8/64 | 1 | 0 | 89% |
| require equipment subject | 6/64 | 1 | 0 | 86% |

Every tightening lost 18–20 measured technical units to save 2–3 noise units. The
broad frame is therefore deliberate, and the residual false positives are documented
in §12 rather than hidden.

---

## 6. Benchmark precision / recall

Over the frozen 193 rejected units, joined positionally to the extractor's own
outcomes via `clause_sequence` (deterministic, not text-matched):

| Metric | Measured reference | This slice | Delta |
|---|---|---|---|
| Candidate total | 53 | **58** | +5 |
| Genuine technical (label A) | 44 | **48** | +4 |
| Collateral non-technical | 9 | **10** | +1 |
| Candidate precision | ~83% | **82.8%** | −0.2pp |
| Remaining technical false negatives | 20 | **16** | −4 |

**Recall:** admission recall before review is 264/328 = **80.5%**. If the 48
technical candidates are promoted through governed review, recoverable recall is
264/312 = **84.6%**.

**Why the deltas.** The implementation detects *more* than the measurement's
taxonomy, not less: +4 technical recoveries and +1 collateral unit at essentially
identical precision. The measurement's four buckets were hand-adjudicated
taxonomy labels; the shipped detector is a general grammatical classifier, so it
also catches constructions that did not fall neatly into a single hand-drawn
bucket. The difference is an improvement in recall at unchanged precision, not
drift. Every recovered unit is individually listed in the working artefacts.

### Per-mechanism precision

| Mechanism | Candidates | Technical (A) | Non-technical | Precision |
|---|---|---|---|---|
| `CAPABILITY` | 9 | 8 | 1 | 89% |
| `PASSIVE_PRESENT` | 25 | 22 | 3 | 88% |
| `IMPERATIVE` | 13 | 11 | 2 | 85% |
| `FUTURE_REQUIREMENT` | 11 | 7 | 4 | **64%** |

`FUTURE_REQUIREMENT` is the weakest mechanism. Its bare `\bwill\s+\w+` frame is
grammar, not engineering intent, and it collects 4 collateral units — including
segmentation artefacts of the form "Instruction will be provided on system
operation". This is the first thing to reconsider if a future slice re-tunes
precision.

### All 10 collateral candidates, verbatim

| Unit | Label | Mechanism | Text |
|---|---|---|---|
| u019 | B | IMPERATIVE | "Test Reports:" |
| u033 | D | PASSIVE_PRESENT | "Only contractors of Grade 1 or 2 … are permitted to perform the …" |
| u053 | C | IMPERATIVE | "Test Mode, signal disconnect." |
| u094 | B | PASSIVE_PRESENT | "The abbreviations and acronyms which are used in this Section include …" |
| u283 | D | PASSIVE_PRESENT | "Fire alarm control panels are to be installed as specified in the drawings." |
| u302 | D | FUTURE_REQUIREMENT | "Computer and Printer Furniture: The Contractor will receive two desks …" |
| u359 | E | CAPABILITY | "Plant monitoring contacts … can have distinct plain text …" |
| u425 | D | FUTURE_REQUIREMENT | "The acceptance inspector will also test the installation …" |
| u446 | D | FUTURE_REQUIREMENT | "Instruction will be provided on system operation …" |
| u447 | D | FUTURE_REQUIREMENT | "Training in system testing will cover logging detector sensitivity …" |

**6 of 10 collateral units are label D — segmentation artefacts**, not admission
defects. Several of those sentences are in fact genuine technical requirements
misclassified as segmentation artefacts by MVP-CLOSE-12, so the true collateral
figure is likely lower than 10. This is an inherited corpus-label limitation, not
a new one.

---

## 7. Existing admitted corpus differential

A differential run compared the pre-CLOSE-13 extractor against the post-CLOSE-13
extractor over the real document. The pre-slice extractor was reconstructed by
mechanically reverting exactly the three CLOSE-13 hunks, and cross-checked against
the independent in-test historical-gate proof.

| Property | Result |
|---|---|
| Emitted requirement rows | 516 → 516 |
| Byte-identical (sequence, text, normalised text, type, category, confidence, review status) | **true** |
| Admitted clause units | 264 → 264 |
| Detected clause units | 457 → 457 |
| Admitted set identical, index-aligned | **true** |
| Every candidate was previously `NOT_ADMITTED` | **true** |

Pre-CLOSE-13 state distribution: `NOT_ADMITTED` 193, `ADMITTED_REQUIREMENT` 264.
Post-CLOSE-13: `NOT_ADMITTED` 135, `ADMITTED_REQUIREMENT` 264, `REQUIREMENT_CANDIDATE` 58.
The admitted set is untouched; the only movement is 193 → 58 + 135.

---

## 8. Technical-requirement count before / after

| | Before | After |
|---|---|---|
| In-memory emitted rows (governing document) | 516 | **516** |
| Live D1 `technical_requirements` | 19,893 | **19,893** |
| Live D1 clauses | 23,622 | **23,622** |
| Live D1 rows with `approved_for_downstream=1` | 139 | **139** |

Live D1 remains byte-for-byte unchanged. The 0013 and 0014 migration columns do
**not** exist on live (`0` admission columns), because no live migration was run.

---

## 9. Downstream authority isolation

Measured on the isolated chain database with the governed write path, not asserted
by construction.

| Consumer | Measured result |
|---|---|
| `technical_requirements` rows from candidates | **0** (3 rows total, exactly the admitted set) |
| Candidate clause owning any requirement row via `clause_id` | **0** |
| `currentTechnicalRequirementsFrom` membership | **absent** (3 rows = admitted set) |
| `boq_requirement_links` created | **0** |
| Linkable as technical evidence | **0** |
| `requirement_profile_versions` | **0** |
| `engineering_knowledge_decisions` | **0** |
| `requirement_evidence` rows deriving from a candidate | **0** |
| Rows with `approved_for_downstream=1` | **0** |
| Rows with `review_status='Approved'` | **0** |
| **Understanding input fingerprint** | **unchanged** — measured. It is triple-gated on Confirmed link ∧ `afd=1` ∧ `review_status='Approved'`, all of which a candidate cannot reach; no table it derives from is written |
| **Technical profiles** | **unchanged** — 0 rows, and `loadInputs` requires a Confirmed link plus `approved_for_downstream=1` |
| **Product matching** | **unchanged** — it performs no direct requirement read at all |
| **Item F blocker / readiness** | **unchanged** — see §10 |

---

## 10. C.3 / C.4 result

| | C.3 | C.4 |
|---|---|---|
| Pre-CLOSE-13 state | `NOT_ADMITTED` | `NOT_ADMITTED` |
| Post-CLOSE-13 state | **`REQUIREMENT_CANDIDATE`** | **`REQUIREMENT_CANDIDATE`** |
| Mechanism | `PASSIVE_PRESENT` | `CAPABILITY` |
| Emitted requirement rows | **0** | **0** |
| In `technical_requirements` | **false** | **false** |
| Approved / linked / downstream-eligible | no | no |

C.3 — "It operates from 100 to 4000 ft/min air velocities and signals trouble if the
sensor cover is removed or improperly installed."
C.4 — "Testing can be done locally via magnetic switch or remotely. Sampling tubes
are available in 3, 5, or 10 feet."

Both are recovered through the general mechanism, not through literal text.

**Item F is unchanged.** From live D1: 0 requirement rows derive from C.3 or C.4,
0 are `approved_for_downstream=1`, 0 links reference them. The MVP-CLOSE-9 finding
stands unchanged: requirement 100207 is sub-clause C.1 of a four-clause article, and
C.3/C.4 becoming review candidates does not alter its blocker, understanding,
matching or readiness.

---

## 11. Review / read-model visibility

**No new route, no new filter, no UI work.** The existing
`GET /api/documents/:id/specification-extraction/clauses` operation serves the new
state, because the `admissionStatus` bind added by MVP-CLOSE-11 is a pass-through
with no value allowlist. This is **verified, not assumed** — if it ever acquired an
allowlist, candidates would become invisible exactly when they matter, so a test
pins the behaviour.

`?admissionStatus=REQUIREMENT_CANDIDATE` returns, for each candidate: source text,
document and extraction version, page and span, admission state, mechanism,
non-admission reason, and admitted-requirement count (0).

**Known limitation, deliberately not fixed.** No frontend calls the `clauses`
operation today — `app/` renders `requirements`, `conflicts` and `export` only.
So a reviewer-facing candidate list remains net-new frontend work, and a
**backend-only** visibility is what this slice delivers. The brief allows backend
visibility for this slice; the UI gap is recorded in §18.

---

## 12. Descriptive catch-all negative control

The descriptive catch-all was **not** opened.

- On the frozen corpus, the shipped `PASSIVE_PRESENT` pattern matches **0** of the
  57 descriptive (label C) units.
- 96 of the 120 legitimate-rejection and descriptive units remain `NOT_ADMITTED`.
- Nine real corpus units are pinned as negative controls in the test suite,
  verbatim from the frozen 28 46 00 document, each verified to be one the detector
  leaves rejected: "CACF - Central Alarm and Control Facility.", "Main operating
  terminal (system console)", "MFACP - Main Fire Alarm Control Panel.", "NAC -
  Notification Appliance circuit.", "Lighting control and dimming system.",
  "Materials and Services:", "Applicable Codes and Standards:", "The following
  standards apply to this Section, among others:", "Lamp test."

### A self-correction, and the residual it exposed

My first draft of this negative control used **invented** descriptive sentences.
Two of them were real false positives of the shipped detector:

- "The abbreviations and acronyms used in this Section are listed below." →
  `PASSIVE_PRESENT` (copula + participle in prose)
- "Test Reports:" → `IMPERATIVE` (a heading beginning with a bare action verb)

Rather than delete the sentences, I replaced the invented set with verified corpus
units and **pinned both residuals explicitly in the test suite**. The
`IMPERATIVE` case is corpus unit `u019`; the `PASSIVE_PRESENT` case is `u094`. Both
appear in the collateral table in §6. The residual is real, bounded, measured, and
visible — not asserted away.

**Why it is acceptable:** a candidate is reviewable and non-authoritative. The
cost of the residual is reviewer attention, not engineering authority.

---

## 13. Parent-rescue negative control

`strictNormativeParent` is **untouched**. It was not modified, not widened, and the
dead parent path was not resurrected. MVP-CLOSE-12 established that 75 units
satisfy both of its conjuncts and all 75 are already admitted, so the **title-keyword**
conjunct — not the hierarchy slot — is the blocker. Broadening it without a
structural-label exclusion would admit nearly the entire `PRODUCTS` structural
corpus (216 units). That repair requires its own measured design and is deferred.

---

## 14. Tests

`tests/specification-clause-admission-outcome.test.mjs`: **16 tests, 16 pass**
(10 pre-existing + 6 new for this slice).

| # | Test | Covers |
|---|---|---|
| 1 | Each mechanism recognised; total, pure, safe on non-string input | Brief req. 1–4 |
| 2 | Overlap resolved by documented precedence, exactly one mechanism per clause | Phase 3 |
| 3 | Candidate invisible to current set, link pool, evidence tables, approvals | Req. 9–12 |
| 4 | Emitted set identical to the **inlined historical gate** | Req. 8 |
| 5 | Descriptive catch-all + structural headings stay rejected; residuals pinned | Req. 5–7, 15 |
| 6 | Three-term identity in the producer | Req. 14 |

The CLOSE-11 suite was updated to the three-state contract. The critical change is
that assertions which previously pinned one *state name* now pin the **invariant**
underneath it — non-admitted, zero emitted rows, reason recorded, source text and
page retained. C.3/C.4 are asserted as candidates through their mechanism while
remaining absent from `technical_requirements`.

| Suite | Result |
|---|---|
| `specification-clause-admission-outcome` | 16/16 |
| `specification-extractor` | 32/32 |
| `specification-extraction-jobs` | 12/12 |
| `specification-extraction-terminal-execution` | 5/5 |
| `specification-approval-profile-freshness` | 4/4 |
| `specification-current-version-authority` | 4/4 |
| `specification-requirement-lineage-authority` | 11/11 |
| `migration-chain-verification` | 3/3 (was 1/3) |
| `migration-baseline-safety` | 9/9 (was 7/9) |
| `npm test` (default) | **519/519** |
| `npm run test:knowledge` | **52/52** |
| `npm run build` | OK |
| `npm run lint` (changed files) | 0 errors, 2 pre-existing warnings |

### A pre-existing regression from MVP-CLOSE-11, found and fixed here

Adding migration 0013 in MVP-CLOSE-11 left **4 test failures across 2 files** that
my CLOSE-11 validation missed, because neither file is in the `npm test` default
list:

- `migration-chain-verification`: index count `461 !== 460`, and
  `MIGRATION_VERSION = "0012_military_havok"` while the journal head was `0013`.
- `migration-baseline-safety`: manifest column deep-equal, `cutoffMigration`, and
  the `adoptedBaselineChain` tag list.

The root cause was that `0013` added a column and an index but recorded neither in
`drizzle-active/manifest.json` nor in the test's pinned literals. Fixed by
recording 0013's column and index in the manifest, advancing
`target.cutoffMigration`, advancing `MIGRATION_VERSION` to the 0014 head, and
advancing the two deliberately-pinned counts with their derivation documented in
place. I did **not** pin the counts back down to 460, which would have hidden a
real index in the applied chain.

---

## 15. Files changed

| File | Change |
|---|---|
| `app/domain/specification-extractor.mjs` | New third state, `CLAUSE_CANDIDATE_MECHANISMS`, pure `classifyRequirementCandidate`, classification on the rejection path, promotion pass, three-term summary + `candidateMechanisms`. `requirementLike` unchanged |
| `worker/specification-extraction-background.mjs` | `candidate_mechanism` in the clause INSERT; three-state `CASE` arms and three-term balance in `finalize`; `candidateClauseUnits` in the persisted summary |
| `db/schema.ts` | `candidateMechanism` nullable column, no index |
| `drizzle-active/0014_specification_clause_candidate_mechanism.sql` | New. One `ADD COLUMN`, 0 destructive statements |
| `drizzle-active/meta/_journal.json` | Entry 0014 added; 15/15 parity with disk |
| `drizzle-active/manifest.json` | 0013's column + index recorded; `candidate_mechanism` added; `namedIndexes` 460 → 461; `target.cutoffMigration` → 0014 |
| `app/domain/production-readiness.mjs` | `MIGRATION_VERSION` → `0014_specification_clause_candidate_mechanism` |
| `tests/specification-clause-admission-outcome.test.mjs` | 6 new tests; existing tests updated to the three-state invariant |
| `tests/migration-baseline-safety.test.mjs` | CLOSE-11 regression fix: counts, cutoff, chain list, with derivations documented |
| `docs/MVP-CLOSE-13-HIGH-PRECISION-REQUIREMENT-CANDIDATES.md` | This report |

`worker/specification-extraction-api.mjs` was **not** changed — the existing
pass-through filter already serves the new state.

---

## 16. Business-state writes

**None.** Zero live mutations.

| Live D1 metric | Slice start | Slice end |
|---|---|---|
| Links / active | 3,195 / 1,963 | 3,195 / 1,963 |
| Knowledge decisions | 115 | 115 |
| Requirement profile versions | 575 | 575 |
| Technical requirements | 19,893 | 19,893 |
| Specification clauses | 23,622 | 23,622 |
| Approved requirements | 139 | 139 |
| `approved_for_downstream=1` | 139 | 139 |
| Admission columns on live | 0 | 0 |

No live migration, no live re-extraction, no approval, no linking, no profile
regeneration, no matching run. All work used isolated databases built from the real
ordered migration chain. Dev server PID 66503 (`:4183`) was never restarted.

---

## 17. Test-inventory status

`scripts/test-classification-baseline.json` is **unchanged**. The suite I extended
was already classified by MVP-CLOSE-11, so no new line was required. I did not
modify classifications for any other agent's file, and did not run `--write-baseline`.

`npm run test:all` remains **RED** on the `REL-003` drift gate, unchanged in
substance from CLOSE-9/10/11/12 and caused entirely by other agents' unclassified
files:

```
+ tests/mvp-bom-2-expansion-identity.test.mjs|SAFE
+ tests/mvp-bom-4d-expansion-pricing-currentness.test.mjs|SAFE
+ tests/mvp-sizing-1-expansion-evidence-laziness.test.mjs|SAFE
```

Not recorded, not touched, not classified.

---

## 18. Remaining defects

1. **16 technical false negatives remain** outside the four mechanisms — descriptive
   and no-lexical-signal clauses. Out of scope by instruction.
2. **`FUTURE_REQUIREMENT` is 64% precision**, the weakest mechanism and the first
   candidate for re-tuning.
3. **Two residual false-positive classes** are measured and pinned rather than
   eliminated: passive-copula prose (`u094`) and imperative headings (`u019`).
4. **No reviewer-facing UI.** The `clauses` operation has no frontend caller, so
   candidates are backend-visible only.
5. **Parent-side `strictNormativeParent` remains unfixed** and is an independent
   defect. The ~20 clauses with no lexical signal likely need it, plus a structural
   exclusion design.
6. **`parseAccessory` pluralization, recorded unchanged by instruction.** The
   pattern `` `\b${name.replace(" ","\\s+")}s?\b` `` cannot match "batteries",
   "power supplies" or "junction boxes". Sole cause of `u176` rejection. It needs
   an isolated parser fix because it changes structured extraction, not clause
   admission.
7. **Pre-segmentation loss still unmeasured.** The 457 denominator is itself
   post-segmentation, so true loss remains **≥ 64**. MVP-CLOSE-10's 193/457 (42.2%)
   discard is measured; what segmentation itself loses is not.
8. **Address model still broken** (`article === clause` 100%, 42 address values for
   513 requirements, one `clause_id` over 104 rows).
9. **Single document.** 66 units hand-adjudicated; three (`u012`–`u014`) flagged
   borderline.
10. **The three leaks in §3 are unfixed.** Candidate state sidesteps them rather
    than repairing them. Any future slice that wants to admit a recovered clause as
    a requirement must first fix the auto-confirm gate, the `clause_id` sibling
    scan and `batchPromoteSourceFacts`.
11. **59 orphan approvals remain `BLOCK ALL`.** Unchanged — candidate recovery does
    not make stored addressing trustworthy.

---

## 19. Next smallest slice

**Repair the three authority leaks, not the admission policy.** The 58 candidates
are now correctly classified and correctly inert. The binding constraint on
promoting any of them is that `Needs Review` is not actually non-authoritative in
this system. The smallest useful next step is therefore a bounded, read-side
authority gate:

1. Add the missing review-state filter to `worker/engineering-knowledge-api.mjs:120`
   and `worker/spec-source-fact-promotion.mjs:104` (`clause_id` sibling scans) —
   the highest-severity leak, since it mints Confirmed links.
2. Require an explicit per-requirement human decision in the auto-confirm route
   rather than a run-level bulk POST, or at minimum exclude
   `clause_id`-bearing recovered rows from bulk selection.
3. Add the same review filter to `batchPromoteSourceFacts`.

Each is independently testable, none changes the admission policy, and together
they are the precondition for any future candidate promotion. Still deferred and
still excluded: the parent-side rescue, `parseAccessory`, segmentation, addressing,
live re-extraction, and 59-approval recovery.
