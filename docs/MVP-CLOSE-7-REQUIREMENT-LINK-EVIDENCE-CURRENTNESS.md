# MVP-CLOSE-7 — Prevent Confirmation of Retired Requirement Evidence

**Lane:** MVP-CLOSE-7 (code + isolated tests; no live business-state writes)
**Date:** 2026-09-28
**Primary agent owns:** requirement-link validation. MVP-SIZING-1 (technical agent) untouched.

Boundaries honoured: no live business-state writes, no approval or linking of `requirement_207` or its
counterpart, no project-wide `suggest-links`, no category-wide propagation, no new endpoint, no
compatibility inference or readiness relaxation, no schema/configuration change, no restart, commit, push
or deployment. Sizing files untouched; the shared dirty tree preserved.

---

## 1. Defect: **CONFIRMED**

"Currentness" here means **evidence version validity** only.

### 1.1 Handler-level evidence

The confirmation route reads the link like this:

```sql
SELECT l.* FROM boq_requirement_links l JOIN projects p ON p.id=l.project_id
 WHERE l.id=? AND p.owner_user_id=? AND l.superseded_at IS NULL
```

**It never joins `technical_requirements` at all**, so the requirement's extraction lineage is never
observed. The only guard on the write is a *status* compare-and-swap,
`… WHERE id=? AND status IN ('Suggested','Needs Review')` — that prevents re-stamping, not retired
evidence. `validateRequirementLink` checked status, scope, ids, reviewer and reason, and nothing else.

**No surrounding guard blocked it.** Confirmed against both the source and a live handler run: confirming a
link whose requirement hung off a **superseded** extraction returned **200**, wrote the knowledge decision,
wrote the document audit event, flipped the link to `Confirmed`, and triggered profile regeneration. The
same held for a link pointing at **another project's** requirement.

### 1.2 Exactly one gap — the other Confirmed-creating paths are already safe

An independent read-only audit enumerated every path that can create a `Confirmed` link:

| Path | Guarded? |
|---|---|
| `suggest-links` — shortlist INSERT | never Confirmed; requirement pool is current-scoped |
| `suggest-links` — deterministic auto-confirm | **already guarded** — same current-scoped pool, plus an explicit approval check |
| `propagate-system-wide` | **already guarded** — the requirement is selected current-scoped, so a retired one is not even found |
| `supersede` | never Confirmed |
| **`confirm` / `reject` / `remove`** | **not guarded — this was the gap** |

The fix adds no redundant guard. The other three `validateRequirementLink` callers were checked: the
`propagate` caller validates a `Confirmed` candidate and now asserts currency explicitly (omitting it would
have pushed every propagation into `skipped`, a silent total regression); the `supersede` caller validates
a `Rejected` status, so the new rule is never reached and un-confirming a retired link keeps working.

---

## 2. Source changes

**Two source files, three edits.**

### `app/domain/engineering-knowledge.mjs` — the shared rule

`validateRequirementLink` now requires, for any link that would gain `Confirmed` authority:

```js
if (link.requirementCurrent !== true) throw new KnowledgeIntegrityError(
  "LINK_REQUIREMENT_NOT_CURRENT",
  "A confirmed link requires a current, non-retired requirement. …");
```

Deliberate properties:

* **Fail-closed.** A caller that omits the flag is refused, not allowed. The old behaviour *was* the bug.
* **Scoped to `Confirmed` only** — rejecting or removing a stale link remains possible, which is how an
  engineer retires bad evidence.
* **Placed last** inside the `Confirmed` block, so the existing reviewer/reason messages are unchanged (an
  existing test asserts the reviewer message).
* **Currency only, never approval.** The canonical predicate says nothing about approval, so this does not
  smuggle in an approval check. That separation is pinned by test 5.

### `worker/engineering-knowledge-api.mjs` — the write boundary

The confirm route re-reads the requirement through the **canonical** definition at the write boundary,
scoped to the link's own project, and passes the real boolean:

```js
const requirementIsCurrent = Boolean(await env.DB.prepare(
  `SELECT r.id FROM ${currentTechnicalRequirementsFrom("r")} WHERE r.id=? AND r.project_id=?`
).bind(link.requirement_id, link.project_id).first());
```

Using `currentTechnicalRequirementsFrom` — the single shared definition — means the guard can never drift
from the readers. Scoping by `project_id` closes the cross-project face of the same hole with no extra
code.

`propagate-system-wide` passes `requirementCurrent: true`, which is honest: its requirement was already
selected through that same current-scoped query.

**No behavioural refactor.** No signature changes, no reordering, no status-map change, no history
rewritten or deleted.

---

## 3. Failing-before / passing-after

New suite `tests/requirement-link-confirmation-currency.test.mjs`, driving the **real handler** on the
**real ordered migration chain**.

**Before — 3 fail / 3 pass:**

| | Case | Result before |
|---|---|---|
| ✖ | 1. retired requirement refused, no side effect | **200 — link became `Confirmed`** |
| ✔ | 2. current + approved still confirms | Confirmed |
| ✔ | 3. repeat does not re-stamp the link | held |
| ✖ | 4. cross-project requirement refused | **200 — link became `Confirmed`** |
| ✔ | 5. current-but-unapproved characterised | held |
| ✔ | 6. rejecting a retired link still works | held |

The three that passed first are the behaviours that must **not** move.

**After: 7/7 pass**, including the write-boundary case added during review.

| Suite | Result |
|---|---|
| `requirement-link-confirmation-currency.test.mjs` (new) | **7 / 7** |
| `engineering-knowledge`, `engineering-knowledge-api`, `technical-requirement-engine` | **57 / 57** |
| all `*knowledge*` + `*requirement*` + `*applicab*` suites | **450 / 450** |
| `npm run test:knowledge` (needs the experimental module-mocks flag) | **52 / 52** |
| `npm test` (default, includes build) | **519 / 519**, build complete |
| `npx eslint` on changed files | 0 errors (1 pre-existing warning, present in `HEAD`, untouched) |

