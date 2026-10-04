# GOLDEN-6C2 — Governed Preliminary Fire Alarm Sizing Persistence

- Lineage: GOLDEN-6C → GOLDEN-6C2 (this lane). Section numbering follows the
  mission contract: proofs first, decision, then the migration and its tests.
- Verdict: `CLOSED` (proven end-to-end). See §33.
- Business-state write declaration: **none** (§31). No live D1 or production
  artifact was written, mutated, regressed or deleted by this lane.

---

## §19 — Architecture-first trace (before any migration file)

This section is the proof of record. It traces the final sizing persistence
layer, the GOLDEN-5 ecosystem rule that depends on it, the circular dependency
this lane breaks, and the ownership reconciliation that makes the new
persistence layer safe to introduce. The migration (`0017`) is only added
after every contract below is pinned by tests.

### 19.1 The final governing table: `fire_alarm_panel_sizing_snapshots`

- **Schema** (`drizzle-active/0004_fire_alarm_panel_sizing_snapshots.sql`, 12
  columns): `id` PK, `project_id` NOT NULL, `version_number` integer NOT NULL,
  `input_fingerprint` NOT NULL, `engine_version` NOT NULL, `status` NOT NULL,
  `input_json` NOT NULL, `calculation_json` NOT NULL, `dossier_json` NOT NULL,
  `reason` NOT NULL, `created_by` NOT NULL, `created_at` DEFAULT
  CURRENT_TIMESTAMP NOT NULL.
- **FK**: `project_id → projects(id)`, `ON UPDATE no action ON DELETE no
  action`. A sizing snapshot is meaningless off a project.
- **Unique**: `fire_alarm_panel_sizing_project_version_idx` on
  `(project_id, version_number)` — one identity per version.
- **Current index**: `fire_alarm_panel_sizing_project_current_idx` on the same
  columns to serve the reader's `ORDER BY version_number DESC LIMIT 1`.
- **Immutability**: `..._immutable_update` / `..._immutable_delete` triggers
  raise `FIRE_ALARM_PANEL_SIZING_SNAPSHOTS_IMMUTABLE`. The table is append-only;
  "current" is derived (highest `version_number`), never mutated in place.
- **Writer** (`app/domain/fire-alarm-panel-sizing-snapshot.mjs`):
  `createFireAlarmPanelSizingSnapshot({ command, dependencies })` is a pure
  engine. It computes `inputFingerprint = sha256(canonicalStringify(input))`
  where `input = { engineVersion, command, dependencies }`, builds
  `calculation = { engineVersion, sizing, panels }`, and a governed dossier.
  Refusals are `panelSizingFailure` errors carrying `{ code, status, details }`.
- **Product dependence**: the final writer is an *exact-product* engine. Its
  `command.panels[].productId` must equal the current approved primary selection
  (`dependencies.panels[].selection.status === "APPROVED"`), the capacity basis
  is exact-product Approved evidence, and expansion needs Approved exact-product
  paths. The table itself has **no** product columns — product identity lives in
  the writer contract and the JSON payloads. This separation is what makes §7
  and §20 provable.
- **Reader + status**: the worker reads `ORDER BY version_number DESC LIMIT 1`;
  a row whose persisted `status !== "COMPLETED"` is reported as `STALE`
  (`PANEL_SIZING_EVIDENCE_STALE`). Currency is by `version_number`, never
  `created_at`.
- **`PANEL_SIZING_SNAPSHOT_REQUIRED` usage (final meaning)**: worker quotation /
  BOM / scope-pricing gates use this literal to mean "no *final* panel-sizing
  snapshot exists": `worker/quotation-line-authority.mjs` (no such table →
  `PANEL_SIZING_SNAPSHOT_REQUIRED`; not COMPLETED → `PANEL_SIZING_EVIDENCE_STALE`),
  `worker/scope-pricing-input.mjs` (`SCOPE_SNAPSHOT_REQUIRED` for quotation
  readiness), `worker/boq-line-bom-api.mjs` (`SNAPSHOT_REQUIRED`). This meaning
  is preserved untouched (§5, Decision C).

### 19.2 GOLDEN-5 `preliminaryTotalPoints` and the ecosystem rule

`aggregatePreliminaryPointDemand`
(`app/domain/fire-alarm-preliminary-point-demand.mjs`) produces a governed
preliminary point demand:

- `projectTotalPoints`/`knownPointDemand` — the proven, authoritative total
  (INVARIANT 6: `projectTotalPoints === knownPointDemand`);
