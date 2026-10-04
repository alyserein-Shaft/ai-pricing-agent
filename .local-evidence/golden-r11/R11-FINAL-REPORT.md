# Golden R11 — Master Continuation Mission — FINAL REPORT

**Project:** Al Mousa School — Clean Golden Run
**Project ID:** `project_ae501b85-9c12-4332-bf8e-787c90f2d388`
**Date:** 2026-09-27
**Terminal condition:** **GOVERNED HOLD — HUMAN DECISION REQUIRED**

---

## 1. Executive summary

All machine-resolvable work on Golden R11 is complete and verified. The
pipeline ran end-to-end for the first time on this project: understanding
analysis reached full coverage, the deterministic linker executed, the
governed system-auto-approval policy ratified the reproducible subset, and
requirement profiles were generated for every item that has a confirmed
requirement link.

The run did **not** produce a draft quotation, and correctly so. Every
remaining blocker is a governed human engineering decision — specifically the
confirmation of `standard`, `compatibilityTarget`, `productFamily` and the
Understanding review queue — none of which may be fabricated, inferred from
web knowledge, or auto-approved on AI confidence alone.

Two genuine defects were found and repaired at their canonical source during
this run (taxonomy, not workarounds). One genuine architectural finding
emerged: **the canonical operation order is link → analyse → approve → profile**,
not the reverse; operating it in reverse is *safe* (the system invalidates
stale approvals) but wasteful.

---

## 2. Terminal state (canonical, read from the APIs and D1)

### Population
| Measure | Count |
|---|---|
| Current authoritative BOQ items | 82 |
| Technical requirements approved + approved_for_downstream | 59 |
| Requirement profiles (current) | 82 |

### Understanding (BOQ analysis) — CONVERGED
| Measure | Count |
|---|---|
| Eligible items | 82 |
| Attempted / analyzed | 70 |
| Not analyzed (governed non-product `Lump Sum` interface functions) | 12 |
| `analysisDebt` | **0** |
| `selectableNew` | **0** |
| `hasMoreSelectable` | **false** |
| `revalidationRequired` | **0** |
| Approved (governed decisions on record) | 12 |
| Awaiting human review | 58 |

### Requirement applicability links (deterministic linker)
| Status | Count |
|---|---|
| Confirmed (deterministic auto-confirm) | 68 |
| Suggested | 556 |
| Needs Review | 6 |
| **Active total** | **630** |

### Requirement profile readiness (current)
| Readiness | Count |
|---|---|
| Ready with Warnings | 14 |
| Classification Required | 44 |
| Needs Technical Review | 18 |
| Missing Critical Information | 6 |
| **Approved for matching** | **0** (human gate — correctly not exercised) |

### Other
- Intelligence facts on current profiles: 1401, **all `Needs Review`** (human decision by design).
- No matching, no costing, no pricing was started (governed prerequisite unmet).

### Baseline comparison (mission start → now)
| Measure | Baseline | Now |
|---|---|---|
| Understanding analyzed | 8 of 82 | **70 of 82** (12 governed exclusions) |
| Approved understanding | 0–9 | 12 |
| Requirement links | 0 | 630 (68 confirmed) |
| Profiles ready with warnings | 0 | 14 |
| Profiles approved for matching | 0 | 0 (human gate) |

---

## 3. Phases executed

### Phase 1 — Constraint restore (migration `0011`) — COMPLETE
Hand-authored forward migration `0011_requirement_intelligence_constraint_restore.sql`
restored the two `NOT NULL` constraints (`evidence_snippet`, `review_status` with
`dflt='Needs Review'`) that migration `0010`'s table rebuild had lost in the live
chain, while preserving 2 CHECKs and 2 FKs. Applied live, verified, and proven
outcome-idempotent. Chain 0000→0011 = 12 SQL / 12 journal / 12 snapshots.
Evidence: `.local-evidence/phase1-0011-constraint-restore.md`.

### Phase 2 — Frozen-pin classification — COMPLETE
The three `migration-baseline-safety` frozen pins (STALE/FROZEN) were classified
as test-pinned assertions and documented, not "fixed" (documented-only per mission).

### Phase 3 — Link-authority investigation — COMPLETE
A subagent mapped every writer route and confirmed the canonical deterministic
linker is `POST /api/projects/{id}/engineering-knowledge/suggest-links`, wired but
never executed for Golden. Confirmed the governance order and that
`persistProfile` is the only approved-Understanding → category path.

