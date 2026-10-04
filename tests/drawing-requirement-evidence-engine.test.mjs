import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  DRAWING_EVIDENCE_TYPES,
  buildDrawingDeviceIdentityRequirement,
  buildBoqDeviceIdentityRequirement,
  drawingRequirementLink,
  buildDrawingRequirementEntries,
} from "../app/domain/drawing-requirement-evidence-engine.mjs";
import {
  consolidateRequirements,
  detectRequirementConflicts,
  resolveApplicability,
  SOURCE_PRECEDENCE,
} from "../app/domain/technical-requirement-engine.mjs";

const engineSource = fs.readFileSync(new URL("../app/domain/drawing-requirement-evidence-engine.mjs", import.meta.url), "utf8");

// The real, already-proven Opera CCTV occurrence (Stage 6A/8): RE ->
// CEILING MOUNTED DOME CAMERA -> CCTV / Cameras / Dome Camera. Reused here,
// not re-derived, exactly as Stage 9's own instruction requires.
const evidenceGroup = () => ({
  definitionKey: "def_re",
  abbreviation: "RE",
  description: "CEILING MOUNTED DOME CAMERA",
  system: "CCTV",
  families: [{ category: "Cameras", family: "Dome Camera" }],
  recognitionVersionId: "v1",
  documentId: "doc_1",
  approvedOccurrenceCount: 2,
  approvedOccurrences: [
    { id: "occ1", pageNumber: 1, confidence: 60, reviewStatus: "Approved" },
    { id: "occ2", pageNumber: 1, confidence: 55, reviewStatus: "Approved" },
  ],
  pages: [1],
});

const boqItem = (overrides = {}) => ({ id: "boq_1", system: "CCTV", category: "Cameras", productFamily: "Dome Camera", ...overrides });

// ============================================================
// Section 3: device/family handoff -- enrich, never select a part number.
// ============================================================

test("Section 1 (evidence types): the taxonomy is explicit about what is wired today, not a blanket claim", () => {
  assert.ok(DRAWING_EVIDENCE_TYPES.some((entry) => entry.type === "Device Identity / Family Evidence" && entry.wired === true));
  assert.ok(DRAWING_EVIDENCE_TYPES.some((entry) => entry.type === "Quantity Evidence" && entry.wired === true));
  assert.ok(DRAWING_EVIDENCE_TYPES.some((entry) => entry.wired === false), "not every drawing fact is claimed to be wired -- an honest taxonomy has real gaps");
});

test("buildDrawingDeviceIdentityRequirement produces requirement evidence with system/family/source/reviewStatus, never a part number or manufacturer", () => {
  const requirement = buildDrawingDeviceIdentityRequirement({ evidenceGroup: evidenceGroup(), boqItem: boqItem(), documentId: "doc_1", documentName: "Floor Plan", recognitionVersionId: "v1" });
  assert.equal(requirement.system, "CCTV");
  assert.equal(requirement.sourceType, "Drawing");
  assert.equal(requirement.attributes[0].name, "Family");
  assert.equal(requirement.attributes[0].normalizedValue, "Dome Camera");
  assert.deepEqual(requirement.source.occurrenceIds, ["occ1", "occ2"]);
  assert.equal(requirement.source.page, 1);
  assert.deepEqual(requirement.source.pageNumbers, [1]);
  assert.equal(requirement.partNumber, undefined);
  assert.equal(requirement.manufacturer, undefined);
});

test("no requirement is created when the evidence group has no resolved System Knowledge Registry family (e.g. Access Control)", () => {
  const requirement = buildDrawingDeviceIdentityRequirement({ evidenceGroup: { ...evidenceGroup(), system: null, families: [] }, boqItem: boqItem(), documentId: "doc_1", recognitionVersionId: "v1" });
  assert.equal(requirement, null);
});

test("buildDrawingRequirementEntries requires a real governed link -- an unapproved review or mismatched family contributes nothing", () => {
  const notApproved = buildDrawingRequirementEntries({
    evidenceGroups: [{ evidenceGroup: evidenceGroup(), documentId: "doc_1", documentName: "Floor Plan", recognitionVersionId: "v1" }],
    boqItem: boqItem(),
    canonicalInterpretation: { system: "CCTV", productFamily: "Dome Camera" },
    reviewStatus: "AWAITING_REVIEW",
  });
  assert.deepEqual(notApproved.requirements, []);
  assert.deepEqual(notApproved.links, []);

  const mismatchedFamily = buildDrawingRequirementEntries({
    evidenceGroups: [{ evidenceGroup: evidenceGroup(), documentId: "doc_1", documentName: "Floor Plan", recognitionVersionId: "v1" }],
    boqItem: boqItem({ productFamily: "Bullet Camera" }),
    canonicalInterpretation: { system: "CCTV", productFamily: "Bullet Camera" },
    reviewStatus: "APPROVED",
  });
  assert.deepEqual(mismatchedFamily.requirements, []);
});

test("buildDrawingRequirementEntries returns BOTH the Drawing entry and a comparable BOQ entry once governed -- never one source silently replacing the other", () => {
  const result = buildDrawingRequirementEntries({
    evidenceGroups: [{ evidenceGroup: evidenceGroup(), documentId: "doc_1", documentName: "Floor Plan", recognitionVersionId: "v1" }],
    boqItem: boqItem(),
    canonicalInterpretation: { system: "CCTV", productFamily: "Dome Camera" },
    reviewStatus: "APPROVED",
  });
  assert.equal(result.requirements.length, 2);
  assert.ok(result.requirements.some((requirement) => requirement.sourceType === "Drawing"));
  assert.ok(result.requirements.some((requirement) => requirement.sourceType === "BOQ"));
  assert.equal(result.links.length, 2);
  assert.ok(result.links.every((link) => link.status === "Confirmed"));
});

