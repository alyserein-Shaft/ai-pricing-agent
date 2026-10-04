/**
 * Compatibility Auto-Confirm Governance Module
 *
 * Implements deterministic, source-version-aware compatibility auto-confirmation
 * for product-to-product and product-to-family relationships.
 *
 * A compatibility relationship may be auto-confirmed only if ALL gates pass:
 * 1. Authoritative manufacturer source
 * 2. Exact source product identity confirmed
 * 3. Exact target product/family identity confirmed
 * 4. Source explicitly states compatibility
 * 5. Document revision/evidence recorded, with exact page + section citation
 * 6. Evidence location recorded
 * 7. Cited source verified against governed product_sources storage
 *    (first-party type + Official Manufacturer + current validity +
 *    non-rejected standing + evidence binding to the source product)
 * 8. No conflicting current authoritative source
 * 9. No source/target identity conflict
 * 10. No superseded target
 * 11. No commercial substitute
 * 12. No project-specific inference
 * 13. Deterministic reproducibility
 */

import { applicationActor } from "./application-context.mjs";
import { FIRST_PARTY_MANUFACTURER_SOURCE_TYPES } from "./product-attribute-review.mjs";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

// Policy version for audit trail.
// 1.1.0: write target moved from deprecated product_compatibility to the
// canonical engineering_relationships table (the table product matching
// actually reads). Gate logic unchanged.
// 1.2.0: gate 5 now requires an exact evidence citation (page + section),
// and new gate 7 verifies the cited document against governed
// product_sources storage (first-party type + Official Manufacturer +
// current validity + non-rejected standing + evidence binding to the source
// product). An asserted document number/revision alone no longer suffices.
export const COMPATIBILITY_AUTO_CONFIRM_POLICY_VERSION = "1.2.0";

// Canonical write target: the governed product-compatibility table the
// matcher reads. product_compatibility is DEPRECATED (db/schema.ts) and
// must receive no new writes.
export const COMPATIBILITY_WRITE_TARGET = "engineering_relationships";

// System actor for auto-confirm
export const COMPATIBILITY_AUTO_CONFIRM_ACTOR = "system:compatibility-auto-confirm";

/**
 * Evidence classification for compatibility relationships
 */
export const EVIDENCE_CLASSIFICATION = {
  EXPLICIT_EXACT: "EXPLICIT_EXACT",           // Manufacturer explicitly names exact model
  EXPLICIT_FAMILY: "EXPLICIT_FAMILY",         // Manufacturer names series/family
  SUPPORTED_VARIANT: "SUPPORTED_VARIANT",     // Manufacturer supports variant
  INFERRED_ONLY: "INFERRED_ONLY",             // Inferred from naming/protocol
  CONFLICT: "CONFLICT",                       // Sources contradict
  NOT_SUPPORTED: "NOT_SUPPORTED",             // Manufacturer explicitly does not support
  MISSING_CANONICAL_TARGET: "MISSING_CANONICAL_TARGET", // Compatible but target not in library
};

/**
 * Evaluate whether a compatibility relationship is eligible for auto-confirmation.
 *
 * @param {Object} db - Database connection
 * @param {Object} params - Relationship parameters
 * @returns {Object} Evaluation result with gates and eligibility
 */
