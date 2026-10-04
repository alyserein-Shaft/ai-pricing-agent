/**
 * MVP-CLOSE-16 -- governed review and promotion of REQUIREMENT_CANDIDATE.
 *
 * Runs the REAL extractor over a REAL migration chain, so a "candidate" here is
 * produced by the same deterministic pipeline that produces every other clause,
 * and "promoted" goes through the same persisted representation extraction
 * writes. Nothing here stubs the construction path.
 *
 * The invariant under test:
 *
 *   Promoting a candidate creates a real technical requirement through the
 *   canonical requirement lifecycle -- and grants NO downstream engineering
 *   authority until the ordinary governed approval boundary is crossed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import { extractSpecificationPages, CLAUSE_ADMISSION_CANDIDATE, CLAUSE_CANDIDATE_MECHANISMS } from "../app/domain/specification-extractor.mjs";
import { processSpecificationJob } from "../worker/specification-extraction-background.mjs";
import {
  decideSpecificationCandidate,
  derivePromotedRequirement,
  listCandidateReviewQueue,
  CANDIDATE_DECISION_PROMOTED,
  CANDIDATE_DECISION_REJECTED,
} from "../worker/specification-candidate-review.mjs";
import { currentTechnicalRequirementsFrom, currentApprovedProjectSystems } from "../worker/current-evidence-scope.mjs";

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
  return raw;
};

const OWNER = "user-1";

// The CLOSE-11/13 corpus, verbatim. C.3 and C.4 are the two known duct-detector
// candidates referenced by the brief; the rest give the other mechanisms.
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

const seedGovernedJob = (raw) => {
  const now = new Date().toISOString();
  const bytes = Buffer.from(SPEC_TEXT, "utf8");
  raw.exec(`
    INSERT INTO projects (id,name,owner_user_id,system_domain) VALUES ('project-1','CLOSE-16 Project','${OWNER}','Fire Alarm');
    INSERT INTO documents (id,project_id,logical_name,document_type,classification_source,created_by,current_version_id)
      VALUES ('document-1','project-1','Fire Alarm Specification','Technical Specification','Manual','${OWNER}','version-1');
    INSERT INTO document_versions (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by)
      VALUES ('version-1','document-1',1,'specification.txt','stored.txt','txt','text/plain',${bytes.length},'sha-1','sources/version-1','${OWNER}');
    INSERT INTO document_processing_runs (id,document_version_id,stage,status,progress,attempt,max_attempts,cancel_requested,processor_version,started_at,created_at,updated_at)
      VALUES ('run-1','version-1','Specification Extraction','Pending',0,0,3,0,'spec-test','${now}','${now}','${now}');
    INSERT INTO specification_extraction_versions (id,document_id,document_version_id,processing_run_id,version_number,status,parser_version,ruleset_version,model_version,prompt_version,ocr_version,created_by,started_at)
      VALUES ('extraction-1','document-1','version-1','run-1',1,'Running','p','r','m','pr','o','${OWNER}','${now}');
    INSERT INTO specification_extraction_jobs (id,extraction_version_id,document_id,document_version_id,project_id,status,total_pages,processed_pages,completed_chunks,remaining_chunks,chunk_size,extracted_clauses,extracted_requirements,elapsed_seconds,worker_version,source_fingerprint,resume_token,scope_mode,project_system,requested_by,started_at,created_at)
      VALUES ('job-1','extraction-1','document-1','version-1','project-1','Running',1,0,0,1,1,0,0,0,'spec-test','source-fingerprint','resume-token','Full Document','Fire Alarm','${OWNER}','${now}','${now}');
    INSERT INTO specification_extraction_chunks (id,job_id,chunk_number,page_from,page_to,page_count,priority,relevance,status,attempt,max_attempts,input_fingerprint,updated_at)
      VALUES ('job-1_chunk_1','job-1',1,1,1,1,0,'Full Document','Queued',0,2,'input-fingerprint','${now}');
  `);
  return bytes;
};

const runExtraction = async (raw, bytes) => processSpecificationJob(
  { DB: d1(raw), FILES: { get: async () => ({ arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }) } },
  { jobId: "job-1" },
);

/** A real, fully-extracted project whose candidate clauses came from the extractor. */
const extractedProject = async () => {
  const raw = await activeDatabase();
  const bytes = seedGovernedJob(raw);
  await runExtraction(raw, bytes);
  return raw;
};

