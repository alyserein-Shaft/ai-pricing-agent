# GOLDEN-6C3 — Governed Fire Alarm Device Evidence Resolution

- Lineage: GOLDEN-6C → GOLDEN-6C2 → GOLDEN-6C3 (this lane). Section numbering
  follows the mission contract: mechanism first, authority trace, single
  classifier, live re-measurement, tests, delivery.
- Verdict: **CLOSED — "MECHANISM PROVEN; PROJECT EVIDENCE REMAINS INCOMPLETE."**
  See §43.
- Read-only declaration: **no live business state was written.** No D1 write,
  no approval, no snapshot, no profile regeneration, no commit, no push. The
  live measurement opens the acceptance-project D1 with `mode=ro` and
  `PRAGMA quick_check = ok` (§27, §41).

---

## §1 Executive verdict

The governed evidence-resolution layer for the four independent device
dimensions — **identity, approved family, addressability, point consumption** —
exists, is pinned by a 61-test suite, feeds the canonical
`classifyFireAlarmSlcItem` classifier (GOLDEN-6C) and the GOLDEN-6C2 snapshot
writer and reader, and is exercised read-only against the acceptance project's
live evidence.

The mechanism is proven. The project evidence is not there yet — and the layer
correctly refuses to fake it. Measured on the acceptance project
(`project_c0123d91…`):

| Signal | GOLDEN-6C §13 (historical) | GOLDEN-6C3 (current, read-only) |
|---|---|---|
| Eligible populations | 80 | 90 |
| Units | 2,400 | 2,429 |
| Governed fact-bearing populations | 23 | 34 (22 whole-blob + 12 field-level) |
| Governed addressability | — | **0** |
| Known point demand | 0 | **0** |
| Unknown point demand | 2,393 units | **2,422 units** |
| Excluded non-point | 7 | 7 (7 units) |
| Threshold | `THRESHOLD_UNCERTAIN` | `THRESHOLD_UNCERTAIN` |
| Family-required blocker ("the 57") | 57 | **56 (1,776 units)** |

The resolver lifts every population with governed evidence into a named,
traceable state (`GOVERNED_FAMILY_RESOLVED` × 34) and leaves every population
without governed evidence `INSUFFICIENT_EVIDENCE` (× 56) or the classifier's
honest `UNRESOLVED` demand. It manufactures nothing: no detector becomes
addressable, no family becomes a best guess, no point count becomes a number.

> That parity — resolver AFTER == 6C replica BEFORE in demand, threshold,
> confidence — is the correct result, not a failure. The point count is decided
> only by the canonical classifier, and the project currently has **zero**
> governed addressability evidence (§11, §15). The proof that the resolver
> *would* move the count when governed evidence exists is the 6C2-disposable-chain
> handoff test (§32) and the unit suite (§37/§38).

---

## §2 What this layer is

`app/domain/fire-alarm-device-evidence-resolver.mjs` answers, for **one device
population**, four **independent** governed questions:

| Dimension | Question | Resolved by | State vocabulary |
|---|---|---|---|
| A. Identity | What is this device? | governed `deviceIdentity` claims | `GOVERNED_IDENTITY_RESOLVED` / `IDENTITY_UNKNOWN` |
| B. Family | What approved family? | governed `deviceFamily` claims, verbatim | `GOVERNED_FAMILY_RESOLVED` / `FAMILY_UNKNOWN` |
| C. Addressability | Is it addressable? | governed `addressability` claims | `GOVERNED_ADDRESSABILITY_RESOLVED` / `ADDRESSABILITY_UNKNOWN` |
| D. Point consumption | Does it consume SLC pool points? | **only** the canonical classifier handoff | `GOVERNED_POINT_CONSUMPTION_RESOLVED` / `MULTI_ADDRESS_UNRESOLVED` / `NON_POINT_CONFIRMED` / `POINT_CONSUMPTION_UNKNOWN` |

Population-level verdicts (7): `GOVERNED_POINT_CONSUMPTION_RESOLVED`,
`GOVERNED_FAMILY_RESOLVED`, `GOVERNED_ADDRESSABILITY_RESOLVED`,
`NON_POINT_CONFIRMED`, `REQUIRES_ENGINEERING_REVIEW`, `INSUFFICIENT_EVIDENCE`,
`CONFLICTING_EVIDENCE`.

