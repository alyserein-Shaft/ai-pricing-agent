// GOVERNED TITLE-BLOCK METADATA -- deterministic drawing-number extraction.
//
// Why this exists: cross-sheet references on a drawing read "REFER DWG NO.
// <number>". Resolving one to a target document requires a GOVERNED drawing
// number for that target. Until now nothing persisted the number, so every
// cross-sheet reference was unresolvable and no symbol identity could become
// governable outside its own legend sheet.
//
// EVIDENCE RULES (deliberately strict):
//   * The value must come from the drawing's OWN text layer, next to an explicit
//     title-block drawing-number label.
//   * A filename is NEVER authority. It is not an input to this module at all,
//     so it cannot leak in through a caller.
//   * Label and value must be geometrically adjacent (same visual row), and both
//     asset ids are returned so the persisted row keeps exact provenance.
//   * No label, no adjacency, or an ambiguous value => NOT_PROVEN. Never a guess.

export const DRAWING_NUMBER_LABELS = Object.freeze([
  /\bDWG\s*NO\.?\b/i,
  /\bDWG\s*NUMBER\b/i,
  /\bDRAWING\s*(?:NO\.?|NUMBER)\b/i,
  /\bSHEET\s*NO\.?\b/i,
]);

// Same-row tolerance in PDF units. Title-block label and value are printed on
// one line; a value on a different line is a different field.
export const DRAWING_NUMBER_ROW_TOLERANCE = 6;
export const DRAWING_NUMBER_MAX_GAP = 260;

// A drawing number is a structured alphanumeric token, not prose.
const VALUE_PATTERN = /^[A-Z0-9][A-Z0-9./-]{3,}$/;

// A "DWG NO." inside a general note names ANOTHER sheet, not this one. Reading
// it as this sheet's own number is the single most dangerous failure mode here:
// every cross-sheet reference in a project would then stamp the referenced
// document's number onto the referencing sheet. A reference verb earlier in the
// same run disqualifies the value.
const REFERENCE_VERB = /\b(REFER|REF\.?|SEE|SUBMITTED|ACCORDING\s+TO)\b/i;

const centerY = (box) => box.y + box.height / 2;

const labelMatches = (text) => DRAWING_NUMBER_LABELS.some((pattern) => pattern.test(text));

const isCrossSheetReference = (text) => {
  const raw = String(text || "");
  const match = REFERENCE_VERB.exec(raw);
  if (!match) return false;
  // The verb must appear BEFORE the drawing-number label.
  const labelAt = raw.search(/\b(?:DWG\s*NO\.?|DWG\s*NUMBER|DRAWING\s*(?:NO\.?|NUMBER)|SHEET\s*NO\.?)\b/i);
  return labelAt === -1 || labelAt > match.index;
};

// Some sheets extract the reference sentence and its "DWG NO." label as two
// consecutive runs with NO geometry at all. Text-run adjacency is then the only
// available evidence, and it is honest evidence: a bare "DWG NO. <number>" run
// immediately after a sentence ending in a reference verb is a reference.
const referenceRunPrecedes = (index, rows) => {
  for (let back = 1; back <= 2 && index - back >= 0; back += 1) {
    const previous = rows[index - back];
    if (!previous || typeof previous.text_content !== "string") continue;
    if (labelMatches(previous.text_content)) return false;
    if (REFERENCE_VERB.test(previous.text_content)) return true;
  }
  return false;
};

// The verb and the label are frequently split across two extracted runs --
// "... GENERAL NOTES & ABBREVIATIONS REFER" then "DWG NO. 2401232-..." on the
// next line, same column. A per-asset test cannot see that, so the nearest line
// directly above the label is inspected with the same column/geometry discipline
// used for label/value adjacency.
const REFERENCE_LINE_GAP = 40;

