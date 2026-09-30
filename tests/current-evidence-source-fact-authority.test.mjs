import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import {
  CURRENT_TECHNICAL_REQUIREMENT_SQL,
  currentTechnicalRequirementsFrom,
} from "../worker/current-evidence-scope.mjs";
import { loadInputs } from "../worker/technical-requirement-api.mjs";
import { buildTechnicalRequirementProfile } from "../app/domain/technical-requirement-engine.mjs";

// WHY THIS FILE BUILDS ITS OWN SCHEMA.
//
// Currentness is a fail-closed gate, so a test that cannot run proves nothing.
// The Slice 2B integration suite builds its database from the untracked
// `drizzle-active/` chain, which is not in Git; a direct test for this authority
// that leaned on it would silently stop exercising the gate in a clean
// checkout. The tables below are only the columns the two SQL statements in
// worker/current-evidence-scope.mjs and loadActiveSourceFacts actually name, so
// this file has zero untracked dependency and runs from a `git archive`.

const SCHEMA = `
CREATE TABLE projects (id TEXT PRIMARY KEY, archived_at TEXT, organization_id TEXT, owner_user_id TEXT);
CREATE TABLE documents (id TEXT PRIMARY KEY, project_id TEXT, deleted_at TEXT, archived_at TEXT, current_version_id TEXT);
CREATE TABLE document_versions (id TEXT PRIMARY KEY, document_id TEXT);
CREATE TABLE specification_extraction_versions (
  id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT,
  version_number INTEGER, superseded_at TEXT, status TEXT);
CREATE TABLE boq_extraction_versions (
  id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT,
  version_number INTEGER, superseded_at TEXT, status TEXT);
-- The BOQ side of the same authority. loadActiveSourceFacts asks whether a
-- provenance row names a current extraction on EITHER side, so a direct test of
-- the Source Fact gate must be able to answer both.
CREATE TABLE boq_items (
  id TEXT PRIMARY KEY, project_id TEXT, source_document_id TEXT,
  extraction_version_id TEXT, row_type TEXT, status TEXT);
CREATE TABLE technical_requirements (
  id TEXT PRIMARY KEY, project_id TEXT, source_document_id TEXT,
  extraction_version_id TEXT, original_text TEXT, approved_for_downstream INTEGER DEFAULT 0);
CREATE TABLE engineering_facts (
  id TEXT PRIMARY KEY, project_id TEXT, entity_type TEXT, entity_id TEXT,
  predicate TEXT, value TEXT, data_type TEXT, operator TEXT, fact_type TEXT,
  scope_type TEXT, scope_id TEXT, status TEXT, confidence INTEGER, model_version TEXT);
CREATE TABLE engineering_fact_provenance (
  id TEXT PRIMARY KEY, fact_id TEXT, source_type TEXT, source_id TEXT,
  document_id TEXT, document_version_id TEXT, extraction_version_id TEXT,
  page TEXT, section TEXT, clause TEXT, confidence INTEGER, created_at TEXT);
CREATE TABLE engineering_knowledge_conflicts (
  id TEXT PRIMARY KEY, project_id TEXT, resolution_status TEXT, blocking INTEGER,
  left_entity_id TEXT, right_entity_id TEXT);
CREATE TABLE boq_requirement_links (
  id TEXT PRIMARY KEY, boq_item_id TEXT, requirement_id TEXT,
  superseded_at TEXT, status TEXT, confidence INTEGER, link_method TEXT, evidence TEXT);
CREATE TABLE requirement_attributes (id TEXT PRIMARY KEY, requirement_id TEXT, name TEXT, operator TEXT, normalized_value TEXT, normalized_unit TEXT, confidence INTEGER, source_location TEXT);
CREATE TABLE requirement_standards (id TEXT PRIMARY KEY, requirement_id TEXT);
CREATE TABLE requirement_manufacturers (id TEXT PRIMARY KEY, requirement_id TEXT);
CREATE TABLE requirement_compatibility (id TEXT PRIMARY KEY, requirement_id TEXT, target_item TEXT, relationship_type TEXT);
CREATE TABLE requirement_accessories (id TEXT PRIMARY KEY, requirement_id TEXT);
CREATE TABLE engineering_relationships (
  id TEXT PRIMARY KEY, project_id TEXT, scope_type TEXT, scope_id TEXT,
  status TEXT, relationship_type TEXT, right_entity_id TEXT);
`;

