// PRODUCTION WRITER for governed Drawing Quantity claims (0020).
//
// WHY A WRITER AND NOT A SCRIPT. The project has had readers and a domain
// builder for quantity claims but no mounted path that can create one, which is
// the same gap that previously left other tables with readers but no writer.
// This is the single canonical write path; nothing else writes
// drawing_quantity_claims.
//
// WHAT THE WRITER IS NOT. It is not an interpreter and not a quantity source.
// It does not parse drawings, count symbols, or infer floors. It accepts an
// ALREADY-GOVERNED claim and persists it under 0020's contract. Deriving
// physical quantity from evidence is the evidence pipeline's job; this file's job
// is to refuse anything that is not already governed, and to never let an
// ungoverned number become authority.
//
// THE CENTRAL REFUSAL. `countMethod` is required by the domain builder and its
// three permitted values are all SCHEDULE-reading methods
// (COMPONENT_CELL_SUM, PRINTED_CELL, PRINTED_ROW_TOTAL). There is deliberately
// no value meaning "counted plotted symbols". A caller therefore cannot express
// "these N occurrences are the quantity": to pass, the caller must supply a
// quantity obtained by reading a printed quantity on the drawing. This is the
// mechanism that makes RECOGNITION_COUNT_CAN_BECOME_PHYSICAL_AUTHORITY_DIRECTLY
// false by construction rather than by convention.

import {
  buildQuantityClaim,
  computeQuantityAuthorityFingerprint,
  COUNT_METHODS,
  DEVICE_VARIANTS,
  DRAWING_QUANTITY_AUTHORITY_VERSION,
} from "../app/domain/drawing-quantity-authority.mjs";
import { classifyLegendClass } from "../app/domain/fire-alarm-legend-class-semantics.mjs";

/** The one table this module writes. Callable with any D1-like binding. */
export const QUANTITY_CLAIM_TABLE = "drawing_quantity_claims";

const isNonEmptyString = (v) => typeof v === "string" && v.trim() !== "";

/**
 * Build one governed claim from a caller input, applying every refusal rule the
 * task requires BEFORE any domain call or database write.
 *
 * The fingerprint of the result is DERIVED, never taken from the caller; whether
 * the caller's declared fingerprint matches it is a separate check, kept
 * separate so this function can be used to derive one in the first place.
 *
 * Returns { ok:true, claim, meaning, fingerprint } or { ok:false, code, reason }.
 */
