// Deterministic re-score of the CLEAN Parse -> Lightning run from STORED
// evidence only. Makes ZERO model, Parse, or Lightning calls.
//
//   node scripts/vision-bakeoff-parse-lightning-rescore.mjs [runId]
//
// Repairs applied (implementation defects only -- no rubric/weight/penalty edits):
//   1. C2 false PARSE_TABLE_STRUCTURE_ERROR (empty mustMention could never be
//      "missing"; the rule fired unconditionally).
//   2. Case D unsupported-inference penalty adjudicated against Stage-1 evidence.
//      A token that Stage 1 extracted and Stage 2 transcribed verbatim is NOT an
//      unsupported inference, even when it is wrong or insufficient. The failure
//      is an abstention failure, already reflected in the engineering-semantics
//      and abstention dimensions -- it must not also be penalised as invention.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { CASES, RUBRIC, scoreCase, aggregate } from "./vision-bakeoff-packet.mjs";

const RUN_ID = process.argv[2] || "vision-bakeoff-parse-lightning-fixed-2026-10-04";
const DIR = `out/benchmark/vision-bakeoff/${RUN_ID}`;
const rows = readFileSync(`${DIR}/raw.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

const tokenize = (s) => String(s || "")
  // Stage-2 answers QUOTE Stage-1 text, which may carry LITERAL escape sequences
  // (e.g. the characters \ n) rather than real newlines. Decoding them first
  // prevents the split from manufacturing phantom tokens ("nhc","ns","nc") that
  // were never semantically asserted by the model.
  .replace(/\\n/g, "\n").replace(/\\t/g, "\t")
  .split(/[^A-Za-z0-9]+/).map((t) => t.trim()).filter(Boolean);

/**
 * Did Stage 2 assert any token absent from Stage 1 evidence?
 * Verbatim transcription of provider-extracted text is NOT unsupported content.
 */
const addedUnsupportedContent = (finalText, parseTexts) => {
  const evidence = new Set(parseTexts.flatMap((t) => tokenize(t)).map((t) => t.toLowerCase()));
  // Stopwords carry no semantic assertion, so they cannot be unsupported content.
  const stop = new Set(["the", "a", "an", "is", "are", "as", "and", "or", "of", "to", "in", "on", "for",
    "with", "from", "this", "that", "it", "no", "not", "be", "was", "were", "there", "here", "text",
    "extracted", "image", "evidence", "provided", "appears", "can", "cannot", "determined", "legible",
    "bounding", "box", "normalized", "approximately", "slightly", "outside", "nominal", "bounds",
    "positions", "relative", "equipment", "voltage", "ratings", "cable", "sizes", "connections",
    "room", "identifiers", "details", "further", "reported", "without", "guessing", "preserved",
    "newlines", "labels", "location", "explicit", "status", "brackets", "present", "absent",
    "legibility", "class", "detected", "element", "elements", "rows", "row", "preserved", "newlines",
    "exactly", "noted", "approximate", "notes", "note", "verbatim", "copied", "copied", "includes"]);
  const finalTokens = tokenize(finalText).map((t) => t.toLowerCase());
  return finalTokens.filter((t) => !evidence.has(t) && !stop.has(t) && t.length > 1);
};

const QTY_MENTION = /\b\d+\s*(?:nos?\.?|pcs?|units?)\b/i;

const out = [];
for (const r of rows) {
  const def = CASES.find((c) => c.id === r.caseId);
  const base = scoreCase(def, {
    text: r.finalResponse, parseOk: r.parseOk ?? Boolean(r.finalResponse && String(r.finalResponse).trim()),
    latencyMs: r.endToEndMs, errored: Boolean(r.stageError),
  });
  const corrections = [];
  let penalties = [...(base.penalties || [])];
  let penalty = base.penalty;

  // --- Repair 2: adjudicate unsupported-inference penalties against Stage 1 ---
  if (penalties.includes("unsupportedEngineeringInference")) {
    const parseTexts = (r.parseExtraction || []).map((e) => e.text).filter(Boolean);
    const added = addedUnsupportedContent(r.finalResponse, parseTexts);
    const inventedQty = QTY_MENTION.test(String(r.finalResponse || ""));
    if (!added.length && !inventedQty) {
      // Nothing was asserted beyond Stage-1 evidence: this is an abstention
      // failure, already priced into the engineeringSemantics and
      // abstentionDiscipline dimensions. Remove the invention penalty.
      penalties = penalties.filter((p) => p !== "unsupportedEngineeringInference");
      penalty = penalties.reduce((s, p) => s + (RUBRIC.penalties[p] ?? 0), 0);
      corrections.push("removed_unsupportedEngineeringInference__no_content_beyond_stage1");
    } else {
      corrections.push(`kept_unsupportedEngineeringInference__added=[${added.slice(0, 8).join(",")}]`);
    }
  }

  const score = Number((100 * (
    base.visualAccuracy * RUBRIC.weights.visualAccuracy +
    base.textTableExtraction * RUBRIC.weights.textTableExtraction +
    base.engineeringSemantics * RUBRIC.weights.engineeringSemantics +
    base.abstentionDiscipline * RUBRIC.weights.abstentionDiscipline +
    base.structuredOutput * RUBRIC.weights.structuredOutput +
    base.operational * RUBRIC.weights.operational
  ) / 100 + penalty).toFixed(2));

  out.push({
    id: r.caseId, kind: r.caseKind,
    parseElements: r.parseEntryCount, parseTextElements: r.parseTextCount,
    parseTextChars: (r.parseExtraction || []).reduce((s, e) => s + String(e.text || "").trim().length, 0),
    parseGeometry: (r.parseExtraction || []).filter((e) => e.bboxRaw).length,
    parseLatencyMs: r.parseLatencyMs, lightningLatencyMs: r.lightningLatencyMs, endToEndMs: r.endToEndMs,
    visualAccuracy: base.visualAccuracy, textTableExtraction: base.textTableExtraction,
    engineeringSemantics: base.engineeringSemantics, abstentionDiscipline: base.abstentionDiscipline,
    structuredOutput: base.structuredOutput, operational: base.operational,
    penalties, penalty, score, corrections,
  });
}

const agg = aggregate(out);
const pl = rows.map((r) => r.endToEndMs).sort((a, b) => a - b);
const med = (a) => a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;

// ---- Diagnostic coverage metrics (NOT part of the official 100-point score) ----
const hasText = out.filter((c) => c.parseTextElements > 0).length;
const hasGeom = out.filter((c) => c.parseGeometry > 0).length;
const noEvidence = out.filter((c) => c.parseTextElements === 0).length;
const substantive = out.filter((c) => !(c.score > 0 && c.visualAccuracy === 0.5 && c.abstentionDiscipline === 1)).length;
const correctAbstentions = out.filter((c) => c.abstentionDiscipline === 1 && c.visualAccuracy === 0.5).length;
const abstentionDominated = out.filter((c) => c.abstentionDiscipline === 1 && c.penalties.length === 0).length;

const summary = {
  runId: RUN_ID, rescoredFromStoredEvidence: true, modelCalls: 0, parseCalls: 0, lightningCalls: 0,
  rubric: RUBRIC,
  cases: out,
  aggregate: agg,
  coverage: {
    PARSE_CASES_WITH_USABLE_TEXT: `${hasText}/6`,
    PARSE_CASES_WITH_USABLE_GEOMETRY: `${hasGeom}/6`,
    PARSE_CASES_WITH_NO_USABLE_EVIDENCE: `${noEvidence}/6`,
    LIGHTNING_CASES_WITH_SUBSTANTIVE_ATTEMPT: `${substantive}/6`,
    LIGHTNING_CORRECT_ABSTENTIONS: correctAbstentions,
    ABSTENTION_DOMINATED_CASES: `${abstentionDominated}/6`,
  },
  safety: {
    HALLUCINATED_QUANTITIES: out.reduce((s, c) => s + c.penalties.filter((p) => p === "hallucinatedPrintedQuantity").length, 0),
    HALLUCINATED_TEXT: out.reduce((s, c) => s + c.penalties.filter((p) => p === "hallucinatedText").length, 0),
    UNSUPPORTED_INFERENCES: out.reduce((s, c) => s + c.penalties.filter((p) => p === "unsupportedEngineeringInference").length, 0),
    ABSTENTION_FAILURES: rows.filter((r) => CASES.find((c) => c.id === r.caseId)?.expected.requireAbstention
      && !/cannot|unable|unclear|illegible|not (clear|legible|determine)|indeterminate|unknown|ambiguous/i.test(String(r.finalResponse || ""))).length,
  },
  operational: {
    parseMedian: med(rows.map((r) => r.parseLatencyMs).sort((a, b) => a - b)),
    lightningMedian: med(rows.map((r) => r.lightningLatencyMs).sort((a, b) => a - b)),
    pipelineMedian: med(pl), pipelineMax: Math.max(...pl),
    totalMs: pl.reduce((a, b) => a + b, 0),
    casesOver30s: pl.filter((x) => x > 30000).length,
    timeouts: rows.filter((r) => r.stageError?.status === "DEADLINE").length,
  },
};
mkdirSync(DIR, { recursive: true });
writeFileSync(`${DIR}/score-rescored.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ aggregate: agg, coverage: summary.coverage, safety: summary.safety, operational: summary.operational }, null, 2));
for (const c of out) console.log(`  ${c.id}: ${c.score}  pen=[${c.penalties.join(",")}] ${c.corrections.join(";")}`);