// The D1 contract the worker modules are written against: prepare -> bind ->
// all/first/run. Identical in shape to the committed active-chain fixture's
// adapter, restated here so this file does not have to import it.
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
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  },
});

const build = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(SCHEMA);
  return { db: d1(raw), raw };
};

const PROJECT = "proj-1";
const OTHER_PROJECT = "proj-2";
const DOCUMENT = "doc-1";
const VERSION = "dv-1";

// A governed document whose current version is dv-1, holding one completed,
// non-superseded specification extraction (sev-1) at version_number 1.
const seedCurrentExtraction = (raw, {
  projectId = PROJECT, documentId = DOCUMENT, versionId = VERSION,
  extractionId = "sev-1", versionNumber = 1, supersededAt = null,
  status = "Completed", currentVersionId = versionId,
  documentDeletedAt = null, documentArchivedAt = null, projectArchivedAt = null,
  requirementId = "treq-1",
} = {}) => {
  const one = (sql, args) => raw.prepare(sql).run(...args);
  one("INSERT OR IGNORE INTO projects (id, archived_at) VALUES (?,?)", [projectId, projectArchivedAt]);
  one("INSERT OR IGNORE INTO document_versions (id, document_id) VALUES (?,?)", [versionId, documentId]);
  one("INSERT OR IGNORE INTO documents (id, project_id, deleted_at, archived_at, current_version_id) VALUES (?,?,?,?,?)",
    [documentId, projectId, documentDeletedAt, documentArchivedAt, currentVersionId]);
  one("INSERT INTO specification_extraction_versions (id, document_id, document_version_id, version_number, superseded_at, status) VALUES (?,?,?,?,?,?)",
    [extractionId, documentId, versionId, versionNumber, supersededAt, status]);
  one("INSERT INTO technical_requirements (id, project_id, source_document_id, extraction_version_id, original_text) VALUES (?,?,?,?,?)",
    [requirementId, projectId, documentId, extractionId, "Facp panel shall support FlashScan, CLIP"]);
};

const currentRequirements = ({ raw }) =>
  raw.prepare(`SELECT r.id FROM (${CURRENT_TECHNICAL_REQUIREMENT_SQL}) r`).all().map((row) => row.id);

const seedFact = (raw, {
  id = "fact-1", projectId = PROJECT, predicate = "protocol_compatibility",
  scopeType = "BOQ Item", scopeId = "boq-1", status = "Active",
  value = "FlashScan, CLIP",
} = {}) => raw.prepare(
  `INSERT INTO engineering_facts (id,project_id,entity_type,entity_id,predicate,value,data_type,operator,fact_type,scope_type,scope_id,status,confidence,model_version)
   VALUES (?,?,'BOQ Item',?,?,?,'text','Equal','Source Fact',?,?,?,95,'source-fact-promotion-1.0.0')`,
).run(id, projectId, scopeId, predicate, JSON.stringify({ value, unit: null }), scopeType, scopeId, status);

const seedProvenance = (raw, {
  id = "prov-1", factId = "fact-1", extractionVersionId = null,
  documentId = DOCUMENT, documentVersionId = VERSION, sourceType = "Specification",
} = {}) => raw.prepare(
  `INSERT INTO engineering_fact_provenance (id,fact_id,source_type,source_id,document_id,document_version_id,extraction_version_id,page,section,clause,confidence,created_at)
   VALUES (?,?,?,?,?,?,?,'28','28 46 00','5',95,'2026-01-01T00:00:00.000Z')`,
).run(id, factId, sourceType, documentId, documentId, documentVersionId, extractionVersionId);

const loadSourceFacts = async ({ db }, { projectId = PROJECT, itemId = "boq-1" } = {}) =>
  (await loadInputs(db, { id: itemId, project_id: projectId })).sourceFacts;

