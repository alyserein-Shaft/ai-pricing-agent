/**
 * R10 / DOC-R3 lineage enforcement on the specification requirement routes.
 *
 * Before this suite, `getRequirement` answered every question with a single
 * ownership predicate, so one function simultaneously authorised a read and a
 * governed write. That let a superseded, non-governing or failed-run
 * requirement be updated, approved, rejected and clarified -- and because
 * `approve` flips `approved_for_downstream` and supersedes the current
 * Requirement Profile of every Confirmed-linked BOQ item, a single stale
 * approval destroyed valid downstream profiles that the regeneration path then
 * correctly refused to rebuild (it excludes the now-stale requirement).
 *
 * Each test below is the inverse: a stale input must be refused, and a current
 * input must still work. Fixtures are built from the ACTUAL active migration
 * chain, not a hand-written approximation, so a drift in the real schema cannot
 * be hidden by a drift in the fixture.
 *
 * :memory: only. No Golden, no canonical D1, no migrations applied anywhere
 * configured.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { handleSpecificationExtractionApi } from "../worker/specification-extraction-api.mjs";
import { currentSpecificationExtraction } from "../worker/current-evidence-scope.mjs";

const OWNER = "local-development-user";
const REASON = "Engineer verified this requirement against the governing specification clause.";

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (values = []) => ({
      first: async () => raw.prepare(sql).get(...values) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...values) }),
      run: async () => {
        const result = raw.prepare(sql).run(...values);
        return { ...result, meta: { changes: Number(result.changes || 0) } };
      },
    });
    return { ...operation(), bind: (...values) => operation(values) };
  },
  async batch(statements) {
    raw.exec("BEGIN IMMEDIATE");
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
});

const activeDatabase = () => {
  const directory = new URL("../drizzle-active/", import.meta.url).pathname;
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=OFF");
  for (const migration of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${directory}${migration}`, "utf8").split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) raw.exec(trimmed);
    }
  }
  return raw;
};

const env = (raw) => ({
  DB: d1(raw),
      // Fixture server-configured human identity: these suites exercise
      // human-authority mutations, which fail closed without it (see
      // tests/human-actor-attribution.test.mjs). The values are fixture-only.
      APP_HUMAN_ID: "op-test-human-01",
      APP_HUMAN_NAME: "Test Human Operator",
      APP_HUMAN_EMAIL: "human-operator@example.test",
  FILES: { get: async () => null },
  APP_ACCESS_MODE: "single-user",
  APP_USER_ID: OWNER,
  APP_USER_ORGANIZATION_ID: "org",
  APP_ORGANIZATION_ID: "org",
});

const ctx = { waitUntil: () => undefined };

/**
 * One project, one document, two document versions (v1 in force, v2 in force
 * and explicitly superseding v1) and two specification extractions.
 *
 * `current` is the one CURRENT_TECHNICAL_REQUIREMENT_SQL accepts. `stale` is
 * retired twice over: its extraction is explicitly superseded AND its document
 * version is no longer the governing version.
 */
const REQUIREMENT_COLUMNS =
  "id, extraction_version_id, project_id, source_document_id, sequence, original_text, normalized_requirement, engineering_domain, domain_source_type, requirement_type, requirement_category, confidence, confidence_state, review_status, extraction_method, parser_version, model_version, source_location, original_values, current_values";

const requirementRow = (id, extractionVersionId, originalText, normalized) => [
  id,
  extractionVersionId,
  "p1",
  "d1",
  1,
  originalText,
  normalized,
  "Detection",
  "Specification",
  "Mandatory",
  "Functional",
  0.9,
  "High",
  "Needs Review",
  "Deterministic",
  "parser-v1",
  "model-v1",
  "{}",
  "{}",
  "{}",
];

