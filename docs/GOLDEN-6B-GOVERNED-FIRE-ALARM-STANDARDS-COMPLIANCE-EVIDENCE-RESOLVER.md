# GOLDEN-6B — GOVERNED FIRE ALARM STANDARDS & COMPLIANCE EVIDENCE RESOLVER

Single pure-domain slice: convert **governed** project evidence about standards
and certifications into **canonical compliance facts** (Layer B), then derive
the **one** downstream engineering input GOLDEN-5 may receive from that evidence
(`complianceRegime`, Layer C). The resolver never treats a mere requirement
mention as an approved standard fact, never fabricates equivalence, never picks
sides by recency / mention count / vendor, and never selects an ecosystem.

**Status:** CLOSED — see §14 verdict. Implemented in
`app/domain/fire-alarm-compliance-evidence-policy.mjs` (pure domain, no new
table, no engine edits). Proof suite
`tests/golden-6b-fire-alarm-compliance-evidence.test.mjs` (19/19 green), plus
GOLDEN-6/6A regression (18/18), eslint clean, `npm run build` clean.

---

## 2. Deliverable inventory (D1–D19)

| # | Mission provision | Deliverable | Proven by |
|---|-------------------|-------------|-----------|
| D1 | §13 / §38-1 mandatory first deliverable | Exact canonical trace from `missingInformation.standard` to its real engine input (two existing paths; **no architectural gap, no new table**) | §3 below + section-9 replica (test 17) |
| D2 | §3/§6/§9/§10/§11 vocabulary | Versioned vocabulary contract: 6 classifications, 9 authority classes, 9 scopes, 6 obligations, 4 resolution states, 3 policy branches | Test 1 |
| D3 | §6 recognition | Recognition names designations only — no authority, no certification implied; unknown designations are null, never fabricated | Test 2b |
| D4 | §30 negatives (single-entry) | Negation is never a fact; unrecognized mandatory designations are ambiguous; ISO 9001 is manufacturer-capability only; manufacturer material never governs | Test 2 |
| D5 | §29 acceptance | Current-project eligible evidence → canonical facts + UL/FM route (acceptance system-wide UL; FM never fabricated) | Test 3 |
| D6 | §29 acceptance | EN54 **and** LPCB both established → EN54/LPCB route; GOLDEN-5 resolves Gent (Rule B) | Test 4 |
| D7 | §30 negative | EN54-only → NO_SUPPORTED branch, regime null → GOLDEN-5 `MISSING_FIRE_ALARM_COMPLIANCE_BASIS`, **never GENT** | Test 5 |
| D8 | §30 negative | LPCB-only → NO_SUPPORTED branch; EN54 never fabricated | Test 6 |
| D9 | §30 negative | NFPA 72/70/101-only → no regime; UL/FM never invented | Test 7 |
| D10 | §16/§22 negative | UL-only → canonical facts keep **only** `["UL"]`, FM never persisted | Test 8 |
| D11 | §16 scope participation | Detector-only UL → PRODUCT_CERTIFICATION scoped DETECTORS, never a system route | Test 9 |
| D12 | §25 | FACP mandatory UL + detector EN54 → **no conflict**; system compliance is UL-based, EN54 is product context | Test 10 |
| D13 | §24 negative | System-wide UL + system-wide EN54/LPCB → `CONFLICTING_COMPLIANCE_EVIDENCE`; mention counts / recency / vendor never break the tie | Test 11 |
| D14 | §26/§34 | Equal-authority supersession claims invalid → fail closed; higher-authority supersession is the only resolution and keeps the loser as history (never mutated/deleted) | Tests 12, 13 |
| D15 | §30 negative | Manufacturer capability / vendor listings never become contractual requirements | Test 14 |
| D16 | §31 | Pending Review / Draft / not-current / superseded rows are refused, surfaced in the review payload, never trusted | Tests 15, 18 |
| D17 | §27/§28 adapter boundary | Adapter returns **only** regime strings; GOLDEN-5 alone resolves ecosystems / models (Farenhyt demo; never GENT on UL/FM) | Test 16 |
| D18 | §33 | Profile lifecycle v1→v2: one governed `requirement_standards` child clears `missingInformation.standard`, moves the fingerprint, supersedes v1; no-change rerun is idempotent (no v3) — proven on the real `executeRequirementProfile` replica | Test 17 |
| D19 | §31/§32 + §35 + §37 | Read-only live dry run on the acceptance project with an honest verdict; §37 no-write declaration; validation summary | §8/§10/§11/§12 below |