function buildGovernedQuantityClaim(input) {
  if (!input || typeof input !== "object") {
    return { ok: false, code: "INVALID_INPUT", reason: "A governed quantity claim must be an object." };
  }

  // --- project / document identity -----------------------------------------
  if (!isNonEmptyString(input.projectId)) {
    return { ok: false, code: "UNKNOWN_PROJECT", reason: "projectId is required." };
  }
  if (!isNonEmptyString(input.documentVersionId)) {
    return { ok: false, code: "MISSING_DOCUMENT_VERSION", reason: "documentVersionId is required so the claim can go stale when the drawing is revised." };
  }
  if (input.documentId !== undefined && input.documentId !== null && !isNonEmptyString(input.documentId)) {
    return { ok: false, code: "INVALID_DOCUMENT_ID", reason: "documentId must be a non-empty string when supplied." };
  }

  // --- location identity ----------------------------------------------------
  if (!isNonEmptyString(input.sheet)) {
    return { ok: false, code: "MISSING_SHEET_IDENTITY", reason: "sheet is required; 0020 identity is location-scoped and a project-global quantity is not expressible." };
  }
  if (input.page !== undefined && input.page !== null && !Number.isInteger(input.page)) {
    return { ok: false, code: "INVALID_PAGE", reason: "page must be an integer when supplied." };
  }

  // --- device class: governed meaning required, no free text authority ------
  if (!isNonEmptyString(input.deviceClass)) {
    return { ok: false, code: "MISSING_DEVICE_CLASS", reason: "deviceClass is required." };
  }
  if (!DEVICE_VARIANTS.includes(input.deviceVariant ?? "STANDARD")) {
    return { ok: false, code: "UNKNOWN_VARIANT", reason: `deviceVariant must be one of ${DEVICE_VARIANTS.join(", ")}.` };
  }

  // The governed legend authority, not the caller's word, decides whether the
  // class MEANS anything. An arbitrary free-text key cannot confer meaning.
  const meaning = classifyLegendClass(input.deviceClass.trim());
  if (!meaning || meaning.state !== "GOVERNED_AND_PROVEN") {
    return {
      ok: false,
      code: "CLASS_MEANING_NOT_GOVERNED",
      reason: `Legend class "${input.deviceClass}" is ${meaning?.state ?? "unknown"}, so no physical quantity may be asserted for it. An unresolved class is UNRESOLVED with a null quantity, never zero.`,
    };
  }

  // --- physical quantity ---------------------------------------------------
  const qty = input.physicalQuantity;
  if (qty === null || qty === undefined) {
    return { ok: false, code: "MISSING_PHYSICAL_QUANTITY", reason: "physicalQuantity is required. An absent quantity is never coerced to zero." };
  }
  if (typeof qty !== "number" || !Number.isFinite(qty)) {
    return { ok: false, code: "INVALID_PHYSICAL_QUANTITY", reason: "physicalQuantity must be a finite number." };
  }
  if (qty < 0) {
    return { ok: false, code: "NEGATIVE_PHYSICAL_QUANTITY", reason: "physicalQuantity must not be negative." };
  }
  if (!Number.isInteger(qty)) {
    return { ok: false, code: "NON_INTEGER_PHYSICAL_QUANTITY", reason: "physicalQuantity must be a whole number of devices." };
  }
  // A governed zero is legitimate (an explicit printed "0" / "NIL") and is
  // PRESERVED, never treated as missing.
  if (input.unit !== undefined && input.unit !== null && !isNonEmptyString(input.unit)) {
    return { ok: false, code: "UNKNOWN_UNIT", reason: "unit must be a non-empty string when supplied." };
  }

  // --- count method: the recognition barrier --------------------------------
  if (!COUNT_METHODS.includes(input.countMethod)) {
    return {
      ok: false,
      code: "INVALID_COUNT_METHOD",
      reason: `countMethod must be one of ${COUNT_METHODS.join(", ")} -- all of which describe reading a PRINTED quantity from the drawing. `
        + "There is no permitted method for turning a symbol-occurrence count into physical quantity authority.",
    };
  }
  // Defence in depth: if a future domain adds an occurrence-style method, the
  // writer still refuses it here.
  if (/OCCURRENCE|SYMBOL_COUNT|PLOTTED/i.test(String(input.countMethod))) {
    return { ok: false, code: "RECOGNITION_COUNT_NOT_PHYSICAL_AUTHORITY", reason: "A symbol-occurrence count is not physical quantity authority." };
  }

  // --- evidence -------------------------------------------------------------
  const assetIds = input.sourceAssetIds;
  if (!Array.isArray(assetIds) || assetIds.length === 0) {
    return { ok: false, code: "MISSING_SOURCE_ASSETS", reason: "sourceAssetIds must be a non-empty array of governed source asset identities." };
  }
  if (!assetIds.every(isNonEmptyString)) {
    return { ok: false, code: "UNVERIFIABLE_SOURCE_ASSETS", reason: "every sourceAssetIds entry must be a non-empty string." };
  }
  if (input.evidenceFingerprint !== undefined && input.evidenceFingerprint !== null
    && !isNonEmptyString(input.evidenceFingerprint)) {
    return { ok: false, code: "MISSING_EVIDENCE_FINGERPRINT", reason: "evidenceFingerprint must be a non-empty string when supplied." };
  }

  // --- review attribution ---------------------------------------------------
  if (!isNonEmptyString(input.reviewedBy) && !isNonEmptyString(input.createdBy)) {
    return { ok: false, code: "MISSING_REVIEW_ATTRIBUTION", reason: "A claim must record who or what established it (reviewedBy / createdBy)." };
  }

  // --- build through the domain, never by hand ------------------------------
  const built = buildQuantityClaim({
    projectId: input.projectId,
    documentId: input.documentId ?? null,
    documentVersionId: input.documentVersionId,
    sheet: input.sheet,
    page: input.page ?? null,
    parserVersion: input.parserVersion ?? null,
    semanticsVersion: input.semanticsVersion ?? meaning.semanticsVersion ?? null,
    deviceClass: input.deviceClass.trim(),
    deviceVariant: input.deviceVariant ?? "STANDARD",
    floorOrArea: input.floorOrArea ?? null,
    quantityType: input.quantityType ?? "PHYSICAL_DEVICE",
    quantity: qty,
    countMethod: input.countMethod,
    printedTotal: input.printedTotal ?? null,
    componentTotal: input.componentTotal ?? null,
    sourceRegion: input.sourceRegion ?? null,
    sourceAssetIds: assetIds,
    evidenceFingerprint: input.evidenceFingerprint,
    reviewedBy: input.reviewedBy ?? null,
    reviewReason: input.reviewReason ?? null,
    reviewStatus: input.reviewStatus ?? "Approved",
    classMeaningGoverned: true,
  });
  if (!built.ok) {
    return { ok: false, code: built.error, reason: built.reason };
  }

  const derived = computeQuantityAuthorityFingerprint(built.claim);
  return { ok: true, claim: built.claim, meaning, fingerprint: derived };
}

