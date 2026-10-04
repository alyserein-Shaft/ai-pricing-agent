/**
 * GOLDEN-6C3A1 -- Governed current addressability clause review & supersession
 * resolution.
 *
 * THE BLOCKER THIS SUITE RESOLVES
 * -------------------------------
 * The three system-level addressability clauses on the acceptance project were
 * Approved against extraction version 2. Extraction version 3 re-issued them and
 * they are back to `Needs Review`. GOLDEN-6C3A therefore sees no governed
 * addressability evidence and every population is INSUFFICIENT.
 *
 * The tempting shortcut is to treat "same text, same document, previously
 * approved" as approval. This suite exists to prove that shortcut is wrong, and
 * to prove what IS true instead: CURRENT + governed beats SUPERSEDED +
 * previously Approved, and the only legitimate route from the blocked state to
 * a governing clause is the repository's own review workflow, acting on the
 * CURRENT row.
 *
 * WHAT IS PROVEN HERE
 * -------------------
 *   Part A  The clause adapter reads the clause's PREDICATE, not the word
 *           "addressable", and compares versions field by field.
 *   Part B  A real-schema disposable database, built from the ACTIVE migration
 *           chain, driven through the ACTUAL worker review handler: a
 *           superseded-but-Approved clause does not govern; a current-but-
 *           unreviewed clause does not govern; reviewing the superseded row is
 *           refused; reviewing the current row is recorded and audited; only
 *           then does GOLDEN-6C3A -- re-run UNCHANGED -- attach anything.
 *   Part C  Reviewing a clause that says something other than "shall be
 *           addressable" attaches nothing. Approval alone fabricates no points
 *           and selects no ecosystem.
 *   Part D  The negatives, stated as executable assertions.
 *
 * :memory: only. No Golden, no canonical D1, no migration is applied anywhere
 * configured, and the live project database is never opened by this file.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { handleSpecificationExtractionApi } from "../worker/specification-extraction-api.mjs";
import { currentTechnicalRequirementsFrom } from "../worker/current-evidence-scope.mjs";
import {
  buildAddressabilityClauseEvidence,
  classifyAddressabilityClauseObligation,
  findObligationWeakening,
  readScopeQualifiers,
  semanticCompareRequirementVersions,
} from "../app/domain/fire-alarm-addressability-clause-evidence.mjs";
import { planAddressabilityAttachments } from "../app/domain/fire-alarm-addressability-applicability.mjs";
import {
  buildDeviceInventoryRecord,
  aggregatePreliminaryPointDemand,
} from "../app/domain/fire-alarm-preliminary-point-demand.mjs";

// The owner of the disposable project. The authority question ("what minimum
// authority may review a requirement?") is answered by the traced handler
// boundary -- a server-resolved project identity, not a client-supplied role --
// so the fixture uses the project owner rather than asserting a hardcoded
// privileged actor.
const OWNER = "local-development-user";
const REASON = "GOLDEN-6C3A1: verified the current clause against its governing source page.";

// ---------------------------------------------------------------------------
// Real-schema disposable database. Built by applying the ACTIVE migration
// chain, so a drift in the real schema cannot be hidden by a drift here.
// ---------------------------------------------------------------------------
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

const post = (target, path, body) =>
  handleSpecificationExtractionApi(
    new Request(`https://app.example${path}`, { method: "POST", body: JSON.stringify(body) }),
    env(target),
    ctx,
  );

// ---------------------------------------------------------------------------
// Fixture clauses, transcribed from the live acceptance project's own recorded
// raw source text (`source_location.originalClauseText` of the current
// extraction). Using the real clause shapes is the point: the adapter must
// distinguish an addressability obligation from three neighbouring obligations
// that all happen to contain the same vocabulary.
// ---------------------------------------------------------------------------
// Keyed by the real `technical_requirements` column names, so a clause is
// compared exactly as the extractor recorded it -- no adapter-shaped aliases.
const CLAUSES = {
  systemAddressable: {
    original_text:
      "The fire detection and alarm system shall be addressable and utilize microprocessor technology to facilitate early detection and provide timely warnings in the event of a fire.",
    normalized_requirement:
      "the fire detection and alarm system shall be addressable and utilize microprocessor technology to facilitate early detection and provide timely warnings in the event of a fire",
    category: "Other",
    requirement_category: "Other",
    system: "Fire Alarm",
    requirement_type: "Mandatory",
    source_location: JSON.stringify({
      pageFrom: 4,
      pageTo: 4,
      section: "28 46 00 SECTION 28 46 00",
      clause: "B",
      clausePath: ["28 46 00 SECTION 28 46 00", "1 GENERAL"],
      originalClauseText:
        "The fire detection and alarm system shall be addressable and utilize microprocessor technology to facilitate early detection and provide timely warnings in the event of a fire.",
    }),
  },
  supplyAndInstall: {
    original_text:
      "All components, including addressable smoke detectors, multi-sensors, duct detectors, heat detectors, line powered isolators, alarm signaling devices, sounders, wiring, terminations, electrical enclosures, and any other materials required for a fully functional system, shall be provided, wired, connected and left in full operational condition.",
    normalized_requirement:
      "all components including addressable smoke detectors multi sensors duct detectors heat detectors line powered isolators alarm signaling devices sounders wiring terminations electrical enclosures and any other materials required for a fully functional system shall be provided wired connected and left in full operational condition",
    category: "Installation",
    requirement_category: "Installation",
    system: "Fire Alarm",
    requirement_type: "Mandatory",
    source_location: null,
  },
  digitalNetwork: {
    original_text:
      "The wiring for detection circuits, alarm devices, and the main loop of the addressable fire alarm system shall form a digital data network.",
    normalized_requirement:
      "the wiring for detection circuits alarm devices and the main loop of the addressable fire alarm system shall form a digital data network",
    category: "Network",
    requirement_category: "Network",
    system: "Fire Alarm",
    requirement_type: "Mandatory",
    source_location: null,
  },
  productFeature: {
    original_text:
      "Features: a) UL 268 listed b) Individually addressable devices c) FlashScan compatible d) Backplate and mounting bracket supplied e) Compatible with addressable devices on the same loop.",
    normalized_requirement:
      "features a ul 268 listed b individually addressable devices c flashscan compatible d backplate and mounting bracket supplied e compatible with addressable devices on the same loop",
    category: "Compliance",
    requirement_category: "Compliance",
    system: "Electrical",
    requirement_type: "Mandatory",
    source_location: null,
  },
  deviceClassAddressable: {
    original_text:
      "The multi criteria fire and CO detector is a plug-in, addressable device providing comprehensive fire and carbon monoxide detection.",
    normalized_requirement:
      "the multi criteria fire and co detector is a plug in addressable device providing comprehensive fire and carbon monoxide detection",
    category: "Other",
    requirement_category: "Other",
    system: "Unknown",
    requirement_type: "Mandatory",
    source_location: null,
  },
};

const REQUIREMENT_COLUMNS =
  "id, extraction_version_id, project_id, source_document_id, clause_id, sequence, source_revision, original_text, normalized_requirement, engineering_domain, domain_source_type, system, category, subcategory, requirement_type, requirement_category, condition, exception, confidence, confidence_state, review_status, extraction_method, parser_version, model_version, source_location, original_values, current_values, approved_for_downstream";

const PLACEHOLDERS = REQUIREMENT_COLUMNS.split(",").map(() => "?").join(", ");

const SOURCE_LOCATION = (clause) =>
  JSON.stringify({
    pageFrom: 4,
    pageTo: 4,
    section: "28 46 00 SECTION 28 46 00",
    article: "B",
    clause: "B",
    clausePath: ["28 46 00 SECTION 28 46 00", "1 GENERAL", clause],
    originalClauseText: clause,
  });

const requirementRow = ({ id, extractionVersionId, specJob, sequence, clause, reviewStatus, approvedForDownstream = 0, clauseNo = "clause_2" }) => [
  id,
  extractionVersionId,
  "p1",
  "d1",
  `${specJob}_chunk_000001_${clauseNo}`,
  sequence,
  "Rev 1",
  clause.original_text,
  clause.normalized_requirement,
  "Fire Alarm",
  "Specification",
  clause.system ?? "Fire Alarm",
  clause.category,
  null,
  clause.requirement_type ?? "Mandatory",
  clause.requirement_category,
  null,
  null,
  0.95,
  "High",
  reviewStatus,
  "Deterministic",
  "parser-v1",
  "model-v1",
  clause.source_location ?? SOURCE_LOCATION(clause.original_text),
  "{}",
  "{}",
  approvedForDownstream,
];

/**
 * The disposable chain: one document, one in-force document version, two
 * extraction versions (2 superseded, 3 current), and the three clauses that
 * were Approved on version 2 and re-issued unreviewed on version 3.
 */
