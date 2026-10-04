import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { parseDrawingStructure } from "../app/domain/drawing-structural-parser.mjs";
import { persist, canonicalCurrent, structureCompleteness } from "../worker/drawing-structural-parser-api.mjs";
import { currentStructure } from "../worker/drawing-structural-review-api.mjs";

// Drawing Structure Persistence Atomicity & Recovery Repair -- regression
// suite for the approved design (implementation step, NOT the governed T-00
// recovery). Every scenario runs against an in-memory D1-shaped fixture that
// mirrors the real schema; NO live D1 is touched here.
//
// The fixture intentionally primes the exact incident class:
//   v1 = Completed + current (the last valid evidence)
//   v2 = Processing, matching fingerprints, stranded/zero children
// and then a governed retry must produce:
//   v3 = Completed + current, correct payload
//   v2 = Failed / historical (superseded + audited)
//   v1 = superseded only after v3 completed.

const sha256hex = value => crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

const DDL = `
  CREATE TABLE documents (id TEXT PRIMARY KEY, current_version_id TEXT);
  CREATE TABLE drawing_intake_versions (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, version_number INTEGER NOT NULL, status TEXT NOT NULL, superseded_at TEXT);
  CREATE TABLE drawing_structure_versions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, document_id TEXT NOT NULL, document_version_id TEXT NOT NULL, drawing_intake_version_id TEXT NOT NULL, version_number INTEGER NOT NULL, input_fingerprint TEXT NOT NULL, output_fingerprint TEXT NOT NULL, parser_version TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL, review_status TEXT NOT NULL DEFAULT 'Needs Review', superseded_at TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE UNIQUE INDEX drawing_structure_document_version_idx ON drawing_structure_versions (document_id, version_number);
  CREATE TABLE drawing_structure_tables (id TEXT PRIMARY KEY, structure_version_id TEXT NOT NULL, table_key TEXT NOT NULL, page_number INTEGER NOT NULL, table_type TEXT NOT NULL, bounding_box TEXT NOT NULL, row_count INTEGER NOT NULL, column_count INTEGER NOT NULL, detection_confidence INTEGER NOT NULL, detection_method TEXT NOT NULL, source_region_key TEXT, section_title TEXT, review_status TEXT NOT NULL DEFAULT 'Needs Review', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE UNIQUE INDEX drawing_structure_table_key_idx ON drawing_structure_tables (structure_version_id, table_key);
  CREATE TABLE drawing_structure_rows (id TEXT PRIMARY KEY, table_id TEXT NOT NULL, row_number INTEGER NOT NULL, bounding_box TEXT, structural_confidence INTEGER NOT NULL, structural_status TEXT NOT NULL, physical_row_count INTEGER NOT NULL, review_status TEXT NOT NULL DEFAULT 'Needs Review', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE UNIQUE INDEX drawing_structure_row_idx ON drawing_structure_rows (table_id, row_number);
  CREATE TABLE drawing_structure_columns (id TEXT PRIMARY KEY, table_id TEXT NOT NULL, column_number INTEGER NOT NULL, bounding_box TEXT NOT NULL, width REAL NOT NULL, header_candidate TEXT, confidence INTEGER NOT NULL, review_status TEXT NOT NULL DEFAULT 'Needs Review', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE UNIQUE INDEX drawing_structure_column_idx ON drawing_structure_columns (table_id, column_number);
  CREATE TABLE drawing_structure_cells (id TEXT PRIMARY KEY, table_id TEXT NOT NULL, row_id TEXT NOT NULL, column_id TEXT NOT NULL, row_number INTEGER NOT NULL, column_number INTEGER NOT NULL, bounding_box TEXT NOT NULL, raw_content TEXT NOT NULL, reconstructed_content TEXT NOT NULL, original_fragments TEXT NOT NULL, confidence INTEGER NOT NULL, review_status TEXT NOT NULL DEFAULT 'Needs Review', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE UNIQUE INDEX drawing_structure_cell_idx ON drawing_structure_cells (table_id, row_number, column_number);
  CREATE TABLE drawing_structure_headers (id TEXT PRIMARY KEY, table_id TEXT NOT NULL, column_id TEXT NOT NULL, header_type TEXT NOT NULL, raw_content TEXT NOT NULL, bounding_box TEXT NOT NULL, source_fragment_ids TEXT NOT NULL, confidence INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE drawing_structure_regions (id TEXT PRIMARY KEY, structure_version_id TEXT NOT NULL, region_key TEXT NOT NULL, page_number INTEGER NOT NULL, region_type TEXT NOT NULL, bounding_box TEXT NOT NULL, raw_content TEXT NOT NULL, source_fragments TEXT NOT NULL, confidence INTEGER NOT NULL, detection_method TEXT NOT NULL, review_status TEXT NOT NULL DEFAULT 'Needs Review', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE drawing_structure_legend_rows (id TEXT PRIMARY KEY, table_id TEXT NOT NULL, row_id TEXT NOT NULL, source_page INTEGER NOT NULL, source_row INTEGER NOT NULL, symbol_geometry TEXT NOT NULL, abbreviation TEXT, description TEXT, notes TEXT, bounding_box TEXT, structural_confidence INTEGER NOT NULL, source_fragment_ids TEXT, review_status TEXT NOT NULL DEFAULT 'Needs Review', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE UNIQUE INDEX drawing_structure_legend_row_idx ON drawing_structure_legend_rows (table_id, source_row);
  CREATE TABLE drawing_structure_validation_issues (id TEXT PRIMARY KEY, structure_version_id TEXT NOT NULL, table_id TEXT NOT NULL, row_id TEXT, column_id TEXT, page_number INTEGER NOT NULL, issue_type TEXT NOT NULL, severity TEXT NOT NULL, bounding_box TEXT, detail TEXT NOT NULL, confidence INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'Open', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE drawing_structure_audit_events (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, document_id TEXT NOT NULL, structure_version_id TEXT NOT NULL, action TEXT NOT NULL, previous_value TEXT, new_value TEXT NOT NULL, reason TEXT NOT NULL, actor_user_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE drawing_title_block_field_reviews (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, structure_version_id TEXT NOT NULL, page_number INTEGER NOT NULL, field_key TEXT NOT NULL, value TEXT, status TEXT NOT NULL, reason TEXT NOT NULL, reviewed_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
`;

