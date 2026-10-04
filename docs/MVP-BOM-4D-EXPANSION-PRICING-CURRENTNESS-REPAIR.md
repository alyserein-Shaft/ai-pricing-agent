# MVP-BOM-4D — Repair Expansion Coverage Pricing Currentness Query

**Verdict: `CLOSED — EXPANSION PRICING CURRENTNESS QUERY REPAIRED`**

---

## 1. Exact defect

`worker/quotation-line-authority.mjs` :: `expansionCoverageBlockers` contained:

```sql
SELECT product_id FROM pricing_lines
WHERE project_id=? AND product_id=?
  AND status='Approved' AND superseded_at IS NULL
LIMIT 1
```

`pricing_lines` has **no `superseded_at` column**. Confirmed from canonical DDL
(`drizzle-active/0000_baseline_schema_0082.sql`, `pricing_lines`):

```
`boq_item_id` text NOT NULL,
`candidate_id` text NOT NULL,
`product_id` text NOT NULL,
`safety_decision_id` text NOT NULL,
```

Supersession lives on **`pricing_runs.superseded_at`**, not on `pricing_lines`.

The query therefore threw `no such column: superseded_at` at runtime. Because
`expansionCoverageBlockers` is reached from `projectPanelSizingBlockers` inside
the quotation authority gate, the **expansion coverage gate could not be
evaluated at all** — the fail-closed blocker path was dead in practice.

The condition was also *semantically* wrong in three further ways, independent of
the crash:

| Written | Canonical pricing currentness |
|---|---|
| `status='Approved'` (exact literal) | `status NOT IN ('Invalid','Expired','Rejected')` + `approval_ready=1` |
| no run join | run must be `superseded_at IS NULL` |
| no version check | run version must be `MAX` for that source |

So even if the column had existed, the query would have accepted a superseded
or unapproved line and accepted a stale version as coverage.

### Why it was latent

`tests/bom-001-r7-expansion-bridge.test.mjs` already reaches
`expansionCoverageBlockers`, but its D1 double answers every statement
generically and **never validates SQL against a real schema**. The broken query
"passed" against a mock that cannot raise `no such column`. This is precisely
the class of defect a mock-boundary test cannot catch.

---

## 2. Canonical currentness rule

**Definition:** `worker/pricing-authority.mjs`, `CURRENT_PRICING_PREDICATE`.

```sql
l.project_id=? AND r.scenario_id=? AND r.superseded_at IS NULL
  AND ${currentBoqEligibleForEngineeringPredicate("b")}
  AND l.approval_ready=1
  AND l.status NOT IN ('Invalid','Expired','Rejected')
  AND r.version_number=(
    SELECT MAX(r2.version_number)
    FROM pricing_runs r2
    JOIN pricing_lines l2 ON l2.pricing_run_id=r2.id
    WHERE r2.project_id=r.project_id AND r2.scenario_id=r.scenario_id
      AND r2.superseded_at IS NULL
      AND l2.boq_item_id=l.boq_item_id
  )
```

Answering the Phase 0 questions:

1. **Canonical predicate** — a pricing line is *current approved commercial
   coverage* iff: its run is not superseded, the run is the MAX version for that
   source, the line is `approval_ready=1`, and its status is not
   Invalid/Expired/Rejected.
2. **Where defined** — `worker/pricing-authority.mjs`, module-level
   `CURRENT_PRICING_PREDICATE`, consumed by `loadCanonicalPricingTotals`.
3. **Latest version selection** — correlated `MAX(r2.version_number)` over
   `pricing_runs` joined to `pricing_lines`, correlated on the *source key*
   (`l2.boq_item_id = l.boq_item_id`).
4. **Superseded/stale exclusion** — two independent mechanisms: `r.superseded_at
   IS NULL` on the run, and the `MAX(version_number)` currentness test. A
   superseded run is excluded from the running max, so its lines can never be
   current.
5. **`approval_ready`** — an explicit separate conjunct. Commercial readiness is
   *not* implied by status; both must hold.
6. **Does approval imply currentness?** — **No.** They are orthogonal conjuncts.
   A line can be current but unapproved, or approved but stale/superseded. The
   broken query conflated the two.
7. **Reuse?** — **Partially, by documented adaptation.** See below.

---

## 3. Repair

Phase 2 hierarchy followed:

1. *Reuse the helper directly* — not possible. `CURRENT_PRICING_PREDICATE` is a
   SQL string fragment, not a callable predicate, and it is BOQ-item-centric
   (see below).
2. *Reuse the canonical SQL verbatim* — not correct for this path. The canonical
   predicate contains `currentBoqEligibleForEngineeringPredicate("b")` joined
   via `l.boq_item_id`. An expansion product is derived from the **sizing
   snapshot**, not from a BOQ item, so a verbatim reuse would inner-join away
   every expansion line and return no coverage — a silent false-negative that
   would permanently block quotations.