const continuesReferenceSentence = (asset, rows) => {
  let box = null;
  // JSON.parse(null) yields null rather than throwing, so a bbox-less row must be
  // rejected explicitly instead of dereferenced.
  try { box = JSON.parse(asset.bounding_box ?? "null"); } catch { return false; }
  if (!box || !Number.isFinite(box.y)) return false;
  return rows.some((other) => {
    if (other.id === asset.id || !other.text_content) return false;
    let otherBox = null;
    try { otherBox = JSON.parse(other.bounding_box ?? "null"); } catch { return false; }
    if (!otherBox || !Number.isFinite(otherBox.y)) return false;
    const gap = box.y - (otherBox.y + otherBox.height);
    if (gap < 0 || gap > REFERENCE_LINE_GAP) return false;
    // Column alignment is tested on the LEFT EDGE, not the centre: the reference
    // sentence is far wider than the "DWG NO." label below it, so comparing
    // centres misses real sheets by tens of units.
    if (Math.abs(otherBox.x - box.x) > 40) return false;
    return REFERENCE_VERB.test(other.text_content);
  });
};

/**
 * Extract the governed drawing number from persisted text assets of ONE page.
 * Pure: no DB, no fetch, no filename, no project state.
 *
 * Returns { ok:true, drawingNumber, pageNumber, boundingBox, sourceAssetIds,
 * extractionMethod, confidence } or { ok:false, reason }.
 */
export function extractGovernedDrawingNumber({ assets = [], pageNumber = null } = {}) {
  // Geometry is required only by the same-row adjacency branch below. Sheets
  // that flatten their title block often emit label runs with no bbox at all, and
  // dropping those rows would hide a perfectly legible drawing number.
  const rows = (assets || []).filter((asset) => asset && typeof asset.text_content === "string");

  const labels = rows
    .map((asset, index) => ({ asset, index }))
    .filter(({ asset, index }) => labelMatches(asset.text_content || "")
      && !isCrossSheetReference(asset.text_content)
      && !continuesReferenceSentence(asset, rows)
      && !referenceRunPrecedes(index, rows))
    .map(({ asset }) => asset);
  if (!labels.length) {
    const sawReference = rows.some((asset) => labelMatches(asset.text_content || "")
      && (isCrossSheetReference(asset.text_content) || continuesReferenceSentence(asset, rows)));
    return { ok: false, reason: sawReference ? "ONLY_CROSS_SHEET_REFERENCE_NUMBER" : "NO_DRAWING_NUMBER_LABEL" };
  }

  // Composite fallback PER LABEL ASSET: a flattened title block carries its own
  // label list plus every value in one run. The asset-level reference guards
  // above already removed reference-continued assets, so this cannot resurrect
  // "REFER DWG NO. <other sheet>".
  for (const label of labels) {
    const composite = extractDrawingNumberFromCompositeText(label.text_content || "");
    if (composite.ok) return { ...composite, pageNumber, sourceAssetIds: [label.id].filter(Boolean) };
  }

  const candidates = [];
  for (const label of labels) {
    const labelText = String(label.text_content || "").trim();
    let box = null;
    try { box = JSON.parse(label.bounding_box ?? "null"); } catch { continue; }
    if (!box || !Number.isFinite(box.y)) continue;
    const labelY = centerY(box);

    // Case 1: label and value share one text run ("DWG NO. 2401232-...").
    const inline = labelText.replace(/^.*?\b(?:NO\.?|NUMBER)\b[.:]?\s*/i, "").trim();
    if (inline && VALUE_PATTERN.test(inline)) {
      candidates.push({ drawingNumber: inline.toUpperCase(), asset: label, box, method: "TITLE_BLOCK_LABEL_INLINE" });
      continue;
    }

    // Case 2: the value is the nearest token on the same visual row.
    for (const value of rows) {
      if (value.id === label.id) continue;
      let valueBox = null;
      try { valueBox = JSON.parse(value.bounding_box ?? "null"); } catch { continue; }
      if (!valueBox || !Number.isFinite(valueBox.y)) continue;
      if (Math.abs(centerY(valueBox) - labelY) > DRAWING_NUMBER_ROW_TOLERANCE) continue;
      const gap = valueBox.x - (box.x + box.width);
      if (gap < 0 || gap > DRAWING_NUMBER_MAX_GAP) continue;
      const text = String(value.text_content || "").trim().toUpperCase();
      if (!VALUE_PATTERN.test(text)) continue;
      if (isCrossSheetReference(value.text_content) || continuesReferenceSentence(value, rows)) continue;
      candidates.push({ drawingNumber: text, asset: value, box: valueBox, method: "TITLE_BLOCK_LABEL_ADJACENT" });
    }
  }

  if (!candidates.length) return { ok: false, reason: "NO_DRAWING_NUMBER_VALUE" };

  // Distinct values on one sheet are a conflict, not a preference: two different
  // drawing numbers means the title block was read ambiguously, and guessing one
  // of them would fabricate the key that cross-sheet resolution depends on.
  const distinct = [...new Set(candidates.map((candidate) => candidate.drawingNumber))];
  if (distinct.length > 1) return { ok: false, reason: "AMBIGUOUS_DRAWING_NUMBER", values: distinct };

  const chosen = candidates.find((candidate) => candidate.drawingNumber === distinct[0]);
  return {
    ok: true,
    drawingNumber: distinct[0],
    pageNumber,
    boundingBox: chosen.box,
    sourceAssetIds: [chosen.asset.id].filter(Boolean),
    extractionMethod: chosen.method,
    confidence: 95,
  };
}