---

## 3. D1 — §13/§38-1 canonical trace (mandatory first deliverable)

`missingInformation.standard` on a BOQ item profile is produced by
`detectMissingInformation` from the **`standards` input array** of the
requirement engine. That array has exactly two governed sources — **no
architectural gap, no new table required** (verified against the live code):

```
missingInformation.standard
   ^-- detectMissingInformation({ boqItem, consolidated, standards, ... })
       (technical-requirement-engine.mjs)
   ^-- standards = [...consolidated.flatMap(item => item.standards),
                    ...sourceFactStandards]
       (technical-requirement-engine.mjs:320)
   ^-- Path A  requirement_standards child rows on CURRENT + ELIGIBLE +
              Confirmed-linked requirements:
              currentTechnicalRequirementEligibleForEngineeringPredicate =
                review_status = 'Approved' AND approved_for_downstream = 1
              (worker/current-evidence-scope.mjs:412-413)
              loaded in worker/technical-requirement-api.mjs loadInputs (:86-148)
              via boq_requirement_links status='Confirmed', superseded_at IS NULL
   ^-- Path B  engineering_facts rows:
              fact_type = 'Source Fact'  AND  status = 'Active'
              AND predicate = 'applicable_standard'
              (worker/technical-requirement-api.mjs loadActiveSourceFacts :244-279)
              stale/non-active rows fail closed (never partial evidence)
```

Engine gates that consume it (pin, re-verified this slice):

- `standard: standards.length ? true : null` — the profile's standard
  information gate (technical-requirement-engine.mjs:218). When the array is
  empty the gate is honestly `null` — no standard is invented.
- `standards: standards.length ? mean(standards.map(i => i.confidence || 70)) : 0`
  (technical-requirement-engine.mjs:326) — confidence collapses to `0` on empty
  input, and the `standards` confidence dimension only applies when the gate is
  satisfied (:339).
- Profiles are written by `persistProfile`, which supersedes the prior current
  version (worker/technical-requirement-api.mjs:315-318); the current profile is
  read via `currentRequirementProfile` (worker/requirement-profile-currency.mjs).

GOLDEN-6B's resolver consumes **the same rows** (the caller-gated
`requirement_standards` children / `applicable_standard` Source Facts), never a
re-typed half. It refuses ungated entries in depth-defence. It changes no
engine gate; it is the pure conversion of that governed evidence into canonical
compliance facts plus the Layer-C regime derivation (both proven end-to-end in
the §33 replica, D18).

---

## 4. Module contract (v `fire-alarm-compliance-evidence-policy-1.0.0`)

`app/domain/fire-alarm-compliance-evidence-policy.mjs` — pure, deterministic, no
database access, no mutation, no review-state changes.

**The two layers stay separate (mission §1/§3):**

- `resolveComplianceEvidence({ entries })` → **Layer B**: canonical facts only —
  `state`, `facts`, `applicableStandards`, `requiredCertifications`,
  `requiredApprovals`, `referenceStandards`, `standardScopes`,
  `certificationScopes`, `supersededHistory`, `conflicts`, `reviewPayload`.
- `deriveCompliancePolicyBranch(resolution)` → **Layer C**: `policyBranch`,
  `regime`, `ruleId`, `reason` — nothing else. No ecosystem, no panel model, no
  compatibility target field is ever produced (asserted by test 16).
- `buildFireAlarmComplianceAdapterResult({ entries })` = resolution + branch.

**Vocabulary (tests 1/2b freeze it):**

- `MENTION_CLASSIFICATIONS` (6): MANDATORY_PROJECT_REQUIREMENT,
  REFERENCE_STANDARD, PRODUCT_CERTIFICATION, MANUFACTURER_CAPABILITY,
  INFORMATIVE_CONTEXT, AMBIGUOUS.
- `AUTHORITY_CLASSES` (9): CONTRACTUAL_PROJECT_REQUIREMENT,
  APPROVED_ADDENDUM_OR_CLARIFICATION, APPROVED_HUMAN_ENGINEERING_DECISION,
  APPROVED_SYSTEM_SPECIFICATION, BOQ_REQUIREMENT, DRAWING_REQUIREMENT,
  PRODUCT_REFERENCE, MANUFACTURER_REFERENCE, INFORMATIVE_TEXT.
