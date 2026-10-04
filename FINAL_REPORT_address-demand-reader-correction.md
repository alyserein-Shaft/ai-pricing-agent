# FINAL REPORT — Al Mousa Address-Demand Reader Correction + Quantity-to-BOQ Linkage Audit

**Canonical project:** `project_ae501b85-9c12-4332-bf8e-787c90f2d388`
**Canonical local D1:** `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite`
**Run:** address-demand-reader-correction-2026-10-03

**Scope of change:** `app/domain/technical-requirement-engine.mjs`, `worker/technical-requirement-api.mjs`, `tests/address-demand-project-api.test.mjs`.
**Not done (prohibited):** no schema, no live D1 writes, no direct SQL writes, no allocation, no sizing, no pricing, no quotation, no commit/push/deploy.

---

## A. Resource Rule-Version Repair

### The defect
`resourceDemandRuleVersion` was read from `physicalQuantityAuthority?.ruleVersion`. Physical Quantity Authority owns device **counts**; it carries no resource-classification policy and no resource rule version. Reading a resource rule version from it yields a value that cannot ever invalidate: a resource-policy change would leave every address-demand fingerprint unchanged, so a cached demand silently survives the very policy change meant to govern it.

### Traced reality
No dedicated resource-classification version constant existed. `REQUIREMENT_RULESET_VERSION` (`"requirement-rules-2026-09-27-fail-closed-panel-compat"`) governs *requirement derivation* — applicability, readiness, conflict — and does not describe how a device becomes `DETECTOR`/`MODULE`/`NOT_SLC` nor how many addresses it consumes.

### The repair
Added a separate, correctly-scoped owner at `app/domain/technical-requirement-engine.mjs:97`:

```
export const RESOURCE_CLASSIFICATION_RULESET_VERSION = "slc-resource-classification-1.0.0";
```

It is now the single owner of the four outputs the task named — `resourcePool`, `addressesPerUnit`, `directSlcAddressState`, `secondaryInterfaceDemandState` — and it is written into **both** the input fingerprint (`addressDemandInputFingerprint.resourceDemandRuleVersion`) and `currentness.resourceDemandRuleVersion`.

The quantity rule version is no longer lost; it is reported separately and visibly as `currentness.physicalQuantityRuleVersion`, sourced from the real 0020 column `authority_version`. The two policies are now conflatable no more.

### Write-path half of the same defect (found while tracing)
`executeRequirementProfile`'s idempotency fingerprint folded in `REQUIREMENT_RULESET_VERSION`, `REQUIREMENT_ENGINE_VERSION` and `REQUIREMENT_INTELLIGENCE_VERSION` — but **not** the resource ruleset. A bump would therefore have left every cached profile's fingerprint unchanged and the idempotency branch would have **reused** the pre-bump profile, so the policy change would never have reached the stored profile at all. Fixed at `worker/technical-requirement-api.mjs:459` by folding in `resourceClassification: RESOURCE_CLASSIFICATION_RULESET_VERSION`.

### Mutation proof
- `REQ G` proves the reader sources `resourceDemandRuleVersion` from `RESOURCE_CLASSIFICATION_RULESET_VERSION` and **not** from a quantity authority that carries `ruleVersion: "quantity-rules-vX"`.
- `REQ G2` proves the fingerprint is sensitive to that field and to nothing else in the scenario: identical quantity (9), identical resource pool, identical addresses-per-unit; only the resource rule version differs (`v1` vs `v2`) → fingerprints differ; identical inputs → identical fingerprints (stable).

Honest scope limit: this is a compositional proof (reader reads the constant ⇒ fingerprint carries it ⇒ fingerprint is a pure function of its inputs), not a live re-import with a mutated constant. Asserting the mutation at module-reload granularity would need a temp module copy and is not worth the fragility; the two halves above are separately falsifiable.

---

## B. Zero-Preservation Repair

### The defect
Truthiness was used to distinguish "no value" from "a value". `physicalQuantity: value || (boqItemId ? null : null)` was a dead ternary that nonetheless mapped a governed `0` to `null`. Same for the demand path and the `currentness.physicalQuantity` label.

### The repair
All reads of a governed number are now **nullish**:

