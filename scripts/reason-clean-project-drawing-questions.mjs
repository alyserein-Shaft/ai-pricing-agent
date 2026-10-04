// TARGETED AI CORROBORATION RUN -- clean project Drawing Intelligence review items.
//
// Task-local runner. It performs NO writes to any database, NO extraction, and
// NO approvals. It deterministically assembles current-project evidence from a
// READ-ONLY copy of the local D1 file and hands it to the reusable reasoner
// (app/domain/project-evidence-reasoner.mjs), which owns the authority
// firewall. Output is a review proposal for a human, never a decision.
//
// Usage: node scripts/reason-clean-project-drawing-questions.mjs [dbPath]

import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

import {
  buildReasoningReviewPacket,
  reasonAcrossProjectEvidence,
  VISUAL_IDENTITY_FOCUS,
  REASONING_RESULT_SCHEMA,
} from "../app/domain/project-evidence-reasoner.mjs";
import { createConfiguredNvidiaNimStructuredProvider } from "../worker/boq-understanding-provider.mjs";

const DB_PATH = process.argv[2] || "/tmp/clean-ro.sqlite";
const PROJECT_ID = "project_29b4c399-2453-4a53-96c6-0434e15f13bb";
const LEGEND_DOC_PATTERN = "%AMS-DR-T-00-ZZZ-002%";
const OCCURRENCE_SHEET_PATTERN = "%-DR-T-93-%";

// ── env (secrets are read, never printed) ───────────────────────────────────
const readEnv = (path) => {
  const env = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^([A-Z_0-9]+)=(.*)$/.exec(line.trim());
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
};

// ── deterministic evidence assembly (read-only) ────────────────────────────
const db = new DatabaseSync(DB_PATH, { readonly: true });
const q = (sql, ...args) => db.prepare(sql).all(...args);

const legendDoc = q(
  "SELECT id, logical_name FROM documents WHERE project_id=? AND logical_name LIKE ? LIMIT 1",
  PROJECT_ID,
  LEGEND_DOC_PATTERN,
)[0];

// Query builder, not a template with nullable placeholders: `(? IS NULL OR ...)`
// makes `NULL IS NULL` true, so a document filter silently degrades into "every
// document" and the requested pattern stops mattering. Each filter is appended
// only when it is actually constrained.
const textAssets = ({ docId = null, pattern = null, maxLen = 400 } = {}) => {
  const where = [
    "d.project_id = ?",
    "v.superseded_at IS NULL",
    "a.asset_type = 'Text'",
    "length(a.text_content) < ?",
  ];
  const args = [PROJECT_ID, maxLen];
  if (docId) {
    where.push("d.id = ?");
    args.push(docId);
  }
  if (pattern) {
    where.push("a.text_content LIKE ?");
    args.push(pattern);
  }
  return q(
    `SELECT a.id AS asset_id, a.text_content, a.bounding_box, p.page_number, d.id AS document_id, d.logical_name, v.id AS intake_version_id
       FROM drawing_assets a
       JOIN drawing_pages p ON p.id = a.page_id
       JOIN drawing_intake_versions v ON v.id = a.intake_version_id
       JOIN documents d ON d.id = v.document_id
      WHERE ${where.join(" AND ")}
      ORDER BY d.logical_name, a.text_content`,
    ...args,
  );
};

const drawingEvidence = (row, over = {}) => ({
  evidenceKey: row.asset_id,
  projectId: PROJECT_ID,
  scope: "PROJECT",
  sourceType: "Drawing",
  governanceState: "CANDIDATE_NOT_APPROVED",
  currentness: "CURRENT",
  documentId: row.document_id,
  documentVersionId: row.intake_version_id,
  locator: `${row.logical_name} p${row.page_number} asset ${row.asset_id}`,
  extractedText: row.text_content,
  isVisualSource: true,
  ...over,
});

