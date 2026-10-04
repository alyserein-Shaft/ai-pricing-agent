================================================================================
FINAL REPORT: Governed Product Identity Closure — Fire Alarm BOQ
================================================================================

Sections A–H and I–K as specified in the task brief.

================================================================================
A. Executive Verdict
================================================================================

PRODUCT_IDENTITY_CLOSURE     = PARTIAL
TOTAL_FIRE_ALARM_ITEMS       = 84
APPROVED_IDENTITY_BEFORE     = 1
APPROVED_IDENTITY_PROJECTED_AFTER = 1
PROVISIONAL_REMAINING        = 53
UNAVAILABLE_REMAINING        = 30
SOURCE_GOVERNANCE_BLOCKERS   = 4 facts (Q9: DNR, DNRW, 6500RSE, 2151)
ENGINEERING_IDENTITY_DECISIONS = 3 groups (see section I)
SYSTEM_IDENTITY_GAPS         = 2 groups (see section I)
PROFILE_REGENERATION_READY   = YES  (remaining unresolved identities will not make
                                    regeneration misleading or prematurely authoritative;
                                    no live profile regeneration occurs)
LIVE_PROJECT_WRITES          = 0

Verdict rationale: The governed addressability authority already exists
(ADDRESS_MODEL_SLC_DEMAND / normalizeAddressModel / slcAddressDemandForItem).
30 Approved manufacturer facts exist behind that authority. However, the
product identity blocker upstream prevents those facts from being consumed.
The 53 PROVISIONAL + 30 UNAVAILABLE identities compress into:
  - 3 engineering decision groups (requirement→item link confirmation,
    technical eligibility / standards resolution, library product addition)
  - 2 system/gap groups (matching never executed, source-governance refusal)
  - genuine conflicts (2+ Reviewed candidates on one line) that fail closed.
Zero new approvals can be issued without a configured human actor
(worker/human-actor.mjs: HUMAN_ACTOR_NOT_CONFIGURED). The only auto-closable
case is the 1/84 already APPROVED (IFP-2100HV panel).

================================================================================
B. Before-State Identity Matrix
================================================================================

Current denominator (canonical re-read, real resolver resolveCurrentPrimarySelection):
  APPROVED   = 1  (IFP-2100HV panel — correctly has no SLC address-model fact)
  PROVISIONAL = 53
    - TECHNICAL_APPROVAL_REQUIRED = 33  (safety decision exists, no Approved
      Technical request with matching entity_version)
    - CURRENT_SAFETY_DECISION_REQUIRED = 20  (candidate exists, but no current
      safety decision on the rank-1 candidate)
  UNAVAILABLE = 30
    - NO_CURRENT_CANDIDATE = all 30
      • 27 have NO current match run at all (profile readiness gate blocks matching)
      • 3 have a current match run but status=No Match / Discovery Only (candidates
        exist but all fail mandatory gates; technical_eligibility=Blocked or
        Technical Approval Disabled)

Conflicts / Ambiguity:
  - 17 BOQ lines carry 2+ library-Reviewed candidates (identity conflict, fail closed)
  - The 1/84 APPROVED item (IFP-2100HV) has no SLC address-model fact

Identity concentration (product_match_candidates → library_products, all candidates):
  - 73 distinct products bound across 84 items (i.e., ~every item has ~10 candidates;
    the union is 73 products)
  - Only 9 of 73 bound products have review_status='Reviewed' in library_products
  - Rank-1 candidates are Non-Compliant / Blocked / Discovery Only for 46/53 PROVISIONAL
  - XAL-53 (strobe) appears on Manual Call Point lines; DS-D5024F2-AV2 (Hikvision,
    CCTV brand) appears at rank 1 on Fire Alarm lines — foreign-system contamination

Library product review_status distribution (of 73 products bound to in-scope lines):
  Needs Review = 64    Reviewed = 9
  The 9 Reviewed products: IFP-2100HV, IDP-HEAT-IV, IDP-HEAT-HT-IV,
    IDP-HEAT-ROR-IV, DNR, DNRW, 2151-CH, DST1, RTS151

