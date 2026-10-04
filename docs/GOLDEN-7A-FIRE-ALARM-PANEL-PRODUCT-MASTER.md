# GOLDEN-7A — Fire Alarm Panel Product Master & Capability Normalization

## 1. Verdict

```
CLOSED — PRODUCT MASTER MECHANISM PROVEN;
MANUFACTURER DATA COVERAGE INCOMPLETE
```

The mission's own alternative verdict is the accurate one. The **mechanism** is
proven: a governed, evidence-only panel capability normalizer, 21/21 green, that
keeps manufacturer / brand / ecosystem / family / model as four separate levels and
never lets a product capability become a project requirement or a selection.

**Coverage is not complete, and I did not force it.** Measured against the live
governed library (§12): of the four target ecosystems, **three have no governed
products at all**.

| Target ecosystem | Governed panel products |
|---|---|
| Honeywell **Farenhyt** | **10** |
| Honeywell **Gamewell-FCI** | **0** |
| **Gent** by Honeywell | **0** |
| **Simplex** | **0** |

## 2. Parallel-lane boundary (§2)

Respected. This slice runs strictly bottom-up:

```
Manufacturer/Product Evidence → Identity → Ecosystem → Capabilities
→ Expansion → Lifecycle → Matching-Ready Product Master
```

It has **no input** for project point demand, building, BOQ line, compliance regime
or preferred brand, so it structurally cannot duplicate or override the
project-side lane. The two lanes meet at exact product selection (GOLDEN-7B).

## 3. §20 — Existing product-master architecture trace

**The canonical product master already exists and is comprehensive. No new table
was created, and none was needed.** 35+ product tables, including:

| Dimension (§20) | Canonical structure | Verdict |
|---|---|---|
| manufacturer / brand / family | `product_manufacturers`, `product_brands`, `product_families` | ✅ |
| model / part number | `canonical_library_products` (`part_number`, `normalized_part_number`) | ✅ |
| variants & dedup | `product_variants`, `product_aliases` | ✅ (present, empty) |
| attributes | `product_attributes` + inline `attributes` JSON | ✅ |
| certifications (§12/§13) | `product_certifications` (`certification_type`, `standard_body`, `standard_number`, `part`, `revision_year`, **`scope`**, `region`, `evidence_location`, `status`, `confidence`) | ✅ |
| relationships / accessories (§10/§11) | `product_accessories` (`relationship_type`, `quantity_rule`, `condition_json`, `included`, `separately_priced`) | ✅ |
| packages / components | `product_packages`, `product_package_components` | ✅ |
| lifecycle (§16) | `product_lifecycle_events` (`lifecycle_status`, `replacement_candidates`, `source_location`) | ✅ |
| sources / raw evidence (§17/§22) | `product_sources`, `product_source_evidence` (`original_text`, `cells`, `page`), `product_documents` | ✅ |
| conflicts (§18) | `product_conflicts` | ✅ |
| device compatibility (§15) | `product_compatibility` | ✅ |
| identity governance | `product_identities` + aliases/observations/rulesets/relationships, `product_identity_reviews` | ✅ |
| commercial readiness (§29) | `product_identity_prices` (1,204 rows) | ✅ |
| discovery gating | `approved_for_discovery`, `identity_status`, `superseded_by_product_id` | ✅ |

**Live state (read-only):** 951 canonical products, 17 manufacturers, **1 brand**
(Farenhyt), 44 families, 68 attributes, 16 certifications, 211 accessories,
82 lifecycle events, 27 compatibility rows, 1,881 identities, 1,204 prices,
**0 aliases, 0 variants**.

Conclusion: the *storage* is fully capable. The *gap is evidence*, not schema.

## 4. Current canonical Fire Alarm product representation (§40.2)

10 real Farenhyt panel products, each carrying a manufacturer-published
description that is the authoritative evidence source. Example
(`IFP-2100HV`):

> "Farenhyt **2100 point** Addressable Fire Panel … **One SLC loop card inbuild**,
> **159 Detectors and 159 Modules per loop**, Additional Loop cards can be
> expanded through **5815RMK** (Remote mounting Kit which accomodates **2 SLC Cards
> (6815)**), **Network upto 32 panels**, inbuild eight on-board **Flexput™**
> circuits … **UL Listing and FM Approved**, Red Cabinet"

Every product currently sits at `lifecycle_status = 'Unknown — Review Required'`
and `approved_for_discovery = 0` (10/10 both).

## 5–9. Normalization contracts delivered

### §5/§6/§31 — Identity and ecosystem
`manufacturer`, `brand`, `ecosystem`, `family`, `model` are five separate fields.
`normalizeEcosystemIdentity` resolves ecosystem from a **declared** ecosystem or
the **brand**, and with neither returns `basis: "UNRESOLVED"` — it **never falls
back to the manufacturer name**, because `manufacturer = Honeywell` covering
Farenhyt and Gamewell-FCI is precisely the flattening the governance model forbids.

