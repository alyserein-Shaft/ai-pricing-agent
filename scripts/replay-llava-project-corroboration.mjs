#!/usr/bin/env node
// REPLAY: stored LLaVA observations -> normalized evidence -> CURRENT-PROJECT
// corroboration -> deterministic gates -> final proposal state.
//
// READ-ONLY. Calls NO model. Uses ONLY the stored LLaVA outputs already on disk.
// Does not persist anything.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { runProjectCorroboration } from "../app/domain/drawing-visual-project-corroboration.mjs";

const PROJECT_ID = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";
const RAW = "out/benchmark/vision-bakeoff/vision-bakeoff-2026-10-04/raw.jsonl";
const DB =
  ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
const LLAVA = "@cf/llava-hf/llava-1.5-7b-hf";

const A = {
  LEGEND: "PROJECT_LEGEND_GOVERNED",
  DRAWING: "PROJECT_DRAWING_APPROVED",
  BOQ: "PROJECT_BOQ",
  MFR: "MANUFACTURER_DATASHEET",
};

/**
 * Build the CURRENT-PROJECT evidence index.
 *
 * PROJECT SCOPING IS THE WHOLE POINT. The drawing tables carry NO project_id;
 * they reach a project only through drawing_intake_versions.project_id. An
 * unscoped read would mix in five other projects (4301 search entries unscoped
 * vs 1267 in scope; 56 legend entries unscoped vs 16 in scope).
 */
const buildEvidenceIndex = (db) => {
  const items = [];
  const push = (o) => items.push(o);

  for (const r of db
    .prepare(
      `SELECT l.id AS item_id, l.entry_type, l.label, l.description, l.review_status,
              v.document_id, v.document_version_id, v.id AS intake_version_id
         FROM drawing_legend_entries l
         JOIN drawing_legends g      ON g.id = l.legend_id
         JOIN drawing_intake_versions v ON v.id = g.intake_version_id
        WHERE v.project_id = ?`,
    )
    .all(PROJECT_ID)) {
    push({
      itemId: `legend:${r.item_id}`,
      projectId: PROJECT_ID,
      sourceType: "DRAWING_LEGEND",
      authorityClass: A.LEGEND,
      reviewState: r.review_status,
      currentness: "CURRENT",
      documentId: r.document_id,
      documentVersionId: r.document_version_id,
      locator: `legend_entry ${r.item_id} (${r.entry_type})`,
      label: r.label,
      text: r.label,
      description: r.description,
    });
  }

  // Other drawing sheets' text, PROJECT-SCOPED. Each page is its own evidence item.
  for (const r of db
    .prepare(
      `SELECT s.id AS item_id, s.page_number, s.text_content, s.drawing_number, s.sheet_name,
              v.document_id, v.document_version_id
         FROM drawing_search_entries s
         JOIN drawing_intake_versions v ON v.id = s.intake_version_id
        WHERE v.project_id = ?
        ORDER BY s.page_number LIMIT 1400`,
    )
    .all(PROJECT_ID)) {
    push({
      itemId: `search:${r.item_id}`,
      projectId: PROJECT_ID,
      sourceType: "DRAWING_PAGE_TEXT",
      // OCR text is evidence, never an approved drawing fact.
      authorityClass: A.DRAWING,
      reviewState: "Needs Review",
      currentness: "CURRENT",
      documentId: r.document_id,
      documentVersionId: r.document_version_id,
      locator: `page ${r.page_number}${r.drawing_number ? ` of ${r.drawing_number}` : ""}${r.sheet_name ? ` (${r.sheet_name})` : ""}`,
      text: r.text_content,
      label: r.drawing_number || r.sheet_name,
    });
  }

  for (const r of db
    .prepare(`SELECT id, description, original_quantity, numeric_quantity FROM boq_items WHERE project_id = ?`)
    .all(PROJECT_ID)) {
    push({
      itemId: `boq:${r.id}`,
      projectId: PROJECT_ID,
      sourceType: "BOQ",
      authorityClass: A.BOQ,
      reviewState: null,
      currentness: "CURRENT",
      documentId: null,
      documentVersionId: null,
      locator: `BOQ item ${r.id}`,
      label: r.description,
      text: r.description,
    });
  }

  return { projectId: PROJECT_ID, items };
};