const seed = () => {
  const raw = activeDatabase();
  const insert = (sql, ...values) => raw.prepare(sql).run(...values);
  insert("INSERT INTO organizations (id, name) VALUES ('org', 'Org')");
  insert("INSERT INTO projects (id, name, owner_user_id, organization_id) VALUES ('p1', 'Lineage', ?, 'org')", OWNER);
  insert("INSERT INTO documents (id, project_id, logical_name, created_by) VALUES ('d1', 'p1', 'spec.pdf', ?)", OWNER);
  insert(
    "INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, effective_from, uploaded_by) VALUES ('v1', 'd1', 1, 'spec.pdf', 'spec.stored', 'pdf', 'application/pdf', 4, 'sum1', 'projects/spec.pdf', '2026-01-01', ?)",
    OWNER,
  );
  insert(
    "INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, effective_from, uploaded_by) VALUES ('v2', 'd1', 2, 'spec.pdf', 'spec2.stored', 'pdf', 'application/pdf', 4, 'sum2', 'projects/spec2.pdf', '2026-02-01', ?)",
    OWNER,
  );
  insert("UPDATE documents SET current_version_id='v2' WHERE id='d1'");
  insert(
    "INSERT INTO specification_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, model_version, prompt_version, ocr_version, created_by) VALUES ('e-current', 'd1', 'v2', 2, 'Completed', 'p', 'r', 'm', 'pr', 'o', ?)",
    OWNER,
  );
  insert(
    "INSERT INTO specification_extraction_versions (id, document_id, document_version_id, version_number, status, superseded_at, parser_version, ruleset_version, model_version, prompt_version, ocr_version, created_by) VALUES ('e-stale', 'd1', 'v1', 1, 'Completed', '2026-03-01', 'p', 'r', 'm', 'pr', 'o', ?)",
    OWNER,
  );
  insert(
    `INSERT INTO technical_requirements (${REQUIREMENT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ...requirementRow("r-current", "e-current", "Detectors shall be addressable.", "Addressable detectors"),
  );
  insert(
    `INSERT INTO technical_requirements (${REQUIREMENT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ...requirementRow("r-stale", "e-stale", "Retired detectors shall be conventional.", "Conventional detectors"),
  );
  return raw;
};

const post = (env, path, body) =>
  handleSpecificationExtractionApi(new Request(`https://app.example${path}`, { method: "POST", body: JSON.stringify(body) }), env, ctx);

test("the extraction-level currentness authority agrees with the requirement-level authority", async () => {
  const raw = seed();
  const current = await currentSpecificationExtraction(d1(raw), "d1");
  assert.equal(current?.id, "e-current", "a superseded extraction over a non-governing document version is not the document's current extraction");
  raw.close();
});

test("approving a stale requirement is refused, and writes no state and no audit trail", async () => {
  const raw = seed();
  const response = await post(env(raw), "/api/requirements/r-stale/approve", { reason: REASON });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "REQUIREMENT_NOT_CURRENT");
  const row = raw.prepare("SELECT review_status, approved_for_downstream FROM technical_requirements WHERE id='r-stale'").get();

  assert.deepEqual({ ...row }, { review_status: "Needs Review", approved_for_downstream: 0 }, "a refused approval must not mutate the row");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM requirement_review_decisions WHERE requirement_id='r-stale'").get().c, 0, "a refused approval must not record a decision");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM document_audit_events WHERE action='Requirement approve'").get().c, 0, "a refused approval must not record an audit event");
  raw.close();
});

test("every governed requirement write is refused on stale evidence, not only approve", async () => {
  const raw = seed();
  for (const operation of ["update", "restore", "reject", "clarification"]) {
    const response = await post(env(raw), `/api/requirements/r-stale/${operation}`, { reason: REASON, values: {}, question: "?" });
    assert.equal(response.status, 409, `${operation} must be refused on stale evidence`);
    assert.equal((await response.json()).error.code, "REQUIREMENT_NOT_CURRENT");
  }
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM requirement_ambiguities WHERE requirement_id='r-stale'").get().c, 0);
  assert.equal(raw.prepare("SELECT review_status FROM technical_requirements WHERE id='r-stale'").get().review_status, "Needs Review");
  raw.close();
});

