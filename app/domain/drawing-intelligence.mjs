// Reusable Drawing Intelligence orchestrator (Fire Alarm / MEP MVP).
//
// Thin deterministic layer over proven primitives; it invents no new authority:
//   native evidence  <- drawing_assets via drawing-intake-engine (reused)
//   occurrences      <- associateMultiplicity/exclusion patterns generalized
//                      from drawing-occurrence-evidence.mjs (reused, not copied)
//   corroboration    <- app/domain/project-evidence-corroboration.mjs (reused)
//   Muse fallback    <- worker/drawing-vision-queue-api.mjs shadow path (reused)
//   currentness      <- document_version_id + intake heads (reused convention)
//
// NEW here (genuinely missing): source router, region classification, governed
// legend dictionary + applicability, project symbol templates, cross-sheet
// graph edges, Muse-escalation policy, generic Agent-1 handoff.
//
// Pure domain logic: no DOM, no fetch, no DB. Quantity authority is never
// produced: no quantity field exists on any output shape.
import { classifyRelationship } from "./project-evidence-corroboration.mjs";

export const DRAWING_INTELLIGENCE_VERSION = "drawing-intelligence-1.0.0";

// ---------------------------------------------------------------------------
// 1. Source router: vector evidence before Vision, always.
// ---------------------------------------------------------------------------
export const SOURCE_ROUTES = Object.freeze(["VECTOR_NATIVE", "RASTER_SCAN", "MIXED", "UNKNOWN"]);
export function routeSource({ hasVectorGeometry = false, hasTextLayer = false, hasRasterImages = false } = {}) {
  if (hasVectorGeometry && hasTextLayer) return { route: "VECTOR_NATIVE", visionAllowed: false, reason: "Native geometry+text present; Vision not justified." };
  if (!hasVectorGeometry && !hasTextLayer && hasRasterImages) return { route: "RASTER_SCAN", visionAllowed: true, reason: "No native evidence; OCR/Vision may enter." };
  if (hasVectorGeometry || hasTextLayer) return { route: "MIXED", visionAllowed: "UNRESOLVED_ONLY", reason: "Native evidence first; Vision only for unresolved regions." };
  return { route: "UNKNOWN", visionAllowed: false, reason: "No source characterization; fail closed." };
}

// ---------------------------------------------------------------------------
// 2-3. Region classification: exclusion and context, never authority.
// ---------------------------------------------------------------------------
export const REGIONS = Object.freeze(["DEVICE_LAYOUT", "LEGEND", "TITLE_BLOCK", "NOTES", "SCHEDULE", "DETAIL", "UNKNOWN"]);
const inBox = (point, box) => point && box
  && point.x >= box.x && point.x <= box.x + box.width
  && point.y >= box.y && point.y <= box.y + box.height;
export function classifyRegion({ point, legendBoxes = [], titleBox = null, scheduleBoxes = [], notesBoxes = [], detailBoxes = [] } = {}) {
  if (!point) return "UNKNOWN";
  if (legendBoxes.some((b) => inBox(point, b))) return "LEGEND";
  if (titleBox && inBox(point, titleBox)) return "TITLE_BLOCK";
  if (scheduleBoxes.some((b) => inBox(point, b))) return "SCHEDULE";
  if (notesBoxes.some((b) => inBox(point, b))) return "NOTES";
  if (detailBoxes.some((b) => inBox(point, b))) return "DETAIL";
  // A point inside no known non-device region defaults to layout ONLY when a
  // layout region was positively established; otherwise UNKNOWN (fail closed).
  return "UNKNOWN";
}
export function classifyRegionWithLayout({ point, layoutBoxes = [], ...rest } = {}) {
  const base = classifyRegion({ point, ...rest });
  if (base !== "UNKNOWN") return base;
  if (layoutBoxes.some((b) => inBox(point, b))) return "DEVICE_LAYOUT";
  return "UNKNOWN";
}