// ---------------------------------------------------------------------------
// CURRENT_TECHNICAL_REQUIREMENT_SQL -- the specification-side currentness gate
// ---------------------------------------------------------------------------

test("current extraction -- a requirement from the governing document version is current", () => {
  const { db, raw } = build();
  seedCurrentExtraction(raw);
  assert.deepEqual(currentRequirements({ raw }), ["treq-1"]);
});

test("superseded extraction -- a superseded extraction version is not current", () => {
  const { db, raw } = build();
  seedCurrentExtraction(raw, { supersededAt: "2026-02-01T00:00:00.000Z" });
  assert.deepEqual(currentRequirements({ raw }), []);
});

test("incomplete extraction -- a Failed or Draft extraction is not current", () => {
  for (const status of ["Failed", "Draft", "Queued"]) {
    const { db, raw } = build();
    seedCurrentExtraction(raw, { status });
    assert.deepEqual(currentRequirements({ raw }), [], `status ${status} must not count as current`);
  }
});

test("superseded document version -- an extraction of a non-governing document version is not current", () => {
  const { db, raw } = build();
  seedCurrentExtraction(raw, { currentVersionId: "dv-2" });
  assert.deepEqual(currentRequirements({ raw }), []);
});

test("newer extraction -- the highest-precedence extraction of a document version governs", () => {
  const { db, raw } = build();
  seedCurrentExtraction(raw, { extractionId: "sev-1", versionNumber: 1, requirementId: "treq-1" });
  seedCurrentExtraction(raw, { extractionId: "sev-2", versionNumber: 2, requirementId: "treq-2" });
  // sev-1 is not superseded in the database, but sev-2 supersedes it by precedence.
  assert.deepEqual(currentRequirements({ raw }), ["treq-2"]);
});

test("equal extraction version -- the later identifier wins deterministically", () => {
  const { db, raw } = build();
  seedCurrentExtraction(raw, { extractionId: "sev-a", versionNumber: 7, requirementId: "treq-a" });
  seedCurrentExtraction(raw, { extractionId: "sev-b", versionNumber: 7, requirementId: "treq-b" });
  assert.deepEqual(currentRequirements({ raw }), ["treq-b"]);
});

test("wrong project -- a requirement cannot claim currentness through another project's document", () => {
  const { db, raw } = build();
  seedCurrentExtraction(raw);
  // The requirement claims OTHER_PROJECT while the document belongs to PROJECT.
  raw.prepare("UPDATE technical_requirements SET project_id=? WHERE id='treq-1'").run(OTHER_PROJECT);
  assert.deepEqual(currentRequirements({ raw }), []);
});

test("wrong source -- a requirement whose source_document_id is not the extraction's document is not current", () => {
  const { db, raw } = build();
  seedCurrentExtraction(raw);
  raw.prepare("UPDATE technical_requirements SET source_document_id='doc-other' WHERE id='treq-1'").run();
  assert.deepEqual(currentRequirements({ raw }), []);
});

test("deleted, archived, or soft-removed evidence -- deleted documents, archived documents, and archived projects are not current", () => {
  for (const key of ["documentDeletedAt", "documentArchivedAt", "projectArchivedAt"]) {
    const { db, raw } = build();
    seedCurrentExtraction(raw, { [key]: "2026-02-01T00:00:00.000Z" });
    assert.deepEqual(currentRequirements({ raw }), [], `${key} must fail closed`);
  }
});

test("missing lineage -- a requirement naming an extraction version that does not exist is not current", () => {
  const { db, raw } = build();
  seedCurrentExtraction(raw);
  raw.prepare("UPDATE technical_requirements SET extraction_version_id='sev-missing' WHERE id='treq-1'").run();
  assert.deepEqual(currentRequirements({ raw }), []);
});

