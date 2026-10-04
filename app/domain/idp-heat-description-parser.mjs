// Stage 4U — IDP-HEAT (Addressable Heat Detector family) enrichment.
//
// Evidence situation (Stage 4U investigation):
//   - No official IDP-HEAT datasheet document exists in the product library.
//     The only local manufacturer evidence for the IDP-HEAT family is the
//     "KSA Honeywell Farenhyt Series Price List - 2023.xlsx" description text
//     (productsource_0d87f6ca, Manufacturer Price List, commercial material).
//   - The official IFP-75 datasheet (productsource_c5660767, Official
//     Manufacturer, checksum-verified, see ifp75-datasheet.mjs) states on its
//     Product overview page that IFP-75 panels support System Sensor(R) IDP/SK
//     sensors and modules. That is authoritative manufacturer evidence for
//     IDP-device <-> IFP-75 panel-family compatibility (panel-to-device
//     direction, restated here as the equivalent device-side fact).
//
// Therefore this module extracts ONLY literal facts from the manufacturer
// description text and derives NOTHING beyond it. Facts the description does
// not state are not produced. Inference (e.g. protocol naming) is not
// persisted as fact. Certifications are intentionally not produced: no
// listing certificate or datasheet evidence for IDP-HEAT exists locally, and
// project specification standards must never become product certifications.

export const IDP_HEAT_DESCRIPTION_PARSER_VERSION = "idp-heat-description-parser-1.0.0";

export const IDP_HEAT_PRICE_LIST_SOURCE_ID = "productsource_0d87f6ca-d3e1-4dd4-b452-5b83684ab0da";
export const IDP_HEAT_PRICE_LIST_DOCUMENT_ID = "doc_93ec065a-bcb5-4551-9b10-769604762631";
export const IDP_HEAT_PRICE_LIST_DOCUMENT_VERSION_ID = "ver_3f4a3e69-6b41-4f94-a32a-972a0006cfd3";

export const IFP75_PANEL_COMPATIBILITY_PRODUCT_ID = "product_d21d8928-74d4-4f40-8681-ab4e99c4c843"; // IFP-75
export const IFP75_DATASHEET_SOURCE_ID = "productsource_c5660767-1246-4867-b57d-fa10feb95c63";
export const IFP75_COMPATIBILITY_EXACT_TEXT = "which can support 75 System Sensor® IDP/SK sensors and 75 IDP/SK modules or 75 Hochiki® SD devices per loop.";

const ADDRESSABLE_RE = /intelligent\s+addressable/i;
const THERMAL_RE = /thermal\s+detector/i;
const HEAT_DETECTOR_RE = /heat\s+detector/i;
const ROR_RE = /rate-of[- ]rise/i;
const HIGH_TEMP_RE = /high\s*temperature/i;
const ROR_RATE_RE = /rate-of[- ]rise\s+detection\s+([0-9]+)\s*[ºo]F\/min\s*\(([0-9]+)\s*[ºo]C\/min\)/i;
const HIGH_TEMP_RANGE_RE = /([0-9]+)\s*[ºo]F\s*[–-]\s*([0-9]+)\s*[ºo]F\s*\(([0-9]+)[ºo]C\s*[–-]\s*([0-9]+)[ºo]C\)/i;
const FIXED_TEMP_RE = /fixed\s+temp\s+([0-9]+)/i;
const HT_FIXED_RE = /high\s*temperature\s+heat\s+detector\s+([0-9]+)\s*[ºo]F/i;
const COLOR_RE = /\((ivory|white|red|black)\s+color\)/i;
const BASE_NOT_INCLUDED_RE = /base\s+not\s+included/i;

const base = (description) => ({
  sourceId: IDP_HEAT_PRICE_LIST_SOURCE_ID,
  documentId: IDP_HEAT_PRICE_LIST_DOCUMENT_ID,
  documentVersionId: IDP_HEAT_PRICE_LIST_DOCUMENT_VERSION_ID,
  section: "Product description (price list line)",
  exactText: description,
  parserVersion: IDP_HEAT_DESCRIPTION_PARSER_VERSION,
  basis: "literal",
  confidence: 90,
  reviewStatus: "Needs Review",
});

const attribute = (state, attributeName, originalValue, normalizedValue, unit = null) => ({
  ...state,
  attributeName,
  originalValue,
  normalizedValue,
  unit,
});

