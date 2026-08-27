import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { buildLinkShortlist, handleEngineeringKnowledgeApi } from "../worker/engineering-knowledge-api.mjs";
import { loadUnderstandingReviewRows, mutateUnderstandingReview, understandingReviewSelectionAuthority, currentApprovedUnderstandingFacts } from "../worker/estimator-understanding-review-api.mjs";
import { prepareBoqUnderstandingInput, validateAndMergeBoqInterpretation, interpretationInputFingerprint } from "../app/domain/boq-understanding-engine.mjs";
import { confirmedSpecifications } from "../worker/estimator-understanding-api.mjs";

// Sprint 1.13 -- real Opera gap: requirement_30 ("UL 268 - Standard for Smoke
// Detectors for Fire Alarm Systems") scores 61 for a Smoke Detector BOQ item
// (a clean equipment-type match) but is Informational, not Mandatory, and a
// real Fire Alarm spec easily has 40+ Mandatory-type clauses that merely
// share the system and a detection-related word without being about any
// specific device -- enough to fill the entire 40-slot shortlist ahead of it
// under the old mandatory-first-only sort, so it was never even suggested,
// let alone reviewable. This proves buildLinkShortlist's device-specific
// reserve fixes exactly that, without touching scoreRequirementLink.
test("Sprint 1.13 -- a high-confidence, equipment-matched, non-Mandatory requirement is not crowded out of the shortlist by many generic Mandatory requirements", () => {
  const item = { description: "Smoke Detector Ceiling Mounted", system_value: "Fire Alarm", category: null, specification_reference: null };
  const target = {
    id: "req-target-ul268",
    original_text: "UL 268 - Standard for Smoke Detectors for Fire Alarm Systems;",
    system: "Fire Alarm",
    category: "Compliance",
    requirement_type: "Informational",
    source_location: null,
  };
  // 45 generic Mandatory clauses: same system + a detection-related word
  // (clears the relaxed Mandatory threshold, >=15) but no specific equipment
  // noun of their own -- exactly the real corpus shape (hundreds of
  // system-wide Mandatory clauses in a detection-heavy Fire Alarm spec).
  const generic = Array.from({ length: 45 }, (_, index) => ({
    id: `req-generic-${index}`,
    original_text: `The control panel shall detect a fire condition and initiate signal number ${index}.`,
    system: "Fire Alarm",
    category: "Functional",
    requirement_type: "Mandatory",
    source_location: null,
  }));

  // Reproduces the OLD behavior directly (mandatory-first sort, flat slice(0,40),
  // no device-specific reserve) to prove the real gap existed.
  const oldShortlist = [target, ...generic]
    .map((requirement) => import("../app/domain/engineering-knowledge.mjs").then((m) => ({ requirement, suggestion: m.scoreRequirementLink({ boqItem: { description: item.description, system: item.system_value, category: item.category }, requirement: { originalText: requirement.original_text, system: requirement.system, category: requirement.category, source: {} } }) })));
  return Promise.all(oldShortlist).then((scored) => {
    const eligible = scored.filter(({ requirement, suggestion }) => suggestion.confidence >= 25 || (/mandatory|required/i.test(requirement.requirement_type || "") && suggestion.confidence >= 15));
    assert.ok(eligible.some(({ requirement }) => requirement.id === "req-target-ul268"), "target must be genuinely eligible (clears the threshold) -- this is a shortlist problem, not a scoring problem");
    const legacyRanked = [...eligible].sort((left, right) => Number(/mandatory|required/i.test(right.requirement.requirement_type || "")) - Number(/mandatory|required/i.test(left.requirement.requirement_type || "")) || right.suggestion.confidence - left.suggestion.confidence).slice(0, 40);
    assert.equal(legacyRanked.some(({ requirement }) => requirement.id === "req-target-ul268"), false, "reproduces the real gap: the old flat mandatory-first slice(0,40) crowds the target out entirely");

    const fixed = buildLinkShortlist(item, [target, ...generic]);
    assert.ok(fixed.length <= 40, "the overall cap is unchanged");
    assert.ok(fixed.some(({ requirement }) => requirement.id === "req-target-ul268"), "the device-specific reserve now guarantees the equipment-matched, high-confidence requirement a slot");
    const targetEntry = fixed.find(({ requirement }) => requirement.id === "req-target-ul268");
    assert.equal(targetEntry.suggestion.itemEquipment, "Smoke Detector");
    assert.equal(targetEntry.suggestion.requirementEquipment, "Smoke Detector");
  });
});

test("Sprint 1.13 -- an item with no equipment-type match at all is unaffected by the reserve (no fabricated relevance)", () => {
  const item = { description: "Generic project heading", system_value: null, category: null, specification_reference: null };
  const requirements = Array.from({ length: 10 }, (_, index) => ({ id: `req-${index}`, original_text: `Provide documentation item ${index}.`, system: "Fire Alarm", category: "Documentation", requirement_type: "Mandatory", source_location: null }));
  const shortlist = buildLinkShortlist(item, requirements);
  assert.equal(shortlist.length, 0, "no equipment-type match exists on either side, so nothing is manufactured into relevance");
});