// ---------------------------------------------------------------------------
// 4. Governed legend dictionary + applicability. Caller strings are never
// authority: only rows carrying document/version/review provenance confer.
// ---------------------------------------------------------------------------
export function buildLegendDictionary({ entries = [] } = {}) {
  const definitions = [];
  for (const e of entries) {
    if (!e || typeof e.token !== "string" || !e.token.trim()) continue;
    if (!e.meaning || !e.sourceDocumentId || !e.sourceDocumentVersionId) continue;
    definitions.push({
      token: e.token.trim(),
      meaning: e.meaning,
      sourceDocumentId: e.sourceDocumentId,
      sourceDocumentVersionId: e.sourceDocumentVersionId,
      sourceRegion: e.sourceRegion ?? null,
      reviewState: e.reviewState ?? "Needs Review",
      applicableScope: e.applicableScope ?? null, // explicit target scope or null
    });
  }
  return { version: DRAWING_INTELLIGENCE_VERSION, definitions };
}
export function resolveLegendApplicability({ token, targetDocumentId, targetDocumentVersionId, dictionary, crossSheetRefs = [], architectureRows = [] } = {}) {
  const defs = (dictionary?.definitions || []).filter((d) => d.token === token);
  // NOTE: no early return on empty defs. Path (c) below -- a governed
  // architecture row -- is self-sufficient authority and must not require a
  // dictionary entry to exist.
  // (a) Same-document definition on the exact version.
  const sameDoc = defs.filter((d) => d.sourceDocumentId === targetDocumentId && d.sourceDocumentVersionId === targetDocumentVersionId);
  if (sameDoc.length) {
    return { applicable: true, authority: "SAME_DOCUMENT_LEGEND", meaning: sameDoc[0].meaning, provenance: sameDoc.map((d) => ({ kind: "LEGEND_DEFINITION", sourceDocumentId: d.sourceDocumentId })) };
  }
  // (b) Explicit cross-sheet LEGEND_FOR reference naming the legend document.
  const xref = (crossSheetRefs || []).find((r) =>
    r.kind === "LEGEND_FOR" && r.targetDocumentId && defs.some((d) => d.sourceDocumentId === r.targetDocumentId));
  if (xref) {
    const def = defs.find((d) => d.sourceDocumentId === xref.targetDocumentId);
    return { applicable: true, authority: "EXPLICIT_CROSS_SHEET_LEGEND_REFERENCE", meaning: def.meaning, provenance: [{ kind: "LEGEND_FOR", noteText: xref.noteText ?? null, targetDocumentId: xref.targetDocumentId }] };
  }
  // (c) Governed architecture row binding the exact live document+version.
  const row = (architectureRows || []).find((r) =>
    r.subject === token && r.relation === "MATCHES_GOVERNED_LEGEND"
    && r.document_id === targetDocumentId && r.document_version_id === targetDocumentVersionId);
  if (row) {
    return { applicable: true, authority: "GOVERNED_LAYOUT_LEGEND_LINK", meaning: row.object, provenance: [{ kind: "LAYOUT_LEGEND_LINK", rowId: row.id }] };
  }
  return { applicable: false, authority: "NOT_PROVEN", provenance: [] };
}

// ---------------------------------------------------------------------------
// 5. Project symbol templates: what THIS symbol looks like IN THIS PROJECT.
// Project-scoped only; never a universal library; human corrections are valid
// template sources through the same shape.
// ---------------------------------------------------------------------------
export function buildSymbolTemplate({ token, glyph, modifiers = [], fill = null, dashed = null, proportions = null, legendSource = null, scope = null } = {}) {
  if (!token || !glyph) return { ok: false, error: "MISSING_TOKEN_OR_GLYPH" };
  return { ok: true, template: { token, glyph, modifiers, fill, dashed, proportions, legendSource, scope, version: DRAWING_INTELLIGENCE_VERSION } };
}
export function matchSymbolTemplate({ candidate, template, tolerances = {} } = {}) {
  const reasons = [];
  if (!candidate || !template || template.ok !== true) return { match: false, reasons: ["INVALID_INPUT"] };
  if (candidate.glyph !== template.template.glyph) return { match: false, reasons: ["GLYPH_MISMATCH"] };
  const tol = tolerances.proportion ?? 0.15;
  const p = template.template.proportions, q = candidate.proportions;
  if (p && q) {
    for (const k of ["wOverH"]) {
      if (Number.isFinite(p[k]) && Number.isFinite(q[k]) && Math.abs(p[k] - q[k]) > tol) {
        return { match: false, reasons: [`PROPORTION_MISMATCH:${k}`] };
      }
    }
  }
  if (template.template.fill !== null && candidate.fill !== undefined && candidate.fill !== template.template.fill) {
    return { match: false, reasons: ["FILL_MISMATCH"] };
  }
  if (template.template.dashed !== null && candidate.dashed !== undefined && candidate.dashed !== template.template.dashed) {
    return { match: false, reasons: ["DASH_MISMATCH"] };
  }
  // Modifiers must match as a SET: a missing or extra modifier is a different symbol.
  const want = [...(template.template.modifiers || [])].sort().join("|");
  const got = [...(candidate.modifiers || [])].sort().join("|");
  if (want !== got) return { match: false, reasons: ["MODIFIER_SET_MISMATCH"] };
  return { match: true, reasons };
}