const seed = () => {
  const raw = activeDatabase();
  const insert = (sql, ...values) => raw.prepare(sql).run(...values);
  insert("INSERT INTO organizations (id, name) VALUES ('org', 'Org')");
  insert("INSERT INTO projects (id, name, owner_user_id, organization_id) VALUES ('p1', 'Clause review', ?, 'org')", OWNER);
  insert("INSERT INTO documents (id, project_id, logical_name, created_by) VALUES ('d1', 'p1', '28 46 00 Fire Detection and Alarm System - Rev 1.pdf', ?)", OWNER);
  insert(
    "INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, effective_from, uploaded_by) VALUES ('v1', 'd1', 1, 'spec.pdf', 'spec.stored', 'pdf', 'application/pdf', 4, 'sum1', 'projects/spec.pdf', '2026-01-01', ?)",
    OWNER,
  );
  insert("UPDATE documents SET current_version_id='v1' WHERE id='d1'");
  const extraction = (id, versionNumber, supersededAt) =>
    insert(
      "INSERT INTO specification_extraction_versions (id, document_id, document_version_id, version_number, status, superseded_at, parser_version, ruleset_version, model_version, prompt_version, ocr_version, created_by) VALUES (?, 'd1', 'v1', ?, 'Completed', ?, 'p', 'r', 'm', 'pr', 'o', ?)",
      id,
      versionNumber,
      supersededAt,
      OWNER,
    );
  extraction("e-v2", 2, "2026-09-20T14:01:22.752Z");
  extraction("e-v3", 3, null);

  // `technical_requirements.clause_id` is a real foreign key into
  // `specification_clauses`, so the clauses are seeded as first-class rows and
  // the requirements reference them, exactly as the live corpus is shaped.
  const clauseRow = (id, extractionVersionId, sequence, clause) =>
    insert(
      "INSERT INTO specification_clauses (id, extraction_version_id, sequence, kind, number, title, page_from, page_to, path, original_text) VALUES (?, ?, ?, 'Requirement', 'B', '28 46 00', 4, 4, ?, ?)",
      id,
      extractionVersionId,
      sequence,
      "28 46 00 SECTION 28 46 00 > 1 GENERAL",
      clause.original_text,
    );

  const clause = (id, extractionVersionId, specJob, sequence, spec, reviewStatus, approvedForDownstream, clauseNo) => {
    const clauseId = `${specJob}_chunk_000001_${clauseNo}`;
    clauseRow(clauseId, extractionVersionId, sequence, spec);
    insert(
      `INSERT INTO technical_requirements (${REQUIREMENT_COLUMNS}) VALUES (${PLACEHOLDERS})`,
      ...requirementRow({ id, extractionVersionId, specJob, sequence, clause: spec, reviewStatus, approvedForDownstream, clauseNo }),
    );
  };

  // Version 2: Approved and approved for downstream -- the historical state that
  // makes the naive carry-forward so tempting.
  clause("r-v2-53", "e-v2", "specjob_v2", 53, CLAUSES.systemAddressable, "Approved", 1, "clause_2");
  clause("r-v2-74", "e-v2", "specjob_v2", 74, CLAUSES.supplyAndInstall, "Approved", 1, "clause_82");
  clause("r-v2-442", "e-v2", "specjob_v2", 442, CLAUSES.digitalNetwork, "Approved", 1, "clause_9");

  // Version 3: the same clauses, re-issued, back to unreviewed.
  clause("r-v3-53", "e-v3", "specjob_v3", 53, CLAUSES.systemAddressable, "Needs Review", 0, "clause_2");
  clause("r-v3-74", "e-v3", "specjob_v3", 74, CLAUSES.supplyAndInstall, "Needs Review", 0, "clause_82");
  clause("r-v3-442", "e-v3", "specjob_v3", 442, CLAUSES.digitalNetwork, "Needs Review", 0, "clause_9");

  // Neighbouring obligations, only ever present on the current extraction.
  clause("r-v3-197", "e-v3", "specjob_v3", 197, CLAUSES.productFeature, "Approved", 1, "clause_5");
  clause("r-v3-181", "e-v3", "specjob_v3", 181, CLAUSES.deviceClassAddressable, "Needs Review", 0, "clause_3");
  return raw;
};

