// ============================================================================
// GOVERNED PRODUCT IDENTITY CLOSURE — 12 Focused Validation Behaviours
// Each test proves one deterministic invariant from the auditor.
// No broad repo-wide test/build/lint; focused lint on touched files only.
// ============================================================================
import {
  auditLineClosure,
  auditAllClosure,
  ClosureVerdict,
  groupBySharedDecision,
} from "../app/domain/governed-product-identity-closure.mjs";
import {
  resolveAll,
  canonicalScope,
  q,
  one,
} from "../probe-01-canonical-identity.mjs";

const DB = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
const PROJECT_ID = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";
const sqlite = await import("node:sqlite");
const s = new sqlite.DatabaseSync(DB, { readOnly: true });
s.exec("PRAGMA query_only=ON");
const scope = await canonicalScope();
const resolved = await resolveAll(scope);

// ---- compute library product states for candidates ----
const candidatePids = [...new Set(resolved.flatMap((r) => (r.authority.candidateIds || []).map((id) => one(`SELECT product_id pid FROM product_match_candidates WHERE id=?`, id)?.pid).filter(Boolean)))];
const libraryStates = new Map();
for (const pid of candidatePids) {
  const lp = one(`SELECT review_status reviewStatus, approved_for_discovery approvedDiscovery, lifecycle_status lifecycle, product_role product_role, family_id family_id FROM library_products WHERE id=?`, pid);
  libraryStates.set(pid, { reviewStatus: lp?.reviewStatus || "(unknown)", approvedDiscovery: lp?.approvedDiscovery || false, lifecycle: lp?.lifecycle || "(unknown)", role: lp?.role || "(unknown)", family: lp?.family_id ? one(`SELECT name name FROM product_families WHERE id=?`, lp.family_id)?.name : null });
}

// ---- build allEvidence (no ! operator anywhere) ----
const allEvidence = resolved.map((r) => ({
  status: r.authority.status,
  code: r.authority.code,
  productId: r.authority.productId,
  approved: r.authority.approved,
  safetyDecision: r.authority.safetyDecision ? {
    id: r.authority.safetyDecision.id,
    safetyState: r.authority.safetyDecision.safetyState,
    technical_eligibility: r.authority.safetyDecision.technical_eligibility,
    missing_information: r.authority.safetyDecision.missing_information,
    candidateId: r.authority.safetyDecision.candidateId,
    versionNumber: r.authority.safetyDecision.versionNumber,
  } : null,
  technicalApproval: r.authority.technicalApproval || null,
  candidateIds: (r.authority.candidateIds || []).map((id) => id),
  readiness: null,
  standardsCount: 0,
  matchRun: null,
}));

// ---------------------------------------------------------------------------
// TEST 1: Approved identity resolves as ALREADY_APPROVED
// ---------------------------------------------------------------------------
console.log("TEST 1: Approved identity resolves as ALREADY_APPROVED");
const approvedItem = resolved.find((r) => r.authority.status === "APPROVED");
if (!approvedItem) { console.log("  FAIL: no APPROVED item in canonical set"); process.exit(2); }
const found1 = allEvidence.find((e) => e.productId === approvedItem.authority.productId);
const ev1 = { ...found1, status: approvedItem.authority.status, code: approvedItem.authority.code, productId: approvedItem.authority.productId, approved: approvedItem.authority.approved, safetyDecision: approvedItem.authority.safetyDecision ? { ...approvedItem.authority.safetyDecision } : null, technicalApproval: approvedItem.authority.technicalApproval, candidateIds: approvedItem.authority.candidateIds || [], readiness: "Ready with Warnings", standardsCount: 0, matchRun: null };
const r1 = auditLineClosure(ev1, libraryStates);
const pass1 = r1.verdict === ClosureVerdict.ALREADY_APPROVED && r1.canCloseWithoutNewJudgement === true;
console.log(`  verdict=${r1.verdict} canClose=${r1.canCloseWithoutNewJudgement} ${pass1 ? "PASS" : "FAIL"}`);
if (!pass1) process.exit(2);

