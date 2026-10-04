import {
  KNOWLEDGE_PROMOTION_POLICY_VERSION,
  isSupersessionRelationship,
  normalizeKnowledgeFactForPromotion,
} from "../app/domain/knowledge-promotion-policy.mjs";
import {
  MIN_GOVERNED_REASON_LENGTH,
} from "../app/domain/reason-governance.mjs";
import { canonicalScopeVisible } from "./knowledge-product-resolver-runtime.mjs";
import { TECHNICAL_SOURCE_AUTHORITY_CLASSES } from "../app/domain/knowledge-source-authority.mjs";

// Governed system actor for the deterministic Knowledge fact promotion path.
// Matches the established repository convention for system actors
// (e.g. "system:spec-source-fact-promotion", "system:knowledge-identity-repair"):
// the audit trail must always make the deciding actor explicit, and a
// machine-decided promotion must never be attributed to a human engineer.
export const KNOWLEDGE_DETERMINISTIC_PROMOTION_ACTOR =
  "system:knowledge-fact-deterministic-promotion";

// Canonical governed reason recorded for deterministic promotions. The system
// path must not accept a caller-supplied justification: the decision is made
// by the fixed policy, so the recorded reason is a policy citation, never
// free-form caller text. Satisfies MIN_GOVERNED_REASON_LENGTH.
export const KNOWLEDGE_DETERMINISTIC_PROMOTION_REASON = (
  "Deterministic governed promotion: " +
  KNOWLEDGE_PROMOTION_POLICY_VERSION +
  " gates satisfied; no engineer exception review required."
);

