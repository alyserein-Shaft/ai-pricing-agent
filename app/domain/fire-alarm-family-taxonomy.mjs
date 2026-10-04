// GOLDEN-6C3B -- canonical Fire Alarm device-family taxonomy and SLC role map.
//
// WHY THIS MODULE EXISTS
// ----------------------
// `classifyFireAlarmSlcItem` carried five hardcoded family sets that were a
// DUPLICATE, DIVERGENT copy of the repository's real family taxonomy in
// `product_families`. Measured divergence (live D1, 44 canonical families):
//
//   * 15 classifier names do not exist in `product_families` at all
//     (Input Module, Heat Detector, Smoke Detector, Horn, Break Glass Unit, ...)
//   * 18 canonical families were unmapped by the classifier
//     (Beam Detector, Carbon Monoxide Detector, Annunciator, Firefighter
//     Telephone, Booster Power Supply, ...)
//   * even the names they shared disagreed on punctuation, because
//     `product_families.normalized_name` is lowercased and separator-stripped
//     ("multi criteria detector") while the classifier compared
//     "Multi-Criteria Detector" verbatim and case-sensitively.
//   * and 8 families that ARE canonical were parked in the classifier's
//     UNRESOLVED set: Duct Detector, Manual Call Point, Pull Station,
//     Interface Module, Strobe, Sounder, Bell, Speaker.
//
// So a governed canonical family could be refused purely because of naming.
//
// SLC ROLE IS NOT POINT CONSUMPTION
// ---------------------------------
// This module answers exactly one question: "what is this family's role on the
// Fire Alarm addressable signalling loop?" It deliberately answers NOTHING about
// how many SLC addresses a unit consumes. That is a separate authority and it is
// NOT in this repository: there is no `product_attributes`, `engineering_facts`
// or `product_families` field anywhere that records SLC address consumption, and
// `unitsPerDevice` appears only as a literal inside the classifier itself.
//
// Roles therefore come from `product_families.engineering_domain`, which is the
// repository's own governed grouping:
//
//   Detection Devices     -> SLC_FIELD_DEVICE
//   Manual Initiation      -> SLC_FIELD_DEVICE
//   Modules and Interfaces-> SLC_MODULE
//   Control Equipment     -> NOT_SLC
//   Accessories           -> NOT_SLC
//   Power and Batteries   -> NOT_SLC
//   Notification Devices  -> NOT_SLC   (a NAC appliance is not an SLC field
//                                       point just because it is a Fire Alarm
//                                       family; addressable notification would
//                                       need its own governed SLC semantics)
//
// Recognition is necessary but never sufficient for a point: the classifier
// still requires independently governed addressable evidence, and it still
// withholds any point count this repository cannot evidence.

export const FIRE_ALARM_FAMILY_TAXONOMY_VERSION = "fire-alarm-family-taxonomy-1.0.0";

export const FIRE_ALARM_SLC_ROLES = Object.freeze([
  "SLC_FIELD_DEVICE",
  "SLC_MODULE",
  "NOT_SLC",
  "UNRESOLVED",
]);

/**
 * Engineering domain (from `product_families`) -> SLC role.
 *
 * Exported because it is the DERIVATION the per-family map below was written
 * from, and publishing it is what makes the two auditable against each other
 * rather than merely asserted to agree. A per-family disagreement is expected
 * and deliberate in exactly one place -- a detector BASE is filed under
 * "Detection Devices" because it is detector-related, but it is a mounting
 * accessory and consumes no SLC address -- so this is documentation of intent
 * rather than a second source of truth.
 */
export const FIRE_ALARM_DOMAIN_SLC_ROLES = Object.freeze({
  "detection devices": "SLC_FIELD_DEVICE",
  "manual initiation": "SLC_FIELD_DEVICE",
  "modules and interfaces": "SLC_MODULE",
  "control equipment": "NOT_SLC",
  "accessories": "NOT_SLC",
  "power and batteries": "NOT_SLC",
  // Deliberate: notification appliances are excluded by family role. An
  // addressable notification appliance would require its own governed SLC
  // semantics, which this repository does not carry.
  "notification devices": "NOT_SLC",
});

/**
 * Canonical family -> SLC role, mirroring the governed `product_families`
 * names. Keys are canonical-normalized (see `normalizeFamilyName`).
 */
