// STEP 14.7 -- Drawing Architecture Review fixture machinery (project-scoped).
// In-memory D1-shaped fixture mirroring the real schema + governed golden
// evidence. NO live D1 is touched by these tests.
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { handleDrawingArchitectureReviewApi } from "../../worker/drawing-architecture-review-api.mjs";

export const sha256hex = (value) => crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
export const now = () => new Date().toISOString();
export const DEV_ID = "local-development-user";
export const DEV_ORG = "organization_bd_shaft_internal_pilot";

export const ARCHITECTURE_REVIEW_DDL = `
  CREATE TABLE projects (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, organization_id TEXT NOT NULL, name TEXT, archived_at TEXT);
  CREATE TABLE documents (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, logical_name TEXT, current_version_id TEXT, deleted_at TEXT);
  CREATE TABLE drawing_intake_versions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, document_id TEXT NOT NULL, document_version_id TEXT NOT NULL, version_number INTEGER NOT NULL, status TEXT NOT NULL, superseded_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE drawing_metadata (id TEXT PRIMARY KEY, intake_version_id TEXT NOT NULL, drawing_number TEXT, revision TEXT, sheet_name TEXT, discipline TEXT, scale TEXT, review_status TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE drawing_document_classifications (id TEXT PRIMARY KEY, intake_version_id TEXT NOT NULL, classification_type TEXT NOT NULL, confidence INTEGER NOT NULL, extraction_method TEXT NOT NULL, review_status TEXT NOT NULL DEFAULT 'Needs Review');
  CREATE TABLE drawing_pages (id TEXT PRIMARY KEY, intake_version_id TEXT NOT NULL, page_number INTEGER NOT NULL, width REAL NOT NULL, height REAL NOT NULL, coordinate_mode TEXT NOT NULL, rotation REAL NOT NULL DEFAULT 0);
  CREATE TABLE drawing_assets (id TEXT PRIMARY KEY, intake_version_id TEXT NOT NULL, page_id TEXT NOT NULL, asset_type TEXT NOT NULL, text_content TEXT, bounding_box TEXT, review_status TEXT NOT NULL DEFAULT 'Needs Review');
  CREATE TABLE drawing_structure_approved_versions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, document_id TEXT NOT NULL, source_structure_version_id TEXT, version_number INTEGER NOT NULL, input_fingerprint TEXT NOT NULL, output_fingerprint TEXT NOT NULL, status TEXT NOT NULL, approved_row_count INTEGER NOT NULL, excluded_row_count INTEGER NOT NULL, created_by TEXT NOT NULL, reason TEXT NOT NULL, superseded_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE drawing_structure_approved_rows (id TEXT PRIMARY KEY, approved_version_id TEXT NOT NULL, review_case_id TEXT, source_legend_row_id TEXT, source_page INTEGER, source_row INTEGER, symbol_geometry TEXT, abbreviation TEXT, description TEXT, notes TEXT, bounding_box TEXT, structural_confidence INTEGER NOT NULL, review_actor_id TEXT, review_reason TEXT, source_snapshot TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE drawing_architecture_review_cases (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, document_id TEXT NOT NULL, document_version_id TEXT NOT NULL,
    drawing_intake_version_id TEXT NOT NULL, structure_version_id TEXT, fact_key TEXT NOT NULL, fact_type TEXT NOT NULL,
    subject TEXT NOT NULL, relation TEXT, object TEXT, scope TEXT NOT NULL, evidence_kind TEXT NOT NULL, authority_class TEXT,
    source_drawing_number TEXT, source_page INTEGER, source_region TEXT, source_fragment_ids TEXT NOT NULL DEFAULT '[]',
    parser_version TEXT NOT NULL, evidence_fingerprint TEXT NOT NULL, decision_state TEXT NOT NULL DEFAULT 'Pending',
    decision_reason TEXT NOT NULL DEFAULT '[]', decision_policy_version TEXT, case_version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'Needs Review', original_snapshot TEXT NOT NULL, current_snapshot TEXT NOT NULL,
    adjustments TEXT NOT NULL DEFAULT '[]', reviewed_by TEXT, reviewed_at TEXT, review_reason TEXT, superseded_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE UNIQUE INDEX architecture_case_unique_idx ON drawing_architecture_review_cases (document_id, drawing_intake_version_id, fact_key);
  CREATE TABLE drawing_architecture_review_events (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, document_id TEXT NOT NULL, drawing_intake_version_id TEXT NOT NULL,
    review_case_id TEXT NOT NULL, action TEXT NOT NULL, previous_snapshot TEXT NOT NULL, new_snapshot TEXT NOT NULL,
    reason TEXT NOT NULL, actor_user_id TEXT NOT NULL, actor_permission TEXT NOT NULL, request_id TEXT NOT NULL,
    case_version INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE drawing_architecture_approved_versions (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, version_number INTEGER NOT NULL, input_fingerprint TEXT NOT NULL,
    output_fingerprint TEXT NOT NULL, status TEXT NOT NULL, approved_fact_count INTEGER NOT NULL, excluded_fact_count INTEGER NOT NULL,
    created_by TEXT NOT NULL, reason TEXT NOT NULL, superseded_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE UNIQUE INDEX architecture_approved_version_idx ON drawing_architecture_approved_versions (project_id, version_number);
  CREATE TABLE drawing_architecture_approved_rows (
    id TEXT PRIMARY KEY, approved_version_id TEXT NOT NULL, review_case_id TEXT NOT NULL, document_id TEXT NOT NULL,
    document_version_id TEXT NOT NULL, drawing_intake_version_id TEXT NOT NULL, structure_version_id TEXT, fact_type TEXT NOT NULL,
    subject TEXT NOT NULL, relation TEXT, object TEXT, scope TEXT NOT NULL, evidence_kind TEXT NOT NULL, authority_class TEXT,
    source_drawing_number TEXT, source_page INTEGER, source_region TEXT, source_fragment_ids TEXT NOT NULL DEFAULT '[]',
    parser_version TEXT NOT NULL, evidence_fingerprint TEXT NOT NULL, review_actor_id TEXT NOT NULL, review_reason TEXT NOT NULL,
    source_snapshot TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE UNIQUE INDEX architecture_approved_row_idx ON drawing_architecture_approved_rows (approved_version_id, review_case_id);
  CREATE TABLE drawing_architecture_approved_audit_events (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, document_id TEXT, approved_version_id TEXT NOT NULL, action TEXT NOT NULL,
    previous_value TEXT, new_value TEXT NOT NULL, reason TEXT NOT NULL, actor_user_id TEXT NOT NULL, request_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE drawing_architecture_exception_adjudications (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
    exception_key TEXT NOT NULL, exception_type TEXT NOT NULL,
    raw_subject TEXT NOT NULL, raw_relation TEXT, raw_object TEXT,
    raw_drawing_number TEXT NOT NULL, building_code TEXT NOT NULL,
    source_drawing_number TEXT NOT NULL, source_drawing_name TEXT,
    decision_state TEXT NOT NULL, decision_reasons TEXT NOT NULL DEFAULT '[]', decision_policy_version TEXT NOT NULL,
    decision_actor TEXT NOT NULL, decision_fingerprint TEXT NOT NULL,
    canonical_target_drawing_number TEXT, canonical_target_document_id TEXT, canonical_target_drawing_number_raw TEXT,
    canonical_building_asset_code TEXT, canonical_building_name TEXT, canonical_panel_identity TEXT,
    stage4_blocking_class TEXT NOT NULL DEFAULT 'NONBLOCKING_DRAWING_REVIEW',
    evidence_observations_count INTEGER, evidence_fingerprint TEXT, evidence_summary TEXT NOT NULL DEFAULT '{}',
    review_case_ids TEXT NOT NULL DEFAULT '[]', created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, superseded_at TEXT, superseding_adjudication_id TEXT);
  CREATE UNIQUE INDEX drawing_architecture_exception_adj_project_key_uniq
    ON drawing_architecture_exception_adjudications (project_id, exception_key) WHERE superseded_at IS NULL;
  CREATE TABLE drawing_architecture_stage4_readiness (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, version_number INTEGER NOT NULL DEFAULT 1,
    architecture_version INTEGER NOT NULL, stage4_readiness TEXT NOT NULL,
    status TEXT NOT NULL, evidence_count INTEGER NOT NULL DEFAULT 0,
    fingerprint TEXT NOT NULL, provenance TEXT NOT NULL,
    stage4_blocking_class_summary TEXT NOT NULL DEFAULT 'NONBLOCKING_DRAWING_REVIEW',
    unique_exception_count INTEGER NOT NULL DEFAULT 0, cross_sheet_reference_count INTEGER NOT NULL DEFAULT 0,
    generic_facp_count INTEGER NOT NULL DEFAULT 0, remaining_engineer_review_required INTEGER NOT NULL DEFAULT 0,
    remaining_confirm_project_reference INTEGER NOT NULL DEFAULT 0, remaining_confirm_same_panel INTEGER NOT NULL DEFAULT 0,
    resolved_count INTEGER NOT NULL DEFAULT 0, mirrored_discrepancy_resolved INTEGER NOT NULL DEFAULT 0,
    stale_count INTEGER NOT NULL DEFAULT 0, real_architecture_conflict_remaining INTEGER NOT NULL DEFAULT 0,
    approved_prior_row_count INTEGER NOT NULL DEFAULT 0, approved_next_row_count INTEGER NOT NULL,
    approved_next_version_number INTEGER NOT NULL, policy_version TEXT NOT NULL, computed_by TEXT NOT NULL,
    reason TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    superseded_at TEXT, superseding_readiness_id TEXT);
  CREATE UNIQUE INDEX drawing_architecture_stage4_readiness_project_version_uniq
    ON drawing_architecture_stage4_readiness (project_id, version_number);
`;

