# GOLDEN-4 — Governed Fire Alarm Compatibility Decision

## 1. Executive verdict

**`CLOSED — GOVERNED HONEYWELL / NOTIFIER COMPATIBILITY DECISION INTEGRATED`**

The human Technical Engineering Decision is recorded through the existing
canonical requirement/review model, and the full downstream lifecycle is proven
on real-schema fixtures: decision → canonical compatibility evidence → new
profile version → changed fingerprint → cleared `compatibilityTarget` blocker.

**No parallel table was invented.** The decision uses precisely the lifecycle the
project's own only-ever-satisfied profile already uses (item C, Heat Detector).

## 2. Human decision received

Recorded faithfully. The decision establishes **only** the
`Honeywell / Notifier Compatibility Boundary`; it explicitly does **not** select
a FACP model, loop capacity, network topology or expansion modules.

## 3. Canonical persistence path

Traced from `detectMissingInformation` backwards rather than assumed:

```js
// app/domain/technical-requirement-engine.mjs:218
compatibilityTarget: compatibility.some((item) => item.targetItem || item.rightEntityId) ? true : null
```

and `:320`, where `compatibility` is assembled from three sources:

```js
compatibility = [
  ...consolidated.flatMap((item) => item.compatibility),                                   // requirement_compatibility
  ...requirementRelationships.filter((r) => /compatible|interface|protocol/i.test(r.relationshipType || "")),
  ...sourceFactCompatibility,                                                              // deliberately carries no targetItem
];
```

Three candidates were evaluated:

| Candidate | Verdict |
|---|---|
| `engineering_relationships` with `rightEntityId` | **Rejected.** `right_entity_id` is `NOT NULL`, so an ecosystem boundary would have to reference a real entity — i.e. a product or a manufacturer identity. That conflates manufacturer with compatibility, which GOLDEN-3 explicitly warned against. |
| Source Fact (`protocol_compatibility`) | **Rejected.** The engine deliberately gives these neither `targetItem` nor `rightEntityId`, so they can never satisfy the gate. |
| **`requirement_compatibility.target_item` via a linked, approved technical requirement** | **Chosen.** Free-text, structurally the same shape `detectMissingInformation` consumes, and the exact path item C already uses. |

## 4. Authority/provenance

The authority is the **human Technical Engineering Decision**, and it is recorded
as such:

- `technical_requirements.extraction_method = 'human-engineering-decision'`
- `source_location = {"basis":"HUMAN_ENGINEERING_DECISION"}`
- an `engineering_facts` row with `fact_type = 'Human Decision'`,
  `scope_type = 'Project'`, `predicate = 'fire_alarm_compatibility_basis'`

**Explicitly NOT claimed**, and asserted in the suite:
- the Specification does not mandate Honeywell — no fabricated clause is created;
- FlashScan/CLIP is **context only**. A test proves a `FlashScan / CLIP` protocol
  reference alone does **not** clear `compatibilityTarget`;
- Honeywell was not inferred;
- the five-manufacturer reference list is not authority.

The decision reason records that no explicit manufacturer mandate exists in the
project documents, that Honeywell/Notifier is adopted as the current engineering
compatibility basis, and that it may be superseded by later contractual evidence.

## 5. Scope/applicability

**The existing scope model is per-BOQ-item, and this is reported rather than
worked around.** `loadInputs` reads links with `WHERE l.boq_item_id = ?`, so a
system- or project-scoped link never reaches a profile's requirement set. There is
**no governed system-wide applicability mechanism for requirement links**.

What the architecture *does* support, and what was used: `boq_requirement_links`
is UNIQUE on `(boq_item_id, requirement_id, version_number)`, so **one**
requirement can legitimately serve **many** items. The decision is therefore
recorded **once** — one requirement row, one `requirement_compatibility` child row,
one human-decision fact — and propagated by **seven governed Confirmed links**.
The decision is not duplicated seven times, and no propagation mechanism was
invented.

## 6. Compatibility representation

```json
{
  "source_item": "Fire alarm control panel",
  "target_item": "Honeywell / Notifier Fire Alarm ecosystem (FlashScan / CLIP addressable-loop family)",
  "relationship_type": "Compatible With",
  "mandatory": 1,
  "review_status": "Approved"
}
```

A **compatibility relationship**, not a manufacturer assignment. Asserted: zero
`requirement_manufacturers` rows for the decision requirement, zero
`requirement_standards`, zero `requirement_attributes`, and no model-number
pattern in the target.

## 7. Supersession model

The decision is current and authoritative now, and **not** permanently immutable:
a later human decision is a new `technical_requirements` row with a new
`requirement_compatibility` child row and its own governed links. Proven by test:
a "Siemens Cerberus" basis is recorded and appears in the regenerated profile
alongside the earlier one, until a governed reversal retires the first through the
ordinary requirement-review lifecycle. No new immutability was introduced.

## 8–9. Profile regeneration and fingerprint behaviour

