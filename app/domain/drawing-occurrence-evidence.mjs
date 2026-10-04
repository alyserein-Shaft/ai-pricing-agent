// Drawing occurrence evidence for Agent 1 quantity consumption (Fireman Telephone MVP).
//
// Produces DrawingOccurrenceEvidence[] from source-native PDF text geometry
// (via drawing-intake-engine extractDrawingStructure). No AI, no quantity
// authority, no product identity: occurrence evidence only. Agent 1 owns all
// quantity claims; this module must never emit one.
//
// Pure domain logic: no DOM, no fetch, no DB. All inputs are passed in;
// currentness is decided by comparing against caller-supplied live heads.
import { extractDrawingStructure } from "./drawing-intake-engine.mjs";

export const OCCURRENCE_EVIDENCE_VERSION = "drawing-occurrence-evidence-1.0.0";
export const TARGET_CLASS = "T";
export const TARGET_IDENTITY = "FIREMAN TELEPHONE JACK";

// A T candidate is a standalone single-glyph text object. Symbol labels are
// emitted as separate text objects by CAD PDF writers; multi-char strings are
// never T candidates.
const isTCandidate = (text) => /^\s*T\s*$/.test(text ?? "");

// Legend-definition patterns: a T that IS the definition (not an occurrence).
const LEGEND_DEF_PATTERN = /^\s*T\s*[-=:]\s*\S/i;
// Title-block label patterns: drawing frame metadata, never devices.
const TITLE_LABEL_PATTERN = /^(DRAWN|CHECKED|APPROVED|SCALE|DATE|DWG|REV|REVISION|DRAWING|TITLE|SHEET|PROJECT|CLIENT|CONSULTANT)\b|^\d{7}-|^(AMS|BOS|GRS|KGS|WLC)\b/i;
const EXCLUSION_RADIUS = 60;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const center = (bbox) => ({ x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 });

const fingerprintOf = (parts) => {
  const text = JSON.stringify(parts);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h2 >>> 13), 3266489909);
  return `doe_${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0")}`;
};

// WLC multiplicity: a printed "N Nos" belongs to a T group only when it sits
// directly below the SAME x column (same-x adjacency, small vertical gap).
// Anything else (other symbols' quantities) is not T evidence.
const NOS_PATTERN = /^\s*(\d+)\s*Nos?\.?\s*$/i;
export function associateMultiplicity(tItems, textItems) {
  const components = [];
  for (const t of tItems) {
    const tc = center(t.boundingBox);
    const match = textItems
      .map((a) => ({ asset: a, m: NOS_PATTERN.exec(a.text ?? "") }))
      .filter(({ m, asset }) => {
        if (!m || !asset.boundingBox) return false;
        const c = center(asset.boundingBox);
        const dx = Math.abs(c.x - tc.x);
        const dy = c.y - tc.y;
        return dx <= 14 && dy >= 0 && dy <= 48;
      })
      .sort((x, y) => (Math.abs(center(x.asset.boundingBox).x - tc.x) - Math.abs(center(y.asset.boundingBox).x - tc.x)))
      .at(0);
    if (match) {
      components.push({
        tBbox: t.boundingBox,
        printedText: match.asset.text.trim(),
        printedValue: Number(match.m[1]),
        printedBbox: match.asset.boundingBox,
        printedAssetId: match.asset.assetId ?? null,
      });
    }
  }
  return components;
}

// Identity authority is DERIVED from governed rows passed in by the caller --
// never accepted as a caller literal. legendRows: approved legend entries
// {label, description, documentId, documentVersionId}. architectureRows:
// approved LAYOUT_LEGEND_LINK rows {id, subject, object, document_id,
// document_version_id}. A row confers applicability ONLY on its exact bound
// document version; rows bound to superseded/duplicate document rows confer
// nothing on the live version.
export function resolveIdentityAuthority({ abbreviation = "T", documentId, documentVersionId, legendRows = [], architectureRows = [] } = {}) {
  const hits = [];
  for (const row of architectureRows || []) {
    if (row.subject === abbreviation && row.relation === "MATCHES_GOVERNED_LEGEND"
      && row.document_id === documentId && row.document_version_id === documentVersionId) {
      hits.push({ rowId: row.id, kind: "LAYOUT_LEGEND_LINK", object: row.object });
    }
  }
  for (const row of legendRows || []) {
    if (String(row.label ?? "").trim() === abbreviation
      && row.documentId === documentId && row.documentVersionId === documentVersionId) {
      hits.push({ rowId: row.id || null, kind: "LEGEND_ENTRY", object: row.description });
    }
  }
  if (!hits.length) {
    return { applicable: false, authority: "NOT_PROVEN", governed_identity: null, provenance: [] };
  }
  return {
    applicable: true,
    authority: "GOVERNED_LAYOUT_LEGEND_LINK",
    governed_identity: TARGET_IDENTITY,
    provenance: hits,
  };
}

