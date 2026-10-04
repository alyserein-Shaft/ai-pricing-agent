// Shared fixture machinery for the drawing structural review + drawing fact
// decision/promotion test suites (Steps 14.5 + 14.6). In-memory D1-shaped
// fixture that mirrors the real schema. NO live D1 is touched by tests.
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { handleDrawingStructuralReviewApi } from "../../worker/drawing-structural-review-api.mjs";

export const sha256hex = value => crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
export const now = () => new Date().toISOString();
export const DEV_ID = "local-development-user";
export const DEV_ORG = "organization_bd_shaft_internal_pilot";

export const STRUCTURE_REVIEW_DDL = `
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

export const makeDb = (documentId = "doc-1", projectId = "proj-1", { track = false } = {}) => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(STRUCTURE_REVIEW_DDL);
  raw.prepare("INSERT INTO projects (id,owner_user_id,organization_id,name) VALUES (?,?,?,?)").run(projectId, DEV_ID, DEV_ORG, "Fixture Pilot");
  raw.prepare("INSERT INTO documents (id,project_id,current_version_id,deleted_at) VALUES (?,?,?,NULL)").run(documentId, projectId, "ver-1");
  raw.prepare("INSERT INTO drawing_intake_versions (id,document_id,version_number,status,superseded_at) VALUES (?,?,?,?,?)").run("intake-1", documentId, 1, "Completed", null);
  const trackedWrites = [];
  const operation = (sql, args = []) => {
    const statement = raw.prepare(sql);
    return {
      first: async () => { const row = statement.get(...args); return row === undefined ? null : row; },
      all: async () => ({ results: statement.all(...args) }),
      run: async () => {
        if (track && /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) {
          const table = (sql.match(/^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z0-9_]+)/i) || [])[1];
          if (table && !trackedWrites.includes(table)) trackedWrites.push(table);
        }
        return { meta: statement.run(...args) };
      },
    };
  };
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
    trackedWrites,
  };
  return { raw, db };
};

// ---------------------------------------------------------------------------
// Synthetic review fixture: realistic page-space geometry, one legend strip per
// row, symbol cell (col 1) and description cell (col 2) per row.
// ---------------------------------------------------------------------------
export const stripFor = (course, index) => ({ x: 560, y: course + index * 150, width: 300, height: 130 });
export const symbolCellBox = strip => ({ x: strip.x + 10, y: strip.y + 20, width: 40, height: 60 });
export const descriptionCellBox = strip => ({ x: strip.x + 100, y: strip.y + 20, width: 170, height: 90 });

export const buildReviewResult = ({ fa = 3, pa = 2, title = 2, abbreviationFor = tableKey => row => `${tableKey === "ft" ? "S" : "P"}${row}`, empty = tableKey => () => false } = {}) => {
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
export const proposalsForResult = result => result.legendRows.filter(row => row.tableKey === "ft").map(row => {
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

export const seedVersion = (raw, { id, versionNumber, documentId = "doc-1", status = "Completed", inputFingerprint = "INPUT_FP", outputFingerprint = "OUTPUT_FP", documentVersionId = "ver-1", intakeId = "intake-1", parserVersion = "drawing-structural-parser-1.7.0", supersededAt = null, summary = {} }) => {
  raw.prepare("INSERT INTO drawing_structure_versions (id,project_id,document_id,document_version_id,drawing_intake_version_id,version_number,input_fingerprint,output_fingerprint,parser_version,status,summary,superseded_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, "proj-1", documentId, documentVersionId, intakeId, versionNumber, inputFingerprint, outputFingerprint, parserVersion, status, JSON.stringify(summary), supersededAt, DEV_ID);
  return id;
};

export const seedChildrenFromResult = (raw, result, versionId) => {
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

export const seedPages = (raw, intakeId = "intake-1") => raw.prepare("INSERT INTO drawing_pages (id,intake_version_id,page_number,width,height,coordinate_mode,rotation) VALUES (?,?,?,?,?,?,?)").run(`page_${intakeId}_1`, intakeId, 1, 3370, 2384, "Vector Coordinates Available", 0);

export const seedProposals = (raw, proposals, overrides = {}) => {
  for (const p of proposals) raw.prepare("INSERT INTO drawing_extraction_proposals (id,project_id,document_id,intake_version_id,page_number,proposal_key,proposal_type,raw_label,normalized_value,bounding_box,confidence,authority_role,governed_status,hard_review_reasons,evidence,source_references,extraction_method,extraction_version,review_status,visual_run_id,superseded_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(p.id, p.projectId ?? "proj-1", p.documentId ?? "doc-1", p.intakeVersionId ?? "intake-1", p.pageNumber ?? 1, p.proposalKey ?? p.id, p.proposalType ?? "LegendDefinition", p.rawLabel, JSON.stringify(p.normalizedMeaning), JSON.stringify(p.boundingBox), 90, p.authorityRole ?? "Primary", p.governedStatus ?? "Needs Review", p.hardReviewReasons ?? "[]", JSON.stringify(p.evidence), JSON.stringify(p.sourceReferences || []), p.extractionMethod ?? "candidate-legend-visual-1", p.extractionVersion ?? "candidate-legend-visual-1", "Needs Review", p.visualRunId === undefined ? null : p.visualRunId, overrides.supersededAt ?? null, now(), now());
};

// Handler helper (same shape the dev server uses: localhost single-user context).
export const apiRequest = (path, { method = "GET", body } = {}) => {
  const request = new Request(`http://127.0.0.1:4183${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return async env => { const response = await handleDrawingStructuralReviewApi(request, env); return { status: response.status, body: await response.json() }; };
};

