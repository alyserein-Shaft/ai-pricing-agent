# GOLDEN-6C3A — Governed Addressability Evidence Applicability & Attachment

- Lineage: GOLDEN-6C → 6C2 → 6C3 → **GOLDEN-6C3A (this lane)**. Section
  numbering follows the mission contract: mechanism first, basis and scope
  rules, resolver handoff, live re-measurement, tests, delivery.
- Verdict: **CLOSED — "ADDRESSABILITY APPLICABILITY MECHANISM PROVEN; PROJECT
  EVIDENCE REMAINS INCOMPLETE."** See §34.
- Read-only declaration: **no live business state was written.** No D1 write, no
  approval, no attachment row, no snapshot, no profile regeneration, no commit,
  no push, no deploy. The live measurement opens the acceptance-project D1
  read-only with `PRAGMA quick_check = ok` and re-verifies the file's SHA-256
  after the run (§27, §31).

---

## §1 Executive verdict

The governed **applicability & attachment layer** for Fire Alarm device
addressability now exists, is pinned by a 67-test suite, and is exercised
read-only against every addressability-capable evidence record the acceptance
project actually holds.

The layer answers one question — *which addressability evidence legitimately
governs which device population* — and answers it with four states only:
`CONFIRMED_APPLICABLE`, `NOT_APPLICABLE`, `INSUFFICIENT_EVIDENCE`,
`REQUIRES_ENGINEERING_REVIEW`. Every attachment carries its evidence, its
population, why it applies, the rule that decided it, its scope, its authority,
its source and its source location. Nothing reaches the GOLDEN-6C3 resolver
except a provenance-complete attachment.

Measured on the acceptance project (`project_c0123d91…`, read-only):

| Signal | Value |
|---|---|
| Fire Alarm populations / units | 90 / 2,429 |
| Addressability-capable evidence records found | 322 |
| Eligible (Approved + approved-for-downstream + current extraction) | 245 |
| **Eligible AND carrying a device addressability claim** | **0** |
| Evidence × population pairs evaluated | 22,050 |
| **Governed addressability attachments created** | **0** |
| Populations with governed addressability (this layer) | 0 |
| Review questions raised for blocked pairs | 112 |

The layer's live result is a hard zero, and every one of the 22,050 pair
decisions is recorded with its reason: 14,490 rejected because the record
carries no device addressability claim, 4,320 because a protocol mention is not
population evidence, 3,240 because network-architecture wiring is not device
evidence. **Not a single approved drawing-architecture row, legend entry, or
specification clause on this project can legitimately make one device
population addressable.** That is the finding, and it is the correct one.

---

## §2 What this layer is, and what it is not

**Is:** a decision engine plus attachment planner that sits *upstream* of the
GOLDEN-6C3 resolver and decides, per (evidence × population) pair, whether a
governed addressability claim may attach to that population — and, when it may,
produces a provenance-complete attachment and a resolver observation.

**Is not:** a family resolver, a quantity owner, an ecosystem or panel
selector, a point classifier, or a source of new claims. Point consumption
remains owned by the canonical `classifyFireAlarmSlcItem` (GOLDEN-6C) via the
6C3 resolver handoff; this layer never writes a point value, never invents a
family, and never promotes similarity into applicability.

The governing invariant, implemented as code and pinned by tests:

> **evidence exists + evidence scope known + population within scope = applicable**

Absence of any of the three never yields an attachment. In particular a
scope-less claim fails closed even when it is approved and current (`RULE_26`).

---

## §3 The evidence contract

An evidence record handed to the classifier carries:

- `id`, `kind`
- `claimKind` ∈ `DEVICE | SYSTEM_ARCHITECTURE | NETWORK_ARCHITECTURE | PROTOCOL | NONE`
- `addressabilityClaim` ∈ `ADDRESSABLE | CONVENTIONAL | NON_LOOP | null`
- `basis` — one of 8 governed bases
- `scope` — `system`, `sheet` / `applicableSheets`, `symbol`, `families`,
  `deviceClasses`, `populationIds`, `schedule`, `systemWide`
- `eligibility` — `reviewStatus`, `approvedForDownstream`, `extractionIsCurrent`,
  `supersededAt`, `rejected`