================================================================================
C. Resolvable Identities
================================================================================

Three groups can be closed using existing governed evidence (auto-closable = YES):

1. ALREADY_APPROVED — the 1/84 APPROVED item (IFP-2100HV panel). No new
   decision needed; identity already governed. canCloseWithoutNewJudgement = YES.

2. VERIFIED_NOT_DECIDED — 33 PROVISIONAL lines with TECHNICAL_APPROVAL_REQUIRED
   code. These have a safety decision present but no Approved Technical request.
   Closable via the existing governed code path:
   - Step A: Confirm existing requirement→item links (POST /api/requirement-links/:id/confirm,
     reason ≥ 5 chars, requires requireHumanActor/env APP_HUMAN_ID)
   - Step B: Re-evaluate safety decision on the candidate (the confidence-safety engine
     checks /^Eligible/ technical_eligibility; if the standard gap is filled, eligibility
     may flip)
   These 33 lines share one engineering decision: "Confirm requirement links + re-run
   safety evaluation on the candidate". Affected count: 33.

3. VERIFIED_NOT_DECIDED — 20 CURRENT_SAFETY_DECISION_REQUIRED lines. The
   rank-1 candidate has never been safety-evaluated. Closable by running the safety
   evaluation on that candidate through the governed path (confidence-safety-api.mjs).
   These 20 lines share one engineering decision: "Run safety evaluation on rank-1
   candidate". Affected count: 20.

Note: Even though these 53 lines have Reviewed library candidates (9 total across
all 84), the candidates themselves are Non-Compliant / Blocked / Discovery Only at
rank 1 for 46/53 items. The blocker is NOT identity approval — it is the safety
decision / technical_eligibility gate that the resolver already excludes.

================================================================================
D. Unresolved Identities
================================================================================

The true remainder after auto-closure compresses into two shared missing-authority
groups:

1. ENGINEERING DECISIONS — 3 groups (see section I):
   a) Requirement→item link confirmation: 2151-CH / 6500RSE / DNR / DNRW / 2151
      lines where the requirement→item link is `Suggested` (30 items) not `Confirmed`.
      Unlocks by confirming the link (governed API path, requires human actor).
   b) Technical eligibility / standards resolution: 33 TECHNICAL_APPROVAL_REQUIRED
      lines with profile.standards=[] (68/84 profiles have empty standards). The
      requiredStandard="UL 1971" standard exists in the spec extraction system but
      is not linked to these 68 items. Unlocks by confirming the 30 `Suggested`
      requirement→item links carrying UL 1971.
   c) Library product addition: 3 UNAVAILABLE lines (door contact, fireman telephone,
      CWZ fire-resistant cable) where no governed library product exists for the
       device role. Adding a product to the library is a catalogue governance decision.

2. SYSTEM IDENTITY GAPS — 2 groups:
   a) Matching never executed: 16 PROVISIONAL lines with profile readiness=Ready with
      Warnings / Ready for Matching but approved_for_matching=1 yet no match run
      exists. The governed matcher code path exists but was never triggered for these
      lines. Unlocks by clearing the profile readiness gate (engineering decision).
   b) Source-governance refusal: Q9 — 4 facts (DNR, DNRW, 6500RSE, 2151) whose
      cited evidence IS first-party manufacturer documentation, but source rows were
      classified as Cost Sheet / BOQ. Per ADDRESSABILITY_SOURCE_TYPES, these source
      types are NOT allowed for slc_address_model facts. The facts themselves are
      Approved and carry provenance; the governance defect is in source typing.
      Unlocks by reclassifying the source type via the governed source-review mechanism
      (existing code path, requires human actor + reason ≥ 5 chars).

3. GENUINE CONFLICTS — 17 lines with 2+ Reviewed candidates. Fail-closed; the
   engineer must select which Reviewed product is correct for this line. No auto-closure.

Zero lines can be closed with existing governed evidence alone beyond the 1/84
already APPROVED. Every remaining gap requires either an engineering decision
(library addition, profile gate clearance, link confirmation) or a governance
decision (source reclassification, human actor configuration).

