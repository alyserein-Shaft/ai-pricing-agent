# GOLDEN-6C — Governed Fire Alarm Preliminary Point Count & Sizing Input

## 1. Executive verdict

```
PARTIAL — GOVERNED PRELIMINARY POINT-DEMAND ENGINE PROVEN AND GREEN;
PERSISTENCE STEP BLOCKED BY FINAL-SIZING SCHEMA INCOMPATIBILITY
```

Two things are true at once, and the distinction matters:

🟢 **The engine is real, green and reusable.** A governed preliminary point-demand
pipeline exists as a pure domain module, it reuses the canonical point-consumption
classifier rather than inventing a second taxonomy, and all 32 tests pass — covering
every acceptance scenario in §31 and every mandatory negative assertion in §32.

🔴 **The slice cannot close.** §18/§19 require a persisted, versioned preliminary
sizing snapshot. The only canonical sizing table in the repository is
**semantically incompatible with preliminary demand**, and the incompatibility is
*circular*, not merely inconvenient. Per §37 ("Do not force preliminary data into a
semantically incompatible final-sizing schema") the correct action is to report the
gap, not to bend the schema. Building the required table is a migration, and it is the
next slice, not this one.

🟡 **The live acceptance project cannot yet produce a usable point count** — and this
is the most important engineering finding in the slice. Measured, not assumed: see §13.

---

## 2. Trace of the existing sizing-snapshot architecture (§18, §37)

### 2.1 The existing table is FINAL sizing, and it is provably unusable here

`fire_alarm_panel_sizing_snapshots` (drizzle-active/0004) is immutability-hardened
(`..._immutable_update` / `..._immutable_delete` triggers raise `ABORT`), versioned per
project, and fingerprinted on `input_fingerprint`. Those are exactly the properties
§19/§20 want. But its writer is `createFireAlarmPanelSizingSnapshot`, and reading the
command validator plus `validatePanelDependency` proves it is a **final** sizing engine:

| Required input | Source | Why preliminary demand cannot supply it |
|---|---|---|
| `command.panels[].productId` | `validateCommand` | a **selected product identity** |
| `dependency.selection.status === 'APPROVED'` + matching `productId` | `validatePanelDependency:236` | an **approved primary panel selection** |
| `nativeLoops`, `detectorsPerLoop`, `modulesPerLoop`, `systemPointCeiling` | `:239` | **exact-product** capacity evidence |
| `loopExpansionUnit` / `mountingUnit` | `:257` | expansion hardware for a chosen panel |
| `command.allocations[]` per panel | `validateCommand:106` | **per-panel** demand allocation |

It then runs `assessExpansionNeed`, `calculateSlcExpansion` and `sizeProjectSlcPanels`
— i.e. exact loop counts, expansion modules and panel quantities. That is §16/§17 work
this slice is explicitly forbidden from doing.

### 2.2 The incompatibility is circular, not just inconvenient

GOLDEN-5's policy (`fire-alarm-ecosystem-policy.mjs`) returns
`PANEL_SIZING_SNAPSHOT_REQUIRED` until `preliminaryTotalPoints` is supplied, and its
comment states the count "must come from a governed preliminary sizing snapshot".

But the only table that can hold a sizing snapshot requires an **APPROVED product
selection** — and approving a product selection requires a resolved **ecosystem**,
which is what GOLDEN-5's policy is waiting for. So:

```
GOLDEN-5 needs a preliminary point count
        ↓
the only sizing table needs an approved product selection
        ↓
an approved product selection needs a resolved ecosystem
        ↓
GOLDEN-5 has not resolved one   ⟲
```

Writing preliminary demand into that table would require fabricating a panel model
and an approved selection — a direct violation of §16, §38 and §41, and precisely the
circular shortcut the governance model exists to prevent.

### 2.3 What actually exists, and is genuinely reusable

| Capability | Canonical module | Status |
|---|---|---|
| SLC point-consumption classification | `fire-alarm-slc-resource-classifier.mjs` | **Exists, fail-closed, reused as-is** |
| Per-panel demand shaping | `fire-alarm-panel-demand-allocation.mjs` | Exists (final sizing; not used here) |
| Capacity / expansion | `fire-alarm-slc-capacity-calculator.mjs` | Exists (downstream, out of scope) |
| Exact panel sizing | `fire-alarm-panel-sizing-snapshot.mjs` | Exists (final; **inapplicable**) |
| Ecosystem policy (GOLDEN-5) | `fire-alarm-ecosystem-policy.mjs` | Exists; **no production caller** |
| Device quantity authority | `drawing-printed-quantity-contract.mjs` | Exists (`QUANTITY_AUTHORITIES: PRINTED_DRAWING\|NONE`) |
| BOQ↔drawing reconciliation | `drawing-quantity-evidence-engine.mjs` | Exists (`compareDrawingEvidenceToBoq`) |

**Reuse is the reason this slice is small.** GOLDEN-6C adds no taxonomy, no
units-per-device rule and no conflict policy of its own.

### 2.4 A hard constraint the mission did not anticipate (DRAW-QTY-1)

`drawing-quantity-evidence-engine.mjs:74-84` states that an approved drawing occurrence
count is a **recognition metric, never a device quantity** — on the one reviewed
fire-alarm riser (WLC T-93) 27 approved occurrences correspond to a printed **248**
devices, roughly a 9× understatement. So §11's dedup must run over
`drawing-printed-quantity-contract` device quantities, never over occurrence counts.
Any future implementation that sums `approvedOccurrenceCount` into point demand
reintroduces a defect that was already found, documented and fenced.

---

## 3. Device point-demand taxonomy (§5, §40.2)

§5 permits reusing equivalent classifications, and equivalent ones exist. The canonical
classifier's four states map onto the requested classes:

| Canonical state | Requested class | Point contribution |
|---|---|---|
| `SLC_DETECTOR_POOL` | `ADDRESSABLE_DETECTOR_POINT` | governed units-per-device (1, with addressable evidence) |
| `SLC_MODULE_POOL` | `ADDRESSABLE_MODULE_POINT` | governed units-per-device (1, with addressable evidence) |
| `NOT_SLC` | `NON_ADDRESSABLE_EQUIPMENT` | **0**, and reported as complexity evidence |
| `UNRESOLVED` | `UNKNOWN_NEEDS_REVIEW` | **null → unknown demand** |

The finer requested distinctions (`INPUT_`/`OUTPUT_`/`COMBINED_` module, `NETWORK_NODE`,
`PANEL_EQUIPMENT`, …) are **not** invented here: the repository has no governed
sub-kind contract for them, and manufacturing one would create a second, divergent
taxonomy. The canonical classifier already refuses notification appliances
(`Horn`, `Strobe`, `Sounder`, `Speaker`, `Bell`) as SLC points, which satisfies §8.

## 4. Quantity authority rules (§10, §40.3)

`reconcilePopulation` is authority-first, arithmetic-second:

1. An explicit `governingAuthority` resolves the population even when other sources
   disagree — the **authority model** decides, and the disagreeing values are retained
   as non-governing evidence (never deleted).
2. Without a governing authority, unanimous sources are `QUANTITY_CONFIRMED`.
3. Disagreement with no authority is `QUANTITY_CONFLICT` with `quantity: null`.
4. No numeric quantity at all is `QUANTITY_UNKNOWN` with `quantity: null`.

A missing quantity is filtered **before** any arithmetic, so it can never be coerced to
zero. (This was a real bug caught during implementation — see §10.2.)

## 5. Deduplication and reconciliation (§11, §12, §40.4)

Dedup is by **governed population identity** (`populationId`) plus the scope tuple
`(project, building, fireAlarmSystem, panel)`. Two records with the same identity and
agreeing sources are one population. Two records with near-identical descriptions but
**different** governed identities are two populations and are both counted — proven by
test 32.10. Text similarity is never a merge key.

Outcomes: `QUANTITY_CONFIRMED` · `QUANTITY_RECONCILED` · `QUANTITY_CONFLICT` ·
`QUANTITY_INCOMPLETE` · `QUANTITY_UNKNOWN`.

## 6. Point-consumption logic (§6, §7, §40.5)

Delegated entirely to `classifyFireAlarmSlcItem`. It already refuses one-point
assumptions in exactly the cases the mission names:

- multi-address / multi-channel evidence (`point_count > 1`, `channel_count > 1`,
  `slc_addressing: multi-address`) → `UNRESOLVED`, not 1 point;
- a detector or module family **without** governed `addressing: addressable` evidence
  → `UNRESOLVED`;
- `CONFLICT` quantity → `UNRESOLVED`.

`resolveSlcDemandQuantity` returns `total: null` on any unknown, so *unknown ≠ 0* is
enforced by the canonical code, not by this slice.

## 7. Known vs unknown demand (§14, §40.6)

`knownPointDemand` and `unknownPointDemand` are separate accumulators and are never
summed into one "total". Critically, equipment **resolved** as non-point
(FACP, battery, PSU, accessories) settles at **0/0** — counting it as unknown would
manufacture phantom unresolved demand and could fake a threshold uncertainty the
evidence does not support. Only genuinely `UNRESOLVED` populations contribute to
`unknownPointDemand`.

## 8. Threshold-risk logic (§15, §40.7)

Threshold is imported from the single canonical constant
(`FARENHYT_PRELIMINARY_POINT_THRESHOLD = 2000`) so the two cannot drift.
`thresholdIsCertifiedManufacturerMaximum: false` is carried on every result.

| Condition | `thresholdStatus` |
|---|---|
| `known > 2000` | `ABOVE_THRESHOLD_CONFIRMED` — **proven**; unknown demand can never retract a proof |
| `known + unknown > 2000` | `THRESHOLD_UNCERTAIN` |
| `known === 0` | `THRESHOLD_UNCERTAIN` — see below |
| otherwise | `WITHIN_THRESHOLD_CONFIRMED` |

**`known === 0` → UNCERTAIN** is a correctness fix found by the live dry run. An empty
or unexamined inventory previously reported `WITHIN_THRESHOLD_CONFIRMED`, which is
indistinguishable from a genuinely small system and would have let GOLDEN-5 resolve an
ecosystem for a project that was never sized. Regression-locked by test 31.22.

## 9. Implementation modules (§40.8)

`app/domain/fire-alarm-preliminary-point-demand.mjs` (new, pure, no I/O):

| Export | Role |
|---|---|
| `buildDeviceInventoryRecord` | §4 lineage-preserving inventory record |
| `reconcilePopulation` | §12 authority-first cross-source reconciliation |
| `classifyDevicePointDemand` | §5–§9 projection of the canonical classifier |
| `aggregatePreliminaryPointDemand` | §13/§14/§15/§21/§22/§26 aggregation |
| `preliminarySizingInput` | §23 GOLDEN-5 adapter |

Inventory records carry `addressability` and `attributes` **without defaults**:
addressability is never assumed, and the live project has none (§13).

## 10. Tests (§40.9, §40.10, §40.11)

`tests/golden-6c-preliminary-point-demand.test.mjs` — **32/32**.

All 21 §31 acceptance scenarios are covered individually, plus 11 §32 negative
assertions. Three assertions deserve naming because they are the mission's real teeth:

- **32.2** multi-address evidence never collapses to one point per device;
- **32.3 / 31.12** unknown quantity is 63, not 0 — unknown is never dropped;
- **32.9** the module's *executable code* (comments stripped) contains no
  `Farenhyt`/`Gamewell`/`Simplex`/`Gent`/`Honeywell`/`Notifier`, no `UL/FM`/`EN54`, no
  loop or expansion logic, and no spare-capacity computation.

### 10.1 Regressions

| Suite | Result |
|---|---|
| `golden-6c-preliminary-point-demand` (new) | **32/32** |
| `golden-5-fire-alarm-ecosystem-policy` | 18/18 |
| `golden-6-facp-requirement-linkage` | 18/18 |
| `golden-6b-fire-alarm-compliance-evidence` | 19/19 |
| `golden-2` / `golden-3` / `golden-4` | 22/22, 24/24, 11/11 |
| `fire-alarm-taxonomy-integration` | 40/40 |
| `task9-fire-alarm-library` | 37/37 |
| `npm test` | **519/519** |
| `npm run build` | passes |
| `eslint` (both new files) | 0 errors, 0 warnings |

### 10.2 Bugs the tests caught during implementation (honest record)

1. **NOT_SLC equipment leaked into `unknownPointDemand`.** FACP/PSU/battery were being
   counted as unresolved demand, which would have manufactured threshold uncertainty.
2. **`null` quantity coerced to `0`.** `nonNegative(numeric(x))` turned a missing
   quantity into a zero population — a direct violation of *unknown ≠ 0*. Now filtered
   before arithmetic.
3. **Missing-scope completeness was row-wise**, so a known-but-unevidenced building
   (Welcome Center) never registered as incomplete. Now a set comparison, and the
   missing scopes are reported.
4. **`known === 0` reported `WITHIN_THRESHOLD_CONFIRMED`** (see §8).

### 10.3 Known pre-existing failures (unchanged, unrelated)

`boq-line-bom-summary` 0/2 and `review-workflow-atomic` R8 27/1 — re-measured
identically to the earlier baseline, and neither file imports anything this slice
touched.

### 10.4 ⚠️ `test:all` drift gate is red — not caused by this slice, not re-recorded

```
+ tests/golden-6b-fire-alarm-compliance-evidence.test.mjs|REAL_STATE
- tests/golden-6b-fire-alarm-compliance-evidence.test.mjs|SAFE
```

`golden-6b` is a **concurrent lane's** file. It is `:memory:`-only (line 135); the
classifier's `REAL_STATE` regex matches the literal string *"Al Mousa School Clean
Golden Run D1"* in a comment on line 85 — a comment that explicitly says the real rows
are **not** used. So this is a **name-match false positive**, identical in kind to the
one corrected in GOLDEN-4.

It was deliberately **not** fixed here: editing another lane's file, or recording it
`REAL_STATE` (which would silently exclude a safe test from `test:all`), would both be
wrong. **Owner: the 6B lane** — either reword the comment or record it. This slice's own
file classifies `SAFE`, correctly.

## 11. GOLDEN-5 integration proof (§40.12)

`preliminarySizingInput` emits the policy input and nothing else. Proven against the
real policy:

- known 1500 + `UL/FM` + `not-exceptional` → policy receives **1500** and resolves
  `RESOLVED_FARENHYT`; `thresholdIsCertifiedMaximum: false` (test 31.19);
- known 1950 + material unknown → adapter emits `preliminaryTotalPoints: null`, the
  policy receives `null`, and `RESOLVED_FARENHYT` is **unreachable** (test 31.20);
- 2200 + unknown 100 → `ABOVE_THRESHOLD_CONFIRMED`; the 100 is reported separately and
  never folded into the total (test 31.14).

No ecosystem, manufacturer, FACP model, loop count or topology is produced here
(test 32.9). **Compliance independence (§25)** holds: the module contains no
compliance-regime logic, and a result serialises with no UL/FM or EN54 content
(test 31.18).

## 12. Existing sizing prerequisite integration proof (§40.13)

`PANEL_SIZING_SNAPSHOT_REQUIRED` remains correct and is **not** weakened. While no
governed point count exists, the policy returns exactly that state. Note it now has two
distinguishable causes — *no sizing evidence at all* versus *sizing evidence whose
threshold is uncertain*. **The policy signature cannot express the difference** (§15.4).

🟡 **Reported gap, not fixed:** `resolveFireAlarmEcosystem` takes
`preliminaryTotalPoints: number | null`. A threshold-uncertain sizing result is
therefore indistinguishable from a project that was never sized. Both surface as
`PANEL_SIZING_SNAPSHOT_REQUIRED`. The adapter mitigates this by withholding the number
so GOLDEN-5 **fails closed**; it cannot, and should not, disambiguate the policy's
reason string. Widening the policy is GOLDEN-5's call, not this slice's.

## 13. Read-only current-project device inventory (§40.14)

Acceptance project `project_c0123d91-…`, read-only via `mode=ro` against the live D1
(never copying the main file alone). `fire_alarm_panel_sizing_snapshots` = **0 rows**,
confirming GOLDEN-5's claim.

**80** Fire Alarm BOQ items with `approved_for_downstream=1` (`row_type='BOQ Item'`),
raw BOQ quantity sum **2,400**. Only **23** APPROVED canonical interpretations exist
project-wide; the rest are `origin: INFERRED, confidence 70`. Only **1** BOQ item in
the whole project has a Confirmed requirement link.

Measured classification through the real pipeline:

| Outcome | Populations |
|---|---|
| Resolved point consumer | **0** |
| `UNRESOLVED` → unknown demand | **73** (2,393 units) |
| `NOT_SLC` → excluded equipment | **7** |

Blocking reasons, verbatim from the canonical classifier:

| Count | Reason |
|---|---|
| 57 | "Governed Fire Alarm system and family are required." |
| 15 | "The current detector/module SLC calculator cannot safely represent this family or its address behavior." |
| 7 | "Family is a capacity provider, accessory, conventional device, or non-SLC equipment…" |
| 1 | "Detector family requires governed addressable evidence." |

**No building scope is recoverable** — `boq_items` carries no building column and the
BOQ sections repeat per building, so scope totals collapse to project level. This is a
genuine evidence gap, not a code limitation, and it is reported rather than papered over.

## 14. Current-project preliminary sizing verdict (§40.15)

```
Preliminary Point Count State:   INSUFFICIENT  /  THRESHOLD_UNCERTAIN

Known Point Demand:               0
Unknown / unresolved:             2,393 devices across 73 populations
Excluded non-point equipment:     7 populations
Threshold Status:                 THRESHOLD_UNCERTAIN
Confidence:                       0  (classified coverage 0.0875)

preliminaryTotalPoints:           null
GOLDEN-5 sizing input usable?     NO

Reason:
No governed device classification exists. 57 of 80 populations have no approved
device family, and the one population whose family IS approved still lacks governed
addressable evidence. Unresolved demand of 2,393 could cross the 2,000-point
threshold in either direction, so no point count can be published.
```

This is the honest state, and it is **not** a coding defect. The pipeline works; the
governed *evidence* does not exist yet.

## 15. Complexity evidence inventory (§40.16)

Observed and preserved, never acted on: **7** non-SLC equipment populations (multiple
FACP entries across repeating BOQ sections — consistent with main + distributed panels
and a Welcome Center). `complexityEvidence.decision` is `null` and
`decidedByThisStage: false`; the module exposes no API that could set one (test 31.21).
That remains GOLDEN-6D's governed output.

## 16. Files changed (§40.17)

| File | Change |
|---|---|
| `app/domain/fire-alarm-preliminary-point-demand.mjs` | **new** — pure domain pipeline |
| `tests/golden-6c-preliminary-point-demand.test.mjs` | **new** — 32 tests |

**No production file, schema, migration, route or existing module was modified.** No
existing canonical contract was widened or redefined.

## 17. Business-state write declaration (§40.18)

None. Live D1 was opened **read-only** (`mode=ro`). No live sizing snapshot, no profile
recalculation, no ecosystem decision, no compatibility propagation, no matching, no
pricing or quotation mutation, no migration, no commit, push, deploy or restart.

## 18. Remaining engineering decisions (§40.19)

1. **Device-family authority (dominant blocker).** 57 populations need an APPROVED
   family and 15 more need a resolvable addressability contract. Nothing downstream can
   advance without this.
2. **Addressability evidence.** Even approved families (`Addressable Heat Detector`)
   fail without governed `addressing: addressable`. This is a separate evidence gap
   from family identity.
3. **Building scope.** No BOQ building column exists; per-building demand needs a
   governed building/scope source.
4. **Preliminary snapshot storage.** Needs its own table (see §19).
5. **Notification-appliance resolution.** 149+ loop-powered strobes/sounders stay
   unresolved until a NAC-vs-loop determination is governed.
6. **GOLDEN-5 threshold-uncertainty signal** (§12).
7. **GOLDEN-6B** compliance regime remains unresolved — correctly, and independently.

## 19. Recommended next slice (§40.20)

**GOLDEN-6C2 — Persist the preliminary sizing snapshot (migration `0017`).**

A new immutable, versioned table for *preliminary* demand only, mirroring 0004's
immutability triggers and fingerprint discipline, storing
`known_point_demand`, `unknown_point_demand`, `threshold_status`, `completeness`,
`confidence`, `scope_totals`, `evidence_references`, `calculation_version` and
`input_fingerprint`, plus the §35 lifecycle (new snapshot on changed evidence, prior
retained) and §36 idempotency.

It must be a **separate** table, not a widened 0004. A migration here requires moving
**four** things in lockstep — journal entry (`version`/`breakpoints`),
`manifest.json` (counts + table/index/trigger entries + `cutoffMigration`),
`db/schema.ts`, and `app/domain/production-readiness.mjs` `MIGRATION_VERSION` — plus
the literal count pins in `tests/migration-baseline-safety.test.mjs` and
`tests/document-revision-migration.test.mjs`. In a tree with ~798 dirty files and
concurrent lanes, that coordination is its own slice.

**Two coordination items to settle first:**
- 🔴 **Agent 3 owns `PANEL_SIZING_SNAPSHOT_REQUIRED`** — the adjacent state. Confirm
  ownership of preliminary-snapshot storage before adding a second sizing table.
- 🟡 **The 6B lane owns the `test:all` drift** (§10.4).

After 6C2, the recommended order is unchanged from the mission: resolve device-family
and addressability authority so a real point count can exist, then **GOLDEN-6D**
(complexity resolver), then feed
`Compliance Regime + Preliminary Total Points + Complexity` to GOLDEN-5.
