import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import * as costApi from "../worker/boq-line-cost-api.mjs";
import * as excelApi from "../worker/excel-export-api.mjs";
import { handleSpecificationExtractionApi } from "../worker/specification-extraction-api.mjs";

const SPECIFICATION_JOB_TABLES = [
  "specification_extraction_jobs",
  "specification_extraction_chunks",
  "specification_extraction_pages",
  "specification_chunk_entities",
  "specification_extraction_failures",
  "specification_extraction_checkpoints",
  "specification_document_map_entries",
  "specification_document_map_details",
  "specification_chunk_metrics",
];

class SpecificationDb {
  constructor({ jobStatus = "Running", checkpointAgeMs = 120_000, retryChanges = 0, allowWrites = false } = {}) {
    this.jobStatus = jobStatus;
    this.checkpointAgeMs = checkpointAgeMs;
    this.retryChanges = retryChanges;
    this.allowWrites = allowWrites;
  }

  prepare(sql) {
    const statement = {
      all: async () => {
        if (sql.includes("FROM sqlite_master")) return { results: SPECIFICATION_JOB_TABLES.map((name) => ({ name })) };
        return { results: [] };
      },
      first: async () => {
        if (sql.includes("FROM documents d")) return { id: "document-1", project_id: "project-1", classification_status: "Manually Confirmed" };
        if (sql.includes("FROM specification_extraction_versions")) return { id: "extraction-1", document_id: "document-1", status: "Running", version_number: 1, summary: "{}" };
        if (sql.includes("FROM specification_extraction_jobs")) return { id: "job-1", extraction_version_id: "extraction-1", document_id: "document-1", status: this.jobStatus, last_checkpoint_at: new Date(Date.now() - this.checkpointAgeMs).toISOString() };
        return null;
      },
      run: async () => {
        if (this.allowWrites && (/^UPDATE specification_/i.test(sql.trim()) || /^INSERT INTO specification_/i.test(sql.trim()))) return { meta: { changes: 1 } };
        if (sql.includes("UPDATE specification_extraction_chunks")) return { meta: { changes: this.retryChanges } };
        throw new Error(`Unexpected specification write during a read test: ${sql}`);
      },
    };
    statement.bind = () => statement;
    return statement;
  }

  async batch() { return [{ meta: { changes: 0 } }]; }
}

const specificationEnv = (DB, sent) => ({
  DB,
  FILES: {},
  SPECIFICATION_QUEUE: { send: async (message) => { sent.push(message); } },
});

