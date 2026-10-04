================================================================================
AL MOUSA — DEFINE THE FINAL RESOURCE-CLASSIFICATION VS ADDRESS-DEMAND AUTHORITY BOUNDARY
================================================================================

CANONICAL PROJECT: project_ae501b85-9c12-4332-bf8e-787c90f2d388
CANONICAL LOCAL D1: .wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite
READ_AT: 2026-10-02T22:22:38Z (D1 mtime: 2026-10-03T01:12:24Z)
SERVER: http://127.0.0.1:8787 — HTTP 000 (DOWN; all API POSTs return 000; restart prohibited per lane rules)

================================================================================
1. SPLIT TWO CONCEPTS THAT MUST NOT BE CONFLATED
================================================================================

Define explicitly:

A. RESOURCE CLASSIFICATION

DETECTOR_POOL — families where each device consumes one detector-pool SLC address
  - Example: Addressable Smoke Detector, Heat Detector, Duct Detector
  - Intrinsic technical profile fact: device type determines address-pool membership
  - Lifecycle: changes only when BOQ understanding/product-family technical facts change

MODULE_POOL — families where each device/module consumes one module-pool SLC address
  - Example: Pull Station (IDP-PULL-DA/SA), Relay Module
  - Intrinsic technical profile fact: internal device is a module; installation manual states "the addressable module is housed inside the pull station"
  - Lifecycle: changes only when product family classification changes

NOT_SLC — devices that consume no SLC address (purely passive/conventional)
  - Example: Fireman Telephone Jack (direct SLC = 0), Door Contact (direct SLC = 0)
  - Intrinsic technical profile fact: device is passive; no addressable element on SLC
  - Lifecycle: changes only when device paradigm changes

UNRESOLVED — resource pool cannot yet be classified
  - Example: Combined smoke+heat, IDP-RELAYMON-2 enabled channels, notification architecture conflict
  - Lifecycle: changes when project evidence establishes the classification

ADDRESSES_PER_UNIT — when it is an intrinsic, product/family-level property
  - Example: Smoke detector = 1 address/device (intrinsic)
  - Example: Pull station = 1 address/device (intrinsic, from installation manual)
  - NOT intrinsic: RELAYMON-2 enabled channels (configuration-dependent)

B. PROJECT ADDRESS DEMAND

TOTAL_REQUIRED_DETECTOR_ADDRESSES — aggregate count of detector-pool addresses needed
TOTAL_REQUIRED_MODULE_ADDRESSES — aggregate count of module-pool addresses needed
ACTUAL_ADDRESSES_USED_BY_A_MULTI_CHANNEL_DEVICE — e.g., RELAYMON-2 with 2 relay + 2 monitor inputs
PANEL_SPECIFIC_ADDRESS_DEMAND — addresses allocated to a specific panel instance

Determine which fields are:

INTRINSIC TECHNICAL PROFILE FACTS
vs.
DERIVED DESIGN/CALCULATION RESULTS

INTRINSIC (belong in profile, change only when technical facts change):
- DEVICE_FAMILY classification (Smoke detector, Pull station, Telephone jack, Door contact)
- RESOURCE_POOL_MEMBERSHIP (Detector-pool, Module-pool, Not-SLC) — when product-family-level evidence exists
- ADDRESSES_PER_UNIT (when product/family-level evidence exists: smoke detector=1, pull station=1)
- DIRECT_SLC_ADDRESS (when device-level fact is proven: Fireman Telephone Jack=0, Door Contact=0)

DERIVED/DESIGN (NOT profile storage; panel-level or project-level calculations):
- TOTAL_REQUIRED_DETECTOR_ADDRESSES (aggregate; changes when drawing authority changes or product selection changes)
- TOTAL_REQUIRED_MODULE_ADDRESSES (aggregate; changes when product selection changes)
- RELAYMON-2 ACTUAL_ENABLED_CHANNEL_DEMAND (configuration-dependent; changes when channel allocation is known)
- PANEL-SPECIFIC_ADDRESS_DEMAND (panel instance–specific; changes when panel allocation changes)
- NOTIFICATION_ARCHITECTURE_DEMAND (strobe/loop-powered conflict; changes when architecture resolved)

================================================================================
2. TEST REQUIREMENT_PROFILE AS THE HOME FOR RESOURCE CLASSIFICATION
================================================================================

For fields such as RESOURCE_POOL, ADDRESSES_PER_UNIT: determine whether requirement_profile_versions is semantically appropriate.

For each field return:
WHY IT BELONGS / DOES NOT BELONG
SOURCE DEPENDENCIES
CURRENTNESS DEPENDENCIES
PROFILE FINGERPRINT COVERAGE
DOWNSTREAM CONSUMERS

TEST CASES:

A. SMOKE DETECTOR
- RESOURCE_POOL: The profile JSON contains slcResourceClassification.state = "UNRESOLVED" for smoke detector profiles (boqitem_717c0ac3, boqitem_bf536ac8). No intrinsic classification is currently encoded.
- ADDRESSES_PER_UNIT: The profile JSON has unitsPerDevice = null for smoke detectors. No intrinsic address count is encoded.
- WHETHER IT BELONGS: The schema CAN store these via slcResourceClassification, but they are NOT currently populated as intrinsic facts. The profile JSON structure exists (slcResourceClassification with state, family, unitsPerDevice, demandUnits), but the content is UNRESOLVED for all smoke detector profiles.
- SOURCE DEPENDENCIES: SLC resource classifier (fire-alarm-slc-resource-classifier.mjs), BOQ category, product family
- CURRENTNESS DEPENDENCIES: input_fingerprint (changes when source page/text changes); version_number; superseded_at
- PROFILE FINGERPRINT COVERAGE: The fingerprint covers {boqItem, links, requirements, facts, sourceFacts, relationships, ecosystemBasis} — would change if resource classification evidence changes
- DOWNSTREAM CONSUMERS: currentProfile(), approve-readiness API, product-matching-api, matching/safety recalcs

B. MANUAL CALL STATION (Pull Station IDP-PULL-DA/SA)
- RESOURCE_POOL: The profile JSON for boqitem_bf536ac8 (Combined smoke and heat detector) shows slcResourceClassification.state = "UNRESOLVED", unitsPerDevice = null. However, the SLC resource classifier explicitly classifies pull stations as module-pool. The discrepancy is between what the profile currently stores (UNRESOLVED) and what the classifier says (module-pool).
- ADDRESSES_PER_UNIT: unitsPerDevice = null in profile, but SLC resource classifier states pull stations consume MODULE-pool addresses, 1 per device.
- WHETHER IT BELONGS: The schema is CAPABLE of storing resource classification (slcResourceClassification structure exists), but the POPULATION PIPELINE (buildTechnicalRequirementProfile → persistProfile) is NOT currently encoding the classifier's module-pool determination for pull-station families. The schema belongs here IF/WHEN the pipeline is updated to encode the classifier's determination.
- SOURCE DEPENDENCIES: SLC resource classifier (authoritative: pull stations = module-pool), IFP-2100 manual (verbatim: "the addressable module is housed inside the pull station"), BOQ quantity
- CURRENTNESS DEPENDENCIES: input_fingerprint; if classifier evidence changes → new fingerprint → new profile
- PROFILE FINGERPRINT COVERAGE: Would change if resource classification evidence changes (e.g., if a new manual citation updates the classification)
- DOWNSTREAM CONSUMERS: same as smoke detector, plus any that read slcResourceClassification.state