The module is a **pure domain module** consuming **structured governed
observation claims** — no free-text AI, no fuzzy similarity, no best-guess, no
derived dimension. It never builds a quantity.

---

## §3 Core invariants (§3, §38 — pinned by tests)

The layer will never, under any evidence combination:

1. **Infer** device → addressable from a name or Fire Alarm membership
   (`38.01`, `38.02`).
2. **Infer** a known name → one point (`38.03`).
3. **Guess** an unknown family (never a best-guess family) (`38.05`).
4. **Default** unknown addressability → conventional (`38.10`, `37.15`).
5. **Default** unknown point consumption → zero — or to one (`38.11`).
6. **Infer** point consumption → one point for a module family without
   addressability (`38.03`).
7. Treat **protocol/system mention** as population addressability unless
   explicitly attached (`37.03`, `37.04`, `38.07`).
8. Let **superseded or rejected** evidence govern (`37.05`, `37.06`, `37.07`,
   `38.09`).
9. Copy identity/family between populations sharing a description
   (`37.08`, `38.06`).
10. Resolve a **conflict** by picking a winner (`37.22`, `37.24`).
11. Let point evidence name an **ecosystem** or an **exact panel**
    (`38.12`, `38.13`).

Missing/unknown stay `UNKNOWN` everywhere except where the classifier itself
settles non-point equipment (`NOT_SLC` → excluded at the engine, §25).

---

## §4 The evidence observation contract

A governed evidence observation is a structured object:

```js
{
  id: "ev-approved-boqitem_…",        // required, unique
  source: "estimator-understanding-review",
  sourceLocation: "…",                 // drawing/sheet location when known
  authority: "Understanding Review (approved)",
  reviewStatus: "Approved",            // Approved | Accepted | Auto Verified
  applicableTo: "boqitem_…",           // optional; policy object or id list
  scope: { population: "boqitem_…", sheet: "FA-A-101", drawing: "…" },
  supersededAt: null,                  // superseded observations never govern
  claims: {
    deviceIdentity: "Manual Call Point",
    deviceFamily: "Manual Call Point",
    addressability: "ADDRESSABLE",     // ADDRESSABLE | CONVENTIONAL | NON_LOOP
    negative: "NON_LOOP",              // only a governed negative
    protocol: "…",                     // protocol/system text, attachable only
  },
}
```

Eligibility gate (`isUsableEvidenceObservation`, pinned by `branch: observation
eligibility gate`): id, source, authority, a positively-speaking status, no
supersession/rejection, at least one recognized claim. Every dimension claim
must be backed by evidence that names that dimension — a claim never bleeds
across dimensions (§8.4 of the resolver header).

---

## §5 Dimension rules (branch tests)

- **Identity**: consensus of governed `deviceIdentity` claims; a single
  governing observation resolves; conflicts stay conflicts (`37.22`–`37.24`,
  `branch: consensus identity from multiple approved sources`).
- **Family**: consumed **verbatim** from governed claims. `aliasEquivalence`
  requires `aliasEvidence: true` and normalizes **within that observation
  only** — a conflicting direct claim from another source still conflicts
  (`37.09`–`37.13`). No fuzzy similarity, ever (`37.11`, `37.12`).
- **Addressability**: `ADDRESSABLE`/`CONVENTIONAL`/`NON_LOOP`, resolved
  independently of family and identity (`37.14`, `branch: explicit + negative
  addressability …`). Absence is absence.
- **Point consumption**: *never* derived by the resolver. Only
  `classifyResolvedDeviceEvidence` — a thin adapter over the canonical
  `classifyFireAlarmSlcItem` — decides demand class, units, and reason
  (`37.26`, `integration: …`). A governed `negative` claim confirms
  `NON_POINT_CONFIRMED` (`37.17`, `37.20`, `37.21`). Qualified `MULTI_ADDRESS`
  evidence leaves the count unresolved: `MULTI_ADDRESS_UNRESOLVED` →
  `REQUIRES_ENGINEERING_REVIEW` (`37.19`, `branch: multi-address claim
  spellings are all detected`).