- `COMPLIANCE_SCOPES` (9): PROJECT, FIRE_ALARM_SYSTEM, FACP, DETECTORS, MODULES,
  NOTIFICATION_APPLIANCES, PRODUCT_ONLY, SPECIFIC_BUILDING, SPECIFIC_BOQ_ITEM.
- `OBLIGATIONS` (6) and resolution `COMPLIANCE_RESOLUTION_STATES` (4:
  RESOLVED / MISSING / CONFLICTING / REQUIRES_ENGINEERING_REVIEW).
- `CONCEPT_TYPES` (3): STANDARD, CERTIFICATION, APPROVAL_BODY —
  NFPA/EN54/BS/European are STANDARD by identity and can never become
  certifications; UL/ULC/FM are CERTIFICATION; LPCB is APPROVAL_BODY.

**Hard design invariants (mission §14–§27):** no synthetic equivalence
(UL≠FM, EN54≠LPCB, NFPA≠UL/FM); every fact keeps scope + authority + currency +
obligation; mention counts / popularity / later `created_at` / vendor bias never
resolve a conflict (conflicts fail closed); manufacturer/vendor product material
can never become a contractual mandate; higher-authority supersession is the
only conflict resolution and superseded facts remain history; the adapter
derives `complianceRegime` only when facts alone justify it.

---

## 5. §29 acceptance scenarios & §30 negative assertions — coverage

**§29 acceptance scenarios** (each exercise = ac number in trailing comment):

| Evidence (governed, eligible, current) | Canonical facts | Adapter (Layer C) | GOLDEN-5 outcome | Test |
|---|---|---|---|---|
| System-wide UL (acceptance req_75) + NFPA/EN54 install (req_78) + detector UL 217/268 (req_79) + SLC NFPA 72 (req_316) | `requiredCertifications=["UL"]`, `applicableStandards=["NFPA","EN54"]`, UL@FIRE_ALARM_SYSTEM, UL 217/268@DETECTORS | UL_FM_POLICY_BRANCH, regime `"UL/FM"` | Farenhyt (after governed sizing + complexity) | 3, 16 |
| EN54 + LPCB (both system-wide) | EN 54@FIRE_ALARM_SYSTEM, `requiredApprovals=["LPCB"]` | EN54_LPCB_POLICY_BRANCH, regime `"LPCB/EN54/European"` | `RESOLVED_GENT` (Rule B) | 4 |
| FACP mandatory UL + detector EN54 (§25) | UL@FACP, EN 54@DETECTORS, no conflict | UL_FM_POLICY_BRANCH | Farenhyt path | 10 |
| Higher-authority addendum EN54/LPCB over spec UL (§34) | UL in `supersededHistory` only | EN54_LPCB_POLICY_BRANCH | Gent | 13 |
| No governed standard evidence (profile v1) | `standard` missing, no claim | — | item profile honest `Missing Critical Information` | 17 |

**§30 negative assertions** (each negative = ng number in trailing comment):

| Negative | Guarantee | Test |
|---|---|---|
| EN54-only | no LPCB fabricated; NO_SUPPORTED; GOLDEN-5 reports `MISSING_FIRE_ALARM_COMPLIANCE_BASIS`, never GENT | 5 |
| LPCB-only | no EN54 fabricated; NO_SUPPORTED; regime null | 6 |
| NFPA 72/70/101-only | no UL/FM invented; standards/codes only | 7 |
| UL-only | canonical facts keep ONLY `["UL"]`; FM never persisted; regime label `"UL/FM"` is policy, not a factual claim | 8 |
| Detector-only UL | PRODUCT_CERTIFICATION scoped DETECTORS only — no system route | 9 |
| System UL + system EN54/LPCB | CONFLICTING_COMPLIANCE_EVIDENCE — three EN54 rows vs one UL row never selects EN54; recency/vendor never break the tie | 11 |
| Equal-authority supersession | spec cannot supersede spec; fails closed | 12 |
| Manufacturer / vendor material | capability classification, never governing, never contractual | 14 |
| Pending / Draft / not-current / superseded rows | refused; never evidence; surfaced in review payload | 15, 18 |
| Negated relationship | `shall not be listed under UL` → AMBIGUOUS, never a fact | 2 |
| Unrecognized mandatory designation | AMBIGUOUS (basis `UNRECOGNIZED_DESIGNATION`), never invented | 2 |
| ISO 9001 quality cert | MANUFACTURER_CAPABILITY only; never system compliance | 2 |
| External ecosystem selection | adapter has no ecosystem/target/model field; GOLDEN-5 alone resolves ecosystems | 16 |