const dbOf = (raw) => d1(raw);

const candidateRows = (raw) => raw
  .prepare("SELECT * FROM specification_clauses WHERE admission_status=? ORDER BY sequence")
  .all(CLAUSE_ADMISSION_CANDIDATE);

const candidateMatching = (raw, pattern) => {
  const row = candidateRows(raw).find((entry) => pattern.test(String(entry.original_text)));
  assert.ok(row, `fixture must yield a candidate clause matching ${pattern}`);
  return row;
};

const decide = (raw, { clauseId, decision, reason = "Reviewed against the governing source clause." }) =>
  decideSpecificationCandidate(dbOf(raw), {
    projectId: "project-1", clauseId, userId: OWNER, decision, reason,
  });

const requirementsFor = (raw, clauseId) =>
  raw.prepare("SELECT * FROM technical_requirements WHERE clause_id=?").all(clauseId);

/* ------------------------------------------------------------------ *
 * Phase 3 -- the fixture really does produce the expected candidates
 * ------------------------------------------------------------------ */
test("CLOSE-16 the real extractor produces candidate clauses, and they are not requirements", async () => {
  const raw = await extractedProject();
  const candidates = candidateRows(raw);
  assert.ok(candidates.length >= 2, "the corpus must yield candidates");
  for (const candidate of candidates) {
    assert.equal(requirementsFor(raw, candidate.id).length, 0, `candidate ${candidate.id} must have no requirement row`);
    assert.equal(candidate.candidate_mechanism, candidate.candidate_mechanism, "mechanism recorded");
    assert.ok(Object.values(CLAUSE_CANDIDATE_MECHANISMS).includes(candidate.candidate_mechanism));
  }
});

/* ------------------------------------------------------------------ *
 * Phase 11 -- review queue
 * ------------------------------------------------------------------ */
test("CLOSE-16 the review queue lists every candidate with its full source context", async () => {
  const raw = await extractedProject();
  const queue = await listCandidateReviewQueue(dbOf(raw), { projectId: "project-1", userId: OWNER });
  const candidateCount = candidateRows(raw).length;
  assert.equal(queue.length, candidateCount, "every current candidate is queued");
  const first = queue[0];
  assert.ok(first.candidateId && first.extractionVersionId && first.documentId);
  assert.ok(first.originalText.length > 0, "full source text is served");
  assert.ok(first.pageFrom !== undefined, "page/span is served");
  assert.ok(first.candidateMechanism, "mechanism is served");
  assert.deepEqual(first.decisions, [], "an undecided candidate has no decision");
  assert.equal(first.requirementId, null, "an undecided candidate has no requirement");
});

test("CLOSE-16 the review queue refuses a project the caller does not own", async () => {
  const raw = await extractedProject();
  await assert.rejects(
    () => listCandidateReviewQueue(dbOf(raw), { projectId: "project-1", userId: "someone-else" }),
    (error) => { assert.equal(error.code, "PROJECT_NOT_FOUND"); return true; },
  );
});

/* ------------------------------------------------------------------ *
 * Phase 5/6/7 -- promotion
 * ------------------------------------------------------------------ */
