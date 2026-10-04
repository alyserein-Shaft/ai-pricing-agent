# MVP-CLOSE-8 — Make Requirement-Link Confirmation Consistent and Idempotent

**Lane:** MVP-CLOSE-8 (code + isolated tests; no live business-state writes)
**Date:** 2026-09-28
**Primary agent owns:** requirement-link confirmation. MVP-SIZING-1 (technical agent) untouched.

Boundaries honoured: no live linking, approvals, regeneration, schema/config change, sizing change,
permission change, restart, commit, push or deployment. No new endpoint, no project-wide propagation.
Historical business records preserved. Sizing files untouched.

---

## 1. Correction to MVP-CLOSE-7's before/after count

**MVP-CLOSE-7's report was internally inconsistent and its header count was wrong.**

The actual recorded test run against unmodified source was **6 tests / 3 pass / 3 fail**, with failures on
cases **#1 (retired requirement confirmed), #3 (repeat appended a second decision), #4 (cross-project
confirmed)** — case #3 failed on the assertion `decisions === 1` receiving `2`, which is precisely the
duplicate-decision defect.

The report's *table*, however, listed only **2 failures and 4 passes**, because after that run I
re-characterized case #3 to assert the defect's actual behaviour (`decisions === 2`), which turned it green.
So the table was written against the re-characterized file while the header kept the original count. The
header (3/3) matches the real first run; the table (2/4) matches the state after re-characterization.
Neither described one consistent run.

**Corrected reading:** against MVP-CLOSE-7's unmodified source, the suite was **3 failing / 3 passing**, and
case #3's failure *was* the duplicate-decision defect — the very defect MVP-CLOSE-8 was dispatched to fix.
The before-count is therefore verified from this session's recorded run output, not from a persisted log
file; I did not save the red run to disk, so that evidence is the session transcript.

---

## 2. The consistency mechanism

### 2.1 What was wrong

`worker/engineering-knowledge-api.mjs` batched three statements:

1. `UPDATE boq_requirement_links … WHERE id=? AND status IN ('Suggested','Needs Review')`
2. `INSERT INTO engineering_knowledge_decisions …` — **unconditional**
3. `INSERT INTO document_audit_events …` — **unconditional**

A 0-row UPDATE is not a failure, so a repeat — or a request that lost a race — no-op'd the transition and
still appended **both** records. The handler then reported the requested status as if the transition had
happened. MVP-CLOSE-7's currentness check was also a **pre-read only**, so evidence retired after that read
could still be confirmed.

### 2.2 What it is now

One transaction; **two independent guards**, because neither is sufficient alone.

**Guard 1 — the link is the gate.** The UPDATE keeps the existing status compare-and-swap and additionally
re-asserts requirement currentness **at the mutation** for a `Confirmed` link, using the same canonical
`currentTechnicalRequirementsFrom` definition the pre-read and every reader use. There is deliberately **no
second lineage rule in this file**. Both dependent INSERTs repeat that post-state condition in their own
`WHERE`.

**Guard 2 — a collision-free natural key.** Guard 1 alone is *not* sufficient, and my first attempt was
wrong. I initially gated the dependent writes on the link's `reviewed_at` stamp. That is **not** a
collision-free discriminator: `now()` has millisecond resolution, so two same-actor requests inside one
millisecond produce an identical stamp, the post-state check matches twice, and duplicate records are
written. Measured: **31 duplicates in 60 simulated concurrent runs** — and the new test passed only by luck
on re-run, which is how I caught it.

The correct discriminator is structural: a link row can undergo **at most one** transition through this
route ever — the UPDATE only fires out of `Suggested`/`Needs Review` into a terminal status, and nothing
moves it back. A decision identity **derived from the link and the target status** is therefore not merely
safe, it is the correct natural key. This mirrors the existing deterministic-id convention already used by
`recordUnderstandingFieldDecision`. Each insert is additionally gated on its own key being absent, so a
repeat is a no-op **without** `OR IGNORE`, which would also have swallowed unrelated constraint errors.

