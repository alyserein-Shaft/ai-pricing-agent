// SYSTEM ARCHITECTURE FACT EXTRACTION (Step 14.7).
//
// Deterministic candidate extraction of FIRE ALARM architecture facts from
// riser / schematic / network-diagram sheet evidence (drawing_assets text
// fragments + their bounding boxes). Pure domain logic: no DOM, no DB.
//
// What this can and cannot do (hard-evidence rules):
//  - Facts are extracted ONLY from explicit text patterns on sheets whose
//    classified type is architecturally PRIMARY (Riser Diagram,
//    Schematic / Single-Line). A legend sheet establishes symbol identity
//    (Step 14.6) but is NEVER an architecture source -- architecture requires
//    riser/schematic/network layout/notes connection evidence.
//  - Bounding-box geometry is used ONLY for deterministic TEXT-line
//    reconstruction (PDF extraction tears one sentence into overlapping
//    fragments) and for spatial ASSOCIATION (panel symbol near a building
//    label). It is NEVER used to infer a line because a line "could" connect
//    two things. There is no vector/line pipeline in this codebase; a
//    connection fact requires an explicit textual statement.
//  - Every fact carries fragment provenance (sourceFragmentIds), the joined
//    excerpt (insight), an evidence fingerprint, and an evidence kind
//    (EXPLICIT prose/token vs DERIVED via deterministic geometry).
//  - Nothing here merges panel identities ACROSS sheets by name alone: a
//    cross-sheet identity requires exact room/location text evidence
//    (resolveCrossSheetPanelIdentities).
import { createHash } from "node:crypto";
import { detectCrossSheetReferences, resolveCrossSheetReferenceTargets } from "./drawing-cross-sheet-references.mjs";
import { ARCHITECTURE_PRIMARY_SHEETS } from "./drawing-architecture-decision-policy.mjs";

