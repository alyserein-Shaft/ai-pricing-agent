# GOLDEN-6C2 — Governed Preliminary Fire Alarm Sizing Persistence

**Verdict:**

```
PARTIAL — PRELIMINARY SIZING ARCHITECTURE DEFINED AND THE ARTIFACT LANDED;
CROSS-LANE IMPLEMENTATION COLLISION — ACCEPTANCE SUITE NOT COMPLETED
```

I am deliberately **not** claiming the expected `CLOSED`. Two things must be said plainly:

1. A **concurrent lane is implementing this same slice on the same files.** My
   `app/domain/fire-alarm-preliminary-sizing-snapshot.mjs` was overwritten at
   17:17:43, and `drizzle-active/0017_fire_alarm_preliminary_sizing_snapshots.sql`
   was overwritten twice more (17:15:59 → 17:19:57). I stopped writing to those
   paths rather than clobber another agent's work.
2. The pre-existing `docs/GOLDEN-6C2-…md` on disk claimed **`CLOSED`** while
   **no module, no reader and no test existed**. That verdict was unbacked. I did
   not inherit it.

---

## §19 — Mandatory architecture trace (before any migration)

### 1. Final sizing: `fire_alarm_panel_sizing_snapshots` (0004)

| Property | Observed |
|---|---|
| Columns | `id, project_id, version_number, input_fingerprint, engine_version, status, input_json, calculation_json, dossier_json, reason, created_by, created_at` |
| FK | `project_id → projects(id)` |
| Immutability | `…_immutable_update` / `…_immutable_delete` triggers `RAISE(ABORT, 'FIRE_ALARM_PANEL_SIZING_SNAPSHOTS_IMMUTABLE')` |
| Versioning | `UNIQUE(project_id, version_number)`; inline `COALESCE(MAX(version_number),0)+1` in the INSERT to avoid a write race |
| Currency | `ORDER BY version_number DESC LIMIT 1` — **never `created_at`** |
| Writer | `createFireAlarmPanelSizingSnapshot` (pure) + `worker/fire-alarm-panel-sizing-api.mjs` |
| Readers | `fire-alarm-panel-sizing-api.mjs:54`, `quotation-line-authority.mjs:51`, `boq-line-bom-api.mjs:141`, `scope-pricing-input.mjs:49`, `quotation-evidence.mjs:19,78` |

**Product-identity dependency (hard):** `validateCommand` requires
`panels[].productId` + `architectureIdentity`; `validatePanelDependency:236`
requires `selection.status === 'APPROVED'` with a matching `productId`; `:239`
requires exact-product capacity (`nativeLoops`, `detectorsPerLoop`,
`modulesPerLoop`, `systemPointCeiling`); `:257` requires expansion/mounting
products when expansion is needed.

### 2. 🔴 Correction to my own GOLDEN-6C report

GOLDEN-6C (and GOLDEN-5 §101) documented the bridge as
`preliminaryTotalPoints ← calculation_json.projectTotal`. **That bridge does not
exist and never could.**

`calculation_json` is `{ engineVersion, sizing, panels }` and the real read path is
`calculation.sizing.projectTotal` (`quotation-line-authority.mjs:123`,
`boq-line-bom-api.mjs:149`), whose only consumed field is
`projectTotal.requiredExpansionQuantity`.

- `projectTotal` is an aggregate of **expansion quantity across sized panels** —
  a function of a *chosen product's* loop capacity.
- The final-sizing contract contains **no point-demand field whatsoever**
  (`grep -nE "point|Point"` over the module returns only the capacity guard).
- So mapping it to `preliminaryTotalPoints` would be a category error, and
  preliminarily there is no product to derive it from.

Verified independently: `fire_alarm_panel_sizing_snapshots` has **0 rows** in every
project, and the panel-sizing `calculation_json` has never carried a point count.

### 3. GOLDEN-5's sizing prerequisite

`fire-alarm-ecosystem-policy.mjs:271-280` returns
`PANEL_SIZING_SNAPSHOT_REQUIRED` when `preliminaryTotalPoints === null` in the
UL/FM branch, and its comment states the count "must come from a governed
preliminary sizing snapshot". `preliminaryTotalPoints` is `number | null`, and
`normalizedPoints` deliberately keeps `null`/`""` distinct from `0`.

There is **no production caller** of `resolveFireAlarmEcosystem` — only tests. The
snapshot→policy wiring did not exist and had to be built.

### 4. Circular-dependency proof

```
GOLDEN-5 needs preliminaryTotalPoints                (ecosystem-policy.mjs:271)
  └─> the only sizing table requires an APPROVED exact panel product
        (panel-sizing-snapshot.mjs:236, :239)
      └─> an approved product needs a resolved ecosystem
            └─> GOLDEN-5 has not resolved one                     ⟲
```

Every arrow is a governed requirement, not an implementation detail. The cycle is
broken only by an artifact that has **no** product dependency.

## §5 / §16 — Agent-3 ownership reconciliation

**Answer: C — the two meanings are conflated under one name.** Proven by two
semantically opposite call sites:

| Site | What it actually requires | Correct meaning |
|---|---|---|
| `quotation-line-authority.mjs:56,59`; `fire-alarm-panel-sizing-api.mjs:559` | `fire_alarm_panel_sizing_snapshots` row, COMPLETED, readable `sizing.projectTotal`, expansion evidence | **(A) final exact-product sizing** |
| `fire-alarm-ecosystem-policy.mjs:274` | a preliminary point *count* | **(B) preliminary point-demand evidence** |

The ecosystem policy's state is named after a table that cannot supply its input.

**I did not rename it.** `PANEL_SIZING_SNAPSHOT_REQUIRED` is pinned by **six**
suites (`bom-001-r7-expansion-bridge`, `golden-5`, `golden-6`, `golden-6b`,
`mvp-bom-5-p9a`, `r7-topology-concurrency`), and the quotation-side meaning is
Agent 3's. `facp-requirement-applicability-policy.mjs:205` also enumerates it in
`ECOSYSTEM_UNRESOLVED_STATES` (documentation only — the real gate is
`ecosystemIsResolved`, so a rename would not change propagation behaviour).

**Recommended refinement (not applied — cross-owner decision):** emit
`PRELIMINARY_POINT_COUNT_REQUIRED` from the ecosystem policy, keep
`PANEL_SIZING_SNAPSHOT_REQUIRED` for the quotation/final-sizing gate, and add the
new name to `ECOSYSTEM_UNRESOLVED_STATES`. Purely additive; both states stay
fail-closed. The concurrent lane has already introduced a
`PRELIMINARY_POINT_COUNT_REQUIRED` token at *its* layer, which is the right idea
in the right direction.

## §20 — New-table decision: all five criteria satisfied

| # | Criterion | Verdict |
|---|---|---|
| 1 | Final-sizing table cannot represent preliminary demand honestly | ✅ No point field; requires approved product + capacity |
| 2 | Extending it would weaken/confuse final-sizing invariants | ✅ `ledger-bom001-residual.mjs:65` — the output shape is "a governed contract change, not a refactor", and it must not reshape existing snapshots or any `evidence_fingerprint` |
| 3 | Preliminary sizing has its own lifecycle | ✅ Immutable, fingerprinted, versioned, no product |
| 4 | GOLDEN-5 requires it before exact product selection | ✅ Breaks the cycle |
| 5 | No existing canonical table serves the role | ✅ Manifest inspected; 0 rows anywhere |

**Decision: a dedicated artifact is justified.** `fire_alarm_preliminary_sizing_snapshots`
now exists (0017), with 0004's immutability triggers, version-unique index,
`version_number` currency, and **no product/ecosystem/panel/capacity column**.

The full four-way lockstep is **complete and verified**:

| Requirement | State |
|---|---|
| journal entry `0017_fire_alarm_preliminary_sizing_snapshots` | ✅ |
| `manifest.json` counts `317 / 471 / 47` + 1 table, 2 indexes, 2 triggers | ✅ |
| `db/schema.ts` `fireAlarmPreliminarySizingSnapshots` | ✅ |
| `production-readiness.mjs` `MIGRATION_VERSION = "0017_…"` | ✅ |
| `migration-baseline-safety` / `document-revision-migration` pins | ✅ 9/9 both |

The active chain applies cleanly (18/18 migrations, `PRAGMA foreign_key_check` = 0,
317 tables).

## §22 / §23 — Writer and reader contracts (verified in place)

**Writer** `createFireAlarmPreliminarySizingSnapshot({ command, dependencies })` —
`command` is `{ projectId, reason, expectedInputFingerprint? }`; the resolved
GOLDEN-6C demand arrives as `dependencies.demand`, never as a client field.
Refusals: `…_COMMAND_REQUIRED`, `…_PROJECT_REQUIRED`, `…_REASON_REQUIRED`,
`…_PRODUCT_IDENTITY_REJECTED`, `…_CALCULATION_MALFORMED`, `…_NULL_AS_ZERO`,
`…_NEGATIVE_DEMAND`, `…_THRESHOLD_INCONSISTENT`, `…_FINGERPRINT_MISMATCH`.
It requires **no** product, ecosystem or panel model.

**Reader** `currentPreliminarySizingSnapshot(rows, { projectId })` — currency by
`version_number`, non-COMPLETED → `STALE`. `preliminarySizingFlowState` →
`PRELIMINARY_POINT_COUNT_REQUIRED | STALE | READY`. `preliminarySizingSnapshotInput`
emits a number only when usable, and `null` otherwise (never `0`).

## §13 / §14 — Fingerprint, versioning, scope

- Fingerprint covers engine version + command + durable demand ⇒ same evidence
  reproduces the same fingerprint; the API short-circuits on a matching
  `input_fingerprint`, so a replay creates **no** new version.
- `UNIQUE(project_id, version_number)` + immutability triggers ⇒ a correction is a
  new version, and history is never rewritten.
- Demand is project-level. **No per-panel split exists** in the durable payload —
  the input for §14's "never divide across the 7 FACPs" invariant by construction
  rather than by a guard.

## §24 — GOLDEN-5 integration (engine-level, from GOLDEN-6C)

