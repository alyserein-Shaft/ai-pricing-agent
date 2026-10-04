# AI Pricing Agent — Governed `commercial_conditions` Writer

**Project**: `project_ae501b85-9c12-4332-bf8e-787c90f2d388` — *Al Mousa School — Clean Golden Run*
**Scope**: add the missing governed writer only. No business decision reopened, no policy-semantics change, no FX, no price approval.
**Final read-only verification**: `2026-10-03T20:45:09Z` → `CURRENTNESS_STATUS = PROVEN`
**Live project writes**: **0**

---

## A. EXECUTIVE VERDICT

```
COMMERCIAL_CONDITIONS_WRITER = COMPLETE
PRICE_VALIDITY_POLICY_PERSISTABLE = YES
POLICY_SEMANTICS_CHANGED = NO
EXPLICIT_EXPIRED_PRICE_STILL_BLOCKED = YES
MALFORMED_DATE_STILL_FAILS_CLOSED = YES
UNGOVERNED_OVERRIDE_PATH = NO
MIGRATION_REQUIRED = NO
LIVE_PROJECT_WRITES = 0
```

The already-authorized decision now has a governed persistence path. It is proven end-to-end against an **isolated in-memory SQLite** database, and the **existing** `resolvePriceValidityPolicy(...)` reader recognises the persisted row **without any change to the reader or to policy semantics**.

---

## B. ROUTE CONTRACT

```
POST /api/price-source-versions/:sourceVersionId/conditions
```

Implemented in **`worker/product-price-library-api.mjs`** — the surface that already owns price-source governance and the `decision(...)` audit helper. **No new API namespace**; one segment group added to the same handler's existing path allowlist.

### Request body (the only supported shape)

```json
{
  "conditionType": "PRICE_VALIDITY_POLICY",
  "value": { "policy": "VALID_UNTIL_SUPERSEDED" },
  "reason": "Authorized company commercial policy: current until superseded."
}
```

### Validation gates, in order

| # | Gate | Failure |
|---|---|---|
| 0 | Path allowlist claims `/api/price-source-versions/` | falls through to the next handler |
| 1 | `canGovernGlobal(user.role)` → 403 `LIBRARY_ROLE_REQUIRED` | no write |
| 2 | `reason.length >= 10` → 422 `REVIEW_REASON_REQUIRED` | no write |
| 3 | `conditionType === "PRICE_VALIDITY_POLICY"` → 422 `CONDITION_TYPE_NOT_SUPPORTED` | no write |
| 4 | `value.policy === "VALID_UNTIL_SUPERSEDED"` → 422 `CONDITION_POLICY_NOT_SUPPORTED` | no write |
| 5 | source version exists → 404 `PRICE_SOURCE_VERSION_NOT_FOUND` | no write |
| 6 | `approval_state === 'Approved'` → 409 `PRICE_SOURCE_VERSION_NOT_APPROVED` | no write |
| 7 | `downstream_use === 'Costing'` → 409 `PRICE_SOURCE_VERSION_NOT_COSTING` | no write |
| 8 | `reliability === 'Current Internal Reference'` → 409 `PRICE_SOURCE_VERSION_NOT_CURRENT_REFERENCE` | no write |
| 9 | `superseded_at IS NULL` → 409 `PRICE_SOURCE_VERSION_SUPERSEDED` | no write |
| 10 | duplicate/conflict (see §E) | 200 idempotent / 409 `CONDITION_CONFLICT` |

Deliberately narrow: exactly **one** condition type and **one** policy value. Not a generic free-form condition writer.

### Response behaviour

| Outcome | Status | Body |
|---|---|---|
| Created | **201** | `{ conditionId, sourceVersionId, conditionType, value, reviewStatus:"Approved", createdBy, idempotent:false, approvedPrices:0, downstreamUseChanged:false }` |
| Idempotent repeat | **200** | same shape + `idempotent:true`, `duplicateAction:"EXISTING_APPROVED_CONDITION_RETAINED"`, existing `conditionId` |
| Conflict | **409** | `error.code:"CONDITION_CONFLICT"` + the current condition, echoed |
| Any gate failure | 4xx | typed `error.code`; **nothing written** |

The response asserts its own limits: `approvedPrices: 0`, `downstreamUseChanged: false`.

### Two constants, one source of truth

```js
const SUPPORTED_COMMERCIAL_CONDITIONS = Object.freeze({ PRICE_VALIDITY_POLICY: "PRICE_VALIDITY_POLICY" });
const CURRENT_INTERNAL_REFERENCE = "Current Internal Reference";
```

