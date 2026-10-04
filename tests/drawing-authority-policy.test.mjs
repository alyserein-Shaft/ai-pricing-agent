import test from "node:test";
import assert from "node:assert/strict";
import {
  PROJECT_TYPES,
  DRAWING_STATUSES,
  normalizeDrawingStatus,
  evaluateDrawingAuthority,
  resolveSourceAuthorityRank,
  SOURCE_TYPE_PRODUCTION_STATUS,
} from "../app/domain/drawing-authority-policy.mjs";
import { consolidateRequirements, detectRequirementConflicts } from "../app/domain/technical-requirement-engine.mjs";

// OPERATIONAL POLICY FOUNDATION -- STAGE 1 test matrix (Section 10).
// Every test below proves one explicit requirement from the accepted Stage
// 1 brief. Nothing here implements quantity policy, RFI workflow,
// calculations, or touches the AI Agent/product matching/pricing.

const req = (overrides = {}) => ({
  id: "r1",
  normalizedRequirement: "text",
  requirementCategory: "Standards",
  attributeName: "Device Identity",
  confidence: 90,
  attributes: [],
  standards: [],
  manufacturers: [],
  compatibility: [],
  accessories: [],
  sourceType: "Specification",
  source: {},
  ...overrides,
});

// ------------------------------------------------------------------
// Section 1: Project Type
// ------------------------------------------------------------------
test("project type is a closed, governed set -- never free text", () => {
  assert.deepEqual(PROJECT_TYPES, ["TENDER", "ON_HAND"]);
});

// ------------------------------------------------------------------
// Section 3: deterministic status normalization -- never guess upward.
// ------------------------------------------------------------------
test("common title-block values normalize deterministically", () => {
  assert.equal(normalizeDrawingStatus("AFC"), "APPROVED_IFC_AFC");
  assert.equal(normalizeDrawingStatus("Approved for Construction"), "APPROVED_IFC_AFC");
  assert.equal(normalizeDrawingStatus("IFC"), "APPROVED_IFC_AFC");
  assert.equal(normalizeDrawingStatus("Issued for Construction"), "APPROVED_IFC_AFC");
  assert.equal(normalizeDrawingStatus("Tender"), "TENDER_REFERENCE");
  assert.equal(normalizeDrawingStatus("For Tender"), "TENDER_REFERENCE");
  assert.equal(normalizeDrawingStatus("Reference"), "TENDER_REFERENCE");
  assert.equal(normalizeDrawingStatus("Design Development"), "DESIGN_DEVELOPMENT");
  assert.equal(normalizeDrawingStatus("DD"), "DESIGN_DEVELOPMENT");
  assert.equal(normalizeDrawingStatus("Concept"), "CONCEPT");
  assert.equal(normalizeDrawingStatus("Concept Design"), "CONCEPT");
});

test("an unrecognized value normalizes to UNKNOWN, never guessed upward", () => {
  assert.equal(normalizeDrawingStatus("Rev A"), "UNKNOWN");
  assert.equal(normalizeDrawingStatus(""), "UNKNOWN");
  assert.equal(normalizeDrawingStatus(null), "UNKNOWN");
  assert.equal(normalizeDrawingStatus("Some ambiguous stamp"), "UNKNOWN");
});

test("an explicitly unapproved IFC issue is never upgraded to Approved", () => {
  assert.equal(normalizeDrawingStatus("Unapproved IFC"), "UNAPPROVED_IFC");
  assert.equal(normalizeDrawingStatus("Issued for Construction - Pending Approval"), "UNAPPROVED_IFC");
});

// ------------------------------------------------------------------
// Section 4: drawing authority profile -- the engineer's exact 5-tier
// mapping, kept independent of coverageState (never referenced here).
// ------------------------------------------------------------------
test("evaluateDrawingAuthority implements the engineer's exact 5-tier trust/commercial mapping", () => {
  assert.deepEqual(
    { authorityTier: evaluateDrawingAuthority({ drawingStatus: "APPROVED_IFC_AFC" }).authorityTier, requiresEngineerReview: evaluateDrawingAuthority({ drawingStatus: "APPROVED_IFC_AFC" }).requiresEngineerReview },
    { authorityTier: "High", requiresEngineerReview: false },
  );
  assert.equal(evaluateDrawingAuthority({ drawingStatus: "UNAPPROVED_IFC" }).trustLevel, "Medium-High");
  assert.equal(evaluateDrawingAuthority({ drawingStatus: "TENDER_REFERENCE" }).commercialUse, "Preliminary pricing only");
  assert.equal(evaluateDrawingAuthority({ drawingStatus: "DESIGN_DEVELOPMENT" }).commercialUse, "Budgetary use only");
  assert.equal(evaluateDrawingAuthority({ drawingStatus: "CONCEPT" }).trustLevel, "Low");
});

test("a Concept drawing is estimate-only and never silently becomes authoritative", () => {
  const profile = evaluateDrawingAuthority({ drawingStatus: "CONCEPT" });
  assert.equal(profile.commercialUse, "Estimate only");
  assert.equal(profile.requiresEngineerReview, true);
});

test("an unknown drawing status resolves to a safe Needs-Review posture, never a default trust level", () => {
  const profile = evaluateDrawingAuthority({ drawingStatus: "UNRECOGNIZED_VALUE" });
  assert.equal(profile.drawingStatus, "UNKNOWN");
  assert.equal(profile.trustLevel, "Unknown");
  assert.equal(profile.requiresEngineerReview, true);
});

