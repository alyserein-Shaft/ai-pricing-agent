import test from "node:test";
import assert from "node:assert/strict";

import {
  PROJECT_CONTEXT_PARSER_VERSION,
  extractProjectContextWorkbook,
} from "../app/domain/project-context-extractor.mjs";

const row = (sourceRow, values) => ({
  sourceRow,
  cells: Object.entries(values).map(([reference, value]) => ({
    reference,
    value,
  })),
});

const workbook = {
  provenance: { parser: "native-openxml" },
  warnings: [],
  sheets: [
    {
      name: "Project name ",
      maxColumn: 6,
      mergedRanges: [],
      rows: [
        row(1, { A1: "Lead Qualification Checklist" }),
        row(2, { B2: "Total Score", F2: 56 }),
        row(5, {
          A5: "Project Name:",
          B5: "Bab Al-Khair Hospital",
          D5: "Full Name",
          E5: "Youssef Adawi",
        }),
        row(6, {
          A6: "Project Status: [On Hand/Bidding]",
          B6: "On Hand",
          D6: "Company Name",
          E6: "IHCC",
        }),
        row(7, {
          A7: "Project Category",
          B7: "Commercial",
          D7: "Company Role in the Project:",
          E7: "MEP Contractor",
        }),
        row(8, { A8: "Email Address", E8: "contact@example.com" }),
        row(9, { A9: "Phone Number", E9: "966500000000" }),
        row(10, { A10: "Address", E10: "Project is in Makkah" }),
        row(12, {
          B12: "Budget:",
          E12: "Nonprofit charity hospital; use cheapest compliant brand and maximum discount.",
        }),
        row(14, {
          A14: "Have we quoted for this client before? [Yes/No]",
          B14: "No",
        }),
        row(20, {
          D20: "Who makes the final purchasing decision?",
          E20: "Ibrahim Sabry",
        }),
        row(23, {
          A23: "Scope:",
          B23: "LC",
          C23: "Timeline:",
          E23: "Urgent",
        }),
        row(25, {
          A25: "Please list the specific requirements and their brands",
          B25: "Nonprofit charity hospital; use cheapest compliant brand and maximum discount.",
        }),
        row(30, { A30: "Low Current Systems", B30: "x" }),
        row(31, { A31: "Project Drawings", B31: "x" }),
        row(34, { A34: "BOQ", B34: "x" }),
      ],
    },
    {
      name: "List",
      maxColumn: 3,
      mergedRanges: [],
      rows: [
        row(1, {
          A1: "Project Status: [On Hand/Bidding]",
          B1: "On Hand",
          C1: 30,
        }),
        row(2, { A2: "Bidding", C2: 0 }),
      ],
    },
  ],
};

test("extracts governed project context facts from the authoritative sheet", () => {
  const result = extractProjectContextWorkbook(workbook, {
    projectId: "project-a",
    documentId: "document-a",
    documentVersionId: "version-a",
    fileName: "Bab Al Khair Hospital NPQ.xlsx",
  });

  assert.equal(PROJECT_CONTEXT_PARSER_VERSION, "project-context-xlsx-1.0.0");
  assert.equal(result.sourceSheet, "Project name ");
  assert.equal(result.status, "Needs Review");

  const facts = Object.fromEntries(
    result.facts.map((fact) => [fact.key, fact]),
  );

  assert.equal(facts.project_name.value, "Bab Al-Khair Hospital");
  assert.equal(facts.project_status.value, "On Hand");
  assert.equal(facts.project_category.value, "Commercial");
  assert.equal(facts.company_role.value, "MEP Contractor");
  assert.equal(facts.scope.value, "LC");
  assert.equal(facts.timeline.value, "Urgent");
  assert.equal(facts.quoted_before.value, "No");
  assert.equal(facts.low_current_available.value, "Available");
  assert.equal(facts.drawings_available.value, "Available");
  assert.equal(facts.boq_available.value, "Available");
});

test("retains immutable cell provenance and begins every fact Needs Review", () => {
  const result = extractProjectContextWorkbook(workbook);
  const projectName = result.facts.find(
    (fact) => fact.key === "project_name",
  );

  assert.deepEqual(projectName.source, {
    sheet: "Project name ",
    row: 5,
    cell: "B5",
    labelCell: "A5",
  });
  assert.equal(projectName.origin, "EXTRACTED");
  assert.equal(projectName.confidence, 100);
  assert.equal(projectName.reviewStatus, "Needs Review");
});

test("ignores template option sheets and does not invent blank fields", () => {
  const result = extractProjectContextWorkbook(workbook);

  assert.equal(
    result.facts.filter(
      (fact) => fact.key === "commercial_instruction",
    ).length,
    1,
  );
  assert.ok(!result.facts.some((fact) => fact.key === "budget_range"));
  assert.ok(!result.facts.some((fact) => fact.source.sheet === "List"));
  assert.ok(result.missingFields.includes("budget_range"));
});

test("marks narrative commercial instructions for AI interpretation without applying them", () => {
  const result = extractProjectContextWorkbook(workbook);
  const instruction = result.facts.find(
    (fact) => fact.key === "commercial_instruction",
  );

  assert.equal(instruction.requiresAiInterpretation, true);
  assert.equal(instruction.reviewStatus, "Needs Review");
  assert.equal(result.summary.approvedFacts, 0);
});
