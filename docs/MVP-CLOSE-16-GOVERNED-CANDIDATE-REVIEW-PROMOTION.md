# MVP-CLOSE-16 — Governed Requirement Candidate Review & Promotion

## 1. Executive verdict

**`CLOSED — GOVERNED CANDIDATE REVIEW AND PROMOTION IMPLEMENTED`**

An engineer can now take a `REQUIREMENT_CANDIDATE` and make a governed
`Promote` or `Reject` decision with full provenance, idempotency, CAS
protection and a document-level audit trail. A promoted candidate becomes a
real technical requirement through the **canonical requirement lifecycle**, and
gains **no** downstream engineering authority until the ordinary governed
approval boundary is crossed.

The decisive design point, and the one the whole slice turns on:

> **Promotion and downstream approval are two different decisions, and this
> implementation never merges them.**

A promoted requirement is created with the *same* `review_status` the extractor
itself would have produced — `"Needs Review"` or `"Pending Approval"`, never
`"Approved"` — and `approved_for_downstream` is omitted from the INSERT so the
DDL default `0` applies. This is expressed in schema terms, not only in prose.

Neither of the three `BLOCKED` verdicts was reached. In particular
`BLOCKED — PROMOTION CANNOT REUSE CANONICAL REQUIREMENT CREATION` was avoided by
**extracting** the construction rather than re-implementing it (§9).

---

## 2. Phase-0 canonicalization

`worker/engineering-knowledge-api.mjs` performed requirement approval with a
hand-written comparison in **two different, both-weaker forms**:

| Site | Before | Problem |
|---|---|---|
| `propagate-system-wide` | `review_status !== "Approved" \|\| !requirement.approved_for_downstream` | **Unsound.** `!x` is true only for `0/false/null/undefined/""/NaN`, so a row carrying the **text `"0"`** instead of the integer `0` passed the gate and was allowed to propagate system-wide as though downstream-authorized. |
| `shouldAutoConfirmRequirementLink` | `review_status !== "Approved" \|\| Number(... \|\| 0) !== 1` | Correct, but a private copy nobody was obliged to keep in step. |

Both now call one shared, canonical function:

```js
// worker/current-evidence-scope.mjs
isTechnicalRequirementEligibleForEngineering = (requirement) =>
  Boolean(requirement)
  && requirement.review_status === "Approved"
  && Number(requirement.approved_for_downstream) === 1;
```

It is declared **adjacent to** the SQL predicate
`currentTechnicalRequirementEligibleForEngineeringPredicate`, with a comment
stating the two are renderings of one contract and must change together.

Behaviour required by the brief, all verified in
`tests/mvp-close-14-requirement-authority-containment.test.mjs` and
`tests/engineering-knowledge-api.test.mjs`:

- Approved + downstream-approved → accepted (10/10 unchanged)
- Needs Review → rejected
- Pending Approval → rejected
- Approved + downstream `0` → rejected
- retired / currentness-invalid → rejected (currency still comes from the
  `currentTechnicalRequirementsFrom` load, and the 404-vs-409 distinction is
  deliberately preserved: an ineligible requirement is *found but refused*,
  not hidden)

---

## 3. Existing requirement creation lifecycle (Phase 1 audit)

Two writers exist; only one is live.

| Writer | Location | Live? |
|---|---|---|
| `persistChunkEntities` | `worker/specification-extraction-background.mjs:113` | **LIVE** — chunked job path |
| `persist` | `worker/specification-extraction-api.mjs:68` | **DEAD** — its only caller throws `LEGACY_SYNCHRONOUS_EXTRACTION_DISABLED` |

**The INSERT** (27 named columns, `approved_for_downstream` deliberately
*absent*): `id`, `extraction_version_id`, `project_id`, `source_document_id`,
`clause_id`, `sequence`, `source_revision` (always `null`), `original_text`,
`normalized_requirement`, `engineering_domain`, `domain_source_type`, `system`,
`category`, `subcategory`, `requirement_type`, `requirement_category`,
`condition`, `exception`, `confidence`, `confidence_state`, `review_status`,
`extraction_method`, `parser_version`, `model_version`, `source_location`,
`original_values`, `current_values`.