/** Canonical currency, read through the repository's own authority. */
const currencyOf = (raw, id) => {
  const row = raw
    .prepare(
      `SELECT r.review_status, r.approved_for_downstream, e.superseded_at,
              (SELECT 1 FROM (${currentTechnicalRequirementsFrom("r")}) cur WHERE cur.id = r.id) AS is_current
         FROM technical_requirements r
         JOIN specification_extraction_versions e ON e.id = r.extraction_version_id
        WHERE r.id = ?`,
    )
    .get(id);
  return {
    isCurrent: row.is_current === 1,
    supersededAt: row.superseded_at,
    reviewStatus: row.review_status,
    approvedForDownstream: row.approved_for_downstream,
  };
};

/** The clause corpus the adapter feeds to GOLDEN-6C3A, eligibility included. */
const evidencesFrom = (raw, ids) =>
  ids.map((id) => {
    const row = raw.prepare("SELECT * FROM technical_requirements WHERE id = ?").get(id);
    return buildAddressabilityClauseEvidence(row, { currency: currencyOf(raw, id) });
  });

/**
 * Device populations, shaped as the acceptance project's own governed census:
 * a field device, control equipment, a NAC notification appliance, a device
 * whose governed family is UNKNOWN, and a population with no drawing scope.
 * Values are fixtures; no population is invented by the code under test.
 */
const POPULATIONS = [
  { id: "pop-mcp", family: "Multi-Criteria Point Detector", deviceClass: "FIELD_DEVICE", system: "Fire Alarm", drawingScope: { sheets: [], symbols: [] } },
  { id: "pop-heat", family: "Conventional Heat Detector", deviceClass: "FIELD_DEVICE", system: "Fire Alarm", drawingScope: { sheets: [], symbols: [] } },
  { id: "pop-facp", family: "Fire Alarm Control Panel", deviceClass: "CONTROL_EQUIPMENT", system: "Fire Alarm", drawingScope: { sheets: [], symbols: [] } },
  { id: "pop-strobe", family: "Strobe", deviceClass: "NOTIFICATION_APPLIANCE", system: "Fire Alarm", drawingScope: { sheets: [], symbols: [] } },
  { id: "pop-unknown", family: null, deviceClass: null, system: "Fire Alarm", drawingScope: { sheets: [], symbols: [] } },
];

const planFor = (evidences, populations = POPULATIONS, existingAttachments = []) =>
  planAddressabilityAttachments({ evidences, populations, existingAttachments });

const ruleIdsFor = (plan, evidenceId) =>
  plan.classifications.filter((c) => c.evidenceId === evidenceId).map((c) => `${c.populationId}:${c.status}:${c.ruleId}`);

// ===========================================================================
// PART A -- the clause adapter reads the predicate, not the vocabulary.
// ===========================================================================

test("A1 the presence of the word 'addressable' is not an addressability obligation", () => {
  assert.equal(classifyAddressabilityClauseObligation(CLAUSES.systemAddressable).obligation, "SYSTEM_SHALL_BE_ADDRESSABLE");
  assert.equal(classifyAddressabilityClauseObligation(CLAUSES.supplyAndInstall).obligation, "SUPPLY_AND_INSTALLATION");
  assert.equal(classifyAddressabilityClauseObligation(CLAUSES.digitalNetwork).obligation, "DIGITAL_DATA_NETWORK");
  assert.equal(classifyAddressabilityClauseObligation(CLAUSES.productFeature).obligation, "PRODUCT_FEATURE");
  assert.equal(classifyAddressabilityClauseObligation(CLAUSES.deviceClassAddressable).obligation, "DEVICE_CLASS_ADDRESSABILITY");

  // Every one of those five clauses contains "addressable". Exactly two of them
  // impose an addressability obligation, and only one of the two is
  // system-wide. The other three are supply, wiring and product data.
  for (const clause of Object.values(CLAUSES)) {
    assert.match(clause.original_text, /addressab/i, "fixture precondition: the clause does contain the vocabulary");
  }
  assert.equal(classifyAddressabilityClauseObligation(CLAUSES.systemAddressable).isAddressabilityObligation, true);
  assert.equal(classifyAddressabilityClauseObligation(CLAUSES.supplyAndInstall).isAddressabilityObligation, false);
  assert.equal(classifyAddressabilityClauseObligation(CLAUSES.digitalNetwork).isAddressabilityObligation, false);
  assert.equal(classifyAddressabilityClauseObligation(CLAUSES.productFeature).isAddressabilityObligation, false);
});

test("A2 'shall be addressable' weakened to 'may be addressable' is a semantic change, never an equivalence", () => {
  const weakened = {
    original_text: "The fire detection and alarm system may be addressable and utilize microprocessor technology.",
    normalized_requirement: "the fire detection and alarm system may be addressable and utilize microprocessor technology",
  };
  assert.deepEqual(findObligationWeakening(weakened.original_text).map((entry) => entry.id), ["MAY_BE_ADDRESSABLE"]);
  assert.deepEqual(findObligationWeakening(CLAUSES.systemAddressable.original_text), []);
  const comparison = semanticCompareRequirementVersions(
    { ...CLAUSES.systemAddressable },
    { ...CLAUSES.systemAddressable, ...weakened },
  );
  assert.equal(comparison.comparison, "SEMANTICALLY_CHANGED");
  assert.equal(comparison.textChanged, true);
});

