# AIU-4C — Full-Population Run Progression Report

**Mode:** IMPLEMENTATION AUTHORIZED — INVESTIGATION FIRST
**Golden project:** Al Mousa School — Clean Golden Run (`project_ae501b85-9c12-4332-bf8e-787c90f2d388`)
**No commits, pushes, deploys, migrations, schema changes, restarts, or Golden model runs.** AI Understanding is **not** declared CLOSED.

---

## 1. Executive Verdict

AIU-4C is **🟢 CLOSED** against all 13 completion criteria.

The central finding inverted the task's premise: **full-population batch progression already existed and already worked correctly.** The `alreadyInterpretedItemIds` currentness authority (`worker/estimator-understanding-api.mjs:591`) plus the per-run caps already implement a rotating, batch-sized selection pool. The real, previously-unmeasured blockers were three smaller ones, all now closed:

1. **Un-truthful termination accounting** — 19 data-quality-excluded rows could never be attempted yet were reported as ordinary `notAnalyzed` backlog, making completion permanently unreachable while looking like routine work.
2. **No backend "is there more work" signal** — the UI had to infer it, and the manifest was never refreshed after a run.
3. **Collision stranding** — a concurrent-run UNIQUE collision threw out of `executeRun`, leaving a run permanently `PROCESSING`.

| Criterion | Status | Evidence |
|---|---|---|
| 1. Full population progresses across batches | 🟢 | B-10/B-11: 30 analyzable rows fully covered across ≥3 bounded batches, zero repeats |
| 2. Caps are batch size, not coverage ceiling | 🟢 | B-9: `selectableNew > nextBatchSize`; Golden 43 selectable vs 13 per batch |
| 3. Already-attempted rows not reprocessed | 🟢 | F-20, C-13, E-18 — currentness-aware exclusion proven |
| 4. Terminal reviewed rows excluded | 🟢 | A-7/A-8 |
| 5. Terminal/ineligible BOQ rows excluded | 🟢 | A-2/A-3/A-4 |
| 6. Retry debt separated from new work | 🟢 | E-18/E-19 — FAILED stays `analysisDebt`, never reselected |
| 7. Deterministic termination | 🟢 | B-12, F-21 — drains to 0, then stable |
| 8. Repeated continuation idempotent/safe | 🟢 | F-20/F-21 + collision fix in `executeRun.save` |
| 9. Completion authority truthful | 🟢 | G-22/G-24 — `notAnalyzed` falls, review debt rises, completion stays false |
| 10. No review decision automated | 🟢 | G-23 — 0 approved, 0 rejected, 0 review rows created |
| 11. API/UI truthfully identify more work | 🟢 | `progression` on manifest + dashboard fact + workflow summary |
| 12. Focused + adjacent tests pass | 🟢 | 18/18 new; 181 + 163 + 74 adjacent; build + lint clean |
| 13. Golden read-only validation | 🟢 | 82 / 20 / 62 / 43 selectable / 19 un-analysable / next batch 13 |

---

## 2. Refreshed Baseline

Read-only, refreshed before any implementation. **No baseline drift** in the progression architecture: pilot selection is still `boq-understanding-pilot-selection-v4`, caps unchanged (`PILOT_MAX=15`, `PRIMARY_MAX=10`, `EXPLORATORY_MAX=3`), and `alreadyInterpretedItemIds` is wired at both manifest call sites. The shared tree had grown to **578 changed files**; the files central to this task (`boq-understanding-pilot.mjs`, `boq-understanding-engine.mjs`) were already modified by other agents, so all edits here were strictly additive.

| Metric | Value |
|---|---|
| total BOQ rows | 108 |
| Merged (terminal) | 8 |
| AI-eligible | 82 |
| interpretations persisted | 26 (19 COMPLETED, 7 NEEDS_REVIEW) |
| runs (historical) | 2 |
| review versions / events | 0 / 0 |
| **AIU-4A completion** | notAnalyzed 62, reviewDebt 20, analysisDebt 0, terminalReviewed 0, **INCOMPLETE** |

---

