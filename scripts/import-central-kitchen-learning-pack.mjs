import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";

import { parseXlsxWorkbook } from "../app/document-parsers/xlsx.mjs";

const EXPECTED_SHEETS = [
  "Executive Summary",
  "Candidate Rules",
  "Quantity Relationships",
  "RFQ to Final Changes",
  "Passive Components",
  "Active Huawei Additions",
  "Rack and Services",
  "Exceptions",
  "Evidence and Provenance",
  "Engineer Review Queue",
  "Governance",
];

const args = process.argv.slice(2);

function argument(name, fallback = "") {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slug(value) {
  return normalize(value).replace(/\s+/g, "-");
}

function rowObject(sheet, headerRowNumber = 1) {
  const headerRow = sheet.rows.find(
    (row) => row.sourceRow === headerRowNumber,
  );

  if (!headerRow) {
    throw new Error(
      `Sheet "${sheet.name}" is missing header row ${headerRowNumber}`,
    );
  }

  const headers = new Map(
    headerRow.cells
      .filter((cell) => clean(cell.value))
      .map((cell) => [cell.column, clean(cell.value)]),
  );

  return sheet.rows
    .filter((row) => row.sourceRow > headerRowNumber)
    .map((row) => {
      const record = {
        __sheet: sheet.name,
        __row: row.sourceRow,
      };

      for (const [column, header] of headers.entries()) {
        const cell = row.cells.find((entry) => entry.column === column);
        record[header] = cell?.value ?? "";
      }

      return record;
    })
    .filter((record) =>
      Object.entries(record).some(
        ([key, value]) =>
          !key.startsWith("__") && clean(value).length > 0,
      ),
    );
}

function findSheet(workbook, name) {
  const sheet = workbook.sheets.find(
    (entry) => entry.name === name,
  );

  if (!sheet) {
    throw new Error(`Required worksheet missing: ${name}`);
  }

  return sheet;
}

function confidenceToInteger(value) {
  const text = normalize(value);

  if (text === "high") return 90;
  if (text === "medium") return 70;
  if (text === "low") return 50;

  const numeric = Number(value);

  if (Number.isFinite(numeric)) {
    return Math.max(0, Math.min(100, Math.round(numeric)));
  }

  return 60;
}

function buildProvenance(record, fileName, checksum) {
  return {
    fileName,
    sha256: checksum,
    sheet: record.__sheet,
    row: record.__row,
    parser: "native-openxml",
    parserVersion: "1",
    historicalOnly: true,
  };
}

function buildGroundTruthRecords({
  quantityRelationships,
  rfqChanges,
  passiveComponents,
  activeAdditions,
  rackServices,
  fileName,
  checksum,
}) {
  const records = [];

  for (const row of quantityRelationships) {
    records.push({
      recordKey: clean(row.relationship_id),
      recordType: "Quantity Relationship",
      originalValue: {
        relationshipType: clean(row.relationship_type),
        basis: clean(row.basis),
        result: clean(row.result),
        basisQuantity: row.basis_quantity,
        resultQuantity: row.result_quantity,
        observedRatioOrDelta: clean(
          row.observed_ratio_or_delta,
        ),
        status: clean(row.status),
        scopeNote: clean(row.scope_note),
      },
      normalizedValue: {
        relationshipType: normalize(row.relationship_type),
        basis: normalize(row.basis),
        result: normalize(row.result),
      },
      confidence: clean(row.status) === "Matched" ? 90 : 65,
      reviewState:
        clean(row.status) === "Matched"
          ? "Needs Review"
          : "Needs Review",
      evidenceScope: "Historical Project",
      provenance: buildProvenance(row, fileName, checksum),
    });
  }

  for (const row of rfqChanges) {
    const key = `rfq-final-${slug(row.component)}`;

    records.push({
      recordKey: key,
      recordType: "RFQ to Final Change",
      originalValue: {
        component: clean(row.component),
        rfqQuantity: row.rfq_quantity,
        finalQuantity: row.final_quantity,
        quantityChange: row.quantity_change,
        status: clean(row.status),
        reviewNote: clean(row.review_note),
      },
      normalizedValue: {
        component: normalize(row.component),
        status: normalize(row.status),
      },
      confidence: 90,
      reviewState: "Needs Review",
      evidenceScope: "Historical Project",
      provenance: buildProvenance(row, fileName, checksum),
    });
  }

  const componentGroups = [
    ["Passive Component", passiveComponents],
    ["Active Huawei Addition", activeAdditions],
    ["Rack or Service", rackServices],
  ];

  for (const [recordType, rows] of componentGroups) {
    for (const row of rows) {
      const partNumber = clean(row.part_number);
      const component = clean(
        row.component ??
          row.component_or_service ??
          row.component_or_service,
      );

      records.push({
        recordKey: `${slug(recordType)}-${slug(
          partNumber || component,
        )}`,
        recordType,
        originalValue: {
          ...Object.fromEntries(
            Object.entries(row).filter(
              ([key]) => !key.startsWith("__"),
            ),
          ),
        },
        normalizedValue: {
          partNumber: normalize(partNumber),
          component: normalize(component),
        },
        confidence: 85,
        reviewState: "Needs Review",
        evidenceScope: "Historical Project",
        provenance: buildProvenance(row, fileName, checksum),
      });
    }
  }

  return records;
}

function buildKnowledgeItems({
  candidateRules,
  exceptions,
  reviewQueue,
  fileName,
  checksum,
}) {
  const items = [];

  for (const row of candidateRules) {
    const governanceStatus = clean(row.governance_status);

    items.push({
      key: clean(row.rule_id),
      classification: clean(row.classification),
      layer: clean(row.domain),
      title: clean(row.rule_name),
      originalValue: {
        candidateRule: clean(row.candidate_rule),
        evidenceSummary: clean(row.evidence_summary),
        dependency: clean(row.dependency),
        confidenceLabel: clean(row.confidence),
        governanceStatus,
        reuseCondition: clean(row.reuse_condition),
        provenanceText: clean(row.provenance),
      },
      normalizedValue: {
        ruleName: normalize(row.rule_name),
        domain: normalize(row.domain),
        classification: normalize(row.classification),
      },
      confidence: confidenceToInteger(row.confidence),
      scope: "Historical Project",
      reviewState: "Needs Review",
      publicationState: "Not Published",
      reusable: false,
      evidence: buildProvenance(row, fileName, checksum),
    });
  }

  for (const row of exceptions) {
    items.push({
      key: clean(row.exception_id),
      classification: "Exception",
      layer: "Safety / Review",
      title: clean(row.exception),
      originalValue: {
        evidence: clean(row.evidence),
        status: clean(row.status),
        priority: clean(row.priority),
        requiredAction: clean(row.required_action),
      },
      normalizedValue: {
        exception: normalize(row.exception),
        priority: normalize(row.priority),
      },
      confidence: 90,
      scope: "Historical Project",
      reviewState:
        clean(row.status) === "Resolved in pack"
          ? "Needs Review"
          : "Needs Review",
      publicationState: "Not Published",
      reusable: false,
      evidence: buildProvenance(row, fileName, checksum),
    });
  }

  for (const row of reviewQueue) {
    items.push({
      key: clean(row.review_id),
      classification: "Engineer Review Task",
      layer: "Review Queue",
      title: clean(row.review_task),
      originalValue: {
        relatedRuleOrException: clean(
          row.related_rule_or_exception,
        ),
        priority: clean(row.priority),
        owner: clean(row.owner),
        status: clean(row.status),
        reviewRole: clean(row.review_role),
        acceptanceCriteria: clean(row.acceptance_criteria),
      },
      normalizedValue: {
        reviewTask: normalize(row.review_task),
        reviewRole: normalize(row.review_role),
      },
      confidence: 100,
      scope: "Historical Project",
      reviewState: "Needs Review",
      publicationState: "Not Published",
      reusable: false,
      evidence: buildProvenance(row, fileName, checksum),
    });
  }

  return items;
}

function buildSources(evidenceRows, fileName, checksum) {
  return evidenceRows.map((row) => ({
    sourceKey: clean(row.evidence_id),
    sourceType: clean(row.source_type),
    name: clean(row.location),
    authority: clean(row.evidence_stage),
    scope: clean(row.subject),
    completenessState: "Reviewed Historical Evidence",
    provenance: {
      ...buildProvenance(row, fileName, checksum),
      supportedFact: clean(row.supported_fact),
    },
  }));
}

function buildSignals() {
  return [
    {
      signalType: "System",
      signalValue: "Data & Structured Cabling",
      normalizedValue: "data structured cabling",
      weight: 4,
    },
    {
      signalType: "Project",
      signalValue: "Central Kitchen - Makkah",
      normalizedValue: "central kitchen makkah",
      weight: 2,
    },
    {
      signalType: "Passive Vendor",
      signalValue: "Corning",
      normalizedValue: "corning",
      weight: 2,
    },
    {
      signalType: "Active Vendor",
      signalValue: "Huawei",
      normalizedValue: "huawei",
      weight: 2,
    },
    {
      signalType: "Technology",
      signalValue: "Cat6A",
      normalizedValue: "cat6a",
      weight: 2,
    },
    {
      signalType: "Technology",
      signalValue: "OM4 Fiber",
      normalizedValue: "om4 fiber",
      weight: 2,
    },
  ];
}

async function main() {
  const fileArgument = argument("--file");

  if (!fileArgument) {
    throw new Error(
      "Missing --file path to the approved learning-pack workbook",
    );
  }

  const projectId = argument(
    "--project-id",
    "central-kitchen-makkah",
  );
  const organizationId = argument(
    "--organization-id",
    "local-org",
  );
  const actorUserId = argument(
    "--actor-user-id",
    "historical-import",
  );

  const dryRun = hasFlag("--dry-run");
  const filePath = resolve(fileArgument);
  const fileName = basename(filePath);
  const bytes = await readFile(filePath);

  const checksum = createHash("sha256")
    .update(bytes)
    .digest("hex");

  const workbook = parseXlsxWorkbook(bytes, {
    fileName,
    sha256: checksum,
  });

  const actualSheets = new Set(
    workbook.sheets.map((sheet) => sheet.name),
  );

  const missingSheets = EXPECTED_SHEETS.filter(
    (name) => !actualSheets.has(name),
  );

  if (missingSheets.length) {
    throw new Error(
      `Workbook validation failed. Missing sheets: ${missingSheets.join(
        ", ",
      )}`,
    );
  }

  const candidateRules = rowObject(
    findSheet(workbook, "Candidate Rules"),
  );
  const quantityRelationships = rowObject(
    findSheet(workbook, "Quantity Relationships"),
  );
  const rfqChanges = rowObject(
    findSheet(workbook, "RFQ to Final Changes"),
  );
  const passiveComponents = rowObject(
    findSheet(workbook, "Passive Components"),
  );
  const activeAdditions = rowObject(
    findSheet(workbook, "Active Huawei Additions"),
  );
  const rackServices = rowObject(
    findSheet(workbook, "Rack and Services"),
  );
  const exceptions = rowObject(
    findSheet(workbook, "Exceptions"),
  );
  const evidenceRows = rowObject(
    findSheet(workbook, "Evidence and Provenance"),
  );
  const reviewQueue = rowObject(
    findSheet(workbook, "Engineer Review Queue"),
  );

  const sources = buildSources(
    evidenceRows,
    fileName,
    checksum,
  );

  const groundTruthRecords = buildGroundTruthRecords({
    quantityRelationships,
    rfqChanges,
    passiveComponents,
    activeAdditions,
    rackServices,
    fileName,
    checksum,
  });

  const knowledgeItems = buildKnowledgeItems({
    candidateRules,
    exceptions,
    reviewQueue,
    fileName,
    checksum,
  });

  const signals = buildSignals();

  const snapshot = {
    projectId,
    organizationId,
    name: "Central Kitchen - Makkah",
    systemDomain: "Data & Structured Cabling",
    client: "Al Mespar Contracting Corp. (MCC)",
    location: "Makkah",
    currency: "SAR",
    projectOutcome: "Historical Final Quotation Reviewed",
    sourceFile: fileName,
    sourceSha256: checksum,
    governance: {
      reviewState: "Needs Review",
      publicationState: "Not Published",
      benchmarkState: "Learning",
      reusable: false,
      automaticApproval: false,
      historicalOnly: true,
    },
  };

  const summary = {
    workbookValid: true,
    filePath,
    fileName,
    sha256: checksum,
    project: snapshot.name,
    projectId,
    organizationId,
    candidateRules: candidateRules.length,
    quantityRelationships: quantityRelationships.length,
    rfqToFinalChanges: rfqChanges.length,
    passiveComponents: passiveComponents.length,
    activeHuaweiAdditions: activeAdditions.length,
    rackAndServices: rackServices.length,
    sources: sources.length,
    groundTruthRecords: groundTruthRecords.length,
    knowledgeItems: knowledgeItems.length,
    exceptions: exceptions.length,
    reviewQueue: reviewQueue.length,
    similaritySignals: signals.length,
    reusableItems: knowledgeItems.filter(
      (item) => item.reusable,
    ).length,
    reviewState: "Needs Review",
    publicationState: "Not Published",
    benchmarkState: "Learning",
    historicalOnly: true,
    automaticApproval: false,
    databaseWrites: 0,
    mode: dryRun ? "dry-run" : "validation-only",
    actorUserId,
  };

  console.log("");
  console.log("Historical Learning Pack Import");
  console.log("================================");
  console.log(`Workbook valid: YES`);
  console.log(`File: ${summary.fileName}`);
  console.log(`SHA-256: ${checksum}`);
  console.log("");
  console.log(`Case Study: ${summary.project}`);
  console.log(`Project ID: ${projectId}`);
  console.log(`Organization ID: ${organizationId}`);
  console.log("");
  console.log(`Candidate Rules: ${summary.candidateRules}`);
  console.log(
    `Quantity Relationships: ${summary.quantityRelationships}`,
  );
  console.log(
    `RFQ-to-Final Changes: ${summary.rfqToFinalChanges}`,
  );
  console.log(
    `Passive Components: ${summary.passiveComponents}`,
  );
  console.log(
    `Active Huawei Additions: ${summary.activeHuaweiAdditions}`,
  );
  console.log(
    `Rack and Services: ${summary.rackAndServices}`,
  );
  console.log(`Evidence Sources: ${summary.sources}`);
  console.log(
    `Ground Truth Records: ${summary.groundTruthRecords}`,
  );
  console.log(`Knowledge Items: ${summary.knowledgeItems}`);
  console.log(`Exceptions: ${summary.exceptions}`);
  console.log(`Review Queue: ${summary.reviewQueue}`);
  console.log(
    `Similarity Signals: ${summary.similaritySignals}`,
  );
  console.log("");
  console.log(`Review State: ${summary.reviewState}`);
  console.log(
    `Publication State: ${summary.publicationState}`,
  );
  console.log(`Benchmark State: ${summary.benchmarkState}`);
  console.log(`Reusable Items: ${summary.reusableItems}`);
  console.log(`Historical Only: ${summary.historicalOnly}`);
  console.log(
    `Automatic Approval: ${summary.automaticApproval}`,
  );
  console.log(`Database Writes: ${summary.databaseWrites}`);
  console.log("");
  console.log("DRY RUN COMPLETED — no database changes were made.");
  console.log("");

  if (!dryRun) {
    console.log(
      "Note: commit mode is intentionally disabled until the dry-run output is approved.",
    );
  }
}

main().catch((error) => {
  console.error("");
  console.error("IMPORT FAILED");
  console.error(error instanceof Error ? error.message : error);
  console.error("");
  process.exitCode = 1;
});
