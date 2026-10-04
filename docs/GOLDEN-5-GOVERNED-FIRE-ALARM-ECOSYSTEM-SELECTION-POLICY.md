# GOLDEN-5 — Governed Fire Alarm Ecosystem-Selection Policy

**Mode:** pure-domain implementation + replica-schema proof. No live business-state mutation.
**Continues:** `docs/GOLDEN-4-GOVERNED-FIRE-ALARM-COMPATIBILITY-DECISION.md` (closed, refactored per §15; not reopened)
**Upstream of this policy:** `docs/fire-alarm-brand-and-pre-sales-policy.md` — the company Fire Alarm **Brand Strategy** layer (in-house brands Farenhyt / Gamewell / Gent, mandatory-brand override, supplier-assisted pre-sales). This document answers *which ecosystem is technically/evidentially compatible*; it does not decide *which brand the company prefers to source*. Brand strategy is applied first, then this policy. Nothing below is superseded by it.
**Tree baseline:** HEAD `029b42637ac117f810e726b40c2e888c484c173b` (worktree remains dirty with concurrent lanes; nothing committed)

---

## 1. Executive verdict

🟢 **`CLOSED — GOVERNED FIRE ALARM ECOSYSTEM SELECTION POLICY PROVEN`**

The question *"which Fire Alarm ecosystem/compatibility family governs this project?"* is
no longer answered by the assumption that *"Honeywell / Notifier is the project-wide
compatibility basis."* It is answered by a governed, pure-domain selection policy —
`app/domain/fire-alarm-ecosystem-policy.mjs` (`fire-alarm-ecosystem-policy-1.0.0`) —
that resolves the ecosystem family from **governed inputs only**, fails closed on
ambiguity, and never produces a compatibility target in an unresolved state.

The policy is a **pure domain module** (no DOM, no fetch, no DB, no `Math.random`),
written in the house style of `evidence-authority-policy.mjs`, and it plugs into the
**exact canonical persistence architecture GOLDEN-4 proved**: decision →
`requirement_compatibility` child row → `boq_requirement_links` → profile regeneration →
changed fingerprint → new version → `compatibilityTarget` cleared. Nothing was rebuilt;
the policy only changes *what decides the ecosystem*, never *how a decision is governed*.

**No parallel compatibility table was invented.** `requirement_compatibility.target_item`
remains canonical. **Source facts alone still never satisfy `compatibilityTarget`.**
**Manufacturer identity is still never compatibility evidence.**

---

## 2. The policy (implementation)

### 2.1 Where it lives

`app/domain/fire-alarm-ecosystem-policy.mjs` — pure domain exports:

| Export | Value |
|---|---|
| `FIRE_ALARM_ECOSYSTEM_POLICY_VERSION` | `"fire-alarm-ecosystem-policy-1.0.0"` |
| `FARENHYT_PRELIMINARY_POINT_THRESHOLD` | `2000` (internal threshold, `thresholdIsCertifiedMaximum: false`) |
| `FARENHYT_THRESHOLD_WORDING` | `"internal engineering/business selection threshold, not a manufacturer-certified technical maximum"` |
| `ECOSYSTEM_DECISION_STATES` | 7 states (3 resolved, 4 unresolved review states) |
| `COMPLIANCE_REGIMES` | `UL/FM`, `LPCB/EN54/European` |
| `RESOLVED_ECOSYSTEM_TARGETS` | Farenhyt, Gent, Gamewell-FCI, Simplex (all end `"Fire Alarm ecosystem"`, never a SKU) |
| `LARGE_ULFM_CANDIDATES` | Gamewell-FCI + Simplex only (never auto-picked) |
| `AUTHORITY_BASES` | `PROJECT_REQUIREMENT`, `HUMAN_ENGINEERING_DECISION`, `ENGINEERING_POLICY_RESOLUTION` |
| `POLICY_RULES` | RULE_A / RULE_B_GENT / RULE_B_MISSING / RULE_C_FARENHYT / RULE_C_SIZING_SNAPSHOT_REQUIRED / RULE_C_LARGE_SYSTEM_EVALUATION / RULE_C_COMPLEXITY_REVIEW / RULE_D_APPROVED_LARGE_SYSTEM_SELECTION |
| normalizers | `normalizeComplianceRegime`, `normalizeComplexityEvidence` |
| resolver | `resolveFireAlarmEcosystem(inputs)` → decision |
| helper | `ecosystemIsResolved(decision)` |

