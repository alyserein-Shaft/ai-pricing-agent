// The one project role authority.
//
// This module previously existed twice: once as the durable approval sets in
// `worker/project-authority.mjs`, and once as a hand-maintained permitted-role
// table in `app/domain/review-workflow.mjs`. The two drifted, and the drift was
// structurally significant rather than cosmetic -- "Technical Reviewer" and
// "Senior Technical Reviewer" are the canonical `required_role` values for a
// technical review, and neither could decide one; "Project Manager", which
// `resolveProjectAuthority` assigns to every project owner, could decide none at
// all. See `tests/review-role-authority-coherence.test.mjs` for the property that
// now holds this together.
//
// There are two distinct questions here, and keeping them separate is the point:
//
//   1. Which roles may APPROVE work? (`TECHNICAL_APPROVAL_ROLES` and friends.)
//      An authority the server resolves from durable project membership.
//   2. Which role may a review item DEMAND? (`TECHNICAL_REVIEW_REQUIRED_ROLES`
//      and friends.) A property of the review stage, set when the item is created.
//
// Question 2 must not silently become question 1. A technical review may only
// demand a technical reviewer, even though Management and Administrator can
// approve technical work -- otherwise any approval could be reframed as a review
// that asked for exactly the approver who signed it.

export const PROJECT_ROLE_VOCABULARY = Object.freeze([
  "Estimator",
  "Project Manager",
  "Engineering Reviewer",
  "Technical Reviewer",
  "Senior Technical Reviewer",
  "Technical Manager",
  "Commercial Reviewer",
  "Commercial Manager",
  "Commercial Approver",
  "Management",
  "Administrator",
]);

export const TECHNICAL_APPROVAL_ROLES = Object.freeze([
  "Engineering Reviewer",
  "Technical Reviewer",
  "Senior Technical Reviewer",
  "Technical Manager",
  // The project owner resolves to Project Manager and is a technical authority
  // for their own project. An owner who cannot close the review that authorises
  // the work is an incoherent authority path, not a stricter policy.
  "Project Manager",
  "Management",
  "Administrator",
]);

export const COMMERCIAL_APPROVAL_ROLES = Object.freeze([
  "Commercial Reviewer",
  "Commercial Manager",
  "Commercial Approver",
  "Project Manager",
  "Management",
  "Administrator",
]);

export const QUOTATION_APPROVAL_ROLES = Object.freeze([
  "Commercial Reviewer",
  "Commercial Manager",
  "Commercial Approver",
  "Project Manager",
  "Management",
  "Administrator",
]);

// What a review item is allowed to demand, by stage. Deliberately narrower than
// the approval sets: a review exists to obtain an independent technical or
// commercial judgement, so a technical review may not simply name its own
// prospective approver as its requirement.
export const TECHNICAL_REVIEW_REQUIRED_ROLES = Object.freeze([
  "Senior Technical Reviewer",
  "Technical Reviewer",
  "Engineering Reviewer",
  "Technical Manager",
]);

export const COMMERCIAL_REVIEW_REQUIRED_ROLES = Object.freeze([
  "Commercial Reviewer",
  "Commercial Manager",
  "Commercial Approver",
  "Management",
  "Administrator",
]);

export const REVIEW_DECISION_STAGE_ROLES = Object.freeze({
  technical: TECHNICAL_APPROVAL_ROLES,
  commercial: COMMERCIAL_APPROVAL_ROLES,
});

export const REVIEW_REQUIRED_ROLES_BY_STAGE = Object.freeze({
  technical: TECHNICAL_REVIEW_REQUIRED_ROLES,
  commercial: COMMERCIAL_REVIEW_REQUIRED_ROLES,
});

const normalizeRole = (value) => String(value || "").trim();

/**
 * The roles permitted to decide a review item that demands `requiredRole`.
 *
 * A `requiredRole` that is not a recognised review requirement has no permitted
 * roles: an unknown requirement is refused, never treated as unrestricted.
 */
export const resolveReviewDecisionRoles = (requiredRole) => {
  const required = normalizeRole(requiredRole);
  if (TECHNICAL_REVIEW_REQUIRED_ROLES.includes(required)) return TECHNICAL_APPROVAL_ROLES;
  if (COMMERCIAL_REVIEW_REQUIRED_ROLES.includes(required)) return COMMERCIAL_APPROVAL_ROLES;
  return null;
};

/** True when `requiredRole` is a requirement a review item of `stage` may carry. */
export const isRequiredRoleForStage = (stage, requiredRole) =>
  (REVIEW_REQUIRED_ROLES_BY_STAGE[stage] || []).includes(normalizeRole(requiredRole));

/** True when `role` is trusted to approve work of `stage`. */
export const canApproveStage = (stage, role) => (REVIEW_DECISION_STAGE_ROLES[stage] || []).includes(normalizeRole(role));
