// GENERAL DRAWING EXTRACTION ENGINE v0.
//
// Consumes the SAME Drawing Intake text assets every other Visual Review
// evidence source already reads (see drawing-overlay-view-model.mjs) -- no
// new evidence source, no schema change, no new authoritative record. It
// looks for one specific, common room/detail-drawing pattern: a numbered
// equipment schedule (a repeating "<number>  <description>" list, e.g. a
// legend of FCC/ELV room equipment) plus standalone numbered callouts
// elsewhere on the same sheet that reference a schedule row by number.
//
// DETECTED != INTERPRETED != APPROVED. Every output here is a proposal --
// nothing is ever auto-approved, and nothing here is persisted as an
// authoritative engineering object.
//
// CRITICAL, deliberate omission: this module contains NO code path that
// infers system/electrical/network/control connectivity from geometry,
// text proximity, or any other signal. It does not consume or produce line/
// leader VECTOR geometry at all -- Drawing Intake does not currently
// extract vector paths, only text -- so "leader geometry" evidence fields
// below are populated only when explicitly available (never fabricated) and
// a SystemConnectionCandidate proposal type is simply never emitted by this
// engine. A prior spatial-clustering pass over this same kind of drawing
// mistook room/furniture/leader/symbol geometry sharing edges for a single
// connected electrical system (a false topology). This engine does not
// repeat that: geometric or textual adjacency here only ever produces a
// CALLOUT -> SCHEDULE ROW reference, never a system connection.
//
// Nothing here is specific to any one drawing, document, or project -- the
// numbered-list pattern detector below is generic (works on relative
// spacing/alignment of the text it is given), and the FCC ROOM DETAILS
// drawing used to validate it during development is a fixture, not a
// hardcoded input.
//
// GOVERNANCE (AI_Pre_Sales_Drawing_Interpretation_Rules.docx): every
// proposal below carries authorityRole/governedStatus/hardReviewReasons
// from evaluateDrawingEvidenceAuthority() (drawing-evidence-authority-
// policy.mjs) -- confidence is kept only as an informational secondary
// metric, never the approval gate. A CalloutReference or an alias-based
// EquipmentCandidate/PanelCandidate can NEVER reach "Verified": placement
// inferred from a callout number's text position has no legend/tag/riser
// corroboration (Rule C), and an alias match (e.g. "FACP" near "MFACP") is
// a Potential Alias, never an automatic identity merge (Rule D) -- both are
// forced to "Needs Review" via an explicit hard-review trigger, not left to
// fall out of a confidence threshold.

import { evaluateDrawingEvidenceAuthority } from "./drawing-evidence-authority-policy.mjs";

const trim = (value) => String(value ?? "").trim();

const isBareInteger = (text) => /^\d{1,3}$/.test(trim(text));

const isShortAcronymToken = (text) => /^[A-Z]{2,8}$/.test(trim(text));

const STOPWORDS = new Set(["AND", "OF", "THE", "FOR", "WITH", "A", "AN", "TO", "IN", "ON"]);

// "MAIN FIRE ALARM CONTROL PANEL (MFACP)" -> "MFACP". A description may
// carry its own explicit acronym in parentheses -- the strongest possible
// alias signal, since the drawing's author wrote it themselves.
const parentheticalAcronyms = (description) =>
  [...trim(description).matchAll(/\(([A-Z0-9]{2,8})\)/g)].map((match) => match[1]);

// "FIRE ALARM WORK STATION" -> "FAWS". A generic fallback alias signal when
// no explicit parenthetical acronym exists: the initials of the
// description's significant (non-stopword) words.
const initialsOf = (description) => {
  const words = trim(description)
    .replace(/\([^)]*\)/g, " ")
    .split(/[^A-Za-z]+/)
    .filter(Boolean)
    .map((word) => word.toUpperCase())
    .filter((word) => !STOPWORDS.has(word));
  return words.map((word) => word[0]).join("");
};