- `ambiguous`, `negative`
- `provenance` — `source`, `sourceLocation`, `authority`, `sourcePage`,
  `sourceDrawingNumber`, `evidenceVersionId`

A population carries `id`, `family`, optional governed `deviceClass`, `system`,
`drawingScope { sheets, symbols }`, and optionally `schedules`. Caller-supplied
`deviceClass` wins over `inferDeviceClass(family)`.

### 3.1 The 8 governed bases

`SAME_DRAWING_SYMBOL_SCOPE`, `SAME_DRAWING_SHEET_SCOPE`,
`EXPLICIT_LEGEND_REFERENCE`, `EXPLICIT_SCHEDULE_REFERENCE`,
`APPROVED_SYSTEM_WIDE_REQUIREMENT`, `EXPLICIT_DEVICE_FAMILY_SCOPE`,
`EXPLICIT_BOQ_RELATIONSHIP`, `HUMAN_ENGINEERING_DECISION`.

### 3.2 The 4 prohibited bases

`SAME_FIRE_ALARM_SYSTEM`, `SAME_MANUFACTURER`, `PRODUCT_FAMILY_GUESS`,
`SAME_DESCRIPTION`. A record using one is `NOT_APPLICABLE` under
`RULE_7_PROHIBITED_APPLICABILITY_BASIS` — it can never attach, no matter how
similar the population looks. Similarity is not applicability.

---

## §4 Rule order (first match wins, fail-closed throughout)

| Order | Rule | Effect |
|---|---|---|
| 1 | `RULE_1_EVIDENCE_NOT_ELIGIBLE` | not Approved / not approved-for-downstream → `NOT_APPLICABLE` |
| 2 | `RULE_2_EVIDENCE_NOT_CURRENT` | superseded / rejected / stale extraction → `NOT_APPLICABLE` |
| 3 | `RULE_5_NETWORK_ARCHITECTURE_…` | data-network wiring → `NOT_APPLICABLE` |
| 4 | `RULE_4_PROTOCOL_MENTION_…` | FlashScan/CLIP/IDP/SLC mention → `NOT_APPLICABLE` unless a governed relationship names populations |
| 5 | `RULE_3_NO_DEVICE_ADDRESSABILITY_CLAIM` | no device claim → `NOT_APPLICABLE` |
| 6 | `RULE_6_UNKNOWN_APPLICABILITY_BASIS` | unknown basis → `INSUFFICIENT_EVIDENCE` |
| 7 | `RULE_7_PROHIBITED_APPLICABILITY_BASIS` | prohibited basis → `NOT_APPLICABLE` |
| 8 | `RULE_8_IMPLICIT_SCOPE_IS_NOT_EVIDENCE` | declared system scope ≠ population system → `NOT_APPLICABLE` |
| 9 | `RULE_23_AMBIGUITY_…` | ambiguous/contested → `REQUIRES_ENGINEERING_REVIEW` |
| 10 | `RULE_26_SCOPE_UNDECLARED_FAILS_CLOSED` | no scope declared → `INSUFFICIENT_EVIDENCE` |
| 11 | basis-specific scope gates | drawing (9A/9B/10/11), schedule (12A/12B), family (13A/13B/14), system-wide (15/16/17), BOQ (18/19/20), human decision (21/22) |

Conflicts are resolved at the population level, never at the pair level
(`RULE_25`): two applicable claims that disagree produce
`ADDRESSABILITY_CONFLICT` with no winner. Never mention count, never recency,
never preferred system, never confidence.

---

## §5 Drawing scope and cross-sheet legends (never assumed, never global)

A legend entry governs **only** the sheet it was approved on, and — under
symbol scope — **only** the symbol it declares.

- same sheet + symbol in the population's governed scope → `CONFIRMED`
  (`RULE_9A`);
- same sheet, symbol not in scope → `NOT_APPLICABLE` (`RULE_9B`);
- different sheet → `NOT_APPLICABLE`; cross-sheet applicability is never implied;
- an explicit governed cross-sheet reference (`applicableSheets`) extends scope
  to the referenced sheet **only**; a bare "refer to drawing X" note with no
  governed reference model is **not** a cross-sheet link (`RULE_11`);