| Site | Before | After |
|---|---|---|
| reported quantity | `value \|\| …` (0 ⇒ null) | `quantity?.value ?? null` |
| actual demand | `.value` unguarded | `governedQuantity` (already `?? null`) |
| demand state | `demand > 0 ⇒ PROVEN`, else fell through to `CONFLICT` | `demand !== null ⇒ PROVEN` (0 is proven) |
| currentness label | `value ? 'governed' : 'un governed'` | nullish, plus `'not-current'` for a stale authority |

**Invariant now holds:** `0` is a real governed numeric value; `null` means unavailable/unknown.

A second, subtler zero defect was fixed: a governed `0` on a `DETECTOR` item previously fell through both branches and landed in `CONFLICT` — labelling *proven zero devices* as an architectural conflict. Demand state is now evaluated in a fixed order (`architectureConflict` → `NOT_SLC` → `!== null` → `UNRESOLVED`), so a governed zero is `PROVEN 0`, and a `NOT_SLC` governed zero remains `NOT_APPLICABLE` with its secondary interface still unresolved.

**Test:** `REQ C` (`0` ⇒ `physicalQuantity = 0`, `demandState = PROVEN`, `actualRequiredAddressDemand = 0`, `physicalQuantityCurrentness = 'CURRENT'`) and `REQ C2` (`NOT_SLC` + `0` ⇒ `NOT_APPLICABLE`, `secondaryInterfaceDemandState` still `null`, `UNRESOLVED_SECONDARY_INTERFACE` listed).

---

## C. Real Authority Identity Repair

### The defect
The response emitted literals — `resourceProfileId: "active"`, `physicalQuantityAuthorityId: "governed"`, version `"absent"` — in fields named as identifiers. Nothing could join on them.

### The repair
Identifiers now come from the resolved authorities; `null` when the upstream authority genuinely has no persistent id, with an explicit state beside it.

| Field | Source |
|---|---|
| `resourceProfileId` | `requirement_profile_versions.id` |
| `resourceProfileVersion` | `version_number` |
| `resourceProfileFingerprint` | `input_fingerprint` |
| `physicalQuantityAuthorityId` | `drawing_quantity_claims.id` |
| `physicalQuantityAuthorityVersion` | `version_number` |
| `physicalQuantityAuthorityFingerprint` | `evidence_fingerprint` |

Nothing is fabricated: no placeholder string is ever returned in an id field, and `evidenceReferences` cite the real identities (`requirement_profile_versions#profile-1@v7`). The old literal `"absent"` in a version field is gone; absence is expressed as `null` plus `resourceAuthorityCurrentness` / `physicalQuantityCurrentness` ∈ {`CURRENT`,`STALE`,`ABSENT`}.

**Tests:** `REQ D` (real ids/versions/fingerprints propagate), `REQ D2` (an authority with no persistent id yields `null` identity **plus** an explicit state — no fabrication).

---

## D. Blocked-Reason Semantics

### The defect
A single early `if (!physicalQuantityAuthority)` returned one collapsed outcome. Two live blockers existed simultaneously — no quantity authority **and** 0/84 populated resource classification — and the read reported only the first, hiding the second entirely.

### The repair
The collapsed branch is replaced by **independent** evaluation of both authorities, then a full explanation.

`boqItemCurrentness` (one primary cause, deterministic precedence, for single-value branching):

`CURRENT` · `STALE_PHYSICAL_QUANTITY_AUTHORITY` · `MISSING_PHYSICAL_QUANTITY_AUTHORITY` · `STALE_RESOURCE_CLASSIFICATION_AUTHORITY` · `MISSING_RESOURCE_CLASSIFICATION_AUTHORITY`

New `unresolvedReasons[]` — **every** applicable cause, fixed order, empty exactly when the read is complete. Also adds `UNRESOLVED_SECONDARY_INTERFACE`, `UNRESOLVED_ADDRESSES_PER_UNIT`, `UNRESOLVED_RESOURCE_CLASSIFICATION`, `ARCHITECTURE_CONFLICT`.

New `authorityBlocked` boolean: true when *any* missing-or-stale authority cause exists. The route's `summary` keys off this rather than off `boqItemCurrentness === 'CURRENT'`.