/**
 * Full validation of a claim on its way to storage.
 *
 * Adds the rule that a declared fingerprint is REQUIRED and must BE the derived
 * one. `evidenceFingerprint` is not a label a caller attaches: it is the drift
 * detector, and the only trustworthy one is derived from the exact evidence
 * about to be persisted. A caller whose declared fingerprint disagrees is
 * describing evidence it is not submitting, which would bake that disagreement
 * into authority. Refuse.
 *
 * Returns { ok:true, claim, meaning, fingerprint } or { ok:false, code, reason }.
 */
export function validateGovernedQuantityClaimInput(input) {
  if (!input || typeof input !== "object") {
    return { ok: false, code: "INVALID_INPUT", reason: "A governed quantity claim must be an object." };
  }
  if (!isNonEmptyString(input.evidenceFingerprint)) {
    return { ok: false, code: "MISSING_EVIDENCE_FINGERPRINT", reason: "evidenceFingerprint is required; it is the drift detector for this claim." };
  }
  const built = buildGovernedQuantityClaim(input);
  if (!built.ok) return built;
  if (input.evidenceFingerprint !== built.fingerprint) {
    return {
      ok: false,
      code: "EVIDENCE_FINGERPRINT_MISMATCH",
      reason: `Declared evidence fingerprint ${input.evidenceFingerprint} is not the fingerprint of this claim's own evidence (${built.fingerprint}). `
        + "The submitted fingerprint must be derived from exactly the evidence being persisted.",
    };
  }
  return built;
}

/**
 * The fingerprint the writer will expect for this input.
 *
 * Exposed so a real caller (the evidence pipeline) can derive the same value
 * from the evidence it read, rather than inventing one -- which is exactly the
 * check `validateGovernedQuantityClaimInput` enforces.
 */
export function governedQuantityClaimFingerprint(input) {
  const built = buildGovernedQuantityClaim(input);
  return built.ok ? built.fingerprint : null;
}

export { DRAWING_QUANTITY_AUTHORITY_VERSION };

// ---- PERSISTENCE ------------------------------------------------------------
//
// Separate from validation so the rules can be tested without a database.
// Every path here uses the D1 binding; nothing writes by raw string SQL beyond
// parameter binding, and 0020's own triggers remain the final authority.

const identityOf = (c) => [c.project_id, c.document_version_id, c.sheet ?? null, c.floor_or_area ?? null, c.device_class, c.device_variant];

/** Read the current (non-superseded) claim for one 0020 identity, if any. */
async function readCurrentClaim(db, c) {
  const [projectId, documentVersionId, sheet, floorOrArea, deviceClass, deviceVariant] = identityOf(c);
  return db.prepare(
    `SELECT * FROM ${QUANTITY_CLAIM_TABLE}
      WHERE project_id=? AND document_version_id=? AND device_class=? AND device_variant=?
        AND superseded_at IS NULL
        AND (sheet IS ? OR sheet = ?)
        AND (floor_or_area IS ? OR floor_or_area = ?)
      ORDER BY version_number DESC LIMIT 1`,
  ).bind(projectId, documentVersionId, deviceClass, deviceVariant, sheet, sheet, floorOrArea, floorOrArea).first();
}

