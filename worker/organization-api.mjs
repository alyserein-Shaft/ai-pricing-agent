import { authenticateLibraryActor } from "./library-auth.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" } });
const problem = (status, code, message) => json({ error: { status, code, message } }, status);
const normalizeIdPart = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60);
const organizationIdFor = (name) => `organization_${normalizeIdPart(name)}`;
const membershipIdFor = (organizationId, userId) => `orgmembership_${normalizeIdPart(organizationId)}_${normalizeIdPart(userId)}`;

const organizationForActor = async (db, actorId, organizationId) => db.prepare(`
  SELECT o.id,o.name,o.status,o.owner_user_id,CASE WHEN o.owner_user_id=? THEN 1 ELSE 0 END is_owner,m.id membership_id,m.status membership_status,
    GROUP_CONCAT(CASE WHEN r.status='Active' AND r.revoked_at IS NULL THEN r.role END,'|') roles
  FROM organizations o
  JOIN organization_memberships m ON m.organization_id=o.id AND m.user_id=? AND m.status='Active' AND m.revoked_at IS NULL
  LEFT JOIN organization_membership_roles r ON r.membership_id=m.id
  WHERE o.id=? AND o.status='Active'
  GROUP BY o.id,o.name,o.status,o.owner_user_id,m.id,m.status
`).bind(actorId, actorId, organizationId).first();

const view = (row) => row ? { id: row.id, name: row.name, status: row.status, membershipId: row.membership_id, roles: String(row.roles || "").split("|").filter(Boolean), isOwner: Boolean(row.is_owner) } : null;

export const createInternalPilotOrganization = async (request, env, actor) => {
  if (env.IDENTITY_AUTH_MODE !== "local" || env.IDENTITY_LOCAL_DEVELOPMENT !== "true" || env.ORGANIZATION_BOOTSTRAP_ENABLED !== "true") return problem(403, "ORGANIZATION_BOOTSTRAP_DISABLED", "The controlled local organization bootstrap is disabled.");
  const configuredUserId = env.LOCAL_DEVELOPMENT_USER_ID || "local-development-user";
  if (actor.id !== configuredUserId || actor.authenticationSource !== "Explicit Local Development") return problem(403, "ORGANIZATION_BOOTSTRAP_ACTOR_DENIED", "Only the verified configured development identity may run this bootstrap.");
  const name = "BD-Shaft Internal Pilot", organizationId = organizationIdFor(name), membershipId = membershipIdFor(organizationId, actor.id);
  const existing = await organizationForActor(env.DB, actor.id, organizationId);
  if (existing) return json({ organization: view(existing), created: false, idempotent: true });
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  const roles = ["Organization Owner", "Organization Administrator"];
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id,name,status,owner_user_id) VALUES (?,?,'Active',?) ON CONFLICT(id) DO NOTHING").bind(organizationId, name, actor.id),
    env.DB.prepare("INSERT INTO organization_memberships (id,organization_id,user_id,status,granted_by) VALUES (?,?,?,'Active',?) ON CONFLICT(organization_id,user_id) DO NOTHING").bind(membershipId, organizationId, actor.id, actor.id),
    ...roles.map((role) => env.DB.prepare("INSERT INTO organization_membership_roles (id,membership_id,role,status,granted_by) VALUES (?,?,?,'Active',?) ON CONFLICT(membership_id,role) DO NOTHING").bind(`orgrole_${normalizeIdPart(role)}_${normalizeIdPart(actor.id)}`, membershipId, role, actor.id)),
    env.DB.prepare("INSERT OR IGNORE INTO organization_audit_events (id,organization_id,action,actor_user_id,actor_authentication_source,reason,new_value_json,request_id) VALUES (?,?, 'Organization Created',?,?,?,?,?)").bind(`orgaudit_created_${organizationId}`, organizationId, actor.id, actor.authenticationSource, "Controlled authenticated development organization bootstrap", JSON.stringify({ name, status: "Active", ownerUserId: actor.id }), requestId),
    env.DB.prepare("INSERT OR IGNORE INTO organization_audit_events (id,organization_id,membership_id,action,actor_user_id,actor_authentication_source,reason,new_value_json,request_id) VALUES (?,?,?,'Organization Membership Granted',?,?,?,?,?)").bind(`orgaudit_membership_${membershipId}`, organizationId, membershipId, actor.id, actor.authenticationSource, "Assign the verified development user as organization owner and administrator", JSON.stringify({ userId: actor.id, roles, status: "Active" }), requestId),
  ]);
  const created = await organizationForActor(env.DB, actor.id, organizationId);
  if (!created || !roles.every((role) => String(created.roles || "").split("|").includes(role))) return problem(503, "ORGANIZATION_BOOTSTRAP_INCOMPLETE", "The organization assignment could not be verified.");
  return json({ organization: view(created), created: true, idempotent: false }, 201);
};

export const handleOrganizationApi = async (request, env) => {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/organizations")) return null;
  const authentication = await authenticateLibraryActor(request, env);
  if (authentication.error) return json({ error: authentication.error }, authentication.error.status);
  const actor = authentication.actor;
  if (url.pathname === "/api/organizations/internal-pilot-bootstrap" && request.method === "POST") return createInternalPilotOrganization(request, env, actor);
  if (url.pathname === "/api/organizations/default" && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT organization_id FROM organization_memberships WHERE user_id=? AND status='Active' AND revoked_at IS NULL ORDER BY granted_at,id").bind(actor.id).all();
    if (!(rows.results || []).length) return problem(404, "ORGANIZATION_MEMBERSHIP_REQUIRED", "No active organization membership is assigned.");
    if (rows.results.length !== 1) return problem(409, "DEFAULT_ORGANIZATION_AMBIGUOUS", "A default organization must be selected from the user's memberships.");
    const organization = await organizationForActor(env.DB, actor.id, rows.results[0].organization_id);
    return json({ organization: view(organization), resolution: "Single active server membership" });
  }
  const match = url.pathname.match(/^\/api\/organizations\/([^/]+)$/);
  if (match && request.method === "GET") {
    const organization = await organizationForActor(env.DB, actor.id, decodeURIComponent(match[1]));
    if (!organization) return problem(403, "ORGANIZATION_ACCESS_DENIED", "Active membership in this organization is required.");
    return json({ organization: view(organization) });
  }
  return problem(404, "ORGANIZATION_API_NOT_FOUND", "Organization operation not found.");
};
