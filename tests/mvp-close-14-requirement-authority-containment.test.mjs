// MVP-CLOSE-14 -- technical requirement authority containment.
//
// The invariant under test:
//
//   The EXISTENCE of a technical_requirements row is never sufficient to grant
//   downstream engineering authority. Only a CURRENT + GOVERNED +
//   DOWNSTREAM-APPROVED requirement may influence link creation, Source Fact
//   promotion, or profile/fingerprint input.
//
// Fixtures build a REAL database by replaying the active migration chain, so
// the canonical predicates in worker/current-evidence-scope.mjs execute against
// the true schema. Mock-based suites cannot catch this class of defect -- the
// MVP-CLOSE-13 leak survived precisely because the engineering-knowledge suite's
// D1 double answered every statement generically without validating SQL.
//
// The three leaks reproduced here are the three MVP-CLOSE-13 §3 proved, plus
// the equivalent patterns this slice found while auditing:
//   Leak 1  bulk auto-confirm / bare-id evaluation load
//   Leak 2  clause_id sibling context scan (two sites, now one shared helper)
//   Leak 3  Source Fact promotion from unreviewed requirements
//   Leak 4  unfiltered DISTINCT system deciding project-wide system fallback
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  currentTechnicalRequirementEligibleForEngineeringPredicate,
  governedRequirementSubclauseCandidates,
} from "../worker/current-evidence-scope.mjs";
import { evaluateSourceFactCandidate, batchPromoteSourceFacts } from "../worker/spec-source-fact-promotion.mjs";
import { evaluateSpecRequirementAutoConfirmation } from "../worker/spec-requirement-auto-confirm.mjs";
import { resolveNearestFamilyContext } from "../app/domain/engineering-knowledge.mjs";

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

// A minimal but schema-valid world: one organization, one project, one live
// document version, and ONE current specification extraction. Requirements
// vary only in their governance state, which is the variable under test.
const seed = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=OFF");
  applyActiveChain(raw);

  raw.prepare("INSERT INTO organizations (id,name) VALUES (?,?)").run("org1", "CLOSE-14 Fixture Org");
  raw.prepare("INSERT INTO projects (id,name,owner_user_id,organization_id,system_domain,initial_status) VALUES (?,?,?,?,?,?)")
    .run("p1", "CLOSE-14 Project", "owner1", "org1", "Fire Alarm", "Active");

  raw.prepare("INSERT INTO documents (id,project_id,logical_name,created_by) VALUES (?,?,?,?)")
    .run("doc1", "p1", "Technical Specification", "owner1");
  raw.prepare(`INSERT INTO document_versions
    (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run("dv1", "doc1", 1, "spec.pdf", "spec.stored", "pdf", "application/pdf", 10, "sha-dv1", "projects/spec.pdf", "owner1");
  raw.prepare("UPDATE documents SET current_version_id='dv1' WHERE id='doc1'").run();

  const extraction = (id, { versionNumber = 1, status = "Completed", supersededAt = null, documentVersionId = "dv1" } = {}) => {
    raw.prepare(`INSERT INTO specification_extraction_versions
      (id,document_id,document_version_id,version_number,status,parser_version,ruleset_version,model_version,prompt_version,ocr_version,created_by,superseded_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, "doc1", documentVersionId, versionNumber, status, "p1", "r1", "m1", "pr1", "o1", "owner1", supersededAt,
    );
    return id;
  };
  // The CURRENT extraction. Version 2, so a retired version 1 can coexist --
  // specification_extraction_versions is UNIQUE on (document_id, version_number),
  // and building the retired-lineage fixtures is half of what this suite tests.
  extraction("sx-current", { versionNumber: 2 });

  const clause = (id, extractionVersionId, sequence, kind, originalText) => {
    raw.prepare(`INSERT INTO specification_clauses (id,extraction_version_id,sequence,kind,path,original_text)
      VALUES (?,?,?,?,?,?)`).run(id, extractionVersionId, sequence, kind, `Section ${sequence}`, originalText);
  };
  clause("cl-1", "sx-current", 1, "Requirement", "Detector requirements");

  const requirement = (id, {
    sequence = 1,
    originalText = "The heat detector shall be a 135F fixed temperature type.",
    clauseId = "cl-1",
    extractionVersionId = "sx-current",
    reviewStatus = "Approved",
    approvedForDownstream = 1,
    requirementType = "Mandatory",
    system = "Fire Alarm",
    category = "Environmental",
  } = {}) => {
    raw.prepare(`INSERT INTO technical_requirements
      (id,extraction_version_id,project_id,source_document_id,clause_id,sequence,original_text,normalized_requirement,
       engineering_domain,domain_source_type,system,category,requirement_type,requirement_category,confidence,confidence_state,
       review_status,extraction_method,parser_version,model_version,source_location,original_values,current_values,approved_for_downstream,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, extractionVersionId, "p1", "doc1", clauseId, sequence, originalText, originalText,
      "Fire Alarm", "Explicit", system, category, requirementType, "Performance", 95, "High Confidence",
      reviewStatus, "test", "p1", "m1", JSON.stringify({ clause: "1.1" }), "{}", "{}", approvedForDownstream,
      new Date().toISOString(), new Date().toISOString(),
    );
    return id;
  };

  const attribute = (requirementId, { name = "fixed_temperature_setpoint", value = 57, confidence = 94 } = {}) => {
    raw.prepare(`INSERT INTO requirement_attributes
      (id,requirement_id,name,operator,original_value,parsed_value,normalized_value,normalized_unit,confidence,source_location)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      `attr-${requirementId}-${name}`, requirementId, name, "Equal", String(value), String(value), JSON.stringify(value), "C", confidence, "{}",
    );
  };

  return { raw, db: d1(raw), extraction, clause, requirement, attribute };
};

