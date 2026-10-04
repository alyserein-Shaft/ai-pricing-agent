# MVP-CLOSE-4 — Repair Retry-Aware Understanding Currentness

**Lane:** MVP-CLOSE-4 (code + isolated tests; no business-state mutation)
**Date:** 2026-09-28
**Acceptance project:** `project_c0123d91-c30b-4956-87cb-e473ef53f89d` — Al Mousa School (Fire Alarm)
**Precondition:** MVP-CLOSE-3 (proved the defect; read-only)

**Boundaries honoured:** no requirement linking, no approvals, no Understanding retries, no profile
regeneration, no schema/migration/configuration change, no permission change, no readiness relaxation,
no compatibility-policy change, no R11 continuation. No restart, commit, push or deploy — the shared dev
process (PID 66503, `:4183`) was **not** restarted. All database access was read-only
(`PRAGMA query_only=ON`, or `readOnly: true` on a scratch copy). No historical fingerprint was altered
and no approval was re-stamped.

---

## 1. Root cause and the exact repair

### Root cause (unchanged from MVP-CLOSE-3, now fixed)

`executeRun` deliberately persists, for an **authorized retry** (`PER_ITEM_RETRY` / `CONTROLLED_RETRY`), a
configuration fingerprint mixed with that run's own authorization fingerprint:

```
sha256(stableStringify({ baseConfigFingerprint, authorizationFingerprint }))
```

so a retry's stored value can **never** equal the plain current fingerprint. The review-layer readers
compared by **exact equality only** and never even received the authorization value, making a valid
authorized retry of the *current* configuration indistinguishable from an interpretation produced under a
genuinely different configuration.

### The repair

One shared predicate, stated once, used by every reader and by the producer.

**`app/domain/boq-understanding-engine.mjs`** — two new exports beside `interpretationConfigFingerprint`:

* `authorizationScopedConfigFingerprint(base, authorization)` — the retry construction, byte-identical to
  what `executeRun` has always written, so **historical rows keep resolving with no backfill**.
* `interpretationConfigFingerprintIsCurrent(stored, current, authorization)` — current iff `stored === current`,
  **or** `stored` reconstructs exactly from `current` + `authorization`. Otherwise false.

Fail-closed contract: a retry marker or a merely non-empty authorization value is **never** sufficient; the
reconstruction must match byte for byte; wrong/absent/mismatched metadata is rejected; a genuinely
different base configuration stays stale because reconstruction is computed against the **current** base.
`currentConfigFingerprint == null` returns `false` (assert nothing) — callers without configuration context
keep their long-standing opt-out by short-circuiting **before** the call, exactly as all three do.

**Placement rationale.** All three consumer modules already imported this module, so the helpers added
**zero new import edges and no cycle**. The engine imports nothing from `worker/`. The independent review
confirmed this and additionally noted that `worker/` *already contains* a cycle
(`estimator-understanding-api.mjs` ↔ `estimator-understanding-review-api.mjs`), so a third module was the
right call.

**Call sites changed (5 edits, 4 files):**

| File | Change |
|---|---|
| `worker/estimator-understanding-review-api.mjs:48` | select `r.authorization_fingerprint authorizationFingerprint` — read through the **existing** `JOIN estimator_understanding_runs r ON r.id = i.run_id`, so the value is always the one belonging to the run that produced *that* interpretation |
| `worker/estimator-understanding-review-api.mjs:275` | `currentUnderstandingAttempt` uses the shared predicate |
| `worker/effective-understanding-interpretation.mjs:53` | effective-interpreter resolution uses the shared predicate |
| `worker/estimator-understanding-api.mjs:608` | `alreadyInterpretedItemIds` delegates to the shared predicate (duplicate formula removed) |
| `worker/estimator-understanding-api.mjs:798` | `executeRun` — the **producer** now uses the same construction, so value-written and value-checked can never drift |

`alreadyInterpretedItemIds` keeps its two pre-existing coverage guards verbatim
(`currentConfigFingerprint == null || configFingerprint == null → covered`). That is deliberate: this
reader's "no config context ⇒ covered" semantics are the **opposite** of the new predicate's fail-closed
default, and collapsing them would have flipped legacy 1-segment rows from covered back to eligible.

---

## 2. Files changed and why