const CATEGORY_RULES = [
  { category: "Panel", pattern: /\bPANEL\b/i },
  { category: "Workstation", pattern: /\bWORK\s*STATION\b|\bGUI\b/i },
  { category: "Telephone", pattern: /\bTELEPHONE\b|\bPHONE\b/i },
  { category: "Printer", pattern: /\bPRINTER\b/i },
  { category: "Furniture", pattern: /\bTABLE\b|\bDESK\b|\bCHAIR\b/i },
  { category: "Interface", pattern: /\bINTERFACE\b|\bPORT\b/i },
  { category: "Indicator", pattern: /\bINDICATOR\b|\bDISPLAY\b/i },
];

const classifyCategory = (description) => {
  const match = CATEGORY_RULES.find(({ pattern }) => pattern.test(description));
  return match ? match.category : "Unknown";
};

// Standard, drawing-agnostic AEC title-block field labels (ISO/BS title
// block convention) -- not specific to any one project's sheet. A bare
// integer sitting immediately to the right of one of these labels, on the
// same row, is a title-block FIELD VALUE (a phase number, a scale ratio, a
// revision index, a drawn/checked initial count), not a callout -- a bare
// numeric match against a schedule row number is not, by itself, enough to
// treat it as a callout (WORKSTREAM 1: false-positive reduction).
export const TITLE_BLOCK_LABELS = [
  "STAGE",
  "SCALE",
  "PHASE",
  "REVISION",
  "REV",
  "DATE",
  "SHEET",
  "DRAWN",
  "CHECKED",
  "APPROVED",
  "PROJECT NUMBER",
  "PROJECT TITLE",
  "DRAWING NUMBER",
  "CLIENT",
  "BUILDING ASSET CODE",
  "SOURCE FILE",
  "NO",
  "DESCRIPTION",
];

export const isTitleBlockLabelAdjacent = (numberAsset, pageAssets) => {
  const rowHeight = Math.max(numberAsset.boundingBox.height, 4);
  return pageAssets.some((candidate) => {
    if (candidate === numberAsset) return false;
    const label = trim(candidate.text_content).toUpperCase();
    if (!TITLE_BLOCK_LABELS.includes(label)) return false;
    const yGap = Math.abs(candidate.boundingBox.y - numberAsset.boundingBox.y);
    if (yGap > rowHeight * 3) return false; // same row, allowing for label/value baseline offset
    const xGap = Math.abs(candidate.boundingBox.x - numberAsset.boundingBox.x);
    return xGap <= rowHeight * 40; // label and its value share a title-block cell/column
  });
};

const unionBox = (a, b) => {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.width, b.x + b.width);
  const y1 = Math.max(a.y + a.height, b.y + b.height);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0, pageWidth: a.pageWidth, pageHeight: a.pageHeight };
};

const normalizeLabel = (text) => trim(text).toUpperCase().replace(/\s+/g, " ");

// A number token B is a plausible schedule-row LABEL for description token
// D when they sit on (approximately) the same text baseline and D starts a
// short distance to the right of B -- the generic "number, then its label"
// reading-order layout used by list-style schedules regardless of the exact
// column positions a particular drawing happens to use.
const isRowPair = (numberAsset, candidateAsset) => {
  const rowHeight = Math.max(numberAsset.boundingBox.height, candidateAsset.boundingBox.height);
  const yGap = Math.abs(numberAsset.boundingBox.y - candidateAsset.boundingBox.y);
  if (yGap > rowHeight * 0.75) return false;
  const xGap = candidateAsset.boundingBox.x - (numberAsset.boundingBox.x + numberAsset.boundingBox.width);
  return xGap >= 0 && xGap <= rowHeight * 20;
};

// Finds every "<number> <description>" pair on a page, then keeps only the
// pairs that belong to a genuine repeating COLUMN (>= 3 rows sharing an
// aligned number-column x and an aligned description-column x) -- this is
// what distinguishes a real numbered schedule/legend list from an
// incidental single number-then-text adjacency elsewhere on the sheet.
const detectScheduleColumns = (pageAssets) => {
  const numberAssets = pageAssets.filter((asset) => isBareInteger(asset.text_content));
  const pairs = [];
  for (const numberAsset of numberAssets) {
    let best = null;
    let bestGap = Infinity;
    for (const candidate of pageAssets) {
      if (candidate === numberAsset) continue;
      if (!isRowPair(numberAsset, candidate)) continue;
      const gap = candidate.boundingBox.x - numberAsset.boundingBox.x;
      if (gap < bestGap) {
        bestGap = gap;
        best = candidate;
      }
    }
    if (best) pairs.push({ numberAsset, descriptionAsset: best });
  }

  const columnTolerance = (asset) => Math.max(asset.boundingBox.height, 4) * 3;
  const columns = [];
  for (const pair of pairs) {
    let column = columns.find(
      (candidateColumn) =>
        Math.abs(candidateColumn.numberX - pair.numberAsset.boundingBox.x) <= columnTolerance(pair.numberAsset) &&
        Math.abs(candidateColumn.descriptionX - pair.descriptionAsset.boundingBox.x) <= columnTolerance(pair.descriptionAsset),
    );
    if (!column) {
      column = { numberX: pair.numberAsset.boundingBox.x, descriptionX: pair.descriptionAsset.boundingBox.x, pairs: [] };
      columns.push(column);
    }
    column.pairs.push(pair);
  }
  return columns.filter((column) => column.pairs.length >= 3);
};

