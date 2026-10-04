// GOLDEN-7A -- Fire Alarm PANEL product capability normalization.
//
// WHAT THIS IS.
//
// A pure, evidence-only normalizer that turns a panel product's OWN governed
// evidence into a structured capability record suitable for later exact sizing.
// It answers "what can this product do, per its manufacturer evidence". It never
// answers "what does the project need" or "which product is selected".
//
// THE THREE CONCEPTS STAY SEPARATE (mission section 4).
//
//   PRODUCT_CAPABILITY  this module's only output
//   PROJECT_REQUIREMENT never read here
//   PROJECT_SELECTION   never produced here
//
// "Supports 2,100 points" is a product capability. It is NOT a project demand and
// it is NOT a selection. There is no input to this module that could express a
// project point count, a building, a BOQ line or a preferred brand, so no amount
// of upstream data can turn a capability claim into a selection.
//
// REUSE, NOT REINVENTION.
//
// `extractFireAlarmProductAttributes` already owns the proven, bounded
// description-text rules for SLC loops, per-loop detector/module limits, the
// Farenhyt system point claim, ECS capability, colour, battery and device role,
// and it already preserves each value's literal `sourceText`. This module CALLS
// it and adds only the dimensions it does not cover: network, expansion,
// protocol, voice detail, smoke control, releasing, redundancy, certification
// normalization and sizing readiness.
//
// CAPACITY SEMANTICS ARE NOT COLLAPSED (mission section 8).
//
// A panel description may simultaneously claim "2100 point" and "159 Detectors
// and 159 Modules per loop". Those are different quantities with different
// meanings: one is a manufacturer nameplate/system claim, the other a per-loop
// device limit. 1 x (159 + 159) = 318, which is not 2,100. Storing a single
// `maxPoints` would silently assert an equivalence the evidence does not
// support. Every capacity therefore keeps its scope, its unit and its raw claim,
// and a conflict between two authorities fails closed rather than resolving to
// the larger number.

import { extractFireAlarmProductAttributes } from "./fire-alarm-product-attribute-extraction.mjs";
// One canonical lifecycle vocabulary, imported rather than re-declared. This
// module still keeps its own CONSUMER vocabulary for presentation, but it can no
// longer decide on its own what counts as a lifecycle state -- that judgement
// belongs to the lifecycle authority and the promotion policy.
import { normalizeCanonicalLifecycleStatus } from "./knowledge-promotion-policy.mjs";

export const FIRE_ALARM_PANEL_CAPABILITY_VERSION = "fire-alarm-panel-capability-normalization-1.0.0";

// ---------------------------------------------------------------------------
// Section 5/6/31 -- identity. manufacturer != brand != ecosystem != family != model.
// ---------------------------------------------------------------------------
export const IDENTITY_LEVELS = Object.freeze(["manufacturer", "brand", "ecosystem", "family", "model"]);

// Normalized part numbers for identity comparison. Separators and case are
// cosmetic; a suffix is NOT, because IFP-75 and IFP-75HV are different models
// with different electrical ratings, and IFP-2100 vs IFP-2100ECSHV differ by
// emergency-communication capability.
const canonicalPartNumber = (value) => String(value ?? "").trim().toUpperCase().replace(/[\s_\-/.]+/g, "");

// Section 30 -- dedup is safe only for pure formatting variants. Two part
// numbers collapse to one identity ONLY when the normalized forms are equal;
// suffix differences survive because they are real variants.
export const areSameProductIdentity = (left, right) => {
  const a = canonicalPartNumber(left);
  const b = canonicalPartNumber(right);
  return a.length > 0 && a === b;
};

// Section 6 -- a manufacturer is never a compatibility ecosystem. Honeywell owns
// several mutually incompatible ecosystems; flattening it would assert exactly
// the universal compatibility the governance model forbids.
export const normalizeEcosystemIdentity = ({ manufacturer, brand, declaredEcosystem = null } = {}) => {
  const declared = String(declaredEcosystem ?? "").trim();
  const brandName = String(brand ?? "").trim();
  if (declared) return { ecosystem: declared, basis: "DECLARED" };
  if (brandName) return { ecosystem: brandName, basis: "BRAND" };
  // Falling back to the manufacturer would be the flattening this forbids, so
  // an unknown ecosystem stays explicitly unknown instead.
  return { ecosystem: null, basis: "UNRESOLVED", manufacturer: String(manufacturer ?? "").trim() || null };
};

// ---------------------------------------------------------------------------
// Section 12/13 -- certification normalization.
//
// UL, FM, EN54, LPCB and ULC are INDEPENDENT claims. A product evidenced as UL
// only stays UL only. Nothing is ever added because it is "usually paired".
// ---------------------------------------------------------------------------
export const CERTIFICATION_CLAIMS = Object.freeze([
  { key: "UL", pattern: /\bUL\s+Listing\b|\bUnderwriters Laboratories\b|\bUL\s+Listed\b/i, body: "UL", scope: "listing" },
  { key: "FM", pattern: /\bFM\s+Approved\b|\bFactory Mutual\b/i, body: "FM", scope: "approval" },
  { key: "EN54", pattern: /\bEN\s?54\b/i, body: "EN", scope: "standard" },
  { key: "LPCB", pattern: /\bLPCB\b/i, body: "LPCB", scope: "approval" },
  { key: "ULC", pattern: /\bULC\b/i, body: "ULC", scope: "listing" },
]);

