import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import {
  authorizeTechnicalMatchApproval, buildUnderstandingReviewActionPolicy, buildUnderstandingReviewLayers, evaluateUnderstandingAuthority, sanitizeReviewedInterpretation,
  summarizeUnderstandingReviewItems, understandingDiscoveryState, validateUnderstandingForApproval, validateUnderstandingReviewCommand,
} from "../app/domain/estimator-understanding-review.mjs";
import { mutateUnderstandingReview, understandingReviewSelectionAuthority } from "../worker/estimator-understanding-review-api.mjs";

const fact = (value, origin = "INFERRED", confidence = 70) => ({ value, origin, confidence });
const valid = (overrides = {}) => ({
  normalizedDescription: fact("Addressable smoke detector", "EXTRACTED", 100),
  system: fact("Fire Alarm"), category: fact("Detection Devices"), equipmentType: fact("smoke detector"),
  productFamily: fact("Addressable Smoke Detector"), subcategory: fact(null, "MISSING", 0), attributes: {},
  manufacturerPreferences: [], manufacturerRestrictions: [], standards: [], compatibilityRequirements: [], requiredAccessories: [],
  searchTerms: [], missingInformation: [], ambiguities: [], engineeringNotes: [], reviewReasons: [], confidence: "MEDIUM", ...overrides,
});

test("AI proposal and engineer canonical review remain separate authorities", () => {
  const proposal = valid({
    normalizedDescription: fact("Addressable Flasher", "EXTRACTED", 100),
    system: fact("Fire Alarm", "INFERRED", 70),
    category: fact("Notification Devices", "INFERRED", 70),
    equipmentType: fact("Addressable flasher", "INFERRED", 70),
    productFamily: fact("Strobe", "INFERRED", 70),
  });
  const withoutReview = buildUnderstandingReviewLayers(proposal, valid(), { hasVersion: false, status: "AWAITING_REVIEW", version: 0 });
  assert.deepEqual(withoutReview.proposalClassification, { system: "Fire Alarm", category: "Notification Devices", equipmentType: "Addressable flasher", productFamily: "Strobe", subcategory: null });
  assert.equal(withoutReview.canonicalReview, null);
  assert.equal(withoutReview.aiProposal.productFamily.value, "Strobe");

  const approved = buildUnderstandingReviewLayers(proposal, { ...proposal, equipmentType: fact("visual alarm device") }, { hasVersion: true, status: "APPROVED", version: 2 });
  assert.equal(approved.canonicalReview.version, 2);
  assert.deepEqual(approved.canonicalReview.changedFields, ["equipmentType"]);
  assert.equal(approved.aiProposal.equipmentType.value, "Addressable flasher");
});

test("approval requires essential classification while optional subcategory does not block", () => {
  assert.equal(validateUnderstandingForApproval(valid()).ok, true);
  const missing = validateUnderstandingForApproval(valid({ equipmentType: fact(null, "MISSING", 0) }));
  assert.equal(missing.ok, false); assert.equal(missing.code, "ESSENTIAL_UNDERSTANDING_MISSING");
});