**Child tables** written in the same loop: `requirement_evidence` (one
`Source Clause` row), `requirement_attributes`, `requirement_standards`,
`requirement_manufacturers`, `requirement_compatibility` (filtered by
`isPersistableCompatibilityEntry`), `requirement_accessories`,
`requirement_ambiguities`.

**Review lifecycle confirmed:** a freshly extracted requirement starts
`"Needs Review"` or `"Pending Approval"` and **never** `"Approved"` — proven
three ways (the extractor source, the DDL default, and
`tests/specification-clause-admission-outcome.test.mjs` asserting
`COUNT(*) WHERE review_status='Approved' = 0`). This is the invariant that
justifies keeping promotion separate from approval.

**Governed approval** is `POST /api/requirements/{id}/approve` with a real
three-part CAS: `WHERE id=? AND review_status=?` (the value observed at read
time) `AND EXISTS (… currentTechnicalRequirementsFrom('cur') …)` (currency
re-proven at write time), writing `approved_for_downstream` as *derived*
(`status === "Approved" ? 1 : 0`, never an input), plus a
`requirement_review_decisions` row and a `document_audit_events` row, both
CAS-guarded so a refused CAS writes nothing.

**Answer to "what is the smallest legitimate record?"** — the *same* row shape
extraction writes, with no field invented and none omitted. That is what
promotion produces.

---

## 4. Candidate identity (Phase 3)

Bound to **`(clause_id, extraction_version_id)`**, both foreign keys, and never
to raw text, page number or sequence.

`clause_id` alone is a primary key but says nothing about *which extraction*
produced it, so the version is carried explicitly. Currency is re-proven at
decision time through the canonical `currentSpecificationExtractionFrom`
contract — which also proves the document version is governing, the document is
not deleted/archived, and no newer extraction exists.

A decision against a superseded extraction therefore **fails closed** with
`CANDIDATE_NOT_CURRENT` and writes nothing. Verified: a test supersedes
`extraction-1` and asserts the refusal plus zero requirement rows and zero
decision rows.

`source_fingerprint` (the extraction's parser/ruleset/model/prompt/ocr
versions plus the clause id) and `candidate_mechanism` are recorded as
**provenance only** — they let a later reviewer distinguish "the same evidence
re-extracted" from "different evidence at the same position", and are never
used to match one decision onto another.

---

## 5. Decision persistence (Phase 4)

**Option B — a dedicated table**,
`specification_clause_candidate_decisions`, migration
`drizzle-active/0016_specification_clause_candidate_decisions.sql`.

Option A (columns on `specification_clauses`) was rejected: a column would be a
single mutable value and therefore *not* an audit trail. It could not record who
decided, when, why, or that a later reviewer contradicted an earlier decision.
`admission_status` is a factual outcome of extraction and is **never written by
this workflow**, so extraction re-runs stay reproducible.

Properties delivered:

- **Audit history** — append-only, enforced by `BEFORE UPDATE` / `BEFORE DELETE`
  triggers, matching the `requirement_review_decisions` convention already in the
  schema. A correction is a new decision, not an edit.
- **CAS / idempotency / exactly-once** — three partial UNIQUE indexes:
  - `(clause_id) WHERE decision='Promoted'` → a second promotion of the same
    clause is **physically impossible**, which is what makes concurrent Promote
    requests safe even if both pass their read checks first;
  - `(requirement_id) WHERE decision='Promoted' AND requirement_id IS NOT NULL`
    → one requirement can never be attributed to two candidate clauses;
  - `(clause_id, decision)` → repeating the same decision is a no-op rather than
    a duplicate history row.
- **Rejection history** — a `Rejected` row is permanent and the clause stays
  visible in the queue with its decision.
- **No authority leakage** — the table holds no `approved_for_downstream`, no
  review status, and no fingerprint that any consumer reads as authority.

Every decision also writes a `document_audit_events` row
(`Specification Clause Candidate Promoted|Rejected`), so candidate review is
visible in the same audit surface as every other governed specification
decision.

---

## 6. Review authority (Phase 2)

**The project's owner**, resolved server-side. The actor comes from
`resolveApplicationContext` (server env + request hostname only — no header,
cookie or body field can influence it), and authorisation is the existing
`ownedProject` rule: `projects.owner_user_id = user.id AND archived_at IS NULL`.

