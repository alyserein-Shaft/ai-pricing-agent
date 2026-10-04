# AIU-4F — Governed Non-Product / Not-Applicable Understanding Outcome

**Mode:** IMPLEMENTATION AUTHORIZED — SEMANTICS FIRST
**Outcome: 🛑 STOPPED per Phase 8. Nothing implemented. No schema change, no migration, no Golden mutation, no commit/push/deploy.**

**Why stopped:** Phase 8 states — *"If current downstream requires every BOQ row to have Product Understanding and cannot represent non-product obligations safely: STOP and report this as a blocking architecture gap rather than bypassing it. Do NOT remove BOQ_UNDERSTANDING_REQUIRED blindly."* **Both clauses are proven true from source.** Details in §7.

---

## 1. Executive Verdict

AIU-4F is **not** closed. Investigation produced a fully proven design and then hit a genuine architectural blocker that the task itself instructs me to report rather than route around.

What is proven:
- The semantic model, authority model, audit model, and completion equation are all **determinable** (not guessed).
- `REJECTED` is **semantically wrong and physically impossible** for a never-analyzed row — proven by schema, not opinion.
- The existing interpretation-review tables **cannot** represent the decision; a schema migration would be required.
- **No deterministic rule can prove a row is a non-product obligation** — AIU-4E is the standing counterexample.
- **Blocking gap:** downstream product matching structurally cannot represent a non-product obligation.

Had the downstream gap not existed, the remaining obstacle would be an unauthorized schema migration in a 578-file dirty shared tree with a stale Drizzle journal. Both are reasons to stop and seek authorization, not to improvise.

---

## 2. Semantic Decision (proven, not implemented)

**Canonical term: `PRODUCT_UNDERSTANDING_NOT_APPLICABLE`** — a *row-level terminal disposition in the AI Understanding review layer*.

It means: *this current BOQ row is legitimate project scope, but it is an obligation/function rather than a product-understanding subject; no product interpretation is authorized, and downstream product matching must not be required for it.*

### Why not the existing candidates

| Candidate | Actual type | Verdict |
|---|---|---|
| `NOT_APPLICABLE` (`boq-understanding-engine.mjs:187-190`) | **per-field evidence-fact origin** | ✗ Reusable meaning would be destroyed. It is explicitly **forbidden** on `system`/`category`/`equipmentType`/`productFamily` for a product row (`:636`), and technical attributes normalize it back to `MISSING` (`:344-370`). |
| `DATA_QUALITY_EXCLUDED` | **in-memory derived lane** | ✗ Not persisted, not a decision; and AIU-4E proved it can be *wrong*. |
| `NO_PRODUCT_FAMILY` (taxonomy `:501-518`) | family-resolution gap code | ✗ Means "no governed catalog family", **not** "row is not a product" — Door contact is a real product that carries this code. |
| `Not Applicable` (technical-requirement engine `:61-64`) | requirement-applicability status | ✗ Per-requirement, not per-BOQ-row. |
| `NON_PRODUCT_MATCHING` roles (`requirement-scope-role-routing.mjs:13-24`) | advisory, **tests-only, no runtime consumer** (`:1-11`) | ✗ Cannot govern runtime state. |

---

## 3. Authority Model

**Authority: explicit human reviewer with a substantive reason. Deterministic assignment is NOT safe.**

Proof that no deterministic rule can decide this: **AIU-4E itself is the counterexample.** Seven genuine physical products ("Fireman telephone jack" ×4, "Door contact" ×3) were excluded solely because `equipmentNoun` lacked those terms (`boq-understanding-pilot.mjs:47-84`).

> **NO RECOGNIZED PRODUCT EVIDENCE ≠ GOVERNED NON-PRODUCT DECISION**

Therefore the existing detection signal may only *suggest* a candidate; it may never auto-terminal a row. `DATA_QUALITY_EXCLUDED` and `NO_PRODUCT_FAMILY` are candidate **evidence**, not proof.

A further authority weakness found: the review API has **no engineer/technical-reviewer role check** — any active project member passes `access()` (`estimator-understanding-review-api.mjs:32`), and a test explicitly pins that absence (`tests/estimator-understanding-review.test.mjs:335-348`). A governed engineering disposition needs a stronger capability check than "project member".

The existing system-actor pattern (`SYSTEM_AUTO_APPROVAL_ACTOR_ID`, `:327-347`) is mechanically reusable but its policy (10 gates requiring a reproducible *product family*) is categorically wrong for non-applicability.

---

## 4. Persistence / Audit Model — and why it is blocked

### `REJECTED` cannot be reused (decisive)

Two independent proofs:

1. **Semantic:** `REJECTED` asserts an interpretation existed, was reviewed, and was rejected. For a non-product row all three are false.
2. **Physical (schema):** both review tables require a real interpretation:
   ```sql
   interpretation_id TEXT NOT NULL REFERENCES estimator_item_interpretations(id)
   canonical_interpretation TEXT NOT NULL
   ```
   (`drizzle/0060_estimator_understanding_review.sql:5, 8, 21-28`)

   Plus the action policy only offers `REJECT_INTERPRETATION` when `proposalState === "AVAILABLE"` (`app/domain/estimator-understanding-review.mjs:172-179`). A never-analyzed row has **no allowed actions at all**.