// Section 35 -- only text the manufacturer itself published on the product is
// admissible. A reseller line is recorded as non-authoritative and never yields a
// certification.
export const normalizeCertifications = ({ description, sources = [] } = {}) => {
  const text = String(description ?? "");
  const manufacturerAuthoritative = sources.some((source) => String(source?.sourceType ?? "").toUpperCase().includes("MANUFACTURER"));
  const claims = [];
  for (const claim of CERTIFICATION_CLAIMS) {
    const match = text.match(claim.pattern);
    if (!match) continue;
    claims.push({
      certification: claim.key,
      standardBody: claim.body,
      // The claim's own words, so "UL Listing" is never upgraded to a
      // certification the document did not state.
      rawClaim: match[0],
      scope: claim.scope,
      region: null,
      authority: manufacturerAuthoritative ? "MANUFACTURER_DOCUMENT" : "CATALOG_TEXT_UNVERIFIED",
      status: manufacturerAuthoritative ? "Evidenced" : "Unverified",
      confidence: manufacturerAuthoritative ? 90 : 40,
    });
  }
  return claims;
};

// ---------------------------------------------------------------------------
// Sections 7/9/10/11/24/25/26 -- capability extraction.
//
// Every rule is a bounded literal match against the product's own description.
// No rule infers a capability from a part number, a family name or a marketing
// adjective, and no rule emits a value that is not stated.
// ---------------------------------------------------------------------------
const CAPABILITY_RULES = Object.freeze([
  // Section 24 -- network.
  { name: "max_network_nodes", pattern: /\bNetwork\s+(?:up\s*to\s*)?(\d+)\s+panels?\b/i, value: (m) => Number(m[1]), unit: "panels" },
  { name: "networkable", pattern: /\bNetwork\s+(?:up\s*to\s*)?\d+\s+panels?\b/i, value: () => true, unit: null },
  // Section 9/10 -- loop expansion. The mounting kit and the loop card it carries
  // are DIFFERENT components and are recorded as two relationships.
  { name: "expansion_via_mounting_kit", pattern: /expanded\s+through\s+(\d{4}[A-Z]*)/i, value: (m) => m[1], unit: null },
  { name: "expansion_kit_loop_card", pattern: new RegExp(`expanded\\s+through\\s+\\d{4}[A-Z]*[^.]*?\\(\\s*[^)]*?(\\d{4})\\s*\\)`, "i"), value: (m) => m[1], unit: null },
  { name: "expansion_loop_card_slots", pattern: /accomodates\s+(\d+)\s+SLC\s+Cards/i, value: (m) => Number(m[1]), unit: "cards" },
  // Section 25 -- voice. Only the explicit ECS/amplifier statement counts.
  { name: "max_addressable_amplifiers", pattern: /up\s+to\s+(\d+)\s+addressable\s+amplifiers/i, value: (m) => Number(m[1]), unit: "amplifiers" },
  { name: "max_voice_watts_per_system", pattern: /maximum\s+of\s+(\d+)\s+watts\s+per\s+system/i, value: (m) => Number(m[1]), unit: "W" },
  { name: "max_speaker_circuits", pattern: /up\s+to\s+(\d+)\s+mappable\s+speaker\s+circuits/i, value: (m) => Number(m[1]), unit: "circuits" },
  // Section 26 -- independent advanced capabilities. Presence is a POSITIVE
  // literal match only; a generic marketing phrase never yields `true`.
  { name: "supports_smoke_control", pattern: /\bSmoke\s+Control\b/i, value: () => true, unit: null },
  { name: "supports_releasing", pattern: /\bReleasing\b|\bRelease\s+Relay\b/i, value: () => true, unit: null },
  { name: "supports_redundancy", pattern: /\bRedundan(?:t|cy)\b/i, value: () => true, unit: null },
  { name: "supports_peer_to_peer", pattern: /\bpeer[\s-]to[\s-]peer\b/i, value: () => true, unit: null },
  { name: "supports_gui", pattern: /\bGraphic\s+Annunciator\b|\bGUI\b|\bGraphic\s+Workstation\b/i, value: () => true, unit: null },
]);

// Section 14 -- protocol. Only an explicit protocol token counts. A protocol is
// product evidence and NEVER a project compatibility conclusion.
const PROTOCOL_RULES = Object.freeze([
  { name: "FlashScan", pattern: /\bFlashScan\b/i },
  { name: "CLIP", pattern: /\bCLIP\b/i },
  { name: "IDP", pattern: /\bIDP\b/i },
  { name: "Flexput", pattern: /\bFlexput\b/i },
]);

const extractCapabilities = (description) => {
  const text = String(description ?? "");
  const out = [];
  for (const rule of CAPABILITY_RULES) {
    const match = text.match(rule.pattern);
    if (!match) continue;
    out.push({
      name: rule.name,
      value: rule.value(match),
      unit: rule.unit,
      // Section 22 -- the raw claim always travels with the normalized value.
      rawClaim: match[0].trim(),
      origin: "EXTRACTED",
      authority: "MANUFACTURER_DOCUMENT",
      confidence: 90,
    });
  }
  return out;
};