### 2.2 Decision states (all seven)

| State | `compatibilityTarget` | Means |
|---|---|---|
| `EXPLICIT_PROJECT_ECOSYSTEM` | set | A governed Project requirement names the ecosystem (Rule A) |
| `RESOLVED_FARENHYT` | set | UL/FM regime, ≤2,000 points, not-exceptional (Rule C) |
| `RESOLVED_GENT` | set | LPCB / EN54 / European regime (Rule B) |
| `LARGE_ULFM_ECOSYSTEM_EVALUATION_REQUIRED` | **null** | >2,000 points OR exceptional complexity; candidates surfaced, no auto pick (Rule C) |
| `MISSING_FIRE_ALARM_COMPLIANCE_BASIS` | **null** | no regime evidence, or contradictory (Rule B) |
| `PANEL_SIZING_SNAPSHOT_REQUIRED` | **null** | UL/FM with no preliminary point count (Rule C) |
| `COMPLEXITY_REVIEW_REQUIRED` | **null** | UL/FM with point count but insufficient complexity evidence (Rule C) |

### 2.3 Rule ladder (checked in order)

1. **Rule A — explicit project ecosystem wins.** If a governed Project-scope requirement
   names the ecosystem, it wins over every default, with basis `PROJECT_REQUIREMENT`.
2. **Rule B — compliance regime.** UL/FM vs LPCB/EN54/European (→ Gent) vs unknown/contradictory
   (→ `MISSING_FIRE_ALARM_COMPLIANCE_BASIS`). No compatibility target in unresolved states.
3. **Rule C — UL/FM preliminary sizing.**
   - No point count → `PANEL_SIZING_SNAPSHOT_REQUIRED` (the sizing snapshot is **input evidence**,
     never created here).
   - ≤2,000 points AND not-exceptional → `RESOLVED_FARENHYT` (`2000` is an **internal** threshold).
   - >2,000 points OR established high complexity → `LARGE_ULFM_ECOSYSTEM_EVALUATION_REQUIRED`
     with candidates Gamewell-FCI + Simplex; **no auto pick, no target until approved**.
   - Point count present but complexity evidence insufficient → `COMPLEXITY_REVIEW_REQUIRED`.
4. **Rule D — approved large-system selection.** An explicit approved human selection of
   **exactly one** candidate resolves via `EXPLICIT_PROJECT_ECOSYSTEM` with basis
   `HUMAN_ENGINEERING_DECISION` (the basis distinguishes authority when the state is shared).

**Hard invariants encoded in the module:** only resolved states ever carry a
`compatibilityTarget`; FlashScan/CLIP protocol references are **context only**, never
consulted for resolution; the 2,000-point threshold is **never** presented as a certified
technical maximum; complexity is tri-state (high / not-exceptional / insufficient) and the
policy **never guesses**; manufacturer identity is never conflated with compatibility
evidence; the decision is expressed as an ecosystem target for
`requirement_compatibility`, never as a manufacturer assignment.

---

## 3. Evidence-input feeding

The module is deliberately free of any D1/schema dependency; its schema has **no
regime-point-count column**, so governed inputs are mapped from evidence:

- `complianceRegime` — normalized from evidence text by `normalizeComplianceRegime`
  (UL/ULC/FM/UL-FM → `UL/FM`; EN54/LPCB/BS 5839/European → `LPCB/EN54/European`;
  contradictory or unrecognized → `null`, fail closed).
- `preliminaryTotalPoints` — mapped from the panel-sizing snapshot's
  `calculation_json.projectTotal` shape as a **documented forward-looking bridge**
  (`normalizedPoints` keeps `null`/`undefined`/`""` distinct from `0`, so a missing point
  count can never be masked as zero). The sizing snapshot table
  (`drizzle-active/0004_fire_alarm_panel_sizing_snapshots.sql`) is **immutable input
  evidence**; nothing in this slice creates a row, and no project in any environment has
  ever had one — the fixture maps the point count from calculation JSON as governed input.