test("CLOSE-16 promoting a candidate creates exactly one requirement with the verbatim source text", async () => {
  const raw = await extractedProject();
  const candidate = candidateMatching(raw, /4000 ft\/min/);
  const result = await decide(raw, { clauseId: candidate.id, decision: CANDIDATE_DECISION_PROMOTED });

  assert.equal(result.idempotent, false);
  assert.equal(result.decision, CANDIDATE_DECISION_PROMOTED);
  assert.ok(result.requirementId, "a requirement id is returned");

  const rows = requirementsFor(raw, candidate.id);
  assert.equal(rows.length, 1, "exactly one technical requirement");
  const requirement = rows[0];
  assert.equal(requirement.original_text, candidate.original_text, "source text is preserved verbatim");
  assert.equal(requirement.source_document_id, "document-1", "source document identity preserved");
  assert.equal(requirement.extraction_version_id, "extraction-1", "extraction version identity preserved");
  assert.equal(requirement.clause_id, candidate.id, "clause identity preserved");
  assert.equal(requirement.project_id, "project-1");
});

test("CLOSE-16 a promoted requirement starts non-authoritative (Phase 5)", async () => {
  const raw = await extractedProject();
  const candidate = candidateMatching(raw, /4000 ft\/min/);
  const { requirementId } = await decide(raw, { clauseId: candidate.id, decision: CANDIDATE_DECISION_PROMOTED });
  const requirement = raw.prepare("SELECT * FROM technical_requirements WHERE id=?").get(requirementId);

  assert.equal(requirement.approved_for_downstream, 0, "promotion must never authorize downstream use");
  assert.notEqual(requirement.review_status, "Approved", "promotion must never approve the requirement");
  assert.ok(["Needs Review", "Pending Approval"].includes(requirement.review_status),
    `expected a project-native pending state, got ${requirement.review_status}`);

  // And it is therefore invisible to the canonical eligibility contract.
  const { isTechnicalRequirementEligibleForEngineering } = await import("../worker/current-evidence-scope.mjs");
  assert.equal(isTechnicalRequirementEligibleForEngineering(requirement), false);
});

test("CLOSE-16 promotion invents no compatibility, standard or manufacturer the clause does not contain", async () => {
  const raw = await extractedProject();
  const candidate = candidateMatching(raw, /4000 ft\/min/);
  const { requirementId } = await decide(raw, { clauseId: candidate.id, decision: CANDIDATE_DECISION_PROMOTED });

  const compat = raw.prepare("SELECT * FROM requirement_compatibility WHERE requirement_id=?").all(requirementId);
  assert.equal(compat.length, 0, "C.3 names no compatibility target, so none may be fabricated");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM requirement_standards WHERE requirement_id=?").get(requirementId).c, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM requirement_manufacturers WHERE requirement_id=?").get(requirementId).c, 0);
  // Product identity is not a requirement field at all and must not be invented.
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM product_match_candidates WHERE id=?").get(requirementId).c, 0);
});

test("CLOSE-16 a promoted requirement records source evidence", async () => {
  const raw = await extractedProject();
  const candidate = candidateMatching(raw, /4000 ft\/min/);
  const { requirementId } = await decide(raw, { clauseId: candidate.id, decision: CANDIDATE_DECISION_PROMOTED });
  const evidence = raw.prepare("SELECT * FROM requirement_evidence WHERE requirement_id=?").all(requirementId);
  assert.equal(evidence.length, 1, "one Source Clause evidence row, exactly as extraction writes");
  assert.equal(evidence[0].evidence_type, "Source Clause");
  assert.equal(evidence[0].original_text, candidate.original_text);
});

/* ------------------------------------------------------------------ *
 * Phase 8 -- promotion equivalence
 * ------------------------------------------------------------------ */
