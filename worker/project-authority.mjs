const ACTIVE_MEMBER = "status='Active' AND revoked_at IS NULL";

const roleValue = (value) => String(value || "").trim();
const isExplicitApplicationAdmin = (actor) =>
  actor?.fullAccess === true && ["Administrator", actor?.permission].includes(actor?.role);

// The role vocabulary and approval sets live in `app/domain/project-roles.mjs` so
// there is exactly one authority. They used to be duplicated here and again in
// `app/domain/review-workflow.mjs`, and the copies disagreed: the review
// workflow's permitted-role table locked out "Technical Reviewer",
// "Senior Technical Reviewer", "Management" and "Project Manager", so a review
// item naming a Technical Reviewer could not be decided by one, and the project
// owner -- who resolves to Project Manager here -- could not decide any review at
// all. `tests/review-role-authority-coherence.test.mjs` now holds the two
// together. This module re-exports the shared sets so its public API is unchanged.
import {
  COMMERCIAL_APPROVAL_ROLES,
  PROJECT_ROLE_VOCABULARY,
  QUOTATION_APPROVAL_ROLES,
  TECHNICAL_APPROVAL_ROLES,
} from "../app/domain/project-roles.mjs";

export { PROJECT_ROLE_VOCABULARY };

export const canApproveTechnicalSafety = (role) => TECHNICAL_APPROVAL_ROLES.includes(roleValue(role));
export const canApproveCommercialPrice = (role) => COMMERCIAL_APPROVAL_ROLES.includes(roleValue(role));
export const canApproveQuotation = (role) => QUOTATION_APPROVAL_ROLES.includes(roleValue(role));

/**
 * Resolve the project role from the durable project membership/owner authority.
 * Client headers are never read. The application actor may supply Administrator
 * authority only when the server actor explicitly carries Administrator plus
 * fullAccess; every other fullAccess claim is not a project role.
 */
export const resolveProjectAuthority = async (db, { projectId, actor } = {}) => {
  const userId = roleValue(actor?.id);
  if (!db || !userId || !roleValue(projectId)) return null;
  const row = await db
    .prepare(
      `SELECT p.owner_user_id, pm.role member_role
       FROM projects p
       LEFT JOIN project_members pm
         ON pm.project_id=p.id AND pm.user_id=? AND ${ACTIVE_MEMBER}
       WHERE p.id=? AND (p.owner_user_id=? OR pm.user_id IS NOT NULL)`,
    )
    .bind(userId, projectId, userId)
    .first();
  if (!row) {
    if (!isExplicitApplicationAdmin(actor)) return null;
    return { projectId, role: "Administrator", source: "application_admin" };
  }
  if (row.member_role) return { projectId, role: roleValue(row.member_role), source: "project_member" };
  if (row.owner_user_id === userId) return { projectId, role: "Project Manager", source: "owner" };
  return null;
};