---

## 6. Conflict discipline (§24/§25) and supersession (§26/§34)

**Conflict detection is REGIME-SCOPED and pair-specific.** The only genuine
regime conflict is regime-level (PROJECT / FIRE_ALARM_SYSTEM / FACP)
**UL/ULC/FM certification evidence vs LPCB approval evidence**. `EN54` and
`European` families are design/installation **codes**, not certification-regime
claimants: a system-level EN54 installation clause coexists with UL listing —
this is exactly the acceptance project's resolved posture (GOLDEN-6 → Farenhyt,
UL/FM regime) — and never triggers a conflict by itself. Field-device facts
(detectors, modules, notification appliances) never participate in regime
conflicts regardless of family. Conflicts fail closed: the adapter returns
`policyBranch=null, regime=null` and the review payload carries the reason.

**Supersession is the ONLY conflict resolution** and is validated:
`AUTHORITY_RANK` orders the nine authority classes
(contractual 90 > addendum 80 > human decision 75 > approved spec 70 > BOQ 60 >
drawing 55 > product reference 25 > manufacturer 20 > informative 10). A
`supersededBy` claim is honoured **only** when the winner carries strictly
higher authority. Equal-authority claims are invalid → the supposed loser stays
live and the pair fails closed into CONFLICTING. Valid supersessions move the
loser to `supersededHistory` — `facts` still contains it, it is never deleted
and never mutated.

---

## 7. Adapter boundary and GOLDEN-5 integration (§27/§28)

Documented approved adapter rules, hard-coded in the module:

| Rule id | Precondition (Layer B facts, regime-scoped only) | Branch / regime |
|---|---|---|
| `compliance-regime.ul-fm` | system-level UL/ULC/FM **certification** evidence (PROJECT / FIRE_ALARM_SYSTEM / FACP scope) | UL_FM_POLICY_BRANCH / `"UL/FM"` — UL-only or FM-only evidence suffices; the sibling is **never fabricated** into canonical facts |
| `compliance-regime.en54-lpcb` | BOTH system-level EN54/European **and** LPCB approval evidence | EN54_LPCB_POLICY_BRANCH / `"LPCB/EN54/European"` — neither alone suffices |
| `compliance-regime.unsupported` | everything else (EN54-only, LPCB-only, NFPA/BS-only codes, no governing facts, conflict, ambiguity) | NO_SUPPORTED_ECOSYSTEM_BRANCH / regime `null` → GOLDEN-5 fails closed |

GOLDEN-5 (`fire-alarm-ecosystem-policy.mjs`) consumes **only** the regime string.
Verified end-to-end (test 16): adapter over live-eligible evidence → regime
`"UL/FM"` → `resolveFireAlarmEcosystem` → `PANEL_SIZING_SNAPSHOT_REQUIRED` with
no sizing inputs (never a fabricated ecosystem), and `RESOLVED_FARENHYT` only
once a governed preliminary sizing snapshot + complexity
(`preliminaryTotalPoints`, `complexity: "not-exceptional"`) are supplied.
EN54-only evidence can never reach Gent through this adapter — GOLDEN-5 reports
`MISSING_FIRE_ALARM_COMPLIANCE_BASIS` (test 5).

---

## 8. §31/§32 — read-only dry run on the live acceptance project

Target: `project_ae501b85-9c12-4332-bf8e-787c90f2d388`
("Al Mousa School — Clean Golden Run"), inspected read-only
(`sqlite3 -readonly` against the local D1 snapshot
`.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b04…sqlite`).
**Nothing was written**: no insert/update, no approvals, no profile
regeneration, no standard-fact creation, no GOLDEN-5 persistence, no matching.

**Measured inventory (this slice, re-verified):**

