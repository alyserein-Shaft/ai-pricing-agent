// R11 Missions 5+6 -- grouped root-cause analysis of Classification Required
// and the Understanding review queue, using the production resolver + the
// canonical auto-approval policy (pure) so the grouping matches real authority.
import { DatabaseSync } from "node:sqlite";
import { loadUnderstandingReviewRows } from "../../worker/estimator-understanding-review-api.mjs";
import { evaluateUnderstandingSystemAutoApproval } from "../../app/domain/understanding-system-auto-approval.mjs";
import { classifyFireAlarmFamilyFromText } from "../../app/domain/fire-alarm-taxonomy.mjs";

const PROJECT = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";
const DB = process.argv[2];

const sqlite = new DatabaseSync(DB, { readOnly: true });
const wrapper = {
  prepare(sql) {
    const stmt = sqlite.prepare(sql);
    return {
      bind(...params) {
        return {
          all: async () => ({ results: stmt.all(...params) }),
          first: async () => stmt.get(...params) ?? null,
        };
      },
    };
  },
};

const rows = await loadUnderstandingReviewRows(wrapper, PROJECT);
const items = rows.map((r) => ({ row: r, item: null }));

// readiness map from DB
const readiness = await wrapper.prepare(`
  SELECT v.boq_item_id, v.readiness_status, v.status FROM requirement_profile_versions v
  JOIN boq_items b ON b.id=v.boq_item_id WHERE b.project_id=? AND v.superseded_at IS NULL`).bind(PROJECT).all();
const readyByItem = new Map(readiness.results.map((x) => [x.boq_item_id, x]));

const records = [];
for (const r of rows) {
  const interpretation = r.effective?.proposal || null;
  const policy = evaluateUnderstandingSystemAutoApproval({
    rawDescription: r.description,
    boqItemSystemValue: r.sourceSystem,
    interpretation,
    proposalState: r.effective?.state === "AVAILABLE" ? "AVAILABLE" : "UNAVAILABLE",
    classificationBlockers: [],
    taxonomyValid: Boolean(r.effective?.taxonomy?.acceptedCandidate),
  });
  const det = classifyFireAlarmFamilyFromText(r.description);
  const rv = readyByItem.get(r.boqItemId);
  records.push({
    id: r.boqItemId,
    desc: r.description,
    reviewStatus: r.reviewStatus,
    readiness: rv?.readiness_status || null,
    effectiveState: r.effective?.state,
    proposalFamily: interpretation?.productFamily?.value ?? null,
    proposalCategory: interpretation?.category?.value ?? null,
    proposalSystem: interpretation?.system?.value ?? null,
    detFamily: det?.family ?? null,
    detCategory: det?.category ?? null,
    eligible: policy.eligible,
    reasons: policy.reasons,
  });
}

function group(recs) {
  const g = {};
  for (const r of recs) {
    // primary root cause = first substantive reason
    const key = r.reasons.length === 0 ? "ELIGIBLE" :
      (r.reasons.find((x) => x.startsWith("ATTRIBUTE_EXCEEDS_EVIDENCE")) ? "E_AI_PROPOSAL_TOO_RICH" :
       r.reasons.includes("FAMILY_NOT_DETERMINISTICALLY_REPRODUCIBLE") ? "B_FAMILY_NOT_REPRODUCIBLE" :
       r.reasons.includes("SYSTEM_NOT_CONFIRMED_BY_DETERMINISTIC_SECTION_CONTEXT") ? "C_SYSTEM_UNCONFIRMED" :
       r.reasons.includes("POLICY_AMBIGUITY_PRESENT") ? "D_POLICY_AMBIGUITY" :
       r.reasons.includes("TAXONOMY_CANDIDATE_NOT_ACCEPTED") ? "D_TAXONOMY_NOT_ACCEPTED" :
       r.reasons.includes("UNVERIFIED_CLAIM_PRESENT") ? "E_UNVERIFIED_CLAIM" :
       "F_OTHER");
    (g[key] ||= []).push(r);
  }
  return g;
}

const awaiting = records.filter((r) => r.reviewStatus === "AWAITING_REVIEW");
const approved = records.filter((r) => r.reviewStatus === "APPROVED");
const notAnalyzed = records.filter((r) => r.reviewStatus === "NOT_ANALYZED");

console.log("=== UNDERSTANDING QUEUE ROOT CAUSE GROUPS (awaiting review =", awaiting.length, ") ===");
const gA = group(awaiting);
for (const [k, v] of Object.entries(gA).sort((a,b)=>b[1].length-a[1].length)) {
  console.log(`\n  ${k}  -> ${v.length} items`);
  const fams = {};
  for (const r of v) { const key = `${r.detFamily || "no-det"} / proposal:${r.proposalFamily || "none"}`; fams[key]=(fams[key]||0)+1; }
  for (const [f,c] of Object.entries(fams).sort((a,b)=>b[1]-a[1]).slice(0,6)) console.log(`      ${c}x  ${f}`);
}

// key question: how many awaiting have a DETERMINISTIC family equal to the proposal?
const detMatch = awaiting.filter((r) => r.detFamily && r.proposalFamily && r.detFamily === r.proposalFamily);
console.log(`\n=== AWAITING WITH DETERMINISTIC FAMILY MATCHING PROPOSAL: ${detMatch.length} / ${awaiting.length} ===`);
const byReason = {};
for (const r of detMatch) for (const x of r.reasons) byReason[x] = (byReason[x]||0)+1;
for (const [k,v] of Object.entries(byReason).sort((a,b)=>b[1]-a[1])) console.log(`   ${v}x ${k}`);

console.log(`\n=== READINESS x REVIEW STATUS MATRIX ===`);
const matrix = {};
for (const r of records) { const k = `${r.readiness||"(no profile)"} | ${r.reviewStatus}`; matrix[k]=(matrix[k]||0)+1; }
for (const [k,v] of Object.entries(matrix).sort((a,b)=>b[1]-a[1])) console.log(`   ${String(v).padStart(3)}x  ${k}`);

console.log(`\n=== CLASSIFICATION REQUIRED items (readiness) ===`);
const cr = records.filter((r) => r.readiness === "Classification Required");
console.log("   count:", cr.length, " of which reviewStatus APPROVED:", cr.filter(r=>r.reviewStatus==="APPROVED").length);
const crg = group(cr);
for (const [k,v] of Object.entries(crg).sort((a,b)=>b[1].length-a[1].length)) {
  console.log(`   ${k}: ${v.length}`);
  const fams={}; for (const r of v) { const key=`${r.detFamily||"no-det"}/${r.proposalFamily||"none"}`; fams[key]=(fams[key]||0)+1; }
  for (const [f,c] of Object.entries(fams).sort((a,b)=>b[1]-a[1]).slice(0,8)) console.log(`        ${c}x ${f}`);
}

console.log(`\n=== APPROVED (${approved.length}) readiness distribution ===`);
const apr = {}; for (const r of approved) { apr[r.readiness||"(none)"]=(apr[r.readiness||"(none)"]||0)+1; }
console.log("   ", JSON.stringify(apr));

import fs from "node:fs";
fs.writeFileSync(".local-evidence/golden-r11/m56-rootcause.json", JSON.stringify(records, null, 2));
console.log("\nwrote .local-evidence/golden-r11/m56-rootcause.json");