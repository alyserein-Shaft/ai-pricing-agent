// DRAWING INTELLIGENCE GOVERNANCE -- cross-sheet reference detection
// (WORKSTREAM 8, Rule B: Cross-Sheet Applicability).
//
// "Refer to Drawing X for legends/general notes" does NOT make Drawing X
// globally applicable to every drawing in the project. This module detects
// EXPLICIT "refer to drawing <number>" text on a sheet and represents it as
// a scoped relationship:
//   Current Sheet -> Referenced Drawing -> Applicable System (if stated) -> Applicability Status
// It never builds a knowledge graph, never resolves the referenced drawing
// against the project's document register (that is the caller's job, since
// only the caller has DB access), and never marks a reference "Applies" by
// default -- applicabilityStatus starts "Scoped to current sheet" (Rule B's
// baseline: an explicit reference from the current sheet applies to THAT
// sheet) and only widens to "Applies to referenced system" when the note
// text itself names a system explicitly (Rule B point 4). A reference is
// never marked as applying to the whole project.
//
// Pure domain logic: no DOM, no fetch, no DB.

const trim = (value) => String(value ?? "").trim();

// A conservative drawing-number pattern: this project's own numbers look
// like "2401232-PC-AMS-T-00-ZZZ-002" or "2401232- PC- AMS- T-00-ZZZ-002"
// (stray spaces after hyphens are a known, harmless PDF text-extraction
// artifact elsewhere in this codebase) -- alphanumeric segments joined by
// hyphens, at least 3 segments, so a stray short number is never mistaken
// for a drawing number.
const DRAWING_NUMBER_PATTERN = /\b([A-Z0-9]+(?:-\s?[A-Z0-9]+){2,})\b/gi;

// Systems this codebase's own governed vocabularies already recognize
// elsewhere (Fire Alarm, CCTV, ...) plus the generic ELV umbrella term this
// project's own notes text uses -- kept intentionally small; an
// unrecognized system name is simply left null rather than guessed.
const SYSTEM_KEYWORDS = [
  { system: "Fire Alarm", pattern: /\bfire\s*alarm\b|\bfas\b/i },
  { system: "CCTV", pattern: /\bcctv\b|\bsecurity\b/i },
  { system: "ELV", pattern: /\belv\b/i },
  { system: "BMS", pattern: /\bbms\b/i },
  { system: "Fire Fighting", pattern: /\bfire\s*fighting\b|\bfirefighting\b/i },
];

const detectSystem = (text) => SYSTEM_KEYWORDS.find(({ pattern }) => pattern.test(text))?.system || null;

const normalizeDrawingNumber = (raw) =>
  trim(raw)
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-{2,}/g, "-");

// Finds every "refer ... drawing/dwg no. <number>" sentence in one page's
// text assets. `pageAssets` are drawing_assets rows already filtered to
// asset_type "Text" for this page (same shape drawing-general-extraction-
// engine.mjs consumes).
// The drawing-number capture is bounded to a single line ([^\n], not \s)
// and a reasonable max length -- a composite/aggregate asset (Title
// Block, Legend) can bundle many unrelated lines into one text blob with
// only newlines separating them, and an open-ended \s+ capture would
// otherwise bleed across those newlines into whatever text happens to
// follow the drawing number (verified against a real case where it
// swallowed part of the FCC equipment schedule that immediately follows
// the reference note in the same composite asset).
//
// This anchors on the "DWG NO./DRAWING NO." LABEL itself, not on the
// trigger word ("refer"/"see"/"as per") -- a real, observed sheet has the
// two in the OPPOSITE order from the more common "...REFER DWG NO. X"
// phrasing ("DWG NO. X" appears first, "...REFER" appears afterward,
// separated by an unrelated title-block strip that a composite/aggregate
// asset's linearization interleaves between them -- the linearization
// order reflects reading order top-to-bottom, not visual/semantic
// proximity, since a legend sheet lays its notes and its callouts out as
// separate visual regions, not one paragraph). Detection must not assume
// either order.
const DRAWING_NUMBER_LABEL_PATTERN = /\b(?:dwg\.?\s*no\.?|drawing\s*(?:no\.?|number))\s*[:\-]?\s*([A-Z0-9][^\n]{5,50})/gi;
const TRIGGER_PATTERN = /\b(?:refer(?:red)?(?:\s+to)?|see|as\s+per)\b/i;