const makeDb = (options = {}) => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(DDL);
  raw.prepare("INSERT INTO documents (id, current_version_id) VALUES (?,?)").run("doc-1", "ver-1");
  raw.prepare("INSERT INTO drawing_intake_versions (id, document_id, version_number, status, superseded_at) VALUES (?,?,?,?,?)").run("intake-1", "doc-1", 1, "Completed", null);
  let batchCount = 0;
  const operation = (sql, args = []) => ({
    sql,
    first: async () => { const row = raw.prepare(sql).get(...args); return row === undefined ? null : row; },
    all: async () => ({ results: raw.prepare(sql).all(...args) }),
    run: async () => ({ meta: raw.prepare(sql).run(...args) }),
  });
  const db = {
    prepare: sql => ({ bind: (...args) => operation(sql, args) }),
    batch: async statements => {
      batchCount += 1;
      if (options.failOnBatchIndex !== undefined && batchCount === options.failOnBatchIndex) throw new Error(options.failMessage || "simulated batch failure");
      raw.exec("BEGIN");
      try {
        for (const statement of statements) await statement.run();
        raw.exec("COMMIT");
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { raw, db };
};

const box = () => ({ x: 0, y: 0, width: 10, height: 10 });

// Internally consistent synthetic parse result (persist consumes exactly the
// fields built here). Counts are free-form EXCEPT they must be reproduced by
// the persisted children -- that invariant is what structureCompleteness
// validates and what tests M/N/O assert. The real T-00 fixture test below
// exercises the real 1.7.0 payload instead.
const buildResult = (options = {}) => {
  const { tableCount = 1, rowsPerTable, cellsPerRow = 2, legendCount, regionCount = 1, issueCount = 0 } = options;
  const perTable = rowsPerTable ?? [3];
  const tables = [], rows = [], columns = [], cells = [], headers = [], legendRows = [], regions = [], validationIssues = [];
  for (let t = 0; t < tableCount; t++) {
    const tableKey = `p1:t${t + 1}`, isFire = t === 0, rowTotal = perTable[t] ?? 0;
    tables.push({ tableKey, page: 1, tableType: isFire ? "Legend" : "Table", boundingBox: box(), rowCount: rowTotal, columnCount: cellsPerRow, detectionConfidence: 90, detectionMethod: "fixture", sourceRegionKey: isFire ? "fa-region" : null, sectionTitle: isFire ? "FIRE ALARM SYSTEM" : null });
    for (let c = 1; c <= cellsPerRow; c++) {
      columns.push({ tableKey, columnNumber: c, boundingBox: box(), width: 10, headerCandidate: c === 1 ? "SYMBOL" : "DESCRIPTION", confidence: 90 });
      headers.push({ tableKey, columnNumber: c, headerType: c === 1 ? "SYMBOL" : "DESCRIPTION", rawContent: c === 1 ? "SYMBOL" : "DESCRIPTION", boundingBox: box(), sourceFragmentIds: [], confidence: 90 });
    }
    for (let r = 1; r <= rowTotal; r++) {
      rows.push({ tableKey, rowNumber: r, boundingBox: box(), confidence: 90, structuralStatus: "Complete", physicalRowCount: 1 });
      for (let c = 1; c <= cellsPerRow; c++) cells.push({ tableKey, rowNumber: r, columnNumber: c, boundingBox: box(), rawContent: "X", reconstructedContent: "X", originalFragments: [], confidence: 90 });
    }
  }
  const fireRows = rows.filter(row => row.tableKey === "p1:t1");
  const count = legendCount ?? Math.min(fireRows.length, 3);
  for (let i = 0; i < count; i++) legendRows.push({ tableKey: "p1:t1", sourcePage: 1, sourceRow: fireRows[i].rowNumber, symbolGeometry: [], abbreviation: null, description: `DEVICE ${i + 1}`, notes: null, boundingBox: box(), confidence: 90, sourceFragmentIds: [] });
  for (let r = 0; r < regionCount; r++) regions.push({ regionKey: `region-${r}`, page: 1, regionType: "Legend", boundingBox: box(), rawContent: "", sourceFragments: [], confidence: 90, detectionMethod: "fixture" });
  for (let i = 0; i < issueCount; i++) validationIssues.push({ tableKey: "p1:t1", rowNumber: 1, columnNumber: 1, page: 1, issueType: "WARN", severity: "low", boundingBox: box(), detail: "fixture issue", confidence: 90 });
  const summary = { pageCount: 1, tableCount: tables.length, rowCount: rows.length, columnCount: columns.length, cellCount: cells.length, headerCount: headers.length, legendRowCount: legendRows.length, regionCount: regions.length, validationIssueCount: validationIssues.length, averageStructuralConfidence: 90 };
  return { parserVersion: "drawing-structural-parser-1.7.0", pages: [{ pageNumber: 1, width: 2384, height: 3370 }], tables, rows, columns, cells, headers, legendRows, regions, validationIssues, sheetIdentities: [], crossSheetConsistency: [], summary };
};

const document = () => ({ id: "doc-1", project_id: "proj-1", version_id: "ver-1", sha256: "S" });
const intakeVersion = { id: "intake-1" };
const user = { id: "reviewer" };
const inputFingerprintFor = (sha256, intakeId = "intake-1", parser = "drawing-structural-parser-1.7.0") => sha256hex({ sha256, intake: intakeId, parser });

const seedVersion = (raw, { id, versionNumber, status = "Completed", inputFingerprint = "OLD_INPUT", outputFingerprint = "OLD_OUTPUT", documentVersionId = "ver-1", intakeId = "intake-1", parserVersion = "drawing-structural-parser-1.7.0", supersededAt = null, summary = {} }) => {
  raw.prepare("INSERT INTO drawing_structure_versions (id,project_id,document_id,document_version_id,drawing_intake_version_id,version_number,input_fingerprint,output_fingerprint,parser_version,status,summary,superseded_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, "proj-1", "doc-1", documentVersionId, intakeId, versionNumber, inputFingerprint, outputFingerprint, parserVersion, status, JSON.stringify(summary), supersededAt, "reviewer");
  return id;
};

const seedAudit = (raw, structureVersionId, action, overrides = {}) => raw.prepare("INSERT INTO drawing_structure_audit_events (id,project_id,document_id,structure_version_id,action,previous_value,new_value,reason,actor_user_id) VALUES (?,?,?,?,?,?,?,?,?)").run(`a_${structureVersionId}_${action}_${Math.random().toString(36).slice(2)}`, "proj-1", "doc-1", structureVersionId, action, overrides.previous_value ?? null, overrides.new_value ?? JSON.stringify({}), overrides.reason ?? "fixture", "reviewer");

// Mirrors persist()'s child INSERT loops so a seeded "valid Completed" can be
// laid down with the exact same physical shape a real success would write.
const seedChildrenFromResult = (raw, result, versionId) => {
  const tableIds = new Map(result.tables.map(table => [table.tableKey, `t_${versionId}_${table.tableKey}`]));
  const rowIds = new Map(result.rows.map(row => [`${row.tableKey}:${row.rowNumber}`, `r_${versionId}_${row.tableKey}_${row.rowNumber}`]));
  const columnIds = new Map(result.columns.map(column => [`${column.tableKey}:${column.columnNumber}`, `c_${versionId}_${column.tableKey}_${column.columnNumber}`]));
  for (const table of result.tables) raw.prepare("INSERT INTO drawing_structure_tables (id,structure_version_id,table_key,page_number,table_type,bounding_box,row_count,column_count,detection_confidence,detection_method,source_region_key,section_title) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(tableIds.get(table.tableKey), versionId, table.tableKey, table.page, table.tableType, JSON.stringify(table.boundingBox), table.rowCount, table.columnCount, table.detectionConfidence, table.detectionMethod, table.sourceRegionKey || null, table.sectionTitle || null);
  for (const row of result.rows) raw.prepare("INSERT INTO drawing_structure_rows (id,table_id,row_number,bounding_box,structural_confidence,structural_status,physical_row_count) VALUES (?,?,?,?,?,?,?)").run(rowIds.get(`${row.tableKey}:${row.rowNumber}`), tableIds.get(row.tableKey), row.rowNumber, JSON.stringify(row.boundingBox), row.confidence, row.structuralStatus, row.physicalRowCount);
  for (const column of result.columns) raw.prepare("INSERT INTO drawing_structure_columns (id,table_id,column_number,bounding_box,width,header_candidate,confidence) VALUES (?,?,?,?,?,?,?)").run(columnIds.get(`${column.tableKey}:${column.columnNumber}`), tableIds.get(column.tableKey), column.columnNumber, JSON.stringify(column.boundingBox), column.width, column.headerCandidate, column.confidence);
  for (const cell of result.cells) raw.prepare("INSERT INTO drawing_structure_cells (id,table_id,row_id,column_id,row_number,column_number,bounding_box,raw_content,reconstructed_content,original_fragments,confidence) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(`cell_${versionId}_${Math.random().toString(36).slice(2)}`, tableIds.get(cell.tableKey), rowIds.get(`${cell.tableKey}:${cell.rowNumber}`), columnIds.get(`${cell.tableKey}:${cell.columnNumber}`), cell.rowNumber, cell.columnNumber, JSON.stringify(cell.boundingBox), cell.rawContent, cell.reconstructedContent, JSON.stringify(cell.originalFragments), cell.confidence);
  for (const header of result.headers) raw.prepare("INSERT INTO drawing_structure_headers (id,table_id,column_id,header_type,raw_content,bounding_box,source_fragment_ids,confidence) VALUES (?,?,?,?,?,?,?,?)").run(`head_${versionId}_${Math.random().toString(36).slice(2)}`, tableIds.get(header.tableKey), columnIds.get(`${header.tableKey}:${header.columnNumber}`), header.headerType, header.rawContent, JSON.stringify(header.boundingBox), JSON.stringify(header.sourceFragmentIds), header.confidence);
  for (const row of result.legendRows) raw.prepare("INSERT INTO drawing_structure_legend_rows (id,table_id,row_id,source_page,source_row,symbol_geometry,abbreviation,description,notes,bounding_box,structural_confidence,source_fragment_ids) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(`legend_${versionId}_${Math.random().toString(36).slice(2)}`, tableIds.get(row.tableKey), rowIds.get(`${row.tableKey}:${row.sourceRow}`), row.sourcePage, row.sourceRow, JSON.stringify(row.symbolGeometry), row.abbreviation, row.description, row.notes, JSON.stringify(row.boundingBox), row.confidence, JSON.stringify(row.sourceFragmentIds || []));
  for (const region of result.regions || []) raw.prepare("INSERT INTO drawing_structure_regions (id,structure_version_id,region_key,page_number,region_type,bounding_box,raw_content,source_fragments,confidence,detection_method) VALUES (?,?,?,?,?,?,?,?,?,?)").run(`region_${versionId}_${Math.random().toString(36).slice(2)}`, versionId, region.regionKey, region.page, region.regionType, JSON.stringify(region.boundingBox), region.rawContent, JSON.stringify(region.sourceFragments), region.confidence, region.detectionMethod);
  for (const issue of result.validationIssues) raw.prepare("INSERT INTO drawing_structure_validation_issues (id,structure_version_id,table_id,row_id,column_id,page_number,issue_type,severity,bounding_box,detail,confidence) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(`issue_${versionId}_${Math.random().toString(36).slice(2)}`, versionId, tableIds.get(issue.tableKey), issue.rowNumber ? rowIds.get(`${issue.tableKey}:${issue.rowNumber}`) : null, issue.columnNumber ? columnIds.get(`${issue.tableKey}:${issue.columnNumber}`) : null, issue.page, issue.issueType, issue.severity, JSON.stringify(issue.boundingBox), issue.detail, issue.confidence);
};

const versionsByNumber = raw => raw.prepare("SELECT * FROM drawing_structure_versions WHERE document_id='doc-1' ORDER BY version_number").all();

// ---------------------------------------------------------------------------
// A. child insert failure does NOT supersede the current Completed structure
// ---------------------------------------------------------------------------
test("A: a child insert failure leaves the previous Completed version current and never canonizes the failed attempt", async () => {
  const { raw, db } = makeDb({ failOnBatchIndex: 2, failMessage: "simulated child write failure" });
  const result = buildResult();
  seedVersion(raw, { id: "v1", versionNumber: 1, status: "Completed", supersededAt: null });
  seedChildrenFromResult(raw, result, "v1");
  await assert.rejects(() => persist({ DB: db }, document(), intakeVersion, result, user), /simulated child write failure/);
  const rows = versionsByNumber(raw);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, "Completed");
  assert.equal(rows[0].superseded_at, null, "the valid Completed version must stay current after a failed retry");
  assert.equal(rows[1].status, "Failed", "best-effort failure marking prefers a definitive Failed state");
  assert.equal(rows[1].superseded_at, null);
  const audits = raw.prepare("SELECT * FROM drawing_structure_audit_events").all();
  assert.ok(!audits.some(entry => entry.structure_version_id === "v1"), "no audit is written against the still-current version");
  assert.ok(audits.some(entry => entry.structure_version_id === rows[1].id && entry.action === "Parse Failed"), "the failed retry attempt is audited");
});

// ---------------------------------------------------------------------------
// B + E + F + G + H + J. matching Processing fingerprint is NOT idempotent
// ---------------------------------------------------------------------------
test("B/E/F/G/H/J: a matching Processing shell is never idempotent; the retry becomes a fresh, higher version; v2 is Failed; v1 superseded only at final commit", async () => {
  const { raw, db } = makeDb();
  const result = buildResult();
  const inputFp = inputFingerprintFor("S");
  const outputFp = sha256hex(result);
  seedVersion(raw, { id: "v1", versionNumber: 1, status: "Completed", inputFingerprint: "OLD_INPUT", outputFingerprint: "OLD_OUTPUT", supersededAt: null });
  seedVersion(raw, { id: "v2", versionNumber: 2, status: "Processing", inputFingerprint: inputFp, outputFingerprint: outputFp, supersededAt: null });
  const outcome = await persist({ DB: db }, document(), intakeVersion, result, user);
  assert.equal(outcome.idempotent, false, "a matching fingerprints Processing artifact must never be returned as idempotent success");
  const rows = versionsByNumber(raw);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].id, "v1");
  assert.equal(rows[0].status, "Completed");
  assert.notEqual(rows[0].superseded_at, null, "v1 is superseded only once v3 completed (final commit)");
  assert.equal(rows[1].id, "v2");
  assert.equal(rows[1].status, "Failed", "the orphan Processing attempt becomes Failed and remains auditable");
  assert.equal(rows[2].version_number, 3, "version numbering uses MAX(version_number)+1 across ALL attempts");
  assert.equal(rows[2].status, "Completed");
  assert.equal(rows[2].superseded_at, null);
  assert.equal(rows[2].input_fingerprint, inputFp);
  assert.equal(rows[2].output_fingerprint, outputFp);
  const audits = raw.prepare("SELECT * FROM drawing_structure_audit_events ORDER BY created_at").all();
  const v2failure = audits.find(entry => entry.structure_version_id === "v2");
  assert.ok(v2failure, "orphan failure audit exists");
  assert.equal(v2failure.action, "Parse Failed");
  const recovery = JSON.parse(v2failure.new_value);
  assert.ok(recovery.recoveredBy && recovery.recoveredBy.version === 3, "failure audit records the recovery target");
  assert.equal(audits.filter(entry => entry.structure_version_id === rows[2].id && entry.action === "Parse").length, 1);
  const integrity = await structureCompleteness(db, rows[2].id, result);
  assert.equal(integrity.pass, true);
  const current = await canonicalCurrent(db, "doc-1");
  assert.equal(current.id, rows[2].id);
});

// ---------------------------------------------------------------------------
// C. matching incomplete children are NOT idempotent success
// ---------------------------------------------------------------------------
test("C: a matching incomplete structure is not idempotent success even when it has partial children", async () => {
  const { raw, db } = makeDb();
  const result = buildResult();
  const inputFp = inputFingerprintFor("S");
  const outputFp = sha256hex(result);
  seedVersion(raw, { id: "v1", versionNumber: 1, status: "Completed", inputFingerprint: "OLD_INPUT", outputFingerprint: "OLD_OUTPUT", supersededAt: null });
  seedVersion(raw, { id: "v2", versionNumber: 2, status: "Processing", inputFingerprint: inputFp, outputFingerprint: outputFp, supersededAt: null });
  // partial children: only the table row exists, all rows/cells/legend missing
  raw.prepare("INSERT INTO drawing_structure_tables (id,structure_version_id,table_key,page_number,table_type,bounding_box,row_count,column_count,detection_confidence,detection_method) VALUES (?,?,?,?,?,?,?,?,?,?)").run("t_partial", "v2", "p1:t1", 1, "Legend", JSON.stringify(box()), 3, 2, 90, "fixture");
  const outcome = await persist({ DB: db }, document(), intakeVersion, result, user);
  assert.equal(outcome.idempotent, false, "matching fingerprints with incomplete children must still not be idempotent");
  const rows = versionsByNumber(raw);
  assert.equal(rows.length, 3);
  assert.equal(rows[2].version_number, 3);
  assert.equal(rows[2].status, "Completed");
  assert.equal(rows[1].status, "Failed");
});

// ---------------------------------------------------------------------------
// D. matching valid Completed IS idempotent success
// ---------------------------------------------------------------------------
test("D: a matching valid Completed structure IS idempotent success", async () => {
  const { raw, db } = makeDb();
  const result = buildResult();
  const inputFp = inputFingerprintFor("S");
  const outputFp = sha256hex(result);
  seedVersion(raw, { id: "v1", versionNumber: 1, status: "Completed", inputFingerprint: inputFp, outputFingerprint: outputFp, supersededAt: null });
  seedChildrenFromResult(raw, result, "v1");
  seedAudit(raw, "v1", "Parse");
  const outcome = await persist({ DB: db }, document(), intakeVersion, result, user);
  assert.equal(outcome.idempotent, true);
  assert.equal(outcome.version.id, "v1");
  assert.equal(versionsByNumber(raw).length, 1, "no duplicate version is created");
  assert.equal(raw.prepare("SELECT count(*) count FROM drawing_structure_audit_events WHERE structure_version_id='v1' AND action='Parse'").get().count, 1);
});

// ---------------------------------------------------------------------------
// I. rerun after completion is idempotent with no duplicate version/audit
// ---------------------------------------------------------------------------
test("I: a successful rerun after completion is idempotent with no duplicate version or audit", async () => {
  const { raw, db } = makeDb();
  const result = buildResult();
  const first = await persist({ DB: db }, document(), intakeVersion, result, user);
  assert.equal(first.idempotent, false);
  const second = await persist({ DB: db }, document(), intakeVersion, result, user);
  assert.equal(second.idempotent, true);
  const rows = versionsByNumber(raw);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "Completed");
  assert.equal(rows[0].superseded_at, null);
  assert.equal(raw.prepare("SELECT count(*) count FROM drawing_structure_audit_events WHERE structure_version_id=? AND action='Parse'").get(rows[0].id).count, 1);
});

// ---------------------------------------------------------------------------
// J. MAX+1 across all versions including a pre-existing Failed orphan
// ---------------------------------------------------------------------------
test("J: version numbering uses MAX(version_number)+1 including previously failed/orphan attempts", async () => {
  const { raw, db } = makeDb();
  const result = buildResult();
  const inputFp = inputFingerprintFor("S");
  const outputFp = sha256hex(result);
  seedVersion(raw, { id: "v1", versionNumber: 1, status: "Completed", inputFingerprint: "OLD_INPUT", outputFingerprint: "OLD_OUTPUT", supersededAt: null });
  seedVersion(raw, { id: "v2", versionNumber: 2, status: "Failed", inputFingerprint: inputFp, outputFingerprint: outputFp, supersededAt: null });
  const outcome = await persist({ DB: db }, document(), intakeVersion, result, user);
  assert.equal(outcome.idempotent, false, "a matching Failed artifact is not idempotent success");
  const rows = versionsByNumber(raw);
  assert.equal(rows[2].version_number, 3, "the orphan v2 still occupies version 2, so the retry must take version 3");
});

// ---------------------------------------------------------------------------
// M/N/O. completeness gates
// ---------------------------------------------------------------------------
test("M: completeness check fails when table rows are missing", async () => {
  const { raw, db } = makeDb();
  const result = buildResult();
  seedVersion(raw, { id: "v1", versionNumber: 1, status: "Processing", inputFingerprint: "F", outputFingerprint: "F", supersededAt: null });
  raw.prepare("INSERT INTO drawing_structure_tables (id,structure_version_id,table_key,page_number,table_type,bounding_box,row_count,column_count,detection_confidence,detection_method) VALUES (?,?,?,?,?,?,?,?,?,?)").run("t_only", "v1", "p1:t1", 1, "Legend", JSON.stringify(box()), 3, 2, 90, "fixture");
  const integrity = await structureCompleteness(db, "v1", result);
  assert.equal(integrity.pass, false);
  assert.equal(integrity.actual.rows, 0);
  assert.ok(integrity.actual.rows < integrity.expected.rows);
});

test("N: completeness check fails when cells, legend rows, or regions are missing", async () => {
  const { raw, db } = makeDb();
  const result = buildResult();
  const versionId = seedVersion(raw, { id: "v1", versionNumber: 1, status: "Processing", inputFingerprint: "F", outputFingerprint: "F", supersededAt: null });
  seedChildrenFromResult(raw, result, versionId);
  raw.exec("DELETE FROM drawing_structure_cells");
  let integrity = await structureCompleteness(db, versionId, result);
  assert.equal(integrity.pass, false);
  assert.equal(integrity.actual.cells, 0);
  raw.exec("DELETE FROM drawing_structure_legend_rows");
  integrity = await structureCompleteness(db, versionId, result);
  assert.equal(integrity.pass, false);
  assert.equal(integrity.actual.legendRows, 0);
  raw.exec("DELETE FROM drawing_structure_regions");
  integrity = await structureCompleteness(db, versionId, result);
  assert.equal(integrity.pass, false);
  assert.equal(integrity.actual.regions, 0);
});

test("O: a successful structure satisfies every result-derived count", async () => {
  const { raw, db } = makeDb();
  const result = buildResult({ tableCount: 2, rowsPerTable: [3, 2], regionCount: 2, issueCount: 1 });
  const outcome = await persist({ DB: db }, document(), intakeVersion, result, user);
  assert.equal(outcome.idempotent, false);
  const integrity = await structureCompleteness(db, outcome.version.id, result);
  assert.equal(integrity.pass, true);
  assert.deepEqual(integrity.actual, integrity.expected);
});

// ---------------------------------------------------------------------------
// P. competing attempts cannot leave two current Completed structures
// ---------------------------------------------------------------------------
test("P: competing persistence attempts leave exactly one current Completed structure", async () => {
  const { raw, db } = makeDb();
  const resultA = buildResult();
  const outcomeA = await persist({ DB: db }, document(), intakeVersion, resultA, user);
  assert.equal(outcomeA.idempotent, false);
  const resultB = buildResult({ tableCount: 2, rowsPerTable: [2, 1], regionCount: 2 });
  const outcomeB = await persist({ DB: db }, { ...document(), sha256: "S2" }, intakeVersion, resultB, user);
  assert.equal(outcomeB.idempotent, false);
  const currents = raw.prepare("SELECT * FROM drawing_structure_versions WHERE document_id='doc-1' AND status='Completed' AND superseded_at IS NULL").all();
  assert.equal(currents.length, 1, "exactly one canonical current may exist");
  assert.equal(currents[0].id, outcomeB.version.id, "the newest completed evidence wins");
});

// ---------------------------------------------------------------------------
// K/L. stale upstream evidence cannot surface as review current
// ---------------------------------------------------------------------------
test("K: a Completed structure bound to a stale document version cannot surface as review current", async () => {
  const { raw, db } = makeDb();
  seedVersion(raw, { id: "v1", versionNumber: 1, status: "Completed", documentVersionId: "ver-1", intakeId: "intake-1", inputFingerprint: "A", outputFingerprint: "B", supersededAt: null });
  raw.prepare("UPDATE documents SET current_version_id='ver-2' WHERE id='doc-1'").run();
  let current = await currentStructure(db, { id: "doc-1" });
  assert.equal(current, null, "structure bound to ver-1 must not surface while the document sits on ver-2");
  seedVersion(raw, { id: "v2", versionNumber: 2, status: "Completed", documentVersionId: "ver-2", intakeId: "intake-1", inputFingerprint: "C", outputFingerprint: "D", supersededAt: null });
  current = await currentStructure(db, { id: "doc-1" });
  assert.equal(current.id, "v2", "the structure bound to the document's actual current version resolves");
});

test("L: a Completed structure bound to a stale intake version cannot surface as review current", async () => {
  const { raw, db } = makeDb();
  raw.prepare("INSERT INTO drawing_intake_versions (id, document_id, version_number, status, superseded_at) VALUES (?,?,?,?,?)").run("intake-2", "doc-1", 2, "Completed", null);
  seedVersion(raw, { id: "v1", versionNumber: 1, status: "Completed", documentVersionId: "ver-1", intakeId: "intake-1", inputFingerprint: "A", outputFingerprint: "B", supersededAt: null });
  const current = await currentStructure(db, { id: "doc-1" });
  assert.equal(current, null, "structure bound to superseded intake-1 must not surface while intake-2 is the newest Completed intake");
  seedVersion(raw, { id: "v2", versionNumber: 2, status: "Completed", documentVersionId: "ver-1", intakeId: "intake-2", inputFingerprint: "C", outputFingerprint: "D", supersededAt: null });
  const current2 = await currentStructure(db, { id: "doc-1" });
  assert.equal(current2.id, "v2", "the structure bound to the newest Completed intake resolves");
});

// ---------------------------------------------------------------------------
// Q. review current selector resolves the intended structure after recovery
// ---------------------------------------------------------------------------
test("Q: review current selector resolves the recovered canonical structure after a stranded-attempt recovery", async () => {
  const { raw, db } = makeDb();
  const result = buildResult();
  const inputFp = inputFingerprintFor("S");
  const outputFp = sha256hex(result);
  seedVersion(raw, { id: "v1", versionNumber: 1, status: "Completed", documentVersionId: "ver-1", intakeId: "intake-1", inputFingerprint: "OLD_INPUT", outputFingerprint: "OLD_OUTPUT", supersededAt: null });
  seedVersion(raw, { id: "v2", versionNumber: 2, status: "Processing", documentVersionId: "ver-1", intakeId: "intake-1", inputFingerprint: inputFp, outputFingerprint: outputFp, supersededAt: null });
  const outcome = await persist({ DB: db }, document(), intakeVersion, result, user);
  const current = await currentStructure(db, { id: "doc-1" });
  assert.equal(current.id, outcome.version.id, "review initialization resolves the recovered v3, never the orphan v2");
});

// ---------------------------------------------------------------------------
// T-00 real fixture: the canonical 1.7.0 payload, exact incident class
// ---------------------------------------------------------------------------
test("T-00 fixture: stranded Processing with matching fingerprints recovers to canonical v3 (087970…) with v2 Failed history and v1 superseded only at final commit", async t => {
  const path = "/Users/serein-b/Downloads/17- Fire Alarm/2401232-PC-AMS-DR-T-00-ZZZ-002.pdf";
  if (!fs.existsSync(path)) return t.skip("T-00 source unavailable");
  const rawPdf = fs.readFileSync(path);
  const result = await parseDrawingStructure(new Uint8Array(rawPdf));

  // Canonical 1.7.0 content expectations (the numbers belong ONLY to this
  // T-00 integration fixture, never generic persistence logic).
  assert.equal(result.parserVersion, "drawing-structural-parser-1.7.0");
  assert.equal(sha256hex(result), "087970ecebd722279cf89e0050486bd98b3cfc496964b3ca28a7ef0c0f67c600");
  assert.equal(result.tables.length, 3);
  assert.equal(result.rows.length, 26);
  assert.equal(result.cells.length, 50);
  assert.equal(result.legendRows.length, 24);
  const fireTable = result.tables.find(table => table.sectionTitle === "FIRE ALARM SYSTEM");
  assert.ok(fireTable);
  assert.equal(result.legendRows.filter(row => row.tableKey === fireTable.tableKey).length, 20);

  const { raw, db } = makeDb();
  const doc = { id: "doc-1", project_id: "proj-1", version_id: "ver-1", sha256: crypto.createHash("sha256").update(rawPdf).digest("hex") };
  const inputFp = inputFingerprintFor(doc.sha256);
  const outputFp = sha256hex(result);
  assert.equal(outputFp, "087970ecebd722279cf89e0050486bd98b3cfc496964b3ca28a7ef0c0f67c600");

  seedVersion(raw, { id: "v1", versionNumber: 1, status: "Completed", inputFingerprint: "OLD_INPUT", outputFingerprint: "OLD_OUTPUT", supersededAt: null });
  seedVersion(raw, { id: "v2", versionNumber: 2, status: "Processing", inputFingerprint: inputFp, outputFingerprint: outputFp, supersededAt: null });
  // v2 is deliberately the stranded shell -- zero children, matching fingerprints.

  const outcome = await persist({ DB: db }, doc, intakeVersion, result, user);
  assert.equal(outcome.idempotent, false);

  const rows = versionsByNumber(raw);
  assert.equal(rows.length, 3);
  const v1 = rows[0], v2 = rows[1], v3 = rows[2];
  assert.equal(v1.status, "Completed");
  assert.notEqual(v1.superseded_at, null, "v1 is superseded only after v3 completed");
  assert.equal(v2.id, "v2");
  assert.equal(v2.status, "Failed", "v2 becomes a Failed, auditable historical attempt");
  assert.notEqual(v2.superseded_at, null, "the orphan is also superseded by the recovery commit");
  assert.equal(v2.input_fingerprint, inputFp, "the orphan keeps its fingerprints");
  assert.equal(v3.version_number, 3);
  assert.equal(v3.status, "Completed");
  assert.equal(v3.superseded_at, null);
  assert.equal(v3.parser_version, "drawing-structural-parser-1.7.0");
  assert.equal(v3.input_fingerprint, inputFp);
  assert.equal(v3.output_fingerprint, "087970ecebd722279cf89e0050486bd98b3cfc496964b3ca28a7ef0c0f67c600");

  const summary = JSON.parse(v3.summary);
  assert.equal(summary.tableCount, 3);
  assert.equal(summary.rowCount, 26);
  assert.equal(summary.cellCount, 50);
  assert.equal(summary.legendRowCount, 24);
  assert.equal(summary.validationIssueCount, 1);

  const integrity = await structureCompleteness(db, v3.id, result);
  assert.equal(integrity.pass, true, "all 3 tables / 26 rows / 50 cells / 24 legend rows / 5 regions / 1 issue persisted");
  const faRows = raw.prepare("SELECT count(*) count FROM drawing_structure_legend_rows l JOIN drawing_structure_tables t ON t.id=l.table_id WHERE t.structure_version_id=? AND t.section_title='FIRE ALARM SYSTEM'").get(v3.id);
  assert.equal(faRows.count, 20, "20 Fire Alarm legend rows persisted");

  const audits = raw.prepare("SELECT * FROM drawing_structure_audit_events WHERE structure_version_id IN ('v1','v2',?) ORDER BY created_at").all(v3.id);
  assert.equal(audits.filter(entry => entry.action === "Parse").length, 1);
  assert.equal(audits.find(entry => entry.action === "Parse").structure_version_id, v3.id);
  assert.equal(audits.filter(entry => entry.action === "Parse Failed").length, 1);
  assert.equal(audits.find(entry => entry.action === "Parse Failed").structure_version_id, "v2");
  assert.ok(audits.find(entry => entry.action === "Parse Failed").previous_value);

  const current = await currentStructure(db, { id: "doc-1" });
  assert.equal(current.id, v3.id, "review initialization resolves exactly the recovered v3");
  assert.equal(current.output_fingerprint, "087970ecebd722279cf89e0050486bd98b3cfc496964b3ca28a7ef0c0f67c600");
});