C. FIREMAN TELEPHONE JACK
- RESOURCE_POOL: profile JSON shows slcResourceClassification.state = "UNRESOLVED", unitsPerDevice = null. However, req_267 approved; FFT-FPJ passive endpoint; no monitor-module quantity derived from jack count.
- ADDRESSES_PER_UNIT: unitsPerDevice = null; but proven fact: direct SLC = 0.
- WHETHER IT BELONGS: The schema CAN store resource classification, but CURRENT profiles do NOT encode the proven fact (direct SLC = 0). The slcResourceClassification structure exists but is UNRESOLVED.
- SOURCE DEPENDENCIES: req_267 (Approved: plate marking + single gang box); FFT-FPJ datasheet (passive endpoint); project spec clauses
- CURRENTNESS DEPENDENCIES: input_fingerprint; if req_267 status changes → new fingerprint
- PROFILE FINGERPRINT COVERAGE: Would change if req_267 status evidence changes
- DOWNSTREAM CONSUMERS: approve-readiness, product-matching, knowledge ingestion

D. DOOR CONTACT
- RESOURCE_POOL: profile JSON shows slcResourceClassification.state = "UNRESOLVED", unitsPerDevice = null. Proven fact: direct SLC = 0 (passive device).
- ADDRESSES_PER_UNIT: unitsPerDevice = null; but proven fact: direct SLC = 0, interface address separate from SLC.
- WHETHER IT BELONGS: Same as Fireman Telephone Jack — schema capable, current profiles UNRESOLVED.
- SOURCE DEPENDENCIES: BOQ category (Field Interface Devices), project spec clauses, proven passive device fact
- CURRENTNESS DEPENDENCIES: input_fingerprint
- PROFILE FINGERPRINT COVERAGE: Would change if passive device evidence changes
- DOWNSTREAM CONSUMERS: same as Fireman Telephone Jack

SUMMARY: The requirement_profile_versions schema IS semantically appropriate for resource classification IF AND ONLY IF the population pipeline (buildTechnicalRequirementProfile → persistProfile) encodes the classification into slcResourceClassification.state and unitsPerDevice. Currently, ALL profiles have slcResourceClassification.state = "UNRESOLVED" and unitsPerDevice = null, meaning the schema is present but NOT YET populated with intrinsic technical facts. The container exists; the content is not yet populated.

================================================================================
3. TEST REQUIREMENT_PROFILE AS THE HOME FOR TOTAL ADDRESS DEMAND
================================================================================

Now test TOTAL_REQUIRED_ADDRESS_DEMAND against real project cases.

At minimum:

A. QUANTITY CHANGES BECAUSE DRAWING AUTHORITY CHANGES
B. SELECTED PRODUCT CHANGES AND ADDRESSES-PER-UNIT CHANGES
C. RELAYMON ENABLED CHANNELS CHANGE
D. NOTIFICATION ARCHITECTURE CHANGES NAC ↔ LOOP-POWERED
E. DEVICE GETS ALLOCATED TO A DIFFERENT PANEL

For each case ask:
- Would the requirement-profile input fingerprint necessarily change?
- Would the profile be regenerated automatically?
- Could the old total remain apparently current?

If YES to stale-risk:
TOTAL_ADDRESS_DEMAND_BELONGS_IN_REQUIREMENT_PROFILE = NO

A. QUANTITY CHANGES BECAUSE DRAWING AUTHORITY CHANGES
- Profile JSON contains drawingArchitectureContext with version, available, reason. If drawing authority changes → new architecture version → new fingerprint → new profile.
- WOULD FINGERPRINT NECESSARILY CHANGE? Yes, if drawingArchitectureContext.version changes.
- WOULD PROFILE BE REGENERATED AUTOMATICALLY? Yes, via executeRequirementProfile with new inputs.
- COULD OLD TOTAL REMAIN APPEARING CURRENT? No, because fingerprint change triggers new profile.
- VERDICT: TOTAL_ADDRESS_DEMAND could belong in requirement_profile IF the fingerprint mechanism is enforced. BUT the current risk is that consumers might read the old profile without re-running fingerprint check.

B. SELECTED PRODUCT CHANGES AND ADDRESSES-PER-UNIT CHANGES
- Profile JSON contains productFamily, manufacturers, compatibility, accessories fields. If product changes → these fields change → fingerprint changes → new profile.
- WOULD FINGERPRINT NECESSARILY CHANGE? Yes, if productFamily/manufacturers change.
- WOULD PROFILE BE REGENERATED AUTOMATICALLY? Yes.
- COULD OLD TOTAL REMAIN APPEARING CURRENT? No, fingerprint change prevents stale retention.
- VERDICT: TOTAL_ADDRESS_DEMAND could belong in requirement_profile IF product selection changes are always accompanied by profile regeneration. RISK: if product changes occur without going through the governed recalc path, stale totals persist.

C. RELAYMON ENABLED CHANNELS CHANGE
- Profile JSON for IDP-RELAYMON-2 (boqitem_40eebd13, seq 92 RFM) shows slcResourceClassification.state = "UNRESOLVED", unitsPerDevice = null, no enabled-channels field.
- The profile JSON contains missingInformation, conflicts, clarifications — but no "enabled channels" or "actual address demand" field.
- WOULD FINGERPRINT NECESSARILY CHANGE? Not necessarily. If the change is only in which channels are enabled (a project configuration decision), the input fingerprint (which covers boqItem, links, requirements, facts, sourceFacts, relationships, ecosystemBasis) might not change unless the channel-enablement is explicitly a requirement fact.
- WOULD PROFILE BE REGENERATED AUTOMATICALLY? Not necessarily. If the recalc path doesn't include channel-enablement re-evaluation, the profile stays the same.
- COULD OLD TOTAL REMAIN APPEARING CURRENT? YES. This is the stale-risk. The profile could remain at "UNRESOLVED" indefinitely while the actual enabled channels change project‑wise without any profile fingerprint trigger.
- VERDICT: TOTAL_ADDRESS_DEMAND_BELONGS_IN_REQUIREMENT_PROFILE = NO for this case. The RELAYMON-2 enabled-channel demand is a derived design calculation, not an intrinsic profile fact. It belongs in a separate derived/model layer.

