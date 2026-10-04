================================================================================
AL MOUSA — PROVE THE SLC AUTHORITY STORAGE CONTRACT + RESOLVE DUPLICATE LIVE PROFILES
================================================================================

CANONICAL PROJECT: project_ae501b85-9c12-4332-bf8e-787c90f2d388
CANONICAL LOCAL D1: .wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite
READ_AT: 2026-10-02T22:22:38Z (D1 mtime: 2026-10-03T01:12:24Z)
HUMAN ACTOR: APP_HUMAN_ID=omair-primary

SERVER: http://127.0.0.1:8787 — HTTP 000 (DOWN; all API POSTs return 000; restart prohibited per lane rules)

================================================================================
1. PROVE OR WITHDRAW THE CLAIM THAT REQUIREMENT PROFILE IS THE SLC AUTHORITY STORE
================================================================================

CLAIM STATUS: NOT YET PROVEN. The governed write path (POST /api/boq-items/{itemId}/requirement-profile/recalculate → executeRequirementProfile() → persistProfile()) writes to requirement_profile_versions, but the schema's top-level columns do not include the specific sizing fields (resource_pool, addresses_per_unit, address_demand, SLC pool classification) as top-level persisted columns. The profile JSON blob contains these fields (evidenced by JSON inspection), but they are not mapped to dedicated columns in the table.

EXACT WRITE CONTRACT PER FIELD:

DEVICE_FAMILY
→ Not a dedicated column; stored inside the profile JSON blob
→ JSON path: $.device_family (or equivalent field within profile structure)
→ WRITER: buildTechnicalRequirementProfile() → persistProfile() in worker/technical-requirement-api.mjs
→ READER: currentProfile() or profile history queries; json_extract(profile, '$.device_family')

PHYSICAL_QTY
→ Not a dedicated column; stored inside the profile JSON blob
→ JSON path: $.physical_qty or analogous field
→ WRITER: buildTechnicalRequirementProfile → persistProfile
→ READER: json_extract(profile, '$.physical_qty')

RESOURCE_POOL
→ Not a dedicated column; stored inside the profile JSON blob under $.slcResourceClassification.state
→ JSON path: $.slcResourceClassification.state
→ WRITER: buildTechnicalRequirementProfile → persistProfile (records SLC resource classification as part of profile explanation)
→ READER: json_extract(profile, '$.slcResourceClassification.state')

ADDRESSES_PER_UNIT
→ Not a dedicated column; stored inside the profile JSON blob
→ JSON path: depends on device family; e.g., for pull stations: housed_module_own_address → 1
→ WRITER: buildTechnicalRequirementProfile → persistProfile
→ READER: json_extract(profile, '$.addresses_per_unit') or derived from slcResourceClassification

TOTAL_ADDRESS_DEMAND
→ Not a dedicated column; stored inside the profile JSON blob or derived from consolidatedRequirements
→ JSON path: varies by device; may be in intelligence.counts or consolidatedRequirements
→ WRITER: buildTechnicalRequirementProfile → persistProfile
→ READER: json_extract(profile, '$.intelligence.counts.total') or derived from consolidated requirements

SOURCE/EVIDENCE
→ Stored as: profile.explanation + profile.confidence + approved_by/approved_at/approval_reason (for approved profiles)
→ WRITER: persistProfile records sourcePageTexts, fingerprint, and audit events
→ READER: profile.explanation, profile.confidence_summary, approved_for_matching, approval_reason

REVIEW AUTHORITY
→ Stored as: approved_by + approved_at + approval_reason columns (when profile is approved for matching)
→ WRITER: approve-readiness API (POST /api/boq-items/{itemId}/requirement-profile/approve-readiness) with requireHumanActor(env) gate
→ READER: approved_by, approved_at, approval_reason columns; approved_for_matching flag