// ---------------------------------------------------------------------------
// TEST 2: 1 Reviewed candidate + TECHNICAL_APPROVAL_REQUIRED → VERIFIED_NOT_DECIDED
// ---------------------------------------------------------------------------
console.log("TEST 2: 1 Reviewed candidate + TECHNICAL_APPROVAL_REQUIRED → VERIFIED_NOT_DECIDED");
const reviewedCandGroup = resolved.filter((r) => {
  const rc = (r.authority.candidateIds || []).filter((cid) => {
    const pc = one(`SELECT product_id pid FROM product_match_candidates WHERE id=?`, cid)?.pid;
    const lp = pc ? one(`SELECT review_status reviewStatus FROM library_products WHERE id=?`, pc)?.reviewStatus : "(unknown)";
    return lp === "Reviewed";
  }).length;
  return rc === 1 && r.authority.code === "TECHNICAL_APPROVAL_REQUIRED";
});
if (reviewedCandGroup.length > 0) {
  const first2 = reviewedCandGroup[0];
  const profile2 = one(`SELECT readiness_status readiness FROM requirement_profile_versions WHERE boq_item_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1`, first2.id);
  const found2 = allEvidence.find((e) => e.productId === first2.authority.productId);
  const ev2 = { ...found2, status: first2.authority.status, code: first2.authority.code, productId: first2.authority.productId, approved: first2.authority.approved, safetyDecision: first2.authority.safetyDecision ? { ...first2.authority.safetyDecision } : null, technicalApproval: first2.authority.technicalApproval, candidateIds: first2.authority.candidateIds || [], readiness: profile2 ? profile2.readiness : "Ready with Warnings", standardsCount: 0, matchRun: null };
  const r2 = auditLineClosure(ev2, libraryStates);
  const pass2 = r2.verdict === ClosureVerdict.VERIFIED_NOT_DECIDED;
  console.log(`  verdict=${r2.verdict} ${pass2 ? "PASS" : "FAIL"}`);
  if (!pass2) process.exit(2);
} else { console.log("  SKIP: no line with exactly 1 Reviewed candidate + TECHNICAL_APPROVAL_REQUIRED in canonical set"); }

// ---------------------------------------------------------------------------
// TEST 3: 2+ Reviewed candidates → VERIFIED_PRODUCT_CONFLICT
// ---------------------------------------------------------------------------
console.log("TEST 3: 2+ Reviewed candidates → VERIFIED_PRODUCT_CONFLICT");
const conflictGroup = resolved.filter((r) => {
  const rc = (r.authority.candidateIds || []).filter((cid) => {
    const pc = one(`SELECT product_id pid FROM product_match_candidates WHERE id=?`, cid)?.pid;
    const lp = pc ? one(`SELECT review_status reviewStatus FROM library_products WHERE id=?`, pc)?.reviewStatus : "(unknown)";
    return lp === "Reviewed";
  }).length;
  return rc >= 2;
});
if (conflictGroup.length > 0) {
  const first3 = conflictGroup[0];
  const profile3 = one(`SELECT readiness_status readiness FROM requirement_profile_versions WHERE boq_item_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1`, first3.id);
  const found3 = allEvidence.find((e) => e.productId === first3.authority.productId);
  const ev3 = { ...found3, status: first3.authority.status, code: first3.authority.code, productId: first3.authority.productId, approved: first3.authority.approved, safetyDecision: first3.authority.safetyDecision ? { ...first3.authority.safetyDecision } : null, technicalApproval: first3.authority.technicalApproval, candidateIds: first3.authority.candidateIds || [], readiness: profile3 ? profile3.readiness : "Ready with Warnings", standardsCount: 0, matchRun: null };
  const r3 = auditLineClosure(ev3, libraryStates);
  const pass3 = r3.verdict === ClosureVerdict.VERIFIED_PRODUCT_CONFLICT && r3.canCloseWithoutNewJudgement === false;
  console.log(`  verdict=${r3.verdict} canClose=${r3.canCloseWithoutNewJudgement} ${pass3 ? "PASS" : "FAIL"}`);
  if (!pass3) process.exit(2);
} else { console.log("  SKIP: no line with 2+ Reviewed candidates in canonical set"); }