export function extractOccurrenceEvidence({ pdfBytes, location, legend }) {
  // `legend` is accepted ONLY as a hint for offline geometry discovery ({})
  // and NEVER as authority: identity_authority is always NOT_PROVEN here.
  // Governed authority requires resolveIdentityAuthority() over live rows.
  void legend;
  const { projectId, documentId, documentVersionId, sheet } = location;
  if (!projectId || !documentId || !documentVersionId) {
    return { ok: false, error: "MISSING_PROVENANCE" };
  }
  return extractDrawingStructure(pdfBytes, { filename: sheet }).then((structure) => {
    const texts = (structure.assets || []).filter((a) => a.assetType === "Text");
    const raw = texts.filter((a) => isTCandidate(a.text));

    // Region exclusion: legend definitions and title-block metadata are never
    // physical devices. Content-proximity based, never a y-band (plan content
    // shares the bottom quarter with the title strip).
    const excluded = [];
    const kept = [];
    for (const t of raw) {
      const c = center(t.boundingBox);
      const legendHit = texts.find((a) => LEGEND_DEF_PATTERN.test(a.text ?? "") && dist(center(a.boundingBox), c) <= EXCLUSION_RADIUS);
      if (legendHit) { excluded.push({ asset: t, reason: "LEGEND_EXAMPLE", near: legendHit.text }); continue; }
      const titleHit = texts.find((a) => TITLE_LABEL_PATTERN.test((a.text ?? "").trim()) && dist(center(a.boundingBox), c) <= EXCLUSION_RADIUS);
      if (titleHit) { excluded.push({ asset: t, reason: "TITLE_BLOCK", near: titleHit.text }); continue; }
      kept.push(t);
    }

    // Deterministic dedup: identical text at identical rounded coordinates is
    // one source object emitted twice, not two devices.
    const seen = new Set();
    const duplicatesRemoved = [];
    const unique = [];
    for (const t of kept) {
      const b = t.boundingBox;
      const key = `${t.text}|${Math.round(b.x)},${Math.round(b.y)}`;
      if (seen.has(key)) { duplicatesRemoved.push(t); continue; }
      seen.add(key);
      unique.push(t);
    }

    const toEvidence = (t, state, extra = {}) => ({
      project_id: projectId,
      document_id: documentId,
      document_version_id: documentVersionId,
      page: t.pageNumber,
      sheet,
      region_type: "LAYOUT_DEVICE_REGION",
      bbox: t.boundingBox,
      observed_symbol: "T",
      governed_identity: null,
      identity_authority: "NOT_PROVEN",
      source_channel: "NATIVE_TEXT",
      source_object_ids: [],
      legend_applicability: { applicable: false, authority: "NOT_PROVEN" },
      excluded: state !== "ACCEPTED",
      exclusion_reason: state === "ACCEPTED" ? null : extra.reason || "UNRESOLVED",
      duplicate_group: null,
      dedup_state: extra.dedupState || null,
      currentness_fingerprint: null, // stamped below
      provenance: {
        extractor: "drawing-intake-1.0.0",
        text: t.text,
        detectionMethod: t.detectionMethod,
        detectionConfidence: t.detectionConfidence,
      },
      review_state: "Needs Review",
    });

    const accepted = unique.map((t) => toEvidence(t, "ACCEPTED"));
    const unresolved = [];
    const fingerprint = fingerprintOf([projectId, documentId, documentVersionId, sheet, accepted.map((a) => a.bbox)]);
    for (const a of accepted) a.currentness_fingerprint = fingerprint;

    // Measured coverage: every input text asset on every scanned page was
    // inspected (candidates + exclusion checks). Regions are the scanned
    // pages; a candidate that can be neither accepted nor excluded lands in
    // `unresolved` and forces INCOMPLETE. Nothing here is constant-folded.
    const pagesScanned = [...new Set(texts.map((a) => a.pageNumber))];
    const checksRun = ["legend-def-proximity", "title-label-proximity", "exact-duplicate"];
    const multiplicity = associateMultiplicity(unique, texts);
    const coverage = {
      sheet,
      pagesScanned,
      textAssetsInspected: texts.length,
      exclusionChecksRun: checksRun,
      applicableDeviceRegions: pagesScanned.length,
      processedRegions: pagesScanned.length,
      acceptedOccurrences: accepted.length,
      excludedOccurrences: excluded.length,
      unresolvedOccurrences: unresolved.length,
      state: unresolved.length ? "INCOMPLETE" : "COMPLETE",
    };
    return {
      ok: true,
      location,
      rawCandidates: raw.length,
      excludedNonPhysical: excluded.map((e) => ({ bbox: e.asset.boundingBox, reason: e.reason, near: e.near })),
      duplicatesRemoved: duplicatesRemoved.length,
      accepted,
      unresolved,
      multiplicity,
      coverage,
      fingerprint,
    };
  });
}