## 3. Previous Progression Limitation

Progression was **already functional**; what was missing was honest accounting and a truthful continuation signal.

- **Already worked:** `activeRows` (AIU-2 eligibility) → `alreadyInterpretedItemIds` (currentness-aware) → `buildBoqUnderstandingPilotManifest` (capped batch). Each run naturally draws the next unattempted rows. Proven: the existing "Sprint 1.9" rotation test and B-10/B-11.
- **Gap 1 — silent stranding:** `DATA_QUALITY_EXCLUDED` rows are filtered at `boq-understanding-pilot.mjs:371` and never enter `executable` (`:389`). They stayed `notAnalyzed` forever, indistinguishable from ordinary backlog.
- **Gap 2 — no continuation signal:** the manifest response carried only the current batch. The UI never refreshed the manifest after a run, so the same button could only re-submit a stale fingerprint (`PILOT_MANIFEST_STALE`).
- **Gap 3 — collision stranding:** `executeRun`'s `save` let a UNIQUE violation propagate, skipping the terminalizing `UPDATE` and leaving the run `PROCESSING` forever.

---

## 4. Canonical Selectable-New Population

**Authority:** `loadUnderstandingProgression` (`worker/estimator-understanding-api.mjs:648`), version `understanding-progression-1.0.0`. It **composes** existing authorities rather than inventing any:

- **Eligibility** — `activeRows`, i.e. the unchanged AIU-2 `currentBoqEligibleForUnderstandingPredicate`.
- **Currentness** — the existing `alreadyInterpretedItemIds` (`:591`). No second currentness model invented.
- **Lanes** — `buildBoqUnderstandingPilotManifest` (selection rules untouched).
- **Debt** — `currentUnderstandingCompletion` (AIU-4A), so progression can never disagree with completion.

```
selectableNew  = primarySelectable + exploratorySelectable
                (eligible AND no current interpretation AND executable lane)
unAnalysable   = DATA_QUALITY_EXCLUDED  (never executable under any run)
attempted      = eligible - notAnalyzed
runsRemaining  = max(ceil(primarySelectable / 10), ceil(exploratorySelectable / 3))
hasMoreSelectable = selectableNew > 0
```

Invariant proven live and in tests: **`selectableNew + unAnalysable = notAnalyzed`**, and **`attempted + notAnalyzed = eligible`**.

---

## 5. Batch Progression Model

```
Run 1 → primary 10 + exploratory 3 = 13   (selectableNew 43 → 30)
Run 2 → next 13                            (30 → 17)
Run 3 → next 13                            (17 → 4)
Run 4 → remaining 4                        (4 → 0)
Run 5 → selectableNew = 0 → NO-OP, no run, no model call
```
Caps are **batch size**, never a ceiling: `runsRemaining = max(...)` because both lanes are drawn in the *same* run, never summed. Empty selection is impossible to submit (`validateControlledPilotRequest` requires ≥1 id, `boq-understanding-pilot.mjs:423`) and the authority reports `nextBatchSize: 0`, `hasMoreSelectable: false` — so a terminal pool performs no work. **No background scheduler, no recursion, no busy loop.**

---

## 6. Primary / Exploratory / Data-Quality Semantics

Golden lane split of all 82 eligible rows, measured per-row through the real production builder:

| Lane | Count | Selectable? |
|---|---|---|
| GOVERNED_PRIMARY | 46 | yes, ≤10 per run |
| CROSS_SYSTEM_EXPLORATORY | 17 | yes, ≤3 per run |
| **DATA_QUALITY_EXCLUDED** | **19** | **never** |

**The Phase 7 question — can excluded rows remain NOT_ANALYZED forever? Yes, and the evidence says that is partly correct:**

- **~12 rows are legitimately un-analyzable** — `unit=LS` interface/control *functions* ("Control of HVAC equipment…", "Signals to elevators…"), excluded as `Heading-like row` / `No product, equipment, or material evidence`. These are not catalog products; no interpretation should be fabricated for them.
- **~7 rows are real products the evidence regexes miss** — "Fireman telephone jack" (×4) and "Door contact" (×3), excluded only because `genericProductEvidence`'s `equipmentNoun` list has no term for telephone/jack/door-contact. These are genuinely analyzable.