- `complexity` — normalized by `normalizeComplexityEvidence` (canonical tokens
  `high` / `exceptional` / `not-exceptional` / `small system` etc.); contradictory
  extremes fail closed to `null`, which routes to a review state.
- `explicitProjectEcosystem` — a governed, Active, non-`Source Fact` Project-scope
  requirement (the `loadInputs` contract) or a Rule D approved selection.
- `protocolReferences` (e.g. FlashScan / CLIP) — accepted, recorded as context, **never
  consulted for resolution**, and surfaced as `protocolReferencesIgnored` so the caller
  can see the policy was not swayed by them.

`resolveFireAlarmEcosystem` returns `{ decisionState, compatibilityTarget, resolvedEcosystem,
ruleId, basis, inputsUsed, protocolReferencesIgnored, needsReview, candidates?, reason,
version, thresholdIsCertifiedMaximum }` — every decision carries full provenance.

---

## 4. Persistence path (canonical, GOLDEN-4 architecture)

A policy resolution is persisted through the **same canonical rows** GOLDEN-4 proved
(§15 of this slice refactored GOLDEN-4's fixture to prove exactly this):

1. **Decision** → `technical_requirements` row, `review_status='Approved'`,
   `extraction_method='engineering-policy-resolution'` (free TEXT),
   `source_location.basis='ENGINEERING_POLICY_RESOLUTION'` with rule/input trace.
2. **Canonical evidence** → one `requirement_compatibility` child row whose
   `target_item` is the policy's canonical ecosystem target (Rule A/B/C/D provenance
   recorded). **Source facts alone never satisfy `compatibilityTarget`** (regression
   guard re-asserted in §14).
3. **Applicability** → `boq_requirement_links` (`status='Confirmed'`), one link per
   applicable BOQ item — **never a fan-out** (one decision → one compat row →
   N links).
4. **Provenance** → `engineering_facts` row: `fact_type='Project Rule'` (a valid
   `FACT_TYPES` member, Project scope), `predicate='fire_alarm_ecosystem_basis'`,
   `scope_type='Project'`, so the resolution is traceable like any governed fact.
5. **Regeneration** → profile fingerprint changes, a new
   `requirement_profile_versions` row appears, the prior version is superseded, and
   `compatibilityTarget` clears in `detectMissingInformation`. **Old runs are never
   re-pointed** (a pre-existing Discovery Only match run stays bound to the profile it
   was created against); **readiness is never forced** (unrelated blockers remain).

No live D1 mutation, no requirement approval, no compat propagation to other items, no
matching run, no safety approval, no panel model/loop/topology/card selection, no sizing
snapshot, no pricing/quotation mutation, no deployment, no restart.

---

## 5. All-branch tests

`tests/golden-5-fire-alarm-ecosystem-policy.test.mjs` — **18 tests, all green**:

- **§13 acceptance table (18 scenarios, table-driven)**: Rule A explicit ecosystem
  (target wins with basis `PROJECT_REQUIREMENT`); Rule B Gent (EN 54-2, LPCB,
  European standard) and missing basis (unknown, contradictory UL+EN54); Rule C
  Farenhyt (1,500 pts; **boundary 2,000 inclusive**; 2,001 → large evaluation),
  sizing-snapshot-required (no points), complexity-review-required (insufficient
  complexity), large UL/FM state (candidates, no auto pick); Rule D approved selection
  (Gamewell-FCI / Simplex resolve with basis `HUMAN_ENGINEERING_DECISION`); invalid
  approved selection refused; protocols alone never resolve; UL/FM with protocols ignores
  them and still resolves Farenhyt.
- **Holistic contract test**: versioned module, canonical targets are families not SKUs,
  `thresholdIsCertifiedMaximum:false`, authority-basis set, seven states.
- **Rule A precedence** (explicit ecosystem wins over contradictory UL/FM+sizing input;
  the input trace records the explicit ecosystem).
- **Regime normalization unit tests** (fails closed on contradiction; raw `"EN 54-2"`
  routes to Gent).