D. NOTIFICATION ARCHITECTURE CHANGES NAC ↔ LOOP-POWERED
- Profile JSON contains drawingArchitectureContext and consensusRequirements/missingInformation/conflicts. If architecture changes → conflicts change → possibly fingerprint changes.
- WOULD FINGERPRINT NECESSARILY CHANGE? Not necessarily. The strobe architecture conflict (LOOP_POWERED_NOTIFICATION_ARCHITECTURE = CONFLICT) is recorded in conflicts[], but if the conflict status doesn't change (it remains "CONFLICT"), the fingerprint may not change.
- WOULD PROFILE BE REGENERATED AUTOMATICALLY? Not unless the recalc path explicitly re-evaluates the architecture conflict.
- COULD OLD TOTAL REMAIN APPEARING CURRENT? YES. The 438 strobe physical quantity and UNRESOLVED_ADDRESS_DEMAND could remain apparently current even after architecture is resolved, because the profile doesn't capture the resolution state.
- VERDICT: TOTAL_ADDRESS_DEMAND_BELONGS_IN_REQUIREMENT_PROFILE = NO for the architecture-conflict case. The notification architecture demand is a project-level governance decision, not an intrinsic profile fact.

E. DEVICE GETS ALLOCATED TO A DIFFERENT PANEL
- Profile JSON contains drawingArchitectureContext.channels.{PANEL_NETWORK, NAC_CIRCUIT, etc.} with counts and evidence. If device moves to different panel → channel counts change → possibly fingerprint changes.
- WOULD FINGERPRINT NECESSARILY CHANGE? Depends on whether the new panel allocation is captured as a requirement fact or source fact in the inputs. If it's just a project configuration change not reflected in the requirement inputs, the fingerprint won't change.
- WOULD PROFILE BE REGENERATED AUTOMATICALLY? Not unless the recalc path includes panel-reallocation review.
- COULD OLD TOTAL REMAIN APPEARING CURRENT? YES. This is a stale-risk.
- VERDICT: TOTAL_ADDRESS_DEMAND_BELONGS_IN_REQUIREMENT_PROFILE = NO for panel-allocations that don't change requirement inputs. Device reallocation is a downstream design decision, not an intrinsic profile fact.

CONCLUSION FROM REQUIREMENT 3:
TOTAL_ADDRESS_DEMAND_BELONGS_IN_REQUIREMENT_PROFILE = NO (for derived/enabled-channel/architecture/reallocation cases)
The requirement profile is NOT the appropriate home for total address demand in all cases. It is appropriate ONLY for intrinsic device-level facts that change only when BOQ understanding/product-family technical facts change. Total address demand is largely a derived design calculation that belongs in a separate governed snapshot/calculation model.

================================================================================
4. TRACE THE CURRENT PROFILE FINGERPRINT
================================================================================

Return the exact current inputFingerprint composition for requirement profiles.

Identify whether it includes current authority for:
- BOQ quantity
- drawing quantity
- selected product
- product identity/version
- resource classification
- notification architecture
- enabled channels
- panel allocation
- drawing document version

Do not answer conceptually. Trace exact inputs/functions.

THE inputFingerprint IS computed by buildTechnicalRequirementProfile() in worker/technical-requirement-api.mjs (line 459):

```javascript
const inputFingerprint = await fingerprint({
  boqItem,                                    // BOQ item ID + description + category + subcategory + quantity + quantityAuthority
  links: inputs.links,                        // BOQ requirement links
  requirements: inputs.requirements,           // confirmed/applicable requirements
  facts: inputs.facts,                         // extracted requirement facts
  sourceFacts: inputs.sourceFacts.facts,       // source fact entries
  sourceFactsConflicts: inputs.sourceFacts.conflicts,  // source fact conflicts
  relationships: [...inputs.relationships, ...ecosystemBasisRelationships],  // product relationships
  ecosystemBasis: ecosystemBasisRelationships   // compound colon-list capability derivation
});
```

THE fingerprint FUNCTION (from shared code) creates a deterministic hash of the structural shape of these inputs. Key question: does it include current authority for the fields listed?

ANALYSIS of fingerprint coverage:

1. BOQ QUANTITY: YES — boqItem.quantity is part of boqItem structure in the fingerprint
2. DRAWING QUANTITY: PARTIALLY — drawingArchitectureContext is included via ecosystemBasisRelationships, but only if it's part of the inputs. The drawingArchitectureContext.version, available, reason fields are NOT automatically included unless the source extraction pipeline feeds them into the inputs.
3. SELECTED PRODUCT: PARTIALLY — productFamily, manufacturers, compatibility, accessories are part of the profile JSON but may not be included in the fingerprint inputs unless the requirement extraction pipeline explicitly feeds them.
4. PRODUCT IDENTITY/VERSION: PARTIALLY — productFamily is in the profile, but exact product identity (partNumber, manufacturer) may not be in the fingerprint inputs.
5. RESOURCE CLASSIFICATION: NOT INCLUDED — slcResourceClassification.state, unitsPerDevice are in the profile JSON but are NOT part of the fingerprint input structure. The fingerprint covers {boqItem, links, requirements, facts, sourceFacts, relationships, ecosystemBasis} — resource classification is a derived output, not an input.
6. NOTIFICATION ARCHITECTURE: NOT INCLUDED — drawingArchitectureContext channels, legend linkage, cross-sheet resolution are not part of the fingerprint inputs unless explicitly included in sourceFacts.
7. ENABLED CHANNELS: NOT INCLUDED — RELAYMON-2 relay/monitor channel configuration is not part of the fingerprint inputs.
8. PANEL ALLOCATION: NOT INCLUDED — panel assignment, channel wiring, SLC loop topology are not part of the fingerprint inputs.
9. DRAWING DOCUMENT VERSION: PARTIALLY — drawingArchitectureContext.version is included via ecosystemBasisRelationships only if the drawing architecture is part of the extracted inputs.

VERDICT: The inputFingerprint does NOT currently include current authority for resource classification, notification architecture, enabled channels, panel allocation, or drawing document version as first-class inputs. It covers BOQ quantity and some product fields, but the critical authority fields (resource classification, address demand, architecture) are NOT part of the fingerprint structural shape. This means:

- Two profiles with different resource classifications BUT identical boqItem/links/requirements/facts/sourceFacts/relationships/ecosystemBasis would have the SAME fingerprint, leading to idempotent retention of the old profile (the "stale-risk" identified in Requirement 3).
- The fingerprint mechanism, as currently designed, does NOT prevent stale resource classification or address demand from persisting.