const trim = (value) => String(value ?? "").trim();
const norm = (value) => trim(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
const normText = (value) => trim(value).replace(/\s+/g, " ").toUpperCase().replace(/\s+/g, " ");

export const ARCHITECTURE_PARSER_VERSION = "drawing-architecture-intelligence-1.0.0";

export const sha256hex = (value) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

// ---------------------------------------------------------------------------
// Deterministic text-line reconstruction (overlap/adjacency within a y-band).
// ---------------------------------------------------------------------------
export const reconstructEvidenceLines = (assets = []) => {
  const byPage = new Map();
  for (const asset of assets) {
    if (!asset?.boundingBox) continue;
    const page = String(asset.pageId ?? "page");
    if (!byPage.has(page)) byPage.set(page, []);
    byPage.get(page).push(asset);
  }
  const lines = [];
  for (const [pageId, pageAssets] of byPage) {
    const boxes = pageAssets.map((asset) => {
      const b = asset.boundingBox || {};
      return { asset, x: Number(b.x ?? 0), y: Number(b.y ?? 0), w: Number(b.width ?? 0), h: Number(b.height ?? 0) };
    });
    boxes.sort((a, b) => a.y - b.y || a.x - b.x);
    // Y-bands: fragments whose vertical centers are within 8 units belong to
    // the same visual line. Real fragments torn by PDF extraction share one
    // baseline y to the fraction of a unit; unrelated rows are 15+ apart.
    const bands = [];
    for (const box of boxes) {
      const centerY = box.y + box.h / 2;
      let band = bands[bands.length - 1];
      if (!band || Math.abs(centerY - band.centerY) > 8) {
        band = { centerY, items: [] };
        bands.push(band);
      }
      band.items.push(box);
    }
    for (const band of bands) {
      band.items.sort((a, b) => a.x - b.x);
      // Within a band, splice into chunks: merge fragments that overlap or are
      // directly adjacent (next.start <= prev.end + 4). Non-adjacent tokens on
      // one visual line (table columns, loop tags) stay separate chunks.
      let chunk = null;
      for (const box of band.items) {
        if (!chunk) { chunk = { pageId, items: [box] }; continue; }
        const prev = chunk.items[chunk.items.length - 1];
        const prevEnd = prev.x + prev.w;
        if (box.x <= prevEnd + 4) chunk.items.push(box);
        else { lines.push(chunk); chunk = { pageId, items: [box] }; }
      }
      if (chunk) lines.push(chunk);
    }
  }
  const resolved = lines.map((chunk) => {
    const text = chunk.items.map((box) => trim(box.asset.textContent)).filter(Boolean).join(" ").replace(/\s+/g, " ");
    const { x, y, w, h } = chunk.items.reduce(
      (acc, box) => ({
        x: Math.min(acc.x, box.x),
        y: Math.min(acc.y, box.y),
        w: Math.max(acc.w, box.x + box.w - Math.min(acc.w + acc.x, acc.x)),
        h: Math.max(acc.h, box.y + box.h - Math.min(acc.h + acc.y, acc.y)),
      }),
      { x: chunk.items[0].x, y: chunk.items[0].y, w: 0, h: 0 },
    );
    return {
      pageId: chunk.pageId,
      text,
      region: { x, y, width: w, height: h },
      fragmentIds: chunk.items.map((box) => box.asset.id),
    };
  });
  return resolved.filter((line) => line.text.length > 0);
};

// ---------------------------------------------------------------------------
// Panel identity normalization.
// ---------------------------------------------------------------------------
export const PANEL_IDENTITY_RULES = [
  { pattern: /^\(?\s*(?:M\.F\.A\.C\.P|MFACP)\s*\)?$/i, subject: "MFACP", kind: "explicit-identity" },
  { pattern: /^\(?\s*(?:F\.A\.C\.P|FACP)\s*\)?$/i, subject: "FACP", kind: "explicit-identity" },
  { pattern: /^(?:MAIN\s+)?FIRE\s+ALARM\s+CONTROL\s+PANEL$/i, subject: "FACP", kind: "label" },
  { pattern: /^(?:MAIN\s+)?FIRE\s+ALARM\s+CONTROL\s+PANEL\s*\(\s*(?:M\.F\.A\.C\.P|MFACP)\s*\)/i, subject: "MFACP", kind: "label-with-expansion" },
  { pattern: /^FIRE\s+ALARM\s+CONTROL\s+PANEL\s*\(\s*(?:F\.A\.C\.P|FACP)\s*\)/i, subject: "FACP", kind: "label-with-expansion" },
  { pattern: /^CAMPUS-WIDE\s+FIRE\s+ALARM\s+CONTROL\s+PANEL$/i, subject: "MFACP", kind: "campus-wide-main" },
  { pattern: /^CAMPUS-WIDE\s+MAIN\s+FIRE\s+ALARM\s+CONTROL\s+PANEL$/i, subject: "MFACP", kind: "campus-wide-main" },
];

export const resolvePanelIdentity = (text) => {
  const t = trim(text);
  if (!t) return null;
  for (const rule of PANEL_IDENTITY_RULES) {
    if (rule.pattern.test(t)) return { subject: rule.subject, label: normText(t), kind: rule.kind };
  }
  return null;
};

// ---------------------------------------------------------------------------
// Building / area vocabulary (this project's own real labels).
// ---------------------------------------------------------------------------
const BUILDING_LABEL_PATTERN = /^(?:AT\s+)?(BOYS\s+SCHOOL|GIRLS\s+SCHOOL|WELCOME\s+CENTER|SUB\s+STATION\s*-?\s*[12]|DG\s+STATION|KG\s+BUILDING)$/i;

const LOCATION_PATTERNS = [
  { name: "at", pattern: /^AT\s+([A-Z0-9 .,&'()\-*]{3,80})$/i },
  { name: "room", pattern: /^\(?ROOM\s+([A-Z0-9 .\-\/]{2,20})\)?$/i },
  { name: "fcc", pattern: /^FIRE\s+COMMAND\s+CENTER(?:\s*[-–]\s*(.*))?$/i },
];

const matchLocation = (text) => {
  const t = trim(text).replace(/\.\s*$/, "");
  for (const { name, pattern } of LOCATION_PATTERNS) {
    const m = pattern.exec(t);
    if (m) return { place: normText(m[1] ?? t), label: t };
  }
  return null;
};

const LOOP_PATTERN = /^(?:NAC\s+)?LOOP[\s\-]?(\d+)?$/i;
const INTERFACE_PATTERN = /^INTERFACE\s+TO\s+(.{3,60})$/i;
const DESTINATION_PATTERN = /^(?:TO|FROM)\s+([A-Z0-9@\s.]{3,80})$/i;
const SIGNAL_PATTERN = /^SIGNAL\s+TO\s+(.{3,60})$/i;

const bboxCenter = (b) => ({ x: Number(b.x ?? 0) + Number(b.width ?? 0) / 2, y: Number(b.y ?? 0) + Number(b.height ?? 0) / 2 });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export const buildingCodeFromDrawingNumber = (drawingNumber = "") => {
  const match = /-AMS-|-BOS-|-GRS-|-KGS-|-WLC-/i.exec(String(drawingNumber));
  return match ? norm(match[0].replace(/-/g, "")) : null;
};

// ---------------------------------------------------------------------------
// Per-sheet candidate fact extraction.
//   sheet:    {projectId, documentId, documentVersionId, intakeVersionId,
//              drawingNumber, sheetName, drawingType}
//   assets:   [{id, pageId, textContent, boundingBox}] (Text assets only)
//   primary:  is this sheet's drawingType architecturally primary?
// Upstream caller supplies cross-sheet machinery inputs.
// ---------------------------------------------------------------------------
export const extractArchitectureFacts = ({ sheet = {}, assets = [] } = {}) => {
  const primary = ARCHITECTURE_PRIMARY_SHEETS.includes(sheet.drawingType);
  const sourceDocument = { id: sheet.documentId, drawingNumber: sheet.drawingNumber ?? null, sheetName: sheet.sheetName ?? null };
  const facts = [];
  const fragments = assets.filter((a) => trim(a.textContent || "").length > 0);
  const lines = reconstructEvidenceLines(fragments);

  const push = (fact) => {
    const { factType, subject, relation, object, evidenceKind, source, identity = {}, assignment = null } = fact;
    const factKey = `${factType}|${norm(subject)}|${norm(relation || "")}|${norm(object || "")}|${norm(fact.scope || "FIRE_ALARM")}`;
    facts.push({ factKey, ...fact });
  };

  const excerpt = (assets) => assets.map((a) => trim(a.textContent)).filter(Boolean).join(" ").replace(/\s+/g, " ");
  const regionOf = (assets) => {
    if (!assets.length) return null;
    const xs = [], ys = [];
    for (const a of assets) {
      if (!a.boundingBox) continue;
      xs.push(Number(a.boundingBox.x ?? 0), Number(a.boundingBox.x ?? 0) + Number(a.boundingBox.width ?? 0));
      ys.push(Number(a.boundingBox.y ?? 0), Number(a.boundingBox.y ?? 0) + Number(a.boundingBox.height ?? 0));
    }
    if (!xs.length) return null;
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  };

  const fragmentObjs = (ids) => (ids || []).map((id) => fragments.find((f) => f.id === id)).filter(Boolean);
  const makeSource = ({ ids, insight }) => ({
    documentId: sheet.documentId,
    documentVersionId: sheet.documentVersionId,
    intakeVersionId: sheet.intakeVersionId,
    structureVersionId: sheet.structureVersionId ?? null,
    drawingNumber: sheet.drawingNumber ?? null,
    sheetName: sheet.sheetName ?? null,
    drawingType: sheet.drawingType ?? null,
    pageNumber: ids && ids.length ? ((fragments.find((f) => f.id === ids[0]))?.pageNumber ?? null) : null,
    sourceRegion: ids ? regionOf(fragmentObjs(ids)) : null,
    sourceFragmentIds: ids || [],
    insight,
  });

  // -------------------------------------------------------------------------
  // Fragment-level token extraction.
  // -------------------------------------------------------------------------
  const panelTokens = [];       // {subject, kind, assetId, boundingBox, label}
  const loopFacts = [];         // canonical loop tokens observed
  const interfaceFacts = [];
  const destinationFacts = [];
  const buildingLabels = [];    // {label, boundingBox, assetId}
  const locationFragments = []; // {place, label, boundingBox, assetId}

  for (const asset of fragments) {
    const text = trim(asset.textContent);
    const box = asset.boundingBox || {};
    // Panels.
    const panel = resolvePanelIdentity(text);
    if (panel) {
      panelTokens.push({ ...panel, assetId: asset.id, boundingBox: box, fragment: asset, pageNumber: asset.pageNumber ?? null });
      continue;
    }
    // Loops.
    if (LOOP_PATTERN.test(text)) {
      const m = LOOP_PATTERN.exec(text);
      const nac = /^NAC/i.test(text);
      loopFacts.push({ assetId: asset.id, boundingBox: box, fragment: asset, nac, number: m[1] ? Number(m[1]) : null, label: normText(text) });
      continue;
    }
    // Interfaces.
    if (INTERFACE_PATTERN.test(text)) {
      const m = INTERFACE_PATTERN.exec(text);
      interfaceFacts.push({ assetId: asset.id, boundingBox: box, fragment: asset, system: trim(m[1]) });
      continue;
    }
    // External civil-defence signal + TO/FROM destinations.
    if (SIGNAL_PATTERN.test(text)) {
      const m = SIGNAL_PATTERN.exec(text);
      destinationFacts.push({ assetId: asset.id, boundingBox: box, fragment: asset, direction: "signal", target: trim(m[1]) });
      continue;
    }
    if (DESTINATION_PATTERN.test(text)) {
      const m = DESTINATION_PATTERN.exec(text);
      destinationFacts.push({ assetId: asset.id, boundingBox: box, fragment: asset, direction: /^TO\b/i.test(text) ? "to" : "from", target: trim(m[1]) });
      continue;
    }
    // Building labels (network diagram node captions).
    if (BUILDING_LABEL_PATTERN.test(text)) {
      buildingLabels.push({ label: normText(text.replace(/^AT\s+/i, "")), rawLabel: text, assetId: asset.id, boundingBox: box });
      continue;
    }
    // Location statements.
    const location = matchLocation(text);
    if (location) {
      locationFragments.push({ ...location, assetId: asset.id, boundingBox: box, fragment: asset });
      continue;
    }
  }

  // -------------------------------------------------------------------------
  // Loop facts: unique per loop identifier.
  // -------------------------------------------------------------------------
  const seenLoops = new Set();
  for (const loop of loopFacts) {
    const subject = loop.nac ? "NAC LOOP" : `LOOP-${loop.number}`;
    if (seenLoops.has(subject)) continue;
    seenLoops.add(subject);
    push({
      factType: loop.nac ? "NAC_CIRCUIT_EXISTS" : "SLC_LOOP_EXISTS",
      subject,
      relation: null,
      object: null,
      scope: "FIRE_ALARM",
      evidenceKind: "EXPLICIT",
      authorityClass: primary ? "PRIMARY" : "SECONDARY",
      source: makeSource({ ids: [loop.assetId], insight: loop.label }),
      identity: { resolution: loop.nac ? "UNIQUE" : "UNIQUE", loopNumber: loop.number ?? null },
      supportingSourceAllowed: false,
    });
  }

  // -------------------------------------------------------------------------
  // Interface facts.
  // -------------------------------------------------------------------------
  for (const iface of interfaceFacts) {
    push({
      factType: "INTERFACE_CONNECTED_TO_SYSTEM",
      subject: "FIRE ALARM SYSTEM",
      relation: "INTERFACES_WITH",
      object: iface.system,
      scope: "FIRE_ALARM",
      evidenceKind: "EXPLICIT",
      authorityClass: primary ? "PRIMARY" : "SECONDARY",
      source: makeSource({ ids: [iface.assetId], insight: `INTERFACE TO ${iface.system}` }),
      identity: { resolution: "UNIQUE" },
      supportingSourceAllowed: false,
    });
  }

  // -------------------------------------------------------------------------
  // Destination facts (explicit connectivity statements).
  // -------------------------------------------------------------------------
  const buildingCode = buildingCodeFromDrawingNumber(sheet.drawingNumber);
  for (const dest of destinationFacts) {
    const t = normText(dest.target);
    if (/CIVIL\s*DEFEN[CS]E/.test(t) || /CIVIL\s*DEFENCE/i.test(dest.target)) {
      push({
        factType: "EXTERNAL_SYSTEM_INTERFACE",
        subject: buildingCode ? `${buildingCode} FIRE ALARM SYSTEM` : "FIRE ALARM SYSTEM",
        relation: "SIGNALS_TO",
        object: "CIVIL DEFENCE",
        scope: "FIRE_ALARM",
        evidenceKind: "EXPLICIT",
        authorityClass: primary ? "PRIMARY" : "SECONDARY",
        source: makeSource({ ids: [dest.assetId], insight: trim(dest.fragment.textContent) }),
        identity: { resolution: "UNIQUE" },
        supportingSourceAllowed: false,
      });
      continue;
    }
    const m = /^FACP\s*@\s*([A-Z]+)\s*BUILDING/.exec(dest.target);
    if (m) {
      push({
        factType: "PANEL_NETWORK_LINK",
        subject: buildingCode ? `${buildingCode} FIRE ALARM SYSTEM` : "FIRE ALARM SYSTEM",
        relation: dest.direction === "to" ? "CONNECTED_TO" : "CONNECTED_FROM",
        object: `FACP @${norm(m[1])} BUILDING`,
        scope: "FIRE_ALARM",
        evidenceKind: "EXPLICIT",
        authorityClass: primary ? "PRIMARY" : "SECONDARY",
        source: makeSource({ ids: [dest.assetId], insight: trim(dest.fragment.textContent) }),
        identity: { resolution: "UNIQUE" },
        supportingSourceAllowed: false,
      });
      continue;
    }
    // Any other explicit destination without a recognized object is a possible
    // connectivity statement -- recorded for review, never confirmed blindly.
    push({
      factType: "PANEL_NETWORK_LINK",
      subject: buildingCode ? `${buildingCode} FIRE ALARM SYSTEM` : "FIRE ALARM SYSTEM",
      relation: dest.direction === "to" ? "CONNECTED_TO" : "CONNECTED_FROM",
      object: dest.target,
      scope: "FIRE_ALARM",
      evidenceKind: "EXPLICIT",
      authorityClass: primary ? "PRIMARY" : "SECONDARY",
      source: makeSource({ ids: [dest.assetId], insight: trim(dest.fragment.textContent) }),
      identity: { resolution: dest.target.length >= 3 ? "UNIQUE" : "AMBIGUOUS" },
      supportingSourceAllowed: false,
    });
  }

  // -------------------------------------------------------------------------
  // Panel facts + deterministic spatial assignment (panel <=> building).
  // -------------------------------------------------------------------------
  const panelIds = new Set(panelTokens.map((p) => norm(p.subject)));
  for (const panelId of panelIds) {
    const tokens = panelTokens.filter((p) => norm(p.subject) === panelId);
    const labelToken = tokens.find((p) => p.kind === "label-with-expansion" || p.kind === "campus-wide-main");
    const explicitToken = tokens.find((p) => p.kind === "explicit-identity") || labelToken || tokens[0];
    const allFragmentIds = [...new Set(tokens.map((p) => p.assetId))];

    // PANEL_EXISTS -- the panel with this normalized identity is present.
    push({
      factType: "PANEL_EXISTS",
      subject: panelId,
      relation: null,
      object: null,
      scope: "FIRE_ALARM",
      evidenceKind: "EXPLICIT",
      authorityClass: primary ? "PRIMARY" : "SECONDARY",
      source: makeSource({ ids: allFragmentIds, insight: labelToken ? labelToken.label : panelId }),
      identity: { resolution: tokens.length > 1 ? "MULTIPLE_OBSERVATIONS" : "UNIQUE", observations: tokens.length },
      supportingSourceAllowed: false,
    });

    // PANEL_LABEL -- a full label expansion is authored on the sheet.
    if (labelToken) {
      push({
        factType: "PANEL_LABEL",
        subject: panelId,
        relation: null,
        object: labelToken.label,
        scope: "FIRE_ALARM",
        evidenceKind: "EXPLICIT",
        authorityClass: primary ? "PRIMARY" : "SECONDARY",
        source: makeSource({ ids: [labelToken.assetId], insight: labelToken.label }),
        identity: { resolution: "UNIQUE" },
        supportingSourceAllowed: false,
      });
    }

    // PANEL_SERVES_AREA -- deterministic nearest-building assignment. Only the
    // explicitly authored FACP node symbols pair with the network-diagram
    // building node captions; identical repeated tokens (e.g. 2 FACP symbols
    // on one line) still each pair with their own nearest building. A tie
    // (two buildings equally near) is an engineer-review item, never a guess.
    const exclusiveTokens = tokens.filter((p) => p.kind === "explicit-identity" && !/label/.test(p.kind));
    const targetLabels = exclusiveTokens.length ? exclusiveTokens : tokens;
    for (const token of targetLabels) {
      const center = bboxCenter(token.boundingBox);
      const candidates = buildingLabels
        .map((b) => ({ b, d: distance(center, bboxCenter(b.boundingBox)) }))
        .filter((c) => c.d <= 200)
        .sort((a, b) => a.d - b.d);
      if (!candidates.length) continue;
      const nearest = candidates[0];
      const second = candidates[1];
      if (!second || nearest.d * 1.5 < second.d) {
        push({
          factType: "PANEL_SERVES_AREA",
          subject: panelId,
          relation: "SERVES",
          object: nearest.b.label,
          scope: "FIRE_ALARM",
          evidenceKind: "DERIVED",
          authorityClass: primary ? "PRIMARY" : "SECONDARY",
          source: makeSource({ ids: [token.assetId, nearest.b.assetId], insight: `${panelId} NEXT TO ${nearest.b.rawLabel}` }),
          identity: { resolution: "UNIQUE", building: nearest.b.label },
          assignment: { deterministic: true, method: "nearest-building-label", distance: Math.round(nearest.d) },
          supportingSourceAllowed: false,
        });
      } else {
        push({
          factType: "PANEL_SERVES_AREA",
          subject: panelId,
          relation: "SERVES",
          object: `AMBIGUOUS (${nearest.b.label} vs ${second.b.label})`,
          scope: "FIRE_ALARM",
          evidenceKind: "DERIVED",
          authorityClass: primary ? "PRIMARY" : "SECONDARY",
          source: makeSource({ ids: [token.assetId, nearest.b.assetId, second.b.assetId], insight: `${panelId} near ${nearest.b.rawLabel} and ${second.b.rawLabel}` }),
          identity: { resolution: "AMBIGUOUS" },
          assignment: { deterministic: false, method: "nearest-building-label", multipleNear: true, nearest: Math.round(nearest.d), second: Math.round(second.d) },
          supportingSourceAllowed: false,
        });
      }
    }

    // PANEL_SERVES_AREA -- deterministic nearest-location assignment. Room /
    // FCC locations denote the MAIN panel's fire command center; building FACP
    // symbols are located by the buildings they serve, never by an FCC room.
    // Only MFACP may take a LOCATED_AT assignment.
    if (panelId !== "MFACP") continue;
    const assignedLocations = new Set();
    for (const token of tokens) {
      const center = bboxCenter(token.boundingBox);
      const locations = locationFragments
        .map((loc) => ({ loc, d: distance(center, bboxCenter(loc.boundingBox)) }))
        .filter((c) => c.d <= 250)
        .sort((a, b) => a.d - b.d);
      if (!locations.length) continue;
      const nearest = locations[0];
      const second = locations[1];
      if (!second || nearest.d * 1.5 < second.d) {
        if (assignedLocations.has(nearest.loc.place)) continue;
        assignedLocations.add(nearest.loc.place);
        let roomToken = null;
        const roomMatch = /ROOM\s+([A-Z0-9 .\-/]{2,20})/i.exec(nearest.loc.label);
        if (roomMatch) roomToken = roomMatch[1];
        push({
          factType: "PANEL_SERVES_AREA",
          subject: panelId,
          relation: "LOCATED_AT",
          scope: "FIRE_ALARM",
          evidenceKind: "DERIVED",
          authorityClass: primary ? "PRIMARY" : "SECONDARY",
          source: makeSource({ ids: [token.assetId, nearest.loc.assetId], insight: `${panelId} LOCATED_AT ${nearest.loc.label}` }),
          identity: { resolution: "UNIQUE", roomNumber: roomToken ? norm(roomToken.replace(/[.\/]/g, "-")) : null, roomToken: roomToken ? roomToken.trim() : null },
          assignment: { deterministic: true, method: "nearest-location-label", distance: Math.round(nearest.d) },
          supportingSourceAllowed: false,
          object: nearest.loc.label.replace(/^AT\s+/i, ""),
        });
      } else {
        push({
          factType: "PANEL_SERVES_AREA",
          subject: panelId,
          relation: "LOCATED_AT",
          object: `AMBIGUOUS (${nearest.loc.label} vs ${second.loc.label})`,
          scope: "FIRE_ALARM",
          evidenceKind: "DERIVED",
          authorityClass: primary ? "PRIMARY" : "SECONDARY",
          source: makeSource({ ids: [token.assetId, nearest.loc.assetId, second.loc.assetId], insight: `${panelId} near ${nearest.loc.label} and ${second.loc.label}` }),
          identity: { resolution: "AMBIGUOUS" },
          assignment: { deterministic: false, method: "nearest-location-label", multipleNear: true },
          supportingSourceAllowed: false,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // PANEL_LOOP_RELATION -- ONLY from a shared evidence line: a panel label and
  // a loop tag that provably sit on the SAME reconstructed text line were
  // authored together (deterministic geometry). A bare line asset never counts.
  // -------------------------------------------------------------------------
  for (const line of lines) {
    const lineText = normText(line.text);
    const loopOnLine = [...new Set(loopFacts.map((l) => l.label).filter((l) => lineText.includes(l)))];
    const panelOnLine = [...new Set(panelTokens.map((p) => p.subject).filter((p) => p && lineText.includes(p)))];
    if (loopOnLine.length && panelOnLine.length) {
      for (const loop of loopOnLine) {
        for (const panel of panelOnLine) {
          push({
            factType: "PANEL_LOOP_RELATION",
            subject: panel,
            relation: "TERMINATES_AT",
            object: loop,
            scope: "FIRE_ALARM",
            evidenceKind: "DERIVED",
            authorityClass: primary ? "PRIMARY" : "SECONDARY",
            source: makeSource({ ids: line.fragmentIds, insight: line.text }),
            identity: { resolution: "UNIQUE" },
            assignment: { deterministic: true, method: "shared-evidence-line" },
            supportingSourceAllowed: false,
          });
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Sentence-level prose facts (reconstructed evidence lines).
  // -------------------------------------------------------------------------
  for (const line of lines) {
    const t = line.text;
    // Campus-wide main panel location: "CAMPUS-WIDE FIRE ALARM CONTROL PANEL
    // LOCATED AT THE FIRE COMMAND CENTER- GROUND FLOOR (02-301) KG BUILDING".
    if (/CAMPUS-WIDE/.test(t) && /LOCATED\s+AT\s+THE/.test(t)) {
      const m = /CAMPUS-WIDE\s+FIRE\s+ALARM\s+CONTROL\s+PANEL\s+LOCATED\s+AT\s+THE\s+(.+)$/i.exec(t);
      if (m) {
        push({
          factType: "PANEL_SERVES_AREA",
          subject: "MFACP",
          relation: "LOCATED_AT",
          object: normText(m[1]),
          scope: "FIRE_ALARM",
          evidenceKind: "EXPLICIT",
          authorityClass: primary ? "PRIMARY" : "SECONDARY",
          source: makeSource({ ids: line.fragmentIds, insight: t }),
          identity: { resolution: "UNIQUE", campusWide: true },
          supportingSourceAllowed: false,
        });
      }
    }
    // Campus network statement: "THE FIRE ALARM CONTROL PANEL (FACP) OF EACH
    // BUILDING SHALL BE CONNECTED TO THE CAMPUS-WIDE MAIN FIRE ALARM CONTROL
    // PANEL (MFACP) ... VIA A FIBER OPTIC CABLE".
    if (/SHALL\s+BE\s+CONNECTED\s+TO/.test(t) && /CAMPUS-WIDE\s+MAIN\s+FIRE\s+ALARM\s+CONTROL\s+PANEL\s*\(?(MFACP|M\.F\.A\.C\.P)/i.test(t) && /VIA\s+A\s+FIBER\s+OPTIC\s+CABLE/i.test(t)) {
      push({
        factType: "PANEL_NETWORK_LINK",
        subject: "BUILDING FACP (EACH BUILDING)",
        relation: "CONNECTED_TO",
        object: "CAMPUS-WIDE MFACP VIA FIBER OPTIC CABLE",
        scope: "FIRE_ALARM",
        evidenceKind: "EXPLICIT",
        authorityClass: primary ? "PRIMARY" : "SECONDARY",
        source: makeSource({ ids: line.fragmentIds, insight: t }),
        identity: { resolution: "UNIQUE", networkStatement: true },
        supportingSourceAllowed: false,
      });
    }
  }

  // -------------------------------------------------------------------------
  // FIRE_ALARM_NETWORK_TOPOLOGY -- aggregate on an explicit network-diagram
  // sheet. Only emitted when the sheet proves (a) >=2 building assignments AND
  // (b) >=1 explicit campus network link. DERIVED aggregate, never a guess.
  // -------------------------------------------------------------------------
  const buildingAreaFacts = facts.filter((f) => f.factType === "PANEL_SERVES_AREA" && f.relation === "SERVES" && f.identity?.building);
  const networkLinkFacts = facts.filter((f) => f.factType === "PANEL_NETWORK_LINK" && (f.identity?.networkStatement || /CAMPUS-WIDE/.test(f.object || "")));
  if (sheet.drawingType === "Riser Diagram" && buildingAreaFacts.length >= 2 && networkLinkFacts.length >= 1) {
    const buildings = [...new Set(buildingAreaFacts.map((f) => f.identity.building))];
    push({
      factType: "FIRE_ALARM_NETWORK_TOPOLOGY",
      subject: "CAMPUS-WIDE FIRE ALARM NETWORK",
      relation: "TOPOLOGY",
      object: `STAR: CAMPUS-WIDE MFACP + BUILDING FACPS (${buildings.join(", ")})`,
      scope: "FIRE_ALARM",
      evidenceKind: "DERIVED",
      authorityClass: "PRIMARY",
      source: makeSource({ ids: [...new Set([...buildingAreaFacts.flatMap((f) => f.source.sourceFragmentIds), ...networkLinkFacts.flatMap((f) => f.source.sourceFragmentIds)])], insight: `Network diagram assigns MFACP + ${buildings.length} building FACPs with explicit campus link` }),
      identity: { resolution: "UNIQUE", buildingCount: buildings.length },
      assignment: { deterministic: true, method: "aggregate-of-explicit-network-evidence", buildingCount: buildings.length },
      supportingSourceAllowed: false,
    });
  }

  return { facts, panelTokens, lines, seenLoops: [...seenLoops] };
};

// ---------------------------------------------------------------------------
// Cross-sheet reference extraction (reuses the governed cross-sheet module).
// ---------------------------------------------------------------------------
export const extractCrossSheetReferenceFacts = ({ sheet = {}, assets = [], documentRegistry = [] } = {}) => {
  const sourceDocument = { id: sheet.documentId, drawingNumber: sheet.drawingNumber ?? null, sheetName: sheet.sheetName ?? null };
  // The governed cross-sheet module consumes assets in its own shape
  // (text_content) -- keep its exact input contract.
  const moduleAssets = (assets || []).map((a) => ({ id: a.id, text_content: a.textContent, pageNumber: a.pageNumber ?? null }));
  const references = [];
  for (const reference of detectCrossSheetReferences({ sourceDocument, pageNumber: null, assets: moduleAssets })) {
    const pageNumber = moduleAssets.find((a) => a.id === reference.evidence?.sourceAssetId)?.pageNumber ?? null;
    references.push({ ...reference, pageNumber });
  }
  const resolved = resolveCrossSheetReferenceTargets(references, documentRegistry);
  const facts = [];
  for (const reference of resolved) {
    const multipleTargets = /multiple documents/.test(reference.applicabilitySource || "");
    facts.push({
      factType: "CROSS_SHEET_REFERENCE",
      subject: reference.sourceDrawingNumber ?? "THIS SHEET",
      relation: "REFERENCES",
      object: reference.referencedDrawingNumber,
      scope: "FIRE_ALARM",
      evidenceKind: "EXPLICIT",
      authorityClass: "PRIMARY",
      source: {
        documentId: sheet.documentId,
        documentVersionId: sheet.documentVersionId,
        intakeVersionId: sheet.intakeVersionId,
        structureVersionId: null,
        drawingNumber: sheet.drawingNumber ?? null,
        sheetName: sheet.sheetName ?? null,
        drawingType: sheet.drawingType ?? null,
        pageNumber: reference.pageNumber ?? null,
        sourceRegion: null,
        sourceFragmentIds: reference.evidence?.sourceAssetId ? [reference.evidence.sourceAssetId] : [],
        insight: reference.evidence?.noteText ?? reference.referencedDrawingNumber,
      },
      identity: { resolution: "UNIQUE" },
      resolution: {
        state: reference.status,
        referencedDrawingNumber: reference.referencedDrawingNumber,
        resolvedTargetDocumentId: reference.resolvedTargetDocumentId ?? null,
        applicableSystem: reference.applicableSystem ?? null,
        applicabilityStatus: reference.applicabilityStatus ?? "Scoped to current sheet",
        multipleTargets,
      },
      supportingSourceAllowed: true,
      factKey: "",
    });
    facts[facts.length - 1].factKey = `CROSS_SHEET_REFERENCE|${norm(facts[facts.length - 1].subject)}|REFERENCES|${norm(reference.referencedDrawingNumber)}|FIRE_ALARM`;
  }
  return { facts, references: resolved };
};

// ---------------------------------------------------------------------------
// Layout <-> legend links (deterministic token match against GOVERNED legend
// rows only -- the 20 confirmed T-00 FIRE ALARM facts from Step 14.6).
// ---------------------------------------------------------------------------
export const extractLayoutLegendFacts = ({ sheet = {}, assets = [], governedLegendRows = [] } = {}) => {
  const facts = [];
  if (!governedLegendRows.length) return { facts };
  const byAbbreviation = new Map(governedLegendRows.map((r) => [norm(r.abbreviation), r]));
  for (const asset of assets) {
    const text = trim(asset.textContent || "");
    if (!text || text.length > 12) continue;
    const row = byAbbreviation.get(norm(text));
    if (!row) continue;
    const factKey = `LAYOUT_LEGEND_LINK|${norm(text)}|MATCHES|${norm(row.description)}|FIRE_ALARM`;
    facts.push({
      factKey,
      factType: "LAYOUT_LEGEND_LINK",
      subject: normText(text),
      relation: "MATCHES_GOVERNED_LEGEND",
      object: row.description ?? "GOVERNED LEGEND ROW",
      scope: "FIRE_ALARM",
      evidenceKind: "EXPLICIT",
      authorityClass: "SECONDARY",
      source: {
        documentId: sheet.documentId,
        documentVersionId: sheet.documentVersionId,
        intakeVersionId: sheet.intakeVersionId,
        structureVersionId: null,
        drawingNumber: sheet.drawingNumber ?? null,
        sheetName: sheet.sheetName ?? null,
        drawingType: sheet.drawingType ?? null,
        pageNumber: asset.pageNumber ?? null,
        sourceRegion: asset.boundingBox ? { x: asset.boundingBox.x, y: asset.boundingBox.y, width: asset.boundingBox.width, height: asset.boundingBox.height } : null,
        sourceFragmentIds: [asset.id],
        insight: `${normText(text)} = ${row.description ?? "governed legend row"}`,
      },
      identity: { resolution: "UNIQUE", legendRowId: row.id ?? null },
      supportingSourceAllowed: true,
      factKey,
    });
  }
  // Deduplicate to one link per abbreviation per sheet.
  const seen = new Set();
  return { facts: facts.filter((f) => (seen.has(f.subject) ? false : (seen.add(f.subject), true))) };
};

// ---------------------------------------------------------------------------
// Engineering discrepancy detection (deterministic signals only).
// ---------------------------------------------------------------------------
export const detectArchitectureDiscrepancies = ({ sheet = {}, crossSheetFacts = [], panelFacts = [] } = {}) => {
  const facts = [];
  const pushDiscrepancy = (evidence, fragmentIds = [], object) => {
    facts.push({
      factType: "ARCHITECTURE_DISCREPANCY",
      subject: sheet.drawingNumber ?? "THIS SHEET",
      relation: "HAS_DISCREPANCY",
      object: object ?? "ARCHITECTURE EVIDENCE",
      scope: "FIRE_ALARM",
      evidenceKind: "EXPLICIT",
      authorityClass: "SECONDARY",
      source: {
        documentId: sheet.documentId,
        documentVersionId: sheet.documentVersionId,
        intakeVersionId: sheet.intakeVersionId,
        structureVersionId: null,
        drawingNumber: sheet.drawingNumber ?? null,
        sheetName: sheet.sheetName ?? null,
        drawingType: sheet.drawingType ?? null,
        pageNumber: null,
        sourceRegion: null,
        sourceFragmentIds: fragmentIds,
        insight: evidence,
      },
      identity: { resolution: "UNIQUE" },
      discrepancy: { type: "DETERMINISTIC_SIGNAL" },
      supportingSourceAllowed: true,
      factKey: `ARCHITECTURE_DISCREPANCY|${norm(sheet.drawingNumber || "THIS SHEET")}|HAS_DISCREPANCY|${norm(evidence.slice(0, 40))}|FIRE_ALARM`,
    });
  };

  // Unresolved cross-sheet references are real, deterministic signals that the
  // referenced sheet is missing from the register or ambiguously named.
  for (const fact of crossSheetFacts) {
    if (fact.resolution?.state !== "Resolved") {
      pushDiscrepancy(
        `Cross-sheet reference to ${fact.resolution?.referencedDrawingNumber ?? fact.object} did not resolve to exactly one registered document (${fact.resolution?.state ?? "UNKNOWN"}).`,
        fact.source?.sourceFragmentIds || [],
        fact.resolution?.referencedDrawingNumber ?? fact.object,
      );
    }
  }

  // Ambiguous panel assignments are engineer-review items, not facts.
  for (const fact of panelFacts) {
    if (fact.identity?.resolution === "AMBIGUOUS" || fact.assignment?.multipleNear) {
      pushDiscrepancy(
        `Panel assignment for ${fact.subject} on ${sheet.drawingNumber ?? "this sheet"} is ambiguous (${fact.object}).`,
        fact.source?.sourceFragmentIds || [],
        fact.subject,
      );
    }
  }

  return { facts };
};

// Cross-sheet panel identity resolution -- the SAME panel across sheets can be
// proven the same ONLY by explicit shared LOCATION evidence. Names alone never
// merge identities. Here we require (a) the same normalized panel subject AND
// (b) >=2 shared campus-location tokens between the two sheets' LOCATION
// evidence for that panel (e.g. "FIRE COMMAND CENTER" + "GROUND FLOOR" or
// "FCC" + "00-015"), which is exact shared text, not a title-similarity guess.
//
// Evidence scope is deliberately narrow: only DERIVED location assignments
// whose text names a room / FCC / fire-command marker participate. PANEL_EXISTS
// labels ("MAIN FIRE ALARM CONTROL PANEL (M.F.A.C.P)") are pure name evidence
// -- two buildings with the same panel model must NEVER "resolve" into one
// identity, so existence facts are excluded by construction.
const STOPWORDS = new Set(["THE", "AT", "OF", "A", "IS", "TO", "THIS", "AND", "IN", "FOR", "911", "ZERO", "MFACP", "FACP", "PANEL", "LOCATED", "NEAR", "NEXT", "SERVES", "VS", "SYSTEM", "FIRE", "ALARM"]);
const LOCATION_TOKENS = (text) => {
  const t = normText(text).replace(/,/g, " ");
  const parts = t.split(/[\s\-]+/).map((p) => p.trim().toUpperCase()).filter((p) => p && !STOPWORDS.has(p));
  return [...new Set(parts)];
};

// A location assignment is IDENTITY-BEARING only if it names a room / FCC /
// fire-command location (the main panel's unique home). Building "SERVES"
// pairings are service-area evidence, not identity: they can never prove two
// panels are the same panel.
const ROOM_OR_FCC_PATTERN = /ROOM|FCC|FIRE\s*COMMAND/i;
const identityBearing = (fact) =>
  fact.evidenceKind === "DERIVED" &&
  !/AMBIGUOUS/.test(fact.object || "") &&
  ROOM_OR_FCC_PATTERN.test(`${fact.source?.insight ?? ""} ${fact.object ?? ""}`);

export const resolveCrossSheetPanelIdentities = (sheets = []) => {
  // sheets: [{ documentId, drawingNumber, facts: [...] }]
  const byPanel = new Map();
  for (const sheet of sheets) {
    for (const fact of sheet.facts) {
      if (fact.factType !== "PANEL_SERVES_AREA") continue;
      if (!identityBearing(fact)) continue;
      const key = `${fact.subject}::FIRE_ALARM`;
      if (!byPanel.has(key)) byPanel.set(key, []);
      const excerpt = fact.source?.insight ?? "";
      byPanel.get(key).push({ sheet, fact, excerpt, tokens: LOCATION_TOKENS(excerpt) });
    }
  }
  const resolved = [];
  const conflicts = [];
  for (const [, group] of byPanel) {
    if (group.length < 2) continue;
    // Pairwise exact-token intersection across the group's documents.
    const seenPairs = new Set();
    const pairByDocuments = new Map();
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        if (a.sheet.documentId === b.sheet.documentId) continue;
        const shared = a.tokens.filter((t) => b.tokens.includes(t));
        if (shared.length >= 2) {
          const pairKey = [a.sheet.documentId, b.sheet.documentId].sort().join("|");
          if (seenPairs.has(pairKey)) continue;
          seenPairs.add(pairKey);
          const identityEvidence = {
            resolved: true,
            method: "EXACT_SHARED_LOCATION_TOKENS",
            sharedTokens: shared,
            acrossSheets: [...new Set([a.sheet.drawingNumber ?? "unknown", b.sheet.drawingNumber ?? "unknown"])],
            acrossDocuments: [...new Set([a.sheet.documentId, b.sheet.documentId])],
            evidence: [a.excerpt, b.excerpt],
          };
          a.fact.crossSheetIdentity = identityEvidence;
          b.fact.crossSheetIdentity = identityEvidence;
          pairByDocuments.set(pairKey, { a, b });
          resolved.push({ subject: a.fact.subject, sharedTokens: shared, acrossSheets: identityEvidence.acrossSheets });
        }
      }
    }
    // A resolved identity is CONTRADICTED when the same proven panel is located
    // at two different named places (e.g. FCC ROOM 00-015 vs another room).
    // That is a deterministic engineering signal, never a guess: both facts
    // stay as location evidence, a conflict record is raised for review.
    for (const { a, b } of pairByDocuments.values()) {
      const ao = norm(a.fact.object ?? "");
      const bo = norm(b.fact.object ?? "");
      if (ao && bo && ao !== bo) {
        conflicts.push({
          subject: a.fact.subject,
          objects: [a.fact.object, b.fact.object],
          acrossSheets: [...new Set([a.sheet.drawingNumber ?? "unknown", b.sheet.drawingNumber ?? "unknown"])],
          acrossDocuments: [...new Set([a.sheet.documentId, b.sheet.documentId])],
          sharedTokens: a.fact.crossSheetIdentity?.sharedTokens ?? [],
        });
      }
    }
  }
  return { resolved, conflicts };
};

// Discrepancy fact raised for a cross-sheet panel-location conflict. Owned by
// the SECOND sheet in the pair so it is reviewed as part of that sheet's
// intake evidence (the case is project-scoped regardless).
export const crossSheetConflictDiscrepancyFact = (sheet, conflict) => ({
  factType: "ARCHITECTURE_DISCREPANCY",
  subject: sheet.drawingNumber ?? "THIS SHEET",
  relation: "HAS_DISCREPANCY",
  object: `CONFLICTING PANEL LOCATION (${conflict.objects[0]} vs ${conflict.objects[1]})`,
  scope: "FIRE_ALARM",
  evidenceKind: "EXPLICIT",
  authorityClass: "SECONDARY",
  source: {
    documentId: sheet.documentId,
    documentVersionId: sheet.documentVersionId,
    intakeVersionId: sheet.intakeVersionId,
    structureVersionId: null,
    drawingNumber: sheet.drawingNumber ?? null,
    sheetName: sheet.sheetName ?? null,
    drawingType: sheet.drawingType ?? null,
    pageNumber: null,
    sourceRegion: null,
    sourceFragmentIds: [],
    insight: `Cross-sheet identity (${conflict.subject}) resolves via shared tokens [${conflict.sharedTokens.join(", ")}] but is located at conflicting places on ${conflict.acrossSheets.join(" and ")}.`,
  },
  identity: { resolution: "UNIQUE" },
  discrepancy: { type: "CROSS_SHEET_PANEL_LOCATION_CONFLICT" },
  supportingSourceAllowed: true,
  factKey: `ARCHITECTURE_DISCREPANCY|${norm(sheet.drawingNumber || "THIS SHEET")}|HAS_DISCREPANCY|CONFLICTINGPANELLOCATION|FIRE_ALARM`,
});

// ---------------------------------------------------------------------------
// Sheet-level fingerprint (staleness anchor for all cases created from this
// sheet's current evidence). Includes every source fragment id + every fact
// key + insight excerpt so ANY evidence change re-fingerprints the sheet.
// ---------------------------------------------------------------------------
export const sheetEvidenceFingerprint = ({ sheet = {}, facts = [] } = {}) =>
  sha256hex({
    intakeVersionId: sheet.intakeVersionId,
    drawingNumber: sheet.drawingNumber ?? null,
    drawingType: sheet.drawingType ?? null,
    facts: facts.map((f) => [f.factKey, f.evidenceKind, (f.source?.sourceFragmentIds || []).slice().sort(), f.source?.insight]),
  });