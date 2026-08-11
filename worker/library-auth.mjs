import { applicationActor, resolveApplicationContext } from "./application-context.mjs";
const PERMISSION_RANK = Object.freeze({
  "Library Viewer": 10,
  "Library Reviewer": 20,
  "Library Manager": 30,
  Administrator: 40,
});

export const LIBRARY_CAPABILITIES = Object.freeze({
  read: "Library Viewer",
  analyze: "Library Reviewer",
  review: "Library Reviewer",
  approve: "Library Manager",
  apply: "Library Manager",
  reverse: "Library Manager",
});

const problem = (status, code, message) => ({ status, code, message });

export const hasLibraryCapability = (permission, capability) =>
  Number(PERMISSION_RANK[permission] || 0) >= Number(PERMISSION_RANK[LIBRARY_CAPABILITIES[capability]] || Infinity);

export const authenticateLibraryActor = async (request, env) => {
  if (!env.DB) return { error: problem(503, "AUTHORIZATION_STORAGE_UNAVAILABLE", "Library authorization storage is unavailable.") };
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return resolved;
  return { actor: applicationActor(resolved.context), applicationContext: resolved.context };
};

export const requireLibraryCapability = (actor, capability) => actor?.fullAccess || hasLibraryCapability(actor?.permission || actor?.role, capability)
  ? null
  : problem(403, "LIBRARY_PERMISSION_DENIED", `The ${LIBRARY_CAPABILITIES[capability]} permission is required for this operation.`);