const extractProtocols = (description) => {
  const text = String(description ?? "");
  return PROTOCOL_RULES
    .filter((rule) => rule.pattern.test(text))
    .map((rule) => ({
      protocol: rule.name,
      rawClaim: (text.match(rule.pattern) || [rule.name])[0],
      // Section 14 -- protocol support is not device compatibility.
      compatibilityInferred: false,
    }));
};

// ---------------------------------------------------------------------------
// Section 8/23 -- capacity records.
//
// Capacity is never a bare number. Every record carries the scope it was stated
// at, so a system nameplate claim and a per-loop device limit can never be
// compared, summed or substituted for one another.
// ---------------------------------------------------------------------------
export const FIRE_ALARM_PANEL_CAPACITY_SCOPES = Object.freeze([
  "SYSTEM_NAMEDPLATE_POINTS",
  "SYSTEM_POINT_CEILING",
  "PER_LOOP_DETECTORS",
  "PER_LOOP_MODULES",
  "BASE_SLC_LOOPS",
  "MAX_SLC_LOOPS",
  "MAX_NETWORK_NODES",
]);

export const buildCapacityRecord = (attribute) => {
  const scopeByName = {
    // SYSTEM_NAMEDPLATE_POINTS and SYSTEM_POINT_CEILING are deliberately
    // different entries: see assessSizingReadiness.
    //
    // SYSTEM_POINT_CEILING is INTENTIONALLY absent from this map. It has no
    // canonical attribute name today, and it must NOT be sourced from
    // `max_system_points`: a nameplate figure is not a stated ceiling (see the
    // worked example in assessSizingReadiness). Until a manufacturer document
    // states a real system ceiling, this scope legitimately stays MISSING and
    // sizing stays PARTIALLY_SIZING_READY. Manufacturing a producer here would
    // let an unexplained nameplate number satisfy a governed ceiling, which is
    // the exact capacity collapse this module exists to prevent.
    //
    // MAX_SLC_LOOPS, by contrast, IS producible and WAS missing: `max_slc_loops`
    // is already a canonical scalar capacity attribute (see
    // fire-alarm-taxonomy.mjs ATTRIBUTE_VALUE_VALIDATORS), and
    // assessSizingReadiness lists MAX_SLC_LOOPS as REQUIRED. Omitting it meant
    // SIZING_READY was unreachable no matter how complete the product evidence.
    max_system_points: "SYSTEM_NAMEDPLATE_POINTS",
    max_detectors_per_loop: "PER_LOOP_DETECTORS",
    max_modules_per_loop: "PER_LOOP_MODULES",
    native_slc_loops: "BASE_SLC_LOOPS",
    max_slc_loops: "MAX_SLC_LOOPS",
    max_network_nodes: "MAX_NETWORK_NODES",
  };
  const scope = scopeByName[attribute.name];
  if (!scope) return null;
  return {
    scope,
    name: attribute.name,
    value: attribute.value,
    unit: attribute.unit ?? (scope.endsWith("LOOPS") ? "loops" : "devices"),
    rawClaim: attribute.sourceText ?? attribute.rawClaim ?? null,
    // A nameplate system claim is NOT decomposable into loop arithmetic from
    // this evidence alone, so the flag is explicit rather than implied.
    decomposableIntoLoopArithmetic: scope === "PER_LOOP_DETECTORS" || scope === "PER_LOOP_MODULES" || scope === "BASE_SLC_LOOPS",
    authority: "MANUFACTURER_DOCUMENT",
  };
};

// Section 18 -- two authorities disagreeing about the same capacity scope is a
// standing conflict, never a silent pick of the larger value.
export const detectCapacityConflicts = (sources) => {
  const byScope = new Map();
  for (const source of sources || []) {
    for (const record of source?.capacities || []) {
      const list = byScope.get(record.scope) || [];
      list.push({ ...record, sourceId: source.sourceId ?? null, sourceType: source.sourceType ?? null });
      byScope.set(record.scope, list);
    }
  }
  const conflicts = [];
  for (const [scope, records] of byScope) {
    const distinct = [...new Set(records.map((record) => record.value))];
    if (distinct.length > 1) {
      conflicts.push({
        scope,
        state: "CONFLICTING_PRODUCT_EVIDENCE",
        values: distinct.sort((a, b) => a - b),
        sources: records.map((record) => ({ sourceId: record.sourceId, rawClaim: record.rawClaim })),
        // No resolution is attempted. The consumer must treat this capability
        // as unknown until a human adjudicates the revision/variant cause.
        resolution: null,
      });
    }
  }
  return conflicts;
};

