# AI Pricing Agent — Commercial Temporal Correctness Repair

**Project**: `project_ae501b85-9c12-4332-bf8e-787c90f2d388` — *Al Mousa School — Clean Golden Run*
**Task type**: Implementation (corrective) — narrows an over-broad policy and closes a fail-open
**Final canonical re-read**: `2026-10-03T20:32:03Z` → `CURRENTNESS_STATUS = PROVEN`

---

## A. CORRECTED UNTIL-SUPERSEDED SEMANTICS

The previous implementation was over-broad. Corrected to the approved policy's precise form.

| | Before | **After** |
|---|---|---|
| `RELAXABLE_VALIDITY_STATES` | `["No Validity Provided", "Expired"]` | **`["No Validity Provided"]`** |
| Relaxed set (effective) | `Valid, Expiring Soon, No Validity Provided, Expired` | `Valid, Expiring Soon, **No Validity Provided only**` |

The policy now handles **exactly** `valid_until = NULL` and nothing else:

| Evidence | State | Under `VALID_UNTIL_SUPERSEDED` |
|---|---|---|
| `valid_until` absent | `No Validity Provided` | ✅ **temporally usable** |
| `valid_until` present + valid + past | `Expired` | 🔴 **BLOCKED** |
| `valid_until` present + malformed | `Unparseable` | 🔴 **BLOCKED** |
| `valid_until` present + valid + current | `Valid` / `Expiring Soon` | ✅ eligible (strict path) |
| future `effective_from` | `Future` | 🔴 BLOCKED |
| rejected / superseded | `Rejected` | 🔴 BLOCKED |

No "expired override" policy was created.

---

## B. EXPLICIT EXPIRY PROTECTION

**An explicit `valid_until` is authoritative evidence and is now unconditionally binding.**

New regression assertions (the ones §2 required):

| Test | Assertion |
|---|---|
| `B-regression` | `past valid_until` + policy → `eligible === false`, `validity === "Expired"`, `validityPolicy === "FIXED_EXPIRY"`, `temporalValidityRelaxed === false` |
| `B` (Gate 2) | `calculatePricingLine` on an expired price → `Pricing Blocked` + `CURRENT_PRICE_SOURCE_REQUIRED` |
| `E1` (Gate 1) | policy in force **and** `priceEligibility === "Price Approval Disabled"` |
| `E2B` (E2E) | explicit expiry blocks end-to-end |
| `E1` (r5 suite) | expired `eligible === false`, validity still truthfully `Expired` |
| `C4` | expired remains truthfully `Expired`, never relabelled |

**Not weakened** — approval, `downstream_use`, future-effective, rejection, supersession, source-version authority and policy scoping all still have their own dedicated passing tests.

---

## C. PRODUCTION OVERRIDE AUDIT

### C1. Was `allowOption` production-reachable? **No — proven**

```js
// previous
const allowExpiredOrMissingValidity = allowOption === true || validityPolicy.allows === true;
```

| Production caller | What it passes as the *options* object | `allowOption` |
|---|---|:-:|
| `worker/boq-line-cost-api.mjs:222` | `{ projectId, boqItemId, candidateId, scenario, body }` | `undefined` |
| `worker/boq-line-cost-api.mjs:455` | `{ ..., body: { ..., ...extra } }` — `extra` lands **inside `body`** | `undefined` |
| `worker/pricing-api.mjs:656` | `{ projectId, boqItemId, candidateId, scenario, body }` | `undefined` |

No caller set it, and `pricing-api.mjs:656` passes the whole request `body` **only as the nested `body` key** — it is never spread into the options object, so it could not reach the flag.

### C2. Latent bypass — **removed anyway**

It was unreachable *today* but a real trap: any future `loadPricingInput(db, { ...reqBody })` or `allowExpiredOrMissingValidity: body.x` would have granted commercial relaxation straight from client input with **no governed condition behind it**.

**Removed from both production paths:**

