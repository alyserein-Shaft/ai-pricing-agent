# Al Mousa — Two Authorized Governed Commercial Writes: **BLOCKED**

**Project**: `project_ae501b85-9c12-4332-bf8e-787c90f2d388` — *Al Mousa School — Clean Golden Run*
**Task type**: live governed execution (2 authorized writes)
**Outcome**: **STOPPED before any write.** `UNAUTHORIZED_LIVE_WRITES = 0`
**Final read-only verification**: `2026-10-03T21:00:29Z` → `CURRENTNESS_STATUS = PROVEN`

---

## A. EXECUTIVE VERDICT

```
PRICE_VALIDITY_CONDITION_PERSISTED = NO
PRICE_RECORD_APPROVED = NO
IFP2100HV_COSTING_AUTHORITY_CURRENT = NO
FARENHYT_65_PERCENT_RULE_CURRENT = YES
DISCOUNT_SCOPE = FARENHYT_MATERIAL_ONLY
OTHER_IN_HOUSE_BRANDS_INHERIT_65_PERCENT = NO
AL_MOUSA_FX_AUTHORITY_CURRENT = NO
SAR_PRICING_READY = NO
UNAUTHORIZED_LIVE_WRITES = 0
```

**Blocker, stated precisely:**

> The governed runtime is serving **stale code**. The `commercial_conditions` writer
> route (`POST /api/price-source-versions/:sourceVersionId/conditions`) exists in the
> working tree and is proven correct in isolation (27/27), but the live `workerd`
> process has **not reloaded** it. The route is therefore not reachable, and the only
> remaining path to the data would be direct SQL — which is explicitly prohibited.

I stopped rather than write. **No code was changed and no row was touched.**

---

## B. CANONICAL BEFORE STATE

All read-only, re-validated immediately before the attempt (`2026-10-03T20:56:46Z`).

### Product — ✅ current

| Field | Value |
|---|---|
| id | `product_ec9dcbb1-39fe-4d24-b369-8b3d271604a7` |
| part_number | **IFP-2100HV** (Red cabinet, per governed attributes) |
| brand | **Farenhyt** ✅ |
| manufacturer | Honeywell |
| identity_status | `Active` |
| review_status | `Reviewed` |
| superseded_by_product_id | `NULL` |

### Technical approval — ✅ current

| Field | Value |
|---|---|
| id | `approval_625e5fbe-19ee-40e5-affe-a2c61a8fd956` |
| status / type | `Approved` / `Technical` |
| decided_by / at | `omair-primary` / `2026-10-02T23:08:25.840Z` |
| safety_decision | `safety_ababb5f6`, `superseded_at` NULL |
| technical_eligibility | `Eligible with Required Warning Acknowledgment` |
| → candidate product | `product_ec9dcbb1` ✅ correct lineage |

### Price source version — ✅ current, single version

| Field | Value |
|---|---|
| id | `pricesourceversion_b8367c21-b926-4aec-88c6-dbdb76a462ee` |
| source | `productsource_0d87f6ca` — *KSA Honeywell Farenhyt Series Price List -2023.xlsx* |
| version_number | `1` — **only version for this source**, so nothing supersedes it |
| approval_state | **`Approved`** ✅ |
| downstream_use | **`Costing`** ✅ |
| reliability | **`Current Internal Reference`** ✅ |
| superseded_at | **`NULL`** ✅ |
| previous_version_id | `NULL` |

Writer gate result: `Approved=1, Costing=1, CurrentInternalReference=1, NotSuperseded=1`.

### Price record — ✅ single row, correct lineage

| Field | Value |
|---|---|
| id | `price_6980c523-856a-4621-ac51-404de322c96e` |
| rows for this product | **1** (no competing/superseding price) |
| amount_minor / currency | `678700` = **USD 6,787.00** / `USD` / `EA` |
| price_type | `Manufacturer List Price` |
| effective_from | `1st March 2023` |
| **valid_until** | **`NULL`** ✅ |
| validity_state | `Historical — Validity End Missing` |
| approval_status | `Needs Review` |
| downstream_use | `Discovery Only` |
| reviewed_by / at | `NULL` / `NULL` |
| price_record_versions | **0** — never reviewed |

### Discount rule — ✅ current, correctly bound

| Field | Value |
|---|---|
| id | `discountrule_784cec95-37be-4b55-b736-94e6bd648283` |
| brand_id | `brand_9c537844` = **Farenhyt** |
| source_version_id | **`pricesourceversion_b8367c21`** ← the exact target version ✅ |
| family_scope / component_scope | `ALL_FARENHYT` / **`Material Only`** |
| discount_basis_points | `6500` (65%) |
| calculation_method | `LIST_PRICE_MINUS_PERCENTAGE` |
| approval_state / approved_by | `Approved` / `omair-primary` |
| superseded_at | `NULL` |

### Condition — ✅ absent (nothing to conflict with)

`commercial_conditions` = **0 rows**.

### FX / pricing — untouched baseline

Al Musa FX rows `0` · pricing runs `0` · pricing lines `0`.