Measured on a **single continuous lifecycle** (generate → decide → regenerate) on
one database, because two separate fixtures would both legitimately start at
version 1 and could not prove retirement. For **all seven** items:

- `input_fingerprint` **changed**;
- a **new** `version_number` was created and the prior row gained
  `superseded_at` (non-current);
- `compatibilityTarget` **cleared** from `missingInformation`;
- `profile.compatibility` carries the Honeywell/Notifier target;
- `confidence.compatibility` becomes non-zero.

## 10. Readiness transition

`compatibilityTarget` disappears **specifically**. The profile is deliberately
**not** forced to `Ready for Matching` — the suite asserts it is **not**, and that
other missing fields remain individually reported. Readiness outcome for the
replica items: `Missing Critical Information` (other fields still missing).

## 11. Fresh matching run

**Not created by this slice, by design.** A pre-existing Discovery Only run keeps
its status and its original `requirement_profile_version_id`; the suite proves it
is **not** re-pointed at the new profile, and that the profile it referenced is now
non-current. A fresh governed matching run is required — fabricating one was
explicitly out of scope.

`DISCOVERY_ONLY` is no longer *caused by* the missing compatibility target,
because the compatibility evidence is now present in the profile. Whether a fresh
run clears `DISCOVERY_ONLY` for other reasons is **not claimed** here.

## 12. Seven-panel matrix

Replica of the acceptance project's seven-panel condition, per item:

| # | Decision reached profile input | Profile regenerated | `compatibilityTarget` satisfied | Other blockers remain | Matchable now? |
|---|---|---|---|---|---|
| 1 (Item G) | yes | yes (new version) | yes | yes | **No** — other missing fields |
| 2–7 | yes | yes (new version) | yes | yes | **No** — other missing fields |

**The GOLDEN-3 asymmetry is preserved and not concealed.** Asserted: item G carries
**3** Confirmed approved requirements (its 2 original SLC-wiring/network-topology
rows + the compatibility decision); the other six carry **1** (the compatibility
decision only). Their missing requirement linkage is a real, still-open blocker.

## 13. Candidate/safety outcome

No candidate was approved and no safety record was created — asserted
(`safety_decisions` and `safety_approval_requests` are both empty). No
`DISCOVERY_ONLY` cause attributable to the compatibility target survives.

## 14. Primary-selection reachability

GOLDEN-2's governed approval route requires a profile at `Ready for Matching`
(`approve-readiness` returns 409 otherwise). Since other fields remain missing,
**that route is not yet reachable** for these items — and this slice does not force
readiness. Reaching it requires the separate requirement-linkage and
source-evidence work, not this decision.

## 15. Remaining blockers

