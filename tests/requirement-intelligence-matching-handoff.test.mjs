import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import { executeRequirementProfile } from "../worker/technical-requirement-api.mjs";

// Sprint 0.8 -- the real Opera Manual Call Point bug: an approved, linked,
// provenance-backed technical fact (addressing=Addressable, action_type=Single
// Action) reached Requirement Intelligence but never reached
// consolidatedRequirements[].attributes, the exact structure Product Matching
// reads. This suite proves the handoff now works, and proves the authority
// model around it: only approved + currently-linked + this-item facts may
// ever influence matching; nothing else can, including historical selections.

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (values = []) => ({
      first: async () => raw.prepare(sql).get(...values) || null,
      all: async () => ({ results: raw.prepare(sql).all(...values) }),
      run: async () => raw.prepare(sql).run(...values),
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

const schema = `
PRAGMA foreign_keys=OFF;
CREATE TABLE projects(id TEXT PRIMARY KEY, owner_user_id TEXT, organization_id TEXT, archived_at TEXT);
CREATE TABLE documents(id TEXT PRIMARY KEY, project_id TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
CREATE TABLE document_versions(id TEXT PRIMARY KEY, document_id TEXT);
CREATE TABLE boq_extraction_versions(id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, version_number INTEGER, status TEXT, superseded_at TEXT);
CREATE TABLE boq_items(id TEXT PRIMARY KEY, project_id TEXT, row_type TEXT, extraction_version_id TEXT, source_document_id TEXT, sequence INTEGER, item_number TEXT, description TEXT, numeric_quantity REAL, original_quantity REAL, normalized_unit TEXT, original_unit TEXT, system_value TEXT, category TEXT, subcategory TEXT, manufacturer TEXT, model TEXT, part_number TEXT, current_values TEXT, source_location TEXT, review_status TEXT, approved_for_downstream INTEGER, specification_reference TEXT, system_confidence INTEGER, extraction_confidence INTEGER);
CREATE TABLE estimator_understanding_runs(id TEXT PRIMARY KEY, run_mode TEXT, parent_run_id TEXT);
CREATE TABLE estimator_item_interpretations(id TEXT PRIMARY KEY, boq_item_id TEXT, run_id TEXT, project_id TEXT, version_number INTEGER, input_fingerprint TEXT, config_fingerprint TEXT, status TEXT, validated_interpretation TEXT, error_code TEXT, model TEXT, raw_response TEXT, created_at TEXT);
CREATE TABLE technical_requirements(id TEXT PRIMARY KEY, project_id TEXT, original_text TEXT, normalized_requirement TEXT, requirement_type TEXT, requirement_category TEXT, system TEXT, category TEXT, condition TEXT, confidence INTEGER, source_location TEXT, approved_for_downstream INTEGER, review_status TEXT);
CREATE TABLE boq_requirement_links(id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, requirement_id TEXT, superseded_at TEXT, status TEXT, confidence INTEGER, link_method TEXT, evidence TEXT);
CREATE TABLE requirement_attributes(id TEXT PRIMARY KEY, requirement_id TEXT, name TEXT, operator TEXT, original_value TEXT, parsed_value TEXT, original_unit TEXT, normalized_value TEXT, normalized_unit TEXT, confidence INTEGER, source_location TEXT);
CREATE TABLE requirement_standards(id TEXT PRIMARY KEY, requirement_id TEXT);
CREATE TABLE requirement_manufacturers(id TEXT PRIMARY KEY, requirement_id TEXT);
CREATE TABLE requirement_compatibility(id TEXT PRIMARY KEY, requirement_id TEXT, target_item TEXT, relationship_type TEXT);
CREATE TABLE requirement_accessories(id TEXT PRIMARY KEY, requirement_id TEXT);
CREATE TABLE engineering_facts(id TEXT PRIMARY KEY, project_id TEXT, status TEXT, scope_type TEXT, scope_id TEXT);
CREATE TABLE engineering_relationships(id TEXT PRIMARY KEY, project_id TEXT, status TEXT, scope_type TEXT, scope_id TEXT, relationship_type TEXT, right_entity_id TEXT);
CREATE TABLE requirement_profile_versions(id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, processing_run_id TEXT, version_number INTEGER, status TEXT, engine_version TEXT, ruleset_version TEXT, model_version TEXT, input_fingerprint TEXT, profile TEXT, explanation TEXT, readiness_status TEXT, confidence_summary TEXT, created_by TEXT, completed_at TEXT, superseded_at TEXT);
CREATE TABLE profile_requirement_applicability(id TEXT PRIMARY KEY, profile_version_id TEXT, requirement_id TEXT, status TEXT, method TEXT, confidence INTEGER, evidence TEXT, priority TEXT, review_status TEXT);
CREATE TABLE consolidated_profile_requirements(id TEXT PRIMARY KEY, profile_version_id TEXT, canonical_key TEXT, normalized_requirement TEXT, requirement_category TEXT, requirement_type TEXT, priority TEXT, governing_source_id TEXT, sources TEXT, attributes TEXT, standards TEXT, manufacturers TEXT, confidence INTEGER);
CREATE TABLE requirement_intelligence_facts(id TEXT PRIMARY KEY, profile_version_id TEXT, requirement_id TEXT, fact_key TEXT, fact_type TEXT, original_value TEXT, current_value TEXT, modality TEXT, confidence INTEGER, source_page INTEGER, source_page_to INTEGER, source_clause TEXT, source_section TEXT, evidence_snippet TEXT, extraction_basis TEXT, engine_version TEXT, review_status TEXT, reviewed_by TEXT, reviewed_at TEXT, review_reason TEXT);
CREATE TABLE profile_issues(id TEXT PRIMARY KEY, profile_version_id TEXT, issue_type TEXT, related_requirement_id TEXT, related_field TEXT, payload TEXT, severity TEXT, blocking INTEGER, status TEXT);
CREATE TABLE requirement_rule_executions(id TEXT PRIMARY KEY, profile_version_id TEXT, rule_id TEXT, rule_version INTEGER, input TEXT, output TEXT, status TEXT, duration_ms INTEGER);
CREATE TABLE requirement_profile_decisions(id TEXT PRIMARY KEY, project_id TEXT, profile_version_id TEXT, entity_type TEXT, entity_id TEXT, action TEXT, previous_value TEXT, new_value TEXT, reason TEXT, evidence TEXT, decided_by TEXT, decided_role TEXT, decided_at TEXT);
CREATE TABLE document_audit_events(id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, version_id TEXT, actor_user_id TEXT, action TEXT, old_value TEXT, new_value TEXT, reason TEXT, request_id TEXT);
`;

const buildDatabase = async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  const migration = await readFile(new URL("../drizzle/0060_estimator_understanding_review.sql", import.meta.url), "utf8");
  raw.exec(migration);
  return raw;
};

let itemSeq = 0;
const seedProject = (raw) => { raw.exec(`INSERT INTO projects VALUES ('p1','owner1','org1',NULL);`); };
const seedItem = (raw, { id, description = "Manual Call Point MCLP" } = {}) => {
  itemSeq += 1; const itemId = id || `boq-item-${itemSeq}`;
  raw.exec(`INSERT INTO documents VALUES ('doc${itemSeq}','p1','dv${itemSeq}',NULL,NULL); INSERT INTO document_versions VALUES ('dv${itemSeq}','doc${itemSeq}'); INSERT INTO boq_extraction_versions VALUES ('ext${itemSeq}','doc${itemSeq}','dv${itemSeq}',1,'Completed',NULL);`);
  raw.prepare(`INSERT INTO boq_items (id,project_id,row_type,extraction_version_id,source_document_id,sequence,item_number,description,numeric_quantity,original_quantity,normalized_unit,original_unit,system_value,category,subcategory,manufacturer,model,part_number,current_values,source_location,review_status,approved_for_downstream,specification_reference,system_confidence,extraction_confidence)
    VALUES (?,'p1','BOQ Item','ext${itemSeq}','doc${itemSeq}',1,'34',?,16,16,'No.','No.',NULL,NULL,NULL,NULL,NULL,NULL,'{}',NULL,'Approved',1,NULL,NULL,95)`).run(itemId, description);
  return itemId;
};

let reqSeq = 0;
const seedRequirement = (raw, { id, originalText, page = 32, clause = "A" } = {}) => {
  reqSeq += 1; const reqId = id || `req-${reqSeq}`;
  raw.prepare(`INSERT INTO technical_requirements (id,project_id,original_text,normalized_requirement,requirement_type,requirement_category,system,category,condition,confidence,source_location,approved_for_downstream,review_status) VALUES (?,'p1',?,?,'Mandatory','Documentation','Fire Alarm','Documentation',NULL,90,?,1,'Approved')`)
    .run(reqId, originalText, originalText.toLowerCase(), JSON.stringify({ pageFrom: page, clause }));
  return reqId;
};

const linkRequirement = (raw, { boqItemId, requirementId, status = "Confirmed" }) => {
  raw.prepare(`INSERT INTO boq_requirement_links (id,project_id,boq_item_id,requirement_id,superseded_at,status,confidence,link_method,evidence) VALUES (?,'p1',?,?,NULL,?,90,'Human-confirmed knowledge link','[]')`)
    .run(`link-${boqItemId}-${requirementId}`, boqItemId, requirementId, status);
};

const seedPriorProfileVersion = (raw, { boqItemId }) => {
  const profileId = `prior-profile-${boqItemId}`;
  raw.prepare(`INSERT INTO requirement_profile_versions (id,project_id,boq_item_id,processing_run_id,version_number,status,engine_version,ruleset_version,model_version,input_fingerprint,profile,explanation,readiness_status,confidence_summary,created_by,completed_at,superseded_at) VALUES (?,'p1',?,NULL,1,'Completed','x','x','x','fp','{}','x','Ready with Warnings','{}','owner1','2026-08-23T00:00:00Z',NULL)`)
    .run(profileId, boqItemId);
  return profileId;
};

const seedIntelligenceFact = (raw, { profileVersionId, requirementId, factType, value, reviewStatus = "Approved", page = 32, clause = "A" }) => {
  raw.prepare(`INSERT INTO requirement_intelligence_facts (id,profile_version_id,requirement_id,fact_key,fact_type,original_value,current_value,modality,confidence,source_page,source_page_to,source_clause,source_section,evidence_snippet,extraction_basis,engine_version,review_status,reviewed_by,reviewed_at,review_reason) VALUES (?,?,?,?,?,?,?,'Mandatory',90,?,?,?,NULL,'evidence','Explicit specification wording','x',?,'engineer1','2026-08-23T00:00:00Z','engineer approval')`)
    .run(`fact-${requirementId}-${factType}`, profileVersionId, requirementId, `${requirementId}:${factType}:${value}`, factType, JSON.stringify(value), JSON.stringify(value), page, page, clause, reviewStatus);
};

const currentProfile = (raw, boqItemId) => {
  const row = raw.prepare("SELECT * FROM requirement_profile_versions WHERE boq_item_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1").get(boqItemId);
  return row ? { ...row, profile: JSON.parse(row.profile) } : null;
};

const attributesFor = (profile, name) => profile.profile.consolidatedRequirements.flatMap((entry) => entry.attributes).filter((attribute) => attribute.name === name);

test("an approved, linked, current fact reaches the exact structure Product Matching reads", async () => {
  const raw = await buildDatabase(); seedProject(raw);
  const itemId = seedItem(raw);
  const reqId = seedRequirement(raw, { originalText: "Manual pull stations shall be individually addressable, suitable for two wire operation, with a high impact red Lexan body and raised white lettering." });
  linkRequirement(raw, { boqItemId: itemId, requirementId: reqId });
  const priorProfileId = seedPriorProfileVersion(raw, { boqItemId: itemId });
  seedIntelligenceFact(raw, { profileVersionId: priorProfileId, requirementId: reqId, factType: "Addressability", value: "Addressable", reviewStatus: "Approved" });

  const DB = d1(raw);
  await executeRequirementProfile({ DB }, { itemId, userId: "owner1", runId: null });
  const profile = currentProfile(raw, itemId);
  const addressing = attributesFor(profile, "addressing");
  assert.equal(addressing.length, 1);
  assert.equal(addressing[0].normalizedValue, "Addressable");
  assert.equal(addressing[0].origin, "PROJECT_SPECIFICATION");
});

test("an unapproved (Needs Review) fact does not reach matching", async () => {
  const raw = await buildDatabase(); seedProject(raw);
  const itemId = seedItem(raw);
  const reqId = seedRequirement(raw, { originalText: "Manual pull stations shall be individually addressable." });
  linkRequirement(raw, { boqItemId: itemId, requirementId: reqId });
  const priorProfileId = seedPriorProfileVersion(raw, { boqItemId: itemId });
  seedIntelligenceFact(raw, { profileVersionId: priorProfileId, requirementId: reqId, factType: "Addressability", value: "Addressable", reviewStatus: "Needs Review" });

  const DB = d1(raw);
  await executeRequirementProfile({ DB }, { itemId, userId: "owner1", runId: null });
  const profile = currentProfile(raw, itemId);
  assert.equal(attributesFor(profile, "addressing").length, 0);
});

test("a rejected fact does not reach matching", async () => {
  const raw = await buildDatabase(); seedProject(raw);
  const itemId = seedItem(raw);
  const reqId = seedRequirement(raw, { originalText: "Manual pull stations shall be individually addressable." });
  linkRequirement(raw, { boqItemId: itemId, requirementId: reqId });
  const priorProfileId = seedPriorProfileVersion(raw, { boqItemId: itemId });
  seedIntelligenceFact(raw, { profileVersionId: priorProfileId, requirementId: reqId, factType: "Addressability", value: "Addressable", reviewStatus: "Rejected" });

  const DB = d1(raw);
  await executeRequirementProfile({ DB }, { itemId, userId: "owner1", runId: null });
  const profile = currentProfile(raw, itemId);
  assert.equal(attributesFor(profile, "addressing").length, 0);
});

test("a fact whose link has since been rejected (stale approval) does not reach matching", async () => {
  const raw = await buildDatabase(); seedProject(raw);
  const itemId = seedItem(raw);
  const reqId = seedRequirement(raw, { originalText: "Manual pull stations shall be individually addressable." });
  linkRequirement(raw, { boqItemId: itemId, requirementId: reqId, status: "Confirmed" });
  const priorProfileId = seedPriorProfileVersion(raw, { boqItemId: itemId });
  seedIntelligenceFact(raw, { profileVersionId: priorProfileId, requirementId: reqId, factType: "Addressability", value: "Addressable", reviewStatus: "Approved" });

  const DB = d1(raw);
  await executeRequirementProfile({ DB }, { itemId, userId: "owner1", runId: null });
  assert.equal(attributesFor(currentProfile(raw, itemId), "addressing").length, 1, "sanity: present while linked");

  // Engineer later rejects the link (e.g. re-evaluated as not applicable to this row).
  raw.prepare("UPDATE boq_requirement_links SET status='Rejected' WHERE boq_item_id=? AND requirement_id=?").run(itemId, reqId);
  raw.prepare("UPDATE requirement_profile_versions SET input_fingerprint='force-recalculate' WHERE boq_item_id=?").run(itemId);
  await executeRequirementProfile({ DB }, { itemId, userId: "owner1", runId: null });
  assert.equal(attributesFor(currentProfile(raw, itemId), "addressing").length, 0, "an approval tied to a no-longer-current link must not resurrect itself");
});

test("a fact approved under another BOQ item's profile never leaks into this item", async () => {
  const raw = await buildDatabase(); seedProject(raw);
  const itemA = seedItem(raw, { description: "Manual Call Point MCLP" });
  const itemB = seedItem(raw, { description: "Manual Call Point MCLP WP" });
  const sharedReqId = seedRequirement(raw, { originalText: "Manual pull stations shall be individually addressable." });
  linkRequirement(raw, { boqItemId: itemA, requirementId: sharedReqId });
  linkRequirement(raw, { boqItemId: itemB, requirementId: sharedReqId });
  const profileBId = seedPriorProfileVersion(raw, { boqItemId: itemB });
  // Approved only under item B's profile chain.
  seedIntelligenceFact(raw, { profileVersionId: profileBId, requirementId: sharedReqId, factType: "Addressability", value: "Addressable", reviewStatus: "Approved" });

  const DB = d1(raw);
  await executeRequirementProfile({ DB }, { itemId: itemA, userId: "owner1", runId: null });
  assert.equal(attributesFor(currentProfile(raw, itemA), "addressing").length, 0, "item A must not inherit item B's approved fact");

  await executeRequirementProfile({ DB }, { itemId: itemB, userId: "owner1", runId: null });
  assert.equal(attributesFor(currentProfile(raw, itemB), "addressing").length, 1, "item B legitimately owns the approved fact");
});

test("provenance (page, clause) survives into the matching input", async () => {
  const raw = await buildDatabase(); seedProject(raw);
  const itemId = seedItem(raw);
  const reqId = seedRequirement(raw, { originalText: "Manual pull stations shall be individually addressable.", page: 32, clause: "A" });
  linkRequirement(raw, { boqItemId: itemId, requirementId: reqId });
  const priorProfileId = seedPriorProfileVersion(raw, { boqItemId: itemId });
  seedIntelligenceFact(raw, { profileVersionId: priorProfileId, requirementId: reqId, factType: "Addressability", value: "Addressable", reviewStatus: "Approved", page: 32, clause: "A" });

  const DB = d1(raw);
  await executeRequirementProfile({ DB }, { itemId, userId: "owner1", runId: null });
  const [addressing] = attributesFor(currentProfile(raw, itemId), "addressing");
  assert.equal(addressing.source.page, 32);
  assert.equal(addressing.source.clause, "A");
});

test("two approved facts from different specification sources conflict rather than silently resolve", async () => {
  const raw = await buildDatabase(); seedProject(raw);
  const itemId = seedItem(raw);
  const reqSingle = seedRequirement(raw, { originalText: "Stations shall include a single action operating mechanism." });
  const reqDual = seedRequirement(raw, { originalText: "Stations elsewhere in this package shall include a dual action operating mechanism.", page: 40, clause: "C" });
  linkRequirement(raw, { boqItemId: itemId, requirementId: reqSingle });
  linkRequirement(raw, { boqItemId: itemId, requirementId: reqDual });
  const priorProfileId = seedPriorProfileVersion(raw, { boqItemId: itemId });
  seedIntelligenceFact(raw, { profileVersionId: priorProfileId, requirementId: reqSingle, factType: "Action Type", value: "Single Action", reviewStatus: "Approved" });
  seedIntelligenceFact(raw, { profileVersionId: priorProfileId, requirementId: reqDual, factType: "Action Type", value: "Dual Action", reviewStatus: "Approved", page: 40, clause: "C" });

  const DB = d1(raw);
  await executeRequirementProfile({ DB }, { itemId, userId: "owner1", runId: null });
  const profile = currentProfile(raw, itemId);
  const conflict = profile.profile.conflicts.find((entry) => entry.attribute === "action_type");
  assert.ok(conflict, "conflicting approved values must surface as a conflict");
  assert.equal(conflict.blocking, true);
  assert.equal(conflict.values.length, 2);
  // Readiness itself is gated by classification (system/category) first, which
  // this test intentionally leaves unset -- the point proven here is that the
  // conflict is recorded and blocking, not the full readiness precedence chain.
  assert.ok(profile.profile.readiness.blockingReasons.length > 0);
});

test("only a governed canonical attribute name is promoted -- an unmapped fact type (e.g. a historical selection) never becomes a requirement attribute", async () => {
  const raw = await buildDatabase(); seedProject(raw);
  const itemId = seedItem(raw);
  const reqId = seedRequirement(raw, { originalText: "The historical final selection for this row was IDP-PULL-DA." });
  linkRequirement(raw, { boqItemId: itemId, requirementId: reqId });
  const priorProfileId = seedPriorProfileVersion(raw, { boqItemId: itemId });
  // No fact type named "Historical Product Selection" is governed -- proves the
  // allow-list (not a deny-list) is what keeps historical selections out.
  seedIntelligenceFact(raw, { profileVersionId: priorProfileId, requirementId: reqId, factType: "Historical Product Selection", value: "IDP-PULL-DA", reviewStatus: "Approved" });

  const DB = d1(raw);
  await executeRequirementProfile({ DB }, { itemId, userId: "owner1", runId: null });
  const profile = currentProfile(raw, itemId);
  const allValues = profile.profile.consolidatedRequirements.flatMap((entry) => entry.attributes).map((attribute) => attribute.normalizedValue);
  assert.ok(!allValues.includes("IDP-PULL-DA"));
});

test("a BOQ item with no approved requirement evidence behaves exactly as before this sprint", async () => {
  const raw = await buildDatabase(); seedProject(raw);
  const itemId = seedItem(raw);

  const DB = d1(raw);
  await executeRequirementProfile({ DB }, { itemId, userId: "owner1", runId: null });
  const profile = currentProfile(raw, itemId);
  assert.deepEqual(profile.profile.consolidatedRequirements, []);
  assert.deepEqual(profile.profile.conflicts, []);
});