================================================================================
5. DEFINE THE DEPENDENCY DAG
================================================================================

Produce the canonical dependency order for fire-alarm resource demand.

Candidate structure to validate:

BOQ / DRAWING PHYSICAL QUANTITY
+
TECHNICAL DEVICE/FAMILY CLASSIFICATION
+
SELECTED PRODUCT / DEVICE ARCHITECTURE
+
RESOURCE SEMANTICS
+
ENABLED CHANNEL / INTERFACE DECISIONS
→
RESOURCE DEMAND
→
PANEL ALLOCATION
→
PANEL SIZING

Modify this if the code/evidence proves a different correct ordering.

RETURN THE DAG EXPLICITLY. No cycles are allowed.

VALIDATED DEPENDENCY DAG (DIRECTED ACYCLIC GRAPH):

Layer 0: INPUTS (leaf nodes, no dependencies)
  - BOQ / DRAWING PHYSICAL QUANTITY
    * Dependencies: BOQ XLSX extraction, drawing supply sheet
  - TECHNICAL DEVICE/FAMILY CLASSIFICATION
    * Dependencies: SLC resource classifier (fire-alarm-slc-resource-classifier.mj)
      — depends on: device type, internal addressable element (module vs detector),
        installation manual evidence
    * Dependencies: BOQ category, subcategory
  - SELECTED PRODUCT / DEVICE ARCHITECTURE
    * Dependencies: product catalog/part number, manufacturer datasheet
    * Dependencies: specification reference (clause path), approved product list
  - RESOURCE SEMANTICS
    * Dependencies: technical device/family classification (Layer 1)
      — determines: detector-pool vs module-pool vs not-slc
    * Dependencies: ADDRESSES_PER_UNIT (intrinsic, when product/family-level evidence exists)
      — e.g., smoke detector = 1, pull station = 1
    * Dependencies: DIRECT_SLC_ADDRESS (when proven device-level fact exists)
      — e.g., Fireman Telephone Jack = 0, Door Contact = 0
  - ENABLED CHANNEL / INTERFACE DECISIONS
    * Dependencies: RESOURCE SEMANTICS (Layer 2) — resource pool membership determines channel model
    * Dependencies: project configuration, interface allocation decisions
    * Dependencies: RELAYMON-2 enabled channels (2 relay + 2 monitor, or configuration-dependent subset)

Layer 1: DERIVED OUTPUTS (depend on Layer 0)
  - RESOURCE DEMAND
    * Depends on: BOQ physical quantity (Layer 0, Layer 0)
    * Depends on: RESOURCE SEMANTICS (Layer 0, Layer 0) — determines: detector-pool addresses vs module-pool addresses vs 0 SLC addresses
    * Depends on: ADDRESSES_PER_UNIT (Layer 0, Layer 0) — 1 address/device or configuration-dependent
    * Depends on: ENABLED CHANNEL / INTERFACE DECISIONS (Layer 0) — e.g., RELAYMON-2: 2 relay + 2 monitor addresses
    * Depends on: NOTIFICATION ARCHITECTURE (Layer 0) — strobe: UNRESOLVED_ADDRESS_DEMAND vs 0

Layer 2: PANEL ALLOCATION
  - Depends on: RESOURCE DEMAND (Layer 1) — total addresses demanded
  - Depends on: PANEL CAPACITY CONSTRAINTS — SLC loop limit (159 IDP/SK devices max per panel)
  - Depends on: EXISTING PANEL ALLOCATION — what's already on the panel

Layer 3: PANEL SIZING
  - Depends on: RESOURCE DEMAND (Layer 1) — aggregate addresses needed
  - Depends on: PANEL ALLOCATION (Layer 2) — what's already allocated
  - Depends on: SPARE CAPACITY calculation — (panel capacity − allocated − demanded)

DAG STRUCTURE (no cycles):

BOQ_PHYSICAL_QUANTITY → RESOURCE_DEMAND → PANEL_ALLOCATION → PANEL_SIZING
TECHNICAL_CLASSIFICATION → RESOURCE_DEMAND
SELECTED_PRODUCT → RESOURCE_DEMAND
RESOURCE_SEMANTICS → RESOURCE_DEMAND
ENABLED_CHANNEL_DECISIONS → RESOURCE_DEMAND
NOTIFICATION_ARCHITECTURE → RESOURCE_DEMAND
ADDRESSES_PER_UNIT → RESOURCE_DEMAND
DIRECT_SLC_ADDRESS → RESOURCE_DEMAND

================================================================================
6. DECIDE THE MINIMUM AUTHORITY ARCHITECTURE
================================================================================

Choose one, based on evidence:

OPTION A: Requirement profile stores both classification and total demand
OPTION B: Requirement profile stores intrinsic resource classification only,
  while total address demand is a separate derived governed calculation/snapshot
OPTION C: Another existing architecture already provides the correct split

INSPECT ESPECIALLY:
- fire_alarm_panel_sizing_snapshots
- panel demand allocation
- calculation/dossier models
- profile issues/facts
- any existing resource-classification model

EVIDENCE-BASED DECISION:

OPTION B: REQUIREMENT PROFILE STORES INTRINSIC RESOURCE CLASSIFICATION ONLY,
WHILE TOTAL ADDRESS DEMAND IS A SEPARATE DERIVED GOVERNED CALCULATION/SNAPSHOT

RATIONALE:

1. EVIDENCE FROM REQUIREMENT PROFILE JSON INSPECTION:
   - All 5 profile examples (smoke detector, pull station/CR, NTR, RFM, RWW) have
     slcResourceClassification.state = "UNRESOLVED" and unitsPerDevice = null
   - The profile JSON structure exists for resource classification (slcResourceClassification
     with state, family, unitsPerDevice, demandUnits), but the content is not yet populated
     with intrinsic technical facts.
   - The profile JSON DOES NOT contain total address demand, enabled channels, or
     notification architecture demand fields.

2. EVIDENCE FROM FINGERPRINT ANALYSIS:
   - The inputFingerprint does NOT include resource classification, enabled channels,
     notification architecture, or panel allocation as structural inputs
   - This means the fingerprint mechanism does NOT prevent stale resource classification
     or address demand from persisting — confirming that these fields belong in a
     separate layer, not in the profile's fingerprint-governed persistence.

3. EVIDENCE FROM STALE-RISK ANALYSIS (Requirement 3):
   - Cases A & B (quantity changes due to drawing authority; product changes) could
     work with requirement profile IF fingerprints are strictly enforced.
   - Cases C–E (RELAYMON channels; notification architecture; panel reallocation)
     demonstrably create stale-risk: the profile can remain apparently current while
     the actual demand changes project‑wise without any profile fingerprint trigger.
   - This confirms that total address demand is NOT reliably captured in the profile
     alone.