3. *Factor a shared helper* — rejected as over-reach. The only structural delta
   is the source key (`product_id` vs `boq_item_id`) and the BOQ-eligibility
   conjunct, which are semantic, not incidental. A helper that takes a flag
   would hide exactly the distinction MVP-BOM-4C needs to keep explicit.
4. **Reproduce the canonical predicate locally, keyed on `product_id`** — chosen,
   with the two deviations stated in code and in this report.

Repaired query:

```sql
SELECT l.product_id
FROM pricing_lines l JOIN pricing_runs r ON r.id=l.pricing_run_id
WHERE l.project_id=? AND l.product_id=?
  AND r.superseded_at IS NULL
  AND l.approval_ready=1
  AND l.status NOT IN ('Invalid','Expired','Rejected')
  AND r.version_number=(
    SELECT MAX(r2.version_number)
    FROM pricing_runs r2 JOIN pricing_lines l2 ON l2.pricing_run_id=r2.id
    WHERE r2.project_id=r.project_id AND r2.scenario_id=r.scenario_id
      AND r2.superseded_at IS NULL AND l2.product_id=l.product_id
  )
LIMIT 1
```

**Why it is authoritative:** every one of the four canonical currentness
conditions is preserved exactly, with `superseded_at` correctly attributed to
`pricing_runs`. Only the *source key* changes.

**The two documented deviations, and why each is required:**

- **Source key `product_id` instead of `boq_item_id`.** Expansion coverage is
  asked per exact product identity resolved from the sizing snapshot
  (`expansionOptions.loopExpansionUnit.productId` /
  `mountingUnit.productId`). A product identity is the correct key for "is this
  product commercially covered".
- **BOQ-eligibility conjunct omitted.** `currentBoqEligibleForEngineeringPredicate`
  governs whether a *BOQ item* is still eligible to enter engineering. It is an
  input-readiness rule for BOQ-backed lines, not a commercial-currentness rule.
  A sizing-derived product has no BOQ item to be eligible or ineligible.

No `superseded_at` column was added. No schema was touched. The bad condition
was **replaced, not deleted** — the coverage gate now enforces canonical
currentness rather than being silently disabled.

---

## 4. Failing-before evidence

New suite: `tests/mvp-bom-4d-expansion-pricing-currentness.test.mjs`.

It builds a **real** in-memory SQLite database by replaying the active
migration chain (`drizzle-active/meta/_journal.json` → each `.sql` file), so the
SQL boundary is genuinely exercised. The existing `bom-001` mock-based suite
could not have caught this.

Red phase, against the pre-repair source:

```
ℹ tests 8
ℹ pass 0
ℹ fail 8
  Error: no such column: superseded_at   (x8)
```

Green phase, after repair:

```
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

The red phase was re-confirmed by reconstructing the original
`superseded_at IS NULL` query in place and re-running: 0/8 pass, all eight
failing with `no such column: superseded_at`.

---

## 5. Passing-after evidence

`tests/mvp-bom-4d-expansion-pricing-currentness.test.mjs` — 8/8:

| # | Test | Asserts |
|---|---|---|
| 1 | query executes against the real schema | no schema error; blocker returned, not thrown |
| 2 | stale pricing version | v1 approved, v2 draft for same products → **blocked** |
| 3 | superseded pricing run | approved lines only in a superseded run → **blocked** |
| 4 | current but not eligible | `approval_ready=0`, `Draft Price` → **blocked** |
| 5 | rejected / expired / invalid | each of the three statuses → **blocked** |
| 6 | current approved exact-product coverage | approved + current for every required product → **cleared** |
| 7 | partial required-product coverage | only the loop expander covered → **blocked** |
| 8 | different product identity | approved+current for `product-panel` → **blocked** |

The governed snapshot in this suite requires **two** distinct expansion
identities (loop expander + mounting kit), so the "partial coverage" case is
genuinely partial rather than accidentally complete.

---

## 6. Files changed

| File | Change |
|---|---|
| `worker/quotation-line-authority.mjs` | Replaced the invalid `pricing_lines.superseded_at` predicate in `expansionCoverageBlockers` with the canonical currentness predicate keyed on `product_id`, plus an inline justification of the two deviations. |
| `tests/mvp-bom-4d-expansion-pricing-currentness.test.mjs` | **New.** Real-schema regression suite, 8 cases. |
| `scripts/test-classification-baseline.json` | Drift baseline re-recorded (see §9). Untracked file. |

No other file was modified. No concurrent-lane file was touched.

---

## 7. Business-state writes

**None.** This slice is read-only against every real store:

- No live D1 access, no migration, no business-state mutation.
- The only database writes are into throwaway `:memory:` SQLite instances
  created and discarded by the new test file.
- No pricing, quotation, sizing, matching, safety, or approval record was
  created, approved, superseded or deleted.
- No commit, push, deploy, restart, reset, clean, stash or revert.

---

## 8. Test inventory

**Targeted and adjacent suites — all green:**

| Suite | Result |
|---|---|
| `mvp-bom-4d-expansion-pricing-currentness` (new) | 8/8 |
| `bom-001-r7-expansion-bridge` (MVP-BOM-2 expansion identity) | 7/7 |
| `mvp-bom-2-expansion-identity` (MVP-BOM-2) | 3/3 |
| `mvp-sizing-1-expansion-evidence-laziness` (MVP-SIZING-1) | 10/10 |
| `r7-panel-sizing-production` (MVP-SIZING-1) | 22/22 |
| `fire-alarm-panel-topology-sizing` | 13/13 |
| `quotation-authority` | 18/18 |
| `quotation-line-authority` | 6/6 |
| `quotation-api` | 4/4 |
| `commercial-pricing-authority` | 3/3 |
| `commercial-pricing-cost-freshness` | 4/4 |
| `pricing-input-authority` | 13/13 |
| `pricing-authoritative-cost-lock` | 1/1 |

**`npm test`** — 519/519 pass.

**`npm run lint`** — 0 problems in both touched files. The repo-wide
112 errors / 2059 warnings are in other lanes' untracked files and are
pre-existing.

**`npm run build`** — succeeds.

**`npm run test:all`** — drift gate passes; 3 failures remain, all
**pre-existing and unrelated**, proven by A/B execution against the
pre-repair source:

| Suite | Pre-repair source | With repair |
|---|---|---|
| `boq-line-bom-summary` | 0 pass / 2 fail | 0 pass / 2 fail |
| `review-workflow-atomic` | 27 pass / 1 fail | 27 pass / 1 fail |
| `document-governing-version.integration` | 18/18 standalone; fails under `test:all` ordering | unchanged |

Identical results with and without the repair: this slice neither caused nor
masked any of them.

---

## 9. Drift baseline

`npm run test:all` initially failed its REL-003 gate with 3 added SAFE files:

```
+ tests/mvp-bom-2-expansion-identity.test.mjs|SAFE
+ tests/mvp-bom-4d-expansion-pricing-currentness.test.mjs|SAFE
+ tests/mvp-sizing-1-expansion-evidence-laziness.test.mjs|SAFE
```

Each was re-reviewed before re-recording, **not** blindly accepted:

- all three pass in isolation (3/3, 8/8, 10/10);
- none performs network I/O, live-D1 access, subprocess spawning, or filesystem
  writes — the `http://localhost/...` strings are request-URL constants inside
  request fixtures, not `fetch` calls.

Re-recorded; the gate now reports `classification matches the recorded baseline
(412 files)`. `scripts/test-classification-baseline.json` is untracked, so it
does not appear in `git diff`.

---

## 10. Confirmation: BOM-5 migration remains unexecuted

Confirmed — **no schema migration was performed or staged by this slice.**

- `pricing_lines` DDL is unchanged. `superseded_at` was **not** added to it.
- `project_quotation_lines` DDL is unchanged.
- `boq_item_id` was **not** made nullable.
- `candidate_id` was **not** made nullable.
- No SCOPE source fields were added.
- No normalized SCOPE pricing input was implemented.
- No sizing, candidate, SCOPE line, or price approval was created.
- No migration file was generated or applied; `npm run db:generate` was not run.

The MVP-BOM-4C blocker stands unchanged: `pricing_lines.boq_item_id`,
`candidate_id` and `safety_decision_id` are all `NOT NULL`, so a pure SCOPE
commercial line — one whose product identity comes from engineering/sizing
authority rather than a BOQ item — **cannot exist** without a governed
matching candidate and BOQ item. This slice did not attempt to change that; it
only restored the existing coverage gate so the constraint is enforced
correctly rather than crashing.

---

## 11. Next slice

The corrected expansion coverage gate is now live and will begin enforcing
canonical currentness the moment any expansion pricing line exists. The
coordinated schema rebuild from MVP-BOM-4C remains the prerequisite for the
generalized source model, and the ordering it established still holds:

1. **Repair the `superseded_at` query defect** — *done in this slice.*
2. Implement the coordinated `pricing_lines` + `project_quotation_lines`
   table-rebuild migration (preserve `pricing_lines.id`, preserve
   `project_quotation_lines.pricing_line_id`, one coordinated contract) with the
   generalized source identity and creation-path branch, plus the full
   failing-before / passing-after test set — as its own reviewed slice.
3. Refactor `loadPricingInput` (`worker/pricing-runtime.mjs:42`) and
   `buildLineCostModel` (`worker/boq-line-cost-api.mjs`) to accept a normalized
   non-BOQ pricing input contract.

Golden E2E remains blocked at Quotation (`PANEL_SIZING_SNAPSHOT_REQUIRED`),
owned by another lane.