### Phase 5 — Understanding analysis coverage — COMPLETE
Drove the canonical pilot loop (`pilot-manifest` → `run`, `mode=CONTROLLED_PILOT`):
7 batches → full coverage (`selectableNew=0`). Re-drained once more after
linking (see §5) to reach a stable fixed point.

### Phase 6 — Taxonomy repairs (two real defects) — COMPLETE
Repaired through the canonical governed taxonomy (`app/domain/fire-alarm-taxonomy.mjs`),
with regression tests, no Golden special cases:

1. **Strobe/Sounder contradiction.** `classifyFireAlarmFamilyFromText("Loop powered
   strobes with sounder …")` returned `Strobe` while `analyzeRequirementFamilyPhrase`
   returned `Sounder/Strobe`. Root cause: the governed `Sounder/Strobe` alias list
   owned only the "sounder (with) strobe" conjunction, never the inverted "strobe
   with sounder" form. Fix: added the four inverted conjunction phrases. Both
   classifiers now agree (`Sounder/Strobe`); bare Strobe/Sounder unaffected.
   This also prevents the auto-approval policy from ratifying the wrong family.
2. **"Fireman telephone jack" resolved to no family** (4 Golden rows, product
   FFT-FPJ). The modern "fire fighter telephone jack" resolved; "fireman" was
   missing from the governed alias list, the requirement vocabulary, and the
   fire-service-context regex. Fix: added fireman/firemen forms to all three.
   The 4 rows now resolve to `Firefighter Telephone`.

Verification: 2 new regression tests; 17 suites re-run green; the frozen
`fire-alarm-golden` evaluation gate **PASSED** (0 true matching errors, 0 false
resolves, 12/12 engineer-review). Evidence: `.local-evidence/phase6-taxonomy-repairs.md`.

### Phase 8 — Governed system-auto-approval — COMPLETE
Drove the per-item `system-auto-approval` route for every AVAILABLE proposal using
the production row resolver. The pure policy gates approval on deterministic
reproducibility (family/category exactly reproducible from raw text, system
confirmed by deterministic section context, only `detector_technology` EXTRACTED,
no unverified manufacturer/standards/compatibility claims) — **never AI confidence**.
Net: 18 applied in the first pass; after the link-driven re-analysis, 4 more
applied. The remaining items are correctly declined with documented reasons
(most commonly `ATTRIBUTE_EXCEEDS_EVIDENCE` for richer attributes, or family not
deterministically reproducible). The 9 items that "declined" with only *positive*
policy reasons were the already-approved items correctly hitting the idempotency
guard (409 `UNDERSTANDING_REVIEW_IDEMPOTENCY_CONFLICT`) — expected, not a defect.

