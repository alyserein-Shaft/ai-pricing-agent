// BOQ review submission planner (pure, UI-agnostic).
//
// Translates reviewed normalized groups into durable bulk-review calls
// without fabricating human activity:
//   - ACCEPT on a group approves ONLY canonical members currently in
//     Needs Review; already Auto Verified / Approved members are untouched.
//   - EXCLUDE on a group rejects ALL canonical members with that group's
//     own user-provided reason (explicit human override).
//   - Groups with unresolved anchors, undecided lines, or exclusions
//     lacking reasons block submission with explicit errors.
// MAX_BATCH mirrors the bulk-review endpoint limit.
export const BOQ_REVIEW_BATCH_LIMIT = 50;

export const planBoqReviewSubmission = ({ candidates = [], lineDecisions = {}, exclusionReasons = {} } = {}) => {
  const list = Array.isArray(candidates) ? candidates : [];
  const errors = [];
  if (!list.length) return { approveIds: [], rejectBatches: [], errors: ["NO_CANDIDATES_STAGED"], pendingLines: 0 };
  let pendingLines = 0;
  const approveIds = [];
  const rejectBatches = [];
  for (const candidate of list) {
    const decision = lineDecisions[candidate.id] || "Pending";
    if (decision === "Pending") { pendingLines += 1; continue; }
    const members = Array.isArray(candidate.memberItemIds) ? candidate.memberItemIds : [];
    const pending = Array.isArray(candidate.pendingItemIds) ? candidate.pendingItemIds : [];
    const unresolved = Array.isArray(candidate.unresolvedAnchors) ? candidate.unresolvedAnchors : [];
    if (decision === "Accepted") {
      if (unresolved.length) { errors.push(`GROUP_UNRESOLVED_ANCHORS:${candidate.id}`); continue; }
      for (const id of pending) if (!approveIds.includes(id)) approveIds.push(id);
    } else if (decision === "Excluded") {
      const reason = String(exclusionReasons[candidate.id] || "").trim();
      if (!reason) { errors.push(`GROUP_EXCLUSION_REASON_REQUIRED:${candidate.id}`); continue; }
      if (unresolved.length) { errors.push(`GROUP_UNRESOLVED_ANCHORS:${candidate.id}`); continue; }
      if (members.length) rejectBatches.push({ ids: [...members], reason, groupId: candidate.id });
    }
  }
  if (pendingLines) errors.push(`LINES_PENDING:${pendingLines}`);
  return { approveIds, rejectBatches, errors, pendingLines };
};

export const chunkIds = (ids = [], limit = BOQ_REVIEW_BATCH_LIMIT) => {
  const out = [];
  for (let index = 0; index < ids.length; index += limit) out.push(ids.slice(index, index + limit));
  return out;
};
