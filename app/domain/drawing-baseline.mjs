// Project drawing baseline: persisted human confirmation over the exact
// current drawing/intake set. Pure domain logic: no DOM, no fetch, no DB.
//
// A baseline binds project -> {document, documentVersion, intakeVersion}[].
// It is idempotent on the set fingerprint: reconfirming the identical set
// returns the existing row. A changed set supersedes the old generation and
// requires a new confirmation. Human actor is mandatory.
export const DRAWING_BASELINE_VERSION = "drawing-baseline-1.0.0";

export function baselineSetFingerprint(members) {
  const canonical = [...members]
    .map((m) => [m.documentId, m.documentVersionId, m.intakeVersionId].join("|"))
    .sort()
    .join(";");
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < canonical.length; i += 1) {
    const ch = canonical.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h2 >>> 13), 3266489909);
  return `dbl_${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0")}`;
}

// Fail-closed eligibility: every current Drawing must have a successful
// current intake in THIS project, versions must be live heads.
export function eligibleBaselineSet({ documents = [], intakesByDocument = {}, heads = {} } = {}) {
  const problems = [];
  const members = [];
  for (const doc of documents) {
    const intake = intakesByDocument[doc.id] || null;
    if (!intake) { problems.push({ documentId: doc.id, reason: "NO_CURRENT_INTAKE" }); continue; }
    if (intake.status !== "Completed") { problems.push({ documentId: doc.id, reason: "INTAKE_NOT_COMPLETED" }); continue; }
    if (intake.project_id !== doc.project_id) { problems.push({ documentId: doc.id, reason: "FOREIGN_PROJECT_INTAKE" }); continue; }
    if (doc.current_version_id !== intake.document_version_id) { problems.push({ documentId: doc.id, reason: "STALE_INTAKE_VERSION" }); continue; }
    if (heads[doc.id] && heads[doc.id] !== doc.current_version_id) { problems.push({ documentId: doc.id, reason: "STALE_DOCUMENT_VERSION" }); continue; }
    members.push({
      documentId: doc.id,
      documentVersionId: doc.current_version_id,
      intakeVersionId: intake.id,
      logicalName: doc.logical_name ?? null,
    });
  }
  if (!members.length) problems.push({ documentId: null, reason: "ZERO_ELIGIBLE_DRAWINGS" });
  return { members, problems, fingerprint: baselineSetFingerprint(members) };
}

export function baselineStatus({ confirmed, currentFingerprint }) {
  if (!confirmed) return { state: "UNCONFIRMED" };
  if (confirmed.set_fingerprint !== currentFingerprint) return { state: "UPDATE_REQUIRED", baseline: confirmed };
  return { state: "CONFIRMED", baseline: confirmed };
}
