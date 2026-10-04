/**
 * Product Attribute Review Governance Module — KN-MASTER-1.
 *
 * Implements the governed `Needs Review -> Approved / Rejected` transition for
 * product_attributes, completing the missing transition KN-ATTR-1 identified.
 *
 * The contract mirrors the repository's own live, consumed engineering-fact
 * precedent rather than inventing a new state machine:
 *
 *   * worker/compatibility-auto-confirm.mjs deterministically writes
 *     `Approved` engineering_relationships through a 12-gate evidence
 *     evaluation, records a product_library_decisions row, and those rows are
 *     consumed today by product matching.
 *   * Every engineering-fact lane in this repository uses single-token
 *     `Approved` as the downstream-eligibility state (engineering_relationships
 *     14/14, product_accessories 211/211, technical_requirements, boq_items).
 *     Product-level semantics (library_products terminating at `Reviewed` +
 *     the discovery-listing flag) govern the catalog ENTITY, not technical
 *     FACTS, and are deliberately not copied here.
 *
 * Approval is evidence-gated and FAILS CLOSED. A human Library Manager (the
 * `approve` capability, worker/library-auth.mjs — first enforcement site in
 * the product-attribute route) may approve ONLY rows whose evidence passes
 * every gate; anything ambiguous, stale, conflicting, or dual-valued stays
 * `Needs Review` as explicit, enumerable review debt. Rejection is always
 * available and is the reversal path (an Approved row can be Rejected with a
 * governed reason, restoring fail-closed behavior).
 *
 * Every decision writes a product_library_decisions row with
 * entity_type='Product Attribute', so the review model stays exception-driven:
 * rows that fail gates are reported with their gates, never silently waved
 * through and never bulk-promoted.
 */
import { resolveFireAlarmAttributeAlias, validateFireAlarmAttributeValue } from "../app/domain/fire-alarm-taxonomy.mjs";
import { MIN_GOVERNED_REASON_LENGTH } from "./reason-governance.mjs";

// Policy version for the audit trail (compatibility-auto-confirm convention).
// 1.0.0: initial governed product-attribute review contract.
export const PRODUCT_ATTRIBUTE_REVIEW_POLICY_VERSION = "1.0.0";

// Closed allowlist of FIRST-PARTY MANUFACTURER document types that may back a
// promotable product attribute. See gate 3 below.
//
// This is a closed list on purpose, and every entry additionally requires
// `authority === "Official Manufacturer"` at the gate, so widening the document
// TYPE here cannot admit a same-named document from any weaker authority.
//
// `Product Manual` was added for the Honeywell / Farenhyt SLC Wiring Manual
// (P/N LS10179-000FH-E rev B), whose section 1.6 is the manufacturer's only
// statement of the built-in surge suppressors. The previous two-entry list
// refused it, which is the same defect this gate already had once: a closed
// list narrower than the governing evidence hierarchy. ai-pricing-agent-workflow
// §9A.2 ranks first-party manufacturer technical documentation as product truth
// and does not stop at the installation manual. Relabelling the document as
// "Installation and Operation Manual" to satisfy the gate was rejected: it would
// write a false document type into canonical provenance.
export const FIRST_PARTY_MANUFACTURER_SOURCE_TYPES = Object.freeze(new Set([
  "Product Datasheet",
  "Installation and Operation Manual",
  "Product Manual",
]));

/**
 * Product CERTIFICATION review.
 *
 * product_certifications previously had NO governed review writer anywhere: the
 * datasheet ingestion path was the only writer, and it always landed rows at
 * status 'Unverified' / review_status 'Needs Review'. A certification could
 * therefore never leave the queue even with a reviewed official datasheet
 * behind it -- the same structural gap that `reviewProductAttribute` closes for
 * product attributes.
 *
 * The gates mirror the attribute gates and are equally fail-closed:
 *   1. the row exists and is current (not deleted, not superseded);
 *   2. the product is an ACTIVE canonical identity for its part number;
 *   3. the claim is backed by a current official manufacturer datasheet source;
 *   4. the evidence is explicit -- verbatim quote plus page and document version;
 *   5. the claim names a standard body or number at all.
 *
 * Promotion is deliberately conservative and names exactly what it proves:
 * 'Verified - Manufacturer Datasheet' means the manufacturer states this claim
 * in the current official datasheet for this exact SKU. It is NOT a
 * certificate-level verification and never satisfies an AHJ or tender
 * submission on its own; that still requires an independent certificate record.
 */
