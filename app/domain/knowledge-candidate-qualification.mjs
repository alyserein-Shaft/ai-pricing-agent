// KN-SCALE-1 -- candidate qualification for Knowledge product links.
//
// Pilot 1 ingested six first-party manufacturer PDFs and produced +1,302
// generic facts and +1,173 `New Product Candidate` links. Measured against the
// real data, 45% of those candidates were numeric measurement values
// ("0.05", "24", "159"), 17.6% were dates / phone numbers / fractions
// ("01/01", "1-800-328-0103", "1-3/8"), 6.2% were ranges ("0-49"), and only 64
// (5.5%) resolved to a catalogue product at all. A datasheet or manual MENTIONS
// part numbers; mentioning one is not an identity claim, and
// `mentioned part number != new canonical product candidate`.
//
// This module is the single place that decides whether a token extracted from
// a document carries enough IDENTITY SEMANTICS to enter the candidate queue.
// It never deletes a fact: a rejected token stays a Knowledge observation, it
// simply does not become a new-product candidate.
//
// Dispositions:
//   "candidate"        -- plausible product identity; may enter the link queue.
//   "referenced"       -- a device/accessory reference in a known device family
//                         (e.g. "B300-6"): still not an identity claim on its
//                         own, so it is NOT auto-candidated.
//   "discovery-only"   -- a mention with no identity semantics at all.
//
// The rules are deliberately conservative in the direction of KEEPING real
// products: every rejection below is a shape that cannot denote a manufacturer
// part number, not a "looks unusual" heuristic.

const clean = (value) => String(value ?? "").trim();

// A manufacturer document number: I56-2806, DN-60977, LS10143-001SK-E,
// 151391, 000FH-E. These identify a DOCUMENT, never a product.
const DOCUMENT_NUMBER = /^(?:[A-Z]{1,4}\d{2,6}(?:-\d{2,6}){0,3}|[A-Z]{2,4}\d{4,6}(?:-[A-Z0-9]{2,6}){1,3}|[A-Z]{2,4}-\d{3,6}|\d{3}FH-[A-Z0-9-]+|151\d{3}|1\d{5})$/i;
// A pure number or decimal: a measurement, a count, a current.
const PURE_NUMBER = /^\d+(?:[.,]\d+)?$/;
// A date: 01/01, 05/20, 7/04.
const DATE_LIKE = /^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/;
// A US/International telephone number: 1-800-328-0103.
const PHONE_LIKE = /^\d{1,3}-\d{3}-\d{3,4}-\d{3,4}$/;
// A range: 0-49, 1000-1500, 0-120.
const RANGE_LIKE = /^\d+(?:\.\d+)?-\d+(?:\.\d+)?$/;
// A fraction or dimension: 1-3/8, 1/2.
const FRACTION_LIKE = /^\d+(?:-\d+)?\/\d+$/;
// A dotted outline/section number: 1.1.1, 4.9.2.
const SECTION_NUMBER = /^\d+(?:\.\d+){1,3}$/;
// A quantity with a unit suffix: 1.04A, 24VDC, 3A, 159mA, 5V, 20mA.
const QUANTITY_WITH_UNIT = /^\d+(?:\.\d+)?\s*(?:MA|A|V|VAC|VDC|W|WH|KHZ|HZ|MM|CM|IN|INCH|FT|DEG|C|%|OHM|MHZ|GHZ|LM|KG|LB|LBS|PPM)$/i;
// An agency / standard / listing token: FM-980, UL 864, NFPA 72, CE.
const STANDARD_TOKEN = /^(?:UL|FM|EN|NFPA|CE|CSAC|IEC|ANSI|AISC|CSA|ULC|CSFM|BS|ISO|SABER|SAA)[-/ ]?\d/i;
// A manufacturer device family whose members are accessories, bases, modules
// and compatible devices rather than standalone new products.
const REFERENCED_DEVICE_FAMILY = /^(?:B\d{3,4}[A-Z0-9-]*|SK|IDP|SD|WIDP|HS|W-SYNC|OSI|FS|FSP|FST|FCM|FMM|FRM|FTM|FSCO|SSH|SS-|SP-|SLC-|B501|RPS-|N16|NBG|ECS|IFP|6815|5815|5496|5880|5824|6899|SLM|MFC|ACM|ANN|RCP|DRB|DB-|HP-|HR-|AVR-|FACP-|TR300|RA100|CK300|M02-)/i;

export const CANDIDATE_DISPOSITIONS = Object.freeze({
  CANDIDATE: "candidate",
  REFERENCED: "referenced",
  DISCOVERY_ONLY: "discovery-only",
});

/**
 * Classify a token extracted from a document.
 *
 * @param {string} token raw token as extracted
 * @returns {{ disposition: string, reason: string }}
 */