// Pure extractor: returns the attributes literally supported by the
// manufacturer description text, nothing else.
export const extractIdpHeatAttributes = (description) => {
  if (typeof description !== "string" || !description.trim()) return [];
  const state = base(description);
  const attributes = [];

  const isAddressable = ADDRESSABLE_RE.test(description);
  const isThermal = THERMAL_RE.test(description) || HEAT_DETECTOR_RE.test(description);
  if (isAddressable && isThermal) {
    attributes.push(attribute(state, "addressable_capability", "Intelligent Addressable", "intelligent-addressable"));
    attributes.push(attribute(state, "detection_principle", HEAT_DETECTOR_RE.test(description) ? "heat detector" : "thermal detector", "heat"));
  } else {
    // Not an IDP-HEAT description — extract nothing rather than guess.
    return [];
  }

  const isRor = ROR_RE.test(description);
  const isHighTemp = HIGH_TEMP_RE.test(description);
  let mode = null;
  if (isRor && isHighTemp) mode = "high-temperature-and-rate-of-rise";
  else if (isRor) mode = "fixed-temperature-and-rate-of-rise";
  else if (isHighTemp) mode = "high-temperature";
  else mode = "fixed-temperature";
  attributes.push(attribute(state, "heat_detector_mode", mode.split("-").join(" "), mode));

  if (isRor) {
    const rate = description.match(ROR_RATE_RE);
    if (rate) {
      attributes.push(attribute(
        state,
        "rate_of_rise_threshold",
        `${rate[1]}ºF/min (${rate[2]}ºC/min)`,
        `${rate[1]} °F/min (${rate[2]} °C/min)`,
        "°F/min",
      ));
    }
  }

  if (isHighTemp) {
    const range = description.match(HIGH_TEMP_RANGE_RE);
    if (range) {
      attributes.push(attribute(
        state,
        "high_temperature_limit",
        `${range[2]}ºF (${range[4]}ºC)`,
        `${range[2]} °F (${range[4]} °C)`,
        "°F",
      ));
      attributes.push(attribute(
        state,
        "fixed_to_high_temperature_range",
        `${range[1]}ºF –${range[2]}ºF (${range[3]}ºC – ${range[4]}ºC)`,
        `${range[1]}–${range[2]} °F (${range[3]}–${range[4]} °C)`,
        "°F",
      ));
      const htFixed = `${range[1]}`;
      attributes.push(attribute(state, "fixed_temperature_rating", `${htFixed}ºF`, `${htFixed}`, "°F"));
    } else {
      const htFixed = description.match(HT_FIXED_RE);
      if (htFixed) attributes.push(attribute(state, "fixed_temperature_rating", `${htFixed[1]}ºF`, `${htFixed[1]}`, "°F"));
    }
  } else {
    const fixed = description.match(FIXED_TEMP_RE);
    // The standard/ROR price-list line does not state the unit of the fixed
    // rating ("Fixed Temp 135"). Persist the stated number without a unit
    // rather than inferring °F.
    if (fixed) attributes.push(attribute(state, "fixed_temperature_rating", `Fixed Temp ${fixed[1]}`, `${fixed[1]}`, null));
  }

  const color = description.match(COLOR_RE);
  if (color) attributes.push(attribute(state, "enclosure_color", `${color[1]} color`, color[1].toLowerCase()));

  if (BASE_NOT_INCLUDED_RE.test(description)) {
    attributes.push(attribute(state, "base_included", "Base Not Included", "false", "boolean"));
  }

  return attributes;
};

// Variant semantics derived from the description text, cross-checked against
// the catalog code suffix. Used for the Stage 4V comparison matrix and to
// surface identity conflicts (code suffix vs stated description) without
// rewriting identity.
export const classifyIdpHeatVariant = (partNumber, description) => {
  const attributes = extractIdpHeatAttributes(description);
  if (!attributes.length) return { isIdpHeat: false };
  const mode = attributes.find((a) => a.attributeName === "heat_detector_mode")?.normalizedValue;
  const code = String(partNumber || "").replace(/\.$/, "").toUpperCase();
  const codeSaysRor = code.includes("ROR");
  const codeSaysHt = code.includes("HT");
  const descriptionSaysRor = mode?.includes("rate-of-rise");
  const descriptionSaysHt = mode?.startsWith("high-temperature");
  const conflicts = [];
  if (codeSaysRor !== Boolean(descriptionSaysRor)) conflicts.push(`code ROR suffix=${codeSaysRor} vs description=${Boolean(descriptionSaysRor)}`);
  if (codeSaysHt !== Boolean(descriptionSaysHt)) conflicts.push(`code HT suffix=${codeSaysHt} vs description=${Boolean(descriptionSaysHt)}`);
  return {
    isIdpHeat: true,
    variant: mode,
    codeSuffixConsistent: conflicts.length === 0,
    identityConflicts: conflicts,
  };
};

// Manufacturer-evidence panel-compatibility relationship builder. Direction in
// the source document is panel-supports-IDP-devices; the stored fact is the
// equivalent device-side statement and keeps the exact source quote. Scope is
// Global (product-library knowledge), never project scope — product
// compatibility knowledge must not be read as a project panel selection.
export const buildPanelCompatibilityRelationship = ({ productId, projectId = null }) => ({
  projectId,
  leftEntityType: "library_product",
  leftEntityId: productId,
  relationshipType: "COMPATIBLE_WITH_PANEL",
  rightEntityType: "library_product",
  rightEntityId: IFP75_PANEL_COMPATIBILITY_PRODUCT_ID,
  conditions: [],
  exceptions: [],
  factType: "manufacturer-panel-compatibility",
  scopeType: projectId ? "BOQ Item" : "Global",
  confidence: 92,
  status: "Needs Review",
  evidence: {
    sourceId: IFP75_DATASHEET_SOURCE_ID,
    documentId: "doc_e711260d-2480-4dc9-a6da-8d098d409200",
    sourceType: "Official Manufacturer Product Datasheet",
    section: "Product overview",
    exactText: IFP75_COMPATIBILITY_EXACT_TEXT,
    direction: "datasheet states the panel supports IDP/SK sensors; stored as the equivalent device-side compatibility fact",
    parserVersion: "ifp75-datasheet-parser-1.0.0",
  },
});
