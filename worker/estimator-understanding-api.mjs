import {
  BOQ_UNDERSTANDING_PROMPT_VERSION,
  BOQ_UNDERSTANDING_SCHEMA_VERSION,
  interpretationConfigFingerprint,
  interpretationInputFingerprint,
  interpretBoqItem,
  prepareBoqUnderstandingInput,
  stableStringify,
} from "../app/domain/boq-understanding-engine.mjs";
import { createHash } from "node:crypto";
import { resolveApplicationContext } from "./application-context.mjs";
import { boqUnderstandingProviderReadiness, createConfiguredBoqUnderstandingProvider } from "./boq-understanding-provider.mjs";
import { currentBoqEvidenceFrom, currentBoqItemPredicate } from "./current-evidence-scope.mjs";
import { authorizeControlledPilotSelection, buildBoqUnderstandingPilotManifest, validateControlledPilotRequest } from "../app/domain/boq-understanding-pilot.mjs";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const projectAccess = (db, projectId, context) => db.prepare(`SELECT p.id FROM projects p LEFT JOIN project_members m ON m.project_id=p.id AND m.user_id=? AND m.status='Active' AND m.revoked_at IS NULL WHERE p.id=? AND p.organization_id=? AND (p.owner_user_id=? OR m.id IS NOT NULL)`).bind(context.userId, projectId, context.organizationId, context.userId).first();
const parse = (value, fallback = null) => { try { return value == null ? fallback : (typeof value === "string" ? JSON.parse(value) : value); } catch { return fallback; } };
const bounded = (values, limit = 12) => [...new Set(values.filter(Boolean).map((value) => String(value).slice(0, 120)))].slice(0, limit);
const safeUsage = (raw) => {
  const parsed = parse(raw, {});
  const metadata = parsed?.usage || parsed || {};
  const usage = metadata?.usage || {};
  const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
  return { durationMs: finite(metadata.durationMs), promptTokens: finite(usage.prompt_tokens), completionTokens: finite(usage.completion_tokens), totalTokens: finite(usage.total_tokens) };
};
const QUALITY_REASONS = new Set([
  "MODEL_CONFIDENCE_LOW",
  "ESSENTIAL_CLASSIFICATION_MISSING",
  "GOVERNED_CANDIDATE_KEY_MISSING_OR_INVALID",
  "APPLICABLE_ATTRIBUTE_MISSING",
  "NULL_LIKE_VALUE_REQUIRES_REVIEW",
  "SOURCE_PROVENANCE_CONTRADICTION",
  "RESERVED_ATTRIBUTE_REMOVED",
  "HISTORICAL_COMPLETION_REQUIRES_REVIEW",
]);
const ESSENTIAL_CLASSIFICATION_FIELDS = new Set(["system", "category", "equipmentType", "productFamily"]);
const RESERVED_ATTRIBUTE_KEYS = new Set(["itemnumber", "itemreference", "description", "quantity", "unit", "normalizedunit", "sourcelocation"]);
const NULL_LIKE = /^(?:unknown|n\/?a|not known|unspecified|null|nil|none|not[_ ]applicable)$/i;
const normalizedKey = (value) => String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
const stableReason = (value) => {
  const reason = String(value || "").split(":", 1)[0];
  if (/^GOVERNED_CANDIDATE_KEY_(?:MISSING|INVALID)$/.test(reason)) return "GOVERNED_CANDIDATE_KEY_MISSING_OR_INVALID";
  if (reason === "RESERVED_SOURCE_ATTRIBUTE_REMOVED") return "RESERVED_ATTRIBUTE_REMOVED";
  return QUALITY_REASONS.has(reason) ? reason : null;
};
export const qualityItem = (row) => {
  const interpretation = parse(row.interpretation, null);
  const blockingMissingFields = [];
  const informationalMissingFields = [];
  const origins = { EXTRACTED: 0, INFERRED: 0, MISSING: 0, NOT_APPLICABLE: 0 };
  const semanticReasons = [];
  const rowInput = prepareBoqUnderstandingInput({
    id: "quality-report-row",
    rowType: row.rowType,
    description: row.description,
    numericQuantity: row.numericQuantity,
    originalQuantity: row.originalQuantity,
    normalizedUnit: row.normalizedUnit,
    originalUnit: row.originalUnit,
    system: row.sourceSystem,
    category: row.sourceCategory,
    subcategory: row.sourceSubcategory,
    manufacturer: row.manufacturer,
    model: row.sourceModel,
    partNumber: row.sourcePartNumber,
    currentValues: parse(row.currentValues, {}),
    sourceLocation: parse(row.sourceLocation, null),
  });
  // Only literal source text and explicit identity columns can support EXTRACTED.
  // Derived BOQ classification columns are not evidence that a value appeared in source.
  const explicitSource = [row.description, row.manufacturer, row.sourceModel, row.sourcePartNumber]
    .filter(Boolean).join(" ").toLowerCase();
  const addMissing = (path, blocking) => (blocking ? blockingMissingFields : informationalMissingFields).push(path);
  const visit = (value, path = "") => {
    if (!value || typeof value !== "object") return;
    if (!Array.isArray(value) && ["EXTRACTED", "INFERRED", "MISSING", "NOT_APPLICABLE"].includes(value.origin)) {
      origins[value.origin] += 1;
      const root = path.split(".")[0];
      const blocking = ESSENTIAL_CLASSIFICATION_FIELDS.has(root) || root === "attributes";
      if (value.origin === "MISSING" || value.value === null) addMissing(path, blocking && root !== "subcategory");
      if (typeof value.value === "string" && NULL_LIKE.test(value.value.trim())) {
        addMissing(path, blocking && root !== "subcategory");
        semanticReasons.push("NULL_LIKE_VALUE_REQUIRES_REVIEW");
      }
      if (value.origin === "EXTRACTED" && value.value != null && path !== "normalizedDescription" && root !== "subcategory" && !RESERVED_ATTRIBUTE_KEYS.has(normalizedKey(path.split(".").at(-1)))) {
        const literal = String(value.value).trim().toLowerCase();
        if (literal && !explicitSource.includes(literal)) semanticReasons.push("SOURCE_PROVENANCE_CONTRADICTION");
      }
    }
    Object.entries(value).forEach(([key, child]) => visit(child, path ? `${path}.${key}` : key));
  };
  visit(interpretation);
  const essentialMissing = [...ESSENTIAL_CLASSIFICATION_FIELDS].filter((field) => interpretation?.[field]?.value == null || interpretation?.[field]?.origin === "MISSING");
  if (essentialMissing.length) semanticReasons.push("ESSENTIAL_CLASSIFICATION_MISSING");
  if (String(interpretation?.confidence || "").toUpperCase() === "LOW") semanticReasons.push("MODEL_CONFIDENCE_LOW");
  const attributes = interpretation?.attributes && typeof interpretation.attributes === "object" ? interpretation.attributes : {};
  const reservedAttributes = Object.keys(attributes).filter((key) => RESERVED_ATTRIBUTE_KEYS.has(normalizedKey(key)));
  if (reservedAttributes.length) semanticReasons.push("RESERVED_ATTRIBUTE_REMOVED");
  const applicableAttributes = rowInput.taxonomyContext?.attributeNames || [];
  for (const attribute of applicableAttributes) {
    const fact = attributes[attribute];
    if (!fact || fact.value == null || fact.origin === "MISSING" || (typeof fact.value === "string" && NULL_LIKE.test(fact.value.trim()))) {
      blockingMissingFields.push(`attributes.${attribute}`);
      semanticReasons.push("APPLICABLE_ATTRIBUTE_MISSING");
    }
  }
  const hasGovernedCandidate = (rowInput.taxonomyContext?.families || []).length > 0;
  if (hasGovernedCandidate && (interpretation?.system?.value == null || interpretation?.category?.value == null || interpretation?.productFamily?.value == null)) {
    semanticReasons.push("GOVERNED_CANDIDATE_KEY_MISSING_OR_INVALID");
  }
  const persistedReasons = (Array.isArray(interpretation?.reviewReasons) ? interpretation.reviewReasons : []).map(stableReason).filter(Boolean);
  const reviewReasons = bounded([...persistedReasons, ...semanticReasons.map(stableReason).filter(Boolean)]);
  const currentUnsafe = blockingMissingFields.length > 0 || reviewReasons.length > 0;
  const historicalUnsafeCompletion = row.status === "COMPLETED" && currentUnsafe;
  if (historicalUnsafeCompletion) reviewReasons.push("HISTORICAL_COMPLETION_REQUIRES_REVIEW");
  const failureCategory = row.status === "FAILED"
    ? (row.errorCode === "AI_OUTPUT_INVALID" ? "AI_OUTPUT_INVALID_LEGACY_UNDIAGNOSED" : String(row.errorCode || "AI_FAILURE_UNCLASSIFIED").slice(0, 80))
    : null;
  const finalStatus = row.status === "FAILED" || row.status === "AI_UNAVAILABLE"
    ? row.status
    : (row.status === "NEEDS_REVIEW" || currentUnsafe ? "NEEDS_REVIEW" : "COMPLETED");
  return {
    itemReference: row.itemReference || null,
    description: row.description || "",
    persistedStatus: row.status,
    finalStatus,
    canonicalClassification: interpretation ? {
      system: interpretation.system?.value ?? null,
      category: interpretation.category?.value ?? null,
      equipmentType: interpretation.equipmentType?.value ?? null,
      productFamily: interpretation.productFamily?.value ?? null,
    } : null,
    provenanceSummary: origins,
    acceptedAttributes: Object.entries(attributes).flatMap(([name, fact]) => {
      if (RESERVED_ATTRIBUTE_KEYS.has(normalizedKey(name)) || !fact || typeof fact !== "object" || fact.value == null || (typeof fact.value === "string" && NULL_LIKE.test(fact.value.trim()))) return [];
      return [{ name: String(name).slice(0, 80), value: typeof fact.value === "string" ? fact.value.slice(0, 160) : fact.value, origin: fact.origin, confidence: fact.confidence }];
    }).slice(0, 20),
    removedOrNormalizedAttributes: bounded([
      ...reservedAttributes.map(() => "RESERVED_ATTRIBUTE_REMOVED"),
      ...Object.entries(attributes).filter(([, fact]) => fact && typeof fact === "object" && typeof fact.value === "string" && NULL_LIKE.test(fact.value.trim())).map(([name]) => `NULL_LIKE_NORMALIZED:${name}`),
    ]),
    blockingMissingFields: bounded(blockingMissingFields),
    informationalMissingFields: bounded(informationalMissingFields),
    reviewReasons: bounded(reviewReasons),
    sanitizedFailureCategory: failureCategory,
    model: row.model,
    ...safeUsage(row.usageMetadata),
  };
};

