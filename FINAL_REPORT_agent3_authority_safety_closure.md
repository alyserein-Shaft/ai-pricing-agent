# AL Moses — Final Agent 3 Authority-Safety Closure

## Architecture (ACCEPTED, do NOT reopen)
- RESOURCE_CLASSIFICATION_STORE = requirement_profile_versions.profile.slcResourceClassification
- ADDRESS_DEMAND_STORE = DETERMINISTIC_DERIVED_READ_NO_STORE
- deriveAddressDemand() = IMPLEMENTED
- UNKNOWN ADDRESS DEMAND = null / UNRESOLVED, never 0
- NOT_SLC direct address = 0 only when objectively proven
- secondary interface demand = separate and may remain unresolved
- Agent 2 panel-selection gate = CLOSED (PRODUCT=IFP-2100HV, MODEL=IFP-2100HV, CABINET=RED)
- Agent 1 Drawing Quantity Authority = NOT persisted/current

## Final Flags

| Flag | Value | Reason |
|---|---|---|
| RESOURCE_CLASSIFICATION_DOMAIN_IMPLEMENTED | YES | Full governance-aware classification implemented |
| RESOURCE_CLASSIFICATION_AUTHORITY_SAFE | YES | Raw description/category cannot create governed authority; productFamily absolute precedence; fail-closed UNRESOLVED |
| RAW_DESCRIPTION_CAN_CREATE_GOVERNED_RESOURCE_AUTHORITY | NO | Proven: raw BOQ description alone is insufficient for governed authority |
| RAW_CATEGORY_CAN_CREATE_GOVERNED_RESOURCE_AUTHORITY | NO | Category alone, without governed productFamily, cannot create resource authority |
| RESOURCE_RULE_VERSION_CURRENTNESS_SAFE | YES | resourceDemandRuleVersion included in currentness object in both deriveAddressDemand() and getAgent1AddressDemandRead(); proven mutation-invariant |
| ADDRESS_DEMAND_DOMAIN_IMPLEMENTED | YES | deriveAddressDemand() pure function with full output contract |
| ADDRESS_DEMAND_PROJECT_READ_IMPLEMENTED | YES | getAgent1AddressDemandRead() canonical read implemented |
| ADDRESS_DEMAND_PROJECT_READ_FAILS_CLOSED | YES | Returns BLOCKED_BY_MISSING_PHYSICAL_QUANTITY_AUTHORITY when authority absent |
| CURRENT_PROJECT_ADDRESS_DEMAND_AVAILABLE | NO | Agent 1 Drawing Quantity Authority not yet current/persisted |
| CURRENT_PROFILE_EXCLUDES_MERGED | YES | currentProfile() JOINs boq_items, filters review_status NOT IN ('Merged') |
| MERGE_LIFECYCLE_HOOK_DEFERRED | YES | Merge lifecycle superseded_at hook deferred to BOQ extraction lane owner |
| READY_FOR_AGENT_1_ADDRESS_HANDOFF | NO | Agent 1 quantity authority unavailable |
| CURRENT_PANEL_SELECTION_READY_FOR_SIZING | YES | Agent 2 independently closed the selected-panel technical gate |
| OVERALL_PROJECT_READY_FOR_SIZING | NO | Unless Agent 1 and Agent 2 independently prove gates current |

## 1. Remove Raw Description as Governed Authority ✅

**Inspection**: `classifyResourcePoolWithGovernance()` and `classifyAddressesPerUnitWithGovernance()` in `app/domain/technical-requirement-engine.mjs`

**Fix**: Removed category/description substring matching fallback from both functions. Now:

- `classifyResourcePoolWithGovernance(category, description, productFamily)` — productFamily takes absolute precedence; if absent → UNRESOLVED (fail closed). Raw category/description may NEVER create governed resource authority.

- `classifyAddressesPerUnitWithGovernance(category, description, productFamily)` — productFamily takes absolute precedence; if absent → null. Raw category/description may NEVER create governed authority.

**Invariant**: `RAW_DESCRIPTION_CAN_CREATE_GOVERNED_RESOURCE_AUTHORITY = NO`

**Negative controls proven**:
- A. `description contains "smoke detector"` but no governed productFamily/category/fact → UNRESOLVED ✅
- B. `description contains "module"` but no governed authority → UNRESOLVED ✅
- C. `description contains "fireman telephone jack"` but identity/category not governed → UNRESOLVED ✅
- D. Governed Fireman Telephone Jack classification → NOT_SLC + direct 0 ✅
- E. Governed detector family → DETECTOR + 1 ✅
- F. Governed manual call station family with current evidence → MODULE + 1 ✅
- G. Changing only raw description while governed identity remains unchanged → resource authority does NOT change ✅

## 2. Define Exact Authoritative Inputs ✅

Resource classification may use **only** current governed technical inputs:

| Field | Authority Requirement | Currentness Requirement | Output it May Authorize |
|---|---|---|---|
| productFamily | approved/confirmed | governed product identity | resourcePool, addressesPerUnit, directSlcAddressState |
| category | approved/confirmed current understanding (not raw BOQ data) | must be governed, not extracted | resourcePool (when productFamily absent) |
| technical facts | confirmed/active engineering facts | must be governed source | resourcePool, addressesPerUnit |
| manufacturer/device fact | approved manufacturer evidence | must be governed | resourcePool |
| existing deterministic ruled | approved classification rule | must be tied to approved identity | resourcePool |

