import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  CLASSIFICATION_TAXONOMY,
  DOWNSTREAM_ROUTES,
  classifySample,
} from "../app/domain/document-classifier.mjs";
import { DOCUMENT_TYPES } from "../app/domain/document-management.mjs";

const leadQualificationSample = {
  readable: true,
  extractionMethod: "native-openxml",
  extractionQuality: 0.98,
  text: [
    "Lead Qualification Checklist",
    "Project Details",
    "Project Name Bab Al-Khair Hospital",
    "Project Status On Hand",
    "Project Category Commercial",
    "Contact Information",
    "Company Name IHCC",
    "Company Role MEP Contractor",
    "Budget nonprofit charity hospital cheapest brand maximum discount",
    "Authority final purchasing decision",
    "Scope LC",
    "Timeline Urgent",
  ].join(" "),
  segments: [{
    kind: "sheet",
    label: "Project name",
    sheetName: "Project name",
    text: "Lead Qualification Checklist Project Details Contact Information Budget Authority Scope Timeline",
    structure: {
      rowCount: 24,
      columnCount: 6,
      mergedRanges: 8,
      tableDensity: 0.75,
    },
  }],
  structure: { sheetCount: 2, pageCount: 0 },
  warnings: [],
};

test("Project Context is a governed upload and classification type", () => {
  assert.ok(CLASSIFICATION_TAXONOMY.includes("Project Context"));
  assert.ok(DOCUMENT_TYPES.includes("Project Context"));
  assert.equal(
    DOWNSTREAM_ROUTES["Project Context"],
    "Project Context Extraction",
  );
});

test("lead qualification workbook is Project Context, never Price List", () => {
  const result = classifySample(leadQualificationSample, {
    fileName: "Bab Al Khair Hospital NPQ.xlsx",
    declaredType: "Auto Detection",
    projectContext: "Phase 6 Real Tender Validation",
  });

  assert.equal(result.primaryType, "Project Context");
  assert.notEqual(result.primaryType, "Price List");
  assert.equal(result.downstreamRoute, "Project Context Extraction");
  assert.ok(result.confidence >= 80);
  assert.equal(result.manualReviewRequired, false);
});

test("Project Context classification retains evidence", () => {
  const result = classifySample(leadQualificationSample, {
    fileName: "Bab Al Khair Hospital NPQ.xlsx",
  });

  assert.ok(result.evidence.some((item) =>
    /lead qualification|project details|scope|timeline/i.test(
      String(item.label || "") + " " + String(item.excerpt || ""),
    ),
  ));
});

test("manual classification UI exposes Project Context", () => {
  const page = fs.readFileSync(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    page,
    /documentClassificationTypes[\s\S]*"Project Context"/,
  );
});
