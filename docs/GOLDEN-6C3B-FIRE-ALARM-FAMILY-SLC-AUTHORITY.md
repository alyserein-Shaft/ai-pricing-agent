# GOLDEN-6C3B — Governed Fire Alarm Device Family Authority & SLC Classifier Resolution

- Lineage: 6C → 6C2 → 6C3 → 6C3A → 6C3A1 → **6C3B (this lane)**.
- Verdict: **CLOSED — DEVICE FAMILY / SLC CLASSIFIER CONTRACT PROVEN;
  POINT-CONSUMPTION EVIDENCE REMAINS INCOMPLETE.** See §57.
- Write declaration: **no live business state was written.** No requirement
  approval, no family-fact approval, no attachment, no point-demand persistence,
  no preliminary snapshot, no panel-sizing snapshot, no ecosystem or product
  selection, no commit, push, deploy or restart. Live D1 was opened read-only
  for census queries only; its SHA-256 is unchanged.

---

## §1 Verdict

The four governed families the classifier refused are now **recognized**, and
**no point is fabricated for any of them**. That is the whole result, and it is
honestly partial:

> before: the classifier refused `Duct Detector`, `Manual Call Point` and
> `Interface Module` as though they had no role at all
> after: each is classified with a governed SLC role, and its point consumption
> is withheld because this repository evidences none

Known point demand is still **0**. That is not a shortfall in this lane; it is
the finding. See §9.

---

## §2 Two defects, and the second is the deeper one

### 🔴 Defect A — a divergent duplicate of the real taxonomy

`classifyFireAlarmSlcItem` carried five hardcoded family sets. Measured against
the live schema's 44 `product_families` rows:

| Divergence | Count | Examples |
|---|---:|---|
| Classifier names absent from `product_families` | 15 | `Input Module`, `Heat Detector`, `Smoke Detector`, `Horn`, `Break Glass Unit` |
| Canonical families unmapped by the classifier | 18 | `Beam Detector`, `Carbon Monoxide Detector`, `Annunciator`, `Firefighter Telephone`, `Booster Power Supply` |
| Names they shared, disagreeing on punctuation | even accepted ones | canonical `multi criteria detector` vs classifier `Multi-Criteria Detector` |
| Canonical families parked in `UNRESOLVED` | 8 | `Duct Detector`, `Manual Call Point`, `Pull Station`, `Interface Module`, `Strobe`, `Sounder`, `Bell`, `Speaker` |

The punctuation case is the sharpest: the classifier compared `String(family).trim()`
verbatim and **case-sensitively**, while `product_families.normalized_name` is
lowercased and separator-stripped. So even a family the classifier *accepted*
was unreachable when driven from the governed table.

### 🔴 Defect B — SLC role and point consumption were the same decision

A family was either accepted with a hardcoded `unitsPerDevice: 1`, or refused
outright. Two consequences:

1. A governed canonical family was unreachable whenever its consumption was not
   evidenced — which conflates "I do not know how many addresses this uses" with
   "I do not know what this device is".
2. **This repository records no point-consumption evidence at all.** `unitsPerDevice`
   appears only as a literal inside the classifier. There is no
   `product_attributes`, `engineering_facts` or `product_families` field
   anywhere that records SLC address consumption. The existing 1:1 contract has
   *test* authority (6C3's suite, and the capacity calculator's cited
   IFP-2100/6815 evidence) — but only for the family strings that suite already
   covers.

---

## §3 Deliverable 1 — the current rejection inventory (§5)

Re-measured live; nothing carried over from the 6C3A1 report. 90 Fire Alarm
populations / 2,429 units. Raw description, resolved family, provenance, and
verdict for every refusal:

| Family | Pop | Units | Raw BOQ description | Family provenance | Addressing | Verdict |
|---|---:|---:|---|---|---|---|
| *(no governed family)* | 56 | 1,776 | "Smoke detectors (above ceiling)", "Heat detector", … | field-level-confirmed | `MISSING` | `UNRESOLVED` — "Governed Fire Alarm system and family are required." |
| **Strobe** | 3 | 299 | "Loop powered strobes" | field-level-confirmed | `MISSING` | `UNRESOLVED` |
| **Manual Call Point** | 11 | 157 | "Fire alarm manual station", "…(weather proof)" | whole-blob-approved + field-level-confirmed | `MISSING` | `UNRESOLVED` |
| **Interface Module** | 7 | 136 | "Interface module control", "Interface module monitor" | whole-blob-approved | `MISSING` | `UNRESOLVED` |
| **Duct Detector** | 3 | 39 | "Duct detector" | field-level + whole-blob | `MISSING` | `UNRESOLVED` |
| **Heat Detector** | 3 | 15 | "Heat detector" | whole-blob-approved | `MISSING` | `UNRESOLVED` |
| Fire Alarm Control Panel | 7 | 7 | — | — | — | `NOT_SLC`, demand 0 |

**Two corrections to the 6C3A1 baseline, both from re-measurement:**

- It is **five** refused named families, not four. `Strobe` is a fifth; the 6C3A1
  24-attachment set only contained four because `Strobe` is a
  `NOTIFICATION_APPLIANCE` and 6C3A's system-wide gate correctly excludes it.
- `productFamily` on the live populations carries
  `{"value":"Manual Call Point","origin":"INFERRED","confidence":70}`, and the
  population's own `addressing` attribute is `MISSING`. The `addressable` value
  in the governed scenario comes from the **6C3A clause attachment**, not from
  the population. That is the correct authority split, and it is why §18's
  "family + addressability" composition matters.

---

## §4 Deliverables 2–5 — authority, resolver and taxonomy traces

**§6 family authority.** Not introduced here. A family reaches the classifier
only through a governed `deviceFamily` observation consumed by
`fire-alarm-device-evidence-resolver.mjs`, which is 6C3's `GOVERNED_FAMILY_RESOLVED`
dimension. The test suite asserts this by giving every population a *governed
observation* rather than a `family` field — writing `family:` onto a population
would bypass the authority this lane is proving.

**§7 6C3 resolver.** Preserved. Identity, family, addressability and point
consumption remain four independent dimensions; `candidates.family` is the
family hand-off and `candidates.attributes.addressing` the addressability
hand-off, and the classifier receives both plus attributes.

**§11 canonical taxonomy.** `product_families.engineering_domain` is the
repository's own grouping, and it is what the new mapping derives from:

| Domain | SLC role |
|---|---|
| Detection Devices | `SLC_FIELD_DEVICE` |
| Manual Initiation | `SLC_FIELD_DEVICE` |
| Modules and Interfaces | `SLC_MODULE` |
| Control Equipment | `NOT_SLC` |
| Accessories | `NOT_SLC` |
| Power and Batteries | `NOT_SLC` |
| Notification Devices | `NOT_SLC` |

**One deliberate per-family exception**, enumerated in the test rather than
hidden: `Detector Base`, `Isolator Base` and `Sounder Base` are filed under
`Detection Devices` because they are detector-*related*, but a base is a mounting
accessory and consumes no SLC address. A2 asserts the mapping agrees with the
domain **except** for these three, and asserts each really is `NOT_SLC`.

---

## §5 Deliverable 6 — exact rejection causes (§10)

| Family | Cause | Category |
|---|---|---|
| `Duct Detector` | canonical, parked in `UNRESOLVED_FAMILIES` | **F** — deliberate exclusion, but unjustified by any consumption or role argument |
| `Manual Call Point` | canonical, parked | **F** |
| `Interface Module` | canonical, parked | **F** |
| `Heat Detector` / `Smoke Detector` | canonical, parked; and the classifier's *accepted* set spells them `Addressable Heat Detector` | **A + B** — name mismatch compounded by deliberate parking |
| `Pull Station`, `Strobe`, `Sounder`, `Bell`, `Speaker` | canonical, parked | **F** (and for these, correct to keep out of a pool) |
| 56 populations with no family | no governed family at all | family-authority gap — out of scope here, and 6C3A2/6C3B territory |
| `Beam Detector`, `Carbon Monoxide Detector`, `Annunciator`, … | absent from all five sets | **C** — unsupported canonical family |