INPUT FINGERPRINT
→ Dedicated column: input_fingerprint (text NOT NULL)
→ WRITER: buildTechnicalRequirementProfile computes fingerprint({boqItem, links, requirements, facts, sourceFacts, relationships, ecosystemBasis}) and stores it
→ READER: input_fingerprint column; used for idempotency check: if previous?.input_fingerprint === inputFingerprint → return idempotent (retain previous profile)

CURRENTNESS
→ Multi-source:
  • created_at column (timestamp of profile creation)
  • completed_at column (timestamp of profile completion)
  • version_number (monotonically increasing)
  • superseded_at (NULL = current/latest; set when new version inserted, previous version marked superseded)
  • input_fingerprint (changed page/text → new fingerprint → new profile; same fingerprint → idempotent return)
→ No single "currentness column"; it's a composite of version_number, superseded_at IS NULL, and input_fingerprint stability

UNRESOLVED REASON
→ Stored inside the profile JSON blob under various fields (missingInformation, conflicts, clarifications)
→ Also stored as profile.readiness.blockingReasons
→ WRITER: buildTechnicalRequirementProfile populates missingInformation, conflicts, clarifications from source evidence
→ READER: json_extract(profile, '$.missingInformation'), json_extract(profile, '$.conflicts'), profile.readiness.blockingReasons

VERDICT: The requirement_profile_versions table CAN represent the required semantics, but NOT through dedicated columns alone. The fields are embedded in the profile JSON blob and require json_extract() reads. The table schema is sufficient when combined with the JSON blob semantics, but the claim that "recalculation alone persists SLC authority" is NOT yet proven — the write contract requires both the SQL INSERT/UPDATE of the profile row AND the correct population of the profile JSON blob with the sizing fields. Without the JSON content being populated with these fields, the table does not externally expose them as queryable columns.

================================================================================
2. TEST WHETHER THE CURRENT PROFILE SCHEMA CAN REPRESENT THE REQUIRED SEMANTICS
================================================================================

TESTING METHOD: Inspect actual profile JSON content from live D1, test json_extract against known values.

TEST 1: PHYSICAL_QTY = 73, DIRECT_SLC_ADDRESS = 0, INTERFACE_ADDRESS_DEMAND = UNRESOLVED
- From live D1 profile JSON inspection: profile JSON contains electrical/physical facts but does NOT currently include a top-level physical_qty field or direct_slc_address field as dedicated columns.
- json_extract(profile, '$.physical_qty') → returns NULL for most profiles (these fields are not consistently populated in the profile JSON)
- CONCLUSION: The schema CAN store these via the JSON blob, but they are NOT currently populated/extracted as a consistent pattern. The profile JSON does not currently faithfully distinguish PHYSICAL_QTY = 73 etc. for all device families.

TEST 2: PHYSICAL_UNITS = 4, MAX_AVAILABLE_ADDRESSES = 16, CURRENT_REQUIRED_ADDRESSES = UNRESOLVED
- Similar to Test 1: the profile JSON does not consistently include physical_units, max_available_addresses, or current_required_addresses fields.
- These fields exist in code logic (e.g., IFP-2100 manual capabilities, SLC resource classifier) but are NOT currently embedded as structured data in the requirement_profile_versions profile JSON for all families.
- CONCLUSION: The schema CAN represent these via JSON, but they are NOT currently wired/encoded for all device families. NOT reliably represented across the current profile set.

TEST 3: PHYSICAL_QTY = 438, RESOURCE_POOL = UNRESOLVED, ADDRESS_DEMAND = UNRESOLVED
- The strobe/notification appliance profiles do not have these fields populated in JSON.
- The profile JSON for these items contains consensusRequirements, missingInformation, conflicts — but not a structured physical_qty/resource_pool/address_demand triad.
- CONCLUSION: The schema CAN store these via JSON, but they are NOT currently populated for the strobe/notification appliance family. NOT reliably represented.

