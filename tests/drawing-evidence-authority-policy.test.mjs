import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateDrawingEvidenceAuthority,
  GOVERNED_STATUSES,
  HARD_REVIEW_TRIGGERS,
} from "../app/domain/drawing-evidence-authority-policy.mjs";

test("authority-per-field policy -- a Schedule is Primary for DeviceIdentity, a Floor Plan is only Verification", () => {
  const primary = evaluateDrawingEvidenceAuthority({ fieldType: "DeviceIdentity", drawingType: "Schedule", sourceType: "Drawing" });
  assert.equal(primary.authorityRole, "Primary");
  assert.equal(primary.finalStatus, "Verified");

  const verification = evaluateDrawingEvidenceAuthority({ fieldType: "DeviceIdentity", drawingType: "Floor Plan", sourceType: "Drawing" });
  assert.equal(verification.authorityRole, "Verification");
  assert.equal(verification.finalStatus, "Needs Review");
});

test("authority-per-field policy -- a Notes Sheet is Unsupported for DeviceQuantity (not in either list)", () => {
  const result = evaluateDrawingEvidenceAuthority({ fieldType: "DeviceQuantity", drawingType: "Notes Sheet", sourceType: "Drawing" });
  assert.equal(result.authorityRole, "Unsupported");
  assert.equal(result.finalStatus, "Needs Review");
});

test("hard-review gate behavior -- Primary + explicit + no triggers reaches Verified; any trigger forces Needs Review regardless", () => {
  const clean = evaluateDrawingEvidenceAuthority({ fieldType: "DeviceIdentity", drawingType: "Schedule", sourceType: "Drawing" });
  assert.equal(clean.finalStatus, "Verified");

  const withTrigger = evaluateDrawingEvidenceAuthority({
    fieldType: "DeviceIdentity",
    drawingType: "Schedule",
    sourceType: "Drawing",
    hardReviewTriggers: ["OCR_UNCERTAINTY"],
  });
  assert.equal(withTrigger.finalStatus, "Needs Review");
  assert.ok(withTrigger.hardReviewReasons.some((reason) => /OCR/.test(reason)));
});

test("status derivation -- Verified with Assumption requires a traceable assumption string surfaced in reasons", () => {
  const result = evaluateDrawingEvidenceAuthority({
    fieldType: "DeviceIdentity",
    drawingType: "Schedule",
    sourceType: "Drawing",
    assumption: "Tag inferred from adjacent room label",
  });
  assert.equal(result.finalStatus, "Verified with Assumption");
  assert.ok(result.hardReviewReasons.some((reason) => reason.includes("Tag inferred from adjacent room label")));
});

test("status derivation -- Conflict always wins regardless of authority role or triggers", () => {
  const result = evaluateDrawingEvidenceAuthority({
    fieldType: "DeviceIdentity",
    drawingType: "Schedule",
    sourceType: "Drawing",
    conflicts: ["Quantity differs between BOQ and drawing count"],
  });
  assert.equal(result.finalStatus, "Conflict");
  assert.equal(result.approvalEligibility, false);
});

test("status derivation -- Not Found short-circuits everything else", () => {
  const result = evaluateDrawingEvidenceAuthority({ fieldType: "DeviceIdentity", notFound: true, conflicts: ["ignored"] });
  assert.equal(result.finalStatus, "Not Found");
});

test("layout-only inferred connectivity remains Needs Review regardless of score, unless corroborated", () => {
  const uncorroborated = evaluateDrawingEvidenceAuthority({
    fieldType: "SystemConnectivity",
    drawingType: "Floor Plan",
    sourceType: "Drawing",
  });
  assert.equal(uncorroborated.finalStatus, "Needs Review");
  assert.ok(uncorroborated.hardReviewReasons.some((reason) => /legend\/tag\/riser corroboration/.test(reason)));

  const corroborated = evaluateDrawingEvidenceAuthority({
    fieldType: "SystemConnectivity",
    drawingType: "Floor Plan",
    sourceType: "Drawing",
    corroboratingEvidence: ["legend-defined line type", "endpoint terminates on device symbol"],
  });
  // Still only Verification role (Floor Plan is never Primary for connectivity)
  // -- corroboration clears the LAYOUT_ONLY_CONNECTIVITY trigger but a bare
  // Verification role with no assumption still is not enough to Verify.
  assert.equal(corroborated.authorityRole, "Verification");
  assert.equal(corroborated.finalStatus, "Needs Review");
});

