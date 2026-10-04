// KN-SCALE-2 -- governed authoring of researched Knowledge observations.
//
// Pilot 1 had to insert researched facts with the generic extractor's
// persistence contract because Knowledge had no fact-authoring interface. That
// proved the architecture but is not the production interface for an internet
// research agent: the agent needs a governed write path that accepts its
// findings as OBSERVATIONS and nothing more.
//
// Invariants this module enforces, structurally:
//   * it can only write knowledge_facts -- never product_attributes, never
//     engineering_relationships, never a promotion, never a link;
//   * every fact it accepts is review_status 'Learned' or 'Needs Review'; no
//     caller value can reach 'Reviewed', 'Approved' or anything else;
//   * identity is CONTENT-ADDRESSED, so replaying a finding is a no-op while
//     two independent sources stay two distinct evidence records;
//   * provenance is mandatory and structured, so a fact can never be authored
//     without a document, a location and a retrieval date.
import { KNOWLEDGE_PROMOTION_ELIGIBILITY } from "./knowledge-promotion-policy.mjs";
import { classifyCandidateDisposition } from "./knowledge-candidate-qualification.mjs";

export const KNOWLEDGE_RESEARCH_FACT_METHOD =
  "external-research: first-party manufacturer document, atomic fact extraction";

const MAX_VALUE_LENGTH = 500;
const MAX_QUOTE_LENGTH = 2_000;
const MIN_REASON_LENGTH = 5;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const problem = (status, message, extra = {}) => ({ ok: false, status, message, ...extra });

// The governed fact-type vocabulary is the promotion policy's own table: every
// type a fact may carry is deliberately classified there, so an authoring agent
// cannot invent a type the rest of the system has never had a reason about.
export const RESEARCH_FACT_TYPES = Object.freeze(
  Object.keys(KNOWLEDGE_PROMOTION_ELIGIBILITY).sort(),
);

/** Normalize a caller-supplied fact type to the governed vocabulary. */
export const normalizeResearchFactType = (value) => {
  const candidate = clean(value);
  if (!candidate) return "";
  const exact = RESEARCH_FACT_TYPES.find((type) => type === candidate);
  if (exact) return exact;
  const caseInsensitive = RESEARCH_FACT_TYPES.find(
    (type) => type.toLowerCase() === candidate.toLowerCase(),
  );
  return caseInsensitive || "";
};

/**
 * Content-addressed fact identity.
 *
 * The same finding submitted twice -- same source, same location, same product
 * context, same type, same value -- resolves to the same primary key, so a
 * replay cannot create a second observation. Two different sources, a different
 * location, or a different value each resolve to their own key, so independent
 * corroboration and divergence both survive.
 */
export const researchFactId = ({
  knowledgeFileId,
  organizationId,
  sourceLocation,
  factType,
  normalizedValue,
  partNumber,
  relationshipTarget,
}) => {
  const locationKey = [
    sourceLocation?.page ?? "",
    sourceLocation?.section ?? "",
    sourceLocation?.documentNumber ?? "",
    sourceLocation?.quote ?? "",
  ].join("|");
  const canonical = [
    organizationId,
    knowledgeFileId,
    locationKey,
    clean(factType),
    clean(normalizedValue),
    clean(partNumber).toUpperCase(),
    clean(relationshipTarget).toUpperCase(),
  ].join("\u001f");
  // FNV-1a over the canonical string, rendered as 24 hex characters: stable,
  // dependency-free and collision-safe at this scale (24 hex = 96 bits).
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const second = (() => {
    let value = 0x1000193;
    for (let index = canonical.length - 1; index >= 0; index -= 1) {
      value ^= canonical.charCodeAt(index);
      value = Math.imul(value, 0x85ebca6b) >>> 0;
    }
    return value;
  })();
  return `knowledgeFact_r${hash.toString(16).padStart(8, "0")}${second.toString(16).padStart(16, "0")}`;
};

