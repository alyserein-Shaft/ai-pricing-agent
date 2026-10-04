// MVP-CLOSE-15 -- extraction-time system authority containment.
//
// The invariant under test:
//
//   Extraction-time project-system inference obeys the SAME canonical
//   requirement authority contract as every downstream engineering consumer.
//   A stale or unreviewed requirement may stay visible for review, but it must
//   not influence extraction behaviour.
//
// Three call sites used to hand-type the identical, completely ungoverned read:
//
//   SELECT DISTINCT system FROM technical_requirements
//    WHERE project_id=? AND system IS NOT NULL
//      AND system NOT IN ('Unknown','Unspecified')
//
//   * specification-extraction-background.mjs (createSpecificationJob) -- decides
//     SINGLE vs MULTI system, i.e. whether page relevance may be filtered by
//     system at all. Persisted as specification_extraction_jobs.project_system.
//   * specification-extraction-background.mjs (processSpecificationJob) -- seeds
//     the extractor's open-ended candidate-recognition context.
//   * engineering-knowledge-api.mjs (suggestLinks) -- decides whether a
//     requirement's effective system may fall back to the project's.
//
// Phase 1 reproduces the leak at RUNTIME, not by string inspection: the test
// invokes the real exported createSpecificationJob and reads back the persisted
// job row, so the observable consequence is actual production state.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { currentApprovedProjectSystems } from "../worker/current-evidence-scope.mjs";
import { createSpecificationJob } from "../worker/specification-extraction-background.mjs";

const ACTIVE_ROOT = new URL("../drizzle-active", import.meta.url).pathname.replace(/\/$/, "");

const applyActiveChain = (db) => {
  const journal = JSON.parse(readFileSync(join(ACTIVE_ROOT, "meta", "_journal.json"), "utf8"));
  for (const entry of journal.entries) {
    const sql = readFileSync(join(ACTIVE_ROOT, `${entry.tag}.sql`), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) db.exec(trimmed);
    }
  }
};

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (args = []) => ({
      first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      run: async () => raw.prepare(sql).run(...args),
    });
    return { ...operation(), bind: (...args) => operation(args) };
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

const OWNER = "close15-owner";

const seed = ({ systemDomain = "Unspecified" } = {}) => {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=OFF");
  applyActiveChain(raw);
  const run = (sql, ...values) => raw.prepare(sql).run(...values);

  run("INSERT INTO organizations (id, name) VALUES ('org', 'CLOSE-15 Org')");
  run("INSERT INTO projects (id, name, owner_user_id, organization_id, system_domain, initial_status) VALUES ('p1', 'CLOSE-15 Project', ?, 'org', ?, 'Active')", OWNER, systemDomain);
  run("INSERT INTO documents (id, project_id, logical_name, created_by) VALUES ('d1', 'p1', 'spec.pdf', ?)", OWNER);
  // A non-PDF source keeps the fixture away from the PDF readiness/inspection
  // paths; the subject under test is the system-inference decision, not
  // document mapping.
  run(`INSERT INTO document_versions
    (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, effective_from, uploaded_by)
    VALUES ('v1', 'd1', 1, 'spec.docx', 'spec.stored', 'docx',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 3, 'sha-v1', 'projects/spec.docx', '2026-01-01', ?)`, OWNER);
  run("UPDATE documents SET current_version_id='v1' WHERE id='d1'");

  // createSpecificationJob is gated behind a real, authenticated classification
  // confirmation (never the classifier's own confidence heuristic), so the
  // fixture supplies a manually confirmed Technical Specification. This is
  // fixture scaffolding, not the subject under test.
  run(`INSERT INTO classification_model_versions
    (id, classifier_version, ruleset_version, prompt_version, configuration)
    VALUES ('cmv1', 'c1', 'r1', 'p1', '{}')`);
  run(`INSERT INTO document_classifications
    (id, document_id, document_version_id, model_version_id, primary_type, secondary_types,
     confidence, confidence_state, status, method, mixed, manual_review_required, downstream_route)
    VALUES ('dc1', 'd1', 'v1', 'cmv1', 'Technical Specification', '[]', 99, 'High',
            'Manually Confirmed', 'Manual', 0, 0, 'specification')`);

  // The CURRENT extraction, version 2. A retired version 1 coexists because
  // specification_extraction_versions is UNIQUE on (document_id, version_number),
  // and the retired-lineage cases below are half of what this suite proves.
  const extraction = (id, { versionNumber, status = "Completed", supersededAt = null, documentVersionId = "v1" } = {}) => {
    run(`INSERT INTO specification_extraction_versions
      (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, model_version, prompt_version, ocr_version, created_by, superseded_at)
      VALUES (?, 'd1', ?, ?, ?, 'p', 'r', 'm', 'pr', 'o', ?, ?)`, id, documentVersionId, versionNumber, status, OWNER, supersededAt);
  };
  extraction("e-current", { versionNumber: 2 });

  const clause = (id, { sequence = 1, originalText = "Requirement clause", admissionStatus = null } = {}) => {
    run(`INSERT INTO specification_clauses (id, extraction_version_id, sequence, kind, path, original_text)
      VALUES (?, 'e-current', ?, 'Requirement', ?, ?)`, id, sequence, `Section ${sequence}`, originalText);
    if (admissionStatus) run("UPDATE specification_clauses SET admission_status=? WHERE id=?", admissionStatus, id);
  };
  clause("cl-1");

  const requirement = (id, {
    system,
    reviewStatus = "Approved",
    approvedForDownstream = 1,
    extractionVersionId = "e-current",
    clauseId = "cl-1",
    sequence = 1,
  } = {}) => {
    run(`INSERT INTO technical_requirements
      (id, extraction_version_id, project_id, source_document_id, clause_id, sequence, original_text, normalized_requirement,
       engineering_domain, domain_source_type, system, category, requirement_type, requirement_category, confidence, confidence_state,
       review_status, extraction_method, parser_version, model_version, source_location, original_values, current_values,
       approved_for_downstream, created_at, updated_at)
      VALUES (?, ?, 'p1', 'd1', ?, ?, ?, ?, 'Fire Alarm', 'Explicit', ?, 'Equipment', 'Mandatory', 'Performance', 95, 'High Confidence',
              ?, 'test', 'p', 'm', '{}', '{}', '{}', ?, ?, ?)`,
      id, extractionVersionId, clauseId, sequence, `${id} text`, `${id} text`,
      system, reviewStatus, approvedForDownstream, new Date().toISOString(), new Date().toISOString());
  };

  return { raw, db: d1(raw), run, extraction, clause, requirement };
};