const fingerprint = (value) => createHash("sha256").update(stableStringify(value)).digest("hex");

export function buildControlledRetryManifest(historicalRunId, qualityReport, historicalRows, authoritativeRows) {
  const historicalByReference = new Map();
  for (const row of historicalRows) {
    const reference = String(row.itemReference || "");
    const values = historicalByReference.get(reference) || [];
    values.push(row);
    historicalByReference.set(reference, values);
  }
  const authoritativeById = new Map(authoritativeRows.map((row) => [row.boqItemId || row.id, row]));
  const recommendations = qualityReport?.recommendedRetryItemReferences || [];
  if (!historicalRunId || recommendations.length !== 6 || new Set(recommendations).size !== 6) return { error: "CONTROLLED_RETRY_RECOMMENDATIONS_CHANGED", status: 409 };
  const selected = [];
  for (const itemReference of recommendations) {
    const historical = historicalByReference.get(String(itemReference)) || [];
    if (historical.length !== 1) return { error: "CONTROLLED_RETRY_RECOMMENDATIONS_CHANGED", status: 409 };
    const current = authoritativeById.get(historical[0].boqItemId);
    if (!current) return { error: "CONTROLLED_RETRY_EVIDENCE_STALE", status: 409 };
    const prepared = prepareBoqUnderstandingInput(current);
    selected.push({
      boqItemId: historical[0].boqItemId,
      itemReference,
      description: current.description,
      currentInputFingerprint: interpretationInputFingerprint(prepared),
      historicalInputFingerprint: historical[0].inputFingerprint,
      historicalStatus: historical[0].status,
      historicalInterpretationFingerprint: fingerprint(historical[0].interpretation || null),
      evidenceDocumentVersionId: current.evidenceDocumentVersionId,
      evidenceExtractionVersion: current.evidenceExtractionVersion,
      row: current,
    });
  }
  const retryFingerprint = fingerprint({
    mode: "CONTROLLED_RETRY",
    historicalRunId,
    items: selected.map(({ boqItemId, currentInputFingerprint, historicalInputFingerprint, historicalStatus, historicalInterpretationFingerprint, evidenceDocumentVersionId, evidenceExtractionVersion }) => ({ boqItemId, currentInputFingerprint, historicalInputFingerprint, historicalStatus, historicalInterpretationFingerprint, evidenceDocumentVersionId, evidenceExtractionVersion })),
  });
  return {
    mode: "CONTROLLED_RETRY",
    historicalRunId,
    retryFingerprint,
    itemIds: selected.map((item) => item.boqItemId),
    items: selected.map(({ itemReference, description }) => ({ itemReference, description })),
    rows: selected.map((item) => item.row),
    itemCount: selected.length,
  };
}