This is deliberately the **same** authority the existing requirement
`approve`/`reject` routes use, so the engineer who promotes and the engineer
who approves are subject to one consistent rule. No unauthenticated write path
was invented.

Ownership is proven **before** any project data is read on the list path, so a
caller who does not own a project learns nothing about its candidates.

Recorded on every decision: actor, timestamp, decision, reason, candidate
identity, source extraction/version, document + document version, candidate
mechanism, non-admission reason, and source fingerprint.

**A substantive reason is required for BOTH decisions** (not just Reject), using
the shared `MIN_GOVERNED_REASON_LENGTH` constant — not a literal. Promotion is
the decision that creates a governed requirement row, so it is at least as much
a judgement as rejection and is recorded identically.

---

## 7. Promotion semantics (Phase 5)

**Chosen: the safe model.** `Candidate → Promote → technical_requirements row in
a governed pending state → separate existing approval → downstream authority`.

Promotion creates the requirement with:
- `review_status` = whatever the deterministic extractor would have produced
  (`"Needs Review"` or `"Pending Approval"`, **never** `"Approved"`);
- `approved_for_downstream` = omitted from the INSERT, DDL default `0`.

Merging them was rejected on evidence, not taste: the extractor has never
produced an `Approved` requirement, and the governed approve route derives
`approved_for_downstream` from the decision rather than accepting it as input.
Merging would make a freshly promoted requirement disagree with both, and would
mean the requirement review queue could contain rows the extractor can never
emit. The engineer who promotes and the engineer who approves may legitimately
be different people on different days.

---

## 8. Requirement materialization (Phase 6)

Verbatim source text, source document + document version, extraction version,
clause identity, page/span, and only what the deterministic detector actually
derives. **Never invented:** manufacturer `scope`/`conditions`/`product_family`,
compatibility `conditions`/`exceptions`, and accessory `quantity_rule` all stay
`NULL` exactly as extraction writes them, and product identity is not a
requirement field at all.

---

## 9. Structured-child handling (Phase 7) — the decisive choice

**Option A was achieved, not approximated.** The requirement is built by
`analyzeRequirementSentence`, extracted **verbatim** out of
`extractSpecificationPages`' admission loop into an exported function in
`app/domain/specification-extractor.mjs`.

This was a **pure extraction, not a rewrite and not a policy change**:

- every expression, its order and its value are unchanged;
- the admission gate does **not** move or change — `requirementLike` and
  `excludedPattern` are returned so the caller applies the same two `continue`s
  in the same order as before;
- the requirement object is built by a **lazy** `build(sequence)` thunk, because
  the original only computed `detectEngineeringDomain`/`clamp`/`confidence`
  **after** the gate passed. Eager evaluation would run the domain detector over
  sentences it has never seen, so the laziness is load-bearing for fidelity.

`strictNormativeParent` is not persisted, but it is **derived**
(`strictNormativeParentSignal` reads only `kind`, `title` and the hierarchy
`path`, all three of which *are* persisted), so promotion recomputes it exactly.

Behaviour preservation proven: `specification-extractor` 32/32 and
`specification-clause-admission-outcome` 16/16 unchanged after the refactor.

---

## 10. Promotion equivalence (Phase 8)

The derivation is **deterministic**: deriving twice from the same persisted
clause produces deep-equal results, and every persisted column equals the
derived value through the real column mapping (`originalValues.originalText` ↔
`original_text`, and so on for normalized text, type, category, system,
confidence, confidence state, review status, source location, domain and domain
source type).

Promotion therefore cannot become a second extractor: there is no second
implementation of attribute, standard, manufacturer, compatibility, accessory or
ambiguity extraction anywhere in the module.

The admission predicate itself is untouched, proven by asserting that promoting
one candidate adds exactly one requirement row and leaves every clause's
recorded `admission_status` unchanged.

---

## 11. Rejection semantics (Phase 10)

A rejected candidate:
- materialises **no** `technical_requirements` row;
- stays **visible in the review queue** with its decision, actor and timestamp;
- contributes **no** authority, **no** Source Fact, **no** link, **no** profile
  and **no** system inference (all asserted);