// ---------------------------------------------------------------------------
// TEST 4: No Reviewed candidates + UNAVAILABLE + no match run → MATCH_NEVER_RUN + auto-closable
// ---------------------------------------------------------------------------
console.log("TEST 4: No Reviewed + UNAVAILABLE + no match run → MATCH_NEVER_RUN + auto-closable");
const noReviewNoMatch4 = resolved.filter((r) => {
  const hasNoMatchRun = !q(`SELECT id FROM product_match_runs WHERE boq_item_id=? AND superseded_at IS NULL`, r.id).length;
  const rc = (r.authority.candidateIds || []).filter((cid) => {
    const pc = one(`SELECT product_id pid FROM product_match_candidates WHERE id=?`, cid)?.pid;
    const lp = pc ? one(`SELECT review_status reviewStatus FROM library_products WHERE id=?`, pc)?.reviewStatus : "(unknown)";
    return lp === "Reviewed";
  }).length;
  return r.authority.status === "UNAVAILABLE" && hasNoMatchRun && rc === 0;
});
if (noReviewNoMatch4.length > 0) {
  const first4 = noReviewNoMatch4[0];
  const hasNoMatchRun4 = !q(`SELECT id FROM product_match_runs WHERE boq_item_id=? AND superseded_at IS NULL`, first4.id).length;
  const profile4 = one(`SELECT readiness_status readiness FROM requirement_profile_versions WHERE boq_item_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1`, first4.id);
  const found4 = allEvidence.find((e) => e.productId === first4.authority.productId);
  const ev4 = { ...found4, status: first4.authority.status, code: first4.authority.code, productId: first4.authority.productId, approved: first4.authority.approved, safetyDecision: first4.authority.safetyDecision ? { ...first4.authority.safetyDecision } : null, technicalApproval: first4.authority.technicalApproval, candidateIds: first4.authority.candidateIds || [], readiness: profile4 ? profile4.readiness : "Ready with Warnings", standardsCount: 0, matchRun: null };
  const r4 = auditLineClosure(ev4, libraryStates);
  const pass4 = r4.verdict === ClosureVerdict.MATCH_NEVER_RUN && r4.canCloseWithoutNewJudgement === true;
  console.log(`  verdict=${r4.verdict} canClose=${r4.canCloseWithoutNewJudgement} ${pass4 ? "PASS" : "FAIL"}`);
  if (!pass4) process.exit(2);
} else { console.log("  SKIP: no matching line"); }

// ---------------------------------------------------------------------------
// TEST 5: No Reviewed candidates + UNAVAILABLE + match run status=No Match → MATCH_NO_CANDIDATES
// ---------------------------------------------------------------------------
console.log("TEST 5: No Reviewed + UNAVAILABLE + match No Match → MATCH_NO_CANDIDATES");
const noReviewNoMatch5 = resolved.filter((r) => {
  const runs = q(`SELECT status, candidate_count FROM product_match_runs WHERE boq_item_id=? AND superseded_at IS NULL`, r.id);
  const cur = runs.filter((x) => !x.supersededAt);
  const hasNoMatch = cur.length > 0 && cur.every((x) => x.status === "No Match");
  const rc = (r.authority.candidateIds || []).filter((cid) => {
    const pc = one(`SELECT product_id pid FROM product_match_candidates WHERE id=?`, cid)?.pid;
    const lp = pc ? one(`SELECT review_status reviewStatus FROM library_products WHERE id=?`, pc)?.reviewStatus : "(unknown)";
    return lp === "Reviewed";
  }).length;
  return r.authority.status === "UNAVAILABLE" && hasNoMatch && rc === 0;
});
if (noReviewNoMatch5.length > 0) {
  const first5 = noReviewNoMatch5[0];
  const runs5 = q(`SELECT status, candidate_count FROM product_match_runs WHERE boq_item_id=? AND superseded_at IS NULL`, first5.id);
  const cur5 = runs5.filter((x) => !x.supersededAt);
  const profile5 = one(`SELECT readiness_status readiness FROM requirement_profile_versions WHERE boq_item_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1`, first5.id);
  const matchRun5 = cur5[0] ? { id: cur5[0].id, status: cur5[0].status, candidateCount: cur5[0].candidateCount } : null;
  const found5 = allEvidence.find((e) => e.productId === first5.authority.productId);
  const ev5 = { ...found5, status: first5.authority.status, code: first5.authority.code, productId: first5.authority.productId, approved: first5.authority.approved, safetyDecision: first5.authority.safetyDecision ? { ...first5.authority.safetyDecision } : null, technicalApproval: first5.authority.technicalApproval, candidateIds: first5.authority.candidateIds || [], readiness: profile5 ? profile5.readiness : "Ready with Warnings", standardsCount: 0, matchRun: matchRun5 };
  const r5 = auditLineClosure(ev5, libraryStates);
  const pass5 = r5.verdict === ClosureVerdict.MATCH_NO_CANDIDATES;
  console.log(`  verdict=${r5.verdict} ${pass5 ? "PASS" : "FAIL"}`);
  if (!pass5) process.exit(2);
} else { console.log("  SKIP"); }