// ---------------------------------------------------------------------------
// 6. Generic occurrence engine (token-parameterized; T was the first token).
// ---------------------------------------------------------------------------
const isToken = (text, token) => String(text ?? "").trim() === token;
export function extractTokenOccurrences({ assets, allTexts, token, location, legendResolution, regions = {} } = {}) {
  const { projectId, documentId, documentVersionId, sheet } = location || {};
  if (!projectId || !documentId || !documentVersionId || !token) return { ok: false, error: "MISSING_PROVENANCE_OR_TOKEN" };
  const raw = (assets || []).filter((a) => isToken(a.text_content ?? a.text, token));
  const excluded = [];
  const kept = [];
  const unresolved = [];
  for (const t of raw) {
    let c = null;
    try { c = centerOf(JSON.parse(t.bounding_box ?? t.boundingBox)); } catch { unresolved.push({ assetId: t.id ?? null, reason: "UNPARSEABLE_GEOMETRY" }); continue; }
    const region = classifyRegionWithLayout({ point: c, ...(regionsFor(t, regions)) });
    if (region === "LEGEND" || region === "TITLE_BLOCK") {
      excluded.push({ assetId: t.id, reason: region === "LEGEND" ? "LEGEND_EXAMPLE" : "TITLE_BLOCK" });
      continue;
    }
    kept.push({ asset: t, center: c, region });
  }
  const seen = new Set();
  const duplicatesRemoved = [];
  const unique = [];
  for (const k of kept) {
    const key = `${Math.round(k.center.x)},${Math.round(k.center.y)}`;
    if (seen.has(key)) { duplicatesRemoved.push(k.asset.id); continue; }
    seen.add(key);
    unique.push(k);
  }
  const applicable = legendResolution?.applicable === true;
  const accepted = unique.map((k) => ({
    project_id: projectId, document_id: documentId, document_version_id: documentVersionId,
    page: k.asset.page_id ?? k.asset.pageNumber ?? null, sheet,
    region_type: k.region === "UNKNOWN" ? "LAYOUT_DEVICE_REGION" : k.region,
    bbox: safeParse(k.asset.bounding_box ?? k.asset.boundingBox),
    observed_symbol: token,
    governed_identity: applicable ? legendResolution.meaning : null,
    identity_authority: applicable ? legendResolution.authority : "NOT_PROVEN",
    source_channel: "NATIVE_TEXT",
    source_object_ids: [k.asset.id].filter(Boolean),
    legend_applicability: applicable
      ? { applicable: true, authority: legendResolution.authority, provenance: legendResolution.provenance }
      : { applicable: false, authority: "NOT_PROVEN" },
    evidenceChannels: { nativeText: true, template: false, muse: false, projectContext: false },
    excluded: false, exclusion_reason: null, duplicate_group: null,
    unresolved: false,
    currentness_fingerprint: null,
    provenance: { extractor: "drawing-intelligence-1.0.0", assetId: k.asset.id ?? null },
    review_state: "Needs Review",
  }));
  const fingerprint = `di_${Math.abs(hash(JSON.stringify([projectId, documentId, documentVersionId, sheet, token, accepted.map((a) => a.source_object_ids)]))).toString(16)}`;
  for (const a of accepted) a.currentness_fingerprint = fingerprint;
  const pagesScanned = [...new Set((allTexts || []).map((a) => a.page_id).filter(Boolean))];
  const coverage = {
    sheet, token, pagesScanned, textAssetsInspected: (allTexts || []).length,
    acceptedOccurrences: accepted.length, excludedOccurrences: excluded.length,
    unresolvedOccurrences: unresolved.length, aiEscalated: 0, humanReviewNeeded: accepted.length + unresolved.length,
    state: unresolved.length ? "INCOMPLETE" : "COMPLETE",
  };
  return { ok: true, location, rawCandidates: raw.length, excluded, duplicatesRemoved, accepted, unresolved, multiplicity: [], coverage, fingerprint };
}
const centerOf = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const safeParse = (v) => { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; } };
const regionsFor = (t, regions) => regions || {};
const hash = (s) => { let h1 = 0xdeadbeef, h2 = 0x41c6ce57; for (let i = 0; i < s.length; i += 1) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); } return (4294967296 * (2097151 & h2) + (h1 >>> 0)); };