export const PRODUCT_CERTIFICATION_REVIEW_POLICY_VERSION = "1.1.0";
// 1.1.0: added gate 6 (conflicting current certification fails closed) and
// gate 7 (backing-source currency, mirroring the attribute-review gate 4).

export const CERTIFICATION_REVIEW_ACTIONS = Object.freeze({
  Approve: "Verified - Manufacturer Datasheet",
  Reject: "Rejected",
});

export const evaluateProductCertificationReview = async (db, certificationId) => {
  const gates = [];
  const fail = (gate, name, reason) => gates.push({ gate, name, pass: false, reason });
  const pass = (gate, name, reason) => gates.push({ gate, name, pass: true, reason });

  const row = await db.prepare("SELECT * FROM product_certifications WHERE id=?").bind(certificationId).first();
  if (!row) {
    fail(1, "certification_current", "Product certification not found");
    return { eligible: false, gates, reason: "Product certification not found", policyVersion: PRODUCT_CERTIFICATION_REVIEW_POLICY_VERSION };
  }
  if (row.deleted_at || row.superseded_at) {
    fail(1, "certification_current", "Certification is deleted or superseded");
    return { eligible: false, gates, reason: "Certification is deleted or superseded", policyVersion: PRODUCT_CERTIFICATION_REVIEW_POLICY_VERSION };
  }
  pass(1, "certification_current", "Certification row is current");

  const product = await db.prepare("SELECT * FROM library_products WHERE id=?").bind(row.product_id).first();
  if (!product || product.identity_status !== "Active" || product.superseded_by_product_id) {
    fail(2, "product_identity", "Product is not an active canonical identity");
  } else {
    pass(2, "product_identity", "Product is active and canonical");
  }

  // Same closed first-party allowlist the attribute review uses (gate 3 there).
  const source = row.document_id
    ? await db
        .prepare(
          `SELECT ps.* FROM product_sources ps
             JOIN documents d ON d.id = ps.document_id
            WHERE d.id = ? AND ps.scope_type = 'Global'
            ORDER BY ps.created_at DESC LIMIT 1`,
        )
        .bind(row.document_id)
        .first()
    : null;
  if (!source || !FIRST_PARTY_MANUFACTURER_SOURCE_TYPES.has(source.source_type) || source.authority !== "Official Manufacturer") {
    fail(3, "first_party_source", `Certification is not backed by an approved first-party manufacturer document${source ? ` (type ${source.source_type}, authority ${source.authority})` : ""}`);
  } else {
    pass(3, "first_party_source", `Backed by ${source.source_type} ${source.file_name || source.id}`);
  }

  const evidence = parse(row.evidence_location, {});
  const missing = ["exactText", "page", "documentVersionId"].filter((key) => !clean(evidence[key]));
  if (missing.length) {
    fail(4, "explicit_evidence", `Evidence is missing ${missing.join(", ")}`);
  } else {
    pass(4, "explicit_evidence", "Verbatim quoted evidence with page and document version");
  }

  if (!clean(row.standard_body) && !clean(row.standard_number)) {
    fail(5, "standard_identified", "Certification names neither a standard body nor a number");
  } else {
    pass(5, "standard_identified", "Certification identifies a standard body or number");
  }

  // Gate 6: no unresolved conflicting current certification for the same
  // product and standard scope. Two current governed rows that state
  // materially different statuses for the same (body, number) scope are a
  // real contradiction: auto-approving either would bless one side of an
  // undecided dispute, so a human resolves it through the governed review
  // path. Agreeing duplicates are not conflicts.
  const conflictingCertification = await db.prepare(
    `SELECT id, status FROM product_certifications
      WHERE product_id = ?
        AND COALESCE(standard_body, '') = COALESCE(?, '')
        AND COALESCE(standard_number, '') = COALESCE(?, '')
        AND id <> ?
        AND deleted_at IS NULL AND superseded_at IS NULL
        AND review_status = 'Approved'
        AND status <> ?
      LIMIT 1`
  ).bind(row.product_id, row.standard_body, row.standard_number, certificationId, row.status).first();
  if (conflictingCertification) {
    fail(6, "no_conflicting_certification", `Conflicting Approved certification ${conflictingCertification.id} states status ${conflictingCertification.status}`);
  } else {
    pass(6, "no_conflicting_certification", "No conflicting current certification for this product and standard scope");
  }

  // Gate 7: the backing source is current, mirroring the attribute-review
  // currency gate. A first-party document that is historical, superseded, or
  // rejected cannot carry a new governed certification approval, even when
  // the claim text itself is well-evidenced.
  const sourceCurrency = source ? String(source.validity_state || "") : "";
  if (!source || !sourceCurrency.startsWith("Current Document")) {
    fail(7, "source_currency", `Backing source currency is ${source ? sourceCurrency || "unknown" : "unknown"}`);
  } else if (source.review_status === "Rejected") {
    fail(7, "source_currency", "Backing source has been rejected");
  } else {
    pass(7, "source_currency", `Backing source is current (${sourceCurrency})`);
  }

  const eligible = gates.every((gate) => gate.pass);
  return { eligible, gates, reason: eligible ? "All deterministic gates passed" : gates.find((gate) => !gate.pass)?.reason, policyVersion: PRODUCT_CERTIFICATION_REVIEW_POLICY_VERSION };
};