// EquipmentScheduleItem[] plus the set of asset ids "consumed" by the
// schedule column(s), so callout detection below never mistakes a
// schedule's own row numbers for a standalone callout elsewhere on the page.
const buildEquipmentScheduleItems = (pageNumber, columns, documentContext) => {
  const items = [];
  const unresolved = [];
  const consumedAssetIds = new Set();
  const seenNumbers = new Map();

  for (const column of columns) {
    for (const { numberAsset, descriptionAsset } of column.pairs) {
      const itemNumber = Number(trim(numberAsset.text_content));
      consumedAssetIds.add(numberAsset.id);
      consumedAssetIds.add(descriptionAsset.id);
      const existing = seenNumbers.get(itemNumber);
      if (existing) {
        // The same row number appearing twice within a qualifying column is
        // genuinely ambiguous -- keep neither as a confirmed row, surface
        // both as unresolved rather than silently picking one.
        existing.ambiguous = true;
        unresolved.push({
          proposalType: "UnknownEngineeringObject",
          pageNumber,
          reason: `Row number ${itemNumber} appears more than once in a detected schedule column`,
          boundingBox: descriptionAsset.bounding_box,
          sourceEntity: { kind: "drawing-asset", id: descriptionAsset.id },
        });
        continue;
      }
      const description = trim(descriptionAsset.text_content);
      // The extraction engine has independently confirmed (via the
      // repeated-column pattern, not the whole-document classifier) that
      // THIS bounding region is functioning as an equipment schedule --
      // Rule A's authority table is about the source that actually
      // produced the fact, so drawingType:"Schedule" reflects the region,
      // not necessarily the document's own (often noisier, whole-sheet)
      // classification.
      const authority = evaluateDrawingEvidenceAuthority({
        fieldType: "DeviceIdentity",
        drawingType: "Schedule",
        sourceType: "Drawing",
        revisionState: documentContext?.revisionState ?? null,
      });
      const item = {
        proposalType: "EquipmentScheduleItem",
        pageNumber,
        itemNumber,
        description,
        normalizedLabel: normalizeLabel(description),
        category: classifyCategory(description),
        aliases: parentheticalAcronyms(description),
        boundingBox: unionBox(numberAsset.boundingBox, descriptionAsset.boundingBox),
        sourceText: `${trim(numberAsset.text_content)} ${description}`,
        confidence: 80,
        authorityRole: authority.authorityRole,
        governedStatus: authority.finalStatus,
        hardReviewReasons: authority.hardReviewReasons,
        reviewStatus: authority.finalStatus,
        extractionMethod: "Numbered schedule list pattern (repeated number+description column)",
        evidence: {
          numberBoundingBox: numberAsset.boundingBox,
          descriptionBoundingBox: descriptionAsset.boundingBox,
        },
        sourceReferences: [numberAsset.id, descriptionAsset.id],
      };
      seenNumbers.set(itemNumber, item);
      items.push(item);
    }
  }
  return { items: items.filter((item) => !item.ambiguous), unresolved, consumedAssetIds };
};

