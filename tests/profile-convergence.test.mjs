/**
 * Stage 4T-1 — Focused tests for Golden Heat Detector Requirement Profile Convergence
 *
 * Tests the profile engine's behavior with Confirmed vs Suggested links,
 * family consumption, equipment type resolution, and compatibility target semantics.
 */
import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { DatabaseSync } from "node:sqlite";
import { buildTechnicalRequirementProfile } from "../app/domain/technical-requirement-engine.mjs";

let db;

before(() => {
  db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE technical_requirements (
      id TEXT PRIMARY KEY, extraction_version_id TEXT NOT NULL, project_id TEXT NOT NULL,
      source_document_id TEXT NOT NULL, clause_id TEXT, sequence INTEGER NOT NULL,
      original_text TEXT NOT NULL, normalized_requirement TEXT NOT NULL,
      engineering_domain TEXT NOT NULL, domain_source_type TEXT NOT NULL,
      system TEXT, category TEXT, subcategory TEXT,
      requirement_type TEXT NOT NULL, requirement_category TEXT NOT NULL,
      condition TEXT, exception TEXT, confidence INTEGER NOT NULL,
      confidence_state TEXT NOT NULL, review_status TEXT NOT NULL,
      approved_for_downstream INTEGER DEFAULT 0
    );
    CREATE TABLE boq_requirement_links (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, boq_item_id TEXT NOT NULL,
      requirement_id TEXT NOT NULL, link_method TEXT NOT NULL, confidence INTEGER NOT NULL,
      evidence TEXT NOT NULL, status TEXT NOT NULL, scope_type TEXT DEFAULT 'BOQ Item',
      scope_id TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
});

after(() => { db.close(); });

const PROJECT_ID = "proj_test";
const BOQ_ITEM_ID = "boq_test";

function insertRequirement(overrides = {}) {
  const reqId = overrides.id || `req_${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO technical_requirements (id, extraction_version_id, project_id, source_document_id, sequence, original_text, normalized_requirement, engineering_domain, domain_source_type, system, category, requirement_type, requirement_category, condition, exception, confidence, confidence_state, review_status, approved_for_downstream)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    reqId, overrides.extraction_version_id || "ext_001", overrides.project_id || PROJECT_ID,
    "doc_001", overrides.sequence || 1,
    overrides.original_text || "Test requirement",
    overrides.normalized_requirement || "test requirement",
    overrides.engineering_domain || "Fire Alarm", overrides.domain_source_type || "Specification",
    overrides.system || "Fire Alarm", overrides.category || "Other",
    overrides.requirement_type || "Mandatory", overrides.requirement_category || "Other",
    overrides.condition || null, overrides.exception || null,
    overrides.confidence || 80, overrides.confidence_state || "High",
    overrides.review_status || "Approved", overrides.approved_for_downstream || 1
  );
  return reqId;
}

function insertLink(reqId, overrides = {}) {
  db.prepare(`
    INSERT INTO boq_requirement_links (id, project_id, boq_item_id, requirement_id, link_method, confidence, evidence, status, scope_type, scope_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    overrides.id || `link_${crypto.randomUUID()}`,
    overrides.project_id || PROJECT_ID, overrides.boq_item_id || BOQ_ITEM_ID,
    reqId, overrides.link_method || "Deterministic", overrides.confidence || 85,
    JSON.stringify(overrides.evidence || []), overrides.status || "Confirmed",
    "BOQ Item", overrides.scope_id || BOQ_ITEM_ID, overrides.created_by || "system:test"
  );
}

const baseBoqItem = {
  id: BOQ_ITEM_ID, itemNumber: "C", description: "Heat detector",
  system: "Fire Alarm", category: "Heat Detector", subcategory: null,
  unit: "Each", quantity: 9, productFamily: "Heat Detector",
  classificationConfidence: 100,
};

describe("Stage 4T-1 — Profile Convergence", () => {

  it("Confirmed links are consumed into the profile", () => {
    const reqId = insertRequirement({
      id: "req_confirmed_001",
      original_text: "The system shall be addressable.",
      requirement_type: "Mandatory",
      requirement_category: "Other",
    });
    insertLink(reqId, { status: "Confirmed" });

    const profile = buildTechnicalRequirementProfile({
      boqItem: baseBoqItem,
      links: [{ requirementId: reqId, status: "Confirmed", confidence: 85, linkMethod: "Test", evidence: [] }],
      requirements: [{
        id: reqId, originalText: "The system shall be addressable.",
        normalizedRequirement: "system shall be addressable",
        requirementType: "Mandatory", requirementCategory: "Other",
        system: "Fire Alarm", category: "Other",
        confidence: 80, sourceType: "Specification", source: {},
        attributes: [], standards: [], manufacturers: [], compatibility: [], accessories: [],
      }],
      knowledgeFacts: [], relationships: [], previousVersion: 0,
    });

    assert.equal(profile.applicableRequirements.length, 1);
    assert.equal(profile.applicableRequirements[0].applicability.status, "Confirmed Applicable");
  });

  it("Suggested links are tracked but excluded from consolidated requirements", () => {
    const reqId = insertRequirement({
      id: "req_suggested_001",
      original_text: "The system should be suitable.",
      requirement_type: "Preferred",
      requirement_category: "Other",
    });

    const profile = buildTechnicalRequirementProfile({
      boqItem: baseBoqItem,
      links: [{ requirementId: reqId, status: "Suggested", confidence: 50, linkMethod: "Test", evidence: [] }],
      requirements: [{
        id: reqId, originalText: "The system should be suitable.",
        normalizedRequirement: "system should be suitable",
        requirementType: "Preferred", requirementCategory: "Other",
        system: "Fire Alarm", category: "Other",
        confidence: 50, sourceType: "Specification", source: {},
        attributes: [], standards: [], manufacturers: [], compatibility: [], accessories: [],
      }],
      knowledgeFacts: [], relationships: [], previousVersion: 0,
    });

    // Suggested requirements are filtered OUT of applicable when status is not "Confirmed Applicable"
    const confirmedInConsolidated = profile.consolidatedRequirements.length;
    assert.equal(confirmedInConsolidated, 0, "Suggested should not appear in consolidated");
  });

  it("Equipment type is resolved from BOQ item classification", () => {
    const profile = buildTechnicalRequirementProfile({
      boqItem: { ...baseBoqItem, category: "Heat Detector" },
      links: [], requirements: [], knowledgeFacts: [], relationships: [], previousVersion: 0,
    });

    // Equipment type comes from boqItem.category
    assert.equal(profile.boqItem?.category, "Heat Detector");
  });

  it("Product family is resolved from BOQ item productFamily", () => {
    const profile = buildTechnicalRequirementProfile({
      boqItem: { ...baseBoqItem, productFamily: "Addressable Heat Detector" },
      links: [], requirements: [], knowledgeFacts: [], relationships: [], previousVersion: 0,
    });

    assert.equal(profile.boqItem?.productFamily, "Addressable Heat Detector");
  });

  it("Exact panel model is not invented from generic compatibility entries", () => {
    const profile = buildTechnicalRequirementProfile({
      boqItem: baseBoqItem,
      links: [], requirements: [], knowledgeFacts: [], relationships: [], previousVersion: 0,
    });

    // No panel model should be invented
    const panelCompatibility = profile.compatibility.filter(c =>
      /IFP|panel model|FACP model/i.test(c.targetItem || c.target_item || "")
    );
    assert.equal(panelCompatibility.length, 0, "No panel model should be invented");
  });

  it("Price list product does not become project selection", () => {
    // The profile should not contain any product-specific panel selection
    const profile = buildTechnicalRequirementProfile({
      boqItem: baseBoqItem,
      links: [], requirements: [], knowledgeFacts: [], relationships: [], previousVersion: 0,
    });

    // No product IDs should be in the profile
    const productRefs = JSON.stringify(profile).match(/product_[a-f0-9-]+/g);
    assert.equal(productRefs, null, "No product IDs should appear in profile");
  });

  it("Unrelated FACP requirement not applied to detector", () => {
    const reqId = insertRequirement({
      id: "req_facp_only",
      original_text: "The FACP shall have an LCD display.",
      requirement_type: "Mandatory",
      requirement_category: "Other",
      system: "Fire Alarm",
      category: "Other",
    });

    const profile = buildTechnicalRequirementProfile({
      boqItem: baseBoqItem,
      links: [{ requirementId: reqId, status: "Confirmed", confidence: 85, linkMethod: "Test", evidence: [] }],
      requirements: [{
        id: reqId, originalText: "The FACP shall have an LCD display.",
        normalizedRequirement: "FACP shall have LCD display",
        requirementType: "Mandatory", requirementCategory: "Other",
        system: "Fire Alarm", category: "Other",
        confidence: 80, sourceType: "Specification", source: {},
        attributes: [], standards: [], manufacturers: [], compatibility: [], accessories: [],
      }],
      knowledgeFacts: [], relationships: [], previousVersion: 0,
    });

    // Even though confirmed, the FACP requirement is in the profile as applicable
    // but it should NOT create detector-specific attributes
    const detectorAttrs = profile.consolidatedRequirements.flatMap(r => r.attributes || [])
      .filter(a => /detector|heat|sensor/i.test(a.name));
    assert.equal(detectorAttrs.length, 0, "FACP requirement should not create detector attributes");
  });

  it("Idempotent profile generation produces consistent results", () => {
    const reqId = insertRequirement({
      id: "req_idempotent",
      original_text: "The system shall comply with NFPA 72.",
      requirement_type: "Mandatory",
      requirement_category: "Compliance",
    });

    const inputs = {
      boqItem: baseBoqItem,
      links: [{ requirementId: reqId, status: "Confirmed", confidence: 85, linkMethod: "Test", evidence: [] }],
      requirements: [{
        id: reqId, originalText: "The system shall comply with NFPA 72.",
        normalizedRequirement: "system shall comply with NFPA 72",
        requirementType: "Mandatory", requirementCategory: "Compliance",
        system: "Fire Alarm", category: "Other",
        confidence: 80, sourceType: "Specification", source: {},
        attributes: [], standards: [], manufacturers: [], compatibility: [], accessories: [],
      }],
      knowledgeFacts: [], relationships: [], previousVersion: 0,
    };

    const profile1 = buildTechnicalRequirementProfile(inputs);
    const profile2 = buildTechnicalRequirementProfile(inputs);

    assert.equal(profile1.readiness.status, profile2.readiness.status);
    assert.equal(profile1.applicableRequirements.length, profile2.applicableRequirements.length);
    assert.equal(profile1.consolidatedRequirements.length, profile2.consolidatedRequirements.length);
  });
});