### Phase 4/9 — Deterministic linking + profile regeneration — COMPLETE
- `suggest-links` created 630 active links; 68 auto-confirmed **deterministically**
  (exact-equipment + category + approved-downstream requirement, actor "Requirement
  Applicability Engine" — the governed path, not AI confidence).
- Regenerated requirement profiles for all 19 items holding a Confirmed link, via
  the canonical queued `generate`/`recalculate` path.

---

## 4. Architecture finding — canonical operation order

Operating approve-then-link caused the system to correctly invalidate 19 fresh
approvals: `confirmedSpecifications` (`worker/estimator-understanding-api.mjs:707`)
feeds **Confirmed requirement links** into the Understanding input, so creating
the 68 links shifted the input fingerprint and the safety engine marked those
approvals `REVALIDATION_REQUIRED`. This is correct, fail-safe behavior — but the
**efficient canonical order is**:

```
suggest-links  →  understanding analysis  →  understanding approval  →  profile generate  →  approve-readiness
```

After re-running analysis and approval in that order, the state reached a stable
fixed point (`revalidationRequired=0`, `selectableNew=0`). This ordering should be
encoded in the operator runbook so the re-analysis churn is not repeated.

---

## 5. G9 / G10 revalidation (pre-human-packet)

- **G9 — elevator interface.** Revalidated against live state: the 12
  non-analyzed rows are `Lump Sum` **interface/control functions**
  ("Signals to elevators…", "Control of HVAC equipment…", "Control and monitor
  element…"). The governed taxonomy classifies these as *function without hardware
  identity* (`NO_PRODUCT_FAMILY`) — legitimately outside product Understanding and
  outside purchasable quotation. Confirmed consistent with the documented finding.
  (Web research corroborates the function-without-hardware reading: NFPA 72 Ch. 21.3
  emergency-control interfaces are system functions, not separately-purchased
  devices.)
- **G10 — combined smoke + heat.** The live "Combined smoke and heat detector"
  rows resolve to `Needs Technical Review` ("No confirmed mandatory technical
  baseline exists") or `Classification Required` (product family unconfirmed).
  Whether a combined multi-sensor device is required is a **specification/standards
  question for the engineer** against the governing document — not a value the
  pipeline may assert.

---

## 6. Authority-hierarchy research (informs the human packet only)

Per the mission's authority hierarchy (project evidence → Saudi AHJ/SBC → NFPA/UL/EN/IEC/BS
→ certification → manufacturer → precedent → historical), web research establishes
the *reference frame* for the engineer's decision. **None of this is auto-promoted
into a Project Requirement; it is presented for human adjudication only.**

- **Governing code:** For a Saudi school (education occupancy), the governing fire
  code is **SBC 801 (Saudi Fire Code)**, which references and is substantially based
  on **NFPA 72** (National Fire Alarm and Signaling Code). Enforcement is by Saudi
  Civil Defense (GDCD), which expects SBC 801–compliant submissions (e.g. structured
  cause-and-effect matrices). SBC 801 is a distinct code with independent legal
  standing, not a wholesale adoption of NFPA 72.
- **Elevator interface (G9):** Phase I emergency recall and related emergency-control
  function interfaces are governed by **NFPA 72 Chapter 21.3** (recall initiated by
  specific smoke detectors at elevator lobby / machine room / hoistway; recall and
  shunt functions). These are *system functions* delivered through the FACP and
  elevator controls — reinforcing that the "Signals to elevators" BOQ rows carry no
  standalone product identity.
- **Compatibility target:** For the Fire Alarm items, the natural compatibility
  boundary is the project FACP / addressable loop and its approved manufacturer
  (e.g. the loop protocol of the specified panel), plus UL/FM listing and SASO
  acceptance. **Which panel/loop the project actually mandates is a
  project-drawing/specification fact** and must be confirmed by the engineer — it
  is exactly the `compatibilityTarget` field the profile engine is (correctly) refusing
  to guess.

---

## 7. Why the terminal condition is GOVERNED HOLD (not BLOCKED, not complete)

Every automated stage that *can* be run without a human decision has been run to a
stable, verified fixed point. What remains is irreducible human engineering work:

1. **Understanding review queue (58 items).** Each requires a reviewer to accept,
   edit-and-accept, or reject the AI-proposed classification. Deterministic
   auto-approval already ratified the reproducible subset; the rest are declined by
   policy with reasons (attributes exceeding evidence, non-reproducible family, or
   ungoverned/system-unconfirmed rows). A human — not the agent — must decide these.
2. **Standards confirmation.** Open `Clarification`/`Missing Information` items ask
   the engineer to cite the governing document for `standard`.
3. **Compatibility target confirmation.** Open `Missing Critical Information` (6
   items) are blocked on `compatibilityTarget` — the FACP/loop the project mandates.
4. **Product-family confirmation.** `Classification Required` items (e.g. combined
   smoke+heat) need the engineer to confirm category/family against the spec.
5. **Readiness approval (matching gate).** Even the 14 "Ready with Warnings" profiles
   require an explicit engineering approval (`approve-readiness`) with a substantive
   reason before matching may begin. `approved_for_matching` remains 0 by design.

None of these may be auto-resolved, impersonated, or inferred from web knowledge.

---

## 8. Evidence index

- `.local-evidence/phase1-0011-constraint-restore.md` — Phase 1 + 2 (constraint repair, frozen-pin classification)
- `.local-evidence/phase6-taxonomy-repairs.md` — Phase 6 (two taxonomy defect repairs + verification)
- `.local-evidence/golden-r11/system-auto-approval-run-1.json` — per-item auto-approval outcomes
- `.local-evidence/scratch/drive-auto-approval.mjs` — governed auto-approval driver (reuses production row resolver)
- `.local-evidence/scratch/probe-taxonomy.mjs`, `probe-r11.mjs` — taxonomy probes
- `drizzle-active/0011_requirement_intelligence_constraint_restore.sql` + `meta/0011_snapshot.json` — head migration

## 9. Recommended next action (human)

1. Triage the 58-item Understanding review queue (approve the correct classifications).
2. Confirm the governing `standard` and the `compatibilityTarget` (FACP/loop) for the
   Fire Alarm items, citing SBC 801 / NFPA 72 and the project specification.
3. Confirm the product family for the combined smoke+heat and other
   `Classification Required` items.
4. Only after readiness is approved (`approved_for_matching`), proceed to technical
   matching → costing → draft quotation.
