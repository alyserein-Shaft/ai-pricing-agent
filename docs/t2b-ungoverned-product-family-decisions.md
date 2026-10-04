# T2b — Resolution of the 6 Ungoverned `productFamily` Expectations

Status: **ANALYSIS ONLY — no benchmark, production or corpus change made**
Date: 2026-10-02
Authority: `app/domain/fire-alarm-taxonomy.mjs`, `app/domain/fire-alarm-family-taxonomy.mjs`

No provider calls. No re-scoring. No test-suite runs beyond targeted resolver probes.
`.lore/EVIDENCE.md` intentionally untouched (another lane owns it).

---

## Decision table

| Case | Expected family (now) | Production resolver | Decision | Recommended expected | Reason | Human decision |
|---|---|---|---|---|---|---|
| **SYN-U-041** | `Loop Expander` | `normalize→null`; text→`null` | **REAL_TAXONOMY_GAP** | `null` (UNKNOWN) *pending* a family decision | No governed Fire Alarm family denotes a loop-capacity expander. `Loop Card` is a board inside a panel (Control Equipment, `NOT_SLC`); `Interface Module` deliberately asserts **no** address count; `Network Node`/`Repeater Panel` are network-tier. None is the same device. `category:"Peripheral"` is also not a production category. | **YES** — engineering: does a loop-expander family belong in this taxonomy? |
| **SYN-U-050** | `Multi Sensor Detector` | `normalize→null`; text→`null` | **GOVERNED_EQUIVALENT_EXISTS** | `Multi-Criteria Detector` | Production governs `Multi-Criteria Detector` (Detection Devices, `SLC_FIELD_DEVICE`) for exactly this device: its own catalogue parts are *"Multi-criteria photoelectric, thermal and infrared smoke detector"*. `medium:"combined"` is preserved. | **YES** — GT change, 2 cases |
| **SYN-U-051** | `Multi Sensor Detector` | `normalize→null`; text→**`Addressable Heat Detector`** ⚠ | **GOVERNED_EQUIVALENT_EXISTS** | `Multi-Criteria Detector` | Same device class as 050; the input *"Heat detector with smoke detection"* is a combined medium. ⚠ Production's own classifier currently resolves this input to `Addressable Heat Detector`, **dropping the smoke** — a production resolver defect, reported not fixed. | **YES** — GT change + production defect |
| **SYN-U-100** | `Addressable Detector` | `normalize→null`; text→`Isolator Base` | **BENCHMARK_GROUND_TRUTH_WRONG** | `null` (UNKNOWN) | `mustRemainUnknown` includes `medium`, so **no** specific detector family is determinable: smoke vs heat vs multi-criteria is exactly what is unknown. `Addressable Detector` asserts a resolution the case deliberately withholds. The case's real subject is `includesIsolator=true` (integral base), which is preserved. | **YES** — GT change to a *less* specific answer |
| **SYN-U-102** | `Mounting Bracket` | `normalize→null`; text→`null` | **GOVERNED_EQUIVALENT_EXISTS** | `Bracket` | `Bracket` is a governed Accessories family (`NOT_SLC`). `Mounting Bracket` is a naming variant of it, not a separate device. `isPrimaryProduct=false` preserved. ⚠ No production phrase reaches `Bracket` (see §Systemic finding). | **YES** — GT change |
| **SYN-U-150** | `Door Holder` | `normalize→null`; text→`null` | **BENCHMARK_GROUND_TRUTH_WRONG** + gap | `null` (UNKNOWN) | No Fire Alarm family governs a door holder. Worse, the expectation is **self-contradictory**: the case's own safety predicate exists to forbid *"classifying a door holder as a fire alarm device"*, yet it demands `productFamily="Door Holder"` under `system:"Fire Alarm"`. A door release accessory is not a governed fire-alarm family. | **YES** — GT **and** predicate change (only case coupled to a predicate) |
| **SYN-U-160** | `Addressable Detector` | `normalize→null`; text→`null` | **BENCHMARK_GROUND_TRUTH_WRONG** | `null` (UNKNOWN) | Same as 100: `medium` must remain unknown, so no detector family is determinable. The case's subject is `compatibilityStatus="CONFLICT"` (third-party protocol vs approved panel), which is preserved. | **YES** — GT change |
| **SYN-U-180** | `Fire Alarm Cable` | `normalize→null`; text→`null` | **REAL_TAXONOMY_GAP** | `null` (UNKNOWN) *pending* a family decision | The only governed cable-related name is `Cable Accessory`, which denotes an accessory **to** a cable (gland/cleat), not the cable. A 500 m FP fire-resistant cable is not a cable accessory — mapping there would be a wrong semantic, not a near-miss. `category:"Cable"` is also not a production category. | **YES** — engineering: does a cable family belong here? |