const FAMILY_ROLES = new Map(
  [
    // Detection Devices
    ["addressable smoke detector", "SLC_FIELD_DEVICE"],
    ["addressable heat detector", "SLC_FIELD_DEVICE"],
    ["smoke detector", "SLC_FIELD_DEVICE"],
    ["heat detector", "SLC_FIELD_DEVICE"],
    ["duct detector", "SLC_FIELD_DEVICE"],
    ["multi criteria detector", "SLC_FIELD_DEVICE"],
    ["multi criteria fire detector", "SLC_FIELD_DEVICE"],
    ["beam detector", "SLC_FIELD_DEVICE"],
    ["carbon monoxide detector", "SLC_FIELD_DEVICE"],
    // Conventional devices are a detection device that is explicitly NOT
    // addressable. The role is still a detection role; the classifier's
    // independent addressable-evidence requirement is what keeps a
    // conventional device out of the addressable pool (mission section 19).
    ["conventional detector", "SLC_FIELD_DEVICE"],
    // Manual Initiation
    ["manual call point", "SLC_FIELD_DEVICE"],
    ["manual station", "SLC_FIELD_DEVICE"],
    ["pull station", "SLC_FIELD_DEVICE"],
    ["break glass unit", "SLC_FIELD_DEVICE"],
    // Modules and Interfaces
    ["control module", "SLC_MODULE"],
    ["monitor module", "SLC_MODULE"],
    ["input module", "SLC_MODULE"],
    ["output module", "SLC_MODULE"],
    ["relay module", "SLC_MODULE"],
    ["isolator module", "SLC_MODULE"],
    ["zone module", "SLC_MODULE"],
    ["zone interface module", "SLC_MODULE"],
    // A generic "Interface Module" is a module ROLE, but its address count is
    // deliberately not asserted anywhere: a single input, a dual input, an
    // input/output module and a multi-module assembly are different devices
    // that share this one name (mission section 22).
    ["interface module", "SLC_MODULE"],
    // Notification Devices -- role is NOT_SLC by family. See the note above.
    ["strobe", "NOT_SLC"],
    ["sounder", "NOT_SLC"],
    ["sounder strobe", "NOT_SLC"],
    ["speaker strobe", "NOT_SLC"],
    ["horn", "NOT_SLC"],
    ["bell", "NOT_SLC"],
    ["speaker", "NOT_SLC"],
    // Control Equipment
    ["fire alarm control panel", "NOT_SLC"],
    ["loop card", "NOT_SLC"],
    ["annunciator", "NOT_SLC"],
    ["firefighter telephone", "NOT_SLC"],
    ["printer", "NOT_SLC"],
    // Power and Batteries
    ["battery", "NOT_SLC"],
    ["battery cabinet", "NOT_SLC"],
    ["battery charger", "NOT_SLC"],
    ["power supply", "NOT_SLC"],
    ["booster power supply", "NOT_SLC"],
    // Accessories
    ["detector base", "NOT_SLC"],
    ["sounder base", "NOT_SLC"],
    ["isolator base", "NOT_SLC"],
    ["enclosure", "NOT_SLC"],
    ["back box", "NOT_SLC"],
    ["weatherproof box", "NOT_SLC"],
    ["junction box", "NOT_SLC"],
    ["bracket", "NOT_SLC"],
    ["guard", "NOT_SLC"],
    ["end of line device", "NOT_SLC"],
  ].map(([name, role]) => [name, role]),
);

/**
 * Canonical family normalization.
 *
 * Case-folded, and every run of non-alphanumeric characters collapsed to a
 * single space. This is the same normalization `product_families` uses, which is
 * what reconciles "Multi-Criteria Detector" with the canonical
 * "multi criteria detector" -- the divergence that previously made even an
 * ACCEPTED family unreachable from the governed table.
 *
 * Punctuation is collapsed but never dropped, so "Smoke Detector" and
 * "SmokeDetector" remain distinct families rather than silently merging.
 */
export const normalizeFamilyName = (value) =>
  String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The SLC role of a governed family, plus how the answer was reached.
 *
 * Returns `{ role: "UNRESOLVED" }` for a family this repository does not govern.
 * It never infers a role from a description, a system, or a manufacturer.
 */
export function resolveFireAlarmSlcRole(family) {
  const normalized = normalizeFamilyName(family);
  if (normalized === "") return { role: "UNRESOLVED", basis: null, normalizedFamily: null, reason: "No governed SLC resource mapping exists for this Fire Alarm family." };
  const role = FAMILY_ROLES.get(normalized);
  if (!role) {
    return {
      role: "UNRESOLVED",
      basis: null,
      normalizedFamily: normalized,
      // Deliberately the established phrasing. The 6C3 contract asserts that a
      // governed-but-unmapped family reports "no governed SLC resource mapping";
      // this lane adds mappings, it does not reword the unmapped case.
      reason: "No governed SLC resource mapping exists for this Fire Alarm family.",
    };
  }
  return { role, basis: "CANONICAL_FAMILY_TAXONOMY", normalizedFamily: normalized, reason: null };
}

/** The engineering domain a role derives from, for provenance. */
export const SLC_ROLE_DOMAINS = Object.freeze({
  SLC_FIELD_DEVICE: ["Detection Devices", "Manual Initiation"],
  SLC_MODULE: ["Modules and Interfaces"],
  NOT_SLC: ["Control Equipment", "Accessories", "Power and Batteries", "Notification Devices"],
  UNRESOLVED: [],
});

export const FIRE_ALARM_FAMILY_TAXONOMY_DISCLAIMERS = Object.freeze([
  "An SLC role is not point consumption. This module never asserts how many SLC addresses a unit consumes.",
  "No repository source records SLC address consumption for any Fire Alarm family; point counts must come from separately governed evidence.",
  "A family role is never inferred from a BOQ description, a system, or a manufacturer.",
  "Notification appliance families are NOT SLC by family role; addressable notification would require its own governed SLC semantics.",
  "A generic Interface Module establishes a module role only; single input, dual input, input/output and multi-module assemblies share that name and consume different numbers of addresses.",
]);