| File | Kind | Why |
|---|---|---|
| `app/domain/boq-understanding-engine.mjs` | +2 exports + contract comment | Owns fingerprint semantics; dependency-safe home shared by all readers |
| `worker/effective-understanding-interpretation.mjs` | 2 lines | The defect site (resolver filter) |
| `worker/estimator-understanding-review-api.mjs` | 3 lines | Load retry metadata; fix `currentUnderstandingAttempt` |
| `worker/estimator-understanding-api.mjs` | 3 lines | De-duplicate the pilot formula; producer/consumer cannot drift |
| `tests/understanding-retry-config-currency.test.mjs` | **new**, 14 tests | Fails before, passes after |
| `scripts/test-classification-baseline.json` | +2 lines | Authoritative test-inventory gate; see §6 |

All four source files already carried unrelated dirty work from the shared tree; only the lines above were
added, and nothing pre-existing was reverted or reformatted. The whole-repository diff is not mine.

---

## 3. Failing-before / passing-after evidence

**Before the repair** (`tests/understanding-retry-config-currency.test.mjs`, 7 fail / 4 pass):

```
✖ authorizationScopedConfigFingerprint reproduces the real on-disk retry construction exactly
✖ interpretationConfigFingerprintIsCurrent: plain match, exact reconstruction, and fail-closed …
✖ [PER_ITEM_RETRY] a FAILED current-config attempt followed by a valid authorized retry … is current
✖ [CONTROLLED_RETRY] a FAILED current-config attempt followed by a valid authorized retry … is current
✖ a changed input fingerprint invalidates the prior retry authority and its field facts
✖ whole-blob approval precedence is unchanged and restricted field authority still binds
✖ effective selection and currentUnderstandingAttempt agree for every case
✔ a plain current-config interpretation stays current (no retry metadata at all)
✔ wrong authorization metadata on the retry run fails closed (stays stale)
✔ authorization metadata belonging to a different run/interpretation is not accepted
✔ a retry produced under a genuinely obsolete base configuration stays stale even when well-formed
```

The four that passed before are exactly the invariants that must **not** move — the red state isolated the
defect rather than the whole contract. The test builds the mixed fingerprint from the raw
`sha256 + stableStringify` primitive, deliberately **not** from the helper under test, so the on-disk format
is pinned independently of the implementation.

**After the repair: 14/14 pass**, including the three added after independent review (deliberate-behaviour
pin, NULL-authorization run, and pilot-vs-review reader agreement).

### Regression results

| Suite | Result |
|---|---|
| `tests/understanding-retry-config-currency.test.mjs` (new) | **14 / 14** |
| 16 directly affected suites incl. `understanding-field-review-authority`, `boq-understanding-retry`, `effective-understanding-interpretation`, `boq-understanding-status-policy`, `boq-understanding-pilot`, `understanding-approval-revalidation`, `understanding-run-progression`, `dashboard-api`, `gov-001-override-unblocks-approval`, `requirement-profile-understanding-handoff`, `product-matching-understanding-authority` | **295 / 295** |
| `npm test` (default, 35 files) + `npm run build` | **519 / 519**, build exit 0 |
| `npm run test:all` (authoritative inventory) | **3864 pass, 0 fail, 14 skipped** |
| `npx eslint` on all changed files | **0 errors** (2 pre-existing warnings, not mine) |

---

## 4. Runtime verification — **completed, not pending**

The running process **does** serve the changed code. Proof: the live summary moved from
`failed 10 / approved 18 / awaiting 20` to `failed 3 / approved 22 / awaiting 23`, which is unreachable by
the old exact-match filter, and the change is the only thing that could produce it. No restart was needed
and none was performed.

Read-only `GET /api/projects/{id}/estimator-understanding-review` (`Host: localhost` → `fullAccess`,
`local-development-user`):

```
LIVE: {"awaitingReview":23,"approved":22,"failed":3,"notAnalyzed":42,"revalidationRequired":0}
```

Matches the prediction exactly (`failed 10→3`, `approved 18→22`, `awaiting 20→23`, `notAnalyzed` unchanged
at 42). Independently, the fixed readers run against a **copy** of the live database now report **zero**
status divergence between the config-filtered and unfiltered readers — the asymmetry that caused this whole
defect is gone.

### Exact membership of the seven (from the live response, matched by `reviewKey`)

