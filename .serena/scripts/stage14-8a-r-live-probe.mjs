// STEP 14.8 -- LIVE PHASE PROBE (governed adjudication write on the real D1).
// Order: live dry-run (read-only) -> apply (write 12 adjudications, approve 12
// primary cases, promote v2=128, readiness COMPLETE/READY) -> verify ->
// idempotency re-apply (no-op) -> final verify.
import { openLiveDb, liveRequest, LIVE_PROJECT } from "./stage14-8a-r-live-driver.mjs";

const { raw, db } = openLiveDb();

const summary = (label, res, pick) => {
  console.log(`\n=== ${label} ===`);
  console.log("status:", res.status);
  if (pick) console.log(JSON.stringify(pick(res.body), null, 1));
};

// ---------------------------------------------------------------- dry-run ---
summary("LIVE adjudication dry-run (evaluate)", await liveRequest("/api/projects/:projectId/drawing-architecture/adjudication/evaluate")({ DB: db }), (b) => ({
  operation: b.operation,
  dryRun: b.dryRun,
  counts: b.inventory?.counts ?? b.counts,
  statusBefore: b.status?.before,
  statusAfter: b.status?.after,
  adjudications: (b.adjudications || []).map((a) => `${a.exceptionType}|${a.decision?.decisionState}|${a.sourceDrawingNumber ?? ""}|${a.referencedDrawingNumber ?? a.buildingCode ?? ""}`),
}));

// --------------------------------------------------------------- live apply ---
const apply1 = await liveRequest("/api/projects/:projectId/drawing-architecture/adjudication/apply")({ DB: db });
summary("LIVE adjudication apply #1", apply1, (b) => ({
  operation: b.operation,
  persistence: b.persistence,
  promotion: b.promotion,
  statusAfter: b.status?.after,
}));

// ---------------------------------------------------------------- verify -----
const current = await liveRequest("/api/projects/:projectId/drawing-architecture/adjudication/current", LIVE_PROJECT, { method: "GET" })({ DB: db });
summary("LIVE adjudication current", current, (b) => ({
  rows: b.adjudications?.length,
  states: (b.adjudications || []).reduce((m, a) => { m[a.decisionState] = (m[a.decisionState] || 0) + 1; return m; }, {}),
  types: (b.adjudications || []).reduce((m, a) => { m[a.exceptionType] = (m[a.exceptionType] || 0) + 1; return m; }, {}),
  facpTargets: (b.adjudications || []).filter((a) => a.exceptionType === "GENERIC_FACP_IDENTITY").map((a) => a.canonicalBuildingAssetCode).sort(),
  readiness: b.readiness?.map((r) => ({ status: r.architecture_status, stage4: r.stage4_readiness, unique: r.unique_exception_count, resolved: r.resolved_count, mirrored: r.mirrored_discrepancy_resolved, nextRows: r.approved_next_row_count, nextVersion: r.approved_next_version_number })),
}));

const approved = await liveRequest("/api/projects/:projectId/drawing-architecture/approved/current", LIVE_PROJECT, { method: "GET" })({ DB: db });
summary("LIVE approved current", approved, (b) => ({ version: b.current?.version, approvedRows: b.current?.approvedRows?.length }));

const readiness = await liveRequest("/api/projects/:projectId/drawing-architecture/readiness", LIVE_PROJECT, { method: "GET" })({ DB: db });
summary("LIVE readiness current", readiness, (b) => ({ status: b.status && { architecture_status: b.status.architecture_status, stage4_readiness: b.status.stage4_readiness }, pendingCaseCount: b.pendingCaseCount, currentApprovedVersion: b.currentApprovedVersion?.version }));

// ------------------------------------------------------- idempotent re-run ---
const apply2 = await liveRequest("/api/projects/:projectId/drawing-architecture/adjudication/apply")({ DB: db });
summary("LIVE adjudication apply #2 (idempotency)", apply2, (b) => ({
  operation: b.operation,
  persistence: b.persistence,
  promotion: b.promotion,
  statusAfter: b.status?.after,
}));

// ------------------------------------------------------------- row counts ---
const counts = {
  adjudicationRows: raw.prepare("SELECT count(*) n FROM drawing_architecture_exception_adjudications").get().n,
  activeAdjudicationRows: raw.prepare("SELECT count(*) n FROM drawing_architecture_exception_adjudications WHERE superseded_at IS NULL").get().n,
  readinessRows: raw.prepare("SELECT count(*) n FROM drawing_architecture_stage4_readiness").get().n,
  approvedVersions: raw.prepare("SELECT count(*) n FROM drawing_architecture_approved_versions").get().n,
  approvedVersionNumbers: raw.prepare("SELECT version_number, superseded_at FROM drawing_architecture_approved_versions ORDER BY version_number").all().map((r) => `${r.version_number}${r.superseded_at ? "·superseded" : "·active"}`),
  pendingReviewCases: raw.prepare("SELECT count(*) n FROM drawing_architecture_review_cases WHERE status='Needs Review'").get().n,
  approvedReviewCases: raw.prepare("SELECT count(*) n FROM drawing_architecture_review_cases WHERE status='Approved'").get().n,
};
console.log("\n=== LIVE row counts ===");
console.log(JSON.stringify(counts, null, 1));