---

## §6 Conflicts and the governing-authority rule

Conflicts never pick winners **unless** a single `governingAuthority` owns the
disagreement — the authority model itself is pre-authorized to resolve family
overrides or a defined precedence (`37.23`); two genuinely different governing
authorities that disagree remain a `CONFLICTING_EVIDENCE` population state
(`37.24`). A conflict on *any* governed dimension marks the **population**
as `CONFLICTING_EVIDENCE` — evidence-layer conflict is population-wide, not
per-dimension (`37.22`).

## §7 Scope applicability is fail-closed (§11, §15)

- A **legend** or **schedule** governs a population only when its declared
  scope includes that population's drawing context; an unrelated-sheet legend
  never leaks (`37.01`, `37.02`, `37.25`).
- A **protocol/system** statement ("analogue addressable type", "FlashScan") is
  evidence only when `applicableTo`/`scope.population` explicitly attaches it
  to the population (`37.03`); all unattached protocol mention is inert
  (`37.04`, `38.07`).
- **Empty population context ⇒ not applicable.** No scope ⇒ no claim.
  (`branch: scope applicability guards`.)

## §8 Point consumption: one classifier, one handoff (§25, §39)

The resolver contains **no** family taxonomy and **no** quantity engine. It
reuses the canonical classifier's public contract:

- Families are consumed verbatim; the classifier's own families and
  unit-per-device math decide `SLC_DETECTOR_POOL` / `SLC_MODULE_POOL` /
  `NON_ADDRESSABLE_EQUIPMENT` / unresolved (`integration: resolved detector →
  SLC_DETECTOR_POOL…`, `integration: resolved module → SLC_MODULE_POOL…`,
  `integration: addressable heat and multi-criteria detectors classify as
  detector pool`, `branch: a governed but classifier-unrepresentable family
  stays unknown-demand`).
- Quantity **never** comes from the resolver (`integration: quantity never
  comes from the resolver`).
- Governed multi-address evidence is surfaced through the classifier's own
  vocabulary (`slc_addressing: "multi_address"`) when the classifier input has
  no `point_behavior`/`slc_addressing` — no parallel rule reimplementation.

---

## §9 Family authority — traced, not invented (§9, §40)

Before creating anything, the existing field was traced. The single
authoritative family source is:

> `estimator_understanding_review_versions.canonical_interpretation` (JSON
> `system`, `category`, `equipmentType`, `productFamily`,
> `attributes.addressing`) on an **APPROVED whole-blob review**, read through
> `currentApprovedUnderstandingFacts`
> (`worker/estimator-understanding-review-api.mjs`, SQL lines 42–47, facts
> lines 251–261).

The field-level fallback (`currentFieldLevelUnderstandingFacts`) is the
narrower, additive path — only `system | category | productFamily` plus
`attribute:*` keys can be confirmed this way (a deliberately closed list), and
it never overrides a whole-blob approval.

The live harness uses the **real** worker builders
(`loadUnderstandingReviewRows` →
`safeUnderstandingReviewItem` → `currentApprovedUnderstandingFacts`) through a
D1-compatible shim over the read-only sqlite — zero duplication of the
governance SQL, and the `reviewMatchesEffective`/staleness gate is inherited,
not re-implemented. **No new field, table, or authority file was created.**

### 9.1 Raw rows vs governed facts (the section is the proof)

| Read | Scope | Result |
|---|---|---|
| Raw `estimator_understanding_review_versions` (APPROVED, whole project, all versions) | 148 rows | looks rich: Addressable Smoke Detector 24, Manual Call Point 21, Fire Alarm Control Panel 19, Interface Module 17, Sounder/Strobe 16, Addressable Heat Detector 9, …; `attributes.addressing`: Addressable 30, MCLP 1, null 117 |
| Governed `currentApprovedUnderstandingFacts` (eligible scope, current-approved only) | **34** populations | Manual Call Point 11, Fire Alarm Control Panel 7, Interface Module 7, Duct Detector 3, Strobe 3, Heat Detector 3; governed addressability **0** |