test("an item with no approved understanding review or no BOQ productFamily at all gets zero requirement entries -- zero behavior change", () => {
  const noFamily = buildDrawingRequirementEntries({
    evidenceGroups: [{ evidenceGroup: evidenceGroup(), documentId: "doc_1", documentName: "Floor Plan", recognitionVersionId: "v1" }],
    boqItem: boqItem({ productFamily: null }),
    canonicalInterpretation: { system: "CCTV", productFamily: null },
    reviewStatus: "APPROVED",
  });
  assert.deepEqual(noFamily.requirements, []);
});

// ============================================================
// Section 6/7: the SAME canonical consolidateRequirements/
// detectAttributeValueConflicts machinery -- reused unmodified -- merges
// agreeing sources and surfaces disagreeing ones as a real conflict.
// ============================================================

test("Section 6: agreeing BOQ and Drawing device-identity evidence consolidate into ONE governed group, both sources preserved, Drawing precedence honoured (never a silent override)", () => {
  const { requirements } = buildDrawingRequirementEntries({
    evidenceGroups: [{ evidenceGroup: evidenceGroup(), documentId: "doc_1", documentName: "Floor Plan", recognitionVersionId: "v1" }],
    boqItem: boqItem(),
    canonicalInterpretation: { system: "CCTV", productFamily: "Dome Camera" },
    reviewStatus: "APPROVED",
  });
  const consolidated = consolidateRequirements(requirements, SOURCE_PRECEDENCE);
  const group = consolidated.find((entry) => entry.requirementCategory === "Device Identity Evidence");
  assert.ok(group, "the two agreeing entries must consolidate into one governed group");
  assert.equal(consolidated.filter((entry) => entry.requirementCategory === "Device Identity Evidence").length, 1);
  assert.equal(group.sources.length, 2);
  assert.deepEqual(new Set(group.sources.map((source) => source.sourceType)), new Set(["Drawing", "BOQ"]));
  assert.equal(SOURCE_PRECEDENCE.Drawing > SOURCE_PRECEDENCE.BOQ, true, "Drawing outranks BOQ in the existing, unmodified precedence table -- Section 8's already-generic order of precedence");
  assert.equal(group.sources[0].sourceType, "Drawing", "the higher-precedence source governs the displayed requirement, but the lower-precedence source is still present in .sources, never dropped");
});

test("Section 7: a real BOQ-vs-Drawing family disagreement (BOQ says Dome Camera, Drawing says Bullet Camera) is a real, surfaced conflict, never silently resolved", () => {
  const drawingBulletGroup = { ...evidenceGroup(), description: "WALL MOUNTED BULLET CAMERA", families: [{ category: "Cameras", family: "Bullet Camera" }] };
  // The governed-link check itself (family must match the engineer's own
  // APPROVED understanding) is proven separately above; this test's real
  // subject is the DOWNSTREAM conflict once the drawing's resolved family
  // disagrees with what the BOQ line itself names, so the Drawing entry is
  // built directly here rather than re-deriving it through the governed-link
  // gate a second time.
  const drawingRequirement = buildDrawingDeviceIdentityRequirement({ evidenceGroup: drawingBulletGroup, boqItem: boqItem(), documentId: "doc_1", documentName: "Floor Plan", recognitionVersionId: "v1" });
  const boqSideRequirement = buildBoqDeviceIdentityRequirement({ boqItem: boqItem({ productFamily: "Dome Camera" }) });
  const consolidated = consolidateRequirements([drawingRequirement, boqSideRequirement], SOURCE_PRECEDENCE);
  assert.equal(consolidated.length, 1, "BOQ and Drawing device-identity entries always share one governed group (attributeName-keyed) regardless of whether their values agree -- the disagreement itself is judged on real attribute VALUES, not on grouping");
  const conflicts = detectRequirementConflicts(consolidated);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].attribute, "Family");
  assert.equal(conflicts[0].severity, "High");
  assert.deepEqual(new Set(conflicts[0].values.map((entry) => entry.value)), new Set(["Dome Camera", "Bullet Camera"]));
  assert.deepEqual(new Set(conflicts[0].values.map((entry) => entry.source.sourceType)), new Set(["Drawing", "BOQ"]));
});

test("a governed drawing link resolves to Confirmed Applicable via the EXISTING resolveApplicability early return -- never re-implemented", () => {
  const requirement = buildDrawingDeviceIdentityRequirement({ evidenceGroup: evidenceGroup(), boqItem: boqItem(), documentId: "doc_1", recognitionVersionId: "v1" });
  const link = drawingRequirementLink(requirement);
  const applicability = resolveApplicability({ boqItem: boqItem(), link, requirement });
  assert.equal(applicability.status, "Confirmed Applicable");
});

test("no part number, manufacturer, or product identity is ever created anywhere in this module -- evidence remains evidence", () => {
  assert.doesNotMatch(engineSource, /partNumber\s*:|part_number\s*:|manufacturer\s*:/i);
});
