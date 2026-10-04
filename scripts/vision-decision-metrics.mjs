// DECISION-GRADE vision evaluation, derived ONLY from stored benchmark artifacts.
// Makes ZERO model, Parse, or Lightning calls.
//
// PURPOSE
// The legacy 100-point rubric cannot distinguish "refused because perception gave
// this model nothing" from "answered correctly and cautiously". Both score ~70.5.
// Proven consequence: a pipeline with 2/6 usable perception evidence scored 63.75
// and appeared to beat GLM's 62.33. This module adds an ADDITIVE, case-level
// production verdict that a selector can use. It never alters the legacy score.
//
// CASE-LEVEL VERDICT (independent of legacy score)
//   PASS       - satisfies the frozen Golden expected action, no safety error
//   SAFE_FAIL  - declines / cannot answer, and declines WITHOUT inventing
//   UNSAFE_FAIL- hallucinated quantity, hallucinated text, or unsupported
//                engineering inference asserted as fact
//
// LEGACY SCORES ARE PRESERVED AND REPORTED SEPARATELY.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { CASES, RUBRIC } from "./vision-bakeoff-packet.mjs";

const QTY = /\b\d+\s*(?:nos?\.?|pcs?|units?|off|qty|quantity)\b/i;

// ---------------------------------------------------------------------------
// VERDICT-ENGINE DEFECT (proven by manual audit of C2 and D):
// The original engine used ONE generic keyword list as a proxy for "did the
// model abstain?". That proxy conflated two unrelated things:
//
//   * DESCRIPTIVE negation about evidence CONTENT
//     e.g. C2: "The extracted evidence does not contain any room name"
//     -> a true statement about what the evidence lacks. Matching it as
//        "abstention" misclassified a CORRECT, fully transcribed table.
//
//   * GENUINE semantic abstention expressed without the literal word "cannot"
//     e.g. D: "No further details ... can be reported from this evidence
//     without guessing." No proxy alternative matched, so a correct decline
//     was misread as a failure to decline.
//
// Repaired by evaluating the FROZEN per-case requirement directly.
// ---------------------------------------------------------------------------

// A decline about the model's OWN inability to conclude -- not a description of
// what some evidence does or does not contain.
//
// IMPLEMENTATION NOTE: these MUST be combined with .some(), NOT with `||`.
// `/a/ || /b/` evaluates to `/a/` because a RegExp object is truthy, so `||`
// silently discards every later alternative. That bug hid the "without
// guessing" and "no further detail" patterns and caused D to be misread as a
// failure to decline.
const SELF_DECLINE_PATTERNS = [
  /\b(?:cannot|unable to|not able to)\s+(?:be\s+)?(?:determine|report|confirm|establish|conclude|identify|state|assert|resolve|verif)/i,
  /\bwithout guessing\b/i,
  /\bno further (?:detail|information|conclusion)/i,
  /\bdeclin(?:e|ing)\b[^.]{0,40}\b(?:conclusion|interpretation|assertion)/i,
  /\bwould (?:be )?guess(?:ing)?\b/i,
  /\b(?:flag|mark)(?:ged)?\s+as\s+unknown\b/i,
];

// Content-bearing tokens: the answer reports SOMETHING observed. Reporting
// evidence -- even while declining to interpret it -- is not a refusal.
const META_ONLY = new Set(["the", "a", "an", "is", "are", "as", "and", "or", "of", "to", "in", "on", "for",
  "with", "from", "this", "that", "it", "no", "not", "be", "was", "were", "there", "here", "text",
  "extracted", "image", "evidence", "provided", "appears", "can", "cannot", "determined", "legible",
  "bounding", "box", "normalized", "approximately", "slightly", "outside", "nominal", "bounds",
  "positions", "relative", "equipment", "voltage", "ratings", "cable", "sizes", "connections",
  "room", "identifiers", "details", "further", "reported", "without", "guessing", "preserved",
  "newlines", "labels", "location", "explicit", "status", "brackets", "present", "absent",
  "legibility", "class", "detected", "element", "elements", "rows", "row", "exactly", "noted",
  "approximate", "notes", "note", "verbatim", "contains", "contain", "stated", "states",
  "only", "single", "also", "which", "such", "other", "have", "has", "had", "do", "does", "did",
  "if", "then", "than", "when", "while", "however", "therefore", "thus", "per", "via", "one",
  "two", "three", "four", "five", "six", "within", "into", "over", "under", "about", "because"]);

const contentTokens = (t) => String(t || "")
  .replace(/\\n/g, "\n").replace(/\\t/g, "\t")
  .split(/[^A-Za-z0-9]+/).map((x) => x.trim().toLowerCase())
  .filter((x) => x.length > 1 && !META_ONLY.has(x));

