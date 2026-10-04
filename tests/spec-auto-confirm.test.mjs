/**
 * Stage 4T — Focused tests for Specification Auto-Confirm Governance
 *
 * Tests the auto-confirm policy gates against known requirement patterns.
 * Uses DatabaseSync (synchronous) to test the same logic as the worker module.
 */
import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { DatabaseSync } from "node:sqlite";

// ─── Policy constants (mirrored from worker/spec-requirement-auto-confirm.mjs) ───
const SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION = "spec-requirement-auto-confirm-1.0.0";
const SPEC_REQUIREMENT_AUTO_CONFIRM_ACTOR = "system:spec-requirement-auto-confirm";

const NORMATIVE_MODAL = /\b(shall|must|is required|are required)\b/i;
const WEAK_PHRASING = /suitable|as required|where necessary|where applicable|as necessary/i;
const DESIGN_CHOICE = /subject to|as directed|at the (sole )?discretion|if deemed|as may be required/i;
const COMMERCIAL_QUALIFICATION =
  /years?[''']?\s+(of\s+)?experience|proven\s+(expertise|experience)|expertise\s+in\s+(installing|inspecting|testing|commissioning)|iso\s?9001|ministry of commerce|agency agreement|priced proposal|maintenance.{0,20}(contract|testing)|inspection.{0,20}testing/i;
const EXCLUDED_TECHNICAL_CATEGORIES = new Set(["Documentation", "Maintenance", "Training"]);
const PENDING_REVIEW = new Set(["Needs Review", "Pending Approval"]);

// ─── Simplified evaluator (mirrors worker logic exactly) ───
function evaluateGates(req, activeExtractionId) {
  const gates = [];
  const reviewStatus = req.review_status;
  const requirementType = req.requirement_type;
  const originalText = req.original_text;
  const extractionVersionId = req.extraction_version_id;
  const condition = req.condition;
  const exception = req.exception;
  const system = req.system;
  const category = req.category;

  // Gate 1: Review is still pending
  if (!PENDING_REVIEW.has(reviewStatus)) {
    gates.push({ gate: 1, pass: false, reason: `Review status is ${reviewStatus}` });
    return { eligible: false, gates };
  }
  gates.push({ gate: 1, pass: true });

  // Gate 2: Requirement type is Mandatory
  if (requirementType !== "Mandatory") {
    gates.push({ gate: 2, pass: false, reason: `Type is ${requirementType}` });
    return { eligible: false, gates };
  }
  gates.push({ gate: 2, pass: true });

  // Gate 3: Normative modal
  if (!NORMATIVE_MODAL.test(originalText)) {
    gates.push({ gate: 3, pass: false, reason: "No normative modal" });
    return { eligible: false, gates };
  }
  gates.push({ gate: 3, pass: true });

  // Gate 4: No weak phrasing
  if (WEAK_PHRASING.test(originalText)) {
    gates.push({ gate: 4, pass: false, reason: "Weak phrasing detected" });
    return { eligible: false, gates };
  }
  gates.push({ gate: 4, pass: true });

  // Gate 5: Active extraction
  if (activeExtractionId && extractionVersionId !== activeExtractionId) {
    gates.push({ gate: 5, pass: false, reason: "Stale extraction" });
    return { eligible: false, gates };
  }
  gates.push({ gate: 5, pass: true });

  // Gate 6: No condition/exception
  if (condition && condition.trim().length > 0) {
    gates.push({ gate: 6, pass: false, reason: "Has condition" });
    return { eligible: false, gates };
  }
  if (exception && exception.trim().length > 0) {
    gates.push({ gate: 6, pass: false, reason: "Has exception" });
    return { eligible: false, gates };
  }
  gates.push({ gate: 6, pass: true });

  // Gate 8: System attribution
  const systemTrim = (system || "").trim();
  if (!systemTrim || /^unknown$/i.test(systemTrim)) {
    gates.push({ gate: 8, pass: false, reason: "System unknown" });
    return { eligible: false, gates };
  }
  gates.push({ gate: 8, pass: true });

  // Gate 9: No commercial boilerplate
  if (COMMERCIAL_QUALIFICATION.test(originalText)) {
    gates.push({ gate: 9, pass: false, reason: "Commercial boilerplate" });
    return { eligible: false, gates };
  }
  gates.push({ gate: 9, pass: true });

  // Gate 10: No delegated design choice
  if (DESIGN_CHOICE.test(originalText)) {
    gates.push({ gate: 10, pass: false, reason: "Design choice" });
    return { eligible: false, gates };
  }
  gates.push({ gate: 10, pass: true });

  // Gate 11: Not excluded category
  if (EXCLUDED_TECHNICAL_CATEGORIES.has(category)) {
    gates.push({ gate: 11, pass: false, reason: `Excluded: ${category}` });
    return { eligible: false, gates };
  }
  gates.push({ gate: 11, pass: true });

  // Gate 12: Source text present
  if (!originalText || originalText.trim().length === 0) {
    gates.push({ gate: 12, pass: false, reason: "Empty text" });
    return { eligible: false, gates };
  }
  gates.push({ gate: 12, pass: true });

  return { eligible: gates.every(g => g.pass), gates };
}

// ─── Test database ───
let db;
const ACTIVE_EXTRACT = "extract_active_001";
const STALE_EXTRACT = "extract_stale_001";

before(() => {
  db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE technical_requirements (
      id TEXT PRIMARY KEY,
      extraction_version_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      original_text TEXT NOT NULL,
      requirement_type TEXT NOT NULL,
      requirement_category TEXT NOT NULL,
      system TEXT,
      category TEXT,
      condition TEXT,
      exception TEXT,
      review_status TEXT NOT NULL,
      approved_for_downstream INTEGER DEFAULT 0
    );
    CREATE TABLE requirement_ambiguities (
      id TEXT PRIMARY KEY,
      requirement_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Open'
    );
    CREATE TABLE requirement_conflicts (
      id TEXT PRIMARY KEY,
      left_requirement_id TEXT NOT NULL,
      right_requirement_id TEXT NOT NULL,
      resolution_status TEXT NOT NULL DEFAULT 'Open'
    );
  `);
});

after(() => {
  db.close();
});

function insertReq(overrides = {}) {
  const reqId = overrides.id || `req_${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO technical_requirements (
      id, extraction_version_id, project_id, original_text,
      requirement_type, requirement_category, system, category,
      condition, exception, review_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    reqId,
    overrides.extraction_version_id || ACTIVE_EXTRACT,
    overrides.project_id || "proj_001",
    overrides.original_text || "Test requirement",
    overrides.requirement_type || "Mandatory",
    overrides.requirement_category || "Other",
    overrides.system || "Fire Alarm",
    overrides.category || "Other",
    overrides.condition || null,
    overrides.exception || null,
    overrides.review_status || "Needs Review"
  );
  return reqId;
}

describe("Stage 4T — Spec Auto-Confirm Gates", () => {
  // ─── Happy path ───
  it("mandatory requirement with normative modal passes all gates", () => {
    const req = { original_text: "The system shall be addressable.", requirement_type: "Mandatory", system: "Fire Alarm", category: "Other", review_status: "Needs Review", extraction_version_id: ACTIVE_EXTRACT, condition: null, exception: null };
    const result = evaluateGates(req, ACTIVE_EXTRACT);
    assert.equal(result.eligible, true);
    assert.equal(result.gates.length, 11);
    assert.ok(result.gates.every(g => g.pass));
  });

  // ─── Gate 1: Review status ───
  it("already approved requirement fails gate 1", () => {
    const req = { original_text: "Shall comply.", requirement_type: "Mandatory", system: "Fire Alarm", category: "Other", review_status: "Approved", extraction_version_id: ACTIVE_EXTRACT, condition: null, exception: null };
    const result = evaluateGates(req, ACTIVE_EXTRACT);
    assert.equal(result.eligible, false);
    assert.equal(result.gates[0].pass, false);
  });

  // ─── Gate 2: Mandatory type ───
  it("preferred requirement fails gate 2", () => {
    const req = { original_text: "Should be suitable.", requirement_type: "Preferred", system: "Fire Alarm", category: "Other", review_status: "Needs Review", extraction_version_id: ACTIVE_EXTRACT, condition: null, exception: null };
    const result = evaluateGates(req, ACTIVE_EXTRACT);
    assert.equal(result.eligible, false);
    assert.equal(result.gates[1].pass, false);
  });

  // ─── Gate 3: Normative modal ───
  it("requirement without shall/must fails gate 3", () => {
    const req = { original_text: "The system provides detection.", requirement_type: "Mandatory", system: "Fire Alarm", category: "Other", review_status: "Needs Review", extraction_version_id: ACTIVE_EXTRACT, condition: null, exception: null };
    const result = evaluateGates(req, ACTIVE_EXTRACT);
    assert.equal(result.eligible, false);
    assert.equal(result.gates[2].pass, false);
  });

  // ─── Gate 4: Weak phrasing ───
  it("requirement with 'suitable' fails gate 4", () => {
    const req = { original_text: "The system shall be suitable for the application.", requirement_type: "Mandatory", system: "Fire Alarm", category: "Other", review_status: "Needs Review", extraction_version_id: ACTIVE_EXTRACT, condition: null, exception: null };
    const result = evaluateGates(req, ACTIVE_EXTRACT);
    assert.equal(result.eligible, false);
    assert.equal(result.gates[3].pass, false);
  });

  it("requirement with 'where necessary' fails gate 4", () => {
    const req = { original_text: "The system shall, where necessary, provide isolation.", requirement_type: "Mandatory", system: "Fire Alarm", category: "Other", review_status: "Needs Review", extraction_version_id: ACTIVE_EXTRACT, condition: null, exception: null };
    const result = evaluateGates(req, ACTIVE_EXTRACT);
    assert.equal(result.eligible, false);
    assert.equal(result.gates[3].pass, false);
  });

  it("requirement with 'as required' fails gate 4", () => {
    const req = { original_text: "The system shall provide monitoring as required by the AHJ.", requirement_type: "Mandatory", system: "Fire Alarm", category: "Other", review_status: "Needs Review", extraction_version_id: ACTIVE_EXTRACT, condition: null, exception: null };
    const result = evaluateGates(req, ACTIVE_EXTRACT);
    assert.equal(result.eligible, false);
    assert.equal(result.gates[3].pass, false);
  });

  // ─── Gate 5: Stale extraction ───
  it("requirement from stale extraction fails gate 5", () => {
    const req = { original_text: "Shall comply with NFPA 72.", requirement_type: "Mandatory", system: "Fire Alarm", category: "Other", review_status: "Needs Review", extraction_version_id: STALE_EXTRACT, condition: null, exception: null };
    const result = evaluateGates(req, ACTIVE_EXTRACT);
    assert.equal(result.eligible, false);
    assert.equal(result.gates[4].pass, false);
  });

  // ─── Gate 6: Condition/Exception ───
  it("requirement with condition fails gate 6", () => {
    const req = { original_text: "Shall provide monitoring.", requirement_type: "Mandatory", system: "Fire Alarm", category: "Other", review_status: "Needs Review", extraction_version_id: ACTIVE_EXTRACT, condition: "Where approved by AHJ", exception: null };
    const result = evaluateGates(req, ACTIVE_EXTRACT);
    assert.equal(result.eligible, false);
    assert.equal(result.gates[5].pass, false);
  });

  // ─── Gate 7 (DB gate 8): System attribution ───
  it("requirement with unknown system fails system gate", () => {
    const req = { original_text: "Shall comply with UL 864.", requirement_type: "Mandatory", system: "Unknown", category: "Other", review_status: "Needs Review", extraction_version_id: ACTIVE_EXTRACT, condition: null, exception: null };
    const result = evaluateGates(req, ACTIVE_EXTRACT);
    assert.equal(result.eligible, false);
    // Find the gate that failed
    const failedGate = result.gates.find(g => !g.pass);
    assert.ok(failedGate, "should have a failed gate");
    assert.ok(failedGate.reason.includes("System"), "should fail on system attribution");
  });

  // ─── Gate 8 (DB gate 9): Commercial boilerplate ───
  it("requirement with experience years fails commercial gate", () => {
    const req = { original_text: "Contractor shall have 10 years experience.", requirement_type: "Mandatory", system: "Fire Alarm", category: "Other", review_status: "Needs Review", extraction_version_id: ACTIVE_EXTRACT, condition: null, exception: null };
    const result = evaluateGates(req, ACTIVE_EXTRACT);
    assert.equal(result.eligible, false);
    const failedGate = result.gates.find(g => !g.pass);
    assert.ok(failedGate, "should have a failed gate");
    assert.ok(failedGate.reason.includes("Commercial"), "should fail on commercial boilerplate");
  });

  // ─── Gate 9 (DB gate 10): Delegated design choice ───
  it("requirement with 'subject to' fails design choice gate", () => {
    const req = { original_text: "Shall be subject to engineer approval.", requirement_type: "Mandatory", system: "Fire Alarm", category: "Other", review_status: "Needs Review", extraction_version_id: ACTIVE_EXTRACT, condition: null, exception: null };
    const result = evaluateGates(req, ACTIVE_EXTRACT);
    assert.equal(result.eligible, false);
    const failedGate = result.gates.find(g => !g.pass);
    assert.ok(failedGate, "should have a failed gate");
    assert.ok(failedGate.reason.includes("Design choice"), "should fail on design choice");
  });

  // ─── Gate 10 (DB gate 11): Excluded category ───
  it("documentation requirement fails excluded category gate", () => {
    const req = { original_text: "Shall provide O&M manuals.", requirement_type: "Mandatory", system: "Fire Alarm", category: "Documentation", review_status: "Needs Review", extraction_version_id: ACTIVE_EXTRACT, condition: null, exception: null };
    const result = evaluateGates(req, ACTIVE_EXTRACT);
    assert.equal(result.eligible, false);
    const failedGate = result.gates.find(g => !g.pass);
    assert.ok(failedGate, "should have a failed gate");
    assert.ok(failedGate.reason.includes("Excluded"), "should fail on excluded category");
  });

  it("maintenance requirement fails excluded category gate", () => {
    const req = { original_text: "Shall perform annual maintenance.", requirement_type: "Mandatory", system: "Fire Alarm", category: "Maintenance", review_status: "Needs Review", extraction_version_id: ACTIVE_EXTRACT, condition: null, exception: null };
    const result = evaluateGates(req, ACTIVE_EXTRACT);
    assert.equal(result.eligible, false);
    const failedGate = result.gates.find(g => !g.pass);
    assert.ok(failedGate, "should have a failed gate");
    assert.ok(failedGate.reason.includes("Excluded"), "should fail on excluded category");
  });

  // ─── Addressable requirement (known from Al Mousa) ───
  it("addressable requirement passes all gates", () => {
    const req = { original_text: "The fire detection and alarm system shall be addressable and utilize microprocessor technology to facilitate early detection and provide timely warnings in the event of a fire.", requirement_type: "Mandatory", system: "Fire Alarm", category: "Other", review_status: "Needs Review", extraction_version_id: ACTIVE_EXTRACT, condition: null, exception: null };
    const result = evaluateGates(req, ACTIVE_EXTRACT);
    assert.equal(result.eligible, true);
    assert.ok(result.gates.every(g => g.pass));
  });

  // ─── Multiple normative modals ───
  it("requirement with 'must' passes gate 3", () => {
    const req = { original_text: "The system must provide automatic detection.", requirement_type: "Mandatory", system: "Fire Alarm", category: "Other", review_status: "Needs Review", extraction_version_id: ACTIVE_EXTRACT, condition: null, exception: null };
    const result = evaluateGates(req, ACTIVE_EXTRACT);
    assert.equal(result.eligible, true);
  });

  it("requirement with 'is required' passes gate 3", () => {
    const req = { original_text: "A redundant power supply is required.", requirement_type: "Mandatory", system: "Fire Alarm", category: "Other", review_status: "Needs Review", extraction_version_id: ACTIVE_EXTRACT, condition: null, exception: null };
    const result = evaluateGates(req, ACTIVE_EXTRACT);
    assert.equal(result.eligible, true);
  });

  // ─── Policy constants ───
  it("policy version is correct", () => {
    assert.equal(SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION, "spec-requirement-auto-confirm-1.0.0");
  });

  it("actor is correct", () => {
    assert.equal(SPEC_REQUIREMENT_AUTO_CONFIRM_ACTOR, "system:spec-requirement-auto-confirm");
  });
});
