// QUANTITY BLOCK ALIGNMENT
// Cross-document, generic, reusable capability: align repeated BOQ blocks to
// drawing buildings using multi-device quantity fingerprints. No project-specific
// mapping is hard-coded; all alignment is evidence-driven.

export const ALIGNMENT_STATES = Object.freeze([
  "UNIQUE_ALIGNMENT_PROVEN",
  "UNIQUE_ALIGNMENT_SUPPORTED_NOT_AUTHORITATIVE",
  "MULTIPLE_PLAUSIBLE_ALIGNMENTS",
  "NO_ALIGNMENT",
  "INSUFFICIENT_EVIDENCE",
]);

// --- Block reconstruction from raw BOQ rows ---------------------------------
// A block is delimited by a repeated section/heading marker row. Rows are given
// in ascending source-row order; membership is structural (by the marker), not
// positional. "SECTION" is an input marker supplied by the caller, never inferred.
export function reconstructBlocks(rows, { marker }) {
  const blocks = [];
  let current = null;
  let bid = 0;
  for (const r of rows) {
    const isMarker = typeof r.description === "string" && r.description.includes(marker);
    if (isMarker) {
      if (current) blocks.push(current);
      bid += 1;
      current = { blockId: `BOQ_BLOCK_${bid}`, rows: [], header: r.description };
    } else if (current) {
      current.rows.push(r);
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

// --- Fingerprint: class -> total quantity within a block -------------------
const deriveClass = (desc = "") => {
  const d = desc.toLowerCase();
  if (d.includes("smoke detectors (above")) return "smoke_above_ceiling";
  if (d.includes("smoke detectors (below")) return "smoke_below_ceiling";
  if (d.startsWith("heat detector")) return "heat_detector";
  if (d.includes("combined smoke and heat")) return "combined_smoke_heat";
  if (d.includes("door contact")) return "door_contact";
  if (d.includes("duct detector")) return "duct_detector";
  if (d.includes("main fire alarm control panel") || d.includes("fire alarm control panel with")) return "facp";
  if (d.includes("fire alarm manual station (weather") || (d.includes("weatherproof") && d.includes("station"))) return "weatherproof_manual_station";
  if (d.trim().startsWith("fire alarm manual station")) return "manual_station";
  if (d.includes("fireman telephone jack")) return "fireman_telephone_jack";
  if (d.includes("interface module control")) return "interface_module_control";
  if (d.includes("interface module monitor")) return "interface_module_monitor";
  if (d.includes("loop powered strobes with sounder (weather")) return "weatherproof_horn_strobe";
  if (d.includes("loop powered strobes with sounder")) return "horn_strobe";
  if (d.includes("loop powered strobes")) return "strobe";
  return "other";
};

export function blockFingerprint(block) {
  const fp = {};
  for (const r of block.rows) {
    const k = deriveClass(r.description);
    const q = Number(r.quantity ?? r.numeric_quantity ?? 0);
    if (Number.isFinite(q)) fp[k] = (fp[k] ?? 0) + q;
  }
  return fp;
}

// --- Alignment evaluation ----------------------------------------------------
// Requires AT LEAST `requiredMatches` independent device classes for a supported
// or proven mapping; a single numeric coincidence cannot govern alignment.
export function evaluateAlignments({ blocks, buildingFingerprints, requiredMatches = 2 }) {
  const results = [];
  for (const block of blocks) {
    const bfp = blockFingerprint(block);
    const candidates = [];
    for (const [buildingTarget, dfp] of Object.entries(buildingFingerprints ?? {})) {
      const matchedClasses = [];
      for (const [cls, bq] of Object.entries(bfp)) {
        // drawing fingerprint may carry only presence counts; treat a class as feature if both sides present
        if (dfp[cls] != null) {
          const dq = Number(dfp[cls]);
          const diff = Math.abs(dq - bq);
          matchedClasses.push({ class: cls, blockQty: bq, drawingEvidence: dq, exact: diff === 0, partial: diff <= Math.max(1, bq * 0.2) });
        }
      }
      const score = matchedClasses.reduce((acc, m) => acc + (m.exact ? 2 : m.partial ? 1 : 0), 0);
      candidates.push({
        buildingTarget,
        matchedClasses,
        matchedClassCount: matchedClasses.length,
        score,
      });
    }
    candidates.sort((a, b) => b.score - a.score);
    const top = candidates[0];
    const second = candidates[1];
    let state;
    const hasEnough = top && top.matchedClassCount >= requiredMatches && (top.exactExactMatchCount ?? 0) >= 0;
    const unique = top && (!second || top.score > second.score);
    if (!top || top.matchedClassCount === 0) state = "NO_ALIGNMENT";
    else if (top.matchedClassCount >= requiredMatches && unique && top.score > 0) state = "UNIQUE_ALIGNMENT_SUPPORTED_NOT_AUTHORITATIVE";
    else if (top.matchedClassCount >= requiredMatches) state = "MULTIPLE_PLAUSIBLE_ALIGNMENTS";
    else if (top.matchedClassCount >= 1) state = "INSUFFICIENT_EVIDENCE"; // exactly one feature = possible coincidence
    else state = "INSUFFICIENT_EVIDENCE";
    results.push({ blockId: block.blockId, state, candidates: candidates.slice(0, 3) });
  }
  return results;
}