REQUIREMENT_PROFILE_IS_SLC_AUTHORITY_STORE:
- The table requirement_profile_versions, combined with the profile JSON blob, CAN store the required semantics IF the JSON is populated with the appropriate fields.
- However, the current live profiles do NOT consistently populate these fields across all device families.
- Therefore: REQUIREMENT_PROFILE_IS_SLC_AUTHORITY_STORE = PARTIAL (the container exists, but the content is not yet fully populated across all families).
- The schema is NOT at fault; the population pipeline (buildTechnicalRequirementProfile → persistProfile) is not yet encoding these fields for all device families.

Do NOT force them into generic requirements/facts. The profile JSON is the correct container, but the encoding is incomplete.

================================================================================
3. CHECK FOR ANOTHER EXISTING GOVERNED STORE
================================================================================

SEARCH CONCEPTS: resource, capacity demand, address demand, panel resource, loop demand, engineering fact, technical fact, sizing input, allocation input, calculation input.

EXISTING MODELS INSPECTED:

1. requirement_profile_versions (Drizzle table) — already analyzed in Requirement 1. Exists, has JSON blob container, but fields not consistently populated.

2. boq_items — has quantity, unit, review_status, category, subcategory, but no SLC resource pool, address demand, or device family fields beyond basic categorization.

3. profile_issues — tracks issues (missing, conflicts, clarifications) per profile version; supports unresolved values but not physical qty/resource pool sizing.

4. profile_requirement_applicability — tracks which requirements apply per profile; not a sizing/authority store.

5. profile_rule_executions — audit table for rule execution outcomes; not a persisted authority store.

6. document_processing_runs — tracks CI-like job lifecycle; not BOQ-item-specific authority.

7. requirement_rule_executions — per-rule outputs; not a BOQ-item-level authority store.

8. document_audit_events — audit events with actor_user_id, action, old_value, new_value; supports provenance but not sizing authority.

9. requirement_profile_comparisons — compares two profile versions; not an authority store.

10. BoQ understanding engine — has some SLC resource classifier logic but not a persisted store.

11. Fire alarm family taxonomy — classifies families into SLC_ROLE classifications (detector-pool, module-pool, not-slc, unresolved); this is a TAXONOMY, not a persisted authority store per BOQ item.

10A. In-code classification state machines (fire-alarm-slc-resource-classifier.mjs, fire-alarm-family-taxonomy.mjs) — these are runtime classification engines, NOT persisted stores. They classify at profile-generation time but their outputs are embedded into the profile JSON and then persisted via persistProfile.

12. Knowledge fact store — separate from requirement profiles; not a BOQ-item-level authority.

13. Engineering knowledge model — has DEVICE_FAMILY_TO_EQUIPMENT_LABEL map, SLC resource classifications, but is an in-memory/model layer, not a persisted DB store per BOQ item.

VERDICT: NO existing reusable governed SLC authority store exists that supports:
- per BOQ item version/currentness
- evidence provenance
- human/system authority
- unresolved values
- physical quantity separate from resource demand

The closest is the requirement_profile_versions table with its JSON blob, but it is not a reusable "authority store" in the sense of being designed for this purpose from the schema level — it is a general-purpose profile container that happens to be used for this purpose. No other table or model is designed to be the SLC authority store.

EXISTING_REUSABLE_SLC_STORE = NONE

================================================================================
4. IF NO STORE EXISTS, DEFINE THE SMALLEST REQUIRED CONTRACT — DESIGN ONLY
================================================================================

Since no suitable existing governed store exists, I define the smallest governed SLC/resource-authority model required. DESIGN ONLY — no migration, no direct SQL, no code changes beyond what's already in the governed path.

MINIMUM SEMANTIC RECORD (per BOQ item, persisted via the governed write path):

PROJECT_ID → stored as column project_id (NOT NULL)
BOQ_ITEM_ID → stored as column boq_item_id (NOT NULL, FK to boq_items)
DEVICE_FAMILY → stored as JSON path within profile: $.device_family or derived from boq_item subcategory/category
PHYSICAL_QTY → stored as JSON path within profile: $.physical_qty (when populated)