// Title-block values are kerned by the CAD font and arrive as
// "2401232- PC- AMS- DR- T-00-ZZZ-002": real spaces around every hyphen. The
// space is a rendering artefact, so it is removed, but only for a token that is
// unambiguously a drawing number (>=2 hyphens and a digit). A prose fragment is
// never promoted by stripping its spaces.
export function normalizeDrawingNumberToken(value) {
  const compact = String(value ?? "").toUpperCase().replace(/\s+/g, "").replace(/^[.,;:/]+|[.,;:/]+$/g, "");
  if (!/^[A-Z0-9][A-Z0-9./-]{3,}$/.test(compact)) return null;
  const hyphens = (compact.match(/-/g) || []).length;
  if (hyphens < 2 || !/\d/.test(compact)) return null;
  return compact;
}

/**
 * Composite title-block runs: some sheets extract the whole title block as ONE
 * text asset, so the label list and every value share a single string
 * ("... DRAWING NUMBER REVISION SHEET TITLE ... 2401232- PC- GRS- DR- T-93-... <2401232-PC-GRS-M3-E-ZZ-ZZZ-001> ...").
 *
 * Rule, in order:
 *   1. Start at the LAST drawing-number label in the run (the label list is
 *      repeated in flattened extractions; the last one precedes the values).
 *   2. Scan forward for the first token that is a drawing number.
 *   3. Refuse anything inside angle brackets -- that is how a SOURCE FILE
 *      filename is printed, and a filename is never authority.
 *   4. Refuse anything whose own run was introduced by a reference verb.
 *   5. Two distinct candidates before any boundary is a conflict, not a choice.
 */
export function extractDrawingNumberFromCompositeText(text) {
  const raw = String(text ?? "");
  if (!raw.trim()) return { ok: false, reason: "EMPTY_TEXT" };
  const labelPattern = /\b(?:DWG\s*NO\.?|DWG\s*NUMBER|DRAWING\s*(?:NO\.?|NUMBER)|SHEET\s*NO\.?)\b/gi;
  const all = [...raw.matchAll(labelPattern)];
  if (!all.length) return { ok: false, reason: "NO_DRAWING_NUMBER_LABEL" };
  // A label introduced by a reference verb names ANOTHER sheet. Selecting the
  // LAST non-reference label is what makes this correct on sheets whose flattened
  // extraction contains both "REFER DWG NO. <other sheet>" and the title block's
  // own "DRAWING NUMBER" label list.
  const ownLabels = all.filter((match, position) => {
    const start = match.index ?? 0;
    // Judge by the text BETWEEN the previous label and this one. A fixed
    // character window misfires on flattened runs, where an unrelated earlier
    // "REFER" can sit within 200 characters of the sheet's own DRAWING NUMBER.
    const previousEnd = position === 0 ? 0 : (all[position - 1].index ?? 0) + all[position - 1][0].length;
    const between = raw.slice(previousEnd, start);
    return !REFERENCE_VERB.test(between);
  });
  if (!ownLabels.length) return { ok: false, reason: "ONLY_CROSS_SHEET_REFERENCE_NUMBER" };
  const chosen = ownLabels.at(-1);
  const tailStart = (chosen.index ?? 0) + chosen[0].length;
  const tail = raw.slice(tailStart);

  const values = [];
  // A drawing number is a digit-led, hyphen-segmented identifier. Matching the
  // SHAPE (rather than a greedy character run) is what stops the scan from
  // absorbing the sheet title printed next to it, and the boundary lookbehind is
  // what stops it from starting mid-number and truncating the project code.
  // Longest-first, and every candidate must END on a boundary. Without the
  // boundary rule the segment charset swallows the sheet title printed beside
  // the number ("-ZZZ-005FIREDETECTION" reads as one legal segment).
  // A hyphen is NOT an ending: it means the match stopped before more segments.
  const boundaries = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const brackets = [...tail.matchAll(/<[^>]*>/g)];
  const candidates = [];
  for (let segments = 8; segments >= 2; segments -= 1) {
    const attempt = new RegExp(`(?<![\\w-])(\\d{2,}(?:\\s*-[\\s]?[A-Z0-9]{1,8}){${segments}})`, "gi");
    for (const match of tail.matchAll(attempt)) {
      const after = tail[(match.index ?? 0) + match[0].length];
      if (after !== undefined && boundaries.includes(after)) continue;
      candidates.push(match);
    }
    if (candidates.length) break;
  }
  for (const match of candidates) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (brackets.some((bracket) => {
      const bStart = bracket.index ?? 0;
      return start >= bStart && end <= bStart + bracket[0].length;
    })) continue;
    const normalized = normalizeDrawingNumberToken(match[1]);
    if (normalized) {
      values.push(normalized);
      break;
    }
  }
  if (!values.length) return { ok: false, reason: "NO_DRAWING_NUMBER_VALUE" };
  const distinct = [...new Set(values)];
  if (distinct.length > 1) return { ok: false, reason: "AMBIGUOUS_DRAWING_NUMBER", values: distinct };
  return { ok: true, drawingNumber: distinct[0], extractionMethod: "TITLE_BLOCK_COMPOSITE_TEXT", confidence: 92 };
}