// Section 10/11 -- expansion relationships.
//
// A component that a description says capacity "can be expanded through" is
// OPTIONAL: base operation does not need it. A component that is stated as
// required for a capability is REQUIRED_FOR_CAPABILITY. The distinction is the
// whole point, so it is never collapsed to "accessory".
export const buildExpansionRelationships = (capabilities) => {
  const relations = [];
  const kit = capabilities.find((entry) => entry.name === "expansion_via_mounting_kit");
  const card = capabilities.find((entry) => entry.name === "expansion_kit_loop_card");
  const slots = capabilities.find((entry) => entry.name === "expansion_loop_card_slots");
  if (kit) {
    relations.push({
      componentPartNumber: kit.value,
      relationship: "SUPPORTS_OPTIONAL_EXPANSION",
      requirement: "OPTIONAL",
      // "can be expanded through" is explicitly not required for base operation.
      requiredForBaseOperation: false,
      rawClaim: kit.rawClaim,
    });
  }
  if (card && kit) {
    relations.push({
      componentPartNumber: card.value,
      relationship: "MOUNTED_IN",
      requirement: "OPTIONAL",
      parentComponentPartNumber: kit.value,
      capacityPerComponent: slots ? slots.value : null,
      capacityUnit: slots ? slots.unit : null,
      rawClaim: card.rawClaim,
    });
  }
  return relations;
};

// ---------------------------------------------------------------------------
// Section 16 -- lifecycle. Never inferred from document recency.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Address Model -- the canonical SLC/address resource semantics.
//
// WHY THIS IS WIRED HERE. `slc_address_model` was promoted onto six canonical
// products and read by NOTHING: the attribute existed, was Approved, and had no
// consumer, so a reviewed panel-sizing input silently influenced no decision.
// This is the Fire Alarm resource layer, so this is where it is interpreted.
//
// WHY THE TOKEN STAYS AUTHORITATIVE. The derived `addressesConsumed` is a
// convenience for arithmetic, and it is deliberately NOT the whole answer.
// Collapsing the model to a 0/1 flag would destroy the distinction that matters
// most in sizing: a device that shares its detector's address still needs an SLC
// connection, while a NON_SLC device needs none. Both would read as "0". A
// reviewer must therefore always be able to see which of the five behaviours was
// actually stated by the manufacturer.
//
// `SHARED_WITH_DETECTOR` is reported as `contextRequired`: counting it
// correctly needs the paired detector to be counted once, and this module will
// not guess the pairing. It reports the requirement instead of inventing it.
export const ADDRESS_MODEL_SLC_DEMAND = Object.freeze({
  STANDALONE_ADDRESS: Object.freeze({
    consumesSlcAddress: true,
    additionalAddressesConsumed: 1,
    basis: "The device carries its own SLC point address.",
    contextRequired: null,
  }),
  SHARED_WITH_DETECTOR: Object.freeze({
    // It sits on the SLC, but adds no address of its own.
    consumesSlcAddress: true,
    additionalAddressesConsumed: 0,
    basis: "The device shares the detector's address, so it must not be counted a second time.",
    contextRequired: "The paired detector must be counted exactly once; this module does not resolve the pairing.",
  }),
  HOUSING_NO_ADDITIONAL_ADDRESS: Object.freeze({
    consumesSlcAddress: false,
    additionalAddressesConsumed: 0,
    basis: "The housing or base adds no address; the address belongs to the device it carries.",
    contextRequired: null,
  }),
  HOUSED_MODULE_OWN_ADDRESS: Object.freeze({
    consumesSlcAddress: true,
    additionalAddressesConsumed: 1,
    basis: "The housed module sets its own point address.",
    contextRequired: null,
  }),
  NON_SLC: Object.freeze({
    consumesSlcAddress: false,
    additionalAddressesConsumed: 0,
    basis: "Not an SLC device; it consumes no SLC address at all.",
    contextRequired: null,
  }),
});

// ---------------------------------------------------------------------------
// SLC ADDRESS DEMAND -- the consumer that makes ADDRESS_MODEL_SLC_DEMAND real.
//
// WHY THIS EXISTS (2026-10-01, pre-Batch-3B address closure).
// `ADDRESS_MODEL_SLC_DEMAND` above was a correct but DEAD table: nothing read it.
// The shipped demand path (`panelDemandFromAllocations` in
// `app/domain/fire-alarm-panel-sizing-snapshot.mjs`) counted one SLC unit per
// allocated BOQ item using ONLY the family classification, so the governed
// address semantics could never refine a count. That is why the B200S shared
// address, the DNR housing and the conventional beam were protected only by
// family taxonomies rather than by the manufacturer's own address statement.
//
// WHAT IT DOES. It applies the address model as a REFINEMENT on top of the
// classifier's pool decision, never as a replacement for it:
//
//   NON_SLC / HOUSING_NO_ADDITIONAL_ADDRESS -> zero SLC address, in every pool
//   SHARED_WITH_DETECTOR                   -> zero ADDITIONAL address
//   STANDALONE_ADDRESS                     -> one address in its classified pool
//   HOUSED_MODULE_OWN_ADDRESS              -> one address in its classified pool
//
// DOUBLE COUNTING. A paired detector + shared-address base yields ONE address,
// because the base contributes `additionalAddressesConsumed: 0`. The pair is
// never summed to two.
//
// FAIL CLOSED. An unrecognised or absent address model returns
// ADDRESS_POOL_CLASSIFICATION_REQUIRED rather than defaulting to "1 address",
// because defaulting is precisely the flattening that mis-sizes a loop.
//
// NO PART NUMBERS. Nothing here is keyed on a SKU; the token vocabulary is the
// contract, so a new product with an approved address model behaves correctly
// with no code change.
export const ADDRESS_POOL_CLASSIFICATION_REQUIRED = "ADDRESS_POOL_CLASSIFICATION_REQUIRED";