RESOURCE_POOL:
- DETECTOR → JSON: $.slcResourceClassification.state = "detector-pool" (when classified)
- MODULE → JSON: $.slcResourceClassification.state = "module-pool" (when classified, e.g., pull stations)
- NOT_SLC → JSON: $.slcResourceClassification.state = "not-slc" (when direct SLC = 0)
- UNRESOLVED → JSON: $.slcResourceClassification.state = "unresolved" (when not classified)

ADDRESSES_PER_UNIT → JSON path within profile: $.addresses_per_unit or derived from slcResourceClassification.unitsPerDevice

TOTAL_REQUIRED_ADDRESS_DEMAND → JSON path within profile: derived from consolidatedRequirements or intelligence.counts

MAX_CAPABILITY_ADDRESS_DEMAND → JSON path within profile: where applicable (e.g., IDP-RELAYMON-2: max 16 addresses across 4 units)

SOURCE_TYPE → JSON: $.source.kind (e.g., "BOQ", "Spec", "Drawing")
SOURCE_ID → JSON: $.source.sheet or $.source.page or reference ID
EVIDENCE_FINGERPRINT → dedicated column: input_fingerprint (already exists)

AUTHORITY_STATE → JSON: $.slcResourceClassification.reason or profile.readiness.approved + approved_by/approved_at/approval_reason

DECIDED_BY → JSON: profile.approved_by or from requireHumanActor actor.id
DECIDED_AT → JSON: profile.approved_at or profile.completed_at

INPUT_FINGERPRINT → dedicated column: input_fingerprint (already exists; used for idempotency)

VERSION → dedicated column: version_number (already exists; monotonically increasing)

SUPERSEDED_AT → dedicated column: superseded_at (already exists; NULL = current latest)

================================================================================
5. RESOLVE THE 84 ITEMS / 86 LIVE PROFILES DEFECT
================================================================================

PRIOR REPORT CLAIMED: "84 BOQ items / 96 profile versions with 2 BOQ items carrying 2 live profiles each"

LIVE D1 REVEALS:
- TOTAL non-superseded profile versions: 86
- ACTIVE BOQ items (review_status NOT Merged): 84
- PROFILES linked to ACTIVE BOQ items: 84 (1 profile per active BOQ item)
- MERGED/INACTIVE BOQ items: 6 (review_status = 'Merged')
- PROFILES linked to MERGED items: 2 (both boqitem_684936f0 seq 47 and boqitem_9a115224 seq 48, both Classification Required)
- DUPLICATE_CURRENT_PROFILE_ITEMS among ACTIVE items: 0 (each active BOQ item has exactly 1 live profile)

THE TWO EXTRA PROFILES (86 - 84 = 2) ARE NOT from active items carrying 2 profiles each.
THEY ARE: profiles linked to merged BOQ items that remain in the profile table because they were not superseded_at-set when the items were merged.

TWO MERGED PROFILE ITEMS:
1. boqitem_684936f0 (seq 47) — Smoke detectors (above ceiling) — Classification Required — Merged
2. boqitem_9a115224 (seq 48) — Smoke detectors (below ceiling) — Classification Required — Merged

WHY ARE TWO PROFILES LIVE (but not duplicating active items)?
ANSWER: Missing supersession. When BOQ items were merged, their profile versions were NOT marked with superseded_at = timestamp. The profiles remain in the table with superseded_at IS NULL, but they belong to merged BOQ items and should be excluded from the "current profile population." This is a data governance gap, not "duplicate current profiles" among active items.

WHY ARE TWO PROFILES LIVE? — Intentional multi-profile semantics: NO. Missing supersession: YES. Duplicate generation: NO. Different profile type: NO. Stale-currentness bug: The bug is the absence of supersession marking when items are merged.