**Resolution taken (smallest sufficient, inside AIU-4C):** I did **not** touch `equipmentNoun`, taxonomy, or classification — that is classification-detection work, explicitly out of scope, and would be guesswork about which terms to admit. Instead the 19 are reported as an explicit, governed **`unAnalysable`** category rather than silent backlog. This makes the terminal condition honest without fabricating progress and without pretending the exclusion rule is correct.

**Terminology debt (recorded, not acted on):** the 7 real-product rows need a separate, evidence-backed decision on `genericProductEvidence` coverage. Flagged as a follow-up, not silently absorbed.

---

## 7. Already-Interpreted / Currentness Semantics

Currentness is the **existing** authority, unchanged and reused:

- A row counts as already-attempted only when its **latest** attempt's `input_fingerprint` matches the row's current input **and** the config matches (or is a verifiable authorized-retry reconstruction). `worker/estimator-understanding-api.mjs:591-604`
- **C-13:** a current interpretation blocks a duplicate new attempt.
- **C-14:** a **stale** interpretation (input changed) does *not* block — the row correctly returns to selectable, which is how re-analysis after evidence change works.
- COMPLETED and NEEDS_REVIEW both count as covered (A-5/A-6), so neither is blindly re-run.
- FAILED with a current fingerprint also counts as covered — it is **retry debt**, not new work (E-18).

---

## 8. Failed / Unavailable Retry Boundary

Preserved exactly; AIU-4C changed no failure semantics.

- Retry is **explicit operator-only**; there is no automatic retry loop anywhere.
- Per-item retry requires `FAILED` + a transient code + unchanged input fingerprint, capped by `MAX_PER_ITEM_RETRY_ATTEMPTS = 3`.
- `AI_UNAVAILABLE` is not per-item retryable; it re-enters selection only when the provider config fingerprint changes.
- A current FAILED row stays out of new-attempt selection and is reported as `analysisDebt` (E-18/E-19). **New-population progression and retry progression are fully separate.**

---

## 9. Idempotency / Concurrency

**Sequential continuation (the actual AIU-4C path) was already safe** and is now proven: the manifest is recomputed per request and previously-attempted rows are excluded, so a replayed batch is impossible (F-20, F-21). The stale-manifest guard additionally rejects an old fingerprint.

**True concurrency was unsafe** (audited by subagent, confirmed in source): no single-flight lock exists, so two overlapping runs can both call the model, and the loser's UNIQUE violation used to throw out of `executeRun`, stranding the run in `PROCESSING` with earlier items already persisted.

**Smallest fix applied** (`worker/estimator-understanding-api.mjs:723`): the `save` INSERT now catches **only** a verified duplicate-key violation, confirms the winning row exists, and lets the run continue and terminalize normally. Any other error still propagates.

**Stated honestly:** this removes data corruption and run stranding. It does **not** prevent duplicate provider spend under true concurrency — that needs a single-flight lock (a partial unique index / migration), which is out of scope here and recorded as a risk.

---

## 10. Completion Authority Integration

AIU-4A semantics untouched — `currentUnderstandingCompletion` was not modified. Progression reads it; it never writes or short-circuits it.

Verified end-to-end (G-22..G-25, and live Golden):
- `notAnalyzed` decreases as attempts persist.
- `reviewDebt` increases by exactly the batch size.
- `approved` / `rejected` / `terminalReviewed` stay 0 — **no review decision is ever automated**; 0 review version/event rows are created by progression.
- `completion` stays **false** throughout, and remains false even after a full drain, because the un-analysable remainder is honestly reported rather than absorbed.
- `eligible` and the completion `version` never change.

Progression is exposed as a **separate** fact/summary field, never merged into completion.

---

## 11. Exact Files Changed