**Preflight conclusion: every identity and gate is current. No drift. The blocker is purely runtime.**

---

## C. LIVE WRITES EXECUTED

**NONE.**

### Write 1 — attempted, not executed

| Item | Value |
|---|---|
| Route | `POST /api/price-source-versions/pricesourceversion_b8367c21-b926-4aec-88c6-dbdb76a462ee/conditions` |
| Target | `pricesourceversion_b8367c21` — gates verified `1/1/1/1` immediately prior |
| Actor | would have been the authenticated `local-development-user` (Administrator) — see §H |
| Reason | authorized-policy text (≥ 10 chars) |
| **Result** | `HTTP 404` `{"error":{"code":"API_NOT_FOUND","message":"Document endpoint not found."}}` |
| Rows written | **0** |

The 404 came from `worker/document-api.mjs:279`, reached because `handleProductPriceLibraryApi` returned `null` — i.e. the running worker does not contain my path-allowlist entry.

### Root cause — proven, not inferred

| Evidence | Value |
|---|---|
| `workerd` process start | `Sat Oct 3 23:15:52 2026` (PID 76942) |
| My route file mtime | `Oct 03 23:42:30` — **27 minutes after the worker started** |
| Live probe of an **existing** governed route | `POST /api/price-sources/productsource_0d87f6ca.../review` → **`PRICE_VALIDITY_REQUIRED`** |
| Interpretation | The live worker still runs the pre-repair code (that error string was removed two slices ago), so it has not reloaded any of the current working-tree worker code |

### Write 2 — not attempted

The per-record approval (`POST /api/price-records/price_6980c523.../review`) was **not attempted**, because Step 1 never succeeded and approving without the persisted policy would leave the record in an inconsistent, non-governed state. It is also served by the same stale worker.

### Why I did not work around this

| Option | Verdict |
|---|---|
| Direct SQL insert | ❌ **Explicitly prohibited.** Would bypass the governed route *and* the `decision()` audit trail. |
| Restart `wrangler dev` | ❌ **Not authorized.** Skill §11: do not start/restart/kill the running process without explicit authorization. This task authorized two *writes*, not a service restart. It is a shared dev server another lane may be using. |
| Write a workaround route | ❌ Task: *"This task should ideally require no code changes. If code changes appear necessary, stop and report the blocker instead of expanding scope."* |
| Change actor to `omair-primary` | ❌ Would be **impersonation of a human approver**. See §H. |

---

## D. CANONICAL AFTER STATE

Fresh re-read at `2026-10-03T21:00:29Z`. **Records changed by me: none.**

| Metric | Before | After |
|---|---|---|
| `commercial_conditions` rows | 0 | **0** |
| conditions for target version | 0 | **0** |
| `price_6980c523` Approved+Costing | 0 | **0** |
| `price_6980c523` state | `Needs Review` / `Discovery Only` / `valid_until NULL` | **identical** |
| `product_library_decisions` total | 629 | **629** |
| Al Musa FX rows | 0 | **0** |
| Al Mesa/Al Mousa pricing runs | 0 | **0** |
| Al Mousa pricing lines | 0 | **0** |

My reachability probe returned `PRICE_VALIDITY_REQUIRED`, which is emitted **before** any write, so it created no audit row — confirmed by the unchanged decision count (629).

---

## E. COST PROOF (derived, not persisted)

Using current governed values only. **No SAR conversion performed.**

```
List price (governed, price_6980c523.amount_minor = 678700)   USD 6,787.00 / EA
Governed rule (discountrule_784cec95, Farenhyt, Material Only)  65% OFF list
Net factor                                                       × 0.35
Net material cost                                                USD 2,375.45 / EA
```

Verified: `6787.00 × 0.35 = 2375.45` exactly.

**This is a derivation for review only. No pricing line, no margin, no selling price, no FX, no quotation was created.** The live price record remains `Needs Review` / `Discovery Only`.

---

## F. BRAND-POLICY PROOF

| Brand | In-house (project policy) | Governed 65% discount today? |
|---|:-:|---|
| **Farenhyt** | ✅ yes | ✅ **YES** — `discountrule_784cec95`, brand-bound, `Material Only` |
| **Gamewell-FCI** | ✅ yes | ❌ **NO** — no governed rule |
| **Gent** | ✅ yes | ❌ **NO** — no governed rule |
| Notifier | ❌ not in-house | ❌ NO |
| Generic Honeywell | ❌ | ❌ NO |

**No blanket Honeywell discount exists.** The rule is bound by `brand_id`, not by `manufacturer_id` — so Honeywell's ownership of Farenhyt does **not** transfer the 65% to Gamewell-FCI, Gent, Notifier or generic Honeywell parts. `discountrule_784cec95`'s own `evidence_json` states `explicitlyNotApplicableTo: ["NOTIFIER","GAMEWELL","GENT","generic HONEYWELL"]`.

This task concerns **Farenhyt IFP-2100HV only**.