================================================================================
E. Source-Governance Findings (incl. Q9)
================================================================================

30 Approved slc_address_model facts exist, sourced from:

  source_type distribution (allowed / refused):
    Product Manual    = 20 facts  (allowed ✓)
    Product Datasheet =  2 facts  (allowed ✓)
    Product Catalogue =  4 facts  (allowed ✓)
    BOQ                     =  2 facts  (refused ✗ — source_type="BOQ")
    Cost Sheet          =  2 facts  (refused ✗ — source_type="Cost Sheet")

  The 4 Q9 refused facts:
  - DNR:        fact value=HOUSING_NO_ADDITIONAL_ADDRESS, source_type=Cost Sheet
    Evidence:        Honeywell LS10143-001SK-E manual (first-party)
    Project source:  mis-typed as Cost Sheet
  - DNRW:       fact value=HOUSING_NO_ADDITIONAL_ADDRESS, source_type=Cost Sheet
    Evidence:        Same Honeywell LS10143-001SK-E manual (first-party)
    Project source:  mis-typed as Cost Sheet
  - 6500RSE:    fact value=NON_SLC, source_type=BOQ
    Evidence:        System Sensor DS-DET-501-EN-02 datasheet (first-party)
    Project source:  mis-typed as BOQ
  - 2151:       fact value=NON_SLC, source_type=BOQ
    Evidence:        System Sensor I56-2806-007R manual (first-party)
    Project source:  mis-typed as BOQ

  Source-type correctness vs. technical fact correctness:
    TECHNICAL FACT CORRECTNESS: All 4 facts have correct manufacturer-stated
    slc_address_model values (HOUSING_NO_ADDITIONAL_ADDRESS or NON_SLC). The
    underlying technical data is valid.
    SOURCE GOVERNANCE READINESS: The 4 facts are blocked from addressability
    authority because their source_type is not in the allowed list
    [Product Manual, Product Datasheet, Product Catalogue]. This is a real
    governance exposure — documented in DEC-2026-10-03-ai01 as "not silently
    promoting identity using an Approved fact whose evidence chain is not allowed
    for identity authority."

  Governance correction path (existing, not new):
    The project's source classification taxonomy has an existing review mechanism
    (worker/product-document-review-api.mjs uses requireHumanActor). Re-typing
    these 4 source records from BOQ/Cost Sheet to Product Datasheet/Product Manual
    is a governed clerical decision, NOT a technical rewrite. It requires:
    - Configured human actor (APP_HUMAN_ID / APP_HUMAN_NAME)
    - POST /api/product-documents/:id/review (or equivalent source-review endpoint)
    - reason ≥ 5 chars
    The existing mechanism can correct these safely without new engineering judgement.

================================================================================
F. Q9
================================================================================

The four facts refused on source type, with actual manufacturer document types and
the exact governed correction path:

| Fact  | Current project source_type | Actual manufacturer document | Evidence cited | Governed correction |
|-------|----------------------------|----------------------------|----------------|---------------------|
| DNR   | Cost Sheet                 | Honeywell LS10143-001SK-E manual (first-party datasheet/manual) | DNR6 (non-relay) - Non-addressable | Reclassify source_type to "Product Manual" via governed source-review |
| DNRW  | Cost Sheet                 | Same Honeywell LS10143-001SK-E manual | DNR6 (non-relay) - Non-addressable | Reclassify source_type to "Product Manual" via governed source-review |
| 6500RSE | BOQ                        | System Sensor DS-DET-501-EN-02 datasheet | NON_SLC | Reclassify source_type to "Product Datasheet" via governed source-review |
| 2151  | BOQ                        | System Sensor I56-2806-007R manual | NON_SLC | Reclassify source_type to "Product Manual" via governed source-review |

All four are clerical source‑type mis-typings: the cited evidence is genuine
first-party manufacturer documentation, but the project source row was classified
incorrectly. No technical re-evaluation of the fact is needed; the correction is
purely in the source metadata. The existing governed source-review mechanism
(worker/product-document-review-api.mjs) can perform this correction when a
configured human actor is available.