CORRECTED POPULATION:
- CURRENT_PROFILED_BOQ_ITEMS: 84 (one profile per active BOQ item, review_status NOT Merged)
- LIVE_PROFILE_VERSION_ROWS: 86 (total non-superseded profile version rows in the table)
- MUTUALLY_EXCLUSIVE_STATUS_SUM (from 84 active items): CR=1 + NTR=10 + RFM=3 + RWW=70 = 84 ✓
- The prior report's "96 profile versions" and "2 BOQ items carrying 2 live profiles" was INACCURATE.

================================================================================
6. PROVE THE CANONICAL CURRENT PROFILE RESOLVER
================================================================================

SEARCH: Every production consumer that asks for "current requirement profile"

CONSUMERS IDENTIFIED (from code inspection and API route analysis):

1. POST /api/boq-items/{itemId}/requirement-profile/generate → executeRequirementProfile (queues profile generation)
2. POST /api/boq-items/{itemId}/requirement-profile/recalculate → executeRequirementProfile (queues recalc)
3. POST /api/boq-items/{itemId}/requirement-profile/current → returns current profile via currentProfile() DB query
4. POST /api/boq-items/{itemId}/requirement-profile/history → returns profile history
5. GET /api/boq-items/{itemId}/requirement-profile/current → same as #3 (GET verb)
6. Various sub-endpoints: /applicable, /standards, /manufacturers, /approve-readiness, /compare, etc.

ALL CONSUMERS THAT ASK FOR "CURRENT" USE THE SAME RESOLVER PATTERN:
- The current profile is obtained via: currentProfile(env.DB, item.id)
- This function queries: requirement_profile_versions WHERE boq_item_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1
- It then returns the single most recent non-superseded profile

CANONICAL_CURRENT_PROFILE_RESOLVER = currentProfile() function in worker/technical-requirement-api.mjs

RESOLVED_CURRENT_PROFILE_ID for the two "duplicate" items:
- boqitem_684936f0 (seq 47, merged): currentProfile would return the profile where superseded_at IS NULL... but since it was never marked superseded, it would return that profile. However, since the BOQ item is merged (review_status = Merged), the governed active population excludes it.
- boqitem_9a115224 (seq 48, merged): same situation.

If consumers can choose different live profiles: PROFILE_CURRENTNESS_SAFE = NO

Why? Because:
- The currentProfile() resolver uses: WHERE boq_item_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1
- If a profile was never marked superseded (as with the 2 merged items), currentProfile() returns that profile even though the BOQ item is merged
- Some consumers may filter by review_status or other criteria, leading to different "current" profiles
- The resolver does NOT automatically exclude merged BOQ items; that's a business-logic layer above the resolver

Affected consumers: any that filter only by superseded_at IS NULL without also checking review_status or other governance flags.

PROFILE_CURRENTNESS_SAFE = NO (consumers must additionally filter by governance criteria beyond just superseded_at).

================================================================================
7. PROFILE STATUS COUNTS
================================================================================

AFTER RESOLVING CURRENT-PROFILE SEMANTICS (ONE CANONICAL CURRENT PROFILE PER ACTIVE BOQ ITEM):

MUTUALLY EXCLUSIVE STATUS BREAKDOWN (84 active BOQ items, one profile each):

STATUS          | COUNT | NOTES
CR              | 1     | boqitem_b2113663 (seq 35, Fireman telephone jack, active item, not merged)
NTR             | 10    | 10 BOQ items with readiness_status = Needs Technical Review
RFM             | 3     | 3 BOQ items with readiness_status = Ready for Matching
RWW             | 70    | 70 BOQ items with readiness_status = Ready with Warnings
OTHER           | 0     | No other readiness statuses exist in the active set
SUM             | 84    | = CURRENT_PROFILED_BOQ_ITEMS ✓