const boqEvidence = (row) => ({
  evidenceKey: row.id,
  projectId: PROJECT_ID,
  scope: "PROJECT",
  sourceType: "BOQ",
  // Normalized BOQ scope is not applied in this project: rows are SOURCE
  // CORROBORATION only and keep their exact source-row provenance.
  governanceState: "SOURCE_CORROBORATION",
  currentness: "CURRENT",
  documentId: row.source_document_id,
  documentVersionId: row.extraction_version_id,
  locator: `BOQ row seq ${row.sequence} item ${row.item_number ?? "n/a"} (${row.section ?? "n/a"}) [review: ${row.review_status}]`,
  extractedText: `${row.item_number ?? ""} ${row.description}`.trim(),
  isVisualSource: false,
});

const specEvidence = (row) => ({
  evidenceKey: row.id,
  projectId: PROJECT_ID,
  scope: "PROJECT",
  sourceType: "Specification",
  governanceState: row.approved_for_downstream === 1 ? "APPROVED_REQUIREMENT" : "EXTRACTED_UNAPPROVED",
  currentness: "CURRENT",
  documentId: row.source_document_id,
  documentVersionId: row.extraction_version_id,
  locator: `Specification clause ${row.clause_id ?? "n/a"} (${row.engineering_domain}; review: ${row.review_status})`,
  extractedText: row.original_text,
  isVisualSource: false,
});

// ── A: the exact legend candidates recovered from the current legend sheet ──
const legendPairs = JSON.parse(readFileSync("out/benchmark/vision-bakeoff/omair-review/fa-legend-candidates.json", "utf8"));
const EXACT_SYMBOLS = ["T", "S", "H", "ZIM", "FTCP", "FARP"];
const legendPairEvidence = legendPairs
  .filter((pair) => EXACT_SYMBOLS.includes(pair.symbol) && pair.descriptionAssetId)
  .map((pair) => ({
    evidenceKey: pair.descriptionAssetId,
    projectId: PROJECT_ID,
    scope: "PROJECT",
    sourceType: "Drawing",
    governanceState: "CANDIDATE_NOT_APPROVED",
    currentness: "CURRENT",
    documentId: legendDoc.id,
    documentVersionId: q(
      "SELECT id FROM drawing_intake_versions WHERE document_id=? AND superseded_at IS NULL LIMIT 1",
      legendDoc.id,
    )[0].id,
    locator: `${legendDoc.logical_name} p1 legend symbol ${pair.symbol} @(${Math.round(pair.symbolBbox.x)},${Math.round(pair.symbolBbox.y)}) -> text @(${Math.round(pair.descriptionBbox.x)},${Math.round(pair.descriptionBbox.y)})`,
    extractedText: `LEGEND SYMBOL "${pair.symbol}" printed above legend description "${pair.description}" in the FIRE ALARM SYSTEM legend table.`,
    isVisualSource: true,
  }));

const legendHeadingEvidence = textAssets({ docId: legendDoc.id, pattern: "%ELV LEGENDS%" })
  .map((row) => drawingEvidence(row, {
    extractedText: `${row.text_content} (legend/abbreviation sheet title block text)`,
  }));

// ── Cross-sheet LEGEND_FOR references (explicit note text, current sheets) ───
const legendForEvidence = textAssets({ pattern: "%FOR ELV LEGENDS%" })
  .map((row) => drawingEvidence(row, {
    extractedText: `${row.text_content} ${row.logical_name.includes("AMS") ? "" : "REFER TO THE ELV LEGEND SHEET."}`.trim(),
  }));