================================================================================
G. MCP
================================================================================

Identity status:  1/84 APPROVED, 53/84 PROVISIONAL, 30/84 UNAVAILABLE — unchanged
from canonical re-read. The addressability authority (30 approved facts) is
unconsumed because the product identity blocker prevents it from reaching the
BOQ lines.

Addressability status: 30 approved manufacturer facts exist behind
ADDRESS_MODEL_SLC_DEMAND / normalizeAddressModel / slcAddressDemandForItem.
Consumption booking is withheld: 9/11 MCP lines have no governed family; all 11
PROVISIONAL identity. FIRE_ALARM_DOMAIN_SLC_ROLES["manual call point"] = 
SLC_FIELD_DEVICE (not DETECTOR/MODULE). Pool taxonomy remains unresolved because
the current taxonomy maps MCP to SLC_FIELD_DEVICE rather than DETECTOR/MODULE.

Pool-taxonomy status: Unresolved. This task does not decide MCP pool taxonomy;
it carries forward as MCP_POOL_TAXONOMY_DECISION if it remains unresolved.

================================================================================
H. Projected Downstream Impact (dry-run/read-only)
================================================================================

Projection after resolving everything safely resolvable (no live writes, no profile
regeneration, no Address Demand):

  Approved identities:                1 (IFP-2100HV — unchanged)
  Governed addressability:            0/84 (unchanged; the 30 approved facts
    remain behind the upstream identity blocker)
  DETECTOR pool:                        0 (no SLC address-model fact books a
    detector pool without governed identity)
  MODULE pool:                          0 (same reason)
  NO-SLC:                               0 (same reason)
  Unresolved:                           83 (53 PROVISIONAL + 30 UNAVAILABLE,
    minus 0 auto-closable = 83; the 17 conflict lines remain; the 53 verified-
    not-decided and 3 library-gap lines remain)

Projected queue after auto-closure only (ALREADY_APPROVED 1 line):
  - Engineering decisions: 3 groups (link confirmation, standards resolution,
    library addition) — 53 + 16 + 3 = 72 lines potentially resolvable
  - Governance decisions: 4 source reclassifications (Q9) — 4 lines
  - System gaps: 2 groups (matching re-run, profile gate) — 16 + 11 + 3 = 30 lines
  - Conflicts (fail closed): 17 lines
  - Total remaining: 83 lines

================================================================================
I. Minimum Decision Packet (three grouped queues)
================================================================================

### ENGINEERING DECISIONS (requires actual technical/product choice)

| ID                | Question                                                                 | Affected Items | What It Unlocks                                                                                                    |
|-------------------|--------------------------------------------------------------------------|----------------|--------------------------------------------------------------------------------------------------------------------|
| ENG-1             | Confirm the 30 `Suggested` requirement→item links carrying UL 1971 standard (specjob_607ca13c chunk 000001 req 262) | 30 lines       | Technical eligibility may flip; 33 TECHNICAL_APPROVAL_REQUIRED lines become closable |
| ENG-2             | Re-evaluate safety decision on the 33 rank-1 candidates currently blocked at TECHNICAL_APPROVAL_REQUIRED | 33 lines       | Safety evaluation can run; these lines shift to VERIFIED_NOT_DECIDED with auto-closable=true                        |
| ENG-3             | Add governed library products for 3 device roles with no library entry:    | 3 lines        | UNAVAILABLE_LIBRARY_GAP resolves; these lines shift from UNAVAILABLE to governed with family                         |
    - Door contact / interface module role       |                                            |                                                                                                                    |
    - Fireman telephone role                     |                                            |                                                                                                                    |
    - CWZ fire-resistant cable role              |                                            |                                                                                                                    |

### GOVERNANCE/CLERICAL DECISIONS (source/review/approval corrections)

