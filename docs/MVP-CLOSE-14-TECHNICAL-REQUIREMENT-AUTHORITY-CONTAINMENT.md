# MVP-CLOSE-14 — Technical Requirement Authority Containment

## 1. Executive verdict

**`CLOSED — TECHNICAL REQUIREMENT AUTHORITY LEAKS CONTAINED`**

All three MVP-CLOSE-13 leaks are closed, plus three equivalent patterns found
during the audit. The root cause was structural, and it is now removed
structurally rather than patched at each site:

> `currentTechnicalRequirementsFrom` was a **currency** predicate that
> correctly filtered on **no** review field, and there was **no eligibility
> counterpart** to BOQ's `currentBoqEligibleForEngineeringPredicate`. So every
> authority-bearing consumer re-typed — or omitted — the review-state rule
> independently. The BOQ side had one definition; the requirement side had
> none.

There is now exactly one definition,
`currentTechnicalRequirementEligibleForEngineeringPredicate`, in the canonical
authority module, and every authority-bearing requirement consumer uses it.

---

## 2. Canonical authority contract

Defined in `worker/current-evidence-scope.mjs`.

### The five axes, kept separate

| Axis | Question | Where it lives |
|---|---|---|
| **Existence** | does a row exist? | the table |
| **Currency** | is it still this project's current evidence? | `currentTechnicalRequirementsFrom` — pre-existing, unchanged |
| **Review state** | is a review pending / approved / rejected? | `review_status` |
| **Downstream authorization** | has a governed decision authorized engineering use? | `approved_for_downstream` |
| **Link applicability / confirmation** | may it link, and is the link confirmed? | `boq_requirement_links.status` |

### The new eligibility contract

```js
currentTechnicalRequirementEligibleForEngineeringPredicate(alias) =>
  `${alias}.review_status = 'Approved' AND ${alias}.approved_for_downstream = 1`
```

Deliberate design decisions:

- **Both conjuncts, neither derived from the other.** The governed approve route
  and the governed auto-confirm CAS write them together, and every reject path
  clears `approved_for_downstream`. So they agree in practice — but relying on
  that coincidence is precisely the assumption MVP-CLOSE-13 proved false
  (`approved_for_downstream=0` bought nothing on its own).
- **The approved family is `('Approved')` ALONE**, deliberately narrower than
  BOQ's `('Approved','Accepted','Auto Verified')`. Those two extra statuses are
  never written to `technical_requirements` by any path in this repository.
  Widening to match would assert authority that does not exist.
- **Currency and eligibility are not merged.** Currency stays a
  `currentTechnicalRequirementsFrom` join; eligibility is a separate predicate
  applied on top. Merging them would hide Needs Review rows from the review
  surface that exists to decide them.
- **The eligibility predicate is a pure predicate**, not a subquery, so it
  composes with `currentTechnicalRequirementsFrom("r")` exactly the way
  `currentBoqEligibleForEngineeringPredicate("b")` does.

### The shared governed context loader

`governedRequirementSubclauseCandidates(db, requirement)` — one definition
replacing two hand-typed copies. It applies **both** canonical predicates to
every *inherited* sub-clause header, and always includes the walking
requirement's own text.

### Visibility is not authority

Review UI keeps reading `currentTechnicalRequirementsFrom` **without** the
eligibility predicate. Nothing was globally hidden. Confirmed in
`worker/specification-extraction-api.mjs`, whose requirement list/export/CSV
paths were deliberately left untouched.

---

## 3. Three reproduced leaks

All reproduced against a **real** database built by replaying the active
migration chain. This matters: the MVP-CLOSE-13 leak survived this long partly
because `tests/engineering-knowledge.test.mjs` uses a D1 double that answers
every statement generically and never validates SQL against a real schema.

### Leak 1 — the bare-id evaluation load (MVP-CLOSE-13 §3 "Leak 1" area)

`worker/spec-requirement-auto-confirm.mjs:62` loaded with
`SELECT * FROM technical_requirements WHERE id = ?` — **no currentness filter**.

The module's own comment in `findEligibleSpecRequirements` asserted that "the
load-time currency filter is the real gate — a requirement whose evidence is
not current never reaches this loop." The batch scan honoured that; the load did
not. So the exported evaluator could compute and **return `eligible: true` for a
retired requirement** to any caller that supplied its own
`activeExtractionVersionId`.

