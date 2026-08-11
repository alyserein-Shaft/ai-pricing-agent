import test from "node:test";
import assert from "node:assert/strict";
import {
  boqReviewReasons,
  extractionReviewActionLabel,
  extractionReviewStatusLabel,
} from "../app/domain/boq-review-reasons.mjs";

test("approved items expose no review reasons", () => {
  assert.deepEqual(
    boqReviewReasons({
      review_status: "Approved",
      extraction_confidence: 10,
      warnings: [{ code: "MISSING_QUANTITY", severity: "Critical" }],
    }),
    [],
  );
});

test("persisted reasons are prioritized and de-duplicated", () => {
  assert.deepEqual(
    boqReviewReasons({
      review_status: "Needs Review",
      extraction_confidence: 60,
      duplicate_of_item_id: "other",
      warnings: [
        { code: "LOW_CONFIDENCE", severity: "Low" },
        { code: "POSSIBLE_DUPLICATE", severity: "Medium" },
        { code: "MISSING_UNIT", severity: "High" },
        { code: "MISSING_QUANTITY", severity: "Critical" },
      ],
    }),
    [
      "Missing Quantity",
      "Missing Unit",
      "Possible Duplicate",
      "Low Extraction Confidence",
    ],
  );
});

test("unknown persisted warnings retain their stored message", () => {
  assert.deepEqual(
    boqReviewReasons({
      review_status: "Needs Review",
      extraction_confidence: 90,
      warnings: [
        {
          code: "PARSER_VALUE_WARNING",
          severity: "Medium",
          message: "Parser could not verify the source value",
        },
      ],
    }),
    ["Parser could not verify the source value"],
  );
});

test("items without an explicit persisted reason fail closed", () => {
  assert.deepEqual(
    boqReviewReasons({
      review_status: "Needs Review",
      extraction_confidence: 90,
      warnings: [],
    }),
    ["Manual Review Required"],
  );
});

test("rejected and edited items use existing review decisions", () => {
  assert.deepEqual(
    boqReviewReasons({
      review_status: "Rejected",
      latest_review: { reason: "Source row is a section heading" },
    }),
    ["Source row is a section heading"],
  );
  assert.deepEqual(
    boqReviewReasons({
      review_status: "Needs Review",
      extraction_confidence: 90,
      latest_review: { action: "update", reason: "Corrected transcription" },
    }),
    ["Edited by Estimator"],
  );
});

test("extraction terminology maps legacy API states without changing the API", () => {
  assert.equal(
    extractionReviewStatusLabel({ review_status: "Approved" }),
    "Extraction Confirmed",
  );
  assert.equal(
    extractionReviewStatusLabel({ review_status: "Rejected" }),
    "Extraction Rejected",
  );
  assert.equal(
    extractionReviewStatusLabel({
      review_status: "Needs Review",
      latest_review: { action: "update" },
    }),
    "Extraction Edited",
  );
  assert.equal(extractionReviewActionLabel("approve"), "Confirm Extraction");
  assert.equal(extractionReviewActionLabel("restore"), "Restore Original");
  assert.equal(extractionReviewActionLabel("reject"), "Reject Extraction");
});