const parse = (value, fallback = {}) => {
  try {
    if (value === null || value === undefined || value === "") return fallback;
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
};

const clean = (value) => String(value ?? "").trim();

// Source kinds whose authority the deterministic path may consume without a
// human. Everything else (price lists, quotations, RFQs, BOQs, unclassified
// uploads) stays on the human path: a reviewer judges the source, the policy
// does not bless it sight unseen.
const TECHNICAL_SOURCE_TYPES = new Set([
  "Product Datasheet",
  "Product Catalogue",
  "Technical Datasheet",
  "Manufacturer Datasheet",
  "Manual",
  "Product Manual",
]);

export async function evaluateKnowledgePromotion(
  db,
  factId,
  organizationId,
  options = {}
) {
  const deterministic =
    options?.authorization === "deterministic";
  const fact = await db
    .prepare(
      `SELECT
         f.*,
         k.sha256 source_checksum,
         k.processing_status,
         k.classification_status source_classification_status,
         k.file_name,
         k.detected_type source_detected_type,
         k.summary source_summary,
         k.extraction_version
       FROM knowledge_facts f
       JOIN knowledge_files k ON k.id=f.knowledge_file_id
       WHERE f.id=?
         AND f.organization_id=?
         AND k.organization_id=?
       LIMIT 1`
    )
    .bind(factId, organizationId, organizationId)
    .first();

  if (!fact) {
    return { status: "FACT_NOT_FOUND", factId };
  }

  if (deterministic) {
    // Deterministic governed path: only auto-learned facts without a
    // human-judgment signal may use the system path. Needs Review,
    // Rejected, and Reviewed facts stay on the human exception/review
    // path. The knowledge_facts row is never rewritten to Reviewed here:
    // machine-learned state and human-reviewed state stay distinct, and
    // the promotion audit records the explicit system actor.
    if (
      fact.review_status !== "Learned" ||
      parse(fact.attributes, {}).reviewRequired === true
    ) {
      return { status: "NOT_APPROVED", factId };
    }
  } else if (fact.review_status !== "Reviewed") {
    return { status: "NOT_APPROVED", factId };
  }

  if (fact.processing_status !== "Completed") {
    return { status: "SOURCE_NOT_PROCESSED", factId };
  }

  // Source standing: a file the governed review path has Rejected carries no
  // standing for deterministic minting, even when the individual fact row is
  // still Learned. The human path is unaffected -- a reviewer judges any
  // source -- but the system path must not promote from rejected evidence.
  if (fact.source_classification_status === "Rejected") {
    return { status: "SOURCE_REJECTED", factId };
  }

  // KN-GOVERNANCE-REPAIR (§5 authority class): the deterministic path mints
  // canonical truth without a human, so it may only consume technical-source
  // files (datasheets, catalogues, manuals). A confident token from a price
  // list, quotation, RFQ, BOQ, or unclassified upload (e.g. "poe" from a
  // pricebook) must never become a canonical attribute without review. The
  // human path is unaffected: a reviewer can judge any source.
  // KN-SCALE-4: a misclassified document must not lose technical authority.
  // The classification is a judgement and may be wrong (Pilot 1: a 232-page
  // Honeywell installation manual classified "Cost Sheet"). The authority
  // assessment is independent evidence recorded on the file, so the gate
  // accepts EITHER a technical classification OR a technical source authority.
  // Anything else -- commercial, unknown -- is still refused.
  const fileSummary = parse(fact.source_summary, {});
  const sourceAuthority = fileSummary?.sourceAuthority?.authorityClass || null;
  const technicalSource = TECHNICAL_SOURCE_TYPES.has(clean(fact.source_detected_type))
    || TECHNICAL_SOURCE_AUTHORITY_CLASSES.includes(clean(sourceAuthority));
  if (deterministic && !technicalSource) {
    return { status: "SOURCE_AUTHORITY_INSUFFICIENT", factId };
  }

  const factAttributes = parse(fact.attributes, {});
  const normalized = normalizeKnowledgeFactForPromotion(
    {
      factType: fact.fact_type,
      originalValue: fact.original_value,
      normalizedValue: fact.normalized_value,
      // P0: honour the extractor's attribute key as well as the research
      // channel's. `app/domain/knowledge-library-engine.mjs` writes the semantic
      // under `relationship`; the governed research-fact path writes
      // `relationshipType`. Reading only the latter made every engine-authored
      // semantic invisible here, which is what let a missing semantic be
      // defaulted downstream. Reading both means the author's real value is
      // passed to the allowlist and correctly REFUSED when unmapped.
      relationshipType: factAttributes.relationshipType ?? factAttributes.relationship,
      targetPartNumber: factAttributes.targetPartNumber,
    },
    { authorization: deterministic ? "deterministic" : "human" }
  );

  if (normalized.status !== "SUPPORTED") {
    return {
      ...normalized,
      factId,
    };
  }

  const attributes = parse(fact.attributes, {});
  const sourceLocation = parse(fact.source_location, {});

  const observationKey = clean(attributes.observationKey);
  const partNumber = clean(attributes.partNumber);

  if (!observationKey || !partNumber) {
    return {
      status: "MISSING_TARGET",
      factId,
    };
  }

  const partFact = await db
    .prepare(
      `SELECT *
       FROM knowledge_facts
       WHERE organization_id=?
         AND knowledge_file_id=?
         AND fact_type='Part Number'
       ORDER BY id`
    )
    .bind(organizationId, fact.knowledge_file_id)
    .all();

  const matchingPartFacts = (partFact.results || []).filter((row) => {
    const rowAttributes = parse(row.attributes, {});
    return (
      clean(rowAttributes.observationKey) === observationKey &&
      clean(row.original_value) === partNumber
    );
  });

  if (matchingPartFacts.length === 0) {
    return {
      status: "MISSING_TARGET",
      factId,
    };
  }

  if (matchingPartFacts.length > 1) {
    return {
      status: "AMBIGUOUS_TARGET",
      factId,
    };
  }

  const linked = await db
    .prepare(
      `SELECT *
       FROM knowledge_product_links
       WHERE organization_id=?
         AND knowledge_fact_id=?
       ORDER BY id`
    )
    .bind(organizationId, matchingPartFacts[0].id)
    .all();

  const links = (linked.results || []).filter(
    (row) => clean(row.existing_product_id)
  );

  if (links.length === 0) {
    return {
      status: "MISSING_TARGET",
      factId,
    };
  }

  if (links.length > 1) {
    return {
      status: "AMBIGUOUS_TARGET",
      factId,
    };
  }

  const product = await db
    .prepare(
      `SELECT *
       FROM canonical_library_products
       WHERE requested_product_id=?
       LIMIT 1`
    )
    .bind(links[0].existing_product_id)
    .first();

  if (!product) {
    return {
      status: "MISSING_TARGET",
      factId,
    };
  }

  // KN-SCOPE-1: use the resolver's single visible-scope authority instead of a
  // second, stricter rule. The old rule required Organization Library plus a
  // matching organization_id, which refused every Global Library product -- and
  // the entire live catalogue is Global Library, so no Knowledge fact could
  // ever promote to a real product. Project-scoped products stay refused
  // (no projectIds are in scope for a library-level promotion).
  if (!canonicalScopeVisible(product, organizationId, [])) {
    return {
      status: "SCOPE_CONFLICT",
      factId,
      canonicalProductId: product.id,
    };
  }

  if (!clean(fact.source_checksum) || Object.keys(sourceLocation).length === 0) {
    return {
      status: "INVALID_PROVENANCE",
      factId,
    };
  }

  // Relationship target discipline (KN-GOVERNANCE-REPAIR §5): the target
  // product resolves through the same exactly-one rule as the source link.
  // Zero or several candidates is a missing/ambiguous target, never a guess.
  // Lifecycle facts carry no target; they resolve against the source product.
  let targetProductId = null;
  if (normalized.targetTable === "engineering_relationships") {
    const targetCandidates = await db
      .prepare(
        `SELECT p.id, p.organization_id, p.library_scope, p.library_project_id
         FROM library_products p
         WHERE (p.normalized_part_number=? OR REPLACE(p.normalized_part_number,'-','')=?)
           AND p.identity_status='Active'
           AND p.superseded_by_product_id IS NULL
           AND (p.library_scope='Global Library'
             OR (p.library_scope='Organization Library' AND p.organization_id=?))
         ORDER BY p.id`
      )
      .bind(
        clean(normalized.targetPartNumber).toUpperCase(),
        clean(normalized.targetPartNumber).toUpperCase().replace(/-/g, ""),
        organizationId
      )
      .all();
    const candidates = targetCandidates.results || [];
    if (candidates.length === 0) {
      return { status: "MISSING_TARGET", factId };
    }
    if (candidates.length > 1) {
      return { status: "AMBIGUOUS_TARGET", factId };
    }
    targetProductId = candidates[0].id;
  }

  return {
    status: "PROMOTABLE",
    factId,
    knowledgeFileId: fact.knowledge_file_id,
    canonicalProductId: product.id,
    targetTable: normalized.targetTable,
    attributeName: normalized.attributeName || null,
    relationshipType: normalized.relationshipType || null,
    targetProductId,
    originalValue: normalized.originalValue,
    normalizedValue: normalized.normalizedValue,
    unit: normalized.unit ?? null,
    sourceChecksum: fact.source_checksum,
    sourceLocation,
  };
}


const promotionUid = (prefix) =>
  `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;

export async function promoteKnowledgeFact(
  db,
  {
    factId,
    organizationId,
    actor,
    reason,
    idempotencyKey,
    authorization = "human",
    _raceRetry = false,
  }
) {
  const key = clean(idempotencyKey);

  if (!key) {
    return {
      status: "IDEMPOTENCY_KEY_REQUIRED",
      factId,
    };
  }

  const governedReason = clean(reason);

  if (governedReason.length < MIN_GOVERNED_REASON_LENGTH) {
    return {
      status: "PROMOTION_REASON_REQUIRED",
      factId,
    };
  }

  if (key) {
    const existingPromotion = await db
      .prepare(
        `SELECT *
         FROM knowledge_promotions
         WHERE organization_id=?
           AND idempotency_key=?
         LIMIT 1`
      )
      .bind(organizationId, key)
      .first();

    if (
      existingPromotion &&
      existingPromotion.knowledge_fact_id !== factId
    ) {
      return {
        status: "IDEMPOTENCY_KEY_CONFLICT",
        factId,
      };
    }

    if (existingPromotion) {
      const snapshot = parse(
        existingPromotion.new_snapshot_json,
        {}
      );

      return {
        status:
          existingPromotion.action === "Evidence Only"
            ? "EVIDENCE_ONLY"
            : "PROMOTED",
        factId: existingPromotion.knowledge_fact_id,
        knowledgeFileId: existingPromotion.knowledge_file_id,
        canonicalProductId: existingPromotion.canonical_product_id,
        canonicalEntityType:
          existingPromotion.canonical_entity_type,
        canonicalEntityId:
          existingPromotion.canonical_entity_id,
        productSourceId:
          existingPromotion.product_source_id,
        attributeName: snapshot.attributeName || null,
        originalValue: snapshot.originalValue ?? null,
        normalizedValue: snapshot.normalizedValue ?? null,
        unit: snapshot.unit ?? null,
        policyVersion: existingPromotion.policy_version,
        idempotent: true,
      };
    }
  }

  const existingFactPromotion = await db
    .prepare(
      `SELECT *
       FROM knowledge_promotions
       WHERE organization_id=?
         AND knowledge_fact_id=?
       LIMIT 1`
    )
    .bind(organizationId, factId)
    .first();

  if (existingFactPromotion) {
    const snapshot = parse(
      existingFactPromotion.new_snapshot_json,
      {}
    );

    return {
      status:
        existingFactPromotion.action === "Evidence Only"
          ? "EVIDENCE_ONLY"
          : "PROMOTED",
      factId: existingFactPromotion.knowledge_fact_id,
      knowledgeFileId: existingFactPromotion.knowledge_file_id,
      canonicalProductId: existingFactPromotion.canonical_product_id,
      canonicalEntityType:
        existingFactPromotion.canonical_entity_type,
      canonicalEntityId:
        existingFactPromotion.canonical_entity_id,
      productSourceId:
        existingFactPromotion.product_source_id,
      attributeName: snapshot.attributeName || null,
      originalValue: snapshot.originalValue ?? null,
      normalizedValue: snapshot.normalizedValue ?? null,
      unit: snapshot.unit ?? null,
      policyVersion: existingFactPromotion.policy_version,
      idempotent: true,
    };
  }

  const evaluation = await evaluateKnowledgePromotion(
    db,
    factId,
    organizationId,
    { authorization }
  );

  if (evaluation.status !== "PROMOTABLE") {
    return evaluation;
  }

  const sourceRow = await db
    .prepare(
      `SELECT
         f.confidence fact_confidence,
         k.file_name,
         k.detected_type,
         k.extraction_version
       FROM knowledge_facts f
       JOIN knowledge_files k ON k.id=f.knowledge_file_id
       WHERE f.id=?
         AND f.organization_id=?
         AND k.organization_id=?
       LIMIT 1`
    )
    .bind(factId, organizationId, organizationId)
    .first();

  if (!sourceRow) {
    return {
      status: "FACT_NOT_FOUND",
      factId,
    };
  }

  // Destination-specific conflict and identity resolution. Attributes compare
  // normalized values; relationships compare the (source, target, kind)
  // triple -- a second kind between the same pair is a second relationship,
  // not a contradiction; lifecycle compares status per product, where two
  // different active statuses is a genuine contradiction with no supersession
  // model to resolve it. Nothing here overwrites canonical truth silently.
  let entityTable = null;
  let entityId = null;
  let sameValueEntity = null;
  let evidenceOnlyNote = null;
  if (evaluation.targetTable === "product_attributes") {
    const activeAttributes = await db
      .prepare(
        `SELECT *
         FROM product_attributes
         WHERE product_id=?
           AND attribute_name=?
           AND deleted_at IS NULL
           AND superseded_at IS NULL
           AND review_status<>'Rejected'
         ORDER BY created_at DESC, id DESC`
      )
      .bind(
        evaluation.canonicalProductId,
        evaluation.attributeName
      )
      .all();

    const activeAttributeRows = activeAttributes.results || [];

    sameValueEntity = activeAttributeRows.find(
      (row) =>
        clean(row.normalized_value) ===
        clean(evaluation.normalizedValue)
    ) || null;

    const conflictingAttributes = activeAttributeRows.filter(
      (row) =>
        clean(row.normalized_value) !==
        clean(evaluation.normalizedValue)
    );

    if (conflictingAttributes.length) {
      return {
        status: "CONFLICT",
        factId,
        knowledgeFileId: evaluation.knowledgeFileId,
        canonicalProductId: evaluation.canonicalProductId,
        attributeName: evaluation.attributeName,
        existingValue:
          conflictingAttributes[0].normalized_value,
        existingValues: conflictingAttributes.map(
          (row) => row.normalized_value
        ),
        proposedValue: evaluation.normalizedValue,
        policyVersion: KNOWLEDGE_PROMOTION_POLICY_VERSION,
      };
    }
    entityTable = "product_attributes";
    entityId = sameValueEntity?.id || promotionUid("productattribute");
  } else if (evaluation.targetTable === "engineering_relationships") {
    // Human-only destination, double-guarded: evaluate() already refuses the
    // deterministic path, but the writer must not mint Approved relationships
    // on any path except an explicit human promotion.
    if (authorization !== "human") {
      return { status: "HUMAN_REVIEW_REQUIRED", factId };
    }
    // KN-REL-1: relationship authority is engineering_relationships, the
    // structure product matching and technical requirements actually read
    // (docs/product-compatibility-disposition.md deprecated
    // product_compatibility as its duplicate).
    //
    // Two existing shapes are honoured before writing anything, so reviewed
    // evidence never becomes a second authority for a relationship that is
    // already canonical:
    //   1. the precise shape this writer produces (right side = a Product);
    //   2. the older seeded shape (right side = ('System', 'the control
    //      unit')), which expresses the same manufacturer claim for the same
    //      left product. Reviewed evidence against it is EVIDENCE_ONLY and
    //      the existing row stays canonical.
    const precise = await db
      .prepare(
        `SELECT *
         FROM engineering_relationships
         WHERE left_entity_type='Product'
           AND left_entity_id=?
           AND right_entity_type='Product'
           AND right_entity_id=?
           AND relationship_type=?
           AND status<>'Rejected'
           AND (project_id IS NULL OR project_id=?)
         ORDER BY created_at DESC, id DESC`
      )
      .bind(
        evaluation.canonicalProductId,
        evaluation.targetProductId,
        evaluation.relationshipType,
        null
      )
      .all();
    const preciseRows = precise.results || [];
    if (preciseRows.length) {
      sameValueEntity = preciseRows[0];
    } else {
      // KN-SUPERSESSION-1 -- a COMPIETING SUCCESSOR is a conflict, not a second row.
      //
      // The `precise` lookup above only matches the same target, so without this
      // guard a later fact naming a DIFFERENT successor would simply fail to
      // match and fall through to a second `Superseded By` row. Two products
      // would then each be recorded as superseding the same legacy item, with
      // nothing able to say which the manufacturer actually stated. That is
      // "latest source wins" by accident.
      //
      // Scoped to supersession deliberately: for `Compatible With`, several
      // compatible partners is the normal, correct case, and a conflict guard
      // there would break the existing compatibility model.
      if (isSupersessionRelationship(evaluation.relationshipType)) {
        const competing = await db
          .prepare(
            `SELECT p.part_number AS right_part_number, r.id
             FROM engineering_relationships r
             JOIN library_products p ON p.id = r.right_entity_id
             WHERE r.left_entity_type='Product'
               AND r.left_entity_id=?
               AND r.right_entity_type='Product'
               AND r.relationship_type=?
               AND r.status<>'Rejected'
               AND (r.project_id IS NULL OR r.project_id=?)
             ORDER BY r.created_at DESC, r.id DESC`
          )
          .bind(evaluation.canonicalProductId, evaluation.relationshipType, null)
          .all();
        const competingRows = competing.results || [];
        if (competingRows.length) {
          const target = await db
            .prepare("SELECT part_number FROM library_products WHERE id=?")
            .bind(evaluation.targetProductId)
            .first();
          return {
            status: "CONFLICT",
            factId,
            knowledgeFileId: evaluation.knowledgeFileId,
            canonicalProductId: evaluation.canonicalProductId,
            attributeName: "relationship_type",
            relationshipType: evaluation.relationshipType,
            existingValue: competingRows[0].right_part_number,
            existingValues: [...new Set(competingRows.map((row) => row.right_part_number))],
            proposedValue: target?.part_number ?? null,
            policyVersion: KNOWLEDGE_PROMOTION_POLICY_VERSION,
          };
        }
      }
      const legacyShape = await db
        .prepare(
          `SELECT *
           FROM engineering_relationships
           WHERE left_entity_type='Product'
             AND left_entity_id=?
             AND right_entity_type='System'
             AND relationship_type=?
             AND status='Approved'
             AND (project_id IS NULL OR project_id=?)
           ORDER BY created_at DESC, id DESC`
        )
        .bind(
          evaluation.canonicalProductId,
          evaluation.relationshipType,
          null
        )
        .all();
      if ((legacyShape.results || []).length) {
        // KN-LEDGER-1: do NOT return early. The existing Approved relationship
        // stays canonical and no second row is written, but the outcome is
        // recorded like any other promotion: the reviewed fact is evidence, and
        // an evidence-only outcome that leaves no ledger row is invisible to
        // audit. Falling through writes the promotion record with action
        // 'Evidence Only' against the existing entity, which is exactly what
        // the attribute path already did for an equivalent-value promotion.
        sameValueEntity = legacyShape.results[0];
        evidenceOnlyNote =
          "An Approved relationship for this product and kind already exists in the seeded ('System', 'the control unit') shape. It remains canonical; the reviewed fact is additional evidence and no second relationship row was written.";
      }
    }
    entityTable = "engineering_relationships";
    entityId = sameValueEntity?.id || promotionUid("engineeringrelationship");
  } else if (evaluation.targetTable === "product_lifecycle_events") {
    if (authorization !== "human") {
      return { status: "HUMAN_REVIEW_REQUIRED", factId };
    }
    const activeEvents = await db
      .prepare(
        `SELECT *
         FROM product_lifecycle_events
         WHERE product_id=?
           AND review_status<>'Rejected'
         ORDER BY created_at DESC, id DESC`
      )
      .bind(evaluation.canonicalProductId)
      .all();
    const events = activeEvents.results || [];
    sameValueEntity = events.find(
      (row) => clean(row.lifecycle_status) === clean(evaluation.normalizedValue)
    ) || null;
    const conflictingEvents = events.filter(
      (row) => clean(row.lifecycle_status) !== clean(evaluation.normalizedValue)
    );
    if (!sameValueEntity && conflictingEvents.length) {
      return {
        status: "CONFLICT",
        factId,
        knowledgeFileId: evaluation.knowledgeFileId,
        canonicalProductId: evaluation.canonicalProductId,
        attributeName: "lifecycle_status",
        existingValue: conflictingEvents[0].lifecycle_status,
        existingValues: conflictingEvents.map((row) => row.lifecycle_status),
        proposedValue: evaluation.normalizedValue,
        policyVersion: KNOWLEDGE_PROMOTION_POLICY_VERSION,
      };
    }
    entityTable = "product_lifecycle_events";
    entityId = sameValueEntity?.id || promotionUid("productlifecycle");
  } else {
    return { status: "DESTINATION_UNSUPPORTED", factId };
  }

  let productSource = await db
    .prepare(
      `SELECT *
       FROM product_sources
       WHERE organization_id=?
         AND checksum=?
         AND scope_type='Organization'
         AND project_id IS NULL
       LIMIT 1`
    )
    .bind(organizationId, evaluation.sourceChecksum)
    .first();

  const sourceId = productSource?.id || promotionUid("productsource");
  const evidenceId = promotionUid("evidence");
  const promotionId = promotionUid("knowledgepromotion");

  const sourceLocation =
    evaluation.sourceLocation &&
    typeof evaluation.sourceLocation === "object"
      ? evaluation.sourceLocation
      : {};

  const actorId = clean(actor?.id);
  const actorRole = clean(actor?.permission || actor?.role) || "Unknown";
  const decidedReason = governedReason;

  const statements = [];

  if (!productSource) {
    const metadata = {
      knowledgeFileId: evaluation.knowledgeFileId,
      sourceChecksum: evaluation.sourceChecksum,
      sourceLocation,
      extractionVersion: sourceRow.extraction_version,
      promotionPolicyVersion: KNOWLEDGE_PROMOTION_POLICY_VERSION,
      authorityReviewRequired: true,
    };

    statements.push(
      db
        .prepare(
          `INSERT INTO product_sources (
             id,
             project_id,
             document_id,
             document_version_id,
             checksum,
             source_type,
             authority,
             scope_type,
             file_name,
             release_version,
             effective_from,
             valid_until,
             currency,
             validity_state,
             review_status,
             downstream_use,
             metadata,
             created_by,
             organization_id
           ) VALUES (
             ?,
             NULL,
             NULL,
             NULL,
             ?,
             ?,
             'Source Document — Review Required',
             'Organization',
             ?,
             NULL,
             NULL,
             NULL,
             NULL,
             'Validity Review Required',
             'Needs Review',
             'Discovery Only',
             ?,
             ?,
             ?
           )`
        )
        .bind(
          sourceId,
          evaluation.sourceChecksum,
          sourceRow.detected_type,
          sourceRow.file_name,
          JSON.stringify(metadata),
          actorId,
          organizationId
        )
    );
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO product_source_evidence (
           id,
           product_id,
           source_id,
           sheet,
           row_number,
           page,
           cells,
           original_text,
           parser_version
         ) VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        evidenceId,
        evaluation.canonicalProductId,
        sourceId,
        clean(sourceLocation.sheet) || null,
        sourceLocation.row ?? null,
        sourceLocation.page ?? null,
        JSON.stringify([sourceLocation]),
        evaluation.originalValue,
        clean(sourceRow.extraction_version) || "knowledge-promotion-v1"
      )
  );

  const attributeEvidence = {
    knowledgeFactId: factId,
    knowledgeFileId: evaluation.knowledgeFileId,
    sourceChecksum: evaluation.sourceChecksum,
    sourceLocation,
    policyVersion: KNOWLEDGE_PROMOTION_POLICY_VERSION,
  };

  // Entity inserts, one per destination. The human path writes Approved
  // canonical rows: the human already reviewed the fact, resolved the link,
  // and supplied a governed reason at promote time, and the promotion audit
  // row records all three -- that chain IS the approval, and a second review
  // designed for datasheet-ingested rows (document versions knowledge files
  // do not carry) would be theater, not governance. The deterministic path
  // writes Reviewed: controlled vocabulary plus evidence gates, consumable
  // where Reviewed suffices and upgradeable through attribute review.
  // Attributes carry the evaluated value;
  // relationships carry the resolved pair plus the full human provenance
  // (fact, link, actor, reason) so an Approved relationship is always
  // attributable to the governed chain that produced it -- never a bare
  // system assertion. Lifecycle events land Needs Review: the fact reviewer
  // approves the evidence, the lifecycle workstream owns the status.
  if (!sameValueEntity && entityTable === "product_attributes") {
    statements.push(
      db
        .prepare(
          `INSERT INTO product_attributes (
             id,
             product_id,
             variant_id,
             attribute_definition_id,
             attribute_name,
             value_json,
             original_value,
             normalized_value,
             unit,
             source_id,
             evidence_json,
             confidence,
             review_status,
             version_number,
             created_by
           ) VALUES (
             ?,
             ?,
             NULL,
             NULL,
             ?,
             ?,
             ?,
             ?,
             ?,
             ?,
             ?,
             ?,
             ?,
             1,
             ?
           )`
        )
        .bind(
          entityId,
          evaluation.canonicalProductId,
          evaluation.attributeName,
          JSON.stringify({
            original: evaluation.originalValue,
            normalized: evaluation.normalizedValue,
            unit: evaluation.unit,
          }),
          evaluation.originalValue,
          evaluation.normalizedValue,
          evaluation.unit,
          sourceId,
          JSON.stringify(attributeEvidence),
          Number(sourceRow.fact_confidence || 0),
          authorization === "human" ? "Approved" : "Reviewed",
          actorId
        )
    );
  }

  if (!sameValueEntity && entityTable === "engineering_relationships") {
    // KN-REL-1: written as a global manufacturer rule (project_id NULL) in the
    // same shape the existing seeded compatibility rows use, with the reviewed
    // fact, its document provenance and the deciding human recorded in
    // `conditions` -- the structure's only evidence-bearing text column.
    statements.push(
      db
        .prepare(
          `INSERT INTO engineering_relationships (
             id,
             project_id,
             left_entity_type,
             left_entity_id,
             relationship_type,
             right_entity_type,
             right_entity_id,
             conditions,
             exceptions,
             fact_type,
             scope_type,
             scope_id,
             provenance_fact_id,
             confidence,
             status,
             version_number,
             reviewed_by,
             reviewed_at,
             created_by
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .bind(
          entityId,
          null,
          "Product",
          evaluation.canonicalProductId,
          evaluation.relationshipType,
          "Product",
          evaluation.targetProductId,
          JSON.stringify([
            {
              type: "documented_evidence",
              knowledgeFactId: factId,
              knowledgeFileId: evaluation.knowledgeFileId,
              sourceChecksum: evaluation.sourceChecksum,
              sourceLocation,
              policyVersion: KNOWLEDGE_PROMOTION_POLICY_VERSION,
              decidedBy: actorId,
              decidedRole: actorRole,
              decidedReason,
            },
          ]),
          JSON.stringify([]),
          "Manufacturer Rule",
          "Product",
          evaluation.canonicalProductId,
          // engineering_relationships.provenance_fact_id is a foreign key to
          // engineering_facts(id), NOT to knowledge_facts(id): a Knowledge fact
          // id must never be written there or the insert fails its FK. The
          // cross-system provenance (fact id, file, checksum, location, who
          // decided and why) is carried in `conditions` above, which is this
          // structure's only free-form evidence field.
          null,
          Number(sourceRow.fact_confidence || 0),
          "Approved",
          1,
          actorId,
          new Date().toISOString(),
          actorId
        )
    );
  }

  if (!sameValueEntity && entityTable === "product_lifecycle_events") {
    const obsoletePartNumber = clean(
      (await db
        .prepare("SELECT part_number FROM library_products WHERE id=?")
        .bind(evaluation.canonicalProductId)
        .first())?.part_number
    );
    statements.push(
      db
        .prepare(
          `INSERT INTO product_lifecycle_events (
             id,
             source_id,
             product_id,
             obsolete_part_number,
             lifecycle_status,
             replacement_candidates,
             review_status,
             source_location
           ) VALUES (?,?,?,?,?,?,?,?)`
        )
        .bind(
          entityId,
          sourceId,
          evaluation.canonicalProductId,
          obsoletePartNumber,
          evaluation.normalizedValue,
          JSON.stringify([]),
          "Needs Review",
          JSON.stringify(sourceLocation)
        )
    );
  }

  const canonicalEntityType =
    entityTable === "engineering_relationships"
      ? "Engineering Relationship"
      : entityTable === "product_lifecycle_events"
        ? "Product Lifecycle Event"
        : "Product Attribute";
  const newSnapshot = {
    ...(evidenceOnlyNote ? { evidenceOnlyNote } : {}),
    productId: evaluation.canonicalProductId,
    entityType: canonicalEntityType,
    entityId: entityId,
    attributeName: evaluation.attributeName || evaluation.relationshipType || "lifecycle_status",
    originalValue: evaluation.originalValue,
    normalizedValue: evaluation.normalizedValue,
    unit: evaluation.unit ?? null,
    targetProductId: evaluation.targetProductId || null,
    reviewStatus:
      sameValueEntity?.review_status
        || (entityTable === "product_lifecycle_events"
          ? "Needs Review"
          : authorization === "human" ? "Approved" : "Reviewed"),
    versionNumber:
      Number(sameValueEntity?.version_number || 1),
    productSourceId: sourceId,
  };

  statements.push(
    db
      .prepare(
        `INSERT INTO knowledge_promotions (
           id,
           organization_id,
           knowledge_fact_id,
           knowledge_file_id,
           canonical_product_id,
           canonical_entity_type,
           canonical_entity_id,
           product_source_id,
           action,
           policy_version,
           source_checksum,
           previous_snapshot_json,
           new_snapshot_json,
           reason,
           decided_by,
           decided_role,
           idempotency_key
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        promotionId,
        organizationId,
        factId,
        evaluation.knowledgeFileId,
        evaluation.canonicalProductId,
        canonicalEntityType,
        entityId,
        sourceId,
        sameValueEntity ? "Evidence Only" : "Promoted",
        KNOWLEDGE_PROMOTION_POLICY_VERSION,
        evaluation.sourceChecksum,
        JSON.stringify({}),
        JSON.stringify(newSnapshot),
        decidedReason,
        actorId,
        actorRole,
        clean(idempotencyKey)
      )
  );

  try {
    await db.batch(statements);
  } catch (error) {
    const message = String(error?.message || error);

    const canonicalAttributeRace =
      /UNIQUE constraint failed:\s*product_attributes\.product_id,\s*product_attributes\.attribute_name/i.test(
        message
      );

    if (canonicalAttributeRace && !_raceRetry) {
      return promoteKnowledgeFact(db, {
        factId,
        organizationId,
        actor,
        reason: governedReason,
        idempotencyKey: key,
        authorization,
        _raceRetry: true,
      });
    }

    throw error;
  }

  return {
    status: sameValueEntity ? "EVIDENCE_ONLY" : "PROMOTED",
    factId,
    knowledgeFileId: evaluation.knowledgeFileId,
    canonicalProductId: evaluation.canonicalProductId,
    canonicalEntityType,
    canonicalEntityId: entityId,
    productSourceId: sourceId,
    attributeName: evaluation.attributeName || evaluation.relationshipType || "lifecycle_status",
    originalValue: evaluation.originalValue,
    normalizedValue: evaluation.normalizedValue,
    unit: evaluation.unit ?? null,
    targetProductId: evaluation.targetProductId || null,
    ...(evidenceOnlyNote ? { note: evidenceOnlyNote } : {}),
    policyVersion: KNOWLEDGE_PROMOTION_POLICY_VERSION,
    idempotent: false,
  };
}
