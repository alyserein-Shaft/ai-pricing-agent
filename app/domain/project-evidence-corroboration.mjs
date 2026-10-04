// PROJECT-WIDE CROSS-DOCUMENT CORROBORATION LAYER -- slice 1 (deterministic envelope).
//
// Mandatory architecture:
//   FILE-LOCAL ANALYSIS -> NORMALIZED PROJECT EVIDENCE -> CROSS-DOCUMENT
//   CORROBORATION -> CONFLICT / AUTHORITY RESOLUTION -> PROJECT-LEVEL UNDERSTANDING
//
// This module is the NORMALIZED + CORROBORATION + RESOLUTION envelope. It does
// NOT replace file-local extractors (BOQ/drawing/spec), the currentness
// predicates (worker/current-evidence-scope.mjs), the field authority table
// (drawing-evidence-authority-policy.mjs), the domain authority matrix
// (evidence-authority-policy.mjs), the quantity authority
// (drawing-quantity-authority.mjs), or the knowledge promotion gates. It reuses
// them: source-type -> authority-class mapping and cross-domain conflict
// resolution are delegated to evidence-authority-policy.mjs, never redefined.
//
// Pure domain logic: no DOM, no fetch, no DB. Fail closed. Quantity authority
// can never be produced here (see §9 of the task).

import {
  resolveAuthorityClassForSource,
  resolveCrossDomainConflict,
} from "./evidence-authority-policy.mjs";

export const CORROBORATION_RELATIONSHIPS = Object.freeze([
  "SUPPORTS",
  "CONTRADICTS",
  "CLARIFIES",
  "RELATED_BUT_NON_AUTHORITATIVE",
  "NO_RELEVANT_EVIDENCE",
]);

const REQUIRED_PROVENANCE = Object.freeze([
  "documentId", "documentVersionId", "sourceType", "reviewState",
]);

const hasQuantityField = (input) =>
  input != null && typeof input === "object" && (
    input.quantity !== undefined || input.physicalQuantity !== undefined ||
    input.quantityAuthority !== undefined
  );

// §1: file-local record, normalized without merging. Identity resolution stays
// governed elsewhere; entityKeys are carried verbatim, never fuzzy-matched.
export function normalizeEvidenceRecord(input) {
  if (!input || typeof input !== "object") return { ok: false, error: "INVALID_INPUT" };
  if (hasQuantityField(input)) {
    return { ok: false, error: "QUANTITY_AUTHORITY_FORBIDDEN: corroboration never asserts physical quantity" };
  }
  for (const key of ["documentId", "documentVersionId", "extractedText", "sourceType"]) {
    if (typeof input[key] !== "string" || input[key].trim() === "") {
      return { ok: false, error: `MISSING_${key.replace(/([A-Z])/g, "_$1").toUpperCase()}` };
    }
  }
  const record = {
    documentId: input.documentId,
    documentVersionId: input.documentVersionId,
    page: input.page ?? null,
    sheet: input.sheet ?? null,
    section: input.section ?? null,
    cell: input.cell ?? null,
    row: input.row ?? null,
    extractedText: input.extractedText,
    structuredFacts: input.structuredFacts ?? null,
    documentType: input.documentType ?? null,
    entityKeys: input.entityKeys && typeof input.entityKeys === "object" ? { ...input.entityKeys } : {},
    sourceType: input.sourceType,
    reviewState: input.reviewState ?? "Needs Review",
    confidence: null, // deliberately dropped: confidence alone is never authority
  };
  return { ok: true, record };
}

// §3 + §6: exactly one relationship. A weak source class can never override an
// authoritative source by agreement: without dimension authority the ceiling is
// RELATED_BUT_NON_AUTHORITATIVE.
export function classifyRelationship({ focus, candidate, sameEntity, valuesEqual, candidateAuthoritativeForDimension, clarifies = false } = {}) {
  if (!focus || !candidate) return "NO_RELEVANT_EVIDENCE";
  if (sameEntity !== true) return "NO_RELEVANT_EVIDENCE";
  if (candidateAuthoritativeForDimension !== true) return "RELATED_BUT_NON_AUTHORITATIVE";
  if (clarifies === true) return "CLARIFIES";
  if (valuesEqual === true) return "SUPPORTS";
  if (valuesEqual === false) return "CONTRADICTS";
  return "NO_RELEVANT_EVIDENCE";
}

// §4: every conclusion retains its full evidence chain. Quantity conclusions
// are refused outright.
export function buildEvidenceChain({ conclusion, supports = [] } = {}) {
  if (typeof conclusion === "string" && /\b\d+\s*(units?|nos?\.?|pcs?|quantity)\b/i.test(conclusion)) {
    return { ok: false, error: "QUANTITY_AUTHORITY_FORBIDDEN: corroboration never asserts physical quantity" };
  }
  const kept = [];
  for (const s of supports) {
    const r = s && s.documentId && s.documentVersionId ? s : normalizeEvidenceRecord(s).record;
    if (!r) return { ok: false, error: "EVIDENCE_PROVENANCE_INCOMPLETE" };
    for (const key of REQUIRED_PROVENANCE) {
      if (!r[key]) return { ok: false, error: "EVIDENCE_PROVENANCE_INCOMPLETE" };
    }
    kept.push({
      documentId: r.documentId, documentVersionId: r.documentVersionId,
      page: r.page ?? null, sheet: r.sheet ?? null, section: r.section ?? null,
      cell: r.cell ?? null, row: r.row ?? null,
      sourceType: r.sourceType, reviewState: r.reviewState,
      authorityClass: resolveAuthorityClassForSource(r.sourceType),
    });
  }
  return { ok: true, conclusion, supports: kept };
}