## Real taxonomy gaps (2 families, 2 cases)

1. **Loop expander** (SYN-U-041) — no governed family. Candidates all rejected on
   semantics, not convenience: `Loop Card` is in-panel (Control Equipment,
   `NOT_SLC`); `Interface Module` is a catch-all that production explicitly
   refuses to give an address count; `Network Node` / `Repeater Panel` are
   network-tier devices.
2. **Fire alarm cable** (SYN-U-180) — no governed family for a cable *itself*.
   `Cable Accessory` is a different object.

Both also carry a benchmark-only `category` (`Peripheral`, `Cable`) that is not one
of production's 7 categories.

## Benchmark ground-truth errors (4 cases)

| Case | Error | Correction direction |
|---|---|---|
| SYN-U-100 | `Addressable Detector` over-claims a family the case marks unknown | make **less** specific → `null` |
| SYN-U-160 | same over-claim | make less specific → `null` |
| SYN-U-150 | expects an ungoverned family *and* contradicts its own "not a fire alarm device" predicate | `null` **+ retarget the predicate** |
| SYN-U-102 | `Mounting Bracket` is a naming variant of governed `Bracket` | rename to canonical |

## Cases that should remain UNKNOWN / review (4)

`SYN-U-041`, `SYN-U-100`, `SYN-U-150`, `SYN-U-160` should carry
`productFamily: null` until a human decides otherwise. `SYN-U-180` joins them once
the cable-family question is settled.

**Coupling:** only **SYN-U-150** has a safety predicate bound to `productFamily`
(`FIELD_MUST_EQUAL "Door Holder"`). The other 7 have predicates on other fields
only (`medium`, `includesIsolator`, `isPrimaryProduct`, `compatibilityStatus`,
`conductorSizeMm2`), so their GT corrections are independent of the predicate set.

## Systemic finding (reported, NOT fixed — out of T2b scope)

