export const QUOTATION_AUTHORITY_VERSION = "quotation-authority-1.0.0";
export const GOVERNED_EXPORT_MODES = new Set(["Approved Cost Sheet", "Client-Safe Export"]);

const ordered = (value) => {
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
};

export const canonicalQuotationEvidence = (manifest) => JSON.stringify(ordered(manifest));
export const quotationEvidenceFingerprint = async (manifest) => {
  const bytes = new TextEncoder().encode(canonicalQuotationEvidence(manifest));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((value) => value.toString(16).padStart(2, "0")).join("");
};

export const QUOTATION_PROVENANCE = Object.freeze({
  USER_AUTHORED: "USER_AUTHORED",
  PROJECT_DERIVED: "PROJECT_DERIVED",
  SYSTEM_DEFAULT: "SYSTEM_DEFAULT",
  GOVERNED_TEMPLATE: "GOVERNED_TEMPLATE",
});

export const quotationTermsWithProvenance = ({ fields, actorId, timestamp }) => ({
  terms: Object.fromEntries(Object.entries(fields).map(([field, entry]) => [field, entry.value])),
  provenance: {
    version: 1,
    recordedAt: timestamp,
    recordedBy: actorId,
    values: Object.fromEntries(Object.entries(fields).map(([field, entry]) => [field, {
      value: entry.value,
      provenance: entry.provenance,
      authority: entry.authority,
      ...(entry.provenance === QUOTATION_PROVENANCE.USER_AUTHORED ? { actorId } : {}),
      recordedAt: timestamp,
      ...(entry.sourceReference ? { sourceReference: entry.sourceReference } : {}),
    }])),
  },
});

export const buildQuotationTerms = ({ payload = {}, project, actorId, timestamp }) => {
  const has = (field) => Object.prototype.hasOwnProperty.call(payload, field);
  const user = (value, field) => ({ value, provenance: QUOTATION_PROVENANCE.USER_AUTHORED, authority: "Quotation Draft Request", sourceReference: `request.${field}` });
  const system = (value, field) => ({ value, provenance: QUOTATION_PROVENANCE.SYSTEM_DEFAULT, authority: "Deterministic Application Default", sourceReference: `quotation-default.${field}` });
  const projectValue = (value, field) => ({ value, provenance: QUOTATION_PROVENANCE.PROJECT_DERIVED, authority: "Governed Project Record", sourceReference: `projects.${field}:${project.id}` });
  return quotationTermsWithProvenance({ fields: {
    validityDays: has("validityDays") ? user(Number(payload.validityDays), "validityDays") : system(30, "validityDays"),
    warrantyMonths: has("warrantyMonths") ? user(Number(payload.warrantyMonths), "warrantyMonths") : system(12, "warrantyMonths"),
    delivery: has("delivery") ? user(String(payload.delivery), "delivery") : system("Unknown", "delivery"),
    paymentTerms: has("paymentTerms") ? user(String(payload.paymentTerms), "paymentTerms") : system("Unknown", "paymentTerms"),
    exclusions: Array.isArray(payload.exclusions) ? user(payload.exclusions, "exclusions") : system([], "exclusions"),
    client: has("client") ? user(String(payload.client), "client") : (project.client ? projectValue(String(project.client), "client") : system("Unknown", "client")),
  }, actorId, timestamp });
};

export const exportEligibleForQuotationIssue = ({ exportJob, quotation, currentEvidenceFingerprint }) => {
  const reject = (code) => ({ eligible: false, code, reasons: [code] });
  if (!exportJob || !quotation) return reject("GOVERNED_EXPORT_REQUIRED");
  if (exportJob.project_id !== quotation.project_id) return reject("EXPORT_PROJECT_MISMATCH");
  if (!["Completed", "Completed with Warnings"].includes(exportJob.status)) return reject("EXPORT_NOT_COMPLETED");
  if (!GOVERNED_EXPORT_MODES.has(exportJob.export_mode)) return reject("EXPORT_MODE_NOT_GOVERNED");
  if (exportJob.cancelled_at || exportJob.superseded_by_id) return reject("EXPORT_STALE");
  if (exportJob.quotation_revision_id !== quotation.id || exportJob.quotation_fingerprint !== quotation.quotation_fingerprint) return reject("EXPORT_QUOTATION_MISMATCH");
  if (quotation.evidence_fingerprint !== currentEvidenceFingerprint || exportJob.evidence_fingerprint !== currentEvidenceFingerprint) return reject("EXPORT_EVIDENCE_STALE");
  return { eligible: true, reasons: [] };
};

/**
 * The canonical quotation fingerprint.
 *
 * One definition, used by the single writer when it creates a revision and by
 * the snapshot export loader when it verifies one. The fingerprint binds the
 * evidence fingerprint, the totals, the VAT basis, the terms AND the immutable
 * quotation lines -- that last part is what makes a stored revision tamper
 * evident: if any line's product, pricing lineage, commercial approval or money
 * changes after approval, recomputing the fingerprint no longer reproduces the
 * stored value, and the snapshot export loader fails closed instead of exporting
 * a quotation nobody approved.
 *
 * `lineAuthority.lines` (the canonical line reader's output) and the stored
 * project_quotation_lines rows describe the same facts, so both sides project
 * them through `quotationLineFingerprintLine` and therefore agree.
 */
export const quotationLineFingerprintLine = (line) => ({
  boqItemId: line.boqItemId ?? line.boq_item_id ?? null,
  pricingRunId: line.pricingRunId ?? line.pricing_run_id ?? null,
  pricingRunVersion: Number(line.pricingRunVersion ?? line.pricing_run_version),
  pricingLineId: line.pricingLineId ?? line.pricing_line_id ?? null,
  pricingLineVersion: Number(line.pricingLineVersion ?? line.pricing_line_version),
  commercialApprovalId: line.commercialApprovalId ?? line.commercial_approval_id ?? null,
  commercialApprovalVersion: Number(line.commercialApprovalVersion ?? line.commercial_approval_version),
  productId: line.productId ?? line.product_id ?? null,
  quantity: String(line.quantity ?? ""),
  netSellingMinor: Number(line.netSellingMinor ?? line.net_selling_minor),
});

/** The fingerprint payload. Key order is part of the contract: JSON.stringify is the digest input. */
export const quotationFingerprintInput = ({ evidenceFingerprint, totals, lineAuthority, vatBasisPoints, terms }) => ({
  evidenceFingerprint,
  totals: {
    currency: totals.currency,
    costMinor: Number(totals.costMinor),
    subtotalMinor: Number(totals.subtotalMinor),
    lineCount: Number(totals.lineCount),
    selectedScenarioId: totals.selectedScenarioId ?? null,
  },
  quotationLineAuthority: {
    version: lineAuthority.authorityVersion,
    lineCount: lineAuthority.lines.length,
    lines: lineAuthority.lines.map(quotationLineFingerprintLine),
  },
  vatBasisPoints,
  terms,
});

export const quotationDigest = async (input) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(input))))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