`ARCHITECTURE_CONFLICT` is wired **narrowly and data-driven** — a conflict is reported only when a decision actually *declares* one (`conflict === true`, or `state`/`conflictState === 'CONFLICT'`). Nothing infers a conflict from a missing decision. No governed decision currently carries that signal, so the outcome is representable but unpopulated today; that absence is itself the honest finding (the channel/interface authority layer is missing) and was not papered over with a guess.

`deriveAddressDemand` engineering semantics were **not** changed.

### Stale was being silently laundered into "missing"
`resolvePhysicalQuantityAuthority` returned `null` for a drifted fingerprint, collapsing *stale* into *missing*. It now returns the claim **with identity and `currentness: 'STALE'` and its `value` withheld (`null`)** — so a drifted number can never be consumed, while "we have a claim but it went stale" stays distinguishable from "we have no claim at all". Those have different remedies.

### Live proof of the fix
Before: `unresolvedReasons` would report one cause. Now, live, all 84 items report **both**:
`["MISSING_PHYSICAL_QUANTITY_AUTHORITY","MISSING_RESOURCE_CLASSIFICATION_AUTHORITY"]`

**Tests:** `REQ A`, `REQ B`, `REQ E`, `REQ E2`, `REQ F` (four single-cause scenarios each labeled with its own cause, asserting exactly one authority cause and no cross-contamination), `REQ G3`.

---

## E. Live Resource Profile Population Audit

Re-read live from canonical D1 (read-only), immediately before this report.

```
current profiles                              = 84
with slcResourceClassification                = 0
profile completed_at range                    = 2026-10-01T23:29:04.060Z → 2026-10-02T22:32:22.475Z
ITEMS_WITH_APPROVED_INTERPRETATION            = 0
```

### Why 0/84 — proved, in four steps