- a population with no governed sheet/symbol scope → `INSUFFICIENT_EVIDENCE`
  (`RULE_10`) — a BOQ item is never attached to a legend just because both are
  in the same project.

Live consequence: **0 of 90 populations on the acceptance project have any
governed sheet/symbol scope** (all 108 `boq_items` carry a null
`drawing_reference`), and **0 of 18 legend entries are approved**. There is
therefore no legend→population attachment path open on this project at all.

---

## §6 The system-wide gate (field devices only)

An approved system-wide addressability requirement may reach **field device
populations only**:

- `FIELD_DEVICE` — covered (`RULE_17`);
- `CONTROL_EQUIPMENT` (FACP, power supply, battery, loop card, detector base,
  enclosure, back box, GUI, network card) — `NOT_APPLICABLE` (`RULE_15`);
- `NOTIFICATION_APPLIANCE` / NAC (strobe, horn, horn/strobe, speaker) —
  `NOT_APPLICABLE` (`RULE_15`);
- unknown family/class — `INSUFFICIENT_EVIDENCE` (`RULE_16`), never a guess.

Live device-class census over the 34 populations that have a governed family:
24 `FIELD_DEVICE`, 7 `CONTROL_EQUIPMENT`, 3 `NOTIFICATION_APPLIANCE`.

---

## §7 Family-scoped evidence and the UNKNOWN family

A family-scoped requirement covers a population only when the population's
governed family is declared. A population whose family is `UNKNOWN` **stays
`INSUFFICIENT_EVIDENCE`** (`RULE_14`) rather than being matched by plausibility.
This is the explicit hand-off point to the family lane: the applicability layer
refuses to guess, and the family authority remains the only thing that can
unblock it.

---

## §8 Attachments and provenance (no naked `addressable = true`)

`planAddressabilityAttachments` deduplicates on the canonical
`evidenceId|populationId` key and returns, per pair, a full classification plus
`attachmentsToCreate`, `confirmedPairs`, `reviewPairs`, `rejectedPairs`. Each
attachment records: `key`, `evidenceId`, `populationId`, `basis`, `ruleId`,
`reason`, `policyVersion`, `addressabilityClaim`, `negative`, `scope`, and
`provenance` (`source`, `sourceLocation`, `authority`, `sourcePage`,
`sourceDrawingNumber`, `evidenceVersionId`).

`buildResolverObservation` refuses anything that is not a real attachment —
missing `evidenceId`, `populationId` or `addressabilityClaim` throws. The
observation it produces carries **only** `claims: { addressability }`; it never
carries a point-consumption, ecosystem or panel claim.

> The observation is deliberately population-scoped. The applicability layer has
> already validated drawing scope (retained on the attachment and in
> `meta.sheets`); re-declaring `scope.sheet` in the observation would re-trigger
> the resolver's own cross-sheet guard on callers that pass no drawing context.

---

## §9 Per-population resolution (the 5 population states)

`derivePopulationAddressability` returns
`applicableAddressabilityEvidence[] / rejectedEvidence[] / reviewRequiredEvidence[] / resolvedAddressability / resolutionState`, with priority:

1. `ADDRESSABILITY_CONFLICT` (disagreeing applicable claims, no winner),
2. `ADDRESSABILITY_REQUIRES_REVIEW` (a pending review question can overturn it —
   fail closed),
3. `ADDRESSABILITY_RESOLVED_ADDRESSABLE` / `…_NON_ADDRESSABLE`,
4. `ADDRESSABILITY_INSUFFICIENT_EVIDENCE`.

Two independent `CONVENTIONAL` sources resolve to `CONVENTIONAL` — only
*disagreement* is a conflict, not agreement.

---

## §10 Downstream handoff (attachment → 6C3 resolver → canonical classifier)

Governed attachments enter `resolveFireAlarmDeviceAuthority` as observations.
Measured behaviours, all pinned by tests:

- addressability-only attachment → `GOVERNED_ADDRESSABILITY_RESOLVED`, value
  `ADDRESSABLE`, population verdict `GOVERNED_ADDRESSABILITY_RESOLVED`;
- the family dimension stays `FAMILY_UNKNOWN` — **dimensions remain
  structurally independent**; an addressability attachment never invents a
  family;