test("A3 a narrowed or broadened scope, and a changed obligation, each require a fresh review", () => {
  const narrowed = semanticCompareRequirementVersions(CLAUSES.systemAddressable, {
    ...CLAUSES.systemAddressable,
    original_text: "All initiating devices in the fire detection and alarm system shall be addressable.",
    normalized_requirement: "all initiating devices in the fire detection and alarm system shall be addressable",
  });
  assert.equal(narrowed.comparison, "SEMANTICALLY_NARROWER");
  assert.deepEqual(narrowed.currentQualifiers.includes("INITIATING_DEVICES"), true);

  const broadened = semanticCompareRequirementVersions(CLAUSES.systemAddressable, {
    ...CLAUSES.systemAddressable,
    original_text: "The fire detection and alarm system shall be addressable including all field devices, modules and detectors.",
  });
  assert.equal(broadened.comparison, "SEMANTICALLY_NARROWER", "an added scope qualifier narrows what the clause reaches even as its wording grows");
  assert.deepEqual(broadened.currentQualifiers.includes("FIELD_DEVICES"), true);

  // Losing the addressability obligation obliges LESS about addressability, so
  // the replacement clause is NARROWER -- not "broader because it says more".
  const lostObligation = semanticCompareRequirementVersions(CLAUSES.systemAddressable, CLAUSES.supplyAndInstall);
  assert.equal(lostObligation.comparison, "SEMANTICALLY_NARROWER");
  assert.equal(lostObligation.obligationChanged, true);
  assert.equal(lostObligation.priorObligation.isAddressabilityObligation, true);
  assert.equal(lostObligation.currentObligation.isAddressabilityObligation, false);

  // Gaining it, from a non-addressability predecessor, broadens.
  const gainedObligation = semanticCompareRequirementVersions(CLAUSES.supplyAndInstall, CLAUSES.systemAddressable);
  assert.equal(gainedObligation.comparison, "SEMANTICALLY_BROADER");

  // A network clause replacing a system addressability obligation is a change
  // of subject, and is never reported as an equivalence either way.
  const obligationSwap = semanticCompareRequirementVersions(CLAUSES.systemAddressable, CLAUSES.digitalNetwork);
  assert.equal(obligationSwap.comparison, "SEMANTICALLY_NARROWER");
  assert.equal(obligationSwap.priorObligation.obligation, "SYSTEM_SHALL_BE_ADDRESSABLE");
  assert.equal(obligationSwap.currentObligation.obligation, "DIGITAL_DATA_NETWORK");

  const changedScope = semanticCompareRequirementVersions(CLAUSES.systemAddressable, { ...CLAUSES.systemAddressable, system: "Security" });
  assert.equal(changedScope.comparison, "SEMANTICALLY_CHANGED");
  assert.deepEqual(changedScope.scopeChangedFields, ["system"]);
  assert.equal(changedScope.scopePreserved, false);
});

test("A4 an identical re-issue compares SEMANTICALLY_EQUIVALENT, and an empty prior compares INSUFFICIENT", () => {
  const identical = semanticCompareRequirementVersions(CLAUSES.systemAddressable, CLAUSES.systemAddressable);
  assert.equal(identical.comparison, "SEMANTICALLY_EQUIVALENT");
  assert.deepEqual(identical.changedFields, []);
  assert.equal(identical.sourceLocationIdentical, true);

  const unknown = semanticCompareRequirementVersions(null, CLAUSES.systemAddressable);
  assert.equal(unknown.comparison, "INSUFFICIENT_TO_COMPARE", "a comparison with no prior version can never certify equivalence");
  // An empty predecessor obliges nothing about addressability, so a real
  // addressability clause in its place obliges more: BROADER, still not equal.
  const emptyPrior = semanticCompareRequirementVersions({ ...CLAUSES.systemAddressable, original_text: "", normalized_requirement: "" }, CLAUSES.systemAddressable);
  assert.equal(emptyPrior.comparison, "SEMANTICALLY_BROADER");
  assert.notEqual(emptyPrior.comparison, "SEMANTICALLY_EQUIVALENT", "an empty prior clause is a change, not an equivalence");
});

test("A5 an equivalent comparison yields a recommendation; it never yields an approval", () => {
  const prior = { ...CLAUSES.systemAddressable, id: "r-v2-53" };
  const current = { ...CLAUSES.systemAddressable, id: "r-v3-53" };
  const comparison = semanticCompareRequirementVersions(prior, current);
  assert.equal(comparison.comparison, "SEMANTICALLY_EQUIVALENT");
  // The recommendation vocabulary is a fixed, closed set; a comparison never
  // smuggles an action out of it.
  for (const key of ["priorObligation", "currentObligation", "currentQualifiers", "obligationWeakening"]) {
    assert.ok(key in comparison, `comparison carries ${key} for the reviewer`);
  }
  assert.equal(comparison.currentObligation.isAddressabilityObligation, true);
  assert.equal(readScopeQualifiers(CLAUSES.systemAddressable.original_text).length, 0, "the clause itself declares no narrowing scope qualifier");
});

// ===========================================================================
// PART B -- the disposable real-schema runtime proof of the governance rule.
// ===========================================================================

test("B1 the disposable chain reproduces the live blocker: superseded Approved, current unreviewed", () => {
  const raw = seed();
  try {
    const superseded = currencyOf(raw, "r-v2-53");
    assert.equal(superseded.isCurrent, false, "version 2's extraction is superseded");
    assert.equal(superseded.reviewStatus, "Approved");
    assert.equal(superseded.approvedForDownstream, 1);

    const current = currencyOf(raw, "r-v3-53");
    assert.equal(current.isCurrent, true, "version 3's extraction is current");
    assert.equal(current.reviewStatus, "Needs Review");
    assert.equal(current.approvedForDownstream, 0);
  } finally {
    raw.close();
  }
});

test("B2 a superseded, previously Approved clause does not govern anything", () => {
  const raw = seed();
  try {
    const plan = planFor(evidencesFrom(raw, ["r-v2-53", "r-v2-74", "r-v2-442"]));
    assert.equal(plan.attachmentsToCreate.length, 0, "a stronger prior review status does not revive superseded evidence");
    for (const entry of plan.classifications) {
      assert.equal(entry.status, "NOT_APPLICABLE");
      assert.equal(entry.ruleId, "RULE_2_EVIDENCE_NOT_CURRENT", "the refusal is currency, not eligibility");
    }
  } finally {
    raw.close();
  }
});

test("B3 the current, unreviewed clause does not govern anything either", () => {
  const raw = seed();
  try {
    const plan = planFor(evidencesFrom(raw, ["r-v3-53", "r-v3-74", "r-v3-442"]));
    assert.equal(plan.attachmentsToCreate.length, 0);
    for (const entry of plan.classifications) {
      assert.equal(entry.status, "NOT_APPLICABLE");
      assert.equal(entry.ruleId, "RULE_1_EVIDENCE_NOT_ELIGIBLE", "the refusal is the missing review, not the text");
    }
  } finally {
    raw.close();
  }
});

test("B4 same source document, same wording, newer extraction still needs current governance", async () => {
  const raw = seed();
  try {
    const identical = raw
      .prepare("SELECT original_text, normalized_requirement, source_document_id FROM technical_requirements WHERE id='r-v2-53'")
      .get();
    const currentText = raw
      .prepare("SELECT original_text, normalized_requirement, source_document_id FROM technical_requirements WHERE id='r-v3-53'")
      .get();
    assert.deepEqual({ ...currentText }, { ...identical }, "the re-issue is byte-identical and comes from the same document");

    const before = planFor(evidencesFrom(raw, ["r-v3-53"]));
    assert.equal(before.attachmentsToCreate.length, 0, "identical text does not bypass version governance");

    await post(raw, "/api/requirements/r-v3-53/approve", { reason: REASON });
    const after = planFor(evidencesFrom(raw, ["r-v3-53"]));
    assert.ok(after.attachmentsToCreate.length > 0, "only the governed review of the CURRENT row changes the outcome");
  } finally {
    raw.close();
  }
});

