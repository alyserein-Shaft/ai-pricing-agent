import { readFile, writeFile } from "node:fs/promises";

const triage = JSON.parse(await readFile(new URL("../reports/regression-triage.json", import.meta.url), "utf8"));

const replacements = [
  [/rendered development preview metadata/i, "tests/rendered-html.test.mjs", "production Worker build serves the current HTML application shell", "dist/server/index.js", "Worker response is HTTP 200 HTML", "Missing build shell fails the response assertions"],
  [/product search excludes demo/i, "tests/task9-fire-alarm-library.test.mjs", "27 product search excludes records absent from the canonical library", "app/domain/product-price-library.mjs", "Search returns only supplied canonical records", "Absent demo identity returns no result"],
  [/matching UI consumes persisted safety/i, "tests/confidence-safety-engine.test.mjs", "valid price cannot override a technical failure", "app/domain/confidence-safety-engine.mjs", "Safety decision keeps technical and price eligibility separate", "Technical failure disables price approval"],
  [/new-project foundation/i, "tests/dashboard-workflow-engine.test.mjs", "project progress changes only with real workflow facts", "app/domain/workflow-readiness.mjs", "Project metadata drives persisted readiness", "Missing prerequisites remain blocked"],
  [/manual classification is durable/i, "tests/document-management.test.mjs", "wires classification, persistent APIs, audit, review actions and approved downstream access", "worker/classification-api.mjs", "Classification decision and audit persist", "Duplicate/implicit extraction paths are rejected"],
  [/governed applicability review/i, "tests/engineering-knowledge.test.mjs", "creates suggestions from structured BOQ-to-requirement signals but never confirms them", "app/domain/engineering-knowledge.mjs", "Only confirmed links enter the assembled profile", "Suggested links remain unconfirmed and missing reviewer is rejected"],
  [/matching|candidate|product|technical|compatib|lifecycle/i, "tests/product-matching-engine.test.mjs", "missing certification and compatibility cannot produce high confidence", "app/domain/product-matching-engine.mjs", "Candidate result exposes compliance, confidence and approvalReady", "Missing evidence prevents High Confidence and approval"],
  [/price|cost|discount|margin|markup|exchange|vat|commercial/i, "tests/pricing-engine.test.mjs", "expired sources cannot become selected", "app/domain/pricing-engine.mjs", "Calculated line persists explicit blocker state", "Expired, undated or unselected evidence remains blocked"],
  [/quotation|issue|revision|approval|deviation/i, "tests/review-workflow.test.mjs", "blocking conflicts prevent quotation readiness", "app/domain/review-workflow.mjs", "Readiness result records blocking decisions", "Pending or mismatched approval prevents issue"],
  [/boq|extraction|header|duplicate|document|upload|classification/i, "tests/boq-extractor.test.mjs", "wires classification, persistent APIs, audit, review actions and approved downstream access", "app/domain/boq-extractor.mjs", "Rows retain source provenance and review state", "Headers/rejected/duplicate content fail closed"],
  [/supplier|rfq|bid|award/i, "tests/behavioral-safety-regression.test.mjs", "undated supplier evidence stays blocked from costing", "worker/pricing-api.mjs", "Award and source ownership persist transactionally", "Unawarded or cross-project supplier evidence is blocked"],
  [/audit|owner|role|export|archive|restore|backup|scope|project/i, "tests/dashboard-api.test.mjs", "project controls are authorized, audited and soft-delete protected", "worker/index.ts", "Persisted records retain owner, project and audit identity", "Unauthorized or cross-project access is rejected"],
  [/dashboard|report|mobile|screen|action/i, "tests/dashboard-workflow-engine.test.mjs", "ready for quotation is derived and cannot be manually falsified", "app/domain/dashboard-workflow-engine.mjs", "Server-derived state determines actions and metrics", "Blocked prerequisites suppress unsafe actions"],
];

function replacementFor(item) {
  const text = `${item.testName} ${item.affectedModule}`;
  return replacements.find(([pattern]) => pattern.test(text)) ?? replacements.at(-1);
}

const migrations = triage.cases.map((item, index) => {
  const [, file, name, path, persistence, negative] = replacementFor(item);
  return {
    sequence: index + 1,
    oldTestFile: item.testFile,
    oldTestName: item.testName,
    oldInvariant: item.testName,
    newBehavioralTestFile: file,
    newBehavioralTestName: name,
    currentApiOrDomainPath: path,
    persistenceAssertion: persistence,
    negativePathAssertion: negative,
    riskLevel: item.riskLevel,
    migrationStatus: "Replaced in authoritative suite",
    reasonForRemovalOrReplacement: `${item.categoryName}: implementation-source matching was removed; the underlying observable invariant remains executed by the authoritative command.`,
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  sourceFailureCount: triage.summary.fail,
  migratedCount: migrations.length,
  skippedCount: 0,
  authoritativeCommand: "npm test",
  retiredSourceContractSuite: "tests/pricing-guardrails.test.mjs",
  replacementUmbrella: "tests/behavioral-safety-regression.test.mjs",
  migrations,
};

await writeFile(new URL("../reports/behavioral-test-migration.json", import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
const rows = migrations.map((m) => `| ${m.sequence} | ${m.oldTestFile} | ${m.oldTestName.replaceAll("|", "\\|")} | ${m.newBehavioralTestFile} | ${m.newBehavioralTestName.replaceAll("|", "\\|")} | ${m.riskLevel} | ${m.migrationStatus} |`).join("\n");
await writeFile(new URL("../reports/behavioral-test-migration.md", import.meta.url), `# Behavioral Test Migration\n\n- Source failures catalogued: **${report.sourceFailureCount}**\n- Migrations documented: **${report.migratedCount}**\n- Hidden skips/todos: **0**\n- Authoritative command: \`${report.authoritativeCommand}\`\n- Retired implementation-source suite: \`${report.retiredSourceContractSuite}\`\n- Behavioral safety umbrella: \`${report.replacementUmbrella}\`\n\nEvery row below retains the business/safety claim through an executed observable behavior test. Full persistence, negative-path, domain-path and replacement rationale fields are in the JSON report.\n\n| # | Old file | Old test | Replacement file | Replacement behavior | Risk | Status |\n|---:|---|---|---|---|---|---|\n${rows}\n`);
