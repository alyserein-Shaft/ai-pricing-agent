const parseJson = (value, fallback) => {
  try {
    return value == null ? fallback : typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
};

const normName = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const normalizedModernValue = (row) => {
  if (row.normalized_value !== null && row.normalized_value !== undefined && row.normalized_value !== "") {
    const parsed = parseJson(row.normalized_value, Symbol.for("invalid-json"));
    return parsed === Symbol.for("invalid-json") ? row.normalized_value : parsed;
  }

  const valueJson = parseJson(row.value_json, null);
  if (valueJson && typeof valueJson === "object" && "normalized" in valueJson) {
    return valueJson.normalized;
  }

  return row.original_value ?? null;
};

export function projectModernProductAttribute(row) {
  return {
    name: row.attribute_name,
    normalizedValue: normalizedModernValue(row),
    originalValue: row.original_value ?? null,
    unit: row.unit ?? null,
    confidence: Number(row.confidence ?? 0),
    reviewStatus: row.review_status ?? null,
    sourceId: row.source_id ?? null,
    evidence: parseJson(row.evidence_json, null),
    knowledgeRepresentation: "product_attributes",
  };
}

export function mergeMatchingProductAttributes({
  legacyAttributes = [],
  modernAttributes = [],
} = {}) {
  const legacy = Array.isArray(legacyAttributes) ? legacyAttributes : [];
  const modernRows = Array.isArray(modernAttributes) ? modernAttributes : [];

  // Callers provide modern rows newest-first. Only the first active row for a
  // canonical attribute name is projected; older active duplicates cannot
  // create multiple competing values inside product.attributes.
  const modernByName = new Map();

  for (const row of modernRows) {
    const key = normName(
      row.attribute_name ||
      row.name ||
      row.attributeName ||
      row.canonicalName ||
      row.originalName
    );

    if (!key || modernByName.has(key)) continue;

    modernByName.set(
      key,
      row.attribute_name
        ? projectModernProductAttribute(row)
        : { ...row, knowledgeRepresentation: row.knowledgeRepresentation || "product_attributes" }
    );
  }

  const output = [];

  for (const entry of legacy) {
    const key = normName(
      entry?.name ||
      entry?.attributeName ||
      entry?.canonicalName ||
      entry?.originalName
    );

    // Modern Product Knowledge is authoritative for the same canonical name.
    if (key && modernByName.has(key)) continue;

    output.push({
      ...entry,
      knowledgeRepresentation: entry?.knowledgeRepresentation || "legacy_library_product",
    });
  }

  output.push(...modernByName.values());

  return output;
}

export function projectMatchingProduct(row, modernAttributes = []) {
  return {
    ...row,
    attributes: mergeMatchingProductAttributes({
      legacyAttributes: parseJson(row.attributes, []),
      modernAttributes,
    }),
    standards: parseJson(row.standards, []),
  };
}
