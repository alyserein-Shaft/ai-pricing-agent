// KN-SCALE-4 -- source authority, independent of document classification.
//
// Pilot 1 exposed the coupling: a 232-page Honeywell installation manual was
// classified `Cost Sheet` and a 2-page detector manual `BOQ`, and promotion's
// deterministic gate keyed off that classification, so a misclassified
// manufacturer manual silently lost its technical-source authority.
//
// Two concepts must stay separate:
//   * DOCUMENT CLASSIFICATION -- what kind of document this is (BOQ, price
//     list, datasheet...). It is a classification judgement and it is allowed
//     to be wrong.
//   * SOURCE AUTHORITY -- how much engineering weight the document's content
//     carries. It is derived from evidence in the document itself and from the
//     retrieval channel, never from the classification.
//
// This module derives authority ONLY from content and retrieval evidence. It
// deliberately does not read `detected_type`.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export const SOURCE_AUTHORITY_CLASSES = Object.freeze({
  MANUFACTURER_TECHNICAL: "Manufacturer Technical Document",
  MANUFACTURER_COMMERCIAL: "Manufacturer Commercial Document",
  UNKNOWN: "Unknown Source Authority",
});

export const TECHNICAL_SOURCE_AUTHORITY_CLASSES = Object.freeze([
  SOURCE_AUTHORITY_CLASSES.MANUFACTURER_TECHNICAL,
]);

const MANUFACTURER_NAMES = [
  "Honeywell",
  "Farenhyt",
  "System Sensor",
  // KN-SA-6: concatenations seen in real library filenames, e.g.
  // `SystemSensor_2151_2151T_Manual_I56-2806-007R.pdf`.
  "SystemSensor",
  "Notifier",
  "Gamewell",
  "Gentex",
  "Hochiki",
  "Fire-Lite",
  "Johnson Controls",
];

/**
 * Match a name on non-alphanumeric boundaries.
 *
 * KN-SA-6: a `\b` anchor is a WORD boundary, and `_` is a word character, so
 * `\bHoneywell\b` never matched `Honeywell_Addressable_Devices_IDP_Booklet.pdf`
 * and `\bSystem Sensor\b` never matched `SystemSensor_...`. Both were silent
 * misses on exactly the first-party documents this module exists to recognise.
 * Explicit non-alphanumeric lookarounds treat `_`, `-`, `/` and `.` as
 * separators while still refusing a match inside a longer word.
 */
const matchesOnBoundaries = (haystack, name) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "i").test(haystack);
};

// First-party document hosting: the retrieval channel is evidence of provenance.
//
// KN-SA-1: these are EXACT registrable domains, matched on DNS label
// boundaries only. `honeywell.com.attacker.example` and
// `evil-honeywell.com` must both fail: the match is
//   label === allow || label.endsWith("." + allow)
// which is anchored at the start by the suffix test and at the end by the
// equality test, so a longer label can never satisfy it. Substring matching
// is deliberately absent. `systemsensoreurope.com` is first-party Honeywell
// infrastructure: the 6500RSE DoP names the entity
// "Honeywell Products and Solutions Sarl (Trading as System Sensor Europe)".
const FIRST_PARTY_DOMAINS = Object.freeze([
  "honeywell.com",
  "farenhyt.com",
  "systemsensor.com",
  "systemsensoreurope.com",
  "notifier.com",
  "firelite.com",
  "siemens.com",
]);

/** Label-boundary match of a hostname against the approved domain list. */
const hostMatchesApprovedDomain = (host, allow) => {
  const h = clean(host).toLowerCase().replace(/\.$/, "");
  if (!h) return false;
  return allow.some((domain) => h === domain || h.endsWith(`.${domain}`));
};