export function validateControlledRetryRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "CONTROLLED_RETRY_REQUEST_INVALID", status: 400 };
  if (Object.keys(body).sort().join(",") !== "historicalRunId,itemIds,mode,retryFingerprint" || body.mode !== "CONTROLLED_RETRY" || typeof body.historicalRunId !== "string" || !body.historicalRunId || typeof body.retryFingerprint !== "string" || !body.retryFingerprint || !Array.isArray(body.itemIds) || body.itemIds.length !== 6 || body.itemIds.some((value) => typeof value !== "string" || !value)) return { error: "CONTROLLED_RETRY_REQUEST_INVALID", status: 400 };
  if (new Set(body.itemIds).size !== 6) return { error: "CONTROLLED_RETRY_REQUEST_INVALID", status: 400 };
  return { value: { mode: "CONTROLLED_RETRY", historicalRunId: body.historicalRunId, retryFingerprint: body.retryFingerprint, itemIds: [...body.itemIds] } };
}

export function authorizeControlledRetryRequest(body, manifest) {
  const validated = validateControlledRetryRequest(body);
  if (validated.error) return validated;
  if (validated.value.historicalRunId !== manifest.historicalRunId || validated.value.retryFingerprint !== manifest.retryFingerprint) return { error: "CONTROLLED_RETRY_STALE", status: 409 };
  if (validated.value.itemIds.some((id, index) => id !== manifest.itemIds[index])) return { error: "CONTROLLED_RETRY_ITEMS_UNAUTHORIZED", status: 400 };
  return { value: { ...validated.value, rows: manifest.rows } };
}

export const buildPilotQualityReport = (run, rows) => {
  const items = rows.map(qualityItem);
  const summarize = (field) => {
    const count = (status) => items.filter((item) => item[field] === status).length;
    return { processed: items.length, completed: count("COMPLETED"), needsReview: count("NEEDS_REVIEW"), failed: count("FAILED"), unavailable: count("AI_UNAVAILABLE") };
  };
  const retryReasons = new Set(["GOVERNED_CANDIDATE_KEY_MISSING_OR_INVALID", "NULL_LIKE_VALUE_REQUIRES_REVIEW", "SOURCE_PROVENANCE_CONTRADICTION", "RESERVED_ATTRIBUTE_REMOVED", "HISTORICAL_COMPLETION_REQUIRES_REVIEW"]);
  const retryPriority = (item) => item.reviewReasons.includes("NULL_LIKE_VALUE_REQUIRES_REVIEW") ? 1
    : item.reviewReasons.includes("GOVERNED_CANDIDATE_KEY_MISSING_OR_INVALID") ? 2
      : item.reviewReasons.includes("SOURCE_PROVENANCE_CONTRADICTION") ? 3
        : item.sanitizedFailureCategory === "AI_OUTPUT_INVALID_LEGACY_UNDIAGNOSED" ? 4 : 5;
  const recommendedRetries = items.filter((item) => item.sanitizedFailureCategory === "AI_OUTPUT_INVALID_LEGACY_UNDIAGNOSED" || item.reviewReasons.some((reason) => retryReasons.has(reason)))
    .map((item, index) => ({ itemReference: item.itemReference, reasons: bounded([item.sanitizedFailureCategory, ...item.reviewReasons.filter((reason) => retryReasons.has(reason))], 8), priority: retryPriority(item), index }))
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .map(({ itemReference, reasons }) => ({ itemReference, reasons }));
  return {
    persistedSummary: summarize("persistedStatus"),
    effectiveQualitySummary: summarize("finalStatus"),
    model: run.model,
    items,
    recommendedRetryItemReferences: recommendedRetries.map((item) => item.itemReference),
    recommendedRetryCount: recommendedRetries.length,
    recommendedRetries,
  };
};

const loadPilotQualityReport = async (db, projectId, runId) => {
  const run = await db.prepare(`SELECT id,project_id projectId,model FROM estimator_understanding_runs WHERE id=? AND project_id=?`).bind(runId, projectId).first();
  if (!run) return null;
  const result = await db.prepare(`SELECT b.item_number itemReference,b.row_type rowType,b.description,b.numeric_quantity numericQuantity,b.original_quantity originalQuantity,b.normalized_unit normalizedUnit,b.original_unit originalUnit,b.system_value sourceSystem,b.category sourceCategory,b.subcategory sourceSubcategory,b.manufacturer,b.model sourceModel,b.part_number sourcePartNumber,b.current_values currentValues,b.source_location sourceLocation,i.status,i.error_code errorCode,i.model,i.raw_response usageMetadata,i.validated_interpretation interpretation
    FROM estimator_item_interpretations i JOIN boq_items b ON b.id=i.boq_item_id
    WHERE i.run_id=? AND i.project_id=? ORDER BY b.sequence,b.id`).bind(runId, projectId).all();
  return buildPilotQualityReport(run, result.results || []);
};

export async function runUnderstandingBatch(rows, { provider, existing = async () => null, save = async () => {}, confirmedSpecifications = {}, configFingerprint: configuredFingerprint = null } = {}) {
  const metadata = provider?.metadata || { provider: "unavailable", model: "unavailable", modelVersion: "unavailable" };
  const configFingerprint = configuredFingerprint || interpretationConfigFingerprint(metadata);
  const summary = { total: rows.length, processed: 0, successful: 0, review: 0, failed: 0, unavailable: 0, reused: 0 };
  const items = [];
  for (const row of rows) {
    const input = prepareBoqUnderstandingInput(row, confirmedSpecifications[row.boqItemId || row.id] || []);
    const inputFingerprint = interpretationInputFingerprint(input);
    const prior = await existing(input.boqItemId, inputFingerprint, configFingerprint);
    if (prior) {
      summary.processed += 1; summary.reused += 1;
      if (prior.status === "COMPLETED") summary.successful += 1;
      else if (prior.status === "NEEDS_REVIEW") summary.review += 1;
      else if (prior.status === "AI_UNAVAILABLE") summary.unavailable += 1;
      else summary.failed += 1;
      items.push({ ...prior, reused: true });
      continue;
    }
    const result = await interpretBoqItem(input, { provider });
    const record = { boqItemId: input.boqItemId, inputFingerprint, configFingerprint, metadata, ...result };
    await save(record);
    summary.processed += 1;
    if (result.status === "COMPLETED") summary.successful += 1;
    else if (result.status === "NEEDS_REVIEW") summary.review += 1;
    else if (result.status === "AI_UNAVAILABLE") summary.unavailable += 1;
    else summary.failed += 1;
    items.push(record);
  }
  return { summary, items };
}