// ---------------------------------------------------------------------------
// 8. Cross-sheet graph: explicit evidence only, never filename inference.
// ---------------------------------------------------------------------------
export const GRAPH_EDGE_KINDS = Object.freeze(["LEGEND_FOR", "REFERENCES", "DETAIL_OF", "SAME_SYSTEM", "REVISION_OF", "SUPERSEDES"]);
export function buildSheetGraph({ documents = [], references = [], versions = [] } = {}) {
  const edges = [];
  for (const r of references) {
    if (r.kind === "LEGEND_FOR" && r.sourceDocumentId && r.targetDocumentId) {
      edges.push({ kind: "LEGEND_FOR", from: r.sourceDocumentId, to: r.targetDocumentId, evidence: r.noteText ?? null });
    } else if (r.referencedDrawingNumber && r.sourceDocumentId && r.resolvedTargetDocumentId) {
      edges.push({ kind: "REFERENCES", from: r.sourceDocumentId, to: r.resolvedTargetDocumentId, evidence: r.noteText ?? null });
    }
  }
  const bySheet = new Map();
  for (const d of documents) {
    const key = `${d.sheetName ?? d.logicalName ?? ""}|${d.building ?? ""}|${d.system ?? ""}`;
    if (!bySheet.has(key)) bySheet.set(key, []);
    bySheet.get(key).push(d);
  }
  for (const [, group] of bySheet) {
    const sorted = [...group].sort((a, b) => (a.versionNumber || 0) - (b.versionNumber || 0));
    for (let i = 1; i < sorted.length; i += 1) {
      edges.push({ kind: "REVISION_OF", from: sorted[i].id, to: sorted[i - 1].id, evidence: "version ordering" });
      edges.push({ kind: "SUPERSEDES", from: sorted[i].id, to: sorted[i - 1].id, evidence: "version ordering" });
    }
  }
  for (const v of versions) {
    if (v.supersededByVersionId) edges.push({ kind: "SUPERSEDES", from: v.supersededByVersionId, to: v.versionId, evidence: "supersession record" });
  }
  return { version: DRAWING_INTELLIGENCE_VERSION, edges: edges.filter((e) => GRAPH_EDGE_KINDS.includes(e.kind)) };
}

// ---------------------------------------------------------------------------
// 10. Targeted Muse escalation: unresolved items only, narrow tasks only.
// ---------------------------------------------------------------------------
export const MUSE_TASKS = Object.freeze(["TRANSCRIBE_GLYPH", "DISAMBIGUATE_MODIFIER", "READ_TEXT", "READ_TABLE_FRAGMENT", "CLASSIFY_LOCAL_SHAPE", "RESOLVE_LOCAL_SPATIAL_RELATION"]);
export function decideMuseEscalation({ unresolved = [] } = {}) {
  return unresolved
    .filter((u) => u && u.bbox && u.question && MUSE_TASKS.includes(u.question))
    .map((u) => ({ bbox: u.bbox, page: u.page ?? null, task: u.question, reason: "unresolved-deterministic" }));
}

// ---------------------------------------------------------------------------
// 14. Generalized Agent-1 handoff (occurrences + printed quantity/multiplicity
// evidence; never claims, never authority).
// ---------------------------------------------------------------------------
export function readDrawingEvidence({ store, projectId, deviceClass, location, currentDocumentVersions }) {
  const loc = store?.[location];
  if (!loc) return { ok: true, occurrences: [], reason: "NO_EVIDENCE_FOR_LOCATION" };
  const current = currentDocumentVersions?.[loc.location.documentId];
  if (!current || current !== loc.location.documentVersionId) {
    return { ok: false, error: "STALE_EVIDENCE_REFUSED" };
  }
  if (loc.location.projectId !== projectId) return { ok: false, error: "FOREIGN_PROJECT_EVIDENCE" };
  void deviceClass;
  return { ok: true, occurrences: loc.accepted || [], multiplicity: loc.multiplicity || [], coverage: loc.coverage || null, fingerprint: loc.fingerprint || null };
}

// Re-exported relationship vocabulary so consumers share one contract.
export { classifyRelationship };