// Standalone numbered tokens elsewhere on the page (i.e. not part of any
// detected schedule column) whose value matches a known schedule row number
// -- the callout/leader-number convention this drawing type uses to
// reference the schedule from elsewhere on the sheet.
const buildCalloutReferences = (pageNumber, pageAssets, scheduleItems, consumedAssetIds, documentContext) => {
  const byNumber = new Map(scheduleItems.map((item) => [item.itemNumber, item]));
  const callouts = [];
  const excluded = [];
  for (const asset of pageAssets) {
    if (!isBareInteger(asset.text_content)) continue;
    if (consumedAssetIds.has(asset.id)) continue;
    const reference = Number(trim(asset.text_content));
    const matched = byNumber.get(reference);
    if (!matched) continue;
    // WORKSTREAM 1: a bare integer matching a schedule row number is NOT,
    // by itself, sufficient to be treated as a callout -- a number sitting
    // in a recognized title-block field cell (a phase/scale/revision/date
    // value) is structurally metadata, not a callout, and is excluded
    // outright rather than surfaced as a low-confidence guess.
    if (isTitleBlockLabelAdjacent(asset, pageAssets)) {
      excluded.push({ assetId: asset.id, reference, reason: "Adjacent to a recognized title-block field label" });
      continue;
    }
    callouts.push({
      proposalType: "CalloutReference",
      pageNumber,
      reference,
      matchedScheduleItem: {
        itemNumber: matched.itemNumber,
        description: matched.description,
        boundingBox: matched.boundingBox,
      },
      boundingBox: asset.bounding_box,
      confidence: 60,
      extractionMethod: "Standalone number matched against detected equipment schedule",
      evidence: {
        numberBoundingBox: asset.bounding_box,
        scheduleRowBoundingBox: matched.boundingBox,
        leaderGeometry: null,
      },
      sourceReferences: [asset.id, ...matched.sourceReferences],
    });
  }

  // Two or more standalone occurrences of the SAME reference number on one
  // page is itself a real signal, not something to silently pick a winner
  // from: it may be a genuine callout repeated at multiple points in the
  // room, or it may be an unrelated numeric coincidence elsewhere on the
  // sheet. Surface every occurrence, but at reduced confidence and with the
  // ambiguity named explicitly, rather than presenting duplicates as
  // equally certain.
  const occurrencesByReference = new Map();
  for (const callout of callouts) {
    occurrencesByReference.set(callout.reference, (occurrencesByReference.get(callout.reference) || 0) + 1);
  }
  for (const callout of callouts) {
    const occurrences = occurrencesByReference.get(callout.reference);
    const corroboratingEvidence = [];
    if (occurrences > 1) {
      callout.confidence = Math.round(callout.confidence * 0.6);
      callout.evidence.ambiguityNote = `${occurrences} standalone occurrences of "${callout.reference}" found on this page; not all may be real callouts to this schedule row.`;
    } else {
      // A single, unambiguous occurrence is itself a (weak) corroborating
      // signal -- still not enough alone to reach Verified (Rule C: a
      // callout/leader number is not legend-defined, tag-matched, or
      // riser-corroborated placement evidence), but distinguishes a clean
      // single match from a genuinely ambiguous multi-occurrence one in the
      // reasons text.
      corroboratingEvidence.push("single unambiguous standalone number match");
    }
    // A callout is placement-context evidence (Rule A: DevicePlacement's
    // authoritative sources are Layout/Enlarged-plan drawings, verified
    // against a legend-defined convention) -- this sheet defines no legend
    // entry for "circled number = schedule reference", so it can only ever
    // be Verification-role at best, and Rule C requires corroboration
    // beyond geometry/text-proximity to escape Needs Review.
    const authority = evaluateDrawingEvidenceAuthority({
      fieldType: "DevicePlacement",
      drawingType: "Floor Plan",
      sourceType: "Drawing",
      corroboratingEvidence,
      applicableLegend: { defined: false },
      revisionState: documentContext?.revisionState ?? null,
    });
    callout.authorityRole = authority.authorityRole;
    callout.governedStatus = authority.finalStatus;
    callout.hardReviewReasons = authority.hardReviewReasons;
    callout.reviewStatus = authority.finalStatus;
  }
  return { callouts, excluded };
};

