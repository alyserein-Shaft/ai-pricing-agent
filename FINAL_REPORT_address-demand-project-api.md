# FINAL REPORT — AL MOUSA: CANONICAL ADDRESS-DEMAND PROJECT READ EXPOSED FOR THE ENGINEER UI

Project: `project_ae501b85-9c12-4332-bf8e-787c90f2d388`
Scope: worker/API transport slice only. The Address Demand domain was treated as CLOSED and was not redesigned.

---

## A. EXISTING CANONICAL READ (source of truth, traced not modified)

`getAgent1AddressDemandRead` — `app/domain/technical-requirement-engine.mjs:803`

**Required inputs** (all explicit; the function performs no I/O and reads no store):

| Input | Meaning |
|---|---|
| `boqItemId` | identity only |
| `resourceClassificationAuthority` | governed `{ state, unitsPerDevice, version }` |
| `physicalQuantityAuthority` | governed `{ value, ruleVersion, maxAddresses }` |
| `architectureDecision` | opaque pass-through |
| `enabledChannelDecision` | opaque pass-through |
| `interfaceDecision` | opaque pass-through |

**Blocked state:** when `physicalQuantityAuthority` is absent the function returns early with `boqItemCurrentness: 'MISSING_PHYSICAL_QUANTITY_AUTHORITY'`, `physicalQuantity: null`, `physicalQuantityAuthorityId: null`, `physicalQuantityCurrentness: 'ABSENT'`, `resourcePool: 'UNRESOLVED'`, `addressesPerUnit: null`, `directSlcAddressState: null`, `secondaryInterfaceDemandState: null`, `actualRequiredAddressDemand: null`, `maxCapabilityAddressDemand: null`, `demandState: 'UNRESOLVED'`.

**Currentness fields:** `currentness` (`resourcePool`, `addressesPerUnit`, `physicalQuantity`, `productAuthority`, `architectureDecision`, `enabledChannelDecision`, `interfaceDecision`, `resourceDemandRuleVersion`) and `addressDemandInputFingerprint`.

**Evidence fields:** `evidenceReferences` (`resourceClassification`, `physicalQuantity`, `product`) and `architectureDecisionReferences`.

The function remains the sole owner of every semantic in the response. The route adapts it and does not re-derive, re-default or repair anything.

---

## B. API ROUTE ADDED

`GET /api/projects/:projectId/requirement-profile/address-demand`
→ `worker/technical-requirement-api.mjs` (`handleTechnicalRequirementApi`)

**Why this path and not `/api/projects/:id/address-demand`:** this file's dispatcher gates on `url.pathname.includes("requirement-profile")`. The chosen path reuses that gate, the existing `resolveApplicationContext` / `applicationActor` authorization, and the existing per-project ownership scope, rather than adding a second entry path. Address demand is also genuinely profile-anchored — its resource authority is `requirement_profile_versions.profile.slcResourceClassification` — so this is the established naming convention, not a new one.

**What the route does, in order:** resolves the owned project → lists current project items through the canonical current-evidence authority → reads the current governed architecture decision → per item, resolves current governed resource classification authority and current governed physical quantity authority → calls `getAgent1AddressDemandRead` → returns the canonical result plus an additive count summary.

**No derivation was duplicated.** `deriveAddressDemand` is not called by the worker.

**Explicitly refused fallbacks** for physical quantity (documented in-code): `boq_items.numeric_quantity`, `boq_quantity_source_decisions`, `drawing_quantity_evidence_coverage`, symbol recognition counts, agent reports, lore, historical drawing values. Each would let a detection signal silently become a governed device count.

---

## C. CURRENT AL MOUSA RESULT (live, re-read immediately before this report)

Read from canonical D1 `.wrangler/state/.../faaf2b04….sqlite` through the real route handler:

```
HTTP 200
ITEM_COUNT   84
SUMMARY      {"PROVEN":0,"UNRESOLVED":0,"CONFLICT":0,"BLOCKED":84,"NOT_APPLICABLE":0}
DISTINCT boqItemCurrentness : ["MISSING_PHYSICAL_QUANTITY_AUTHORITY"]
DISTINCT demandState        : ["UNRESOLVED"]
physicalQuantity == null    : 84
physicalQuantity == 0       : 0        <-- no fabricated zero anywhere
```

This is the correct and expected result. `drawing_quantity_claims` does not exist in canonical D1 (verified: 0 rows in `sqlite_master`), so the governed quantity store is absent and every item blocks.

Also re-read: `currentBoqEvidenceCounts` = 90 current BOQ items; the route returns 84 because it additionally excludes `review_status = 'Merged'`.

---

## D. FAIL-CLOSED PROOF

`tests/address-demand-project-api.test.mjs` — 11/11 pass, driving the **real handler** against an in-memory fake D1.