- with a governed family observation as well, `classifyResolvedDeviceEvidence`
  yields `SLC_DETECTOR_POOL` × 1 point per device for
  `Addressable Smoke Detector`, and `NOT_SLC` × 0 for a FACP;
- with **no** governed family, the classifier returns `UNRESOLVED` and
  `unitsPerDevice: null` — addressability alone never manufactures a point.

---

## §11 Protocol and network mentions (the required negative)

`SLC_LOOP_EXISTS`-style protocol facts and data-network wiring facts never
attach to a population. They may only attach when they carry an **explicit
governed population relationship** (`EXPLICIT_BOQ_RELATIONSHIP` or
`HUMAN_ENGINEERING_DECISION` naming concrete populations), which is
`RULE_18`. Live: 48 protocol rows and 36 network rows produced 4,320 and 3,240
pair decisions respectively — **0 attachments**.

---

## §12 Idempotency

Re-planning identical inputs with the existing attachments present creates
nothing new and reproduces the identical classification ledger — live 0 → 0,
hypothetical 48 → 0, classifications byte-identical both times.

---

## §13 Human review questions

`addressabilityReviewQuestions` raises a question only where evidence genuinely
cannot resolve applicability, naming the evidence, the population and the
blocking reason. Live (hypothetical gate): 112 `INSUFFICIENT_EVIDENCE` pairs →
112 `ADDRESSABILITY_APPLICABILITY_REQUIRED` questions, e.g.

> Evidence `spec-requirement:…_requirement_1` (Specification requirement) makes
> an addressability claim but declares no population/device-class scope for
> `boqitem_2e960996…`; confirm the governed scope or record a human
> applicability decision.

---

## §14 Acceptance scenarios (24 rows, all passing)

| # | Scenario | Verdict |
|---|---|---|
| 35.1 | legend + matching symbol scope | `CONFIRMED_APPLICABLE`, attachment created |
| 35.2 | legend + unrelated sheet | `NOT_APPLICABLE`, no attachment |
| 35.3 | explicit governed cross-sheet reference | confirmed on referenced sheet only |
| 35.4 | system-wide addressable requirement + detector | `CONFIRMED_APPLICABLE` (`RULE_17`) |
| 35.5 | same requirement + FACP | `NOT_APPLICABLE` (`RULE_15`) |
| 35.6 | detector-scoped requirement + detector | `CONFIRMED_APPLICABLE` |
| 35.7 | detector-scoped requirement + module | `NOT_APPLICABLE` (`RULE_13B`) |
| 35.8 | family-dependent scope + UNKNOWN family | `INSUFFICIENT_EVIDENCE` (`RULE_14`) |
| 35.9 | protocol mention, no relationship | 0 attachments project-wide |
| 35.10 | protocol mention bound by governed relationship | attaches (`RULE_18`) |
| 35.11 | current approved evidence | eligible |
| 35.12 | superseded evidence | `NOT_APPLICABLE` (`RULE_2`) |
| 35.13 | pending / unapproved evidence | `NOT_APPLICABLE` (`RULE_1`) |
| 35.14 | conflicting applicable evidence | `ADDRESSABILITY_CONFLICT`, no winner |
| 35.15 | explicit conventional evidence | `ADDRESSABILITY_RESOLVED_NON_ADDRESSABLE` |
| 35.16 | schedule-linked device | confirmed via schedule basis |
| 35.17 | fuzzy schedule name | `NOT_APPLICABLE` |
| 35.18 | BOQ population, no drawing relationship | `INSUFFICIENT_EVIDENCE` (`RULE_10`) |
| 35.19 | one evidence, many in-scope populations | N attachments, one evidence row |
| 35.20 | reprocessing identical input | no duplicates |
| 35.21 | attachment → resolver | `GOVERNED_ADDRESSABILITY_RESOLVED` |
| 35.22 | attachment does not fabricate point consumption | asserted absent |
| 35.23 | improved evidence → demand recomputes | 0 → 12 known points, threshold moves |
| 35.24 | no effective change | demand identical, nothing invented |

## §15 Mandatory negatives (11 rows, all passing)

