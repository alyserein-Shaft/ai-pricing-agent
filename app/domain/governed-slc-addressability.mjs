// Canonical GOVERNED SLC ADDRESSABILITY resolver.
//
// ============================================================================
// WHAT THIS IS FOR
// ============================================================================
// It answers exactly one question, for exactly one BOQ line:
//
//   "Is there governed authority that this line consumes an SLC address, and
//    if so how many per device?"
//
// It exists because the project already HAD this authority and no reader.
// `ADDRESS_MODEL_SLC_DEMAND` in `fire-alarm-panel-capability-normalization.mjs`
// is the canonical closed vocabulary of manufacturer-stated SLC address
// behaviour, and `slcAddressDemandForItem` is its existing consumer. 30
// `product_attributes.slc_address_model` facts are promoted and Approved. But
// the only callers of the consumer
// (`panelDemandFromAllocations(allocations, items)` in
// `fire-alarm-panel-sizing-snapshot.mjs` and `worker/fire-alarm-panel-sizing-api.mjs`)
// pass NO resolver, so `slcAddressDemandForAllocations` is unreachable in
// production. This module is that missing reader. It does not replace the
// vocabulary and it does not add one.
//
// ============================================================================
// WHY THIS IS NOT DERIVED FROM ANYTHING ELSE
// ============================================================================
// Address consumption is a PRODUCT CAPABILITY FACT. It is NOT:
//   * a consequence of the product family (a family says which pool a device
//     belongs to; it never says how many addresses the device consumes),
//   * a consequence of a raw BOQ category / subcategory / system_value,
//   * a consequence of description matching,
//   * a consequence of AI confidence or candidate rank,
//   * a consequence of the project's own quantity.
//
// Those refusals are structural here, not advisory: the only inputs this
// resolver reads are a governed product identity and the Approved manufacturer
// attribute fact attached to that exact product.
//
// ============================================================================
// THE TWO AUTHORITIES ARE SEPARATE AND STAY SEPARATE
// ============================================================================
//   PRODUCT CAPABILITY FACT  -> "an IDP-PULL-DA sets its own module address"
//   RESOURCE CLASSIFICATION  -> "therefore this line occupies the MODULE pool"
//
// This resolver produces the FIRST. The canonical resource classifier
// (`classifyFireAlarmSlcItem`) produces the SECOND. Neither derives the other:
// the classifier will not book a pool on family alone, and this resolver will
// not pick a pool at all.
//
// ============================================================================
// GATES -- all must pass before any address is consumed
// ============================================================================
//   G1 identity      governed product identity resolved and APPROVED. A
//                    provisional or ambiguous selection is NOT identity.
//   G2 fact presence at least one current Approved `slc_address_model` fact.
//   G3 currentness   review_status='Approved', superseded_at IS NULL,
//                    deleted_at IS NULL -- the exact predicate the existing
//                    capacity/expansion reader already uses, so currentness
//                    means the same thing here as everywhere else.
//   G4 source type   the source must be manufacturer technical documentation.
//                    A price list, cost sheet, BOQ text or any commercial
//                    artefact is refused for a technical fact. No existing
//                    project policy admits those source types for this fact.
//   G5 citation      the fact must carry an exact evidence citation.
//   G6 conflict      exactly ONE distinct canonical token per product. Two
//                    current Approved tokens are an unresolved conflict, never
//                    a choice between them.
//   G7 vocabulary    the token must be one of the five canonical semantics.
//   G8 provenance    fact id, source id, version, author and policy version
//                    must all be present, so the decision is traceable.
//
// FAIL CLOSED. Any failing gate yields UNRESOLVED with a named code. Absence is
// never read as zero, and a refusal is never silently downgraded.

import {
  ADDRESS_MODEL_SLC_DEMAND,
  normalizeAddressModel,
} from "./fire-alarm-panel-capability-normalization.mjs";

export const GOVERNED_SLC_ADDRESSABILITY_VERSION = "governed-slc-addressability-1.0.0";

// The two states. There is deliberately no third "assumed" state and no
// boolean shortcut: a consumer that wants a number must handle UNRESOLVED.
export const GOVERNED_ADDRESSABILITY_STATES = Object.freeze({
  AUTHORITATIVE: "AUTHORITATIVE",
  UNRESOLVED: "UNRESOLVED",
});

