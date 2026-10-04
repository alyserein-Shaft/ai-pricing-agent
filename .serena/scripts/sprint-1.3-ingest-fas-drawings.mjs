#!/usr/bin/env node
/**
 * Sprint 1.3 (Drawing Intake) -- Task: ingest the real Opera FAS riser
 * diagrams and legend sheet through the REAL, existing drawing-intake
 * pipeline (app/domain/drawing-intake-engine.mjs's extractDrawingStructure +
 * the exact same persistence shape as worker/drawing-intake-api.mjs's
 * persist()) rather than inventing a parallel subsystem.
 *
 * The only thing substituted here is the R2 object-fetch step (this dev
 * environment has no local R2 simulation set up for this project) -- the
 * real file bytes are read directly from the real, read-only Al Mespar/
 * Diriyah project folder on disk instead. Everything downstream (the
 * extraction engine call, the exact INSERT statements, the review_status
 * gating, the fingerprinting) is the real, unmodified production code path.
 *
 * Registers each source PDF as a real project `documents` + `document_versions`
 * row first (a genuine, honest registration of these real files as project
 * evidence -- not fabricated), then runs intake against it.
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { extractDrawingStructure, DRAWING_INTAKE_VERSION } from "../app/domain/drawing-intake-engine.mjs";

const dbPath = process.argv[2];
if (!dbPath) throw new Error("Usage: sprint-1.3-ingest-fas-drawings.mjs <db-path>");
const raw = new DatabaseSync(dbPath);
const PROJECT_ID = "project_c8d6ffe8-a781-4bdf-94aa-a40eea873920";
const USER_ID = "local-development-user";
const id = (prefix) => `${prefix}_${randomUUID()}`;
const FAS_DIR = "/Users/serein-b/Downloads/Projects/Opera Block Townhouses-Diriyah/Data/Low Current/FAS/DWG";

const FILES = [
  { path: `${FAS_DIR}/Legend/BV-BSW-127-0000-OMR-DWG-EL-100-0000100-A.pdf`, logicalName: "FAS Electrical Legend and Symbols Sheet 01", documentType: "Legend Sheet" },
  { path: `${FAS_DIR}/Riser/BV-BSW-127-0000-OMR-DWG-EL-800-1000300-A.pdf`, logicalName: "FAS Riser -- Small TH (Sheet 01)", documentType: "Riser Diagram" },
  { path: `${FAS_DIR}/Riser/BV-BSW-127-0000-OMR-DWG-EL-800-1000301-A.pdf`, logicalName: "FAS Riser -- Large TH (Sheet 02)", documentType: "Riser Diagram" },
  { path: `${FAS_DIR}/Riser/BV-BSW-127-0000-OMR-DWG-EL-800-1000302-A.pdf`, logicalName: "FAS Riser -- Corner A (Sheet 03)", documentType: "Riser Diagram" },
  { path: `${FAS_DIR}/Riser/BV-BSW-127-0000-OMR-DWG-EL-800-1000303-A.pdf`, logicalName: "FAS Riser -- Corner B (Sheet 04)", documentType: "Riser Diagram" },
  { path: `${FAS_DIR}/Riser/BV-BSW-127-0000-OMR-DWG-EL-800-1000350-A.pdf`, logicalName: "FAS Riser -- Male/Female Clubhouse (Sheet 01)", documentType: "Riser Diagram" },
  { path: `${FAS_DIR}/Riser/BV-BSW-127-0000-OMR-DWG-EL-800-1000351-A.pdf`, logicalName: "FAS Riser -- Family Clubhouse (Sheet 01)", documentType: "Riser Diagram" },
];

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (values = []) => ({
      first: async () => raw.prepare(sql).get(...values) || null,
      all: async () => ({ results: raw.prepare(sql).all(...values) }),
      run: async () => raw.prepare(sql).run(...values),
    });
    return { ...operation(), bind: (...values) => operation(values) };
  },
  async batch(statements) {
    raw.exec("BEGIN IMMEDIATE");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); raw.exec("COMMIT"); return results; }
    catch (error) { raw.exec("ROLLBACK"); throw error; }
  },
});
const DB = d1(raw);
const hash = (v) => createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");

const results = [];
for (const file of FILES) {
  const bytesBuffer = readFileSync(file.path);
  const bytes = new Uint8Array(bytesBuffer.buffer, bytesBuffer.byteOffset, bytesBuffer.byteLength);
  const sha256 = createHash("sha256").update(bytesBuffer).digest("hex");
  const originalFilename = file.path.split("/").pop();

  // Idempotent: reuse an existing document registration for the exact same
  // file content (matched by sha256) rather than re-registering it.
  let documentId = raw.prepare("SELECT d.id FROM documents d JOIN document_versions v ON v.id=d.current_version_id WHERE d.project_id=? AND v.sha256=?").get(PROJECT_ID, sha256)?.id;
  let versionId;
  if (documentId) {
    versionId = raw.prepare("SELECT current_version_id FROM documents WHERE id=?").get(documentId).current_version_id;
    console.log(`[document] already registered: ${file.logicalName} (${documentId})`);
  } else {
    documentId = id("doc");
    versionId = id("ver");
    raw.prepare(`INSERT INTO documents (id, project_id, logical_name, document_type, classification_source, current_version_id, created_by) VALUES (?,?,?,?,?,?,?)`)
      .run(documentId, PROJECT_ID, file.logicalName, file.documentType, "Real Al Mespar/Diriyah project source file (read-only project folder)", versionId, USER_ID);
    raw.prepare(`INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, source, uploaded_by) VALUES (?,?,1,?,?,?,?,?,?,?,?,?)`)
      .run(versionId, documentId, originalFilename, originalFilename, "pdf", "application/pdf", bytesBuffer.byteLength, sha256, file.path, "Sprint 1.3 Real Project File Registration", USER_ID);
    console.log(`[document] registered: ${file.logicalName} (${documentId})`);
  }

  // Real, unmodified extraction engine call.
  const extracted = await extractDrawingStructure(bytes, { fileName: originalFilename });

  const previous = raw.prepare("SELECT * FROM drawing_intake_versions WHERE document_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1").get(documentId);
  const inputFingerprint = hash({ sha256, parser: DRAWING_INTAKE_VERSION });
  const outputFingerprint = hash(extracted);
  if (previous?.input_fingerprint === inputFingerprint && previous?.output_fingerprint === outputFingerprint) {
    console.log(`[intake] idempotent -- unchanged since last run (${previous.id})`);
    results.push({ file: file.logicalName, documentId, intakeVersionId: previous.id, idempotent: true, summary: JSON.parse(previous.summary) });
    continue;
  }

  const intakeId = id("drawingIntake");
  const versionNumber = Number(previous?.version_number || 0) + 1;
  const pageIds = new Map(extracted.pages.map((p) => [p.pageNumber, id("drawingPage")]));

  const statements = [
    raw2(`INSERT INTO drawing_intake_versions (id,project_id,document_id,document_version_id,version_number,input_fingerprint,output_fingerprint,parser_version,status,summary,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [intakeId, PROJECT_ID, documentId, versionId, versionNumber, inputFingerprint, outputFingerprint, extracted.parserVersion, "Completed", JSON.stringify(extracted.summary), USER_ID]),
  ];
  if (previous) statements.push(raw2(`UPDATE drawing_intake_versions SET superseded_at=CURRENT_TIMESTAMP WHERE id=?`, [previous.id]));
  for (const c of extracted.documentClassifications) statements.push(raw2(`INSERT INTO drawing_document_classifications (id,intake_version_id,classification_type,confidence,extraction_method) VALUES (?,?,?,?,?)`, [id("drawingClass"), intakeId, c.type, c.confidence, c.method]));
  for (const p of extracted.pages) statements.push(raw2(`INSERT INTO drawing_pages (id,intake_version_id,page_number,width,height,coordinate_mode,classifications,text_count,source_review_status,extraction_method) VALUES (?,?,?,?,?,?,?,?,?,?)`, [pageIds.get(p.pageNumber), intakeId, p.pageNumber, p.width, p.height, p.coordinateMode, JSON.stringify(p.classifications), p.textCount, p.reviewStatus, p.extractionMethod]));
  statements.push(raw2(`INSERT INTO drawing_metadata (id,intake_version_id,drawing_number,revision,sheet_name,discipline,scale,issue_date,consultant,contractor,client,project_name,sheet_size,confidence,extraction_method) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id("drawingMeta"), intakeId, extracted.metadata.drawingNumber, extracted.metadata.revision, extracted.metadata.sheetName, extracted.metadata.discipline, extracted.metadata.scale, extracted.metadata.issueDate, extracted.metadata.consultant, extracted.metadata.contractor, extracted.metadata.client, extracted.metadata.projectName, extracted.metadata.sheetSize, 75, "Explicit title-block labels only"]));
  for (const a of extracted.assets) statements.push(raw2(`INSERT INTO drawing_assets (id,intake_version_id,page_id,asset_type,text_content,bounding_box,coordinates_available,detection_confidence,detection_method) VALUES (?,?,?,?,?,?,?,?,?)`, [id("drawingAsset"), intakeId, pageIds.get(a.pageNumber), a.assetType, a.text || null, a.boundingBox ? JSON.stringify(a.boundingBox) : null, a.coordinatesAvailable ? 1 : 0, a.detectionConfidence, a.detectionMethod]));
  for (const l of extracted.legends) {
    const legendId = id("drawingLegend");
    statements.push(raw2(`INSERT INTO drawing_legends (id,intake_version_id,page_id,legend_version,confidence,detection_method) VALUES (?,?,?,?,?,?)`, [legendId, intakeId, pageIds.get(l.pageNumber), l.legendVersion, l.confidence, l.detectionMethod]));
    for (const e of l.entries) statements.push(raw2(`INSERT INTO drawing_legend_entries (id,legend_id,sequence,entry_type,label,description,confidence) VALUES (?,?,?,?,?,?,?)`, [id("legendEntry"), legendId, e.sequence, e.entryType, e.label, e.description, e.confidence]));
  }
  for (const s of extracted.search) statements.push(raw2(`INSERT INTO drawing_search_entries (id,intake_version_id,page_id,page_number,text_content,drawing_number,sheet_name,tags) VALUES (?,?,?,?,?,?,?,?)`, [id("drawingSearch"), intakeId, pageIds.get(s.pageNumber), s.pageNumber, s.text, s.drawingNumber, s.sheetName, JSON.stringify(s.tags)]));

  for (const statement of statements) statement.run();
  raw.prepare(`INSERT INTO drawing_intake_audit_events (id,project_id,document_id,intake_version_id,action,previous_value,new_value,reason,actor_user_id) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id("drawingAudit"), PROJECT_ID, documentId, intakeId, "Drawing Intake Completed", previous ? JSON.stringify({ id: previous.id, version: previous.version_number }) : null, JSON.stringify({ version: versionNumber, summary: extracted.summary, classifications: extracted.documentClassifications }), "Sprint 1.3 (Drawing Intake): real FAS riser/legend ingestion via the existing drawing-intake pipeline", USER_ID);

  console.log(`[intake] completed v${versionNumber} (${intakeId}) -- ${JSON.stringify(extracted.summary)}`);
  results.push({ file: file.logicalName, documentId, intakeVersionId: intakeId, idempotent: false, summary: extracted.summary, classifications: extracted.documentClassifications });
}

function raw2(sql, values) { return { run: () => raw.prepare(sql).run(...values) }; }

console.log("\n=== SUMMARY ===");
console.log(JSON.stringify(results, null, 2));