| File | Change |
|---|---|
| `app/domain/boq-understanding-pilot.mjs` | **Additive**: `selectablePrimaryCount`, `selectableExploratoryCount`, `selectableItemCount` (pre-cap pool size). Selection logic, caps, lanes, regexes, fingerprint all untouched. |
| `worker/estimator-understanding-api.mjs` | **Additive**: `UNDERSTANDING_PROGRESSION_VERSION` + `loadUnderstandingProgression`; `progression` on the manifest response; collision-tolerant `save` in `executeRun`. |
| `worker/dashboard-api.mjs` | Wiring only: `understandingProgression` fact. |
| `app/domain/presales-workflow-engine.mjs` | **Additive**: progression fields inside the existing understanding summary. |
| `app/page.tsx` | Manifest refresh after a run + backend-driven truthful continuation message + type declaration. |
| `tests/understanding-run-progression.test.mjs` | **New** — 18 focused tests. |
| `tests/boq-understanding-pilot.test.mjs` | Updated two shape/stub guards for the additive fields (invariants preserved). |

No eligibility, taxonomy, classification, prompt/model/schema, retry, matching, requirements, `approved_for_matching`, or auto-approval changes.

---

## 12. Tests Added / Changed

**New:** `tests/understanding-run-progression.test.mjs` — 18 tests covering all required groups. Batches are executed through the **real** `runUnderstandingBatch` with a stub provider (no network), fed rows from the **real** `activeRows` read so fingerprints match production exactly.

- **A. Selection (A-1..A-8):** never-attempted selectable; Merged/Rejected/downstream=0 excluded; COMPLETED, NEEDS_REVIEW, APPROVED, REJECTED not reselected.
- **B. Batch progression (B-9..B-12):** batch respects caps; pool exceeds one batch; repeated runs cover all 30 rows with **zero repeats**; drains to 0 and then no-ops.
- **C. Currentness (C-13/C-14):** current blocks, stale does not.
- **D. Lanes (D-15..D-17):** pool shrinks per run; data-quality reported explicitly; `selectableNew + unAnalysable = notAnalyzed`.
- **E. Retry (E-18/E-19):** FAILED is debt, never new work.
- **F. Idempotency (F-20/F-21):** no batch overlap; terminal pool stable.
- **G. Completion (G-22..G-25):** `notAnalyzed` falls, review debt rises, completion stays false, zero review rows, eligibility unchanged.

**Changed:** two guards in `boq-understanding-pilot.test.mjs` — the exact manifest key set (extended with the three additive fields) and the endpoint stub's modelled read queries. The assertions that actually protect the endpoint (**`writes === 0`**, **`aiCalls === 0`**) were left intact and still pass.

---

## 13. Test Results

| Suite | Result |
|---|---|
| `understanding-run-progression.test.mjs` (new) | **18/18 pass** |
| AIU-4C + AIU-4A + eligibility + pilot + retry + observability + review + auto-approval | **181/181 pass** |
| boq-understanding battery (9 suites) + effective-interpretation + revalidation | **163/163 pass** |
| dashboard / presales / dashboard-engine / workflow authority+reconciliation / requirement handoff / matching authority / drawing handoff / line-decision | **74/74 pass** |
| Lint (6 touched files) | **0 errors** (5 pre-existing warnings, none from this change) |
| Build | **Pass** — validated Sites artifact |

An earlier 8-failure run was a **test-harness bug of my own** (batch rows rebuilt from the raw fixture instead of real `activeRows`, so fingerprints differed). Fixed to mirror production; not a production defect.

---

## 14. Golden Read-Only Validation

**No model calls, no runs executed on Golden.** Progression authority evaluated read-only (`run()`/`batch()` refused):

| Metric | Value |
|---|---|
| eligible | 82 |
| attempted | 20 |
| notAnalyzed | 62 |
| **selectable new** | **43** (30 primary + 13 exploratory) |
| **un-analysable** | **19** |
| retry debt (analysisDebt) | 0 |
| review debt | 20 |
| terminal reviewed | 0 |
| **expected next batch** | **13** (10 primary + 3 exploratory) |
| runs remaining | 5 |
| continuation | available — "Analyze next batch" |