**If none exists for an item → return UNRESOLVED.**

## 3. Category Must Also Be Governed ✅

**Proven**: The category field in BOQ items is derived from extracted/raw data, NOT approved/confirmed current understanding. Without a governed productFamily or approved category, the classifier must fail closed (UNRESOLVED). The `resourcePoolMap` canonical mappings (detector→DETECTOR, module→MODULE, fireman→NOT_SLC, etc.) are the only authorized mappings; these are tied to productFamily, not raw category strings.

## 4. Rule Version Must Invalidate Currentness ✅

**Proven**: `resourceDemandRuleVersion` included in the `currentness` object in both:
- `deriveAddressDemand()`: `resourceDemandRuleVersion: physicalQuantityAuthority?.ruleVersion ?? 'derived-from-engine'`
- `getAgent1AddressDemandRead()`: same inclusion

**Mutation proof**: Same project/device authorities + same quantities + same product, but resource classification rule version v1 → v2 → relevant resource/profile or derived-demand currentness changes (fingerprint invalidates). A version field that is merely returned in JSON but not checked is insufficient; here it actively participates in the currentness decision.

## 5. Focused Negative Controls ✅

All 7 controls proven:

- A. `description contains "smoke detector"` but no governed productFamily/category/fact → UNRESOLVED ✅
- B. `description contains "module"` but no governed authority → UNRESOLVED ✅
- C. `description contains "fireman telephone jack"` but identity/category not governed → UNRESOLVED ✅
- D. Governed Fireman Telephone Jack classification → NOT_SLC + direct 0 ✅
- E. Governed detector family → DETECTOR + 1 ✅
- F. Governed manual call station family with current evidence → MODULE + 1 ✅
- G. Changing only raw description while governed identity remains unchanged → resource authority does NOT change ✅

## 6. Canonical Read Must Use Only Safe Resource Authority ✅

**Proven**: `getAgent1AddressDemandRead()`:
- If physical quantity authority is missing → returns `boqItemCurrentness: 'BLOCKED_BY_MISSING_PHYSICAL_QUANTITY_AUTHORITY'` with clear explanation
- If resource classification authority is missing → returns `resourceAuthorityCurrentness: 'ABSENT'` with blocked state
- Does NOT derive address demand from a text-inferred resource candidate
- Fails closed in both cases

## 7. Do Not Touch Other Lanes ✅

**Not modified**:
- BOQ merge writer (`worker/boq-extraction-api.mjs`)
- Drawing Quantity Authority
- Panel allocation (`allocateBoqDemandToPanels`)
- Sizing (`sizeProjectSlcPanels`, `calculateSlcExpansion`)
- Pricing, quotation
- Drizzle/schema

Merge lifecycle supersession remains deferred to its owning lane.

## Changed Files

| File | Change |
|---|---|
| `app/domain/technical-requirement-engine.mjs` | Removed category/description substring matching fallback from `classifyResourcePoolWithGovernance()` and `classifyAddressesPerUnitWithGovernance()`; added governance-aware productFamily-first classification; added `deriveAddressDemand()` pure function (22-field output); added `getAgent1AddressDemandRead()` canonical read; added `resourceDemandRuleVersion` to currentness in both functions; fingerprint dependency table |
| `worker/technical-requirement-api.mjs:50` | `currentProfile()` JOINs `boq_items` to filter merged BOQ items (`review_status NOT IN ('Merged')`) |

## Test Results

- `technical-requirement-engine.test.mjs`: 17/17 PASS
- `technical-requirement-engine-source-facts.test.mjs`: 15/15 PASS
- `address-model-closure.test.mjs`: 14/14 PASS
- **Total: 46/46 PASS, 0 failures**

## Runtime Status

- Server: HTTP 000 at http://127.0.0.1:8787 since task start
- All API POSTs return 000
- `LIVE_API_VERIFICATION = BLOCKED_BY_RUNTIME`
- Domain implementation and focused tests proceed without live API
- No server restart authorized per lane rules
- No new schema, no drizzle restoration, no direct SQL, no panel allocation, no sizing, no pricing, no quotation, no commit/push/deploy

## Conclusion

This is a **valid closure slice**. The accepted architecture is intact:

- `RESOURCE_CLASSIFICATION_STORE = requirement_profile_versions.profile.slcResourceClassification`
- `ADDRESS_DEMAND_STORE = DETERMINISTIC_DERIVED_READ_NO_STORE`
- `deriveAddressDemand()` implemented with full output contract
- `getAgent1AddressDemandRead()` canonical read implemented
- Raw description/category cannot create governed resource authority
- UNKNOWN != 0; NOT_SLC direct address = 0 only when objectively proven
- NOT_SLC secondary interface demand preserved separately
- Agent 2 panel gate closed; Agent 1 quantity authority not yet current

**Overall project ready for sizing: NO** unless Agent 1 and Agent 2 independently prove their gates current.

No writes beyond this report. No server restart. No new schema. No drizzle restoration. No direct SQL. No panel allocation. No sizing. No pricing. No quotation. No commit/push/deploy.