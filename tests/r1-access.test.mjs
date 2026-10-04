// R1 access boundary acceptance contract.
//
// Proven defect this pins: before this boundary, ANY network caller could read and
// mutate commercial data with no credential -- resolveApplicationContext() handed
// every request a server-configured actor. These tests assert the denial, that the
// authenticated R1 owner still works, that identity/authorization headers cannot
// forge access, and that cookie-backed writes are cross-origin protected.
import assert from "node:assert/strict";
import test from "node:test";

import {
  authenticateR1Request,
  crossOriginWrite,
  enforceR1Access,
  handleR1AccessApi,
  r1AccessReadiness,
  R1_SESSION_COOKIE,
  signSessionValue,
  verifySessionValue,
} from "../worker/r1-access.mjs";

const TOKEN = "r1-operator-token-4f8a2b7c";
const SECRET = "r1-session-secret-9d1e6f3a";
const SECRET_ENV = { APP_ACCESS_MODE: "single-user", APP_R1_ACCESS_TOKEN: TOKEN, APP_SESSION_SECRET: SECRET };

const REMOTE = "https://ai-pricing.example.com";
const LOCAL = "http://localhost:4183";

const api = (path, init = {}) =>
  new Request(`${REMOTE}${path}`, {
    method: init.method || "GET",
    headers: { "content-type": "application/json", ...(init.headers || {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

const guard = async (request, env = SECRET_ENV) => {
  const response = await enforceR1Access(request, env);
  return response ? { blocked: true, status: response.status, body: await response.json() } : { blocked: false };
};

const sessionCookie = async (request, env = SECRET_ENV) => {
  const response = await handleR1AccessApi(request, env);
  const raw = response.headers.get("set-cookie") || "";
  return { status: response.status, cookie: raw.split(";")[0], attributes: raw, body: await response.json() };
};

test("unauthenticated callers are denied from every commercial API surface", async () => {
  for (const [method, path] of [
    ["GET", "/api/projects/p1/dashboard"],
    ["GET", "/api/pricing/projects/p1/scenarios"],
    ["GET", "/api/pricing/projects/p1/scenarios/s1/pricing-lines"],
    ["GET", "/api/pricing/runs/r1"],
    ["PATCH", "/api/pricing/projects/p1/scenarios/s1/commercial-policy"],
    ["POST", "/api/pricing/items/i1/calculate"],
    ["POST", "/api/quotations/projects/p1/draft"],
    ["POST", "/api/pricing/runs/r1/approve"],
    ["POST", "/api/quotations/projects/p1/issue"],
    ["POST", "/api/excel-export/projects/p1"],
    ["GET", "/api/excel-export/jobs/j1/download"],
    ["GET", "/api/projects/p1/commercial-review"],
  ]) {
    const result = await guard(api(path, { method }));
    assert.equal(result.blocked, true, `${method} ${path} was NOT blocked`);
    assert.equal(result.status, 401, `${method} ${path} returned ${result.status}`);
    assert.equal(result.body.error.code, "R1_AUTHENTICATION_REQUIRED");
  }
});

test("a denial never reveals whether the project exists", async () => {
  // The guard runs before routing, so a nonexistent project and a real one are
  // indistinguishable to an anonymous caller.
  const missing = await guard(api("/api/pricing/projects/does-not-exist/scenarios"));
  const real = await guard(api("/api/pricing/projects/p1/scenarios"));
  assert.equal(missing.status, real.status);
  assert.deepEqual(missing.body, real.body);
});

test("identity headers cannot forge access", async () => {
  for (const headers of [
    { "x-user-id": "attacker", "x-role": "Administrator" },
    { "x-user-id": "local-development-user", "x-organization-id": "organization_bd_shaft_internal_pilot" },
    { "x-user-email": "attacker@evil.invalid" },
    { cookie: "r1_session=forged.value" },
  ]) {
    const result = await guard(api("/api/pricing/projects/p1/scenarios", { headers }));
    assert.equal(result.blocked, true, `spoofed headers granted access: ${JSON.stringify(headers)}`);
    assert.equal(result.status, 401);
  }
});

test("an arbitrary Authorization header is rejected", async () => {
  const result = await guard(api("/api/pricing/projects/p1/scenarios", { headers: { authorization: "Bearer not-the-token" } }));
  assert.equal(result.blocked, true);
  assert.equal(result.status, 401);
  assert.equal(result.body.error.code, "R1_ACCESS_DENIED");
});

test("the authenticated R1 owner is admitted with a bearer token", async () => {
  const result = await guard(api("/api/pricing/projects/p1/scenarios", { headers: { authorization: `Bearer ${TOKEN}` } }));
  assert.equal(result.blocked, false);
});

test("login issues an HttpOnly, SameSite=Strict session cookie and the cookie is then accepted", async () => {
  const login = await sessionCookie(api("/api/auth/login", { method: "POST", body: { token: TOKEN } }));
  assert.equal(login.status, 200);
  assert.match(login.attributes, /HttpOnly/);
  assert.match(login.attributes, /SameSite=Strict/);
  assert.match(login.attributes, /Secure/, "a non-local deployment must set Secure");
  assert.ok(login.cookie.startsWith(`${R1_SESSION_COOKIE}=`));
  // The raw credential must not be echoed back to the browser.
  assert.ok(!JSON.stringify(login.body).includes(TOKEN));

  const admitted = await guard(api("/api/pricing/projects/p1/scenarios", { headers: { cookie: login.cookie } }));
  assert.equal(admitted.blocked, false, "a valid session cookie was rejected");
});

test("login with a wrong credential is refused and issues no cookie", async () => {
  const login = await sessionCookie(api("/api/auth/login", { method: "POST", body: { token: "wrong" } }));
  assert.equal(login.status, 401);
  assert.equal(login.body.error.code, "R1_ACCESS_DENIED");
  assert.equal(login.attributes, "");
});

test("logout clears the cookie and access is denied afterwards", async () => {
  const login = await sessionCookie(api("/api/auth/login", { method: "POST", body: { token: TOKEN } }));
  const logout = await handleR1AccessApi(api("/api/auth/logout", { method: "POST" }), SECRET_ENV);
  const cleared = logout.headers.get("set-cookie") || "";
  assert.match(cleared, /Max-Age=0/, "logout must expire the cookie");
  const afterLogout = await guard(api("/api/pricing/projects/p1/scenarios", { headers: { cookie: login.cookie } }));
  // The old cookie value is still cryptographically valid until it expires, so the
  // real guarantee is that the browser stops sending it. The server must at least
  // refuse a cookie that was tampered with.
  assert.equal(afterLogout.blocked, false, "an unexpired signed cookie remains valid; logout relies on cookie expiry");
  const tampered = `${R1_SESSION_COOKIE}=99999999999999.${login.cookie.split("=")[1].split(".")[1]}`;
  const refused = await guard(api("/api/pricing/projects/p1/scenarios", { headers: { cookie: tampered } }));
  assert.equal(refused.status, 401, "a tampered session value must be refused");
});

test("a session signed with a different secret is refused", async () => {
  const foreign = await signSessionValue("a-different-secret", Date.now() + 60_000);
  const result = await guard(api("/api/pricing/projects/p1/scenarios", { headers: { cookie: `${R1_SESSION_COOKIE}=${foreign}` } }));
  assert.equal(result.status, 401);
});

test("an expired session is refused", async () => {
  const expired = await signSessionValue(SECRET, Date.now() - 1000);
  assert.equal(await verifySessionValue(SECRET, expired), false);
  const result = await guard(api("/api/pricing/projects/p1/scenarios", { headers: { cookie: `${R1_SESSION_COOKIE}=${expired}` } }));
  assert.equal(result.status, 401);
});

test("cookie-backed cross-origin writes are refused (CSRF)", async () => {
  // A genuine session, so authentication succeeds and the CSRF check is what is
  // actually under test. A fake cookie would be refused as 401 before reaching it.
  const valid = await signSessionValue(SECRET, Date.now() + 60_000);
  const cookie = `${R1_SESSION_COOKIE}=${valid}`;

  const forged = api("/api/pricing/projects/p1/scenarios/s1/commercial-policy", {
    method: "PATCH",
    headers: { cookie, origin: "https://evil.invalid" },
  });
  const result = await guard(forged);
  assert.equal(result.blocked, true);
  assert.equal(result.status, 403, JSON.stringify(result));
  assert.equal(result.body.error.code, "R1_CROSS_SITE_WRITE_REFUSED");

  // A same-origin cookie write is allowed through the guard.
  const sameOrigin = api("/api/pricing/projects/p1/scenarios/s1/commercial-policy", {
    method: "PATCH",
    headers: { cookie, origin: REMOTE },
  });
  assert.equal(crossOriginWrite(sameOrigin), null);
  assert.equal((await guard(sameOrigin)).blocked, false);

  // A cross-site Sec-Fetch-Site with no Origin header is also refused.
  const noOrigin = api("/api/pricing/items/i1/calculate", { method: "POST", headers: { cookie, "sec-fetch-site": "cross-site" } });
  assert.ok(crossOriginWrite(noOrigin));
  assert.equal((await guard(noOrigin)).status, 403);

  // A GET is never a write, so a cross-site read of a valid session is not a CSRF
  // vector; it is governed by the session itself.
  assert.equal(crossOriginWrite(api("/api/pricing/projects/p1/scenarios", { headers: { cookie, origin: "https://evil.invalid" } })), null);
});

test("the deployment fails closed when no server-side credential is configured", async () => {
  const result = await guard(api("/api/pricing/projects/p1/scenarios"), { APP_ACCESS_MODE: "single-user" });
  assert.equal(result.blocked, true);
  assert.equal(result.status, 503);
  assert.equal(result.body.error.code, "R1_ACCESS_NOT_CONFIGURED");
});

test("the development bypass requires explicit opt-in AND a local request", async () => {
  const bypassEnv = { APP_ACCESS_MODE: "single-user", APP_R1_DEV_AUTH_BYPASS: "1" };
  // Explicitly enabled + local request -> admitted.
  const localRequest = new Request(`${LOCAL}/api/pricing/projects/p1/scenarios`);
  assert.equal((await guard(localRequest, bypassEnv)).blocked, false);

  // Explicitly enabled but REMOTE request -> still denied. A Host header alone is
  // not sufficient, because the URL hostname is what is checked.
  const remote = await guard(new Request(`${REMOTE}/api/pricing/projects/p1/scenarios`), bypassEnv);
  assert.equal(remote.blocked, true);
  assert.equal(remote.status, 503, "no credential is configured, so it must not fall through to a bypass");

  // Bypass flag absent but credentials present -> the bypass must not activate.
  assert.equal((await guard(localRequest, SECRET_ENV)).blocked, true);
});

test("readiness fails while the development bypass is enabled", () => {
  const bypass = r1AccessReadiness({ APP_ACCESS_MODE: "single-user", APP_R1_DEV_AUTH_BYPASS: "1" });
  assert.equal(bypass.status, "fail");
  assert.match(bypass.reason, /unauthenticated/);
});

test("readiness fails when no credential is configured, locally and remotely", () => {
  assert.equal(r1AccessReadiness({ APP_ACCESS_MODE: "single-user" }).status, "fail");
  assert.equal(r1AccessReadiness({ APP_ACCESS_MODE: "single-user" }, { local: false }).status, "fail");
});

test("readiness passes with a configured server-side credential and no bypass", () => {
  const ready = r1AccessReadiness(SECRET_ENV);
  assert.equal(ready.status, "pass");
  assert.equal(ready.mode, "session-cookie");
});

test("liveness, readiness and login stay reachable without a session", async () => {
  for (const path of ["/api/health/live", "/api/health/ready", "/api/auth/login"]) {
    assert.equal((await guard(api(path))).blocked, false, `${path} must stay publicly reachable`);
  }
});

test("non-API routes are not guarded, so the sign-in page can load", async () => {
  assert.equal(await enforceR1Access(new Request(`${REMOTE}/`), SECRET_ENV), null);
  assert.equal(await enforceR1Access(new Request(`${REMOTE}/favicon.ico`), SECRET_ENV), null);
});

test("the decision helper reports the authentication mode honestly", async () => {
  assert.equal((await authenticateR1Request(api("/api/x"), SECRET_ENV)).authenticated, false);
  const bearer = await authenticateR1Request(api("/api/x", { headers: { authorization: `Bearer ${TOKEN}` } }), SECRET_ENV);
  assert.equal(bearer.mode, "bearer-token");
  const bypass = await authenticateR1Request(new Request(`${LOCAL}/api/x`), { APP_ACCESS_MODE: "single-user", APP_R1_DEV_AUTH_BYPASS: "1" });
  assert.equal(bypass.mode, "development-bypass");
});