export const classifyCandidateDisposition = (token) => {
  const value = clean(token);
  if (!value) {
    return { disposition: CANDIDATE_DISPOSITIONS.DISCOVERY_ONLY, reason: "empty token" };
  }
  if (DATE_LIKE.test(value)) {
    return { disposition: CANDIDATE_DISPOSITIONS.DISCOVERY_ONLY, reason: "date-like token" };
  }
  if (PHONE_LIKE.test(value)) {
    return { disposition: CANDIDATE_DISPOSITIONS.DISCOVERY_ONLY, reason: "telephone number" };
  }
  if (PURE_NUMBER.test(value)) {
    return {
      disposition: CANDIDATE_DISPOSITIONS.DISCOVERY_ONLY,
      reason: "bare number: a measurement or count, not an identity",
    };
  }
  if (RANGE_LIKE.test(value)) {
    return { disposition: CANDIDATE_DISPOSITIONS.DISCOVERY_ONLY, reason: "numeric range" };
  }
  if (FRACTION_LIKE.test(value)) {
    return { disposition: CANDIDATE_DISPOSITIONS.DISCOVERY_ONLY, reason: "fraction or dimension" };
  }
  if (SECTION_NUMBER.test(value)) {
    return { disposition: CANDIDATE_DISPOSITIONS.DISCOVERY_ONLY, reason: "section or outline number" };
  }
  if (QUANTITY_WITH_UNIT.test(value)) {
    return {
      disposition: CANDIDATE_DISPOSITIONS.DISCOVERY_ONLY,
      reason: "quantity with a unit suffix",
    };
  }
  if (DOCUMENT_NUMBER.test(value)) {
    return {
      disposition: CANDIDATE_DISPOSITIONS.DISCOVERY_ONLY,
      reason: "document, install-sheet or manual number",
    };
  }
  if (STANDARD_TOKEN.test(value)) {
    return { disposition: CANDIDATE_DISPOSITIONS.DISCOVERY_ONLY, reason: "standard or listing token" };
  }
  if (value.length > 32 || /\s/.test(value)) {
    return {
      disposition: CANDIDATE_DISPOSITIONS.DISCOVERY_ONLY,
      reason: "free text, not an identifier",
    };
  }
  if (!/[A-Za-z]/.test(value)) {
    return {
      disposition: CANDIDATE_DISPOSITIONS.DISCOVERY_ONLY,
      reason: "no letter content: cannot carry a manufacturer part identity",
    };
  }
  if (REFERENCED_DEVICE_FAMILY.test(value)) {
    return {
      disposition: CANDIDATE_DISPOSITIONS.REFERENCED,
      reason: "accessory, base, module or compatible-device reference in a known manufacturer device family",
    };
  }
  // A long multi-segment token with letters is usually a sentence fragment or a
  // hyphenated phrase rather than an ordering code.
  if (value.split("-").length > 4) {
    return {
      disposition: CANDIDATE_DISPOSITIONS.DISCOVERY_ONLY,
      reason: "multi-segment token with no part-number shape",
    };
  }
  return {
    disposition: CANDIDATE_DISPOSITIONS.CANDIDATE,
    reason: "identifier-shaped token with letter content",
  };
};

/**
 * Should this token create a link row at all?
 *
 * `candidate`  -- yes, and it may become a `New Product Candidate`.
 * `referenced` -- only when the part number ALREADY resolves to a canonical
 *                 product, and then only as an `Existing Product -- Additive
 *                 Learning Only` link. Linking a mention of a product we already
 *                 know is useful; creating a NEW canonical candidate for a
 *                 mentioned accessory is not.
 * `discovery-only` -- never.
 *
 * In TARGETED_PRODUCT_ENRICHMENT the caller already knows the target product,
 * so no extracted mention is linked at all; only an explicitly asserted
 * research observation may be.
 */
export const qualifiesAsLinkCandidate = (token, { ingestionMode, asserted = false } = {}) => {
  if (ingestionMode === KNOWLEDGE_INGESTION_MODES.TARGETED) {
    return asserted
      ? { qualifies: true, mode: "asserted", ...classifyCandidateDisposition(token) }
      : {
          qualifies: false,
          mode: "not-linked",
          disposition: CANDIDATE_DISPOSITIONS.REFERENCED,
          reason: "targeted enrichment: the target product is already known, so an extracted mention is a referenced-product observation, not a link",
        };
  }
  const classification = classifyCandidateDisposition(token);
  if (classification.disposition === CANDIDATE_DISPOSITIONS.CANDIDATE) {
    return { qualifies: true, mode: "candidate", ...classification };
  }
  if (classification.disposition === CANDIDATE_DISPOSITIONS.REFERENCED) {
    // The route resolves this against the catalogue with an INNER JOIN, so a
    // referenced token that matches nothing simply produces no link row.
    return {
      qualifies: true,
      mode: "referenced-known-product-only",
      ...classification,
    };
  }
  return { qualifies: false, mode: "not-linked", ...classification };
};

export const KNOWLEDGE_INGESTION_MODES = Object.freeze({
  GENERAL: "GENERAL_KNOWLEDGE_INGESTION",
  TARGETED: "TARGETED_PRODUCT_ENRICHMENT",
});

export const normalizeIngestionMode = (value) =>
  String(value ?? "").trim().toUpperCase() === KNOWLEDGE_INGESTION_MODES.TARGETED
    ? KNOWLEDGE_INGESTION_MODES.TARGETED
    : KNOWLEDGE_INGESTION_MODES.GENERAL;