test("worker exposes the supersede correction path and reuses versioning columns (no new schema, no delete)", async () => {
  const [worker, schema] = await Promise.all([
    readFile(new URL("../worker/engineering-knowledge-api.mjs", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);
  assert.match(worker, /requirement-links\\\/\(\[\^\/\]\+\)\\\/supersede\$/);
  assert.match(worker, /LINK_NOT_CONFIRMED/);
  assert.match(worker, /reverses_decision_id/);
  assert.doesNotMatch(worker, /DELETE FROM boq_requirement_links/);
  assert.doesNotMatch(worker, /DELETE FROM engineering_knowledge_decisions/);
  assert.match(schema, /supersededAt/);
  assert.match(schema, /reversesDecisionId/);
});

const buildFullDb = () => {
  const raw = new DatabaseSync(":memory:");
  const dir = new URL("../drizzle/", import.meta.url);
  const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) raw.exec(readFileSync(new URL(file, dir), "utf8"));
  return raw;
};

test("Sprint 1.13 -- supersede corrects a Confirmed link end-to-end: preserves the original row, records a reversing decision, and Requirement Profile recomputes without it on the very next read", async () => {
  const raw = buildFullDb();
  const d1 = {
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
      try { const results = []; for (const statement of statements) results.push(await statement.run()); raw.exec("COMMIT"); return results; }
      catch (error) { raw.exec("ROLLBACK"); throw error; }
    },
  };

  const stamp = "2026-08-24T00:00:00.000Z";
  raw.exec(`
    INSERT INTO organizations (id, name) VALUES ('org1','Org');
    INSERT INTO projects (id, name, owner_user_id, organization_id) VALUES ('p1','Project','user1','org1');
    INSERT INTO documents (id, project_id, logical_name, current_version_id, created_by) VALUES ('doc1','p1','spec.pdf','dv1','user1');
    INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by) VALUES ('dv1','doc1',1,'spec.pdf','spec.pdf','pdf','application/pdf',1,'x','k','user1');
    INSERT INTO boq_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, ocr_version, created_by) VALUES ('ext1','doc1','dv1',1,'Completed','1','1','1','user1');
    INSERT INTO boq_items (id, extraction_version_id, project_id, source_document_id, sequence, row_type, description, extraction_confidence, confidence_state, review_status, source_location, original_raw_values, current_values, approved_for_downstream, system_value, normalized_unit, numeric_quantity, section_path)
      VALUES ('boq1','ext1','p1','doc1',1,'BOQ Item','Sounder with Strobe Wal Mounted',90,'High','Approved','{}','[]','{}',1,'Fire Alarm','Each','7','[]');
    INSERT INTO specification_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, model_version, prompt_version, ocr_version, created_by) VALUES ('specext1','doc1','dv1',1,'Completed','1','1','1','1','1','user1');
    INSERT INTO technical_requirements (id, extraction_version_id, project_id, source_document_id, sequence, original_text, normalized_requirement, engineering_domain, domain_source_type, system, requirement_type, requirement_category, confidence, confidence_state, review_status, extraction_method, parser_version, model_version, source_location, original_values, current_values, approved_for_downstream)
      VALUES ('req1','specext1','p1','doc1',1,'Low frequency sounder base shall be listed to UL 268 and UL 464.','low frequency sounder base shall be listed to ul 268 and ul 464','Fire Alarm','Inferred','Fire Alarm','Informational','Compliance',90,'High','Approved','pdfjs','1','1','{}','{}','{}',1);
    INSERT INTO boq_requirement_links (id, project_id, boq_item_id, requirement_id, link_method, confidence, evidence, status, scope_id, version_number, reviewed_by, reviewed_at, review_reason, created_by)
      VALUES ('link1','p1','boq1','req1','Technical Applicability v2','61','[]','Confirmed','boq1',1,'user1','${stamp}','initial (mistaken) confirmation','user1');
    INSERT INTO engineering_knowledge_decisions (id, project_id, entity_type, entity_id, action, reason, scope_type, scope_id, decided_by, decided_role)
      VALUES ('decision1','p1','BOQ Requirement Link','link1','confirm','initial (mistaken) confirmation','BOQ Item','boq1','user1','Project Manager');
  `);

  // localhost is treated as single-user dev mode by resolveApplicationContext,
  // deriving userId/organizationId from these env vars -- the same real
  // context resolution the live worker uses, not a bypass.
  const env = { DB: d1, APP_USER_ID: "user1", APP_ORGANIZATION_ID: "org1", APP_USER_EMAIL: "user1@local.invalid", APP_USER_NAME: "User One" };

  const before = await raw.prepare("SELECT status, superseded_at FROM boq_requirement_links WHERE id='link1'").get();
  assert.equal(before.status, "Confirmed");
  assert.equal(before.superseded_at, null);

  const response = await handleEngineeringKnowledgeApi(new Request("http://localhost/api/requirement-links/link1/supersede", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "requirement_390 describes a smoke-detector sounder base accessory, not this standalone wall Sounder/Strobe unit -- correcting the mistaken confirmation." }) }), env);
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.link.status, "Rejected");
  assert.equal(result.supersededLinkId, "link1");

  // The original row is untouched except for superseded_at -- never deleted, never rewritten.
  const original = await raw.prepare("SELECT status, reviewed_by, review_reason, superseded_at FROM boq_requirement_links WHERE id='link1'").get();
  assert.equal(original.status, "Confirmed");
  assert.equal(original.review_reason, "initial (mistaken) confirmation");
  assert.ok(original.superseded_at, "original must be marked superseded, not deleted or rewritten");

  const corrected = await raw.prepare("SELECT status, previous_version_id, version_number, review_reason FROM boq_requirement_links WHERE id=?").get(result.link.id);
  assert.equal(corrected.status, "Rejected");
  assert.equal(corrected.previous_version_id, "link1");
  assert.equal(corrected.version_number, 2);

  const decision = await raw.prepare("SELECT reverses_decision_id, action FROM engineering_knowledge_decisions WHERE entity_id=?").get(result.link.id);
  assert.equal(decision.action, "supersede");
  assert.equal(decision.reverses_decision_id, "decision1");

  // Downstream: the current (non-superseded) links for this item no longer include the corrected one at all.
  const currentLinks = await raw.prepare("SELECT requirement_id, status FROM boq_requirement_links WHERE boq_item_id='boq1' AND superseded_at IS NULL").all();
  assert.equal(currentLinks.length, 1);
  assert.equal(currentLinks[0].status, "Rejected");
});