test("currentTechnicalRequirementsFrom -- resolves lineage for a provenance row, and fails closed when it cannot", () => {
  const { db, raw } = build();
  seedCurrentExtraction(raw);
  raw.prepare("INSERT INTO engineering_fact_provenance (id,fact_id,source_type,document_id,document_version_id,extraction_version_id,created_at) VALUES (?,?,?,?,?,?,?)")
    .run("prov-current", "fact-x", "Specification", DOCUMENT, VERSION, "sev-1", "2026-01-01T00:00:00.000Z");
  raw.prepare("INSERT INTO engineering_fact_provenance (id,fact_id,source_type,document_id,document_version_id,extraction_version_id,created_at) VALUES (?,?,?,?,?,?,?)")
    .run("prov-superseded", "fact-y", "Specification", DOCUMENT, VERSION, "sev-none", "2026-01-01T00:00:00.000Z");
  // The lineage probe the API builds: is there a CURRENT technical requirement
  // extracted from the very extraction version this provenance row names?
  const probe = `SELECT e.fact_id FROM engineering_fact_provenance e
    WHERE EXISTS (SELECT 1 FROM ${currentTechnicalRequirementsFrom("cr")} WHERE cr.extraction_version_id=e.extraction_version_id)
      AND e.fact_id=?`;
  assert.equal(raw.prepare(probe).get("fact-x")?.fact_id, "fact-x");
  assert.equal(raw.prepare(probe).get("fact-y"), undefined);
});

// ---------------------------------------------------------------------------
// loadActiveSourceFacts -- the Source Fact currentness gate
// ---------------------------------------------------------------------------

test("Product Family scope -- a current Product-Family-scoped Source Fact participates as evidence", async () => {
  const { db, raw } = build();
  seedCurrentExtraction(raw);
  seedFact(raw, { id: "fact-pf", scopeType: "Product Family", scopeId: "Addressable Smoke Detector" });
  seedProvenance(raw, { id: "prov-pf", factId: "fact-pf", extractionVersionId: "sev-1" });
  const loaded = await loadSourceFacts({ db });
  const fact = loaded.facts.find((entry) => entry.factId === "fact-pf");
  assert.ok(fact, "a Product-Family-scoped Source Fact must remain eligible evidence");
  assert.equal(fact.scopeType, "Product Family");
  assert.equal(fact.scopeId, "Addressable Smoke Detector");
  assert.equal(fact.provenance.length, 1, "its provenance must be attached");
});

test("BOQ Item scope -- a BOQ-Item-scoped Source Fact participates", async () => {
  const { db, raw } = build();
  seedCurrentExtraction(raw);
  seedFact(raw, { id: "fact-bi", scopeType: "BOQ Item", scopeId: "boq-1" });
  seedProvenance(raw, { id: "prov-bi", factId: "fact-bi", extractionVersionId: "sev-1" });
  const loaded = await loadSourceFacts({ db });
  assert.ok(loaded.facts.some((entry) => entry.factId === "fact-bi"));
});

test("non-extraction provenance -- a document/page/section provenance needs no extraction lineage to participate", async () => {
  const { db, raw } = build();
  seedCurrentExtraction(raw);
  seedFact(raw, { id: "fact-doc" });
  seedProvenance(raw, { id: "prov-doc", factId: "fact-doc", extractionVersionId: null });
  const loaded = await loadSourceFacts({ db });
  assert.ok(loaded.facts.some((entry) => entry.factId === "fact-doc"));
});

test("stale evidence -- an Active Source Fact whose only provenance is a non-current extraction fails closed", async () => {
  const { db, raw } = build();
  seedCurrentExtraction(raw, { supersededAt: "2026-02-01T00:00:00.000Z" });
  seedFact(raw, { id: "fact-stale" });
  seedProvenance(raw, { id: "prov-stale", factId: "fact-stale", extractionVersionId: "sev-1" });
  await assert.rejects(loadSourceFacts({ db }), (error) => {
    assert.equal(error.code, "STALE_SOURCE_FACT_EVIDENCE");
    assert.deepEqual(error.technicalDetails.staleSourceFactIds, ["fact-stale"]);
    assert.match(error.suggestedAction, /Re-run specification extraction|supersede/i);
    return true;
  });
});

