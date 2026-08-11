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