test("specification status and summary GET reads do not dispatch stale work", async () => {
  for (const operation of ["status", "summary"]) {
    const sent = [];
    const response = await handleSpecificationExtractionApi(
      new Request(`http://localhost/api/documents/document-1/specification-extraction/${operation}`),
      specificationEnv(new SpecificationDb(), sent),
      { waitUntil() { throw new Error("GET must not schedule fallback work"); } },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(sent, [], `${operation} GET must remain read-only`);
  }
});

test("explicit specification resume and chunk retry commands still dispatch", async () => {
  const resumeSent = [];
  const resume = await handleSpecificationExtractionApi(
    new Request("http://localhost/api/documents/document-1/specification-extraction/resume", { method: "POST" }),
    specificationEnv(new SpecificationDb({ jobStatus: "Paused", allowWrites: true }), resumeSent),
    { waitUntil() { throw new Error("Queue-bound command unexpectedly used fallback dispatch"); } },
  );
  assert.equal(resume.status, 200);
  assert.deepEqual(resumeSent, [{ jobId: "job-1" }]);

  const retrySent = [];
  const retry = await handleSpecificationExtractionApi(
    new Request("http://localhost/api/documents/document-1/specification-extraction/chunks/chunk-1/retry", { method: "POST" }),
    specificationEnv(new SpecificationDb({ jobStatus: "Failed", retryChanges: 1, allowWrites: true }), retrySent),
    { waitUntil() { throw new Error("Queue-bound command unexpectedly used fallback dispatch"); } },
  );
  assert.equal(retry.status, 202);
  assert.deepEqual(retrySent, [{ jobId: "job-1" }]);

  const source = await readFile(new URL("../worker/specification-extraction-api.mjs", import.meta.url), "utf8");
  assert.match(source, /operation === "rerun"[\s\S]{0,1000}dispatchSpecificationWork/);
});

test("cost read scenario authority only loads an already selected current scenario", async () => {
  assert.equal(typeof costApi.loadGovernedPricingScenario, "function");
  const sql = [];
  const selectedDb = {
    prepare(statement) {
      sql.push(statement);
      return {
        bind() { return this; },
        async first() {
          if (statement.includes("FROM project_dashboard_profiles")) return { selected_pricing_scenario_id: "scenario-1" };
          if (statement.includes("FROM pricing_scenarios")) return { id: "scenario-1", project_id: "project-1", project_currency: "USD", status: "Approved" };
          throw new Error(`Unexpected selected-scenario query: ${statement}`);
        },
      };
    },
  };
  const selected = await costApi.loadGovernedPricingScenario(selectedDb, "project-1");
  assert.equal(selected.blocker, null);
  assert.equal(selected.scenario.project_currency, "USD");

  let scenarioLookup = 0;
  const unselectedDb = {
    prepare(statement) {
      return {
        bind() { return this; },
        async first() {
          if (statement.includes("FROM project_dashboard_profiles")) return { selected_pricing_scenario_id: null };
          scenarioLookup += 1;
          throw new Error("An unselected cost read must not create or resolve a scenario.");
        },
      };
    },
  };
  const unselected = await costApi.loadGovernedPricingScenario(unselectedDb, "project-1");
  assert.equal(unselected.scenario, null);
  assert.equal(unselected.blocker.code, "PRICING_SCENARIO_UNSELECTED");
  assert.equal(scenarioLookup, 0);

  const source = await readFile(new URL("../worker/boq-line-cost-api.mjs", import.meta.url), "utf8");
  const buildSource = source.slice(source.indexOf("export const buildLineCostModel"), source.indexOf("export async function handleBoqLineCostApi"));
  assert.match(buildSource, /loadGovernedPricingScenario/);
  assert.doesNotMatch(buildSource, /ensureDefaultScenario/);
});

class TemplateReadDb {
  constructor() { this.writes = 0; }
  prepare(sql) {
    const statement = {
      all: async () => sql.includes("FROM export_templates") ? { results: [{ id: "template-1", supported_modes: "[]", sheet_configuration: "{}" }] } : { results: [] },
      first: async () => null,
      run: async () => { this.writes += 1; throw new Error("A template GET must not provision a template."); },
    };
    statement.bind = () => statement;
    return statement;
  }
  async batch() { this.writes += 1; throw new Error("A template GET must not batch writes."); }
}

test("Excel template GET never provisions templates", async () => {
  const DB = new TemplateReadDb();
  const response = await excelApi.handleExcelExportApi(
    new Request("http://localhost/api/excel-exports/templates"),
    { DB, FILES: {} },
  );

  assert.equal(response.status, 200);
  assert.equal(DB.writes, 0);
});

test("Excel export creation is the explicit command that provisions its template", async () => {
  let provisioned = false;
  const sentinel = new Error("stop after explicit provisioning");
  const DB = {
    prepare(sql) {
      return {
        bind() { return this; },
        async first() {
          if (sql.includes("FROM projects p")) return { id: "project-1", name: "Project" };
          return null;
        },
        async all() { return { results: [] }; },
        async run() { if (sql.includes("INSERT OR IGNORE INTO export_templates")) provisioned = true; },
      };
    },
    async batch() { if (provisioned) throw sentinel; },
  };

  await assert.rejects(
    excelApi.handleExcelExportApi(
      new Request("http://localhost/api/excel-exports/projects/project-1/exports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "Draft Cost Sheet" }),
      }),
      { DB, FILES: {} },
    ),
    sentinel,
  );
  assert.equal(provisioned, true);
});

class DownloadReadDb {
  constructor() { this.writes = 0; }
  prepare(sql) {
    const statement = {
      first: async () => {
        if (sql.includes("FROM excel_export_jobs")) return { id: "job-1", project_id: "project-1", status: "Completed", stage: "Completed" };
        if (sql.includes("FROM projects p")) return { id: "project-1" };
        if (sql.includes("FROM excel_export_files")) return { id: "file-1", object_key: "exports/job-1.xlsx", mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename: "job-1.xlsx", sha256: "abc" };
        return null;
      },
      all: async () => ({ results: [] }),
      run: async () => { this.writes += 1; throw new Error("Workbook GET must not mutate download telemetry."); },
    };
    statement.bind = () => statement;
    return statement;
  }
  async batch() { this.writes += 1; throw new Error("Workbook GET must not batch writes."); }
}

test("Excel workbook GET does not mutate download telemetry", async () => {
  const DB = new DownloadReadDb();
  const response = await excelApi.handleExcelExportApi(
    new Request("http://localhost/api/excel-exports/job-1/download"),
    { DB, FILES: { get: async () => ({ body: new Uint8Array([1, 2, 3]) }) } },
  );

  assert.equal(response.status, 200);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
  assert.equal(DB.writes, 0);
});
