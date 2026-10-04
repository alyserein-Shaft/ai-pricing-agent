// CCTV System Pack v1 closure -- deterministic, evidence-only extraction of
// selection-critical CCTV product attributes from a catalog product's own
// description text. Mirrors fire-alarm-product-attribute-extraction.mjs's
// exact discipline: no rule infers a value from a part number; every value
// comes from a literal, bounded text match in the description, or is not
// emitted at all.
export const CCTV_PRODUCT_ATTRIBUTE_EXTRACTION_VERSION = "cctv-product-attribute-extraction-1.0.0";

const titleCase = (word) => `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`;

// Real Central Kitchen gap: DS-2CD3T66G2-4IS/DS-2CD3166G2-ISU-H's own
// official description states "Defog" explicitly ("Defog: clear imaging
// against strong back light...", "...DFOG."); their plain siblings
// (DS-2CD3061G2-LIUF/DS-2CD3161G2-LIUF) never do. Scoped to the camera
// families this was actually proven against.
const RULES = Object.freeze([
  { name: "defog", families: ["Dome Camera", "Bullet Camera", "PTZ Camera"], pattern: /\bdefog\b|\bdfog\b/i, value: () => "Defog" },
]);

/**
 * @param {{ description: string, family: string|null }} product
 * @returns {Array<{ name: string, value: string, origin: "EXTRACTED", confidence: number, sourceText: string, extractionMethod: string }>}
 */
export function extractCctvProductAttributes({ description, family = null }) {
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
      extractionMethod: `${CCTV_PRODUCT_ATTRIBUTE_EXTRACTION_VERSION}:${rule.name}`,
    });
  }
  return results;
}