test("stale evidence, mixed lineage -- one non-extraction provenance rescues the fact", async () => {
  const { db, raw } = build();
  seedCurrentExtraction(raw, { supersededAt: "2026-02-01T00:00:00.000Z" });
  seedFact(raw, { id: "fact-mixed" });
  seedProvenance(raw, { id: "prov-mixed-old", factId: "fact-mixed", extractionVersionId: "sev-1" });
  seedProvenance(raw, { id: "prov-mixed-doc", factId: "fact-mixed", extractionVersionId: null });
  const loaded = await loadSourceFacts({ db });
  assert.ok(loaded.facts.some((entry) => entry.factId === "fact-mixed"),
    "a fact that also carries document-level provenance is not lineage-stale");
});

test("superseded evidence -- a Superseded Source Fact is excluded even when its content is identical", async () => {
  const { db, raw } = build();
  seedCurrentExtraction(raw);
  seedFact(raw, { id: "fact-live" });
  seedProvenance(raw, { id: "prov-live", factId: "fact-live", extractionVersionId: "sev-1" });
  seedFact(raw, { id: "fact-old", status: "Superseded" });
  seedProvenance(raw, { id: "prov-old", factId: "fact-old", extractionVersionId: "sev-1" });
  const loaded = await loadSourceFacts({ db });
  assert.deepEqual(loaded.facts.map((entry) => entry.factId), ["fact-live"]);
});

test("wrong project -- a Source Fact from another project never crosses the boundary", async () => {
  const { db, raw } = build();
  seedCurrentExtraction(raw);
  seedCurrentExtraction(raw, {
    projectId: OTHER_PROJECT, documentId: "doc-2", versionId: "dv-2",
    extractionId: "sev-2", requirementId: "treq-2",
  });
  seedFact(raw, { id: "fact-mine", projectId: PROJECT });
  seedProvenance(raw, { id: "prov-mine", factId: "fact-mine", extractionVersionId: "sev-1" });
  seedFact(raw, { id: "fact-theirs", projectId: OTHER_PROJECT, scopeId: "boq-1" });
  seedProvenance(raw, { id: "prov-theirs", factId: "fact-theirs", extractionVersionId: "sev-2" });
  const loaded = await loadSourceFacts({ db });
  assert.deepEqual(loaded.facts.map((entry) => entry.factId), ["fact-mine"]);
});

test("missing provenance -- a Source Fact with no provenance row still participates (currentness is not established, lineage is not violated)", async () => {
  const { db, raw } = build();
  seedCurrentExtraction(raw);
  seedFact(raw, { id: "fact-bare" });
  const loaded = await loadSourceFacts({ db });
  const fact = loaded.facts.find((entry) => entry.factId === "fact-bare");
  assert.ok(fact);
  assert.deepEqual(fact.provenance, []);
});

test("blocking conflict -- an open blocking conflict is carried to the engine as a Source Fact conflict", async () => {
  const { db, raw } = build();
  seedCurrentExtraction(raw);
  seedFact(raw, { id: "fact-c" });
  seedProvenance(raw, { id: "prov-c", factId: "fact-c", extractionVersionId: "sev-1" });
  raw.prepare("INSERT INTO engineering_knowledge_conflicts (id,project_id,resolution_status,blocking,left_entity_id,right_entity_id) VALUES (?,?,'Open',1,'fact-c','product-x')")
    .run("conf-1", PROJECT);
  raw.prepare("INSERT INTO engineering_knowledge_conflicts (id,project_id,resolution_status,blocking,left_entity_id,right_entity_id) VALUES (?,?,'Resolved',1,'fact-c','product-y')")
    .run("conf-2", PROJECT);
  const loaded = await loadSourceFacts({ db });
  assert.deepEqual(loaded.conflicts, [{ factId: "fact-c", conflictId: "conf-1" }]);
});

test("no Source Facts -- an empty project yields empty evidence rather than an error", async () => {
  const { db, raw } = build();
  const loaded = await loadSourceFacts({ db });
  assert.deepEqual(loaded, { facts: [], conflicts: [] });
});