// How much surrounding context (BOTH directions) to scan for a trigger
// word/system name alongside a "DWG NO." label. Calibrated against a real
// measured case in this project's own data: a composite Legend asset's
// linearization put an unrelated ~386-character title-block strip between
// "DWG NO. X" and its own "...REFER" note -- generic to how this codebase's
// composite assets get built (any sheet whose title-block strip lands
// between its notes and its own callout will show a similarly sized gap),
// not tuned to one document's specific text. A bounded window, not the
// whole (possibly large, multi-topic) enclosing text blob, so a trigger
// word/system name mentioned far away in an unrelated part of the same
// composite asset is never picked up.
const REFERENCE_CONTEXT_WINDOW = 500;

// How much context AROUND THE TRIGGER WORD ITSELF (once found, not the
// whole wide existence-check window above) to keep for system-name
// detection and as the stored evidence text -- e.g. "1. FOR ELV LEGENDS
// ... REFER DWG NO. X", where "ELV" sits close to "REFER" specifically.
// This stays a tight, precision-focused window: REFERENCE_CONTEXT_WINDOW
// only answers "is a referral phrase present somewhere nearby at all"; it
// must not also widen what counts as "the system THIS referral names",
// or an unrelated system mentioned elsewhere in the same wide window would
// be picked up instead.
const SYSTEM_CONTEXT_WINDOW = 80;

const findReferencesInText = (text) => {
  const references = [];
  let match;
  DRAWING_NUMBER_LABEL_PATTERN.lastIndex = 0;
  while ((match = DRAWING_NUMBER_LABEL_PATTERN.exec(text))) {
    const tail = match[1];
    const numberMatch = [...tail.matchAll(DRAWING_NUMBER_PATTERN)][0];
    if (!numberMatch) continue;
    const windowStart = Math.max(0, match.index - REFERENCE_CONTEXT_WINDOW);
    const windowEnd = Math.min(text.length, match.index + match[0].length + REFERENCE_CONTEXT_WINDOW);
    const window = text.slice(windowStart, windowEnd);
    // A bare "DRAWING NUMBER: X" citation with no nearby referral phrase is
    // not a cross-sheet reference -- e.g. the sheet's own title-block field
    // (also independently excluded below by comparing against the current
    // sheet's own known number, but most sheets never even reach that check
    // because they simply have no trigger word nearby at all).
    const triggerMatch = TRIGGER_PATTERN.exec(window);
    if (!triggerMatch) continue;
    const triggerAbsoluteIndex = windowStart + triggerMatch.index;
    const triggerAbsoluteEnd = triggerAbsoluteIndex + triggerMatch[0].length;
    const numberAbsoluteIndex = match.index;
    const numberAbsoluteEnd = match.index + match[0].length;
    // localContext (system-name detection): BEFORE the trigger word only --
    // a system name like "FOR ELV LEGENDS ... REFER" always precedes the
    // trigger it qualifies. Text AFTER the trigger is whatever the
    // reference happens to point at next (the drawing number, then
    // whatever unrelated text follows it in the same composite blob), which
    // must never be mistaken for a system name.
    const localContext = text.slice(Math.max(0, triggerAbsoluteIndex - SYSTEM_CONTEXT_WINDOW), triggerAbsoluteEnd);
    // noteText (stored evidence): the literal span covering BOTH the
    // trigger word and the drawing-number citation, in whichever order they
    // actually occur -- the human-reviewable quote must show the real
    // number, not just the trigger phrase.
    const noteText = text.slice(Math.min(triggerAbsoluteIndex, numberAbsoluteIndex), Math.max(triggerAbsoluteEnd, numberAbsoluteEnd));
    references.push({
      referencedDrawingNumber: normalizeDrawingNumber(numberMatch[1]),
      noteText: trim(noteText),
      localContext,
    });
  }
  return references;
};