The gap (148 → 34) is exactly the governance working: raw rows include
versions on **non-eligible items** (structural rows, older versions, items not
in the current understanding scope) and one eligible item whose approval is no
longer current (its review no longer matches the effective interpretation /
input fingerprint). Raw table reads are not facts; current-approved reads are
the fact. This is the answer to "reuse existing fact structures" (§40).

---

## §10 Persistence: report the gap, invent no store (§40)

The layer needs **no** new persistence. The resolver is a pure domain shape
which feeds the existing GOLDEN-6C2 persistence. The only storage question the
mission asked was "where does resolved evidence live?":

- **No `fire_alarm_device_authority` table** was created or proposed.
- Resolved candidates are derived values on top of the governed source rows
  (`canonical_interpretation` + field confirmations), exactly as the engine
  vocabulary already models them.
- The 6C2 snapshot (`fire_alarm_panel_sizing_snapshots`) is the only write
  point in the chain, and this lane reaches it **only on a disposable
  database** (§32).
- The persistence gap that *does* remain is reported, not papered over: the
  project has **zero** governed, population-attached addressability evidence,
  so no snapshot input can contain one (§28.2, §43 verdict).

---

## §11 Protocol mention ≠ population addressability

85 `requirement_intelligence_facts` rows carry a system-wide
`Addressability:addressable` statement (project spec corpus: 2,143 fact rows).
NONE are attached to a BOQ population through a governed link, so **none are
consumed** — the harness inherits the resolver's §7 fail-closed posture and
never free-text-parses specifications.

## §15 Legends govern only within declared scope

The acceptance project has 18 drawing legend entries (via
`drawing_intake_versions`); **0 are Approved**. They cannot govern from live
data. `engineering_facts` holds **0** device/address/family/point predicates.
Both are reported as present-but-not-governed; neither is consumed.

---

## §26–§29 Live inventory and re-measurement (§27, §28, §29)

### §27 The read-only inventory harness

`scripts/golden-6c3-live-inventory.mjs` opens the acceptance D1 with
`readOnly: true`, confirms `PRAGMA quick_check = ok`, reuses the worker's
governed read path (§9), runs the resolver per population, hands every
population to `classifyResolvedDeviceEvidence`, and runs the GOLDEN-6C engine
**before** (6C §13 replica) and **after** (resolver candidates). It issues
only `SELECT`/`PRAGMA` statements — the D1-compatible shim exposes `run` for
shape compatibility with the worker module calls, but no code path invokes it,
and `db.close()` is the final statement. Run:

```sh
node scripts/golden-6c3-live-inventory.mjs
```

Current measurement (acceptance project):

- **90** eligible Fire Alarm BOQ populations / **2,429** units.
- **34** populations with governed facts — 22 whole-blob APPROVED, 12
  field-level confirmed.
- Governed family census: Manual Call Point 11, Fire Alarm Control Panel 7,
  Interface Module 7, Duct Detector 3, Strobe 3, Heat Detector 3.
- **0** populations with governed addressability evidence.

### §28 Re-measure of the "57" unresolved populations

The GOLDEN-6C §13 blocker *"Governed Fire Alarm system and family are
required."* counted **57** of 80. Re-measured through the same governed read
against current data:

**56 populations / 1,776 units** still blocked on that reason. The count moved
down **despite the base growing 80 → 90** because 11 populations gained
governed family evidence since 6C (new whole-blob/field-level confirmations),
and none gained governed addressability.

| §13 blocker bucket | 6C historical | 6C3 current |
|---|---|---|
| Family required ("the 57") | 57 | **56** (1,776 units) |
| Cannot safely represent family/address behavior | 15 | **27** (646 units) |
| Capacity provider/accessory/conventional/non-SLC | 7 | **7** (7 units) |
| Detector family requires governed addressable evidence | 1 | **0** |

The "0" for the last bucket is honest: no detector-family population currently
has a governed family inside the eligible scope, so none can ask for
addressability — the blocker bucket count itself is evidence-dependent.

### §29 Per-population matrix

The harness emits the full matrix —
`Population | Qty | Identity | Family | Addressability | PointConsumption |
Authority | Status` — as 90 governed rows (TSV in the harness output). Its
deciding authority is traced per row (e.g. `Understanding Review (approved)` /
`Understanding Review (confirmed field)` / `(none)`). Example rows:

| Population | Qty | Identity | Family | Addressability | PointConsumption | Authority | Status |
|---|---|---|---|---|---|---|---|
| `boqitem_e613397f…` | 1 | Fire Alarm Control Panel | Fire Alarm Control Panel | UNKNOWN | POINT_CONSUMPTION_UNKNOWN | Understanding Review (approved) | GOVERNED_FAMILY_RESOLVED |
| `boqitem_ea12a5ee…` | 13 | UNKNOWN | Duct Detector | UNKNOWN | POINT_CONSUMPTION_UNKNOWN | Understanding Review (confirmed field) | GOVERNED_FAMILY_RESOLVED |
| `boqitem_2e960996…` | 131 | UNKNOWN | UNKNOWN | UNKNOWN | POINT_CONSUMPTION_UNKNOWN | (none) | INSUFFICIENT_EVIDENCE |

### §29.1 Coverage, before vs after

| Coverage signal | BEFORE (6C replica) | AFTER (resolver) |
|---|---|---|
| Populations | 90 | 90 |
| With governed family | 34 | 34 (all `GOVERNED_FAMILY_RESOLVED`) |
| With governed addressability | 0 | 0 |
| `INSUFFICIENT_EVIDENCE` | — | 56 (1,776 units) |
| Unknown demand | 2,422 units | 2,422 units |
| Known demand | 0 | 0 |

### §29.2 GOLDEN-6C demand / threshold / confidence

| Measure | BEFORE | AFTER |
|---|---|---|
| `knownPointDemand` | 0 | 0 |
| `unknownPointDemand` | 2,422 units | 2,422 units |
| Excluded non-point | 7 populations / 7 units | 7 populations / 7 units |
| `thresholdStatus` | `THRESHOLD_UNCERTAIN` | `THRESHOLD_UNCERTAIN` |
| `completeness` | `INSUFFICIENT` | `INSUFFICIENT` |
| `confidence` | 0 | 0 |
| `preliminaryTotalPoints` | null | null |

The AFTER row is identical to BEFORE by construction and by honesty: the point
count is decided only by the canonical classifier, and the classifier input
(governed family, governed addressability) is unchanged by the resolver. The
resolver's contribution is the **evidence layer**: per-dimension authority,
conflict states, non-point confirmation, and honest `INSUFFICIENT_EVIDENCE`
instead of silent guessing.

---

## §30–§31 No threshold optimization (accepted)

This lane deliberately performs **no** threshold optimization
(`THRESHOLD_UNCERTAIN` is the correct, accepted outcome; the submission notes
it as an accepted negative observation, not a defect). No number is published
as `preliminaryTotalPoints` while the threshold is uncertain — that gate
belongs to the 6C engine and is untouched.

## §32 GOLDEN-6C2 handoff — disposable database only

Two tests prove the handoff contract end-to-end **on a disposable database**:
the test applies the active `drizzle-active` migration chain in journal order
to a throwaway sqlite (project seeded with `organization_id NULL`,
`initial_status 'Draft'`, owner `'u1'` to satisfy FKs), runs
`classifyFireAlarmDeviceEvidence`-resolved demand through the 6C engine, and
calls the real async snapshot writer (`currentPreliminarySizingSnapshot` /
`preliminarySizingSnapshotInput` read-back):

- `6C2 handoff: resolver-resolved demand writes a usable preliminary snapshot
  on a disposable chain`
- `6C2 handoff: resolver UNRESOLVED-point populations keep the count usable at
  zero known`

No live D1 is opened by the test suite.

## §33 Compliance independence (family never proves addressable)

The four dimensions are structurally independent; a `Detector` family
**never** auto-proves `ADDRESSABLE` (`38.01`), and addressability never
imports identity. The compliance lane (GOLDEN-6B) is untouched.

## §34 Ecosystem independence

The resolver contract contains **no ecosystem vocabulary**. Point evidence
cannot name an ecosystem (`38.12`); GOLDEN-5's exact-panel/ecosystem policy
never appears (`independence: ecosystem lane (GOLDEN-5) never appears in the
resolver contract`).

