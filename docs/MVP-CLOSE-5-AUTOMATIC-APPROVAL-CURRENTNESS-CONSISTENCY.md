# MVP-CLOSE-5 — Close Automatic-Approval Currentness Consistency

**Lane:** MVP-CLOSE-5 (bounded write-side repair + isolated tests; no business-state mutation)
**Date:** 2026-09-28
**Acceptance project:** `project_c0123d91-c30b-4956-87cb-e473ef53f89d` — Al Mousa School (Fire Alarm)
**Precondition:** MVP-CLOSE-3 (diagnosis), MVP-CLOSE-4 (reader-side repair, accepted)

**Boundaries honoured:** no requirement linking (including `requirement_207`), no approvals, no
Understanding retries, no profile regeneration, no schema/migration/configuration change, no permission
change, no readiness relaxation, no compatibility-policy change, no sizing/commercial/R11 changes. No
commit, push or deployment. The shared dev process (PID 66503, `:4183`) was **not** restarted. All
database access was read-only; **no live approval route was called**.

---

## 1. Proven writer behaviour, before → after

### 1.1 The gap was real, and it was in the *callers*, not the policy

Both writers resolved their row with `loadUnderstandingReviewRows(db, projectId)` — **no**
`currentConfigFingerprint`. A null fingerprint is the resolver's long-standing "no configuration context"
opt-out, which **skips config currency entirely**.

Proven with the real modules against an isolated database built from the real ordered migration chain,
seeding an interpretation produced under a genuinely obsolete base configuration (different model,
`58c7741d…` vs current `6fb54e06…`):

| Probe | Result before |
|---|---|
| `applyUnderstandingSystemAutoApproval` | **`applied: true`**, `eligible: true`, whole-blob approval **written** |
| `applyUnderstandingSystemFieldAutoApproval` | **`applied: true`, 3 field confirmations written** (`system`, `category`, `productFamily`) |
| Control: same seed under the *current* config | **byte-identical output** — proving config currency is never consulted |
| The config-aware reader on that same row | `UNAVAILABLE_OR_STALE` / `REVALIDATION_REQUIRED` |

So the writers produced governance records the canonical reader immediately contradicted.

**The approval policy was never at fault.** Gate 1 of `evaluateUnderstandingSystemAutoApproval` already
refuses `proposalState !== "AVAILABLE"`. It was handed a row whose state had been computed with
currentness checking switched off. No policy change was needed or made.

### 1.2 After the repair

| Case | Whole-blob writer | Field writer |
|---|---|---|
| plain current config | approves | confirms 3 fields |
| valid authorized retry of the current base | approves | confirms 3 fields |
| genuinely obsolete base | **refuses** | **refuses** |
| otherwise-valid retry under an obsolete base | **refuses** | — |
| wrong / missing / empty retry metadata | **refuses** | — |
| changed input fingerprint | refuses (already did) | refuses (already did) |
| idempotent repeat | no second decision | idempotent no-op |
| newest attempt FAILED | **refuses** (no silent fallback to an older success) | **refuses** |
| no configuration context supplied | **explicit refusal** | **explicit refusal** |
| whole-blob precedence / restricted field keys | preserved | preserved |

---

## 2. Exact changes

**One production file, one new test file, one metadata line.**