```js
// worker/pricing-runtime.mjs  — option deleted from the signature
export const loadPricingInput = async (db, { projectId, boqItemId, candidateId, scenario, body }) => {

// the ONLY source of relaxation
const validityPolicy = await resolvePriceValidityPolicy(db, priceSourceIds);
const allowExpiredOrMissingValidity = validityPolicy.allows === true;
```

Same treatment in `worker/scope-pricing-input.mjs` (its `allowExpiredOrMissingValidity` option is gone; it now resolves the policy itself).

### C3. Final production rule

> `GOVERNED_POLICY.allows === true` → missing-validity relaxation. **Nothing else.**

The domain flag on `selectPriceSources` / `calculatePricingLine` remains as an **internal test seam only**; production always supplies the governance-derived value. Locked by three tests:

| Test | Proves |
|---|---|
| `G1` | passing `allowExpiredOrMissingValidity: true` to `loadPricingInput` is **ignored** → strict |
| `G2` | governed policy governs even when a caller actively tries to **deny** it |
| `G3` | source-level scan (comments stripped) proves no worker reads the flag from a request body or destructures it as a caller option |

---

## D. COMMERCIAL DATE PARSER / NORMALIZATION

**New module: `app/domain/commercial-date.mjs`** — the single canonical boundary for governed commercial dates.

### States

| Status | Meaning |
|---|---|
| `VALID_DATE` | in the governed vocabulary → normalized ISO, comparable |
| `MISSING_DATE` | the source states **no** date (absent / null / empty) |
| `UNPARSEABLE_DATE` | a date **was stated** but is not in the vocabulary → **fails closed** |

### Supported vocabulary — derived from the data actually present

| Format | Example | In canonical data |
|---|---|---|
| `ISO_DATE` | `2023-03-01` | ✅ `valid_until`, `product_sources` |
| `ISO_DATETIME` | `2026-10-01T13:56:48.998Z` | ✅ `discount_rules`, `pricing_exchange_rates` |
| `DAY_FIRST_ORDINAL` | **`1st March 2023`** | ✅ **504 `price_records` rows** |
| `DAY_FIRST_PLAIN` | `1 March 2023` | — |
| `MONTH_FIRST` | `March 1, 2023` | — |

Five explicit rules. No natural-language parsing. Anything else → `UNPARSEABLE_DATE`.

### Provenance + calendar validation

Every result returns `{ raw, status, iso, format }` — the original source value is **always preserved**. Impossible calendar dates are rejected by UTC round-trip verification, so `31st February 2023` and `2023-02-30` are `UNPARSEABLE_DATE`, never coerced.

Unsupported format → **Needs Review / blocked**, never inference.

---

## E. MALFORMED-DATE FAIL-CLOSED PROOF

### The real defect, on real data

```
price_records.effective_from = "1st March 2023"   →  504 rows
new Date("1st March 2023")                          →  Invalid Date
```

Legacy logic `new Date(effectiveFrom) > new Date(at)` → `Invalid Date > <valid>` → **`false`** → `priceValidity` never returned `"Future"` → the price **fell through and was treated as already in force**. A malformed date was read as a *current* date. That is a fail-open on the exact gate that decides whether a price may reach Costing.

### The fix

`priceValidity` now returns a new `Unparseable` state, checked **before** any temporal comparison:

```
Rejected / superseded   → "Rejected"
effectiveFrom malformed → "Unparseable"     ← new, fails closed
validUntil    malformed → "Unparseable"     ← new, fails closed
validUntil    absent    → "No Validity Provided"
effectiveFrom future    → "Future"
validUntil    past      → "Expired"
within 14 days          → "Expiring Soon"
otherwise               → "Valid"
```

`Unparseable` is **not** in `RELAXABLE_VALIDITY_STATES`, **not** in `STRICT_VALIDITY_STATES`, therefore **never eligible**. Also added to the `PRICE_STATES` vocabulary in `product-price-library.mjs` for consistency.

### Behavioural delta — measured

Strict-mode eligibility was swept against a faithful replication of the legacy gate:

| Case | New | Legacy | |
|---|---|---|---|
| undated / expired / valid / future / rejected / superseded / Discovery-Only / unapproved / Farenhyt | — | — | **identical** |
| **`malformed valid_until`** | **blocked** | **eligible** | 🔴 **fail-open closed** |

**The only behavioural change in the entire task is that malformed dates now fail closed.** Everything else is preserved — strict default proven by the sweep, and `temporalValidityStates(false)` returns byte-identical `["Valid","Expiring Soon"]` to the old inline set.

### `1st March 2023` normalized (F4)

```
raw: "1st March 2023"  →  status VALID_DATE  iso 2023-03-01  format DAY_FIRST_ORDINAL
```
and the test asserts `Number.isNaN(new Date("1st March 2023").getTime())` — proving the native parser really did fail, while the governed parser succeeds deterministically. It correctly yields `No Validity Provided` (not `Future`, not `Unparseable`).

---

## F. POLICY PERSISTENCE PATH

### The commercial decision is current — accepted, not re-requested

`PRICE_VALIDITY_POLICY = VALID_UNTIL_SUPERSEDED` for the `Approved` / `Costing` / `Current Internal Reference` context is treated as **authorized**.

### But there is **no governed writer**

| Probe | Result |
|---|---|
| `grep commercial_conditions` across `worker app scripts db` | **only my reader + comments** |
| Any `/conditions` route | **none** |
| Any INSERT/UPDATE for the table | **none** |
| `db/schema.ts` (`commercialConditions`) | **0 — not modelled in Drizzle** |
| Origin | raw `CREATE TABLE` in `drizzle/0014_task9_fire_alarm_library.sql` only |

The table exists as a migration artifact; it was **never wired to any route, writer, or schema model**. So:

> **The missing item is PERSISTENCE CAPABILITY, not another commercial decision.**

Per §8 I did **not** insert, and did **not** hand-roll SQL. `commercial_conditions` remains **0 rows** (verified).

### Exact smallest writer handoff

| Item | Value |
|---|---|
| **Where** | `worker/product-price-library-api.mjs` (already owns price-source governance and the `decision()` audit helper) |
| **Route** | `POST /api/price-source-versions/{sourceVersionId}/conditions` |
| **Body** | `{ conditionType: "PRICE_VALIDITY_POLICY", value: { policy: "VALID_UNTIL_SUPERSEDED" }, reason: ">= 10 chars" }` |
| **Guards** | `canGovernGlobal(user.role)`; the target `price_source_versions` row must be `Approved` + `Costing` + `Current Internal Reference` + not superseded; reject any other `policy` value |
| **Write** | `INSERT INTO commercial_conditions (...)` with `review_status='Approved'`, `created_by=user.id` |
| **Audit** | reuse `decision(env.DB, user, "Commercial Condition", id, "Approved", …)` |
| **Also needed** | declare `commercialConditions` in `db/schema.ts` so the table is a modelled entity, not a migration orphan |
| **Size** | one route + one schema declaration; **no migration** (table already exists) |

Once that exists, the already-authorized decision is one authenticated `POST` away — no further commercial judgement required.

---

## G. IFP-2100HV READINESS

`price_6980c523` — re-read `2026-10-03T20:32:03Z`, **unchanged**:

| Field | Value |
|---|---|
| `approval_status` | `Needs Review` ✅ unchanged |
| `downstream_use` | `Discovery Only` ✅ unchanged |
| `valid_until` | `NULL` ✅ unchanged |
| `validity_state` | `Historical — Validity End Missing` ✅ unchanged |
| `reviewed_by` | `NULL` ✅ unchanged |

Supporting gates: identity Active · technical approval `Approved` · source version `Approved`/`Costing`/`Current Internal Reference`/not superseded · discount rule Approved.

**The temporal blocker is closed mechanically and is no longer a *policy* question.** What remains is purely mechanical: persist the condition (needs the writer, §F), then a Library/Admin approves the record. **Not done here.**

---

## H. FX HANDOFF — UNCHANGED

**No FX schema, code, policy, or data touched.** Verified: `worker/pricing-api.mjs`, `worker/boq-line-cost-api.mjs`, `app/domain/cost-buildup-model.mjs` — zero diff. Al Musa FX rows still **0**.