**None is category E (classifier bug) in the arithmetic sense, and none is
category G solved by reclassification.** §15's question — does the repository
already have a 1:1 rule for these families? — answers **no**: the rule exists
only as a literal for the two pools 6C3 already tested.

---

## §6 What changed (§55)

**New:** `app/domain/fire-alarm-family-taxonomy.mjs` — the canonical family →
SLC role boundary, with normalization and per-family exceptions.

**Modified:** `app/domain/fire-alarm-slc-resource-classifier.mjs` — consumes the
taxonomy, carries `slcRole` on every output, and adds one state.
Version `1.0.0 → 1.1.0`.

**Not touched by this lane:** 6C3A applicability, the 6C3 resolver, the 6C
demand engine, the panel-sizing API, any schema, any migration.
**§42:** the 6C3A attachment count is 24 before and after.

> **A note on `worker/technical-requirement-api.mjs`.** It is dirty in this tree,
> but that is a **concurrent lane's** +434-line refactor, not this lane's. It
> matters here for one reason: that refactor embeds
> `slcClassifierVersion` in the requirement-profile **input fingerprint**, and
> profile reuse is skipped only when the fingerprint is unchanged. So bumping the
> classifier to `1.1.0` means existing requirement profiles will not match their
> fingerprint and will be re-evaluated on next generation.
>
> That is almost certainly the *correct* behaviour — a changed classifier should
> invalidate a cached profile that embedded the old one — and the lane's 40
> requirement-profile tests pass. But it is a real downstream effect of a version
> bump, so it is stated rather than left to be discovered. No profile is
> regenerated, superseded or written by this lane.

### The one new state, and why

```
SLC_ROLE_ESTABLISHED
```

> The family's role on the signalling loop is governed and known; the number of
> SLC addresses a unit consumes is not evidenced anywhere in this repository.

It carries `unitsPerDevice: null` and `demandUnits: null`, deliberately. Its
safety is structural, not aspirational:

| Consumer | Behaviour with the new state |
|---|---|
| 6C preliminary demand | `demandClass` falls through its own `|| "UNKNOWN_NEEDS_REVIEW"` → **unknown, never zero** |
| Panel sizing | `!["SLC_DETECTOR_POOL","SLC_MODULE_POOL"].includes(state)` → `CURRENT_SLC_CLASSIFICATION_REQUIRED`, so it **cannot be allocated** |
| `technical-requirement-api` | passes the classification through, no pool membership implied |

---

## §7 Two mistakes I made and corrected

Recording these because both would have been silent damage.

**1. I made notification families `NOT_SLC` first.** That booked 149 units of
strobes/sounders as a **settled zero**, destroying the existing 6C contract that
they "stay visible as unresolved until addressable evidence exists". Three
existing tests caught it. Fixed by removing `|| slcRole === "NOT_SLC"` from the
exclusion gate: the taxonomy *records* a `NOT_SLC` role for notification and
control families, but the **exclusion decision stays with the established
governed sets**, because reclassifying a family out of `UNRESOLVED` moves its
units from `unknown` into zero, and that is a decision this lane must not make.

**2. I had to correct three pre-existing contract assertions.** These were
deliberate, not accidents:

| Assertion | Change | Why |
|---|---|---|
| `SLC_RESOURCE_CLASSIFIER_VERSION === 1.0.0` (2 sites) | → `1.1.0` | deliberate version bump |
| `SLC_RESOURCE_STATES` deep-equals 4 states | + `SLC_ROLE_ESTABLISHED` | the coupling fix; the R7-P2 test exists to police the vocabulary, so it had to be amended explicitly |
| `Manual Call Point → UNRESOLVED` | → `SLC_ROLE_ESTABLISHED`, **plus** new assertions that `unitsPerDevice`/`demandUnits` are `null` | the intended change — and "remains non-demand", the property that case protects, is now asserted *more* strongly, not less |

