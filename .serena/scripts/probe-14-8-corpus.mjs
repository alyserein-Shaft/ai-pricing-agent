// STEP 14.8 -- fixture probe: does the real golden corpus reproduce the live
// pending/approved inventory exactly (21 pending, 12 unique)? Diagnostic only.
import { makeArchDb, seedRealSheet, seedRealT00Legend, seedArchDocument, apiArchRequest, archInitializePath, archConfirmPath, archReviewPath, archAdjudicateEvaluatePath } from "../tests/fixtures/drawing-architecture-fixture.mjs";

const PROJECT = "proj-1";
const { raw, db } = makeArchDb(PROJECT);
const run = (path, { method = "POST", body } = {}) => apiArchRequest(path, { method, body })({ DB: db });

// T-00 governed legend authority (register target for every DR-less citation).
seedArchDocument({
  raw, projectId: PROJECT, documentId: "doc-t00-real",
  drawingNumber: "2401232- PC- AMS- DR- T-00-ZZZ-002",
  sheetName: "ELV LEGENDS, NOTES AND ABBREVIATIONS",
});
seedRealT00Legend({ raw, projectId: PROJECT, documentId: "doc-t00-real" });

// Every evidence-bearing corpus sheet verbatim.
const keys = [
  ["AMS_NET", "doc-ams-net"], ["KGS_005", "doc-kgs-005"], ["AMS_002", "doc-ams-002"],
  ["SHEET_2401232_PC_WLC_DR_T_93_ZZZ_005", "doc-wlc-93"], ["SHEET_2401232_PC_GRS_DR_T_93_ZZZ_005", "doc-grs-93"], ["SHEET_2401232_PC_BOS_DR_T_93_ZZZ_005", "doc-bos-93"],
  ["SHEET_2401232_PC_BOS_DR_T_94_ZZZ_001", "doc-bos-94"], ["SHEET_2401232_PC_AMS_DR_T_94_ZZZ_001", "doc-ams-94"], ["SHEET_2401232_PC_GRS_DR_T_94_ZZZ_001", "doc-grs-94"],
  ["SHEET_2401232_PC_WLC_DR_T_94_ZZZ_001", "doc-wlc-94"], ["SHEET_2401232_PC_KGS_DR_T_91_ZZZ_002", "doc-kgs-91"],
];
for (const [key, docId] of keys) seedRealSheet({ raw, projectId: PROJECT, sheetKey: key, documentId: docId, intakeId: `intake-${docId}` });

const init = await run(archInitializePath(PROJECT));
console.log("initialize:", init.status, "documents=", init.body.documents, "total=", init.body.total);

const confirm = await run(archConfirmPath(PROJECT));
console.log("confirm:", confirm.status, "promotion=", confirm.body.promotion);

const review = await run(archReviewPath(PROJECT), { method: "GET" });
const byStatus = review.body.cases.reduce((m, c) => { m[c.status] = (m[c.status] || 0) + 1; return m; }, {});
console.log("review statuses:", JSON.stringify(byStatus));
const byType = review.body.cases.reduce((m, c) => { m[`${c.status}|${c.factType}`] = (m[`${c.status}|${c.factType}`] || 0) + 1; return m; }, {});
console.log("status|factType:", JSON.stringify(byType, null, 1));
const pending = review.body.cases.filter((c) => c.status === "Needs Review");
console.log("pending samples:");
for (const c of pending.slice(0, 30)) console.log(`  ${c.factType} | ${c.subject} | ${c.sourceDrawingNumber} | ${c.object ?? ""}`);

const adj = await run(archAdjudicateEvaluatePath(PROJECT));
console.log("adjudicate dry-run:", adj.status);
console.log("  counts:", JSON.stringify(adj.body.inventory?.counts ?? adj.body.counts));
console.log("  status:", JSON.stringify(adj.body.status));
console.log("  adjudications:", (adj.body.adjudications || []).map((a) => `${a.exceptionType}|${a.exceptionKey}|${a.decision?.decisionState}`).join("\n    "));