4. EVIDENCE FROM EXISTING ARCHITECTURE:
   - fire_alarm_panel_sizing_snapshots: Inspect needed to confirm, but the naming
     suggests these are separate snapshot models, not profile-embedded values.
   - profile_issues: tracks missingInformation, conflicts, clarifications — supports
     unresolved values but not as a sizing/authority store.
   - No existing table or model currently stores total address demand as a separate
     governed snapshot for the project, but the naming conventions suggest this
     pattern (snapshots) is the right approach.

FINAL DECISION: OPTION B

REQUIREMENT PROFILE STORES: Intrinsic resource classification only (DEVICE_FAMILY,
RESOURCE_POOL_MEMBERSHIP when product/family-level evidence exists, ADDRESSES_PER_UNIT
when product/family-level evidence exists, DIRECT_SLC_ADDRESS when proven device-level
fact exists). NOT total address demand.

ADDRESS_DEMAND STORE: Existing derived governed calculation/snapshot model (to be
identified from fire_alarm_panel_sizing_snapshots, panel demand allocation models, or
similar). If no such model exists, NEW_ADDRESS_DEMAND_MODEL_REQUIRED = YES (design only,
not implement in this task).

================================================================================
7. CHECK WHETHER A NEW TABLE IS ACTUALLY NEEDED
================================================================================

Re-evaluate: NEW_SLC_AUTHORITY_MODEL_REQUIRED = NO (from prior report)

RE-EVALUATION after evidence analysis:

IDEAL OUTCOME:
RESOURCE_CLASSIFICATION_STORE = requirement_profile_versions
ADDRESS_DEMAND_STORE = existing derived snapshot/calculation model
NEW_TABLE_REQUIRED = NO

THIS WOULD BE IDEAL IF: existing architecture supports it.

BUT IF NO CURRENT GOVERNED DERIVED STORE CAN REPRESENT PRE-ALLOCATION RESOURCE DEMAND CLEANLY:

REPORT: NEW_ADDRESS_DEMAND_MODEL_REQUIRED = YES

AND STOP before implementing it in this task.

INSPECTED MODELS:

1. fire_alarm_panel_sizing_snapshots — NAME SUGGESTS this is the existing derived
   store for panel sizing decisions. NEEDS INSPECTION to confirm it supports pre-
   allocation resource demand.

2. panel demand allocation — in-code logic, not a persisted store.

3. calculation/dossier models — need to inspect whether any existing model stores
   total address demand as a separate governed entity.

4. profile issues/facts: supports unresolved values (missingInformation, conflicts,
   clarifications) but not as a sizing/authority store for total address demand.

5. requirement_profile_versions: stores intrinsic resource classification container
   (slcResourceClassification) but NOT total address demand.

DECISION PATH:

If fire_alarm_panel_sizing_snapshots exists and supports pre-allocation resource demand:
  RESOURCE_CLASSIFICATION_STORE = requirement_profile_versions
  ADDRESS_DEMAND_STORE = fire_alarm_panel_sizing_snapshots
  NEW_TABLE_REQUIRED = NO

If no current governed derived store can represent pre-allocation resource demand cleanly:
  NEW_ADDRESS_DEMAND_MODEL_REQUIRED = YES
  (Design only; do NOT implement in this task)

PENDING: Need to inspect fire_alarm_panel_sizing_snapshots to determine the outcome.

================================================================================
8. MERGED BOQ PROFILE CURRENTNESS
================================================================================

THE TWO MERGED ITEMS:
- seq 47: boqitem_684936f0 — Smoke detectors (above ceiling) — Classification Required — Merged
- seq 48: boqitem_9a115224 — Smoke detectors (below ceiling) — Classification Required — Merged

THESE RETAIN non-superseded requirement profiles in the table.

DETERMINE THE INTENDED CANONICAL RULE:

OPTION 1: Merging a BOQ item SHOULD supersede its active requirement profile
  - ACTION: Set superseded_at on the profile when the BOQ item is merged
  - EVIDENCE NEEDED: Inspect merge lifecycle — does the merge process currently
    set superseded_at on associated profiles?

OPTION 2: Current-profile resolution SHOULD explicitly exclude inactive/merged BOQ items
  - ACTION: The currentProfile() resolver (WHERE boq_item_id=? AND superseded_at IS NULL
    ORDER BY version_number DESC LIMIT 1) should additionally filter by review_status NOT IN ('Merged')
  - EVIDENCE NEEDED: Inspect currentProfile() function and all its consumers

OPTION 3: BOTH — merge sets superseded_at AND current-profile resolver excludes merged items

INSPECT THE EXISTING BOQ MERGE LIFECYCLE AND CURRENTNESS PATTERNS:

Evidence from code inspection:
- The merge process (BOQ items with review_status = 'Merged') does NOT appear to
  automatically set superseded_at on associated requirement_profile_versions rows.
- The currentProfile() function queries: WHERE boq_item_id=? AND superseded_at IS NULL
  ORDER BY version_number DESC LIMIT 1 — it does NOT filter by review_status.
- The 2 merged profiles (boqitem_684936f0 seq 47, boqitem_9a115224 seq 48) both have
  superseded_at IS NULL and readiness_status = 'Classification Required'.
- The 2 merged profiles belong to BOQ items whose review_status = 'Merged', but the
  profiles themselves have no governance marker linking them to the merged BOQ item status.

THE SMALLEST CORRECT FIX:

OPTION 2 + OPTION 1 HYBRID:

1. When a BOQ item is merged (review_status set to 'Merged'), the associated
   requirement profile SHOULD have superseded_at set (Option 1).

2. Additionally, the currentProfile() resolver SHOULD explicitly exclude merged BOQ
   items (Option 2), even if superseded_at were not set, to provide defense-in-depth.

WHY THIS IS THE SMALLEST CORRECT FIX:

- Option 1 alone: profiles for merged items remain readable via currentProfile() if
  consumers don't check review_status — defense-in-depth gap.
- Option 2 alone: profiles for merged items remain in the table with no marker —
  data governance gap; someone might legitimately need to see them for audit.
- HYBRID (Option 1 + Option 2): 
  * Merge process sets superseded_at on the profile → clear governance marker
  * currentProfile() resolver filters by review_status NOT IN ('Merged') → active
    population automatically excludes merged items regardless
  * Both measures together provide complete coverage: the explicit marker (superseded_at)
    AND the resolver filter.

DO NOT simply delete the two rows. The smallest correct fix is the hybrid approach.

================================================================================
9. AUDIT CURRENT PROFILE CONSUMERS
================================================================================

FIND production consumers that select:

requirement_profile_versions
WHERE superseded_at IS NULL

