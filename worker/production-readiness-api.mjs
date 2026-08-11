import { APPLICATION_VERSION, MIGRATION_VERSION, READINESS_REQUIRED_TABLES } from "../app/domain/production-readiness.mjs";

const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const checkDatabase = async (db) => { if (!db) return { status: "fail", reason: "DB binding missing" }; try { await db.prepare("SELECT 1 AS ok").first(); const rows = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${READINESS_REQUIRED_TABLES.map(() => "?").join(",")})`).bind(...READINESS_REQUIRED_TABLES).all(), present = new Set((rows.results || []).map((row) => row.name)), missing = READINESS_REQUIRED_TABLES.filter((table) => !present.has(table)); return { status: missing.length ? "fail" : "pass", required: READINESS_REQUIRED_TABLES.length, present: present.size, missing }; } catch (error) { return { status: "fail", reason: String(error).slice(0, 300) }; } };

export const handleProductionReadinessApi = async (request, env) => {
  const url = new URL(request.url); if (!url.pathname.startsWith("/api/health/")) return null;
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID(), checkedAt = new Date().toISOString();
  if (url.pathname === "/api/health/live") return response({ status: "pass", service: "ai-pricing-agent", applicationVersion: APPLICATION_VERSION, checkedAt, requestId });
  if (url.pathname === "/api/health/ready") { const database = await checkDatabase(env.DB), storage = env.FILES ? { status: "configured" } : { status: "fail", reason: "FILES binding missing" }, status = database.status === "pass" && storage.status === "configured" ? "pass" : "fail"; return response({ status, applicationVersion: APPLICATION_VERSION, migrationVersion: MIGRATION_VERSION, dependencies: { database, storage }, checkedAt, requestId }, status === "pass" ? 200 : 503); }
  return response({ status: "fail", code: "HEALTH_ROUTE_NOT_FOUND", requestId }, 404);
};

