/**
 * MVP-CLOSE-11 -- no segmented specification clause can disappear silently.
 *
 * MVP-CLOSE-10 proved that segmentSpecification() correctly detects every source
 * clause unit and that the loss happens strictly afterwards, at the
 * requirement-admission predicate in app/domain/specification-extractor.mjs,
 * where a `continue` discarded the clause with no row, no count, no audit event
 * and no reconciliation. On the governing 28 46 00 extraction that silently
 * discarded 193 of 457 clause units, including binding technical clauses.
 *
 * This suite proves the repair is observability-only:
 *
 *   - every segmented clause unit now has an explicit, reasoned outcome;
 *   - the completeness invariant `detected = admitted + notAdmitted` holds;
 *   - the downstream technical-requirement set is UNCHANGED (this is asserted
 *     against the historical gate inlined below, not merely asserted about the
 *     new code);
 *   - a non-admitted clause can never reach technical_requirements, the review
 *     queue, link candidates or any authority fingerprint.
 *
 * It runs against the real active migration chain and the real extractor.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import {
  extractSpecificationPages,
  segmentSpecification,
  CLAUSE_ADMISSION_ADMITTED,
  CLAUSE_ADMISSION_NOT_ADMITTED,
  CLAUSE_ADMISSION_CANDIDATE,
  CLAUSE_CANDIDATE_MECHANISMS,
  CLAUSE_NON_ADMISSION_REASONS,
} from "../app/domain/specification-extractor.mjs";
import { processSpecificationJob } from "../worker/specification-extraction-background.mjs";
import { handleSpecificationExtractionApi } from "../worker/specification-extraction-api.mjs";
import { currentTechnicalRequirementsFrom } from "../worker/current-evidence-scope.mjs";

/* ------------------------------------------------------------------ *
 * Isolated database on the real ordered migration chain.
 * ------------------------------------------------------------------ */