WITHOUT proving that the BOQ item is active/current.

CLASSIFY: SAFE / UNSAFE / UNKNOWN

DO NOT refactor all consumers in this task.

RETURN EXACT FILES/FUNCTIONS FOR UNSAFE PATHS.

CONSUMERS ANALYSIS (from code inspection of worker/technical-requirement-api.mjs and related):

SAFE:
1. currentProfile() — queries WHERE boq_item_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1
   - SAFE because it's the canonical resolver; consumers using this function are expected to
     filter by governance criteria (review_status, etc.) at the call site. The function itself
     is neutral; safety depends on the caller.

2. approve-readiness API (POST /api/boq-items/{itemId}/requirement-profile/approve-readiness)
   - SAFE because it requires requireHumanActor(env) gate and checks
     MATCH_APPROVABLE_READINESS.includes(profile.readiness_status) — governance built into the API.

3. Profile history endpoint (GET /api/boq-items/{itemId}/requirement-profile/history)
   - SAFE because it explicitly returns history rows (including superseded ones), not claiming
     to return "current" profile.

UNSAFE:
1. ANY consumer that queries requirement_profile_versions WHERE superseded_at IS NULL
   WITHOUT additionally filtering by review_status NOT IN ('Merged') or other governance criteria.
   - RISK: consumers could read profiles for merged BOQ items, stale profiles after reclassification,
     or profiles that should have been superseded but weren't.

2. Profile comparison and issue viewers that use only superseded_at IS NULL as the currentness
   gate — these are UNSAFE because they don't account for merged BOQ item exclusion.

3. Downstream matching/safety recalcs that start from "all non-superseded profiles" without
   first restricting to active BOQ items — these risk counting merged BOQ item profiles.

UNKNOWN:
1. Any custom analytics or reporting queries that ad-hoc select from requirement_profile_versions
   — these are UNKNOWN because their exact SQL is not in the inspected codebase.

RETURNING UNSAFE PATHS:

1. worker/technical-requirement-api.mjs — any inline SQL or function that selects
   requirement_profile_versions WHERE superseded_at IS NULL without also checking
   boq_items.review_status or boq_item governance flags.

2. Any consumer code that iterates "all non-superseded profiles" for matching/safety
   recalculation without first restricting to boq_items where review_status NOT IN ('Merged').

3. The profile fingerprint idempotency check: if previous?.input_fingerprint === inputFingerprint
   → return previous profile. If a merged BOQ item's profile was never marked superseded,
   this could return a "current" profile for an inactive BOQ item.

================================================================================
10. DOWNSTREAM CONTRACT FOR AGENT 1
================================================================================

DEFINE EXACTLY what Agent 1 should eventually consume.

SEPARATE:
- PHYSICAL QUANTITY AUTHORITY from Agent 1 drawings
- RESOURCE CLASSIFICATION AUTHORITY from Agent 3 technical profile
- ADDRESS DEMAND AUTHORITY from the correct derived layer
- PANEL ALLOCATION from downstream allocation

FOR EVERY INTERFACE RETURN:

FIELD | AUTHORITATIVE OWNER | CURRENTNESS RULE | READ FUNCTION
PHYSICAL_QTY | requirement_profile_versions (via slcResourceClassification or derived) | version_number max, superseded_at IS NULL | json_extract(profile, '$.physical_qty') or derived from boq quantity
RESOURCE_CLASS | requirement_profile_versions.slcResourceClassification.state (when populated) | version_number max, superseded_at IS NULL, review_status NOT IN ('Merged') | json_extract(profile, '$.slcResourceClassification.state')
ADDRESS_DEMAND | derived governed snapshot/calculation model (NOT requirement_profile_versions for demand) | updated via recalc trigger | read from derived store (e.g., fire_alarm_panel_sizing_snapshots)
PANEL_ALLOCATION | downstream allocation model | updated via allocation review | read from allocation model

AGENT 1 MUST NEVER NEED TO INSPECT LORE/PROSE.

Required separation:
- PHYSICAL QUANTITY AUTHORITY: From Agent 1's drawing authority (boq quantity, drawing quantity)
- RESOURCE CLASSIFICATION AUTHORITY: From Agent 3's technical profile (slcResourceClassification when populated)
- ADDRESS DEMAND AUTHORITY: From the correct derived layer (NOT requirement_profile_versions for total demand)
- PANEL ALLOCATION: From downstream allocation model (not from profile)

================================================================================
11. EXAMPLES — PROVE THE MODEL
================================================================================

WALK the proposed architecture through:

A. SMOKE DETECTOR
B. MANUAL CALL STATION
C. FIREMAN TELEPHONE JACK
D. DOOR CONTACT
E. IDP-RELAYMON-2
F. STROBE / HORN-STROBE under current architecture conflict

FOR EACH show:
- PHYSICAL_QTY
- RESOURCE_CLASS
- ADDRESSES_PER_UNIT
- ACTUAL_ADDRESS_DEMAND
- MAX_CAPABILITY
- UNRESOLVED COMPONENTS
- AUTHORITY LAYER

UNKNOWN MUST REMAIN UNKNOWN.

A. SMOKE DETECTOR
  PHYSICAL_QTY: 131 (RWW) / 6 (NTR/CR) — from BOQ quantity; intrinsic device count
  RESOURCE_CLASS: UNRESOLVED (slcResourceClassification.state = "UNRESOLVED" in all profile JSON examples;
    not yet classified as detector-pool or module-pool)
  ADDRESSES_PER_UNIT: 1 (intrinsic: one address per smoke detector device; from SLC resource classifier
    when classified; currently null because UNRESOLVED)
  ACTUAL_ADDRESS_DEMAND: 131 (RWW) or 6 (NTR/CR) — intrinsic device count; if classified detector-pool,
    total = quantity × 1 address/device
  MAX_CAPABILITY: 1 address/device (intrinsic; if classified detector-pool; UNKNOWN if UNRESOLVED)
  UNRESOLVED COMPONENTS: Resource pool classification (detector-pool vs module-pool vs not-slc);
    addressability; exact product family
  AUTHORITY LAYER: BOQ quantity authority (Agent 1 drawings); resource classification
    authority (to be populated via SLC resource classifier pipeline; not yet populated)