*Evidence classes: brand-in-house status and the discount rule = **project governed evidence**; IFP-2100HV belonging to the Farenhyt line = **first-party manufacturer evidence** already on record (datasheet 351602:C:04-22, cited in the technical approval). No new external facts were needed and none were inferred.*

---

## G. REMAINING COMMERCIAL BLOCKER

**One blocker, in execution order:**

> **Stale governed runtime.** The live `workerd` has not reloaded the working-tree worker code, so neither
> `POST /api/price-source-versions/:id/conditions` nor the current
> `POST /api/price-records/:id/review` behaviour is reachable. Until the worker reloads,
> the authorized writes cannot be performed through their governed routes.

**Not implemented, as instructed.** The blocker is an environment/runtime condition, not code and not a commercial decision.

Second, already-known and **unchanged by this task**: **FX authority** — Al Musa has `0` governed `pricing_exchange_rates` rows and `convertCurrency` requires a non-expired `valid_until`, so USD→SAR remains blocked. That is a *separate* slice and was not opened.

Note the distinction the task asked me to preserve:

| | State |
|---|---|
| **PRODUCT COSTING AUTHORITY** | `NO` — blocked by the stale runtime (and, once that clears, by the two authorized writes) |
| **PROJECT CURRENCY CONVERSION AUTHORITY** | `NO` — independently blocked by missing FX authority |

---

## H. CODE / VCS

```
CODE_WRITES = 0
```

No file was created, edited, or deleted in this task. No test was modified. Verified by mtime: `worker/product-price-library-api.mjs`, `db/schema.ts` and the new test all still carry their **previous slice's** timestamps (23:40–23:44); nothing was touched during this session.

**Read-only VCS** (no `stash / reset / checkout / restore / clean / add / commit / push`):

```
stash@{0}  retained, not dropped
unstaged = 19   staged = 74   (all pre-existing foreign shared state)
```

### Actor-attribution finding (reported, not worked around)

The running app's configured identity is **`local-development-user`** (`APP_USER_ID` in `.dev.vars`, role Administrator). Prior governed commercial decisions are recorded as **`omair-primary`** (541 decisions; `discount_rules.approved_by` and `price_source_versions.approved_by` are both `omair-primary`).

So the two writes, once unblocked, would be audited as `decided_by = local-development-user`, **not** `omair-primary`. I deliberately did **not** set `APP_USER_ID=omair-primary` to make the audit trail read as the commercial decision-maker — that would be impersonating a human approver. Flagging it so you can decide whether the provenance is acceptable, or whether you want to run the two calls under an omair-primary session yourself.

### Also unchanged

No FX work, no `EXCHANGE_RATE_VALIDITY_POLICY`, no `convertCurrency` change, no pricing lines, no quotation, no margin/selling price, no migration or schema change, no writer-architecture change, no duplicate-write-race migration, no `validity_state='Superseded'` fix, no technical/drawing/matching lane touched, panel selection and technical approval untouched, no date invented, list price unaltered, no catalogue approval, no other price record approved.

---

## I. EXACT UNBLOCK SEQUENCE

Once the worker is reloaded (by whoever owns the running process):

1. **Verify** the live worker serves current code, e.g. `POST /api/price-sources/productsource_0d87f6ca.../review` with `downstreamUse:"Costing"` should **no longer** return `PRICE_VALIDITY_REQUIRED`.
2. **Write 1** — `POST /api/price-source-versions/pricesourceversion_b8367c21-b926-4aec-88c6-dbdb76a462ee/conditions` with `PRICE_VALIDITY_POLICY` / `VALID_UNTIL_SUPERSEDED` + substantive reason. Idempotent if already present; stop on `CONDITION_CONFLICT`.
3. **Verify** `resolvePriceValidityPolicy(['productsource_0d87f6ca'])` → `allows: true`, and confirm expired/malformed still blocked.
4. **Write 2** — `POST /api/price-records/price_6980c523-856a-4621-ac51-404de322c96e/review` with `{ "decision": "Approve", "downstreamUse": "Costing", "reason": "..." }` — **`validUntil` omitted** so `valid_until` stays `NULL` and `validity_state` becomes the truthful `No Validity Provided`.
5. **Re-read** and prove `IFP2100HV_COSTING_AUTHORITY_CURRENT = YES`.

No new engineering work is required — both routes already exist and are proven. FX remains a separate slice.

---

## PROHIBITIONS OBSERVED

- ✅ No unauthorized live writes — `commercial_conditions` 0, price record untouched, decision count unchanged
- ✅ No direct SQL writes — every DB access was a read
- ✅ No service restart / kill, no `stash / reset / checkout / restore / clean / add / commit / push`
- ✅ No code change, no migration, no schema change
- ✅ No price approved, no catalogue approval, no other price record touched
- ✅ No invented or altered date, list price unaltered
- ✅ No discount change, no 65% applied to any other brand
- ✅ No panel-selection or technical-approval change
- ✅ No FX work, no FX rate inserted, no SAR conversion
- ✅ No pricing lines, quotation, margin or selling price
- ✅ No technical/drawing/matching lane touched