| # | Never happens | Pinned by |
|---|---|---|
| 36.1 | a legend applies to every drawing in the project | 35.2, scope tests |
| 36.2 | "the system shall be addressable" makes every FA device addressable | 35.5, system-wide gate test |
| 36.3 | same Fire Alarm system used as a basis | `RULE_7` |
| 36.4 | same description copies evidence onto another population | `RULE_7` |
| 36.5 | FlashScan / CLIP / IDP / SLC attaches to every population | 35.9, `RULE_4` |
| 36.6 | UNKNOWN family satisfies a family-scoped requirement | 35.8, `RULE_14` |
| 36.7 | addressable automatically means one point | 35.22, `RULE_3` claim shape |
| 36.8 | superseded evidence governs | `RULE_2` |
| 36.9 | rejected / pending evidence governs | `RULE_1` |
| 36.10 | an attachment selects an ecosystem | assertion on attachment + observation |
| 36.11 | an attachment selects a panel | assertion on attachment |

Plus governance aliases: manufacturer and product-family-guess bases never
establish scope; unknown basis fails closed; a scope-less claim fails closed
(`RULE_26`); supersession and pending are rejected on live shapes.

---

## §16 §37–§38 — before/after point demand and threshold neutrality

**Live governed state** (the only numbers that describe the project today):

| Goal | known | unknown | excluded | threshold | completeness | confidence | total |
|---|---|---|---|---|---|---|---|
| 6C replica (approved facts direct) | 0 | 2,422 | 7 pop / 7 units | `THRESHOLD_UNCERTAIN` | `INSUFFICIENT` | 0 | `null` |
| 6C3 resolver + 6C3A (live) | 0 | 2,422 | 7 pop / 7 units | `THRESHOLD_UNCERTAIN` | `INSUFFICIENT` | 0 | `null` |

AFTER is identical to BEFORE, and that is the required behaviour: the layer
created 0 governed attachments, so it may not move a single number. The 6C3A
before/after figures reproduce the 6C3 baseline exactly, which is itself a
regression proof that the new layer changes nothing it should not.

**Hypothetical dry run** (clearly labelled, *not* a claim about the project):
with only the approval/currency gate hypothetically satisfied for the current
(v3) addressability clauses, and every other value left live:

- 3 hypothetical evidence records (2 `SYSTEM_ARCHITECTURE`, 1 `NETWORK_ARCHITECTURE`);
- 270 pairs evaluated → **48 attachments** on **24 populations / 347 units**;
- pair census: 48 `CONFIRMED_APPLICABLE` (`RULE_17`), 90 `NOT_APPLICABLE`
  (`RULE_5` network), 20 `NOT_APPLICABLE` (`RULE_15` control/NAC), 112
  `INSUFFICIENT_EVIDENCE` (`RULE_16` unknown class);
- **point demand does not move**: of the 24 attached populations, **0** yield a
  canonical POOL point, because the canonical classifier owns consumption and
  none of those populations' governed families is a canonical SLC
  detector/module class.

That last line is the strongest live governance evidence in this lane: even
with 48 governed addressability attachments in hand, the point count stays
`0 / 2,422 unknown / THRESHOLD_UNCERTAIN`. The layer cannot inflate demand.

Threshold neutrality is therefore preserved: nothing in this lane optimises,
biases, or nudges a threshold.

---

## §27 The read-only live harness

`scripts/golden-6c3a-live-addressability-applicability.mjs` (new).

It opens the acceptance-project D1 read-only, verifies `PRAGMA quick_check`, and
reuses the GOLDEN-6C3 governed read path (`loadUnderstandingReviewRows`,
`safeUnderstandingReviewItem`, `currentFieldLevelUnderstandingFacts`) so the 90
populations are built exactly as the resolver sees them. It then:

1. inventories every evidence record that could carry an addressability claim;
2. classifies each candidate's eligibility and claim kind from the record's own
   fields (never from vocabulary presence alone);
3. runs the planner over eligible evidence × all populations (the pair ledger);
4. derives the per-population resolution and the 6C before/after demand;
5. runs the labelled hypothetical dry run and its pair matrix;
6. prints the per-population matrix, the idempotency check and the review
   questions.

## §28 The live evidence landscape, re-measured