// Sprint 1.15 -- real Opera gap: requirement_160 ("components must be
// compatible with the control unit") and requirement_200 ("initiating
// devices... same manufacturer") are real, approved, on-topic evidence for
// Detection Devices and Manual Initiation items, but scoreRequirementLink
// can never surface them for any specific item (no equipment-specific text
// -- see Sprint 1.13). Proves the smallest governed path that reuses
// boq_requirement_links.scope_type/scope_id (already declared, always
// 'BOQ Item' until now) to let an EXPLICITLY, evidence-backed classified
// system-wide requirement reach every CURRENT item whose real APPROVED
// Understanding category matches -- and nowhere else.
test("Sprint 1.15 -- propagate-system-wide reaches only the explicitly-classified governed categories, using each item's real approved Understanding, never a different system or an unapproved item", async () => {
  const raw = buildFullDb();
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
      try { const results = []; for (const statement of statements) results.push(await statement.run()); raw.exec("COMMIT"); return results; }
      catch (error) { raw.exec("ROLLBACK"); throw error; }
    },
  });
  const DB = d1(raw);

  raw.exec(`
    INSERT INTO organizations (id, name) VALUES ('org1','Org');
    INSERT INTO projects (id, name, owner_user_id, organization_id) VALUES ('p1','Project','user1','org1');
    INSERT INTO documents (id, project_id, logical_name, current_version_id, created_by) VALUES ('doc1','p1','spec.pdf','dv1','user1');
    INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by) VALUES ('dv1','doc1',1,'spec.pdf','spec.pdf','pdf','application/pdf',1,'x','k','user1');
    INSERT INTO boq_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, ocr_version, created_by) VALUES ('ext1','doc1','dv1',1,'Completed','1','1','1','user1');
    INSERT INTO specification_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, model_version, prompt_version, ocr_version, created_by) VALUES ('specext1','doc1','dv1',1,'Completed','1','1','1','1','1','user1');
    INSERT INTO technical_requirements (id, extraction_version_id, project_id, source_document_id, sequence, original_text, normalized_requirement, engineering_domain, domain_source_type, system, requirement_type, requirement_category, confidence, confidence_state, review_status, extraction_method, parser_version, model_version, source_location, original_values, current_values, approved_for_downstream)
      VALUES ('req-compat','specext1','p1','doc1',1,'Certification that components are compatible with the control unit.','certification that components are compatible with the control unit','Fire Alarm','Inferred','Fire Alarm','Informational','Compliance',90,'High','Approved','pdfjs','1','1','{}','{}','{}',1);
    INSERT INTO technical_requirements (id, extraction_version_id, project_id, source_document_id, sequence, original_text, normalized_requirement, engineering_domain, domain_source_type, system, requirement_type, requirement_category, confidence, confidence_state, review_status, extraction_method, parser_version, model_version, source_location, original_values, current_values, approved_for_downstream)
      VALUES ('req-manufacturer','specext1','p1','doc1',2,'Provide initiating devices made by the same manufacturer.','provide initiating devices made by the same manufacturer','Fire Alarm','Inferred','Fire Alarm','Mandatory','Compliance',90,'High','Approved','pdfjs','1','1','{}','{}','{}',1);
    INSERT INTO technical_requirements (id, extraction_version_id, project_id, source_document_id, sequence, original_text, normalized_requirement, engineering_domain, domain_source_type, system, requirement_type, requirement_category, confidence, confidence_state, review_status, extraction_method, parser_version, model_version, source_location, original_values, current_values, approved_for_downstream)
      VALUES ('req-not-approved','specext1','p1','doc1',3,'Some other clause.','some other clause','Fire Alarm','Inferred','Fire Alarm','Informational','Compliance',90,'High','Needs Review','pdfjs','1','1','{}','{}','{}',0);
  `);

  const items = [
    { id: "boq-detector", description: "Addressable Smoke Detector Ceiling Mounted", system: "Fire Alarm", category: "Detection Devices", equipmentType: "Addressable Smoke Detector", productFamily: "Addressable Smoke Detector" },
    { id: "boq-mcp", description: "Manual Call Point MCLP", system: "Fire Alarm", category: "Manual Initiation", equipmentType: "Manual Call Point", productFamily: "Manual Call Point" },
    { id: "boq-sounder", description: "Sounder with Strobe Wall Mounted", system: "Fire Alarm", category: "Notification Devices", equipmentType: "Sounder/Strobe", productFamily: "Sounder/Strobe" },
    { id: "boq-cctv", description: "Fixed dome camera", system: "CCTV", category: "Detection Devices", equipmentType: "Fixed Camera", productFamily: "Fixed Camera" },
  ];
  for (const [index, itemFixture] of items.entries()) {
    raw.prepare(`INSERT INTO boq_items (id, extraction_version_id, project_id, source_document_id, sequence, row_type, description, extraction_confidence, confidence_state, review_status, source_location, original_raw_values, current_values, approved_for_downstream, system_value, normalized_unit, original_unit, numeric_quantity, original_quantity, section_path)
      VALUES (?,'ext1','p1','doc1',?,'BOQ Item',?,90,'High','Approved','null','[]','{}',1,?,'Each','Each','1','1','[]')`).run(itemFixture.id, index + 1, itemFixture.description, itemFixture.system);
  }

  // Reusable across both the initial approval and any later re-approval this
  // test needs after propagate-system-wide changes an item's
  // confirmedSpecification (the same real Sprint 1.9 revalidation lifecycle
  // proven live on Opera -- linking new evidence correctly requires a fresh
  // interpretation + re-approval through the normal governed path, it is not
  // a bug in propagate-system-wide).
  let approvalCounter = 0;
  const approveItem = async (itemFixture) => {
    const specs = (await confirmedSpecifications(DB, "p1"))[itemFixture.id] || [];
    const input = prepareBoqUnderstandingInput({ id: itemFixture.id, rowType: "BOQ Item", description: itemFixture.description, numericQuantity: "1", originalQuantity: "1", normalizedUnit: "Each", originalUnit: "Each", system: itemFixture.system, category: null, subcategory: null, manufacturer: null, model: null, partNumber: null, currentValues: {}, sourceLocation: null }, specs);
    const inputFingerprint = interpretationInputFingerprint(input);
    const candidate = input.taxonomyContext.families.find((entry) => entry.category === itemFixture.category && entry.family === itemFixture.productFamily);
    const response = {
      normalizedDescription: { value: itemFixture.description, origin: "EXTRACTED", confidence: 100 },
      system: { value: itemFixture.system, origin: "EXTRACTED", confidence: 95 },
      category: { value: itemFixture.category, origin: "EXTRACTED", confidence: 90 },
      equipmentType: { value: itemFixture.equipmentType, origin: "EXTRACTED", confidence: 90 },
      productFamily: { value: itemFixture.productFamily, origin: "EXTRACTED", confidence: 90 },
      ...(candidate ? { taxonomyCandidateKey: { value: candidate.selectionKey, origin: "EXTRACTED", confidence: 95 } } : {}),
      technicalAttributes: [], standards: [], manufacturerEvidence: [], compatibilityRequirements: [], requiredAccessories: [],
      searchTerms: [], missingInformation: [], ambiguities: [], confidence: "HIGH",
    };
    const merged = validateAndMergeBoqInterpretation(input, response);
    const uniq = `${itemFixture.id}-${++approvalCounter}`;
    raw.exec(`INSERT INTO estimator_understanding_runs (id,project_id,organization_id,provider,model,model_version,prompt_version,schema_version,config_fingerprint,status,requested_by) VALUES ('run-${uniq}','p1','org1','test','test','1','1','1','cfg1','COMPLETED','user1')`);
    raw.prepare(`INSERT INTO estimator_item_interpretations (id,run_id,project_id,boq_item_id,version_number,input_fingerprint,config_fingerprint,provider,model,model_version,prompt_version,schema_version,status,validated_interpretation,created_by)
      VALUES (?,?,?,?,(SELECT COALESCE(MAX(version_number),0)+1 FROM estimator_item_interpretations WHERE boq_item_id=?),?,'cfg1','test','test','1','1','1',?,?,'user1')`)
      .run(`interp-${uniq}`, `run-${uniq}`, "p1", itemFixture.id, itemFixture.id, inputFingerprint, merged.status, JSON.stringify(merged.interpretation));
    const row = (await loadUnderstandingReviewRows(DB, "p1")).find((entry) => entry.boqItemId === itemFixture.id);
    const approval = await mutateUnderstandingReview(DB, { userId: "user1" }, "p1", row, { action: "APPROVE_INTERPRETATION", expectedVersion: Number(row.reviewVersion || 0), requestId: `req-${uniq}`, selectionAuthority: understandingReviewSelectionAuthority("p1", row), reason: null });
    assert.equal(approval.review?.status, "APPROVED", `${itemFixture.id} must approve cleanly: ${JSON.stringify(approval)}`);
  };
  for (const itemFixture of items) await approveItem(itemFixture);

  const env = { DB, APP_USER_ID: "user1", APP_ORGANIZATION_ID: "org1", APP_USER_EMAIL: "user1@local.invalid", APP_USER_NAME: "User One" };
  const propagate = (requirementId, body) => handleEngineeringKnowledgeApi(new Request(`http://localhost/api/requirements/${requirementId}/propagate-system-wide`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), env).then((response) => response.json().then((result) => ({ status: response.status, result })));

  // Invalid categories are rejected -- nothing invented, nothing partially applied.
  const invalid = await propagate("req-compat", { reason: "System-wide compatibility per clause text.", categories: ["Not A Real Category"] });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.result.error.code, "PROPAGATION_CATEGORIES_INVALID");

  // An unapproved requirement cannot be propagated.
  const unapproved = await propagate("req-not-approved", { reason: "Should not be allowed regardless.", categories: ["Detection Devices"] });
  assert.equal(unapproved.status, 409);
  assert.equal(unapproved.result.error.code, "REQUIREMENT_NOT_APPROVED");

  // requirement_160-equivalent: explicitly classified to Detection Devices + Manual Initiation only (never Notification Devices -- panel compatibility is not proven for Sounder/Strobe).
  const compat = await propagate("req-compat", { reason: "Explicit system-wide compatibility clause; applies to addressable-loop initiating/detection devices, not to conventional notification appliances.", categories: ["Detection Devices", "Manual Initiation"] });
  assert.equal(compat.status, 201, JSON.stringify(compat.result));
  assert.deepEqual(new Set(compat.result.propagatedTo.map((entry) => entry.boqItemId)), new Set(["boq-detector", "boq-mcp"]), "reaches Detection Devices and Manual Initiation only");

  // Propagating req-compat changed boq-detector/boq-mcp's confirmedSpecification,
  // so (exactly like the real Opera 30/31/34/35 revalidation cycle) their
  // Understanding approval must be refreshed through the normal governed path
  // before currentApprovedUnderstandingFacts will recognize them as current again.
  await approveItem(items.find((entry) => entry.id === "boq-detector"));
  await approveItem(items.find((entry) => entry.id === "boq-mcp"));

  // requirement_200-equivalent: task explicitly requires "initiating devices only" -- Notification Devices is deliberately excluded even though the requirement's own text also mentions notification appliances.
  const manufacturer = await propagate("req-manufacturer", { reason: "Manufacturer-consistency constraint scoped to initiating devices only, per governed review.", categories: ["Detection Devices", "Manual Initiation"] });
  assert.equal(manufacturer.status, 201, JSON.stringify(manufacturer.result));
  assert.deepEqual(new Set(manufacturer.result.propagatedTo.map((entry) => entry.boqItemId)), new Set(["boq-detector", "boq-mcp"]));

  // Prove it end to end from the database, not just the response.
  const currentLinksFor = async (itemId) => (await raw.prepare("SELECT requirement_id, status, scope_type, scope_id FROM boq_requirement_links WHERE boq_item_id=? AND superseded_at IS NULL").all(itemId));
  const detectorLinks = await currentLinksFor("boq-detector");
  assert.equal(detectorLinks.length, 2);
  assert.ok(detectorLinks.every((entry) => entry.status === "Confirmed" && entry.scope_type === "Engineering Domain" && entry.scope_id === "Fire Alarm"));

  const mcpLinks = await currentLinksFor("boq-mcp");
  assert.equal(mcpLinks.length, 2);

  // Sounder/Strobe inherits neither -- its family does not require panel compatibility (Sprint 1.14) and was explicitly excluded from requirement_200's category list too.
  const sounderLinks = await currentLinksFor("boq-sounder");
  assert.equal(sounderLinks.length, 0, "Sounder/Strobe must not inherit either system-wide requirement");

  // A different system entirely never receives a Fire Alarm-scoped requirement, even with a coincidentally-matching category name.
  const cctvLinks = await currentLinksFor("boq-cctv");
  assert.equal(cctvLinks.length, 0, "an unrelated system must never receive a Fire Alarm requirement");

  // Re-running with the same categories does not duplicate already-governed links.
  // (req-manufacturer's own propagation just re-triggered the same real revalidation on boq-detector/boq-mcp.)
  await approveItem(items.find((entry) => entry.id === "boq-detector"));
  await approveItem(items.find((entry) => entry.id === "boq-mcp"));
  const repeat = await propagate("req-compat", { reason: "Re-affirming the same classification.", categories: ["Detection Devices", "Manual Initiation"] });
  assert.equal(repeat.status, 201);
  assert.equal(repeat.result.propagatedTo.length, 0);
  assert.equal(repeat.result.skipped.length, 2);
  assert.ok(repeat.result.skipped.every((entry) => /already Confirmed/.test(entry.reason)));
});