test("action policy enforces the governed transition matrix", () => {
  const waitingBlocked = buildUnderstandingReviewActionPolicy({ reviewStatus: "AWAITING_REVIEW", proposalState: "AVAILABLE", classificationBlockers: ["system"], taxonomyValid: true, authorityValid: true, actorAuthorized: true });
  assert.deepEqual(waitingBlocked.allowedActions, ["EDIT_AND_APPROVE", "REJECT_INTERPRETATION"]);
  assert.equal(waitingBlocked.approvalDenialMessage, "Resolve 1 classification field before approval.");
  assert.equal(waitingBlocked.denialReasons.APPROVE_INTERPRETATION, "BLOCKING_FIELDS_UNRESOLVED");

  const waitingReady = buildUnderstandingReviewActionPolicy({ reviewStatus: "AWAITING_REVIEW", proposalState: "AVAILABLE", taxonomyValid: true, authorityValid: true, actorAuthorized: true });
  assert.deepEqual(waitingReady.allowedActions, ["APPROVE_INTERPRETATION", "EDIT_AND_APPROVE", "REJECT_INTERPRETATION"]);
  assert.deepEqual(buildUnderstandingReviewActionPolicy({ reviewStatus: "APPROVED", proposalState: "AVAILABLE", taxonomyValid: true, authorityValid: true, actorAuthorized: true }).allowedActions, ["RETURN_TO_REVIEW"]);
  assert.deepEqual(buildUnderstandingReviewActionPolicy({ reviewStatus: "REJECTED", proposalState: "AVAILABLE", taxonomyValid: true, authorityValid: true, actorAuthorized: true }).allowedActions, ["RETURN_TO_REVIEW"]);
  for (const proposalState of ["FAILED", "UNAVAILABLE_OR_STALE"]) assert.deepEqual(buildUnderstandingReviewActionPolicy({ reviewStatus: proposalState === "FAILED" ? "FAILED" : "NOT_ANALYZED", proposalState, authorityValid: true, actorAuthorized: true }).allowedActions, []);
});

test("Addressable Flasher understanding approval is separate from matching completeness", () => {
  const flasher = valid({
    normalizedDescription: fact("Addressable Flasher", "EXTRACTED", 100),
    category: fact("Notification Devices"), equipmentType: fact("Flasher"), productFamily: fact("Strobe"),
  });
  const readiness = evaluateUnderstandingAuthority({ interpretation: flasher, reviewStatus: "AWAITING_REVIEW", taxonomyValid: true });
  assert.equal(validateUnderstandingForApproval(flasher).ok, true);
  assert.equal(readiness.understandingApprovalEligible, true);
  assert.equal(readiness.discoveryReadiness.state, "ELIGIBLE_AFTER_UNDERSTANDING_APPROVAL");
  assert.equal(readiness.technicalMatchReadiness.state, "BLOCKED");
  assert.deepEqual(readiness.matchingBlockers.map((entry) => entry.field), ["attributes.product_type", "attributes.protocol", "attributes.compatible_panel_family", "attributes.loop_compatibility", "attributes.operating_voltage"]);
  assert.ok(readiness.laterProjectEvidenceNeeded.every((entry) => entry.state === "AWAITING_PROJECT_EVIDENCE"));
  const approved = evaluateUnderstandingAuthority({ interpretation: flasher, reviewStatus: "APPROVED", taxonomyValid: true });
  assert.equal(approved.discoveryReadiness.state, "DISCOVERY_ONLY");
  assert.equal(approved.technicalMatchReadiness.ready, false);
  const forged = authorizeTechnicalMatchApproval({ interpretation: flasher, reviewStatus: "APPROVED", taxonomyValid: true, technicalMatchReady: true });
  assert.equal(forged.allowed, false);
  assert.equal(forged.code, "TECHNICAL_MATCH_EVIDENCE_INCOMPLETE");
});

test("classification essentials block approval while subcategory remains informational", () => {
  const missing = valid({ system: fact(null, "MISSING", 0) });
  const blocked = evaluateUnderstandingAuthority({ interpretation: missing, taxonomyValid: true });
  assert.deepEqual(blocked.classificationBlockers.map((entry) => entry.field), ["system"]);
  assert.equal(blocked.understandingApprovalEligible, false);
  const optional = evaluateUnderstandingAuthority({ interpretation: valid({ subcategory: fact(null, "MISSING", 0) }), taxonomyValid: true });
  assert.equal(optional.classificationBlockers.length, 0);
  assert.deepEqual(optional.informationalMissing.map((entry) => entry.field), ["subcategory"]);
});