| Source | Records | Eligible | Carries a device addressability claim |
|---|---|---|---|
| Drawing legend entries (project) | 18 (13 legends) | 0 approved | 0 |
| Approved drawing-architecture rows (scope `FIRE_ALARM`) | 244 | 244 | 0 |
| — of which `SLC_LOOP_EXISTS` (protocol) | 48 | 48 | 0 (protocol) |
| — of which `PANEL_NETWORK_LINK` + topology (network) | 36 | 36 | 0 (network) |
| — of which `LAYOUT_LEGEND_LINK`, `CROSS_SHEET_REFERENCE`, etc. | 160 | 160 | 0 (no claim) |
| Addressability-vocabulary specification requirements | 59 (v1/v2/v3) | 1 | 0 |
| Requirement-intelligence `Addressability:addressable` facts | 1 on a current profile version (12 rows exist across superseded profile versions) | 0 | 0 |
| Engineering device/address/point facts + relationships | 0 | 0 | 0 |
| **Total candidates** | **322** | **245** | **0** |

The decisive row is the specification corpus:

- On **superseded v2** the two system-level clauses (`…_requirement_53`
  "The fire detection and alarm system shall be addressable…" and
  `…_requirement_442` "the wiring … shall form a digital data network") **are**
  `Approved` + approved-for-downstream — but their extraction is superseded, so
  the currency gate (`RULE_2`) refuses them.
- On **current v3** the same clauses are re-issued as `Needs Review` /
  afd = 0 — so the eligibility gate (`RULE_1`) refuses them.
- The only `Approved` + afd row on current v3 (`…_requirement_197`) is a
  **product compliance clause** (a Honeywell IDP detector data-sheet item). Its
  claim kind is `NONE`: it is identity/product evidence, not a governed
  per-population addressability claim, so `RULE_3` refuses it.

A vendor mention, a loop-exists note, a legend description and a data-network
sentence all exist in quantity on this project. **None of them is a governed
device addressability claim.** That is why governed attachments are 0.

## §29 Pair-level matrix (live)

22,050 pairs, 0 attachments:

| Pairs | Decision |
|---|---|
| 14,490 | `NOT_APPLICABLE` / `RULE_3_NO_DEVICE_ADDRESSABILITY_CLAIM` |
| 4,320 | `NOT_APPLICABLE` / `RULE_4_PROTOCOL_MENTION_NOT_POPULATION_EVIDENCE` |
| 3,240 | `NOT_APPLICABLE` / `RULE_5_NETWORK_ARCHITECTURE_NOT_DEVICE_EVIDENCE` |

Per-population addressability resolution: **90 populations / 2,429 units
`ADDRESSABILITY_INSUFFICIENT_EVIDENCE`**.

## §31 Read-only discipline (proven)

- D1 opened with `DatabaseSync(path, { readOnly: true })`; `PRAGMA quick_check` =
  `ok` before any read.
- SHA-256 of the database file compared before and after the run — **identical**.
- Two consecutive runs produce **byte-identical output** once the
  `generatedAt` header line is excluded.
- No INSERT/UPDATE/DELETE anywhere in the harness; no schema, migration,
  snapshot, approval, attachment persistence, profile regeneration, deploy or
  commit.

## §32 Delivery checklist (19 deliverables)

| # | Deliverable | Where proven |
|---|---|---|
| 1 | Applicability decision engine, 4 states, fail-closed | §2, §4; tests `35.1`–`35.13` |
| 2 | Pair-level applicability matrix | §29; live 22,050 pairs |
| 3 | Per-population output shape (5 resolution states) | §9 |
| 4 | Every attachment provenance-complete (no naked `addressable`) | §8; `handoff:` tests |
| 5 | Legend scope: same sheet/symbol only, never global | §5; `35.1`–`35.3` |
| 6 | Cross-sheet: governed reference only; bare note rejected | §5; `RULE_11` test |
| 7 | System-wide gate: field devices only | §6; system-wide suite |
| 8 | Family-scope gate; UNKNOWN family stays INSUFFICIENT | §7; `35.6`–`35.8` |
| 9 | Protocol/network mentions never auto-attach | §11; live 48 + 36 rows |
| 10 | Prohibited bases (same system / manufacturer / family guess / description) | §3.2; `36.3`, `36.4` |
| 11 | Eligibility + currency gates (approved, afd, current) | §4; `35.11`–`35.13` |
| 12 | Conflict handling: no winner by count/recency/confidence | §4, §9; `35.14` |
| 13 | Negative (conventional) evidence governed correctly | §9; `35.15`, negative suite |
| 14 | Handoff through the 6C3 resolver, never a direct classifier call | §10; `35.21`–`35.22` |
| 15 | No point-consumption invention by this layer | §10, §16; `35.22`, `36.7` |
| 16 | Acceptance matrix (24) + mandatory negatives (11) + idempotency | §14, §15, §12 |
| 17 | Before/after 6C demand + threshold neutrality | §16 |
| 18 | Read-only live harness + determinism proof | §27, §31 |
| 19 | This delivery document + verdict | §32, §34 |