Handoff stands exactly as before:

| Item | Value |
|---|---|
| Blocker | `pricing_exchange_rates.valid_until` is **`NOT NULL`** in live DDL, **and** `convertCurrency` independently requires a non-expired `valid_until` |
| Change needed | make `valid_until` nullable **+** relax the `convertCurrency` gate to honour `superseded_at IS NULL` |
| Surface | reuse `commercial_conditions` with `condition_type='EXCHANGE_RATE_VALIDITY_POLICY'`, or an analogous per-project condition |
| Risk | `convertCurrency` is shared by the PROJECT **and** SCOPE costing paths — needs its own suite |
| Owner | Commercial/Procurement (policy) → Library Manager/Administrator (migration + execution) |
| **Not done** | another project's expiry was **not** copied; no FX rate persisted |

**New evidence for whoever picks this up:** two suites (`fx-single-truth`, `r6-fixed-usd-sar-normalization`) already fail with

```
SyntaxError: pricing-engine.mjs does not provide an export named 'FIXED_USD_SAR_POLICY'
```

— i.e. another lane already has **tests written for an FX until-superseded policy export that was never built**. Those tests are the natural starting point for this handoff. (Pre-existing; not fixed here, per §10.)

---

## I. VCS STATE — READ-ONLY

No `git stash / reset / checkout / restore / clean / add / commit / push` was executed. `stash@{0}` untouched and **not dropped**.

```
git stash list
  stash@{0}: WIP on main: 292bb86 Golden E2E: ...   (pre-existing, retained)

unstaged modified: 14      staged: 74
```

### This lane's files

| File | State |
|---|---|
| `app/domain/commercial-date.mjs` | **untracked** (new) |
| `worker/commercial-validity-policy.mjs` | **untracked** (new, prior task) |
| `tests/commercial-validity-policy.test.mjs` | **untracked** (new + extended) |
| `tests/pricing-costing-expiry-policy.test.mjs` | **untracked** |
| `tests/r5-supplier-price-contract.test.mjs` | **untracked** |
| `worker/scope-pricing-input.mjs` | **untracked** |
| `app/domain/pricing-engine.mjs` | **staged + unstaged** (`MM`) |
| `worker/pricing-runtime.mjs` | **staged + unstaged** (`MM`) |
| `app/domain/product-price-library.mjs` | unstaged (`M`) |

`MM` arises because the prior stash restore staged those files; this task's later edits sit unstaged on top. The remaining ~72 staged / ~12 unstaged files belong to **other lanes**.

**No cleanup attempted.** `VCS_STATE_MUTATED = NO`.

---

## J. FOCUSED TESTS

| Suite | Result |
|---|---|
| `commercial-validity-policy` | **26/26** |
| `pricing-costing-expiry-policy` | **25/25** |
| `knowledge-banner-copy-truth` (R5) | **4/4** |
| `product-price-library-api` | 9/10 |
| `pricing-engine` | 20/20 |
| `pricing-api` | 13/13 |
| `confidence-safety-engine` | 16/16 |
| `r5-supplier-price-contract` | 1/6 (back to pre-task baseline) |

### §12 checklist

| Requirement | Test | ✅ |
|---|---|:-:|
| missing validity + governed policy → eligible | `A1`, Gate 1 relaxed, `E2E A` | ✅ |
| missing validity + no policy → blocked | `A2`, `E2E A (strict)` | ✅ |
| **explicit expired + governed policy → blocked** | `B-regression`, `B`, `E1`, `E2E B`, `C4` | ✅ |
| explicit current date → eligible | `E2`, `C` | ✅ |
| future effective date → blocked | `C3`, `D` | ✅ |
| **malformed `effective_from` → blocked** | `F1` | ✅ |
| **malformed `valid_until` → blocked** | `F2`, `F3`, `F6` | ✅ |
| **`"1st March 2023"` deterministically normalized** | `F4` | ✅ |
| Rejected → blocked | `C1`, `E`, `E2E E` | ✅ |
| Discovery Only → blocked | `C2`, `F` | ✅ |
| Needs Review → blocked | `C1`, `F` | ✅ |
| superseded source / version / policy → blocked | `A4`, `B2` | ✅ |
| wrong source-version policy → not borrowed | `B1`, `B4`, `B5` | ✅ |
| **no arbitrary production boolean** | `G1`, `G2`, `G3` | ✅ |
| **no date invented or overwritten** | `D1`, `D2`, `F6` | ✅ |