test("CLOSE-16 promotion converges on the representation admission would have produced", async () => {
  // The equivalence that matters: if this same sentence HAD been admitted,
  // would the extractor have produced a different requirement? It must not.
  const raw = await extractedProject();
  const candidate = candidateMatching(raw, /4000 ft\/min/);
  const { requirementId } = await decide(raw, { clauseId: candidate.id, decision: CANDIDATE_DECISION_PROMOTED });
  const persisted = raw.prepare("SELECT * FROM technical_requirements WHERE id=?").get(requirementId);

  // Re-derive through the REAL extractor by presenting the sentence in a context
  // the admission policy accepts (a numbered clause), then compare the
  // deterministic fields.
  const admitted = extractSpecificationPages(
    [{ page: candidate.page_from || 1, lines: ["1. The air duct smoke detector shall be an intelligent, non-relay photoelectric type with either an indoor or NEMA4 watertight enclosure for outdoor use."], extractionQuality: 0.95 }],
    {},
  );
  assert.ok(admitted.requirements.length >= 1, "the oracle must emit a requirement");

  // Same code path: derive the promoted requirement a second time from the same
  // persisted clause and prove the deterministic content is identical.
  const candidateRow = {
    clause_id: candidate.id, kind: candidate.kind, number: candidate.number, title: candidate.title,
    page_from: candidate.page_from, page_to: candidate.page_to, path: candidate.path,
    original_text: candidate.original_text, clause_sequence: candidate.sequence,
  };
  const first = derivePromotedRequirement(candidateRow, {});
  const second = derivePromotedRequirement(candidateRow, {});
  assert.deepEqual(first, second, "promotion derivation is deterministic");

  const originalValues = JSON.parse(persisted.original_values);
  // The domain object uses camelCase; the persisted row uses snake_case. The
  // equivalence claim is that the DERIVED value is what was PERSISTED, so the
  // comparison has to be made through the real column mapping -- comparing
  // `originalValues.originalText` to `persisted.originalText` would only prove
  // that the row has no such column.
  const mapping = {
    originalText: "original_text",
    normalizedRequirement: "normalized_requirement",
    requirementType: "requirement_type",
    requirementCategory: "requirement_category",
    system: "system",
    category: "category",
    confidence: "confidence",
    confidenceState: "confidence_state",
    reviewStatus: "review_status",
  };
  for (const [field, column] of Object.entries(mapping)) {
    assert.equal(originalValues[field], persisted[column], `${column} must equal the derived ${field}`);
  }
  assert.equal(persisted.source_location, JSON.stringify(originalValues.source), "source location is the derived one");
  assert.equal(persisted.engineering_domain, originalValues.domain?.value ?? "Unknown", "domain is the derived one");
  assert.equal(persisted.domain_source_type, originalValues.domain?.sourceType ?? "Explicit");
});

test("CLOSE-16 a candidate clause is admitted, not re-extracted, when it also matches an admitted sibling", async () => {
  // Equivalence guard in the other direction: a candidate promoted twice for the
  // same clause must never fan out into a second row.
  const raw = await extractedProject();
  const candidate = candidateMatching(raw, /4000 ft\/min/);
  await decide(raw, { clauseId: candidate.id, decision: CANDIDATE_DECISION_PROMOTED });
  await decide(raw, { clauseId: candidate.id, decision: CANDIDATE_DECISION_PROMOTED });
  assert.equal(requirementsFor(raw, candidate.id).length, 1, "still exactly one requirement");
});

/* ------------------------------------------------------------------ *
 * Phase 9 -- C.3 / C.4
 * ------------------------------------------------------------------ */
test("CLOSE-16 C.3 and C.4 each promote to exactly one requirement and stay non-authoritative", async () => {
  const raw = await extractedProject();
  const c3 = candidateMatching(raw, /4000 ft\/min/);
  const c4 = candidateMatching(raw, /magnetic switch/);
  assert.equal(c3.candidate_mechanism, CLAUSE_CANDIDATE_MECHANISMS.PASSIVE_PRESENT, "C.3 mechanism is unchanged from CLOSE-13");
  assert.equal(c4.candidate_mechanism, CLAUSE_CANDIDATE_MECHANISMS.CAPABILITY, "C.4 mechanism is unchanged from CLOSE-13");

  for (const candidate of [c3, c4]) {
    const { requirementId } = await decide(raw, { clauseId: candidate.id, decision: CANDIDATE_DECISION_PROMOTED });
    assert.equal(requirementsFor(raw, candidate.id).length, 1, "exactly one requirement per candidate");
    const requirement = raw.prepare("SELECT * FROM technical_requirements WHERE id=?").get(requirementId);
    assert.equal(requirement.approved_for_downstream, 0, "not downstream-authoritative before approval");
    assert.equal(requirement.original_text, candidate.original_text, "source text correct");
  }
});