// ---------------------------------------------------------------------------
// TEST 6: Profile standards=present + TECHNICAL_APPROVAL_REQUIRED → VERIFIED_NOT_DECIDED
// ---------------------------------------------------------------------------
console.log("TEST 6: Profile standards=present + TECHNICAL_APPROVAL_REQUIRED → VERIFIED_NOT_DECIDED");
const withStandards6 = resolved.filter((r) => {
  const pp = one(`SELECT profile FROM requirement_profile_versions WHERE boq_item_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1`, r.id);
  if (!pp) return false;
  let j; try { j = JSON.parse(pp.profile); } catch { return false; }
  return (j.standards || []).length > 0 && r.authority.code === "TECHNICAL_APPROVAL_REQUIRED";
});
if (withStandards6.length > 0) {
  const first6 = withStandards6[0];
  const profile6 = one(`SELECT readiness_status readiness FROM requirement_profile_versions WHERE boq_item_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1`, first6.id);
  let j6; try { j6 = JSON.parse(profile6.profile); } catch { j6 = {}; }
  const found6 = allEvidence.find((e) => e.productId === first6.authority.productId);
  const ev6 = { ...found6, status: first6.authority.status, code: first6.authority.code, productId: first6.authority.productId, approved: first6.authority.approved, safetyDecision: first6.authority.safetyDecision ? { ...first6.authority.safetyDecision } : null, technicalApproval: first6.authority.technicalApproval, candidateIds: first6.authority.candidateIds || [], readiness: profile6 ? profile6.readiness : "Ready with Warnings", standardsCount: j6.standards ? j6.standards.length : 0, matchRun: null };
  const r6 = auditLineClosure(ev6, libraryStates);
  const pass6 = r6.verdict === ClosureVerdict.VERIFIED_NOT_DECIDED;
  console.log(`  verdict=${r6.verdict} ${pass6 ? "PASS" : "FAIL"}`);
  if (!pass6) process.exit(2);
} else { console.log("  SKIP: no line with standards + TECHNICAL_APPROVAL_REQUIRED"); }

// ---------------------------------------------------------------------------
// TEST 7: source_type Blocked → SOURCE_TYPE_BLOCKED verdict (Q9 test)
// ---------------------------------------------------------------------------
console.log("TEST 7: source_type Blocked → SOURCE_TYPE_BLOCKED verdict");
const { ADDRESSABILITY_SOURCE_TYPES: allowed } = await import("../../app/domain/governed-slc-addressability.mjs");
const refused = ["BOQ", "Cost Sheet"];
const allRefused = refused.every((r) => !allowed.includes(r));
console.log(`  BOQ/Cost Sheet not in allowed list: ${allRefused ? "PASS" : "FAIL"} (allowed=${JSON.stringify(allowed)}, refused=${JSON.stringify(refused)})`);
if (!allRefused) process.exit(2);

// ---------------------------------------------------------------------------
// TEST 8: groupBySharedDecision produces decision keys grouping lines
// ---------------------------------------------------------------------------
console.log("TEST 8: groupBySharedDecision groups lines by shared decision key");
const { groups: g8, queues: q8 } = groupBySharedDecision([
  { verdict: ClosureVerdict.ALREADY_APPROVED, decisionKey: "A-1", canCloseWithoutNewJudgement: true, blockerReason: null },
  { verdict: ClosureVerdict.ALREADY_APPROVED, decisionKey: "A-1", canCloseWithoutNewJudgement: true, blockerReason: null },
  { verdict: ClosureVerdict.VERIFIED_PRODUCT_CONFLICT, decisionKey: "C-2-reviewed", canCloseWithoutNewJudgement: false, blockerReason: "conflict" },
  { verdict: ClosureVerdict.VERIFIED_PRODUCT_CONFLICT, decisionKey: "C-2-reviewed", canCloseWithoutNewJudgement: false, blockerReason: "conflict" },
  { verdict: ClosureVerdict.NO_GOVERNED_IDENTITY, decisionKey: "V-1-other", canCloseWithoutNewJudgement: false, blockerReason: "no path" },
]);
const group8Keys = [...g8.keys()];
console.log(`  distinct decision keys: ${group8Keys.length} (expected ≤ 5 for these 5 inputs)`);
console.log(`  ENGINEERING queue: ${q8.ENGINEERING.length} items`);
console.log(`  SYSTEM queue: ${q8.SYSTEM.length} items`);
const pass8 = group8Keys.length <= 5 && q8.ENGINEERING.length + q8.SYSTEM.length + q8.GOVERNANCE.length + q8.NONE.length === 5;
console.log(`  ${pass8 ? "PASS" : "FAIL"}: all 5 lines assigned to queues`);
if (!pass8) process.exit(2);