### Regression

26 of 48 suites still fail — **the identical set and counts recorded before this task began**, with one exception found and resolved:

- **`r5-supplier-price-contract` 5 → 6 → back to 5.** The extra failure was `CASE F/H` asserting an expired price becomes eligible under the relaxed flag — the exact contract §1/§2 supersedes. Only that assertion was updated; the neighbouring rejected/currency assertions were left intact.

The remaining 5 in that file are pre-existing and belong to the supplier-intake lane (`"Costing Eligible"` vs `"Costing"` state mismatch; `supplier-price-intake.mjs` and `supplier-price-intake-api.mjs` show **zero** diff from me).

`product-price-library-api`'s single failure is the other lane's `INGESTIBLE_DOCUMENT_TYPES` ingestion refactor (unchanged, and it persists with my edits reverted).

`price-effective-date-validity` (G-5) still fails on two absent exports (`governedDateRemediation`, `parseGovernedPriceDate`). **This task delivered the parser it needed** (`normalizeCommercialDate`) — G-5 remains a separate authorised slice.

---

## FINAL FLAGS

```
VALID_UNTIL_SUPERSEDED_MISSING_ONLY = YES
EXPLICIT_EXPIRED_PRICE_BLOCKED_UNDER_POLICY = YES
UNGOVERNED_PRODUCTION_VALIDITY_OVERRIDE = NO
COMMERCIAL_DATE_PARSING_DETERMINISTIC = YES
UNPARSEABLE_EFFECTIVE_DATE_FAILS_CLOSED = YES
UNPARSEABLE_VALID_UNTIL_FAILS_CLOSED = YES
FARENHYT_1ST_MARCH_2023_NORMALIZED = YES
PRICE_VALIDITY_POLICY_HUMAN_DECISION_CURRENT = YES
PRICE_VALIDITY_POLICY_PERSISTED = NO
PRICE_VALIDITY_POLICY_PERSISTENCE_BLOCKER =
    NO GOVERNED WRITER EXISTS — commercial_conditions has no route, no writer,
    and is not modelled in db/schema.ts. Needs
    POST /api/price-source-versions/{id}/conditions + a db/schema.ts declaration.
    PERSISTENCE CAPABILITY, not a commercial decision.
IFP2100HV_COSTING_AUTHORITY_CURRENT = NO
FX_POLICY_CHANGED = NO
ENGINEER_INPUT_REQUIRED = NO
VCS_STATE_MUTATED = NO
```

`CURRENTNESS_STATUS = PROVEN` — canonical re-read `2026-10-03T20:32:03Z`.

---

## PROHIBITIONS OBSERVED

- ✅ **No catalogue approval** — `Approved`+`Costing` price records still **1** (pre-existing); none of the 504 promoted
- ✅ **No price approval** — `price_6980c523` untouched
- ✅ **No FX changes** — zero diff on FX paths; no rate persisted; no other project's expiry copied
- ✅ **No invented dates** — no `valid_until` written; `commercial_conditions` still 0 rows; malformed source values left exactly as recorded
- ✅ **No pricing lines** — Al Musa still **0 runs / 0 lines**
- ✅ **No quotation, margin or selling price**
- ✅ **No technical changes**
- ✅ **No schema** — `db/schema.ts` untouched (the handoff recommends a declaration; not made here)
- ✅ **No direct SQL** — every DB interaction was `SELECT`
- ✅ **No commit / push / deploy**; **no stash/reset/checkout/restore/clean/add**; `stash@{0}` not dropped