const owned = async (db, projectId, { actorUserId = "owner1", reason = "CLOSE-14 governed promotion run" } = {}) => {
  const { handleSpecSourceFactApi } = await import("../worker/spec-source-fact-promotion.mjs");
  return handleSpecSourceFactApi(
    new Request(`https://localhost/api/projects/${projectId}/specification-source-facts/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason, actorUserId }),
    }),
    {
      DB: db,
      FILES: {},
      APP_ACCESS_MODE: "single-user",
      APP_USER_ID: actorUserId,
      APP_USER_ORGANIZATION_ID: "org1",
      APP_ORGANIZATION_ID: "org1",
      APP_USER_EMAIL: "owner@test.invalid",
      APP_USER_NAME: "Fixture Owner",
    },
  );
};

// ---------------------------------------------------------------------------
// Phase 0 -- the canonical contract itself
// ---------------------------------------------------------------------------

test("CLOSE-14 the eligibility predicate requires BOTH governed conjuncts", () => {
  const predicate = currentTechnicalRequirementEligibleForEngineeringPredicate("r");
  assert.match(predicate, /r\.review_status = 'Approved'/);
  assert.match(predicate, /r\.approved_for_downstream = 1/);
  // The approved family must stay narrow. 'Accepted' and 'Auto Verified' are
  // BOQ statuses and are never written to technical_requirements; admitting
  // them would assert authority that does not exist.
  assert.doesNotMatch(predicate, /Accepted/);
  assert.doesNotMatch(predicate, /Auto Verified/);
});

test("CLOSE-14 eligibility is independent of currentness, and currentness is independent of review state", async () => {
  // CURRENCY answers "is this still the project's evidence?" and must stay true
  // for a Needs Review row -- hiding it would break the review surface. These
  // assertions pin that separation so the two axes can never be collapsed.
  const { raw, requirement } = seed();
  requirement("r-pending", { reviewStatus: "Needs Review", approvedForDownstream: 0 });
  const { currentTechnicalRequirementsFrom } = await import("../worker/current-evidence-scope.mjs");
  const current = raw.prepare(`SELECT r.id FROM ${currentTechnicalRequirementsFrom("r")} WHERE r.id='r-pending'`).all();
  assert.equal(current.length, 1, "a Needs Review requirement is still CURRENT evidence");
});

// ---------------------------------------------------------------------------
// Phase 1 -- Leak 2: the clause_id sibling scan
// ---------------------------------------------------------------------------

test("CLOSE-14 LEAK 2 an unreviewed clause sibling can no longer lend context to an approved requirement", async () => {
  const { raw, db, requirement, clause } = seed();
  // The approved subject requirement, whose own text deliberately names NO
  // equipment family -- so it depends entirely on inheriting one from a
  // preceding sub-clause header. That is the only situation the leak can act in.
  requirement("r-approved", {
    sequence: 5,
    originalText: "It shall be installed as described.",
  });
  // The unreviewed sibling that sits in the same clause, at a lower sequence,
  // and names the family. Before the repair this row was returned to the walk
  // and its text became the approved requirement's effective family/category.
  requirement("r-unapproved", {
    sequence: 1,
    originalText: "Addressable heat detectors shall be of the 135F fixed temperature type.",
    reviewStatus: "Needs Review",
    approvedForDownstream: 0,
  });

  const approved = raw.prepare("SELECT * FROM technical_requirements WHERE id='r-approved'").get();
  const candidates = await governedRequirementSubclauseCandidates(db, approved);
  const texts = candidates.map((c) => c.text);

  assert.ok(
    !texts.some((t) => t.includes("135F fixed temperature")),
    "an unreviewed sibling's text must never enter the context walk",
  );
  assert.ok(
    texts.some((t) => t.includes("It shall be installed as described")),
    "the subject requirement's own text is always present",
  );
});

test("CLOSE-14 LEAK 2 an approved sibling DOES still contribute its context", async () => {
  const { raw, db, requirement } = seed();
  requirement("r-subject", { sequence: 5, originalText: "It shall be installed as described." });
  requirement("r-header", {
    sequence: 1,
    originalText: "Addressable heat detectors shall be of the 135F fixed temperature type.",
    reviewStatus: "Approved",
    approvedForDownstream: 1,
  });
  const subject = raw.prepare("SELECT * FROM technical_requirements WHERE id='r-subject'").get();
  const candidates = await governedRequirementSubclauseCandidates(db, subject);
  assert.ok(
    candidates.some((c) => c.text.includes("135F fixed temperature")),
    "a genuinely approved sibling header must still be inheritable, or the fix would break valid authority",
  );
});

test("CLOSE-14 the governed context walk is the SAME function both former leak sites now call", async () => {
  // Structural guarantee against the two sites drifting apart again. MVP-CLOSE-13's
  // leak existed twice precisely because the query was duplicated by hand.
  const ekApi = readFileSync(new URL("../worker/engineering-knowledge-api.mjs", import.meta.url), "utf8");
  const promotion = readFileSync(new URL("../worker/spec-source-fact-promotion.mjs", import.meta.url), "utf8");
  for (const [name, source] of [["engineering-knowledge-api", ekApi], ["spec-source-fact-promotion", promotion]]) {
    assert.ok(
      source.includes("governedRequirementSubclauseCandidates"),
      `${name} must use the shared governed context loader`,
    );
    assert.doesNotMatch(
      source,
      /FROM technical_requirements WHERE clause_id=/,
      `${name} must not hand-type a clause_id requirement query again`,
    );
  }
});

// ---------------------------------------------------------------------------
// Phase 1 -- Leak 3: Source Fact promotion from unreviewed requirements
// ---------------------------------------------------------------------------

test("CLOSE-14 LEAK 3 a Needs Review requirement cannot be promoted to a Source Fact", async () => {
  const { db, requirement, attribute } = seed();
  requirement("r-needs-review", { reviewStatus: "Needs Review", approvedForDownstream: 0 });
  attribute("r-needs-review");

  const evaluation = await evaluateSourceFactCandidate(db, {
    requirementId: "r-needs-review",
    activeExtractionVersionId: "sx-current",
  });
  assert.equal(evaluation.candidates.length, 0, "an unreviewed requirement yields no promotable candidate");

  const result = await batchPromoteSourceFacts(db, "p1", { actorUserId: "owner1" });
  assert.equal(result.promoted, 0, "the batch scan must never select an unreviewed requirement");
});

test("CLOSE-14 LEAK 3 a Pending Approval requirement cannot be promoted either", async () => {
  const { db, requirement, attribute } = seed();
  requirement("r-pending", { reviewStatus: "Pending Approval", approvedForDownstream: 0 });
  attribute("r-pending");
  const evaluation = await evaluateSourceFactCandidate(db, { requirementId: "r-pending", activeExtractionVersionId: "sx-current" });
  assert.equal(evaluation.candidates.length, 0);
});

test("CLOSE-14 LEAK 3 approved_for_downstream=0 buys nothing even with review_status='Approved'", async () => {
  // MVP-CLOSE-13 proved the two flags were assumed to move in lockstep. This
  // pins that BOTH conjuncts are genuinely required.
  const { db, requirement, attribute } = seed();
  requirement("r-flag-off", { reviewStatus: "Approved", approvedForDownstream: 0 });
  attribute("r-flag-off");
  const evaluation = await evaluateSourceFactCandidate(db, { requirementId: "r-flag-off", activeExtractionVersionId: "sx-current" });
  assert.equal(evaluation.candidates.length, 0, "the downstream authorization flag is independently required");
});

test("CLOSE-14 LEAK 3 an approved requirement still promotes (valid authority preserved)", async () => {
  const { db, requirement, attribute } = seed();
  requirement("r-good", { reviewStatus: "Approved", approvedForDownstream: 1 });
  attribute("r-good");
  const evaluation = await evaluateSourceFactCandidate(db, { requirementId: "r-good", activeExtractionVersionId: "sx-current" });
  assert.ok(evaluation.candidates.length > 0, "an approved current requirement must still promote");
  const result = await batchPromoteSourceFacts(db, "p1", { actorUserId: "owner1" });
  assert.ok(result.promoted >= 1, "the governed batch path must still work for approved requirements");
});

// ---------------------------------------------------------------------------
// Phase 1 -- Leak 1: the bare-id evaluation load
// ---------------------------------------------------------------------------

test("CLOSE-14 LEAK 1 a retired requirement cannot yield an auto-confirm verdict", async () => {
  const { db, raw, requirement, extraction } = seed();
  // A first extraction that is superseded by a second. The requirement belongs
  // to the RETIRED lineage.
  extraction("sx-retired", { versionNumber: 1, supersededAt: new Date().toISOString() });
  requirement("r-retired", {
    extractionVersionId: "sx-retired",
    reviewStatus: "Needs Review",
    approvedForDownstream: 0,
  });

  const verdict = await evaluateSpecRequirementAutoConfirmation(db, {
    requirementId: "r-retired",
    // A caller that supplies its own expectation must still not get a verdict.
    activeExtractionVersionId: "sx-retired",
  });
  assert.equal(verdict.eligible, false, "a retired requirement must never be reported auto-confirmable");
  assert.match(verdict.reason, /not found|no longer current/i);

  const row = raw.prepare("SELECT review_status, approved_for_downstream FROM technical_requirements WHERE id='r-retired'").get();
  assert.equal(row.review_status, "Needs Review", "the retired row is left untouched");
  assert.equal(row.approved_for_downstream, 0);
});

test("CLOSE-14 LEAK 1 a current pending Mandatory requirement is still auto-confirmable (governed automation preserved)", async () => {
  const { db, requirement } = seed();
  requirement("r-current", {
    originalText: "The heat detector shall be a 135F fixed temperature type.",
    reviewStatus: "Needs Review",
    approvedForDownstream: 0,
    requirementType: "Mandatory",
  });
  const verdict = await evaluateSpecRequirementAutoConfirmation(db, {
    requirementId: "r-current",
    activeExtractionVersionId: "sx-current",
  });
  assert.equal(verdict.eligible, true, "the governed deterministic auto-confirm path must keep working");
});

// ---------------------------------------------------------------------------
// Phase 1 -- Leak 4: the unfiltered DISTINCT system read
// ---------------------------------------------------------------------------

test("CLOSE-14 LEAK 4 an unreviewed row can no longer make the project look multi-system", async () => {
  const { raw } = seed();
  const { currentTechnicalRequirementsFrom, currentTechnicalRequirementEligibleForEngineeringPredicate } =
    await import("../worker/current-evidence-scope.mjs");
  // Before the repair this query was `SELECT DISTINCT system FROM
  // technical_requirements WHERE project_id=? ...` with no governance filter,
  // and its result decides `isMultiSystem`, which decides whether the project's
  // governed system_domain may be used as the effective system for EVERY
  // approved requirement. One unreviewed row changed the whole project.
  const systemSql = `SELECT DISTINCT r.system FROM ${currentTechnicalRequirementsFrom("r")}
      WHERE r.project_id=? AND r.system IS NOT NULL AND r.system NOT IN ('Unknown','Unspecified')
        AND ${currentTechnicalRequirementEligibleForEngineeringPredicate("r")}`;

  raw.prepare(`INSERT INTO technical_requirements
    (id,extraction_version_id,project_id,source_document_id,clause_id,sequence,original_text,normalized_requirement,
     engineering_domain,domain_source_type,system,category,requirement_type,requirement_category,confidence,confidence_state,
     review_status,extraction_method,parser_version,model_version,source_location,original_values,current_values,approved_for_downstream,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "r-other-system", "sx-current", "p1", "doc1", "cl-1", 9,
    "The CCTV camera shall be installed.", "The CCTV camera shall be installed.",
    "CCTV", "Explicit", "CCTV", "Equipment", "Mandatory", "Performance", 95, "High Confidence",
    "Needs Review", "test", "p1", "m1", "{}", "{}", "{}", 0,
    new Date().toISOString(), new Date().toISOString(),
  );

  const systems = raw.prepare(systemSql).all("p1");
  assert.equal(
    systems.length, 0,
    "an unreviewed CCTV row must not contribute a system value that would flip the project to multi-system",
  );
});

// ---------------------------------------------------------------------------
// Phase 2 -- clause identity alone is never authority
// ---------------------------------------------------------------------------

test("CLOSE-14 clause collision: only the approved sibling contributes", async () => {
  const { raw, db, requirement } = seed();
  requirement("r-approved-sib", {
    sequence: 2,
    originalText: "Addressable heat detectors shall be of the 135F fixed temperature type.",
    reviewStatus: "Approved",
    approvedForDownstream: 1,
  });
  requirement("r-unapproved-sib", {
    sequence: 1,
    originalText: "SPRINKLER heads shall be wet pipe type.",
    reviewStatus: "Needs Review",
    approvedForDownstream: 0,
  });
  const subject = raw.prepare("SELECT * FROM technical_requirements WHERE id='r-approved-sib'").get();
  const texts = (await governedRequirementSubclauseCandidates(db, subject)).map((c) => c.text);
  assert.ok(texts.some((t) => t.includes("135F fixed temperature")));
  assert.ok(!texts.some((t) => t.includes("SPRINKLER")), "the unapproved sibling in the same clause stays out");
});

test("CLOSE-14 a clause shared across extraction lineages yields only current evidence", async () => {
  const { raw, db, requirement, extraction } = seed();
  extraction("sx-old", { versionNumber: 1, supersededAt: new Date().toISOString() });
  // Same clause_id, RETIRED extraction, approved -- the cross-lineage trap.
  requirement("r-old-approved", {
    extractionVersionId: "sx-old",
    sequence: 1,
    originalText: "RETIRED LINEAGE HEADER shall be legacy.",
    reviewStatus: "Approved",
    approvedForDownstream: 1,
  });
  requirement("r-new-subject", { sequence: 5, originalText: "It shall be installed as described." });

  const subject = raw.prepare("SELECT * FROM technical_requirements WHERE id='r-new-subject'").get();
  const texts = (await governedRequirementSubclauseCandidates(db, subject)).map((c) => c.text);
  assert.ok(!texts.some((t) => t.includes("RETIRED LINEAGE")), "a retired approved requirement cannot regain authority");
});

test("CLOSE-14 a retired approved requirement is not eligible for promotion", async () => {
  const { db, requirement, attribute, extraction } = seed();
  extraction("sx-old2", { versionNumber: 1, supersededAt: new Date().toISOString() });
  requirement("r-old2", { extractionVersionId: "sx-old2", reviewStatus: "Approved", approvedForDownstream: 1 });
  attribute("r-old2");
  const evaluation = await evaluateSourceFactCandidate(db, {
    requirementId: "r-old2",
    activeExtractionVersionId: "sx-old2",
  });
  assert.equal(evaluation.candidates.length, 0, "approved but retired is still not authoritative");
});

// ---------------------------------------------------------------------------
// Phase 9 -- REQUIREMENT_CANDIDATE isolation
// ---------------------------------------------------------------------------

test("CLOSE-14 a REQUIREMENT_CANDIDATE clause creates no technical_requirements row and reaches no authority path", async () => {
  const { raw, db, requirement, clause } = seed();
  // A recovered candidate lives at CLAUSE level only (MVP-CLOSE-11/13 model).
  clause("cl-candidate", "sx-current", 2, "Requirement", "Recovered candidate clause");
  raw.prepare("UPDATE specification_clauses SET admission_status='REQUIREMENT_CANDIDATE' WHERE id='cl-candidate'").run();

  // A real approved requirement, so the walk has something to walk.
  requirement("r-normal", { sequence: 5, originalText: "It shall be installed as described." });
  const subject = raw.prepare("SELECT * FROM technical_requirements WHERE id='r-normal'").get();
  const texts = (await governedRequirementSubclauseCandidates(db, subject)).map((c) => c.text);

  assert.ok(
    !texts.some((t) => t.includes("Recovered candidate clause")),
    "a candidate clause is not a technical_requirements row and can never be walked as context",
  );
  // The candidate clause is genuinely not a requirement row at all.
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM technical_requirements WHERE clause_id='cl-candidate'").get().c, 0);

  // And it can be neither promoted nor auto-confirmed, because there is no id.
  const evaluation = await evaluateSourceFactCandidate(db, {
    requirementId: "cl-candidate",
    activeExtractionVersionId: "sx-current",
  });
  assert.equal(evaluation.candidates.length, 0);
  const verdict = await evaluateSpecRequirementAutoConfirmation(db, {
    requirementId: "cl-candidate",
    activeExtractionVersionId: "sx-current",
  });
  assert.equal(verdict.eligible, false);
});

// ---------------------------------------------------------------------------
// Phase 8 -- the fix must not have disabled legitimate automation
// ---------------------------------------------------------------------------

test("CLOSE-14 the governed promotion route still works end to end for approved requirements", async () => {
  const { db, requirement, attribute } = seed();
  requirement("r-route", { reviewStatus: "Approved", approvedForDownstream: 1 });
  attribute("r-route");
  const response = await owned(db, "p1");
  const body = await response.json();
  assert.ok(body.promoted >= 1, `the governed route must still promote: ${JSON.stringify(body)}`);
});