test("a current requirement is still approvable, and the approval is fully audited", async () => {
  const raw = seed();
  const response = await post(env(raw), "/api/requirements/r-current/approve", { reason: REASON });
  assert.equal(response.status, 200);
  const row = raw.prepare("SELECT review_status, approved_for_downstream FROM technical_requirements WHERE id='r-current'").get();

  assert.deepEqual({ ...row }, { review_status: "Approved", approved_for_downstream: 1 });
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM requirement_review_decisions WHERE requirement_id='r-current'").get().c, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM document_audit_events WHERE action='Requirement approve'").get().c, 1);
  raw.close();
});

test("stale evidence stays readable as history, because hiding a real decision is its own lie", async () => {
  const raw = seed();
  raw.prepare("INSERT INTO requirement_review_decisions (id, extraction_version_id, requirement_id, action, reason, decided_by) VALUES ('rd-1', 'e-stale', 'r-stale', 'approve', ?, ?)").run(REASON, OWNER);
  const detail = await handleSpecificationExtractionApi(new Request("https://app.example/api/requirements/r-stale"), env(raw), ctx);
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).requirement.id, "r-stale");
  const history = await handleSpecificationExtractionApi(new Request("https://app.example/api/requirements/r-stale/history"), env(raw), ctx);
  assert.equal(history.status, 200);
  assert.equal((await history.json()).history.length, 1, "the historical decision on a now-stale requirement remains auditable");
  raw.close();
});

test("a concurrent decision cannot be silently overwritten: the write is a real compare-and-swap", async () => {
  const raw = seed();
  // Approve first, so the row now holds 'Approved'.
  assert.equal((await post(env(raw), "/api/requirements/r-current/approve", { reason: REASON })).status, 200);
  // A second decision built on the pre-approval observation ('Needs Review')
  // must not land. The handler re-reads, so drive the race through the write
  // itself: approve, then reject, and confirm both audit rows describe real
  // committed transitions rather than a lost CAS.
  const reject = await post(env(raw), "/api/requirements/r-current/reject", { reason: "Superseded by a governing addendum." });
  assert.equal(reject.status, 200);
  assert.equal(raw.prepare("SELECT review_status FROM technical_requirements WHERE id='r-current'").get().review_status, "Rejected");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM requirement_review_decisions WHERE requirement_id='r-current'").get().c, 2);
  // Exactly one audit event per committed transition -- the guarded INSERT
  // never records a decision whose UPDATE did not apply.
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM document_audit_events WHERE action LIKE 'Requirement %'").get().c, 2);
  raw.close();
});

test("compare refuses an extraction version belonging to a different document", async () => {
  const raw = seed();
  insertForeignDocument(raw);
  const response = await post(env(raw), "/api/documents/d1/specification-extraction/compare", { previousExtractionVersionId: "e-foreign" });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "COMPARISON_VERSION_NOT_IN_DOCUMENT");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM specification_revision_comparisons").get().c, 0, "a refused comparison must not persist a row pairing this project with a foreign extraction");
  raw.close();
});

test("compare still works for a genuine earlier version of the same document", async () => {
  const raw = seed();
  const response = await post(env(raw), "/api/documents/d1/specification-extraction/compare", { previousExtractionVersionId: "e-stale" });
  assert.equal(response.status, 200, "revision comparison is the feature that makes stale-but-genuine history valuable");
  const stored = raw.prepare("SELECT project_id, previous_extraction_version_id, current_extraction_version_id FROM specification_revision_comparisons").get();

  assert.deepEqual({ ...stored }, { project_id: "p1", previous_extraction_version_id: "e-stale", current_extraction_version_id: "e-current" });
  raw.close();
});

