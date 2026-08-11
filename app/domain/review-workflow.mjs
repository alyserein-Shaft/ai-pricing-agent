export const REVIEW_STATUSES = ["Not Started", "Open", "Assigned", "In Review", "Waiting for Clarification", "Waiting for Supplier", "Waiting for Technical Approval", "Waiting for Commercial Approval", "Changes Requested", "Approved", "Approved with Conditions", "Rejected", "Escalated", "Blocked", "Superseded", "Cancelled"];
export const TERMINAL_REVIEW_STATUSES = new Set(["Approved", "Rejected", "Superseded", "Cancelled"]);
const transitions = {
  "Not Started": ["Open", "Assigned", "Cancelled"], Open: ["Assigned", "In Review", "Blocked", "Escalated", "Cancelled"], Assigned: ["In Review", "Open", "Escalated", "Cancelled"],
  "In Review": ["Waiting for Clarification", "Waiting for Supplier", "Waiting for Technical Approval", "Waiting for Commercial Approval", "Changes Requested", "Approved", "Approved with Conditions", "Rejected", "Escalated", "Blocked"],
  "Waiting for Clarification": ["In Review", "Blocked", "Escalated"], "Waiting for Supplier": ["In Review", "Blocked", "Escalated"], "Waiting for Technical Approval": ["In Review", "Approved", "Approved with Conditions", "Changes Requested", "Rejected", "Escalated"],
  "Waiting for Commercial Approval": ["In Review", "Approved", "Approved with Conditions", "Changes Requested", "Rejected", "Escalated"], "Changes Requested": ["In Review", "Assigned", "Cancelled"],
  "Approved with Conditions": ["Approved", "Changes Requested", "Escalated", "Superseded"], Blocked: ["Open", "In Review", "Escalated", "Cancelled"], Escalated: ["Assigned", "In Review", "Approved", "Rejected"], Approved: ["Superseded"], Rejected: ["Open", "Superseded"], Superseded: [], Cancelled: ["Open"]
};

export const canTransitionReview = (from, to) => REVIEW_STATUSES.includes(to) && (transitions[from] || []).includes(to);

export const calculateReviewPriority = ({ safetyState, severity, blocking, dueDate, value = 0, confidence = 100, marginException = false, supplierDependency = false }) => {
  let score = 0;
  if (["Blocked", "Unsafe"].includes(safetyState)) score += 50;
  if (severity === "Critical") score += 40; else if (severity === "High") score += 25; else if (severity === "Medium") score += 10;
  if (blocking) score += 25; if (marginException) score += 20; if (supplierDependency) score += 8; if (confidence < 50) score += 15; else if (confidence < 75) score += 8;
  if (Number(value) >= 100000) score += 12; else if (Number(value) >= 25000) score += 6;
  if (dueDate) { const days = (new Date(dueDate).getTime() - Date.now()) / 86400000; if (days < 0) score += 30; else if (days <= 2) score += 18; else if (days <= 7) score += 8; }
  return { score, priority: score >= 65 ? "Critical" : score >= 40 ? "High" : score >= 18 ? "Medium" : "Low" };
};

