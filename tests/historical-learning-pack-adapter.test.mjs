import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseXlsxWorkbook } from "../app/document-parsers/xlsx.mjs";
import { buildHistoricalLearningPack } from "../app/domain/historical-learning-pack-adapter.mjs";

const file =
  "outputs/central-kitchen-approved/Central_Kitchen_Structured_Cabling_Learning_Pack_v1.xlsx";

test("approved Structured Cabling pack maps to governed case records", async () => {
  const bytes = await readFile(file);
  const workbook = parseXlsxWorkbook(bytes, {
    fileName:
      "Central_Kitchen_Structured_Cabling_Learning_Pack_v1.xlsx",
    sha256:
      "f392fe2a76dacd7748f23d4efea2da8d3e30b57e41d396fdac050d2d6da37a84",
  });

  const result = buildHistoricalLearningPack({
    workbook,
    sha256:
      "f392fe2a76dacd7748f23d4efea2da8d3e30b57e41d396fdac050d2d6da37a84",
    project: {
      id: "central-kitchen-makkah",
      organizationId: "local-org",
      name: "Central Kitchen - Makkah",
      systemDomain: "Data & Structured Cabling",
      client: "Al Mespar Contracting Corp. (MCC)",
      location: "Makkah",
      currency: "SAR",
    },
  });

  assert.equal(result.counts.candidateRules, 12);
  assert.equal(result.counts.quantityRelationships, 12);
  assert.equal(result.counts.rfqToFinalChanges, 12);
  assert.equal(result.counts.passiveComponents, 12);
  assert.equal(result.counts.activeHuaweiAdditions, 10);
  assert.equal(result.counts.rackAndServices, 5);
  assert.equal(result.counts.evidenceSources, 10);
  assert.equal(result.counts.groundTruthRecords, 51);
  assert.equal(result.counts.knowledgeItems, 28);
  assert.equal(result.counts.exceptions, 8);
  assert.equal(result.counts.reviewQueue, 8);

  assert.equal(
    result.snapshot.governance.publicationState,
    "Not Published",
  );
  assert.equal(
    result.snapshot.governance.automaticApproval,
    false,
  );
  assert.equal(
    result.knowledgeItems.some((item) => item.reusable),
    false,
  );

  assert.ok(
    result.knowledgeItems.every(
      (item) => item.layer === "Project Evidence",
    ),
  );

  const allowedClassifications = new Set([
    "Project-specific fact",
    "Historical observation",
    "Engineering rule",
    "Manufacturer rule",
    "Supplier observation",
    "Pricing precedent",
    "Matching precedent",
    "Clarification pattern",
    "Error pattern",
    "Approved reusable knowledge",
    "Non-reusable project exception",
  ]);

  assert.ok(
    result.knowledgeItems.every((item) =>
      allowedClassifications.has(item.classification),
    ),
  );
  assert.ok(
    result.groundTruthRecords.every(
      (record) =>
        record.reviewState === "Needs Review" &&
        record.provenance.historicalOnly === true,
    ),
  );
});