export const casesView = raw => raw.prepare(`SELECT c.*, l.source_row, l.source_fragment_ids, t.table_key, t.section_title, t.table_type, t.source_region_key, t.page_number FROM drawing_structure_review_cases c JOIN drawing_structure_legend_rows l ON l.id=c.legend_row_id JOIN drawing_structure_tables t ON t.id=l.table_id ORDER BY t.table_key,l.source_row`).all();

export const snapshotOf = row => JSON.parse(row.current_snapshot);
export const fireTableKey = result => result.tables.find(t => t.sectionTitle === "FIRE ALARM SYSTEM").tableKey;

export const seedCanonicalFixture = ({ raw, db, result, versionId = "v3", versionNumber = 3, supersededAt = null, includeProposals = true, proposalRows = null }) => {
  seedVersion(raw, { id: versionId, versionNumber, status: "Completed", supersededAt, inputFingerprint: `IN_${versionId}`, outputFingerprint: `OUT_${versionId}` });
  seedChildrenFromResult(raw, result, versionId);
  seedPages(raw);
  if (includeProposals) seedProposals(raw, proposalRows || proposalsForResult(result));
  return db;
};

export const initializePath = documentId => `/api/documents/${documentId}/drawing-structure/review/initialize`;
export const reviewPath = documentId => `/api/documents/${documentId}/drawing-structure/review`;
export const publishPath = documentId => `/api/documents/${documentId}/drawing-structure/review/publish`;
export const evaluatePath = documentId => `/api/documents/${documentId}/drawing-structure/review/evaluate`;
export const deterministicConfirmPath = documentId => `/api/documents/${documentId}/drawing-structure/review/deterministic-confirm`;
export const confirmCasePath = caseId => `/api/structure-review-cases/${encodeURIComponent(caseId)}/confirm`;
export const rejectCasePath = caseId => `/api/structure-review-cases/${encodeURIComponent(caseId)}/reject`;

export const approvedCurrentPath = documentId => `/api/documents/${documentId}/drawing-structure/approved/current`;
export const approvedHistoryPath = documentId => `/api/documents/${documentId}/drawing-structure/approved/history`;