const LABELS = {
  MISSING_QUANTITY: "Missing Quantity",
  MISSING_UNIT: "Missing Unit",
  MISSING_DESCRIPTION: "Missing Description",
  MISSING_SYSTEM: "Missing System",
  MISSING_MANUFACTURER: "Missing Manufacturer",
  MISSING_MODEL: "Missing Model",
  MISSING_SPECIFICATION: "Missing Specification",
  POSSIBLE_DUPLICATE: "Possible Duplicate",
  QUANTITY_MISMATCH: "Quantity Mismatch",
  LOW_EXTRACTION_CONFIDENCE: "Low Extraction Confidence",
  LOW_CONFIDENCE: "Low Extraction Confidence",
  AMBIGUOUS_DESCRIPTION: "Ambiguous Description",
  MULTIPLE_SOURCE_MATCHES: "Multiple Source Matches",
  HEADER_DETECTION_UNCERTAIN: "Header Detection Uncertain",
  SECTION_MAPPING_UNCERTAIN: "Section Mapping Uncertain",
  OCR_WARNING: "OCR Warning",
  MANUAL_REVIEW_REQUIRED: "Manual Review Required",
};

const PRIORITY = {
  MISSING_QUANTITY: 10,
  MISSING_UNIT: 20,
  MISSING_DESCRIPTION: 30,
  QUANTITY_MISMATCH: 40,
  POSSIBLE_DUPLICATE: 50,
  OCR_WARNING: 60,
  LOW_EXTRACTION_CONFIDENCE: 70,
  LOW_CONFIDENCE: 70,
};

const severityPriority = { Critical: 0, High: 25, Medium: 55, Low: 80 };

function readableCode(code) {
  return String(code || "")
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

export function boqReviewReasons(item = {}) {
  if (item.review_status === "Approved") return [];
  if (item.review_status === "Rejected") {
    return [item.latest_review?.reason || "Manual Review Required"];
  }

  const candidates = (item.warnings || []).map((warning, index) => ({
    label:
      LABELS[warning.code] ||
      String(warning.message || "").trim() ||
      readableCode(warning.code),
    priority:
      PRIORITY[warning.code] ?? severityPriority[warning.severity] ?? 90,
    index,
  }));

  if (
    item.duplicate_of_item_id &&
    !candidates.some((entry) => entry.label === "Possible Duplicate")
  ) {
    candidates.push({ label: "Possible Duplicate", priority: 50, index: 1000 });
  }
  if (
    Number(item.extraction_confidence) < 75 &&
    !candidates.some((entry) => entry.label === "Low Extraction Confidence")
  ) {
    candidates.push({
      label: "Low Extraction Confidence",
      priority: 70,
      index: 1001,
    });
  }
  if (item.latest_review?.action === "update") {
    candidates.push({
      label: "Edited by Estimator",
      priority: 85,
      index: 1002,
    });
  }

  const seen = new Set();
  const reasons = candidates
    .filter((entry) => entry.label)
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .filter((entry) => {
      if (seen.has(entry.label)) return false;
      seen.add(entry.label);
      return true;
    })
    .map((entry) => entry.label);

  return reasons.length ? reasons : ["Manual Review Required"];
}

export function extractionReviewStatusLabel(item = {}) {
  if (item.review_status === "Approved") return "Extraction Confirmed";
  if (item.review_status === "Rejected") return "Extraction Rejected";
  if (
    item.review_status === "Needs Review" &&
    item.latest_review?.action === "update"
  ) {
    return "Extraction Edited";
  }
  return item.review_status || "Needs Review";
}

export function extractionReviewActionLabel(operation) {
  return (
    {
      update: "Edit",
      restore: "Restore Original",
      approve: "Confirm Extraction",
      reject: "Reject Extraction",
    }[operation] || operation
  );
}
