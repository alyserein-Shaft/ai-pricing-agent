export const LIBRARY_SCOPES = Object.freeze(["Global Library", "Organization Library", "Project Library"]);

const scope = (libraryScope, organizationId = null, projectId = null) => ({ libraryScope, organizationId, projectId });
export const scopeProblem = (status, code, message, details = {}) => ({ status, code, message, details });

export const productScope = (product) => {
  const value = scope(product?.library_scope, product?.organization_id || null, product?.library_project_id || null);
  if (!LIBRARY_SCOPES.includes(value.libraryScope)) return { error: scopeProblem(409, "PRODUCT_SCOPE_MISMATCH", "Product library scope is missing or invalid.", { productId: product?.id }) };
  if (value.libraryScope === "Global Library" && (value.organizationId || value.projectId)) return { error: scopeProblem(409, "PRODUCT_SCOPE_MISMATCH", "Global products cannot carry organization or project ownership.", { productId: product.id }) };
  if (value.libraryScope === "Organization Library" && (!value.organizationId || value.projectId)) return { error: scopeProblem(409, "PRODUCT_SCOPE_MISMATCH", "Organization products require one organization and no project owner.", { productId: product.id }) };
  if (value.libraryScope === "Project Library" && !value.projectId) return { error: scopeProblem(409, "PRODUCT_SCOPE_MISMATCH", "Project products require an owning project.", { productId: product.id }) };
  return { scope: value };
};

export const resolvePairScope = (products) => {
  if (!Array.isArray(products) || products.length !== 2) return { error: scopeProblem(409, "PRODUCT_SCOPE_MISMATCH", "Exactly two scoped products are required.") };
  const values = products.map(productScope);
  if (values.some((entry) => entry.error)) return { error: values.find((entry) => entry.error).error };
  const [left, right] = values.map((entry) => entry.scope);
  const same = left.libraryScope === right.libraryScope && left.organizationId === right.organizationId && left.projectId === right.projectId;
  if (!same) return { error: scopeProblem(409, "IDENTITY_SCOPE_CONFLICT", "Products in different library ownership scopes cannot resolve as one identity without an approved promotion.", { left, right }) };
  return { scope: left };
};

export const actorCanAccessScope = async (db, actor, resolvedScope) => {
  if (!resolvedScope || !LIBRARY_SCOPES.includes(resolvedScope.libraryScope)) return scopeProblem(503, "ORGANIZATION_AUTHORIZATION_UNAVAILABLE", "Library scope authorization is unavailable.");
  if (resolvedScope.libraryScope === "Global Library") return null;
  if (resolvedScope.libraryScope === "Organization Library") {
    const member = await db.prepare("SELECT id FROM organization_memberships WHERE organization_id=? AND user_id=? AND status='Active' AND revoked_at IS NULL").bind(resolvedScope.organizationId, actor.id).first();
    return member ? null : scopeProblem(403, "ORGANIZATION_ACCESS_DENIED", "Active membership in the owning organization is required.");
  }
  const project = await db.prepare("SELECT id,organization_id,owner_user_id FROM projects WHERE id=?").bind(resolvedScope.projectId).first();
  if (!project) return scopeProblem(503, "ORGANIZATION_AUTHORIZATION_UNAVAILABLE", "The owning project cannot be resolved.");
  const member = project.owner_user_id === actor.id ? { id: project.id } : await db.prepare("SELECT id FROM project_members WHERE project_id=? AND user_id=? AND status='Active' AND revoked_at IS NULL").bind(project.id, actor.id).first();
  if (!member) return scopeProblem(403, "LIBRARY_SCOPE_DENIED", "Access to the owning project is required.");
  if (project.organization_id) {
    const organizationMember = await db.prepare("SELECT id FROM organization_memberships WHERE organization_id=? AND user_id=? AND status='Active' AND revoked_at IS NULL").bind(project.organization_id, actor.id).first();
    if (!organizationMember) return scopeProblem(403, "ORGANIZATION_ACCESS_DENIED", "Active membership in the project's organization is required.");
  }
  return null;
};

export const storedScope = (record) => scope(record?.library_scope, record?.organization_id || null, record?.library_project_id || null);
export const sameScope = (left, right) => left?.libraryScope === right?.libraryScope && (left?.organizationId || null) === (right?.organizationId || null) && (left?.projectId || null) === (right?.projectId || null);