// Fire Alarm E2E fix (requirement applicability) -- real Central Kitchen -
// Makkah gap: "the entire fire detection system shall be analogue
// addressable type" never reached Beam Detector because propagate-system-
// wide required a reviewer to hand-enumerate every governed category, and
// nobody had reason to type out every Fire Alarm category for a clause that
// already states its own whole-system scope. Reuses the exact same Sprint
// 1.15 fixtures/harness above to prove the new allSystemCategories path
// reaches every current category in the requirement's own system (never a
// different system), while a family-specific clause with the same flag is
// rejected outright -- the wording check is a real gate, not a formality.
test("Fire Alarm E2E fix -- a genuinely whole-system-worded requirement may propagate to every governed category via allSystemCategories, but a family-specific clause with the same flag is rejected", async () => {
  const raw = buildFullDb();
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
      try { const results = []; for (const statement of statements) results.push(await statement.run()); raw.exec("COMMIT"); return results; }
      catch (error) { raw.exec("ROLLBACK"); throw error; }
    },
  });
  const DB = d1(raw);

  raw.exec(`
    INSERT INTO organizations (id, name) VALUES ('org1','Org');
    INSERT INTO projects (id, name, owner_user_id, organization_id) VALUES ('p1','Project','user1','org1');
    INSERT INTO documents (id, project_id, logical_name, current_version_id, created_by) VALUES ('doc1','p1','spec.pdf','dv1','user1');
    INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by) VALUES ('dv1','doc1',1,'spec.pdf','spec.pdf','pdf','application/pdf',1,'x','k','user1');
    INSERT INTO boq_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, ocr_version, created_by) VALUES ('ext1','doc1','dv1',1,'Completed','1','1','1','user1');
    INSERT INTO specification_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, model_version, prompt_version, ocr_version, created_by) VALUES ('specext1','doc1','dv1',1,'Completed','1','1','1','1','1','user1');
    INSERT INTO technical_requirements (id, extraction_version_id, project_id, source_document_id, sequence, original_text, normalized_requirement, engineering_domain, domain_source_type, system, requirement_type, requirement_category, confidence, confidence_state, review_status, extraction_method, parser_version, model_version, source_location, original_values, current_values, approved_for_downstream)
      VALUES ('req-system-wide','specext1','p1','doc1',1,'The entire fire detection system shall be analogue addressable type.','the entire fire detection system shall be analogue addressable type','Fire Alarm','Inferred','Fire Alarm','Mandatory','Other',83,'Medium','Approved','pdfjs','1','1','{}','{}','{}',1);
    INSERT INTO technical_requirements (id, extraction_version_id, project_id, source_document_id, sequence, original_text, normalized_requirement, engineering_domain, domain_source_type, system, requirement_type, requirement_category, confidence, confidence_state, review_status, extraction_method, parser_version, model_version, source_location, original_values, current_values, approved_for_downstream)
      VALUES ('req-family-specific','specext1','p1','doc1',2,'Heat detector heads shall be rate-of-rise type with a fixed temperature set point.','heat detector heads shall be rate of rise type with a fixed temperature set point','Fire Alarm','Inferred','Fire Alarm','Mandatory','Functional',90,'High','Approved','pdfjs','1','1','{}','{}','{}',1);
  `);

  const items = [
    { id: "boq-detector", description: "Addressable Smoke Detector Ceiling Mounted", system: "Fire Alarm", category: "Detection Devices", equipmentType: "Addressable Smoke Detector", productFamily: "Addressable Smoke Detector" },
    { id: "boq-mcp", description: "Manual Call Point MCLP", system: "Fire Alarm", category: "Manual Initiation", equipmentType: "Manual Call Point", productFamily: "Manual Call Point" },
    { id: "boq-sounder", description: "Sounder with Strobe Wall Mounted", system: "Fire Alarm", category: "Notification Devices", equipmentType: "Sounder/Strobe", productFamily: "Sounder/Strobe" },
    { id: "boq-cctv", description: "Fixed dome camera", system: "CCTV", category: "Detection Devices", equipmentType: "Fixed Camera", productFamily: "Fixed Camera" },
  ];
  for (const [index, itemFixture] of items.entries()) {
    raw.prepare(`INSERT INTO boq_items (id, extraction_version_id, project_id, source_document_id, sequence, row_type, description, extraction_confidence, confidence_state, review_status, source_location, original_raw_values, current_values, approved_for_downstream, system_value, normalized_unit, original_unit, numeric_quantity, original_quantity, section_path)
      VALUES (?,'ext1','p1','doc1',?,'BOQ Item',?,90,'High','Approved','null','[]','{}',1,?,'Each','Each','1','1','[]')`).run(itemFixture.id, index + 1, itemFixture.description, itemFixture.system);
  }
  const approveItem = async (itemFixture, counterRef) => {
    const specs = (await confirmedSpecifications(DB, "p1"))[itemFixture.id] || [];
    const input = prepareBoqUnderstandingInput({ id: itemFixture.id, rowType: "BOQ Item", description: itemFixture.description, numericQuantity: "1", originalQuantity: "1", normalizedUnit: "Each", originalUnit: "Each", system: itemFixture.system, category: null, subcategory: null, manufacturer: null, model: null, partNumber: null, currentValues: {}, sourceLocation: null }, specs);
    const inputFingerprint = interpretationInputFingerprint(input);
    const candidate = input.taxonomyContext.families.find((entry) => entry.category === itemFixture.category && entry.family === itemFixture.productFamily);
    const response = {
      normalizedDescription: { value: itemFixture.description, origin: "EXTRACTED", confidence: 100 },
      system: { value: itemFixture.system, origin: "EXTRACTED", confidence: 95 },
      category: { value: itemFixture.category, origin: "EXTRACTED", confidence: 90 },
      equipmentType: { value: itemFixture.equipmentType, origin: "EXTRACTED", confidence: 90 },
      productFamily: { value: itemFixture.productFamily, origin: "EXTRACTED", confidence: 90 },
      ...(candidate ? { taxonomyCandidateKey: { value: candidate.selectionKey, origin: "EXTRACTED", confidence: 95 } } : {}),
      technicalAttributes: [], standards: [], manufacturerEvidence: [], compatibilityRequirements: [], requiredAccessories: [],
      searchTerms: [], missingInformation: [], ambiguities: [], confidence: "HIGH",
    };
    const merged = validateAndMergeBoqInterpretation(input, response);
    const uniq = `${itemFixture.id}-${++counterRef.n}`;
    raw.exec(`INSERT INTO estimator_understanding_runs (id,project_id,organization_id,provider,model,model_version,prompt_version,schema_version,config_fingerprint,status,requested_by) VALUES ('run-${uniq}','p1','org1','test','test','1','1','1','cfg1','COMPLETED','user1')`);
    raw.prepare(`INSERT INTO estimator_item_interpretations (id,run_id,project_id,boq_item_id,version_number,input_fingerprint,config_fingerprint,provider,model,model_version,prompt_version,schema_version,status,validated_interpretation,created_by)
      VALUES (?,?,?,?,(SELECT COALESCE(MAX(version_number),0)+1 FROM estimator_item_interpretations WHERE boq_item_id=?),?,'cfg1','test','test','1','1','1',?,?,'user1')`)
      .run(`interp-${uniq}`, `run-${uniq}`, "p1", itemFixture.id, itemFixture.id, inputFingerprint, merged.status, JSON.stringify(merged.interpretation));
    const row = (await loadUnderstandingReviewRows(DB, "p1")).find((entry) => entry.boqItemId === itemFixture.id);
    const approval = await mutateUnderstandingReview(DB, { userId: "user1" }, "p1", row, { action: "APPROVE_INTERPRETATION", expectedVersion: Number(row.reviewVersion || 0), requestId: `req-${uniq}`, selectionAuthority: understandingReviewSelectionAuthority("p1", row), reason: null });
    assert.equal(approval.review?.status, "APPROVED", `${itemFixture.id} must approve cleanly: ${JSON.stringify(approval)}`);
  };
  const counterRef = { n: 0 };
  for (const itemFixture of items) await approveItem(itemFixture, counterRef);

  const env = { DB, APP_USER_ID: "user1", APP_ORGANIZATION_ID: "org1", APP_USER_EMAIL: "user1@local.invalid", APP_USER_NAME: "User One" };
  const propagate = (requirementId, body) => handleEngineeringKnowledgeApi(new Request(`http://localhost/api/requirements/${requirementId}/propagate-system-wide`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), env).then((response) => response.json().then((result) => ({ status: response.status, result })));

  // The family-specific clause has no "entire ... system" wording -- allSystemCategories must be refused, not silently downgraded to a partial list.
  const rejected = await propagate("req-family-specific", { reason: "Trying to broaden a family-specific clause.", allSystemCategories: true });
  assert.equal(rejected.status, 422);
  assert.equal(rejected.result.error.code, "REQUIREMENT_NOT_SYSTEM_WIDE_SCOPED");

  // The genuinely whole-system clause reaches every current Fire Alarm category -- Detection Devices, Manual Initiation, AND Notification Devices (unlike the hand-picked Sprint 1.15 case above, nothing is excluded) -- but never the unrelated CCTV item.
  const propagated = await propagate("req-system-wide", { reason: "Requirement text itself states the entire fire detection system shall be addressable.", allSystemCategories: true });
  assert.equal(propagated.status, 201, JSON.stringify(propagated.result));
  assert.deepEqual(new Set(propagated.result.propagatedTo.map((entry) => entry.boqItemId)), new Set(["boq-detector", "boq-mcp", "boq-sounder"]), "reaches every current Fire Alarm category, including Notification Devices this time, since the requirement's own text names no exclusion");

  const currentLinksFor = async (itemId) => (await raw.prepare("SELECT requirement_id, status, scope_type, scope_id, link_method FROM boq_requirement_links WHERE boq_item_id=? AND requirement_id='req-system-wide' AND superseded_at IS NULL").all(itemId));
  const detectorLinks = await currentLinksFor("boq-detector");
  assert.equal(detectorLinks.length, 1);
  assert.equal(detectorLinks[0].status, "Confirmed");
  assert.equal(detectorLinks[0].scope_type, "Engineering Domain");
  assert.match(detectorLinks[0].link_method, /whole-system wording/);

  const cctvLinks = await currentLinksFor("boq-cctv");
  assert.equal(cctvLinks.length, 0, "a different system must never receive this Fire Alarm-scoped requirement even with allSystemCategories");
});