const envFor = (raw) => ({
  DB: d1(raw),
  // Real bytes, so the source load succeeds. A non-PDF source skips the PDF
  // readiness and document-map paths entirely, letting the test exercise the
  // system-inference decision without a PDF parser.
  FILES: { get: async () => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }), head: async () => null },
  APP_ACCESS_MODE: "single-user",
  APP_USER_ID: OWNER,
  APP_USER_ORGANIZATION_ID: "org",
  APP_ORGANIZATION_ID: "org",
  APP_USER_EMAIL: "owner@test.invalid",
  APP_USER_NAME: "CLOSE-15 Owner",
});

// The directly observable production consequence: createSpecificationJob
// persists the inferred system as specification_extraction_jobs.project_system.
// That value is later handed to mapSpecificationPages() during chunk
// processing, so it is not a diagnostic -- it is real extraction behaviour.
const queuedProjectSystem = async (fixture) => {
  const result = await createSpecificationJob(envFor(fixture.raw), { documentId: "d1", userId: OWNER, force: true });
  const row = fixture.raw.prepare("SELECT project_system FROM specification_extraction_jobs ORDER BY created_at DESC, id DESC LIMIT 1").get();
  return { projectSystem: row?.project_system ?? null, result };
};

// ---------------------------------------------------------------------------
// Phase 1/4 -- negative authority cases
// ---------------------------------------------------------------------------

test("CLOSE-15 a Needs Review requirement's system does not seed extraction", async () => {
  const fixture = seed();
  fixture.requirement("r-pending", { system: "Fire Alarm", reviewStatus: "Needs Review", approvedForDownstream: 0 });
  const { projectSystem } = await queuedProjectSystem(fixture);
  assert.equal(projectSystem, "Unspecified", "an unreviewed system must not be inferred");
});

test("CLOSE-15 a Pending Approval requirement's system does not seed extraction", async () => {
  const fixture = seed();
  fixture.requirement("r-pending-approval", { system: "Fire Alarm", reviewStatus: "Pending Approval", approvedForDownstream: 0 });
  const { projectSystem } = await queuedProjectSystem(fixture);
  assert.equal(projectSystem, "Unspecified");
});

test("CLOSE-15 approved_for_downstream=0 does not seed extraction even when review_status is Approved", async () => {
  // The two conjuncts are independent; a flag-only authorisation is not authority.
  const fixture = seed();
  fixture.requirement("r-flag-off", { system: "Fire Alarm", reviewStatus: "Approved", approvedForDownstream: 0 });
  const { projectSystem } = await queuedProjectSystem(fixture);
  assert.equal(projectSystem, "Unspecified");
});