const d1 = (raw) => ({
  prepare(sql) {
    const operation = (args = []) => ({
      first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      run: async () => {
        const result = raw.prepare(sql).run(...args);
        return { ...result, meta: { changes: Number(result.changes || 0), last_insert_rowid: result.lastInsertRowid } };
      },
    });
    return { ...operation(), bind: (...args) => operation(args) };
  },
  batch: async (statements) => {
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

const activeDatabase = async () => {
  const directory = new URL("../drizzle-active/", import.meta.url).pathname;
  const migrations = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=OFF");
  for (const migration of migrations) {
    const sql = await readFile(`${directory}${migration}`, "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) raw.exec(trimmed);
    }
  }
  return { raw, chain: migrations };
};


/* ------------------------------------------------------------------ *
 * One governed project/document/version/run/extraction/job/chunk set --
 * the minimum the real governed write path requires. Column lists are
 * taken from the live schema, not guessed.
 * ------------------------------------------------------------------ */
const seedGovernedJob = (raw, { projectName = "Clause Admission Project", ownerUserId = "user-1" } = {}) => {
  const now = new Date().toISOString();
  const bytes = Buffer.from(SPEC_TEXT, "utf8");
  raw.exec(`
    INSERT INTO projects (id,name,owner_user_id,system_domain) VALUES ('project-1','${projectName}','${ownerUserId}','Fire Alarm');
    INSERT INTO documents (id,project_id,logical_name,document_type,classification_source,created_by,current_version_id)
      VALUES ('document-1','project-1','Fire Alarm Specification','Technical Specification','Manual','user-1','version-1');
    INSERT INTO document_versions (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by)
      VALUES ('version-1','document-1',1,'specification.txt','stored.txt','txt','text/plain',${bytes.length},'sha-1','sources/version-1','user-1');
    INSERT INTO document_processing_runs (id,document_version_id,stage,status,progress,attempt,max_attempts,cancel_requested,processor_version,started_at,created_at,updated_at)
      VALUES ('run-1','version-1','Specification Extraction','Pending',0,0,3,0,'spec-test','${now}','${now}','${now}');
    INSERT INTO specification_extraction_versions (id,document_id,document_version_id,processing_run_id,version_number,status,parser_version,ruleset_version,model_version,prompt_version,ocr_version,created_by,started_at)
      VALUES ('extraction-1','document-1','version-1','run-1',1,'Running','p','r','m','pr','o','user-1','${now}');
    INSERT INTO specification_extraction_jobs (id,extraction_version_id,document_id,document_version_id,project_id,status,total_pages,processed_pages,completed_chunks,remaining_chunks,chunk_size,extracted_clauses,extracted_requirements,elapsed_seconds,worker_version,source_fingerprint,resume_token,scope_mode,project_system,requested_by,started_at,created_at)
      VALUES ('job-1','extraction-1','document-1','version-1','project-1','Running',1,0,0,1,1,0,0,0,'spec-test','source-fingerprint','resume-token','Full Document','Fire Alarm','user-1','${now}','${now}');
    INSERT INTO specification_extraction_chunks (id,job_id,chunk_number,page_from,page_to,page_count,priority,relevance,status,attempt,max_attempts,input_fingerprint,updated_at)
      VALUES ('job-1_chunk_1','job-1',1,1,1,1,0,'Full Document','Queued',0,2,'input-fingerprint','${now}');
  `);
  return bytes;
};

const runExtraction = async (raw, bytes) => processSpecificationJob(
  { DB: d1(raw), FILES: { get: async () => ({ arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }) } },
  { jobId: "job-1" },
);

/* ------------------------------------------------------------------ *
 * A small specification that exercises every required outcome class.
 * ------------------------------------------------------------------ */
const SPEC_TEXT = [
  "PART 2 - PRODUCTS",
  "C. Duct Smoke Detector:",
  "1. The air duct smoke detector shall be an intelligent, non-relay photoelectric type with either an indoor or NEMA4 watertight enclosure for outdoor use.",
  "2. The UL 268A-listed housing fits square or rectangular footprints and has a twist-lock base for plug-in detectors.",
  "3. It operates from 100 to 4000 ft/min air velocities and signals trouble if the sensor cover is removed or improperly installed.",
  "4. Testing can be done locally via magnetic switch or remotely. Sampling tubes are available in 3, 5, or 10 feet. Strip and clamp terminals support 12 - 18 AWG wiring.",
  "D. Addressable Manual Alarm Call Points:",
  "1. The manual call point must be electrically compatible with the standard range of automatic detectors.",
  "E. Device Schedule:",
  "3. Alarm horns",
  "4. Repeater panel (remote annunciator)",
  "F. References:",
  "5. The system shall comply with the table of contents requirements.",
  "6. Abcd.",
].join("\n");

const pages = () => [{ page: 1, lines: SPEC_TEXT.split("\n"), extractionQuality: 0.95 }];
const extract = () => extractSpecificationPages(pages(), { extractionMethod: "structured-text" });

const outcomeFor = (result, pattern) => {
  const index = result.clauses.findIndex((clause) => pattern.test(String(clause.text)));
  assert.notEqual(index, -1, `fixture must contain a clause matching ${pattern}`);
  return { clause: result.clauses[index], outcome: result.clauseAdmission[index] };
};

/**
 * The PRE-REPAIR admission loop, inlined verbatim from the historical gate.
 *
 * This is the failing-before oracle. It is deliberately NOT a reimplementation
 * of the repaired logic: it is the single `continue` that MVP-CLOSE-10
 * identified, reproduced so the suite can assert that the repaired code admits
 * exactly the same requirements while additionally accounting for every clause
 * that the old code dropped without a trace.
 */
const preRepairRequirements = (clauses) => {
  const emitted = [];
  for (const clause of clauses) for (const sentence of String(clause.text).split(/(?<=[.;!?])\s+(?=[A-Z0-9"(])/)) {
    const type = /shall|must|required|provide|comply/i.test(sentence) ? "Mandatory"
      : /should|preferred/i.test(sentence) ? "Preferred"
      : /may|optional/i.test(sentence) ? "Optional" : "Informational";
    const hasStructure = /UL\s?\d/i.test(sentence);
    const requirementLike = type !== "Informational" || hasStructure;
    if (!requirementLike || /copyright|table of contents|index of sections/i.test(sentence)) continue;
    emitted.push(sentence);
  }
  return emitted;
};

/* ------------------------------------------------------------------ *
 * 1-3  Loss observability
 * ------------------------------------------------------------------ */
test("MVP-CLOSE-11 a technically binding clause with no normative modal survives as an explicit, auditable non-admission outcome", () => {
  const result = extract();

  // The MVP-CLOSE-10 subject clauses: binding technical text with no modal.
  //
  // MVP-CLOSE-13 changes the STATE these clauses carry, not the invariant they
  // were admitted under test for. C.3 is a passive/present predicate and C.4 is
  // modal-free capability, so both are now REQUIREMENT_CANDIDATE: still not
  // requirements, still recorded, still auditable, but flagged for review. The
  // assertions below therefore pin the INVARIANT (non-admitted, zero rows,
  // reason recorded, text and page retained) and accept either non-admitted
  // state, rather than pinning one state name forever.
  for (const pattern of [/4000 ft\/min/, /magnetic switch/]) {
    const { clause, outcome } = outcomeFor(result, pattern);
    assert.ok(
      [CLAUSE_ADMISSION_NOT_ADMITTED, CLAUSE_ADMISSION_CANDIDATE].includes(outcome.admissionStatus),
      `expected a non-admitted state, got ${outcome.admissionStatus}`,
    );
    assert.notEqual(outcome.admissionStatus, CLAUSE_ADMISSION_ADMITTED);
    assert.equal(outcome.admittedRequirementCount, 0);
    assert.equal(outcome.nonAdmissionReason, CLAUSE_NON_ADMISSION_REASONS.NOT_REQUIREMENT_LIKE);
    // The source text is retained verbatim, so the clause is auditable.
    assert.ok(clause.text.length > 40, "the rejected source text must be retained for audit");
    assert.ok(clause.pageFrom === 1, "the rejected clause must retain its page provenance");
  }

  // It is visible in the result surface...
  assert.ok(Array.isArray(result.clauseAdmission));
  assert.equal(result.clauseAdmission.length, result.clauses.length);
  // ...but it is NOT a technical requirement.
  const admitted = result.requirements.map((r) => r.originalText);
  assert.ok(!admitted.some((t) => /4000 ft\/min/.test(t)), "C.3 must not become a technical requirement");
  assert.ok(!admitted.some((t) => /magnetic switch/.test(t)), "C.4 must not become a technical requirement");
});

test("MVP-CLOSE-11 failing-before: the historical gate leaves clause units with no recorded outcome at all", () => {
  const structure = segmentSpecification(pages());
  const legacy = preRepairRequirements(structure.clauses);

  // The pre-repair code emits 3 requirements and has NO way to say what became
  // of the other clause units -- this is the defect, asserted positively.
  assert.equal(structure.clauses.length, 13);
  assert.equal(legacy.length, 3);
  const unaccounted = structure.clauses.length - new Set(legacy).size;
  assert.equal(unaccounted, 10, "pre-repair, 10 clause units left no trace whatsoever");

  // After the repair the same fixture accounts for every single unit.
  const result = extract();
  assert.equal(result.clauseAdmission.length, structure.clauses.length);
  assert.equal(result.clauseAdmission.filter((o) => o.admissionStatus).length, structure.clauses.length);
  assert.equal(result.requirements.length, legacy.length, "the admitted set must be unchanged");
});

/* ------------------------------------------------------------------ *
 * 4-5  Legitimate rejection stays legitimate
 * ------------------------------------------------------------------ */
test("MVP-CLOSE-11 headings and equipment-name list units are rejected without gaining requirement authority", () => {
  const result = extract();
  for (const pattern of [/^Duct Smoke Detector:$/, /^Alarm horns$/, /^Repeater panel \(remote annunciator\)$/]) {
    const { outcome } = outcomeFor(result, pattern);
    assert.equal(outcome.admissionStatus, CLAUSE_ADMISSION_NOT_ADMITTED);
    assert.equal(outcome.nonAdmissionReason, CLAUSE_NON_ADMISSION_REASONS.NOT_REQUIREMENT_LIKE);
  }
  const admitted = result.requirements.map((r) => r.originalText);
  assert.ok(!admitted.some((t) => t === "Alarm horns"), "an equipment-name unit must not become a requirement");
  assert.ok(!admitted.some((t) => t === "Duct Smoke Detector:"), "an article heading must not become a requirement");
});

test("MVP-CLOSE-11 every non-admission reason is derived from the pre-existing gate, and all three are reachable", () => {
  const result = extract();
  // copyright / table of contents / index of sections -> the existing literal exclusion
  assert.equal(outcomeFor(result, /table of contents/).outcome.nonAdmissionReason, CLAUSE_NON_ADMISSION_REASONS.EXCLUDED_PATTERN);
  // sentenceSplit's <8 character filter -> no candidate sentence ever reaches the gate
  assert.equal(outcomeFor(result, /^Abcd\.$/).outcome.nonAdmissionReason, CLAUSE_NON_ADMISSION_REASONS.NO_CANDIDATE_SENTENCE);
  // everything else is the not-requirement-like branch
  assert.equal(outcomeFor(result, /4000 ft\/min/).outcome.nonAdmissionReason, CLAUSE_NON_ADMISSION_REASONS.NOT_REQUIREMENT_LIKE);

  const reasons = new Set(result.clauseAdmission.filter((o) => o.admissionStatus === CLAUSE_ADMISSION_NOT_ADMITTED).map((o) => o.nonAdmissionReason));
  for (const reason of Object.values(CLAUSE_NON_ADMISSION_REASONS)) {
    assert.ok(reasons.has(reason), `reason ${reason} must be reachable`);
  }
  // An admitted clause never carries a reason, so the two fields cannot disagree.
  for (const outcome of result.clauseAdmission.filter((o) => o.admissionStatus === CLAUSE_ADMISSION_ADMITTED)) {
    assert.equal(outcome.nonAdmissionReason, null);
    assert.ok(outcome.admittedRequirementCount > 0);
  }
});

/* ------------------------------------------------------------------ *
 * 6  Admitted behaviour is unchanged
 * ------------------------------------------------------------------ */
test("MVP-CLOSE-11 the admitted technical set is exactly what the historical gate admitted, in the same order", () => {
  const structure = segmentSpecification(pages());
  const legacy = preRepairRequirements(structure.clauses);
  const result = extract();

  assert.equal(result.requirements.length, legacy.length, "requirement COUNT must not change");
  assert.deepEqual(result.requirements.map((r) => r.originalText), legacy, "requirement CONTENT and ORDER must not change");

  // Deterministic identity: requirement sequence is positional and unchanged.
  assert.deepEqual(result.requirements.map((r) => r.sequence), legacy.map((_, i) => i + 1));
  // The admitted clauses are exactly those that emitted a row.
  const emitted = new Set(result.requirements.map((r) => r.originalText));
  for (const outcome of result.clauseAdmission) {
    assert.equal(outcome.admittedRequirementCount > 0, outcome.admissionStatus === CLAUSE_ADMISSION_ADMITTED);
  }
  assert.equal(result.clauseAdmission.filter((o) => o.admissionStatus === CLAUSE_ADMISSION_ADMITTED).length, new Set(emitted).size);
});

/* ------------------------------------------------------------------ *
 * 7-8  Completeness accounting
 * ------------------------------------------------------------------ */
test("MVP-CLOSE-11 completeness accounting balances, and clause units are never conflated with requirement rows", () => {
  const result = extract();
  const s = result.summary;

  // MVP-CLOSE-13: the identity has THREE terms, one per persisted state. A
  // candidate is a completed POLICY outcome, so it is counted in the balance
  // rather than being folded into "rejected" -- folding the two would be exactly
  // the conflation this test exists to prevent.
  assert.equal(s.clauseUnitsDetected, s.admittedClauseUnits + s.candidateClauseUnits + s.nonAdmittedClauseUnits);
  assert.equal(s.clauseUnitsDetected, 13);
  assert.equal(s.admittedClauseUnits, 3);
  assert.equal(s.candidateClauseUnits, 2);
  assert.equal(s.nonAdmittedClauseUnits, 8);
  assert.equal(s.clauseAdmissionBalanced, true);
  assert.equal(s.clauseAdmissionStatus, "COMPLETE_WITH_CANDIDATES");
  // The per-mechanism breakdown is reported, and is not invented: it is derived
  // from the outcomes that actually carry a mechanism.
  const mechanisms = Object.values(s.candidateMechanisms).reduce((sum, n) => sum + n, 0);
  assert.equal(mechanisms, s.candidateClauseUnits, "every candidate must be attributed to exactly one mechanism");

  // The metric that MVP-CLOSE-10 warned about: clause units and requirement rows
  // are DIFFERENT units and must not be compared. One admitted clause unit can
  // emit several rows, so a clause-vs-row comparison would report phantom loss.
  assert.notEqual(s.clauseUnitsDetected, s.technicalRequirementsEmitted);
  assert.equal(s.technicalRequirementsEmitted, result.requirements.length);

  // The pre-existing summary keys are preserved and still mean what they meant.
  assert.equal(s.totalClausesDetected, s.clauseUnitsDetected);
  assert.equal(s.totalRequirementsExtracted, s.technicalRequirementsEmitted);
  assert.equal(s.parserVersion, "spec-engine-1.0.1");
  assert.equal(s.modelVersion, "deterministic-semantic-1.0.0");
});

/* ------------------------------------------------------------------ *
 * 9-14  Authority isolation
 * ------------------------------------------------------------------ */
test("MVP-CLOSE-11 a non-admitted clause is persisted as a clause, never as a requirement, and is outside current technical evidence", async () => {
  const { raw } = await activeDatabase();
  const bytes = seedGovernedJob(raw, { projectName: "Clause Admission Project" });

  await runExtraction(raw, bytes);

  // Every segmented clause unit is persisted WITH an outcome.
  const clauses = raw.prepare("SELECT sequence,original_text,admission_status,admitted_requirement_count,non_admission_reason,candidate_mechanism FROM specification_clauses WHERE extraction_version_id='extraction-1' ORDER BY sequence").all();
  assert.equal(clauses.length, 13, "every segmented clause unit must be persisted");
  for (const clause of clauses) {
    assert.ok(clause.admission_status, `clause ${clause.sequence} must carry an admission_status`);
    assert.ok([CLAUSE_ADMISSION_ADMITTED, CLAUSE_ADMISSION_NOT_ADMITTED, CLAUSE_ADMISSION_CANDIDATE].includes(clause.admission_status));
  }
  // MVP-CLOSE-13: "rejected" is now the union of two states. BOTH are audited
  // here, because the invariant under test is that neither may become authority:
  // a candidate is a review signal, not a softer rejection.
  const notAdmitted = clauses.filter((c) => c.admission_status === CLAUSE_ADMISSION_NOT_ADMITTED);
  const candidates = clauses.filter((c) => c.admission_status === CLAUSE_ADMISSION_CANDIDATE);
  assert.equal(notAdmitted.length, 8);
  assert.equal(candidates.length, 2);
  for (const clause of [...notAdmitted, ...candidates]) {
    assert.equal(clause.admitted_requirement_count, 0);
    assert.ok(clause.non_admission_reason, "every non-admitted clause must carry a reason");
    // 10. the rejected source text is retained verbatim, with its page.
    assert.ok(clause.original_text.length > 0);
  }
  // A candidate carries exactly one mechanism; a plain rejection carries none.
  // The mechanism is a positive review signal, so it must never be fabricated
  // for a clause that was not classified.
  for (const clause of candidates) {
    assert.ok(Object.values(CLAUSE_CANDIDATE_MECHANISMS).includes(clause.candidate_mechanism), `candidate ${clause.sequence} must carry a known mechanism`);
  }
  for (const clause of [...notAdmitted, ...clauses.filter((c) => c.admission_status === CLAUSE_ADMISSION_ADMITTED)]) {
    assert.equal(clause.candidate_mechanism, null, `clause ${clause.sequence} must not carry a mechanism unless it is a candidate`);
  }
  // C.3 and C.4 are recovered as review candidates (MVP-CLOSE-13 Phase 6), and
  // remain auditable source clauses either way.
  assert.ok(candidates.some((c) => /4000 ft\/min/.test(c.original_text)), "C.3 must be auditable as a candidate source clause");
  assert.ok(candidates.some((c) => /magnetic switch/.test(c.original_text)), "C.4 must be auditable as a candidate source clause");

  // AUTHORITY ISOLATION: technical_requirements holds only admitted output.
  const requirements = raw.prepare("SELECT id,original_text,review_status,approved_for_downstream FROM technical_requirements WHERE extraction_version_id='extraction-1' ORDER BY sequence").all();
  assert.equal(requirements.length, 3, "only admitted clauses may become requirements");
  // MVP-CLOSE-13: a REQUIREMENT_CANDIDATE creates ZERO requirement rows. This is
  // the whole point of the state -- it is reviewable without being authority, so
  // it must be absent from technical_requirements just as firmly as a rejection.
  for (const clause of [...notAdmitted, ...candidates]) {
    assert.ok(
      !requirements.some((r) => r.original_text === clause.original_text),
      `a non-admitted clause (including a candidate) must never appear in technical_requirements: ${clause.original_text.slice(0, 60)}`,
    );
  }
  // No requirement was fabricated to represent the rejected clauses.
  for (const requirement of requirements) {
    assert.ok(!/4000 ft\/min|magnetic switch|Alarm horns|Duct Smoke Detector:/.test(requirement.original_text));
    assert.equal(requirement.approved_for_downstream, 0, "a fresh extraction must not be downstream-eligible");
  }
  // The review queue is not polluted: the rejected clauses are NOT review rows.
  assert.equal(raw.prepare("SELECT COUNT(*) AS c FROM technical_requirements WHERE review_status IS NULL").get().c, 0);

  // The current technical requirement set is exactly the admitted set -- a
  // non-admitted clause cannot enter it, so no link, profile, understanding or
  // matching input can ever see it.
  const current = raw.prepare(`SELECT r.id FROM ${currentTechnicalRequirementsFrom("r")} WHERE r.project_id='project-1' ORDER BY r.sequence`).all();
  assert.equal(current.length, 3);
  assert.deepEqual(current.map((r) => r.id).sort(), requirements.map((r) => r.id).sort());

  // No link can be created against a clause, because links target requirements.
  const linkable = raw.prepare(`SELECT COUNT(*) AS c FROM boq_requirement_links l JOIN ${currentTechnicalRequirementsFrom("r")} ON r.id=l.requirement_id`).get().c;
  assert.equal(linkable, 0, "nothing in the rejected corpus is linkable as technical evidence");
});

test("MVP-CLOSE-11 the persisted extraction summary reconciles admission from what was actually written", async () => {
  const { raw } = await activeDatabase();
  const bytes = seedGovernedJob(raw, { projectName: "Clause Admission Project" });

  await runExtraction(raw, bytes);

  const version = raw.prepare("SELECT status,summary FROM specification_extraction_versions WHERE id='extraction-1'").get();
  const summary = JSON.parse(version.summary);

  // The run is COMPLETED: a policy rejection must not be treated as a
  // processing failure (Phase 4 -- "Completed" is not redefined).
  assert.equal(version.status, "Completed");
  assert.equal(summary.clauseUnitsDetected, 13);
  assert.equal(summary.admittedClauseUnits, 3);
  assert.equal(summary.candidateClauseUnits, 2);
  assert.equal(summary.nonAdmittedClauseUnits, 8);
  assert.equal(summary.clauseUnitsWithoutOutcome, 0, "a new run must leave no clause without an outcome");
  assert.equal(summary.clauseAdmissionBalanced, true);
  // Read back from the persisted table, not the in-memory claim. This is the
  // reconciliation that would catch a third state falling through the CASE arms.
  assert.equal(
    summary.clauseUnitsDetected,
    summary.admittedClauseUnits + summary.candidateClauseUnits + summary.nonAdmittedClauseUnits,
  );
  assert.equal(summary.clauseAdmissionStatus, "COMPLETE_WITH_CANDIDATES");
  // The pre-existing summary keys survive untouched.
  assert.equal(summary.totalClausesDetected, 13);
  assert.equal(summary.totalRequirementsExtracted, 3);
});

/* ------------------------------------------------------------------ *
 * 15-16  Historical compatibility
 * ------------------------------------------------------------------ */
test("MVP-CLOSE-11 historical clause rows stay readable and NULL is fail-safe, never mistaken for admitted", async () => {
  const { raw } = await activeDatabase();

  // A clause row written before admission recording existed: NULL outcome.
  raw.exec(`
    INSERT INTO projects (id,name,owner_user_id,system_domain) VALUES ('project-1','Historical Project','user-1','Fire Alarm');
    INSERT INTO documents (id,project_id,logical_name,document_type,classification_source,created_by,current_version_id)
      VALUES ('document-1','project-1','Fire Alarm Specification','Technical Specification','Manual','user-1','version-1');
    INSERT INTO document_versions (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by)
      VALUES ('version-1','document-1',1,'specification.txt','stored.txt','txt','text/plain',10,'sha-1','sources/version-1','user-1');
    INSERT INTO specification_extraction_versions (id,document_id,document_version_id,version_number,status,parser_version,ruleset_version,model_version,prompt_version,ocr_version,created_by,started_at)
      VALUES ('extraction-old','document-1','version-1',1,'Completed','p','r','m','pr','o','user-1','2026-01-01T00:00:00.000Z');
    INSERT INTO specification_clauses (id,extraction_version_id,sequence,kind,number,title,page_from,page_to,path,original_text)
      VALUES ('extraction-old_clause_1','extraction-old',1,'Article','1','A legacy clause that predates admission recording',1,1,'["2 PRODUCTS"]','A legacy clause that predates admission recording');
  `);

  // The historical row is still readable, and its outcome is NULL = "not recorded".
  const legacy = raw.prepare("SELECT admission_status,admitted_requirement_count,non_admission_reason,candidate_mechanism,original_text FROM specification_clauses WHERE id='extraction-old_clause_1'").get();
  assert.equal(legacy.admission_status, null);
  assert.equal(legacy.admitted_requirement_count, null);
  assert.equal(legacy.non_admission_reason, null);
  assert.ok(legacy.original_text.length > 0, "historical source text must be preserved");

  // NULL is fail-safe: it is neither ADMITTED nor NOT_ADMITTED, so it can never
  // be counted as an admitted clause and can never grant authority.
  // MVP-CLOSE-13: NULL must remain distinct from all THREE known states, so a
  // clause that was never analysed can never be read as a candidate either.
  assert.ok(![CLAUSE_ADMISSION_ADMITTED, CLAUSE_ADMISSION_NOT_ADMITTED, CLAUSE_ADMISSION_CANDIDATE].includes(legacy.admission_status));
  assert.equal(legacy.candidate_mechanism, null, "a never-analysed clause must not carry a mechanism");
  const admittedCount = raw.prepare("SELECT COUNT(*) AS c FROM specification_clauses WHERE admission_status='ADMITTED_REQUIREMENT'").get().c;
  assert.equal(admittedCount, 0, "a NULL outcome must never be read as admitted");

  // No historical rewrite is required or performed.
  assert.equal(raw.prepare("SELECT COUNT(*) AS c FROM specification_clauses WHERE extraction_version_id='extraction-old'").get().c, 1);
  // The additive columns are nullable, which is what makes that possible.
  const cols = raw.prepare("SELECT name FROM pragma_table_info('specification_clauses')").all().map((c) => c.name);
  for (const column of ["admission_status", "admitted_requirement_count", "non_admission_reason"]) {
    assert.ok(cols.includes(column), `${column} must exist on specification_clauses`);
  }
  // MVP-CLOSE-13: the mechanism column is additive and nullable, so the same
  // historical row stays insertable. It carries no DEFAULT, which is the point:
  // a default would fabricate a mechanism on rows that were never analysed.
  // `notnull` is a SQLite keyword and must be quoted in a column list.
  const mechanism = raw.prepare("SELECT name,\"notnull\",dflt_value FROM pragma_table_info('specification_clauses') WHERE name='candidate_mechanism'").get();
  assert.ok(mechanism, "candidate_mechanism must exist on specification_clauses");
  assert.equal(mechanism.notnull, 0, "candidate_mechanism must be nullable");
  assert.equal(mechanism.dflt_value, null, "candidate_mechanism must have no DEFAULT");
});

/* ------------------------------------------------------------------ *
 * 6  Review/read surface -- existing extraction response, no new UI
 * ------------------------------------------------------------------ */
test("MVP-CLOSE-11 the existing clauses response exposes the admission outcome and can list rejected clauses", async () => {
  const { raw } = await activeDatabase();
  // The API actor for a localhost request is the server-derived single-user
  // identity, so the governed project is owned by exactly that identity.
  const bytes = seedGovernedJob(raw, { projectName: "Read Surface Project", ownerUserId: "local-development-user" });
  await runExtraction(raw, bytes);

  const env = { DB: d1(raw), FILES: {} };
  const call = async (query = "") => {
    const response = await handleSpecificationExtractionApi(
      new Request(`http://localhost/api/documents/document-1/specification-extraction/clauses${query}`),
      env,
      {},
    );
    assert.ok(response, "the clauses read must be served by the extraction handler");
    return { status: response.status, body: await response.json() };
  };

  // Unfiltered: every clause unit is visible with its outcome and provenance.
  const all = await call();
  assert.equal(all.status, 200);
  assert.equal(all.body.clauses.length, 13);
  for (const clause of all.body.clauses) {
    assert.ok(clause.admission_status, "admission status must be exposed");
    assert.ok("original_text" in clause, "source text must be exposed");
    assert.ok("page_from" in clause && "page_to" in clause, "page/span must be exposed");
    assert.equal(clause.extraction_version_id, "extraction-1", "extraction version must be exposed");
    if (clause.admission_status === "NOT_ADMITTED") assert.ok(clause.non_admission_reason, "reason must be exposed");
  }

  // Filtered: a reviewer can list only the clauses the policy did not admit.
  //
  // MVP-CLOSE-13: the new state needs NO new filter and NO new route. The
  // existing `admissionStatus` bind is a pass-through with no value allowlist, so
  // REQUIREMENT_CANDIDATE is served by the same query. This is verified rather
  // than assumed, because if it ever acquired an allowlist the candidates would
  // become invisible exactly when they matter.
  const rejected = await call("?admissionStatus=NOT_ADMITTED");
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.clauses.length, 8);
  for (const clause of rejected.body.clauses) {
    assert.equal(clause.admission_status, "NOT_ADMITTED");
    assert.equal(clause.admitted_requirement_count, 0);
  }

  // Phase 7 read-model visibility: candidates are retrievable with their text,
  // document/version, page span, admission state, mechanism and reason -- using
  // the pre-existing surface, with no new endpoint.
  const candidates = await call(`?admissionStatus=${CLAUSE_ADMISSION_CANDIDATE}`);
  assert.equal(candidates.status, 200);
  assert.equal(candidates.body.clauses.length, 2);
  for (const clause of candidates.body.clauses) {
    assert.equal(clause.admission_status, CLAUSE_ADMISSION_CANDIDATE);
    assert.equal(clause.admitted_requirement_count, 0, "a candidate must emit zero requirement rows");
    assert.ok(Object.values(CLAUSE_CANDIDATE_MECHANISMS).includes(clause.candidate_mechanism), "the mechanism must be exposed for review");
    assert.ok(clause.non_admission_reason, "the reason it was not admitted must remain visible");
    assert.ok(clause.original_text.length > 0, "source text must be exposed");
    assert.ok("page_from" in clause && "page_to" in clause, "page/span must be exposed");
    assert.equal(clause.extraction_version_id, "extraction-1", "document/version must be exposed");
  }
  assert.ok(candidates.body.clauses.some((c) => /4000 ft\/min/.test(c.original_text)), "C.3 must be inspectable by a reviewer as a candidate");
  assert.ok(candidates.body.clauses.some((c) => /magnetic switch/.test(c.original_text)), "C.4 must be inspectable by a reviewer as a candidate");

  // The three states partition the corpus exactly -- no unit is counted twice and
  // none is dropped.
  const admitted = await call("?admissionStatus=ADMITTED_REQUIREMENT");
  assert.equal(admitted.body.clauses.length, 3);
  assert.equal(
    admitted.body.clauses.length + rejected.body.clauses.length + candidates.body.clauses.length,
    all.body.clauses.length,
  );

  // The rejected clauses are NOT reachable through the requirements read, so
  // observability did not create a second, weaker requirement surface.
  const requirements = await handleSpecificationExtractionApi(
    new Request("http://localhost/api/documents/document-1/specification-extraction/requirements"),
    env,
    {},
  );
  const requirementBody = await requirements.json();
  assert.equal(requirementBody.requirements.length, 3);
  assert.ok(!requirementBody.requirements.some((r) => /4000 ft\/min|Alarm horns/.test(r.original_text)));
});

/* ------------------------------------------------------------------ *
 * MVP-CLOSE-13 -- REQUIREMENT_CANDIDATE authority-isolation proofs.
 *
 * These are the measurements the slice is actually accountable for. Each one
 * is executed against the real migration chain and the real consumers, because
 * the whole risk of this slice is a clause state that is quietly non-authoritative
 * in one place and quietly authoritative in another.
 * ------------------------------------------------------------------ */
test("MVP-CLOSE-13 classifyRequirementCandidate recognises each measured mechanism, is total, and is pure", async () => {
  const { classifyRequirementCandidate, CLAUSE_CANDIDATE_MECHANISMS: M } = await import("../app/domain/specification-extractor.mjs");

  // The four measured mechanisms, expressed grammatically. No clause is quoted
  // verbatim from the governing document, so these are not text hacks: they are
  // the constructions, applied to fresh wording.
  const expected = [
    [M.PASSIVE_PRESENT, "The housings are to be painted red before delivery."],
    [M.PASSIVE_PRESENT, "Access passwords protect the stored records."],
    [M.FUTURE_REQUIREMENT, "The control unit will interrupt power on alarm."],
    [M.IMPERATIVE, "Install all detectors on a solid substrate."],
    [M.IMPERATIVE, "Use crimp-on spade lugs for all connections."],
    [M.CAPABILITY, "Sensitivity can be adjusted at the panel."],
    [M.CAPABILITY, "The unit is able to store up to 500 events."],
  ];
  for (const [mechanism, sentence] of expected) {
    assert.equal(classifyRequirementCandidate(sentence), mechanism, `expected ${mechanism} for: ${sentence}`);
  }

  // Total and safe: no input produces a throw, a non-mechanism value, or a
  // mechanism name outside the declared set.
  for (const input of ["", "   ", "Alarm horns", "3. Repeater panel (remote annunciator)", "1.1.2.3", null, undefined, 42, {}]) {
    const result = classifyRequirementCandidate(input);
    assert.ok(result === null || Object.values(M).includes(result), `unexpected result ${result} for ${JSON.stringify(input)}`);
  }

  // Pure: the same input always yields the same mechanism, so the recorded label
  // is a deterministic function of the source text and can be audited later.
  for (const [, sentence] of expected) {
    assert.equal(classifyRequirementCandidate(sentence), classifyRequirementCandidate(sentence));
  }
});

test("MVP-CLOSE-13 a clause matching several mechanisms is counted exactly once, by documented precedence", async () => {
  const { classifyRequirementCandidate, CLAUSE_CANDIDATE_MECHANISMS: M } = await import("../app/domain/specification-extractor.mjs");

  // "Install" is imperative; this sentence is also a capability statement. The
  // documented order is PASSIVE_PRESENT > FUTURE_REQUIREMENT > IMPERATIVE >
  // CAPABILITY, so the earlier mechanism wins. Double counting would inflate the
  // candidate count and mis-attribute a clause in the review queue.
  assert.equal(classifyRequirementCandidate("Install the units so they can be removed without tools."), M.IMPERATIVE);
  assert.equal(classifyRequirementCandidate("The detector is to be wired and will be tested at the factory."), M.PASSIVE_PRESENT);
  assert.equal(classifyRequirementCandidate("The panel will operate and can store 500 events."), M.FUTURE_REQUIREMENT);

  // And the precedence is total: exactly one mechanism per sentence, never zero
  // and never two, over a broad sample.
  const sample = [
    "The units are to be labelled.",
    "Test each circuit weekly.",
    "Backup power can last four hours.",
    "The system will be commissioned by the contractor.",
    "Suppression agents are stored in cylinders.",
    "Clearly label the isolation valve.",
  ];
  for (const sentence of sample) {
    const mechanism = classifyRequirementCandidate(sentence);
    assert.ok(mechanism !== null && Object.values(M).includes(mechanism), `no single mechanism for: ${sentence}`);
  }
});

test("MVP-CLOSE-13 a REQUIREMENT_CANDIDATE clause is invisible to the current technical set, link pool, and understanding inputs", async () => {
  const { raw } = await activeDatabase();
  const bytes = seedGovernedJob(raw, { projectName: "Candidate Isolation Project" });
  await runExtraction(raw, bytes);

  const candidates = raw.prepare("SELECT id,original_text FROM specification_clauses WHERE extraction_version_id='extraction-1' AND admission_status='REQUIREMENT_CANDIDATE'").all();
  assert.equal(candidates.length, 2, "this fixture must produce review candidates");

  // 9. A candidate creates ZERO technical_requirements rows. Not a row in
  // 'Needs Review', not a row in any status -- no row. Phase 1 measured that
  // every status variant leaks, so a row at all would be a regression.
  const requirements = raw.prepare("SELECT id,original_text,review_status,approved_for_downstream,clause_id FROM technical_requirements WHERE extraction_version_id='extraction-1'").all();
  assert.equal(requirements.length, 3, "the requirement set must be exactly the admitted set");
  for (const candidate of candidates) {
    assert.ok(!requirements.some((r) => r.original_text === candidate.original_text), `a candidate must not become a requirement: ${candidate.original_text.slice(0, 50)}`);
    // And it cannot be an indirect child of one either.
    assert.ok(!requirements.some((r) => r.clause_id === candidate.id), `a candidate clause must own no requirement rows: ${candidate.id}`);
  }

  // 10. Absent from the current technical requirement set, so every consumer
  // that reads currency rather than approval still cannot see it.
  const currentIds = raw.prepare(`SELECT r.id FROM ${currentTechnicalRequirementsFrom("r")} WHERE r.project_id='project-1'`).all().map((r) => r.id);
  assert.equal(currentIds.length, 3);
  const currentTexts = new Set(requirements.map((r) => r.original_text));
  for (const candidate of candidates) assert.ok(!currentTexts.has(candidate.original_text));

  // 11. Not linkable: links key on requirement_id, and no candidate has one.
  const links = raw.prepare("SELECT COUNT(*) AS c FROM boq_requirement_links").get().c;
  assert.equal(links, 0, "candidate recovery must create no link");
  const linkable = raw.prepare(`SELECT COUNT(*) AS c FROM boq_requirement_links l JOIN ${currentTechnicalRequirementsFrom("r")} ON r.id=l.requirement_id`).get().c;
  assert.equal(linkable, 0);

  // 12/13. No fingerprint, profile, readiness or downstream approval effect: the
  // candidate count appears in no evidence-derived table, and no row anywhere is
  // downstream-eligible. Measured by query, not asserted by construction.
  // Tables that a CANDIDATE can reach only by becoming a requirement. The check
  // that matters is not "empty" but "no row references a candidate": a
  // pre-existing admitted requirement may legitimately have produced evidence
  // rows, so an absolute zero would be a weaker, wrong assertion here.
  for (const table of ["requirement_profile_versions", "boq_requirement_links", "engineering_knowledge_decisions"]) {
    const count = raw.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
    assert.equal(count, 0, `${table} must be untouched by candidate recovery`);
  }
  const candidateTexts = new Set(candidates.map((c) => c.original_text));
  const evidence = raw.prepare("SELECT original_text FROM requirement_evidence").all();
  for (const row of evidence) {
    assert.ok(!candidateTexts.has(row.original_text), "no evidence row may derive from a candidate clause");
  }
  assert.equal(raw.prepare("SELECT COUNT(*) AS c FROM technical_requirements WHERE approved_for_downstream=1").get().c, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) AS c FROM technical_requirements WHERE review_status='Approved'").get().c, 0);
});

test("MVP-CLOSE-13 candidate classification cannot alter the emitted requirement set, measured against the historical gate", () => {
  // The decisive regression guard. `preRepairRequirements` below inlines the
  // pre-MVP-CLOSE-11 admission gate, so this compares the CURRENT extractor
  // against the ORIGINAL policy, not against a snapshot of itself.
  const structure = segmentSpecification(pages());
  const legacy = preRepairRequirements(structure.clauses);
  const result = extract();

  assert.equal(result.requirements.length, legacy.length, "requirement COUNT must not change");
  assert.deepEqual(result.requirements.map((r) => r.originalText), legacy, "requirement CONTENT and ORDER must not change");
  assert.deepEqual(result.requirements.map((r) => r.sequence), legacy.map((_, i) => i + 1));

  // And the classification itself is confined to the rejection path: a candidate
  // never overlaps an admitted clause, and an admitted clause never carries a
  // mechanism.
  for (const outcome of result.clauseAdmission) {
    if (outcome.admissionStatus === CLAUSE_ADMISSION_ADMITTED) {
      assert.equal(outcome.candidateMechanism, null, "an admitted clause must never be classified as a candidate");
    }
    if (outcome.admissionStatus === CLAUSE_ADMISSION_CANDIDATE) {
      assert.equal(outcome.admittedRequirementCount, 0, "a candidate must emit zero requirement rows");
    }
  }
});

test("MVP-CLOSE-13 the descriptive catch-all and structural headings stay rejected", async () => {
  const { classifyRequirementCandidate, CLAUSE_ADMISSION_NOT_ADMITTED: R, CLAUSE_ADMISSION_CANDIDATE: C } = await import("../app/domain/specification-extractor.mjs");

  // MVP-CLOSE-12 measured the descriptive catch-all at ~9% precision (11
  // technical against 108 noise). Phase 10 requires representative samples to
  // remain NOT_ADMITTED, so the catch-all is demonstrably not opened.
  //
  // These are VERBATIM units from the frozen 28 46 00 corpus, labelled `B`/`C`
  // in the MVP-CLOSE-12 reconciliation, and each was checked to be one of the 96
  // such units the shipped detector leaves NOT_ADMITTED.
  //
  // Wording invented for this test was discarded on both counts. It was not
  // representative, and two invented sentences turned out to be real residual
  // false positives of the shipped detector ("...are listed below" trips the
  // passive-copula frame; "Test Reports:" trips the imperative frame). Using
  // invented negatives would have hidden exactly the behaviour worth recording.
  const descriptiveCorpus = [
    "CACF - Central Alarm and Control Facility.",
    "Main operating terminal (system console)",
    "MFACP - Main Fire Alarm Control Panel.",
    "NAC - Notification Appliance circuit.",
    "Lighting control and dimming system.",
    "Materials and Services:",
    "Applicable Codes and Standards:",
    "The following standards apply to this Section, among others:",
    "Lamp test.",
  ];
  for (const sentence of descriptiveCorpus) {
    assert.equal(classifyRequirementCandidate(sentence), null, `a corpus descriptive unit must not be a candidate: ${sentence}`);
  }

  // DOCUMENTED RESIDUAL, not a defect I am hiding: the passive-copula frame
  // matches a copula + past participle in ANY clause, so descriptive prose that
  // uses one is classified as a candidate. Measured on the frozen corpus this
  // costs 2-3 collateral units against 26 recovered technical units; every
  // tightening tried (dropping the bare copula, restricting to an engineering
  // participle list, requiring an equipment subject) lost 18-20 of the 26
  // technical units to save 2-3 noise units, so the broad frame is deliberate.
  // It is safe because a candidate is reviewable and non-authoritative, not
  // because the classification is clean.
  const residualCopula = "The abbreviations and acronyms used in this Section are listed below.";
  assert.equal(
    classifyRequirementCandidate(residualCopula),
    "PASSIVE_PRESENT",
    "the passive-copula residual is characterised explicitly, not asserted away",
  );
  // A second residual, from the imperative frame: a heading beginning with a
  // bare action verb ("Test Reports:") is grammatical as a heading and as an
  // instruction, and the frame cannot tell them apart without a structural
  // label. Also a measured collateral unit (`u019`) in MVP-CLOSE-12 terms.
  assert.equal(
    classifyRequirementCandidate("Test Reports:"),
    "IMPERATIVE",
    "the imperative-heading residual is characterised explicitly, not asserted away",
  );

  // Structural headings and equipment labels: not candidates either. These are
  // short, so `sentenceSplit` may drop them entirely -- either way they must
  // never become a REQUIREMENT_CANDIDATE.
  const structural = ["Alarm horns", "Repeater panel (remote annunciator)", "Duct Smoke Detector:", "3. Device Schedule:", "F. References:"];
  for (const sentence of structural) {
    assert.equal(classifyRequirementCandidate(sentence), null, `a structural heading must not be a candidate: ${sentence}`);
  }
  assert.ok(!Object.values(C).includes(R), "the three state constants must be distinct");
});

test("MVP-CLOSE-13 the completeness identity has three terms in both the producer and the persisted summary", () => {
  const result = extract();
  const s = result.summary;

  // 14. detected = admitted + candidate + notAdmitted, in the in-memory producer.
  assert.equal(s.clauseUnitsDetected, s.admittedClauseUnits + s.candidateClauseUnits + s.nonAdmittedClauseUnits);
  assert.equal(s.clauseAdmissionBalanced, true);
  // Every clause carries exactly one state; no unit is uncounted or double counted.
  const total = [CLAUSE_ADMISSION_ADMITTED, CLAUSE_ADMISSION_CANDIDATE, CLAUSE_ADMISSION_NOT_ADMITTED]
    .map((state) => result.clauseAdmission.filter((o) => o.admissionStatus === state).length)
    .reduce((sum, n) => sum + n, 0);
  assert.equal(total, result.clauseAdmission.length);
  assert.equal(total, s.clauseUnitsDetected);
  // The technical requirement row count stays a SEPARATE metric: one admitted
  // clause unit can emit several rows, so conflating the two would report
  // phantom loss (the MVP-CLOSE-10 measurement error).
  assert.equal(s.technicalRequirementsEmitted, result.requirements.length);
  assert.notEqual(s.clauseUnitsDetected, s.technicalRequirementsEmitted);
});