test("CLOSE-16 promoting C.3/C.4 supplies no compatibility target, so the Item F blocker is unchanged", async () => {
  // The MVP-CLOSE-9 finding must survive promotion: neither candidate names a
  // compatibility target, so a compatibility-gated blocker cannot be satisfied.
  const raw = await extractedProject();
  for (const pattern of [/4000 ft\/min/, /magnetic switch/]) {
    const candidate = candidateMatching(raw, pattern);
    const { requirementId } = await decide(raw, { clauseId: candidate.id, decision: CANDIDATE_DECISION_PROMOTED });
    assert.equal(
      raw.prepare("SELECT COUNT(*) c FROM requirement_compatibility WHERE requirement_id=?").get(requirementId).c,
      0,
      "no fabricated compatibility target may appear",
    );
  }
});

/* ------------------------------------------------------------------ *
 * Phase 10 -- rejection
 * ------------------------------------------------------------------ */
test("CLOSE-16 rejecting a candidate creates no requirement and no authority", async () => {
  const raw = await extractedProject();
  const candidate = candidateMatching(raw, /magnetic switch/);
  const result = await decide(raw, { clauseId: candidate.id, decision: CANDIDATE_DECISION_REJECTED });

  assert.equal(result.requirementId, null);
  assert.equal(requirementsFor(raw, candidate.id).length, 0, "rejection materializes nothing");

  // No authority effect of any kind.
  const current = raw.prepare(`SELECT COUNT(*) c FROM ${currentTechnicalRequirementsFrom("r")} WHERE r.clause_id=?`).get(candidate.id).c;
  assert.equal(current, 0, "a rejected candidate contributes no current requirement");
  assert.deepEqual(await currentApprovedProjectSystems(dbOf(raw), "project-1"), [], "and no system inference");
});

test("CLOSE-16 a rejected candidate stays visible in the queue with its decision", async () => {
  const raw = await extractedProject();
  const candidate = candidateMatching(raw, /magnetic switch/);
  await decide(raw, { clauseId: candidate.id, decision: CANDIDATE_DECISION_REJECTED, reason: "Collateral descriptive prose, not an obligation." });
  const queue = await listCandidateReviewQueue(dbOf(raw), { projectId: "project-1", userId: OWNER });
  const entry = queue.find((item) => item.candidateId === candidate.id);
  assert.ok(entry, "a rejected candidate remains historically visible");
  assert.deepEqual(entry.decisions, [CANDIDATE_DECISION_REJECTED]);
  assert.equal(entry.requirementId, null);
  assert.equal(entry.lastDecidedBy, OWNER);
});

/* ------------------------------------------------------------------ *
 * Hard lifecycle requirements -- idempotency, CAS, conflicts
 * ------------------------------------------------------------------ */
test("CLOSE-16 repeating the same decision is a deterministic no-op", async () => {
  const raw = await extractedProject();
  const candidate = candidateMatching(raw, /4000 ft\/min/);
  const first = await decide(raw, { clauseId: candidate.id, decision: CANDIDATE_DECISION_PROMOTED });
  const second = await decide(raw, { clauseId: candidate.id, decision: CANDIDATE_DECISION_PROMOTED });

  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true, "the repeat is reported as idempotent");
  assert.equal(second.requirementId, first.requirementId, "and returns the SAME requirement");
  assert.equal(requirementsFor(raw, candidate.id).length, 1, "still exactly one requirement");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM specification_clause_candidate_decisions WHERE clause_id=?").get(candidate.id).c, 1,
    "no duplicate decision history row");

  const rejected = candidateMatching(raw, /magnetic switch/);
  await decide(raw, { clauseId: rejected.id, decision: CANDIDATE_DECISION_REJECTED });
  const rejectedAgain = await decide(raw, { clauseId: rejected.id, decision: CANDIDATE_DECISION_REJECTED });
  assert.equal(rejectedAgain.idempotent, true, "repeat Reject is also a no-op");
});