const COMMERCIAL_SIGNALS = /price\s*list|price\s*book|list\s*price|quotation|\bRFQ\b|order\s*form|bill\s*of\s*materials/i;
const TECHNICAL_HEADINGS = /data\s*sheet|datasheet|installation\s*(and|&)\s*operation|installation\s*guide|user('s)?\s*manual|technical\s*manual|(?:^|[\s_\-/])manual(?:\b|_)|engineering\s*bulletin|compatibility\s*(guide|list)|application\s*note|instructions?\s*(for\s*)?use/i;
// KN-SA-2: a bare `\b` cannot anchor these because `_` is a word character,
// so `..._Manual_I56-4446-001_B.pdf` never matched. Non-alphanumeric
// lookarounds treat `_` and `-` as separators.
const DOCUMENT_NUMBER_SIGNALS = /(?<![A-Za-z0-9])(?:[A-Z]{1,4}\d{2,6}(?:-\d{2,6}){0,3}|LS\d{4,6}(?:-[A-Z0-9]+)*|I\d{2}-\d{4}(?:-\d{3})?|DN-\d{4,6}|SPDS-?\d{4,6})(?![A-Za-z0-9])/;
// Legal entity / trading-name forms that establish the publishing manufacturer.
const LEGAL_ENTITY_SIGNALS = /trading\s+as\s+system\s+sensor|hone(y|i)well\s+products\s+and\s+solutions|system\s+sensor\s+products|fire\s*[- ]?protection\s+(?:products|ltd)/i;

/** Is this URL/host a first-party manufacturer document channel? */
export const isFirstPartyManufacturerSource = (url) => {
  const value = clean(url);
  if (!value) return false;
  let host = "";
  try {
    host = new URL(value).hostname;
  } catch {
    host = value;
  }
  return hostMatchesApprovedDomain(host, FIRST_PARTY_DOMAINS);
};

/**
 * First-party signals that SURVIVE ingestion, for the governed correction path.
 *
 * KN-SA-CORRECTION: the document body is not retained, so a stale
 * `Unknown Source Authority` cannot be re-assessed after the fact. These are the
 * only two channels that still exist on the stored row -- the original filename
 * and the first-party retrieval URL recorded at ingest -- and they are read with
 * exactly the same matchers the assessor uses, including the non-alphanumeric
 * boundary rule from KN-SA-6. A correction that cannot show one of these is
 * refused: a human asserting "this really is a Honeywell datasheet" is a claim,
 * and a claim that raises the trust level of a source is exactly the thing this
 * path must not accept on assertion alone.
 *
 * Note what this deliberately does NOT include: a document number. KN-SA-5
 * established that a document number may corroborate but never establish, and
 * that rule has to bind the human correction path too, otherwise re-introducing
 * it here would undo the guard through the back door -- `SO26-06-17-01.pdf` is a
 * project number that satisfies any document-number test.
 */
export const retainedFirstPartySignals = ({ fileName, retrievalUrl } = {}) => {
  const signals = [];
  const refusals = [];
  const name = clean(fileName);
  const url = clean(retrievalUrl);
  const named = MANUFACTURER_NAMES.filter((candidate) => matchesOnBoundaries(name, candidate));
  const firstParty = isFirstPartyManufacturerSource(url);
  if (named.length) {
    signals.push(`manufacturer named in the stored filename: ${named.join(", ")}`);
  }
  if (firstParty) {
    signals.push(`retrieved from a first-party manufacturer document channel: ${clean(url)}`);
  }

  // KN-SA-CORRECTION: presence of a first-party signal is NECESSARY but not
  // sufficient, and the class it implies is the thing that has to be compared
  // against the class being requested. A manufacturer price list hosted on the
  // manufacturer's own domain carries a first-party signal and is still
  // commercial: scoring it as a valid basis for `Manufacturer Technical Document`
  // would let a price list mint canonical truth, which is precisely what the
  // commercial regression guards exist to prevent.
  const commercial = COMMERCIAL_SIGNALS.test(`${name} ${url}`);
  if (commercial) {
    refusals.push(
      "the retained signal is commercial (price list / price book / quotation / RFQ language): a first-party channel does not make a commercial document a technical one",
    );
  }

  // The implied class reuses the assessor's own decision, restricted to the
  // signals that survive ingestion. It is deliberately not a re-grading of the
  // document: the body was never retained, so a human inspection plus this
  // implication is the substitute for re-reading it, and the declared Batch-1
  // corrections are each backed by one.
  const impliedAuthorityClass = !named.length && !firstParty
    ? SOURCE_AUTHORITY_CLASSES.UNKNOWN
    : commercial
      ? SOURCE_AUTHORITY_CLASSES.MANUFACTURER_COMMERCIAL
      : SOURCE_AUTHORITY_CLASSES.MANUFACTURER_TECHNICAL;

  if (!named.length && !firstParty) {
    signals.push(
      "no first-party signal survives on the stored row (neither the stored filename nor the recorded retrieval URL identifies a manufacturer channel)",
    );
  }

  return {
    // ANY retained signal qualifies as evidence; two of them are stronger than
    // one. The previous form (`signals.length === 1`) inverted that, scoring the
    // best-evidenced source in the library as having none.
    ok: signals.some((signal) => !signal.startsWith("no first-party signal")),
    // What the retained signals actually support. A correction must land on
    // this class, not on whatever class was requested.
    impliedAuthorityClass,
    commercialSignalPresent: commercial,
    refusals,
    // A document number is reported but never counted as sufficient.
    documentNumberCorroborates: DOCUMENT_NUMBER_SIGNALS.test(name),
    signals,
  };
};

/**
 * Assess a source's authority from evidence, never from its classification.
 *
 * @param {{ fileName?: string, text?: string, sourceUrl?: string, retrievalMethod?: string }} input
 * @returns {{ authorityClass: string, evidence: string[], assessedAt: string }}
 */
export const assessKnowledgeSourceAuthority = (input = {}) => {
  const evidence = [];
  const text = clean(input.text).slice(0, 200_000);
  const fileName = clean(input.fileName);

  const namedManufacturers = MANUFACTURER_NAMES.filter((name) =>
    matchesOnBoundaries(`${fileName} ${text}`, name),
  );
  if (namedManufacturers.length) {
    evidence.push(`manufacturer named in document content: ${namedManufacturers.join(", ")}`);
  }

  if (DOCUMENT_NUMBER_SIGNALS.test(`${fileName} ${text}`)) {
    evidence.push("manufacturer document number present");
  }

  const hasTechnicalHeading = TECHNICAL_HEADINGS.test(`${fileName} ${text}`);
  if (hasTechnicalHeading) {
    evidence.push("technical document heading present (data sheet / installation manual / bulletin)");
  }

  const hasLegalEntity = LEGAL_ENTITY_SIGNALS.test(text);
  if (hasLegalEntity) {
    evidence.push("manufacturer legal entity / trading name present in document content");
  }

  const firstParty = isFirstPartyManufacturerSource(input.sourceUrl)
    || isFirstPartyManufacturerSource(input.retrievalMethod);
  if (firstParty) {
    evidence.push("retrieved from a first-party manufacturer document channel");
  }

  const commercial = COMMERCIAL_SIGNALS.test(`${fileName} ${text}`);
  if (commercial) {
    evidence.push("commercial content present (price list / quotation / RFQ language)");
  }

  // KN-SA-5: a bare document number is NOT sufficient to establish authority.
  // The pattern also matches date-like project numbering ("SO26-06-17-01",
  // "QE.10046.26.R00"), and letting it stand alone upgrades project drawings
  // to Manufacturer Technical Document. A document number corroborates; it
  // cannot establish. Establishment requires a manufacturer name, a legal
  // entity, or a technical publication heading. `detected_type` is never read.
  const hasContentSignal = Boolean(
    namedManufacturers.length || hasTechnicalHeading || hasLegalEntity,
  );

  let authorityClass = SOURCE_AUTHORITY_CLASSES.UNKNOWN;
  if (commercial) {
    // A manufacturer price list stays commercial evidence even when hosted on
    // the manufacturer's own first-party domain.
    authorityClass = namedManufacturers.length || firstParty || hasContentSignal
      ? SOURCE_AUTHORITY_CLASSES.MANUFACTURER_COMMERCIAL
      : SOURCE_AUTHORITY_CLASSES.UNKNOWN;
  } else if (hasContentSignal && (namedManufacturers.length || hasLegalEntity || firstParty)) {
    // KN-SA-3: the first-party retrieval channel is a genuine authority
    // signal. It was previously recorded as evidence but never consulted. It
    // still cannot stand alone -- an arbitrary file uploaded to a first-party
    // host must still show content evidence before it becomes technical.
    authorityClass = SOURCE_AUTHORITY_CLASSES.MANUFACTURER_TECHNICAL;
    if (!namedManufacturers.length && !hasLegalEntity) {
      evidence.push("no manufacturer named in content: treat technical structure without provenance as unproven authority");
    }
  } else if (hasContentSignal) {
    // Technical structure without an identifiable manufacturer or an
    // approved first-party channel: real engineering content, but the
    // manufacturer authority is unproven.
    authorityClass = SOURCE_AUTHORITY_CLASSES.MANUFACTURER_TECHNICAL;
    evidence.push("no manufacturer named in content: treat technical structure without provenance as unproven authority");
  }

  if (!evidence.length) {
    evidence.push("no manufacturer, document-number or technical-heading evidence found");
  }

  return { authorityClass, evidence, assessedAt: new Date().toISOString() };
};

/** Read the stored authority assessment back off a knowledge file's summary. */
export const storedSourceAuthority = (file) => {
  const summary = typeof file?.summary === "string" ? (() => {
    try {
      return JSON.parse(file.summary);
    } catch {
      return {};
    }
  })() : (file?.summary || {});
  const authority = summary?.sourceAuthority;
  if (!authority || typeof authority.authorityClass !== "string") return null;
  return authority;
};

export const hasTechnicalSourceAuthority = (file) => {
  const authority = storedSourceAuthority(file);
  return Boolean(authority && TECHNICAL_SOURCE_AUTHORITY_CLASSES.includes(authority.authorityClass));
};
