// R7-P2 -- governed Fire Alarm SLC resource classification.
//
// This module classifies ONE already-governed BOQ item. It does not inspect
// free text, discover products, aggregate project demand, allocate panels, or
// authorize a panel. A caller must supply the governed Fire Alarm family and
// technical attributes already approved by the existing understanding/profile
// path. Unsupported device types remain UNRESOLVED rather than being forced
// into the current detector/module calculator.
//
// GOLDEN-6C3B -- SLC ROLE IS NOW SEPARATE FROM POINT CONSUMPTION
// ---------------------------------------------------------------
// These two concerns were coupled: a family was either accepted with a hardcoded
// one-point-per-device, or refused outright. That coupling made a governed
// canonical family unreachable whenever its consumption was not evidenced, and
// it hid the fact that this repository records NO point-consumption evidence at
// all. Every output now carries an `slcRole` alongside its demand, and a family
// whose role is established but whose consumption is not evidenced returns
// `SLC_ROLE_ESTABLISHED` with a null demand -- which the 6C demand engine
// correctly books as UNKNOWN, never as zero.
//
// The two established pools keep their existing one-point contract and their
// existing state names, so no previously-governed output changes.

import { resolveFireAlarmSlcRole, normalizeFamilyName, FIRE_ALARM_FAMILY_TAXONOMY_VERSION } from "./fire-alarm-family-taxonomy.mjs";

export const SLC_RESOURCE_CLASSIFIER_VERSION = "fire-alarm-slc-resource-classifier-1.3.0";
export const SLC_RESOURCE_STATES = Object.freeze([
  "SLC_DETECTOR_POOL",
  "SLC_MODULE_POOL",
  // GOLDEN-6C3B: the family's role on the signalling loop is governed and known,
  // but the number of SLC addresses a unit consumes is not evidenced anywhere in
  // this repository. Carries a null demand on purpose.
  "SLC_ROLE_ESTABLISHED",
  "NOT_SLC",
  "UNRESOLVED",
]);