export const activeRows = async (db, projectId, itemId = null) => {
  // Sprint 1.9 -- interpretationFingerprints is a correlated group_concat on
  // the same single read (not a second query) so buildBoqUnderstandingPilotManifest
  // can exclude already-attempted rows from competing for this round's
  // capped exploratory/primary slots -- see its own comment for why that's
  // needed -- without breaking the "one authoritative read" contract this
  // query is relied on for. It carries every interpretation this row has
  // ever gotten (not just whether one exists) so alreadyInterpretedItemIds
  // below can tell a genuinely current interpretation apart from a stale one
  // left over from before governed taxonomy/prompt logic changed -- a row
  // whose only interpretation no longer matches its own current input
  // fingerprint must still be treated as needing a fresh attempt, not as
  // already covered.
  //
  // Fire Alarm E2E fix (evidence/config-aware pilot fairness) -- real
  // Central Kitchen - Makkah gap: this used to carry every historical
  // input_fingerprint the row ever got, so an item whose evidence/
  // requirement-link state changed and then REVERTED (e.g. a system-wide
  // requirement link confirmed, then correctly superseded once found to be
  // mis-scoped) could land back on a fingerprint matching an OLD attempt --
  // one no longer the item's LATEST attempt -- and still count as "already
  // covered" against that old match alone, even though the item's real
  // approval lifecycle (estimator_understanding_review_current_evidence_guard's
  // "only the latest interpretation version may be approved" rule) had moved
  // on and needed a fresh one. This now carries ONLY the item's single
  // latest (highest version_number) attempt, as its own
  // input_fingerprint:config_fingerprint pair (colon-joined; both sides are
  // hex digests, so a literal colon cannot appear in either half) -- "already
  // covered" is judged against exactly the same attempt the approval
  // lifecycle itself treats as authoritative, never an arbitrary older one.
  const result = await db.prepare(`SELECT b.id boqItemId,b.item_number itemNumber,b.sequence,b.row_type rowType,b.description,b.numeric_quantity numericQuantity,b.original_quantity originalQuantity,b.normalized_unit normalizedUnit,b.original_unit originalUnit,b.system_value system,b.category,b.subcategory,b.manufacturer,b.model,b.part_number partNumber,b.source_document_id sourceDocumentId,b.evidence_document_version_id evidenceDocumentVersionId,b.evidence_extraction_version evidenceExtractionVersion,b.current_values currentValues,b.source_location sourceLocation,
    (SELECT i.input_fingerprint || ':' || i.config_fingerprint FROM estimator_item_interpretations i WHERE i.boq_item_id=b.id ORDER BY i.version_number DESC LIMIT 1) interpretationFingerprints
    FROM ${currentBoqEvidenceFrom("b")}
    WHERE b.project_id=? AND ${currentBoqItemPredicate("b")} ${itemId ? "AND b.id=?" : ""} ORDER BY b.sequence,b.id`).bind(...(itemId ? [projectId, itemId] : [projectId])).all();
  return (result.results || []).map((row) => ({ ...row, currentValues: parse(row.currentValues, {}), sourceLocation: parse(row.sourceLocation, null), interpretationFingerprints: String(row.interpretationFingerprints || "").split(",").filter(Boolean) }));
};

// Sprint 1.9 -- "already interpreted" for rotation purposes must mean
// genuinely current, not just present. Sprint 1.11 -- that current fingerprint
// must include confirmedSpecification, exactly as runUnderstandingBatch/
// executeRun's own fingerprint does when it originally stores an
// interpretation (see effective-understanding-interpretation.mjs's Sprint 1.0
// comment for the same reasoning applied to the review layer). Without this,
// confirming a NEW specification link to an item (which changes its real,
// governed current fingerprint and correctly puts its approval into
// REVALIDATION_REQUIRED -- see estimator-understanding-review-api.mjs)
// left the pilot manifest still treating that item as "already interpreted"
// at its stale, pre-link fingerprint, so it could never be re-selected for a
// fresh attempt through the real pipeline -- the exact real gap hit tracing
// item 34 after linking requirement_364 to it this sprint.
//
// Fire Alarm E2E fix (evidence/config-aware pilot fairness) -- currentConfigFingerprint
// is the SAME provider/config fingerprint executeRun computes and persists
// alongside every real interpretation attempt (see interpretationConfigFingerprint).
// A row only counts as "already interpreted" (excluded from this round's
// fresh candidate pool) when its single LATEST attempt matches on BOTH
// halves -- identical input AND identical effective config state. Passing
// null (the default, used only by callers that genuinely have no config
// context, e.g. some direct tests) falls back to fingerprint-only matching
// against that latest attempt, unchanged from before this fix. Judging
// freshness against the LATEST attempt specifically (never "any attempt in
// this row's history") is what actually resolves a reverted-evidence state:
// an item whose current input fingerprint reverts to match an OLDER,
// no-longer-latest attempt is correctly recognized as materially changed
// and made eligible again, exactly tracking the same "only the latest
// version may be approved" rule the governed review lifecycle itself
// enforces -- so a fresh attempt made here can always actually be approved
// afterward. This never creates an infinite retry loop on its own: a
// genuinely unchanged (input, config) pair against the item's own latest
// attempt still counts as covered exactly as before, and the manifest's own
// primary/exploratory caps are completely unchanged.
const alreadyInterpretedItemIds = (rows, confirmedSpecificationByItem, currentConfigFingerprint = null) => new Set(rows.filter((row) => {
  const currentFingerprint = interpretationInputFingerprint(prepareBoqUnderstandingInput(row, confirmedSpecificationByItem[row.boqItemId] || []));
  return row.interpretationFingerprints.some((latestAttempt) => {
    const separator = latestAttempt.indexOf(":");
    const inputFingerprint = separator === -1 ? latestAttempt : latestAttempt.slice(0, separator);
    const configFingerprint = separator === -1 ? null : latestAttempt.slice(separator + 1);
    return inputFingerprint === currentFingerprint && (currentConfigFingerprint == null || configFingerprint == null || configFingerprint === currentConfigFingerprint);
  });
}).map((row) => row.boqItemId));