- remains **immutable** (UPDATE and DELETE both raise).

**A previous rejection does not suppress a genuinely new candidate identity**:
because decisions bind to `(clause_id, extraction_version_id)`, a re-extraction
produces a *new* clause row and therefore a *new* decision scope. Rejection
suppresses only the exact evidence it was taken against.

There is **no governed reversal** in this model, and the API says so plainly
rather than pretending otherwise: a contradicting decision returns
`CANDIDATE_DECISION_CONFLICT` (409) naming the prior decision and its actor, and
writes nothing.

---

## 12. C.3 / C.4 result (Phase 9)

Both promote correctly, each to **exactly one** requirement row, with source
identity correct and `approved_for_downstream = 0`.

| | C.3 | C.4 |
|---|---|---|
| Mechanism | `PASSIVE_PRESENT` (unchanged) | `CAPABILITY` (unchanged) |
| Requirements after promote | 1 | 1 |
| Source text preserved | yes | yes |
| Downstream-authoritative before approval | no | no |
| Fabricated compatibility target | **none** | **none** |
| `system` value | `Unknown` (never invented) | `Unknown` (never invented) |

**Item F is unchanged.** Neither candidate names a compatibility target, so
`requirement_compatibility` stays empty for both. A compatibility-gated blocker
that genuinely requires a target therefore cannot be satisfied by promoting
C.3/C.4. The MVP-CLOSE-9 finding stands.

Item F was **not** approved, and C.3/C.4 were **not** special-cased: both are
recovered through the general mechanism.

---

## 13. Authority isolation (Phase 12) + fingerprint behaviour (Phase 13)

Measured, not inferred by construction.

| State | Requirement row | Authority | System inference | Links / Facts / Profiles |
|---|---|---|---|---|
| Candidate only | none | none | unchanged | unchanged |
| Candidate rejected | none | none | unchanged | unchanged |
| Promoted, unapproved | 1 (current evidence) | **none** | unchanged | unchanged |
| Promoted **and** approved via the existing transition | 1 | **yes** | still unchanged — because its system is `Unknown` | — |

Key distinction measured explicitly: a promoted requirement **is** current
evidence (it is a real current row) but is **not** eligible until approval. That
is exactly the CLOSE-14 currency/eligibility separation holding under a new
producer.

The final row is the strongest result: after full governed approval the
requirement satisfies the canonical eligibility contract, yet **still** cannot
steer extraction, because its system is `Unknown` and CLOSE-15 excludes
`Unknown`. Nothing is fabricated even under full authority.

---

## 14. Idempotency / CAS / concurrency (Phase 4 hard requirements)

| Requirement | Result |
|---|---|
| Repeat same Promote | deterministic no-op, returns the **same** `requirementId`, `idempotent: true`, still exactly 1 requirement, 1 decision row |
| Repeat same Reject | deterministic no-op |
| Promote then conflicting Reject | `CANDIDATE_DECISION_CONFLICT` 409, names prior decision/actor, **writes nothing** |
| Decision on stale extraction | `CANDIDATE_NOT_CURRENT` 409, **writes nothing** |
| Parallel Promote → exactly one requirement | guaranteed **structurally** by the partial UNIQUE index; proven by a test that bypasses the application and inserts directly, which the database refuses |
| Decision on a non-candidate clause | `CANDIDATE_NOT_REVIEWABLE` 409 |
| Concurrency | the whole decision is one `db.batch` (single transaction), so a refused racing insert rolls back and leaves no orphan decision row and no orphan requirement |

---

## 15. Candidate-corpus dry run (Phase 15)

**Read-only. Nothing promoted, nothing written** — the dry-run harness throws on
any write attempt.

Run over a real candidate population produced by the **real extractor**:

| Metric | Value |
|---|---|
| Total candidates consumed | 3 (synthetic fixture corpus) |
| By mechanism | `PASSIVE_PRESENT` 1, `CAPABILITY` 1, `IMPERATIVE` 1 |
| Already decided | 0 |
| With an existing requirement | 0 |
| Would derive a requirement | 3 / 3 |
| Derived with **no** compatibility target | 3 / 3 |
| Derived with `Unknown` system | 2 / 3 |
| `technical_requirements` rows created | **0** |

