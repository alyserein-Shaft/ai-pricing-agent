import { FIRE_ALARM_ATTRIBUTE_PROFILES } from "./fire-alarm-taxonomy.mjs";

export const ENGINEERING_ATTRIBUTE_PROFILE_VERSION = "engineering-attribute-profiles-1.0.0";

const freezeProfile = (profile) => Object.freeze({
  ...profile,
  attributes: Object.freeze([...profile.attributes]),
  matchingImportance: Object.freeze({ ...profile.matchingImportance }),
});

export const STRUCTURED_CABLING_ATTRIBUTE_PROFILES = Object.freeze({
  "Structured Cabling Cable": freezeProfile({
    system: "Structured Cabling",
    family: "Structured Cabling Cable",
    attributes: ["cable_category", "construction", "conductor_type", "conductor_size", "pair_count", "shielding", "jacket_material", "fire_rating", "length_or_packaging", "indoor_outdoor", "applicable_standard"],
    matchingImportance: {
      cable_category: "Mandatory", construction: "Mandatory", conductor_type: "Mandatory", conductor_size: "Mandatory",
      pair_count: "Mandatory", shielding: "Mandatory", jacket_material: "Comparison", fire_rating: "Mandatory",
      length_or_packaging: "Comparison", indoor_outdoor: "Mandatory", applicable_standard: "Mandatory",
    },
    evidenceRequired: true,
  }),
});

export function governedAttributeProfile(system, productFamily) {
  if (system === "Fire Alarm" && FIRE_ALARM_ATTRIBUTE_PROFILES[productFamily]) {
    return { version: ENGINEERING_ATTRIBUTE_PROFILE_VERSION, system, ...FIRE_ALARM_ATTRIBUTE_PROFILES[productFamily] };
  }
  if (system === "Structured Cabling" && STRUCTURED_CABLING_ATTRIBUTE_PROFILES[productFamily]) {
    return { version: ENGINEERING_ATTRIBUTE_PROFILE_VERSION, ...STRUCTURED_CABLING_ATTRIBUTE_PROFILES[productFamily] };
  }
  return null;
}

export function mandatoryMatchingAttributes(system, productFamily) {
  const profile = governedAttributeProfile(system, productFamily);
  return profile ? profile.attributes.filter((name) => profile.matchingImportance[name] === "Mandatory") : [];
}