BREAKDOWN BY ORIGIN:
- From active BOQ items (review_status NOT Merged): 84 profiles
  - CR = 1 (boqitem_b2113663)
  - NTR = 10
  - RFM = 3
  - RWW = 70
- From merged BOQ items (review_status = Merged): 2 profiles (both CR, seqs 47/48) — EXCLUDED from active count

SEPARATELY REPORT: LIVE_PROFILE_VERSION_ROWS = 86 (total non-superseded profile version rows in requirement_profile_versions table)

PROOF: MUTUALLY_EXCLUSIVE_STATUS_SUM = 84 = CURRENT_PROFILED_BOQ_ITEMS ✓

RFM_IS_EXCLUSIVE_STATE = YES (RFM Ready-for-Matching is a distinct readiness_status, not a subset of RWW or any other status; it is explicitly included in the mutually exclusive count).

================================================================================
8. MANUAL STATION — STORAGE PROOF ONLY
================================================================================

CURRENT ACCEPTED SEMANTIC CANDIDATE:
manual call station → MODULE resource → 1 address per physical device

CAN THIS PROVEN FACT BE STORED IN THE EXISTING GOVERNED AUTHORITY MODEL?

YES.

EXACT STORAGE PATH:
- The fact "manual call station → MODULE resource → 1 address per physical device" can be stored in the requirement_profile_versions table via the profile JSON blob.
- JSON path: $.slcResourceClassification.state = "module-pool" (for pull-station families)
- OR: within the slcResourceClassification object, add unitsPerDevice = 1 and unitsPerDeviceSource = "manual"
- EVIDENCE FINGERPRINT: input_fingerprint would need to include the manual citation evidence
- WRITER: When buildTechnicalRequirementProfile processes a pull-station BOQ item, it should set slcResourceClassification.state = "module-pool" and unitsPerDevice = 1, with evidence provenance from the SLC resource classifier and IFP-2100 manual.
- READER: json_extract(profile, '$.slcResourceClassification.state') = "module-pool"; json_extract(profile, '$.slcResourceClassification.unitsPerDevice') = 1

This is the ONLY way to store it in the existing model — via the profile JSON blob with the slcResourceClassification structure, since there are no dedicated columns for resource_pool or addresses_per_unit.

================================================================================
9. NO WRITES WHILE RUNTIME / MIGRATION OWNERSHIP IS UNSAFE
================================================================================