// Fire Alarm E2E fix (requirement applicability, follow-up) -- real Central
// Kitchen - Makkah gap found while re-validating the fix above: "the entire
// fire detection system shall be analogue addressable type" DOES carry a
// structured `addressing` attribute once seeded (see
// scripts/seed-central-kitchen-system-wide-addressing-requirement-attribute.mjs),
// and propagating it with allSystemCategories reached Notification Devices
// too -- but every Notification Devices product in the real catalog lacks
// any recorded `addressing` value, so the requirement blocked every
// candidate in that category outright. Notification appliances are wired on
// a conventional circuit even in a fully addressable system; they were never
// meant to be governed by this clause. Proves the narrowing: a whole-system
// requirement whose OWN structured attributes concern addressable-loop
// participation (addressing/protocol/compatible_panel_family/loop_compatibility)
// reaches only the addressable-loop categories (Detection Devices, Manual
// Initiation here) even under allSystemCategories, while a whole-system
// requirement with no such attribute (the test above) still reaches every
// category unchanged.
test("Fire Alarm E2E fix -- a whole-system requirement carrying an addressable-loop attribute (addressing) narrows allSystemCategories to loop-participation categories, excluding Notification Devices", async () => {
  const raw = buildFullDb();
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
      try { const results = []; for (const statement of statements) results.push(await statement.run()); raw.exec("COMMIT"); return results; }
      catch (error) { raw.exec("ROLLBACK"); throw error; }
    },
  });
  const DB = d1(raw);

  raw.exec(`
    INSERT INTO organizations (id, name) VALUES ('org1','Org');
    INSERT INTO projects (id, name, owner_user_id, organization_id) VALUES ('p1','Project','user1','org1');
    INSERT INTO documents (id, project_id, logical_name, current_version_id, created_by) VALUES ('doc1','p1','spec.pdf','dv1','user1');
    INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by) VALUES ('dv1','doc1',1,'spec.pdf','spec.pdf','pdf','application/pdf',1,'x','k','user1');
    INSERT INTO boq_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, ocr_version, created_by) VALUES ('ext1','doc1','dv1',1,'Completed','1','1','1','user1');
    INSERT INTO specification_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, model_version, prompt_version, ocr_version, created_by) VALUES ('specext1','doc1','dv1',1,'Completed','1','1','1','1','1','user1');
    INSERT INTO technical_requirements (id, extraction_version_id, project_id, source_document_id, sequence, original_text, normalized_requirement, engineering_domain, domain_source_type, system, requirement_type, requirement_category, confidence, confidence_state, review_status, extraction_method, parser_version, model_version, source_location, original_values, current_values, approved_for_downstream)
      VALUES ('req-addressing','specext1','p1','doc1',1,'The entire fire detection system shall be analogue addressable type.','the entire fire detection system shall be analogue addressable type','Fire Alarm','Inferred','Fire Alarm','Mandatory','Other',83,'Medium','Approved','pdfjs','1','1','{}','{}','{}',1);
    INSERT INTO requirement_attributes (id, requirement_id, name, operator, original_value, normalized_value, confidence, source_location)
      VALUES ('reqattr-addressing','req-addressing','addressing','Equal','The entire fire detection system shall be analogue addressable type','Addressable',90,'{}');
  `);

  const items = [
    { id: "boq-detector", description: "Addressable Smoke Detector Ceiling Mounted", system: "Fire Alarm", category: "Detection Devices", equipmentType: "Addressable Smoke Detector", productFamily: "Addressable Smoke Detector" },
    { id: "boq-mcp", description: "Manual Call Point MCLP", system: "Fire Alarm", category: "Manual Initiation", equipmentType: "Manual Call Point", productFamily: "Manual Call Point" },
    { id: "boq-sounder", description: "Sounder with Strobe Wall Mounted", system: "Fire Alarm", category: "Notification Devices", equipmentType: "Sounder/Strobe", productFamily: "Sounder/Strobe" },
  ];
  for (const [index, itemFixture] of items.entries()) {
    raw.prepare(`INSERT INTO boq_items (id, extraction_version_id, project_id, source_document_id, sequence, row_type, description, extraction_confidence, confidence_state, review_status, source_location, original_raw_values, current_values, approved_for_downstream, system_value, normalized_unit, original_unit, numeric_quantity, original_quantity, section_path)
      VALUES (?,'ext1','p1','doc1',?,'BOQ Item',?,90,'High','Approved','null','[]','{}',1,?,'Each','Each','1','1','[]')`).run(itemFixture.id, index + 1, itemFixture.description, itemFixture.system);
  }
  const approveItem = async (itemFixture, counterRef) => {
    const specs = (await confirmedSpecifications(DB, "p1"))[itemFixture.id] || [];
    const input = prepareBoqUnderstandingInput({ id: itemFixture.id, rowType: "BOQ Item", description: itemFixture.description, numericQuantity: "1", originalQuantity: "1", normalizedUnit: "Each", originalUnit: "Each", system: itemFixture.system, category: null, subcategory: null, manufacturer: null, model: null, partNumber: null, currentValues: {}, sourceLocation: null }, specs);
    const inputFingerprint = interpretationInputFingerprint(input);
    const candidate = input.taxonomyContext.families.find((entry) => entry.category === itemFixture.category && entry.family === itemFixture.productFamily);
    const response = {
      normalizedDescription: { value: itemFixture.description, origin: "EXTRACTED", confidence: 100 },
      system: { value: itemFixture.system, origin: "EXTRACTED", confidence: 95 },
      category: { value: itemFixture.category, origin: "EXTRACTED", confidence: 90 },
      equipmentType: { value: itemFixture.equipmentType, origin: "EXTRACTED", confidence: 90 },
      productFamily: { value: itemFixture.productFamily, origin: "EXTRACTED", confidence: 90 },
      ...(candidate ? { taxonomyCandidateKey: { value: candidate.selectionKey, origin: "EXTRACTED", confidence: 95 } } : {}),
      technicalAttributes: [], standards: [], manufacturerEvidence: [], compatibilityRequirements: [], requiredAccessories: [],
      searchTerms: [], missingInformation: [], ambiguities: [], confidence: "HIGH",
    };
    const merged = validateAndMergeBoqInterpretation(input, response);
    const uniq = `${itemFixture.id}-${++counterRef.n}`;
    raw.exec(`INSERT INTO estimator_understanding_runs (id,project_id,organization_id,provider,model,model_version,prompt_version,schema_version,config_fingerprint,status,requested_by) VALUES ('run-${uniq}','p1','org1','test','test','1','1','1','cfg1','COMPLETED','user1')`);
    raw.prepare(`INSERT INTO estimator_item_interpretations (id,run_id,project_id,boq_item_id,version_number,input_fingerprint,config_fingerprint,provider,model,model_version,prompt_version,schema_version,status,validated_interpretation,created_by)
      VALUES (?,?,?,?,(SELECT COALESCE(MAX(version_number),0)+1 FROM estimator_item_interpretations WHERE boq_item_id=?),?,'cfg1','test','test','1','1','1',?,?,'user1')`)
      .run(`interp-${uniq}`, `run-${uniq}`, "p1", itemFixture.id, itemFixture.id, inputFingerprint, merged.status, JSON.stringify(merged.interpretation));
    const row = (await loadUnderstandingReviewRows(DB, "p1")).find((entry) => entry.boqItemId === itemFixture.id);
    const approval = await mutateUnderstandingReview(DB, { userId: "user1" }, "p1", row, { action: "APPROVE_INTERPRETATION", expectedVersion: Number(row.reviewVersion || 0), requestId: `req-${uniq}`, selectionAuthority: understandingReviewSelectionAuthority("p1", row), reason: null });
    assert.equal(approval.review?.status, "APPROVED", `${itemFixture.id} must approve cleanly: ${JSON.stringify(approval)}`);
  };
  const counterRef = { n: 0 };
  for (const itemFixture of items) await approveItem(itemFixture, counterRef);

  const env = { DB, APP_USER_ID: "user1", APP_ORGANIZATION_ID: "org1", APP_USER_EMAIL: "user1@local.invalid", APP_USER_NAME: "User One" };
  const propagate = (requirementId, body) => handleEngineeringKnowledgeApi(new Request(`http://localhost/api/requirements/${requirementId}/propagate-system-wide`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), env).then((response) => response.json().then((result) => ({ status: response.status, result })));

  const propagated = await propagate("req-addressing", { reason: "Requirement text itself states the entire fire detection system shall be addressable, and structures an addressing=Addressable fact.", allSystemCategories: true });
  assert.equal(propagated.status, 201, JSON.stringify(propagated.result));
  assert.deepEqual(new Set(propagated.result.propagatedTo.map((entry) => entry.boqItemId)), new Set(["boq-detector", "boq-mcp"]), "an addressing-attribute whole-system requirement reaches only addressable-loop categories, never Notification Devices");
  assert.deepEqual(new Set(propagated.result.categories), new Set(["Detection Devices", "Manual Initiation", "Modules and Interfaces", "Control Equipment"]), "categories are narrowed to the loop-participation subset, not every governed category");
  assert.ok(!propagated.result.categories.includes("Notification Devices"), "Notification Devices is excluded from the narrowed category set");

  const currentLinksFor = async (itemId) => (await raw.prepare("SELECT requirement_id, status FROM boq_requirement_links WHERE boq_item_id=? AND requirement_id='req-addressing' AND superseded_at IS NULL").all(itemId));
  assert.equal((await currentLinksFor("boq-sounder")).length, 0, "Notification Devices must not inherit an addressing constraint no catalog evidence supports");
  assert.equal((await currentLinksFor("boq-detector")).length, 1);
});