// Agent 1 read interface: normalized occurrence evidence only, never raw PDF
// tables. Stale evidence (version mismatch) is refused, never emitted.
export function readDrawingOccurrenceEvidence({ evidenceByLocation, projectId, deviceClass, location, currentDocumentVersions }) {
  if (deviceClass !== TARGET_IDENTITY && deviceClass !== "T") return { ok: true, occurrences: [], reason: "DEVICE_CLASS_OUT_OF_SCOPE" };
  const loc = evidenceByLocation[location];
  if (!loc) return { ok: true, occurrences: [], reason: "NO_EVIDENCE_FOR_LOCATION" };
  // Location identity travels in camelCase (extraction input shape); occurrence
  // evidence itself is snake_case (canonical Agent 1 shape). Do not conflate.
  const current = currentDocumentVersions?.[loc.location.documentId];
  if (!current || current !== loc.location.documentVersionId) {
    return { ok: false, error: "STALE_EVIDENCE_REFUSED", reason: "Document version is not current." };
  }
  if (loc.location.projectId !== projectId) {
    return { ok: false, error: "FOREIGN_PROJECT_EVIDENCE", reason: "Project scope mismatch." };
  }
  return { ok: true, occurrences: loc.accepted, multiplicity: loc.multiplicity, coverage: loc.coverage, fingerprint: loc.fingerprint };
}