const parseObject = (value) => {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

/**
 * Validate and normalize a researched-fact submission. Pure: it performs no
 * database access, so the route stays a thin, governed shell around it.
 */
export const assessResearchFactSubmission = ({ file, organizationId, payload = {} } = {}) => {
  if (!file || file.organization_id !== organizationId) {
    return problem("KNOWLEDGE_FILE_NOT_FOUND", "The source file is not in this organization.");
  }

  const factType = normalizeResearchFactType(payload.factType);
  if (!payload.factType || !factType) {
    return problem(
      "KNOWLEDGE_FACT_TYPE_UNSUPPORTED",
      `factType must be a governed Knowledge fact type. Allowed: ${RESEARCH_FACT_TYPES.join(", ")}.`,
    );
  }

  const originalValue = clean(payload.originalValue);
  const normalizedValue = clean(payload.normalizedValue ?? originalValue);
  if (!originalValue) {
    return problem("KNOWLEDGE_FACT_VALUE_REQUIRED", "originalValue is required.");
  }
  if (originalValue.length > MAX_VALUE_LENGTH || normalizedValue.length > MAX_VALUE_LENGTH) {
    return problem(
      "KNOWLEDGE_FACT_VALUE_TOO_LONG",
      `A researched fact value may not exceed ${MAX_VALUE_LENGTH} characters.`,
    );
  }

  const suppliedLocation = parseObject(payload.sourceLocation);
  const page = suppliedLocation.page ?? null;
  const section = clean(suppliedLocation.section);
  if (page == null && !section) {
    return problem(
      "KNOWLEDGE_FACT_LOCATION_REQUIRED",
      "sourceLocation must carry a page or a section: a fact without a location cannot be reviewed against its source.",
    );
  }
  const quote = clean(suppliedLocation.quote);
  if (!quote) {
    return problem(
      "KNOWLEDGE_FACT_QUOTE_REQUIRED",
      "sourceLocation.quote is required: the reviewer must see the exact source text.",
    );
  }
  if (quote.length > MAX_QUOTE_LENGTH) {
    return problem(
      "KNOWLEDGE_FACT_QUOTE_TOO_LONG",
      `A source quote may not exceed ${MAX_QUOTE_LENGTH} characters.`,
    );
  }

  const documentNumber = clean(suppliedLocation.documentNumber);
  if (!documentNumber) {
    return problem(
      "KNOWLEDGE_FACT_DOCUMENT_REQUIRED",
      "sourceLocation.documentNumber is required: research evidence must identify its document.",
    );
  }

  const observationKey = clean(payload.observationKey);
  if (observationKey.length < 3 || observationKey.length > 200) {
    return problem(
      "KNOWLEDGE_FACT_OBSERVATION_KEY_REQUIRED",
      "observationKey is required (3-200 characters) so the fact can be resolved to a product context.",
    );
  }

  const partNumber = clean(payload.partNumber);
  const relationshipTarget = clean(payload.targetPartNumber);

  const extractionMethod = clean(payload.extractionMethod) || KNOWLEDGE_RESEARCH_FACT_METHOD;
  const retrievalMethod = clean(payload.retrievalMethod);
  if (retrievalMethod.length < MIN_REASON_LENGTH) {
    return problem(
      "KNOWLEDGE_FACT_RETRIEVAL_REQUIRED",
      "retrievalMethod is required: state how the source was obtained (e.g. first-party manufacturer document URL).",
    );
  }

  const researchNote = clean(payload.note);
  const researchReason = clean(payload.reason);
  if (researchNote.length > MAX_QUOTE_LENGTH) {
    return problem("KNOWLEDGE_FACT_NOTE_TOO_LONG", "note is too long.");
  }

  const confidenceRaw = Number(payload.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(100, Math.round(confidenceRaw)))
    : 70;

  // Review state is DERIVED, never supplied. This is the structural reason an
  // authoring agent cannot smuggle in canonical authority: the only two states
  // it can produce are the two states that still require a human decision.
  const reviewStatus = confidence < 60 ? "Needs Review" : "Learned";

  const candidateDisposition = classifyCandidateDisposition(normalizedValue).disposition;

  const factId = researchFactId({
    knowledgeFileId: file.id,
    organizationId,
    sourceLocation: { ...suppliedLocation, page, section, quote, documentNumber },
    factType,
    normalizedValue,
    partNumber,
    relationshipTarget,
  });

  return {
    ok: true,
    fact: {
      id: factId,
      organizationId,
      knowledgeFileId: file.id,
      factType,
      originalValue,
      normalizedValue,
      reviewStatus,
      confidence,
      attributes: {
        observationKey,
        partNumber,
        ...(relationshipTarget ? { targetPartNumber: relationshipTarget, relationshipType: clean(payload.relationshipType) || undefined } : {}),
        researchMethod: extractionMethod,
        researchRetrievedAt: clean(suppliedLocation.retrievedAt) || clean(payload.retrievedAt),
        candidateDisposition,
        authoringChannel: "research-fact-api",
        ...(researchNote ? { note: researchNote } : {}),
        ...(researchReason ? { researchReason } : {}),
      },
      sourceLocation: {
        ...suppliedLocation,
        page,
        section,
        quote,
        documentNumber,
        knowledgeFileId: file.id,
        fileName: file.file_name,
        extractionMethod,
        retrievalMethod,
      },
    },
  };
};

/**
 * Build the governed INSERT for an accepted fact. `INSERT OR IGNORE` on the
 * content-addressed primary key is what makes an exact replay a no-op without a
 * separate idempotency table and without a schema change.
 */
export const researchFactInsertStatement = (db, fact) =>
  db
    .prepare(
      `INSERT OR IGNORE INTO knowledge_facts
         (id, organization_id, knowledge_file_id, fact_type, fact_key, original_value,
          normalized_value, attributes, confidence, review_status, source_location, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      fact.id,
      fact.organizationId,
      fact.knowledgeFileId,
      fact.factType,
      `research:${fact.attributes.observationKey}:${fact.factType.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      fact.originalValue,
      fact.normalizedValue,
      JSON.stringify(fact.attributes),
      fact.confidence,
      fact.reviewStatus,
      JSON.stringify(fact.sourceLocation),
      new Date().toISOString(),
    );