// Named refusals. A refusal is a first-class, reportable outcome.
export const GOVERNED_ADDRESSABILITY_CODES = Object.freeze({
  NO_GOVERNED_PRODUCT_IDENTITY: "NO_GOVERNED_PRODUCT_IDENTITY",
  PRODUCT_IDENTITY_NOT_APPROVED: "PRODUCT_IDENTITY_NOT_APPROVED",
  NO_APPROVED_ADDRESS_MODEL: "NO_APPROVED_ADDRESS_MODEL",
  ADDRESS_MODEL_NOT_CURRENT: "ADDRESS_MODEL_NOT_CURRENT",
  SOURCE_TYPE_NOT_ALLOWED_FOR_THIS_FACT: "SOURCE_TYPE_NOT_ALLOWED_FOR_THIS_FACT",
  ADDRESS_MODEL_CONFLICT: "ADDRESS_MODEL_CONFLICT",
  UNRECOGNISED_ADDRESS_MODEL: "UNRECOGNISED_ADDRESS_MODEL",
  CITATION_MISSING: "CITATION_MISSING",
  PROVENANCE_INCOMPLETE: "PROVENANCE_INCOMPLETE",
  POLICY_VERSION_UNKNOWN: "POLICY_VERSION_UNKNOWN",
});

// G4. The ONLY source types admitted for a manufacturer-stated address
// behaviour. Everything else -- and specifically anything commercial
// (Cost Sheet, Quotation, Price List) or project-derived (BOQ, Specification
// Extract) -- is refused. This list is deliberately narrow: it is the set of
// source types that state what a device DOES rather than what it costs or what
// a project asked for.
export const ADDRESSABILITY_SOURCE_TYPES = Object.freeze([
  "Product Manual",
  "Product Datasheet",
  "Product Catalogue",
]);

// The canonical approval state of a governed product selection. Referenced by
// name rather than imported, because `PRIMARY_SELECTION_STATES` lives in the
// worker layer and `app/domain` must not depend on it. The literal is the same
// one `fire-alarm-panel-sizing-snapshot.mjs` already compares against.
const APPROVED_SELECTION_STATUS = "APPROVED";

