export const FIRE_ALARM_TAXONOMY_VERSION = "fire-alarm-taxonomy-1.0.0";

const freezeList = (values) => Object.freeze([...values]);

export const FIRE_ALARM_TAXONOMY = Object.freeze({
  "Control Equipment": freezeList(["Fire Alarm Control Panel", "Repeater Panel", "Annunciator", "Network Node", "Loop Card", "Communication Card", "Printer", "Graphic Interface"]),
  "Detection Devices": freezeList(["Addressable Smoke Detector", "Addressable Heat Detector", "Multi-Criteria Detector", "Beam Detector", "Duct Detector", "Flame Detector", "Conventional Detector", "Detector Base", "Sounder Base", "Isolator Base"]),
  "Notification Devices": freezeList(["Sounder", "Strobe", "Sounder/Strobe", "Bell", "Horn", "Speaker", "Speaker/Strobe"]),
  "Modules and Interfaces": freezeList(["Monitor Module", "Control Module", "Input Module", "Output Module", "Relay Module", "Isolator Module", "Zone Module", "Interface Module"]),
  "Manual Initiation": freezeList(["Manual Call Point", "Pull Station", "Break Glass Unit"]),
  "Power and Batteries": freezeList(["Fire Alarm Power Supply", "Booster Power Supply", "Battery", "Battery Cabinet", "Charger"]),
  Accessories: freezeList(["Mounting Base", "Back Box", "Weatherproof Box", "Guard", "Bracket", "End-of-Line Device", "Enclosure", "Cable Accessory", "Programming Tool", "Software License"]),
});

const COMMON_ATTRIBUTES = freezeList(["product_type", "addressing", "protocol", "compatible_panel_family", "loop_compatibility", "loop_capacity", "zone_capacity", "device_capacity", "input_voltage", "operating_voltage", "standby_current", "alarm_current", "power_rating", "battery_capacity", "battery_autonomy", "sound_output", "flash_rate", "candela_rating", "frequency", "environmental_rating", "ip_rating", "ik_rating", "temperature_range", "humidity_range", "mounting_type", "indoor_outdoor", "detector_technology", "detection_principle", "sensitivity_settings", "isolation_capability", "network_capability", "redundancy", "communication_interface", "enclosure_type", "dimensions", "weight", "warranty", "regional_variant", "firmware_generation", "included_components"]);
const mandatory = new Set(["product_type", "protocol", "compatible_panel_family", "loop_compatibility", "operating_voltage"]);
export const FIRE_ALARM_ATTRIBUTE_PROFILES = Object.freeze(Object.fromEntries(
  Object.values(FIRE_ALARM_TAXONOMY).flat().map((family) => [family, Object.freeze({
    family,
    attributes: COMMON_ATTRIBUTES,
    unknownPolicy: "null",
    evidenceRequired: true,
    matchingImportance: Object.freeze(Object.fromEntries(COMMON_ATTRIBUTES.map((name) => [name, mandatory.has(name) ? "Mandatory" : "Comparison"]))),
  })]),
));

const normalized = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (value) => new Set(normalized(value).split(" ").filter((token) => token.length > 2));
const exactCategoryAliases = new Map([
  ["control equipment", "Control Equipment"], ["detection device", "Detection Devices"], ["detection devices", "Detection Devices"],
  ["notification device", "Notification Devices"], ["notification devices", "Notification Devices"], ["notification appliance", "Notification Devices"],
  ["modules and interfaces", "Modules and Interfaces"], ["manual initiation", "Manual Initiation"], ["power and batteries", "Power and Batteries"], ["accessories", "Accessories"],
]);
const familyPhrases = Object.freeze({
  "Fire Alarm Control Panel": ["fire alarm control panel", "fire alarm panel", "facp"],
  "Repeater Panel": ["repeater panel", "fire alarm repeater"],
  "Addressable Smoke Detector": ["addressable smoke detector", "addressable optical smoke detector", "addressable photoelectric detector", "addressable photoelectric smoke detector"],
  "Addressable Heat Detector": ["addressable heat detector"],
  "Multi-Criteria Detector": ["multi criteria detector", "multicriteria detector"],
  "Beam Detector": ["beam detector"], "Duct Detector": ["duct detector", "duct smoke detector"], "Flame Detector": ["flame detector"],
  "Conventional Detector": ["conventional detector", "conventional smoke detector", "conventional heat detector"],
  "Detector Base": ["detector base"], "Sounder Base": ["sounder base"], "Isolator Base": ["isolator base"],
  "Sounder/Strobe": ["sounder strobe", "sounder with strobe"], "Sounder": ["sounder"], "Strobe": ["strobe"],
  "Monitor Module": ["monitor module", "monitoring module"], "Control Module": ["control module"], "Input Module": ["input module"],
  "Output Module": ["output module"], "Relay Module": ["relay module"], "Isolator Module": ["isolator module"], "Zone Module": ["zone module"], "Interface Module": ["interface module"],
  "Manual Call Point": ["manual call point"], "Pull Station": ["pull station"], "Break Glass Unit": ["break glass unit"],
  "Fire Alarm Power Supply": ["fire alarm power supply"], "Booster Power Supply": ["booster power supply"], "Battery Cabinet": ["battery cabinet"],
});
const familyCategory = new Map(Object.entries(FIRE_ALARM_TAXONOMY).flatMap(([category, families]) => families.map((family) => [family, category])));
const exactFamilyAliases = new Map(Object.entries(familyPhrases).flatMap(([family, phrases]) => phrases.map((phrase) => [normalized(phrase), family])));
const attributeAliases = new Map([
  ["technology", "addressing"], ["addressability", "addressing"], ["addressing", "addressing"], ["protocol", "protocol"],
  ["compatible panel family", "compatible_panel_family"], ["compatiblepanelfamily", "compatible_panel_family"], ["loop compatibility", "loop_compatibility"], ["loopcompatibility", "loop_compatibility"], ["operating voltage", "operating_voltage"], ["operatingvoltage", "operating_voltage"],
  ["detector technology", "detector_technology"], ["detectortechnology", "detector_technology"], ["detection principle", "detection_principle"], ["detectionprinciple", "detection_principle"], ["isolator", "isolation_capability"], ["isolation capability", "isolation_capability"], ["isolationcapability", "isolation_capability"],
]);