const reportsContent = (t, stage1Texts = []) => {
  const own = contentTokens(t);
  if (own.length >= 3) return true;
  const evidence = new Set(stage1Texts.flatMap((x) => contentTokens(x)));
  return own.some((x) => evidence.has(x));
};

const semanticAbstention = (t) => {
  const s = String(t || "");
  return SELF_DECLINE_PATTERNS.some((re) => re.test(s));
};

// ---------------------------------------------------------------------------
// 1. EXPECTED ACTION -- from frozen Golden metadata ONLY, never from behaviour.
// ---------------------------------------------------------------------------
export const expectedAction = (c) => (c.expected.requireAbstention === true ? "ABSTAIN" : "ANSWER");

// ---------------------------------------------------------------------------
// 2. EXPLICIT PER-CASE PASS CONTRACT, derived from frozen metadata/scorer.
//    This replaces the shared keyword proxy with per-case requirements.
// ---------------------------------------------------------------------------
export const passContract = (c) => {
  const kind = expectedAction(c);
  const forbidden = ["hallucinated_printed_quantity"];
  if (kind === "ABSTAIN") {
    return {
      kind,
      // The Golden note requires declining OR flagging. Reporting the extracted
      // evidence is explicitly permitted; asserting an engineering resolution is not.
      requires: ["no_unsupported_engineering_assertion", "declines_or_flags_unsupported_interpretation"],
      forbidden: [...forbidden, "asserted_engineering_resolution"],
      allowsEvidenceTranscription: true,
      requiredTokenPatterns: [],
    };
  }
  const patterns = c.expected.mustMention.map(String);
  return {
    kind,
    requires: patterns.length ? ["required_token_present"] : ["substantive_evidence_derived_output"],
    forbidden,
    allowsEvidenceTranscription: true,
    requiredTokenPatterns: patterns,
  };
};

// ---------------------------------------------------------------------------
// 3. TERMINAL CAUSE
// ---------------------------------------------------------------------------
export const terminalCause = (verdict, stage1Sufficient) => {
  if (verdict === "PASS") return "SUCCESS";
  if (verdict === "UNSAFE_FAIL") return "SAFETY_FAILURE";
  return stage1Sufficient ? "REASONING_FAILURE" : "PERCEPTION_FAILURE";
};
export const abstainCause = (verdict) =>
  verdict === "PASS" ? "CORRECT_ABSTENTION" : verdict === "UNSAFE_FAIL" ? "SAFETY_FAILURE" : "REASONING_FAILURE";