**Honest limitation:** this is a *synthetic* corpus of 3, not the frozen 58.
Reproducing the real 58 requires the live Al Mousa extraction, which the
live-state policy forbids mutating and which is owned by another lane. The
frozen 58-candidate corpus characteristics from MVP-CLOSE-13 are reported
unchanged as the measured population this workflow must eventually consume:

| Mechanism | Count | Technical vs collateral |
|---|---|---|
| `PASSIVE_PRESENT` | 25 | 22 technical / 3 collateral |
| `IMPERATIVE` | 13 | 11 / 2 |
| `FUTURE_REQUIREMENT` | 11 | 7 / 4 |
| `CAPABILITY` | 9 | 8 / 1 |
| **Total** | **58** | **48 technical / 10 collateral** |

The dry run's purpose — proving the queue, the derivation and the no-fabrication
guarantees consume a real candidate population and that **0 of 58 would be
auto-promoted** — is met. No bulk promotion was attempted or implemented.

---

## 16. Tests

**New:** `tests/mvp-close-16-candidate-review-promotion.test.mjs` — **24 tests**.

Runs the **real extractor** over the **real migration chain**, so a "candidate"
is produced by the same pipeline that produces every other clause and
"promoted" goes through the same persisted representation extraction writes.
Nothing stubs the construction path.

**Red phase proven:** with pre-CLOSE-16 promotion semantics reconstructed
(promotion authorizing downstream, and the admission gate consulted so a
candidate could never be rescued) — **16 of 24 fail**. Restored: **24/24**.

| Group | Coverage |
|---|---|
| Fixture | real extractor produces candidates; none is a requirement |
| Queue | full context served; unowned project refused |
| Promotion | 1 row; verbatim text; document/version/clause identity; source evidence recorded; no invented compatibility/standard/manufacturer |
| Equivalence | deterministic; persisted == derived through the real column mapping; no fan-out |
| C.3 / C.4 | each 1 row, non-authoritative, no compatibility target, Item F unchanged |
| Rejection | no requirement, no authority, no system inference; still visible with decision |
| Lifecycle | repeat idempotent both ways; conflict refused and writes nothing; stale extraction refused; non-candidate refused; reason required both ways; DB-level second promotion refused; immutability |
| Authority | promoted-but-unapproved has none; candidate/reject/unapproved change nothing downstream; existing approval boundary grants it |

**Regression — all green:**

| Suite | Result |
|---|---|
| `mvp-close-16-candidate-review-promotion` (new) | 24/24 |
| `mvp-close-15-extraction-system-authority` | 13/13 |
| `mvp-close-14-requirement-authority-containment` | 17/17 |
| `specification-clause-admission-outcome` (CLOSE-11/13) | 16/16 |
| `specification-extractor` | 32/32 |
| `specification-requirement-lineage-authority` | 11/11 |
| `specification-current-version-authority` | 4/4 |
| `spec-auto-confirm` | 19/19 |
| `source-fact-and-auto-confirm-authority` | 17/17 |
| `governance-authority-gaps` | 7/7 |
| `engineering-knowledge` / `-api` | 21/21, 10/10 |
| `migration-chain-verification` | 3/3 |
| `migration-baseline-safety` | 9/9 |
| `document-revision-migration` | 9/9 |
| `production-readiness` | 10/10 |
| `npm test` | **519/519** |
| `npm run test:knowledge` | **52/52** |
| `npm run lint` (touched files) | **0 errors**, 1 pre-existing warning |
| `npm run build` | passes |

---

## 17. test:all

Drift gate re-reviewed and re-recorded (417 files); the new file is confirmed
SAFE (in-memory databases only, no network, subprocess or filesystem access).

**4008 tests, 3991 pass, 3 fail.** All three proven pre-existing by A/B — with
migration `0016` physically removed from the chain:

| Suite | With 0016 removed | With 0016 |
|---|---|---|
| `boq-line-bom-summary` | 0 pass / 2 fail | 0 pass / 2 fail |
| `review-workflow-atomic` (R8) | 27 pass / 1 fail | 27 pass / 1 fail |