test("CLOSE-15 a retired requirement's system does not seed extraction", async () => {
  const fixture = seed();
  fixture.extraction("e-retired", { versionNumber: 1, supersededAt: new Date().toISOString() });
  // Approved AND downstream-authorized, but on retired evidence.
  fixture.requirement("r-retired", { system: "Fire Alarm", extractionVersionId: "e-retired" });
  const { projectSystem } = await queuedProjectSystem(fixture);
  assert.equal(projectSystem, "Unspecified", "approved but retired is still not authority");
});

test("CLOSE-15 an Unknown/Unspecified system never counts as a project system", async () => {
  for (const system of ["Unknown", "Unspecified", null]) {
    const fixture = seed();
    fixture.requirement("r-unknown", { system });
    const { projectSystem } = await queuedProjectSystem(fixture);
    assert.equal(projectSystem, "Unspecified", `system ${JSON.stringify(system)} must not be inferred`);
  }
});

// ---------------------------------------------------------------------------
// Phase 3 -- positive behaviour, including valid multi-system projects
// ---------------------------------------------------------------------------

test("CLOSE-15 a current approved system's requirement still seeds extraction", async () => {
  const fixture = seed();
  fixture.requirement("r-approved", { system: "Fire Alarm" });
  const { projectSystem } = await queuedProjectSystem(fixture);
  assert.equal(projectSystem, "Fire Alarm", "a genuinely approved current requirement must still infer its system");
});

test("CLOSE-15 two approved systems preserve legitimate multi-system behaviour", async () => {
  // The narrowing must NOT collapse a real multi-system project. With two
  // governed systems the inference is deliberately empty, which is the
  // pre-existing Wave 4 contract: in a multi-system project the legacy
  // system_domain fallback must not filter out other systems' pages.
  const fixture = seed({ systemDomain: "Fire Alarm" });
  fixture.requirement("r-fa", { system: "Fire Alarm", sequence: 1 });
  fixture.requirement("r-cctv", { system: "CCTV", sequence: 2 });
  const { projectSystem } = await queuedProjectSystem(fixture);
  assert.equal(projectSystem, "Unspecified", "two governed systems must not be collapsed to one");
});

test("CLOSE-15 an unreviewed second system does not turn a single-system project multi-system", async () => {
  // This is the exact pre-repair failure: the project has exactly one approved
  // system, and a single unreviewed CCTV row used to make it look multi-system,
  // silencing page-relevance filtering for the whole document.
  const fixture = seed();
  fixture.requirement("r-fa", { system: "Fire Alarm", sequence: 1 });
  fixture.requirement("r-cctv-unreviewed", { system: "CCTV", sequence: 2, reviewStatus: "Needs Review", approvedForDownstream: 0 });
  const { projectSystem } = await queuedProjectSystem(fixture);
  assert.equal(projectSystem, "Fire Alarm", "one governed system must still be inferred as single-system");
});

test("CLOSE-15 the project system_domain fallback still applies when no governed requirement names a system", async () => {
  // With zero governed systems the pre-existing fallback to the project's own
  // system_domain must remain reachable, or projects whose requirements are all
  // still under review would silently lose their system context.
  const fixture = seed({ systemDomain: "Fire Alarm" });
  fixture.requirement("r-pending", { system: "CCTV", reviewStatus: "Needs Review", approvedForDownstream: 0 });
  const { projectSystem } = await queuedProjectSystem(fixture);
  assert.equal(projectSystem, "Fire Alarm", "the governed project domain fallback must survive the narrowing");
});

// ---------------------------------------------------------------------------
// Phase 5 -- candidate isolation
// ---------------------------------------------------------------------------

test("CLOSE-15 a REQUIREMENT_CANDIDATE has no effect on extraction system inference", async () => {
  const fixture = seed();
  // A recovered candidate is clause-level only and creates no requirement row.
  fixture.clause("cl-candidate", { sequence: 2, originalText: "Recovered CCTV candidate clause", admissionStatus: "REQUIREMENT_CANDIDATE" });
  fixture.requirement("r-fa", { system: "Fire Alarm", sequence: 1 });
  assert.equal(
    fixture.raw.prepare("SELECT COUNT(*) c FROM technical_requirements WHERE clause_id='cl-candidate'").get().c,
    0,
    "a candidate must not be materialised as a technical requirement",
  );
  const { projectSystem } = await queuedProjectSystem(fixture);
  assert.equal(projectSystem, "Fire Alarm", "a candidate clause cannot introduce a system");
});