// Asset-bound builder: occurrences from LIVE drawing_assets rows, so every
// occurrence carries its real sourceAssetIds (asset id, page id, intake id).
// `assets`: live rows {id, text_content, bounding_box, page_id,
// intake_version_id}. `allTexts`: live text rows on the same intake for
// exclusion + multiplicity association. `resolution`: output of
// resolveIdentityAuthority() -- the ONLY source of identity authority.
export function buildOccurrenceEvidenceFromAssets({ assets, allTexts, location, resolution, governedLegendSymbols = [], governedLegendRegions = [] }) {
  const { projectId, documentId, documentVersionId, sheet } = location;
  if (!projectId || !documentId || !documentVersionId) return { ok: false, error: "MISSING_PROVENANCE" };
  const raw = (assets || []).filter((a) => isTCandidate(a.text_content));
  const excluded = [];
  const kept = [];
  // Candidates whose asset row is malformed (unparseable bbox) can be neither
  // accepted nor excluded: they are preserved as UNRESOLVED and force
  // INCOMPLETE coverage. This branch is real, not decorative.
  const unresolved = [];
  for (const t of raw) {
    let c = null;
    try { c = center(JSON.parse(t.bounding_box)); } catch { unresolved.push({ assetId: t.id, reason: "UNPARSEABLE_GEOMETRY" }); continue; }
    // GOVERNED LEGEND MEMBERSHIP / REGION (authoritative, radius-free).
    //
    // A legend table can lay its symbol above its description with no delimiter
    // at all, in which case the delimiter-pattern proximity test below cannot see
    // it and the definition itself is accepted as a physical device. Two stronger
    // signals exist and are checked FIRST: the asset is a member of a governed
    // legend definition, or it lies inside a governed legend region. Neither
    // depends on a pixel radius, a symbol name, or a document.
    const governedSymbolHit = governedLegendSymbols.find((entry) => entry?.assetId === t.id || entry?.symbolAssetId === t.id);
    if (governedSymbolHit) { excluded.push({ assetId: t.id, reason: "GOVERNED_LEGEND_SYMBOL", near: governedSymbolHit.token ?? null }); continue; }
    const governedRegionHit = governedLegendRegions.find((region) => {
      if (!region?.boundingBox) return false;
      const box = region.boundingBox;
      return box.x <= c.x && c.x <= box.x + box.width && box.y <= c.y && c.y <= box.y + box.height;
    });
    if (governedRegionHit) { excluded.push({ assetId: t.id, reason: "GOVERNED_LEGEND_REGION", near: governedRegionHit.source ?? null }); continue; }
    const legendHit = (allTexts || []).find((a) => {
      if (!LEGEND_DEF_PATTERN.test(a.text_content ?? "")) return false;
      try { return dist(center(JSON.parse(a.bounding_box)), c) <= EXCLUSION_RADIUS; } catch { return false; }
    });
    if (legendHit) { excluded.push({ assetId: t.id, reason: "LEGEND_EXAMPLE", near: legendHit.text_content }); continue; }
    const titleHit = (allTexts || []).find((a) => {
      if (!TITLE_LABEL_PATTERN.test(String(a.text_content ?? "").trim())) return false;
      try { return dist(center(JSON.parse(a.bounding_box)), c) <= EXCLUSION_RADIUS; } catch { return false; }
    });
    if (titleHit) { excluded.push({ assetId: t.id, reason: "TITLE_BLOCK", near: titleHit.text_content }); continue; }
    kept.push(t);
  }
  const seen = new Set();
  const duplicatesRemoved = [];
  const unique = [];
  for (const t of kept) {
    const b = JSON.parse(t.bounding_box);
    const key = `${t.text_content}|${Math.round(b.x)},${Math.round(b.y)}`;
    if (seen.has(key)) { duplicatesRemoved.push(t.id); continue; }
    seen.add(key);
    unique.push(t);
  }
  // Accepted candidates carry parsed geometry; anything reaching here with
  // malformed geometry was already preserved as UNRESOLVED above.
  const accepted = [];
  for (const t of unique) {
    let bbox = null;
    try { bbox = JSON.parse(t.bounding_box); } catch { unresolved.push({ assetId: t.id, reason: "UNPARSEABLE_GEOMETRY" }); continue; }
    if (!Number.isFinite(bbox.x) || !Number.isFinite(bbox.y)) { unresolved.push({ assetId: t.id, reason: "NON_FINITE_GEOMETRY" }); continue; }
    accepted.push({
      project_id: projectId, document_id: documentId, document_version_id: documentVersionId,
      page: t.page_id, sheet, region_type: "LAYOUT_DEVICE_REGION", bbox,
      observed_symbol: "T",
      governed_identity: resolution?.applicable === true ? TARGET_IDENTITY : null,
      identity_authority: resolution?.applicable === true ? resolution.authority : "NOT_PROVEN",
      source_channel: "NATIVE_TEXT",
      source_object_ids: [t.id],
      legend_applicability: resolution?.applicable === true
        ? { applicable: true, authority: resolution.authority, provenance: resolution.provenance }
        : { applicable: false, authority: "NOT_PROVEN" },
      excluded: false, exclusion_reason: null, duplicate_group: null, dedup_state: null,
      currentness_fingerprint: null,
      provenance: { extractor: "live-drawing-assets", assetId: t.id, intakeVersionId: t.intake_version_id, text: t.text_content },
      review_state: "Needs Review",
    });
  }
  const pagesScanned = [...new Set((allTexts || []).map((a) => a.page_id).filter(Boolean))];
  const fingerprint = fingerprintOf([projectId, documentId, documentVersionId, sheet, accepted.map((a) => a.source_object_ids)]);
  for (const a of accepted) a.currentness_fingerprint = fingerprint;
  const multiplicity = associateMultiplicity(
    unique.map((t) => { try { return { boundingBox: JSON.parse(t.bounding_box) }; } catch { return null; } }).filter(Boolean),
    (allTexts || []).map((a) => { try { return { text: a.text_content, boundingBox: JSON.parse(a.bounding_box), assetId: a.id }; } catch { return null; } }).filter(Boolean),
  );
  const coverage = {
    sheet, pagesScanned, textAssetsInspected: (allTexts || []).length,
    exclusionChecksRun: ["legend-def-proximity", "title-label-proximity", "exact-duplicate", "geometry-parse"],
    applicableDeviceRegions: pagesScanned.length, processedRegions: pagesScanned.length,
    acceptedOccurrences: accepted.length, excludedOccurrences: excluded.length,
    unresolvedOccurrences: unresolved.length,
    state: unresolved.length ? "INCOMPLETE" : "COMPLETE",
  };
  return { ok: true, location, rawCandidates: raw.length, excludedNonPhysical: excluded, duplicatesRemoved: duplicatesRemoved.length, accepted, unresolved, multiplicity, coverage, fingerprint };
}