// ---------------------------------------------------------------------------
// In-memory DB shaped like D1 (+ write tracking for the no-side-effect tests).
// ---------------------------------------------------------------------------
export const makeArchDb = (projectId = "proj-1", { track = true } = {}) => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(ARCHITECTURE_REVIEW_DDL);
  raw.prepare("INSERT INTO projects (id,owner_user_id,organization_id,name,archived_at) VALUES (?,?,?,?,NULL)").run(projectId, DEV_ID, DEV_ORG, "Al Mousa Fixture Pilot");
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
    prepare: (sql) => ({ bind: (...args) => operation(sql, args) }),
    batch: async (statements) => {
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
// Seeding helpers.
// ---------------------------------------------------------------------------
export const seedArchDocument = ({ raw, projectId = "proj-1", documentId, logicalName = null, documentVersionId = "ver-1", intakeId, intakeVersion = 1, intakeStatus = "Completed", intakeSupersededAt = null, drawingNumber = null, revision = null, sheetName = null, classificationType = null, classificationConfidence = 90, assets = [], pages = null }) => {
  const did = documentId || `doc-${Math.random().toString(36).slice(2, 8)}`;
  const iid = intakeId || `intake-${did}`;
  raw.prepare("INSERT INTO documents (id,project_id,logical_name,current_version_id,deleted_at) VALUES (?,?,?,?,NULL)").run(did, projectId, logicalName ?? `${drawingNumber ?? did}.pdf`, documentVersionId);
  raw.prepare("INSERT INTO drawing_intake_versions (id,project_id,document_id,document_version_id,version_number,status,superseded_at) VALUES (?,?,?,?,?,?,?)").run(iid, projectId, did, documentVersionId, intakeVersion, intakeStatus, intakeSupersededAt);
  if (drawingNumber) {
    raw.prepare("INSERT INTO drawing_metadata (id,intake_version_id,drawing_number,revision,sheet_name,discipline,scale,review_status,created_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").run(`meta-${did}`, iid, drawingNumber, revision, sheetName, null, null, "Needs Review");
  }
  if (classificationType) {
    raw.prepare("INSERT INTO drawing_document_classifications (id,intake_version_id,classification_type,confidence,extraction_method,review_status) VALUES (?,?,?,?,?,?)").run(`class-${did}`, iid, classificationType, classificationConfidence, "fixture", "Needs Review");
  }
  const pageRows = pages || [{ pageNumber: 1, width: 1189, height: 841, coordinateMode: "drawn-space" }];
  for (const p of pageRows) {
    raw.prepare("INSERT INTO drawing_pages (id,intake_version_id,page_number,width,height,coordinate_mode,rotation) VALUES (?,?,?,?,?,?,0)").run(`page-${iid}-${p.pageNumber}`, iid, p.pageNumber, p.width, p.height, p.coordinateMode || "drawn-space");
  }
  for (const [index, a] of assets.entries()) {
    const assetId = a.id ?? `asset-${iid}-${index}`;
    const pageId = a.pageId ?? `page-${iid}-${a.pageNumber ?? 1}`;
    raw.prepare("INSERT INTO drawing_assets (id,intake_version_id,page_id,asset_type,text_content,bounding_box,review_status) VALUES (?,?,?,?,?,?,?)").run(assetId, iid, pageId, a.assetType ?? "Text", a.text, JSON.stringify(a.box ?? { x: 0, y: 0, width: 20, height: 20 }), "Needs Review");
  }
  return { documentId: did, intakeId: iid };
};

// Add a newer CURRENT intake for an EXISTING document (supersede-then-reseed
// flows, test K). Inserts only the intake/meta/pages/assets of the new intake;
// the document row itself is untouched. Callers supersede the old intake FIRST.
export const seedArchIntakeVersion = ({ raw, projectId = "proj-1", documentId, documentVersionId = "ver-1", intakeId, intakeVersion, intakeStatus = "Completed", drawingNumber = null, revision = null, sheetName = null, classificationType = null, classificationConfidence = 90, assets = [] }) => {
  const iid = intakeId || `intake-${documentId}-${intakeVersion}`;
  raw.prepare("INSERT INTO drawing_intake_versions (id,project_id,document_id,document_version_id,version_number,status,superseded_at,created_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").run(iid, projectId, documentId, documentVersionId, intakeVersion, intakeStatus, null);
  if (drawingNumber) {
    raw.prepare("INSERT INTO drawing_metadata (id,intake_version_id,drawing_number,revision,sheet_name,discipline,scale,review_status,created_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").run(`meta-${documentId}-${iid}`, iid, drawingNumber, revision, sheetName, null, null, "Needs Review");
  }
  if (classificationType) {
    raw.prepare("INSERT INTO drawing_document_classifications (id,intake_version_id,classification_type,confidence,extraction_method,review_status) VALUES (?,?,?,?,?,?)").run(`class-${documentId}-${iid}`, iid, classificationType, classificationConfidence, "fixture", "Needs Review");
  }
  for (const [index, a] of assets.entries()) {
    const assetId = a.id ?? `asset-${iid}-${index}`;
    const pageId = a.pageId ?? `page-${iid}-${a.pageNumber ?? 1}`;
    raw.prepare("INSERT INTO drawing_pages (id,intake_version_id,page_number,width,height,coordinate_mode,rotation) VALUES (?,?,?,?,?,?,0)").run(pageId, iid, a.pageNumber ?? 1, 1189, 841, "drawn-space");
    raw.prepare("INSERT INTO drawing_assets (id,intake_version_id,page_id,asset_type,text_content,bounding_box,review_status) VALUES (?,?,?,?,?,?,?)").run(assetId, iid, pageId, a.assetType ?? "Text", a.text, JSON.stringify(a.box ?? { x: 0, y: 0, width: 20, height: 20 }), "Needs Review");
  }
  return { documentId, intakeId: iid };
};

export const seedGovernedLegendRow = ({ raw, projectId = "proj-1", documentId, t00DrawingNumber, abbreviation, description, versionNumber = 1 }) => {
  const avId = `approvedStruct-${projectId}-${versionNumber}-${Math.random().toString(36).slice(2, 8)}`;
  raw.prepare("INSERT INTO drawing_structure_approved_versions (id,project_id,document_id,source_structure_version_id,version_number,input_fingerprint,output_fingerprint,status,approved_row_count,excluded_row_count,created_by,reason,superseded_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)")
    .run(avId, projectId, documentId, null, versionNumber, `IN_${avId}`, `OUT_${avId}`, "Active", 1, 0, "system:deterministic-drawing-evaluation", "fixture governed row", null);
  raw.prepare("INSERT INTO drawing_structure_approved_rows (id,approved_version_id,review_case_id,source_legend_row_id,source_page,source_row,symbol_geometry,abbreviation,description,notes,bounding_box,structural_confidence,review_actor_id,review_reason,source_snapshot,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)")
    .run(`approvedRow-${documentId}-${abbreviation}`, avId, null, null, 1, 1, "[]", abbreviation, description, null, JSON.stringify({ x: 0, y: 0, width: 20, height: 20 }), 92, "system:deterministic-drawing-evaluation", "fixture", "{}");
  return { approvedVersionId: avId };
};

// Seed the REAL T-00 governed FA legend rows (project-scoped approved rows).
// Verbatim from the live governed structure (15 rows, AMS T-00-ZZZ-002).
export const seedRealT00Legend = ({ raw, projectId = "proj-1", documentId }) => {
  const rows = [
    ["MFACP", "MAIN FIRE ALARM CONTROL PANEL"],
    ["H", "HEAT DETECTOR"],
    ["S", "SMOKE DETECTOR"],
    ["F", "FIRE ALARM MANUAL STATION"],
    ["DC", "DOOR CONTACT"],
    ["S D", "DUCT DETECTOR"],
    ["S H", "SMOKE AND HEAT COMBINED DETECTOR"],
    ["FARP", "FIRE ALARM REPEATER PANEL"],
    ["FTCP", "FIREMAN TELEPHONE CONTROL PANEL"],
    ["T", "FIREMAN TELEPHONE JACK"],
    ["CE C", "INTERFACE MODULE CONTROL"],
    ["CE M", "INTERFACE MODULE MONITORING"],
    ["WP", "LOOP POWERED STROBE WITH SOUNDER (WEATHER PROOF TYPE)"],
    ["WP C", "CEILING MOUNTED LOOP POWERED STROBE WITH SOUNDER (WEATHER PROOF TYPE)"],
    ["ZIM", "ZONE INTERFACE MODULE"],
  ];
  for (const [abbreviation, description] of rows) seedGovernedLegendRow({ raw, projectId, documentId, abbreviation, description });
  return rows.length;
};

// ---------------------------------------------------------------------------
// Real Al Mousa golden evidence (extracted verbatim from the live miniflare
// D1 -- 12 FA PDFs, current Completed intakes).
// ---------------------------------------------------------------------------
export const REAL_ARCHITECTURE_EVIDENCE = (() => {
  const here = fileURLToPath(new URL("./", import.meta.url));
  return JSON.parse(readFileSync(new URL("../golden/fa-architecture-real-assets.json", `file://${here}`), "utf8"));
})();

export const seedRealSheet = ({ raw, projectId = "proj-1", sheetKey, documentId, intakeId }) => {
  const golden = REAL_ARCHITECTURE_EVIDENCE[sheetKey];
  const assets = golden.assets.map((a) => ({ id: `${sheetKey}-${a.id}`, assetType: a.assetType ?? "Text", text: a.text, box: a.box, pageNumber: 1 }));
  return seedArchDocument({
    raw,
    projectId,
    documentId,
    logicalName: `${golden.drawingNumber}.pdf`,
    drawingNumber: golden.drawingNumber,
    sheetName: golden.sheetName,
    intakeId,
    assets,
  });
};

// ---------------------------------------------------------------------------
// Request harness (binds the project-scoped pipeline to the in-memory DB).
// ---------------------------------------------------------------------------
export const apiArchRequest = (path, { method = "GET", body } = {}) => {
  const request = new Request(`http://127.0.0.1:4183${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return async (env) => {
    const response = await handleDrawingArchitectureReviewApi(request, env);
    if (!response) return { status: 404, body: { error: { code: "NOT_HANDLED", message: "route not handled" } } };
    return { status: response.status, body: await response.json() };
  };
};

export const archInitializePath = (projectId) => `/api/projects/${projectId}/drawing-architecture/review/initialize`;
export const archReviewPath = (projectId) => `/api/projects/${projectId}/drawing-architecture/review`;
export const archEvaluatePath = (projectId) => `/api/projects/${projectId}/drawing-architecture/review/evaluate`;
export const archConfirmPath = (projectId) => `/api/projects/${projectId}/drawing-architecture/review/deterministic-confirm`;
export const archApprovedCurrentPath = (projectId) => `/api/projects/${projectId}/drawing-architecture/approved/current`;
export const archApprovedHistoryPath = (projectId) => `/api/projects/${projectId}/drawing-architecture/approved/history`;
export const archAdjudicateEvaluatePath = (projectId) => `/api/projects/${projectId}/drawing-architecture/adjudication/evaluate`;
export const archAdjudicateApplyPath = (projectId) => `/api/projects/${projectId}/drawing-architecture/adjudication/apply`;
export const archAdjudicationCurrentPath = (projectId) => `/api/projects/${projectId}/drawing-architecture/adjudication/current`;
export const archAdjudicationHistoryPath = (projectId) => `/api/projects/${projectId}/drawing-architecture/adjudication/history`;
export const archReadinessPath = (projectId) => `/api/projects/${projectId}/drawing-architecture/readiness`;
export const archReadinessHistoryPath = (projectId) => `/api/projects/${projectId}/drawing-architecture/readiness/history`;
export const archBridgePath = (projectId) => `/api/projects/${projectId}/drawing-architecture/bridge`;

// ---------------------------------------------------------------------------
// Row helpers.
// ---------------------------------------------------------------------------
export const casesRows = (raw, projectId = "proj-1") => raw.prepare("SELECT * FROM drawing_architecture_review_cases WHERE project_id=? ORDER BY fact_type,id").all(projectId);
export const caseByFact = (raw, projectId, factType, subject, object = null) => {
  const rows = casesRows(raw, projectId);
  return rows.find((r) => r.fact_type === factType && r.subject === subject && (object === null || r.object === object)) || null;
};
export const snapshotOf = (row) => JSON.parse(row.current_snapshot);
export const decisionState = (row) => (row ? (JSON.parse(row.decision_reason || "[]"), row.decision_state ?? row.status) : null);