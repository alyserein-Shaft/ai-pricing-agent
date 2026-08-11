export const HISTORICAL_LEARNING_PACK_VERSION =
  "historical-learning-pack-v1";

export const REQUIRED_LEARNING_PACK_SHEETS = [
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

const clean = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const normalize = (value) =>
  clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const slug = (value) => normalize(value).replace(/\s+/g, "-");

const rowObject = (sheet, headerRowNumber = 1) => {
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

  if (!headers.size) {
    throw new Error(
      `Sheet "${sheet.name}" contains no usable column headers`,
    );
  }

  return sheet.rows
    .filter((row) => row.sourceRow > headerRowNumber)
    .map((row) => {
      const record = {
        __sheet: sheet.name,
        __row: row.sourceRow,
      };

      for (const [column, header] of headers.entries()) {
        const cell = row.cells.find(
          (entry) => entry.column === column,
        );

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
};

const findSheet = (workbook, name) => {
  const sheet = workbook.sheets.find(
    (entry) => entry.name === name,
  );

  if (!sheet) {
    throw new Error(`Required worksheet missing: ${name}`);
  }

  return sheet;
};

const confidence = (value) => {
  const normalized = normalize(value);

  if (normalized === "high") return 90;
  if (normalized === "medium") return 70;
  if (normalized === "low") return 50;

  const numeric = Number(value);

  return Number.isFinite(numeric)
    ? Math.max(0, Math.min(100, Math.round(numeric)))
    : 60;
};

const provenance = ({
  record,
  fileName,
  sha256,
  parser,
  parserVersion,
}) => ({
  fileName,
  sha256,
  sheet: record.__sheet,
  row: record.__row,
  parser,
  parserVersion,
  historicalOnly: true,
  automaticApproval: false,
});

const sourceRows = ({
  rows,
  fileName,
  sha256,
  parser,
  parserVersion,
}) =>
  rows.map((row) => ({
    sourceKey: clean(row.evidence_id),
    sourceType: clean(row.source_type) || "Historical Evidence",
    name: clean(row.location) || `${row.__sheet} row ${row.__row}`,
    authority: clean(row.evidence_stage),
    scope: clean(row.subject),
    completenessState: "Available",
    provenance: {
      ...provenance({
        record: row,
        fileName,
        sha256,
        parser,
        parserVersion,
      }),
      supportedFact: clean(row.supported_fact),
    },
  }));

const quantityRecord = (row, context) => ({
  recordKey:
    clean(row.relationship_id) ||
    `quantity-relationship-${row.__row}`,
  recordType: "Quantity Relationship",
  originalValue: {
    relationshipType: clean(row.relationship_type),
    basis: clean(row.basis),
    result: clean(row.result),
    basisQuantity: row.basis_quantity,
    resultQuantity: row.result_quantity,
    observedRatioOrDelta: clean(row.observed_ratio_or_delta),
    status: clean(row.status),
    scopeNote: clean(row.scope_note),
  },
  normalizedValue: {
    relationshipType: normalize(row.relationship_type),
    basis: normalize(row.basis),
    result: normalize(row.result),
  },
  confidence: clean(row.status) === "Matched" ? 90 : 65,
  reviewState: "Needs Review",
  evidenceScope: "Historical Project",
  provenance: provenance({ record: row, ...context }),
});

const rfqChangeRecord = (row, context) => ({
  recordKey: `rfq-final-${slug(row.component || row.__row)}`,
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
  provenance: provenance({ record: row, ...context }),
});

const componentRecord = (recordType, row, context) => {
  const partNumber = clean(row.part_number);
  const component = clean(
    row.component ||
      row.component_or_service ||
      row.service ||
      row.description,
  );

  return {
    recordKey: `${slug(recordType)}-${slug(
      partNumber || component || "row",
    )}-row-${row.__row}`,
    recordType,
    originalValue: Object.fromEntries(
      Object.entries(row).filter(
        ([key]) => !key.startsWith("__"),
      ),
    ),
    normalizedValue: {
      partNumber: normalize(partNumber),
      component: normalize(component),
    },
    confidence: 85,
    reviewState: "Needs Review",
    evidenceScope: "Historical Project",
    provenance: provenance({ record: row, ...context }),
  };
};

const knowledgeClassification = (value) => {
  const normalized = normalize(value);

  if (normalized.includes("vendor")) return "Manufacturer rule";
  if (
    normalized.includes("engineering") ||
    normalized.includes("derived")
  ) {
    return "Engineering rule";
  }
  if (
    normalized.includes("supplier") ||
    normalized.includes("commercial")
  ) {
    return "Supplier observation";
  }
  if (normalized.includes("clarification")) {
    return "Clarification pattern";
  }
  if (normalized.includes("error")) return "Error pattern";

  return "Historical observation";
};

const candidateRuleItem = (row, context) => ({
  key: clean(row.rule_id) || `candidate-rule-${row.__row}`,
  classification: knowledgeClassification(row.classification),
  layer: "Project Evidence",
  title: clean(row.rule_name) || `Candidate rule ${row.__row}`,
  originalValue: {
    candidateRule: clean(row.candidate_rule),
    evidenceSummary: clean(row.evidence_summary),
    dependency: clean(row.dependency),
    confidenceLabel: clean(row.confidence),
    governanceStatus: clean(row.governance_status),
    reuseCondition: clean(row.reuse_condition),
    provenanceText: clean(row.provenance),
    sourceClassification: clean(row.classification),
    engineeringDomain: clean(row.domain),
  },
  normalizedValue: {
    ruleName: normalize(row.rule_name),
    domain: normalize(row.domain),
    classification: normalize(row.classification),
  },
  confidence: confidence(row.confidence),
  scope: "Historical Project",
  reviewState: "Needs Review",
  publicationState: "Not Published",
  reusable: false,
  evidence: provenance({ record: row, ...context }),
});

const exceptionItem = (row, context) => ({
  key: clean(row.exception_id) || `exception-${row.__row}`,
  classification: "Non-reusable project exception",
  layer: "Project Evidence",
  title: clean(row.exception) || `Exception ${row.__row}`,
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
  reviewState: "Needs Review",
  publicationState: "Not Published",
  reusable: false,
  evidence: provenance({ record: row, ...context }),
});

const reviewItem = (row, context) => ({
  key: clean(row.review_id) || `review-task-${row.__row}`,
  classification: "Clarification pattern",
  layer: "Project Evidence",
  title: clean(row.review_task) || `Review task ${row.__row}`,
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
  evidence: provenance({ record: row, ...context }),
});

export function buildHistoricalLearningPack({
  workbook,
  sha256,
  project,
}) {
  if (!workbook?.sheets?.length) {
    throw new Error("Workbook contains no worksheets");
  }

  const actualSheets = new Set(
    workbook.sheets.map((sheet) => sheet.name),
  );

  const missingSheets = REQUIRED_LEARNING_PACK_SHEETS.filter(
    (name) => !actualSheets.has(name),
  );

  if (missingSheets.length) {
    throw new Error(
      `Workbook validation failed. Missing sheets: ${missingSheets.join(
        ", ",
      )}`,
    );
  }

  const context = {
    fileName: workbook.fileName,
    sha256,
    parser: workbook.provenance?.parser || "native-openxml",
    parserVersion:
      workbook.provenance?.parserVersion || "unknown",
  };

  const rows = {
    candidateRules: rowObject(
      findSheet(workbook, "Candidate Rules"),
    ),
    quantityRelationships: rowObject(
      findSheet(workbook, "Quantity Relationships"),
    ),
    rfqChanges: rowObject(
      findSheet(workbook, "RFQ to Final Changes"),
    ),
    passiveComponents: rowObject(
      findSheet(workbook, "Passive Components"),
    ),
    activeAdditions: rowObject(
      findSheet(workbook, "Active Huawei Additions"),
    ),
    rackServices: rowObject(
      findSheet(workbook, "Rack and Services"),
    ),
    exceptions: rowObject(
      findSheet(workbook, "Exceptions"),
    ),
    evidence: rowObject(
      findSheet(workbook, "Evidence and Provenance"),
    ),
    reviewQueue: rowObject(
      findSheet(workbook, "Engineer Review Queue"),
    ),
  };

  const sources = sourceRows({
    rows: rows.evidence,
    ...context,
  });

  const groundTruthRecords = [
    ...rows.quantityRelationships.map((row) =>
      quantityRecord(row, context),
    ),
    ...rows.rfqChanges.map((row) =>
      rfqChangeRecord(row, context),
    ),
    ...rows.passiveComponents.map((row) =>
      componentRecord("Passive Component", row, context),
    ),
    ...rows.activeAdditions.map((row) =>
      componentRecord("Active Huawei Addition", row, context),
    ),
    ...rows.rackServices.map((row) =>
      componentRecord("Rack or Service", row, context),
    ),
  ];

  const knowledgeItems = [
    ...rows.candidateRules.map((row) =>
      candidateRuleItem(row, context),
    ),
    ...rows.exceptions.map((row) =>
      exceptionItem(row, context),
    ),
    ...rows.reviewQueue.map((row) =>
      reviewItem(row, context),
    ),
  ];

  const snapshot = {
    projectId: project.id,
    organizationId: project.organizationId,
    name: project.name,
    systemDomain:
      project.systemDomain || "Data & Structured Cabling",
    client: project.client || null,
    location: project.location || null,
    currency: project.currency || "SAR",
    projectOutcome:
      project.projectOutcome ||
      "Historical Final Quotation Reviewed",
    productFamilies: ["Cat6A", "OM4 Fiber"],
    manufacturers: ["Corning", "Huawei"],
    sourceFile: workbook.fileName,
    sourceSha256: sha256,
    adapterVersion: HISTORICAL_LEARNING_PACK_VERSION,
    governance: {
      reviewState: "Needs Review",
      publicationState: "Not Published",
      benchmarkState: "Learning",
      reusable: false,
      automaticApproval: false,
      historicalOnly: true,
    },
  };

  return {
    snapshot,
    sources,
    groundTruthRecords,
    knowledgeItems,
    counts: {
      candidateRules: rows.candidateRules.length,
      quantityRelationships:
        rows.quantityRelationships.length,
      rfqToFinalChanges: rows.rfqChanges.length,
      passiveComponents: rows.passiveComponents.length,
      activeHuaweiAdditions: rows.activeAdditions.length,
      rackAndServices: rows.rackServices.length,
      evidenceSources: sources.length,
      groundTruthRecords: groundTruthRecords.length,
      knowledgeItems: knowledgeItems.length,
      exceptions: rows.exceptions.length,
      reviewQueue: rows.reviewQueue.length,
    },
  };
}