| Req | Test | Result |
|---|---|---|
| A | no governed quantity authority → every item explicitly blocked, quantity `null` | PASS |
| B | current governed quantity + current resource authority → `PROVEN`, demand 12 | PASS |
| C | `NOT_SLC` direct 0 with unresolved secondary → `NOT_APPLICABLE`, never `PROVEN`/0 | PASS |
| D | resource classification authority absent → `UNRESOLVED`; quantity never decides the pool | PASS |
| D2 | raw-text `addressability` never reaches any governed output | PASS |
| E | drifted claim fingerprint → not consumed, blocks | PASS |
| E2 | a claim bound to another item is never borrowed | PASS |
| F | one blocked row fabricates no zero and contributes no total | PASS |
| — | response is additive transport, canonical field names preserved verbatim | PASS |
| — | route exposes no allocation / sizing / SBUS / occupancy figure | PASS |
| — | item scope uses the canonical current-evidence authority, not a weaker filter | PASS |

No regression: 65/65 across `technical-requirement-engine` (17), `technical-requirement-engine-source-facts` (15), `address-model-closure` (14), `address-demand-project-api` (11), `requirement-domain-routing` (8). `npm run lint` reports **zero** findings in the two touched files.

---

## E. RESPONSE CONTRACT (actual, captured from the live run)

```jsonc
{
  "projectId": "project_ae501b85-…",
  "addressDemandStore": "DETERMINISTIC_DERIVED_READ_NO_STORE",
  "sourceOfTruth": "getAgent1AddressDemandRead",
  "summary": { "PROVEN": 0, "UNRESOLVED": 0, "CONFLICT": 0, "BLOCKED": 84, "NOT_APPLICABLE": 0 },
  "items": [ /* one independently fail-closed read per current project item */ ]
}
```

Each item, exactly as returned today:

```jsonc
{
  "boqItemId": "boqitem_01eb742e-…",
  "boqItemCurrentness": "MISSING_PHYSICAL_QUANTITY_AUTHORITY",
  "physicalQuantity": null,
  "physicalQuantityAuthorityId": null,
  "physicalQuantityCurrentness": "ABSENT",
  "resourceProfileId": null,
  "resourceProfileVersion": null,
  "resourcePool": "UNRESOLVED",
  "addressesPerUnit": null,
  "directSlcAddressState": null,
  "secondaryInterfaceDemandState": null,
  "resourceAuthorityCurrentness": "ABSENT",
  "actualRequiredAddressDemand": null,
  "maxCapabilityAddressDemand": null,
  "demandState": "UNRESOLVED",
  "unresolvedReason": "Physical quantity authority absent; cannot derive address demand. Agent 1 Drawing Quantity Authority not yet current/persisted.",
  "addressDemandInputFingerprint": { "boqItemId": "…", "resourcePool": "UNRESOLVED",
    "addressesPerUnit": null, "physicalQuantity": null,
    "architectureDecision": { /* governed identity: basisVersion, decisionId, ecosystem,
      ecosystemState, primaryProtocol, selectedProtocolMode, specificationVersion,
      decidedBy, decidedRole, decidedAt */ },
    "enabledChannelDecision": null, "interfaceDecision": null },
  "architectureDecisionReferences": [],
  "evidenceReferences": { "resourceClassification": "unavailable — Agent 1 quantity authority absent",
                          "physicalQuantity": "unavailable" },
  "currentness": { "resourcePool": "UNRESOLVED", "addressesPerUnit": null,
    "physicalQuantity": null, "productAuthority": "un governed",
    "architectureDecision": { /* same governed identity */ },
    "enabledChannelDecision": null, "interfaceDecision": null,
    "resourceDemandRuleVersion": "derived-from-engine" }
}
```