// A stated multi-point address count that is not a positive integer. This exists
// so a malformed count FAILS CLOSED instead of silently falling back to the
// single-address default, which would under-count a proven 6- or 10-address
// module by 6x or 10x.
export const ADDRESS_COUNT_INVALID = "ADDRESS_COUNT_INVALID";

/**
 * Address demand for ONE allocated item.
 *
 * @param {object} input
 * @param {string|null} input.classificationState governed pool state from the
 *   SLC resource classifier: SLC_DETECTOR_POOL | SLC_MODULE_POOL | NOT_SLC
 * @param {string|null} input.addressModel approved `slc_address_model` token
 * @returns {{ok: true, pool: string|null, addresses: number, basis: string}
 *          |{ok: false, code: string, why: string}}
 */
export const slcAddressDemandForItem = ({
  classificationState,
  addressModel,
  addressesConsumed,
} = {}) => {
  const state = String(classificationState ?? "").trim();
  const model = String(addressModel ?? "").trim();
  const semantics = ADDRESS_MODEL_SLC_DEMAND[model];

  if (!semantics) {
    // An absent or unknown address model is NOT permission to assume one address.
    return {
      ok: false,
      code: ADDRESS_POOL_CLASSIFICATION_REQUIRED,
      why: `No approved slc_address_model${model ? ` (${model})` : ""} for an SLC allocation. Refusing to assume an address count.`,
    };
  }

  // An explicit count is validated even when it will not be used, so a malformed
  // value can never be silently ignored on the zero-address paths below.
  let explicitCount = null;
  if (addressesConsumed !== undefined && addressesConsumed !== null && addressesConsumed !== "") {
    const numeric = Number(addressesConsumed);
    if (!Number.isInteger(numeric) || numeric < 1) {
      return {
        ok: false,
        code: ADDRESS_COUNT_INVALID,
        why: `addresses_consumed must be a positive integer when stated, got ${JSON.stringify(addressesConsumed)}. Refusing to guess an address count.`,
      };
    }
    explicitCount = numeric;
  }

  // A non-SLC classification can never carry SLC address demand, whatever the
  // address model says. The family taxonomy is authoritative for that. An
  // explicit count cannot override this: notification appliance QUANTITY is a
  // NAC sizing output and must never become an SLC address count.
  if (state === "NOT_SLC" || semantics.consumesSlcAddress === false) {
    return {
      ok: true,
      pool: null,
      addresses: 0,
      basis: semantics.basis,
      ...(explicitCount !== null && explicitCount > 1
        ? {
            ignoredExplicitCount: explicitCount,
            ignoredBecause:
              "This device consumes no SLC address, so no explicit count can raise it above zero.",
          }
        : {}),
    };
  }

  if (semantics.additionalAddressesConsumed === 0) {
    // SHARED_WITH_DETECTOR: sits on the SLC but adds no address of its own.
    return {
      ok: true,
      pool: null,
      addresses: 0,
      basis: semantics.basis,
      contextRequired: semantics.contextRequired ?? null,
    };
  }

  // The token still decides WHETHER an address is consumed and which pool it
  // lands in. The explicit count only supplies HOW MANY, for a proven
  // multi-point module. Absent an explicit count this is exactly the previous
  // single-address behaviour.
  const pool = state === "SLC_DETECTOR_POOL" ? "detectors" : "modules";
  return {
    ok: true,
    pool,
    addresses: explicitCount ?? semantics.additionalAddressesConsumed,
    basis: semantics.basis,
    ...(explicitCount !== null && explicitCount !== semantics.additionalAddressesConsumed
      ? { explicitCountBasis: "Stated address count from manufacturer evidence overrides the single-address default." }
      : {}),
  };
};

/**
 * Aggregate address demand over allocated items, keeping detector and module
 * pools SEPARATE (Batch 3A: 159 detectors AND 159 modules are distinct pools,
 * never one interchangeable device count).
 */
export const slcAddressDemandForAllocations = (allocations, items, resolveAddressModel) => {
  const demand = { detectors: 0, modules: 0 };
  const unresolved = [];
  for (const allocation of allocations || []) {
    const item = items?.[allocation.boqItemId];
    const state = item?.classification?.state ?? null;
    const resolved = typeof resolveAddressModel === "function"
      ? resolveAddressModel(item, allocation)
      : null;
    // A resolver may return the bare model string (unchanged legacy contract) OR
    // an object carrying a proven multi-point count. Accepting both keeps every
    // existing caller working untouched.
    const addressModel = resolved && typeof resolved === "object"
      ? resolved.addressModel ?? resolved.slc_address_model ?? null
      : resolved ?? null;
    const addressesConsumed = resolved && typeof resolved === "object"
      ? resolved.addressesConsumed ?? resolved.addresses_consumed ?? undefined
      : undefined;
    const outcome = slcAddressDemandForItem({
      classificationState: state,
      addressModel,
      addressesConsumed,
    });
    if (!outcome.ok) {
      unresolved.push({ boqItemId: allocation.boqItemId, code: outcome.code });
      continue;
    }
    if (outcome.pool && outcome.addresses > 0) {
      demand[outcome.pool] += outcome.addresses * (Number(allocation.quantity) || 0);
    }
  }
  return { demand, unresolved };
};