| Item | BOQ item | Before | After | Basis |
|---|---|---|---|---|
| F | `boqitem_ea12a5ee-866f-45db-91a1-621119569551` | FAILED | **AWAITING_REVIEW** | field-confirmed, no whole blob |
| G | `boqitem_e613397f-ddaf-4a18-85ef-dd7791d8aac4` | FAILED | **APPROVED** | system approval v1 |
| H | `boqitem_ff3d761b-dc84-4408-8a5f-c85ed99a85ff` | FAILED | **APPROVED** | system approval v1 |
| J | `boqitem_889d28ef-4b42-47b9-ad5b-d698787f9120` | FAILED | **AWAITING_REVIEW** | field-confirmed, no whole blob |
| L | `boqitem_adc0f04b-8f53-43fb-a4ff-f82ea108115e` | FAILED | **APPROVED** | system approval v1 |
| M | `boqitem_e750f539-4f25-46c0-a4ba-9f265bab329b` | FAILED | **APPROVED** | system approval v1 |
| N | `boqitem_610420bb-5b06-47df-ac79-3e60c40901c3` | FAILED | **AWAITING_REVIEW** | field-confirmed, no whole blob |

The 3 items that remain `FAILED` are correct: each has **zero** successful retries, so there is no current
proposal to report.

**Scope statement:** this restores *Understanding* currentness only. F/J/N are now
`AWAITING_REVIEW` — they still require an engineer decision, and nothing about matching eligibility,
technical approval, readiness or compatibility has changed by this slice.

### The four recovered approvals are SYSTEM approvals

All four are `reviewed_by = system:understanding-auto-approval`, `created_at 2026-09-20 19:54:38`,
`review_reason = "System Auto-Approval (policy understanding-system-auto-approval-1.0.0)"`. They are
**not** human decisions and are not represented as such. They were recorded through
`applyUnderstandingSystemAutoApproval`, which resolves **without** a config filter — so the system could
approve a row the human review screen (which resolves *with* the filter) could never have offered. This
slice made those pre-existing approvals visible again; it created none.

---

## 5. Existing business records preserved

Newest row in every governed table, all predating this slice:

| Table | Newest row |
|---|---|
| `requirement_profile_versions` | 2026-09-28 10:45:11 (MVP-CLOSE-1) |
| `estimator_understanding_field_reviews` | 2026-09-28 10:44:49 |
| `estimator_understanding_review_versions` | 2026-09-27 14:05:29 |
| `estimator_item_interpretations` | 2026-09-27 14:05:22 |
| `boq_requirement_links` | 2026-09-27 14:00:05 |
| `estimator_understanding_runs` | 2026-09-27 14:05:12 |

**F/J/N profiles are byte-for-byte unchanged** — still 6 rows (3 items × v1+v2), same versions, same
`input_fingerprint`s, same `created_at` (v1 `BOQ Extraction`, v2 `Approved AI Understanding` with
`Duct Detector` / `Manual Call Point` / `Strobe` intact). No profile regeneration was triggered or needed,
exactly as MVP-CLOSE-3 predicted. **No new review decision, field decision, interpretation, link,
processing run or profile version was created by this slice.**

---

## 6. Corrected count and actor scope

MVP-CLOSE-2/3 described all 87 field reviews as acceptance-project rows. The real distribution:

| Project | Field reviews | Items |
|---|---|---|
| `project_c0123d91…` (acceptance) | **36** | 12 |
| `project_ae501b85…` (Al Mousa School — Clean Golden Run) | **51** | 17 |
| **Total** | **87** | 29 |

(While verifying this I briefly queried a mistyped golden-project id and saw 0; the correct id is
`project_ae501b85-…`. The 36 / 51 / 87 split is confirmed by grouping on the stored values.)

**Actor scope, restated from actual stored fields:** all 87 field reviews carry
`reviewed_by = system:deterministic-understanding-field-confirmation`. There is no human reviewer on any of
them, and the table has **no `policy_version` column** — the policy string
`understanding-field-auto-confirm-1.0.0` exists only inside `review_reason`.

---

## 7. Independent review reconciliation

An independent reviewer (read-only, no overlapping writes) audited the plan and the landed code.

**Confirmed clean:** cycle safety; exhaustive site inventory (no call site missed — including
`dashboard-api.mjs:281/287` and `product-matching-api.mjs:242/248`, which are fixed transitively);
`authorization_fingerprint` is nullable with no CHECK and is NULL for every `CONTROLLED_PILOT` run;
`estimator_item_interpretations.run_id` is NOT NULL so the INNER JOIN can never yield `undefined`;
`executeRun`'s `existing()` reuse check must stay exact because of
`UNIQUE(boq_item_id, input_fingerprint, config_fingerprint)` — left untouched; no existing test regresses;
no other trigger can abort the test seeds.