Canonical names were preserved verbatim. `directSlcAddressState` and `addressDemandInputFingerprint` are the canonical spellings (the task's shorthand `directSlcAddressState` / `inputFingerprint` were not forced). `summary` uses the reader's own vocabulary (`PROVEN`, not `READY`).

### Contract limitations Agent 4 must know (canonical reader, deliberately unchanged)

1. **`resourceProfileId` and `physicalQuantityAuthorityId` carry literals, not identifiers** — the reader hardcodes `'active'` and `'governed'`/`'absent'`. **The UI cannot join to a profile or a claim from this response.** Join via `boqItemId` instead. Pinned by test B.
2. **`addressDemandInputFingerprint` is a plain object, not a hash.** Nothing compares it, so it cannot by itself detect staleness in the UI. Pinned as a fact, not treated as a guarantee.
3. **Response is ~194 KB for 84 items** (2.3 KB/item). The architecture decision appears in both `addressDemandInputFingerprint` and `currentness` — 168 occurrences. This is inherent to the canonical reader's shape and was not altered.
4. `evidenceReferences` values are human-readable strings, not structured references.

---

## F. DEFECTS FOUND IN THE CANONICAL READER (reported, NOT fixed — domain is closed)

1. **`resourceDemandRuleVersion` reads the wrong authority.** `technical-requirement-engine.mjs:958` derives it from `physicalQuantityAuthority?.ruleVersion`. A *resource classification* rule version is being read off the *physical quantity* authority, so it can never invalidate on a resource-rule change. It will effectively always be `'derived-from-engine'`. This is the "version present in JSON but never checked" failure mode.
2. **Inconsistent quantity read.** Line 891 computes demand from `physicalQuantityAuthority.value`, but line 964 reports `physicalQuantity` via `value || …`. A governed claim of quantity `0` therefore yields `actualRequiredAddressDemand: 0` while `physicalQuantity: null`. Line 964's ternary is also dead code (`boqItemId ? null : null`).
3. **Persisted `addressability` is raw-text derived.** `buildTechnicalRequirementProfile` sets `slcResourceClassification.addressability` from `classifyAddressability(category, description)` — raw substring matching on "detector"/"smoke"/"heat"/"fireman"/"telephone"/"door". The reader does not consume it, and this route forwards only governed fields (test D2). But the stored profile field is not itself governed authority.
4. **0 of 84 live profiles carry a classification.** `PROFILES_WITH_RESOURCE_CLASSIFICATION = 0` — the persisted profiles predate the `slcResourceClassification` field. Live resource authority is unpopulated regardless of quantity authority.
5. **Stale comment.** Lines 542–545 describe the pools as `DETECTOR_POOL`/`MODULE_POOL`; the actual vocabulary is `DETECTOR`/`MODULE`/`NOT_SLC`. Comment only, no behavioral effect.
6. Dead substring helpers `classifyResourcePool`, `classifyAddressesPerUnit` remain unreferenced.

---

## G. AGENT 4 UI HANDOFF

- **Endpoint:** `GET /api/projects/{projectId}/requirement-profile/address-demand`
- **Consume as-is.** The shape in §E is the real captured response, not a proposal. Do not expect it to change shape when quantity authority lands — only the values (`boqItemCurrentness` → `CURRENT`, `demandState` → `PROVEN`/`UNRESOLVED`/`CONFLICT`/`NOT_APPLICABLE`, quantities populated).
- **Render a blocked state, not zero.** Today all 84 items are `BLOCKED`. `physicalQuantity` is `null`, never `0`. A UI that coerces `null → 0` will fabricate 84 devices and destroy the safety property this architecture exists to provide.
- **Branch on `boqItemCurrentness` first**, then on `demandState`. Do not infer state from a null field.
- **`summary` is a state count only** — it carries no engineering total by design.
- **Join by `boqItemId`**, not by `resourceProfileId`/`physicalQuantityAuthorityId` (see §E limitations).
- **Nothing beyond address demand is exposed.** No panel allocation, no sizing, no SBUS occupancy. Do not expect or request those from this route.

---

## FLAGS

```
ADDRESS_DEMAND_DOMAIN_REOPENED               = NO
ADDRESS_DEMAND_CANONICAL_READ_REUSED         = YES
ADDRESS_DEMAND_PROJECT_API_IMPLEMENTED       = YES
ADDRESS_DEMAND_PROJECT_API_FAILS_CLOSED      = YES
CURRENT_PROJECT_ADDRESS_DEMAND_AVAILABLE     = NO
UI_CAN_CONSUME_ADDRESS_DEMAND_CONTRACT      = YES

ADDRESS_DEMAND_DERIVATION_DUPLICATED         = NO
QUANTITY_FALLBACK_TO_BOQ_OR_RECOGNITION      = NO
RAW_TEXT_CAN_REACH_A_GOVERNED_OUTPUT         = NO   (proven by test D2)
LIVE_AL_MOUSA_FABRICATED_ZEROS              = 0    (84/84 null)
LIVE_API_VERIFICATION                        = PROVEN_VIA_CANONICAL_D1   (server not running; the real
                                               handler was executed directly against canonical D1)
```

### Still blocked by other lanes (unchanged by this slice)

- **Agent 1 Drawing Quantity Authority is not landed.** `drawing_quantity_claims` absent; migration `out/qty-authority/INFRASTRUCTURE-HANDOFF-0064.sql` still unlanded with the two defects previously reported (D1 numbering → `drizzle-active/0020`, D2 NULL uniqueness). Owner decisions required.
- `CANONICAL_MIGRATION_CHAIN_IS_UNTRACKED_IN_GIT = YES` (`drizzle-active/` is untracked).
- Merge-lifecycle supersession hook for resource classification remains deferred to the BOQ merge writer lane.
- 0 of 84 profiles populated with resource classification — a recalculate is needed before resource authority can ever be non-null.

**No quantity writes. No allocation. No sizing. No pricing. No quotation. No schema. No direct SQL. No commit/push/deploy.**