test("B5 reviewing the superseded row is refused, and mutates nothing", async () => {
  const raw = seed();
  try {
    const response = await post(raw, "/api/requirements/r-v2-53/approve", { reason: REASON });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "REQUIREMENT_NOT_CURRENT");

    const row = raw.prepare("SELECT review_status, approved_for_downstream FROM technical_requirements WHERE id='r-v2-53'").get();
    assert.deepEqual({ ...row }, { review_status: "Approved", approved_for_downstream: 1 }, "the refused write left the historical row exactly as it was");
    assert.equal(raw.prepare("SELECT COUNT(*) c FROM requirement_review_decisions WHERE requirement_id='r-v2-53'").get().c, 0);
    assert.equal(raw.prepare("SELECT COUNT(*) c FROM document_audit_events WHERE action='Requirement approve'").get().c, 0);
  } finally {
    raw.close();
  }
});

test("B6 the current clause passes the real review workflow, and the decision is recorded and audited", async () => {
  const raw = seed();
  try {
    const response = await post(raw, "/api/requirements/r-v3-53/approve", { reason: REASON });
    assert.equal(response.status, 200);

    const row = raw.prepare("SELECT review_status, approved_for_downstream FROM technical_requirements WHERE id='r-v3-53'").get();
    assert.deepEqual({ ...row }, { review_status: "Approved", approved_for_downstream: 1 });

    const decision = raw.prepare("SELECT action, reason, decided_by FROM requirement_review_decisions WHERE requirement_id='r-v3-53'").get();
    assert.equal(decision.action, "approve");
    assert.equal(decision.reason, REASON, "the governed reason is preserved verbatim");
    // Human-actor attribution: server-configured human quoted; OWNER keeps
    // ownership. See tests/human-actor-attribution.test.mjs.
    assert.equal(decision.decided_by, "op-test-human-01");
    assert.equal(raw.prepare("SELECT COUNT(*) c FROM document_audit_events WHERE action='Requirement approve'").get().c, 1);
  } finally {
    raw.close();
  }
});

test("B7 only the CURRENT governed evidence participates, and GOLDEN-6C3A re-runs unchanged", async () => {
  const raw = seed();
  try {
    const all = ["r-v2-53", "r-v2-74", "r-v2-442", "r-v3-53", "r-v3-74", "r-v3-442"];

    const before = planFor(evidencesFrom(raw, all));
    assert.equal(before.attachmentsToCreate.length, 0);
    assert.equal(before.classifications.length, all.length * POPULATIONS.length, "every pair is still decided, not skipped");

    await post(raw, "/api/requirements/r-v3-53/approve", { reason: REASON });

    const after = planFor(evidencesFrom(raw, all));
    const governed = after.classifications.filter((c) => c.status === "CONFIRMED_APPLICABLE");
    assert.ok(governed.length > 0, "the reviewed current clause now governs field-device populations");
    for (const entry of governed) {
      assert.equal(entry.evidenceId, "spec-requirement:r-v3-53", "only the current, reviewed clause governs");
      assert.equal(entry.ruleId, "RULE_17_APPROVED_SYSTEM_WIDE_REQUIREMENT");
      assert.ok(["pop-mcp", "pop-heat"].includes(entry.populationId), "a system-wide clause reaches field devices only");
    }
    // The superseded clauses are still present in the plan and still refused.
    for (const id of ["spec-requirement:r-v2-53", "spec-requirement:r-v2-74", "spec-requirement:r-v2-442"]) {
      assert.ok(after.classifications.some((c) => c.evidenceId === id && c.status === "NOT_APPLICABLE"), `${id} remains refused`);
    }
    // The current-but-unreviewed clauses are still refused on eligibility.
    for (const id of ["spec-requirement:r-v3-74", "spec-requirement:r-v3-442"]) {
      assert.ok(after.classifications.some((c) => c.evidenceId === id && c.ruleId === "RULE_1_EVIDENCE_NOT_ELIGIBLE"));
    }
  } finally {
    raw.close();
  }
});

test("B8 reviewing all three current clauses attaches to field devices only, and never to a panel or a NAC", async () => {
  const raw = seed();
  try {
    for (const id of ["r-v3-53", "r-v3-74", "r-v3-442"]) await post(raw, `/api/requirements/${id}/approve`, { reason: REASON });
    const plan = planFor(evidencesFrom(raw, ["r-v3-53", "r-v3-74", "r-v3-442"]));

    // Only the system addressability obligation can attach; the supply clause
    // and the network clause are governed, approved, current -- and still inert.
    const attached = [...new Set(plan.attachmentsToCreate.map((a) => a.evidenceId))];
    assert.deepEqual(attached, ["spec-requirement:r-v3-53"]);

    assert.deepEqual(ruleIdsFor(plan, "spec-requirement:r-v3-74"), POPULATIONS.map((p) => `${p.id}:NOT_APPLICABLE:RULE_3_NO_DEVICE_ADDRESSABILITY_CLAIM`));
    assert.deepEqual(ruleIdsFor(plan, "spec-requirement:r-v3-442"), POPULATIONS.map((p) => `${p.id}:NOT_APPLICABLE:RULE_5_NETWORK_ARCHITECTURE_NOT_DEVICE_EVIDENCE`));

    assert.ok(ruleIdsFor(plan, "spec-requirement:r-v3-53").includes("pop-facp:NOT_APPLICABLE:RULE_15_DEVICE_CLASS_NOT_COVERED"), "control equipment is out of reach");
    assert.ok(ruleIdsFor(plan, "spec-requirement:r-v3-53").includes("pop-strobe:NOT_APPLICABLE:RULE_15_DEVICE_CLASS_NOT_COVERED"), "NAC notification appliances are out of reach");
    assert.ok(ruleIdsFor(plan, "spec-requirement:r-v3-53").includes("pop-unknown:INSUFFICIENT_EVIDENCE:RULE_16_DEVICE_CLASS_UNKNOWN"), "an ungoverned family stays insufficient, which is GOLDEN-6C3B's work");
    assert.equal(plan.attachmentsToCreate.length, 2, "exactly the two governed field-device populations");
  } finally {
    raw.close();
  }
});

test("B9 the planner is idempotent: re-running over existing attachments creates nothing new", async () => {
  const raw = seed();
  try {
    await post(raw, "/api/requirements/r-v3-53/approve", { reason: REASON });
    const evidences = evidencesFrom(raw, ["r-v3-53", "r-v2-53"]);
    const first = planFor(evidences);
    const second = planFor(evidences, POPULATIONS, first.attachmentsToCreate);
    assert.equal(second.attachmentsToCreate.length, 0);
    assert.equal(second.confirmedPairs, first.confirmedPairs, "the decisions themselves are unchanged by the replay");
  } finally {
    raw.close();
  }
});