1. **Do the profiles predate the implementation?** **Yes.** All 84 current profiles were completed between 2026-10-01T23:29 and 2026-10-02T22:32. `slcResourceClassification` is part of the uncommitted resource-classification work dated 2026-10-03. The profiles were written before the field existed. `CURRENTNESS_STATUS = PROVEN` (timestamp comparison against the implementation's own history, plus the field being absent in 84/84 rows).

2. **Does `executeRequirementProfile` produce the field?** **Yes.** `buildTechnicalRequirementProfile` sets `slcResourceClassification` at `app/domain/technical-requirement-engine.mjs:582-595`.

3. **Does the population writer persist it?** **Yes.** `persistProfile` writes `JSON.stringify(profile)` — the whole profile object — at `worker/technical-requirement-api.mjs:418`. The writer is not the blocker.

4. **Are current approved/confirmed inputs sufficient to regenerate it?** **No — and this is the substantive finding.** `productFamily` is computed at `worker/technical-requirement-api.mjs:434` as
   `approvedProductFamily || item.subcategory || item.category`.
   **0 of 84 items have an approved understanding interpretation**, so `approvedProductFamily` is always null and `productFamily` always falls through to **raw extraction text** — `subcategory` for 40 items, `category` for 43, null for 1.

   So regenerating today would populate *governed resource authority* from **raw, unapproved BOQ text**. That directly contradicts the accepted invariant *"raw description cannot create resource authority."* Regeneration must not proceed on current inputs.

### Dry-run classification if regenerated today (real inputs, real classifier, no writes)
```
WOULD_CLASSIFY_TALLY  = DETECTOR 10 · MODULE 8 · NOT_SLC 0 · UNRESOLVED 66
DETERMINISTICALLY_CLASSIFIABLE = 18
EXPECTED_UNRESOLVED  = 66
```
Computed with the *actual exported* `classifyResourcePoolWithGovernance` / `classifyAddressesPerUnitWithGovernance` (both exported by this task so the audit exercises the real logic rather than a copy that could drift) and `currentApprovedUnderstandingFacts` (the canonical reader), so no hand-rolled table guess is involved.

**`NOT_SLC = 0` is not a fact about the project.** The 3 `Fireman Telephone Jack` and 3 `Door Contact` rows — which *are* non-SLC — come out `UNRESOLVED`, because the classifier matches the family **exactly** (lowercased) against a 9-key vocabulary (`detector, smoke, heat, module, manual call, pull station, fireman, door, telephone`). `"fireman telephone jack"`, `"door contact"`, `"addressable smoke detector"` and `"manual call point"` are compound labels that match nothing. 66 UNRESOLVED is a **vocabulary gap**, not an absence of evidence.

I did **not** widen the vocabulary. Adding `"fireman telephone"` / `"door contact"` / `"smoke detector"` would be substring matching, which is exactly what the accepted invariant forbids and what the task forbids. The vocabulary must be extended by a governed decision, not by me.

### Divergent-map defect found (unreported by the prior lane)
Two different maps exist in `app/domain/technical-requirement-engine.mjs`:

| | keys |
|---|---|
| `resourcePoolMap` **:599 — dead, referenced nowhere in code** | `detector, smoke, heat, "smoke detector", module, "manual call", "pull station", fireman, "telephone jack", "door contact"` (10) |
| `familyMap` **:635 — the map actually in use** | `detector, smoke, heat, module, "manual call", "pull station", fireman, door, telephone` (9) |

`FINAL_REPORT_address-demand-infrastructure.md:53,269` and `FINAL_REPORT_agent3_authority_safety_closure.md:69` both cite **`resourcePoolMap`** as "the canonical mappings … 9 proven device-family entries". That map is **dead code with 10 entries**; the map that actually governs has **9** and different keys. Those reports' cited authority is not the governing authority.

I did **not** delete `resourcePoolMap`: two other lanes' reports cite it, and removing a cited artifact is a cross-lane decision, not mine. It is left in place with the divergence reported. It is the sole lint warning in my touched files (`599:7 'resourcePoolMap' is assigned a value but never used`) and that warning is **accurate**.

---

## F. Reprofile Plan

**`RESOURCE_PROFILE_REGENERATION_READY = NO`** — the mechanism exists, the inputs do not.

| Item | Value |
|---|---|
| Route / function | `POST /api/projects/:projectId/requirement-profile/items/:boqItemId/generate` → `executeRequirementProfile` (`worker/technical-requirement-api.mjs`) |
| `ITEMS_REQUIRING_REPROFILE` | **84** (all current profiles lack the field) |
| `ITEMS_DETERMINISTICALLY_CLASSIFIABLE` | **18** — but all 18 derive from **raw** `subcategory`/`category`, not from approved authority |
| `ITEMS_EXPECTED_UNRESOLVED` | **66** |
| `WRITE/REVIEW AUTHORITY REQUIRED` | **YES — two independent blockers** |

**Blocker 1 (governance, must clear first).** `productFamily` must be governed before regeneration. Either (a) approve Understanding interpretations so `approvedProductFamily` is populated, or (b) a governed product-family taxonomy that maps the project's actual family labels. Without this, regeneration writes resource authority from unapproved text.

**Blocker 2 (vocabulary).** Extend the classification vocabulary **by governed decision** to cover the observed families (`Sounder`, `Strobe`, `Control Panel`, `Addressable Smoke Detector`, `Manual Call Point`, `Fireman Telephone Jack`, `Door Contact`, `Relay Module`, `Combined Monitor/Relay Module`, `Manual Initiation`, `Fire Resistant Cable`, `Detection Devices`). Until then 66/84 stay `UNRESOLVED` regardless of Blocker 1.

**Not to be done:** do not invent classifications to raise coverage. `NOT_SLC = 0` today is honest.

**Dry-run only.** No profile was regenerated; canonical D1 was not written.

---

## G. Quantity-to-BOQ Existing Linkage Audit

Read-only exhaustive audit (independent search agent, verified against canonical schema and DDL). Canonical DDL is `drizzle-active/0000_baseline_schema_0082.sql` + subsequent `00xx_*.sql`; `db/schema.ts` is an **incomplete ORM projection** (it omits `boq_quantity_source_decisions`, `drawing_quantity_evidence_coverage` and `drawing_quantity_claims` entirely).

### Headline
**No governed, device-class-scoped, project-scoped, current, approved drawing→BOQ-item correspondence exists anywhere in the system.** `device_class` appears **zero** times in `db/schema.ts`; in the canonical chain it exists **only** in `drizzle-active/0020_drawing_quantity_claims.sql` — i.e. the vocabulary is new, not reused.

### Every candidate mechanism

| # | Mechanism | Location | Join key | Governed? |
|---|---|---|---|---|
| 1 | `boq_quantity_source_decisions` | baseline `:152-167`; writer `worker/quantity-source-decision-api.mjs:239-240` | `boq_item_id` + **free-text `definition_key`** (no FK) | **NO.** `definition_key` comes straight from the request body, never validated against `drawing_symbol_definitions`. No `sheet`, `device_class`, `document_version_id`, `review_status` or `superseded_at`. For `source='BOQ'`/`'Reviewed'` there is **no** live-drawing-comparison gate. **Its writer route is not even mounted** in `worker/index.ts`. |
| 2 | `resolveGovernedLink` | `app/domain/drawing-quantity-evidence-engine.mjs:124-135` | approved interpretation: `system`/`families` ↔ `productFamily‖category` | **Derived live, never persisted.** The closest thing to a genuine predicate (requires `review_status === 'APPROVED'`), but it dies with the request — cannot be cited, audited or re-verified. |
| 3 | `drawing_quantity_evidence_coverage` | baseline `:1221-1231` | `project_id` + `recognition_version_id` | Aggregate coverage only. **No `boq_item_id`, no `device_class`, no `sheet`.** |
| 4 | `drawing_symbol_definitions` / `_occurrences` / `_recognition_versions` | baseline `:1554-1663` | `definition_id`, `occurrence_key` | Reviewed/approved recognition, but **no `boq_item_id` on any of them.** `definition_key` *should* point here and does not. |
| 5 | `profile_requirement_applicability.device_identity_ref` | `drizzle-active/0009_profile_applicability_device_identity_authority.sql:41-89` | 3-class CHECK on project+device+variant | **ORPHANED.** Already migrated and CHECK-constrained for exactly this identity triple, but `persistProfile` writes 9 columns and **never writes this one** — 0 rows, no code path. |
| 6 | `buildDrawingRequirementEntries` | `app/domain/drawing-requirement-evidence-engine.mjs:201-212` | embeds all three in an opaque id string | **No production caller** — tests only. |
| 7 | `boq_items.drawing_reference` | `app/domain/boq-extractor.mjs:20`; persisted `worker/boq-extraction-api.mjs:35` | raw text, e.g. `"DWG-02"` | **Raw extracted text.** No FK to any drawing table, never joined. |
| 8 | `al-mousa-drawing-boq-reconciliation.mjs` | `scripts/lib/al-mousa-drawing-boq-reconciliation.mjs:42-62,139-150` | hardcoded 13-family map on both sides | **NOT GOVERNED.** Read-only diagnostic, hardcodes this project id. |
| 9 | `drawing_legend_geometry_approved_links` | baseline `:1021-1036` | legend candidate → `drawing_structure_approved_rows` | Red herring despite the name. **No `boq_item_id`.** |
| 10 | `drawing-candidate-comparison`, `drawing-discrepancy-detection`, Excel export, `boq-line-bom-api` | various | — | Explicitly non-authoritative (`approvedForTakeoff:false`) or drawing↔drawing; **no drawing↔BOQ join exists.** |

**Exhaustive negative:** no `JOIN` between any `drawing_*` table and `boq_items` exists in any `.sql` file.

### The missing authority layer, named
**A governed Quantity-to-BOQ Applicability/Link authority does not exist.** Per task 9, this is reported as a missing authority layer and **not** hidden inside `getAgent1AddressDemandRead()`.

---

## H. Mapping Cardinality

**`QUANTITY_TO_BOQ_CARDINALITY = MIXED`** — definitively **not** 1:1. Real Al Mousa BOQ rows (re-read live):

### ONE drawing class → MANY BOQ items (per-floor / per-riser splits)

| Drawing class | BOQ rows | Quantities |
|---|---|---|
| Fireman Telephone Jack | 3 | 19, 24, 6 |
| Heat detector | 4 | 9, 6, 8, 1 |
| Duct detector | 4 | 13, 13, 13, 6 |
| Combined smoke and heat detector | 2 | 6, 5 |
| Interface module control | 4 | 16, 16, 16, 7 |
| Interface module monitor | 4 | 97 total |
| Relay Module | 8 | 1 each (HVAC / elevators; two rows share an identical description but differ in rowid) |

### MANY BOQ items → ONE drawing class
The 9 `Addressable Smoke Detector` rows split above/below ceiling **and** per floor: **131, 253, 192, 243, 56, 81, 5, 1, 4**. A single smoke symbol class spans all of them.

### Decisive consequence
**The per-BOQ-row quantities are NOT derivable from a class-level claim.** `Interface module control` splits 16/16/16/7 across four BOQ rows; `Heat detector` splits 9/6/8/1. A single `(device_class, device_variant)` count **cannot** be divided across BOQ rows without inventing a split rule.

Therefore any governed link must be **per drawing LOCATION** — i.e. it must carry `(project_id, document_version_id, sheet, floor_or_area, device_class, device_variant)`, exactly the 0020 claim key — and bind that to `boq_item_id`. A class-level link would be wrong, not merely imprecise.

Description matching is also disproven as a key: the 8 `Relay Module` rows include two with **identical** descriptions and different quantities, and quantities differ per row.

---

## I. Correct Authority Boundary

**Option B.**

> **B.** Drawing Quantity Authority remains **drawing-semantic scoped** — a claim about a drawing location. A **separate governed Quantity-to-BOQ Applicability/Link authority** binds a governed claim to a BOQ item.

Rejected:
- **A** (make the claim BOQ-item-scoped) would contradict the claim's actual semantics and force class-level rows to carry per-floor quantities they cannot represent (§H). It would also relocate the unvalidated-`definition_key` defect into an authoritative table.
- **C** is false: no existing governed correspondence exists (§G).

This also matches the migration as written: `drizzle-active/0020_drawing_quantity_claims.sql` deliberately has **no** `boq_item_id` and **no** FK to `boq_items`, and explicitly forbids SLC/address columns (its `authority_version`, not `rule_version`, is the quantity-policy column). The approved migration and the correct architecture agree; my previous resolver was the thing that disagreed.

### Implemented in this task (fail-closed, no schema)
`worker/technical-requirement-api.mjs` now gates the per-item read behind the link authority and refuses to invent one:

1. governed link table must exist — `drawing_quantity_boq_links` (**PROPOSED, NOT LANDED**; a named seam, **not** a schema change);
2. a governed link row for `(project_id, boq_item_id)` must exist;
3. the claim it points at must exist, be unrejected (`review_status = 'Approved'`), and its fingerprint must be current.

Any gate failing ⇒ `null` ⇒ the canonical read fails closed as `MISSING_PHYSICAL_QUANTITY_AUTHORITY`. **Description similarity is never used as a correspondence.**

### Real defect this exposed in my own earlier code
The previous resolver queried `WHERE project_id=? AND boq_item_id=?` against `drawing_quantity_claims` and read `row.rule_version` / `row.max_addresses`. **None of those columns exist in 0020** (`boq_item_id` absent; the column is `authority_version`; there is no `max_addresses`, and the migration deliberately forbids SLC/address columns on a quantity claim). The resolver was coupled to a schema that contradicts the approved migration. It now reads only real 0020 columns. `REQ G4` pins this.

---

## J. Project API Regression Tests

`tests/address-demand-project-api.test.mjs` — **21 tests, 21 pass.** Hermetic in-memory fake D1 driving the **real** handler, plus direct canonical-reader exercise. Covers required cases A–G:

| Case | Test |
|---|---|
| A missing quantity ⇒ `MISSING_PHYSICAL_QUANTITY_AUTHORITY` | `REQ A` |
| B quantity present + resource authority missing ⇒ `MISSING_RESOURCE_CLASSIFICATION_AUTHORITY` | `REQ B` |
| C `quantity = 0` ⇒ response quantity remains `0` | `REQ C`, `REQ C2` |
| D real authority IDs propagate | `REQ D`, `REQ D2` |
| E resource rule version mutation invalidates fingerprint | `REQ G`, `REQ G2` |
| F one blocked cause never mislabeled as another | `REQ F` (4 single-cause scenarios + both-missing) |
| G no BOQ row can borrow a drawing quantity without governed correspondence | `REQ G`, `REQ G2`, `REQ G3`, `REQ G4` |

Plus stale-vs-missing (`REQ E`, `REQ E2`), no cross-item borrowing (`REQ E3`), additive-transport contract, no-allocation/sizing/SBUS (serialized-response token scan), raw-text `addressability` never reaching a governed output, blocked row contributing no total, and canonical current-evidence item scope.

Three **real** defects were caught by these tests during this task and fixed: summary keyed on the wrong condition; authority row returned `quantity` instead of the reader's `value`; test fixture destructure mismatches (twice).

### Regression
- 5 focused suites: **75/75 pass** — `address-demand-project-api` (21), `technical-requirement-engine` (17), `technical-requirement-engine-source-facts` (15), `address-model-closure` (14), `requirement-domain-routing` (8).
- All **51** test files that import either changed module: 597 tests, 489 pass, 108 fail — **all 108 confined to 8 files that fail at module load** on missing exports from modules this task never touched:
  `confidence-safety-api.mjs` (`candidateStaleness`, `currentDecision`), `product-matching-api.mjs` (`loadProducts`), `current-evidence-scope.mjs` (`currentApprovedProjectSystems`, `currentTechnicalRequirementEligibleForEngineeringPredicate`), `engineering-knowledge.mjs` (`HUMAN_REQUIREMENT_LINK_METHOD`, `HUMAN_AUTHORED_LINK_APPLICABILITY`). These are pre-existing breaks from other lanes; they never execute my code. **Attributed, not dismissed as "pre-existing" without evidence.**
- Export surface verified intact by importing both modules (29 engine exports; all pre-existing names present, `buildTechnicalRequirementProfile` unchanged). No export was removed.
- `eslint` on the 3 touched files: 1 pre-existing warning (`resourcePoolMap` unused — accurate, see §E). Zero errors. Repo-wide debt (4343 problems) untouched.

### Live verification (read-only, canonical D1)
```
HTTP 200 · items 84 · summary {"PROVEN":0,"UNRESOLVED":0,"CONFLICT":0,"BLOCKED":84,"NOT_APPLICABLE":0}
boqItemCurrentness     MISSING_PHYSICAL_QUANTITY_AUTHORITY ×84
unresolvedReasons      ["MISSING_PHYSICAL_QUANTITY_AUTHORITY","MISSING_RESOURCE_CLASSIFICATION_AUTHORITY"] ×84
physicalQuantity null  84/84 · zero 0/84 · identities present 0/84
drawing_quantity_claims      absent   drawing_quantity_boq_links   absent
boq_quantity_source_decisions present, 6 rows   drawing_quantity_evidence_coverage present, 1 row
```
**Zero fabricated quantities. Zero fabricated identifiers.** The canonical SQLite was opened `readOnly: true` with every `.run()` throwing; `git status --porcelain .wrangler` = **0** entries. HEAD still `292bb86`.

---

## K. Updated Handoff

### For the quantity-authority lane (blocking)
1. **`drizzle-active/0020_drawing_quantity_claims.sql` is unapplied** — `drawing_quantity_claims` absent from canonical D1. Owner decisions still open: apply path (none approved), and note **D2 appears already fixed** in 0020 (uniqueness uses `COALESCE(sheet,'')`/`COALESCE(floor_or_area,'')`, NULL-safe). Prior lane's defect D1 (numbering) is superseded — `0020` is now correct.
2. **Land the governed link authority** (option B). It must be keyed by the **full 0020 claim key** `(project_id, document_version_id, sheet, floor_or_area, device_class, device_variant)` plus `boq_item_id`, because per-row quantities differ per floor (§H). Its writer must **require a real governed predicate** — never a request-body string, or it merely relocates the `definition_key` defect.
3. **`boq_quantity_source_decisions.definition_key` remains an unvalidated free-text hint** with no FK, no `sheet`, no supersession, and **its writer route is unmounted** in `worker/index.ts`. Do not treat those 6 Al Mousa rows as a correspondence.
4. `resolveGovernedLink` (`app/domain/drawing-quantity-evidence-engine.mjs:124-135`) is the only genuine predicate today but is derived live and never persisted — it cannot be cited as authority.
5. `profile_requirement_applicability.device_identity_ref` (`drizzle-active/0009_…`) is an already-migrated, CHECK-constrained slot for this exact triple, written by **no** code path. Evaluate it before adding new schema.

### For the resource-classification lane (blocking, independent)
6. **`productFamily` is ungoverned for 84/84 items** (0 approved interpretations; falls back to raw `subcategory`/`category`). Regeneration would write resource authority from unapproved text. Govern it first.
7. **Extend the classification vocabulary by governed decision**, not substring matching. 66/84 are UNRESOLVED purely because compound family labels (`"fireman telephone jack"`, `"addressable smoke detector"`, `"manual call point"`, `"door contact"`) miss the 9-key exact-match map. `NOT_SLC = 0` is a vocabulary artifact, not a project fact.
8. **Reconcile the divergent maps**: `resourcePoolMap` (:599, dead, 10 keys) vs `familyMap` (:635, live, 9 keys). Two prior reports cite the dead one as canonical.
9. **Bump `RESOURCE_CLASSIFICATION_RULESET_VERSION`** on any resource-policy change; it is now in both the address-demand fingerprint and the profile idempotency fingerprint, so cached profiles will correctly recompute.
10. **`secondaryInterfaceDemandState` is unmodelled for `DETECTOR`/`MODULE`** — a monitor-module demand for a detector is a real secondary demand that is not represented at all. Reported, not fixed (the domain is closed).
11. `maxCapabilityAddressDemand`'s `RELAYMON → 16` branch is **unreachable** (`RELAYMON` is not in the resource-pool vocabulary) and is a hardcoded placeholder. Reported, not fixed.

### For Agent 4 (Engineer UI)
Contract is the canonical reader's, additively transported. Route: `GET /api/projects/:projectId/requirement-profile/address-demand`.
New/changed vs the previous slice: `boqItemCurrentness` widened; `unresolvedReasons[]` and `authorityBlocked` added; `physicalQuantityAuthorityVersion`, `resourceProfileVersion`, `physicalQuantityAuthorityFingerprint`, `resourceProfileFingerprint` added; `resourceProfileId`/`physicalQuantityAuthorityId` are now real or `null` (were literals `"active"`/`"governed"`).
Limitations, unchanged: `addressDemandInputFingerprint` is a plain object, not a hash, and nothing compares it; ~194 KB for 84 items (~2.3 KB/item) with the architecture decision appearing 168×, inherent to the reader shape and deliberately not removed; `evidenceReferences` values are human-readable strings. `CURRENT_PROJECT_ADDRESS_DEMAND_AVAILABLE = NO` — the UI must render blocked/unresolved states honestly and must never display a blocked item as `0`.

---

## Flags

```
RESOURCE_RULE_VERSION_OWNER_CORRECT = YES
GOVERNED_ZERO_PRESERVED = YES
REAL_AUTHORITY_IDS_EXPOSED = YES
BLOCKED_REASONS_DISTINGUISHABLE = YES
LIVE_PROFILES_WITH_RESOURCE_CLASSIFICATION = 0/84
RESOURCE_PROFILE_REGENERATION_READY = NO
DRAWING_QUANTITY_TO_BOQ_GOVERNED_LINK_EXISTS = NO
QUANTITY_TO_BOQ_CARDINALITY = MIXED
ADDRESS_DEMAND_CANONICAL_READER_CORRECT = YES
ADDRESS_DEMAND_PROJECT_API_CORRECT = YES
CURRENT_PROJECT_ADDRESS_DEMAND_AVAILABLE = NO
DRAWING_QUANTITY_MIGRATION_REFERENCE = drizzle-active/0020_drawing_quantity_claims.sql
```

Supporting: `ADDRESS_DEMAND_DOMAIN_REOPENED = NO` · `DERIVE_ADDRESS_DEMAND_SEMANTICS_CHANGED = NO` · `ADDRESS_DEMAND_DERIVATION_DUPLICATED = NO` · `QUANTITY_FALLBACK_TO_BOQ_OR_RECOGNITION = NO` · `RAW_TEXT_CAN_REACH_A_GOVERNED_OUTPUT = NO` · `DESCRIPTION_MATCHING_USED_AS_AUTHORITY = NO` · `LIVE_AL_MOUSA_FABRICATED_ZEROS = 0` · `LIVE_AL_MOUSA_FABRICATED_IDENTIFIERS = 0` · `SCHEMA_CREATED = NO` · `LIVE_D1_WRITES = 0` · `COMMIT_PUSH_DEPLOY = NO`

`RESOURCE_PROFILE_REGENERATION_READY = NO` despite the route existing: regeneration today would create governed resource authority from raw, unapproved BOQ text, violating an accepted invariant. The mechanism is ready; the **inputs** are not.

**STOP.** No schema. No live D1 writes. No allocation. No sizing. No pricing. No quotation. No commit/push/deploy.