## §33 Verification

- `node --test tests/golden-6c3a-fire-alarm-addressability-applicability.test.mjs`
  → **67 pass, 0 fail**.
- Regression suites `golden-6b`, `golden-6c`, `golden-6c2`, `golden-6c3`,
  `golden-7a` + migration chain/baseline/static + taxonomy/SLC/attribute →
  **238 pass, 0 fail**.
- `npm run build` → green (ESM Worker artifact + hosting manifest present).
- ESLint on the three lane files → **0 problems**.
- `node scripts/authoritative-test-inventory.mjs --list` → lane test file
  present in the safe set.
- `node scripts/golden-6c3a-live-addressability-applicability.mjs` → read-only,
  `quick_check ok`, numbers in §1, §28, §29, §16; run twice, identical output.

## §34 Verdict

**CLOSED — "ADDRESSABILITY APPLICABILITY MECHANISM PROVEN; PROJECT EVIDENCE
REMAINS INCOMPLETE."**

The applicability & attachment layer is proven end to end: 67/67 tests green,
all regression gates green, build green, live read-only run deterministic and
provably non-writing, and a full pair-level ledger showing that the 322
addressability-capable records on the acceptance project yield **zero**
governed attachments — with a recorded reason for each of the 22,050 pair
decisions. The hypothetical dry run demonstrates the converse on live data: the
moment approval and currency are satisfied, the same mechanism attaches exactly
48 evidence→population pairs across 24 field-device populations, refuses
control equipment and NAC appliances, refuses network-architecture clauses,
leaves unknown families `INSUFFICIENT_EVIDENCE`, and still moves the point
count by **zero** because the canonical classifier owns consumption.

The evidence gap is real, measured and reported — never faked.

## §35 Files changed (lane only)

- `app/domain/fire-alarm-addressability-applicability.mjs` (new) — the layer.
- `tests/golden-6c3a-fire-alarm-addressability-applicability.test.mjs` (new) —
  67-test suite.
- `scripts/golden-6c3a-live-addressability-applicability.mjs` (new) — read-only
  live applicability/attachment inventory.
- `docs/GOLDEN-6C3A-GOVERNED-ADDRESSABILITY-APPLICABILITY-ATTACHMENT.md` (this
  document).

No existing production module, migration, fixture or golden evidence was
modified. Nothing was committed.

## §36 Remaining risk and the next smallest slice

Real, unresolved risk: with zero eligible addressability-claiming evidence, this
layer cannot attach anything live, so the point count legitimately stays
`THRESHOLD_UNCERTAIN` with no published total. Two upstream gaps, in order of
leverage:

1. **Review the current system-level clause.** The current v3 re-issue of
   "The fire detection and alarm system shall be addressable…" is
   `Needs Review`. Reviewing and approving that one current clause opens 48
   governed attachments across 24 field-device populations immediately — and,
   as the dry run proves, still yields 0 points, correctly.
2. **Bind populations to sheets.** With 0 of 90 populations carrying a
   `drawing_reference`, the entire legend/drawing-scope path (§5) is inert.
   Populating BOQ→drawing bindings is the prerequisite for legend-driven
   addressability.

Neither gap can be closed by this layer, and neither is guessed at here. The
next lane re-runs `scripts/golden-6c3a-live-addressability-applicability.mjs`
unchanged; the engine is already proven to consume whatever the evidence layer
records.
