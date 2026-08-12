import { requireMigratedTables } from "./schema-requirements.mjs";

const SUPPLIER_MEMORY_TABLES = [
  "knowledge_files",
  "knowledge_facts",
  "knowledge_product_links",
  "knowledge_file_events",
];

const uid = prefix => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();
const normalizedValue = value => clean(value).toLowerCase().replace(/[^a-z0-9.+/-]+/g, " ").trim();
const normalizedPartNumber = value => clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");

const fact = ({
  orgId,
  fileId,
  type,
  key,
  value,
  attributes,
  confidence,
  sourceLocation,
}) => ({
  id: uid("knowledgeFact"),
  orgId,
  fileId,
  type,
  key,
  originalValue: clean(value),
  normalizedValue: normalizedValue(value),
  attributes: JSON.stringify(attributes || {}),
  confidence,
  reviewStatus: confidence < 80 ? "Needs Review" : "Learned",
  sourceLocation: JSON.stringify(sourceLocation || {}),
});

export const persistSupplierQuoteKnowledgeMemory = async (
  env,
  { document, result, userId },
) => {
  await requireMigratedTables(env.DB, SUPPLIER_MEMORY_TABLES);

  const organizationId = document.organization_id;
  if (!organizationId) {
    throw Object.assign(
      new Error("Supplier quote memory requires an organization."),
      { code: "ORGANIZATION_REQUIRED" },
    );
  }

  let knowledgeFile = await env.DB.prepare(
    "SELECT * FROM knowledge_files WHERE organization_id=? AND sha256=?",
  ).bind(organizationId, document.sha256).first();

  const knowledgeFileAlreadyExisted = Boolean(knowledgeFile);
  const fileId = knowledgeFile?.id || uid("knowledgeFile");
  const processedAt = now();

  if (!knowledgeFile) {
    await env.DB.prepare(
      `INSERT INTO knowledge_files (
        id,organization_id,file_name,extension,mime_type,byte_size,sha256,
        object_key,detected_type,secondary_types,classification_confidence,
        classification_status,processing_status,extraction_method,
        extraction_version,summary,uploaded_by,processed_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      fileId,
      organizationId,
      document.original_filename,
      document.extension,
      document.mime_type || "application/octet-stream",
      Number(document.byte_size || 0),
      document.sha256,
      document.object_key,
      "Supplier Quotation",
      "[]",
      100,
      "Governed Supplier Intake",
      "Completed",
      result.parser,
      result.parserVersion,
      JSON.stringify({
        supplier: result.metadata.supplier,
        quotationReference: result.metadata.quotationReference,
        issueDate: result.metadata.issueDate,
        validUntil: result.metadata.validUntil,
        currency: result.metadata.currency,
        rowCount: result.rows.length,
        supplierLineCount: result.rows.filter(row => row.rowType === "SUPPLIER_LINE").length,
        downstreamUse: "Discovery Only",
      }),
      userId,
      processedAt,
    ).run();

    knowledgeFile = { id: fileId };
  }

  const statements = [];
  const linkStatements = [];

  for (const row of result.rows.filter(entry => entry.rowType === "SUPPLIER_LINE")) {
    const page =
      row.raw?.page ??
      (Number(String(row.sheet || "").match(/PDF page\s+(\d+)/i)?.[1] || 0) || null);

    const sourceLocation = {
      documentId: document.id,
      documentVersionId: document.current_version_id,
      checksum: document.sha256,
      sheet: row.sheet || null,
      page,
      row: row.rowNumber,
      parser: result.parser,
      parserVersion: result.parserVersion,
    };

    const observationKey =
      `supplier-quote:${document.current_version_id}:${row.sheet || "source"}:${row.rowNumber}`;

    const shared = {
      observationKey,
      supplier: row.supplier || result.metadata.supplier || null,
      quotationReference:
        row.quotationReference || result.metadata.quotationReference || null,
      issueDate: row.issueDate || result.metadata.issueDate || null,
      validUntil: row.validUntil || result.metadata.validUntil || null,
      sourceType: "Supplier Quotation",
      historicalObservation: true,
      reviewRequired: true,
    };

    const facts = [];

    if (row.partNumber) {
      facts.push(fact({
        orgId: organizationId,
        fileId,
        type: "Part Number",
        key: `${observationKey}:part-number`,
        value: row.partNumber,
        attributes: {
          ...shared,
          description: row.description || null,
          manufacturer: row.manufacturer || "Unknown",
          unit: row.unit || "Unknown",
        },
        confidence: 99,
        sourceLocation,
      }));
    }

    if (row.description) {
      facts.push(fact({
        orgId: organizationId,
        fileId,
        type: "Product Description",
        key: `${observationKey}:description`,
        value: row.description,
        attributes: {
          ...shared,
          partNumber: row.partNumber || null,
        },
        confidence: 98,
        sourceLocation,
      }));
    }

    if (row.unit) {
      facts.push(fact({
        orgId: organizationId,
        fileId,
        type: "Unit",
        key: `${observationKey}:unit`,
        value: row.unit,
        attributes: {
          ...shared,
          partNumber: row.partNumber || null,
        },
        confidence: 95,
        sourceLocation,
      }));
    }

    const amount = row.netUnitPrice ?? row.unitPrice;
    const currency = row.currency || result.metadata.currency || null;

    if (amount !== null && amount !== undefined && currency) {
      facts.push(fact({
        orgId: organizationId,
        fileId,
        type: "Price",
        key: `${observationKey}:price`,
        value: `${currency} ${amount}`,
        attributes: {
          ...shared,
          partNumber: row.partNumber || null,
          currency,
          amount,
          priceType: "Supplier Quotation Price",
          effectiveDate: row.issueDate || result.metadata.issueDate || null,
          validity: row.validUntil || result.metadata.validUntil || null,
          approvalStatus: "Discovery Only",
          discoveryStatus: "Discovery Only",
          costingEligible: false,
        },
        confidence: 99,
        sourceLocation,
      }));
    }

    for (const entry of facts) {
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO knowledge_facts (
            id,organization_id,knowledge_file_id,fact_type,fact_key,
            original_value,normalized_value,attributes,confidence,
            review_status,source_location
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        ).bind(
          entry.id,
          entry.orgId,
          entry.fileId,
          entry.type,
          entry.key,
          entry.originalValue,
          entry.normalizedValue,
          entry.attributes,
          entry.confidence,
          entry.reviewStatus,
          entry.sourceLocation,
        ),
      );

      if (entry.type === "Part Number") {
        linkStatements.push(
          env.DB.prepare(
            `INSERT OR IGNORE INTO knowledge_product_links (
              id,organization_id,knowledge_fact_id,part_number,
              existing_product_id,link_state,new_information
            )
            SELECT ?,?,f.id,?,p.id,
              CASE
                WHEN p.id IS NULL THEN 'New Product Candidate'
                ELSE 'Existing Product — Additive Learning Only'
              END,
              ?
            FROM knowledge_facts f
            LEFT JOIN library_products p
              ON p.normalized_part_number=?
            WHERE f.knowledge_file_id=?
              AND f.fact_type='Part Number'
              AND f.fact_key=?
            LIMIT 1`,
          ).bind(
            uid("knowledgeLink"),
            organizationId,
            entry.originalValue,
            JSON.stringify({
              sourceType: "Supplier Quotation",
              reviewRequired: true,
              costingEligible: false,
            }),
            normalizedPartNumber(entry.originalValue),
            fileId,
            entry.key,
          ),
        );
      }
    }
  }

  for (let index = 0; index < statements.length; index += 75) {
    await env.DB.batch(statements.slice(index, index + 75));
  }
  for (let index = 0; index < linkStatements.length; index += 75) {
    await env.DB.batch(linkStatements.slice(index, index + 75));
  }

  const existingLearnEvent = await env.DB.prepare(
    "SELECT id FROM knowledge_file_events WHERE knowledge_file_id=? AND event_type='Supplier Quotation Learned' LIMIT 1",
  ).bind(fileId).first();

  if (!existingLearnEvent) {
    await env.DB.prepare(
      `INSERT INTO knowledge_file_events (
        id,organization_id,knowledge_file_id,event_type,details,actor_user_id
      ) VALUES (?,?,?,?,?,?)`,
    ).bind(
      uid("knowledgeEvent"),
      organizationId,
      fileId,
      "Supplier Quotation Learned",
      JSON.stringify({
        quotationReference: result.metadata.quotationReference,
        supplier: result.metadata.supplier,
        supplierLineCount: result.rows.filter(row => row.rowType === "SUPPLIER_LINE").length,
        downstreamUse: "Discovery Only",
        costingEligible: false,
      }),
      userId,
    ).run();
  }

  return {
    knowledgeFileId: fileId,
    supplierLinesLearned:
      result.rows.filter(row => row.rowType === "SUPPLIER_LINE").length,
    duplicateFile: knowledgeFileAlreadyExisted,
    eventCreated: !existingLearnEvent,
  };
};

const parseJson = (value, fallback = {}) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

export const persistSupplierQuoteKnowledgeMemoryFromRun = async (
  env,
  { document, run, userId },
) => {
  const persisted = await env.DB.prepare(
    "SELECT * FROM supplier_quote_intake_rows WHERE intake_run_id=? ORDER BY sheet_name,row_number",
  ).bind(run.id).all();

  const rows = (persisted.results || []).map(row => ({
    rowType: row.row_type,
    sheet: row.sheet_name,
    rowNumber: row.row_number,
    itemNumber: row.item_number,
    supplier: row.supplier_name,
    quotationReference: row.quotation_reference,
    manufacturer: row.manufacturer,
    partNumber: row.part_number,
    description: row.description,
    unit: row.unit,
    quantity: row.quantity,
    currency: row.currency,
    listPrice: row.list_price_minor == null ? null : row.list_price_minor / 100,
    unitPrice: row.unit_price_minor == null ? null : row.unit_price_minor / 100,
    discount: row.discount_basis_points == null ? null : row.discount_basis_points / 100,
    netUnitPrice: row.net_price_minor == null ? null : row.net_price_minor / 100,
    issueDate: row.issue_date,
    validUntil: row.valid_until,
    reviewStatus: row.review_status,
    raw: parseJson(row.raw_values, {}),
  }));

  return persistSupplierQuoteKnowledgeMemory(env, {
    document,
    userId,
    result: {
      parser: String(run.parser_version || "persisted-supplier-intake").split(":")[0],
      parserVersion: String(run.parser_version || "").split(":").slice(1).join(":") || "1",
      metadata: {
        supplier: run.supplier_name,
        quotationReference: run.quotation_reference,
        issueDate: run.issue_date,
        validUntil: run.valid_until,
        currency: run.currency,
      },
      rows,
    },
  });
};