// Short all-caps tokens elsewhere on the sheet that read as an acronym/alias
// of a schedule item's description (an explicit "(MFACP)"-style acronym, a
// suffix/prefix variant of one such as "FACP" for "MFACP", or a match
// against the description's own word-initials) -- surfaced as an
// EquipmentCandidate (or PanelCandidate when the matched row is itself
// panel-category) rather than folded silently into the schedule row.
//
// WORKSTREAM 4 (identity safety): "FACP" and "MFACP" (or any two labels
// that merely look similar) are NEVER treated as the same equipment
// instance here. This function produces a POTENTIAL ALIAS observation --
// it keeps rawLabel (exactly as it appears in this location) and the
// matched schedule item's own raw description SEPARATE, sets
// identityStatus to "Potential Alias" (never "Same Instance"/"Merged"),
// and never writes a canonicalType that unifies the two. Prefix
// differences matter (Rule D: FACP/MFACP/RFACP "may indicate different
// roles") -- a suffix/initials match is exactly the kind of similarity the
// rulebook says must NOT auto-merge, so it is always forced to Needs
// Review via ALIAS_MERGE_WITHOUT_MATCH, regardless of authority role.
const buildEquipmentCandidates = (pageNumber, pageAssets, scheduleItems, consumedAssetIds, documentContext) => {
  const candidates = [];
  for (const asset of pageAssets) {
    const text = trim(asset.text_content);
    if (!isShortAcronymToken(text) || consumedAssetIds.has(asset.id)) continue;
    let bestMatch = null;
    let bestConfidence = 0;
    let bestMatchBasis = null;
    for (const item of scheduleItems) {
      let confidence = 0;
      let matchBasis = null;
      if (item.aliases.includes(text)) {
        confidence = 85;
        matchBasis = "Exact match to the description's own parenthetical acronym";
      } else if (item.aliases.some((alias) => alias.endsWith(text) || text.endsWith(alias))) {
        confidence = 65;
        matchBasis = "Partial/suffix match against the description's parenthetical acronym";
      } else if (initialsOf(item.description) === text) {
        confidence = 55;
        matchBasis = "Matches the initials of the description's significant words";
      }
      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestMatch = item;
        bestMatchBasis = matchBasis;
      }
    }
    if (!bestMatch) continue;
    const authority = evaluateDrawingEvidenceAuthority({
      fieldType: "DeviceIdentity",
      drawingType: "Schedule",
      sourceType: "Drawing",
      // Name/acronym similarity alone is never sufficient identity
      // evidence -- this trigger is unconditional for every alias
      // candidate this function produces, not just the FCC fixture.
      hardReviewTriggers: ["ALIAS_MERGE_WITHOUT_MATCH"],
      revisionState: documentContext?.revisionState ?? null,
    });
    candidates.push({
      proposalType: bestMatch.category === "Panel" ? "PanelCandidate" : "EquipmentCandidate",
      pageNumber,
      rawLabel: text,
      alias: text,
      canonicalType: null, // deliberately never unified with the matched item's type -- see header comment
      identityStatus: "Potential Alias",
      matchBasis: bestMatchBasis,
      potentialMatch: {
        itemNumber: bestMatch.itemNumber,
        rawLabel: bestMatch.description,
        boundingBox: bestMatch.boundingBox,
      },
      // Deprecated, kept for the existing overlay/inspector's current
      // rendering (label/matchedScheduleItem) -- callers should prefer
      // rawLabel/potentialMatch, which do not read as an identity claim.
      label: bestMatch.description,
      matchedScheduleItem: {
        itemNumber: bestMatch.itemNumber,
        description: bestMatch.description,
        boundingBox: bestMatch.boundingBox,
      },
      boundingBox: asset.bounding_box,
      confidence: bestConfidence,
      authorityRole: authority.authorityRole,
      governedStatus: authority.finalStatus,
      hardReviewReasons: authority.hardReviewReasons,
      reviewStatus: authority.finalStatus,
      extractionMethod: "Standalone acronym matched against equipment schedule alias/initials",
      evidence: { aliasBoundingBox: asset.bounding_box, scheduleRowBoundingBox: bestMatch.boundingBox },
      sourceReferences: [asset.id, ...bestMatch.sourceReferences],
    });
  }
  return candidates;
};