`VALID_UNTIL_SUPERSEDED` is **imported from the reader** (`worker/commercial-validity-policy.mjs`), so writer and reader cannot disagree on the policy name. A test asserts the writer's four gates and the reader's four predicate markers both exist, guarding against drift.

### ⚠️ One limitation, stated plainly

In the current single-user MVP, `applicationActor()` defaults the role to `Administrator`, so a **403 `LIBRARY_ROLE_REQUIRED` is not reachable today**. The reachable fail-closed path is **503 `APPLICATION_CONTEXT_UNAVAILABLE`**. I proved:

- **behaviourally**: no server context → 503, no write;
- **structurally**: the `canGovernGlobal(user.role)` guard exists and appears **before** the `INSERT`.

I did not fabricate a 403 test, because inventing one would have required inventing an authorization model.

---

## C. SCHEMA MAPPING

### Canonical existing DDL (read from live D1 before modelling)

```sql
CREATE TABLE `commercial_conditions` (
  `id` text PRIMARY KEY NOT NULL,
  `source_version_id` text NOT NULL,
  `condition_type` text NOT NULL,
  `value_json` text NOT NULL,
  `scope_json` text NOT NULL,
  `review_status` text NOT NULL DEFAULT 'Needs Review',
  `created_by` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Indexes/triggers on the table: **only** `sqlite_autoindex_commercial_conditions_1` (the PK autoindex). **No unique constraint** beyond the primary key — which is precisely why duplicate safety had to be enforced in the route (§E).

### Declaration added to `db/schema.ts`

```ts
// commercial_conditions already exists in the database (drizzle/0014_task9_fire_alarm_library.sql).
// This declaration MODELS THE EXISTING TABLE EXACTLY so it stops being a migration
// orphan now that it has a governed writer (POST /api/price-source-versions/:id/conditions).
// NO MIGRATION was created or modified: no columns added, no field meanings reinterpreted,
// and no foreign key added -- the canonical DDL declares none on source_version_id.
export const commercialConditions = sqliteTable("commercial_conditions", {
  id: text("id").primaryKey(),
  sourceVersionId: text("source_version_id").notNull(),
  conditionType: text("condition_type").notNull(),
  value: text("value_json", { mode: "json" }).notNull(),
  scope: text("scope_json", { mode: "json" }).notNull(),
  reviewStatus: text("review_status").notNull().default("Needs Review"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
```

Modelled exactly: every column, the `Needs Review` default, the `CURRENT_TIMESTAMP` default, and **no foreign key** (the real DDL declares none). A test asserts no invented columns (`superseded_at`, `approved_by`, `valid_until`, `version_number` are all absent).

> **`NO MIGRATION CREATED`** — asserted two ways: a test proves `commercial_conditions` appears in **exactly one** migration file (`0014_task9_fire_alarm_library.sql`, the pre-existing creation), and `git status --short drizzle` reports **0** changed files out of 66.

---

## D. PERSISTENCE PROOF

Full chain, each step independently asserted:

```
POST /api/price-source-versions/psv-good/conditions
   │  canGovernGlobal, reason, conditionType, policy      -> all pass
   │  price_source_versions: Approved + Costing
   │                       + Current Internal Reference
   │                       + not superseded              -> all pass
   ▼
INSERT INTO commercial_conditions
   (id, source_version_id, condition_type, value_json,
    scope_json, review_status, created_by)
   -> exactly 1 row, review_status='Approved',
      created_by='omair-primary', created_at populated
   ▼
decision(env.DB, user, "Commercial Condition", conditionId,
         "Approved", {condition:null},
         {conditionType, value, sourceVersionId, reviewStatus},
         reason, null)
   -> audit row: entity_type, entity_id, action,
      decided_by, reason, new_value{sourceVersionId,...}
   ▼
resolvePriceValidityPolicy(db, ["source-1"])   [EXISTING, UNMODIFIED]
   -> { allows: true, policy: "VALID_UNTIL_SUPERSEDED",
        sourceVersionIds: ["psv-good"] }
   ▼
loadPricingInput -> safetyDecision.priceEligibility
   valid_until NULL  -> "Eligible for Price Approval"
```

**The reader was not modified.** `worker/commercial-validity-policy.mjs` has **zero** diff from the previous slice.

### Downstream gates verified intact *after* persistence

With the condition persisted, each of these stays **blocked**:

| Case | Result |
|---|---|
| explicit past `valid_until` | 🔴 `Price Approval Disabled` |
| malformed `valid_until` | 🔴 blocked |
| malformed `effective_from` | 🔴 blocked |
| `Discovery Only` | 🔴 blocked |
| `Needs Review` | 🔴 blocked |
| `approval_status='Superseded'` | 🔴 blocked |
| `superseded_at` stamped | 🔴 blocked |

Only a genuinely **missing** `valid_until` becomes temporally usable. Exactly the approved meaning.

---

## E. DUPLICATE / CONFLICT BEHAVIOUR

The table has **no unique constraint** beyond its PK, so this is enforced in the route, fail-closed. Currentness = the **latest** row per `(source_version_id, condition_type)` — the same rule the reader uses (`ORDER BY created_at ASC`, last wins).

| Situation | Behaviour | Proof |
|---|---|---|
| **Same** current approved condition | **200 idempotent** — returns the existing `conditionId`, `idempotent:true`, `duplicateAction:"EXISTING_APPROVED_CONDITION_RETAINED"`. **No second row.** | row count stays `1` |
| **Conflicting** current approved condition | **409 `CONDITION_CONFLICT`**, echoing the current condition. Nothing written; the existing row is byte-for-byte untouched. | row count stays `1`, `value_json` unchanged |
| Current **non-approved** condition | **409 `CONDITION_CONFLICT`** — not silently overwritten. | row count stays `1` |

**No supersession/replacement workflow was invented.** Replacing a conflicting condition requires a separate explicit governed decision, which does not exist yet and was out of scope.

### Schema limitation worth recording

Because the table carries **no** `superseded_at` and **no** unique index, "which condition is current" is decided purely by `created_at` ordering. Two conditions written in the same second would order by `id` (a UUID) — non-deterministic. Adding a unique index on `(source_version_id, condition_type)` and a `superseded_at` column would harden this, but that is a **migration**, explicitly excluded here. The route's fail-closed conflict check keeps this safe in the meantime.

---

## F. IFP-2100HV READINESS

Read-only validation against the live lineage at `2026-10-03T20:44:17Z`:

| Aspect | State |
|---|---|
| **Source-version condition readiness** | ✅ **READY** — `pricesourceversion_b8367c21` is `Approved` + `Costing` + `Current Internal Reference` + not superseded. `writer_gates_pass = 1`. The writer would accept it today. |
| **Price-record approval state** | `Needs Review` — **unchanged** |
| **Downstream-use state** | `Discovery Only` — **unchanged** |
| **Temporal eligibility state** | `valid_until = NULL`, `effective_from = "1st March 2023"` → `No Validity Provided`, which the policy covers |
| **Costing Authority current?** | **NO** |

The price record remains exactly as it was — verified after the slice:

```
price_6980c523   Needs Review / Discovery Only / valid_until NULL / 1 row, unchanged
Approved+Costing catalogue prices: 1  (the pre-existing price_1c248b3e — none added)
Al Musa pricing runs / lines: 0 / 0
commercial_conditions rows: 0   (no live write)
```

**Not done, by instruction:** the price was not approved, `downstream_use` was not changed, no pricing line was created.

---

## G. FILES CHANGED

| File | Why |
|---|---|
| `worker/product-price-library-api.mjs` | Added the governed `POST /api/price-source-versions/:id/conditions` route, the two shared constants, the reader-policy import, and the one-segment path-allowlist entry so the route is reachable. |
| `db/schema.ts` | Added the `commercialConditions` declaration modelling the existing table exactly. No migration. |
| `tests/commercial-conditions-writer.test.mjs` | **New** — 27 focused tests, in-memory SQLite only. |

Verified by mtime that **nothing else** was touched this slice (`commercial-date.mjs`, `pricing-engine.mjs`, `pricing-runtime.mjs`, `commercial-validity-policy.mjs`, `product-price-library.mjs`, `scope-pricing-input.mjs` all unchanged since the previous slice). `drizzle/` untouched.

---

## H. FOCUSED VALIDATION

```
node --test tests/commercial-conditions-writer.test.mjs      → 27 tests, 27 pass, 0 fail
```

All 21 required cases covered:

| # | Case | Test |
|:-:|---|---|
| 1 | unauthorized caller → rejected | `1` (503 behavioural) + `1b` (guard present & before write) |
| 2 | invalid `conditionType` | ✅ 422 |
| 3 | invalid policy value | ✅ 422 |
| 4 | short reason | ✅ 422 |
| 5 | missing source version | ✅ 404 |
| 6 | non-Approved source version | ✅ 409 |
| 7 | non-Costing source version | ✅ 409 |
| 8 | non-current/historical source version | ✅ 409 |
| 9 | superseded source version | ✅ 409 |
| 10 | valid request → persisted | ✅ 201 |
| 11 | `review_status = Approved` | ✅ |
| 12 | creator/audit identity preserved | ✅ `created_by='omair-primary'` |
| 13 | `decision()` audit row created | ✅ |
| 14 | existing reader resolves the new condition | ✅ `allows:true` before/after |
| 15 | explicit expired remains blocked | ✅ |
| 16 | malformed date remains blocked | ✅ both `valid_until` and `effective_from` |
| 17 | Discovery Only remains blocked | ✅ |
| 18 | Needs Review remains blocked | ✅ |
| 19 | wrong source version cannot borrow | ✅ |
| 20 | exact duplicate → no uncontrolled duplicate | ✅ count stays 1 |
| 21 | conflicting condition fails closed | ✅ + `21b` non-approved |

### Adjacent price-library governance suites

| Suite | Result |
|---|---|
| `commercial-validity-policy` | 26/26 |
| `pricing-costing-expiry-policy` | 25/25 |
| `knowledge-banner-copy-truth` | 4/4 |
| `pricing-engine` | 20/20 |
| `pricing-api` | 13/13 |
| `product-price-library-api` | 9/10 |

### New failures caused by this slice: **0**

Full 48-suite sweep diffed against the previous slice's recorded state: **empty diff** (22 clean / 26 failing, identical counts and identical set).

### Pre-existing / foreign-lane failures (not fixed)

26 suites, unchanged by this slice. Notably:
- `product-price-library-api` 9/10 — the other lane's `INGESTIBLE_DOCUMENT_TYPES` ingestion refactor removed the literal the test greps for.
- `r5-supplier-price-contract` 1/6 — `supplier-price-intake` lane (`"Costing Eligible"` vs `"Costing"`).
- `fx-single-truth`, `r6-fixed-usd-sar-normalization` — expect an unbuilt `FIXED_USD_SAR_POLICY` export (FX lane, untouched).
- `price-effective-date-validity` — G-5, needs two absent exports (separate slice).

### One gap found and documented, deliberately not fixed

`validity_state='Superseded'` **on its own** is not read by `priceValidity` (which only treats `status === 'Rejected'` or a `superseded_at` stamp as rejected), so such a row would remain temporally eligible. The governed representation of supersession is `approval_status='Superseded'`, which **is** enforced (test `19b`). Changing eligibility semantics is explicitly out of scope, so this is recorded in test `19c` and reported rather than silently fixed.

---

## I. NEXT HANDOFF

To reach `IFP2100HV_COSTING_AUTHORITY_CURRENT = YES`, the **smallest** next steps — **not implemented here**:

1. **Persist the already-authorized condition** — one call, no new decision needed:
   ```
   POST /api/price-source-versions/pricesourceversion_b8367c21-b926-4aec-88c6-dbdb76a462ee/conditions
   { "conditionType": "PRICE_VALIDITY_POLICY",
     "value": { "policy": "VALID_UNTIL_SUPERSEDED" },
     "reason": "<substantive commercial reason>" }
   ```
   Owner: **Library Manager / Administrator** (`canGovernGlobal`). The source version already satisfies every gate.
2. **Approve the price record** — the separate, already-existing action:
   ```
   POST /api/price-records/price_6980c523-856a-4621-ac51-404de322c96e/review
   { "decision": "Approve", "downstreamUse": "Costing",
     "reason": "<substantive reason>" }
   ```
   `validUntil` omitted ⇒ stays `NULL`; `validity_state` becomes the truthful `No Validity Provided`. **No date is invented.**

Both are existing governed surfaces; **no new engineering work is required.**

> **FX remains a separate open item** and is **not** part of Costing Authority for the record itself. Al Musa still has **0** FX rows, so USD→SAR conversion at pricing time remains blocked. That is the separate FX handoff (schema `valid_until NOT NULL` + `convertCurrency`) — **not opened here.**

---

## PROHIBITIONS OBSERVED

- ✅ **Policy semantics unchanged** — `VALID_UNTIL_SUPERSEDED` still relaxes only `valid_until` absent
- ✅ **No expired prices allowed** · **no malformed dates allowed**
- ✅ **Commercial date parser untouched** · **price eligibility semantics untouched**
- ✅ **IFP-2100HV not approved**, `downstream_use` unchanged, no pricing lines
- ✅ **No quotation revisions** · **no FX change**, no `EXCHANGE_RATE_VALIDITY_POLICY`, no `convertCurrency` change
- ✅ **No migration created or edited** — `drizzle/` 0 changed of 66
- ✅ **No Drawing/Technical/Matching logic touched**
- ✅ **No catalogue-wide approvals** — `Approved`+`Costing` count still 1
- ✅ **No live project data written** — `commercial_conditions` 0 rows; every write proven in-memory
- ✅ **No hand-rolled SQL outside the established persistence layer**
- ✅ **No commit / push / deploy / stash / reset / checkout / restore / clean**; `stash@{0}` untouched and not dropped; no unrelated files staged