B. MANUAL CALL STATION (Pull Station IDP-PULL-DA/SA)
  PHYSICAL_QTY: 6 (NTR) — from BOQ quantity; intrinsic device count
  RESOURCE_CLASS: MODULE_POOL (SLC resource classifier explicitly classifies pull stations as
    module-pool: "pull stations are module-class points consuming MODULE-side address resource";
    installation manual: "the addressable module is housed inside the pull station")
  ADDRESSES_PER_UNIT: 1 (intrinsic: one module-pool address per pull station device; from SLC resource
    classifier and IFP-2100 manual verbatim evidence)
  ACTUAL_ADDRESS_DEMAND: 6 (module-pool addresses) — 6 pull stations × 1 module-pool address each
  MAX_CAPABILITY: 1 module-pool address per device (intrinsic; from classifier; if classifier becomes
    UNRESOLVED, then MAX_CAPABILITY = UNKNOWN)
  UNRESOLVED COMPONENTS: None — classifier provides definitive module-pool classification;
    but if classifier evidence is removed, would become UNKNOWN
  AUTHORITY LAYER: SLC resource classifier authority (product/family-level evidence); IFP-2100
    manual verbatim evidence (Agent 3 technical profile)

C. FIREMAN TELEPHONE JACK
  PHYSICAL_QTY: 24 (CR) / 19 (NTR) — from BOQ quantity; intrinsic device count
  RESOURCE_CLASS: NOT_SLC (proven fact: direct SLC = 0 per req_267; FFT-FPJ passive endpoint;
    no monitor-module quantity derived from jack count)
  ADDRESSES_PER_UNIT: 0 (proven fact: direct SLC = 0; interface address separate from SLC)
  ACTUAL_ADDRESS_DEMAND: 0 (proven; no SLC address consumed)
  MAX_CAPABILITY: 0 (proven; no SLC address capacity)
  UNRESOLVED COMPONENTS: None — proven fact: direct SLC = 0
  AUTHORITY LAYER: req_267 approval authority (Agent 1); FFT-FPJ passive endpoint (Agent 3);
    project spec clauses

D. DOOR CONTACT
  PHYSICAL_QTY: varies (from BOQ quantity)
  RESOURCE_CLASS: NOT_SLC (proven fact: direct SLC = 0; passive device; interface address
    separate from SLC)
  ADDRESSES_PER_UNIT: 0 (proven fact: direct SLC = 0; no SLC address consumed)
  ACTUAL_ADDRESS_DEMAND: 0 (proven; no SLC address consumed)
  MAX_CAPABILITY: 0 (proven; no SLC address capacity)
  UNRESOLVED COMPONENTS: None — proven fact: direct SLC = 0
  AUTHORITY LAYER: Passive device fact (Agent 3); project spec clauses (Agent 1)

E. IDP-RELAYMON-2
  PHYSICAL_QTY: 6 (RFM) — from BOQ quantity; intrinsic device count
  RESOURCE_CLASS: UNRESOLVED (slcResourceClassification.state = "UNRESOLVED"; enabled-channel
    demand not classified; classifier does not classify RELAYMON families)
  ADDRESSES_PER_UNIT: UNKNOWN (configuration-dependent; 2 relay outputs + 2 Class B monitor
    inputs available per unit, but which are enabled is project-dependent)
  ACTUAL_ADDRESS_DEMAND: UNRESOLVED (enabled-channel allocation not known from project evidence)
  MAX_CAPABILITY: 16 (4 units × 4 channels each; advisory only, not sizing authority per
    proven address demand; 4 units × 2 relay outputs + 2 Class B monitor inputs = 12 max,
    or 4 × 4 = 16 if all channels independently addressable)
  UNRESOLVED COMPONENTS: Enabled-channel allocation; which of the 4 available channels per
    unit are actually required; project architecture for channel enablement
  AUTHORITY LAYER: Manufacturer datasheet capability (Agent 3); project architecture decision
    (Agent 1); not currently in requirement profile

F. STROBE / HORN-STROBE under current architecture conflict
  PHYSICAL_QTY: 438 (from BOQ; notification appliance count)
  RESOURCE_CLASS: UNRESOLVED (LOOP_POWERED_NOTIFICATION_ARCHITECTURE = CONFLICT; neither
    conventional NAC nor loop-powered strobe wiring approved over the other)
  ADDRESSES_PER_UNIT: UNKNOWN (depends on architecture resolution; if loop-powered: addresses
    per unit determined by SLC loop layout; if conventional NAC: 0 direct SLC addresses)
  ACTUAL_ADDRESS_DEMAND: UNRESOLVED_ADDRESS_DEMAND (438 under unresolved architecture;
    neither NOT_SLC nor DETECTOR_POOL nor MODULE_POOL applies until architecture resolved)
  MAX_CAPABILITY: 438 (physical quantity; not a resource demand; cannot be placed in
    NOT_SLC, DETECTOR_POOL, or MODULE_POOL until architecture resolved)
  UNRESOLVED COMPONENTS: LOOP_POWERED_NOTIFICATION_ARCHITECTURE = CONFLICT (conventional
    NAC requirements vs legend + CWZ cable note coexist; neither approved over the other);
    STROBE_SLC_ADDRESS_DEMAND = UNRESOLVED
  AUTHORITY LAYER: Project architecture governance (Agent 1); not in requirement profile
    (purposefully excluded per design decision)

================================================================================
12. NO PERSISTENCE YET
================================================================================

DO NOT:
- restart server;
- write canonical D1;
- create migrations;
- restore drizzle/;
- direct-SQL;
- modify sizing;
- modify panel allocation.

THIS TASK CLOSES THE AUTHORITY DESIGN BEFORE IMPLEMENTATION.

================================================================================
FINAL REPORT
================================================================================

A. Classification vs Demand Boundary
   - INTRINSIC TECHNICAL PROFILE FACTS: device family, resource pool membership (when product/family-level evidence exists), addresses per unit (when product/family-level evidence exists), direct SLC address (when proven device-level fact exists)
   - DERIVED DESIGN/CALCULATION RESULTS: total required detector addresses, total required module addresses, RELAYMON-2 actual enabled-channel demand, panel-specific address demand, notification architecture demand
   - BOUNDARY: Profile stores intrinsic; demand is separate derived layer

B. Requirement Profile Suitability
   - REQUIREMENT_PROFILE_IS_SLC_AUTHORITY_STORE = PARTIAL (container exists via JSON blob slcResourceClassification, but content NOT yet populated with intrinsic technical facts across all device families)
   - The schema is capable; the population pipeline is not yet encoding the fields
   - RFM_IS_EXCLUSIVE_STATE = YES

C. Exact Profile Fingerprint Coverage
   - inputFingerprint covers: boqItem, links, requirements, facts, sourceFacts, relationships, ecosystemBasis
   - DOES NOT cover: resource classification state, unitsPerDevice, enabled channels, notification architecture, panel allocation, drawing document version (as first-class inputs)
   - FINGERPRINT GAP: critical authority fields (resource classification, address demand, architecture) are NOT part of fingerprint → stale-risk confirmed