const normalized = (value) => String(value ?? "").trim().toLowerCase();
const factValue = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value.value ?? value.normalizedValue ?? value.originalValue ?? null;
  return value;
};
const attributeValue = (attributes, names) => {
  for (const name of names) {
    const value = factValue(attributes?.[name]);
    if (value !== null && value !== undefined && value !== "") return String(value).trim();
  }
  return null;
};
const numericAttribute = (attributes, names) => {
  const raw = attributeValue(attributes, names);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

// Families that contribute exactly ONE SLC address per device.
//
// Membership here is a CONSUMPTION claim, and every member needs product-level
// evidence that a single unit occupies one address on the loop. That is why the
// set is a closed list rather than "anything whose role is SLC_FIELD_DEVICE".
//
// PULL STATION -- CORRECTED TWICE. It was ORIGINALLY added here as a
// detector-pool family, which was WRONG. NOTIFIER NBG-12LX (DN-6726) is a
// two-wire SLC device whose internal addressable element is a MODULE: the
// installation manual describes "the addressable module is housed inside the
// pull station", and the programming note classifies it as an "Alarm Initiating
// Module of software type 'mpul'". It is therefore programmed and counted as a
// module-class point and consumes the MODULE-side address resource. Brand
// category ("manual station") is not the address class; the internal device is.
//
// DUCT DETECTOR -- newly RESOLVED 2026-09-30. This family previously stayed
// SLC_ROLE_ESTABLISHED with null demand because no duct detector product
// existed in the repository to evidence its consumption. It is now evidenced.
// An addressable duct detector is a TWO-PART assembly whose ONLY addressable
// element is the plug-in detector head:
//   - Honeywell DNR / DNRW (DN-60429, DNR-Datasheet): "DNR: Intelligent
//     NON-RELAY photoelectric low flow smoke detector housing. REQUIRES
//     photoelectric smoke detector (SOLD SEPARATELY)." A non-relay housing
//     performs no addressable function of its own.
//   - DN-60977: "The FSP-951R is a remote test capable detector for use with
//     DNR Series duct detector housings", and "Each FSP-951 Series detector
//     uses one of the panel's addresses on the NOTIFIER SLC."
// So the assembly consumes exactly ONE detector-side address, carried by the
// head. The housing, the sampling tube and the remote test station are
// mechanical / non-SLC and must never be counted as a second point. The
// project agrees: specification clause requires "an intelligent NON RELAY
// photoelectric type", which is precisely what a DNR/DNRW is.
// The optional relay/control module that a DNRW "can also accommodate" is an
// add-on sold separately and is NOT part of the 45.
const DETECTOR_FAMILIES = new Set([
  "Addressable Smoke Detector",
  "Addressable Heat Detector",
  "Multi-Criteria Detector",
  "Duct Detector",
]);
// Module-pool families. Pull Station joins here on the NBG-12LX evidence cited
// above: its addressable element is a module ("mpul", an alarm initiating
// module), so it draws one MODULE address per device from the 159-per-loop
// module resource rather than from the detector resource.
const MODULE_FAMILIES = new Set([
  "Monitor Module",
  "Control Module",
  "Input Module",
  "Output Module",
  "Relay Module",
  "Isolator Module",
  "Zone Module",
  "Pull Station",
  "Firephone Control Module",
]);

const ACCESSORY_FAMILIES = new Set([
  "Detector Base",
  "Sounder Base",
  "Isolator Base",
  "Enclosure",
  "Back Box",
  "Weatherproof Box",
  "Bracket",
  "Guard",
  "End-of-Line Device",
]);
const NOT_SLC_FAMILIES = new Set([
  "Fire Alarm Control Panel",
  "Loop Card",
  "Battery",
  "Battery Charger",
  "Power Supply",
  "Conventional Detector",
  // Duct detector HOUSINGS. NON-RELAY, and they "require photoelectric smoke
  // detector (sold separately)" (Honeywell DNR/DNRW, DN-60429). A housing has
  // no addressable element, so it adds no SLC point. The address belongs to
  // the FSP-951R head; see DETECTOR_FAMILIES.
  "Duct Detector Housing",
  "Sampling Tube",
  "Remote Test Station",
  // FIREMAN TELEPHONE JACK -- newly RESOLVED 2026-09-30. This previously
  // stayed SLC_ROLE_ESTABLISHED with null demand. It is now established that
  // the jack is NOT an SLC point:
  //   - The project requirement describes a PASSIVE field device: "each fire
  //     fighter's telephone jack should feature a single phone jack mounted on
  //     a standard single gang stainless steel plate" and the plate "must ...
  //     fit any standard single gang box". Nothing in a single-gang box is an
  //     addressable SLC device.
  //   - NOTIFIER N-FPJ, the governed jack for this ecosystem, is a Remote Phone
  //     Jack that merely "provides a plug-in location for the FHS-F" handset
  //     (Honeywell NFC-FFT datasheet DN-60779).
  //   - The comparable Honeywell FFT-FPJ states the electrical fact outright:
  //     "The FFT-FPJ is a PASSIVE DEVICE that does not draw a current." Its
  //     annunciation comes from a SEPARATE monitor module, not from the jack.
  // The addressable telephone interface is the Firephone Control Module, which
  // is a distinct, separately-quantified line (see MODULE_FAMILIES). One jack
  // must never be inferred to be one module.
  "Fireman Telephone Jack",
  "Firefighter Phone Jack",
  // "Interface Module" in this project's BOQ denotes the FIREMAN TELEPHONE
  // JACK line, not an addressable interface module. The genuinely addressable
  // lines are separately categorised as "Interface module control" and
  // "Interface module monitor", which map to Control Module and Monitor Module.
  "Interface Module",
]);
const UNRESOLVED_FAMILIES = new Set([
  // "Duct Detector", "Interface Module" and "Pull Station" were REMOVED from
  // this set on 2026-09-30. Each now has product-level consumption evidence and
  // is classified by DETECTOR_FAMILIES / MODULE_FAMILIES / NOT_SLC_FAMILIES
  // above. Leaving them here as well would be contradictory, and the ordering
  // below would silently re-shadow the resolved answer.
  //
  // "Heat Detector" and "Smoke Detector" (unsuffixed) are retained on purpose:
  // they denote CONVENTIONAL, non-addressable devices, and an addressability
  // decision per line is still required before they may be booked as zero.
  // "Zone Interface Module" is retained because no product in this repository
  // evidences its addresses-per-unit.
  //
  // "Manual Call Point" is retained HERE, and the distinction is the whole
  // point. First-party evidence proves the POOL: IDP-PULL-DA and IDP-PULL-SA
  // both carry product_attributes.slc_address_model = HOUSED_MODULE_OWN_ADDRESS
  // (review_status Approved, each bound to a first-party product source), and
  // LS10179-000FH-E:B s11.2.1 cross-references "Setting the SLC Address for a
  // Single Point IDP/SK Module" and "module addresses 01 - 159". So a manual
  // call point draws from the MODULE address pool, not the detector pool --
  // which matters, because the panel states 159 detectors AND 159 modules as
  // two separate pools.
  //
  // What that evidence does NOT establish is a units-per-device consumption
  // contract, and the project's own golden gate (GOLDEN-6C3B) deliberately holds
  // this family at "role established, consumption still unevidenced". Moving it
  // into MODULE_FAMILIES would book one point per device and would break that
  // gate, so the pool finding is recorded here rather than enacted by moving the
  // family. Promoting the canonical ROLE from SLC_FIELD_DEVICE to SLC_MODULE is
  // therefore a human engineering decision, not a code change: it moves a
  // golden-gated role and would also require moving "manual initiation" in
  // SLC_ROLE_DOMAINS.
  //
  // Notification appliance families are retained here, and this is deliberate
  // policy rather than an omission: they sit on the NAC, not the SLC, and a
  // per-line addressability decision is still required before any of them may be
  // booked as a settled zero. Their canonical family ROLE is already NOT_SLC
  // (see FIRE_ALARM_DOMAIN_SLC_ROLES), so the refusal below is about missing
  // EVIDENCE, not about the family being unclassifiable. A generic label such as
  // "Sounder" or "Strobe" is NOT sufficient authority for a zero, and the
  // project notification-architecture decision governs delivery topology -- it
  // does not by itself prove the addressability of any individual line.
  "Heat Detector",
  "Smoke Detector",
  "Manual Call Point",
  "Manual Station",
  "Break Glass Unit",
  "Zone Interface Module",
  "Strobe",
  "Sounder",
  "Sounder/Strobe",
  "Bell",
  "Horn",
  "Speaker",
]);

const isMultiAddressEvidence = (attributes) => {
  const explicit = normalized(attributes?.slc_addressing || attributes?.addressing_mode || attributes?.point_behavior || attributes?.slc_point_behavior);
  if (["multi-address", "multi_address", "multi-channel", "multi_channel", "dual-address", "dual_address"].includes(explicit)) return true;
  for (const names of [["channel_count"], ["address_count"], ["slc_address_count"], ["slc_point_count"], ["point_count"], ["points_per_device"]]) {
    const value = numericAttribute(attributes, names);
    if (value !== null && value > 1) return true;
  }
  return false;
};

// SECONDARY INTERFACE DEMAND -- STRUCTURALLY SEPARATE FROM DIRECT SLC DEMAND.
//
// A proven DIRECT SLC address of zero is a statement about THIS device on THIS
// signalling loop. It is never a statement about the project's total downstream
// resource demand. Three real cases in this repository prove why the two axes
// cannot collapse into one number:
//
//   * Fireman Telephone Jack: the jack is a PASSIVE single-gang plate that draws
//     no current (Honeywell FFT-FPJ DN-60779: "a PASSIVE DEVICE that does not
//     draw a current"), so its DIRECT demand is a proven 0 -- but its annunciation
//     comes from a SEPARATE, separately-quantified Firephone Control Module.
//     One jack must never be inferred to be one module.
//   * Duct Detector Housing: a DNR/DNRW non-relay housing has no addressable
//     element of its own (DIRECT 0), yet the assembly's single detector point is
//     carried by the separately-quantified FSP-951R head.
//   * Notification appliances: a conventional-NAC appliance consumes no SLC
//     address (DIRECT 0 on the accepted architecture), while the NAC circuit and
//     any control module remain real, separately-quantified downstream demand.
//
// Therefore every classification carries an explicit SECONDARY INTERFACE axis,
// which defaults to UNRESOLVED and is only ever PROVEN by the closed evidence
// table below. A family absent from the table is NOT "no secondary demand" -- it
// is UNRESOLVED, and an unresolved secondary axis never books a zero.
export const SECONDARY_INTERFACE_STATES = Object.freeze(["UNRESOLVED", "SEPARATE_DEVICE_REQUIRED", "PROVEN_ZERO"]);

const SECONDARY_INTERFACE_BY_FAMILY = new Map([
  ["Fireman Telephone Jack", { state: "SEPARATE_DEVICE_REQUIRED", separateDevice: "Firephone Control Module", basis: "The jack is a passive plate; its SLC interface is the separately-quantified Firephone Control Module." }],
  ["Firefighter Phone Jack", { state: "SEPARATE_DEVICE_REQUIRED", separateDevice: "Firephone Control Module", basis: "The jack is a passive plate; its SLC interface is the separately-quantified Firephone Control Module." }],
  ["Duct Detector Housing", { state: "SEPARATE_DEVICE_REQUIRED", separateDevice: "FSP-951 Series detector head", basis: "A non-relay housing has no addressable element; the assembly's detector point is carried by the separately-quantified plug-in head." }],
  ["Sampling Tube", { state: "SEPARATE_DEVICE_REQUIRED", separateDevice: "Duct detector assembly", basis: "Sampling tubing is mechanical; the SLC point belongs to the detector assembly it serves." }],
]);

// Wiring and material scope is the ONE place a zero secondary axis is provable:
// cable, conduit and containment have no upstream and no downstream control
// interface at all. Nothing else in this table may ever produce PROVEN_ZERO.
const SECONDARY_INTERFACE_PROVEN_ZERO_FAMILIES = new Set(["", "WIRING_MATERIAL_SCOPE"]);

const resolveSecondaryInterface = ({ family, slcRoleBasis }) => {
  const governedFamily = family ? String(family).trim() : "";
  const entry = SECONDARY_INTERFACE_BY_FAMILY.get(governedFamily);
  if (entry) return { ...entry, reason: entry.basis };
  if (SECONDARY_INTERFACE_PROVEN_ZERO_FAMILIES.has(governedFamily) || slcRoleBasis === "WIRING_CATEGORY_RULE") {
    return { state: "PROVEN_ZERO", separateDevice: null, reason: "Wiring and material scope has no upstream or downstream control interface." };
  }
  return {
    state: "UNRESOLVED",
    separateDevice: null,
    reason: "No governed secondary-interface authority exists for this family. A direct SLC address of zero would NOT by itself establish that total downstream resource demand is zero.",
  };
};

// The DIRECT SLC axis, stated per DEVICE and never as a project total. It is
// derived from the SAME classification that produced the state, so the two can
// never disagree, and it is null whenever the classification is unresolved --
// unknown is never booked as zero.
const directSlcPerDevice = (state, unitsPerDevice) => {
  if (state === "NOT_SLC") return 0;
  if (state === "SLC_DETECTOR_POOL" || state === "SLC_MODULE_POOL") {
    return Number.isFinite(Number(unitsPerDevice)) ? Number(unitsPerDevice) : null;
  }
  return null;
};

// ============================================================================
// GOVERNED ADDRESSABILITY AUTHORITY -- THE SECOND, INDEPENDENT ADDRESSABILITY
// CHANNEL (1.3.0)
// ============================================================================
// The classifier historically had exactly ONE way to learn that a device was
// addressable: a governed technical attribute reading "addressable". That
// channel is still honoured and is unchanged.
//
// This channel is the manufacturer's own statement of address behaviour, read
// through `app/domain/governed-slc-addressability.mjs` from the Approved
// `slc_address_model` product fact. It is added because it is the fact that
// actually decides the question, and because without it a family can never be
// booked no matter how good its evidence is.
//
// THE INVARIANT THIS CHANNEL MUST NOT BREAK. Family alone must never imply
// consumption. That is preserved structurally: the channel contributes only
// WHETHER an address is consumed and HOW MANY -- never WHICH pool. The pool
// still comes from the governed family role, exactly as before. So a MODULE
// family with no approved address model remains unresolved, and a MODULE family
// whose approved model is NON_SLC becomes a proven zero rather than a booking.
//
// It is also never a fallback in the permissive direction: an UNRESOLVED
// authority leaves every existing outcome exactly as it was.
const readAddressabilityAuthority = (authority) => {
  const isAuthoritative = authority?.state === "AUTHORITATIVE";
  const addresses = isAuthoritative ? Number(authority.addressesConsumedPerDevice) : Number.NaN;
  return {
    authority: authority || null,
    isAuthoritative,
    addressModel: isAuthoritative ? authority.addressModel ?? null : null,
    basis: isAuthoritative ? authority.basis ?? null : null,
    contextRequired: isAuthoritative ? authority.contextRequired ?? null : null,
    refusedAt: authority?.code ?? null,
    // Proven no-address: the manufacturer says this device takes no SLC address.
    provesNoAddress: isAuthoritative && authority.consumesSlcAddress === false,
    // Occupies a pool: consumes at least one address of its own.
    grantsAddress: isAuthoritative && authority.consumesSlcAddress === true
      && Number.isFinite(addresses) && addresses > 0,
    // Sits on the loop but adds no address of its own (SHARED_WITH_DETECTOR).
    sharedNoAdditionalAddress: isAuthoritative && authority.consumesSlcAddress === true
      && Number.isFinite(addresses) && addresses === 0,
    addressesConsumedPerDevice: Number.isFinite(addresses) ? addresses : null,
  };
};

const addressabilityProvenance = (read) => ({
  addressabilityAuthority: read.isAuthoritative ? "APPROVED_ADDRESS_MODEL" : null,
  addressabilityAuthorityVersion: read.authority?.provenance?.resolverVersion ?? null,
  addressModel: read.addressModel,
  addressModelBasis: read.basis,
  addressabilityRefusedAt: read.isAuthoritative ? null : read.refusedAt,
  addressesPerUnitBasis: read.grantsAddress
    ? "APPROVED_MANUFACTURER_ADDRESS_MODEL"
    : null,
});

// The governed addressability question, asked once, from BOTH channels. A
// family is addressable when either an approved technical attribute says so, or
// an approved manufacturer address model consumes an address of its own.
const addressabilityProven = (attributeAddressability, read) =>
  normalized(attributeAddressability) === "addressable" || read.grantsAddress;

const quantityStatus = (quantity) => {
  if (!quantity || String(quantity.status || "").trim().toUpperCase() === "CONFLICT") return "CONFLICT";
  if (quantity.value === null || quantity.value === undefined || !Number.isFinite(Number(quantity.value)) || Number(quantity.value) < 0) return "UNKNOWN";
  return "VALID";
};

export function resolveSlcDemandQuantity(quantity, unitsPerDevice = 1) {
  const status = quantityStatus(quantity);
  if (status !== "VALID") return { ...(quantity || {}), unitsPerDevice, value: null, total: null, status };
  const value = Number(quantity.value);
  const units = Number(unitsPerDevice);
  if (!Number.isFinite(value) || !Number.isFinite(units) || units <= 0) return { ...quantity, unitsPerDevice: unitsPerDevice ?? null, value: null, total: null, status: "UNKNOWN" };
  return { ...quantity, unitsPerDevice: units, value, total: value * units, status: "VALID" };
}

const unresolved = ({ family, addressability, reason, attributes, quantity, unitsPerDevice = null, slcRole = "UNRESOLVED", read = null }) => ({
  state: "UNRESOLVED",
  slcRole,
  directSlcPerDevice: null,
  secondaryInterface: resolveSecondaryInterface({ family, slcRoleBasis: null }),
  family: family || null,
  addressability: addressability || null,
  unitsPerDevice,
  demandUnits: null,
  quantity: resolveSlcDemandQuantity(quantity, unitsPerDevice),
  classifierVersion: SLC_RESOURCE_CLASSIFIER_VERSION,
  reason,
  provenance: {
    family: family || null,
    addressability: addressability || null,
    technicalRole: attributeValue(attributes, ["technical_role", "device_role", "engineering_role"]) || null,
    familyTaxonomy: FIRE_ALARM_FAMILY_TAXONOMY_VERSION,
    normalizedFamily: normalizeFamilyName(family),
    ...addressabilityProvenance(read || { isAuthoritative: false, addressModel: null, basis: null, refusedAt: null, grantsAddress: false }),
    evidenceAttributes: ["addressing", "addressability", "technology", "technical_role", "device_role", "engineering_role", "slc_addressing", "addressing_mode", "point_behavior", "slc_point_behavior", "channel_count", "address_count", "slc_address_count", "slc_point_count", "point_count", "points_per_device"].filter((name) => attributes?.[name] != null),
  },
});

/**
 * GOLDEN-6C3B -- the role-established, consumption-unknown outcome.
 *
 * This is the honest state for a governed family whose role on the signalling
 * loop IS established while the number of SLC addresses a unit consumes is not
 * evidenced anywhere in this repository. It carries a NULL demand, so the 6C
 * demand engine books it as UNKNOWN rather than as zero, and it is deliberately
 * NOT one of the two pool states, so panel sizing continues to fail closed on
 * it rather than allocating capacity it cannot justify.
 */
const roleEstablished = ({ family, addressability, slcRole, attributes, quantity, reason, read = null, contextRequired = null }) => ({
  state: "SLC_ROLE_ESTABLISHED",
  slcRole,
  directSlcPerDevice: null,
  secondaryInterface: resolveSecondaryInterface({ family, slcRoleBasis: "CANONICAL_FAMILY_TAXONOMY" }),
  family: family || null,
  addressability: addressability || null,
  unitsPerDevice: null,
  demandUnits: null,
  quantity: resolveSlcDemandQuantity(quantity, null),
  classifierVersion: SLC_RESOURCE_CLASSIFIER_VERSION,
  reason,
  // Reported rather than resolved. SHARED_WITH_DETECTOR is exactly this case:
  // the pairing that would turn it into a count is a project fact, not a
  // product fact.
  ...(contextRequired ? { contextRequired } : {}),
  provenance: {
    family: family || null,
    addressability: addressability || null,
    technicalRole: attributeValue(attributes, ["technical_role", "device_role", "engineering_role"]) || null,
    familyTaxonomy: FIRE_ALARM_FAMILY_TAXONOMY_VERSION,
    normalizedFamily: normalizeFamilyName(family),
    slcRoleBasis: "CANONICAL_FAMILY_TAXONOMY",
    consumptionAuthority: null,
    ...addressabilityProvenance(read || { isAuthoritative: false, addressModel: null, basis: null, refusedAt: null, grantsAddress: false }),
    evidenceAttributes: ["addressing", "addressability", "technology", "technical_role", "device_role", "engineering_role"].filter((name) => attributes?.[name] != null),
  },
});

// Wiring/material scope is never an SLC addressable device, under any
// manufacturer, protocol or panel. Cable, conduit and containment consume no
// SLC addresses by physical necessity -- they carry no address, draw no loop
// polling slot, and are not polled. This rule therefore keys on the BOQ
// CATEGORY (wiring scope), not on any product family, and it deliberately
// does NOT force a product family onto wiring rows merely to satisfy the
// classifier. It is evaluated before the system/family gates so an
// Electrical-system cable and a Fire-Alarm-system cable settle identically:
// neither occupies the Fire Alarm SLC.
const WIRING_CATEGORY_PATTERN = /\bcabl\w*\b|\bwir\w*\b|\bconduit\b|\bcontainment\b|\btrunking\b/i;

const isWiringScope = (category) => {
  if (category === null || category === undefined) return false;
  return WIRING_CATEGORY_PATTERN.test(String(category));
};

export function classifyFireAlarmSlcItem({ system, family, category = null, attributes = {}, selectedQuantity = null, addressabilityAuthority = null } = {}) {
  const governedSystem = normalized(system);
  const governedFamily = family ? String(family).trim() : null;
  const governedCategory = category ? String(category).trim() : null;
  const addressability = attributeValue(attributes, ["addressing", "addressability", "technology"]);
  const technicalRole = attributeValue(attributes, ["technical_role", "device_role", "engineering_role"]);
  const quantity = selectedQuantity || { value: null, source: null, decisionId: null };
  const read = readAddressabilityAuthority(addressabilityAuthority);

  if (isWiringScope(governedCategory)) {
    return {
      state: "NOT_SLC",
      slcRole: "NOT_SLC",
      directSlcPerDevice: 0,
      secondaryInterface: resolveSecondaryInterface({ family: "WIRING_MATERIAL_SCOPE", slcRoleBasis: "WIRING_CATEGORY_RULE" }),
      family: governedFamily,
      category: governedCategory,
      addressability,
      unitsPerDevice: 0,
      demandUnits: 0,
      quantity: resolveSlcDemandQuantity(quantity, 0),
      classifierVersion: SLC_RESOURCE_CLASSIFIER_VERSION,
      reason: `BOQ category "${governedCategory}" is wiring/material scope, not an SLC addressable device. Preserved for BOM/commercial scope; consumes no SLC addresses.`,
      provenance: {
        family: governedFamily,
        category: governedCategory,
        addressability: addressability || null,
        technicalRole: technicalRole || null,
        familyTaxonomy: FIRE_ALARM_FAMILY_TAXONOMY_VERSION,
        normalizedFamily: normalizeFamilyName(governedFamily),
        slcRoleBasis: "WIRING_CATEGORY_RULE",
        consumptionAuthority: "PHYSICAL_NECESSITY",
        ...addressabilityProvenance(read),
      },
    };
  }

  if (governedSystem !== "fire alarm" || !governedFamily) return unresolved({ family: governedFamily, addressability, attributes, quantity, read, reason: "Governed Fire Alarm system and family are required." });
  if (isMultiAddressEvidence(attributes)) return unresolved({ family: governedFamily, addressability, attributes, quantity, read, reason: "Multi-address or multi-channel behavior has no governed units-per-device contract." });

  // A GOVERNED PRODUCT FACT OF NO SLC ADDRESS is a proven zero, and it is
  // allowed to settle a line that its family alone would have booked. This is
  // the only case where the address model overrides a family role, and it is
  // deliberately one-directional: a proven no-address fact can zero a line, but
  // it can never promote one. Without it, a family taxonomy would keep booking
  // devices the manufacturer says consume nothing.
  if (read.provesNoAddress) {
    return {
      state: "NOT_SLC",
      slcRole: "NOT_SLC",
      directSlcPerDevice: 0,
      secondaryInterface: resolveSecondaryInterface({ family: governedFamily, slcRoleBasis: "CANONICAL_FAMILY_TAXONOMY" }),
      family: governedFamily,
      addressability,
      unitsPerDevice: 0,
      demandUnits: 0,
      quantity: resolveSlcDemandQuantity(quantity, 0),
      classifierVersion: SLC_RESOURCE_CLASSIFIER_VERSION,
      reason: `Approved manufacturer address model ${read.addressModel} states this device consumes no SLC address, so the governed product fact settles the line at zero rather than leaving the family taxonomy to guess. ${read.basis || ""}`.trim(),
      provenance: {
        family: governedFamily,
        addressability: addressability || null,
        technicalRole: technicalRole || null,
        familyTaxonomy: FIRE_ALARM_FAMILY_TAXONOMY_VERSION,
        normalizedFamily: normalizeFamilyName(governedFamily),
        slcRoleBasis: "APPROVED_ADDRESS_MODEL",
        consumptionAuthority: "APPROVED_MANUFACTURER_NO_SLC_ADDRESS",
        ...addressabilityProvenance(read),
      },
    };
  }

  // The canonical role comes from the governed family taxonomy, never from the
  // legacy hardcoded sets and never from the description.
  const { role: slcRole, reason: roleReason } = resolveFireAlarmSlcRole(governedFamily);

  // The exclusion decision stays EXACTLY where it was. The taxonomy records a
  // NOT_SLC role for control equipment, accessories, power and notification
  // families, but this lane does not act on that role to reclassify anything:
  // promoting a family from UNRESOLVED to NOT_SLC moves its units out of the
  // `unknown` bucket and into a settled zero, and the 6C contract is explicit
  // that unknown demand must stay visible rather than be booked as zero. So the
  // established exclusion sets remain the authority for exclusion, and the
  // taxonomy role below is provenance plus a route to ROLE_ESTABLISHED.
  if (NOT_SLC_FAMILIES.has(governedFamily) || ACCESSORY_FAMILIES.has(governedFamily)) {
    return { state: "NOT_SLC", slcRole: "NOT_SLC", directSlcPerDevice: 0, secondaryInterface: resolveSecondaryInterface({ family: governedFamily, slcRoleBasis: "CANONICAL_FAMILY_TAXONOMY" }), family: governedFamily, addressability, unitsPerDevice: 0, demandUnits: 0, quantity: resolveSlcDemandQuantity(quantity, 0), classifierVersion: SLC_RESOURCE_CLASSIFIER_VERSION, reason: "Family is a capacity provider, accessory, conventional device, or non-SLC equipment; it does not add an SLC pool point.", provenance: { family: governedFamily, addressability, technicalRole, familyTaxonomy: FIRE_ALARM_FAMILY_TAXONOMY_VERSION, normalizedFamily: normalizeFamilyName(governedFamily), slcRoleBasis: "CANONICAL_FAMILY_TAXONOMY", ...addressabilityProvenance(read) } };
  }

  // THE ADDRESS COUNT, once, from the channel that actually carries it. The
  // approved manufacturer address model states HOW MANY; the legacy
  // "addressable" attribute states only that the device is addressable at all,
  // so it yields the single-point default. Family alone still contributes
  // nothing here.
  const unitsPerDevice = read.grantsAddress
    ? read.addressesConsumedPerDevice
    : 1;
  const addressabilitySource = read.grantsAddress
    ? `Approved manufacturer address model ${read.addressModel}`
    : "governed addressable technical attribute";

  if (DETECTOR_FAMILIES.has(governedFamily)) {
    if (quantityStatus(quantity) === "CONFLICT") return unresolved({ family: governedFamily, addressability, attributes, quantity, slcRole: "SLC_FIELD_DEVICE", read, reason: "Governed quantity conflict cannot produce SLC demand." });
    if (read.sharedNoAdditionalAddress) return roleEstablished({ family: governedFamily, addressability, slcRole: "SLC_FIELD_DEVICE", attributes, quantity, read, contextRequired: read.contextRequired, reason: `Approved address model ${read.addressModel} states this detector family adds no SLC address of its own, so no detector pool point is booked. ${read.contextRequired}` });
    if (!addressabilityProven(addressability, read)) return unresolved({ family: governedFamily, addressability, attributes, quantity, slcRole: "SLC_FIELD_DEVICE", read, reason: `Detector family requires governed addressable evidence. The approved address model, where one exists, reports ${read.addressabilityRefusedAt || "no consumption"}.` });
    return { state: "SLC_DETECTOR_POOL", slcRole: "SLC_FIELD_DEVICE", directSlcPerDevice: directSlcPerDevice("SLC_DETECTOR_POOL", unitsPerDevice), secondaryInterface: resolveSecondaryInterface({ family: governedFamily, slcRoleBasis: "CANONICAL_FAMILY_TAXONOMY" }), family: governedFamily, addressability, unitsPerDevice, demandUnits: resolveSlcDemandQuantity(quantity, unitsPerDevice).total, quantity: resolveSlcDemandQuantity(quantity, unitsPerDevice), classifierVersion: SLC_RESOURCE_CLASSIFIER_VERSION, reason: `Governed addressable detector family contributes ${unitsPerDevice} SLC detector point(s) per device, on the authority of ${addressabilitySource}.`, provenance: { family: governedFamily, addressability, technicalRole, familyTaxonomy: FIRE_ALARM_FAMILY_TAXONOMY_VERSION, normalizedFamily: normalizeFamilyName(governedFamily), slcRoleBasis: "CANONICAL_FAMILY_TAXONOMY", consumptionAuthority: read.grantsAddress ? "APPROVED_MANUFACTURER_ADDRESS_MODEL" : "ESTABLISHED_ONE_POINT_PER_DEVICE", ...addressabilityProvenance(read) } };
  }

  if (MODULE_FAMILIES.has(governedFamily)) {
    if (quantityStatus(quantity) === "CONFLICT") return unresolved({ family: governedFamily, addressability, attributes, quantity, slcRole: "SLC_MODULE", read, reason: "Governed quantity conflict cannot produce SLC demand." });
    if (read.sharedNoAdditionalAddress) return roleEstablished({ family: governedFamily, addressability, slcRole: "SLC_MODULE", attributes, quantity, read, contextRequired: read.contextRequired, reason: `Approved address model ${read.addressModel} states this module family adds no SLC address of its own, so no module pool point is booked. ${read.contextRequired}` });
    if (!addressabilityProven(addressability, read)) return unresolved({ family: governedFamily, addressability, attributes, quantity, slcRole: "SLC_MODULE", read, reason: `Module family requires governed addressable evidence. A MODULE family does not imply module-address consumption on its own; the approved address model, where one exists, reports ${read.addressabilityRefusedAt || "no consumption"}.` });
    return { state: "SLC_MODULE_POOL", slcRole: "SLC_MODULE", directSlcPerDevice: directSlcPerDevice("SLC_MODULE_POOL", unitsPerDevice), secondaryInterface: resolveSecondaryInterface({ family: governedFamily, slcRoleBasis: "CANONICAL_FAMILY_TAXONOMY" }), family: governedFamily, addressability, unitsPerDevice, demandUnits: resolveSlcDemandQuantity(quantity, unitsPerDevice).total, quantity: resolveSlcDemandQuantity(quantity, unitsPerDevice), classifierVersion: SLC_RESOURCE_CLASSIFIER_VERSION, reason: `Governed addressable module family contributes ${unitsPerDevice} SLC module point(s) per device, on the authority of ${addressabilitySource}.`, provenance: { family: governedFamily, addressability, technicalRole, familyTaxonomy: FIRE_ALARM_FAMILY_TAXONOMY_VERSION, normalizedFamily: normalizeFamilyName(governedFamily), slcRoleBasis: "CANONICAL_FAMILY_TAXONOMY", consumptionAuthority: read.grantsAddress ? "APPROVED_MANUFACTURER_ADDRESS_MODEL" : "ESTABLISHED_ONE_POINT_PER_DEVICE", ...addressabilityProvenance(read) } };
  }

  // GOLDEN-6C3B: a governed canonical family whose SLC role is established, but
  // for which this repository evidences no units-per-device contract. It is
  // recognized, and its point consumption is withheld rather than defaulted.
  if (slcRole === "SLC_FIELD_DEVICE" || slcRole === "SLC_MODULE") {
    if (!addressabilityProven(addressability, read)) {
      return unresolved({ family: governedFamily, addressability, attributes, quantity, slcRole, read, reason: "Governed family role is established, but governed addressable evidence is required before it can occupy an addressable SLC pool." });
    }
    if (quantityStatus(quantity) === "CONFLICT") return unresolved({ family: governedFamily, addressability, attributes, quantity, slcRole, read, reason: "Governed quantity conflict cannot produce SLC demand." });
    // SHARED_WITH_DETECTOR: the device is on the loop but adds no address of its
    // own, so it must NOT be booked as a pool point. The pairing that would
    // resolve it is a project fact, so consumption is reported as required-not-
    // determined rather than settled at one.
    if (read.sharedNoAdditionalAddress) {
      return roleEstablished({
        family: governedFamily,
        addressability,
        slcRole,
        attributes,
        quantity,
        read,
        contextRequired: read.contextRequired,
        reason: `Governed family role is established as ${slcRole}, and the approved address model ${read.addressModel} states the device adds no SLC address of its own. No pool point is booked: ${read.contextRequired}`,
      });
    }
    const consumptionNote = slcRole === "SLC_MODULE"
      ? "A module of this name may be single input, dual input, input/output, or a multi-module assembly; these consume different numbers of SLC addresses."
      : "This repository records no governed SLC address-consumption evidence for this family, and one address per device is not assumed from industry convention.";
    return roleEstablished({
      family: governedFamily,
      addressability,
      slcRole,
      attributes,
      quantity,
      read,
      reason: `Governed family role is established as ${slcRole}, but point consumption is not established. ${consumptionNote}`,
    });
  }

  // The remaining families: a role the taxonomy can name, or none at all. The
  // role travels with the refusal so the decision stays explainable (a
  // notification appliance is UNRESOLVED *and* canonically NOT_SLC -- the
  // refusal is about missing evidence, not about the family being unclassifiable).
  if (UNRESOLVED_FAMILIES.has(governedFamily)) return unresolved({ family: governedFamily, addressability, attributes, quantity, slcRole, read, reason: read.isAuthoritative
    ? `The approved address model ${read.addressModel} resolves this device's SLC address behaviour, but the current detector/module SLC calculator still cannot safely represent this family as a resource class.`
    : "The current detector/module SLC calculator cannot safely represent this family or its address behavior." });
  return unresolved({ family: governedFamily, addressability, attributes, quantity, slcRole, read, reason: roleReason || "No governed SLC resource mapping exists for this Fire Alarm family." });
}