// ── Current T occurrences on the fire-alarm T-93 sheets ────────────────────
const tOccurrenceEvidence = q(
  `SELECT d.logical_name, d.id AS document_id, v.id AS intake_version_id, COUNT(*) AS n
     FROM drawing_assets a
     JOIN drawing_pages p ON p.id = a.page_id
     JOIN drawing_intake_versions v ON v.id = a.intake_version_id
     JOIN documents d ON d.id = v.document_id
    WHERE d.project_id = ? AND v.superseded_at IS NULL AND a.asset_type = 'Text'
      AND trim(a.text_content) = 'T' AND d.logical_name LIKE ?
    GROUP BY d.logical_name ORDER BY d.logical_name`,
  PROJECT_ID, OCCURRENCE_SHEET_PATTERN,
).map((row) => ({
  evidenceKey: `occ:${row.logical_name}`,
  projectId: PROJECT_ID,
  scope: "PROJECT",
  sourceType: "Drawing",
  governanceState: "CANDIDATE_NOT_APPROVED",
  currentness: "CURRENT",
  documentId: row.document_id,
  documentVersionId: row.intake_version_id,
  locator: `${row.logical_name} printed standalone symbol "T" glyphs`,
  extractedText: `Sheet ${row.logical_name} carries ${row.n} printed standalone "T" symbols (occurrence evidence only; not a quantity authority).`,
  isVisualSource: true,
}));

// ── C: WLC local multiplicity note ─────────────────────────────────────────
// Exact-label matching only. A wildcard pattern here also matches unrelated
// revision-block strings, which is how non-evidence gets read as evidence.
const wlcMultiplicityEvidence = q(
  `SELECT a.id AS asset_id, a.text_content, a.bounding_box, p.page_number,
          d.id AS document_id, d.logical_name, v.id AS intake_version_id
     FROM drawing_assets a
     JOIN drawing_pages p ON p.id = a.page_id
     JOIN drawing_intake_versions v ON v.id = a.intake_version_id
     JOIN documents d ON d.id = v.document_id
    WHERE d.project_id = ? AND v.superseded_at IS NULL AND a.asset_type = 'Text'
      AND d.logical_name LIKE '%WLC-DR-T-93%' AND trim(a.text_content) = ?
    ORDER BY a.bounding_box LIMIT 8`,
  PROJECT_ID, "2 Nos",
).map((row) => drawingEvidence(row, {
  extractedText: `PRINTED MULTIPLICITY LABEL "${row.text_content}" on ${row.logical_name} (the sheet does not state what this label counts).`,
}));

// The cable note is wrapped across two extracted text assets on the same sheet.
// Reconstructed deterministically from both, and labelled as reconstructed.
const wlcNoteFragments = q(
  `SELECT a.id AS asset_id, a.text_content, a.bounding_box, p.page_number,
          d.id AS document_id, d.logical_name, v.id AS intake_version_id
     FROM drawing_assets a
     JOIN drawing_pages p ON p.id = a.page_id
     JOIN drawing_intake_versions v ON v.id = a.intake_version_id
     JOIN documents d ON d.id = v.document_id
    WHERE d.project_id = ? AND v.superseded_at IS NULL AND a.asset_type = 'Text'
      AND d.logical_name LIKE '%WLC-DR-T-93%'
      AND (a.text_content LIKE '%PAIR%' OR a.text_content LIKE 'EACH FIREMAN%')
    ORDER BY a.bounding_box`,
  PROJECT_ID,
);
const wlcNoteEvidence = wlcNoteFragments.length
  ? [{
    evidenceKey: wlcNoteFragments[0].asset_id,
    projectId: PROJECT_ID,
    scope: "PROJECT",
    sourceType: "Drawing",
    governanceState: "CANDIDATE_NOT_APPROVED",
    currentness: "CURRENT",
    documentId: wlcNoteFragments[0].document_id,
    documentVersionId: wlcNoteFragments[0].intake_version_id,
    locator: `${wlcNoteFragments[0].logical_name} p${wlcNoteFragments[0].page_number} local note, reconstructed from ${wlcNoteFragments.length} wrapped text assets (${wlcNoteFragments.map((f) => f.asset_id).join(" + ")})`,
    extractedText: `LOCAL NOTE (wrapped across ${wlcNoteFragments.length} extracted text assets): ${wlcNoteFragments.map((f) => f.text_content.trim()).join(" ")}`,
    isVisualSource: true,
  }]
  : [];