| Channel | Measured |
|---|---|
| Technical requirements | 59 `Approved` / 432 `Needs Review` / 25 `Pending Approval` |
| Eligible `requirement_standards` children (Approved + downstream=1 + current extraction) | seq `100075` UL ×2 (system-wide listing); `100078` NFPA 72 + EN54 (installation); `100079` UL + UL 217 + UL 268 (detector certification); `100316` NFPA 72 (SLC). All `status='Mandatory'` (extractor label). 8 rows |
| `applicable_standard` Source Facts (`engineering_facts`) | **10 rows, ALL `Pending Review`** → 0 Active → Path B contributes nothing |
| FACP items (category `Control Panel`) | 7 BOQ items |
| `boq_requirement_links` on FACP items (non-superseded) | 45 `Confirmed` + 43 `Suggested` → 9 distinct Approved + current + downstream requirements (each linked to 5 items) — **none of the 9 carries `requirement_standards` children** |
| Standards-carrying requirements vs linkage | `100075 / 100078 / 100079 / 100316` are **not linked to any Control Panel item** — their standards rows never reach an item profile |
| Current FACP `requirement_profile_versions` | 6 of 7 items, **all `Missing Critical Information`** (versions 3–5); all 6 profile JSONs include `"standard"` in `missingInformation` |

**Honest verdict (Layer B + Layer C, project-eligible evidence):**

1. **Resolver** over the 8 eligible `requirement_standards` rows →
   `RESOLVED_COMPLIANCE_FACTS`: `requiredCertifications=["UL"]`;
   `applicableStandards=["NFPA","EN54"]`;
   `certificationScopes` = UL@FIRE_ALARM_SYSTEM (100075), UL 217 / UL 268@DETECTORS
   (100079); `standardScopes` = NFPA 72@FIRE_ALARM_SYSTEM (100078, 100316),
   EN 54@FIRE_ALARM_SYSTEM (100078); `requiredApprovals=[]`; `conflicts=[]`
   (EN54 is an installation code — no LPCB, no conflict).
2. **Adapter** → `UL_FM_POLICY_BRANCH`, regime `"UL/FM"`, rule
   `compliance-regime.ul-fm`. Never GENT. No FM, no LPCB fabricated.
3. **GOLDEN-5 executability — honest NO, per item.** Every current FACP profile
   still reports `standard` missing, and it is right to: the 9 Confirmed-linked
   requirements carry **zero** standards children, the 4 standards-carrying
   requirements are unlinked to the panels, and all 10 Source Facts are pending.
   The item-level gate is structurally identical to GOLDEN-6B test 17's v1
   condition; the §33 replica proves the exact clearing mechanism (one governed
   `requirement_standards` child on a linked eligible requirement → `standard`
   clears, v1 superseded).
4. **Project-level regime input is now derivable deterministically** — a strict
   improvement over the previous "no compliance basis" posture — and the same
   facts, once profile wiring is implemented after governed approvals, feed
   GOLDEN-5: with the adapter regime and a governed sizing snapshot +
   complexity, `RESOLVED_FARENHYT`; never GENT.

**Corrections to the prior discovery record (honesty note):** the earlier
session note "zero active Confirmed FACP links" is superseded by direct
re-measurement — 45 Confirmed links do exist and ride eligible requirements,
but they carry **no standards evidence**; the standards blocker persists
precisely because linkage ≠ standards (GOLDEN-6 test 7, extended here). The
earlier "12/12 compatibility rows Needs Review" figure is not reproduced by
querying `engineering_relationships` for this project (zero rows reference the
FACP items); this report states only what was measured.

---

## 9. §33 — profile lifecycle proof (replica, not live)

`tests/golden-6b-fire-alarm-compliance-evidence.test.mjs` test 17 seeds a
minimal Fire Alarm project through the **real** `executeRequirementProfile`
(worker/technical-requirement-api.mjs) on an in-memory replica built from the
`drizzle-active/` migration chain (the GOLDEN-6 fixture pattern), with
`currentRequirementProfile` reads:

- **v1** — the Confirmed-linked, Approved, current-eligible Compliance
  requirement has **no** `requirement_standards` child. Result:
  `version_number=1`; `missingInformation` contains `standard` **and**
  `compatibilityTarget`; `standards` is `[]`. No standard is invented.
- **v2** — record ONE governed child row
  (`requirement_standards`: UL 864, `status='Mandatory'`) on that requirement.
  Regenerate → `version_number=2`; `input_fingerprint` **moves**;
  `standard` leaves `missingInformation`; `compatibilityTarget` stays
  independent and missing; the profile now carries the governed standard.
- **History** — v1 is retained as superseded history (`superseded_at` set),
  never mutated.
- **Idempotency** — a no-change rerun returns the **same** v2 id, version and
  fingerprint; no v3 is minted.

This is the exact end-to-end trace of D1/§13: `missingInformation.standard` is
cleared only by governed evidence arriving on a confirmed eligible requirement.