### §7/§9/§24/§25/§26 — Capability extraction
**Reuse first.** `extractFireAlarmProductAttributes` already owns the proven,
bounded description rules (`native_slc_loops`, `max_detectors_per_loop`,
`max_modules_per_loop`, `max_system_points`, `ecs_capability`, `color`,
`battery_capacity`, `device_role`) and already preserves each value's literal
`sourceText`. This slice **calls** it and adds only the uncovered dimensions:
`max_network_nodes`, `networkable`, expansion kit/card/slots, ECS amplifier/watt/
speaker-circuit detail, smoke control, releasing, redundancy, peer-to-peer, GUI.
Every rule is a positive literal match — no rule infers a capability from a part
number, a family name or a marketing adjective.

### §8/§23 — Capacity semantics (the important one)

A single `maxPoints` would have been wrong here, and the real data proves it:

```
SYSTEM_NAMEDPLATE_POINTS  = 2100   ("Farenhyt 2100 point")
PER_LOOP_DETECTORS        = 159    ("159 Detectors and 159 Modules per loop")
PER_LOOP_MODULES          = 159
BASE_SLC_LOOPS            = 1
```

`1 × (159 + 159) = 318`, which does **not** reconcile to 2,100. The manufacturer
has not defined what a "point" is. So every capacity is stored as a record with
`scope`, `unit`, `rawClaim` and an explicit
`decomposableIntoLoopArithmetic` flag, and the nameplate claim is never treated as
a governed ceiling.

### §11/§28 — Expansion relationships
"can be expanded through 5815RMK" is recorded as
`SUPPORTS_OPTIONAL_EXPANSION` / `requiredForBaseOperation: false`, with `6815`
recorded as `MOUNTED_IN` that kit carrying `capacityPerComponent: 2 cards`. A
capability-required component and an optional one are different relationships and
are never collapsed to "accessory".

### §12/§13 — Certifications
UL, FM, EN54, LPCB, ULC are independent claims extracted as separate records with
`rawClaim` preserved (a "UL Listing" claim is never upgraded). A **reseller**-sourced
claim yields `authority: CATALOG_TEXT_UNVERIFIED`, `status: Unverified`;
manufacturer evidence yields `MANUFACTURER_DOCUMENT` / `Evidenced`.

### §16/§19 — Lifecycle
Never inferred from document recency (`inferredFromDocumentRecency: false` always).
The catalog's `Unknown — Review Required` stays **UNKNOWN**; a
`DISCONTINUED` event yields `DISCONTINUED` and preserves the replacement id
**without applying it**.

### §18 — Conflicting evidence
Two authorities disagreeing on the same capacity scope produce
`CONFLICTING_PRODUCT_EVIDENCE` with both values and **no resolution** — never the
larger number.

### §27 — Sizing readiness
Decided by evidence, never by model name. A panel with base loops, per-loop limits
and a nameplate claim is **PARTIALLY_SIZING_READY**, not `SIZING_READY`, because
`MAX_SLC_LOOPS` and a *defined* `SYSTEM_POINT_CEILING` are still missing. This was
a correction I made during implementation: the first version returned
`SIZING_READY`, which would have let a marketing number stand in for a governed
system ceiling.

## 10. Target-ecosystem product inventory (§32, read-only)

**10 Fire Alarm Control Panel products, all Farenhyt:**

| Model | Sizing readiness | Notable evidence |
|---|---|---|
| IFP-2100HV / HVB | PARTIALLY | 1 loop, 159/159 per loop, 2100 nameplate, net 32, UL+FM, 5815RMK/6815 |
| IFP-2100ECSHV / ECSHVB | PARTIALLY | as above + 16 amps, 2000 W, 128 speaker circuits |
| RFP-2100HV / HVB | PARTIALLY | remote (no display) variant, same capacities |
| IFP-75 / 75B / 75HV / 75HVB | **INSUFFICIENT** | no capacity evidence in the catalog text |

- **Certifications present:** UL, FM (all 10)
- **Protocols present:** Flexput
- **Expansion components:** 5815RMK, 6815
- **Lifecycle:** UNKNOWN 10/10 · **`approved_for_discovery`: 0/10**
- **Gamewell-FCI / Gent / Simplex:** no governed products

## 11–14. Readiness assessments

- **Sizing readiness:** 0 ready, 6 partial, 4 insufficient.
- **BOM relationship readiness:** *partial* — the expansion kit and loop card
  relationship exists for 6 models; the 4 IFP-75 variants have none.