export const loadPilotManifest = async (db, projectId, options, currentConfigFingerprint = null) => {
  const [rows, specs] = await Promise.all([activeRows(db, projectId), confirmedSpecifications(db, projectId)]);
  return buildBoqUnderstandingPilotManifest(projectId, rows, { alreadyInterpretedItemIds: alreadyInterpretedItemIds(rows, specs, currentConfigFingerprint), ...options });
};

// Sprint 1.0 -- exported so worker/estimator-understanding-review-api.mjs's
// review reconciliation (loadUnderstandingReviewRows) can pass the SAME real,
// confirmed, approved-for-downstream requirement evidence into
// resolveEffectiveUnderstandingInterpretation's currentInputFor as this
// module's own runUnderstandingBatch already uses when it originally stores
// an interpretation's input_fingerprint. Without this, the two computations
// diverged: an interpretation whose classification depended on confirmed
// specification evidence could never be recognized as "current" by review,
// permanently reporting UNAVAILABLE_OR_STALE regardless of approval status.
export const confirmedSpecifications = async (db, projectId) => {
  // Sprint 1.13 -- l.superseded_at IS NULL was missing here: a link's own
  // status column stays 'Confirmed' forever on its original row even after
  // /supersede marks it superseded (that row is never rewritten -- see
  // engineering-knowledge-api.mjs's Sprint 1.13 comment), so without this
  // filter a corrected/superseded confirmation kept feeding Understanding's
  // confirmedSpecification input as if it were still current. Every other
  // consumer of Confirmed links (loadInputs in technical-requirement-api.mjs,
  // the engineering-knowledge links list, knowledge-profile) already filters
  // on this; this was the one gap where a superseded link could still reach
  // downstream evidence.
  const result = await db.prepare(`SELECT l.boq_item_id boqItemId,r.id,r.normalized_requirement normalizedRequirement,r.source_location sourceLocation
    FROM boq_requirement_links l JOIN technical_requirements r ON r.id=l.requirement_id
    WHERE l.project_id=? AND l.status='Confirmed' AND l.superseded_at IS NULL AND r.approved_for_downstream=1 AND r.review_status='Approved'`).bind(projectId).all();
  return (result.results || []).reduce((map, row) => { (map[row.boqItemId] ||= []).push({ id: row.id, normalizedRequirement: row.normalizedRequirement, sourceLocation: parse(row.sourceLocation, null) }); return map; }, {});
};

const listLatest = async (db, projectId) => {
  const result = await db.prepare(`SELECT i.* FROM estimator_item_interpretations i WHERE i.project_id=? AND i.version_number=(SELECT MAX(i2.version_number) FROM estimator_item_interpretations i2 WHERE i2.boq_item_id=i.boq_item_id) ORDER BY i.created_at,i.id`).bind(projectId).all();
  return (result.results || []).map((row) => ({ id: row.id, runId: row.run_id, boqItemId: row.boq_item_id, version: row.version_number, status: row.status, interpretation: parse(row.validated_interpretation), error: row.error_code ? { code: row.error_code, message: row.error_message } : null, inputFingerprint: row.input_fingerprint, provider: row.provider, model: row.model, modelVersion: row.model_version, promptVersion: row.prompt_version, schemaVersion: row.schema_version, createdAt: row.created_at }));
};

const loadHistoricalRetryRows = async (db, projectId, runId) => {
  const result = await db.prepare(`SELECT i.boq_item_id boqItemId,b.item_number itemReference,i.status,i.input_fingerprint inputFingerprint,i.validated_interpretation interpretation
    FROM estimator_item_interpretations i JOIN boq_items b ON b.id=i.boq_item_id
    WHERE i.run_id=? AND i.project_id=? ORDER BY b.sequence,b.id`).bind(runId, projectId).all();
  return result.results || [];
};

const loadControlledRetryManifest = async (db, projectId, historicalRunId) => {
  const qualityReport = await loadPilotQualityReport(db, projectId, historicalRunId);
  if (!qualityReport) return null;
  return buildControlledRetryManifest(historicalRunId, qualityReport, await loadHistoricalRetryRows(db, projectId, historicalRunId), await activeRows(db, projectId));
};

const comparisonReport = (historicalReport, retryReport) => ({
  historicalPersistedSummary: historicalReport.persistedSummary,
  historicalEffectiveQualitySummary: historicalReport.effectiveQualitySummary,
  retryPersistedSummary: retryReport.persistedSummary,
  retryEffectiveQualitySummary: retryReport.effectiveQualitySummary,
  items: retryReport.items.map((after) => {
    const before = historicalReport.items.find((item) => item.itemReference === after.itemReference);
    return {
      itemReference: after.itemReference,
      description: after.description,
      historicalPersistedStatus: before?.persistedStatus || null,
      historicalEffectiveQualityStatus: before?.finalStatus || null,
      retryStatus: after.persistedStatus,
      reviewReasonsBefore: before?.reviewReasons || [],
      reviewReasonsAfter: after.reviewReasons,
      blockingMissingFieldsBefore: before?.blockingMissingFields || [],
      blockingMissingFieldsAfter: after.blockingMissingFields,
      informationalMissingFieldsBefore: before?.informationalMissingFields || [],
      informationalMissingFieldsAfter: after.informationalMissingFields,
      governedClassificationBefore: before?.canonicalClassification || null,
      governedClassificationAfter: after.canonicalClassification,
      acceptedAttributes: after.acceptedAttributes,
      removedOrNormalizedAttributes: after.removedOrNormalizedAttributes,
      model: after.model,
      durationMs: after.durationMs,
      promptTokens: after.promptTokens,
      completionTokens: after.completionTokens,
      totalTokens: after.totalTokens,
      sanitizedFailureCategory: after.sanitizedFailureCategory,
    };
  }),
});