// ---------------------------------------------------------------------------
// The shared definition itself
// ---------------------------------------------------------------------------

test("CLOSE-15 the shared project-systems reader is deterministic and governed", async () => {
  const fixture = seed();
  fixture.requirement("r-cctv", { system: "CCTV", sequence: 1 });
  fixture.requirement("r-fa", { system: "Fire Alarm", sequence: 2 });
  fixture.requirement("r-bad", { system: "Access Control", sequence: 3, reviewStatus: "Needs Review", approvedForDownstream: 0 });
  const systems = await currentApprovedProjectSystems(fixture.db, "p1");
  assert.deepEqual(systems, ["CCTV", "Fire Alarm"], "governed systems only, sorted deterministically");
  assert.deepEqual(await currentApprovedProjectSystems(fixture.db, "p1"), systems, "repeat reads are stable");
  assert.deepEqual(await currentApprovedProjectSystems(fixture.db, null), [], "a missing project yields no systems");
});

test("CLOSE-15 the project-systems reader does not cross project boundaries", async () => {
  const fixture = seed();
  fixture.requirement("r-fa", { system: "Fire Alarm" });

  // A second project needs its OWN document and extraction: the canonical
  // requirement authority joins documents on project_id, so a requirement can
  // only ever be current evidence for the project that actually owns its
  // source document. That is itself part of the contract being asserted.
  fixture.run("INSERT INTO projects (id, name, owner_user_id, organization_id, initial_status) VALUES ('p2', 'Other', ?, 'org', 'Active')", OWNER);
  fixture.run("INSERT INTO documents (id, project_id, logical_name, created_by) VALUES ('d2', 'p2', 'other.docx', ?)", OWNER);
  fixture.run(`INSERT INTO document_versions
    (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, effective_from, uploaded_by)
    VALUES ('v2', 'd2', 1, 'other.docx', 'other.stored', 'docx',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 3, 'sha-v2', 'projects/other.docx', '2026-01-01', ?)`, OWNER);
  fixture.run("UPDATE documents SET current_version_id='v2' WHERE id='d2'");
  fixture.run(`INSERT INTO specification_extraction_versions
    (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, model_version, prompt_version, ocr_version, created_by)
    VALUES ('e-p2', 'd2', 'v2', 1, 'Completed', 'p', 'r', 'm', 'pr', 'o', ?)`, OWNER);
  fixture.run(
    `INSERT INTO technical_requirements
      (id, extraction_version_id, project_id, source_document_id, clause_id, sequence, original_text, normalized_requirement,
       engineering_domain, domain_source_type, system, category, requirement_type, requirement_category, confidence, confidence_state,
       review_status, extraction_method, parser_version, model_version, source_location, original_values, current_values,
       approved_for_downstream, created_at, updated_at)
     VALUES ('r-p2','e-p2','p2','d2',NULL,5,'t','t','CCTV','Explicit','CCTV','Equipment','Mandatory','Performance',95,'High Confidence',
             'Approved','test','p','m','{}','{}','{}',1,?,?)`, new Date().toISOString(), new Date().toISOString());

  assert.deepEqual(await currentApprovedProjectSystems(fixture.db, "p1"), ["Fire Alarm"]);
  assert.deepEqual(await currentApprovedProjectSystems(fixture.db, "p2"), ["CCTV"]);
});

// ---------------------------------------------------------------------------
// Structural: both extraction call sites use the canonical definition
// ---------------------------------------------------------------------------

test("CLOSE-15 both extraction-background sites use the canonical authority reader", () => {
  const source = readFileSync(new URL("../worker/specification-extraction-background.mjs", import.meta.url), "utf8");
  const uses = source.match(/currentApprovedProjectSystems\(/g) || [];
  assert.equal(uses.length, 2, "both the job-creation and chunk-processing sites must call the shared reader");
  assert.doesNotMatch(
    source,
    /FROM technical_requirements WHERE project_id=\?/,
    "the ungoverned hand-typed system read must not exist in this module",
  );
  // The ungoverned literal must not be reintroduced anywhere in production code.
  for (const file of ["../worker/engineering-knowledge-api.mjs", "../worker/technical-requirement-api.mjs", "../worker/estimator-understanding-api.mjs"]) {
    const text = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(text, /DISTINCT system FROM technical_requirements/, `${file} must not hand-type a system read`);
  }
});