The *write* was independently safe — the CAS re-states currency in an `EXISTS`
guard. What leaked was the **verdict**.

Reproduction: a requirement on a superseded extraction, evaluated with
`activeExtractionVersionId` set to that same retired id. Before: `eligible: true`.
After: `eligible: false`, "Requirement not found or no longer current evidence".

### Leak 2 — the `clause_id` sibling scan (MVP-CLOSE-13 §3 "Leak 2")

Two **byte-identical** hand-typed copies:

- `worker/engineering-knowledge-api.mjs:117-120` (`requirementSubclauseCandidates`)
- `worker/spec-source-fact-promotion.mjs:101-106` (`subclauseCandidates`)

```sql
SELECT sequence, original_text FROM technical_requirements
 WHERE clause_id=? AND extraction_version_id=? AND sequence<=?
```

`clause_id` is a **source-position key, not an authority key**: one clause holds
several requirements, from different extraction versions, approved alongside
unapproved. With no currentness filter and no review filter, an unreviewed
row's text was inherited as the effective **family, category, equipment type and
source text** of a *different, already-approved* requirement. That flowed into
`scoreRequirementLink` → `shouldAutoConfirmRequirementLink`, which MVP-CLOSE-13
proved flips `eligible:false` → `eligible:true` and mints a **Confirmed** link
with no human in the loop.

The duplication is why "fix both sites" was never going to hold: the second copy
existed precisely so a single fix could not cover it.

Reproduction: an approved requirement whose own text names no equipment family
(the only situation the leak can act in), with an unreviewed `Needs Review`
sibling in the same clause naming one. Before: the sibling's text entered the
context walk. After: it does not, while a genuinely **approved** sibling still
does — so valid authority is preserved.

### Leak 3 — Source Fact promotion from unreviewed requirements (MVP-CLOSE-13 §3 "Leak 3")

`evaluateSourceFactCandidate` gated on currentness only. Its gates were
`5 active_extraction`, `9 project_source_evidence`, `1 unambiguous_subject`,
`7 not_conditional`, `4 confidence_threshold`, `10 standard_subject_in_own_text`
— **no review-state gate at all**.

Impact is not inert: promoted facts reach
`app/domain/technical-requirement-engine.mjs` as authoritative `technicalFacts`,
and `worker/technical-requirement-api.mjs` folds Active Source Facts into both
the profile **and its `input_fingerprint`**, which invalidates matching on
change. So an unreviewed row could reach matching by this route.

Reproduction: `Needs Review`, `Pending Approval`, and
`Approved` + `approved_for_downstream=0` rows, each carrying a high-confidence
`fixed_temperature_setpoint` attribute. Before: promoted. After: no candidate
produced, and the batch scan never selects them.

### Equivalent pattern found by this slice — Leak 4

`worker/engineering-knowledge-api.mjs`, the fifth parallel query:

```sql
SELECT DISTINCT system FROM technical_requirements
 WHERE project_id=? AND system IS NOT NULL AND system NOT IN ('Unknown','Unspecified')
```

No currentness filter, no review filter. Its result becomes
`canonicalProjectSystems`, which decides `isMultiSystem` inside
`resolveEffectiveRequirementSystem` — which decides whether the project's
governed `system_domain` may be used as the effective system **at all**.

So **one unreviewed row carrying a distinct system value flipped the whole
project to multi-system and silently disabled the system fallback for every
approved requirement in it**, changing link scores and auto-confirm outcomes
project-wide. The identical query is duplicated at
`worker/specification-extraction-background.mjs:70` and `:273` (see §18).

### Equivalent pattern — profile input missing a conjunct

`worker/technical-requirement-api.mjs:88` (`loadInputs`) filtered on
`r.approved_for_downstream=1` and **omitted** `review_status='Approved'` — the
only authority-bearing profile/fingerprint input relying on the two flags
staying in lockstep rather than requiring both. Now on the canonical predicate.

### Equivalent pattern — duplicated eligibility literals

Three byte-identical copies of `approved_for_downstream=1 AND
review_status='Approved'` existed (`engineering-knowledge-api.mjs:20` and
`:126`, `estimator-understanding-api.mjs:729`). All now reference the canonical
predicate.

---

## 4. Root causes

1. **Asymmetry in the canonical module.** BOQ had
   `currentBoqEligibleForEngineeringPredicate`; requirements had nothing. Every
   requirement consumer had to invent the rule, and three of them invented it
   wrong or not at all.