export const reviewProductCertification = async (db, { certificationId, decision, reason, decidedBy, decidedRole }) => {
  const governedReason = clean(reason);
  if (governedReason.length < MIN_GOVERNED_REASON_LENGTH) {
    return { success: false, code: "REVIEW_REASON_REQUIRED", reason: "Provide a substantive review reason." };
  }
  const nextStatus = CERTIFICATION_REVIEW_ACTIONS[decision];
  if (!nextStatus) {
    return { success: false, code: "INVALID_REVIEW_DECISION", reason: "decision must be Approve or Reject." };
  }

  const row = await db.prepare("SELECT * FROM product_certifications WHERE id=?").bind(certificationId).first();
  if (!row) return { success: false, code: "CERTIFICATION_NOT_FOUND", reason: "Product certification not found." };
  if (decision === "Approve" && row.review_status === "Approved") {
    return { success: true, alreadyApproved: true, certificationId };
  }
  if (decision === "Reject" && row.review_status === "Rejected") {
    return { success: true, alreadyRejected: true, certificationId };
  }

  if (decision === "Approve") {
    const evaluation = await evaluateProductCertificationReview(db, certificationId);
    if (!evaluation.eligible) {
      return { success: false, code: "CERTIFICATION_EVIDENCE_GATE_FAILED", evaluation, reason: evaluation.reason };
    }
  }

  const nextReview = decision === "Approve" ? "Approved" : "Rejected";
  const updated = await db
    .prepare("UPDATE product_certifications SET status=?, review_status=? WHERE id=? AND review_status IN ('Needs Review','Reviewed')")
    .bind(nextStatus, nextReview, certificationId)
    .run();
  if (Number(updated?.changes ?? updated?.meta?.changes ?? 0) !== 1) {
    return { success: false, code: "CERTIFICATION_STATE_CHANGED", reason: "Certification state changed before this review completed." };
  }

  await db
    .prepare(
      `INSERT INTO product_library_decisions
         (id, project_id, entity_type, entity_id, action, previous_value, new_value, reason, decided_by, decided_role, decided_at)
       VALUES (?, NULL, 'Product Certification', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id("certdecision"),
      certificationId,
      decision,
      `${row.status} / ${row.review_status}`,
      `${nextStatus} / ${nextReview}`,
      governedReason,
      clean(decidedBy),
      clean(decidedRole),
      now(),
    )
    .run();

  return { success: true, certificationId, from: row.review_status, to: nextReview, status: nextStatus };
};

export const reviewProductCertificationsForProduct = async (db, { productId, reason, decidedBy, decidedRole }) => {
  const rows = (await db
    .prepare(
      `SELECT id, standard_body, standard_number FROM product_certifications
        WHERE product_id=? AND review_status IN ('Needs Review','Reviewed')
          AND deleted_at IS NULL AND superseded_at IS NULL
        ORDER BY standard_body, standard_number, id`,
    )
    .bind(productId)
    .all()).results || [];

  const approved = [];
  const rejected = [];
  const exceptions = [];
  for (const row of rows) {
    const result = await reviewProductCertification(db, {
      certificationId: row.id,
      decision: "Approve",
      reason,
      decidedBy,
      decidedRole,
    });
    if (result.success) approved.push(row);
    else exceptions.push({ ...row, reason: result.reason, gates: result.evaluation?.gates || [] });
  }
  return { approved, rejected, exceptions, policyVersion: PRODUCT_CERTIFICATION_REVIEW_POLICY_VERSION };
};

export const PRODUCT_ATTRIBUTE_REVIEW_ACTIONS = Object.freeze({
  APPROVE: "Approve",
  REJECT: "Reject",
});

const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

const parse = (value, fallback = null) => {
  try {
    if (value === null || value === undefined || value === "") return fallback;
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
};

const clean = (value) => String(value ?? "").trim();

// KN-MASTER-1: an attribute name is a real technical attribute, not ingestion
// bookkeeping. The governed writers never emit source_* names, but the gate
// keeps the contract explicit for any future producer.
const isBookkeepingName = (name) => /^source[_-]/i.test(clean(name));

/**
 * Resolve a governed attribute name onto the canonical taxonomy contract name
 * (alias map first, raw name as the already-canonical fallback).
 */
const canonicalName = (name) => resolveFireAlarmAttributeAlias(name) || clean(name);

/**
 * Evaluate whether a product_attributes row is eligible for evidence-gated
 * approval. Gates mirror the live compatibility auto-confirm precedent and
 * the repository's established source-authority semantics.
 *
 * @param {Object} db - D1 database handle
 * @param {string} attributeId
 * @returns {Promise<Object>} { eligible, gates, reason, policyVersion, timestamp }
 */
export const evaluateProductAttributeReview = async (db, attributeId) => {
  const gates = [];
  const fail = (gate, name, reason) => gates.push({ gate, name, pass: false, reason });
  const pass = (gate, name, reason) => gates.push({ gate, name, pass: true, reason });

  // Gate 1: the attribute row exists and is current (not deleted, not superseded).
  const attribute = await db.prepare("SELECT * FROM product_attributes WHERE id=?").bind(attributeId).first();
  if (!attribute) {
    fail(1, "attribute_current", "Product attribute not found");
    return { eligible: false, gates, reason: "Product attribute not found", policyVersion: PRODUCT_ATTRIBUTE_REVIEW_POLICY_VERSION, timestamp: now() };
  }
  if (attribute.deleted_at || attribute.superseded_at) {
    fail(1, "attribute_current", "Attribute is deleted or superseded");
    return { eligible: false, gates, reason: "Attribute is deleted or superseded", policyVersion: PRODUCT_ATTRIBUTE_REVIEW_POLICY_VERSION, timestamp: now() };
  }
  pass(1, "attribute_current", "Attribute row is current");

  // Gate 2: the product is an active canonical identity (not superseded).
  const product = await db
    .prepare("SELECT * FROM library_products WHERE id=?")
    .bind(attribute.product_id)
    .first();
  if (!product || product.identity_status !== "Active" || product.superseded_by_product_id) {
    fail(2, "product_identity", "Product is not an active canonical identity");
  } else if (product.requested_product_id && product.requested_product_id !== product.id) {
    fail(2, "product_identity", "Product is not the canonical identity for its part number");
  } else {
    pass(2, "product_identity", "Product is active and canonical");
  }

  // Gate 3: an authoritative FIRST-PARTY MANUFACTURER source backs the row.
  //
  // This gate previously accepted ONLY source_type "Product Datasheet", which is
  // narrower than the governing evidence hierarchy itself: the exact-model
  // INSTALLATION AND OPERATION MANUAL is the FIRST-listed product-truth source
  // (ai-pricing-agent-workflow §9A.2), ahead of the datasheet. An official
  // Honeywell IFP-2100 Installation and Operation Manual was therefore refused as
  // evidence, which is exactly backwards -- it was blocking the strongest
  // first-party evidence while accepting a weaker form of it.
  //
  // The accepted set is a CLOSED allowlist of first-party manufacturer document
  // types, and both accepted types additionally require authority "Official
  // Manufacturer", so a same-named source from any other authority is still refused.
  const source = attribute.source_id
    ? await db.prepare("SELECT * FROM product_sources WHERE id=?").bind(attribute.source_id).first()
    : null;
  if (!source) {
    fail(3, "authoritative_source", "No source record backs this attribute");
  } else if (!FIRST_PARTY_MANUFACTURER_SOURCE_TYPES.has(source.source_type)) {
    fail(3, "authoritative_source", `Source type ${source.source_type} is not a first-party manufacturer document`);
  } else if (source.authority !== "Official Manufacturer") {
    fail(3, "authoritative_source", `Source authority ${source.authority} is not an official manufacturer`);
  } else if (source.review_status === "Rejected") {
    fail(3, "authoritative_source", "Source has been rejected");
  } else {
    pass(3, "authoritative_source", `Backed by ${source.source_type} ${source.file_name || source.id}`);
  }

  // Gate 4: the backing source is the CURRENT document, not historical.
  // 'Current Document — Applicability Review Required' is current: for a
  // product's OWN datasheet the applicability question is inherent, and the
  // document-version match below pins the attribute to the exact current
  // version. Historical/validity-review states fail closed.
  if (!source || !String(source.validity_state || "").startsWith("Current Document")) {
    fail(4, "source_currency", `Source currency is ${source?.validity_state || "unknown"}`);
  } else {
    pass(4, "source_currency", `Source is current (${source.validity_state})`);
  }

  // Gate 5: the evidence is explicit and locatable (verbatim quote + position).
  const evidence = parse(attribute.evidence_json, {});
  const requiredEvidenceKeys = ["exactText", "page", "section", "documentId", "documentVersionId"];
  const missingEvidence = requiredEvidenceKeys.filter((key) => !clean(evidence[key]));
  if (missingEvidence.length) {
    fail(5, "explicit_evidence", `Evidence is missing ${missingEvidence.join(", ")}`);
  } else {
    pass(5, "explicit_evidence", "Verbatim quoted evidence with page, section, and document version");
  }

  // Gate 6: the evidence cites the source's CURRENT document version.
  if (!source || !evidence.documentVersionId || evidence.documentVersionId !== source.document_version_id) {
    fail(6, "document_version_match", "Evidence does not cite the source's current document version");
  } else {
    pass(6, "document_version_match", "Evidence cites the current document version");
  }

  // Gate 7: the attribute carries a non-empty value.
  const value = clean(attribute.normalized_value) || clean(attribute.original_value);
  if (!value) {
    fail(7, "value_present", "Attribute has no value");
  } else {
    pass(7, "value_present", "Attribute carries a value");
  }

  // Gate 8: this is a real technical attribute, not bookkeeping or a
  // project-specific inference smuggled into global product knowledge.
  if (isBookkeepingName(attribute.attribute_name)) {
    fail(8, "technical_attribute", "Bookkeeping (source_*) attributes are not technical facts");
  } else if (evidence.projectId || evidence.projectSpecific) {
    fail(8, "technical_attribute", "Evidence is project-specific, not global product knowledge");
  } else {
    pass(8, "technical_attribute", "Real technical attribute with document evidence");
  }

  // Gate 9: the value is valid under the canonical taxonomy vocabulary.
  // Resolving the governed name onto its canonical contract name first means
  // cabinet_color values are checked against the canonical `color` vocabulary,
  // and capacity values must be a single non-negative integer -- so the real
  // dual-valued datasheet string ("150 IDP/SK points; 75 SD points") is
  // INVALID here and stays Needs Review as explicit review debt.
  const canonical = canonicalName(attribute.attribute_name);
  const validation = validateFireAlarmAttributeValue(canonical, value);
  if (!validation.valid) {
    fail(9, "canonical_value_valid", `Value is not valid for canonical attribute ${canonical}`);
  } else {
    pass(9, "canonical_value_valid", `Value is valid for canonical attribute ${canonical}`);
  }

  // Gate 10: no conflicting current value for the same canonical attribute on
  // the same product. Agreement across sources is fine; contradiction is not.
  const siblings = (await db
    .prepare(
      `SELECT * FROM product_attributes
        WHERE product_id=? AND id<>? AND deleted_at IS NULL AND superseded_at IS NULL
          AND review_status<>'Rejected'`
    )
    .bind(attribute.product_id, attributeId)
    .all()).results || [];
  const conflicting = siblings.filter((row) => {
    if (canonicalName(row.attribute_name) !== canonical) return false;
    const siblingValue = clean(row.normalized_value) || clean(row.original_value);
    return siblingValue && siblingValue !== value;
  });
  if (conflicting.length) {
    fail(10, "no_conflicting_value", `Conflicting current value for ${canonical} on this product`);
  } else {
    pass(10, "no_conflicting_value", "No conflicting current value");
  }

  const eligible = gates.every((gate) => gate.pass);
  return {
    eligible,
    gates,
    reason: eligible ? "All gates passed" : (gates.find((gate) => !gate.pass) || {}).reason,
    policyVersion: PRODUCT_ATTRIBUTE_REVIEW_POLICY_VERSION,
    timestamp: now(),
    canonicalAttribute: canonical,
  };
};

/**
 * Perform the governed review transition on one product attribute row.
 *
 * Approve: requires every evidence gate to pass (fail closed). Idempotent.
 * Reject: always available from any non-Rejected state; the reversal path.
 *
 * Every actual transition writes a product_library_decisions row with
 * entity_type='Product Attribute', the deciding actor, role, and reason.
 *
 * @param {Object} db - D1 database handle
 * @param {Object} params { attributeId, decision, reason, decidedBy, decidedRole }
 */
export const reviewProductAttribute = async (db, { attributeId, decision, reason, decidedBy, decidedRole }) => {
  const governedReason = clean(reason);
  if (governedReason.length < MIN_GOVERNED_REASON_LENGTH) {
    return { success: false, code: "REVIEW_REASON_REQUIRED", reason: "Provide a substantive review reason." };
  }
  const action = decision === "Approve" ? "Approve" : decision === "Reject" ? "Reject" : null;
  if (!action) {
    return { success: false, code: "INVALID_REVIEW_DECISION", reason: "decision must be Approve or Reject." };
  }

  const attribute = await db.prepare("SELECT * FROM product_attributes WHERE id=?").bind(attributeId).first();
  if (!attribute) {
    return { success: false, code: "ATTRIBUTE_NOT_FOUND", reason: "Product attribute not found." };
  }

  if (action === "Approve") {
    if (attribute.review_status === "Approved") {
      return { success: true, alreadyApproved: true, attributeId };
    }
    const evaluation = await evaluateProductAttributeReview(db, attributeId);
    if (!evaluation.eligible) {
      return { success: false, code: "ATTRIBUTE_EVIDENCE_GATE_FAILED", evaluation, reason: evaluation.reason };
    }
    const timestamp = now();
    await db
      .prepare("UPDATE product_attributes SET review_status='Approved' WHERE id=?")
      .bind(attributeId)
      .run();
    await db
      .prepare(
        `INSERT INTO product_library_decisions
           (id, project_id, entity_type, entity_id, action, previous_value, new_value, reason, decided_by, decided_role, decided_at)
         VALUES (?, NULL, 'Product Attribute', ?, 'Approved', ?, 'Approved', ?, ?, ?, ?)`
      )
      .bind(id("libdecision"), attributeId, attribute.review_status, governedReason, clean(decidedBy), clean(decidedRole), timestamp)
      .run();
    return { success: true, attributeId, evaluation, from: attribute.review_status, to: "Approved" };
  }

  // Reject: the always-available reversal path.
  if (attribute.review_status === "Rejected") {
    return { success: true, alreadyRejected: true, attributeId };
  }
  const timestamp = now();
  await db
    .prepare("UPDATE product_attributes SET review_status='Rejected' WHERE id=?")
    .bind(attributeId)
    .run();
  await db
    .prepare(
      `INSERT INTO product_library_decisions
         (id, project_id, entity_type, entity_id, action, previous_value, new_value, reason, decided_by, decided_role, decided_at)
       VALUES (?, NULL, 'Product Attribute', ?, 'Rejected', ?, 'Rejected', ?, ?, ?, ?)`
    )
    .bind(id("libdecision"), attributeId, attribute.review_status, governedReason, clean(decidedBy), clean(decidedRole), timestamp)
    .run();
  return { success: true, attributeId, from: attribute.review_status, to: "Rejected" };
};

/**
 * Exception-driven batch review: evaluate every current reviewable attribute
 * of one product, approve exactly the gate-passing rows, and return the rest
 * as enumerable exceptions with their gates. Cohort membership is never
 * eligibility; only the evidence gates decide.
 */
export const reviewProductAttributesForProduct = async (db, { productId, reason, decidedBy, decidedRole }) => {
  const rows = (await db
    .prepare(
      `SELECT id, attribute_name FROM product_attributes
        WHERE product_id=? AND review_status IN ('Needs Review','Reviewed')
          AND deleted_at IS NULL AND superseded_at IS NULL
        ORDER BY attribute_name, id`
    )
    .bind(productId)
    .all()).results || [];
  const approved = [];
  const exceptions = [];
  for (const row of rows) {
    const result = await reviewProductAttribute(db, {
      attributeId: row.id,
      decision: "Approve",
      reason,
      decidedBy,
      decidedRole,
    });
    if (result.success && !result.alreadyApproved) {
      approved.push({ id: row.id, attributeName: row.attribute_name });
    } else if (result.success && result.alreadyApproved) {
      approved.push({ id: row.id, attributeName: row.attribute_name, alreadyApproved: true });
    } else {
      exceptions.push({
        id: row.id,
        attributeName: row.attribute_name,
        reason: result.reason,
        gates: result.evaluation?.gates || [],
      });
    }
  }
  return { approved, exceptions, policyVersion: PRODUCT_ATTRIBUTE_REVIEW_POLICY_VERSION };
};