**After the fix: 0 duplicates in 60 runs.**

### 2.3 Post-state classification, and no false success

After the batch the route reads the result's `changes` and the link's current row, then distinguishes three
outcomes from the database's own post-state rather than from an earlier read:

* **transition happened** → one decision, one audit, and regeneration runs;
* **already decided** → `transition: false, idempotent: true, decisionId: null, profile: null`, plus
  `regenerationRequired` computed from the shared `currentRequirementProfile` helper (reused, not
  re-derived);
* **still undecided** → the currency condition stopped it → `422 LINK_REQUIREMENT_NOT_CURRENT`.

Regeneration runs **only** for a real transition. If it throws, the route returns
`500 LINK_CONFIRMED_PROFILE_REGENERATION_FAILED` with `regenerationRequired: true` — the transition is
durably recorded, but a plain success is never reported while required regeneration is incomplete. A retry
returns an explicit idempotent no-op carrying `regenerationRequired`, never a false success. This preserves
the established recovery reality: `executeRequirementProfile` is invoked without a `runId`, and `updateRun`
returns early when `runId` is falsy, so a failure records no processing run — the canonical profile route
remains the recovery path.

---

## 3. Failing-before / passing-after

New suite `tests/requirement-link-confirmation-idempotency.test.mjs`, real handler, real ordered migration
chain.

**Before: 3 fail / 3 pass** (cases 2, 3, 6 failing — duplicates and idempotency).
**After: 6/6**, and the concurrency case now passes deterministically (0/60 duplicates).

| Suite | Result |
|---|---|
| `requirement-link-confirmation-idempotency.test.mjs` (new) | **6 / 6** |
| `requirement-link-confirmation-currency.test.mjs` (CLOSE-7) | **7 / 7** after its case #3 was updated |
| both together | **13 / 13** |
| `engineering-knowledge`, `engineering-knowledge-api`, `technical-requirement-engine` | **50 / 50** |
| broad `*knowledge*` + `*requirement*` sweep | **433 / 433** |
| `npm run test:knowledge` (experimental-flag suites) | **52 / 52** |
| `npm test` (default + build) | **519 / 519**, build complete |
| `npx eslint` on changed files | 0 errors, 0 new warnings |

**One test was changed, not added:** CLOSE-7's case #3 asserted the duplicate-decision defect (`2`
decisions). Since MVP-CLOSE-8 fixes it, the expectation is inverted to the correct behaviour, with a comment
recording what changed and why. The defect itself is now covered properly by the new suite.

---

## 4. Idempotency, currentness, concurrency, regeneration

* **Sequential repeat** — explicit idempotent no-op; zero duplicate decision/audit rows; link not
  re-stamped; no regeneration.
* **Competing confirmations** — two requests dispatched before either commits yield exactly one transition and
  one decision. Verified over **60 randomised-ordering runs, 0 duplicates** (31/60 before).
* **Currentness at the mutation** — retiring the requirement between the pre-read and the write is refused
  with no decision and no `Confirmed` status.
* **Failure atomicity** — every recorded decision is asserted to correspond to a link that actually reached
  the recorded status; a decision cannot exist without its transition.
* **Regeneration** — runs only on a real transition; failure returns a non-success with
  `regenerationRequired: true`; a retry returns a no-op that does not claim completion.
* **Preserved** — rejecting/removing a link whose requirement was retired still works (the currency clause is
  applied only to a `Confirmed` target); the `engineering_knowledge_decisions` immutability triggers are
  untouched; approval remains a separate axis from applicability confirmation.

### Concurrency limitation, stated explicitly