// LEGACY DERIVED FORMS already present in `product_lifecycle_events`.
//
// The canonical promotion vocabulary deliberately does NOT include these: they
// are DERIVED DISPLAY FORMS produced by `product-price-library`'s
// `lifecycleState()` ("Discontinued — Replacement Candidate" and friends), not
// manufacturer-stated lifecycle states. Adding them to the promotion vocabulary
// would let a derived label be promoted as if a manufacturer had said it.
//
// They must still be READ. 57 live rows use "Discontinued — Replacement
// Candidate", 20 "— No Replacement", 5 "— Replacement Missing". If this consumer
// cannot read them they silently report UNKNOWN and the affected products look
// unverified -- so the legacy forms are understood here, at the consumer, and
// nowhere else.
const LEGACY_LIFECYCLE_FORMS = Object.freeze([
  { pattern: /^discontinued\s*[-—–]\s*replacement candidate$/i, state: "DISCONTINUED", replacementKnown: true },
  { pattern: /^discontinued\s*[-—–]\s*replacement missing$/i, state: "DISCONTINUED", replacementKnown: false },
  { pattern: /^discontinued\s*[-—–]\s*no replacement$/i, state: "DISCONTINUED", replacementKnown: false },
]);

const readLegacyLifecycleForm = (value) => {
  const text = String(value ?? "").trim();
  return LEGACY_LIFECYCLE_FORMS.find((form) => form.pattern.test(text)) || null;
};

const ADDRESS_MODEL_TOKEN_KEY = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

const ADDRESS_MODEL_TOKENS = new Map(
  Object.keys(ADDRESS_MODEL_SLC_DEMAND).map((token) => [ADDRESS_MODEL_TOKEN_KEY(token), token]),
);

/**
 * Interpret a canonical Address Model value.
 *
 * Returns `null` for an absent or unrecognised value -- deliberately NOT a
 * default. Defaulting an unknown address model to "consumes one address" (or to
 * zero) would silently mis-size a panel, so an absent model reports absent and
 * the caller decides. That is the fail-closed behaviour the brief requires.
 */
export const normalizeAddressModel = (value) => {
  const token = ADDRESS_MODEL_TOKENS.get(ADDRESS_MODEL_TOKEN_KEY(value));
  if (!token) return null;
  const demand = ADDRESS_MODEL_SLC_DEMAND[token];
  return {
    addressModel: token,
    ...demand,
  };
};

export const LIFECYCLE_STATES = Object.freeze(["CURRENT", "LEGACY", "DISCONTINUED", "REPLACED", "UNKNOWN"]);