test("B10 a review replay changes no governed state, and the replay is itself audited", async () => {
  const raw = seed();
  try {
    assert.equal((await post(raw, "/api/requirements/r-v3-53/approve", { reason: REASON })).status, 200);
    const before = { ...raw.prepare("SELECT review_status, approved_for_downstream FROM technical_requirements WHERE id='r-v3-53'").get() };
    const attachmentsBefore = planFor(evidencesFrom(raw, ["r-v3-53"])).attachmentsToCreate.length;

    // The traced handler treats a repeat approve -- where the observed status
    // already equals the new status -- as an intentional no-op, not an error.
    // That is the real contract, read from the implementation rather than
    // assumed. What matters is that the replay is STATE-idempotent while
    // remaining VISIBLE: a silent no-op would be indistinguishable from a lost
    // decision, so the replay records its own decision and audit event.
    const replay = await post(raw, "/api/requirements/r-v3-53/approve", { reason: `${REASON} (replay)` });
    assert.equal(replay.status, 200);
    const after = raw.prepare("SELECT review_status, approved_for_downstream FROM technical_requirements WHERE id='r-v3-53'").get();
    assert.deepEqual({ ...after }, before, "a replay leaves the governed state byte-identical");
    assert.equal(planFor(evidencesFrom(raw, ["r-v3-53"])).attachmentsToCreate.length, attachmentsBefore, "and decides no applicability differently");

    const decisions = raw.prepare("SELECT action, reason FROM requirement_review_decisions WHERE requirement_id='r-v3-53' ORDER BY decided_at").all();
    assert.equal(decisions.length, 2, "both decisions are recorded, including the idempotent replay");
    assert.equal(decisions[1].reason, `${REASON} (replay)`, "the replay's own reason is preserved verbatim");
    assert.equal(
      raw.prepare("SELECT COUNT(*) c FROM document_audit_events WHERE action='Requirement approve'").get().c,
      2,
      "and the replay is audited, so a repeat call is never invisible",
    );
  } finally {
    raw.close();
  }
});

test("B11 a reason is mandatory; an empty review reason is refused before anything is written", async () => {
  const raw = seed();
  try {
    const response = await post(raw, "/api/requirements/r-v3-53/approve", { reason: "   " });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, "REVIEW_REASON_REQUIRED");
    assert.equal(raw.prepare("SELECT review_status FROM technical_requirements WHERE id='r-v3-53'").get().review_status, "Needs Review");
    assert.equal(raw.prepare("SELECT COUNT(*) c FROM requirement_review_decisions WHERE requirement_id='r-v3-53'").get().c, 0);
  } finally {
    raw.close();
  }
});

test("B12 a v4 extraction that re-issues the identical text stops the reviewed v3 from governing", async () => {
  const raw = seed();
  try {
    await post(raw, "/api/requirements/r-v3-53/approve", { reason: REASON });
    assert.ok(planFor(evidencesFrom(raw, ["r-v3-53"])).attachmentsToCreate.length > 0, "precondition: the reviewed v3 clause governs");

    // A later extraction supersedes version 3 and re-issues the same text, so
    // that same text has never been reviewed in its current form.
    raw
      .prepare(
        "INSERT INTO specification_extraction_versions (id, document_id, document_version_id, version_number, status, superseded_at, parser_version, ruleset_version, model_version, prompt_version, ocr_version, created_by) VALUES ('e-v4', 'd1', 'v1', 4, 'Completed', NULL, 'p', 'r', 'm', 'pr', 'o', ?)",
      )
      .run(OWNER);
    raw.prepare("UPDATE specification_extraction_versions SET superseded_at='2026-10-01T00:00:00.000Z' WHERE id='e-v3'").run();
    raw
      .prepare(
        "INSERT INTO specification_clauses (id, extraction_version_id, sequence, kind, number, title, page_from, page_to, path, original_text) VALUES ('specjob_v4_chunk_000001_clause_2', 'e-v4', 53, 'Requirement', 'B', '28 46 00', 4, 4, '28 46 00 SECTION 28 46 00 > 1 GENERAL', ?)",
      )
      .run(CLAUSES.systemAddressable.original_text);
    raw
      .prepare(
        `INSERT INTO technical_requirements (${REQUIREMENT_COLUMNS}) VALUES (?, 'e-v4', 'p1', 'd1', 'specjob_v4_chunk_000001_clause_2', 53, 'Rev 1', ?, ?, 'Fire Alarm', 'Specification', 'Fire Alarm', 'Other', NULL, 'Mandatory', 'Other', NULL, NULL, 0.95, 'High', 'Needs Review', 'Deterministic', 'parser-v1', 'model-v1', ?, '{}', '{}', 0)`,
      )
      .run(
        "r-v4-53",
        CLAUSES.systemAddressable.original_text,
        CLAUSES.systemAddressable.normalized_requirement,
        SOURCE_LOCATION(CLAUSES.systemAddressable.original_text),
      );

    const reviewedButNowSuperseded = currencyOf(raw, "r-v3-53");
    assert.equal(reviewedButNowSuperseded.isCurrent, false);
    assert.equal(reviewedButNowSuperseded.reviewStatus, "Approved", "its approval survives as history");
    assert.equal(planFor(evidencesFrom(raw, ["r-v3-53"])).attachmentsToCreate.length, 0, "and history does not govern");

    const newButUnreviewed = currencyOf(raw, "r-v4-53");
    assert.equal(newButUnreviewed.isCurrent, true);
    assert.equal(planFor(evidencesFrom(raw, ["r-v4-53"])).attachmentsToCreate.length, 0, "identical wording in the current extraction still requires its own governance");

    const refused = await post(raw, "/api/requirements/r-v3-53/approve", { reason: `${REASON} (stale retry)` });
    assert.equal(refused.status, 409, "the already-approved v3 row can no longer be re-reviewed");

    await post(raw, "/api/requirements/r-v4-53/approve", { reason: REASON });
    const resumed = planFor(evidencesFrom(raw, ["r-v3-53", "r-v4-53"]));
    assert.equal(resumed.attachmentsToCreate.length, 2);
    assert.deepEqual([...new Set(resumed.attachmentsToCreate.map((a) => a.evidenceId))], ["spec-requirement:r-v4-53"]);
  } finally {
    raw.close();
  }
});