---

## §8 §38 runtime proof — the full production chain

`tests/golden-6c3b-fire-alarm-family-authority.test.mjs`, 21 tests, real
`drizzle-active/` schema, and the **actual production chain in order**:
6C3A applicability → 6C3 resolver → `classifyFireAlarmSlcItem` → 6C demand.
Only the population fixtures are authored; the taxonomy fixture is transcribed
verbatim from the governed table.

---

## §9 §41 — the 24-population / 347-unit re-run

Run through the unchanged 6C3A1 live harness (§7f), on the live census:

| Measure | Value |
|---|---|
| 6C3A attachments | **24** — unchanged, on 24 populations / 347 units |
| Family-resolved populations | 34 / 90 |
| **SLC role established** | **24** |
| SLC pool classified | 0 |
| Consumption known (real points) | **0** |
| Settled-excluded (0 points) | 7 — the FACPs; *absence* of a point, not knowledge of consumption |
| Consumption unknown | 83 |
| 6C known point demand | **0** |
| 6C unknown point demand | **2,422** |
| `preliminaryTotalPoints` | `null` |
| Completeness / threshold | `INSUFFICIENT` / **`THRESHOLD_UNCERTAIN`** |
| Sizing input usable | **false** |

All 24 attached populations: `SLC_ROLE_ESTABLISHED / UNKNOWN_NEEDS_REVIEW`,
`addr=addressable`, point `null` — 11 Manual Call Point, 7 Interface Module,
3 Duct Detector, 3 Heat Detector.

**The threshold did not move** (§28). And the test suite proves *why* rather than
asserting it: a fixture containing a pre-existing consumption-contract family
does resolve to `WITHIN_THRESHOLD_CONFIRMED`, and removing that one family
returns it to `THRESHOLD_UNCERTAIN` with 44 units still unknown. The flip is
driven by known points, and this lane creates none.

---

## §10 Deliverable 9 — point-consumption authority matrix

| Family | Role | Consumption authority | Demand |
|---|---|---|---|
| `Addressable Smoke Detector` | `SLC_FIELD_DEVICE` | **established** (6C3 test contract) | 1/device |
| `Addressable Heat Detector` | `SLC_FIELD_DEVICE` | **established** | 1/device |
| `Multi-Criteria Detector` | `SLC_FIELD_DEVICE` | **established** | 1/device |
| `Monitor`/`Control`/`Input`/`Output`/`Relay`/`Isolator`/`Zone` Module | `SLC_MODULE` | **established** | 1/device |
| `Duct Detector`, `Heat Detector`, `Smoke Detector`, `Manual Call Point`, `Pull Station` | `SLC_FIELD_DEVICE` | **none** | withheld |
| `Interface Module` | `SLC_MODULE` | **none** — and see §11 | withheld |
| everything else | `NOT_SLC` / `UNRESOLVED` | n/a | 0 or withheld |

---

## §11 §22 / §24 — Interface Module and multi-address safety

`Interface Module` gets a module **role** and never a point count, because a
single input, a dual input, an input/output module and a multi-module assembly
all share that name and consume different numbers of addresses. The classifier
says so in its own reason string, and records
`provenance.consumptionAuthority: null`.

The multi-address guard is unchanged and still runs **first**, before any role
is consulted — `channel_count`, `address_count`, `slc_point_count`,
`point_count`, `points_per_device > 1`, or an explicit multi/dual-address mode
all resolve to `UNRESOLVED` with a null demand.

---

## §12 §52 / §53 — acceptance and negatives

21 executable assertions. All ten §53 negatives are covered:

| Negative | Where |
|---|---|
| family = detector ⇏ one point | B1, B2, C3 |
| addressable ⇏ one point | B1, C6 |
| addressable ⇏ family | B5, C6 |
| same system ⇏ family | C5 |
| same manufacturer ⇏ family | C5 (role comes only from the taxonomy) |
| description similarity ⇏ family | C5 — `"Detector"`, `"Module"` are not families |
| family known ⇏ override explicit non-addressable | C7 — proven at the **resolver**, where negative evidence actually lives |
| family known ⇏ ecosystem selection | D2 — no vendor string in any attachment |
| SLC eligible ⇏ sizing-ready | C8 — panel sizing fails closed |
| consumption unknown ⇏ zero | B3, B4 — `UNKNOWN_NEEDS_REVIEW`, 44 unknown units |

**§33 negative families** (C1, C2): FACP, Loop Card, Annunciator, Firefighter
Telephone, Printer, Battery, Power Supply, Booster Power Supply, Battery Charger,
Detector Base, Sounder Base, Isolator Base, Enclosure, Back Box, Bracket,
End-of-Line Device, Strobe, Sounder, Speaker, Horn, Bell — none becomes an SLC
field point, and the notification families additionally stay *unresolved* rather
than being settled at zero.

**§43 determinism** (D1): repeated runs byte-stable, and a reversed population
order produces an identical per-id result.

---

## §13 Deliverable 18 — files changed

| File | Change |
|---|---|
| `app/domain/fire-alarm-family-taxonomy.mjs` | **new** — canonical family → SLC role boundary |
| `app/domain/fire-alarm-slc-resource-classifier.mjs` | consumes the taxonomy, adds `slcRole` + `SLC_ROLE_ESTABLISHED`, version 1.1.0 |
| `tests/golden-6c3b-fire-alarm-family-authority.test.mjs` | **new** — 21 tests |
| `scripts/golden-6c3a1-live-clause-review.mjs` | added §7f family/classifier re-run |
| `tests/r7-p2-slc-resource-quantity.test.mjs` | 3 contract assertions updated (§7) |
| `tests/golden-6c3-fire-alarm-device-evidence-authority.test.mjs` | 1 version assertion updated |
| `tests/golden-7a3b-honeywell-brand-registry.test.mjs` | C1 rewritten — see below |

**On that last one:** GOLDEN-7A3B had found that `promoteProductIdentity` selected
`v.file_name`, a column the real `document_versions` does not have, making
promotion unrunnable. **A concurrent lane has since fixed it** to
`v.original_filename AS file_name`. My test asserted the throw, so it failed —
correctly. C1 now asserts the query resolves *and* that the brand is still lost,
which is the finding that survived. I removed the now-unnecessary disposable
`ALTER TABLE`; the brand-blindness evidence is stronger for being demonstrable on
the real schema with no repair at all.

---

## §14 Deliverable 19 — tests / lint / build

| Check | Result |
|---|---|
| `tests/golden-6c3b-fire-alarm-family-authority.test.mjs` | **21/21** |
| 6B / 6C / 6C2 / 6C3 / 6C3A / 6C3A1 / 6C3B / 6 + SLC + taxonomy + attribute + migration-chain + 7A + 7A3B | **409/409** |
| Drawing intelligence regressions (8 suites, shared taxonomy) | **112/112** |
| 7A3B + 7A3B1 | **31/31** |
| Requirement-profile suites (classifier version is in the profile fingerprint) | **40/40** |
| `npx eslint` on all 7 touched files | **0 problems** |
| `npm run build` | **passes** |
| Live harness determinism | two runs byte-identical excluding `generatedAt`; **0** write attempts; SHA-256 unchanged |

**Pre-existing/concurrent, separated from regressions:** the 11 documented skips
in `tests/identity-resolution-governance.test.mjs` are explicit reason-stated
retirements from another lane, not failures and not mine. The one failure
observed during the sweep — 7A3B's C1 — was a concurrent lane fixing the defect
that test asserts, and is addressed in §13 rather than suppressed.

---

## §15 §58 — gate answers