export const normalizeLifecycle = ({ recordedStatus = null, lifecycleEvents = [] } = {}) => {
  const events = lifecycleEvents || [];
  const explicit = events
    .map((event) => String(event?.lifecycle_status ?? event?.lifecycleStatus ?? "").trim().toUpperCase())
    .filter((state) => LIFECYCLE_STATES.includes(state));
  // The consumer's own coarse vocabulary above could not read most of the
  // CANONICAL lifecycle vocabulary the promotion path now enforces -- it knew
  // CURRENT/LEGACY/DISCONTINUED/REPLACED/UNKNOWN but not `Superseded`,
  // `End of Sale`, `End of Support`, `Limited Availability` or
  // `Replacement Candidate`. So a value that had passed the promotion gate was
  // silently dropped here and reported as UNKNOWN.
  //
  // Rather than widen this consumer's vocabulary ad hoc, every event value is
  // first run through the CANONICAL normaliser and then mapped onto this
  // module's consumer vocabulary. One vocabulary decides what is storable; this
  // decides how it is presented to a resource/sizing surface.
  const canonicalEvents = events
    .map((event) => normalizeCanonicalLifecycleStatus(event?.lifecycle_status ?? event?.lifecycleStatus))
    .filter(Boolean);
  // Legacy derived forms are folded into the same stream, marked so a caller can
  // tell a manufacturer-stated state from a derived one.
  const legacyEvents = events
    .map((event) => readLegacyLifecycleForm(event?.lifecycle_status ?? event?.lifecycleStatus))
    .filter(Boolean);
  if (!canonicalEvents.length && legacyEvents.length) {
    const replacement = events.find((event) => {
      const candidates = event?.replacement_candidates ?? event?.replacementCandidates;
      return Array.isArray(candidates) && candidates.length > 0;
    });
    return {
      lifecycleStatus: legacyEvents.some((form) => form.state === "DISCONTINUED") ? "DISCONTINUED" : legacyEvents[legacyEvents.length - 1].state,
      canonicalLifecycleStates: [],
      legacyDerivedStates: events.map((event) => String(event?.lifecycle_status ?? event?.lifecycleStatus ?? "").trim()).filter(Boolean),
      // A derived form can say whether a replacement is KNOWN; it is never a
      // replacement product id, so nothing is applied.
      replacementKnown: legacyEvents.some((form) => form.replacementKnown),
      replacementProductId: replacement ? (replacement.replacement_candidates ?? replacement.replacementCandidates)[0] : null,
      source: "LIFECYCLE_EVENT",
      basis: legacyEvents.map((form) => form.state),
      inferredFromDocumentRecency: false,
    };
  }
  const canonicalStates = canonicalEvents.map((state) => state.toUpperCase());
  if (canonicalStates.length > 0) {
    // DISCONTINUED and SUPERSEDED are the two states a resource surface must
    // never miss, so they are checked explicitly before falling back to the most
    // recent state.
    const state = canonicalStates.includes("DISCONTINUED")
      ? "DISCONTINUED"
      : canonicalStates.includes("SUPERSEDED")
        ? "REPLACED"
        : canonicalStates[canonicalStates.length - 1] === "CURRENT"
          ? "CURRENT"
          : canonicalStates[canonicalStates.length - 1];
    const replacement = events.find((event) => {
      const candidates = event?.replacement_candidates ?? event?.replacementCandidates;
      return Array.isArray(candidates) && candidates.length > 0;
    });
    return {
      lifecycleStatus: state,
      // The canonical states are reported alongside the mapped one so an
      // engineer sees the manufacturer's actual disposition rather than only the
      // coarse bucket.
      canonicalLifecycleStates: canonicalEvents,
      // Section 16 -- a replacement is preserved, never silently applied.
      replacementProductId: replacement ? (replacement.replacement_candidates ?? replacement.replacementCandidates)[0] : null,
      source: "LIFECYCLE_EVENT",
      basis: canonicalEvents,
      // Section 19 -- "current" is never concluded from a document date.
      inferredFromDocumentRecency: false,
    };
  }
  if (explicit.length > 0) {
    const state = explicit.includes("DISCONTINUED") ? "DISCONTINUED" : explicit[explicit.length - 1];
    const replacement = events.find((event) => {
      const candidates = event?.replacement_candidates ?? event?.replacementCandidates;
      return Array.isArray(candidates) && candidates.length > 0;
    });
    return {
      lifecycleStatus: state,
      // Section 16 -- a replacement is preserved, never silently applied.
      replacementProductId: replacement ? (replacement.replacement_candidates ?? replacement.replacementCandidates)[0] : null,
      source: "LIFECYCLE_EVENT",
      basis: explicit,
      // Section 19 -- "current" is never concluded from a document date.
      inferredFromDocumentRecency: false,
    };
  }
  const recorded = String(recordedStatus ?? "").trim();
  if (/^current$/i.test(recorded)) return { lifecycleStatus: "CURRENT", replacementProductId: null, source: "CATALOG_FIELD", basis: [recorded], inferredFromDocumentRecency: false };
  if (/^legacy$/i.test(recorded)) return { lifecycleStatus: "LEGACY", replacementProductId: null, source: "CATALOG_FIELD", basis: [recorded], inferredFromDocumentRecency: false };
  // The live catalog's "Unknown - Review Required" is honest UNKNOWN, and must
  // not be upgraded to CURRENT just because the datasheet is easy to find.
  return { lifecycleStatus: "UNKNOWN", replacementProductId: null, source: "CATALOG_FIELD", basis: [recorded || "absent"], inferredFromDocumentRecency: false };
};

// ---------------------------------------------------------------------------
// Section 27 -- sizing readiness, decided by evidence, never by model name.
// ---------------------------------------------------------------------------
export const SIZING_READINESS_STATES = Object.freeze([
  "SIZING_READY",
  "PARTIALLY_SIZING_READY",
  "INSUFFICIENT_CAPABILITY_DATA",
  "CONFLICTING_CAPABILITY_DATA",
]);

export const assessSizingReadiness = ({ capacities, conflicts = [] } = {}) => {
  if (conflicts.length > 0) return { state: "CONFLICTING_CAPABILITY_DATA", missing: [], present: [] };
  const byScope = new Map((capacities || []).map((record) => [record.scope, record]));
  // Exact sizing needs a base loop count, a per-loop device basis, a MAXIMUM
  // loop count and a DEFINED system ceiling.
  //
  // A "2100 point" nameplate deliberately does NOT satisfy the ceiling. The
  // manufacturer has not stated what a "point" is (a loop device? a Flexput
  // circuit? a total across loops?), and 1 x (159+159) = 318 does not reconcile
  // to 2,100. Treating the nameplate as a governed ceiling is exactly the
  // capacity collapse mission section 8 forbids, so readiness stays partial
  // until a real ceiling is evidenced.
  //
  // MAX_SLC_LOOPS is deliberately NOT in this list. It was required here while
  // being consumed by nothing: calculateSlcExpansion takes no maximum-loop
  // input, so the gate was blocking on a fact the sizing engine never reads --
  // and which cannot be read safely anyway, because the real loop ceiling is
  // occupancy-dependent (a shared SBUS budget, minus whatever else is fitted)
  // rather than a single product scalar.
  //
  // Loop topology is therefore evaluated REQUIREMENT-RELATIVE at calculation
  // time: a design needing N loops is feasible when governed evidence proves at
  // least N loops are supportable. Nothing needs to know whether the absolute
  // theoretical maximum is 20, 40 or 64, and an absolute maximum must never be
  // substituted here.
  //
  // It is also NOT the case that the system point ceiling implies a loop count.
  // CEILING(2100/318) = 7 is the number of loops needed to reach the ceiling with
  // both pools FULLY loaded; ten lightly-loaded loops whose total demand is still
  // under 2100 are equally valid. Point ceiling and loop topology are
  // independent constraints and neither may be derived from the other.
  const required = ["BASE_SLC_LOOPS", "PER_LOOP_DETECTORS", "PER_LOOP_MODULES", "SYSTEM_POINT_CEILING"];
  const present = required.filter((scope) => byScope.has(scope));
  const missing = required.filter((scope) => !byScope.has(scope));
  const nameplateOnly = byScope.has("SYSTEM_NAMEDPLATE_POINTS") && !byScope.has("SYSTEM_POINT_CEILING");
  // Reported, never blocking: loop feasibility is settled requirement-relatively.
  const advisory = byScope.has("MAX_SLC_LOOPS") ? [] : ["MAX_SLC_LOOPS"];
  const readiness = missing.length === 0
    ? { state: "SIZING_READY", nameplateOnly: false }
    : present.length > 0
      ? { state: "PARTIALLY_SIZING_READY", nameplateOnly }
      : { state: "INSUFFICIENT_CAPACITY_DATA", nameplateOnly };
  return {
    ...readiness,
    missing,
    present,
    advisory,
    loopTopologyAuthority: "REQUIREMENT_RELATIVE",
    note: "Readiness covers the inputs the calculation consumes. Whether the CALCULATED loop count is supportable is decided requirement-relatively from expansion authority, not from an absolute maximum-loop scalar.",
  };
};

