// Scoped confirmation of Omair's already-approved T applicability decision.
//
// Confirms EXACTLY the four current field sheets he named, one case at a time,
// through the scoped route. It never touches S/H, the legend-sheet T case, or any
// panel/loop/NAC/interface fact. The dev server intermittently 500s while other
// lanes edit, so each call is retried within a bounded window; a case that never
// gets a JSON answer is reported as unconfirmed rather than assumed.

const BASE = "http://localhost:4183";
const PROJECT_ID = "project_29b4c399-2453-4a53-96c6-0434e15f13bb";

const TARGET_CASES = [
  { caseId: "architectureCase_f6a02d15-63d9-43e9-a207-30db1d03da8c", sheet: "2401232-PC-BOS-DR-T-93-ZZZ-005" },
  { caseId: "architectureCase_6e45cb7e-b6e5-4f93-b99b-53fd761f94d3", sheet: "2401232-PC-GRS-DR-T-93-ZZZ-005" },
  { caseId: "architectureCase_4e6750ef-e805-4efd-8e61-626855588857", sheet: "2401232-PC-KGS-DR-T-93-ZZZ-005" },
  { caseId: "architectureCase_478cd3b7-a332-4c92-9e54-1e059c580b01", sheet: "2401232-PC-WLC-DR-T-93-ZZZ-005" },
];

const REASON = "Omair approved T = FIREMAN TELEPHONE JACK applicability on this current T-93 field sheet: governed current AMS legend definition plus this sheet's own explicit LEGEND_FOR cross-sheet reference resolved through governed drawing numbers.";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const postCase = async (caseId) => {
  const response = await fetch(`${BASE}/api/projects/${PROJECT_ID}/drawing-architecture/review/confirm-case`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ caseId, reason: REASON }),
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: null, html: text.slice(0, 80) };
  }
};

const results = [];
for (const target of TARGET_CASES) {
  let outcome = null;
  for (let attempt = 1; attempt <= 12 && !outcome; attempt += 1) {
    const attemptResult = await postCase(target.caseId).catch((error) => ({ status: 0, body: null, html: String(error?.message ?? error).slice(0, 80) }));
    if (attemptResult.body) {
      outcome = { ...attemptResult, attempt };
      break;
    }
    await sleep(8000);
  }
  const confirmed = outcome?.body?.status === "Approved";
  results.push({ sheet: target.sheet, caseId: target.caseId, confirmed, httpStatus: outcome?.status ?? null, decisionState: outcome?.body?.decisionState ?? null, confirmedBy: outcome?.body?.confirmedBy ?? null, idempotent: outcome?.body?.idempotent ?? null, promotionRows: outcome?.body?.promotion?.approvedRows ?? null, error: outcome?.body?.error?.code ?? (outcome ? null : "NO_JSON_RESPONSE_AFTER_RETRIES"), attempts: outcome?.attempt ?? 12 });
  console.log(`${confirmed ? "CONFIRMED" : "NOT_CONFIRMED"} ${target.sheet} | http ${outcome?.status ?? "-"} | ${outcome?.body?.decisionState ?? outcome?.body?.error?.code ?? "no json"} | by ${outcome?.body?.confirmedBy ?? "-"} | rows ${outcome?.body?.promotion?.approvedRows ?? "-"}`);
}

console.log(`\nSCOPED_T_CONFIRMED = ${results.filter((r) => r.confirmed).length} / ${results.length}`);
console.log(`UNCONFIRMED = ${results.filter((r) => !r.confirmed).map((r) => `${r.sheet} (${r.error})`).join(", ") || "none"}`);