test("Riser Diagram is Primary for SystemConnectivity and reaches Verified with no triggers", () => {
  const result = evaluateDrawingEvidenceAuthority({ fieldType: "SystemConnectivity", drawingType: "Riser Diagram", sourceType: "Drawing" });
  assert.equal(result.authorityRole, "Primary");
  assert.equal(result.finalStatus, "Verified");
});

test("commercial quantity during tender -- BOQ is Primary, drawing count is discrepancy-evidence-only Verification", () => {
  const boq = evaluateDrawingEvidenceAuthority({ fieldType: "CommercialQuantity", sourceType: "BOQ" });
  assert.equal(boq.authorityRole, "Primary");
  assert.equal(boq.finalStatus, "Verified");

  const drawingCount = evaluateDrawingEvidenceAuthority({ fieldType: "CommercialQuantity", drawingType: "Schedule", sourceType: "Drawing" });
  assert.equal(drawingCount.authorityRole, "Verification");
  assert.ok(drawingCount.hardReviewReasons.some((reason) => /discrepancy evidence only/.test(reason)));
});

test("device quantity project-type override -- On-hand promotes Floor Plan/Device Layout to Primary, Tender does not", () => {
  const tender = evaluateDrawingEvidenceAuthority({ fieldType: "DeviceQuantity", drawingType: "Floor Plan", sourceType: "Drawing", projectType: "TENDER" });
  assert.equal(tender.authorityRole, "Verification");

  const onHand = evaluateDrawingEvidenceAuthority({ fieldType: "DeviceQuantity", drawingType: "Floor Plan", sourceType: "Drawing", projectType: "ON_HAND" });
  assert.equal(onHand.authorityRole, "Primary");
  assert.equal(onHand.finalStatus, "Verified");
});

test("inferred (non-explicit) values never auto-verify even from a Primary source", () => {
  const result = evaluateDrawingEvidenceAuthority({ fieldType: "DeviceIdentity", drawingType: "Schedule", sourceType: "Drawing", explicit: false });
  assert.equal(result.finalStatus, "Needs Review");
});

test("missing or ambiguous legend forces Needs Review for a Legend Sheet source", () => {
  const result = evaluateDrawingEvidenceAuthority({
    fieldType: "SymbolsAbbreviations",
    drawingType: "Legend Sheet",
    sourceType: "Drawing",
    applicableLegend: { defined: false },
  });
  assert.equal(result.finalStatus, "Needs Review");
});

test("revision mismatch (not the latest valid revision) forces Needs Review even for a Primary source", () => {
  const result = evaluateDrawingEvidenceAuthority({
    fieldType: "DeviceIdentity",
    drawingType: "Schedule",
    sourceType: "Drawing",
    revisionState: { isLatestValid: false },
  });
  assert.equal(result.finalStatus, "Needs Review");
  assert.ok(result.hardReviewReasons.some((reason) => /revision/i.test(reason)));
});

test("provenance requirements are always returned regardless of status", () => {
  for (const input of [{ fieldType: "DeviceIdentity", notFound: true }, { fieldType: "unknown" }, { fieldType: "DeviceIdentity", drawingType: "Schedule" }]) {
    const result = evaluateDrawingEvidenceAuthority(input);
    assert.deepEqual(result.provenanceRequirements, ["drawingNumber", "revision", "sheetNumber", "page", "source"]);
  }
});

test("GOVERNED_STATUSES and HARD_REVIEW_TRIGGERS are the exact engineer-approved closed vocabularies", () => {
  assert.deepEqual([...GOVERNED_STATUSES], ["Verified", "Verified with Assumption", "Needs Review", "Conflict", "Not Found"]);
  assert.ok(HARD_REVIEW_TRIGGERS.includes("LIFE_SAFETY_OR_CODE_COMPLIANCE"));
  assert.ok(HARD_REVIEW_TRIGGERS.includes("AFFECTS_PRICE"));
});
