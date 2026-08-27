// Sprint 0.5 -- deterministic, evidence-only extraction of selection-critical
// Fire Alarm product attributes from a catalog product's own description text.
// Every rule here was proven against real catalog products before being added
// (see FAMILY_SPECIFIC_ATTRIBUTES in fire-alarm-taxonomy.mjs and the audit
// notes in tests/fire-alarm-product-attribute-extraction.test.mjs). No rule
// infers a value from a part number; every value comes from a literal, bounded
// text match in the description, or is not emitted at all.
export const PRODUCT_ATTRIBUTE_EXTRACTION_VERSION = "fire-alarm-product-attribute-extraction-1.0.0";

const titleCase = (word) => `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`;

// families: undefined = applies regardless of the product's own classified
// family (device_role, addressing); a list = only evaluated when the product's
// classified family is in the list, matching the scoped governed-attribute
// profile added in fire-alarm-taxonomy.mjs.
const RULES = Object.freeze([
  { name: "addressing", pattern: /\bAddressable\b/i, value: () => "Addressable" },
  { name: "action_type", families: ["Pull Station"], pattern: /\b(Dual|Single)\s+Action\b/i, value: (m) => `${titleCase(m[1])} Action` },
  { name: "relay_count", families: ["Relay Module"], pattern: /\b(\d+)\s*(?:Isolated\s*Sets?\s*Of\s*)?Form\s*C\s*(?:Contacts?|Relays?)\b/i, value: (m) => Number(m[1]) },
  { name: "frequency", families: ["Sounder Base", "Sounder", "Sounder/Strobe"], pattern: /\b(\d+(?:\.\d+)?)\s*Hz\b/i, value: (m) => `${m[1]} Hz` },
  { name: "ecs_capability", families: ["Fire Alarm Control Panel"], pattern: /\bEmergency Communication System\b|\bECS[- ]/i, value: () => "ECS Capable" },
  { name: "color", families: ["Fire Alarm Control Panel"], pattern: /\b(Red|Black)\s+Cabinet\b/i, value: (m) => titleCase(m[1]) },
  // Explicit accessory-indicating words only -- never inferred from a family
  // name like "Strobe" alone (a LENS-* product's own family is Strobe, same as
  // a real strobe device; only its own description text decides device_role).
  { name: "device_role", pattern: /\bAccessor(?:y|ies)\b|\bAttachment\b/i, value: () => "Accessory" },
  // Sprint 1.3 -- SLC capacity facts, proven against the real IFP-2100
  // HV/HVB/ECSHV/ECSHVB catalog descriptions (Sprint 1.1's evidence matrix).
  // Deliberately NOT `families`-scoped: these target products all have a
  // null family_id in the live catalog (unrelated, pre-existing gap, out of
  // scope to fix here), which would silently prevent a families-gated rule
  // from ever firing on them -- confirmed empirically ("color"/"ecs_capability",
  // already scoped to "Fire Alarm Control Panel", never appear on these real
  // products for exactly this reason). Each pattern is specific enough
  // (a Farenhyt-prefixed point count; the literal "X Detectors and Y Modules
  // per loop" sentence; the literal "One SLC loop card inbuild" phrase) that
  // an ungated match elsewhere in the catalog is not a realistic risk, and
  // scripts/extract-fire-alarm-product-attributes.mjs only ever writes to an
  // explicit, caller-supplied target id list regardless.
  { name: "native_slc_loops", pattern: /\bOne SLC loop card inbuild\b/i, value: () => 1 },
  // Detector and module capacities are captured as two SEPARATE named
  // attributes from the SAME sentence, never combined into one total -- this
  // is the exact real gap Sprint 1.1 found (only "159 Detectors" was ever
  // captured; "159 Modules" from the same sentence never was).
  { name: "max_detectors_per_loop", pattern: /\b(\d+)\s*Detectors\s+and\s+\d+\s*Modules\s+per\s+loop\b/i, value: (m) => Number(m[1]) },
  { name: "max_modules_per_loop", pattern: /\b\d+\s*Detectors\s+and\s+(\d+)\s*Modules\s+per\s+loop\b/i, value: (m) => Number(m[1]) },
  { name: "max_system_points", pattern: /\bFarenhyt\s+(\d+)\s*point\b/i, value: (m) => Number(m[1]) },
]);

/**
 * @param {{ description: string, family: string|null }} product
 * @returns {Array<{ name: string, value: string|number, origin: "EXTRACTED", confidence: number, sourceText: string, extractionMethod: string }>}
 */
export function extractFireAlarmProductAttributes({ description, family = null }) {
  const text = String(description || "");
  if (!text.trim()) return [];
  const results = [];
  for (const rule of RULES) {
    if (rule.families && !rule.families.includes(family)) continue;
    const match = text.match(rule.pattern);
    if (!match) continue;
    results.push({
      name: rule.name,
      value: rule.value(match),
      origin: "EXTRACTED",
      confidence: 90,
      sourceText: match[0],
      extractionMethod: `${PRODUCT_ATTRIBUTE_EXTRACTION_VERSION}:${rule.name}`,
    });
  }
  return results;
}
