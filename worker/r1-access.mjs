// R1 access boundary.
//
// WHAT THIS IS FOR
// The deployed application is single-user (one operator, one organization). Before
// this module, single-user mode supplied ATTRIBUTION but not AUTHENTICATION:
// resolveApplicationContext() returned a server-configured actor for every request
// that reached the Worker, and request identity headers were (correctly) ignored.
// The consequence was that any arbitrary network caller who could reach the
// deployment could read and mutate commercial data -- pricing, commercial policy,
// quotation, export -- with no credential at all.
//
// WHAT IT DELIBERATELY IS NOT
// It is not R2 multi-user RBAC. There is one R1 operator and one credential. Role
// resolution, project authority and the library capability gate are unchanged and
// still come from the server-configured application context; this module only
// answers the prior question: "is this caller the R1 operator at all?".
//
// DESIGN CONSTRAINT THAT SHAPED IT
// A bearer token embedded in the browser bundle, in localStorage, or in the API
// client is NOT a server-side access boundary -- it ships to every visitor. So the
// credential is server-side only: the operator types it into a sign-in form, it is
// exchanged once for a signed session cookie, and the token is never persisted in
// the browser. The cookie is HttpOnly (invisible to script), SameSite=Strict, and
// Secure outside local development.
//
// The session is a stateless signed value: `expiresAtMs.hmac`, HMAC-SHA256 over the
// expiry using APP_SESSION_SECRET. No session table, no new migration, no new
// subsystem. Revocation is expiry; logout clears the cookie.

const SESSION_COOKIE = "r1_session";
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h operator session
const SESSION_VERSION = "r1";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Public paths. Liveness/readiness must stay reachable or the platform health
// check cannot run; the sign-in endpoint must be reachable or nobody can ever
// authenticate. Everything else under /api/ requires a valid session.
const PUBLIC_API_PATHS = new Set([
  "/api/health/live",
  "/api/health/ready",
  "/api/auth/login",
]);

const json = (body, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store", ...extraHeaders },
  });

const configured = (value) => String(value || "").trim() || null;
const base64url = (bytes) => Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Constant-time comparison so a caller cannot learn the secret byte-by-byte from
// response timing. Length differences are not hidden (that is unavoidable) but no
// early return short-circuits the comparison itself.
export const constantTimeEqual = (a, b) => {
  const left = Buffer.from(String(a ?? ""));
  const right = Buffer.from(String(b ?? ""));
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
};

const hmacKey = async (secret) =>
  crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);

export const signSessionValue = async (secret, expiresAtMs) => {
  const payload = `${SESSION_VERSION}.${expiresAtMs}`;
  const signature = base64url(await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(payload)));
  return `${expiresAtMs}.${signature}`;
};

export const verifySessionValue = async (secret, value, now = Date.now()) => {
  const raw = String(value || "");
  const separator = raw.indexOf(".");
  if (separator <= 0) return false;
  const expiresAt = Number(raw.slice(0, separator));
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  const expected = await signSessionValue(secret, expiresAt);
  return constantTimeEqual(expected, raw);
};

export const readCookie = (request, name) => {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
};

const localRequest = (request) => LOOPBACK_HOSTS.has(new URL(request.url).hostname);

// The development bypass is the ONLY unauthenticated path, and it must be
// impossible to activate by accident:
//   1. it requires an explicit APP_R1_DEV_AUTH_BYPASS=1;
//   2. it requires APP_ACCESS_MODE=single-user (the R1 deployment mode);
//   3. it additionally requires a loopback request URL, so a Host header alone is
//      not sufficient to reach it from a remote caller;
//   4. readiness FAILS while it is on, so a deployment cannot report ready while
//      unauthenticated (see r1AccessReadiness).
export const devBypassEnabled = (env, request) =>
  configured(env.APP_R1_DEV_AUTH_BYPASS) === "1"
  && configured(env.APP_ACCESS_MODE) === "single-user"
  && localRequest(request);

const bearerToken = (request) => {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
};

/**
 * CSRF / cross-origin write protection.
 * Cookie-backed unsafe requests are the only ones a cross-site page can forge, and
 * a forged request carries the victim's cookie. SameSite=Strict already blocks the
 * common case, but an explicit origin check is the cheap second line:
 *   - if the request declares a cross-site Origin, refuse it;
 *   - if it declares no Origin, fall back to Sec-Fetch-Site, refusing cross-site.
 * A request that authenticates with an explicit bearer token is exempt: a browser
 * will not attach an Authorization header cross-site without a CORS preflight that
 * this Worker never approves.
 */
export const crossOriginWrite = (request) => {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return null;
  if (bearerToken(request)) return null;
  const origin = request.headers.get("origin");
  if (origin) {
    let expected;
    try { expected = new URL(request.url).origin; } catch { expected = null; }
    if (!expected || origin !== expected) return "The request origin does not match this application.";
  } else {
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") return "Cross-site requests are not accepted for state changes.";
  }
  return null;
};

/**
 * The authentication decision. Returns { authenticated, mode } or
 * { authenticated: false, status, code, message }.
 */