Three files initially reported failures in a broad sweep; they were `mock.module is not a function` and
require the experimental flag — **pre-existing, not caused by this change**; they pass with the flag.

### Case 7 — the write-boundary recheck, stated honestly

A requirement is retired at the exact moment of the route's link read, proving the decision uses a **fresh**
read rather than a value derived earlier. This exercises the re-read; it is **not** a true multi-actor race,
which this fixture cannot express.

---

## 4. Preservation of valid current-link behaviour

* A current, approved requirement still confirms normally: link `Confirmed`, one knowledge decision, one
  audit event.
* **Reject and remove still work on a retired link** — the guard targets gaining `Confirmed` authority only.
* The existing approval, applicability, project-authority and reason checks are untouched and still enforced.
* Currency is strictly separated from approval: a current-but-unapproved requirement is **not** blocked by
  this guard, and that is now asserted rather than assumed.
* Historical links and decisions are neither deleted nor rewritten; the guard only prevents new authority.

**Live data unchanged:** 3195 links, 115 knowledge decisions, 0 active links for F. No route was called
against live data.

---

## 5. Remaining limitations

1. **A repeat confirmation still appends a duplicate decision row.** The link's status CAS correctly
   prevents re-stamping, but the decision and audit INSERTs in the same batch are not covered by that CAS.
   This is a **pre-existing defect, out of scope here** (the brief keeps the duplicate-row concern
   separate, and it does not block this fix). Test 3 now pins the actual behaviour so it cannot be
   forgotten. The immutability triggers on that table are `BEFORE DELETE`/`BEFORE UPDATE` only, so they do
   not prevent it.
2. **The guard does not add an approval check.** A current-but-unapproved requirement can still be
   confirmed by this route. That is a separate axis, unchanged here, and now explicitly characterised.
3. **Two offline scripts** write `Confirmed` links against a live database outside any route. They are not
   application paths and were not touched; one of them references columns that no longer exist, so it is
   already inert.
4. `npm run test:all` is **red on one file owned by another agent** — see §6. Not a code defect.

---

## 6. Test-inventory disposition and ownership

The gate flagged two unclassified files. I recorded **only my own**:

* `tests/requirement-link-confirmation-currency.test.mjs` — verified against the inventory policy's own
  detectors before recording: no `REAL_STATE` match (no live D1, no Golden/Al Mousa reference), no
  `SPAWNS_PROCESS` match, and it matches `CHAIN_FIXTURE` (non-excluding). Derived label `SAFE`; database is
  in-memory only.

* `tests/mvp-sizing-1-expansion-evidence-laziness.test.mjs` — **owned by the technical agent (MVP-SIZING-1)**.
  I did **not** record it and did not touch it. Running `test:all:record` would have written a
  classification for another agent's file without their isolation evidence, which the standing governance
  instruction forbids. **The gate therefore remains red on that one line until its owner records it.** That
  is the correct, honest state rather than a green gate achieved by someone else's signature.

---

## 7. Current `requirement_207` counterpart — exact identity/status (read-only)

| Field | Value |
|---|---|
| id | `specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_207` |
| extraction_version_id | `specextract_b4b03333-f24e-4b35-976e-2e2f9e681f89` (**current** lineage) |
| sequence | 100207 |
| `review_status` | **`Needs Review`** |
| `approved_for_downstream` | **0** |
| type / category | Mandatory / Environmental |
| confidence | 83, Medium Confidence |
| text | "the air duct smoke detector shall be an intelligent non relay photoelectric type with either an indoor or nema4 watertight enclosure for outdoor use" |
| source | page 14, §`28 46 00 SECTION 28 46 00` |
| attributes / standards / compatibility / accessories | all empty |
| existing links | 0 |

Same clause text and confidence as the retired row, on the current extraction, awaiting requirement review.

**Observed vs predicted, stated separately:** F's *current, measured* readiness is
`Missing Critical Information` with `compatibilityTarget` as its one blocking issue. That is the observed
state today. What a hypothetical future link would do is **not** observed here — and per MVP-CLOSE-6 it
would not clear `compatibilityTarget`, because this requirement carries no compatibility target. No profile
or readiness value was changed, predicted-as-fact, or exercised in this slice.

---

## 8. One next bounded step (not executed)

**Close the duplicate-decision hole in the same route** — the limitation in §5.1, now isolated and pinned
by test 3.

It is the same handler and the same batch, so it is a one-place change: cover the decision and audit INSERTs
with the same status compare-and-swap the link UPDATE already uses, or add the read-boundary status guard, so
a repeat confirmation reports the existing state instead of appending a decision for a change that never
happened.

Exit criteria: a failing test first; then exactly one decision row per actual state change; the link CAS
behaviour unchanged; `engineering-knowledge`, `engineering-knowledge-api` and the new suite green; and the
`engineering_knowledge_decisions` immutability triggers still unaltered. It deliberately does **not** touch
approval policy, compatibility, readiness, sizing, or the specification re-extraction lineage.

---

## 9. Coordination

An independent read-only subagent traced every route, the canonical currency definition, all
`validateRequirementLink` callers, schema/trigger constraints and test feasibility. It ran no test and never
touched the database, and marked its own runtime claims `UNVERIFIED`. Its findings were accepted only after
primary verification, and two were acted on: the `propagate` caller needed an explicit `true` (otherwise a
silent total regression), and the new rule had to be placed after the existing reviewer/reason checks. It
also flagged the duplicate-decision defect, which is reported in §5.1 rather than silently fixed. No sizing
file was read for modification or edited.