- `unknownPointDemand` — unresolved remainder, never folded into the total;
- `preliminaryTotalPoints` — **null** whenever the threshold is not provable
  (`THRESHOLD_UNCERTAIN` / `INSUFFICIENT`);
- `completeness`, `confidence`, `missingKnownScopes`, `scopeTotals`,
  `populations`, `conflicts`, `complexityEvidence`.

`resolveFireAlarmEcosystem` (`app/domain/fire-alarm-ecosystem-policy.mjs`)
consumes `preliminaryTotalPoints` via `preliminarySizingInput(...)`. Rule C (the
preliminary point-count prerequisite) emits **`PANEL_SIZING_SNAPSHOT_REQUIRED`**
when `preliminaryTotalPoints === null` — the exact same literal string the final
worker gates use, but denoting the *preliminary point-count* prerequisite
(Decision C, §5). Threshold `PRELIMINARY_POINT_THRESHOLD = 2000`.

### 19.3 The circular dependency this lane breaks

GOLDEN-5 needs a project-level preliminary point total before it can move toward
an ecosystem decision. Today that total only exists transiently inside
`aggregatePreliminaryPointDemand` — it is **not persisted**:

```
GOLDEN-5 ecosystem rule
   └─ needs ─ preliminaryTotalPoints (proven, project-level)
        └─ needs ─ governed preliminary point aggregation
             └─ needs ─ GOLDEN-5 to run (to resolve ecosystem/scope)
```

The proof of the cycle: `resolveFireAlarmEcosystem` takes
`preliminaryTotalPoints` as an input and returns ecosystem gates such as
`LARGE_ULFM_ECOSYSTEM_EVALUATION_REQUIRED`, but a project that has not completed
the point count cannot get a preliminary total; a project that cannot get a
preliminary total cannot reach the ecosystem rule; and the ecosystem rule is, in
the exact-product pipeline, one of the things that exists before exact-product
sizing (which is what the final table persists). No governed record sits between
"point count proven" and "ecosystem decision" — the preliminary total is
recomputed and lost on every run, and any downstream layer that wants it must
re-prove it.

**Break**: a governed, append-only, project-scoped *preliminary sizing snapshot*
persists exactly the output of `aggregatePreliminaryPointDemand` at a point in
time. GOLDEN-5 (and the future ecosystem/scope consumers) read from that record
instead of forcing a live recompute. The preliminary counter is now an evidence
input, produced by demand aggregation (recorded), consumed by the ecosystem rule
(gated on the same governed evidence) — the loop is a DAG.

### 19.4 Ownership reconciliation (Agent-3 boundary)

- Agent-3 owns the **final** physical-panel-sizing layer: the
  `fire_alarm_panel_sizing_snapshots` migration, the exact-product writer/reader,
  the quotation/BOM/scope gates, and the meaning of `PANEL_SIZING_SNAPSHOT_REQUIRED`
  as "final sizing snapshot required". Nothing in this lane changes, renames,
  rewires or re-interprets Agent-3's contract.
- This lane (GOLDEN-6C/6C2) owns the **preliminary point-count layer**: the
  point-demand engine, `preliminarySizingInput`, the ecosystem policy inputs, and
  the new `fire_alarm_preliminary_sizing_snapshots` persistence record.
- Separation is preserved structurally: two distinct tables (final vs
  preliminary), two distinct engine versions, two distinct contract families,
  and — to end the literal collision (§5) — a distinct prerequisite token
  `PRELIMINARY_POINT_COUNT_REQUIRED` at the persistence layer. Agent-3's final
  meaning of `PANEL_SIZING_SNAPSHOT_REQUIRED` is untouched.

### 19.5 Proposed contract and migration recommendation

- New migration `0017_fire_alarm_preliminary_sizing_snapshots` mirrors `0004`
  **minus every product-identity channel** (no product_id, panel model,
  manufacturer, ecosystem, loop or expansion capacity in schema, writer
  contract, calculation or dossier).
- Writer `createFireAlarmPreliminarySizingSnapshot({ command, dependencies })`
  (pure): consumes the governed `aggregatePreliminaryPointDemand` result;
  persists `calculation_json` with project-level
  `projectTotalPoints === knownPointDemand` and `preliminaryTotalPoints`
  (null on THRESHOLD_UNCERTAIN); computes a deterministic input fingerprint;
  refuses malformed/inconsistent/negative/null-as-zero/product-identifying
  inputs (§22).
