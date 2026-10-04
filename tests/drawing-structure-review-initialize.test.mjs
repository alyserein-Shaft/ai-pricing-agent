import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { parseDrawingStructure } from "../app/domain/drawing-structural-parser.mjs";
import { persist } from "../worker/drawing-structural-parser-api.mjs";
import { handleDrawingStructuralReviewApi } from "../worker/drawing-structural-review-api.mjs";
import { T00_LEGEND_DEFINITION_PROPOSALS } from "./golden/t00-review-proposals.fixture.mjs";

// Drawing Structure Review Initialization -- implementation + governance suite
// for Step 14.5. Every scenario runs against an in-memory D1-shaped fixture that
// mirrors the real schema; NO live D1 is touched (the governed T-00 population
// was created once against the live dev server, verified read-only separately).
//
// Coverage (A-R):
//   A  initialize resolves ONLY the current structure version
//   B  Processing structure cannot initialize (409)
//   C  Failed structure cannot initialize (409)
//   D  superseded Completed structure cannot initialize (409)
//   E  stale document-version structure cannot initialize (409)
//   F  stale intake structure cannot initialize (409)
//   G  review cases bind the exact structure version
//   H  review cases bind the exact legend row and its cells
//   I  Fire Alarm <=> PA/VA proposals never cross systems
//   J  Title Block contributes zero legend-review cases
//   K  null-abbreviation native-symbol rows survive without fabricated codes
//   L  same current structure cannot create duplicate cases (idempotent)
//   L2 stale proposal evidence refreshes pristine cases only, never touched ones
//   M  a new structure version never inherits an older version's approvals
//   N  initialization creates no technical approval
//   O  initialization creates no product-match / takeoff approval
//   P  initialization creates no pricing / commercial action
//   Q  full initialization provenance survives inside every snapshot
//   R  T-00 real integration: 20 FA + 4 PA/VA, 20 EXACT joins, no fabrication
//   +  UNATTRIBUTED rows are blocked, never silently initialized

const sha256hex = value => crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const now = () => new Date().toISOString();
const DEV_ID = "local-development-user";
const DEV_ORG = "organization_bd_shaft_internal_pilot";

const DDL = `
  CREATE TABLE projects (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, organization_id TEXT NOT NULL, name TEXT);
  CREATE TABLE documents (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, current_version_id TEXT, deleted_at TEXT);
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
  CREATE TABLE drawing_pages (id TEXT PRIMARY KEY, intake_version_id TEXT NOT NULL, page_number INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, coordinate_mode TEXT, rotation INTEGER);
  CREATE TABLE drawing_extraction_proposals (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, document_id TEXT NOT NULL, intake_version_id TEXT NOT NULL, page_number INTEGER NOT NULL, proposal_key TEXT NOT NULL, proposal_type TEXT NOT NULL, raw_label TEXT, normalized_value TEXT, bounding_box TEXT, confidence INTEGER, authority_role TEXT, governed_status TEXT, hard_review_reasons TEXT, evidence TEXT, source_references TEXT, extraction_method TEXT, extraction_version TEXT, review_status TEXT NOT NULL DEFAULT 'Needs Review', corrected_value TEXT, reviewed_by TEXT, visual_run_id TEXT, superseded_at TEXT, superseded_by_run_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE INDEX drawing_extraction_proposals_scope_idx ON drawing_extraction_proposals (document_id, proposal_type, intake_version_id, superseded_at);
  CREATE TABLE drawing_structure_review_cases (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, document_id TEXT NOT NULL, structure_version_id TEXT NOT NULL, legend_row_id TEXT NOT NULL, parent_case_id TEXT, case_version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'Needs Review', original_snapshot TEXT NOT NULL, current_snapshot TEXT NOT NULL, adjustments TEXT NOT NULL DEFAULT '[]', reviewed_by TEXT, reviewed_at TEXT, review_reason TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE UNIQUE INDEX drawing_structure_review_case_row_idx ON drawing_structure_review_cases (structure_version_id, legend_row_id);
  CREATE TABLE drawing_structure_review_events (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, document_id TEXT NOT NULL, structure_version_id TEXT NOT NULL, review_case_id TEXT NOT NULL, action TEXT NOT NULL, previous_snapshot TEXT NOT NULL, new_snapshot TEXT NOT NULL, reason TEXT NOT NULL, actor_user_id TEXT NOT NULL, actor_permission TEXT NOT NULL, request_id TEXT NOT NULL, case_version INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE drawing_structure_approved_versions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, document_id TEXT NOT NULL, source_structure_version_id TEXT NOT NULL, version_number INTEGER NOT NULL, input_fingerprint TEXT NOT NULL, output_fingerprint TEXT NOT NULL, status TEXT NOT NULL, approved_row_count INTEGER NOT NULL, excluded_row_count INTEGER NOT NULL, created_by TEXT NOT NULL, reason TEXT NOT NULL, superseded_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE UNIQUE INDEX drawing_structure_approved_version_idx ON drawing_structure_approved_versions (document_id, version_number);
  CREATE TABLE drawing_structure_approved_rows (id TEXT PRIMARY KEY, approved_version_id TEXT NOT NULL, review_case_id TEXT NOT NULL, source_legend_row_id TEXT NOT NULL, source_page INTEGER NOT NULL, source_row INTEGER NOT NULL, symbol_geometry TEXT NOT NULL, abbreviation TEXT, description TEXT, notes TEXT, bounding_box TEXT, structural_confidence INTEGER NOT NULL, review_actor_id TEXT NOT NULL, review_reason TEXT NOT NULL, source_snapshot TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE drawing_structure_approved_audit_events (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, document_id TEXT NOT NULL, approved_version_id TEXT NOT NULL, action TEXT NOT NULL, previous_value TEXT, new_value TEXT NOT NULL, reason TEXT NOT NULL, actor_user_id TEXT NOT NULL, request_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
`;