// ── BOQ / Specification retrieval ──────────────────────────────────────────
const boqTelephone = q(
  `SELECT * FROM boq_items
    WHERE project_id = ? AND review_status IS NOT NULL
      AND (description LIKE '%ELEPHONE%' OR description LIKE '%Fireman telephone%')
    ORDER BY sequence LIMIT 10`,
  PROJECT_ID,
).map(boqEvidence);

const boqCable = q(
  `SELECT * FROM boq_items
    WHERE project_id = ? AND (description LIKE '%CABLE%' OR description LIKE '%PAIR%')
    ORDER BY sequence LIMIT 8`,
  PROJECT_ID,
).map(boqEvidence);

// Per-candidate concept lookup: the search term is the RECOVERED LEGEND TEXT,
// never a hardcoded device name. A legend recovered for any symbol gets its own
// corroboration instead of silently inheriting a neighbour's evidence.
const conceptEvidence = (description) => {
  const concept = String(description || "").replace(/\s*\(.*?\)\s*/g, " ").trim();
  if (concept.length < 4) return [];
  const like = `%${concept}%`;
  return [
    ...q(
      `SELECT * FROM boq_items WHERE project_id = ? AND description LIKE ? ORDER BY sequence LIMIT 3`,
      PROJECT_ID, like,
    ).map(boqEvidence),
    ...q(
      `SELECT * FROM technical_requirements WHERE project_id = ? AND original_text LIKE ? ORDER BY sequence LIMIT 3`,
      PROJECT_ID, like,
    ).map(specEvidence),
  ];
};
const legendConceptEvidence = EXACT_SYMBOLS.flatMap((symbol) => {
  const pair = legendPairs.find((entry) => entry.symbol === symbol);
  return conceptEvidence(pair ? pair.description : "");
});

const specTelephone = q(
  `SELECT * FROM technical_requirements
    WHERE project_id = ? AND (original_text LIKE '%telephone%' OR original_text LIKE '%Telephone%')
    ORDER BY sequence LIMIT 10`,
  PROJECT_ID,
).map(specEvidence);

const specCable = q(
  `SELECT * FROM technical_requirements
    WHERE project_id = ?
      AND (original_text LIKE '%pair%' OR original_text LIKE '%conductor%' OR original_text LIKE '%Cable%' OR original_text LIKE '%cable%')
    ORDER BY sequence LIMIT 10`,
  PROJECT_ID,
).map(specEvidence);

// ── Questions ──────────────────────────────────────────────────────────────
const questions = [
  {
    questionId: "A",
    question: "For the current Fire Alarm legend sheet, do current-project BOQ and Specification evidence corroborate the recovered legend definitions T, S, H, ZIM, FTCP and FARP?",
    questionType: "LEGEND_DEFINITION_CORROBORATION",
    focusDimension: "DEVICE_TERMINOLOGY",
    candidates: EXACT_SYMBOLS.map((symbol) => {
      const pair = legendPairs.find((entry) => entry.symbol === symbol);
      return { label: `${symbol} => ${pair ? pair.description : "unknown"}` };
    }),
    evidence: [...legendPairEvidence, ...legendHeadingEvidence, ...legendConceptEvidence, ...boqTelephone, ...specTelephone],
  },
  {
    questionId: "B",
    question: "Does current-project evidence corroborate that the printed symbol T on the fire-alarm T-93 sheets means FIREMAN TELEPHONE JACK?",
    questionType: "SYMBOL_IDENTITY",
    focusDimension: VISUAL_IDENTITY_FOCUS,
    candidates: [{ label: "T => FIREMAN TELEPHONE JACK" }],
    evidence: [
      ...legendPairEvidence.filter((item) => item.extractedText.startsWith('LEGEND SYMBOL "T"')),
      ...legendForEvidence,
      ...tOccurrenceEvidence,
      ...boqTelephone,
      ...specTelephone,
    ],
  },
  {
    questionId: "C",
    question: "On the WLC T-93 sheet, each printed T symbol is annotated with a printed 2 Nos label, and a local note states one pair of telephone cable for each fireman telephone jack. Does current-project evidence resolve whether the printed 2 Nos refers to physical fireman telephone jacks, to cable pairs, or to something else?",
    questionType: "PRINTED_MULTIPLICITY_REFERENT",
    focusDimension: VISUAL_IDENTITY_FOCUS,
    candidates: [
      { label: "printed 2 Nos = number of jacks" },
      { label: "printed 2 Nos = cable pairs" },
      { label: "printed 2 Nos = some other object" },
      { label: "printed 2 Nos referent remains ambiguous" },
    ],
    evidence: [...wlcMultiplicityEvidence, ...wlcNoteEvidence, ...boqCable, ...boqTelephone, ...specCable, ...specTelephone],
  },
];