2. **Duplication as a design goal.** The promotion module copied the clause
   query "to stay independent", which guaranteed the leak existed twice and
   could not be fixed once.
3. **`clause_id` treated as an authority key** rather than a positional key.
4. **Currency read as eligibility.** A currency predicate that correctly hides
   nothing from review was relied upon to also gate authority.

---

## 5. Consumer inventory

Full inventory produced by a read-only subagent. Authority-bearing readers,
after this slice:

| Site | Currency | Eligibility | Class |
|---|---|---|---|
| `engineering-knowledge-api.mjs:20` publish | canonical | **canonical** | authority |
| `engineering-knowledge-api.mjs` suggestLinks pool | canonical | **canonical** | link creation |
| `engineering-knowledge-api.mjs` suggestLinks DISTINCT system | **canonical** | **canonical** | link creation |
| `engineering-knowledge-api.mjs` subclause walk | **canonical (shared)** | **canonical (shared)** | link creation |
| `spec-source-fact-promotion.mjs` evaluate | canonical | **canonical** | authority |
| `spec-source-fact-promotion.mjs` batch scan | **canonical** | **canonical** | authority |
| `spec-source-fact-promotion.mjs` subclause walk | **canonical (shared)** | **canonical (shared)** | authority |
| `spec-requirement-auto-confirm.mjs` evaluate load | **canonical** | n/a (admission axis) | admission |
| `technical-requirement-api.mjs:88` loadInputs | canonical | **canonical** | profile/fingerprint |
| `estimator-understanding-api.mjs:729` confirmedSpecifications | canonical | **canonical** | matching input |
| `engineering-discovery-api.mjs:20` | canonical | `approved_for_downstream=1` only | authority (deprecated, dead) |
| `technical-requirement-api.mjs:48` intelligence facts | profile-version scoped | `rif.review_status` | profile input |

Deliberately **not** changed (visibility ≠ authority): requirement detail,
evidence, history, list, export, CSV, clause lists, document counters, and the
links-list review surface. A reviewer must be able to see and dismiss bad links.

---

## 6. Clause-ID behavior after

`clause_id` is now a **filter input only**, never an authority signal:

- every inherited sub-clause header must independently satisfy
  current + governed + downstream-approved;
- approved and unapproved requirements sharing a clause → only the approved
  one contributes (asserted);
- a retired approved requirement sharing a clause with a current one → excluded
  (asserted);
- a `REQUIREMENT_CANDIDATE` clause is not a `technical_requirements` row at all
  and can never be walked as context (asserted).

---

## 7. Shared selector/predicate design

```js
// worker/current-evidence-scope.mjs
currentTechnicalRequirementEligibleForEngineeringPredicate(alias)  // pure predicate
governedRequirementSubclauseCandidates(db, requirement)           // one shared loader
```

Mirrors the existing BOQ pattern exactly, so no new idiom was introduced. The
two former duplicate sites are now thin delegations, and a structural test
asserts neither file can re-type a `FROM technical_requirements WHERE
clause_id=` query again.

---

## 8. engineering-knowledge repair

Three changes, all in `worker/engineering-knowledge-api.mjs`:

1. `requirementSubclauseCandidates` → delegates to
   `governedRequirementSubclauseCandidates`.
2. The DISTINCT-system query → canonical currentness + eligibility.
3. The subject-requirement pool and the publish path → canonical predicate
   instead of a re-typed literal.

The repair is at the **predicate**, not at any test string: no requirement text,
clause id, system value or status literal is special-cased.

---

## 9. spec-source/promotion repair

- `subclauseCandidates` duplicate **deleted**, replaced by the shared loader.
  The module stays independent of the knowledge API's route wiring; only the
  *authority rule* is now shared, which was the actual defect.
- `evaluateSourceFactCandidate` loads through both canonical predicates.
- `batchPromoteSourceFacts` scan restricted to eligible requirements.

Gating at the **load** rather than adding a gate number keeps the failure
honest: an ineligible requirement is indistinguishable from one that does not
exist, so no caller can read an `eligible: true` verdict off
non-authoritative evidence.

---

## 10. Auto-confirm audit

`worker/spec-requirement-auto-confirm.mjs` — the **governed** deterministic
auto-approval path (12 gates + real CAS + audit row + policy version + system
actor). Per Phase 5 this was audited, found to be *legitimately authorized*, and
**preserved**, not disabled.

