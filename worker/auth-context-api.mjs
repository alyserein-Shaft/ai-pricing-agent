import { authenticateLibraryActor } from "./library-auth.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" },
});

const initials = (name, email) => String(name || email || "User")
  .split(/\s+|@/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "U";

export const handleAuthContextApi = async (request, env) => {
  const url = new URL(request.url);
  if (url.pathname !== "/api/auth/session" || request.method !== "GET") return null;
  const authentication = await authenticateLibraryActor(request, env);
  if (authentication.error) return json({ authenticated: false, error: authentication.error }, authentication.error.status);
  const actor = authentication.actor;
  const organizationRows = await env.DB.prepare("SELECT o.id,o.name,m.status,m.id membership_id,GROUP_CONCAT(CASE WHEN r.status='Active' AND r.revoked_at IS NULL THEN r.role END,'|') roles FROM organization_memberships m JOIN organizations o ON o.id=m.organization_id LEFT JOIN organization_membership_roles r ON r.membership_id=m.id WHERE m.user_id=? AND o.id=? AND m.status='Active' AND m.revoked_at IS NULL AND o.status='Active' GROUP BY o.id,o.name,m.status,m.id ORDER BY o.name,o.id").bind(actor.id, actor.organizationId).all();
  const projectRows = await env.DB.prepare("SELECT p.id project_id,p.name project_name,p.organization_id,COALESCE(pm.role,CASE WHEN p.owner_user_id=? THEN 'Project Manager' END) role FROM projects p LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=? AND pm.status='Active' AND pm.revoked_at IS NULL WHERE p.archived_at IS NULL AND p.organization_id=? AND (p.owner_user_id=? OR pm.id IS NOT NULL) ORDER BY p.name,p.id").bind(actor.id, actor.id, actor.organizationId, actor.id).all();
  const fullName = actor.fullName || null;
  const displayName = fullName || actor.email;
  return json({
    authenticated: true,
    user: { id: actor.id, email: actor.email, fullName, displayName, initials: initials(fullName, actor.email) },
    effectiveLibraryPermission: actor.permission,
    authenticationSource: actor.authenticationSource,
    accessMode: actor.accessMode,
    fullAccess: actor.fullAccess,
    organizations: (organizationRows.results || []).map((organization) => ({ ...organization, roles: String(organization.roles || "").split("|").filter(Boolean) })),
    defaultOrganizationId: actor.organizationId,
    projectMemberships: projectRows.results || [],
    signOutUrl: "/signout-with-chatgpt?return_to=/",
  });
};