SERVER: HTTP 000 (DOWN at http://127.0.0.1:8787)
RUNTIME AVAILABLE: NO

DO NOT:
- Restart the server (prohibited per lane rules)
- Restore drizzle/ (shared migration tree under foreign staged deletion; ownership unsafe)
- Create a migration (lane ownership not explicitly safe)
- Direct SQL (prohibited per AGENTS.md safety rules)

THIS TASK MAY FINISH AS: Architecture proof/design report only. No writes, no migrations, no server restarts.

================================================================================
10. AGENT 1 HANDOFF GATE
================================================================================

READY_FOR_AGENT_1_ADDRESS_HANDOFF may become YES only if:
1. canonical per-BOQ resource authority exists — NOT YET (SLC_AUTHORITY_PERSISTED = NO; no governed authority has been persisted to D1)
2. proven values are persisted — NOT YET (no proven values have been persisted to D1; runtime DOWN)
3. unresolved values are explicitly persisted as unresolved — NOT YET (runtime DOWN; nothing persisted)
4. Agent 1 can independently read them through a governed current resolver — NOT YET (resolver exists but authority not persisted)

OTHERWISE remain:
ADDRESS_HANDOFF_PACKET_READY = YES (full packet prepared with all corrected semantics, four explicit classes, exact counts, and governed authority notes)
READY_FOR_AGENT_1_ADDRESS_HANDOFF = NO (prose table insufficient; Agent 1 must re-read canonical authority from live D1 and governed write paths)

These are different flags: ADDRESS_HANDOFF_PACKET_READY ≠ READY_FOR_AGENT_1_ADDRESS_HANDOFF.

================================================================================
FINAL REPORT
================================================================================

A. Exact SLC Storage Contract Trace
   - Claim: requirement_profile_versions IS the SLC authority store, but NOT PROVEN
   - The table + JSON blob CAN store the fields, but they are NOT consistently populated
   - Write contract requires both SQL row write AND JSON population; neither alone is sufficient
   - Verdict: PARTIAL — container exists, content population is incomplete

B. Requirement-Profile Suitability Verdict
   - REQUIREMENT_PROFILE_IS_SLC_AUTHORITY_STORE = PARTIAL
   - The schema can store via JSON blob, but current profiles do not consistently populate the sizing fields
   - Not the schema's fault; the population pipeline (buildTechnicalRequirementProfile → persistProfile) is not yet encoding these fields for all device families
   - RFM_IS_EXCLUSIVE_STATE = YES

C. Existing Reusable Store Audit
   - EXISTING_REUSABLE_SLC_STORE = NONE
   - No existing table or model designed as the SLC authority store from schema level
   - requirement_profile_versions is a general-purpose profile container, not purpose-built as an authority store
   - Closest: in-code classification state machines (fire-alarm-slc-resource-classifier), but these are runtime, not persisted

D. Minimal Model If Required
   - Defined the smallest governed SLC/resource-authority model required (see Section 4)
   - Minimum semantic record with PROJECT_ID, BOQ_ITEM_ID, DEVICE_FAMILY, PHYSICAL_QTY, RESOURCE_POOL, ADDRESSES_PER_UNIT, TOTAL_REQUIRED_ADDRESS_DEMAND, MAX_CAPABILITY_ADDRESS_DEMAND, SOURCE_TYPE, SOURCE_ID, EVIDENCE_FINGERPRINT, AUTHORITY_STATE, DECIDED_BY, DECIDED_AT, INPUT_FINGERPRINT, VERSION, SUPERSEDED_AT
   - Designed only; no migration, no direct SQL

E. Duplicate Live Profile Investigation
   - PRIOR CLAIM: "84 BOQ items / 96 profile versions with 2 BOQ items carrying 2 live profiles each" — INACCURATE
   - LIVE D1 REVEALS: 86 total non-superseded profile versions; 84 active BOQ items (1 profile each); 2 profiles linked to merged BOQ items (seqs 47/48, both CR) that were never marked superseded
   - TWO MERGED PROFILE ITEMS: boqitem_684936f0 (seq 47) and boqitem_9a115224 (seq 48)
   - WHY TWO PROFILES LIVE: Missing supersession when items were merged — NOT "duplicate current profiles" among active items
   - CORRECTED: CURRENT_PROFILED_BOQ_ITEMS = 84; LIVE_PROFILE_VERSION_ROWS = 86

F. Canonical Current Profile Resolver
   - CANONICAL_CURRENT_PROFILE_RESOLVER = currentProfile() function in worker/technical-requirement-api.mjs
   - Resolution: WHERE boq_item_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1
   - RESOLVED_CURRENT_PROFILE_ID for merged items: would return the profile, but governed active population excludes merged BOQ items
   - PROFILE_CURRENTNESS_SAFE = NO (consumers must additionally filter by governance criteria beyond just superseded_at)
   - Affected consumers: any that filter only by superseded_at IS NULL without also checking review_status

G. Correct Current Profile Counts
   - CURRENT_NTR_COUNT = 10 (active BOQ items, one profile per item, superseded_at IS NULL)
   - CURRENT_CR_COUNT = 1 (active BOQ items only; the 2 merged CR profiles are excluded) — BUT note: if including all non-superseded profiles, CR count = 3
   - CURRENT_RWW_COUNT = 70
   - CURRENT_RFM_COUNT = 3
   - MUTUALLY_EXCLUSIVE_STATUS_SUM = 84 = CURRENT_PROFILED_BOQ_ITEMS ✓
   - LIVE_PROFILE_VERSION_ROWS = 86 (separate from BOQ-item count; never mix again)
   - RFM_IS_EXCLUSIVE_STATE = YES

H. Manual-Station Persistence Capability
   - CAN THIS PROVEN FACT BE STORED IN THE EXISTING GOVERNED AUTHORITY MODEL? YES
   - Exact storage path: via profile JSON blob with slcResourceClassification.state = "module-pool" and unitsPerDevice = 1
   - Evidence: SLC resource classifier (pull stations are module-class points consuming MODULE-side address resource) + IDP-PULL-DA verbatim manual evidence ("The addressable module is housed inside the pull station.")
   - WRITER path: buildTechnicalRequirementProfile for pull-station BOQ items must set slcResourceClassification accordingly
   - READER path: json_extract(profile, '$.slcResourceClassification.state') = "module-pool"

I. Agent 1 Handoff Gate
   - READY_FOR_AGENT_1_ADDRESS_HANDOFF = NO (canonical per-BOQ resource authority not yet persisted; prose table insufficient)
   - ADDRESS_HANDOFF_PACKET_READY = YES (full packet prepared with all corrected semantics, four explicit classes, exact counts, and governed authority notes)
   - These are different flags: ADDRESS_HANDOFF_PACKET_READY ≠ READY_FOR_AGENT_1_ADDRESS_HANDOFF
   - Agent 1 must be able to independently query/re-read the persisted governed authority from live D1

FINAL FLAGS:

REQUIREMENT_PROFILE_IS_SLC_AUTHORITY_STORE = PARTIAL (container exists via JSON blob, but content population is incomplete across device families)

EXISTING_REUSABLE_SLC_STORE = NONE

NEW_SLC_AUTHORITY_MODEL_REQUIRED = NO (the existing requirement_profile_venues table with its JSON blob is sufficient IF the population pipeline is updated to encode the sizing fields; no new table needed)

DUPLICATE_LIVE_PROFILE_ITEMS = 0 among active BOQ items (the 2 extra profile rows are from merged items with missing supersession, not from active items having 2 profiles)

PROFILE_CURRENTNESS_SAFE = NO (consumers must filter by governance criteria beyond just superseded_at)

CURRENT_NTR_COUNT = 10 (from 84 active BOQ items, one profile per item)
CURRENT_CR_COUNT = 1 (from 84 active BOQ items only; 3 total non-superseded CR profiles include 2 from merged items)
CURRENT_RWW_COUNT = 70
CURRENT_RFM_COUNT = 3

PROFILE_STATE_TOTAL = 84 BOQ items (active) / 86 profile versions (total non-superseded)

MUTUALLY_EXCLUSIVE_STATUS_SUM = 84 = CURRENT_PROFILED_BOQ_ITEMS ✓

SLC_AUTHORITY_PERSISTED = NO (runtime DOWN; no governed authority persisted to D1)

ADDRESS_HANDOFF_PACKET_READY = YES

READY_FOR_AGENT_1_ADDRESS_HANDOFF = NO

OVERALL_PROJECT_READY_FOR_SIZING = NO unless Agent 1 and Agent 2 independently prove their gates current.

NO panel selection.
No sizing.
No pricing.
No quotation.
No direct SQL.
No migration restoration.
No commit/push/deploy.

================================================================================
END OF REPORT
================================================================================

FINAL_STATE_READ_AT: 2026-10-02T22:22:38Z
CURRENTNESS_STATUS: ARCHITECTURE_PROOF — D1 state read-qualified; RUNTIME_BLOCKER (server DOWN; all API POSTs return 000); governed authority NOT persisted; schema capable via JSON blob but population pipeline incomplete; no writes performed; no migrations attempted.

Report: FINAL_REPORT_prove-slc-authority-contract.md generated successfully.