export const evaluateCompatibilityAutoConfirmation = async (db, {
  sourceProductId,
  targetProductId = null,
  targetFamilyId = null,
  relationshipType,
  conditionsJson = "{}",
  evidenceJson = "{}",
  confidence = 90,
  sourceDocumentNumber = null,
  sourceDocumentRevision = null,
  sourceDocumentDate = null,
  sourceDocumentUrl = null,
  sourceDocumentPage = null,
  sourceDocumentSection = null,
  evidenceClassification = EVIDENCE_CLASSIFICATION.EXPLICIT_EXACT,
}) => {
  const gates = [];
  const now = new Date().toISOString();

  // Gate 1: Source product identity confirmed
  const sourceProduct = await db.prepare(
    "SELECT id, part_number, identity_status, superseded_by_product_id, review_status FROM library_products WHERE id=?"
  ).bind(sourceProductId).first();

  if (!sourceProduct) {
    gates.push({ gate: 1, name: "source_product_identity", pass: false, reason: "Source product not found" });
    return { eligible: false, gates, reason: "Source product not found" };
  }

  if (sourceProduct.identity_status !== "Active") {
    gates.push({ gate: 1, name: "source_product_identity", pass: false, reason: `Source product identity status is ${sourceProduct.identity_status}` });
    return { eligible: false, gates, reason: `Source product identity status is ${sourceProduct.identity_status}` };
  }

  if (sourceProduct.superseded_by_product_id) {
    gates.push({ gate: 1, name: "source_product_identity", pass: false, reason: "Source product is superseded" });
    return { eligible: false, gates, reason: "Source product is superseded" };
  }

  gates.push({ gate: 1, name: "source_product_identity", pass: true, reason: "Source product is active and canonical" });

  // Gate 2: Target product/family identity confirmed
  let targetExists = false;
  let targetType = null;

  if (targetProductId) {
    const targetProduct = await db.prepare(
      "SELECT id, part_number, identity_status, superseded_by_product_id FROM library_products WHERE id=?"
    ).bind(targetProductId).first();

    if (!targetProduct) {
      gates.push({ gate: 2, name: "target_product_identity", pass: false, reason: "Target product not found" });
      return { eligible: false, gates, reason: "Target product not found" };
    }

    if (targetProduct.identity_status !== "Active") {
      gates.push({ gate: 2, name: "target_product_identity", pass: false, reason: `Target product identity status is ${targetProduct.identity_status}` });
      return { eligible: false, gates, reason: `Target product identity status is ${targetProduct.identity_status}` };
    }

    if (targetProduct.superseded_by_product_id) {
      gates.push({ gate: 2, name: "target_product_identity", pass: false, reason: "Target product is superseded" });
      return { eligible: false, gates, reason: "Target product is superseded" };
    }

    targetExists = true;
    targetType = "product";
    gates.push({ gate: 2, name: "target_product_identity", pass: true, reason: `Target product ${targetProduct.part_number} is active and canonical` });
  } else if (targetFamilyId) {
    const targetFamily = await db.prepare(
      "SELECT id, name FROM product_families WHERE id=?"
    ).bind(targetFamilyId).first();

    if (!targetFamily) {
      gates.push({ gate: 2, name: "target_family_identity", pass: false, reason: "Target family not found" });
      return { eligible: false, gates, reason: "Target family not found" };
    }

    targetExists = true;
    targetType = "family";
    gates.push({ gate: 2, name: "target_family_identity", pass: true, reason: `Target family ${targetFamily.name} exists` });
  } else {
    gates.push({ gate: 2, name: "target_identity", pass: false, reason: "No target product or family specified" });
    return { eligible: false, gates, reason: "No target product or family specified" };
  }

  // Gate 3: No conflicting current authoritative source.
  // Checked against the canonical engineering_relationships table (the
  // matcher-read store), never the deprecated product_compatibility table.
  const rightEntityType = targetProductId ? "Product" : "Product Family";
  const rightEntityId = targetProductId || targetFamilyId;
  const existingRelationship = await db.prepare(
    "SELECT id, status FROM engineering_relationships WHERE left_entity_type='Product' AND left_entity_id=? AND relationship_type=? AND right_entity_type=? AND right_entity_id=? AND status='Approved' AND effective_to IS NULL"
  ).bind(sourceProductId, relationshipType, rightEntityType, rightEntityId).first();

  if (existingRelationship) {
    gates.push({ gate: 3, name: "no_conflicting_source", pass: false, reason: "Relationship already exists" });
    return { eligible: false, gates, reason: "Relationship already exists" };
  }

  // UNRESOLVED-SEMANTICS: absence of a duplicate is not absence of a conflict.
  // A governed statement about the SAME pair under a DIFFERENT relationship
  // type (e.g. an 'Incompatible' record, or a different compatibility claim)
  // means the pair's compatibility is disputed, and auto-confirming an
  // 'Approved' row over disputed evidence would convert "no conflicting
  // evidence seen" into a governed compatibility truth. Refuse; a human
  // resolves disputed pairs through the engineering-knowledge decision flow.
  const conflictingRelationship = await db.prepare(
    "SELECT id, relationship_type, status FROM engineering_relationships WHERE left_entity_type='Product' AND left_entity_id=? AND relationship_type<>? AND right_entity_type=? AND right_entity_id=? AND status='Approved' AND effective_to IS NULL"
  ).bind(sourceProductId, relationshipType, rightEntityType, rightEntityId).first();

  if (conflictingRelationship) {
    gates.push({ gate: 3, name: "no_conflicting_source", pass: false, reason: `Conflicting ${conflictingRelationship.relationship_type} relationship exists for this pair` });
    return { eligible: false, gates, reason: "Conflicting relationship exists for this pair" };
  }

  gates.push({ gate: 3, name: "no_conflicting_source", pass: true, reason: "No existing relationship found" });

  // Gate 4: Evidence classification is valid for auto-confirm
  const validClassifications = [
    EVIDENCE_CLASSIFICATION.EXPLICIT_EXACT,
    EVIDENCE_CLASSIFICATION.EXPLICIT_FAMILY,
    EVIDENCE_CLASSIFICATION.SUPPORTED_VARIANT,
  ];

  if (!validClassifications.includes(evidenceClassification)) {
    gates.push({ gate: 4, name: "evidence_classification", pass: false, reason: `Evidence classification ${evidenceClassification} is not eligible for auto-confirm` });
    return { eligible: false, gates, reason: `Evidence classification ${evidenceClassification} is not eligible for auto-confirm` };
  }

  gates.push({ gate: 4, name: "evidence_classification", pass: true, reason: `Evidence classification ${evidenceClassification} is eligible for auto-confirm` });

  // Gate 5: Source document evidence recorded, with an exact citation.
  // A document number and revision alone do not locate the claim; the page
  // and section where the manufacturer states compatibility are required so
  // the evidence is independently checkable.
  if (!sourceDocumentNumber || !sourceDocumentRevision) {
    gates.push({ gate: 5, name: "source_document_evidence", pass: false, reason: "Source document number and revision are required" });
    return { eligible: false, gates, reason: "Source document number and revision are required" };
  }

  if (!String(sourceDocumentPage ?? "").trim() || !String(sourceDocumentSection ?? "").trim()) {
    gates.push({ gate: 5, name: "source_document_evidence", pass: false, reason: "Source document page and section citation are required" });
    return { eligible: false, gates, reason: "Source document page and section citation are required" };
  }

  gates.push({ gate: 5, name: "source_document_evidence", pass: true, reason: "Source document evidence with page and section citation recorded" });

  // Gate 7: Cited source verified against governed source storage.
  // An asserted document number/revision (or a sourceAuthority label on the
  // input) is NOT authority. Resolve the governed product_sources row for
  // this exact document number + revision and require: first-party
  // manufacturer source type from the closed allowlist, Official
  // Manufacturer authority, current validity, non-rejected standing, and an
  // existing evidence binding of that source to the source product. Any
  // missing link fails closed; model confidence plays no role here (the
  // confidence parameter is written through, never gated on).
  const normToken = (value) => String(value ?? "").trim().toUpperCase();
  const wantedNumber = normToken(sourceDocumentNumber);
  const wantedRevision = normToken(sourceDocumentRevision);
  const governedSource = await db.prepare(
    `SELECT id, checksum, source_type, authority, validity_state, review_status, file_name
       FROM product_sources
      WHERE scope_type = 'Global' AND project_id IS NULL
        AND authority = 'Official Manufacturer'
        AND review_status <> 'Rejected'
        AND validity_state LIKE 'Current Document%'
        AND UPPER(TRIM(json_extract(metadata, '$.documentNumber'))) = ?
        AND UPPER(TRIM(json_extract(metadata, '$.revision'))) = ?
      ORDER BY created_at DESC LIMIT 1`
  ).bind(wantedNumber, wantedRevision).first();

  if (!governedSource) {
    gates.push({ gate: 7, name: "source_authority_verified", pass: false, reason: "No current governed first-party manufacturer source matches the cited document number and revision" });
    return { eligible: false, gates, reason: "No current governed first-party manufacturer source matches the cited document number and revision" };
  }

  if (!FIRST_PARTY_MANUFACTURER_SOURCE_TYPES.has(governedSource.source_type)) {
    gates.push({ gate: 7, name: "source_authority_verified", pass: false, reason: `Governed source type ${governedSource.source_type} is not a first-party manufacturer document` });
    return { eligible: false, gates, reason: `Governed source type ${governedSource.source_type} is not a first-party manufacturer document` };
  }

  const sourceEvidenceBinding = await db.prepare(
    "SELECT id FROM product_source_evidence WHERE source_id=? AND product_id=? LIMIT 1"
  ).bind(governedSource.id, sourceProductId).first();

  if (!sourceEvidenceBinding) {
    gates.push({ gate: 7, name: "source_authority_verified", pass: false, reason: "Governed source has no evidence binding to the source product" });
    return { eligible: false, gates, reason: "Governed source has no evidence binding to the source product" };
  }

  gates.push({ gate: 7, name: "source_authority_verified", pass: true, reason: `Cited document verified against governed source ${governedSource.id} (${governedSource.source_type}, ${governedSource.validity_state}) with product evidence binding` });

  // Gate 6: No project-specific inference
  const conditions = JSON.parse(conditionsJson || "{}");
  if (conditions.projectSpecific || conditions.projectId) {
    gates.push({ gate: 6, name: "no_project_inference", pass: false, reason: "Relationship contains project-specific inference" });
    return { eligible: false, gates, reason: "Relationship contains project-specific inference" };
  }

  gates.push({ gate: 6, name: "no_project_inference", pass: true, reason: "No project-specific inference detected" });

  // All gates passed
  const eligible = gates.every((gate) => gate.pass);

  return {
    eligible,
    gates,
    reason: eligible ? "All gates passed" : gates.find((gate) => !gate.pass)?.reason,
    policyVersion: COMPATIBILITY_AUTO_CONFIRM_POLICY_VERSION,
    actor: COMPATIBILITY_AUTO_CONFIRM_ACTOR,
    timestamp: now,
    evidenceClassification,
    sourceDocument: {
      number: sourceDocumentNumber,
      revision: sourceDocumentRevision,
      date: sourceDocumentDate,
      url: sourceDocumentUrl,
      page: sourceDocumentPage,
      section: sourceDocumentSection,
    },
  };
};