Checks: `43 + 19 = 62` ✓ and `20 + 62 = 82` ✓. Post-validation Golden state unchanged: 0 review versions, 0 review events, 26 interpretations, 2 runs — **zero model/API tokens consumed**.

---

## 15. Graphify / Serena Final Verification

- **Serena — one authority:** `loadUnderstandingProgression` has exactly **two** consumers, both backend: `handleEstimatorUnderstandingApi` (`:917`, manifest response) and `collectProjectFacts` (`worker/dashboard-api.mjs:270`).
- **Structural — no divergent progression predicate:** `selectableNew` / `hasMoreSelectable` / `unAnalysable` are defined in exactly one place (`loadUnderstandingProgression`) plus the additive pre-cap counts in the manifest builder. No duplicate or competing definition.
- **No frontend authority:** `app/page.tsx` only *declares and renders* backend fields (`progression.selectableNew`, `hasMoreSelectable`, `runsRemaining`); it computes no selectable/not-analyzed state. The pre-existing backend-count reads remain intact.
- **No stale pilot-only ceiling:** the caps are unchanged and now provably per-batch; the pre-cap selectable counts are published so the ceiling question is answered by data, not assumption.
- **No bypass:** terminal/ineligible rows are excluded by the unchanged AIU-2 predicate, and A-2..A-8 prove it.
- **Authority path:** eligible BOQ → `activeRows` + `alreadyInterpretedItemIds` → manifest (capped batch) → `executeRun` → interpretation persistence → `currentUnderstandingCompletion` (AIU-4A) — one coherent chain, with progression layered on as a pure read.

---

## 16. Remaining Risks

- **R1 — duplicate provider spend under true concurrency.** The collision fix prevents corruption and stranding but not duplicate model calls. A single-flight lock requires a migration and is a separate slice.
- **R2 — 7 real products remain un-analyzable.** "Fireman telephone jack" / "Door contact" are excluded by `genericProductEvidence` gaps, not by genuine non-analyzability. They are now *visible* as `unAnalysable` rather than silently stuck, but still need an evidence-backed decision on equipment-term coverage. Deliberately not guessed here.
- **R3 — completion is permanently unreachable for this project** while any un-analysable row exists. This is now truthfully reported rather than masked. Deciding whether un-analysable rows should become governed terminal *unavailable* state (vs. blocking completion) is a semantics decision beyond AIU-4C.
- **R4 — pilot terminology debt.** "pilot", "CONTROLLED_PILOT", "pilot manifest" now describe full-population progression. Recorded only; no renaming in this slice.
- **R5 — concurrent-agent shared tree.** 578 changed files, including files central to this task. All edits here were additive and verified against the live tree.

---

## 17. Exact Next Smallest Slice

**AIU-4D — Golden Engineer Review Closure.**

Rationale from actual post-AIU-4C state: progression is now unblocked and honest — 43 rows are selectable across 5 governed batches, and 19 more are explicitly accounted for. The single largest remaining blocker to any finished Understanding stage is **review debt**: 20 rows already await engineer decision, and each subsequent batch adds ~13 more (≈83 at full drain). Nothing else in the system can resolve that: auto-approval (AIU-4B) is route-only by design and out of scope here, and the product needs engineer judgement on NEEDS_REVIEW/ambiguous rows. Until reviews happen, `reviewDebt` — not progression — is what keeps completion false.

---

## 18. What Was Not Changed

- No engineer approve/reject of the current 20; no system auto-approval; no AIU-4B or AIU-4D.
- No model runs executed against Golden (no tokens consumed); Golden data verified byte-identical.
- Completion authority semantics unchanged; AI eligibility semantics unchanged.
- No taxonomy, classification, `equipmentNoun`, prompt, model, provider, or schema changes.
- No retry semantics change; new work and retry remain separate.
- No requirements/matching redesign; `approved_for_matching` still not implemented.
- No historical interpretations deleted or superseded; caps, run modes, and manifest fingerprint all unchanged.
- No migration, schema change, commit, push, deploy, or restart.
- **AI Understanding is NOT declared CLOSED.**

**STOP.**