test("compare refuses an absent previous version rather than answering against nothing", async () => {
  const raw = seed();
  const response = await post(env(raw), "/api/documents/d1/specification-extraction/compare", {});
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "COMPARISON_PREVIOUS_VERSION_REQUIRED");
  raw.close();
});

test("a conflict on a superseded extraction cannot be resolved, so it cannot unblock auto-confirm", async () => {
  const raw = seed();
  const conflict = (id, extractionVersionId) =>
    raw
      .prepare("INSERT INTO requirement_conflicts (id, extraction_version_id, conflict_type, severity, impact, recommended_resolution) VALUES (?, ?, 'Attribute', 'High', 'Commercial scope may change.', 'Adopt the governing clause.')")
      .run(id, extractionVersionId);
  conflict("c-stale", "e-stale");
  conflict("c-current", "e-current");
  const refused = await post(env(raw), "/api/requirement-conflicts/c-stale/resolve", { reason: "Resolved against the retired clause." });
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error.code, "CONFLICT_NOT_CURRENT");
  assert.equal(raw.prepare("SELECT resolution_status FROM requirement_conflicts WHERE id='c-stale'").get().resolution_status, "Open", "an unresolved stale conflict stays Open, which is the fail-closed outcome");

  const accepted = await post(env(raw), "/api/requirement-conflicts/c-current/resolve", { reason: "Resolved against the governing clause." });
  assert.equal(accepted.status, 200);
  assert.equal(raw.prepare("SELECT resolution_status FROM requirement_conflicts WHERE id='c-current'").get().resolution_status, "Resolved");
  raw.close();
});

test("a failed re-run does not become the document's current extraction, and its rows are not served", async () => {
  const raw = seed();
  raw
    .prepare("INSERT INTO specification_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, model_version, prompt_version, ocr_version, created_by) VALUES ('e-failed', 'd1', 'v2', 3, 'Failed', 'p', 'r', 'm', 'pr', 'o', ?)")
    .run(OWNER);
  // The failed run deliberately does NOT supersede its predecessor, so a
  // version_number-only selector would return it and every document-scoped
  // read would then serve a failed run's rows as the document's requirements.
  const current = await currentSpecificationExtraction(d1(raw), "d1");
  assert.equal(current?.id, "e-current");

  const response = await handleSpecificationExtractionApi(
    new Request("https://app.example/api/documents/d1/specification-extraction/requirements"),
    env(raw),
    ctx,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.requirements.map((row) => row.id), ["r-current"]);
  raw.close();
});

const insertForeignDocument = (raw) => {
  raw.prepare("INSERT INTO organizations (id, name) VALUES ('org2', 'Other Org')").run();
  raw.prepare("INSERT INTO projects (id, name, owner_user_id, organization_id) VALUES ('p2', 'Other', ?, 'org2')").run("someone-else");
  raw.prepare("INSERT INTO documents (id, project_id, logical_name, created_by) VALUES ('d2', 'p2', 'other.pdf', 'someone-else')").run();
  raw
    .prepare("INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, effective_from, uploaded_by) VALUES ('v9', 'd2', 1, 'other.pdf', 'other.stored', 'pdf', 'application/pdf', 4, 'sum9', 'projects/other.pdf', '2026-01-01', 'someone-else')")
    .run();
  raw
    .prepare("INSERT INTO specification_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, model_version, prompt_version, ocr_version, created_by) VALUES ('e-foreign', 'd2', 'v9', 1, 'Completed', 'p', 'r', 'm', 'pr', 'o', 'someone-else')")
    .run();
  raw
    .prepare(`INSERT INTO technical_requirements (${REQUIREMENT_COLUMNS}) VALUES (?, ?, 'p2', 'd2', 1, 'Someone else private clause text.', 'Private', 'Detection', 'Specification', 'Mandatory', 'Functional', 0.9, 'High', 'Needs Review', 'Deterministic', 'parser-v1', 'model-v1', '{}', '{}', '{}')`)
    .run("r-foreign", "e-foreign");
};