test("family-specific profiles never impose Fire Alarm fields on structured cabling", () => {
  const cable = valid({ system: fact("Structured Cabling"), category: fact("Cables"), equipmentType: fact("Cat6A cable"), productFamily: fact("Structured Cabling Cable") });
  const readiness = evaluateUnderstandingAuthority({ interpretation: cable, taxonomyValid: true });
  const fields = readiness.matchingBlockers.map((entry) => entry.field);
  assert.ok(fields.includes("attributes.cable_category"));
  for (const forbidden of ["attributes.protocol", "attributes.loop_compatibility", "attributes.compatible_panel_family"]) assert.equal(fields.includes(forbidden), false);
  const unknown = evaluateUnderstandingAuthority({ interpretation: valid({ system: fact("CCTV"), category: fact("Cameras"), productFamily: fact("Unknown Camera Family") }), taxonomyValid: true });
  assert.equal(unknown.understandingApprovalEligible, true);
  assert.equal(unknown.technicalMatchReadiness.ready, false);
  assert.deepEqual(unknown.matchingBlockers.map((entry) => entry.field), ["governed_attribute_profile"]);
});

test("future evidence recalculates readiness without changing prior evidence", () => {
  const before = valid({ category: fact("Notification Devices"), equipmentType: fact("Flasher"), productFamily: fact("Strobe") });
  const after = structuredClone(before);
  for (const name of ["product_type", "protocol", "compatible_panel_family", "loop_compatibility", "operating_voltage"]) after.attributes[name] = fact(`${name} evidence`, "EXTRACTED", 90);
  const version1 = evaluateUnderstandingAuthority({ interpretation: before, reviewStatus: "APPROVED", taxonomyValid: true });
  const version2 = evaluateUnderstandingAuthority({ interpretation: after, reviewStatus: "APPROVED", taxonomyValid: true });
  assert.equal(version1.technicalMatchReadiness.ready, false);
  assert.equal(version2.technicalMatchReadiness.ready, true);
  assert.deepEqual(before.attributes, {});
});

test("current-scope summary preserves failed attempts and reconciles exactly", () => {
  const item = (status, attempted = false) => ({ review: { status }, aiAttempted: attempted });
  const items = [
    ...Array.from({ length: 12 }, () => item("AWAITING_REVIEW", true)),
    item("FAILED", true),
    ...Array.from({ length: 191 }, () => item("NOT_ANALYZED", false)),
  ];
  assert.deepEqual(summarizeUnderstandingReviewItems(items), {
    authoritativeCurrentBoqItems: 204, aiAttempted: 13, aiAnalyzed: 13, awaitingReview: 12,
    approved: 0, rejected: 0, failed: 1, notAnalyzed: 191,
  });
});

test("classification approval succeeds without matching fields while missing classification produces zero writes", async () => {
  let batches = 0;
  const db = {
    prepare: () => ({ bind() { return this; }, async first() { return null; } }),
    async batch() { batches += 1; },
  };
  const proposal = valid({
    normalizedDescription: fact("Addressable Flasher", "EXTRACTED", 100),
    category: fact("Notification Devices"), equipmentType: fact("Addressable flasher"), productFamily: fact("Strobe"),
  });
  const blocking = ["operating_voltage", "loop_compatibility", "compatible_panel_family", "protocol", "product_type"];
  const row = {
    boqItemId: "boq-27-06-10", interpretationId: "interpretation-current", interpretationStatus: "NEEDS_REVIEW",
    reviewVersion: 0, evidenceDocumentVersionId: "document-version-current", evidenceExtractionVersion: 1,
    effective: {
      state: "AVAILABLE", selected: { interpretationId: "interpretation-current", versionNumber: 2 }, proposal,
      currentInputFingerprint: "f".repeat(64), requiredAttributeNames: blocking,
      classification: { system: "Fire Alarm", category: "Notification Devices", equipmentType: "Addressable flasher", productFamily: "Strobe" },
      taxonomy: { acceptedCandidate: true }, quality: { blockingMissingFields: blocking.map((name) => `attributes.${name}`), informationalMissingFields: [], reviewReasons: [] },
      latestCurrentAttempt: { status: "NEEDS_REVIEW" },
    },
  };
  const command = { action: "APPROVE_INTERPRETATION", expectedVersion: 0, requestId: "review_forged_approval", selectionAuthority: understandingReviewSelectionAuthority("project", row), reason: null };
  const approved = await mutateUnderstandingReview(db, { userId: "engineer" }, "project", row, command);
  assert.equal(approved.review.status, "APPROVED"); assert.equal(batches, 1);

  batches = 0;
  const missingRow = { ...row, effective: { ...row.effective, proposal: { ...proposal, system: fact(null, "MISSING", 0) }, quality: { ...row.effective.quality, blockingMissingFields: ["system"] } } };
  const incompleteEdit = await mutateUnderstandingReview(db, { userId: "engineer" }, "project", missingRow, { ...command, action: "EDIT_AND_APPROVE", requestId: "review_incomplete_edit", selectionAuthority: understandingReviewSelectionAuthority("project", missingRow), reason: "Complete known fields", canonicalInterpretation: { ...proposal, system: fact(null, "MISSING", 0) } });
  assert.equal(incompleteEdit.error, "ESSENTIAL_UNDERSTANDING_MISSING"); assert.equal(batches, 0);
});