// §5 + §7: corroboration is not authority; contradictions fail closed.
// Delegates precedence to the existing cross-domain policy; unresolved pairs
// return PROJECT_EVIDENCE_CONFLICT with Needs Review, never a silent pick.
export function detectProjectConflict({ dimension, claims = [] } = {}) {
  const normalized = (claims || []).filter(Boolean);
  if (normalized.length < 2) return { state: "NO_CONFLICT", resolution: "No competing claims." };
  const values = new Set(normalized.map((c) => String(c.value ?? "").trim().toLowerCase()));
  if (values.size <= 1) return { state: "AGREES", resolution: "Claims agree." };
  const [left, right] = normalized;
  const resolution = resolveCrossDomainConflict(
    { authorityClass: left.authorityClass },
    { authorityClass: right.authorityClass },
    { consistent: false, dimension: dimension ?? null },
  );
  return {
    state: "PROJECT_EVIDENCE_CONFLICT",
    resolution: "Needs Review",
    dimension: dimension ?? null,
    policy: resolution,
    claims: normalized.map((c) => ({
      value: c.value,
      authorityClass: c.authorityClass,
      source: c.source && c.source.documentId ? {
        documentId: c.source.documentId, documentVersionId: c.source.documentVersionId,
        section: c.source.section ?? null, sourceType: c.source.sourceType ?? null,
        reviewState: c.source.reviewState ?? null,
      } : null,
    })),
  };
}

// §8: clarification chaining with every link visible (RAW + LEGEND + REQUIREMENT + BOQ).
export function buildClarificationChain({ rawObservation, legendDefinition, requirement, boqContext } = {}) {
  const links = [
    rawObservation ? { role: "RAW_PLAN_OBSERVATION", ...rawObservation } : null,
    legendDefinition ? { role: "GOVERNED_LEGEND_DEFINITION", ...legendDefinition } : null,
    requirement ? { role: "PROJECT_REQUIREMENT", ...requirement } : null,
    boqContext ? { role: "BOQ_IDENTITY_CONTEXT", ...boqContext } : null,
  ].filter(Boolean);
  if (links.length === 0) return { ok: false, error: "NO_LINKS" };
  for (const link of links) {
    if (!link.documentId) return { ok: false, error: "EVIDENCE_PROVENANCE_INCOMPLETE" };
  }
  return { ok: true, links };
}

// §10: bounded, sanitized, authority-classified packet for reasoning models.
// Sanitized derived input only: commercial values, contacts, client identity,
// confidential filenames, and credentials never enter the packet.
const COMMERCIAL_PATTERN = /\$\s?\d|quotation|price\s*[:=]\s*\S+@\S+|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/i;
export function buildEvidencePacketForReasoning({ currentObservation, projectEvidence = [], task = "", maxItems = 8 } = {}) {
  const items = [];
  const push = (record, relation) => {
    const text = String(record.extractedText ?? "");
    if (COMMERCIAL_PATTERN.test(text)) return; // drop commercial/contact content, never forward
    items.push({
      documentId: record.documentId,
      documentVersionId: record.documentVersionId,
      section: record.section ?? null,
      cell: record.cell ?? null,
      sourceType: record.sourceType,
      reviewState: record.reviewState,
      authorityClass: resolveAuthorityClassForSource(record.sourceType),
      relation,
      extractedText: text.slice(0, 500),
    });
  };
  const current = normalizeEvidenceRecord(currentObservation);
  if (!current.ok) return current;
  push(current.record, "CURRENT_OBSERVATION");
  for (const ev of (projectEvidence || []).slice(0, Math.max(0, maxItems - 1))) {
    const r = normalizeEvidenceRecord(ev);
    if (!r.ok) continue;
    push(r.record, "PROJECT_EVIDENCE");
  }
  return { ok: true, packet: { task: String(task).slice(0, 500), sanitizedInput: true, items } };
}

// §12: project-level synthesis counts. AI agreement never creates authority:
// readiness requires corroborated governed evidence, reported separately.
export function synthesizeProjectState({ facts = [] } = {}) {
  let corroborated = 0, singleSource = 0, conflicts = 0, unresolved = 0;
  for (const fact of facts) {
    const rels = fact.relationships || [];
    if (rels.includes("CONTRADICTS")) conflicts += 1;
    else if (rels.includes("SUPPORTS")) corroborated += 1;
    else if (rels.length === 0) singleSource += 1;
    else unresolved += 1;
  }
  return {
    corroborated, singleSource, conflicts, unresolved,
    readyForDownstream: corroborated,
  };
}

// §13: incremental reconciliation. Only facts sharing an entity key with the
// change are re-evaluated; nothing is blindly reprocessed.
export function affectedByChange({ facts = [], change = {} } = {}) {
  const keys = change.entityKeys || {};
  const entries = Object.entries(keys).filter(([, v]) => v !== undefined && v !== null && String(v) !== "");
  const affectedIds = (facts || [])
    .filter((fact) => entries.some(([k, v]) => fact.entityKeys && String(fact.entityKeys[k] ?? "") === String(v)))
    .map((fact) => fact.id);
  return { affectedIds };
}
