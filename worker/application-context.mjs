const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "terminal.local"]);

const problem = (status, code, message) => ({ status, code, message });

const configuredValue = (value) => String(value || "").trim() || null;

/**
 * Resolve the one server-controlled application identity used by the current MVP.
 * Request identity and role headers are deliberately ignored. Multi-user identity
 * resolution will replace this module when that product phase is authorized.
 */
export const resolveApplicationContext = async (request, env = {}) => {
  const host = new URL(request.url).hostname;
  const local = LOCAL_HOSTS.has(host);
  const mode = configuredValue(env.APP_ACCESS_MODE) || (local ? "single-user" : null);
  if (mode !== "single-user") {
    return {
      error: problem(
        503,
        "APPLICATION_CONTEXT_UNAVAILABLE",
        "The server-side application user context is not configured.",
      ),
    };
  }

  const userId = configuredValue(env.APP_USER_ID)
    || configuredValue(env.LOCAL_DEVELOPMENT_USER_ID)
    || (local ? "local-development-user" : null);
  const organizationId = configuredValue(env.APP_ORGANIZATION_ID)
    || (local ? "organization_bd_shaft_internal_pilot" : null);
  if (!userId || !organizationId) {
    return {
      error: problem(
        503,
        "APPLICATION_CONTEXT_INCOMPLETE",
        "The application user and organization must be configured by the server.",
      ),
    };
  }

  const email = configuredValue(env.APP_USER_EMAIL)
    || configuredValue(env.LOCAL_DEVELOPMENT_USER_EMAIL)
    || (local ? "local@development.invalid" : null);
  const fullName = configuredValue(env.APP_USER_NAME)
    || configuredValue(env.LOCAL_DEVELOPMENT_USER_NAME)
    || (local ? "Local Development User" : null);

  return {
    context: Object.freeze({
      userId,
      organizationId,
      email,
      fullName,
      mode: "single-user",
      accessMode: "single-user",
      fullAccess: true,
      authenticationSource: "Server-configured Single User",
    }),
  };
};

export const applicationActor = (context, role = "Administrator") => ({
  id: context.userId,
  email: context.email,
  fullName: context.fullName,
  organizationId: context.organizationId,
  permission: role,
  role,
  fullAccess: true,
  accessMode: context.accessMode,
  authenticationSource: context.authenticationSource,
});