test("Fire Alarm approval uses the shared canonical category and family", () => {
  const invalid = validateUnderstandingForApproval(valid({ productFamily: fact("Invented Detector") }));
  assert.equal(invalid.ok, false); assert.equal(invalid.code, "FIRE_ALARM_TAXONOMY_INVALID");
});

test("governed command is item-only and reasons are mandatory for edit, reject and return", () => {
  const base = { expectedVersion: 0, requestId: "review_request_123", selectionAuthority: "a".repeat(64) };
  for (const action of ["EDIT_AND_APPROVE", "REJECT_INTERPRETATION", "RETURN_TO_REVIEW"]) assert.equal(validateUnderstandingReviewCommand({ ...base, action }).code, "UNDERSTANDING_REVIEW_REASON_REQUIRED");
  assert.equal(validateUnderstandingReviewCommand({ ...base, action: "APPROVE_INTERPRETATION" }).ok, true);
  assert.equal(validateUnderstandingReviewCommand({ ...base, action: "APPROVE_INTERPRETATION", selectionAuthority: "stale" }).ok, false);
  assert.equal(validateUnderstandingReviewCommand({ ...base, action: "APPROVE_INTERPRETATION", itemIds: ["bulk"] }).ok, false);
});

test("reviewed values are separate and unsafe provider fields cannot enter canonical data", () => {
  assert.equal(sanitizeReviewedInterpretation(valid({ raw_response: "secret" })), null);
  const original = valid(); const edited = sanitizeReviewedInterpretation({ ...original, equipmentType: fact("optical smoke detector") });
  assert.equal(original.equipmentType.value, "smoke detector"); assert.equal(edited.equipmentType.value, "optical smoke detector");
  assert.equal("taxonomyCandidateKey" in edited, false);
});

test("interpretation approval grants discovery only and no other authority", () => {
  assert.deepEqual(understandingDiscoveryState("APPROVED", "COMPLETED"), { eligible: true, label: "Understanding approved — ready for product discovery" });
});