test("B13 the superseded clause stays readable as history, because hiding a real decision is its own lie", async () => {
  const raw = seed();
  try {
    const detail = await handleSpecificationExtractionApi(new Request("https://app.example/api/requirements/r-v2-53"), env(raw), ctx);
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).requirement.id, "r-v2-53");
  } finally {
    raw.close();
  }
});

// ===========================================================================
// PART C -- approval does not manufacture applicability, points or ecosystem.
// ===========================================================================

test("C1 an approved product-compliance clause is governed, current, and still inert", async () => {
  const raw = seed();
  try {
    const evidence = evidencesFrom(raw, ["r-v3-197"])[0];
    assert.equal(evidence.eligibility.reviewStatus, "Approved");
    assert.equal(evidence.eligibility.approvedForDownstream, 1);
    assert.equal(evidence.eligibility.extractionIsCurrent, true);
    const plan = planFor([evidence]);
    assert.equal(plan.attachmentsToCreate.length, 0);
    assert.deepEqual(ruleIdsFor(plan, evidence.id), POPULATIONS.map((p) => `${p.id}:NOT_APPLICABLE:RULE_3_NO_DEVICE_ADDRESSABILITY_CLAIM`));
  } finally {
    raw.close();
  }
});

test("C2 a device-scoped addressability clause does not become system-wide, and stays insufficient while the family is ungoverned", async () => {
  const raw = seed();
  try {
    // Unreviewed, it is refused on eligibility before its scope is even read.
    const unreviewed = evidencesFrom(raw, ["r-v3-181"])[0];
    assert.equal(planFor([unreviewed], [POPULATIONS[0]]).classifications[0].ruleId, "RULE_1_EVIDENCE_NOT_ELIGIBLE");

    await post(raw, "/api/requirements/r-v3-181/approve", { reason: REASON });
    const evidence = evidencesFrom(raw, ["r-v3-181"])[0];
    assert.equal(evidence.eligibility.approvedForDownstream, 1);
    assert.equal(evidence.claimKind, "DEVICE");
    assert.equal(evidence.basis, "EXPLICIT_DEVICE_FAMILY_SCOPE");
    assert.notEqual(evidence.claimKind, "SYSTEM_ARCHITECTURE", "a device-scoped clause is never promoted to a system-wide one");
    // The extractor attributed this clause to no system, and the clause declares
    // no governed family list of its own. Each of those is independently
    // sufficient to refuse it, and neither is a licence to attach.
    assert.equal(evidence.scope.families, undefined);
    assert.equal(evidence.scope.system, "Unknown");

    const refused = planFor([evidence], [POPULATIONS[0], POPULATIONS[1]]);
    assert.equal(refused.attachmentsToCreate.length, 0);
    assert.deepEqual(ruleIdsFor(refused, evidence.id), [
      "pop-mcp:NOT_APPLICABLE:RULE_8_IMPLICIT_SCOPE_IS_NOT_EVIDENCE",
      "pop-heat:NOT_APPLICABLE:RULE_8_IMPLICIT_SCOPE_IS_NOT_EVIDENCE",
    ]);

    // Give it a declared system but still no family list: the fail-closed scope
    // guard takes over, and the pair stays INSUFFICIENT rather than attaching.
    const systemScoped = { ...evidence, scope: { ...evidence.scope, system: "Fire Alarm" } };
    const undeclared = planFor([systemScoped], [POPULATIONS[0]]);
    assert.equal(undeclared.attachmentsToCreate.length, 0);
    assert.equal(undeclared.classifications[0].status, "INSUFFICIENT_EVIDENCE");
    assert.equal(undeclared.classifications[0].ruleId, "RULE_26_SCOPE_UNDECLARED_FAILS_CLOSED");

    // A declared family reaches that family, and only that family. The panel's
    // family is simply not among them, so the family scope refuses it (the
    // panel is additionally out of the system-wide gate's reach, asserted in B8).
    const scoped = { ...systemScoped, scope: { ...systemScoped.scope, families: ["Multi-Criteria Point Detector"] } };
    const covered = planFor([scoped], [POPULATIONS[0], POPULATIONS[1], POPULATIONS[2]]);
    assert.deepEqual(ruleIdsFor(covered, scoped.id), [
      "pop-mcp:CONFIRMED_APPLICABLE:RULE_13A_FAMILY_SCOPE_COVERED",
      "pop-heat:NOT_APPLICABLE:RULE_13B_FAMILY_SCOPE_MISMATCH",
      "pop-facp:NOT_APPLICABLE:RULE_13B_FAMILY_SCOPE_MISMATCH",
    ]);

    // And a declared family still does not reach a population whose governed
    // family is UNKNOWN -- that resolution is GOLDEN-6C3B's work, not this clause's.
    const unknownFamily = planFor([scoped], [POPULATIONS[4]]);
    assert.equal(unknownFamily.classifications[0].status, "INSUFFICIENT_EVIDENCE");
    assert.equal(unknownFamily.classifications[0].ruleId, "RULE_14_FAMILY_PREREQUISITE_UNKNOWN");
  } finally {
    raw.close();
  }
});

test("C3 the whole review changes no point demand: the classifier, not the clause, owns consumption", async () => {
  const raw = seed();
  try {
    const inventory = () =>
      POPULATIONS.map((population) =>
        buildDeviceInventoryRecord({
          populationId: population.id,
          deviceFamily: population.family,
          system: population.system,
          // Addressability is carried on the inventory record by the downstream
          // device-evidence resolver, not by an addressability attachment.
          addressability: null,
          governingSource: "BOQ schedule",
          reviewStatus: "Approved",
          sources: [{ authority: "BOQ schedule", source: "BOQ", quantity: 12 }],
        }),
      );

    const before = aggregatePreliminaryPointDemand(inventory());
    await post(raw, "/api/requirements/r-v3-53/approve", { reason: REASON });
    const plan = planFor(evidencesFrom(raw, ["r-v3-53"]));
    assert.ok(plan.attachmentsToCreate.length > 0, "precondition: the clause now governs");
    const after = aggregatePreliminaryPointDemand(inventory());

    assert.equal(after.totalPoints, before.totalPoints, "governing the clause fabricated no point");
    assert.equal(after.knownPoints, before.knownPoints);
    assert.equal(after.unknownPopulations, before.unknownPopulations);
    assert.equal(after.confidence, before.confidence);
    assert.equal(plan.attachmentsToCreate.every((a) => a.pointDemand === undefined || a.pointDemand === null), true, "an attachment never carries a point value");
  } finally {
    raw.close();
  }
});