// ---------------------------------------------------------------------------
// The handoff condition: current Source Fact evidence REACHES the profile, and
// still cannot decide compatibility. IR-1 is never edited to make this pass.
// ---------------------------------------------------------------------------

const PANEL = {
  id: "boq-1",
  projectId: PROJECT,
  itemNumber: "5.1",
  description: "Addressable smoke detector",
  system: "Fire Alarm",
  category: "Detection",
  subcategory: "Detector",
  // A family the taxonomy governs as panel-protocol-locked, so
  // compatibilityTarget is genuinely blocking for this item and the assertion
  // below is about the Source Fact, not about a non-blocking advisory field.
  productFamily: "Addressable Smoke Detector",
  unit: "No",
  quantity: 1,
  attributes: {},
};

const profileWith = async ({ db }) => {
  const { facts, conflicts } = await loadSourceFacts({ db });
  return buildTechnicalRequirementProfile({
    boqItem: PANEL, requirements: [], sourceFacts: facts, sourceFactConflicts: conflicts,
  });
};

test("Product Family Source Fact -- current evidence reaches the profile and still cannot satisfy compatibilityTarget", async () => {
  const { db, raw } = build();
  seedCurrentExtraction(raw);
  seedFact(raw, {
    id: "fact-pf", scopeType: "Product Family", scopeId: "Addressable Smoke Detector",
    predicate: "protocol_compatibility", value: "FlashScan, CLIP",
  });
  seedProvenance(raw, { id: "prov-pf", factId: "fact-pf", extractionVersionId: "sev-1" });

  const profile = await profileWith({ db });

  const evidence = profile.compatibility.find((entry) => entry.source === "Source Fact");
  assert.ok(evidence, "the Product-Family Source Fact must enter as governed Source Fact evidence");
  assert.equal(evidence.factId, "fact-pf");
  assert.equal(evidence.blocking, false, "and it must not be a blocking claim");
  assert.equal(evidence.status, "Evidence");
  assert.equal(profile.compatibility.some((entry) => entry.productCompatibilityClaimed === true), false,
    "no product compatibility may be asserted from a Source Fact");

  const gap = (profile.missingInformation || []).find((entry) => entry.field === "compatibilityTarget");
  assert.ok(gap, "compatibilityTarget must still be reported as missing");
  assert.equal(gap.blocking, true, "and must still block -- the authority separation is intact");
});

test("Product Family precedence -- a BOQ-Item-scoped fact governs over the family-level fact of the same predicate", async () => {
  const { db, raw } = build();
  seedCurrentExtraction(raw);
  seedFact(raw, { id: "fact-pf", scopeType: "Product Family", scopeId: "Addressable Smoke Detector", value: "FlashScan, CLIP" });
  seedProvenance(raw, { id: "prov-pf", factId: "fact-pf", extractionVersionId: "sev-1" });
  seedFact(raw, { id: "fact-bi", scopeType: "BOQ Item", scopeId: "boq-1", value: "FlashScan, CLIP PRO" });
  seedProvenance(raw, { id: "prov-bi", factId: "fact-bi", extractionVersionId: "sev-1" });

  const profile = await profileWith({ db });

  const evidence = profile.compatibility.find((entry) => entry.source === "Source Fact");
  assert.equal(evidence.factId, "fact-bi", "the more specific scope is the one this profile treats as authoritative");
  assert.equal(profile.compatibility.some((entry) => entry.factId === "fact-pf"), false,
    "the family-level fact is not deleted, only outranked for this profile");
});

test("stale evidence never reaches the profile -- the fail-closed refusal happens before the engine is called", async () => {
  const { db, raw } = build();
  seedCurrentExtraction(raw, { supersededAt: "2026-02-01T00:00:00.000Z" });
  seedFact(raw, { id: "fact-pf", scopeType: "Product Family", scopeId: "Addressable Smoke Detector" });
  seedProvenance(raw, { id: "prov-pf", factId: "fact-pf", extractionVersionId: "sev-1" });

  await assert.rejects(profileWith({ db }), (error) => error.code === "STALE_SOURCE_FACT_EVIDENCE");
});