- **Commercial readiness:** `product_identity_prices` has 1,204 rows and the
  identity model carries supplier/price/currency fields, so the commercial path is
  structurally available. **Gap:** the 10 panel products are
  `approved_for_discovery = 0`, so they are not yet visible to matching or pricing.

## 15–16. Tests

`tests/golden-7a-fire-alarm-panel-capability.test.mjs` — **21/21**, covering all
§33 acceptance scenarios and all §34 negative assertions, driven by **real
catalog descriptions**. Notable proofs: a nameplate is not a ceiling;
`1×(159+159) ≠ 2100`; `EN54` gains no `LPCB`; a UL-only product stays UL-only;
a reseller claim is unverified; marketing prose ("advanced voice evacuation
capable") yields **no** capability; smoke-control and releasing stay independent;
empty description fabricates nothing; and the module's executable code contains no
`best`/`preferred`/`recommend`/`rank`/`price`/`currency`/`quotation`.

## 17. Files changed

| File | Change |
|---|---|
| `app/domain/fire-alarm-panel-capability-normalization.mjs` | **new** — pure normalizer |
| `tests/golden-7a-fire-alarm-panel-capability.test.mjs` | **new** — 21 tests |
| `scripts/test-classification-baseline.json` | drift re-recorded (429 files) |

**No production file, schema, migration, route or existing module was modified.**

## 18. Test / lint / build

| Check | Result |
|---|---|
| `golden-7a-fire-alarm-panel-capability` (new) | **21/21** |
| `task9-fire-alarm-library` | 37/37 |
| `fire-alarm-attribute-semantics` | 8/8 |
| `fire-alarm-taxonomy-integration` | 40/40 |
| `golden-6c` / `golden-6c2` | 32/32, 34/34 |
| `product-matching-engine` | 77/77 |
| `npm test` | **519/519** |
| `npm run build` | passes |
| `eslint` (both new files) | 0 errors, 0 warnings |
| `test:all` | 4278 tests, 4262 pass, **2 fail** |

The 2 `test:all` failures are the long-standing pre-existing
`boq-line-bom-summary` pair. `review-workflow-atomic` R8 was fixed by its own
lane and is now green.

## 19. Business-state write declaration

None. Live D1 opened **read-only** (`mode=ro`). No project selection, compatibility
propagation, panel approval, final sizing snapshot, matching run, price or
quotation mutation, no deploy, restart, commit or push. **§36 honored:** no
project, panel count or 2,000-point rule is encoded in the product master.

## 20. Remaining product-data gaps

1. 🔴 **Gamewell-FCI, Gent and Simplex have zero governed products.** Coverage is
   genuinely incomplete; it was not padded.
2. 🔴 **All 10 panels are `approved_for_discovery = 0`** — invisible to matching and
   pricing until product-identity review promotes them.
3. 🔴 **Lifecycle is UNKNOWN for 10/10.** No manufacturer lifecycle notice has been
   ingested, so current/legacy/discontinued is not yet known.
4. 🟠 **`SYSTEM_POINT_CEILING` and `MAX_SLC_LOOPS` unevidenced**, so no panel is
   sizing-ready. The "2100 point" nameplate is deliberately not accepted as a
   ceiling.
5. 🟠 **0 product aliases / variants**, so §30 dedup is proven only in the
   normalizer, not yet persisted.
6. 🟠 **Certifications are not yet written to `product_certifications`** — the
   evidence exists in description text; `standards` is still `[]` on these rows.
7. 🟠 **IFS-2100-style suffixed variants** need an explicit variant policy so a
   colour/electrical suffix is not treated as a distinct ecosystem.

## 21. Recommended next bottom-up slice

**GOLDEN-7B — Governed Exact Panel Capacity & Eligibility Engine**, exactly as the
mission specifies. Its `TECHNICALLY_ELIGIBLE` filter needs data this slice shows is
**not yet present**: a defined system ceiling, a maximum loop count, governed
certification rows, and lifecycle status.

**Recommended order before GOLDEN-7B runs:**
1. **GOLDEN-7A2 — Manufacturer evidence ingestion** for Gamewell-FCI, Gent and
   Simplex, with §17 source authority (official datasheet/manual/listing/lifecycle
   notice) and §22 raw-claim preservation. Without it, 7B would return
   `INSUFFICIENT_PRODUCT_DATA` for three of four ecosystems.
2. Persist the normalized capabilities, certifications, lifecycle and aliases into
   the existing canonical tables, then run product-identity review to set
   `approved_for_discovery`.

Both lanes remain independent; the project-side lane is unaffected by any of this.

> No live compatibility decision, live requirement approval, live profile
> regeneration, live matching run, live safety approval, live panel selection,
> live sizing snapshot, pricing mutation, quotation mutation, commit, push,
> deployment, restart, or unrelated business-state mutation was performed.