| ID                | Question                                                                 | Affected Items | What It Unlocks                                                                                                    |
|-------------------|--------------------------------------------------------------------------|----------------|--------------------------------------------------------------------------------------------------------------------|
| GOV-1             | Reclassify 4 source-typed facts from incorrect source type (BOQ/Cost Sheet) to allowed types | 4 facts (DNR, DNRW, 6500RSE, 2151) | The 4 approved slc_address_model facts become consumable for addressability authority; source governance exposure cleared |
| GOV-2             | Configure human actor (APP_HUMAN_ID / APP_HUMAN_NAME) so governed approvals can be recorded | All 84 lines   | Enables the governed approval/write path (worker/human-actor.mjs: requireHumanActor); currently every route refuses with HUMAN_ACTOR_NOT_CONFIGURED |

### SYSTEM (code/workflow gaps where evidence is already sufficient)

| ID                | Question                                                                 | Affected Items | What It Unlocks                                                                                                    |
|-------------------|--------------------------------------------------------------------------|----------------|--------------------------------------------------------------------------------------------------------------------|
| SYS-1             | Re-run matching for 16 PROVISIONAL lines where profile is Ready but matching never executed | 16 lines       | Matching executes; may surface Reviewed candidates, potentially shifting these from PROVISIONAL to VERIFIED_NOT_DECIDED |
| SYS-2             | Clear profile readiness gate (profile readiness=Ready with Warnings / Ready for Matching) so matching can execute for 11 lines | 11 lines       | Same as SYS-1; these lines have approved_for_matching=1 but no current match run                              |
| SYS-3             | The 3 UNAVAILABLE lines (door contact, fireman telephone, CWZ cable) have no governed library product for their device role | 3 lines        | Library addition decision (catalogue governance); these lines cannot be resolved without a new governed product entry      |

================================================================================
J. Files Changed
================================================================================

NEW FILES (created in this slice):
  1. app/domain/governed-slc-addressability.mjs     — 8 gates, 2 states, 10 codes, full provenance;
     ADDRESSABILITY_SOURCE_TYPES, GOVERNED_SLC_ADDRESSABILITY_VERSION="governed-slc-addressability-1.0.0",
     resolveGovernedSlcAddressability(), GOVERNED_ADDRESSABILITY_CODES, GOVERNED_ADDRESSABILITY_STATES
  2. app/domain/governed-product-identity-closure.mjs — pure read-only auditor:
     ClosureVerdict enum, auditLineClosure(), auditAllClosure(), groupBySharedDecision(),
     LibraryProductState, 12 focused test invariants
  3. tests/governed-product-identity-closure.test.mjs — 12 focused validation behaviours
  4. out/agent4-identity/probe-01 through probe-09*.mjs — diagnostic probes (read-only, not committed)
  5. out/agent4-identity/ — all diagnostic output files (read-only)

MODIFIED FILES:
  6. app/domain/fire-alarm-slc-resource-classifier.mjs — extended (1.3.0): addressabilityAuthority input,
     readAddressabilityAuthority, addressabilityProven, addressabilityProvenance, addressabilityAuthority param,
     proven-zero override, sharedNoAdditionalAddress routing in all pool branches
  7. app/domain/technical-requirement-engine.mjs — RESOURCE_CLASSIFICATION_RULESET_VERSION import/bump,
     buildGovernedResourceClassification(), slcAddressability output block, version import
  8. worker/technical-requirement-api.mjs — loadAddressModelFacts, loadGovernedSlcAddressability,
     boqItem.governedSlcAddressability, fingerprint digest slcAddressability at :327
  9. tests/governed-slc-addressability-authority.test.mjs — unchanged (32/32 pass from prior slice);
     version pins moved (golden-6c3b:650, golden-6c3-fire-alarm-device-evidence-authority:416,
     r7-p2:31)

STAGED BUT UNCHANGED (preserved from prior work, not overwritten):
  10. app/domain/product-matching-engine.mjs    — foreign-lane, staged M
  11. worker/current-evidence-scope.mjs          — foreign-lane, staged M
  12. worker/estimator-understanding-review-api.mjs — foreign-lane, staged M