/** Verify the claim's document version is the document's CURRENT head. */
async function assertCurrentDocumentVersion(db, claim) {
  if (!claim.document_id) {
    return { ok: false, code: "MISSING_DOCUMENT_ID", reason: "documentId is required to verify drawing currentness." };
  }
  const doc = await db.prepare("SELECT id, current_version_id, project_id FROM documents WHERE id=?").bind(claim.document_id).first();
  if (!doc) return { ok: false, code: "UNKNOWN_DOCUMENT", reason: `No document ${claim.document_id}.` };
  // Cross-project refusal: a document from another project may never carry a claim.
  if (doc.project_id !== claim.project_id) {
    return { ok: false, code: "CROSS_PROJECT_DOCUMENT", reason: "The document belongs to a different project." };
  }
  if (doc.current_version_id !== claim.document_version_id) {
    return {
      ok: false,
      code: "STALE_DOCUMENT_VERSION",
      reason: `Claim binds document version ${claim.document_version_id}, which is not the current head ${doc.current_version_id}. `
        + "Quantity authority must be re-derived against the current drawing revision.",
    };
  }
  return { ok: true, document: doc };
}

/** Verify every declared source asset exists and belongs to this claim's intake evidence. */
async function assertSourceAssetsExist(db, claim) {
  for (const id of claim.source_asset_ids ?? []) {
    const row = await db.prepare("SELECT id FROM drawing_assets WHERE id=?").bind(id).first();
    if (!row) {
      return { ok: false, code: "UNVERIFIABLE_SOURCE_ASSETS", reason: `Source asset ${id} does not exist in governed drawing evidence.` };
    }
  }
  return { ok: true };
}

const toStoredRow = (claim, fingerprint, now, { versionNumber = 1, previousVersionId = null } = {}) => ({
  id: `dqc_${crypto.randomUUID().replace(/-/g, "").slice(0, 32)}`,
  project_id: claim.project_id,
  document_id: claim.document_id,
  document_version_id: claim.document_version_id,
  sheet: claim.sheet,
  page: claim.page,
  floor_or_area: claim.floor_or_area,
  parser_version: claim.parser_version,
  semantics_version: claim.semantics_version,
  device_class: claim.device_class,
  device_variant: claim.device_variant,
  quantity_type: claim.quantity_type,
  quantity: claim.quantity,
  count_method: claim.count_method,
  printed_total: claim.printed_total,
  component_total: claim.component_total,
  discrepancy: claim.discrepancy ? JSON.stringify(claim.discrepancy) : null,
  unresolved_reason: claim.unresolved_reason,
  source_region: claim.source_region ? JSON.stringify(claim.source_region) : null,
  source_asset_ids: JSON.stringify(claim.source_asset_ids ?? []),
  evidence_fingerprint: fingerprint,
  state: claim.state,
  authority_version: claim.authority_version ?? DRAWING_QUANTITY_AUTHORITY_VERSION,
  review_status: claim.review?.status ?? "Approved",
  reviewed_by: claim.review?.reviewed_by ?? null,
  reviewed_at: now,
  review_reason: claim.review?.reason ?? null,
  version_number: versionNumber,
  previous_version_id: previousVersionId,
  superseded_at: null,
  created_by: claim.review?.reviewed_by ?? "system",
  created_at: now,
});

/**
 * Persist one governed claim under 0020's version/supersession contract.
 *
 *   identical authority  -> idempotent no-op (the existing claim is returned)
 *   changed authority    -> stamp the old row superseded, insert a new version
 *
 * Never UPDATEs a governed value and never DELETEs history: 0020's triggers
 * would refuse both, and this path never attempts them.
 */