### Existing tables cannot represent it without migration

- `review_status` CHECK allows only `('AWAITING_REVIEW','APPROVED','REJECTED')` (`:7`)
- `action` CHECK allows only the four interpretation actions (`:27`)
- The current-evidence trigger (`:18-37` in `0063`) requires a joined interpretation row with matching fingerprint
- `interpretation_id` / `canonical_interpretation` are `NOT NULL`

Adding the disposition inside these tables is a **table-rebuild migration**, not a small CHECK edit.

### Reuse of the generic review queue — assessed and rejected

`review_queue_items` + `review_decisions` *could* technically carry this with no migration (per-item FK, `version_number`, `reason_for_review`, `required_decision`, `required_role`, `review_decisions` audit, `canTransitionReview` gate, `validateDecision` requiring reason ≥ 10 chars + version currency). But it is a **semantic mismatch**: it is the generic workflow-review subsystem, not the Understanding review authority, and AIU-3 already established its transition gate is weak — only 2 of 8 status-write sites are gated by `canTransitionReview`. Building a completion authority on it would inherit that weakness.

**A new narrow append-only disposition table is the correct model — and it requires a migration.**

---

## 5. Completion Authority Integration (designed, not implemented)

```
eligible
= notAnalyzed
+ analysisDebt
+ reviewDebt
+ terminalApproved
+ terminalRejected
+ terminalNonProduct        <-- new, explicitly separate
```

Completion becomes `notAnalyzed === 0 && analysisDebt === 0 && reviewDebt === 0`.

Guarantees:
- `terminalNonProduct` removes the row from `NOT_ANALYZED` debt
- it **does not** increase `approvedCoverage` (approved intelligence stays APPROVED-only)
- it **does not** produce an interpretation or an approved fact
- `currentApprovedUnderstandingFacts` keeps returning `null` for it (unchanged)

---

## 6. Run Progression Integration (designed, not implemented)

- `selectableNew` must exclude dispositioned rows (via the currentness-aware `alreadyInterpretedItemIds` path or an explicit exclusion).
- A **dedicated append-only reversal action** (e.g. `REVERSE_NOT_APPLICABLE`) returns the row to `NOT_ANALYZED` and restores selectability. Existing `RETURN_TO_REVIEW` is unusable here because it is gated on `proposalState === "AVAILABLE"` (`estimator-understanding-review.mjs:164-180`) and a non-product row has no proposal.
- No interpretation is ever fabricated for a dispositioned row.

---

## 7. Downstream Scope Preservation — **THE BLOCKER**

Direct source reading, `worker/product-matching-api.mjs`:

```js
// :58
const currentUnderstanding = (db, itemId) => db.prepare(
  "SELECT ... FROM estimator_item_interpretations WHERE boq_item_id=? AND status IN ('COMPLETED','NEEDS_REVIEW') ..."
).bind(itemId).first();

// :239
if (!understandingRow) throw Object.assign(new Error("Run BOQ understanding before product matching."), { code: "BOQ_UNDERSTANDING_REQUIRED" });
```

**There is no branch for a non-product disposition, and no alternative path.** A row correctly governed as `PRODUCT_UNDERSTANDING_NOT_APPLICABLE` has, by definition, **no interpretation** — so it can *never* satisfy this gate.

Consequence: marking the 12 rows non-applicable would clear their `NOT_ANALYZED` debt while leaving them **permanently hard-blocked** from matching → pricing → quotation. The system would then hold two contradictory truths:

- Understanding: *"this row needs no product understanding"* ✅
- Commercial: *"this row cannot be quoted without product matching"* ❌

That contradiction is precisely what this audit chain exists to eliminate. Fixing it requires downstream redesign (service/interface/LOB pricing for non-product obligations), which AIU-4F explicitly forbids ("Do NOT redesign Requirement/Product Matching/BOM/Pricing"; "Do NOT remove BOQ_UNDERSTANDING_REQUIRED blindly").

I therefore did **not** implement, because doing so would either leave a false-green commercial state or force a forbidden downstream bypass.

### Product Understanding not applicable ≠ BOQ scope not applicable

Correct semantics: these are legitimate *obligations* that still need requirement handling and service/interface pricing — they simply do not need *product* matching. The architecture currently has no way to express that, and no service/interface pricing path exists.

---

## 8. Product False-Positive Safety (design constraint for any future implementation)

- Absence of recognized product evidence may **never** auto-terminal a row (AIU-4E: 7 real products).
- "Fireman telephone jack" and "Door contact" must remain analyzable.
- Merged / Rejected / `approved_for_downstream=0` rows must remain outside AI eligibility.
- Any deterministic rule, if ever added, must fail closed and be evidence-positive.

---

## 9. Exact Files Changed

**None.**

---

## 10. Tests Added / Changed

**None.** Writing tests against an unimplemented, unauthorized-migration-requiring model would encode an unproven contract.

---

## 11. Test Results