It is an **admission** gate, not a downstream-authority gate: it moves a
pending row into Approved. The eligibility predicate is deliberately **not**
applied there — requiring a requirement to be already Approved in order to be
approved is circular. The one real defect (the bare currency-less load, Leak 1)
was fixed.

Regression added proving a current, pending, Mandatory requirement is **still**
auto-confirmable — the fix narrows the leak, not the automation.

No other deterministic auto-confirm path was found that can turn an unapproved
requirement into engineering evidence on classification alone.

---

## 11. Candidate isolation

A `REQUIREMENT_CANDIDATE` lives at **clause level only** (MVP-CLOSE-11/13
model) and creates no `technical_requirements` row. Asserted: no row exists for
the candidate clause; its text never enters a context walk; it cannot be
promoted; it cannot be auto-confirmed. This protects the future promotion
workflow.

---

## 12. Cross-lineage safety

Same clause, text, category or family does **not** restore authority. Asserted
for a retired-but-approved requirement on a superseded extraction sharing a
clause with a current one, and for promotion eligibility.

---

## 13. Fingerprint/profile effect

Traced by a read-only subagent:

| Output | Before | After |
|---|---|---|
| `loadInputs` requirement set | `approved_for_downstream` only | both canonical conjuncts |
| Profile `input_fingerprint` (requirements) | leak via `approved_for_downstream`-only | closed |
| Profile `input_fingerprint` (Source Facts) | **leak** — unreviewed row → Active Source Fact | closed |
| BOQ understanding `input_fingerprint` | already triple-gated | unchanged |
| Matching `input_fingerprint` | inherited the Source-Fact leak | closed |
| Matching readiness / dossier | no direct requirement read | unchanged |

---

## 14. Tests

**New:** `tests/mvp-close-14-requirement-authority-containment.test.mjs` — 17 tests.

**Red phase proven.** With all four fixes reverted in place: **6 of 17 fail** —
Leak 2, three Leak 3 variants, Leak 1, and the clause-collision case. Restored:
**17/17 pass**.

Honest note on discrimination: the cross-lineage and retired-approved-promotion
tests pass in *both* states, because the pre-existing currency gate already
excluded those rows. They are guard-rail regressions against future widening,
not red-phase discriminators. The Leak 4 test is likewise satisfied by asserting
the corrected SQL rather than a leak outcome.

Validation:

| Suite | Result |
|---|---|
| `mvp-close-14-requirement-authority-containment` (new) | 17/17 |
| `engineering-knowledge` | 21/21 |
| `technical-requirement-engine` | 19/19 |
| `specification-extractor` | 32/32 |
| `boq-understanding` | 63/63 |
| `estimator-row-readiness` | 10/10 |
| `product-matching-engine` | 77/77 |
| `product-matching-api` | 6/6 |
| `confidence-safety-engine` | 16/16 |
| `product-price-library` | 11/11 |
| `governance-authority-gaps` | 7/7 |
| `compat-governance` | 6/6 |
| `source-fact-and-auto-confirm-authority` | 17/17 |
| `specification-current-version-authority` | 4/4 |
| `specification-requirement-lineage-authority` | 11/11 |
| `migration-chain-verification` | 3/3 |
| `current-evidence-scope` | 7/7 |
| `engineering-knowledge-api` | 10/10 |
| `document-downstream-api`, `spec-auto-confirm`, `profile-convergence`, `dashboard-*-authority` | all pass |
| `npm test` | **519/519** |
| `npm run test:knowledge` | **52/52** |
| `npm run lint` (touched files) | **0 errors**, 8 pre-existing warnings |
| `npm run build` | passes |

---

## 15. Files changed

**Production (6):**
- `worker/current-evidence-scope.mjs` — new canonical predicate + shared loader
- `worker/engineering-knowledge-api.mjs` — Leaks 2 + 4, canonical literals
- `worker/spec-source-fact-promotion.mjs` — Leaks 2b + 3, duplicate deleted
- `worker/spec-requirement-auto-confirm.mjs` — Leak 1
- `worker/technical-requirement-api.mjs` — profile-input eligibility
- `worker/estimator-understanding-api.mjs` — canonical literal