export const normalizeFireAlarmCategory = (value) => exactCategoryAliases.get(normalized(value)) || null;
export const normalizeFireAlarmFamily = (value) => exactFamilyAliases.get(normalized(value)) || (familyCategory.has(String(value)) ? String(value) : null);
export const fireAlarmCategoryForFamily = (family) => familyCategory.get(family) || null;
export const isCanonicalFireAlarmPair = (category, family) => fireAlarmCategoryForFamily(family) === category;
export const normalizeFireAlarmAttributeName = (value, family) => {
  const profile = FIRE_ALARM_ATTRIBUTE_PROFILES[family];
  if (!profile) return null;
  const key = normalized(value).replace(/ /g, "_");
  const canonical = attributeAliases.get(normalized(value)) || key;
  return profile.attributes.includes(canonical) ? canonical : null;
};

export function buildFireAlarmTaxonomyContext(evidence = {}, { maxFamilies = 6, maxAttributes = 10 } = {}) {
  const sourceText = [evidence.description, evidence.system, evidence.category, evidence.subcategory, evidence.manufacturerText, evidence.modelText, ...(evidence.confirmedSpecification || []).map((entry) => typeof entry === "string" ? entry : entry?.normalizedRequirement || entry?.originalText)].filter(Boolean).join(" ");
  const source = normalized(sourceText);
  const sourceTokens = tokens(source);
  const scored = [];
  for (const [family, phrases] of Object.entries(familyPhrases)) {
    let score = 0;
    const basis = [];
    for (const phrase of phrases) {
      const normalizedPhrase = normalized(phrase);
      if (source.includes(normalizedPhrase)) { score += 100 + normalizedPhrase.length; basis.push(phrase); }
      else {
        const phraseTokens = tokens(phrase);
        const overlap = [...phraseTokens].filter((token) => sourceTokens.has(token)).length;
        if (overlap >= 2 && overlap === phraseTokens.size) { score += overlap * 10; basis.push(phrase); }
      }
    }
    if (score) scored.push({ category: fireAlarmCategoryForFamily(family), family, score, basis: freezeList(basis) });
  }
  scored.sort((left, right) => right.score - left.score || left.family.localeCompare(right.family));
  const families = scored.slice(0, Math.max(1, Math.min(8, maxFamilies))).map(({ category, family, basis }, index) => Object.freeze({ selectionKey: `FA-${index + 1}`, category, family, basis }));
  const likelyFireAlarm = /\bfire alarm\b/.test(source) || families.length > 0;
  const selectedAttributes = [];
  const addAttribute = (name) => { if (!selectedAttributes.includes(name)) selectedAttributes.push(name); };
  for (const { family } of families) {
    for (const name of ["product_type", "addressing", "protocol", "compatible_panel_family", "loop_compatibility", "operating_voltage"]) if (FIRE_ALARM_ATTRIBUTE_PROFILES[family].attributes.includes(name)) addAttribute(name);
  }
  if (/\b(?:optical|photoelectric|heat|thermal|beam|flame)\b/.test(source)) addAttribute("detector_technology");
  if (/\bisolat(?:or|ion)\b/.test(source)) addAttribute("isolation_capability");
  return Object.freeze({ version: FIRE_ALARM_TAXONOMY_VERSION, system: likelyFireAlarm ? "Fire Alarm" : null, families: freezeList(families), attributeNames: freezeList(selectedAttributes.slice(0, Math.max(1, Math.min(12, maxAttributes)))) });
}