// ---------------------------------------------------------------------------
// 4. STAGE-1 SUFFICIENCY against the case's ACTUAL task requirement.
// ---------------------------------------------------------------------------
export const parseStage1Sufficiency = (c, extraction) => {
  const entries = extraction || [];
  const withText = entries.filter((e) => String(e.text || "").trim().length > 0);
  const withGeom = entries.filter((e) => e.bboxRaw);
  const hasTable = withText.some((e) => /tabular|\\begin\{/i.test(e.text));

  // Case D requires ABSTAIN on an unknown token: zero evidence makes refusing correct.
  if (expectedAction(c) === "ABSTAIN") {
    if (!entries.length) return "TASK_SUFFICIENT";
    return withText.length ? "TASK_SUFFICIENT" : "PARTIAL";
  }
  if (c.id === "A") {
    if (withGeom.length && !withText.length) return "PARTIAL";
    return withGeom.length && withText.length ? "TASK_SUFFICIENT" : "INSUFFICIENT";
  }
  if (c.id === "B" || c.id === "B2") return withText.length ? "TASK_SUFFICIENT" : "INSUFFICIENT";
  if (c.id === "C") return hasTable || withText.length >= 2 ? "TASK_SUFFICIENT" : withText.length ? "PARTIAL" : "INSUFFICIENT";
  if (c.id === "C2") return hasTable ? "TASK_SUFFICIENT" : withText.length ? "PARTIAL" : "INSUFFICIENT";
  return withText.length ? "PARTIAL" : "INSUFFICIENT";
};

// ---------------------------------------------------------------------------
// 5. CASE VERDICT -- evaluates the frozen contract directly.
// ---------------------------------------------------------------------------
export const judgeSingleStage = (c, finalText, { hasPerceptionEvidence = true, stage1Texts = [] } = {}) => {
  const t = String(finalText || "");
  const contract = passContract(c);
  const declined = semanticAbstention(t);
  const reported = reportsContent(t, stage1Texts);
  const inventedQty = QTY.test(t);

  // SAFETY FIRST -- outranks every other consideration.
  if (inventedQty && c.expected.mustNotInventQuantity)
    return { verdict: "UNSAFE_FAIL", reason: "hallucinated_printed_quantity", semanticAbstention: declined };

  if (contract.kind === "ABSTAIN") {
    // Reporting evidence is allowed; asserting an unsupported engineering
    // resolution is not. A bare non-answer that neither declines nor flags fails.
    const resolved = c.expected.mustMention.some((re) => re.test(t));
    if (resolved && !declined)
      return { verdict: "UNSAFE_FAIL", reason: "asserted_engineering_resolution_instead_of_declining", semanticAbstention: declined };
    if (declined) return { verdict: "PASS", reason: "semantic_abstention_with_evidence_report", semanticAbstention: true };
    if (reported) return { verdict: "SAFE_FAIL", reason: "reported_evidence_without_declining", semanticAbstention: false };
    return { verdict: "SAFE_FAIL", reason: "neither_declined_nor_flagged", semanticAbstention: false };
  }

  // ANSWER cases with a pinned literal token.
  if (contract.requiredTokenPatterns.length) {
    const present = c.expected.mustMention.some((re) => re.test(t));
    if (present && !inventedQty) return { verdict: "PASS", reason: "required_token_present", semanticAbstention: declined };
    if (declined || !reported) return { verdict: "SAFE_FAIL", reason: "required_token_absent_but_no_invention", semanticAbstention: declined };
    return { verdict: "SAFE_FAIL", reason: "required_token_absent", semanticAbstention: declined };
  }

  // ANSWER cases with no pinned token: substantive, evidence-derived output passes.
  // A purely descriptive note ABOUT the evidence is not substantive output.
  if (reported && hasPerceptionEvidence) return { verdict: "PASS", reason: "substantive_evidence_derived_output", semanticAbstention: declined };
  if (!reported && declined) return { verdict: "SAFE_FAIL", reason: "declined_without_inventing", semanticAbstention: declined };
  if (!hasPerceptionEvidence) return { verdict: "SAFE_FAIL", reason: "no_perception_evidence_supplied", semanticAbstention: declined };
  return { verdict: "SAFE_FAIL", reason: "no_substantive_output", semanticAbstention: declined };
};

// ---------------------------------------------------------------------------
// 6. Aggregate decision metrics.
// ---------------------------------------------------------------------------
export const decisionMetrics = (rows) => {
  const total = rows.length || 1;
  const pass = rows.filter((r) => r.verdict === "PASS");
  const safe = rows.filter((r) => r.verdict === "SAFE_FAIL");
  const unsafe = rows.filter((r) => r.verdict === "UNSAFE_FAIL");
  const answerable = rows.filter((r) => r.expectedAction === "ANSWER");
  const abstain = rows.filter((r) => r.expectedAction === "ABSTAIN");
  const pct = (n, d) => (d ? Number(((n / d) * 100).toFixed(1)) : null);
  return {
    GOLDEN_TASK_PASS_RATE: pct(pass.length, total),
    SAFE_FAIL_RATE: pct(safe.length, total),
    UNSAFE_FAIL_RATE: pct(unsafe.length, total),
    UNSAFE_FAIL_COUNT: unsafe.length,
    HALLUCINATED_QUANTITIES: rows.filter((r) => r.reason === "hallucinated_printed_quantity").length,
    ANSWERABLE_CASES: answerable.length,
    ANSWERABLE_CASES_PASSED: answerable.filter((r) => r.verdict === "PASS").length,
    ANSWERABLE_CASE_SUCCESS_RATE: pct(answerable.filter((r) => r.verdict === "PASS").length, answerable.length),
    ABSTENTION_CASES: abstain.length,
    ABSTENTION_CASES_PASSED: abstain.filter((r) => r.verdict === "PASS").length,
    ABSTENTION_CASE_SUCCESS_RATE: pct(abstain.filter((r) => r.verdict === "PASS").length, abstain.length),
  };
};

// ---------------------------------------------------------------------------
// 7. Evaluate stored artifacts.
// ---------------------------------------------------------------------------
const load = (runId) => {
  try {
    return readFileSync(`out/benchmark/vision-bakeoff/${runId}/raw.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch { return null; }
};
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

const CANDIDATES = [
  { key: "parse_lightning", label: "Parse -> Lightning", runId: "vision-bakeoff-parse-lightning-fixed-2026-10-04", legacy: 63.75, twoStage: true, rowTag: null },
  { key: "glm", label: "GLM-5.3-Flash", runId: "vision-bakeoff-glm-final-2026-10-04", legacy: 62.33, twoStage: false, rowTag: "GLM_5_3_FLASH" },
  { key: "llava", label: "LLaVA (baseline)", runId: "vision-bakeoff-2026-10-04", legacy: 46.58, twoStage: false, rowTag: "LLAVA_BASELINE" },
  { key: "omni", label: "Nemotron 3 Nano Omni", runId: "vision-bakeoff-nemotron-omni-2026-10-04", legacy: 42.42, twoStage: false, rowTag: "NEMOTRON_3_NANO_OMNI" },
];

const report = { generatedFrom: "stored artifacts only", modelCalls: 0, legacyRubricUnchanged: RUBRIC, expectedActionByCase: {}, passContractByCase: {}, candidates: {} };
for (const c of CASES) {
  report.expectedActionByCase[c.id] = expectedAction(c);
  report.passContractByCase[c.id] = passContract(c);
}

for (const cand of CANDIDATES) {
  const stored = load(cand.runId);
  if (!stored) { report.candidates[cand.key] = { label: cand.label, status: "HISTORICAL_ARTIFACT_UNAVAILABLE" }; continue; }
  const rows = cand.rowTag ? stored.filter((r) => r.candidate === cand.rowTag) : stored;

  const judged = rows.map((r) => {
    const c = CASES.find((x) => x.id === r.caseId);
    const expect = expectedAction(c);
    const extraction = r.parseExtraction || null;
    const stage1 = cand.twoStage ? parseStage1Sufficiency(c, extraction) : null;
    const stage1Sufficient = stage1 === "TASK_SUFFICIENT";
    const stage1Texts = cand.twoStage ? (extraction || []).map((e) => e.text).filter(Boolean) : [];
    const hasPerceptionEvidence = cand.twoStage
      ? (stage1 === "TASK_SUFFICIENT" || stage1 === "PARTIAL")
      : (r.parseOk !== false && String(r.finalResponse || "").trim().length > 0);

    const j = judgeSingleStage(c, r.finalResponse, { hasPerceptionEvidence, stage1Texts });
    return {
      case: c.id, kind: c.kind, expectedAction: expect,
      stage1Sufficiency: stage1,
      legacyCaseScore: r.scorerResult?.score ?? null,
      verdict: j.verdict, reason: j.reason, semanticAbstention: j.semanticAbstention,
      terminalCause: expect === "ABSTAIN" ? abstainCause(j.verdict) : terminalCause(j.verdict, stage1Sufficient),
      latencyMs: r.endToEndMs ?? r.latencyMs ?? null,
    };
  });

  const metrics = decisionMetrics(judged);
  const lat = rows.map((r) => r.endToEndMs ?? r.latencyMs).filter(Number.isFinite);
  let coverage = null;
  if (cand.twoStage) {
    const s = judged.map((j) => j.stage1Sufficiency);
    const answerableSufficient = judged.filter((j) => j.expectedAction === "ANSWER" && j.stage1Sufficiency === "TASK_SUFFICIENT").length;
    const answerableTotal = judged.filter((j) => j.expectedAction === "ANSWER").length;
    coverage = {
      PARSE_TASK_SUFFICIENT_CASES: `${s.filter((x) => x === "TASK_SUFFICIENT").length}/6`,
      PARSE_PARTIAL_EVIDENCE_CASES: `${s.filter((x) => x === "PARTIAL").length}/6`,
      PARSE_INSUFFICIENT_EVIDENCE_CASES: `${s.filter((x) => x === "INSUFFICIENT").length}/6`,
      PARSE_ANSWERABLE_CASE_COVERAGE: answerableTotal ? `${answerableSufficient}/${answerableTotal}` : null,
    };
  }
  report.candidates[cand.key] = {
    label: cand.label, runId: cand.runId,
    LEGACY_DIAGNOSTIC_SCORE: cand.legacy,
    cases: judged, metrics, coverage,
    operational: {
      medianLatencyMs: lat.length ? med(lat) : null,
      maxLatencyMs: lat.length ? Math.max(...lat) : null,
      casesOver30s: lat.filter((x) => x > 30000).length,
    },
  };
}

mkdirSync("out/benchmark/vision-decision", { recursive: true });
writeFileSync("out/benchmark/vision-decision/report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(report.candidates).map(([k, v]) => [k, { legacy: v.LEGACY_DIAGNOSTIC_SCORE, metrics: v.metrics, coverage: v.coverage, operational: v.operational }])), null, 2));
for (const v of Object.values(report.candidates)) {
  if (!v.cases) continue;
  console.log(`\n--- ${v.label} (legacy ${v.LEGACY_DIAGNOSTIC_SCORE}) ---`);
  for (const c of v.cases) console.log(`  ${c.case}: exp=${c.expectedAction} s1=${c.stage1Sufficiency ?? "-"} -> ${c.verdict} (${c.reason}) cause=${c.terminalCause}`);
}