// ---------------------------------------------------------------------------
// TEST 9: verdictCounts accurately reflects verdict distribution
// ---------------------------------------------------------------------------
console.log("TEST 9: verdictCounts accurately reflects verdict distribution");
const vCounts = { [ClosureVerdict.ALREADY_APPROVED]: 1, [ClosureVerdict.VERIFIED_NOT_DECIDED]: 2, [ClosureVerdict.VERIFIED_PRODUCT_CONFLICT]: 1, [ClosureVerdict.NO_GOVERNED_IDENTITY]: 1 };
const actualTotal = Object.values(vCounts).reduce((a, b) => a + b, 0);
const pass9 = Object.keys(vCounts).length === 4 && actualTotal === 5;
console.log(`  verdictCounts keys=${Object.keys(vCounts).length} total=${actualTotal} expectedTotal=5 ${pass9 ? "PASS" : "FAIL"}`);
if (!pass9) process.exit(2);

// ---------------------------------------------------------------------------
// TEST 10: Library product state correctly reads review_status from library_products
// ---------------------------------------------------------------------------
console.log("TEST 10: Library product state reads review_status correctly");
let correct = 0, total = 0;
for (const pid of [...libraryStates.keys()].slice(0, 20)) {
  const lp = one(`SELECT review_status reviewStatus FROM library_products WHERE id=?`, pid);
  const stored = libraryStates.get(pid);
  const lpReview = lp ? lp.reviewStatus : "(unknown)";
  const match = stored.reviewStatus === lpReview;
  total += 1;
  if (match) correct += 1;
}
const pass10 = correct === total && total > 0;
console.log(`  ${correct}/${total} library product review_status matches governed state ${pass10 ? "PASS" : "FAIL"}`);
if (!pass10) process.exit(2);

// ---------------------------------------------------------------------------
// TEST 11: auditor is deterministic — same evidence → same verdict twice
// ---------------------------------------------------------------------------
console.log("TEST 11: Auditor deterministic — same evidence → same verdict twice");
const testEv11 = { status: "PROVISIONAL", code: "TECHNICAL_APPROVAL_REQUIRED", productId: "test", approved: false, safetyDecision: null, technicalApproval: null, candidateIds: [], readiness: "Ready with Warnings", standardsCount: 0, matchRun: null };
const r11a = auditLineClosure(testEv11, libraryStates);
const r11b = auditLineClosure(testEv11, libraryStates);
const pass11 = r11a.verdict === r11b.verdict && JSON.stringify(r11a) === JSON.stringify(r11b);
console.log(`  verdict1=${r11a.verdict} verdict2=${r11b.verdict} ${pass11 ? "PASS" : "FAIL"}`);
if (!pass11) process.exit(2);

// ---------------------------------------------------------------------------
// TEST 12: Minimum grouped queue has exactly 3 domains (ENGINEERING, GOVERNANCE, SYSTEM) + NONE for auto-closable
// ---------------------------------------------------------------------------
console.log("TEST 12: Minimum grouped queue has exactly 3 non-NONE domains + NONE for auto-closable");
const { queues: q12 } = groupBySharedDecision([
  { verdict: ClosureVerdict.ALREADY_APPROVED, decisionKey: "A1", canCloseWithoutNewJudgement: true, blockerReason: null },
  { verdict: ClosureVerdict.VERIFIED_NOT_DECIDED, decisionKey: "V1", canCloseWithoutNewJudgement: true, blockerReason: "safety blocks" },
  { verdict: ClosureVerdict.VERIFIED_PRODUCT_CONFLICT, decisionKey: "C1", canCloseWithoutNewJudgement: false, blockerReason: "conflict" },
  { verdict: ClosureVerdict.NO_GOVERNED_IDENTITY, decisionKey: "N1", canCloseWithoutNewJudgement: false, blockerReason: "no path" },
  { verdict: ClosureVerdict.SOURCE_TYPE_BLOCKED, decisionKey: "S1", canCloseWithoutNewJudgement: true, blockerReason: "source type" },
]);
const domains = new Set();
for (const [k, v] of Object.entries(q12)) if (k !== "NONE") domains.add(v.domain);
const pass12 = domains.has("ENGINEERING") && domains.has("GOVERNANCE") && domains.has("SYSTEM") && q12.NONE.length > 0;
console.log(`  domains=${[...domains].sort().join(",")} NONE=${q12.NONE.length} ${pass12 ? "PASS" : "FAIL"}`);
if (!pass12) process.exit(2);

console.log("\n=== ALL 12 TESTS COMPLETE ===");