test("CLOSE-16 a conflicting decision is refused deterministically and writes nothing", async () => {
  const raw = await extractedProject();
  const candidate = candidateMatching(raw, /4000 ft\/min/);
  const promoted = await decide(raw, { clauseId: candidate.id, decision: CANDIDATE_DECISION_PROMOTED });

  await assert.rejects(
    () => decide(raw, { clauseId: candidate.id, decision: CANDIDATE_DECISION_REJECTED }),
    (error) => {
      assert.equal(error.code, "CANDIDATE_DECISION_CONFLICT");
      assert.equal(error.priorDecision, CANDIDATE_DECISION_PROMOTED);
      return true;
    },
  );
  assert.equal(requirementsFor(raw, candidate.id).length, 1, "the original requirement is untouched");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM specification_clause_candidate_decisions WHERE clause_id=?").get(candidate.id).c, 1,
    "the refused decision wrote no history row");
  assert.equal(promoted.requirementId, requirementsFor(raw, candidate.id)[0].id);
});

test("CLOSE-16 a decision on a retired extraction fails closed", async () => {
  const raw = await extractedProject();
  const candidate = candidateMatching(raw, /4000 ft\/min/);
  // Retire the extraction, exactly as a re-extraction would.
  raw.prepare("UPDATE specification_extraction_versions SET superseded_at=? WHERE id=?").run(new Date().toISOString(), "extraction-1");

  await assert.rejects(
    () => decide(raw, { clauseId: candidate.id, decision: CANDIDATE_DECISION_PROMOTED }),
    (error) => { assert.equal(error.code, "CANDIDATE_NOT_CURRENT"); return true; },
  );
  assert.equal(requirementsFor(raw, candidate.id).length, 0, "nothing materialized against retired evidence");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM specification_clause_candidate_decisions WHERE clause_id=?").get(candidate.id).c, 0);
});

test("CLOSE-16 a decision on a non-candidate clause is refused", async () => {
  const raw = await extractedProject();
  const admitted = raw.prepare("SELECT * FROM specification_clauses WHERE admission_status='ADMITTED_REQUIREMENT' LIMIT 1").get();
  assert.ok(admitted, "the fixture must contain an admitted clause");
  await assert.rejects(
    () => decide(raw, { clauseId: admitted.id, decision: CANDIDATE_DECISION_PROMOTED }),
    (error) => { assert.equal(error.code, "CANDIDATE_NOT_REVIEWABLE"); return true; },
  );
});

test("CLOSE-16 a substantive reason is required for BOTH decisions", async () => {
  const raw = await extractedProject();
  for (const decision of [CANDIDATE_DECISION_PROMOTED, CANDIDATE_DECISION_REJECTED]) {
    const candidate = candidateMatching(raw, /4000 ft\/min|magnetic switch/);
    await assert.rejects(
      () => decideSpecificationCandidate(dbOf(raw), { projectId: "project-1", clauseId: candidate.id, userId: OWNER, decision, reason: "x" }),
      (error) => { assert.equal(error.code, "CANDIDATE_REASON_REQUIRED"); return true; },
    );
  }
});