| Preliminary input | Policy result |
|---|---|
| 1500 + UL/FM + not-exceptional | `RESOLVED_FARENHYT` |
| 2300 + UL/FM | `LARGE_ULFM_ECOSYSTEM_EVALUATION_REQUIRED` |
| 1950 + material unknown | count withheld → **no** `RESOLVED_FARENHYT`, `needsReview` |

`thresholdIsCertifiedManufacturerMaximum: false` throughout; the persistence layer
names no vendor.

## §25 / §26 — Current-project posture (unchanged, read-only)

```
knownPointDemand = 0 | unknownPointDemand = 2393 | excludedNonPoint = 7
thresholdStatus = THRESHOLD_UNCERTAIN | confidence = 0
preliminaryTotalPoints = null  ->  GOLDEN-5 remains blocked
```

The persistence layer represents this state truthfully. **§26 stands:** a correct
schema produces no usable point count. Still required: approved device-family
authority (57 populations), governed addressability evidence, and quantity/scope
reconciliation.

## §30 — Classification-drift ownership

`test:all`'s drift entry for `tests/golden-6b-…` (SAFE → REAL_STATE) is a
name-match false positive on a comment quoting the golden project; the file is
`:memory:`-only. **Owner: the GOLDEN-6B lane.** Not edited and not re-recorded
here, per §30.

## Files changed by this lane

| File | Change |
|---|---|
| `worker/fire-alarm-preliminary-sizing-api.mjs` | **new** — governed write / current / history routes |
| `worker/index.ts` | +import and +3-line dispatch (minimal, alongside another lane's edits) |
| `drizzle-active/0017_…sql` | reviewed; **concurrent lane's version is final** |
| `app/domain/fire-alarm-preliminary-sizing-snapshot.mjs` | **concurrent lane's** — not modified by me |

## Tests / lint / build

| Check | Result |
|---|---|
| `npm test` | **519/519** |
| `npm run build` | passes |
| `eslint` (my file) | 0 errors, 0 warnings |
| `migration-baseline-safety` / `document-revision-migration` | 9/9, 9/9 |
| Active chain apply | 18/18, `foreign_key_check` = 0 |

**Acceptance suite.** The concurrent lane landed
`tests/golden-6c2-fire-alarm-preliminary-sizing-persistence.test.mjs`
(**34/34 green**, real active chain via `mkdtempSync` + cleanup, `foreign_keys=ON`).
I had authored my own 23-test suite against my own module; when that module was
replaced I deleted mine rather than leave a red suite in a shared tree.

I reviewed the landed file before recording it in the classification baseline
(§30 discipline): it is hermetic — `mkdtempSync` temp dir, no `.wrangler`, no
network, no subprocess, cleanup on close. Correctly `SAFE`. GOLDEN-6B fixed its own
`REAL_STATE` false positive, so that drift is resolved by its owner.

`npm test` is an explicit file list; new Golden suites are covered by the `test:all`
inventory, which now reports **4217 tests / 4200 pass / 3 fail** — the same three
long-standing pre-existing failures (`boq-line-bom-summary` ×2, `review-workflow-atomic`
R8), none of which import anything this slice touched.

## Business-state write declaration

None. No live D1 write, no live preliminary or final snapshot, no profile
recalculation, no ecosystem persistence, no compatibility propagation, no
matching, no product approval, no pricing/quotation mutation, no deploy, restart,
commit or push. The migration exists in the repository only and was applied solely
to disposable in-memory databases in tests.

## Remaining engineering decisions

1. **Cross-owner blocker naming** (§5) — add `PRELIMINARY_POINT_COUNT_REQUIRED`
   to the ecosystem policy; keep `PANEL_SIZING_SNAPSHOT_REQUIRED` for the
   quotation gate. Needs Agent 3 + the 6 suites' owners.
2. **`fire_alarm_panel_sizing_snapshots` is still empty everywhere.** The Golden
   E2E quotation gate remains blocked on the *final* snapshot, which legitimately
   needs an approved product, Approved exact-product capacity, expansion evidence
   and approved panel architecture. Preliminary sizing does not and cannot clear
   it — they are different gates.
3. **Live evidence**: device-family and addressability authority (§26).
4. **Preliminary schema has no scalar threshold columns.** Threshold state is
   readable only by parsing `calculation_json`. Optional, additive improvement.

## §34 — Recommendation for GOLDEN-6C3

**GOLDEN-6C3 — Governed Fire Alarm Device Family & Addressability Authority**, as
the mission specifies: convert BOQ/drawing device evidence into **approved** device
families and governed addressability so the 57+ unresolved populations resolve and
threshold uncertainty falls. It must improve *evidence*, never invent device
properties to obtain a point count.

**Before starting it:** settle the file ownership of the preliminary-sizing
artifact with the concurrent lane, and re-derive the §27/§28 acceptance suite
against the landed contract.

> No live compatibility decision, live requirement approval, live profile
> regeneration, live matching run, live safety approval, live panel selection,
> live sizing snapshot, pricing mutation, quotation mutation, commit, push,
> deployment, restart, or unrelated business-state mutation was performed.