// ── Run ────────────────────────────────────────────────────────────────────
const env = readEnv(".dev.vars");
const provider = createConfiguredNvidiaNimStructuredProvider(env, {
  schema: REASONING_RESULT_SCHEMA,
  maxTokens: 2048,
});

if (!provider) {
  console.error("REASONER_RUN = ABORTED (no configured text reasoning provider)");
  process.exit(1);
}

// Deterministic retriever for the bounded second pass: serves ONLY the exact
// allowlisted concepts the model asked for, and only from this project. Hard
// capped -- a broad term must never turn a targeted request into a project dump.
const MAX_FETCHED_PER_REQUEST = 6;
const MAX_FETCHED_TOTAL = 12;
const retrieveEvidence = async ({ projectId, requests }) => {
  const out = [];
  for (const request of requests) {
    if (projectId !== PROJECT_ID) continue;
    const term = `%${request.term.replace(/[%_]/g, "")}%`;
    if (out.length >= MAX_FETCHED_TOTAL) break;
    let fetched = [];
    if (request.kind === "BOQ_CONCEPT") {
      fetched = q(
        `SELECT * FROM boq_items WHERE project_id = ? AND description LIKE ? ORDER BY sequence LIMIT ?`,
        PROJECT_ID, term, MAX_FETCHED_PER_REQUEST,
      ).map(boqEvidence);
    } else if (request.kind === "SPEC_CONCEPT") {
      fetched = q(
        `SELECT * FROM technical_requirements WHERE project_id = ? AND original_text LIKE ? ORDER BY sequence LIMIT ?`,
        PROJECT_ID, term, MAX_FETCHED_PER_REQUEST,
      ).map(specEvidence);
    } else if (request.kind === "LEGEND_EVIDENCE") {
      fetched = textAssets({ docId: legendDoc.id, pattern: term })
        .filter((row) => row.page_number === 1)
        .slice(0, MAX_FETCHED_PER_REQUEST)
        .map((row) => drawingEvidence(row));
    } else if (request.kind === "DRAWING_TEXT" || request.kind === "DRAWING_GEOMETRY") {
      fetched = textAssets({ pattern: term }).slice(0, MAX_FETCHED_PER_REQUEST).map((row) => drawingEvidence(row));
    } else if (request.kind === "CROSS_SHEET_RELATION") {
      fetched = legendForEvidence.slice(0, MAX_FETCHED_PER_REQUEST);
    }
    out.push(...fetched);
  }
  return out.slice(0, MAX_FETCHED_TOTAL);
};