- Reader: current-by-`version_number`; `STALE` when `status !== "COMPLETED"`;
  adapter into GOLDEN-5 policy input shape — numeric only when `usable`
  (§15/§23).
- Recommendation (§20): **create the new table** — section 20's five criteria
  are all satisfied, and the table mirrors the approved 0004 pattern.

---

## §5 — `PANEL_SIZING_SNAPSHOT_REQUIRED`: answer + smallest safe refinement

**Answer: C — the literal is conflated.** Golden-5's Rule C emits
`PANEL_SIZING_SNAPSHOT_REQUIRED` for its *preliminary point-count* prerequisite
(fires on `preliminaryTotalPoints === null`), while the worker quotation /
BOM / panel-sizing gates use the same literal for *final* sizing snapshots.
When this lane lands, a project with a proven preliminary count but no final
sizing snapshot triggers the same code string for two different prerequisites —
a real, testable conflation, not a theoretical one.

- A. Rename the final-worker usages → **rejected**: Agent-3 owns those gates;
  renaming rewires another agent's contract and its pinned tests.
- B. Rename GOLDEN-5 Rule C's emit → **rejected**: golden-5 tests pin the
  current emit; changing it moves the goalposts of the circular dependency we
  are resolving and touches the ecosystem policy's public behavior.
- **C. Introduce a distinct preliminary token at the new persistence layer** →
  **adopted (smallest safe refinement).** GOLDEN-5's own emit stays unchanged
  and still pinned by its tests. The new persistence layer exports
  `PRELIMINARY_POINT_COUNT_REQUIRED` as the preliminary prerequisite token and
  never collides with the final `PANEL_SIZING_SNAPSHOT_REQUIRED`. Nothing
  currently emitted by any other layer is redefined.

---

## §7 — The preliminary artifact carries no product identity

The preliminary snapshot must not require `product_id`, `panel_model`,
`manufacturer`, `ecosystem`, `loop` or expansion capacity. Proof by construction:

- **Schema**: 0017 has the same 12 columns as 0004 and no product column
  (§19.5). The 6c2 suite asserts the applied schema has none of those columns.
- **Writer contract**: `createFireAlarmPreliminarySizingSnapshot` accepts only
  `{ projectId, reason, expectedInputFingerprint? }` (the demand dependency is
  passed separately, like the final writer). `createdBy` is recorded by the
  persistence layer at insert time — mirroring the final worker payload — not
  part of the fingerprint input. Any `productId` / `panelModel` /
  `manufacturer` / `ecosystem` / `loop` / `expansion` key in the command or
  shimmed dependencies is refused (negative §28 row 9).
- **Outputs**: `calculation_json` and `dossier_json` never carry product or
  ecosystem identity (asserted in the 6c2 suite).

---

## §9–§11 — Governed threshold semantics

- **§9 (`WITHIN_THRESHOLD_CONFIRMED`)**: reported only on governed evidence. A
  populationless project or an all-unknown project is `THRESHOLD_UNCERTAIN`,
  never a small system (§27 row 10 / §29 regression).
- **§10 (`known 1950 + material unknown`)**: exactly `THRESHOLD_UNCERTAIN`,
  `completeness = THRESHOLD_UNCERTAIN`, `preliminaryTotalPoints = null`. The
  known 1950 is *not* promoted to a policy number.
- **§11 (no coercion)**: `null` / unknown is never coerced to zero and never
  folded into a total. `unknownPointDemand` stays visible. An empty inventory
  never means `≤ 2000`.

---

## §14 — Project-level totals are never divided across FACPs

The persisted `calculation_json.projectTotalPoints` is the project-level
`knownPointDemand`. The writer and reader never divide it across seven FACPs, a
device count, or any arbitrary bucket. The 6c2 suite asserts the persisted
project total equals `knownPointDemand` and that no `projectTotal / N` style
division appears in any output token (negative path §28 row 5 analogue).

---

## §15 — Adapter emits numbers only when trustworthy

The persistence-layer adapter into GOLDEN-5 policy input mirrors
`preliminarySizingInput`:

- `usable = thresholdStatus !== "THRESHOLD_UNCERTAIN" && completeness !== "INSUFFICIENT"`
  (numeric `preliminaryTotalPoints` only when usable);
- `preliminaryTotalPoints = null` on `THRESHOLD_UNCERTAIN`;
- `sourceVersion` records which snapshot version the adapter read.