const main = () => {
  const rows = readFileSync(RAW, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const cases = rows.filter((r) => r.model === LLAVA);
  const db = new DatabaseSync(DB, { readOnly: true });
  const evidenceIndex = buildEvidenceIndex(db);
  db.close();

  console.log(`STORED LLaVA CASES REPLAYED : ${cases.length}`);
  console.log(`EVIDENCE INDEX (project-scoped): ${evidenceIndex.items.length} items for ${PROJECT_ID}`);
  console.log(`   legend=${evidenceIndex.items.filter((i) => i.sourceType === "DRAWING_LEGEND").length}` +
    `  pageText=${evidenceIndex.items.filter((i) => i.sourceType === "DRAWING_PAGE_TEXT").length}` +
    `  boq=${evidenceIndex.items.filter((i) => i.sourceType === "BOQ").length}`);

  const out = [];
  let manufactured = 0;

  for (const c of cases) {
    // Each stored case is treated as its own source document so that corroboration
    // is genuinely CROSS-document rather than self-referential.
    const result = runProjectCorroboration({
      caseId: c.caseId,
      description: c.finalResponse || "",
      kind: c.caseKind,
      sourceDocument: { id: `stored-image:${c.imageFile}`, documentVersionId: null, drawingNumber: c.imageFile },
      revision: null,
      imageProvenance: [{ file: c.imageFile, bytes: c.imageBytes }],
      modelInfo: { provider: c.provider, visionModel: c.model, synthesisModel: "NONE_REPLAY_STORED" },
      evidenceIndex,
      // The stored observation is prose; any printed count it mentions is evidence only.
      quantityClaims: /\b\d+\s*(?:nos?|pcs?)\b/i.test(c.finalResponse || "") ? [{ source: "stored LLaVA prose", note: "printed quantity is evidence, never authority" }] : [],
    });
    manufactured += result.manufactured.PROJECT_CONTEXT_MANUFACTURED_VISUAL_FACTS;

    const rec = {
      case: c.caseId,
      kind: c.caseKind,
      image: c.imageFile,
      expectedNote: c.referenceExpected?.note ?? null,
      localObservation: result.observation.rawModelObservation,
      observedTokens: result.observation.observedTokens,
      quotedText: result.observation.observed_text,
      projectEvidenceFound: result.relationships.length,
      crossDocument: result.gates.counts.crossDocument ?? 0,
      supporting: result.relationships.filter((r) => r.relationship === "SUPPORTS").map((r) => ({ item: r.itemId, tokens: r.anchorTokens, auth: r.authorityClass, review: r.reviewState, at: r.provenance.locator })),
      clarifying: result.relationships.filter((r) => r.relationship === "CLARIFIES").map((r) => ({ item: r.itemId, tokens: r.anchorTokens, auth: r.authorityClass, review: r.reviewState, at: r.provenance.locator })),
      contradicting: result.relationships.filter((r) => r.relationship === "CONTRADICTS"),
      relatedNonAuth: result.relationships.filter((r) => r.relationship === "RELATED_BUT_NON_AUTHORITATIVE").length,
      conflict: result.conflict.state,
      authorityClassTop: result.relationships[0]?.authorityClass ?? null,
      finalState: result.gates.finalState,
      outcome: result.gates.outcome,
      hardReviewReasons: result.gates.hardReviewReasons,
      manufactured: result.manufactured.PROJECT_CONTEXT_MANUFACTURED_VISUAL_FACTS,
      fingerprint: result.fingerprint?.slice(0, 16) ?? null,
    };
    out.push(rec);
  }

  console.log("\n" + "=".repeat(104));
  for (const r of out) {
    console.log(`\n########## CASE ${r.case}  (${r.kind})  ${r.image}`);
    console.log(`  expected      : ${r.expectedNote}`);
    console.log(`  LOCAL_OBSERVATION   : ${r.localObservation.slice(0, 150)}...`);
    console.log(`  observed tokens     : ${r.observedTokens.join(", ") || "(none)"}`);
    console.log(`  quoted text seen    : ${r.quotedText.length ? r.quotedText.join(" | ") : "(none)"}`);
    console.log(`  PROJECT_EVIDENCE_FOUND: ${r.projectEvidenceFound} (cross-document ${r.crossDocument})`);
    console.log(`  SUPPORTING   : ${r.supporting.length ? JSON.stringify(r.supporting) : "(none)"}`);
    console.log(`  CLARIFYING   : ${r.clarifying.length ? JSON.stringify(r.clarifying.slice(0, 3)) : "(none)"}`);
    console.log(`  CONTRADICTING: ${r.contradicting.length}`);
    console.log(`  RELATED_NON_AUTH: ${r.relatedNonAuth}`);
    console.log(`  AUTHORITY_CLASS: ${r.authorityClassTop}`);
    console.log(`  conflict     : ${r.conflict}`);
    console.log(`  FINAL_RESULT : ${r.finalState}  [${r.outcome}]  reasons=${JSON.stringify(r.hardReviewReasons)}`);
    console.log(`  manufactured : ${r.manufactured}`);
  }

  console.log("\n" + "=".repeat(104));
  const summary = {
    cases: out.length,
    PROJECT_CONTEXT_MANUFACTURED_VISUAL_FACTS: manufactured,
    finalStates: out.reduce((a, r) => ({ ...a, [r.finalState]: (a[r.finalState] || 0) + 1 }), {}),
    outcomes: out.reduce((a, r) => ({ ...a, [r.outcome]: (a[r.outcome] || 0) + 1 }), {}),
    ambiguitiesClarified: out.filter((r) => r.clarifying.length > 0).length,
    governedSupport: out.filter((r) => r.supporting.length > 0).length,
    contradictions: out.reduce((n, r) => n + r.contradicting.length, 0),
    evidenceIndexSize: evidenceIndex.items.length,
  };
  console.log("SUMMARY " + JSON.stringify(summary, null, 2));
  console.log(`\nPROJECT_CONTEXT_MANUFACTURED_VISUAL_FACTS = ${manufactured}`);
};

main();