**Tests (4):**
- `tests/mvp-close-14-requirement-authority-containment.test.mjs` (new, 17)
- `tests/governance-authority-gaps.test.mjs` — mock schema completeness
- `tests/compat-governance.test.mjs` — mock schema completeness
- `tests/source-fact-and-auto-confirm-authority.test.mjs` — explicit approval

**Other:** `scripts/test-classification-baseline.json` (re-recorded).

### On the three test-fixture edits

These are **fidelity corrections**, not relaxations, and each is commented
in place:

- `governance-authority-gaps` / `compat-governance`: the mock
  `technical_requirements` omitted `review_status`, a column the **real** table
  has always had. The rows were already asserting approved-for-downstream
  requirements, which the governed paths always write as a pair.
- `source-fact-and-auto-confirm-authority`: the shared fixture seeds rows as
  `Needs Review`/`approved_for_downstream=0` because the auto-confirm tests in
  that file need a pending row. The five tests about **other** axes (scan
  scope, R11 subject gate) now approve their subject requirement explicitly, so
  each keeps testing what it was written for instead of silently re-testing
  approval. This was verified to fail 5/17 before the correction and pass
  17/17 after — it was a real break caused by the fix, not a pre-existing
  failure.

No golden evidence, no historical fixture, and no other lane's file was edited.

---

## 16. Business-state writes

**None.** No live requirement, approval, link, profile regeneration, matching
run, extraction, or promotion was created or mutated. The only database writes
are into throwaway `:memory:` SQLite instances created and discarded by the new
test file. No live D1 access. No commit, push, deploy, restart, reset, clean,
stash or revert.

---

## 17. test:all

Drift gate re-reviewed and re-recorded (413 files); the new file was confirmed
SAFE (its only URL is a `new Request(...)` object handed to a directly-invoked
handler against an in-memory DB — no network I/O).

**3955 tests, 3938 pass, 3 fail.** All three proven pre-existing by A/B with
*every* production change reverted:

| Suite | All my changes reverted | With my changes |
|---|---|---|
| `boq-line-bom-summary` | 0 pass / 2 fail | 0 pass / 2 fail |
| `review-workflow-atomic` (R8) | 27 pass / 1 fail | 27 pass / 1 fail |

Identical either way. This slice neither caused nor masked them.

---

## 18. Remaining defects

Found and deliberately **not** fixed here.

1. **`worker/specification-extraction-background.mjs:70` and `:273`** — the same
   unfiltered `SELECT DISTINCT system` as Leak 4, feeding extraction-time page
   mapping and candidate systems. A stale row can seed extraction. Left alone
   because it shapes **extraction** behaviour, which is adjacent to the
   out-of-scope admission policy and owned by the CLOSE-10/11/13 lanes. **This is
   the highest-value follow-up.**
2. **`worker/engineering-discovery-api.mjs:20`** — `approved_for_downstream=1`
   without `review_status`. Deprecated module, zero rows, no UI. Gating it would
   be correct but is dead code.
3. **`worker/engineering-knowledge-api.mjs:266`** — the links list joins raw
   `technical_requirements`, so a retired requirement's text can appear on a
   current link. Left **display-visible on purpose**: this is the review surface
   where a reviewer must see and dismiss bad links. Hiding rows someone must act
   on is its own authority defect. A currency annotation would be safe.
4. **`worker/engineering-knowledge-api.mjs:298`** — `propagate-system-wide`
   enforces approval in JS with `!requirement.approved_for_downstream` rather
   than the canonical predicate, and uses a weaker truthiness test than `:42`.
5. **`worker/technical-requirement-api.mjs:48`** — `loadApprovedIntelligenceAttributes`
   does not filter `requirement_profile_versions` on `superseded_at IS NULL`.
6. **CLOSE-10 lifecycle defects, untouched as instructed:** approve CAS may
   return success after a lost compare-and-swap; reject/restore may not
   regenerate profiles. Neither was required to close a leak.
7. **The 16 false negatives, `parseAccessory`, specification
   hierarchy/addressing, and the 59 orphan approvals** — all explicitly out of
   scope.

---

## 19. Next smallest slice

**Gate the two remaining unfiltered `DISTINCT system` reads in
`worker/specification-extraction-background.mjs` (defect 1).** It is the same
class as the leak just closed, it is the last live instance of the exact query
string that caused Leak 4, and it needs a canonical predicate plus a
currentness-aware extraction fixture — a contained change that unblocks nothing
else and risks nothing in the commercial lanes.