- **Complexity normalization unit tests** (never guesses; contradictory extremes → null).
- **§14 negative assertions (six test blocks, read-only + replica)**:
  1. The 2,000 threshold is an internal selection threshold — reason text **never**
     claims certification (`/certified (technical )?maximum for|listed (up to|for)|rated
     (up to|for)/i` must not match).
  2. The policy never auto-selects between Gamewell-FCI and Simplex — a refused
     "approved" Farenhyt selection on a large system yields `LARGE_ULFM_…_REQUIRED`,
     `compatibilityTarget: null`.
  3. No compatibility target exists in **any** unresolved state (missing regime, missing
     points, missing complexity, large-branch pre-approval, protocol-only).
  4. FlashScan / CLIP protocol reference **alone** never resolves an ecosystem and never
     clears `compatibilityTarget` (regression guard).
  5. A large evaluation with **no approval** writes **no** `requirement_compatibility`
     row and leaves the target missing (replica-schema assertion, not just a unit check).
  6. The requirement engine (`technical-requirement-engine.mjs`) contains **no
     manufacturer-specific ecosystem vocabulary** (file-read guard) — the policy module
     owns that vocabulary, the engine never does.
- **§15 canonical lifecycle (policy-resolved)**: with no resolution the blocker is real
  on all seven items; resolution creates canonical, provable evidence with policy
  provenance (`extraction_method='engineering-policy-resolution'`, basis
  `ENGINEERING_POLICY_RESOLUTION`, `Project Rule` / `fire_alarm_ecosystem_basis` fact);
  regeneration changes the fingerprint, retires the prior version, clears the blocker;
  readiness is not forced; the resolution selects no panel model / loop capacity /
  topology / expansion module; supersession via a governed lifecycle (Gent supersedes
  Farenhyt — old Discovery Only run not re-pointed).