export async function executeRun(env, context, projectId, rows, options = {}) {
  const provider = createConfiguredBoqUnderstandingProvider(env);
  const initialReadiness = boqUnderstandingProviderReadiness(env);
  const metadata = provider?.metadata || { provider: "unavailable", model: "unavailable", modelVersion: "unavailable" };
  const baseConfigFingerprint = interpretationConfigFingerprint(metadata);
  const configFingerprint = options.authorizationFingerprint ? fingerprint({ baseConfigFingerprint, authorizationFingerprint: options.authorizationFingerprint }) : baseConfigFingerprint;
  const runId = id("understandingrun");
  await env.DB.prepare(`INSERT INTO estimator_understanding_runs(id,project_id,organization_id,provider,model,model_version,prompt_version,schema_version,config_fingerprint,status,total_items,requested_by,run_mode,parent_run_id,authorization_fingerprint) VALUES(?,?,?,?,?,?,?,?,?,'PROCESSING',?,?,?,?,?)`).bind(runId, projectId, context.organizationId, metadata.provider, metadata.model, metadata.modelVersion, BOQ_UNDERSTANDING_PROMPT_VERSION, BOQ_UNDERSTANDING_SCHEMA_VERSION, configFingerprint, rows.length, context.userId, options.mode || "CONTROLLED_PILOT", options.parentRunId || null, options.authorizationFingerprint || null).run();
  const specs = await confirmedSpecifications(env.DB, projectId);
  const outcome = await runUnderstandingBatch(rows, {
    provider,
    configFingerprint,
    confirmedSpecifications: specs,
    // NOTE (Fire Alarm E2E fix, evidence/config-aware pilot fairness) -- this
    // reuse check deliberately still matches ANY historical attempt sharing
    // this exact (input_fingerprint, config_fingerprint) pair, not just the
    // item's own latest -- estimator_item_interpretations has a real,
    // load-bearing UNIQUE(boq_item_id, input_fingerprint, config_fingerprint)
    // constraint, so a fresh save() for a pair that already exists on an
    // older, non-latest row would fail outright, not merely "waste" an
    // attempt. Restricting eligibility for the pilot MANIFEST to the item's
    // own latest attempt (see alreadyInterpretedItemIds below) is what
    // resolves the reverted-evidence gap safely: it lets the item compete
    // for a slot again, and this reuse check still protects the one thing it
    // has always protected -- never re-attempting AI work for content
    // already on file, under any version. See that function's comment for
    // why the deeper "which version may be approved" question is a
    // different, review-lifecycle-owned concern this does not change.
    existing: async (boqItemId, inputFingerprint, fingerprint) => {
      const row = await env.DB.prepare(`SELECT status,validated_interpretation interpretation,error_code errorCode,error_message errorMessage FROM estimator_item_interpretations WHERE boq_item_id=? AND input_fingerprint=? AND config_fingerprint=?`).bind(boqItemId, inputFingerprint, fingerprint).first();
      return row ? { boqItemId, status: row.status, interpretation: parse(row.interpretation), error: row.errorCode ? { code: row.errorCode, message: row.errorMessage } : null } : null;
    },
    save: async (record) => {
      const prior = await env.DB.prepare(`SELECT COALESCE(MAX(version_number),0) version FROM estimator_item_interpretations WHERE boq_item_id=?`).bind(record.boqItemId).first();
      await env.DB.prepare(`INSERT INTO estimator_item_interpretations(id,run_id,project_id,boq_item_id,version_number,input_fingerprint,config_fingerprint,provider,model,model_version,prompt_version,schema_version,status,raw_response,validated_interpretation,error_code,error_message,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id("understanding"), runId, projectId, record.boqItemId, Number(prior?.version || 0) + 1, record.inputFingerprint, record.configFingerprint, metadata.provider, metadata.model, metadata.modelVersion, BOQ_UNDERSTANDING_PROMPT_VERSION, BOQ_UNDERSTANDING_SCHEMA_VERSION, record.status, record.usageMetadata ? JSON.stringify({ usage: record.usageMetadata }) : null, record.interpretation ? JSON.stringify(record.interpretation) : null, record.error?.code || null, record.error?.message || null, context.userId).run();
    },
  });
  const runStatus = !provider ? "AI_UNAVAILABLE" : outcome.summary.failed === rows.length ? "FAILED" : "COMPLETED";
  await env.DB.prepare(`UPDATE estimator_understanding_runs SET status=?,processed_items=?,successful_items=?,review_items=?,failed_items=?,completed_at=CURRENT_TIMESTAMP WHERE id=?`).bind(runStatus, outcome.summary.processed, outcome.summary.successful, outcome.summary.review, outcome.summary.failed + outcome.summary.unavailable, runId).run();
  const providerFailed = outcome.items.some((item) => item.error?.code === "AI_PROVIDER_ERROR");
  return { runId, status: runStatus, providerReadiness: providerFailed ? { ...initialReadiness, state: "Provider error", detail: "Workers AI could not complete the request." } : initialReadiness, ...outcome, qualityReport: await loadPilotQualityReport(env.DB, projectId, runId) };
}

export const handleEstimatorUnderstandingApi = async (request, env) => {
  const pathname = new URL(request.url).pathname;
  const qualityMatch = pathname.match(/^\/api\/projects\/([^/]+)\/estimator-understanding\/runs\/([^/]+)\/quality-report$/);
  const retryManifestMatch = pathname.match(/^\/api\/projects\/([^/]+)\/estimator-understanding\/runs\/([^/]+)\/retry-manifest$/);
  const controlledRetryMatch = pathname.match(/^\/api\/projects\/([^/]+)\/estimator-understanding\/runs\/([^/]+)\/retry$/);
  const comparisonMatch = pathname.match(/^\/api\/projects\/([^/]+)\/estimator-understanding\/runs\/([^/]+)\/comparison-report$/);
  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)\/estimator-understanding(?:\/(run|pilot-manifest))?$/);
  const retryMatch = pathname.match(/^\/api\/boq-items\/([^/]+)\/estimator-understanding\/retry$/);
  if (!qualityMatch && !retryManifestMatch && !controlledRetryMatch && !comparisonMatch && !projectMatch && !retryMatch) return null;
  if (!env.DB) return json({ error: { code: "ESTIMATOR_UNDERSTANDING_UNAVAILABLE", message: "BOQ understanding storage is unavailable." } }, 503);
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
  if (retryManifestMatch || controlledRetryMatch || comparisonMatch) {
    const matched = retryManifestMatch || controlledRetryMatch || comparisonMatch;
    const projectId = decodeURIComponent(matched[1]);
    const runId = decodeURIComponent(matched[2]);
    if (!(await projectAccess(env.DB, projectId, resolved.context))) return json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } }, 404);
    if (retryManifestMatch) {
      if (request.method !== "GET") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET." } }, 405);
      const manifest = await loadControlledRetryManifest(env.DB, projectId, runId);
      if (!manifest) return json({ error: { code: "UNDERSTANDING_RUN_NOT_FOUND", message: "Understanding run not found." } }, 404);
      if (manifest.error) return json({ error: { code: manifest.error, message: "The controlled retry recommendation is no longer current." } }, manifest.status);
      return json({ mode: manifest.mode, historicalRunId: manifest.historicalRunId, retryFingerprint: manifest.retryFingerprint, itemIds: manifest.itemIds, itemCount: manifest.itemCount, items: manifest.items, safeguards: { historicalRunPreserved: true, understandingOnly: true, matchingStarted: false, pricingStarted: false } });
    }
    if (comparisonMatch) {
      if (request.method !== "GET") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET." } }, 405);
      const retryRun = await env.DB.prepare(`SELECT parent_run_id parentRunId FROM estimator_understanding_runs WHERE id=? AND project_id=? AND run_mode='CONTROLLED_RETRY'`).bind(runId, projectId).first();
      if (!retryRun?.parentRunId) return json({ error: { code: "CONTROLLED_RETRY_NOT_FOUND", message: "Controlled retry run not found." } }, 404);
      const historicalReport = await loadPilotQualityReport(env.DB, projectId, retryRun.parentRunId);
      const retryReport = await loadPilotQualityReport(env.DB, projectId, runId);
      return json(comparisonReport(historicalReport, retryReport));
    }
    if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } }, 405);
    let body;
    try { body = await request.json(); } catch { return json({ error: { code: "CONTROLLED_RETRY_REQUEST_INVALID", message: "Use the exact current controlled retry manifest." } }, 400); }
    const manifest = await loadControlledRetryManifest(env.DB, projectId, runId);
    if (!manifest) return json({ error: { code: "UNDERSTANDING_RUN_NOT_FOUND", message: "Understanding run not found." } }, 404);
    if (manifest.error) return json({ error: { code: manifest.error, message: "The controlled retry recommendation is no longer current." } }, manifest.status);
    const authorized = authorizeControlledRetryRequest(body, manifest);
    if (authorized.error) return json({ error: { code: authorized.error, message: "The controlled retry request does not match the current server recommendation." } }, authorized.status);
    const existing = await env.DB.prepare(`SELECT id,status FROM estimator_understanding_runs WHERE parent_run_id=? AND authorization_fingerprint=? AND run_mode='CONTROLLED_RETRY'`).bind(runId, manifest.retryFingerprint).first();
    if (existing) {
      const historicalReport = await loadPilotQualityReport(env.DB, projectId, runId);
      const retryReport = await loadPilotQualityReport(env.DB, projectId, existing.id);
      return json({ retryRunId: existing.id, status: existing.status, idempotent: true, comparisonReport: retryReport ? comparisonReport(historicalReport, retryReport) : null });
    }
    let result;
    try {
      result = await executeRun(env, resolved.context, projectId, authorized.value.rows, { mode: "CONTROLLED_RETRY", parentRunId: runId, authorizationFingerprint: manifest.retryFingerprint });
    } catch (error) {
      const raced = await env.DB.prepare(`SELECT id,status FROM estimator_understanding_runs WHERE parent_run_id=? AND authorization_fingerprint=? AND run_mode='CONTROLLED_RETRY'`).bind(runId, manifest.retryFingerprint).first();
      if (!raced) throw error;
      const historicalReport = await loadPilotQualityReport(env.DB, projectId, runId);
      const retryReport = await loadPilotQualityReport(env.DB, projectId, raced.id);
      return json({ retryRunId: raced.id, status: raced.status, idempotent: true, comparisonReport: retryReport ? comparisonReport(historicalReport, retryReport) : null });
    }
    return json({ retryRunId: result.runId, status: result.status, idempotent: false, summary: result.summary, comparisonReport: comparisonReport(await loadPilotQualityReport(env.DB, projectId, runId), result.qualityReport) });
  }
  if (qualityMatch) {
    if (request.method !== "GET") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET." } }, 405);
    const projectId = decodeURIComponent(qualityMatch[1]);
    const runId = decodeURIComponent(qualityMatch[2]);
    if (!(await projectAccess(env.DB, projectId, resolved.context))) return json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } }, 404);
    const report = await loadPilotQualityReport(env.DB, projectId, runId);
    return report ? json(report) : json({ error: { code: "UNDERSTANDING_RUN_NOT_FOUND", message: "Understanding run not found." } }, 404);
  }
  if (projectMatch) {
    const projectId = decodeURIComponent(projectMatch[1]);
    const operation = projectMatch[2] || null;
    if (!(await projectAccess(env.DB, projectId, resolved.context))) return json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } }, 404);
    // Fire Alarm E2E fix (evidence/config-aware pilot fairness) -- the SAME
    // config fingerprint executeRun computes and persists on every real
    // interpretation attempt, so manifest eligibility is judged on exactly
    // the pair uniqueness the pipeline itself already keys on.
    const currentConfigFingerprint = interpretationConfigFingerprint((createConfiguredBoqUnderstandingProvider(env)?.metadata) || { provider: "unavailable", model: "unavailable", modelVersion: "unavailable" });
    if (request.method === "GET" && operation === "pilot-manifest") return json(await loadPilotManifest(env.DB, projectId, undefined, currentConfigFingerprint));
    if (request.method === "GET" && operation === null) {
      const latestRun = await env.DB.prepare(`SELECT id FROM estimator_understanding_runs WHERE project_id=? ORDER BY started_at DESC,id DESC LIMIT 1`).bind(projectId).first();
      return json({ projectId, providerReadiness: boqUnderstandingProviderReadiness(env), items: await listLatest(env.DB, projectId), latestQualityRunId: latestRun?.id || null, latestQualityReport: latestRun ? await loadPilotQualityReport(env.DB, projectId, latestRun.id) : null });
    }
    if (request.method !== "POST" || operation !== "run") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET, GET /pilot-manifest, or POST /run." } }, 405);
    let body;
    try { body = await request.json(); } catch { return json({ error: { code: "CONTROLLED_ITEM_SELECTION_REQUIRED", message: "Select 1 to 15 authorized pilot items from a current manifest." } }, 400); }
    const controlled = validateControlledPilotRequest(body);
    if (controlled.error) return json({ error: { code: controlled.error, message: "Select 1 to 15 authorized pilot items from a current manifest." } }, 400);
    const [allRows, allSpecs] = await Promise.all([activeRows(env.DB, projectId), confirmedSpecifications(env.DB, projectId)]);
    const manifest = buildBoqUnderstandingPilotManifest(projectId, allRows, { alreadyInterpretedItemIds: alreadyInterpretedItemIds(allRows, allSpecs, currentConfigFingerprint) });
    const authorized = authorizeControlledPilotSelection(controlled.value, manifest, allRows);
    if (authorized.error) return json({ error: { code: authorized.error, message: authorized.error === "PILOT_ITEM_NOT_AUTHORIZED" ? "One or more items are outside the current controlled pilot manifest." : "The pilot manifest is stale. Prepare the pilot again." } }, authorized.status);
    return json(await executeRun(env, resolved.context, projectId, authorized.value.rows), 200);
  }
  if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST to retry an item." } }, 405);
  const itemId = decodeURIComponent(retryMatch[1]);
  const item = await env.DB.prepare(`SELECT b.project_id projectId FROM ${currentBoqEvidenceFrom("b")} WHERE b.id=? AND ${currentBoqItemPredicate("b")}`).bind(itemId).first();
  if (!item || !(await projectAccess(env.DB, item.projectId, resolved.context))) return json({ error: { code: "BOQ_ITEM_NOT_FOUND", message: "BOQ item not found." } }, 404);
  return handlePerItemRetry(env, resolved.context, item.projectId, itemId, request);
};

// Sprint 1.18 -- real gap: an item whose AI interpretation failed with a
// transient MODEL-OUTPUT problem (invalid schema, an unsupported field, a
// malformed confidence value, or a provider error) had no way back into the
// pipeline except the CONTROLLED_RETRY batch mechanism, which requires the
// project's OWN quality report to recommend exactly 6 items project-wide --
// an unrelated, narrow pilot-comparison control, not a general per-item
// retry path. This reuses the EXACT SAME executeRun/existing()/config-
// fingerprint-mixing machinery CONTROLLED_RETRY already relies on (no new
// interpretation logic, no second cache, no weaker schema validation) --
// only the ELIGIBILITY GATE, idempotency, and attempt cap around it are new.
//
// Eligible only when the item's OWN latest interpretation attempt is
// currently FAILED with one of these codes -- never for a COMPLETED/
// NEEDS_REVIEW (approved-or-awaiting-review) interpretation, which keeps
// going through the existing controlled-pilot/controlled-retry governance
// exactly as before.
export const TRANSIENT_MODEL_FAILURE_CODES = new Set(["AI_OUTPUT_INVALID_SCHEMA", "AI_OUTPUT_INVALID_UNSUPPORTED_FIELD", "AI_OUTPUT_INVALID_CONFIDENCE", "AI_PROVIDER_ERROR"]);
// A deliberate, small bound -- not "no retry" and not "unbounded" -- so a
// genuinely still-failing item cannot be retried indefinitely through this
// path; beyond this it requires a full CONTROLLED_RETRY batch or a real
// evidence change (which shifts the input fingerprint and clears this path
// on its own).
export const MAX_PER_ITEM_RETRY_ATTEMPTS = 3;
export async function handlePerItemRetry(env, context, projectId, itemId, request) {
  const db = env.DB;
  let body; try { body = await request.json(); } catch { body = {}; }
  const reason = String(body?.reason || "").trim();
  if (reason.length < 10) return json({ error: { code: "PER_ITEM_RETRY_REASON_REQUIRED", message: "Provide a substantive reason for retrying this failed interpretation." } }, 422);
  const latest = await db.prepare(`SELECT * FROM estimator_item_interpretations WHERE boq_item_id=? ORDER BY version_number DESC LIMIT 1`).bind(itemId).first();
  if (!latest) return json({ error: { code: "PER_ITEM_RETRY_NOT_ELIGIBLE", message: "This item has no prior interpretation attempt to retry." } }, 409);
  if (latest.status !== "FAILED" || !TRANSIENT_MODEL_FAILURE_CODES.has(latest.error_code)) return json({ error: { code: "PER_ITEM_RETRY_NOT_ELIGIBLE", message: "Only an item whose latest attempt failed with a transient model-output error is eligible -- a normal approved or awaiting-review interpretation must go through the existing review path, never this one." } }, 409);
  const [rows, specs] = await Promise.all([activeRows(db, projectId, itemId), confirmedSpecifications(db, projectId)]);
  const row = rows[0];
  if (!row) return json({ error: { code: "BOQ_ITEM_NOT_FOUND", message: "BOQ item not found." } }, 404);
  const currentInputFingerprint = interpretationInputFingerprint(prepareBoqUnderstandingInput(row, specs[row.boqItemId] || []));
  if (currentInputFingerprint !== latest.input_fingerprint) return json({ error: { code: "PER_ITEM_RETRY_EVIDENCE_CHANGED", message: "The item's evidence has changed since the failed attempt; it is eligible for the normal understanding pilot instead of a same-input retry." } }, 409);
  // Sprint 1.19 -- the cap is scoped to the CURRENT engine's own prompt_version
  // (an existing, already-persisted column on every interpretation), not to
  // input_fingerprint alone. A genuine engine/validation fix (see
  // boq-understanding-engine.mjs's BOQ_UNDERSTANDING_PROMPT_VERSION Sprint
  // 1.19 comment) is a materially different situation from "retry the same
  // broken thing again" -- prior failures recorded under an OLDER prompt
  // version are real history (never deleted, still fully queryable) but must
  // not count against the NEW version's own fresh, still-bounded budget.
  const attemptCount = (await db.prepare(`SELECT COUNT(*) count FROM estimator_item_interpretations WHERE boq_item_id=? AND input_fingerprint=? AND status='FAILED' AND prompt_version=?`).bind(itemId, currentInputFingerprint, BOQ_UNDERSTANDING_PROMPT_VERSION).first())?.count || 0;
  if (attemptCount >= MAX_PER_ITEM_RETRY_ATTEMPTS) return json({ error: { code: "PER_ITEM_RETRY_LIMIT_REACHED", message: `This item has already failed ${attemptCount} times at its current evidence under the current engine version; a per-item retry can no longer help. Use the controlled batch retry or provide new evidence.` } }, 409);
  const authorizationFingerprint = fingerprint({ mode: "PER_ITEM_RETRY", boqItemId: itemId, failedInterpretationId: latest.id, reason });
  const existingRetryRun = await db.prepare(`SELECT id, status FROM estimator_understanding_runs WHERE run_mode='PER_ITEM_RETRY' AND parent_run_id=? AND authorization_fingerprint=?`).bind(latest.run_id, authorizationFingerprint).first();
  if (existingRetryRun) return json({ retryRunId: existingRetryRun.id, status: existingRetryRun.status, idempotent: true });
  const result = await executeRun(env, context, projectId, [row], { mode: "PER_ITEM_RETRY", parentRunId: latest.run_id, authorizationFingerprint });
  return json({ retryRunId: result.runId, status: result.status, idempotent: false, previousFailure: { interpretationId: latest.id, errorCode: latest.error_code, version: latest.version_number }, summary: result.summary });
}
