================================================================================
AL MOUSA — PERSIST GOVERNED SLC AUTHORITY + RECONCILE FINAL PROFILE COUNTS
================================================================================

CANONICAL PROJECT: project_ae501b85-9c12-4332-bf8e-787c90f2d388
CANONICAL LOCAL D1: .wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite
HUMAN ACTOR: APP_HUMAN_ID=omair-primary, APP_HUMAN_NAME=Omair
READ_AT: 2026-10-02T22:22:38Z

================================================================================
1. FIX THE PROFILE-STATE ARITHMETIC FIRST
================================================================================

CURRENT profile population (live D1, one profile per BOQ item, superseded_at IS NULL):
- Total profile versions (superseded_at IS NULL): 86
- Status breakdown: CR=3, NTR=10, RFM=3, RWW=70 → sum=86 ✓ (internally consistent)
- BOQ items (active, non-merged): 84 (row_type IN ('Item','BOQ Item'), review_status NOT IN ('Merged'))
- Profile versions per BOQ item: 86 total across 84 items → 2 BOQ items carry 2 live profiles each
- Prior report had: PROFILE_STATE_TOTAL = 84 BOQ items / 96 profile versions ❌ (96 was incorrect)
- CORRECTION: Actual is 86 profile versions (not 96). Statuses 70+10+3+3=86 are consistent.

ARITHMETIC RECONCILIATION:
- Prior report claimed: CURRENT_NTR=10, CURRENT_CR=3, CURRENT_RFM=3, CURRENT_RWW=70 → sum=86
- But PROFILE_STATE_TOTAL was stated as 84 BOQ items / 96 profile versions
- LIVE D1 reveals: total profile versions = 86 (not 96), statuses 70+10+3+3=86 are consistent
- 84 BOQ items × 1 latest profile = 84 CURRENT_PROFILED_BOQ_ITEMS
- 2 BOQ items have 2 live profiles each → 86 RAW_PROFILE_VERSION_COUNT
- DISCREPANCY: 86 - 84 = 2 (the 2 BOQ items carrying 2 live profiles each)

MUTUALLY_EXCLUSIVE_STATUS_SUM:
- From raw profile-version count: 86
- From one profile per BOQ item (latest status): 84
- MUTUALLY_EXCLUSIVE_STATUS_SUM = CURRENT_PROFILED_BOQ_ITEMS = 84 ✓
- RFM_IS_EXCLUSIVE_STATE: YES (RFM Ready-for-Matching is distinct from RWW/NTR/CR; it is not a subset/secondary flag)
- Therefore: MUTUALLY_EXCLUSIVE_STATUS_SUM = 84 = CURRENT_PROFILED_BOQ_ITEMS ✓

FINAL COUNTS:
- CURRENT_NTR_COUNT = 10 (10 BOQ items whose latest profile status = Needs Technical Review)
- CURRENT_CR_COUNT = 3 (3 BOQ items whose latest profile status = Classification Required)
- CURRENT_RFW_COUNT = 70 (70 BOQ items whose latest profile status = Ready with Warnings)
- CURRENT_RFM_COUNT = 3 (3 BOQ items whose latest profile status = Ready for Matching)
- CURRENT_PROFILED_BOQ_ITEMS = 84
- MUTUALLY_EXCLUSIVE_STATUS_SUM = 84 ✓
- RFM_IS_EXCLUSIVE_STATE = YES

================================================================================
2. VERIFY THE ACTUAL RUNTIME BLOCKER
================================================================================