- **§16 propagation matrix**: one policy resolution reaches **all seven** control-panel
  items through profile input via the canonical requirement — 1 decision → 1 compat
  child row → 7 `Confirmed` links; the asymmetry is preserved (item G keeps its 3 linked
  requirements, the other six keep only the decision's link).

---

## 6. GOLDEN-4 regression proof (§15 refactor)

GOLDEN-4's fixture previously recorded a **hand-written** "Honeywell / Notifier" human
decision. Per §15, the fixture now seeds the decision **through the policy**
(`resolveFireAlarmEcosystem({ complianceRegime:"UL/FM", preliminaryTotalPoints:1500,
complexity:"not-exceptional" })` → `RESOLVED_FARENHYT` →
**"Honeywell Farenhyt Fire Alarm ecosystem"**), keeping all **11 governance
assertions**, which still pass **11/11**:

1. No decision → `compatibilityTarget` missing on all seven items, readiness blocked.
2–6. One canonical decision + one `requirement_compatibility` child + seven links; policy
   provenance fact (`Project Rule` / `fire_alarm_ecosystem_basis`); no manufacturer rows,
   no standards, no attributes, no model numbers.
5–6. FlashScan/CLIP and the five-manufacturer list remain **context, never authority**.
7–9. Fingerprint change, new version, prior retired, blocker cleared, Farenhyt target.
10. Other independent blockers remain visible; readiness not forced.
14. No panel model / loop capacity / topology / expansion; no sizing snapshot.
15. A later governed decision (Siemens Cerberus, `HUMAN_ENGINEERING_DECISION` — still a
   legitimate authority per Rule D) can supersede the policy basis.
16. All seven items reach the decision through profile input (asymmetry preserved).
Engine. The engine contains no manufacturer-specific authority.
12–13. Profile compatibility evidence is what changes; no approval is created.
11. A pre-existing Discovery Only run is never re-pointed; no run is fabricated.

The marked addendum (§21) was appended to `docs/GOLDEN-4-GOVERNED-FIRE-ALARM-COMPATIBILITY-DECISION.md`
recording that the fixture authority moved from a human Honeywell/Notifier decision to
policy resolution, and that GOLDEN-4's verdict is **not reopened**.

---

## 7. Files changed

| File | Change |
|---|---|
| `app/domain/fire-alarm-ecosystem-policy.mjs` | **new** — GOLDEN-5 policy engine (pure domain) |
| `tests/golden-5-fire-alarm-ecosystem-policy.test.mjs` | **new** — 18 tests (§13 table, §14 negatives, §15 lifecycle, §16 propagation) |
| `tests/golden-4-fire-alarm-compatibility-decision.test.mjs` | §15 refactor — policy-resolved Farenhyt seed + policy-resolved supersession evidence; 11 assertions kept |
| `docs/GOLDEN-4-GOVERNED-FIRE-ALARM-COMPATIBILITY-DECISION.md` | marked §15 refactor addendum (§21) |
| `scripts/test-classification-baseline.json` | **new test registered** `tests/golden-5-fire-alarm-ecosystem-policy.test.mjs|SAFE` (alphabetical, after golden-4) |

**No production worker, engine, schema, migration, or other source file was modified by
this slice.** Concurrent-lane changes present in the tree are attributed, not repaired.

---

## 8. Test results

| Suite | Result |
|---|---|
| `node --test tests/golden-5-fire-alarm-ecosystem-policy.test.mjs` | **18/18 pass** |
| `node --test tests/golden-4-fire-alarm-compatibility-decision.test.mjs` | **11/11 pass** (refactored fixture) |
| `npm test` (build + 33 default suites) | **pass** |
| `npm run test:knowledge` (52 tests, `--experimental-test-module-mocks`) | **52/52 pass** |
| `npm run test:fire-alarm-golden` | **GATE PASSED** — no regression vs Fire Alarm MVP v1 frozen baseline |
| `npm run lint` | 0 errors / 0 warnings in this slice's files (tree-wide pre-existing errors/warnings in concurrent lanes untouched and unrepaired) |
| `npm run test:all` (drift gate, `authoritative-test-inventory.mjs --run --verify-drift`) | **classification drift check PASSED** — baseline reconciled at 423 files with the new test registered; authoritative run 4114 tests, 4097 pass, **3 fail** — the long-standing pre-existing `boq-line-bom-summary` (×2, mock lacks the sizing-snapshot `first()` query added by the concurrent sizing lane in `worker/boq-line-bom-api.mjs`) and `review-workflow-atomic` R8 (×1, manifest index ordering from the 0016 spec-clause lane). Reproduced standalone (30 tests, 27 pass, 3 fail) with identical errors; none of those files references the policy module or GOLDEN-5 files, so the failures are unrelated to this slice (same set documented in GOLDEN-4 §17). |

The full default suite and the drift gate were run against the registered baseline; the
new GOLDEN-5 test is classified `SAFE` (replica/schema memory fixtures, no real database,
no live D1).

---

## 9. Business-state write declaration

None. No live D1 mutation, no live requirement approval, no live profile regeneration,
no live matching run, no safety approval, no panel selection, no sizing snapshot, no
pricing/quotation mutation, no commit, no push, no deployment, no restart, and no other
unrelated business-state mutation was performed. The acceptance project
`project_c0123d91-…` was read-only. All proof is replica/test-schema evidence.

---

## 10. Remaining blockers and next slice

- **6 of 7 FACP BOQ items still have zero linked technical requirements** (GOLDEN-3 §5).
  Even with a governed ecosystem selection, those six items cannot reach a candidate
  population at all — the ecosystem decision propagates only to the one item (G) that
  has level/loop requirements linked today. This is the dominant blocker after GOLDEN-5
  and is **reported, not concealed**.
- **Panel-sizing snapshot prerequisite** (Agent 3's `PANEL_SIZING_SNAPSHOT_REQUIRED`)
  remains a separate dependency; this slice deliberately never creates a snapshot row.
- **Large UL/FM systems** require a governed human evaluation between the Gamewell-FCI
  and Simplex candidates; no auto pick.
- **Next slice candidate**: link the Ecosystem-selection requirement to the remaining six
  FACP items so the canonical single decision reaches the full seven-panel population via
  `boq_requirement_links` — the persistence path and propagation mechanics are already
  proven here (§16) and in GOLDEN-4's test 16.
- No project in any environment has ever had a sizing-snapshot row; the snapshot pipeline
  itself is a distinct governed stage (GOLDEN-1/GOLDEN-2 context) and was not advanced.

---

**End state:** all GOLDEN-5 and GOLDEN-4 tests green; fire-alarm golden gate passes; the
classification-drift check passes with the new test registered; the drift gate's only
failures are the long-standing pre-existing `boq-line-bom-summary` (×2) and
`review-workflow-atomic` R8 (×1) documented above; the GOLDEN-4 lifecycle is proven with
a genuinely policy-resolved ecosystem; no live business-state mutation.