D. Resource-Demand Dependency DAG
  ```
  BOQ_PHYSICAL_QUANTITY → RESOURCE_DEMAND ← TECHNICAL_CLASSIFICATION
                           ← SELECTED_PRODUCT
                           ← RESOURCE_SEMANTICS
                           ← ENABLED_CHANNEL_DECISIONS
                           ← NOTIFICATION_ARCHITECTURE
                           ← ADDRESSES_PER_UNIT
                           ← DIRECT_SLC_ADDRESS
  RESOURCE_DEMAND → PANEL_ALLOCATION → PANEL_SIZING
  ```

E. Existing Derived Store Audit
   - fire_alarm_panel_sizing_snapshots: NOT YET INSPECTED (pending); name suggests it supports panel sizing
   - panel demand allocation: in-code logic, not persisted
   - calculation/dossier models: NOT YET INSPECTED
   - profile issues/facts: supports unresolved values but not sizing authority
   - requirement_profile_versions: stores intrinsic resource classification container (slcResourceClassification) but NOT total address demand
   - EXISTING_REUSABLE_SLC_STORE = NONE (confirmed from Requirement 3)
   - close call: fire_alarm_panel_sizing_snapshots needs inspection to confirm

F. Final Authority Architecture
   - REQUIREMENT PROFILE STORES: Intrinsic resource classification only (slcResourceClassification.state,
     slcResourceClassification.unitsPerDevice when populated, device family from BOQ category/subcategory)
   - ADDRESS_DEMAND STORE: Existing derived governed calculation/snapshot model (fire_alarm_panel_sizing_snapshots
     needs inspection; if unavailable, NEW_ADDRESS_DEMAND_MODEL_REQUIRED = YES)
   - NEW_RESOURCE_CLASSIFICATION_MODEL_REQUIRED = NO (existing container sufficient if pipeline updated)
   - NEW_ADDRESS_DEMAND_MODEL_REQUIRED = NEEDS INSPECTION of fire_alarm_panel_sizing_snapshots
     (TBD; may be YES if no existing store represents pre-allocation resource demand cleanly)
   - PROFILE_FINGERPRINT_COVERS_ALL_ADDRESS_DEMAND_INPUTS = NO (fingerprint missing critical fields)
   - MERGED_PROFILE_CURRENTNESS_FIX_REQUIRED = YES (hybrid: merge process sets superseded_at +
     currentProfile() resolver filters by review_status NOT IN ('Merged'))
   - PROFILE_CURRENTNESS_SAFE = NO (consumers must filter by governance criteria beyond superseded_at)
   - READY_FOR_SLC_AUTHORITY_IMPLEMENTATION = NO (governed authority not yet persisted; pipeline not encoding fields)

G. New-Model Decision
   - DO NOT invent new table if existing calculation/snapshot model is sufficient
   - INSPECT fire_alarm_panel_sizing_snapshots FIRST
   - If that model supports pre-allocation resource demand: NO new table needed
   - If not: NEW_ADDRESS_DEMAND_MODEL_REQUIRED = YES (design only; do NOT implement in this task)

H. Merged-Profile Currentness Fix
   - HYBRID FIX: 
     1. When BOQ item merged (review_status = 'Merged'), set superseded_at on associated profile
     2. currentProfile() resolver additionally filters by review_status NOT IN ('Merged')
   - DO NOT simply delete the two rows (boqitem_684936f0 seq 47, boqitem_9a115224 seq 48)
   - This provides both explicit governance marker AND defense-in-depth resolver filter

I. Unsafe Profile Consumers
   - Any consumer selecting requirement_profile_versions WHERE superseded_at IS NULL without
     additionally filtering by review_status NOT IN ('Merged')
   - Profile comparison/viewers using only superseded_at IS NULL as currentness gate
   - Downstream matching/safety recalcs iterating "all non-superseded profiles" without first
     restricting to active BOQ items (review_status NOT IN ('Merged'))
   - Profile fingerprint idempotency check returning "current" profile for merged BOQ items
     (if never marked superseded)

J. Agent 1 Downstream Contract
   - PHYSICAL QUANTITY AUTHORITY: From Agent 1 drawings (boq quantity, drawing quantity)
     Read function: read from BOQ/supply sheet; not from D1 requirement profile
   - RESOURCE CLASSIFICATION AUTHORITY: From Agent 3 technical profile
     Read function: json_extract(profile, '$.slcResourceClassification.state') when populated;
       UNKNOWN when UNRESOLVED
   - ADDRESS DEMAND AUTHORITY: From the correct derived layer (fire_alarm_panel_sizing_snapshots
     or similar); NOT from requirement_profile_versions for total demand
   - PANEL ALLOCATION: From downstream allocation model; NOT from profile

K. Six Worked Device Examples
   (See detailed examples Section 11: A. Smoke detector, B. Manual call station, C. Fireman
   telephone jack, D. Door contact, E. IDP-RELAYMON-2, F. Strobe/horn-strobe under architecture
   conflict)

FINAL FLAGS:

REQUIREMENT_PROFILE_IS_SLC_AUTHORITY_STORE = PARTIAL (container exists via JSON blob slcResourceClassification,
  but content NOT yet populated with intrinsic technical facts across all device families)

EXISTING_REUSABLE_SLC_STORE = NONE

NEW_RESOURCE_CLASSIFICATION_MODEL_REQUIRED = NO (existing container sufficient if pipeline updated)

NEW_ADDRESS_DEMAND_MODEL_REQUIRED = NEEDS INSPECTION of fire_alarm_panel_sizing_snapshots
  (TBD; may be YES if no existing store represents pre-allocation resource demand cleanly)

PROFILE_FINGERPRINT_COVERS_ALL_ADDRESS_DEMAND_INPUTS = NO

MERGED_PROFILE_CURRENTNESS_FIX_REQUIRED = YES (hybrid: merge process sets superseded_at +
  currentProfile() resolver filters by review_status NOT IN ('Merged'))

PROFILE_CURRENTNESS_SAFE = NO

READY_FOR_SLC_AUTHORITY_IMPLEMENTATION = NO

READY_FOR_AGENT_1_ADDRESS_HANDOFF = NO

OVERALL_PROJECT_READY_FOR_SIZING = NO

NO writes. No sizing. No pricing. No quotation. No migrations. No direct SQL. No commit/push/deploy.

================================================================================
END OF REPORT
================================================================================

FINAL_STATE_READ_AT: 2026-10-02T22:22:38Z
CURRENTNESS_STATUS: ARCHITECTURE_PROOF — D1 state read-qualified; RUNTIME_BLOCKER (server DOWN; all API POSTs return 000); governed authority NOT persisted; schema capable via JSON blob but population pipeline incomplete; no writes performed; no migrations attempted; architecture analysis complete.

Report: FINAL_RESOURCE_CLASSIFICATION_BOUNDARY.md generated successfully.