const makeDb = (documentId = "doc-1", projectId = "proj-1") => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(DDL);
  raw.prepare("INSERT INTO projects (id,owner_user_id,organization_id,name) VALUES (?,?,?,?)").run(projectId, DEV_ID, DEV_ORG, "Fixture Pilot");
  raw.prepare("INSERT INTO documents (id,project_id,current_version_id,deleted_at) VALUES (?,?,?,NULL)").run(documentId, projectId, "ver-1");
  raw.prepare("INSERT INTO drawing_intake_versions (id,document_id,version_number,status,superseded_at) VALUES (?,?,?,?,?)").run("intake-1", documentId, 1, "Completed", null);
  const operation = (sql, args = []) => ({
    sql,
    first: async () => { const row = raw.prepare(sql).get(...args); return row === undefined ? null : row; },
    all: async () => ({ results: raw.prepare(sql).all(...args) }),
    run: async () => ({ meta: raw.prepare(sql).run(...args) }),
  });
  const db = {
    prepare: sql => ({ bind: (...args) => operation(sql, args) }),
    batch: async statements => {
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

// ---------------------------------------------------------------------------
// Synthetic review fixture: realistic page-space geometry, one legend strip per
// row, symbol cell (col 1) and description cell (col 2) per row.
// ---------------------------------------------------------------------------
const stripFor = (course, index) => ({ x: 560, y: course + index * 150, width: 300, height: 130 });
const symbolCellBox = strip => ({ x: strip.x + 10, y: strip.y + 20, width: 40, height: 60 });
const descriptionCellBox = strip => ({ x: strip.x + 100, y: strip.y + 20, width: 170, height: 90 });

// fa/pa/title rows. `fa` and `pa` are legend tables; `title` is a Title Block.
const buildReviewResult = ({ fa = 3, pa = 2, title = 2, abbreviationFor = tableKey => row => `${tableKey === "ft" ? "S" : "P"}${row}`, empty = tableKey => () => false } = {}) => {
  const tables = [], rows = [], columns = [], cells = [], headers = [], legendRows = [], regions = [];
  const addTable = (tableKey, section, tableType, count, course) => {
    const base = stripFor(course, 0);
    tables.push({ tableKey, page: 1, tableType, boundingBox: { x: base.x, y: course - 60, width: 300, height: count * 150 + 60 }, rowCount: count, columnCount: 2, detectionConfidence: 92, detectionMethod: "fixture", sourceRegionKey: section ? `${tableKey}-region` : null, sectionTitle: section || null });
    for (let c = 1; c <= 2; c++) {
      columns.push({ tableKey, columnNumber: c, boundingBox: { x: base.x + (c - 1) * 100 - 40, y: course - 60, width: 100, height: 40 }, width: 100, headerCandidate: c === 1 ? "SYMBOL" : "DESCRIPTION", confidence: 90 });
      headers.push({ tableKey, columnNumber: c, headerType: c === 1 ? "SYMBOL" : "DESCRIPTION", rawContent: c === 1 ? "SYMBOL" : "DESCRIPTION", boundingBox: { x: base.x + (c - 1) * 100 - 40, y: course - 60, width: 100, height: 40 }, sourceFragmentIds: [], confidence: 90 });
    }
    for (let r = 1; r <= count; r++) {
      const strip = stripFor(course, r - 1);
      rows.push({ tableKey, rowNumber: r, boundingBox: strip, confidence: 92, structuralStatus: "Complete", physicalRowCount: 1 });
      const emptyCell = empty(tableKey)(r);
      cells.push({ tableKey, rowNumber: r, columnNumber: 1, boundingBox: symbolCellBox(strip), rawContent: emptyCell ? "" : "SYM", reconstructedContent: emptyCell ? "" : "SYM", originalFragments: emptyCell ? [] : [{ id: `${tableKey}:${r}:c1`, text: "SYM", boundingBox: symbolCellBox(strip) }], confidence: 90 });
      cells.push({ tableKey, rowNumber: r, columnNumber: 2, boundingBox: descriptionCellBox(strip), rawContent: emptyCell ? "" : `${section || "TITLE"} DEVICE ${r}`, reconstructedContent: emptyCell ? "" : `${section || "TITLE"} DEVICE ${r}`, originalFragments: emptyCell ? [] : [{ id: `${tableKey}:${r}:c2`, text: `${section || "TITLE"} DEVICE ${r}`, boundingBox: descriptionCellBox(strip) }], confidence: 90 });
      if (section) legendRows.push({ tableKey, sourcePage: 1, sourceRow: r, symbolGeometry: [], abbreviation: emptyCell ? null : abbreviationFor(tableKey)(r), description: emptyCell ? null : `${section} DEVICE ${r}`, notes: null, boundingBox: strip, confidence: 92, sourceFragmentIds: emptyCell ? [] : [`${tableKey}:${r}:c1`, `${tableKey}:${r}:c2`] });
    }
  };
  addTable("ft", "FIRE ALARM SYSTEM", "Legend", fa, 200);
  addTable("pt", "PUBLIC ADDRESS AND VOICE ALARM SYSTEM", "Legend", pa, 2600);
  addTable("tt", null, "Title Block", title, 3200);
  for (let r = 0; r < 1; r++) regions.push({ regionKey: "region-0", page: 1, regionType: "Legend", boundingBox: { x: 540, y: 160, width: 340, height: 400 }, rawContent: "", sourceFragments: [], confidence: 90, detectionMethod: "fixture" });
  const summary = { pageCount: 1, tableCount: tables.length, rowCount: rows.length, columnCount: columns.length, cellCount: cells.length, headerCount: headers.length, legendRowCount: legendRows.length, regionCount: regions.length, validationIssueCount: 0, averageStructuralConfidence: 92 };
  return { parserVersion: "drawing-structural-parser-1.7.0", pages: [{ pageNumber: 1, width: 2384, height: 3370 }], tables, rows, columns, cells, headers, legendRows, regions, validationIssues: [], sheetIdentities: [], crossSheetConsistency: [], summary };
};

// Synthetic LegendDefinition proposals, one per FT legend row, each matching the
// row's exact strip + symbol cell geometry (= proven EXACT spatial join).
const proposalsForResult = result => result.legendRows.filter(row => row.tableKey === "ft").map(row => {
  const strip = stripFor(200, row.sourceRow - 1);
  return {
    id: `fixture-proposal-fa-${row.sourceRow}`,
    proposalKey: `fixture-proposal-fa-${row.sourceRow}`,
    proposalType: "LegendDefinition",
    projectId: "proj-1",
    documentId: "doc-1",
    intakeVersionId: "intake-1",
    pageNumber: 1,
    rawLabel: row.abbreviation ?? null,
    normalizedMeaning: row.description,
    boundingBox: strip,
    evidence: {
      sequence: row.sourceRow,
      rawLabel: row.abbreviation ?? null,
      rawDescription: row.description,
      section: "FIRE ALARM SYSTEM",
      qualifiers: "",
      sourceDocumentVersionId: "ver-1",
      boundingBox: strip,
      symbolBoundingBox: symbolCellBox(strip),
      visualRunId: "fixture-run-fa",
      sourceDocumentId: "doc-1",
      runOwnerDocumentId: "doc-1",
      applicableSystem: "Fire Alarm",
      approvedForTakeoff: false,
      approvedForPricing: false,
    },
    visualRunId: "fixture-run-fa",
    sourceReferences: [`fa-row-${row.sourceRow}`],
  };
});

const seedVersion = (raw, { id, versionNumber, documentId = "doc-1", status = "Completed", inputFingerprint = "INPUT_FP", outputFingerprint = "OUTPUT_FP", documentVersionId = "ver-1", intakeId = "intake-1", parserVersion = "drawing-structural-parser-1.7.0", supersededAt = null, summary = {} }) => {
  raw.prepare("INSERT INTO drawing_structure_versions (id,project_id,document_id,document_version_id,drawing_intake_version_id,version_number,input_fingerprint,output_fingerprint,parser_version,status,summary,superseded_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, "proj-1", documentId, documentVersionId, intakeId, versionNumber, inputFingerprint, outputFingerprint, parserVersion, status, JSON.stringify(summary), supersededAt, DEV_ID);
  return id;
};

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
};

const seedPages = (raw, intakeId = "intake-1") => raw.prepare("INSERT INTO drawing_pages (id,intake_version_id,page_number,width,height,coordinate_mode,rotation) VALUES (?,?,?,?,?,?,?)").run(`page_${intakeId}_1`, intakeId, 1, 3370, 2384, "Vector Coordinates Available", 0);

const seedProposals = (raw, proposals, overrides = {}) => {
  for (const p of proposals) raw.prepare("INSERT INTO drawing_extraction_proposals (id,project_id,document_id,intake_version_id,page_number,proposal_key,proposal_type,raw_label,normalized_value,bounding_box,confidence,authority_role,governed_status,hard_review_reasons,evidence,source_references,extraction_method,extraction_version,review_status,visual_run_id,superseded_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(p.id, p.projectId ?? "proj-1", p.documentId ?? "doc-1", p.intakeVersionId ?? "intake-1", p.pageNumber ?? 1, p.proposalKey ?? p.id, p.proposalType ?? "LegendDefinition", p.rawLabel, JSON.stringify(p.normalizedMeaning), JSON.stringify(p.boundingBox), 90, p.authorityRole ?? "Primary", p.governedStatus ?? "Needs Review", p.hardReviewReasons ?? "[]", JSON.stringify(p.evidence), JSON.stringify(p.sourceReferences || []), p.extractionMethod ?? "candidate-legend-visual-1", p.extractionVersion ?? "candidate-legend-visual-1", "Needs Review", p.visualRunId === undefined ? null : p.visualRunId, overrides.supersededAt ?? null, now(), now());
};

// Handler helper (same shape the dev server uses: localhost single-user context).
const apiRequest = (path, { method = "GET", body } = {}) => {
  const request = new Request(`http://127.0.0.1:4183${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return async env => { const response = await handleDrawingStructuralReviewApi(request, env); return { status: response.status, body: await response.json() }; };
};

const casesView = raw => raw.prepare(`SELECT c.*, l.source_row, l.source_fragment_ids, t.table_key, t.section_title, t.table_type FROM drawing_structure_review_cases c JOIN drawing_structure_legend_rows l ON l.id=c.legend_row_id JOIN drawing_structure_tables t ON t.id=l.table_id ORDER BY t.table_key,l.source_row`).all();

const snapshotOf = row => JSON.parse(row.current_snapshot);
const fireTableKey = result => result.tables.find(t => t.sectionTitle === "FIRE ALARM SYSTEM").tableKey;

const seedCanonicalFixture = ({ raw, db, result, versionId = "v3", versionNumber = 3, supersededAt = null, includeProposals = true, proposalRows = null }) => {
  seedVersion(raw, { id: versionId, versionNumber, status: "Completed", supersededAt, inputFingerprint: `IN_${versionId}`, outputFingerprint: `OUT_${versionId}` });
  seedChildrenFromResult(raw, result, versionId);
  seedPages(raw);
  if (includeProposals) seedProposals(raw, proposalRows || proposalsForResult(result));
  return db;
};

const initializePath = documentId => `/api/documents/${documentId}/drawing-structure/review/initialize`;
const reviewPath = documentId => `/api/documents/${documentId}/drawing-structure/review`;
const publishPath = documentId => `/api/documents/${documentId}/drawing-structure/review/publish`;

// ---------------------------------------------------------------------------
// A + G. initialize resolves ONLY the current v3 (v1 superseded, v2 Processing);
// every created case binds v3 and no case ever binds v1/v2.
// ---------------------------------------------------------------------------
test("A/G: initialize resolves the current structure only; every created review case binds its exact version and legend row", async () => {
  const { raw, db } = makeDb();
  const result = buildReviewResult();
  seedVersion(raw, { id: "v1", versionNumber: 1, status: "Completed", supersededAt: now(), inputFingerprint: "IN_1", outputFingerprint: "OUT_1" });
  seedChildrenFromResult(raw, result, "v1");
  seedVersion(raw, { id: "v2", versionNumber: 2, status: "Processing", supersededAt: null, inputFingerprint: "IN_2", outputFingerprint: "OUT_2" });
  seedCanonicalFixture({ raw, db, result, versionId: "v3", versionNumber: 3 });

  const run = await apiRequest(initializePath("doc-1"), { method: "POST", body: {} })({ DB: db });
  assert.equal(run.status, 200);
  assert.equal(run.body.created, 5, "3 Fire Alarm + 2 PA/VA legend rows initialize");
  assert.equal(run.body.created, run.body.total);
  assert.equal(run.body.attributed, 3, "Fire Alarm rows have deterministic candidates + text codes");
  assert.equal(run.body.partiallyAttributed, 2, "PA/VA rows have structural evidence but no proposal candidate");
  assert.equal(run.body.unattributed, 0);
  assert.deepEqual(run.body.blockedUnattributed, []);
  assert.equal(run.body.join.exactJoins, 3);
  assert.equal(run.body.join.unmatchedStructureRows, 2);
  assert.equal(run.body.idempotent, false);

  const cases = casesView(raw);
  assert.equal(cases.length, 5);
  for (const row of cases) {
    assert.equal(row.structure_version_id, "v3", "case binds the resolved v3, never v1/v2");
    assert.equal(row.document_id, "doc-1");
    assert.equal(row.status, "Needs Review");
    assert.equal(row.case_version, 1);
    assert.equal(row.reviewed_by, null);
  }
  assert.equal(cases.filter(row => row.section_title === "FIRE ALARM SYSTEM").length, 3, "exactly the Fire Alarm legend rows");
  assert.equal(cases.filter(row => row.section_title === "PUBLIC ADDRESS AND VOICE ALARM SYSTEM").length, 2);
  assert.equal(cases.every(row => row.table_type === "Legend"), true);
  // snapshot-level version provenance
  for (const row of cases) {
    const snapshot = snapshotOf(row);
    assert.equal(snapshot.initializationProvenance.structureVersionId, "v3");
    assert.equal(snapshot.initializationProvenance.documentVersionId, "ver-1");
    assert.equal(snapshot.initializationProvenance.structureOutputFingerprint, "OUT_v3");
  }

  // second run is a no-op (idempotent)
  const again = await apiRequest(initializePath("doc-1"), { method: "POST", body: {} })({ DB: db });
  assert.equal(again.status, 200);
  assert.equal(again.body.created, 0);
  assert.equal(again.body.refreshed, 0);
  assert.equal(again.body.skipped, 5);
  assert.equal(again.body.idempotent, true);
  assert.equal(casesView(raw).length, 5, "no duplicates under the unique (structure_version_id, legend_row_id) index");
});

// ---------------------------------------------------------------------------
// B/C/D/E/F. non-resolvable current structure => governed 409, never an init.
// ---------------------------------------------------------------------------
test("B: a Processing current structure cannot initialize (409)", async () => {
  const { raw, db } = makeDb();
  seedVersion(raw, { id: "v1", versionNumber: 1, status: "Processing" });
  const run = await apiRequest(initializePath("doc-1"), { method: "POST", body: {} })({ DB: db });
  assert.equal(run.status, 409);
  assert.equal(run.body.error.code, "DRAWING_STRUCTURE_REQUIRED");
});

test("C: a Failed current structure cannot initialize (409)", async () => {
  const { raw, db } = makeDb();
  seedVersion(raw, { id: "v1", versionNumber: 1, status: "Failed" });
  const run = await apiRequest(initializePath("doc-1"), { method: "POST", body: {} })({ DB: db });
  assert.equal(run.status, 409);
  assert.equal(run.body.error.code, "DRAWING_STRUCTURE_REQUIRED");
});

test("D: a superseded Completed structure cannot initialize (409)", async () => {
  const { raw, db } = makeDb();
  seedVersion(raw, { id: "v1", versionNumber: 1, status: "Completed", supersededAt: now() });
  const run = await apiRequest(initializePath("doc-1"), { method: "POST", body: {} })({ DB: db });
  assert.equal(run.status, 409);
  assert.equal(run.body.error.code, "DRAWING_STRUCTURE_REQUIRED");
});

test("E: a Completed structure bound to a stale document version cannot initialize (409)", async () => {
  const { raw, db } = makeDb();
  seedVersion(raw, { id: "v1", versionNumber: 1, status: "Completed", documentVersionId: "ver-1" });
  raw.prepare("UPDATE documents SET current_version_id='ver-2' WHERE id='doc-1'").run();
  const run = await apiRequest(initializePath("doc-1"), { method: "POST", body: {} })({ DB: db });
  assert.equal(run.status, 409);
  assert.equal(run.body.error.code, "DRAWING_STRUCTURE_REQUIRED");
});

test("F: a Completed structure bound to a stale intake cannot initialize (409)", async () => {
  const { raw, db } = makeDb();
  raw.prepare("INSERT INTO drawing_intake_versions (id,document_id,version_number,status,superseded_at) VALUES (?,?,?,?,?)").run("intake-2", "doc-1", 2, "Completed", null);
  seedVersion(raw, { id: "v1", versionNumber: 1, status: "Completed", intakeId: "intake-1" });
  const run = await apiRequest(initializePath("doc-1"), { method: "POST", body: {} })({ DB: db });
  assert.equal(run.status, 409);
  assert.equal(run.body.error.code, "DRAWING_STRUCTURE_REQUIRED");
});

// ---------------------------------------------------------------------------
// H. cells + fragments bind exactly.
// ---------------------------------------------------------------------------
test("H: review cases bind the exact legend row with its cells and source fragments", async () => {
  const { raw, db } = makeDb();
  const result = buildReviewResult();
  seedCanonicalFixture({ raw, db, result });
  await apiRequest(initializePath("doc-1"), { method: "POST", body: {} })({ DB: db });

  const fa = casesView(raw).find(row => row.table_key === "ft" && row.source_row === 1);
  assert.ok(fa, "Fire Alarm row 1 has a case");
  const snapshot = snapshotOf(fa);
  assert.equal(snapshot.sourcePage, 1);
  assert.equal(snapshot.sourceRow, 1);
  assert.equal(snapshot.abbreviation, "S1");
  assert.equal(snapshot.description, "FIRE ALARM SYSTEM DEVICE 1");
  assert.deepEqual(snapshot.sourceFragmentIds, ["ft:1:c1", "ft:1:c2"]);
  assert.equal(snapshot.cells.length, 2, "the legend row binds its two cells");
  const symbolCell = snapshot.cells.find(cell => cell.column_number === 1);
  assert.deepEqual(symbolCell.original_fragments, [{ id: "ft:1:c1", text: "SYM", boundingBox: symbolCellBox(stripFor(200, 0)) }]);
  assert.equal(snapshot.structuralConfidence, 92);
});

// ---------------------------------------------------------------------------
// I. Fire Alarm <=> PA/VA never cross systems.
// ---------------------------------------------------------------------------
test("I: Fire Alarm proposals never cross into PA/VA rows and vice versa", async () => {
  const { raw, db } = makeDb();
  const result = buildReviewResult();
  seedCanonicalFixture({ raw, db, result });
  await apiRequest(initializePath("doc-1"), { method: "POST", body: {} })({ DB: db });

  const cases = casesView(raw);
  const faCases = cases.filter(row => row.section_title === "FIRE ALARM SYSTEM");
  const paCases = cases.filter(row => row.section_title === "PUBLIC ADDRESS AND VOICE ALARM SYSTEM");
  assert.equal(faCases.length, 3);
  assert.equal(paCases.length, 2);

  for (const row of faCases) {
    const snapshot = snapshotOf(row);
    assert.equal(snapshot.joinClassification, "EXACT_JOIN");
    assert.equal(snapshot.proposalCandidateCount, 1);
    assert.equal(snapshot.proposalCandidates[0].proposalId, `fixture-proposal-fa-${row.source_row}`, "candidate is this row's own Fire Alarm proposal");
    assert.equal(snapshot.attributionState, "ATTRIBUTED");
  }
  for (const row of paCases) {
    const snapshot = snapshotOf(row);
    assert.equal(snapshot.joinClassification, "NO_MATCH", "a PA/VA row never receives a Fire Alarm proposal");
    assert.equal(snapshot.proposalCandidateCount, 0);
    assert.ok(snapshot.attributionWarnings.includes("NO_DETERMINISTIC_PROPOSAL_ATTRIBUTION"), "PA/VA rows surface the honest deterministic-attribution warning");
    assert.equal(snapshot.attributionState, "PARTIALLY_ATTRIBUTED");
  }
});

// ---------------------------------------------------------------------------
// J. Title Block contributes zero legend-review cases.
// ---------------------------------------------------------------------------
test("J: Title Block rows create no legend-review cases", async () => {
  const { raw, db } = makeDb();
  const result = buildReviewResult({ title: 4 });
  seedCanonicalFixture({ raw, db, result });
  await apiRequest(initializePath("doc-1"), { method: "POST", body: {} })({ DB: db });

  const cases = casesView(raw);
  assert.equal(cases.length, 5, "only legend rows (FA 3 + PA 2) become cases");
  assert.equal(cases.some(row => row.table_type === "Title Block"), false, "no Title Block review case exists");
  assert.equal(cases.every(row => row.table_type === "Legend"), true);
});

// ---------------------------------------------------------------------------
// K. null-abbreviation native-symbol rows survive without fabricated codes.
// ---------------------------------------------------------------------------
test("K: null-abbreviation native-symbol rows keep abbreviation null and are never given fabricated codes", async () => {
  const { raw, db } = makeDb();
  const result = buildReviewResult({ fa: 2, pa: 0, title: 0 });
  // make row 1 a native-symbol row: no textual code, but real vector geometry
  const first = result.legendRows.find(row => row.tableKey === "ft" && row.sourceRow === 1);
  first.symbolGeometry = [{ id: "shape-ft-1", type: "polyline", boundingBox: symbolCellBox(stripFor(200, 0)) }];
  first.abbreviation = null;
  seedCanonicalFixture({ raw, db, result });
  await apiRequest(initializePath("doc-1"), { method: "POST", body: {} })({ DB: db });

  const row = casesView(raw).find(entry => entry.table_key === "ft" && entry.source_row === 1);
  const snapshot = snapshotOf(row);
  assert.equal(snapshot.abbreviation, null, "no fabrication of a symbol code");
  assert.equal(snapshot.symbolRepresentation, "VECTOR_GEOMETRY");
  assert.equal(snapshot.attributionState, "ATTRIBUTED", "native symbol + candidate + description + fragments is complete");
  assert.equal(snapshot.attributionWarnings.length, 0);
  assert.equal(snapshot.symbolGeometry.length, 1);
});

// ---------------------------------------------------------------------------
// UNATTRIBUTED gate: rows with no evidence are blocked, never silently created.
// ---------------------------------------------------------------------------
test("gate: an UNATTRIBUTED legend row is blocked, never silently initialized into a case", async () => {
  const { raw, db } = makeDb();
  const result = buildReviewResult({ fa: 2, pa: 0, title: 0, empty: tableKey => row => tableKey === "ft" && row === 1 });
  seedCanonicalFixture({ raw, db, result, proposalRows: proposalsForResult(result).filter(p => !p.id.endsWith("-1")) });

  const run = await apiRequest(initializePath("doc-1"), { method: "POST", body: {} })({ DB: db });
  assert.equal(run.status, 200);
  assert.equal(run.body.created, 1, "only the attributable row creates a case");
  assert.equal(run.body.unattributed, 1);
  assert.equal(run.body.blockedUnattributed.length, 1);
  assert.equal(run.body.blockedUnattributed[0].sourceRow, 1);
  assert.ok(run.body.blockedUnattributed[0].attributionWarnings.includes("UNATTRIBUTED_LEGEND_ROW_BLOCKED"));
  assert.equal(casesView(raw).length, 1, "no case exists for the silent row");
});

// ---------------------------------------------------------------------------
// L. same current structure cannot create duplicate cases.
// ---------------------------------------------------------------------------
test("L: the same current structure can never create duplicate cases (idempotent)", async () => {
  const { raw, db } = makeDb();
  const result = buildReviewResult();
  seedCanonicalFixture({ raw, db, result });
  const first = await apiRequest(initializePath("doc-1"), { method: "POST", body: {} })({ DB: db });
  assert.equal(first.body.created, 5);
  const second = await apiRequest(initializePath("doc-1"), { method: "POST", body: {} })({ DB: db });
  assert.equal(second.body.created, 0);
  assert.equal(second.body.refreshed, 0);
  assert.equal(second.body.skipped, 5);
  assert.equal(second.body.idempotent, true);
  assert.equal(casesView(raw).length, 5);
  // unique index protects even a hand-forced reinsert
  const any = casesView(raw)[0];
  assert.throws(() => raw.prepare("INSERT INTO drawing_structure_review_cases (id,project_id,document_id,structure_version_id,legend_row_id,original_snapshot,current_snapshot,adjustments,status,case_version) VALUES (?,?,?,?,?,?,?,?,?,?)").run("forced", "proj-1", "doc-1", any.structure_version_id, any.legend_row_id, "{}", "{}", "[]", "Needs Review", 1));
});

// ---------------------------------------------------------------------------
// L2. stale proposal evidence refreshes pristine cases only; a human-reviewed
// case is never silently overwritten; re-runs stay idempotent.
// ---------------------------------------------------------------------------
test("L2: stale evidence refreshes pristine cases in place but never touches a reviewed case; third run is idempotent", async () => {
  const { raw, db } = makeDb();
  const result = buildReviewResult();
  seedCanonicalFixture({ raw, db, result });
  const first = await apiRequest(initializePath("doc-1"), { method: "POST", body: {} })({ DB: db });
  assert.equal(first.body.created, 5);
  const fpBefore = first.body.evidenceFingerprint;

  // human approves the FA row 1 case
  const fa1 = casesView(raw).find(row => row.table_key === "ft" && row.source_row === 1);
  const confirm = await apiRequest(`/api/structure-review-cases/${encodeURIComponent(fa1.id)}/confirm`, { method: "POST", body: { reason: "T-00 reviewer visually verified row" } })({ DB: db });
  assert.equal(confirm.status, 200);
  assert.equal(confirm.body.status, "Approved");

  // change the proposal evidence set (new duplicate proposal => new fingerprint)
  const extra = { ...proposalsForResult(result).find(p => p.id.endsWith("-2")), id: "fixture-proposal-fa-2-extra", proposalKey: "fixture-proposal-fa-2-extra", evidence: { ...proposalsForResult(result).find(p => p.id.endsWith("-2")).evidence, rawDescription: "FIRE ALARM SYSTEM DEVICE 2 DUP", description: null } };
  seedProposals(raw, [extra]);

  const second = await apiRequest(initializePath("doc-1"), { method: "POST", body: {} })({ DB: db });
  assert.equal(second.status, 200);
  assert.equal(second.body.created, 0);
  assert.equal(second.body.refreshed, 4, "only the 4 pristine cases refresh; the approved one is untouched");
  assert.equal(second.body.skipped, 1);
  assert.notEqual(second.body.evidenceFingerprint, fpBefore, "the fingerprint reflects the changed evidence set");
  assert.equal(second.body.idempotent, false);

  const after = casesView(raw);
  assert.equal(after.length, 5, "refresh never duplicates");
  const approved = after.find(row => row.id === fa1.id);
  assert.equal(approved.status, "Approved");
  assert.equal(approved.reviewed_by, DEV_ID);
  assert.equal(JSON.parse(approved.current_snapshot).initializationProvenance.proposalEvidenceFingerprint, fpBefore, "human-reviewed snapshot keeps its original evidence binding");
  const refreshed = after.find(row => row.table_key === "ft" && row.source_row === 2 && row.id !== fa1.id);
  assert.equal(JSON.parse(refreshed.current_snapshot).initializationProvenance.proposalEvidenceFingerprint, second.body.evidenceFingerprint, "pristine case snapshot advanced to current evidence");

  const third = await apiRequest(initializePath("doc-1"), { method: "POST", body: {} })({ DB: db });
  assert.equal(third.body.created, 0);
  assert.equal(third.body.refreshed, 0);
  assert.equal(third.body.skipped, 5);
  assert.equal(third.body.idempotent, true);
});

// ---------------------------------------------------------------------------
// M. a new structure version never inherits an older version's approvals.
// ---------------------------------------------------------------------------
test("M: a new structure version does not inherit an older version's review authorization", async () => {
  const { raw, db } = makeDb();
  const result = buildReviewResult();
  seedCanonicalFixture({ raw, db, result, versionId: "v3", versionNumber: 3 });
  await apiRequest(initializePath("doc-1"), { method: "POST", body: {} })({ DB: db });

  // v3: approve one case and publish
  const fa3 = casesView(raw).find(row => row.table_key === "ft" && row.source_row === 1);
  await apiRequest(`/api/structure-review-cases/${encodeURIComponent(fa3.id)}/confirm`, { method: "POST", body: { reason: "Reviewer approves the T-00 symbol row" } })({ DB: db });
  const published = await apiRequest(publishPath("doc-1"), { method: "POST", body: { reason: "Publishing v3 approved legend evidence" } })({ DB: db });
  assert.equal(published.status, 201, "fresh publish creates a new approved version");
  let approvedVersions = raw.prepare("SELECT * FROM drawing_structure_approved_versions ORDER BY version_number").all();
  assert.equal(approvedVersions.length, 1);
  assert.equal(approvedVersions[0].source_structure_version_id, "v3");
  assert.equal(approvedVersions[0].approved_row_count, 1);
  assert.equal(raw.prepare("SELECT count(*) count FROM drawing_structure_approved_rows").get().count, 1);

  // v4 becomes current with identical content; its cases are all fresh Needs Review
  seedVersion(raw, { id: "v4", versionNumber: 4, status: "Completed", supersededAt: null, inputFingerprint: "IN_v4", outputFingerprint: "OUT_v4" });
  seedChildrenFromResult(raw, result, "v4");
  const v4Init = await apiRequest(initializePath("doc-1"), { method: "POST", body: {} })({ DB: db });
  assert.equal(v4Init.status, 200);
  assert.equal(v4Init.body.created, 5);
  const v4Cases = raw.prepare("SELECT * FROM drawing_structure_review_cases WHERE structure_version_id='v4'").all();
  assert.equal(v4Cases.length, 5);
  assert.ok(v4Cases.every(row => row.status === "Needs Review" && row.reviewed_by === null), "v4 starts clean: no inherited approvals, no inherited reviewers");

  // publishing v4 cannot silently carry v3's approved rows
  const v4Publish = await apiRequest(publishPath("doc-1"), { method: "POST", body: { reason: "Publishing v4 without any approvals" } })({ DB: db });
  assert.equal(v4Publish.status, 201, "v4 also publishes (never blocked by v3's approvals), but carries zero rows");
  approvedVersions = raw.prepare("SELECT * FROM drawing_structure_approved_versions ORDER BY version_number").all();
  assert.equal(approvedVersions.length, 2);
  const v4Approved = approvedVersions[1];
  assert.equal(v4Approved.source_structure_version_id, "v4");
  assert.equal(v4Approved.approved_row_count, 0, "zero silent carryover into the new structure authorization");
  assert.equal(raw.prepare("SELECT count(*) count FROM drawing_structure_approved_rows WHERE approved_version_id=?").get(v4Approved.id).count, 0);
});

// ---------------------------------------------------------------------------
// N/O/P. initialization alone performs zero technical/product/pricing actions.
// ---------------------------------------------------------------------------
test("N/O/P: initialization creates no technical approval, no product-match action, and no pricing/commercial action", async () => {
  const { raw, db } = makeDb();
  const result = buildReviewResult();
  seedCanonicalFixture({ raw, db, result });
  await apiRequest(initializePath("doc-1"), { method: "POST", body: {} })({ DB: db });

  assert.equal(raw.prepare("SELECT count(*) count FROM drawing_structure_approved_versions").get().count, 0, "no technical approval version is created");
  assert.equal(raw.prepare("SELECT count(*) count FROM drawing_structure_approved_rows").get().count, 0, "no approved rows are created");
  assert.equal(raw.prepare("SELECT count(*) count FROM drawing_structure_approved_audit_events").get().count, 0, "no approval audit events are created");
  assert.equal(raw.prepare("SELECT count(*) count FROM drawing_structure_review_events").get().count, 0, "initialization writes no review events (silent population, audited via snapshots)");
  // proposals remain untouched (no product/takeoff approval, no reviewed flag)
  const proposals = raw.prepare("SELECT * FROM drawing_extraction_proposals ORDER BY id").all();
  assert.equal(proposals.length, 3);
  assert.ok(proposals.every(p => p.review_status === "Needs Review" && p.reviewed_by === null && p.corrected_value === null && p.superseded_at === null), "proposal rows untouched by initialization");
});

// ---------------------------------------------------------------------------
// Q. full provenance survives inside every snapshot.
// ---------------------------------------------------------------------------
test("Q: initialization provenance, evidence fingerprint, and fragment roots survive inside every case snapshot", async () => {
  const { raw, db } = makeDb();
  const result = buildReviewResult();
  seedCanonicalFixture({ raw, db, result });
  const run = await apiRequest(initializePath("doc-1"), { method: "POST", body: {} })({ DB: db });
  assert.deepEqual(run.status, 200);
  assert.match(run.body.evidenceFingerprint, /^[0-9a-f]{64}$/);

  for (const row of casesView(raw)) {
    const snapshot = snapshotOf(row);
    assert.equal(snapshot.initializationProvenance.structureVersionId, "v3");
    assert.equal(snapshot.initializationProvenance.documentVersionId, "ver-1");
    assert.equal(snapshot.initializationProvenance.structureInputFingerprint, "IN_v3");
    assert.equal(snapshot.initializationProvenance.structureOutputFingerprint, "OUT_v3");
    assert.equal(snapshot.initializationProvenance.parserVersion, "drawing-structural-parser-1.7.0");
    assert.equal(snapshot.initializationProvenance.proposalEvidenceFingerprint, run.body.evidenceFingerprint);
    assert.ok(snapshot.sourceFragmentIds.length >= 2, "fragment roots survive");
    assert.ok(snapshot.cells.every(cell => Array.isArray(cell.original_fragments)), "cell fragments survive as arrays");
    assert.ok(typeof snapshot.symbolRepresentation === "string");
    assert.ok(["ATTRIBUTED", "PARTIALLY_ATTRIBUTED", "UNATTRIBUTED"].includes(snapshot.attributionState));
  }
});

// ---------------------------------------------------------------------------
// R. T-00 real integration (governed, fixture-only).
// ---------------------------------------------------------------------------
test("R: T-00 real fixture initializes 24 cases (20 Fire Alarm + 4 PA/VA) with 20 EXACT spatial joins and no fabricated codes", async t => {
  const path = "/Users/serein-b/Downloads/17- Fire Alarm/2401232-PC-AMS-DR-T-00-ZZZ-002.pdf";
  if (!fs.existsSync(path)) return t.skip("T-00 source unavailable");
  const rawPdf = fs.readFileSync(path);
  const result = await parseDrawingStructure(new Uint8Array(rawPdf));
  assert.equal(result.parserVersion, "drawing-structural-parser-1.7.0");
  assert.equal(result.legendRows.length, 24);

  const DOC = "doc_0de6f58b-7b48-46a2-92d3-aaef230c92b0";
  const PROJECT = "project_c0123d91-c30b-4956-87cb-e473ef53f89d";
  const INTAKE = "drawingIntake_57719080-1ce0-4a11-833a-311f213efcd1";
  const DOC_VER = "ver_47d5b443-74a1-4643-a29f-c8f7b4fdc5e6";

  const { raw, db } = makeDb(DOC, PROJECT);
  raw.prepare("UPDATE documents SET current_version_id=? WHERE id=?").run(DOC_VER, DOC);
  raw.prepare("UPDATE drawing_intake_versions SET id=? WHERE id='intake-1'").run(INTAKE);
  seedPages(raw, INTAKE);
  seedProposals(raw, T00_LEGEND_DEFINITION_PROPOSALS);
  const doc = { id: DOC, project_id: PROJECT, version_id: DOC_VER, sha256: sha256hex(rawPdf) };
  const outcome = await persist({ DB: db }, doc, { id: INTAKE }, result, { id: DEV_ID });
  assert.equal(outcome.idempotent, false);
  const structure = raw.prepare("SELECT * FROM drawing_structure_versions WHERE status='Completed' AND superseded_at IS NULL").get();
  assert.ok(structure, "persisted Completed structure exists");
  assert.equal(JSON.parse(structure.summary).legendRowCount, 24);

  const run = await apiRequest(initializePath(DOC), { method: "POST", body: {} })({ DB: db });
  assert.equal(run.status, 200);
  assert.equal(run.body.created, 24);
  assert.equal(run.body.attributed, 20);
  assert.equal(run.body.partiallyAttributed, 4);
  assert.equal(run.body.unattributed, 0);
  assert.deepEqual(run.body.blockedUnattributed, []);
  assert.equal(run.body.total, 24);
  assert.equal(run.body.join.exactJoins, 20, "the proven 20/20 spatial join reproduces through the governed initialization");
  assert.equal(run.body.join.highConfidenceJoins, 0);
  assert.equal(run.body.join.ambiguousJoins, 0);
  assert.equal(run.body.join.unmatchedStructureRows, 4, "the four PA/VA rows stay unmatched, exactly as scoped");
  assert.equal(run.body.idempotent, false);

  const cases = casesView(raw);
  assert.equal(cases.length, 24);
  assert.equal(cases.filter(row => row.section_title === "FIRE ALARM SYSTEM").length, 20);
  assert.equal(cases.filter(row => row.section_title === "PUBLIC ADDRESS AND VOICE ALARM SYSTEM").length, 4);
  for (const row of cases) {
    assert.equal(row.structure_version_id, structure.id, "every case binds the exact persisted version");
    const snapshot = snapshotOf(row);
    assert.equal(snapshot.initializationProvenance.documentVersionId, DOC_VER);
    assert.equal(snapshot.initializationProvenance.structureOutputFingerprint, structure.output_fingerprint);
    assert.equal(snapshot.initializationProvenance.proposalEvidenceFingerprint, run.body.evidenceFingerprint);
    assert.ok(snapshot.sourceFragmentIds.length >= 1);
  }
  const faCases = cases.filter(row => row.section_title === "FIRE ALARM SYSTEM");
  for (const row of faCases) {
    const snapshot = snapshotOf(row);
    assert.equal(snapshot.joinClassification, "EXACT_JOIN");
    assert.equal(snapshot.attributionState, "ATTRIBUTED");
    assert.equal(snapshot.proposalCandidateCount, 1, "one deterministic candidate per Fire Alarm row");
    assert.equal(snapshot.proposalCandidates[0].sourceImage, null);
  }
  const paCases = cases.filter(row => row.section_title === "PUBLIC ADDRESS AND VOICE ALARM SYSTEM");
  for (const row of paCases) {
    const snapshot = snapshotOf(row);
    assert.equal(snapshot.joinClassification, "NO_MATCH");
    assert.equal(snapshot.attributionState, "PARTIALLY_ATTRIBUTED");
    assert.equal(snapshot.proposalCandidateCount, 0);
    assert.ok(snapshot.attributionWarnings.includes("NO_DETERMINISTIC_PROPOSAL_ATTRIBUTION"));
  }

  // null-abbreviation native-symbol rows: never fabricated
  const expectedNullAbbr = result.legendRows.filter(row => row.tableKey === fireTableKey(result) && !(row.abbreviation && String(row.abbreviation).trim())).length;
  const nullAbbrLegendRows = raw.prepare("SELECT l.id,l.abbreviation FROM drawing_structure_legend_rows l JOIN drawing_structure_tables t ON t.id=l.table_id WHERE t.structure_version_id=? AND t.section_title='FIRE ALARM SYSTEM' AND (l.abbreviation IS NULL OR l.abbreviation='')").all(structure.id);
  assert.ok(expectedNullAbbr >= 4, `T-00 has ${expectedNullAbbr} native-symbol (null/empty code) Fire Alarm rows`);
  assert.equal(nullAbbrLegendRows.length, expectedNullAbbr, "persisted null/empty abbreviations match the parse exactly");
  for (const legendRow of nullAbbrLegendRows) {
    const caseRow = raw.prepare("SELECT * FROM drawing_structure_review_cases WHERE structure_version_id=? AND legend_row_id=?").get(structure.id, legendRow.id);
    assert.ok(caseRow, "every null-code row still gets a review case");
    assert.equal(JSON.parse(caseRow.current_snapshot).abbreviation, null, "no fabricated symbol code");
    assert.ok(["VECTOR_GEOMETRY", "TEXT_CODE", "NONE"].includes(JSON.parse(caseRow.current_snapshot).symbolRepresentation));
  }

  // idempotent second run on the same population
  const second = await apiRequest(initializePath(DOC), { method: "POST", body: {} })({ DB: db });
  assert.equal(second.body.created, 0);
  assert.equal(second.body.refreshed, 0);
  assert.equal(second.body.skipped, 24);
  assert.equal(second.body.idempotent, true);
  assert.equal(second.body.evidenceFingerprint, run.body.evidenceFingerprint);
  assert.equal(casesView(raw).length, 24);
});