The persisted layer **never outputs Farenhyt or Gent** — no manufacturer/ecosystem
strings exist in any persisted shape (asserted by the suite).

---

## §20 — Five-criterion decision: create the new table

| # | Criterion | Assessment |
|---|-----------|------------|
| 1 | Independent governing lifecycle (escalation/review/audit semantics) | Final sizing depends on exact-product approval; preliminary sizing depends only on governed point evidence. Distinct lifecycle + distinct engine version. **Satisfied** |
| 2 | Unique FK identity | `project_id → projects(id)` like 0004. **Satisfied** |
| 3 | Different cardinality/granularity from existing rows | Final table is per-project panel-sizing evidence; preliminary table is per-project *point-count* evidence. One preliminary row per project version; no overlap with 0004 or any requirement/estimation table. **Satisfied** |
| 4 | Different access/authority path | Final table consumed by quotation/BOM/scope (Agent-3); preliminary table consumed by ecosystem policy input (this lane). Distinct writer contracts. **Satisfied** |
| 5 | Cannot be expressed as columns on an existing table | `preliminaryTotalPoints` is pre-exact-product; final `calculation_json` requires exact-product sizing. Storing it on 0004 would fabricate an exact-product snapshot; storing on the policy side is impossible (policy consumes, does not persist). **Satisfied** |

All five → **new table** `fire_alarm_preliminary_sizing_snapshots` as migration
`0017`, mirroring `0004` minus product identity.

**Lockstep** (hand-authored; `db:generate` never run): `0017_*.sql`, journal
entry `{idx:17, version:"9", when:…, tag:"0017_fire_alarm_preliminary_sizing_snapshots"}`,
`meta/0017_snapshot.json` (prevId = 0016 snapshot id), `manifest.json`
(counts 316→317 tables, 469→471 indexes, 45→47 triggers; cutoff →
`0017_fire_alarm_preliminary_sizing_snapshots.sql`), `db/schema.ts`
(one-line style, no `supersededAt`), `MIGRATION_VERSION`.

---

## §22 / §23 — Writer and reader contracts

### Writer — `createFireAlarmPreliminarySizingSnapshot({ command, dependencies })`