/**
 * Deterministic parse of a VISION TRANSCRIPTION of a title-block crop.
 *
 * A vision model may propose text; it never proposes authority. A value is
 * accepted only from an explicit drawing-number label followed by a structured
 * token on the same line, and two different values are a conflict, not a
 * preference. Reference sentences ("REFER DWG NO. ...") are rejected for the same
 * reason the asset path rejects them: they name another sheet.
 */
export function parseDrawingNumberFromTranscription(text) {
  const raw = String(text ?? "");
  if (!raw.trim()) return { ok: false, reason: "EMPTY_TRANSCRIPTION" };
  const lines = raw.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim() !== "");
  const values = [];
  // Title-block fields are column-aligned and the transcription preserves the
  // gap: "2401232- PC- AMS- DR- T-00-ZZZ-002        1" is DRAWING NUMBER and
  // REVISION side by side. Splitting on the column gap BEFORE normalising keeps
  // the revision from being merged into the drawing number.
  const collect = (segment) => {
    for (const column of String(segment).split(/\s{2,}/)) {
      const candidate = normalizeDrawingNumberToken(column);
      if (candidate) {
        values.push(candidate);
        return;
      }
    }
  };
  for (const [index, line] of lines.entries()) {
    const labelMatch = /^(?:DWG\s*NO\.?|DWG\s*NUMBER|DRAWING\s*(?:NO\.?|NUMBER)|SHEET\s*NO\.?)\b\s*[.:]?\s*(.*)$/i.exec(line);
    if (!labelMatch) continue;
    if (REFERENCE_VERB.test(line)) continue;
    const inline = normalizeDrawingNumberToken(labelMatch[1]);
    if (inline) {
      values.push(inline);
      continue;
    }
    // Title blocks print the label row and the value row separately
    // ("DRAWING NUMBER ... REVISION" then the values). Only the immediately
    // following lines are considered, so an unrelated later token is never
    // attached to the label.
    for (const next of lines.slice(index + 1, index + 3)) collect(next);
  }
  if (!values.length) return { ok: false, reason: "NO_DRAWING_NUMBER_LABEL_IN_TRANSCRIPTION" };
  const distinct = [...new Set(values)];
  if (distinct.length > 1) return { ok: false, reason: "AMBIGUOUS_DRAWING_NUMBER", values: distinct };
  return { ok: true, drawingNumber: distinct[0], extractionMethod: "TITLE_BLOCK_CROP_VISION_TRANSCRIPTION", confidence: 90 };
}