// sourceDocument: { id, drawingNumber, sheetName } describing the CURRENT
// sheet these assets belong to -- provenance for every relationship this
// function produces. assets: Text assets for that sheet (asset_type
// already filtered by the caller, same convention as the general
// extraction engine).
export const detectCrossSheetReferences = ({ sourceDocument = {}, pageNumber = null, assets = [] } = {}) => {
  const relationships = [];
  for (const asset of assets) {
    const text = trim(asset.text_content);
    if (!text) continue;
    for (const found of findReferencesInText(text)) {
      // Skip a "reference" that is just this same sheet's own drawing
      // number restating itself (a title block frequently repeats its own
      // number near other text) -- not a cross-sheet relationship.
      if (sourceDocument.drawingNumber && normalizeDrawingNumber(sourceDocument.drawingNumber) === found.referencedDrawingNumber) continue;
      const system = detectSystem(found.localContext);
      relationships.push({
        sourceDocumentId: sourceDocument.id ?? null,
        sourceDrawingNumber: sourceDocument.drawingNumber ?? null,
        sourceSheet: sourceDocument.sheetName ?? null,
        pageNumber,
        referencedDrawingNumber: found.referencedDrawingNumber,
        // Rule B baseline: an explicit reference is scoped to the CURRENT
        // sheet unless the note text itself names a system, in which case
        // it may extend to that system's own related drawings -- never to
        // the whole project. resolvedTargetDocumentId is left null here on
        // purpose: only the caller (with DB access to the document
        // register) can resolve a drawing number to a real document id,
        // and an unresolved reference must stay visibly unresolved rather
        // than silently matched to the wrong document. Use
        // resolveCrossSheetReferenceTargets() below to resolve it safely.
        applicableSystem: system,
        applicableDrawingTypes: system ? [system] : [],
        applicabilityStatus: system ? `Scoped to ${system} drawings` : "Scoped to current sheet",
        applicabilitySource: "Explicit same-sheet reference note",
        resolvedTargetDocumentId: null,
        revisionCompatibility: "Unknown", // the caller must check this against the target's real revision
        status: "Unresolved",
        evidence: { noteText: found.noteText, sourceAssetId: asset.id },
        governedStatus: "Needs Review", // an explicit reference is real evidence of a relationship, but its resolution/applicability still needs engineer confirmation
      });
    }
  }
  return relationships;
};

// WORKSTREAM 7: safe, deterministic target resolution -- exact match only,
// never fuzzy/approximate. documentRegistry: every real Drawing document
// in the project, as [{id, drawingNumber}]. Two deterministic passes are
// tried, in order:
//   1. Exact match after normalization (uppercase, whitespace stripped).
//   2. The SAME exact match after removing a literal "-DR-" segment from
//      whichever side has it -- a real, observed, project-wide drafting
//      convention on this project (reference notes consistently omit the
//      "-DR-" (Drawing) discipline-type segment the registered document's
//      own drawing_number always includes, e.g. a note says
//      "2401232-PC-AMS-T-00-ZZZ-002" while the real registered number is
//      "2401232-PC-AMS-DR-T-00-ZZZ-002"). This is a fixed, literal,
//      known-token removal -- not edit-distance or substring fuzzy
//      matching -- so it stays a safe, deterministic identity rule per
//      Rule B, applied symmetrically since either side could be the one
//      carrying the segment.
// A reference with no exact match on either pass is left unresolved.
const normalizeForExactMatch = (value) => String(value ?? "").trim().toUpperCase().replace(/\s+/g, "").replace(/-{2,}/g, "-");
const stripDrSegment = (normalized) => normalized.replace(/-DR-/g, "-");

export const resolveCrossSheetReferenceTargets = (references, documentRegistry = []) => {
  const registry = documentRegistry.map((doc) => ({ ...doc, normalized: normalizeForExactMatch(doc.drawingNumber) }));
  return references.map((reference) => {
    const referenceNormalized = normalizeForExactMatch(reference.referencedDrawingNumber);
    const exact = registry.find((doc) => doc.normalized === referenceNormalized);
    const drStripped =
      exact ||
      registry.find((doc) => stripDrSegment(doc.normalized) === referenceNormalized || doc.normalized === stripDrSegment(referenceNormalized));
    const match = exact || drStripped;
    if (!match) return { ...reference, resolvedTargetDocumentId: null, status: "Unresolved" };
    return {
      ...reference,
      resolvedTargetDocumentId: match.id,
      applicabilitySource: exact
        ? "Explicit same-sheet reference note, exact drawing-number match"
        : "Explicit same-sheet reference note, matched after removing the project's known '-DR-' segment convention",
      status: "Resolved",
    };
  });
};