export const authenticateR1Request = async (request, env) => {
  const secret = configured(env.APP_SESSION_SECRET);
  const token = configured(env.APP_R1_ACCESS_TOKEN);

  if (devBypassEnabled(env, request)) return { authenticated: true, mode: "development-bypass" };

  if (!secret || !token) {
    // Fail closed. An R1 deployment with no server-side credential configured is
    // not a deployment that may serve commercial data to the network.
    return {
      authenticated: false,
      status: 503,
      code: "R1_ACCESS_NOT_CONFIGURED",
      message: "Server-side R1 access credentials are not configured. Set APP_R1_ACCESS_TOKEN and APP_SESSION_SECRET on the server.",
      mode: "not-configured",
    };
  }

  const presented = bearerToken(request);
  if (presented) {
    return constantTimeEqual(presented, token)
      ? { authenticated: true, mode: "bearer-token" }
      : { authenticated: false, status: 401, code: "R1_ACCESS_DENIED", message: "The supplied access credential is not valid." };
  }

  const cookie = readCookie(request, SESSION_COOKIE);
  if (cookie && (await verifySessionValue(secret, cookie))) return { authenticated: true, mode: "session-cookie" };

  return {
    authenticated: false,
    status: 401,
    code: "R1_AUTHENTICATION_REQUIRED",
    message: "Sign in to access commercial and project data.",
  };
};

const denial = (decision) =>
  json({ authenticated: false, error: { code: decision.code, message: decision.message } }, decision.status, {
    // Never let a shared cache or the browser store a denial or a session response.
    "www-authenticate": decision.status === 401 ? "Session" : undefined,
  });

/**
 * The single dispatch guard. Returns a Response when the request must be stopped,
 * or null to let the normal routing continue.
 */
export const enforceR1Access = async (request, env) => {
  const url = new URL(request.url);
  // Only the API surface is guarded. Static assets and the SPA shell stay open so
  // an unauthenticated visitor can load the sign-in page at all.
  if (!url.pathname.startsWith("/api/")) return null;
  if (PUBLIC_API_PATHS.has(url.pathname)) return null;

  const decision = await authenticateR1Request(request, env);
  if (!decision.authenticated) return denial(decision);

  const csrf = crossOriginWrite(request);
  if (csrf) return json({ authenticated: false, error: { code: "R1_CROSS_SITE_WRITE_REFUSED", message: csrf } }, 403);
  return null;
};

const cookieHeader = (value, maxAgeSeconds, secure) =>
  `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;

/** POST /api/auth/login and POST /api/auth/logout. */
export const handleR1AccessApi = async (request, env) => {
  const url = new URL(request.url);
  if (url.pathname !== "/api/auth/login" && url.pathname !== "/api/auth/logout") return null;
  if (request.method !== "POST") return json({ error: { code: "R1_AUTH_METHOD_NOT_ALLOWED", message: "Use POST." } }, 405);

  const secure = !localRequest(request);

  if (url.pathname === "/api/auth/logout") {
    // A browser form POST navigates, so it is answered with a redirect back to the
    // application root; a fetch/XHR caller gets the JSON body.
    const accepts = String(request.headers.get("accept") || "");
    if (accepts.includes("text/html")) {
      return new Response(null, {
        status: 303,
        headers: { location: "/", "set-cookie": cookieHeader("", 0, secure), "cache-control": "no-store" },
      });
    }
    return json({ authenticated: false, signedOut: true }, 200, { "set-cookie": cookieHeader("", 0, secure) });
  }

  const secret = configured(env.APP_SESSION_SECRET);
  const expectedToken = configured(env.APP_R1_ACCESS_TOKEN);
  if (!secret || !expectedToken) {
    return json({ error: { code: "R1_ACCESS_NOT_CONFIGURED", message: "Server-side R1 access credentials are not configured." } }, 503);
  }

  let presented = bearerToken(request);
  if (!presented) {
    let body = {};
    try { body = await request.json(); } catch { body = {}; }
    presented = configured(body.token) || configured(body.accessToken);
  }
  if (!presented || !constantTimeEqual(presented, expectedToken)) {
    return json({ authenticated: false, error: { code: "R1_ACCESS_DENIED", message: "The supplied access credential is not valid." } }, 401);
  }

  // The session length is fixed server-side. A client-supplied TTL would let a
  // caller mint a longer-lived session than the operator expects.
  const ttl = DEFAULT_SESSION_TTL_MS;
  const value = await signSessionValue(secret, Date.now() + ttl);
  return json(
    { authenticated: true, accessMode: "single-user", expiresAt: new Date(Date.now() + ttl).toISOString(), cookieHttpOnly: true },
    200,
    { "set-cookie": cookieHeader(value, Math.floor(ttl / 1000), secure) },
  );
};

/**
 * Readiness input. The deployment is NOT ready when the only thing standing between
 * the network and commercial data is the development bypass, and never ready when no
 * server-side credential exists at all outside local development.
 */
export const r1AccessReadiness = (env, { local = false } = {}) => {
  const secret = configured(env.APP_SESSION_SECRET);
  const token = configured(env.APP_R1_ACCESS_TOKEN);
  const bypassRequested = configured(env.APP_R1_DEV_AUTH_BYPASS) === "1";
  if (bypassRequested) {
    return { status: "fail", mode: "development-bypass", reason: "APP_R1_DEV_AUTH_BYPASS is enabled. The deployment is unauthenticated and must not be treated as ready." };
  }
  if (!secret || !token) {
    return local
      ? { status: "fail", mode: "not-configured", reason: "APP_R1_ACCESS_TOKEN / APP_SESSION_SECRET are not configured. Local development may set APP_R1_DEV_AUTH_BYPASS=1 explicitly." }
      : { status: "fail", mode: "not-configured", reason: "APP_R1_ACCESS_TOKEN / APP_SESSION_SECRET are not configured. R1 refuses to serve commercial data unauthenticated." };
  }
  return { status: "pass", mode: "session-cookie" };
};

export const R1_SESSION_COOKIE = SESSION_COOKIE;
export const R1_PUBLIC_API_PATHS = PUBLIC_API_PATHS;