test("C4 the whole review selects no ecosystem, panel or manufacturer", async () => {
  const raw = seed();
  try {
    for (const id of ["r-v3-53", "r-v3-74", "r-v3-442"]) await post(raw, `/api/requirements/${id}/approve`, { reason: REASON });
    const plan = planFor(evidencesFrom(raw, ["r-v3-53", "r-v3-74", "r-v3-442", "r-v3-197", "r-v3-181"]));
    const serialized = JSON.stringify(plan);
    for (const vendor of ["Farenhyt", "Gamewell-FCI", "Gamewell", "Gentex", "Gent", "Simplex", "Notifier", "Honeywell", "Siemens", "EST", "Apollo"]) {
      assert.equal(serialized.includes(vendor), false, `the plan must never select an ecosystem (${vendor})`);
    }
    assert.equal(plan.attachmentsToCreate.every((a) => a.product === undefined && a.manufacturer === undefined && a.panel === undefined), true);
  } finally {
    raw.close();
  }
});

test("C5 the legend path stays independent of clause review", async () => {
  const raw = seed();
  try {
    await post(raw, "/api/requirements/r-v3-53/approve", { reason: REASON });
    const legend = {
      id: "legend:F-1",
      kind: "DRAWING_LEGEND",
      claimKind: "DEVICE",
      addressabilityClaim: "ADDRESSABLE",
      basis: "SAME_DRAWING_SYMBOL_SCOPE",
      // A legend's governed scope is the sheet it is drawn on plus the symbol it
      // defines. Both are required; a symbol with no sheet cannot be proven to
      // reach anything.
      scope: { system: "Fire Alarm", sheet: "FA-002", symbol: "F-1" },
      eligibility: { reviewStatus: "Approved", approvedForDownstream: 1, extractionIsCurrent: true, supersededAt: null },
      provenance: { source: "Legend", sourceLocation: "FA-002", authority: "Drawing legend", evidenceVersionId: null },
    };
    // A BOQ population with no canonical relationship to any drawing is
    // INSUFFICIENT under a drawing-scoped legend, whatever the clause says.
    const plan = planFor([legend, ...evidencesFrom(raw, ["r-v3-53"])]);
    for (const entry of plan.classifications.filter((c) => c.evidenceId === "legend:F-1")) {
      assert.equal(entry.status, "INSUFFICIENT_EVIDENCE");
      assert.equal(entry.ruleId, "RULE_10_DRAWING_SCOPE_UNKNOWN", "a drawing-scoped legend cannot be proven applicable without a drawing relationship");
    }
    // With a governed symbol, the legend path still decides on its own evidence.
    const drawn = [{ ...POPULATIONS[0], drawingScope: { sheets: ["FA-002"], symbols: ["F-1"] } }];
    const withDrawing = planFor([legend], drawn);
    assert.equal(withDrawing.attachmentsToCreate.length, 1);
    assert.equal(withDrawing.classifications[0].ruleId, "RULE_9A_DRAWING_SCOPE_COVERED");
  } finally {
    raw.close();
  }
});

// ===========================================================================
// PART D -- the negatives, as executable assertions.
// ===========================================================================

test("D1 the repository contains no carry-forward or review-inheritance mechanism to reuse", () => {
  const raw = activeDatabase();
  try {
    const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
    for (const name of tables) {
      assert.equal(/carry|inherit|lineage|supersed.*approv|approv.*supersed/i.test(name), false, `no inheritance table may be introduced (${name})`);
    }
    const columns = raw.prepare("PRAGMA table_info(technical_requirements)").all().map((column) => column.name);
    for (const name of columns) {
      assert.equal(/carry|inherit|prior_review|previous_review|reapprove/i.test(name), false, `no inheritance column may be introduced (${name})`);
    }
  } finally {
    raw.close();
  }
});

test("D2 the adapter itself carries no approval action and no applicability rule", async () => {
  const source = readFileSync(new URL("../app/domain/fire-alarm-addressability-clause-evidence.mjs", import.meta.url), "utf8");
  // A recommendation vocabulary is not an approval path: the adapter may state
  // what a reviewer should look at, never what the system has decided.
  for (const forbidden of [/\bdb\.\s*prepare\b/, /\bUPDATE\b/i, /\bINSERT\b/i, /\bDELETE\b/i]) {
    assert.equal(forbidden.test(source), false, `the adapter must stay read-only (${forbidden})`);
  }
  assert.equal(source.includes("SAFE_FOR_MUMAN_REAPPROVAL"), false, "the adapter does not even name an approval action");
});

test("D3 the clause corpus governs nothing until the current clause is reviewed, and never revives a superseded one", async () => {
  const raw = seed();
  try {
    const corpus = ["r-v2-53", "r-v3-53"];
    assert.equal(planFor(evidencesFrom(raw, corpus)).attachmentsToCreate.length, 0);

    await post(raw, "/api/requirements/r-v3-53/approve", { reason: REASON });
    const plan = planFor(evidencesFrom(raw, corpus));
    const confirmed = plan.classifications.filter((c) => c.status === "CONFIRMED_APPLICABLE");
    assert.ok(confirmed.length > 0);
    assert.equal(confirmed.every((c) => c.evidenceId === "spec-requirement:r-v3-53"), true);
    assert.equal(plan.classifications.filter((c) => c.evidenceId === "spec-requirement:r-v2-53").every((c) => c.status === "NOT_APPLICABLE"), true);
  } finally {
    raw.close();
  }
});

test("D4 three approvals of three adjacent obligations still attach only the one that obliges addressability", async () => {
  const raw = seed();
  try {
    for (const id of ["r-v3-53", "r-v3-74", "r-v3-442"]) {
      const response = await post(raw, `/api/requirements/${id}/approve`, { reason: REASON });
      assert.equal(response.status, 200);
      assert.equal(raw.prepare("SELECT approved_for_downstream FROM technical_requirements WHERE id=?").get(id).approved_for_downstream, 1);
    }
    const plan = planFor(evidencesFrom(raw, ["r-v3-53", "r-v3-74", "r-v3-442"]));
    const obligations = {
      "spec-requirement:r-v3-53": "SYSTEM_SHALL_BE_ADDRESSABLE",
      "spec-requirement:r-v3-74": "SUPPLY_AND_INSTALLATION",
      "spec-requirement:r-v3-442": "DIGITAL_DATA_NETWORK",
    };
    for (const evidence of evidencesFrom(raw, ["r-v3-53", "r-v3-74", "r-v3-442"])) {
      assert.equal(evidence.obligation, obligations[evidence.id]);
    }
    assert.equal(plan.attachmentsToCreate.length, 2, "three governed clauses, two field-device populations, one governing clause");
  } finally {
    raw.close();
  }
});