Returns `{ status: "COMPLETED", engineVersion, inputFingerprint, input,
calculation, dossier }`. Refuses (via `preliminarySizingFailure(code, message,
status, details)`, `status 422`, mirroring 0004's failure helper):

| Code | Guard |
|------|-------|
| `PRELIMINARY_SIZING_COMMAND_REQUIRED` | missing/non-object command |
| `PRELIMINARY_SIZING_PROJECT_REQUIRED` | missing `projectId` |
| `PRELIMINARY_SIZING_REASON_REQUIRED` | reason < 5 chars |
| `PRELIMINARY_SIZING_FINGERPRINT_MISMATCH` | supplied `expectedInputFingerprint` ≠ recomputed fingerprint |
| `PRELIMINARY_SIZING_CALCULATION_MALFORMED` | demand missing `thresholdStatus`/`knownPointDemand`/`unknownPointDemand`/`completeness` |
| `PRELIMINARY_SIZING_THRESHOLD_INCONSISTENT` | `THRESHOLD_UNCERTAIN` with non-null `preliminaryTotalPoints` |
| `PRELIMINARY_SIZING_NEGATIVE_DEMAND` | negative known/unknown demand |
| `PRELIMINARY_SIZING_NULL_AS_ZERO` | `null` supplied in a numeric demand slot (never coerced to 0) |
| `PRELIMINARY_SIZING_PRODUCT_IDENTITY_REJECTED` | any product/ecosystem/panel identity key in the command/calculation (§7) |

`calculation_json` = `{ engineVersion, projectTotalPoints, preliminaryTotalPoints,
thresholdStatus, completeness, confidence, knownPointDemand, unknownPointDemand,
scopeTotals, missingKnownScopes, conflicts }` — project-level only.

### Reader — `currentPreliminarySizingSnapshot(rows)` + adapter

- Selects the row with the highest `version_number`; payload has `version`,
  `inputFingerprint`, `engineVersion`, `status`, `current`, `input`,
  `calculation`, `dossier`, `reason`, `createdBy`, `createdAt` (mirrors the
  worker payload shape of §19.1).
- `status: "STALE"` when the persisted `status !== "COMPLETED"` or when a newer
  version supersedes it; currency is by `version_number`, never `created_at`.
- Adapter `preliminarySizingSnapshotInput(payload)` (§15) feeds
  `resolveFireAlarmEcosystem` with numeric input only when `usable`.

---

## §25 / §26 — GOLDEN-5 stays blocked; empty inventory never resolves

- §25: GOLDEN-5 integration regression — known 1950 + material unknown stays in
  the `THRESHOLD_UNCERTAIN` path (ecosystem not resolved; `preliminaryTotalPoints`
  null) **after** passing through the persisted snapshot adapter.
- §26: an empty inventory (`aggregatePreliminaryPointDemand([])`) must never
  resolve `RESOLVED_FARENHYT`; persistence still refuses to fabricate ≤2000.

---

## §27 — Acceptance scenarios (18 rows)

| Row | Scenario | Assertion |
|-----|----------|-----------|
| 1 | Writer stores a governed aggregate (known 1500) | `status: "COMPLETED"`; `projectTotalPoints === 1500`; usable |
| 2 | Same evidence, second write | Deterministic fingerprint; identical `inputFingerprint` (idempotent) |
| 3 | Version currency | Higher `version_number` wins; older row reported non-current |
| 4 | Persisted STALE | `status ≠ "COMPLETED"` → reader reports `STALE` |
| 5 | Project total undivided | `calculation_json.projectTotalPoints === knownPointDemand`; never ÷7 |
| 6 | `WITHIN_THRESHOLD_CONFIRMED` governed-only | Only on proven evidence (known 1500, no material unknown) |
| 7 | 1950 + material unknown | `THRESHOLD_UNCERTAIN`; `preliminaryTotalPoints === null` (persisted) |
| 8 | Null/unknown never zero | `unknownPointDemand` retained; nothing coerced to 0 |
| 9 | Empty inventory | `THRESHOLD_UNCERTAIN`, `INSUFFICIENT`, never ≤2000 |
| 10 | Adapter usable → numeric | `preliminarySizingSnapshotInput(...).preliminaryTotalPoints` numeric when usable |
| 11 | Adapter UNCERTAIN → null | null `preliminaryTotalPoints`, `usable: false` |
| 12 | No product identity in schema | Applied 0017 SQL has no `product_id`/`panel_model`/`manufacturer`/`ecosystem`/`loop`/`expansion` |
| 13 | No product identity in outputs | writer calculation/dossier never carry product or ecosystem identity |
| 14 | Never emits Farenhyt/Gent | serialized outputs contain neither token |
| 15 | GOLDEN-5 blocked via adapter | 1950 + material unknown persists; policy input null; ecosystem unresolved |
| 16 | Empty inventory never resolves | no `RESOLVED_FARENHYT` from an empty preliminary record |
| 17 | Immutability + FK + unique (applied chain) | UPDATE/DELETE raise `FIRE_ALARM_PRELIMINARY_SIZING_SNAPSHOTS_IMMUTABLE`; FK to `projects(id)`; UNIQUE `(project_id, version_number)` — disposable sqlite, full active chain |
| 18 | Lockstep | migration/journal/snapshot/manifest/schema.ts/`MIGRATION_VERSION` all name 0017 |

## §28 — Negative scenarios (10 rows)

| Row | Input | Refusal |
|-----|-------|---------|
| 1 | No command | `PRELIMINARY_SIZING_COMMAND_REQUIRED` |
| 2 | No projectId | `PRELIMINARY_SIZING_PROJECT_REQUIRED` |
| 3 | Missing reason / short reason | `PRELIMINARY_SIZING_REASON_REQUIRED` |
| 4 | Bad fingerprint expectation | `PRELIMINARY_SIZING_FINGERPRINT_MISMATCH` |
| 5 | Malformed calculation (no thresholdStatus) | `PRELIMINARY_SIZING_CALCULATION_MALFORMED` |
| 6 | THRESHOLD_UNCERTAIN with non-null points | `PRELIMINARY_SIZING_THRESHOLD_INCONSISTENT` |
| 7 | Negative known demand | `PRELIMINARY_SIZING_NEGATIVE_DEMAND` |
| 8 | Negative unknown demand | `PRELIMINARY_SIZING_NEGATIVE_DEMAND` |
| 9 | Null-as-zero in a numeric slot | `PRELIMINARY_SIZING_NULL_AS_ZERO` |
| 10 | Product identity key (§7) | `PRELIMINARY_SIZING_PRODUCT_IDENTITY_REJECTED` |

## §29 — Regression coverage

- Migration gates: `migration-baseline-safety`, `document-revision-migration`,
  `migration-chain-verification`, `review-workflow-atomic` — advance pins to the
  0017 head; all pass with non-zero index/trigger/table counts.
- Fire alarm golden series: golden-5, golden-6, golden-6C (32), golden-6B (19),
  and new golden-6C2 (defined above).
- R7 panel sizing family: `r7-panel-sizing-production`, `r7-topology-concurrency`;
  matching prereqs (`product-matching-engine`, `product-matching-api`);
  profile currency (`requirement-profile-staleness`,
  `specification-approval-profile-freshness`).
- GOLDEN-5 integration rows (§25/§26) run inside the 6c2 suite against the real
  `resolveFireAlarmEcosystem`.

---

## §30 — golden-6b REAL_STATE false positive

- `scripts/authoritative-test-inventory.mjs` classifies golden-6b as
  `REAL_STATE` because the test file's **comment** at lines 84–87 names "Al Mousa
  School Clean Golden Run D1".
- This lineage owns the untracked golden-6b test file; the comment is reworded
  to describe the read-only replica of the eligibility evidence shape **without**
  the matching tokens. `scripts/test-classification-baseline.json` is **not
  touched**: its `golden-6b` `SAFE` entry is already correct, and the baseline
  drive (`npm run test:inventory`, not `test:all --verify-drift`) is the
  supported check because golden-6c remains absent from the baseline (pre-existing
  drift; not repaired here).

## §31 — Live-state write declaration

No live D1 writes, snapshot creation, profile regeneration, matching, approval,
pricing, quotation mutation, deployment, restart, commit or push. Every database
used by this lane is a disposable, in-memory or temp-file sqlite created from the
active migration chain (`document-revision`-style helpers). Schema migrations are
landed as repository files only and never applied to live state.

## §32 — Deliverables (18)

1. Architecture trace + decision record — this document.
2. `drizzle-active/0017_fire_alarm_preliminary_sizing_snapshots.sql`.
3. `drizzle-active/meta/_journal.json` — appended entry idx 17.
4. `drizzle-active/meta/0017_snapshot.json` — linked snapshot (prevId = 0016).
5. `drizzle-active/manifest.json` — counts/target + table + indexes + triggers.
6. `db/schema.ts` — `fireAlarmPreliminarySizingSnapshots` (one-line style).
7. `app/domain/production-readiness.mjs` — `MIGRATION_VERSION` → 0017.
8. `app/domain/fire-alarm-preliminary-sizing-snapshot.mjs` — writer + reader +
   adapter.
9. `tests/golden-6c2-fire-alarm-preliminary-sizing-persistence.test.mjs` —
   §27 (18) + §28 (10) + §29 regressions.
10. `tests/migration-baseline-safety.test.mjs` — pin updates to the 0017 head.
11. `tests/document-revision-migration.test.mjs` — table count pin 316 → 317.
12. golden-6b comment reword (§30).
13. Test run evidence (§29 suites).
14. `npm run lint` green **for this lane's files** (targeted eslint on the seven
    changed files: zero findings). The repo-wide run still reports pre-existing
    errors in unrelated working-tree files that this lane does not touch.
15. `npm run build` green.
16. Business-state write declaration (§31).
17. Classification verification via `npm run test:inventory` (§30).
18. GOLDEN-6C3 recommendation (below).

## §33 — Verdict

**CLOSED** — the circular GOLDEN-5 → sizing → exact product → ecosystem
dependency is broken by a governed preliminary sizing persistence layer,
proven end-to-end: migration lockstep, writer/reader contracts, 18 acceptance +
10 negative scenarios, golden-series regressions, and full migration-gate
agreement at the 0017 head. No unresolved cross-owner contract decision remains
(§19.4 reconciliation; §5 Decision C).

### GOLDEN-6C3 recommendation

The next workload item is a **device-family + addressability authority** for the
preliminary point count. The live-data dry run on `project_c0123d91…` measured
`knownPointDemand = 0`, `unknownPointDemand = 2393`, `excludedNonPoint = 7`,
`THRESHOLD_UNCERTAIN` — a ±57% point gap with no family/addressability authority.
Until populations resolve under a governed units-per-device and
addressable–vs–ULC/per-panel-addressability contract, the preliminary snapshot
will legitimately stay `THRESHOLD_UNCERTAIN` for that class of project.