Not applicable — no implementation. Read-only source/schema inspection plus one read-only Golden probe.

---

## 12. Golden Read-Only Validation (no mutation)

Baseline confirmed unchanged: 108 BOQ rows, 82 eligible, 26 interpretations, 0 review versions, 0 review events, 2 runs.

```
eligible 82 | notAnalyzed 62 | reviewDebt 20 | analysisDebt 0 | terminalReviewed 0
selectableNew 50 | unAnalysable 12 | nextBatch 13 | runsRemaining 7
```

**Non-product candidates (12 — would each require an individual governed engineer decision; none auto-assignable):**

| count | description |
|---|---|
| ×4 | `Control and monitor element as required for interfacing with access doors…` |
| ×4 | `Control of HVAC equipment, smoke exhaust fans, duct heaters and interfacing with BMS system` |
| ×4 | `Signals to elevators with all required accessories` |

**Hypothetical effect if all 12 were confirmed NOT-APPLICABLE (arithmetic only):**

| metric | now | hypothetical |
|---|---|---|
| notAnalyzed | 62 | **50** |
| unAnalysable | 12 | **0** |
| nonProductTerminal | 0 | **12** |
| selectableNew | 50 | 50 (unchanged) |
| reviewDebt | 20 | 20 (unchanged) |
| completion | false | **still false** (reviewDebt 20) |
| at full drain | — | reviewDebt **70**, still false until all reviewed |

Completion would *not* immediately become true — it is still gated by the 20 (later 70) review-debt rows. This confirms the disposition alone does not manufacture completion; it only removes the permanent 12-row floor.

Golden data was **not** mutated (probe refused `run()`/`batch()`).

---

## 13. Graphify / Serena Verification

- **One authority:** `currentApprovedUnderstandingFacts` (`:196`) and `currentUnderstandingCompletion` (`:234`) are the only Understanding authorities; no parallel path exists to duplicate.
- **Decisive structural fact:** the product-matching gate reads `estimator_item_interpretations` directly (`:58`), *not* the Understanding review authority — which is why a review-level disposition could never satisfy it.
- **No non-product rows can become approved intelligence:** the APPROVED-only filter at `:200` is untouched.
- **No hidden bypass introduced:** nothing was changed.

---

## 14. Remaining Risks / Blockers

| # | Blocker | Severity |
|---|---|---|
| B1 | **Downstream cannot represent non-product obligations** — `BOQ_UNDERSTANDING_REQUIRED` (`product-matching-api.mjs:58,239`) has no non-product branch. Fixing requires service/interface/LOB pricing design. | 🔴 blocking |
| B2 | **No persistence without a migration** — interpretation-review tables are `NOT NULL`-bound to a real interpretation; a new append-only disposition table requires a versioned migration. | 🔴 blocking |
| B3 | Migration delivery risk — shared tree has 578 changed files; Drizzle journal is stale with no wired migration runner (`scripts/apply-0080-onboarding-d-contact-title.mjs:6-17`). | 🟠 high |
| B4 | **No engineer capability check** on the review API — any project member can currently act (`:32`; `tests/estimator-understanding-review.test.mjs:335-348`). | 🟠 high |
| B5 | No deterministic non-product rule exists; a future one must fail closed and be evidence-positive. | 🟡 medium |
| B6 | R1 concurrency debt unchanged (pre-scale reliability debt). | 🟡 low |

---

## 15. Exact Next Smallest Slice

**This is now an authorization/design decision, not another implementation slice.** None of the three listed candidates is correct yet, because every one of them presupposes the non-product disposition exists — and it cannot honestly exist until B1 is answered.

**Recommended next step: a narrow, read-only design slice — AIU-4G — Non-Product Obligation Commercial Path Decision.** It must answer, before any code:

1. Can a non-product BOQ obligation reach quotation **without** product matching (service/interface/LOB/lump-sum pricing)? If yes, what is the minimal governed representation?
2. If not, must `BOQ_UNDERSTANDING_REQUIRED` be taught to accept a governed non-product disposition, and under what audit?
3. Which comes first — the disposition table (B2) or the commercial path (B1)?

The task's three listed options are all premature:
- **AIU-4C-EXEC / AIU-4D** would leave the 12 rows permanently blocking quotation regardless of how much is attempted or reviewed.
- **AIU-4B** does not address the floor at all.

**Not implemented. No next slice started.**

---

## 16. What Was Not Changed

- No code, schema, migration, tests, or configuration changed.
- No `NOT_APPLICABLE` status introduced; no `REJECTED` reused; no interpretation fabricated; no row removed from BOQ; no eligibility predicate changed; no `BOQ_UNDERSTANDING_REQUIRED` bypassed.
- The 12 rows remain exactly as they are: eligible, never attempted, data-quality excluded, visible as `NOT_ANALYZED`.
- No product-evidence regex changed again; no taxonomy, prompt, model, or matching redesign.
- No AI run, no engineer review, no auto-approval, no AIU-4B/4D, no R1 lock.
- No commit, push, deploy, migration, or restart. Golden data verified unmutated.
- **AI Understanding is NOT declared CLOSED.**

**STOP.**