const buildScheduleRegionCandidates = (pageNumber, columns, documentContext) =>
  columns.map((column, index) => {
    const boxes = column.pairs.map(({ numberAsset, descriptionAsset }) => unionBox(numberAsset.boundingBox, descriptionAsset.boundingBox));
    const boundingBox = boxes.reduce((acc, box) => (acc ? unionBox(acc, box) : box), null);
    const authority = evaluateDrawingEvidenceAuthority({
      fieldType: "DeviceIdentity",
      drawingType: "Schedule",
      sourceType: "Drawing",
      revisionState: documentContext?.revisionState ?? null,
    });
    return {
      proposalType: "RegionCandidate",
      pageNumber,
      regionKind: "Equipment Schedule List",
      rowCount: column.pairs.length,
      boundingBox,
      confidence: 75,
      authorityRole: authority.authorityRole,
      governedStatus: authority.finalStatus,
      hardReviewReasons: authority.hardReviewReasons,
      reviewStatus: authority.finalStatus,
      extractionMethod: "Envelope of a detected numbered schedule column",
      evidence: {},
      sourceReferences: column.pairs.flatMap(({ numberAsset, descriptionAsset }) => [numberAsset.id, descriptionAsset.id]),
      id: `schedule-region:${pageNumber}:${index}`,
    };
  });

const pageNumberById = (pages) => new Map((pages || []).map((page) => [page.id, page.page_number]));

// Top-level orchestrator. assets: raw drawing_assets rows (bounding_box
// already parsed to an object, as worker/drawing-intake-api.mjs already
// hydrates them). pages: drawing_pages rows (for the page_id -> page_number
// lookup every asset needs, same convention as drawing-overlay-view-model).
// documentContext (optional): { revisionState } -- revisionState is the
// same shape drawing-authority-policy.mjs's evaluateDrawingAuthority()
// returns (or simply { isLatestValid }); passed straight through to every
// evaluateDrawingEvidenceAuthority() call below so a caller that knows the
// document's real revision/issue status can have it enforced. Omitting it
// is safe -- revisionState is treated as unknown/neutral, never assumed
// valid.
export const buildGeneralDrawingExtractionProposals = ({ pages = [], assets = [], documentContext = null } = {}) => {
  const pageNumbers = pageNumberById(pages);
  const byPage = new Map();
  for (const asset of assets || []) {
    if (!asset.bounding_box || !asset.coordinates_available) continue;
    // Drawing Intake's own asset_type vocabulary already distinguishes
    // individual, atomically-positioned text runs ("Text") from composite
    // aggregate captures ("Title Block", "Legend", "Schedule"/"Table") that
    // bundle many lines into one synthetic (often page-spanning, sometimes
    // absent) bounding box -- see drawing-intake-engine.mjs. Only "Text"
    // assets have the per-item geometry a row-by-row list detector needs;
    // an aggregate blob's own giant bounding box would otherwise win false
    // "closest" pairings against real row numbers.
    if (asset.asset_type !== "Text") continue;
    if (!isBareInteger(asset.text_content) && !trim(asset.text_content)) continue;
    const pageNumber = pageNumbers.get(asset.page_id);
    if (pageNumber === undefined || pageNumber === null) continue;
    const withBox = { ...asset, boundingBox: asset.bounding_box };
    if (!byPage.has(pageNumber)) byPage.set(pageNumber, []);
    byPage.get(pageNumber).push(withBox);
  }

  const scheduleItems = [];
  const callouts = [];
  const equipmentCandidates = [];
  const regionCandidates = [];
  const unresolved = [];
  const excludedCallouts = [];

  for (const [pageNumber, pageAssets] of byPage) {
    const columns = detectScheduleColumns(pageAssets);
    const built = buildEquipmentScheduleItems(pageNumber, columns, documentContext);
    scheduleItems.push(...built.items);
    unresolved.push(...built.unresolved);
    const calloutResult = buildCalloutReferences(pageNumber, pageAssets, built.items, built.consumedAssetIds, documentContext);
    callouts.push(...calloutResult.callouts);
    excludedCallouts.push(...calloutResult.excluded.map((entry) => ({ ...entry, pageNumber })));
    equipmentCandidates.push(...buildEquipmentCandidates(pageNumber, pageAssets, built.items, built.consumedAssetIds, documentContext));
    regionCandidates.push(...buildScheduleRegionCandidates(pageNumber, columns, documentContext));
  }

  return { scheduleItems, callouts, equipmentCandidates, regionCandidates, unresolved, excludedCallouts };
};