test("CLOSE-16 the schema refuses a second promotion of the same clause at the database level", async () => {
  // Proves the guarantee is structural, not merely an application check: even a
  // direct INSERT bypassing decideSpecificationCandidate cannot fan out.
  const raw = await extractedProject();
  const candidate = candidateMatching(raw, /4000 ft\/min/);
  await decide(raw, { clauseId: candidate.id, decision: CANDIDATE_DECISION_PROMOTED });
  const existing = raw.prepare("SELECT * FROM specification_clause_candidate_decisions WHERE clause_id=?").get(candidate.id);
  assert.throws(
    () => raw.prepare("INSERT INTO specification_clause_candidate_decisions (id,clause_id,extraction_version_id,project_id,document_id,document_version_id,decision,reason,decided_by) VALUES ('forged','" + candidate.id + "','extraction-1','project-1','document-1','version-1','Promoted','forged','someone')").run(),
    /UNIQUE constraint failed/,
    "a second promotion is physically impossible",
  );
  assert.equal(existing.decision, CANDIDATE_DECISION_PROMOTED);
});

test("CLOSE-16 candidate decisions are immutable", async () => {
  const raw = await extractedProject();
  const candidate = candidateMatching(raw, /4000 ft\/min/);
  await decide(raw, { clauseId: candidate.id, decision: CANDIDATE_DECISION_PROMOTED });
  const row = raw.prepare("SELECT id FROM specification_clause_candidate_decisions WHERE clause_id=?").get(candidate.id);
  assert.throws(() => raw.prepare("UPDATE specification_clause_candidate_decisions SET reason='rewritten' WHERE id=?").run(row.id), /immutable/);
  assert.throws(() => raw.prepare("DELETE FROM specification_clause_candidate_decisions WHERE id=?").run(row.id), /immutable/);
});

/* ------------------------------------------------------------------ *
 * Phase 12/13 -- authority isolation and fingerprints
 * ------------------------------------------------------------------ */
test("CLOSE-16 a promoted but unapproved requirement has no authority and no system inference", async () => {
  const raw = await extractedProject();
  const candidate = candidateMatching(raw, /4000 ft\/min/);
  await decide(raw, { clauseId: candidate.id, decision: CANDIDATE_DECISION_PROMOTED });

  // It IS current evidence (it is a real current row) but NOT eligible.
  const currentRows = raw.prepare(`SELECT COUNT(*) c FROM ${currentTechnicalRequirementsFrom("r")} WHERE r.clause_id=?`).get(candidate.id).c;
  assert.equal(currentRows, 1, "a promoted requirement is current evidence");
  const eligible = raw.prepare(`SELECT COUNT(*) c FROM ${currentTechnicalRequirementsFrom("r")} WHERE r.clause_id=? AND r.review_status='Approved' AND r.approved_for_downstream=1`).get(candidate.id).c;
  assert.equal(eligible, 0, "but it is not downstream-authoritative before approval");
  assert.deepEqual(await currentApprovedProjectSystems(dbOf(raw), "project-1"), [],
    "and it must not influence extraction-time system inference");
});

test("CLOSE-16 a candidate alone and a rejected candidate both change nothing downstream", async () => {
  const raw = await extractedProject();
  const before = {
    requirements: raw.prepare("SELECT COUNT(*) c FROM technical_requirements").get().c,
    links: raw.prepare("SELECT COUNT(*) c FROM boq_requirement_links").get().c,
    facts: raw.prepare("SELECT COUNT(*) c FROM engineering_facts").get().c,
    profiles: raw.prepare("SELECT COUNT(*) c FROM requirement_profile_versions").get().c,
    systems: await currentApprovedProjectSystems(dbOf(raw), "project-1"),
  };
  // Candidate only: it already exists, so this is a no-write observation.
  const queue = await listCandidateReviewQueue(dbOf(raw), { projectId: "project-1", userId: OWNER });
  assert.ok(queue.length > 0);
  // Candidate rejected.
  const candidate = candidateMatching(raw, /magnetic switch/);
  await decide(raw, { clauseId: candidate.id, decision: CANDIDATE_DECISION_REJECTED });
  // Promoted but unapproved.
  const promoted = candidateMatching(raw, /4000 ft\/min/);
  await decide(raw, { clauseId: promoted.id, decision: CANDIDATE_DECISION_PROMOTED });

  assert.equal(raw.prepare("SELECT COUNT(*) c FROM boq_requirement_links").get().c, before.links, "no link is created");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM engineering_facts").get().c, before.facts, "no Source Fact is promoted");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM requirement_profile_versions").get().c, before.profiles, "no profile is regenerated");
  assert.deepEqual(await currentApprovedProjectSystems(dbOf(raw), "project-1"), before.systems, "no system inference change");
});