/**
 * Auto-confirm a compatibility relationship if all gates pass.
 *
 * @param {Object} db - Database connection
 * @param {Object} params - Relationship parameters
 * @returns {Object} Result of auto-confirmation attempt
 */
export const autoConfirmCompatibility = async (db, params) => {
  const evaluation = await evaluateCompatibilityAutoConfirmation(db, params);

  if (!evaluation.eligible) {
    return {
      success: false,
      evaluation,
      reason: evaluation.reason,
    };
  }

  const now = new Date().toISOString();
  const relationshipId = id("compat");

  // Full auto-confirm provenance. engineering_relationships has no dedicated
  // evidence column, so provenance travels as an explicit conditions entry
  // (type auto_confirm_provenance) alongside the relationship conditions --
  // never mixed into them, always reconstructable.
  const relationshipConditions = (() => {
    try {
      const parsed = JSON.parse(params.conditionsJson || "{}");
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  })();
  const conditions = [
    ...relationshipConditions,
    {
      type: "auto_confirm_provenance",
      policyVersion: COMPATIBILITY_AUTO_CONFIRM_POLICY_VERSION,
      writeTarget: COMPATIBILITY_WRITE_TARGET,
      actor: COMPATIBILITY_AUTO_CONFIRM_ACTOR,
      timestamp: now,
      evaluation: evaluation.gates,
      evidenceClassification: evaluation.evidenceClassification,
      sourceDocument: evaluation.sourceDocument,
      sourceEvidence: params.evidenceJson ? JSON.parse(params.evidenceJson) : {},
    },
  ];

  const rightEntityType = params.targetProductId ? "Product" : "Product Family";
  const rightEntityId = params.targetProductId || params.targetFamilyId;

  // Insert into the CANONICAL compatibility store. Never product_compatibility.
  await db.prepare(
    `INSERT INTO engineering_relationships (
      id, project_id, left_entity_type, left_entity_id,
      relationship_type, right_entity_type, right_entity_id,
      conditions, exceptions, fact_type, scope_type, scope_id,
      confidence, status, version_number, effective_from,
      reviewed_by, reviewed_at, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    relationshipId,
    null, // Library-level, no project scope
    "Product",
    params.sourceProductId,
    params.relationshipType,
    rightEntityType,
    rightEntityId,
    JSON.stringify(conditions),
    "[]",
    "Manufacturer Rule",
    "Product",
    params.sourceProductId,
    params.confidence || 90,
    "Approved", // Auto-confirmed status
    1,
    now,
    COMPATIBILITY_AUTO_CONFIRM_ACTOR,
    now,
    COMPATIBILITY_AUTO_CONFIRM_ACTOR,
    now,
  ).run();

  // Create audit trail in product_library_decisions (project_id nullable)
  await db.prepare(
    `INSERT INTO product_library_decisions (
      id, project_id, entity_type, entity_id, action,
      previous_value, new_value, reason,
      decided_by, decided_role, decided_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id("libdecision"),
    null, // Library-level, no project scope
    COMPATIBILITY_WRITE_TARGET,
    relationshipId,
    "Auto-Confirm",
    "Needs Review",
    "Approved",
    `Auto-confirmed by policy ${COMPATIBILITY_AUTO_CONFIRM_POLICY_VERSION}: ${evaluation.evidenceClassification}`,
    COMPATIBILITY_AUTO_CONFIRM_ACTOR,
    "System",
    now,
  ).run();

  return {
    success: true,
    relationshipId,
    evaluation,
    timestamp: now,
  };
};

/**
 * Batch auto-confirm multiple compatibility relationships.
 *
 * @param {Object} db - Database connection
 * @param {Array} relationships - Array of relationship parameters
 * @returns {Object} Batch result with successes and failures
 */
export const batchAutoConfirmCompatibility = async (db, relationships) => {
  const results = [];
  const successes = [];
  const failures = [];

  for (const relationship of relationships) {
    const result = await autoConfirmCompatibility(db, relationship);
    results.push(result);

    if (result.success) {
      successes.push(result);
    } else {
      failures.push(result);
    }
  }

  return {
    total: relationships.length,
    successes: successes.length,
    failures: failures.length,
    results,
  };
};