1. **Missing requirement linkage** for 6 of 7 items (GOLDEN-3's finding, unchanged).
2. **Other `missingInformation` fields** per item (e.g. product family, standard)
   still block readiness.
3. `DISCOVERY_ONLY` may persist for reasons other than compatibility until a fresh
   governed matching run executes.
4. No live run has been executed; everything is proven on replicas.

## 16. Live execution plan

Live D1 stayed read-only. Exact plan, on authorization only:

1. `technical_requirements`: one row, `extraction_method='human-engineering-decision'`,
   `source_location.basis='HUMAN_ENGINEERING_DECISION'`, `review_status='Approved'`,
   `approved_for_downstream=1` — via the **existing** governed requirement-review
   route (`POST /api/requirements/{id}/approve`), with the full decision text as
   `reason`, so `requirement_review_decisions` and `document_audit_events` are written
   by the existing governed path.
2. `requirement_compatibility`: one child row with the ecosystem `target_item`.
3. `boq_requirement_links`: seven rows, `status='Confirmed'`, one per FACP BOQ item
   — after resolving each item's real id and profile version.
4. `engineering_facts`: one `Human Decision` project-scope provenance row.
5. Regenerate each of the seven profiles through the existing
   `POST /api/boq-items/{id}/requirement-profile/recalculate`.
6. Re-run product matching per item through the existing governed route.
7. Verify with `npm run test:knowledge` and the Golden suites.

## 17. Tests

New `tests/golden-4-fire-alarm-compatibility-decision.test.mjs` — **11/11**, real
active chain, no SQL mock, in-memory only. Covers required items 1–16, plus an
explicit guard that the requirement engine contains **no** hardcoded
manufacturer.

| Suite | Result |
|---|---|
| `golden-4-fire-alarm-compatibility-decision` (new) | 11/11 |
| `technical-requirement-engine` | 19/19 |
| `product-matching-engine` / `-api` | 77/77, 6/6 |
| `confidence-safety-engine` | 16/16 |
| `engineering-knowledge` | 21/21 |
| `technical-requirement-review-workspace` | 3/3 |
| `governance-authority-gaps` | 7/7 |
| `golden-2` / `golden-3` | 22/22, 24/24 |
| `npm test` | **519/519** |
| `npm run build` | passes |
| lint (touched) | 0 errors, 0 warnings |
| `test:all` | 4096 tests, 4079 pass, **3 fail** |

The 3 `test:all` failures are the long-standing pre-existing
`boq-line-bom-summary` (×2) and `review-workflow-atomic` R8 (×1), A/B-proven
unrelated in earlier slices; this slice changes no production file at all.

## 18. Files changed

| File | Change |
|---|---|
| `tests/golden-4-fire-alarm-compatibility-decision.test.mjs` | **new**, 11 tests |
| `scripts/test-classification-baseline.json` | drift re-recorded (422 files) |

**No production source file was modified.** The canonical model already expresses
everything required, which is why the mission needed no implementation. One
fixture name was corrected: it originally read "Al Mousa-shaped Project", which
made the inventory classifier flag the file `REAL_STATE` on a name match alone.
The fixture contains none of that project's data, so the name was corrected rather
than recording a false exclusion.

## 19. Business-state writes

None. The acceptance project `project_c0123d91-…` was **not** written to; no live
D1 access; no approval, no matching run, no safety record, no panel-sizing
snapshot, no pricing or quotation mutation; no commit, push, deploy or restart.

## 20. Next Golden slice

**Resolve the missing requirement linkage for the six FACP items with zero linked
technical requirements** (GOLDEN-3 §5, still open). It is now the dominant blocker:
the compatibility boundary is governed and satisfied, but without linked
requirements those six items cannot reach a candidate population at all, so
readiness and matching cannot advance. The panel-sizing snapshot prerequisite
(Agent 3's `PANEL_SIZING_SNAPSHOT_REQUIRED`) remains a separate dependency.

---

## 21. Addendum — GOLDEN-5 §15 fixture refactor (post-closure)

**This doc previously closed with a hand-written `Honeywell / Notifier` human
decision as its fixture evidence. On GOLDEN-5 closure the fixture was refactored
so the exact same canonical lifecycle is proven with a genuinely
policy-resolved ecosystem, per GOLDEN-5 §15. This addendum records the change;
it does not re-open GOLDEN-4's verdict.**

### What changed

- `tests/golden-4-fire-alarm-compatibility-decision.test.mjs` now seeds the
  decision through `app/domain/fire-alarm-ecosystem-policy.mjs`:
  `resolveFireAlarmEcosystem({ complianceRegime: "UL/FM", preliminaryTotalPoints:
  1500, complexity: "not-exceptional" })` → `RESOLVED_FARENHYT` →
  target **`Honeywell Farenhyt Fire Alarm ecosystem`**.
- The hand-written `Honeywell / Notifier compatibility family (FlashScan / CLIP
  addressable-loop family)` target text is gone. No Honeywell/Notifier target
  remains hand-written anywhere in the fixture; the ecosystem vocabulary lives
  only in the governed policy module.
- Authority provenance changed accordingly:
  - `extraction_method = 'engineering-policy-resolution'`
  - `source_location.basis = 'ENGINEERING_POLICY_RESOLUTION'`
  - `engineering_facts` row: `fact_type = 'Project Rule'`,
    `predicate = 'fire_alarm_ecosystem_basis'`, `scope_type = 'Project'`
- The supersession test ("a later governed decision can supersede the current
  compatibility basis") still uses a governed **human** decision (Siemens
  Cerberus, `HUMAN_ENGINEERING_DECISION`) — that authority type remains
  legitimate under GOLDEN-5 (Rule D base) and the test proves the supersession
  mechanism, not a manufacturer assumption. Its earlier-basis reference text was
  updated from "Honeywell / Notifier" to "policy-resolved Honeywell Farenhyt".

### What is preserved (the 11 governance assertions)

1. No decision → `compatibilityTarget` missing on all seven items, readiness
   blocked, no compatibility relationship.
2-6. One canonical decision row + one `requirement_compatibility` child + seven
   `Confirmed` links; a provenance fact; no manufacturer rows, no standards, no
   structured attributes, no model numbers; the decision is a compatibility
   relationship, never a manufacturer assignment.
5-6. FlashScan/CLIP and the manufacturer list remain **context, never authority**.
7-9. Fingerprint change, new profile version, prior version retired,
   `compatibilityTarget` cleared, Farenhyt relationship present.
10. Other independent blockers remain visible; readiness is not forced.
14. No panel model / loop capacity / topology / expansion selected; no sizing
   snapshot created.
15. A later governed decision can supersede the basis; both coexist until
   governed away.
16. All seven items reach the decision through profile input; item G keeps its
   2 original requirements, the other six carry only the decision.
Engine. The requirement engine contains no manufacturer-specific authority.
12-13. Profile compatibility evidence is what changes; no approval is created.
11. A pre-existing Discovery Only run is never re-pointed at a regenerated
   profile; no match run is fabricated.

The suite still passes 11/11 against the refactored fixture, and GOLDEN-5 §15's
own suite additionally proves the same lifecycle end-to-end on its own fixtures
(with the FlashScan/CLIP and 2,000-point threshold negative guards).