const results = [];
for (const spec of questions) {
  const started = Date.now();
  // One transport-only retry: a provider transport blip must not cost the human
  // a review packet. This retries the CALL, never the reasoning semantics.
  let outcome = null;
  for (let attempt = 0; attempt < 2 && !outcome; attempt += 1) {
    outcome = await reasonAcrossProjectEvidence({
      projectId: PROJECT_ID,
      questionId: spec.questionId,
      question: spec.question,
      questionType: spec.questionType,
      focusDimension: spec.focusDimension,
      candidates: spec.candidates,
      evidence: spec.evidence,
      provider,
      retrieveEvidence,
    });
    if (outcome.failClosedReason === "MODEL_PROVIDER_FAILURE") {
      outcome = null;
      if (attempt === 0) console.log(`   (${spec.questionId}: provider transport failure, retrying once)`);
    }
  }
  const result = { ...(outcome ?? {}), durationMs: Date.now() - started };
  results.push(result);
  const rel = (sourceType) => result.evidenceAssessment
    .filter((entry) => entry.sourceType === sourceType)
    .map((entry) => `${entry.evidenceId}:${entry.relationship}(${entry.authorityCeiling})`)
    .join(" ") || "NONE";
  console.log(
    [
      `Q${spec.questionId}`,
      result.status,
      result.recommendedAction,
      `conf=${result.modelConfidence}`,
      `calls=${result.modelCalls}`,
      `requests=${result.evidenceRequestsFulfilled}`,
      `${result.durationMs}ms`,
    ].join(" | "),
  );
  if (result.failClosedReason) console.log(`   FAIL-CLOSED: ${result.failClosedReason} ${result.modelError ? `(${result.modelError})` : ""} ${(result.errors || []).join(",")}`);
  console.log(`   BOQ: ${rel("BOQ")}`);
  console.log(`   SPEC: ${rel("Specification")}`);
  console.log(`   DRAWING: ${rel("Drawing")}`);
  if (result.contradictions?.length) console.log(`   contradictions: ${result.contradictions.join(" ; ")}`);
  if (result.firewallNotes?.length) console.log(`   firewall: ${result.firewallNotes.join(" ; ")}`);
  console.log(`   interpretation: ${result.proposedInterpretation ?? "(fail-closed)"}`);
}

const packet = buildReasoningReviewPacket({
  results,
  optionsByQuestionId: {
    A: ["APPROVE_EXACT_LEGEND_DEFINITIONS", "APPROVE_SELECTED", "REJECT", "DEFER"],
    B: ["APPROVE_T_IDENTITY", "APPROVE_APPLICABILITY_ONLY", "KEEP_NOT_PROVEN"],
    C: ["JACKS", "CABLE_PAIRS", "OTHER", "KEEP_AMBIGUOUS"],
  },
});

mkdirSync("out/benchmark/vision-bakeoff/omair-review", { recursive: true });
writeFileSync(
  "out/benchmark/vision-bakeoff/omair-review/ai-corroboration.json",
  JSON.stringify({
    projectId: PROJECT_ID,
    model: results[0]?.model ?? null,
    reasonerVersion: "project-evidence-reasoner-1.0.0",
    authorityStatus: "AI_PROPOSED",
    results,
    reviewPacket: packet,
  }, null, 1),
);

console.log("\n=== Omair review packet ===");
for (const entry of packet) {
  console.log(`\n[${entry.questionId}] ${entry.status} -> recommend ${entry.aiRecommendation} (conf ${entry.confidence}, authority ${entry.authorityStatus})`);
  console.log(`  support: ${entry.strongestSupport ? `${entry.strongestSupport.evidenceId} ${entry.strongestSupport.sourceType}/${entry.strongestSupport.relationship} @ ${entry.strongestSupport.locator}` : "none"}`);
  console.log(`  contradiction: ${entry.strongestContradiction ? `${entry.strongestContradiction.evidenceId} @ ${entry.strongestContradiction.locator}` : "none"}`);
  console.log(`  options: ${entry.options.join(" / ")}`);
}

console.log(`\nAI_REASONING_CALLS = ${results.reduce((sum, r) => sum + (r.modelCalls || 0), 0)}`);
console.log(`ITERATIVE_EVIDENCE_REQUESTS = ${results.reduce((sum, r) => sum + (r.evidenceRequestsFulfilled || 0), 0)}`);
console.log("AI_AUTHORITY_WRITES = 0");
console.log("QUANTITY_CLAIMS_CREATED = 0");
db.close();