// ---------------------------------------------------------------------------
// The normalization entry point.
// ---------------------------------------------------------------------------
/**
 * Normalizes ONE panel product from its own governed evidence.
 *
 * @param {object} input
 * @param {string} input.partNumber
 * @param {string} [input.description]  manufacturer-published description text
 * @param {string|null} [input.family]
 * @param {string|null} [input.manufacturer]
 * @param {string|null} [input.brand]
 * @param {string|null} [input.declaredEcosystem]
 * @param {string|null} [input.recordedLifecycleStatus]
 * @param {Array} [input.sources]         governed product sources
 * @param {Array} [input.lifecycleEvents]
 * @param {Array} [input.conflictingSources] other authorities for section 18
 */
export function normalizeFireAlarmPanelCapability(input = {}) {
  const description = String(input.description ?? "");
  const partNumber = String(input.partNumber ?? "").trim();

  // Reuse the proven extraction rules, then add this slice's dimensions.
  const baseAttributes = extractFireAlarmProductAttributes({ description, family: input.family ?? null });
  const attributes = [...baseAttributes, ...extractCapabilities(description)];

  const capacities = attributes.map(buildCapacityRecord).filter(Boolean);
  const capabilities = attributes.filter((attribute) => !buildCapacityRecord(attribute));
  const conflicts = detectCapacityConflicts([
    { sourceId: input.primarySourceId ?? null, sourceType: "MANUFACTURER_DOCUMENT", capacities },
    ...(input.conflictingSources || []),
  ]);

  const ecosystem = normalizeEcosystemIdentity({
    manufacturer: input.manufacturer,
    brand: input.brand,
    declaredEcosystem: input.declaredEcosystem,
  });

  return {
    version: FIRE_ALARM_PANEL_CAPABILITY_VERSION,
    // Section 5/6/31 -- the four levels are reported separately and never merged.
    identity: {
      manufacturer: String(input.manufacturer ?? "").trim() || null,
      brand: String(input.brand ?? "").trim() || null,
      ecosystem: ecosystem.ecosystem,
      ecosystemBasis: ecosystem.basis,
      family: String(input.family ?? "").trim() || null,
      model: partNumber || null,
      canonicalPartNumber: canonicalPartNumber(partNumber) || null,
      variantSuffixes: partNumber.replace(/^[A-Z]+-?/i, "").match(/[A-Z]{2,}(?=$|-)/gi) || [],
    },
    capabilities,
    capacities,
    capacityConflicts: conflicts,
    protocols: extractProtocols(description),
    certifications: normalizeCertifications({ description, sources: input.sources || [] }),
    expansionRelationships: buildExpansionRelationships(attributes),
    // The canonical `slc_address_model` attribute value, as stored on
    // `product_attributes`. `null` when absent or unrecognised -- reported as
    // absent rather than defaulted, because a wrong default mis-sizes panels.
    addressModel: normalizeAddressModel(input.slcAddressModel ?? input.addressModel ?? null),
    lifecycle: normalizeLifecycle({
      recordedStatus: input.recordedLifecycleStatus ?? null,
      lifecycleEvents: input.lifecycleEvents || [],
    }),
    sizingReadiness: assessSizingReadiness({ capacities, conflicts }),
    // Section 38 -- the contract GOLDEN-7B will consume. This module supplies
    // the data; it never evaluates a project's requirements.
    consumptionContract: {
      eligibleQueryInputs: ["ecosystem", "requiredCertifications", "requiredNetworkCapability", "requiredAdvancedFeatures", "requiredPointDemand", "requiredAddressModel"],
      providedFields: ["capabilities", "capacities", "certifications", "protocols", "expansionRelationships", "lifecycle", "sizingReadiness", "addressModel"],
    },
    // Section 4/36/37 -- the invariants that make this a bottom-up product layer.
    productCapabilityOnly: true,
    projectRequirementRead: false,
    projectSelectionProduced: false,
  };
}