---

## 10. §34 supersession proof (no historical mutation)

- **Equal authority** (spec vs spec, test 12): the `supersededBy` claim is
  invalid (winner rank 70 ≯ loser rank 70); the loser stays live → the UL/LPCB
  pair is detected as CONFLICTING and the adapter fails closed (regime null).
- **Higher authority** (addendum vs spec, test 13): the Addendum (rank 80)
  validly supersedes the Specification (rank 70). Result:
  `RESOLVED_COMPLIANCE_FACTS` on the EN54/LPCB route; the superseded UL fact
  remains in `facts` **and** `supersededHistory`; `requiredCertifications=[]`
  (it no longer governs). No row is deleted; nowhere is `created_at` used to
  resolve anything.

---

## 11. §35 review payloads

Every resolution returns `reviewPayload = { state, reviews[], conflictReason,
whyPolicyCouldNotResolve }`.

- `reviews` — every non-governing / refused / pending row, with
  `id, concept, authority, scope, obligation, classification, reason`
  (`reason` carries the refusal basis: `NOT_ELIGIBLE_FOR_DOWNSTREAM`,
  `NEGATED_RELATIONSHIP`, `UNRECOGNIZED_DESIGNATION`, `INFORMATIVE_WORDING`, …).
  Pending rows are surfaced, never trusted.
- `conflictReason` / `whyPolicyCouldNotResolve` — populated only on
  CONFLICTING; they state the fail-closed discipline (no side-picking by
  recency, mention count, or vendor).

Live demo (test 18): the 10 pending `applicable_standard` Source Facts of the
acceptance project are all present in `reviews` (`fact-*` ids), while the 8
eligible requirement-standard rows resolve the state to
`RESOLVED_COMPLIANCE_FACTS` with regime `"UL/FM"`.

---

## 12. §37 no-write declaration

All proofs in this slice ran on fixtures and the in-memory replica:

- **No live D1 writes** — the acceptance snapshot was only ever opened with
  `sqlite3 -readonly`.
- **No approvals**, **no standard-fact creation**, **no profile recalculation**
  on live data, **no GOLDEN-5 persistence**, **no matching runs**.
- **No deployment, no restart**, **no commit / push** — all changes remain
  uncommitted working-tree edits.
- Only artifacts produced: the new domain module, the new test suite, the
  baseline entry, this document.

---

## 13. Validation

| Gate | Result |
|---|---|
| `node --test tests/golden-6b-fire-alarm-compliance-evidence.test.mjs` | 19/19 pass |
| `node --test tests/golden-6-facp-requirement-linkage.test.mjs` (GOLDEN-6 + GOLDEN-6A regression) | 18/18 pass |
| `npx eslint app/domain/fire-alarm-compliance-evidence-policy.mjs tests/golden-6b-fire-alarm-compliance-evidence.test.mjs` | clean (0 errors, 0 warnings) |
| `npm run build` | clean (Sites artifact verified) |
| `scripts/test-classification-baseline.json` | entry `tests/golden-6b-fire-alarm-compliance-evidence.test.mjs|SAFE` added; 425 entries, sorted, valid JSON |

---

## 14. Closure criteria and verdict

```text
eligible governed standard evidence        -> canonical compliance facts   ✔ (D5–D12, tests 3–10)
no synthetic equivalence (UL/FM, EN54/LPCB, NFPA/UL/FM)                     ✔ (D7–D10, tests 5–8)
scope participates; conflicts fail closed  -> CONFLICTING_COMPLIANCE_EVIDENCE ✔ (D11–D13, tests 9–11)
supersession: only higher authority wins;  -> history kept, never mutated   ✔ (D14, tests 12–13)
manufacturer capability never contractual                                   ✔ (D15, test 14)
ineligible / pending rows refused + surfaced                                ✔ (D16, tests 15/18)
adapter feeds ONLY complianceRegime; GOLDEN-5 resolves ecosystems/models    ✔ (D17, test 16)
profile lifecycle: governed evidence clears the standard blocker,           ✔ (D18, test 17)
  v1 superseded, idempotent no-change rerun
read-only live dry-run with honest MISSING posture surfaced                 ✔ (D19, §8)
no live writes / approvals / persistence / deploy / commit                  ✔ (§12)
```

**Verdict: CLOSED — GOVERNED FIRE ALARM STANDARDS & COMPLIANCE EVIDENCE
RESOLVER PROVEN.**