> **A. Are the 24 addressability-governed populations classified correctly by
> family/SLC role?**
> **Yes.** All 24 resolve a governed family, and all 24 now carry an
> established SLC role (`Manual Call Point` and `Duct Detector`/`Heat Detector`
> → `SLC_FIELD_DEVICE`; `Interface Module` → `SLC_MODULE`). None is refused for
> naming reasons any more.
>
> **B. For how many is point consumption actually known?**
> **0.** Not one of the 24 has consumption evidence in this repository. (The 7
> FACPs are *settled-excluded* at 0, which is an absence of a point, not a
> knowledge of consumption — the harness reports the two separately for exactly
> this reason.)
>
> **C. For how many is it still unknown?**
> **83 of 90 populations** — the 24 attached, the 56 with no governed family, and
> the 3 loop-powered strobes. 2,422 units.
>
> **D. Does `preliminaryTotalPoints` become calculable?**
> **No.** `null`, completeness `INSUFFICIENT`, and `preliminarySizingInput(...).usable === false`.
>
> **E. Does `THRESHOLD_UNCERTAIN` remain?**
> **Yes** — and it was not chased; §9 proves the threshold only follows *known*
> points, and this lane creates none.
>
> **F. Which gaps remain, by kind?**
>
> | Kind | What is actually missing |
> |---|---|
> | **Point-consumption evidence** | Governed evidence of SLC addresses per unit for `Duct Detector`, `Heat Detector`, `Manual Call Point`, `Interface Module`, and the 2,422 units behind 56 unresolved families. **This is now the single binding blocker.** |
> | **Drawing binding** | 108 BOQ items with `drawing_reference = null`; 0 of 90 populations carry sheet/symbol scope, so the legend path stays `RULE_10`. → **6C3A2** |
> | **Human review** | `requirement_53` on the current v3 extraction still needs its signature (6C3A1). Family facts are `origin: INFERRED, confidence: 70` and would benefit from confirmation, but no *family* currently blocks. |

**Proceed in parallel to GOLDEN-6C3A2.** The family/classifier mechanism is
closed; drawing binding is independent of it and unblocked.

**Do not proceed to GOLDEN-6D.** Complexity requires a preliminary point-demand
picture that is sufficiently resolved to be meaningful, and this one is
`INSUFFICIENT` with a null total. Defining the next slice from the actual
unresolved evidence — *what does a duct detector, a manual call point and an
interface module each consume, and who is authorized to record that* — rather
than assuming one address per addressable device, which is precisely the
fabrication this lane refused.

---

## §16 §57 closure

**CLOSED — DEVICE FAMILY / SLC CLASSIFIER CONTRACT PROVEN; POINT-CONSUMPTION
EVIDENCE REMAINS INCOMPLETE.**

| Condition | Met |
|---|---|
| governed family evidence → canonical family → deterministic classifier behaviour, end to end | ✔ on a real schema through the real chain |
| every rejection caused *solely* by incompatible naming/taxonomy eliminated where the family is governed | ✔ `Duct Detector`, `Manual Call Point`, `Interface Module`, `Heat Detector` all now classify; the case/punctuation divergence is fixed at a normalization boundary, not with scattered aliases |
| no point consumption fabricated | ✔ `unitsPerDevice: null`, `demandUnits: null`, booked as **unknown**; 0 known points created |
| 6C contract preserved (`known`/`unknown`/`excluded`, `unknown ≠ zero`) | ✔ 44 unknown units in the fixture, 2,422 live |
| panel sizing still fails closed | ✔ `CURRENT_SLC_CLASSIFICATION_REQUIRED` |

Not `CLOSED — GOVERNED FIRE ALARM DEVICE FAMILY → SLC CLASSIFIER AUTHORITY
PROVEN`, because that phrasing would imply point consumption was resolved too. It
was not, and the honest consequence is that 6C point demand is unchanged — which
is the single most important thing this lane has to say.

> No live family-fact or requirement approval, attachment creation, point-demand
> persistence, panel-sizing snapshot, ecosystem or product selection, matching,
> pricing, quotation mutation, commit, push, deployment or restart was performed.
