import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { handleDocumentApi } from "../worker/document-api.mjs";

const fixture = () => {
  const raw = new DatabaseSync(":memory:");

  raw.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT,
      owner_user_id TEXT,
      organization_id TEXT,
      archived_at TEXT
    );

    CREATE TABLE upload_sessions (
      id TEXT PRIMARY KEY
    );

    CREATE TABLE documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      logical_name TEXT,
      document_type TEXT,
      notes TEXT,
      tags TEXT DEFAULT '[]',
      classification_source TEXT,
      current_version_id TEXT,
      archived_at TEXT,
      deleted_at TEXT,
      created_by TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE document_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      version_number INTEGER,
      original_filename TEXT,
      stored_filename TEXT,
      extension TEXT,
      mime_type TEXT,
      byte_size INTEGER,
      sha256 TEXT,
      object_key TEXT,
      revision TEXT,
      issue_purpose TEXT,
      drawing_status TEXT DEFAULT 'UNKNOWN',
      uploaded_by TEXT,
      uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
      quarantine_status TEXT
    );

    CREATE TABLE document_processing_runs (
      id TEXT PRIMARY KEY,
      document_version_id TEXT,
      stage TEXT,
      status TEXT,
      progress INTEGER,
      error_code TEXT,
      error_message TEXT,
      suggested_action TEXT,
      started_at TEXT,
      completed_at TEXT,
      last_retry_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE processing_history (id TEXT PRIMARY KEY);
    CREATE TABLE document_audit_events (id TEXT PRIMARY KEY);

    CREATE TABLE classification_model_versions (id TEXT PRIMARY KEY);
    CREATE TABLE classification_candidates (id TEXT PRIMARY KEY);
    CREATE TABLE classification_evidence (id TEXT PRIMARY KEY);
    CREATE TABLE classification_segments (id TEXT PRIMARY KEY);
    CREATE TABLE classification_overrides (id TEXT PRIMARY KEY);
    CREATE TABLE downstream_routing_handoffs (id TEXT PRIMARY KEY);

    CREATE TABLE document_classifications (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      primary_type TEXT,
      secondary_types TEXT,
      confidence INTEGER,
      confidence_state TEXT,
      status TEXT,
      manual_review_required INTEGER,
      downstream_route TEXT,
      error_code TEXT,
      error_message TEXT,
      superseded_at TEXT,
      classified_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE processing_logs (id TEXT PRIMARY KEY);
    CREATE TABLE boq_extraction_sources (id TEXT PRIMARY KEY);
    CREATE TABLE boq_sections (id TEXT PRIMARY KEY);
    CREATE TABLE boq_extraction_evidence (id TEXT PRIMARY KEY);
    CREATE TABLE boq_extraction_warnings (id TEXT PRIMARY KEY);
    CREATE TABLE boq_review_decisions (id TEXT PRIMARY KEY);
    CREATE TABLE boq_revision_comparisons (id TEXT PRIMARY KEY);

    CREATE TABLE boq_extraction_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      document_version_id TEXT NOT NULL,
      version_number INTEGER,
      status TEXT,
      summary TEXT,
      error_code TEXT,
      error_message TEXT,
      suggested_action TEXT,
      superseded_at TEXT
    );

    CREATE TABLE boq_items (
      id TEXT PRIMARY KEY,
      extraction_version_id TEXT NOT NULL,
      project_id TEXT,
      source_document_id TEXT,
      row_type TEXT,
      review_status TEXT,
      approved_for_downstream INTEGER DEFAULT 0
    );

    CREATE TABLE specification_extraction_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      document_version_id TEXT NOT NULL,
      version_number INTEGER,
      status TEXT,
      summary TEXT,
      error_code TEXT,
      error_message TEXT,
      suggested_action TEXT,
      superseded_at TEXT
    );

    CREATE TABLE specification_extraction_jobs (
      id TEXT PRIMARY KEY,
      extraction_version_id TEXT,
      document_id TEXT,
      document_version_id TEXT,
      project_id TEXT,
      status TEXT,
      total_pages INTEGER,
      processed_pages INTEGER,
      current_page INTEGER,
      current_chunk INTEGER,
      completed_chunks INTEGER,
      remaining_chunks INTEGER,
      extracted_clauses INTEGER,
      extracted_requirements INTEGER,
      elapsed_seconds INTEGER,
      estimated_remaining_seconds INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE specification_extraction_chunks (id TEXT PRIMARY KEY);
    CREATE TABLE specification_extraction_pages (id TEXT PRIMARY KEY);
    CREATE TABLE specification_chunk_entities (id TEXT PRIMARY KEY);
    CREATE TABLE specification_extraction_failures (id TEXT PRIMARY KEY);
    CREATE TABLE specification_extraction_checkpoints (id TEXT PRIMARY KEY);
    CREATE TABLE specification_document_map_entries (id TEXT PRIMARY KEY);
    CREATE TABLE specification_document_map_details (id TEXT PRIMARY KEY);
    CREATE TABLE specification_chunk_metrics (id TEXT PRIMARY KEY);

    CREATE TABLE technical_requirements (
      id TEXT PRIMARY KEY,
      extraction_version_id TEXT NOT NULL,
      project_id TEXT,
      source_document_id TEXT,
      review_status TEXT,
      approved_for_downstream INTEGER DEFAULT 0
    );

    CREATE TABLE drawing_intake_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      document_id TEXT NOT NULL,
      document_version_id TEXT NOT NULL,
      version_number INTEGER,
      status TEXT,
      summary TEXT,
      review_status TEXT,
      superseded_at TEXT
    );

    CREATE TABLE project_context_extraction_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      document_id TEXT,
      document_version_id TEXT,
      version_number INTEGER,
      status TEXT,
      superseded_at TEXT
    );

    CREATE TABLE project_context_facts (
      id TEXT PRIMARY KEY,
      extraction_version_id TEXT,
      review_status TEXT
    );

    CREATE TABLE supplier_quote_intake_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      document_id TEXT,
      document_version_id TEXT,
      status TEXT,
      candidate_count INTEGER DEFAULT 0,
      superseded_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_quote_intake_rows (
      id TEXT PRIMARY KEY,
      intake_run_id TEXT,
      project_id TEXT,
      document_id TEXT,
      document_version_id TEXT,
      row_type TEXT,
      review_status TEXT,
      promoted_price_record_id TEXT
    );
  `);

  raw.exec(`
    INSERT INTO projects VALUES
      ('p1','Project 1','user-a','org-a',NULL);

    INSERT INTO documents
      (id,project_id,logical_name,document_type,current_version_id,archived_at,deleted_at)
    VALUES
      ('draw-a','p1','Drawing A','Drawing','v-draw-a',NULL,NULL),
      ('draw-b','p1','Drawing B','Drawing','v-draw-b',NULL,NULL),
      ('boq-a','p1','BOQ A','BOQ','v-boq-a',NULL,NULL),
      ('spec-a','p1','Spec A','Technical Specification','v-spec-a',NULL,NULL),
      ('quote-a','p1','Supplier Quote A','Supplier Quotation','v-quote-a',NULL,NULL);

    INSERT INTO document_versions
      (id,document_id,version_number,original_filename,extension,mime_type,byte_size,sha256,uploaded_by,quarantine_status)
    VALUES
      ('v-draw-a','draw-a',1,'drawing-a.pdf','pdf','application/pdf',100,'sha-a','user-a','Clear'),
      ('v-draw-b','draw-b',1,'drawing-b.pdf','pdf','application/pdf',100,'sha-b','user-a','Clear'),
      ('v-boq-a','boq-a',1,'boq-a.xlsx','xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',100,'sha-c','user-a','Clear'),
      ('v-spec-a','spec-a',1,'spec-a.pdf','pdf','application/pdf',100,'sha-d','user-a','Clear'),
      ('v-quote-a','quote-a',1,'supplier-quote-a.xlsx','xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',100,'sha-e','user-a','Clear');

    -- Documents Workspace Truth Fix (2026-09-06): status is 'Manually
    -- Confirmed' for all five, not the classifier's own automatic
    -- 'Classified' -- documentDownstreamState's classificationConfirmed()
    -- now requires real human confirmation, matching every other governed
    -- confirmed-check in this codebase. These fixtures test pipeline/
    -- extraction/review computation, not the confirmation gate itself.
    INSERT INTO document_classifications
      (id,document_id,primary_type,confidence,confidence_state,status,manual_review_required,downstream_route)
    VALUES
      ('c1','draw-a','Drawing',100,'High','Manually Confirmed',0,'Drawing Analysis'),
      ('c2','draw-b','Drawing',100,'High','Manually Confirmed',0,'Drawing Analysis'),
      ('c3','boq-a','BOQ',100,'High','Manually Confirmed',0,'BOQ Extraction'),
      ('c4','spec-a','Technical Specification',100,'High','Manually Confirmed',0,'Specification Extraction'),
      ('c5','quote-a','Supplier Quotation',100,'High','Manually Confirmed',0,'Supplier Price Intake');

    INSERT INTO drawing_intake_versions
      (id,project_id,document_id,document_version_id,version_number,status,summary,review_status,superseded_at)
    VALUES
      ('di1','p1','draw-b','v-draw-b',1,'Completed','{}','Needs Review',NULL);

    INSERT INTO boq_extraction_versions
      (id,document_id,document_version_id,version_number,status,summary,superseded_at)
    VALUES
      ('bx1','boq-a','v-boq-a',1,'Completed','{}',NULL);

    INSERT INTO boq_items VALUES
      ('b1','bx1','p1','boq-a','BOQ Item','Needs Review',0),
      ('b2','bx1','p1','boq-a','BOQ Item','Needs Review',0),
      ('b3','bx1','p1','boq-a','BOQ Item','Approved',1);

    INSERT INTO specification_extraction_versions
      (id,document_id,document_version_id,version_number,status,summary,superseded_at)
    VALUES
      ('sx1','spec-a','v-spec-a',1,'Completed','{}',NULL);

    INSERT INTO technical_requirements VALUES
      ('r1','sx1','p1','spec-a','Needs Review',0),
      ('r2','sx1','p1','spec-a','Approved',1),
      ('r3','sx1','p1','spec-a','Approved',1);

    INSERT INTO supplier_quote_intake_runs
      (id,project_id,document_id,document_version_id,status,candidate_count,superseded_at)
    VALUES
      ('sqi1','p1','quote-a','v-quote-a','NEEDS REVIEW',3,NULL);

    INSERT INTO supplier_quote_intake_rows VALUES
      ('sq1','sqi1','p1','quote-a','v-quote-a','SUPPLIER_LINE','Needs Review',NULL),
      ('sq2','sqi1','p1','quote-a','v-quote-a','SUPPLIER_LINE','Approved','price-2'),
      ('sq3','sqi1','p1','quote-a','v-quote-a','SUPPLIER_LINE','Rejected',NULL),
      ('sq4','sqi1','p1','quote-a','v-quote-a','HEADER','Needs Review',NULL);
  `);

  const operation = (sql, args = []) => ({
    first: async () => raw.prepare(sql).get(...args),
    all: async () => ({ results: raw.prepare(sql).all(...args) }),
    run: async () => raw.prepare(sql).run(...args),
  });

  const DB = {
    prepare(sql) {
      return {
        ...operation(sql),
        bind: (...args) => operation(sql, args),
      };
    },
    async batch(statements) {
      raw.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };

  const FILES = {
    put: async () => {},
    get: async () => null,
    delete: async () => {},
  };

  return {
    raw,
    env: {
      DB,
      FILES,
      APP_ACCESS_MODE: "single-user",
      APP_USER_ID: "user-a",
      APP_ORGANIZATION_ID: "org-a",
    },
  };
};

const getDocuments = async (env) => {
  const response = await handleDocumentApi(
    new Request("https://app.example/api/projects/p1/documents"),
    env,
    { waitUntil() {} },
  );
  return { response, body: await response.json() };
};

test("documents API projects persisted downstream truth into one normalized contract", async () => {
  const { raw, env } = fixture();

  const { response, body } = await getDocuments(env);

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.documents.length, 5);

  const byId = new Map(body.documents.map((document) => [document.id, document]));

  const drawingNotStarted = byId.get("draw-a");
  assert.equal(drawingNotStarted.drawing_intake_id, null);
  assert.equal(drawingNotStarted.downstream_state.kind, "Drawing");
  assert.equal(drawingNotStarted.downstream_state.pipelineStatus, "Not Started");
  assert.equal(drawingNotStarted.downstream_state.recommendedAction, "Open drawing workspace");

  const drawingCompleted = byId.get("draw-b");
  assert.equal(drawingCompleted.drawing_intake_id, "di1");
  assert.equal(drawingCompleted.drawing_intake_status, "Completed");
  assert.equal(drawingCompleted.drawing_intake_review_status, "Needs Review");
  assert.equal(drawingCompleted.downstream_state.pipelineStatus, "Completed");
  assert.equal(drawingCompleted.downstream_state.reviewStatus, "Needs Review");
  assert.equal(drawingCompleted.downstream_state.readyForDownstream, false);

  const boq = byId.get("boq-a");
  assert.equal(Number(boq.boq_item_count), 3);
  assert.equal(Number(boq.boq_items_pending), 2);
  assert.equal(Number(boq.boq_items_approved), 1);
  assert.equal(boq.downstream_state.totalCount, 3);
  assert.equal(boq.downstream_state.pendingCount, 2);
  assert.equal(boq.downstream_state.approvedCount, 1);
  assert.equal(boq.downstream_state.reviewStatus, "Partially Reviewed");
  assert.equal(boq.downstream_state.readyForDownstream, false);

  const spec = byId.get("spec-a");
  assert.equal(Number(spec.specification_requirement_count), 3);
  assert.equal(Number(spec.specification_requirements_pending), 1);
  assert.equal(Number(spec.specification_requirements_approved), 2);
  assert.equal(spec.downstream_state.totalCount, 3);
  assert.equal(spec.downstream_state.pendingCount, 1);
  assert.equal(spec.downstream_state.approvedCount, 2);
  assert.equal(spec.downstream_state.reviewStatus, "Partially Reviewed");
  assert.equal(spec.downstream_state.readyForDownstream, false);

  const quote = byId.get("quote-a");
  assert.equal(quote.supplier_quote_intake_id, "sqi1");
  assert.equal(Number(quote.supplier_quote_line_count), 3);
  assert.equal(Number(quote.supplier_quote_lines_pending), 1);
  assert.equal(Number(quote.supplier_quote_lines_approved), 1);
  assert.equal(quote.downstream_state.pipelineStatus, "Completed");
  assert.equal(quote.downstream_state.reviewStatus, "Partially Reviewed");
  assert.equal(quote.downstream_state.totalCount, 3);
  assert.equal(quote.downstream_state.pendingCount, 1);
  assert.equal(quote.downstream_state.approvedCount, 1);
  assert.equal(quote.downstream_state.readyForDownstream, false);
  assert.equal(quote.downstream_state.recommendedAction, "Review supplier quote");

  raw.close();
});