## §35 Exact-model independence

The resolver concerns device families and addressability, never product
identity or model. `deviceIdentity` is an evidence answer, not a product
selection; no population names a panel or a manufacturer (`38.08`, `38.13`,
`branch: equipment families do not generate addressability review questions`).

---

## §37 Acceptance — 26 rows (all passing)

`tests/golden-6c3-fire-alarm-device-evidence-authority.test.mjs`, section 37
(26 scenarios, `37.01`–`37.26`): legend/schedule scope (`37.01`, `37.02`,
`37.25`), protocol attachment (`37.03`, `37.04`), superseded/needs-review/
rejected evidence (`37.05`–`37.07`), identity isolation (`37.08`), alias
governance (`37.09`, `37.10`), verbatim families (`37.11`–`37.13`),
addressability independence (`37.14`–`37.16`), NAC/non-loop (`37.17`,
`37.18`), multi-address (`37.19`), non-point families (`37.20`, `37.21`),
conflicts and governing authority (`37.22`–`37.24`), and the classifier
handoff (`37.26`).

## §38 Mandatory negatives — 13 rows (all passing)

`38.01`–`38.13` pin every never-infer invariant in §3 — including
`38.07 FlashScan/CLIP mention never makes every device addressable` and the
pair `38.10 unknown addressability never becomes conventional` / `38.11
unknown point consumption never becomes zero`.

The suite is **61 tests, 61 pass** via `node --test`
(`0.2538 s`), includes branch/integration/vocabulary coverage, and is
classified by the authoritative inventory as part of the safe set (PLAIN —
zero `REAL_STATE` / `SPAWNS_PROCESS` tokens).

## §39 No duplicate taxonomy

No family set, units-per-device table, or quantity engine was written. The
classifier (`fire-alarm-slc-resource-classifier.mjs`) is imported and reused;
its `UNRESOLVED_FAMILIES` / `NOT_SLC_FAMILIES` and
`isMultiAddressEvidence` (`slc_addressing|addressing_mode|point_behavior|
slc_point_behavior`) are the vocabulary.

## §40 Reuse of existing fact structures

Consumed exactly as they exist: `boq_items` (population identity and
quantity), `estimator_understanding_review_versions.canonical_interpretation`
(family/identity/addressability), `estimator_understanding_field_reviews`
(field-level), `estimator_item_interpretations` (currency, via the worker's
own `resolveEffectiveUnderstandingInterpretation`), the 6C engine, the 6C2
snapshot writer/reader, and the `drizzle-active` chain for the disposable
handoff. Persistence gap reported in §10.

## §41 Read-only discipline

- Live db opened `readOnly: true`; `PRAGMA quick_check = ok`.
- No live D1 write, no approval, no snapshot, no profile regeneration.
- No commit, no push, no stash, no reset, no deploy.
- The 6C2 handoff writes **only** to the disposable test database.
- Working-tree scope: lane files only (`app/domain/…resolver.mjs`,
  `scripts/golden-6c3-live-inventory.mjs`,
  `tests/golden-6c3-….test.mjs`, this document). Nothing was committed.

---

## §42 Delivery checklist (21 deliverables)

