import { test } from "node:test";
import assert from "node:assert/strict";
import { compareEvidenceForConflict } from "../app/domain/drawing-discrepancy-detection.mjs";

// DRAWING INTELLIGENCE -- WORKSTREAM 8: real conflict exercise.
//
// EVIDENCE OF ABSENCE (real Al Mousa data, queried directly against the
// local dev D1 database on 2026-09-15):
//
//   1. Checked whether the FCC ROOM DETAILS equipment schedule's 14 items
//      have a corresponding BOQ line item by keyword match against
//      boq_items.description for this project (project_c0123d91-
//      c30b-4956-87cb-e473ef53f89d): "BMS INTERFACE", "WORK STATION",
//      "AHU STATUS", "FIREFIGHTER", "SPRINKLER VALVE", "EMERGENCY AND
//      STANDBY", "FIRE PUMP", "LIFT STATUS", "PRINTER", "IP TELEPHONE",
//      "PSTN", "WORK TABLE" -- ALL 12 returned 0 matches. The BOQ uses
//      different, more general terminology (e.g. "Fire alarm control
//      panel with all accessories") that does not align 1:1 with the
//      room-schedule's specific per-device descriptions, so no honest
//      quantity comparison is possible at this granularity.
//   2. The schedule itself represents per-room EQUIPMENT PRESENCE (one row
//      = one device type present in this room), not a counted quantity
//      field -- there is no "quantity" value on a schedule row to compare
//      against a BOQ quantity in the first place for the one item that DID
//      match by keyword ("Main fire alarm control panel", BOQ quantity 1,
//      schedule row 1 MFACP) -- both are consistent with "one," no
//      discrepancy.
//   3. Revision fields are "Not Found" (null) for most of the 13 real
//      drawings (see docs/drawing-intelligence-set-report.md) -- there is
//      no genuine, evidenced revision-mismatch case to exercise; treating
//      a missing revision as a "mismatch" would be fabricating
//      significance from absent data, which this task explicitly forbids.
//
// CONCLUSION: Al Mousa has no genuine, evidenced real-world discrepancy
// available at the fidelity this pipeline currently extracts. Per this
// task's own explicit instruction, the mechanism is instead proven here
// with an ISOLATED, clearly-labeled SYNTHETIC fixture -- and Drawing
// Intelligence closure stays conditional specifically for this reason
// (see the Drawing Intelligence Final Closure Report).

test("SYNTHETIC FIXTURE (not real Al Mousa data) -- a genuine value disagreement between two sources produces a Conflict that blocks approval", () => {
  const result = compareEvidenceForConflict({
    fieldType: "DeviceQuantity",
    itemLabel: "Fireman Telephone Jack (Building A)",
    left: { source: "BOQ", value: 19, documentId: "doc_boq_fixture" },
    right: { source: "Drawing Schedule", value: 24, documentId: "doc_drawing_fixture", sheetName: "SYNTHETIC FIXTURE SHEET" },
  });
  assert.equal(result.hasConflict, true);
  assert.equal(result.conflict.governedStatus, "Conflict");
  assert.equal(result.conflict.approvalEligibility, false);
  assert.equal(result.conflict.evidenceSources.length, 2);
  assert.equal(result.conflict.evidenceSources[0].source, "BOQ");
  assert.equal(result.conflict.evidenceSources[1].source, "Drawing Schedule");
});

test("SYNTHETIC FIXTURE -- a Conflict surfaces an RFI/discrepancy candidate naming both sources, with no price/business decision made", () => {
  const result = compareEvidenceForConflict({
    fieldType: "DeviceQuantity",
    itemLabel: "Fireman Telephone Jack (Building A)",
    left: { source: "BOQ", value: 19 },
    right: { source: "Drawing Schedule", value: 24 },
  });
  assert.ok(result.rfiCandidate);
  assert.equal(result.rfiCandidate.proposalType, "RfiDiscrepancyCandidate");
  assert.match(result.rfiCandidate.question, /19/);
  assert.match(result.rfiCandidate.question, /24/);
  assert.doesNotMatch(JSON.stringify(result.rfiCandidate), /price|cost|\$|SAR|recommend/i);
});

test("matching values from two sources produce no conflict and no RFI candidate", () => {
  const result = compareEvidenceForConflict({
    fieldType: "DeviceQuantity",
    itemLabel: "Main Fire Alarm Control Panel",
    left: { source: "BOQ", value: 1 },
    right: { source: "Drawing Schedule", value: 1 },
  });
  assert.equal(result.hasConflict, false);
  assert.equal(result.conflict, null);
  assert.equal(result.rfiCandidate, null);
});

test("a Conflict cannot be sidestepped by a high-confidence/Primary-authority source -- Conflict always wins over authority role", () => {
  // Even though BOQ is the Rule A Primary authority for CommercialQuantity
  // during tender, a genuine disagreement with another explicit source
  // still forces Conflict, not a silent "Primary wins" resolution -- this
  // module never picks a winner.
  const result = compareEvidenceForConflict({
    fieldType: "CommercialQuantity",
    itemLabel: "Fireman Telephone Jack",
    left: { source: "BOQ", value: 19 },
    right: { source: "Drawing Schedule", value: 24 },
  });
  assert.equal(result.conflict.governedStatus, "Conflict");
});