| File | Change |
|---|---|
| `worker/estimator-understanding-review-api.mjs` | `applyUnderstandingSystemAutoApproval` and `applyUnderstandingSystemFieldAutoApproval` take a required `currentConfigFingerprint` and resolve with it; both refuse explicitly when it is absent; both refuse when the newest current attempt is `FAILED`/`AI_UNAVAILABLE`; both routes pass `currentConfigFingerprintFor(env)` |
| `tests/understanding-writer-config-currency.test.mjs` | **new**, 10 tests |
| `scripts/test-classification-baseline.json` | +1 derived `\|SAFE` line (§6) |
| `tests/understanding-retry-config-currency.test.mjs` (mine) | 2 call sites gain the new argument |
| `tests/understanding-system-auto-approval.test.mjs` (**another agent's untracked file**) | 4 call sites gain the new argument — **mechanical only** |

The repair reuses the MVP-CLOSE-4 shared predicate through the existing resolver; it introduces no new
fingerprint logic and does not re-derive currency by any second route.

**Two new refusal codes**, exported as constants so callers can branch on them:
`UNDERSTANDING_CONFIG_CONTEXT_REQUIRED`, `UNDERSTANDING_LATEST_ATTEMPT_FAILED`.
Both surface through the existing route shape (`409` + outcome body) — no HTTP contract change.

**Explicitly unchanged:** approval policy, restricted field key set (`system`/`category`/`productFamily`),
idempotency and the `recordUnderstandingFieldDecision` compare-and-swap, `mutateUnderstandingReview`'s
`selectionAuthority` + `expectedVersion` CAS, whole-blob precedence, cascade behaviour, and the `null`
opt-out for **readers** that legitimately have no configuration context.

> **Ownership flag:** the signature change forced a 4-argument update in
> `tests/understanding-system-auto-approval.test.mjs`, which is **untracked shared work I did not create**.
> The edit is mechanical (adds `, 'cfg1'` — the config its own seed already persists) and preserves intent
> exactly, but it is another agent's file and is called out here for their review.

---

## 3. Regression evidence

**Red before:** 5 fail / 5 pass. The five that passed first are exactly the invariants that already held
(current config, valid retry, input-change, idempotency, precedence) — the red state isolated the gap
rather than the contract.

```
✖ 3.  both writers REFUSE a genuinely obsolete base configuration
✖ 3b. an otherwise-valid retry under an OBSOLETE base is still refused
✖ 4.  both writers REFUSE wrong, missing and mismatched retry metadata
✖ 7.  both writers REFUSE when the newest current attempt FAILED…
✖ 8.  both writers refuse EXPLICITLY when no configuration context is supplied
✔ 1, 2, 5, 6, 9
```

**Green after: 10/10.**

| Suite | Result |
|---|---|
| `tests/understanding-writer-config-currency.test.mjs` (new) | **10 / 10** |
| 17 directly affected suites (incl. `understanding-system-auto-approval`, `understanding-field-review-authority`, `understanding-retry-config-currency`, revalidation, completion, progression, pilot, review, dashboard, gov-001, profile handoff, matching authority) | **263 / 263** |
| `npm run test:all` (authoritative inventory) | **3874 pass, 0 fail, 14 skipped** |
| `npm run build` | exit 0 |
| `npx eslint` on changed files | 0 errors, 0 new warnings |

---

## 4. Preservation of existing business records

Newest row in every governed table — all predate this slice:

| Table | Newest |
|---|---|
| `requirement_profile_versions` | 2026-09-28 10:45:11 |
| `estimator_understanding_field_reviews` | 2026-09-28 10:44:49 |
| `estimator_understanding_review_versions` | 2026-09-27 14:05:29 |
| `estimator_item_interpretations` | 2026-09-27 14:05:22 |
| `boq_requirement_links` | 2026-09-27 14:00:05 |
| `estimator_understanding_runs` | 2026-09-27 14:05:12 |

Totals unchanged: 157 review decisions, 87 field decisions, 575 profile versions. Nothing was
re-stamped, revoked, regenerated or rewritten.

**Non-regression proof (the important one).** The four system approvals and the three field-confirmed
retry items were written by the *old* unfiltered writers. I checked — against a scratch copy of live data,
read-only — whether the **repaired** writers would still accept them:

| Record | selected | state | newest attempt | new guards |
|---|---|---|---|---|
| 4 system approvals (G, H, L, M) | their retry | `AVAILABLE` | `NEEDS_REVIEW` ×3, `COMPLETED` ×1 | **pass** |
| 3 field-confirmed retries (F, J, N) | their retry | `AVAILABLE` | `NEEDS_REVIEW` ×2, `COMPLETED` | **pass** |

So the repair does not invalidate a single existing record, and no re-stamping or revocation is warranted.
Their bound interpretations are valid authorized retries of the current base configuration — the same
predicate MVP-CLOSE-4 introduced.

---

## 5. Runtime verification — partial, and deliberately bounded

* **Completed (read-only):** the live process is healthy and reader behaviour is **unchanged** by a
  write-side repair — `GET …/estimator-understanding-review` returns
  `awaiting 23 / approved 22 / failed 3 / notAnalyzed 42`, identical to MVP-CLOSE-4. Server not restarted.
* **Not performed, by design:** exercising the repaired writers through the running server would require
  calling `POST …/system-auto-approval` or `POST …/field-auto-approval`, which are **live approval routes
  and would mutate business state** — explicitly out of bounds. There is therefore **no runtime proof that
  the deployed process serves these particular two writer bodies**, and I am not claiming one. The writer
  behaviour is proven against the real modules in an isolated database, which is the strongest evidence the
  boundaries allow.

---

## 6. Test-inventory disposition and ownership

**Correction to my own brief:** I initially mislabelled the files. The independent review caught it. The
truth:

* `tests/understanding-retry-config-currency.test.mjs` — **mine** (MVP-CLOSE-4's new test).
* `tests/understanding-field-review-authority.test.mjs` — **the other agent's**, attributable by slice only:
  its header reads *"R11 Phase 6B — field-level governed Understanding authority."* It is cited as
  pre-existing in `docs/MVP-CLOSE-0…:169` ("**existing**") and last run in `docs/MVP-CLOSE-1…:93`
  (12/12). No author or agent identity is recorded anywhere. It is **untracked and uncommitted**.

**Are the two `|SAFE` labels justified?** Yes, and they are *derived, not asserted*. The inventory policy
(`scripts/authoritative-test-inventory.mjs:40-42`) is: *"a class is only justified if running the file
could touch state outside a throwaway temp database"*; only `REAL_STATE` and `SPAWNS_PROCESS` exclude.
Both files match neither, so both derive `SAFE` — verified by re-implementing the detectors read-only.
Isolation evidence: `understanding-retry-config-currency` is `:memory:` + the shared chain fixture; the
other agent's file is a throwaway temp sqlite from `drizzle-active`; neither touches `.wrangler`, the
Golden project, spawns processes, or does network I/O.

**Disposition: keep both entries exactly as recorded. Change nothing.**

Dropping the other agent's entry is not a technical option — the file is on disk, so it is always in the
computed `current` set, and removing its baseline line reproduces the identical gate failure for everyone.
Relabelling it `EXCLUDED` would hide a passing guard to make a gate pass, which is the failure mode the
governing instruction explicitly forbids.

**The real open question is coordination, not classification:** `understanding-field-review-authority.test.mjs`
is untracked, uncommitted, and owned by nobody by name. I re-ran it in this slice — **12/12 pass** — which
closes the review's one `UNVERIFIED` item. A human still needs to decide who commits it and under which
slice. One quality note for whoever owns it: it applies the migration chain by **filename sort** rather
than the journal order, which the shared fixture's own docstring warns against — a latent fixture-drift
risk to remediate in the fixture, **not** a reason to relabel.

This slice's own new file was verified against the same detectors (`REAL_STATE` false, `SPAWNS_PROCESS`
false, `CHAIN_FIXTURE` true → derived `SAFE`) before recording; the baseline diff is exactly one line.

---

## 7. Scope correction: requirement-link confirmation

**Traced, not assumed.** The two writers have exactly **two** call sites in the entire codebase, both
HTTP route handlers in `estimator-understanding-review-api.mjs` (lines 552 and 598). Neither
`boq-line-decision-api.mjs` nor `technical-requirement-api.mjs` imports or calls them.

Requirement-link confirmation therefore does **not** depend on these writers, and no claim of that kind is
made. (Those files use `loadUnderstandingReviewRows` / `safeUnderstandingReviewItem` as *readers*, which is
a different path — see §8.) `requirement_207` was not linked; its applicability and compatibility
contribution remain separately verifiable.

---

## 8. Remaining currentness risk (distinguished from unrelated backlog)

**Latent, currently zero-impact — the unfiltered *readers*.** `technical-requirement-api.mjs:375` (profile
generation), `boq-line-decision-api.mjs`, `boq-line-bom-api.mjs`, `engineering-knowledge-api.mjs` and
`ai-presales-agent-tools.mjs` still call the authority functions **without** a config fingerprint. Measured
across the whole acceptance project with the repaired code:

> **items where the unfiltered reader selects differently from the config-aware reader: 0**
> **…of those, where the unfiltered reader would still yield facts: 0**

So MVP-CLOSE-4 already closed the observable gap; what remains is a *latent* risk that would only bite if a
future interpretation were produced under an obsolete configuration with no authorized retry. It is a real
one-authority principle (the profile path is the only unfiltered reader that persists classification into
an artifact) but it is **not** the cause of anything currently wrong, and it is unrelated to the existing
BOQ-link / compatibility / readiness backlog.

**Explicitly not this slice:** when the provider is unavailable or misconfigured,
`currentConfigFingerprintFor` derives a fingerprint from the `unavailable` metadata triple, which matches no
real interpretation — so the writers fail closed and auto-approval is unavailable. That is the correct
direction, stated so it is not later mistaken for a regression.

---

## 9. Next slice (proposed — NOT executed)

**Decide and close the unfiltered-reader asymmetry for the profile path only** — i.e. determine whether
`technical-requirement-api.mjs:375` should resolve with `currentConfigFingerprintFor(env)`.

Why this and not something else:

* It is the **only** unfiltered reader that turns Understanding classification into a **persisted
  artifact**, so it is the only one where "stale authority" could become durable.
* It is currently measured at **zero** divergence, so the decision is a safety closure with a bounded blast
  radius, not a data migration.
* It needs a *policy* answer, not a mechanical one: making it config-aware is strictly safer, but it would
  change profile content and fingerprints for any item whose understanding is config-stale, and would
  require deciding whether such a profile should instead be refused or regenerated.

Exit criteria: a failing test first; then either (a) the profile path resolves with the shared predicate,
with a test proving a config-stale interpretation can no longer reach `boqItem.classificationProvenance`,
or (b) a recorded, evidence-backed decision to keep the unfiltered read with an explicit comment naming the
accepted risk. Either way, verify the 12 acceptance items' profiles are unchanged, and re-run
`npm run test:all` (the gate now expects 407 classified files).

Not in this slice and not claimed: `requirement_207` linking, compatibility work, or the
BOQ-link/readiness backlog.

---

## 10. Evidence classification

* **Project evidence** — active migration chain; stored runs, interpretations, field and review decisions,
  profiles; read-only SQL and read-only HTTP.
* **Runtime evidence** — 10 new isolated tests on the real ordered chain; live read-only `GET` showing
  reader behaviour unchanged.
* **Dependency evidence** — repo-wide call-site grep establishing that requirement-link confirmation does
  not reach these writers (§7).
* **Independent review evidence** — read-only subagent on dependency safety, site completeness, schema
  facts, invariant risks and test design (its actionable findings were actioned in MVP-CLOSE-4), plus a
  second read-only subagent on inventory ownership, which corrected my inverted ownership premise.
* **Inference / not claimed** — that the deployed process serves these two writer bodies (§5).

---

STOPPED — MVP-CLOSE-5 complete.