export const validateDecision = ({ review, decision, role, currentVersion, safety, technicalApproved, pricingReady, dependencies = [], conditions = [] }) => {
  const errors = [];
  if (!review) errors.push("REVIEW_NOT_FOUND");
  if (review && Number(currentVersion) !== Number(review.versionNumber)) errors.push("STALE_REVIEW_VERSION");
  if (!String(decision?.reason || "").trim() || String(decision?.reason || "").trim().length < 10) errors.push("DECISION_REASON_REQUIRED");
  if (!role) errors.push("REVIEW_ROLE_REQUIRED");
  const type = String(decision?.type || "");
  if (type.includes("Technical") && !["Senior Technical Reviewer", "Technical Manager", "Admin"].includes(role)) errors.push("TECHNICAL_APPROVAL_ROLE_REQUIRED");
  if ((type.includes("Commercial") || type.includes("Margin") || type.includes("Cost") || type.includes("Price")) && !["Commercial Reviewer", "Commercial Manager", "Management", "Admin"].includes(role)) errors.push("COMMERCIAL_APPROVAL_ROLE_REQUIRED");
  if ((type.includes("Approve") || type === "Approved") && safety && safety.technicalEligibility !== "Eligible") errors.push("SAFETY_APPROVAL_BLOCKED");
  if ((type.includes("Commercial") || type.includes("Cost") || type.includes("Price")) && !technicalApproved) errors.push("TECHNICAL_APPROVAL_REQUIRED");
  if ((type.includes("Commercial") || type.includes("Cost")) && !pricingReady) errors.push("PRICING_APPROVAL_BLOCKED");
  if (dependencies.some((entry) => entry.blocking && entry.status !== "Completed")) errors.push("UNRESOLVED_DEPENDENCY");
  if (decision?.outcome === "Approved with Conditions" && conditions.some((entry) => !entry.description || !entry.owner || !entry.dueDate)) errors.push("INVALID_APPROVAL_CONDITION");
  return { permitted: errors.length === 0, errors };
};

export const validateBulkAction = (items = []) => {
  const errors = [];
  if (!items.length) errors.push("NO_REVIEW_ITEMS");
  for (const field of ["safetyState", "approvalLevel", "reviewType"]) if (new Set(items.map((item) => item[field])).size > 1) errors.push(`MIXED_${field.replace(/[A-Z]/g, (x) => `_${x}`).toUpperCase()}`);
  if (items.some((item) => item.severity === "Critical" || item.manualOverride || item.blocking)) errors.push("UNSAFE_BULK_ACTION");
  return { permitted: errors.length === 0, errors };
};

export const calculateQuotationReadiness = ({ reviewItems = [], clarifications = [], safetyBlocks = 0, pricingPending = 0 }) => {
  if (reviewItems.some((item) => item.status === "Rejected")) return "Rejected";
  if (safetyBlocks || reviewItems.some((item) => item.status === "Blocked" || item.status === "Escalated")) return "Exceptions Pending";
  if (clarifications.some((item) => !["Resolved", "Rejected", "Cancelled"].includes(item.status))) return "Clarifications Pending";
  if (pricingPending) return "Supplier Pricing Pending";
  const technical = reviewItems.filter((item) => /Technical|Specification|Compatibility|Standards/.test(item.reviewType));
  if (technical.some((item) => !["Approved", "Approved with Conditions"].includes(item.status))) return "Technical Review Required";
  const commercial = reviewItems.filter((item) => /Commercial|Cost|Margin|Price/.test(item.reviewType));
  if (commercial.some((item) => !["Approved", "Approved with Conditions"].includes(item.status))) return "Commercial Review Required";
  if (reviewItems.some((item) => item.status === "Approved with Conditions")) return "Ready with Warnings";
  return reviewItems.length ? "Ready for Quotation" : "Not Ready";
};

export const summarizeReviews = (items = [], readiness = "Not Ready") => ({
  total: items.length, open: items.filter((x) => ["Not Started", "Open", "Assigned"].includes(x.status)).length, inReview: items.filter((x) => x.status === "In Review").length,
  waiting: items.filter((x) => x.status.startsWith("Waiting")).length, approved: items.filter((x) => x.status === "Approved").length, conditional: items.filter((x) => x.status === "Approved with Conditions").length,
  rejected: items.filter((x) => x.status === "Rejected").length, blocked: items.filter((x) => x.status === "Blocked").length, escalated: items.filter((x) => x.status === "Escalated").length,
  overdue: items.filter((x) => x.dueDate && new Date(x.dueDate) < new Date() && !TERMINAL_REVIEW_STATUSES.has(x.status)).length, readiness
});