| # | Deliverable | Where proven |
|---|---|---|
| 1 | Never-infer invariants pinned (13 negatives) | §3, tests `38.01`–`38.13` |
| 2 | Acceptance matrix (26 rows) | tests `37.01`–`37.26` |
| 3 | Family-authority mechanism traced to the existing `canonical_interpretation` field before creating anything | §9; `worker/estimator-understanding-review-api.mjs` |
| 4 | Four dimensions structurally independent | §2, §33; `38.01`, `37.14`, vocabulary test |
| 5 | Single taxonomy / single quantity engine reused (`classifyFireAlarmSlcItem` is the sole point decider) | §8, §25, §39 |
| 6 | Protocol mention never population-addressable unless attached | §11; `37.03`, `37.04`, `38.07` |
| 7 | Legend/schedule scope fail-closed | §15, §7; `37.01`, `37.02`, `37.25` |
| 8 | Conflict rule: never pick winners; single `governingAuthority` exception | §6; `37.22`–`37.24` |
| 9 | No new store; persistence gap reported; no `fire_alarm_device_authority` table | §10, §40 |
| 10 | Multi-address evidence → `MULTI_ADDRESS_UNRESOLVED` → `REQUIRES_ENGINEERING_REVIEW` | §5; `37.19`, branch tests |
| 11 | Negative evidence governs only `NON_LOOP`/`CONVENTIONAL`/`NON_POINT` confirmations | §5; `37.16`, `37.17`, `37.20`, `37.21` |
| 12 | Superseded/rejected evidence never governs | §7; `37.05`–`37.07`, `38.09` |
| 13 | 6C2 handoff on disposable DB only (async writer + reader contract) | §32; 2 handoff tests |
| 14 | Read-only live inventory + re-measure harness | §27; `scripts/golden-6c3-live-inventory.mjs` |
| 15 | Re-measure of the 57 family-required populations | §28 (56 / 1,776 units) |
| 16 | Per-population matrix + before/after coverage + 6C demand/threshold/confidence metrics | §29, §29.1, §29.2 |
| 17 | No threshold optimization; `THRESHOLD_UNCERTAIN` accepted | §30–§31 |
| 18 | Compliance / ecosystem / exact-model independence | §33–§35; `38.08`, `38.12`, `38.13`, independence test |
| 19 | 61-test suite green; build green; lane ESLint clean; regression suites green (golden-6c, 6c2, golden-5, 6b, migration gates = 115 tests) | §37–§38, §44 |
| 20 | Lane classified safe in the authoritative inventory | `scripts/authoritative-test-inventory.mjs --list` |
| 21 | This delivery document + verdict | §42, §43 |

## §43 Verdict

**CLOSED — "MECHANISM PROVEN; PROJECT EVIDENCE REMAINS INCOMPLETE."**

The governed evidence-resolution layer is proven end-to-end: the resolver,
the classifier handoff through the canonical `classifyFireAlarmSlcItem`, the
6C engine parity, and the 6C2 snapshot write/read on a disposable chain all
behave exactly as the mission contract demands, with 61/61 tests green and all
regression gates green. On the acceptance project the layer correctly reports
that **no population has governed addressability evidence and 56 populations
lack a governed family**, so the preliminary point count legitimately remains
`THRESHOLD_UNCERTAIN` with no published total. The evidence gap is real,
measured, and reported — never faked.

## §44 Verification

- `node --test tests/golden-6c3-fire-alarm-device-evidence-authority.test.mjs`
  → **61 pass**.
- `node --test` golden-6c + golden-6c2 + golden-5 + golden-6b +
  migration-baseline-safety + migration-chain-verification →
  **115 pass**.
- `npm run build` → green (ESM Worker artifact + hosting manifest present).
- ESLint (lane files) → **0 problems**.
- `node scripts/authoritative-test-inventory.mjs --list` → lane file present
  in the safe set (PLAIN, no excluded classes).
- `node scripts/golden-6c3-live-inventory.mjs` → read-only run, `quick_check
  ok`, numbers in §27–§29.

## §45 Files changed (lane only)

- `app/domain/fire-alarm-device-evidence-resolver.mjs` (new) — the layer.
- `tests/golden-6c3-fire-alarm-device-evidence-authority.test.mjs` (new) —
  61-test suite.
- `scripts/golden-6c3-live-inventory.mjs` (new) — read-only live inventory.
- `docs/GOLDEN-6C3-GOVERNED-FIRE-ALARM-DEVICE-EVIDENCE-RESOLUTION.md` (this
  document).

No existing production module, migration, fixture, or golden evidence was
modified. Nothing was committed.

## §46 Remaining risk and next smallest slice

Real, unresolved risk: zero governed addressability evidence on the acceptance
project means the layer cannot lift the point count live until the project
records approved addressing facts (drawing legend/schedule review, field
confirmations, or approved understanding attributes). The next smallest slice
is to close that evidence path upstream — review and approve the 18 legend
entries / attach the 85 system `Addressability:addressable` spec facts to the
populations they describe — then re-run this same inventory harness unchanged;
the resolver and engine are already proven to consume it.