**Actioned:**
1. It diagnosed the one red test as a **fixture** bug (seeding the raw merged payload, which carries the
   server-owned `boqItemId` and is therefore rejected by `sanitizeReviewedInterpretation`). I had already
   fixed it the same way — the real persistence shape is `sanitizePersistedAiInterpretation`.
2. **Test-inventory drift gate was failing.** `npm run test:all` exits non-zero on `REL-003 DRIFT GATE
   FAILED: the safe/excluded boundary changed (2 added, 0 removed)`. The two files are mine and one
   pre-existing untracked file from another agent. I recorded both; the diff is **exactly two added
   `|SAFE` lines** and the gate is now green. Flagging this explicitly because it touches a shared file.
3. **Deliberate behaviour change added as a pinned test** (see §8).

**Recorded, not actioned (correctly out of scope):** the pre-existing asymmetry where
`applyUnderstandingSystemAutoApproval` / `applyUnderstandingSystemFieldAutoApproval`
(`review-api:443`, `:637`) still write against an *unfiltered* resolution while filtered readers read
filtered; and the absence of a `run_mode` CHECK tying a non-null `authorization_fingerprint` to a retry
mode (redundant today — the binding is cryptographic, not nominal).

---

## 8. One deliberate behaviour change, now pinned

Before the repair, a **FAILED authorized retry** sitting on top of an older plain-config success was
invisible to the config filter, so `currentUnderstandingAttempt` saw the older success and matching stayed
open. Now the retry *is* a current attempt, so it correctly becomes the newest current attempt and
**matching fails closed** (`BOQ_UNDERSTANDING_REQUIRED`).

This is a **strengthening**, and it is the function's own documented rule (`review-api:263-269`): *"A later
FAILED or AI_UNAVAILABLE attempt proves that the current input/config no longer has an executable proposal,
even when an older success for the same input remains… a new matching run must fail closed."* The rule was
simply not reaching retries before. The review screen still offers the older proposal for re-approval,
because effective selection still resolves to it. Pinned by
*"a FAILED authorized retry over an older current-config success fails matching closed, while review still
offers the older proposal"*.

---

## 9. Next smallest slice (proposed — NOT executed)

**Reconcile the unfiltered write paths with the filtered readers**, i.e. decide and then implement one
policy for `applyUnderstandingSystemAutoApproval` (`review-api:443`) and
`applyUnderstandingSystemFieldAutoApproval` (`review-api:637`), which today bind a decision to an
interpretation chosen without config currency. It is the same class of defect, on the write side, and it is
the only remaining place where the two resolution modes still disagree.

Why now and why this: the readers are now correct and consistent, which makes the writers' divergence
*observable* rather than masked. It is still a policy decision, not a mechanical change, because the
correct answer is not obvious — a writer that resolves with config currency would refuse items the review
screen can no longer show, while one that resolves without it can bind a decision to a config-stale
interpretation.

Constraints for that slice: no re-stamping of the four existing system approvals (they are already
consistent again); preserve whole-blob precedence and the restricted field-level key set; fail closed on
absent metadata; add a failing regression test first; and do **not** proceed to the F/J/N `requirement_207`
link until the write-side policy is settled, since that link is a business decision that should not be
recorded by a writer whose authority mode is still under review.

---

## 10. Evidence classification

* **Project evidence** — active migration chain (journal order, NOT a directory sort), stored runs /
  interpretations / field and review decisions / profiles, read-only SQL and read-only HTTP.
* **Runtime evidence** — 14 new isolated tests on the real ordered migration chain; live
  `GET .../estimator-understanding-review` on the un-restarted shared process; fixed readers against a
  scratch copy of live data.
* **Independent review evidence** — separate read-only subagent audit of dependency safety, site
  completeness, schema facts, invariant risks and test design; its three actionable findings are reconciled
  in §7.
* **Inference** — that the 3 remaining `FAILED` items should stay failed (each has zero successful retries;
  observed, and consistent with the predicate's contract rather than assumed).

---

STOPPED — MVP-CLOSE-4 implementation and verification report complete.