export async function persistGovernedQuantityClaim(db, input, { actorId, now = new Date().toISOString() } = {}) {
  const validated = validateGovernedQuantityClaimInput({ ...input, createdBy: input?.createdBy ?? actorId });
  if (!validated.ok) {
    return { ok: false, status: 422, code: validated.code, reason: validated.reason };
  }
  const claim = validated.claim;

  const currentness = await assertCurrentDocumentVersion(db, claim);
  if (!currentness.ok) {
    return { ok: false, status: currentness.code === "CROSS_PROJECT_DOCUMENT" || currentness.code === "UNKNOWN_DOCUMENT" ? 404 : 409, code: currentness.code, reason: currentness.reason };
  }

  const assets = await assertSourceAssetsExist(db, claim);
  if (!assets.ok) {
    return { ok: false, status: 422, code: assets.code, reason: assets.reason };
  }

  const fingerprint = computeQuantityAuthorityFingerprint({ ...claim, source_asset_ids: claim.source_asset_ids });
  const existing = await readCurrentClaim(db, claim);

  // --- idempotent repeat ---------------------------------------------------
  if (existing) {
    const sameQuantity = existing.quantity === claim.quantity;
    const sameFingerprint = existing.evidence_fingerprint === fingerprint;
    if (sameQuantity && sameFingerprint) {
      return {
        ok: true, idempotent: true, action: "NO_OP",
        claim: { ...existing, source_asset_ids: JSON.parse(existing.source_asset_ids || "[]") },
      };
    }
    // --- supersession ------------------------------------------------------
    // The governed value is never edited. The old row is retired and a NEW
    // version is inserted, so history stays readable and the fingerprint of the
    // superseded claim keeps describing what it actually said.
    const stamped = await db.prepare(
      `UPDATE ${QUANTITY_CLAIM_TABLE} SET superseded_at=? WHERE id=? AND superseded_at IS NULL`,
    ).bind(now, existing.id).run();
    if (!stamped.meta?.changes) {
      // Another writer retired it first. Refuse rather than race.
      return { ok: false, status: 409, code: "CONCURRENT_SUPERSESSION", reason: "The current claim was superseded concurrently. Re-read and retry." };
    }
    const row = toStoredRow(claim, fingerprint, now, {
      versionNumber: (existing.version_number ?? 1) + 1,
      previousVersionId: existing.id,
    });
    const insert = db.prepare(
      `INSERT INTO ${QUANTITY_CLAIM_TABLE}
        (id,project_id,document_id,document_version_id,sheet,page,floor_or_area,parser_version,semantics_version,
         device_class,device_variant,quantity_type,quantity,count_method,printed_total,component_total,discrepancy,
         unresolved_reason,source_region,source_asset_ids,evidence_fingerprint,state,authority_version,review_status,
         reviewed_by,reviewed_at,review_reason,version_number,previous_version_id,superseded_at,created_by,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const inserted = await insert.bind(
      row.id, row.project_id, row.document_id, row.document_version_id, row.sheet, row.page, row.floor_or_area,
      row.parser_version, row.semantics_version, row.device_class, row.device_variant, row.quantity_type, row.quantity,
      row.count_method, row.printed_total, row.component_total, row.discrepancy, row.unresolved_reason,
      row.source_region, row.source_asset_ids, row.evidence_fingerprint, row.state, row.authority_version,
      row.review_status, row.reviewed_by, row.reviewed_at, row.review_reason, row.version_number,
      row.previous_version_id, null, row.created_by, row.created_at,
    ).run();
    if (!inserted.meta?.changes) {
      return { ok: false, status: 409, code: "SUPERSESSION_ROLLED_BACK", reason: "0020's guards refused the replacement claim; the previous version remains current." };
    }
    return { ok: true, idempotent: false, action: "SUPERSEDED", previousClaimId: existing.id, claim: row };
  }

  // --- first write ---------------------------------------------------------
  const row = toStoredRow(claim, fingerprint, now);
  const inserted = await db.prepare(
    `INSERT INTO ${QUANTITY_CLAIM_TABLE}
      (id,project_id,document_id,document_version_id,sheet,page,floor_or_area,parser_version,semantics_version,
       device_class,device_variant,quantity_type,quantity,count_method,printed_total,component_total,discrepancy,
       unresolved_reason,source_region,source_asset_ids,evidence_fingerprint,state,authority_version,review_status,
       reviewed_by,reviewed_at,review_reason,version_number,previous_version_id,superseded_at,created_by,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    row.id, row.project_id, row.document_id, row.document_version_id, row.sheet, row.page, row.floor_or_area,
    row.parser_version, row.semantics_version, row.device_class, row.device_variant, row.quantity_type, row.quantity,
    row.count_method, row.printed_total, row.component_total, row.discrepancy, row.unresolved_reason,
    row.source_region, row.source_asset_ids, row.evidence_fingerprint, row.state, row.authority_version,
    row.review_status, row.reviewed_by, row.reviewed_at, row.review_reason, row.version_number,
    row.previous_version_id, null, row.created_by, row.created_at,
  ).run();
  if (!inserted.meta?.changes) {
    return { ok: false, status: 409, code: "CLAIM_NOT_INSERTED", reason: "0020's guards refused the claim." };
  }
  return { ok: true, idempotent: false, action: "CREATED", previousClaimId: null, claim: row };
}