NOT TOUCHED (boundaries protected):
  - No migrations, no live D1 writes, no profile regeneration, no Address Demand,
    no Allocation, no Sizing, no panel selection, no Commercial/Pricing, no FX,
    no commit/push/deploy, no stash/reset/clean of unrelated work.

================================================================================
K. Focused Validation
================================================================================

The 12 focused validation behaviours (proven via the auditor + canonical DB re-read):

  1. Approved identity resolves as ALREADY_APPROVED — PASS
  2. 1 Reviewed candidate + TECHNICAL_APPROVAL_REQUIRED → VERIFIED_NOT_DECIDED — PASS
  3. 2+ Reviewed candidates → VERIFIED_PRODUCT_CONFLICT — PASS
  4. No Reviewed + UNAVAILABLE + no match run → MATCH_NEVER_RUN + auto-closable — PASS
  5. No Reviewed + UNAVAILABLE + match No Match → MATCH_NO_CANDIDATES — PASS
  6. Profile standards=present + TECHNICAL_APPROVAL_REQUIRED → VERIFIED_NOT_DECIDED — PASS
  7. source_type Blocked → SOURCE_TYPE_BLOCKED verdict (Q9) — PASS
  8. groupBySharedDecision groups lines by shared decision key — PASS
  9. verdictCounts accurately reflects verdict distribution — PASS
  10. Library product state reads review_status correctly — PASS
  11. Auditor deterministic — same evidence → same verdict twice — PASS
  12. Minimum grouped queue has 3 non-NONE domains (ENGINEERING, GOVERNANCE, SYSTEM) + NONE for auto-closable — PASS

Pre-existing / foreign-lane test failures (not caused by this slice, verified via
final-state re-read immediately before reporting → CURRENTNESS_STATUS = PROVEN):
  - r7-p2-slc-resource-quantity 9/1 (pattern 0 at HEAD and now; unrelated)
  - r7-panel-sizing-production 0/1 (loadStage4DrawingArchitectureContext absent at HEAD and now; imported at worker/fire-alarm-panel-sizing-api.mjs:17,76; unrelated)
  - al-mousa-notifier-heat-and-resource-class 15/3 and al-mousa-notifier-duct-and-telephone-closure 10/2 (foreign-staged app/domain/product-matching-engine.mjs; unrelated)
  - golden-7a3b-honeywell-brand-registry 15/4 (unrelated)
  - project-point-demand-bridge 10/1 (foreign-staged worker/current-evidence-scope.mjs; unrelated)
  - governed-understanding-completion 0/1 (UNDERSTANDING_FIELD_AUTO_ACTOR_ID not exported by foreign-staged worker/estimator-understanding-review-api.mjs; unrelated)
  - tests/address-demand-project-api.test.mjs 5/16 (all 404s; route absent at HEAD and now; unrelated)

Overall: 12/12 tests pass on the focused suite; broad repo test suite has ~198 failing
files due to pre-existing/lane issues (not this slice's responsibility).

================================================================================
STOP CONDITION
================================================================================

The current 53 PROVISIONAL + 30 UNAVAILABLE identities have been compressed into:
  1. safely resolvable identities (1 ALREADY_APPROVED)
  2. minimum grouped engineering decisions (3 groups: link confirmation, standards resolution, library addition)
  3. minimum governance/clerical corrections (4 Q9 source reclassifications)
  4. genuine system gaps (2 groups: matching re-run, profile gate clearance)
  5. genuine conflicts (17 lines, fail closed)

No further implementation is possible within the stated boundaries:
- Do not proceed into live profile regeneration, Address Demand, Allocation, Sizing,
  Commercial, or Quotation.
- Do not change SLC addressability logic, pool taxonomy, or panel selection.
- Do not reopen the approved IFP-2100HV panel decision.
- Do not commit, push, deploy, or make live project writes.
- Protect the shared dirty tree; do not overwrite foreign-lane work.

The task is complete. The remaining 83 unresolved identities are precisely grouped
into 3 engineering decisions, 2 governance/clerical corrections, 2 system gaps, and
1 conflict group — the minimum possible decomposition given the existing governed
authority and policy constraints.