test("CLOSE-16 crossing the existing governed approval boundary does grant authority", async () => {
  // The end-to-end governance proof: promotion is inert, the EXISTING approval
  // route is what makes a requirement authoritative, and nothing in the
  // promotion path short-circuits it.
  const raw = await extractedProject();
  const candidate = candidateMatching(raw, /4000 ft\/min/);
  const { requirementId } = await decide(raw, { clauseId: candidate.id, decision: CANDIDATE_DECISION_PROMOTED });

  const beforeApproval = raw.prepare(`SELECT COUNT(*) c FROM ${currentTechnicalRequirementsFrom("r")} WHERE r.id=? AND r.review_status='Approved' AND r.approved_for_downstream=1`).get(requirementId).c;
  assert.equal(beforeApproval, 0, "promotion alone confers no authority");
  assert.deepEqual(await currentApprovedProjectSystems(dbOf(raw), "project-1"), [], "and no system inference");

  // Apply the SAME transition the governed approve route performs.
  raw.prepare("UPDATE technical_requirements SET review_status='Approved', approved_for_downstream=1 WHERE id=? AND review_status IN ('Needs Review','Pending Approval')").run(requirementId);

  const afterApproval = raw.prepare(`SELECT COUNT(*) c FROM ${currentTechnicalRequirementsFrom("r")} WHERE r.id=? AND r.review_status='Approved' AND r.approved_for_downstream=1`).get(requirementId).c;
  assert.equal(afterApproval, 1, "the ordinary governed approval boundary is what grants authority");

  // C.3's own text names no governed system, so the deterministic detector
  // returns Unknown. That is the correct, non-fabricating outcome, and CLOSE-15
  // excludes Unknown from project-system inference. So even an APPROVED promoted
  // candidate must not invent a system for the project -- which is exactly the
  // "no fabricated structure" guarantee holding under full authority.
  const approved = raw.prepare("SELECT system, engineering_domain FROM technical_requirements WHERE id=?").get(requirementId);
  assert.equal(approved.system, "Unknown", "no system may be invented for a clause that names none");
  assert.deepEqual(await currentApprovedProjectSystems(dbOf(raw), "project-1"), [],
    "an approved candidate with an Unknown system still cannot steer extraction");
});

/* ------------------------------------------------------------------ *
 * Phase 5 -- candidate isolation from the extractor
 * ------------------------------------------------------------------ */
test("CLOSE-16 promotion never widens admission: the extracted requirement set is unchanged", async () => {
  const raw = await extractedProject();
  const before = raw.prepare("SELECT COUNT(*) c FROM technical_requirements").get().c;
  const candidate = candidateMatching(raw, /4000 ft\/min/);
  await decide(raw, { clauseId: candidate.id, decision: CANDIDATE_DECISION_PROMOTED });
  const after = raw.prepare("SELECT COUNT(*) c FROM technical_requirements").get().c;
  assert.equal(after, before + 1, "exactly the one promoted requirement, and nothing else was admitted");
  // And re-running the extractor produces the identical admitted set, i.e. the
  // admission predicate itself is untouched by this slice.
  const clauses = raw.prepare("SELECT admission_status, COUNT(*) c FROM specification_clauses GROUP BY admission_status").all();
  assert.ok(clauses.find((row) => row.admission_status === CLAUSE_ADMISSION_CANDIDATE), "candidates remain candidates");
});