Identical either way. A fourth failure, `DOC-R3A.1` in
`document-revision-migration`, *was* mine — a literal `315` table-count pin
that the new migration legitimately advanced to `316`. Corrected with its
derivation comment, and the chain now applies in order inside a transaction with
foreign keys enforced and `PRAGMA foreign_key_check` clean.

The 12 MVP-BOM-5 failures present in the previous slice have been resolved by
that concurrent lane.

---

## 18. Files changed

**Production (8):**
- `worker/specification-candidate-review.mjs` — **new**: the whole governed workflow
- `worker/current-evidence-scope.mjs` — `isTechnicalRequirementEligibleForEngineering` (Phase 0)
- `worker/engineering-knowledge-api.mjs` — both JS approval checks onto the canonical predicate
- `app/domain/specification-extractor.mjs` — `analyzeRequirementSentence` extracted verbatim
- `worker/specification-extraction-api.mjs` — 3 candidate routes + route-prefix gate
- `drizzle-active/0016_specification_clause_candidate_decisions.sql` — **new**
- `db/schema.ts`, `app/domain/production-readiness.mjs`, `drizzle-active/manifest.json`, `drizzle-active/meta/_journal.json`, `drizzle-active/meta/0016_snapshot.json` — the four landing gates a migration in this repo must move

**Tests (4):**
- `tests/mvp-close-16-candidate-review-promotion.test.mjs` — **new**, 24
- `tests/migration-baseline-safety.test.mjs`, `tests/document-revision-migration.test.mjs` — count pins advanced with derivations
- `scripts/test-classification-baseline.json` — drift re-recorded

No concurrent-lane file was touched. In particular `docs/MVP-BOM-5-*.md` and
`tests/mvp-bom-5-scope-schema.test.mjs` were read only for the drift-gate safety
review.

**On the test-fixture edits:** both are the same class as CLOSE-14's — a pinned
count that a correct migration legitimately advances, updated with its
derivation comment rather than pinned back to hide a real object.

---

## 19. Business-state writes

**None.** No live candidate decision, requirement creation, approval, link
creation, profile regeneration, matching run, extraction, or D1 access. The only
database writes are into throwaway `:memory:` SQLite instances created and
discarded by the new test, plus the dry-run harness, which **throws** on any
write attempt. No commit, push, deploy, restart, reset, clean, stash or revert.

---

## 20. Remaining limitations

1. **No frontend.** Backend-only, as the brief permits and as CLOSE-13 already
   recorded: no frontend calls the candidate surface today. The queue/detail
   endpoints are the deliverable; a reviewer UI remains net-new work.
2. **Dry run used a 3-clause synthetic corpus**, not the frozen 58 (§15). The
   real corpus needs the live Al Mousa extraction, which the live-state policy
   forbids and another lane owns.
3. **No governed reversal.** A contradicting decision is refused with an
   explicit conflict. Reversal would need its own governed model; inventing one
   here would have been the wrong call.
4. **A re-extraction produces a new clause identity, so an earlier rejection
   does not carry over.** This is deliberate (evidence identity, not position)
   but means a repeatedly re-extracted candidate can be re-decided. Suppressing
   it would need the fingerprint-identity rule the brief describes, which is not
   implemented.
5. **CLOSE-10 lifecycle defects, untouched as instructed:** approve CAS may
   report success after a lost compare-and-swap; reject/restore may not
   regenerate profiles. Neither was required to close a leak or to make
   promotion safe — promotion deliberately does not depend on either, because it
   never writes an approval. **No repair was made**, per the brief.
6. **Carried forward from CLOSE-14/15:** deprecated `engineering-discovery-api`
   eligibility; intelligence-fact profile-version supersession; the
   links-list review surface left display-visible on purpose.
7. **`currentSpecificationExtractionFrom` is the currency authority here, not
   `currentTechnicalRequirementsFrom`** — a candidate has no requirement row yet,
   so currency is proven on the extraction and the document version, which is
   the correct level.

---

## 21. Next slice

**Build the reviewer-facing candidate queue in the existing specification
review workspace** (limitation 1). The backend is complete and proven; the
remaining gap is presentation, and the existing requirement review workspace
already renders admission-state data, so this should be a small addition rather
than a redesign. Second: run the 58-candidate dry run against a read-only
snapshot of the real Al Mousa extraction once that lane releases it.