The competing-confirmation test dispatches two requests through the fixture's single serialising SQLite
connection, so it exercises interleaved `await` boundaries, not true parallel transactions. Combined with
the 60-run ordering sweep, the **duplicate-record** property is well covered. What is **not** proven is
safety against two writers in genuinely separate D1 transactions racing between the UPDATE and the INSERTs
— D1's own serialisation semantics are not exercised by this fixture. I am not claiming race safety beyond
what was measured. Note the natural key means the worst case is a rejected duplicate insert, not a silent
second record.

---

## 5. Test-inventory status — gate is NOT green

| File | Owner | Action |
|---|---|---|
| `tests/requirement-link-confirmation-idempotency.test.mjs` | this slice | Recorded. Evidence checked against the policy's own detectors first: no `REAL_STATE` match, no `SPAWNS_PROCESS` match, matches `CHAIN_FIXTURE` (non-excluding), in-memory database only → derived label `SAFE`. |
| `tests/mvp-sizing-1-expansion-evidence-laziness.test.mjs` | **technical agent (MVP-SIZING-1)** | **Not recorded. Not touched. Not classified by me.** |

`npm run test:all` therefore **remains red with exactly one unclassified file**, the sizing agent's. I did not
run `test:all:record`, because that would write a classification for another agent's file without their
isolation evidence, which the standing instruction forbids. The baseline diff for this slice is exactly one
added line — mine. The gate is unresolved and is reported as such rather than papered over.

---

## 6. Remaining limitations

1. **True D1 concurrency is unproven** (above).
2. **The link transition and its records are one D1 batch**, so they commit together. The one residual gap is
   that `executeRequirementProfile` runs *after* that batch commits; a crash between them leaves a
   `Confirmed` link whose regeneration never ran. This is surfaced honestly through
   `regenerationRequired`, not hidden, and is the pre-existing ordering.
3. **Conflicting later actions are unchanged by design.** Following the existing transition policy, a link
   already in a terminal status cannot be re-confirmed, rejected or removed through this route — they return
   an idempotent no-op. Un-confirming remains the `/supersede` path. No new policy was invented.
4. **Two offline scripts** still write `Confirmed` links outside any route; untouched, one already inert.
5. **Requirement approval is still not checked here** — a current-but-unapproved requirement can be
   confirmed. Separate axis, unchanged, and characterised by test.

---

## 7. Next project-progress step (not executed)

**Specification-review slice for the current-lineage duct-detector clause, then one bounded applicability
pass for item F** — the step MVP-CLOSE-6 identified and MVP-CLOSE-7's currency guard now makes safe to
revisit.

Concretely: review and, if correctly extracted, approve
`specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_207` (seq 100207, current extraction
`specextract_b4b03333-f24e-4b35-976e-2e2f9e681f89`, `Needs Review`, `approved_for_downstream=0`, page 14
§28 46 00, identical clause text and confidence 83 to the retired row) through the existing requirement-review
route. Only then is a confirmation meaningful — and MVP-CLOSE-7's guard guarantees any confirmation is
evaluated against current evidence.

Scope guard: **that single requirement only**, not the 59 approvals orphaned on the superseded lineage,
which remain a separate, larger specification-currency decision needing its own owner. Expected outcome
stated honestly in advance: it supplies technical requirements and may resolve the `standard` gap, but it
carries an empty `compatibility` array and therefore **will not** clear F's `compatibilityTarget` blocker.
F's readiness may remain `Missing Critical Information`; that is an acceptable result, not a failure.

---

## 8. Coordination

A read-only subagent traced every requirement-link route, the canonical currency definition, all
`validateRequirementLink` callers, schema/trigger constraints and test feasibility in the preceding slice; its
findings were verified against source and live data before use. For this slice, transaction and test design
were held by the primary agent to keep single write ownership over
`worker/engineering-knowledge-api.mjs`. The concurrency finding — the 31/60 duplicate rate in my own first
implementation — was caught by the primary agent's own diagnostic, not delegated, and is the reason the
mechanism was redesigned rather than shipped as first written.