test("DRAWING_STATUSES includes UNKNOWN as a first-class member", () => {
  assert.ok(DRAWING_STATUSES.includes("UNKNOWN"));
});

// ------------------------------------------------------------------
// Section 6: unimplemented authority sources are honestly reported.
// ------------------------------------------------------------------
test("Formal Client Clarification and Approved RFI Response/Technical Bulletin are recognized by policy but honestly reported as not yet produced", () => {
  assert.equal(SOURCE_TYPE_PRODUCTION_STATUS["Formal Client Clarification"], "NOT_YET_PRODUCED");
  assert.equal(SOURCE_TYPE_PRODUCTION_STATUS["Approved RFI Response"], "NOT_YET_PRODUCED");
  assert.equal(SOURCE_TYPE_PRODUCTION_STATUS["Technical Bulletin"], "NOT_YET_PRODUCED");
  assert.equal(SOURCE_TYPE_PRODUCTION_STATUS.Specification, "SUPPORTED_BY_POLICY");
  assert.equal(SOURCE_TYPE_PRODUCTION_STATUS.Drawing, "SUPPORTED_BY_POLICY");
  assert.equal(SOURCE_TYPE_PRODUCTION_STATUS.BOQ, "SUPPORTED_BY_POLICY");
});

const drawing = (drawingStatus) => req({ id: `drawing-${drawingStatus}`, sourceType: "Drawing", source: { drawingStatus } });
const boq = () => req({ id: "boq-1", sourceType: "BOQ", source: {} });
const specification = () => req({ id: "spec-1", sourceType: "Specification", source: {} });
const clientClarification = () => req({ id: "clarification-1", sourceType: "Formal Client Clarification", source: {} });

// ------------------------------------------------------------------
// Section 10: the required precedence test matrix, proven end-to-end
// through consolidateRequirements' real default (statusAwareSourceAuthority).
// ------------------------------------------------------------------
test("Approved IFC drawing outranks Specification", () => {
  const [group] = consolidateRequirements([drawing("APPROVED_IFC_AFC"), specification()]);
  assert.equal(group.governingSourceId, "drawing-APPROVED_IFC_AFC");
});

test("Specification outranks Tender/Reference drawing", () => {
  const [group] = consolidateRequirements([specification(), drawing("TENDER_REFERENCE")]);
  assert.equal(group.governingSourceId, "spec-1");
});

test("BOQ outranks Tender/Reference drawing", () => {
  const [group] = consolidateRequirements([boq(), drawing("TENDER_REFERENCE")]);
  assert.equal(group.governingSourceId, "boq-1");
});

test("Formal Client Clarification outranks Approved IFC drawing", () => {
  const [group] = consolidateRequirements([drawing("APPROVED_IFC_AFC"), clientClarification()]);
  assert.equal(group.governingSourceId, "clarification-1");
});

test("Approved RFI Response / Technical Bulletin rank between Formal Client Clarification and Approved IFC drawing", () => {
  const rfi = resolveSourceAuthorityRank({ sourceType: "Approved RFI Response" });
  const clarification = resolveSourceAuthorityRank({ sourceType: "Formal Client Clarification" });
  const approvedDrawing = resolveSourceAuthorityRank({ sourceType: "Drawing", source: { drawingStatus: "APPROVED_IFC_AFC" } });
  assert.ok(clarification.weight > rfi.weight);
  assert.ok(rfi.weight > approvedDrawing.weight);
});

test("Concept drawing does not silently outrank Specification or BOQ", () => {
  const [conceptVsSpec] = consolidateRequirements([drawing("CONCEPT"), specification()]);
  assert.equal(conceptVsSpec.governingSourceId, "spec-1");
  const [conceptVsBoq] = consolidateRequirements([drawing("CONCEPT"), boq()]);
  assert.equal(conceptVsBoq.governingSourceId, "boq-1");
});

test("unknown drawing status resolves to a safe, low-ranked governing behavior -- never treated as approved", () => {
  const [group] = consolidateRequirements([drawing("UNKNOWN"), specification()]);
  assert.equal(group.governingSourceId, "spec-1");
  const rank = resolveSourceAuthorityRank({ sourceType: "Drawing", source: {} });
  assert.equal(rank.drawingStatus, "UNKNOWN");
  assert.ok(rank.weight < resolveSourceAuthorityRank({ sourceType: "Drawing", source: { drawingStatus: "APPROVED_IFC_AFC" } }).weight);
});

test("Section 7: real conflicting requirement values remain visible even when one source's authority governs display", () => {
  const groups = consolidateRequirements([
    drawing("APPROVED_IFC_AFC")
      ? { ...drawing("APPROVED_IFC_AFC"), attributes: [{ name: "Voltage", normalizedValue: 24, normalizedUnit: "V" }] }
      : null,
    { ...specification(), attributes: [{ name: "Voltage", normalizedValue: 12, normalizedUnit: "V" }] },
  ].filter(Boolean));
  const conflicts = detectRequirementConflicts(groups);
  assert.equal(conflicts.length, 1, "authority answering 'which source governs' must not suppress a real conflicting-value finding");
  assert.equal(conflicts[0].blocking, true);
});

test("Drawing entries without a drawingStatus field behave exactly like UNKNOWN (backward-compatible default)", () => {
  const [group] = consolidateRequirements([req({ id: "legacy-drawing", sourceType: "Drawing", source: { documentId: "doc_1" } }), specification()]);
  assert.equal(group.governingSourceId, "spec-1");
});