test("migration creates versioned immutable reviews and append-only idempotent events", async () => {
  const migration = await readFile(new URL("../drizzle/0060_estimator_understanding_review.sql", import.meta.url), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE projects(id TEXT PRIMARY KEY);
    CREATE TABLE documents(id TEXT PRIMARY KEY,project_id TEXT,current_version_id TEXT,deleted_at TEXT,archived_at TEXT);
    CREATE TABLE document_versions(id TEXT PRIMARY KEY,document_id TEXT);
    CREATE TABLE boq_extraction_versions(id TEXT PRIMARY KEY,document_id TEXT,document_version_id TEXT,version_number INTEGER,status TEXT,superseded_at TEXT);
    CREATE TABLE boq_items(id TEXT PRIMARY KEY,project_id TEXT,row_type TEXT,extraction_version_id TEXT,source_document_id TEXT);
    CREATE TABLE estimator_item_interpretations(id TEXT PRIMARY KEY,boq_item_id TEXT,input_fingerprint TEXT,version_number INTEGER);`);
  db.exec(migration);
  db.exec(`INSERT INTO projects VALUES('p'); INSERT INTO documents VALUES('doc','p','d',NULL,NULL); INSERT INTO document_versions VALUES('d','doc'); INSERT INTO boq_extraction_versions VALUES('x','doc','d',1,'Completed',NULL); INSERT INTO boq_items VALUES('b','p','BOQ Item','x','doc'); INSERT INTO estimator_item_interpretations VALUES('i','b','fp',1);
    INSERT INTO estimator_understanding_review_versions(id,project_id,boq_item_id,interpretation_id,version_number,review_status,canonical_interpretation,source_input_fingerprint,source_document_version_id,source_extraction_version,reviewed_by) VALUES('r','p','b','i',1,'APPROVED','{}','fp','d',1,'u');
    INSERT INTO estimator_understanding_review_events(id,project_id,boq_item_id,interpretation_id,review_version_id,action,new_status,actor_user_id,request_id,request_fingerprint) VALUES('e','p','b','i','r','APPROVE_INTERPRETATION','APPROVED','u','req','hash');`);
  assert.throws(() => db.exec(`UPDATE estimator_understanding_review_versions SET review_status='REJECTED' WHERE id='r'`), /immutable/);
  assert.throws(() => db.exec(`DELETE FROM estimator_understanding_review_events WHERE id='e'`), /append only/);
  assert.throws(() => db.exec(`INSERT INTO estimator_understanding_review_events(id,project_id,boq_item_id,interpretation_id,review_version_id,action,new_status,actor_user_id,request_id,request_fingerprint) VALUES('e2','p','b','i','r','APPROVE_INTERPRETATION','APPROVED','u','req','different')`), /UNIQUE/);
  db.exec(`UPDATE documents SET current_version_id='superseded' WHERE id='doc'`);
  assert.throws(() => db.exec(`INSERT INTO estimator_understanding_review_versions(id,project_id,boq_item_id,interpretation_id,version_number,review_status,canonical_interpretation,source_input_fingerprint,source_document_version_id,source_extraction_version,reviewed_by) VALUES('r2','p','b','i',2,'APPROVED','{}','fp','d',1,'u')`), /evidence is stale/);
});

test("review API and UI preserve current evidence, privacy and downstream boundaries", async () => {
  const [api, ui, index] = await Promise.all([
    readFile(new URL("../worker/estimator-understanding-review-api.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/components/workspaces/AiUnderstandingReviewWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);
  assert.match(api, /currentBoqEvidenceFrom/); assert.match(api, /UNDERSTANDING_REVIEW_STALE/); assert.match(api, /UNDERSTANDING_REVIEW_SELECTION_STALE/); assert.match(api, /UNDERSTANDING_REVIEW_IDEMPOTENCY_CONFLICT/);
  assert.match(api, /ENGINEER_ROLES/); assert.match(api, /UNDERSTANDING_REVIEW_FORBIDDEN/);
  assert.match(api, /db\.batch/); assert.doesNotMatch(api, /INSERT INTO (?:product_match|pricing|project_quotation|review_decisions)/i);
  assert.ok(api.indexOf("selectionAuthority !== understandingReviewSelectionAuthority") < api.indexOf("db.batch"), "selection authority must fail before writes");
  assert.doesNotMatch(ui, /raw_response|raw model output|account.?id|credentials|interpretationId|boqItemId/i);
  assert.match(ui, /No bulk approval/); assert.match(ui, /does not approve a product, technical compliance, price, or quotation/);
  assert.match(index, /handleEstimatorUnderstandingReviewApi/);
});


test("stale selection authority fails before any review write", async () => {
  let batches = 0;
  const db = {
    prepare: () => ({
      bind() { return this; },
      async first() { return null; },
    }),
    async batch() { batches += 1; },
  };
  const row = {
    boqItemId: "boq-current",
    interpretationId: "interpretation-current",
    reviewVersion: 0,
    evidenceDocumentVersionId: "document-version-current",
    evidenceExtractionVersion: 1,
    effective: {
      selected: { interpretationId: "interpretation-current", versionNumber: 3 },
      currentInputFingerprint: "f".repeat(64),
    },
  };
  const result = await mutateUnderstandingReview(
    db,
    { userId: "engineer" },
    "project",
    row,
    {
      action: "APPROVE_INTERPRETATION",
      expectedVersion: 0,
      requestId: "review_stale_selection_runtime",
      selectionAuthority: "0".repeat(64),
      reason: null,
    },
  );

  assert.equal(result.error, "UNDERSTANDING_REVIEW_SELECTION_STALE");
  assert.equal(result.status, 409);
  assert.equal(batches, 0);
});


test("conflicting idempotency replay fails before any review write", async () => {
  let batches = 0;
  const db = {
    prepare: () => ({
      bind() { return this; },
      async first() {
        return {
          requestFingerprint: "persisted-fingerprint-for-another-command",
          reviewVersionId: "existing-review-version",
        };
      },
    }),
    async batch() { batches += 1; },
  };

  const result = await mutateUnderstandingReview(
    db,
    { userId: "engineer" },
    "project",
    {},
    {
      action: "APPROVE_INTERPRETATION",
      expectedVersion: 0,
      requestId: "reused-request-id",
      selectionAuthority: "a".repeat(64),
      reason: null,
    },
  );

  assert.equal(result.error, "UNDERSTANDING_REVIEW_IDEMPOTENCY_CONFLICT");
  assert.equal(result.status, 409);
  assert.equal(batches, 0);
});


test("matching idempotency replay returns the current review without another write", async () => {
  const { createHash } = await import("node:crypto");
  const { understandingReviewRequestFingerprint } = await import("../app/domain/estimator-understanding-review.mjs");

  let batches = 0;
  const command = {
    action: "APPROVE_INTERPRETATION",
    expectedVersion: 0,
    requestId: "matching-replay-request",
    selectionAuthority: "a".repeat(64),
    reason: null,
  };
  const persistedFingerprint = createHash("sha256")
    .update(understandingReviewRequestFingerprint(command))
    .digest("hex");

  const authoritativeRow = {
    boqItemId: "boq-replay-item",
    itemReference: "27.06.10",
    rowType: "BOQ Item",
    description: "Addressable Flasher",
    numericQuantity: 22,
    normalizedUnit: "Each",
    sourceLocation: "{}",
    extractionReviewStatus: "Needs Review",
    extractionApproved: 0,
    evidenceDocumentVersionId: "document-version-current",
    evidenceExtractionVersion: 1,
    reviewVersion: 0,
  };

  const db = {
    prepare(sql) {
      return {
        bind() { return this; },
        async first() {
          assert.match(sql, /estimator_understanding_review_events/);
          return {
            requestFingerprint: persistedFingerprint,
            reviewVersionId: "existing-review-version",
          };
        },
        async all() {
          if (sql.includes("FROM estimator_item_interpretations")) return { results: [] };
          return { results: [authoritativeRow] };
        },
      };
    },
    async batch() { batches += 1; },
  };

  const result = await mutateUnderstandingReview(
    db,
    { userId: "engineer" },
    "project",
    authoritativeRow,
    command,
  );

  assert.equal(result.idempotent, true);
  assert.equal(result.review.status, "NOT_ANALYZED");
  assert.equal(result.review.version, 0);
  assert.equal(batches, 0);
});