const parseEvidence = (raw) => {
  if (raw && typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(String(raw ?? ""));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

// A citation exists when the evidence names where the fact came from AND what
// was said. A URL alone is not a citation: it locates a document, it does not
// state a claim. This is why a bare link can never promote a technical fact.
const hasCitation = (evidence) => {
  const location = evidence?.sourceLocation || null;
  if (!location || typeof location !== "object") return false;
  const quote = String(location.quote ?? "").trim();
  return quote.length > 0;
};

const unresolved = ({ code, why, productIdentity = null, candidates = [] }) => ({
  state: GOVERNED_ADDRESSABILITY_STATES.UNRESOLVED,
  code,
  why,
  // Every answer carries the identity it was resolved against, so a refusal is
  // as traceable as an authority.
  addressModel: null,
  consumesSlcAddress: null,
  addressesConsumedPerDevice: null,
  contextRequired: null,
  provenance: {
    resolverVersion: GOVERNED_SLC_ADDRESSABILITY_VERSION,
    productId: productIdentity?.productId ?? null,
    productSelectionStatus: productIdentity?.status ?? null,
    productSelectionCode: productIdentity?.code ?? null,
    candidateAddressModels: candidates,
    gatesPassed: [],
    refusedAt: code,
  },
});

/**
 * Resolve the governed SLC addressability authority for ONE BOQ line.
 *
 * @param {object} input
 * @param {object|null} input.productIdentity governed product identity, as
 *   returned by the canonical primary-selection resolver. `status` must be
 *   APPROVED; `productId` must name the exact product.
 * @param {Array} input.addressModelFacts current `slc_address_model` attribute
 *   rows for that product. Each row carries `attributeName`, `normalizedValue`,
 *   `reviewStatus`, `supersededAt`, `deletedAt`, `sourceType`, `evidenceJson`,
 *   `versionNumber`, `attributeId`, `sourceId`, `createdBy`, `createdAt`.
 * @returns {object} an AUTHORITATIVE or UNRESOLVED authority, never a number
 *   on its own.
 */
export const resolveGovernedSlcAddressability = ({ productIdentity = null, addressModelFacts = [] } = {}) => {
  // ---- G1: governed product identity -------------------------------------
  const productId = String(productIdentity?.productId ?? "").trim();
  if (!productId) {
    return unresolved({
      code: GOVERNED_ADDRESSABILITY_CODES.NO_GOVERNED_PRODUCT_IDENTITY,
      why: "No governed product identity resolves for this line. An address model is a statement about a specific product, so without product identity there is nothing the fact can be about.",
      productIdentity,
    });
  }
  const identityStatus = String(productIdentity?.status ?? "").trim().toUpperCase();
  if (identityStatus !== APPROVED_SELECTION_STATUS) {
    return unresolved({
      code: GOVERNED_ADDRESSABILITY_CODES.PRODUCT_IDENTITY_NOT_APPROVED,
      why: `The governed product selection for this line is ${identityStatus || "UNAVAILABLE"}, not APPROVED. A provisional candidate is a proposal; its address model must not be booked as demand.`,
      productIdentity: { ...productIdentity, productId },
    });
  }

  const facts = Array.isArray(addressModelFacts) ? addressModelFacts : [];

  // ---- G2/G3: presence and currentness -----------------------------------
  const current = facts.filter((fact) =>
    String(fact?.reviewStatus ?? "").trim() === "Approved"
    && !fact?.supersededAt
    && !fact?.deletedAt);
  const stale = facts.length - current.length;
  if (!current.length) {
    return unresolved({
      code: stale > 0
        ? GOVERNED_ADDRESSABILITY_CODES.ADDRESS_MODEL_NOT_CURRENT
        : GOVERNED_ADDRESSABILITY_CODES.NO_APPROVED_ADDRESS_MODEL,
      why: stale > 0
        ? `Every slc_address_model fact for ${productId} is superseded, deleted or unapproved. A non-current fact is not evidence of current address behaviour.`
        : `No Approved slc_address_model fact exists for ${productId}. Absence of evidence is not evidence of zero SLC addresses.`,
      productIdentity: { ...productIdentity, productId },
    });
  }

  const cited = current.filter((fact) => hasCitation(parseEvidence(fact.evidenceJson)));
  if (!cited.length) {
    return unresolved({
      code: GOVERNED_ADDRESSABILITY_CODES.CITATION_MISSING,
      why: `Every Approved slc_address_model fact for ${productId} lacks an exact evidence citation. A technical address claim must state what the document said.`,
      productIdentity: { ...productIdentity, productId },
    });
  }

  // ---- G4: source type ---------------------------------------------------
  const allowed = cited.filter((fact) => ADDRESSABILITY_SOURCE_TYPES.includes(String(fact.sourceType ?? "").trim()));
  if (!allowed.length) {
    const seen = [...new Set(cited.map((fact) => String(fact.sourceType ?? "").trim() || "unstated"))].sort();
    return unresolved({
      code: GOVERNED_ADDRESSABILITY_CODES.SOURCE_TYPE_NOT_ALLOWED_FOR_THIS_FACT,
      why: `The only approved slc_address_model facts for ${productId} cite ${seen.join(", ")}. Address behaviour is a manufacturer technical fact; no project policy admits a cost sheet, price list or project BOQ as its authority.`,
      productIdentity: { ...productIdentity, productId },
      candidates: seen,
    });
  }

  // ---- G7: closed vocabulary ---------------------------------------------
  const normalised = allowed.map((fact) => ({ fact, model: normalizeAddressModel(fact.normalizedValue) }));
  const recognised = normalised.filter((entry) => entry.model);
  if (!recognised.length) {
    return unresolved({
      code: GOVERNED_ADDRESSABILITY_CODES.UNRECOGNISED_ADDRESS_MODEL,
      why: `No approved address model for ${productId} resolves to a canonical SLC address behaviour. An unrecognised value is refused rather than guessed at.`,
      productIdentity: { ...productIdentity, productId },
      candidates: normalised.map((entry) => String(entry.fact.normalizedValue ?? "")),
    });
  }

  // ---- G6: conflict ------------------------------------------------------
  // Two current Approved tokens for one product is an unresolved conflict. The
  // resolver does NOT pick one, and does NOT average them, and does NOT let a
  // higher version silently win: "newest wins" would let a later promotion
  // quietly overturn an earlier approved engineering statement.
  const distinctTokens = [...new Set(recognised.map((entry) => entry.model.addressModel))];
  if (distinctTokens.length > 1) {
    return unresolved({
      code: GOVERNED_ADDRESSABILITY_CODES.ADDRESS_MODEL_CONFLICT,
      why: `${productId} carries ${distinctTokens.length} conflicting approved address models (${distinctTokens.join(", ")}). A conflict between approved facts is resolved by a human, not by this resolver.`,
      productIdentity: { ...productIdentity, productId },
      candidates: distinctTokens,
    });
  }

  const addressModel = distinctTokens[0];
  const semantics = ADDRESS_MODEL_SLC_DEMAND[addressModel];
  const winning = recognised.filter((entry) => entry.model.addressModel === addressModel);

  // ---- G8: provenance ----------------------------------------------------
  // Provenance is checked on the fact that actually carries the winning token.
  // One fully traceable Approved fact is enough; a second Approved copy of the
  // SAME token is corroboration, not a conflict.
  const traceable = winning.find((entry) => {
    const fact = entry.fact;
    return Boolean(
      fact.attributeId && fact.sourceId && fact.createdBy && fact.createdAt
      && fact.versionNumber !== null && fact.versionNumber !== undefined
      && parseEvidence(fact.evidenceJson)?.policyVersion);
  });
  if (!traceable) {
    return unresolved({
      code: GOVERNED_ADDRESSABILITY_CODES.PROVENANCE_INCOMPLETE,
      why: `The approved ${addressModel} fact for ${productId} is not fully traceable (attribute id, source id, version, author and promotion policy version are all required).`,
      productIdentity: { ...productIdentity, productId },
      candidates: [addressModel],
    });
  }

  const fact = traceable.fact;
  const evidence = parseEvidence(fact.evidenceJson);
  const location = evidence.sourceLocation || {};
  const corroborating = winning.length;

  return {
    state: GOVERNED_ADDRESSABILITY_STATES.AUTHORITATIVE,
    code: null,
    // WHETHER an address is consumed is a manufacturer statement, taken from the
    // canonical semantics. HOW MANY is the same statement's count.
    addressModel,
    consumesSlcAddress: semantics.consumesSlcAddress,
    addressesConsumedPerDevice: semantics.additionalAddressesConsumed,
    // SHARED_WITH_DETECTOR reports the requirement instead of inventing a
    // number: the paired detector must be counted once and this resolver will
    // not guess the pairing.
    contextRequired: semantics.contextRequired ?? null,
    basis: semantics.basis,
    provenance: {
      resolverVersion: GOVERNED_SLC_ADDRESSABILITY_VERSION,
      addressModelPolicy: evidence.policyVersion,
      productId,
      productSelectionStatus: identityStatus,
      productSelectionSafetyDecisionId: productIdentity.safetyDecisionId ?? null,
      productSelectionTechnicalApprovalId: productIdentity.technicalApprovalRequestId ?? null,
      attributeId: fact.attributeId,
      attributeVersion: fact.versionNumber,
      sourceId: fact.sourceId,
      sourceType: fact.sourceType,
      decidedBy: fact.createdBy,
      decidedAt: fact.createdAt,
      citation: {
        document: location.document ?? null,
        documentNumber: location.documentNumber ?? null,
        revision: location.revision ?? null,
        page: location.page ?? null,
        section: location.section ?? null,
        quote: location.quote ?? null,
        url: location.url ?? null,
        retrievedAt: location.retrievedAt ?? null,
      },
      originalValue: fact.originalValue ?? null,
      corroboratingFactIds: winning.map((entry) => entry.fact.attributeId).filter(Boolean),
      corroboratingFactCount: corroborating,
      gatesPassed: [
        "G1_GOVERNED_PRODUCT_IDENTITY_APPROVED",
        "G2_APPROVED_FACT_PRESENT",
        "G3_FACT_CURRENT",
        "G4_SOURCE_TYPE_MANUFACTURER_DOCUMENT",
        "G5_EXACT_CITATION_PRESENT",
        "G6_NO_UNRESOLVED_CONFLICT",
        "G7_CANONICAL_VOCABULARY",
        "G8_PROVENANCE_TRACEABLE",
      ],
      refusedAt: null,
    },
  };
};