**Governed family names that no phrase can ever reach.** Measured: `Bracket`,
`Mounting Base`, `Cable Accessory`, `Loop Card`, `Network Node` all resolve as
family *names* but `classifyFireAlarmFamilyFromText` returns `null` for every
plausible phrasing. This is the identical defect class production already fixed
once for `Bell` ("a declared Notification Devices family with zero phrases, so
the catalog's three genuine bell products could never classify").

This does **not** block the benchmark — the contract discloses family *names* to
the model, so a model can return `Bracket` without production's phrase matcher.
It does mean production's own classifier cannot reach these families from BOQ
text. Reported for a separate decision; no taxonomy change made here.

**Second, larger finding — `category` has the same defect `productFamily` had.**
The benchmark's 8 category values (`Detector`, `Notification`, `Control Panel`,
`Peripheral`, `Module`, `Annunciator`, `Accessory`, `Cable`) are **entirely
disjoint** from production's 7 categories (`Control Equipment`, `Detection
Devices`, `Notification Devices`, `Modules and Interfaces`, `Manual Initiation`,
`Power and Batteries`, `Accessories`). So `category` is free text, undisclosed,
and off-taxonomy — the identical contract defect just closed for `productFamily`,
still present in the neighbouring field. **Not touched in T2b**; it needs its own
slice and would change `category` accuracy for all tiers.

## Exact human decisions needed

1. **Loop expander (SYN-U-041):** create a governed family, or leave `productFamily`
   UNKNOWN? If created — which category, and does it consume an SLC address?
2. **Fire alarm cable (SYN-U-180):** create a governed family for a cable itself,
   or leave UNKNOWN? Confirm `Cable Accessory` must **not** absorb it.
3. **SYN-U-050 / SYN-U-051:** authorise `Multi Sensor Detector` →
   `Multi-Criteria Detector` as a `HUMAN_AUTHORISED_GROUND_TRUTH_CORRECTION`
   (2 cases).
4. **SYN-U-102:** authorise `Mounting Bracket` → `Bracket` (1 case).
5. **SYN-U-100 / SYN-U-160:** authorise reducing `Addressable Detector` → `null`,
   since `medium` is deliberately unknown (2 cases).
6. **SYN-U-150:** authorise `Door Holder` → `null` **and** retarget the
   `productFamily` predicate, which currently encodes the contradiction (1 case).
7. **Separately:** decide whether production should gain phrases for `Bracket`,
   `Mounting Base`, `Cable Accessory`, `Loop Card`, `Network Node` (the `Bell`
   defect class), and whether `category` gets its own contract-closure slice.

---

# T2c — APPLIED (2026-10-02)

All seven human decisions applied. Evidence class: **EXTERNAL FIRST-PARTY
MANUFACTURER EVIDENCE** (Honeywell/Farenhyt), supplied by the human reviewer.

## Corrections applied

| Case | Before | After | Basis |
|---|---|---|---|
| SYN-U-041 | `Loop Expander` | **`Loop Card`** | MANUFACTURER EVIDENCE. Farenhyt SLC expanders are panel loop-expansion cards/modules; in-panel + `NOT_SLC` does not distinguish them from the governed Loop Card concept. |
| SYN-U-050 | `Multi Sensor Detector` | **`Multi-Criteria Detector`** | Production governs this family for this exact device. |
| SYN-U-051 | `Multi Sensor Detector` | **`Multi-Criteria Detector`** | Same device class. |
| SYN-U-100 | `Addressable Detector` | **`null`** | `medium` is `mustRemainUnknown`; no specific detector family is determinable. |
| SYN-U-102 | `Mounting Bracket` | **`Bracket`** | Naming variant of a governed Accessories family. |
| SYN-U-150 | `Door Holder` | **`null`** + **PREDICATE RETRACTED** | See below. |
| SYN-U-160 | `Addressable Detector` | **`null`** | Same as 100. |
| SYN-U-180 | `Fire Alarm Cable` | **`null`** + gap pinned | Real taxonomy coverage gap; NOT mapped to `Cable Accessory`. |

### SYN-U-150 — a safety rule was retracted, not softened

The case asserted that *"classifying a door holder as a fire alarm device"* is a
safety violation. **That premise was false.** Honeywell sells electromagnetic door
holders FOR fire alarm systems and FACPs expose door-holder relay outputs, so a
door holder CAN legitimately be part of a fire alarm system. The old rule would
have penalised a **correct** answer.

Retracted: `FIELD_MUST_EQUAL isPrimaryProduct false` and
`FIELD_MUST_EQUAL productFamily "Door Holder"`, plus the prose that asserted the
false premise. Surviving rule is strictly narrower and taxonomy-grounded:
`FIELD_MUST_BE_UNKNOWN productFamily` — no governed Fire Alarm family exists, so
none may be asserted. `isPrimaryProduct: false` remains a plain **correctness**
expectation (a door holder is an accessory), which makes no safety claim.

## Verification (focused only)

- Predicate reconciliation: **29 prose rules -> 35 executable predicates -> 35
  mutation-proven**, 0 lint problems
- `KNOWN_UNGOVERNED_GROUND_TRUTH_FAMILIES` is now **EMPTY**; the gate is **retained**,
  and a regression test proves it still rejects a re-opened ungoverned family
- Focused suites **47/47**; `17f` key contract green; `17g` winnability green
- Retraction proof: honest UNKNOWN family **passes**; `Door Holder`, `Annunciator`
  and `Bell` all **fail** on the narrowed rule
- `Cable Accessory` **explicitly refused** on SYN-U-180 by both the
  must-be-unknown and not-equal predicates
- `17d` remains the pre-existing failure, proven independent in T2

## Lightning re-score (existing checkpoint, NO provider calls)

| Metric | Before | After | Delta |
|---|---|---|---|
| caseFullyCorrect | 3/33 | 3/33 | unchanged |
| productFamily correct | 7/33 | **8/33** | **+1** |
| fieldAccuracy (19 fields) | 0.8306 | **0.8339** | **+0.0033** |
| attributeAccuracy (excl. productFamily) | 0.9053 | 0.9053 | unchanged |

Operational metrics untouched: `MODEL_RESULT` 33, `TIMEOUT` 3, median 2961ms,
p90 59361ms.

**26 stored-wrong productFamily fields re-classified:** 21 still wrong because the
model returned UNKNOWN where a governed family is established · 4 genuine
misclassifications · **1 newly correct** (SYN-U-100, model said UNKNOWN and the
corrected ground truth is also UNKNOWN).

**Honest reading:** removing a 22% unfairness moved the score by 0.0033. The
correction was necessary for the benchmark to be *valid*, but it does not rescue
the corpus's difficulty — the dominant failure is unchanged and real: Lightning
returns UNKNOWN for a plainly stated family in 21 of 33 cases.

---

# T2d — `category` CONTRACT CLOSURE (2026-10-02)

## Production category contract

`category` is a **closed 7-value governed vocabulary** with **exact-name matching
only**. `normalizeFireAlarmCategory` is backed by a deliberately small alias map:

```
control equipment            -> Control Equipment
detection device(s)          -> Detection Devices
notification device(s)       -> Notification Devices
notification appliance       -> Notification Devices
modules and interfaces       -> Modules and Interfaces
manual initiation            -> Manual Initiation
power and batteries          -> Power and Batteries
accessories                  -> Accessories
```

`normalizeCategoryFamily` (system-knowledge-registry) passes category through
`pack.normalizeCategory`, and returns `null` for an unregistered system.

**All EIGHT benchmark category values were off-contract** — `normalizeFireAlarmCategory`
returns `null` for `Detector`, `Notification`, `Control Panel`, `Peripheral`,
`Module`, `Annunciator`, `Accessory`, `Cable`. Two of them (`Annunciator`,
`Control Panel`) are **FAMILY** names, so the benchmark had conflated the two
taxonomy levels.

## Corrections applied

- **26 cases** — category derived *mechanically* from production via
  `fireAlarmCategoryForFamily(normalizeFireAlarmFamily(family))`. No hand mapping.
- **9 cases** — decided from the input text: 060/100/130/140/160 → `Detection Devices`,
  170 → `Modules and Interfaces`, 150 → `Accessories` (**judgment call**: a door
  holder has no governed family, but `Accessories` is the governed domain for
  non-primary devices).
- **1 case left NULL as a visible gap** — SYN-U-180 (a cable). No governed category
  exists; the only cable-adjacent name is the FAMILY `Cable Accessory`, which
  denotes an accessory *to* a cable. Forcing `Accessories` would be a guess, so it
  is pinned in `KNOWN_UNGOVERNED_EXPECTED_CATEGORIES` (empty list + retained gate)
  exactly as the productFamily gap was handled.
- 190/191 remain `null` (non-descriptive input).

Result: 34 category values rewritten. Distribution is now Detection Devices 16,
Notification Devices 7, Control Equipment 3, Modules and Interfaces 4,
Accessories 2, null 4. Zero off-taxonomy values remain.

## Focused tests (A–F) — `tests/boq-category-equivalence.test.mjs`, 9/9

| | Assertion |
|---|---|
| A | contract discloses exactly production's 7 categories, read live |
| B | canonical category scores correct **through the real scorer** |
| C | production-supported aliases normalise (`detection device`, `notification appliance`); the 8 old values provably do **not** |
| D | all 42 ordered pairs of distinct governed categories are non-equivalent; conflated family/category pairs stay apart |
| E | UNKNOWN never equals a governed category; two unknowns are correct on the correctness axis |
| F | gate rejects a re-opened off-contract value; every GT category governed-or-null |

Focused total **56/56**; `17f`/`17g` green; predicates reconcile 29 → 35 → 35
mutation-proven, 0 lint.

## Lightning before → after (no provider calls)

| Metric | Before | After | Delta |
|---|---|---|---|
| category correct | 31/33 | 31/33 | unchanged |
| productFamily correct | 7/33 | 8/33 | +1 |
| caseFullyCorrect | 3/33 | 3/33 | unchanged |
| fieldAccuracy (19 fields) | 0.8306 | 0.8339 | +0.0033 |
| attributeAccuracy (excl. both taxonomy fields) | 0.8996 | 0.8996 | unchanged |
| unknownPreservation | 0.9636 | 0.9636 | unchanged |

Operational untouched: `MODEL_RESULT` 33, `TIMEOUT` 3, median 2961ms, p90 59361ms.

## Category error decomposition (2 previously wrong)

| Class | Count |
|---|---|
| `BENCHMARK_CONTRACT_ERROR` | **2** |
| `TRUE_CLASSIFICATION_ERROR` | 0 |
| `GOVERNED_ALIAS_EQUIVALENT` | 0 |
| `EXPECTED_UNKNOWN_ERROR` | 0 |
| `TAXONOMY_GAP` | 0 |
| `OTHER_REAL_ERROR` | 0 |

Both: SYN-U-041 model said `Module` (new GT `Control Equipment`) and SYN-U-102
model said `Module` (new GT `Accessories`) — both off-contract values the old
prompt taught the model, so neither is a defensible capability signal.

## Self-correction

My first T2d re-score reported fieldAccuracy 0.8306 → **0.9116** and
attributeAccuracy → **1.0**. That was a **bug in my script**, not a result: the
`kept` array dropped every wrong field that was *not* category/productFamily, and
the BEFORE/AFTER attribute denominators used different field sets. Corrected to a
like-for-like comparison, the true movement is +0.0033. The inflated number was
never reported as a finding.

## Remaining blocker

**The recorded Lightning answers were elicited under the OLD, off-contract category
prompt.** The model was offered `Detector`/`Module`/etc. — never the 7 governed
categories — so its 2 category errors are measured against a vocabulary it was
never shown. categoryAccuracy is now *correctly specified* but **not yet
re-measured**. Lightning's semantic numbers should be considered
`PRE-CATEGORY-CONTRACT` until re-run.