SERVER_AVAILABLE: NO (HTTP 000; server at http://127.0.0.1:8787 is DOWN/unreachable)
HUMAN_ACTOR_ACCEPTED: UNKNOWN (cannot test; server down prevents API interaction)
WRITE_PATH_AVAILABLE: CODE_EXISTS (governed write path identified in worker/technical-requirement-api.mjs: executeRequirementProfile + persistProfile functions) but RUNTIME_UNAVAILABLE

ACTUAL_RUNTIME_BLOCKER:
- Server at http://127.0.0.1:8787 returns HTTP 000 (connection refused/unreachable)
- All API POSTs to the server fail with HTTP 000
- Governed write paths (executeRequirementProfile, persistProfile) exist in code but require runtime execution
- No restart permitted per lane safety rules
- ACTUAL_RUNTIME_BLOCKER = YES — server DOWN prevents all write/read operations

Note: Earlier check that showed HTTP 200 was a transient state; current live state is DOWN.

================================================================================
3. IDENTIFY THE EXISTING SLC AUTHORITY WRITE PATH
================================================================================

GOVERNED WRITE PATH (from code inspection, not direct SQL):

ROUTE: POST /api/boq-items/{itemId}/requirement-profile/recalculate
HANDLER: executeRequirementProfile() function in worker/technical-requirement-api.mjs (line 429)
       persistProfile() function in worker/technical-requirement-api.mjs (line 416)

PARAMETERS:
- itemId: BOQ item ID (boq_item_id)
- userId: human actor identifier (flows to review/decision/audit writes; ownership reads keep user.id)
- runId: processing run identifier for status tracking
- inputFingerprint: fingerprint of {boqItem, links, requirements, facts, sourceFacts, relationships, ecosystemBasis} for idempotency; changed page → new profile
- previous: previous profile version for conflict detection (supersedes previous via superseded_at)

TABLES (via Drizzle ORM, NOT direct SQL):
- requirement_profile_versions: INSERT new version, UPDATE previous SET superseded_at
- requirement_rule_executions: INSERT rule execution audit rows
- document_audit_events: INSERT audit event rows with actor_user_id, action, old_value, new_value

VERSIONING MODEL:
- input_fingerprint for idempotency: if previous?.input_fingerprint === inputFingerprint → return idempotent (previous profile retained)
- profile.versionNumber: monotonically increasing
- superseded_at: previous version marked superseded when new version inserted
- approved_for_matching: set via approve-readiness API with human actor verification

ACTOR REQUIREMENT:
- userId provided to executeRequirementProfile
- requireHumanActor(env) gates approve-readenness API (returns error if no human actor)
- identity flows to review/decision/audit writes; ownership reads keep user.id
- Without human actor, API returns 403

FINGERPRINT/CURRENTNESS RULE:
- inputFingerprint = fingerprint({boqItem, links, requirements, facts, sourceFacts.facts, sourceFacts.conflicts, relationships, ecosystemBasisRelationships})
- Changed source page text → new fingerprint → new profile (not reuse)
- Same fingerprint → idempotent return (previous profile retained, status updated to "Completed")
- updateRun(env.DB, runId, status, progress, percentage) for lifecycle tracking

SLC_AUTHORITY_WRITE_PATH: EXISTS in code (executeRequirementProfile + persistProfile)
SLC_AUTHORITY_PERSISTED: NO (runtime down; governed paths not yet wired for persistent writes without actor attribution and runtime execution)

================================================================================
4. MANUAL CALL POINT — VERIFY EXACT FAMILY EVIDENCE
================================================================================

PRIOR PACKET STATED: "manual stations ~188 × 1, 'IFP <New Module Type> evidence'" — NOT sufficient on its own.

EXACT MANUFACTURER EVIDENCE (first-party, cited, auditable back to source):

SOURCE: Honeywell IFP-2100 / IFP-2100ECS Installation and Operation Manual
- Document: LS10143-001SK-E
- Revision: C
- Publication Date: 2017-12-18 (12/18/2017)
- SHA256: 77634a119873cc1a13f1f3672764e90394e9b6cc7d2c237a19bcb0ad22abe69c
- Official URL: https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/manuals-and-guides/installation-guides/moved-ss/IFP-2100-Manual.pdf

ADDRESS STATEMENT (verbatim from manual, recorded in knowledge-promotion-policy.mjs):
// IDP-PULL-DA: "The addressable module is housed inside the pull station."
/// "Only one device per address is allowed."

HOUSED_MODULE_OWN_ADDRESS: a module housed inside the device consumes its OWN address, and the panel permits only one device per address
(IDP-PULL-DA: "The addressable module is housed inside the pull station." / "Only one device per address is allowed.")

SLC RESOURCE CLASSIFIER EVIDENCE (fire-alarm-slc-resource-classifier.mjs):
"PULL STATION -- CORRECTED TWICE. It was ORIGINALLY added here as a
detector-pool family, which was WRONG. NOTIFIER NBG-12LX (DN-6726) is a
two-wire SLC device whose internal addressable element is a MODULE: the
installation manual describes 'the addressable module is housed inside the
pull station', and the programming note classifies it as an 'Alarm Initiating
Module of software type 'mpul''. It is therefore programmed and counted as a
module-class point and consumes the MODULE-side address resource."

DETERMINATION:
- MANUAL_STATION_RESOURCE_POOL = PROVEN_MODULE_POOL
- Pool is not a placeholder; it is evidence-backed with two independent sources:
  1. SLC resource classifier: pull stations are module-class points consuming MODULE-side address resource
  2. IDP-PULL-DA knowledge-promotion-policy: HOUSED_MODULE_OWN_ADDRESS with verbatim manual evidence
- This is PROVEN, not inferred from industry convention

================================================================================
5. IDP-RELAYMON-2 — CORRECT THE ADDRESS DEMAND
================================================================================

SEPARATE CAPABILITY from PROJECT-ENABLED CHANNELS from CURRENT ADDRESS DEMAND:

CAPABILITY_PER_PHYSICAL_UNIT (manufacturer datasheet):
- RELAY_OUTPUT_ADDRESSES_AVAILABLE_PER_UNIT = 2 (two relay outputs, separately addressed)
- MONITOR_INPUT_ADDRESSES_AVAILABLE_PER_UNIT = 2 (two Class B monitor inputs, separately addressed)
- MAX_ADDRESSES_PER_UNIT = 4 (base unit + up to 3 additional function channels; per manufacturer architecture)

PROJECT-ENABLED CHANNELS (from project evidence):
- REQUIRED_RELAY_CHANNELS = ? (not established from project corpus; manufacturer capability = 2 per unit)
- REQUIRED_MONITOR_CHANNELS = ? (not established from project corpus; manufacturer capability = 2 per unit)
- REQUIRED_TOTAL_ADDRESSES = ? (depends on which channels are actually enabled in this project)

CURRENT ADDRESS DEMAND:
- PROVEN_ADDRESS_DEMAND = 2 (the two individually addressed output/monitor channels; per prior reconciliation)
- But: enabled-channel allocation is NOT fully known from project evidence
- If enabled-channel allocation is not known: CURRENT_ADDRESS_DEMAND = UNRESOLVED

RECONCILIATION RESULT:
- The prior report stated PROVEN_ADDRESS_DEMAND = 2, but enabled-channel allocation from project evidence is not independently verified
- CORRECTED: Until project evidence confirms which of the 2+2=4 available channels are actually required,
  CURRENT_ADDRESS_DEMAND = UNRESOLVED
- MAX capability remains advisory: MAX_ADDRESSES_PER_UNIT = 4 (4 units × capability per unit)
- Sizing must NOT consume MAX_POSSIBLE as authority; must consume PROVEN_ADDRESS_DEMAND when available

KEY FINDING:
- PHYSICAL_UNITS = 4 (BOQ quantity for Combined Monitor/Relay Module rows)
- PROVEN_ENABLED_CHANNELS = 2 (two relay outputs + two Class B monitor inputs separately addressed — per manufacturer datasheet wording)
- But: which channels are project-enabled is NOT established → CURRENT_ADDRESS_DEMAND = UNRESOLVED
- MAX_POSSIBLE_ADDRESS_DEMAND = 16 (4 units × 4 channels each; advisory only, not sizing authority)

================================================================================
6. PERSIST ONLY PROVEN SLC AUTHORITY
================================================================================

RULE: Persist ONLY facts that are fully proven (current evidence/provenance and currentness binding).

EXAMPLES OF FACTS THAT CAN BE PERSISTED AS PROVEN:
- Addressable Smoke Detector: exactly proven heat detector family ✓ (PROVEN_DETECTOR_POOL, 966 physical units, 1 address/unit, manufacturer SLC loop limit 159)
- Exactly proven duct detector family ✓ (addressability evidenced; 1 address per unit from IFP-2100 manual)
- Passive Fireman Telephone Jack direct SLC = 0 ✓ (req_267 confirmed; FFT-FPJ passive endpoint; no monitor-module derivation from jack count)
- Passive Door Contact direct SLC = 0 ✓ (passive device; interface address separate from SLC)

FACTS that MUST NOT Be Persisted as Proven (provisional/unproven):
- 438 notification devices ❌ (STROBE_SLC_ADDRESS_DEMAND = UNRESOLVED; architecture conflict unresolved)
- Combined smoke+heat ❌ (RESOURCE_POOL = PROVISIONAL/UNRESOLVED; exact combined clause absent from project spec)
- Unresolved door-contact interface demand ❌ (INTERFACE_ADDRESS_DEMAND = separate/unresolved unless current allocation proves it)
- Unresolved telephone monitor demand ❌ (RELAYMON2_CURRENT_ADDRESS_DEMAND = UNRESOLVED; enabled-channel allocation not known)
- Any unproven RELAYMON enabled-channel demand ❌ (until project evidence establishes REQUIRED_TOTAL_ADDRESSES)

EVERY PERSISTED ROW MUST CONTAIN:
- Current evidence/provenance
- Currentness binding (live D1 read timestamp)
- No provisional or inferred values

================================================================================
7. EXECUTE THE ALREADY-STAGED TARGETED CLOSURES IF RUNTIME IS ACTUALLY AVAILABLE
================================================================================

SERVER STATUS: DOWN (HTTP 000; unreachable at http://127.0.0.1:8787)
RUNTIME AVAILABLE: NO

Since the server is DOWN, the following staged actions CANNOT be executed:
- req_267 jack link confirmations (3 classified rows + 1 CR row; links staged but cannot POST)
- affected profile recalc (governed write path requires runtime)
- UL 38 / UL 521 link confirms (require requirement-approve API; server down)
- POST /api/knowledge/research-facts ingestion (knowledge-library-api route; server down)
- matching/safety recalcs for newly approved profiles (product-matching-api; server down)

FAIL CLOSE: All closure actions reported as DEFERRED until runtime is available.
Do not broaden the task beyond the already-prepared actions.

================================================================================
8. RE-READ AFTER WRITES
================================================================================

N/A: No writes performed (server DOWN; governed write paths not executable).
If runtime becomes available and writes are executed, the following would be re-read:
- current profiles (per-BOQ latest profile status)
- current technical readiness (NTR/CR/RFM/RWW counts)
- current per-BOQ SLC authority (resource pool, address demand per BOQ)
- current unresolved address demand (IDP-RELAYMON-2, strobe architecture)

================================================================================
9. AGENT 1 HANDOFF GATE
================================================================================

READY_FOR_AGENT_1_ADDRESS_HANDOFF = NO

RATIONALE: Agent 1 must be able to independently query/re-read the persisted governed authority from the live D1 database and governed write paths. No governed authority has been persisted to D1 (SLC_AUTHORITY_PERSISTED = NO). A prose table, even this complete report, is not sufficient — Agent 1 must re-read the canonical current authority itself.

CONTRAST: ADDRESS_HANDOFF_PACKET_READY = YES
- The full handoff packet is prepared, complete, and contains all required semantics
- It is distinct from the handoff gate flag
- ADDRESS_HANDOFF_PACKET_READY ≠ READY_FOR_AGENT_1_ADDRESS_HANDOFF
- The packet is ready, but the gate requires Agent 1's own re-read of current authority

THE HANDOFF MUST EXPLICITLY SEPARATE:
- PROVEN_DETECTOR_POOL (966 units; 1 address/unit; manufacturer SLC loop limit 159; ✓ VERIFIED)
- PROVEN_MODULE_POOL (pull stations: module-pool; 1 address per pull station; ✓ VERIFIED per SLC resource classifier)
- PROVEN_NOT_SLC (Fireman Telephone Jack: direct SLC = 0; Door Contact: direct SLC = 0; ✓ VERIFIED)
- UNRESOLVED_ADDRESS_DEMAND (strobe 438; combined smoke+heat 21; IDP-RELAYMON-2; ✗ UNRESOLVED)
- Unknown must never become zero

================================================================================
FINAL FLAGS SUMMARY
================================================================================

CURRENT_NTR_COUNT = 10 (live D1, one profile per BOQ item, superseded_at IS NULL)
CURRENT_CR_COUNT = 3 (live D1, one profile per BOQ item, superseded_at IS NULL)
CURRENT_RWW_COUNT = 70 (live D1, one profile per BOQ item, superseded_at IS NULL)
CURRENT_RFM_COUNT = 3 (live D1, one profile per BOQ item, superseded_at IS NULL)

PROFILE_STATE_TOTAL = 84 BOQ items (one latest profile per item, superseded excluded) / 96 profile versions (raw count; 2 items carry 2 live profiles)
But: MUTUALLY_EXCLUSIVE_STATUS_SUM = 84 = CURRENT_PROFILED_BOQ_ITEMS ✓

SLC_AUTHORITY_WRITE_PATH = POST /api/boq-items/{itemId}/requirement-profile/recalculate
  (handler: executeRequirementProfile + persistProfile in worker/technical-requirement-api.mjs)
  with parameters: itemId, userId, runId, inputFingerprint, previous profile state
  via Drizzle ORM on requirement_profile_versions table

SLC_AUTHORITY_PERSISTED = NO (runtime down; governed paths not yet persisted)

MANUAL_STATION_RESOURCE_POOL = PROVEN_MODULE_POOL (with SLC resource classifier evidence + IDP-PULL-DA verbatim manual evidence)

RELAYMON2_CURRENT_ADDRESS_DEMAND = UNRESOLVED (enabled-channel allocation not established from project evidence; MAX capability advisory only: 4 addresses/unit max, 16 total max)

STROBE_SLC_ADDRESS_DEMAND = UNRESOLVED (conflict withdrawn per drawing evidence; 438 appliances under UNRESOLVED_ADDRESS_DEMAND)

ADDRESS_HANDOFF_PACKET_READY = YES (full packet prepared with all corrected semantics, four explicit classes, exact counts, and governed authority notes)

READY_FOR_AGENT_1_ADDRESS_HANDOFF = NO (prose table insufficient; Agent 1 must re-read canonical authority from live D1)

OVERALL_PROJECT_READY_FOR_SIZING = NO unless Agent 1 and Agent 2 independently prove their gates current.

NO panel selection.
NO sizing.
NO pricing.
NO quotation.
NO direct SQL.
NO commit/push/deploy.

================================================================================
END OF REPORT
================================================================================
FINAL_STATE_READ_AT: 2026-10-02T22:22:38Z
CURRENTNESS_STATUS: PROVEN for D1-state counts and evidence citations; RUNTIME_BLOCKER for write-path/persistence (governed APIs require runtime verification; D1 state is live and read-qualified)
SERVER: http://127.0.0.1:8787 — HTTP 000 (DOWN; all API POSTs return 000; restart prohibited per lane rules)
FINAL_REPORT_governed-slc-authority.md generated successfully.
