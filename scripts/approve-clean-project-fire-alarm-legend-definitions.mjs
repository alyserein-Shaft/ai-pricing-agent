// TASK-LOCAL governed approval runner -- six exact Fire Alarm legend definitions.
//
// Writes ONLY through the canonical governed routes:
//   POST /api/structure-review-cases/{id}/edit      (exact abbreviation + description + provenance notes)
//   POST /api/structure-review-cases/{id}/confirm
//   POST /api/documents/{id}/drawing-structure/review/publish
//
// No direct SQL, no approval of any other legend row, no quantity, no AI call.
// Descriptions come from the accepted clean-project recovery packet, never
// retyped from memory; AI corroboration is attached as ADVISORY metadata only.

import { readFileSync } from "node:fs";

const BASE = "http://localhost:4183";
const DOCUMENT_ID = "doc_18e8db55-d75c-474f-827c-f1a21413b244";
const INTAKE_VERSION_ID = "drawingIntake_8c0a8eeb-fbf0-4a63-b611-eaf346ea40a0";
const DOCUMENT_VERSION_ID = "ver_03c5acf0-8d8a-4fc7-ae19-f7eeab3c3be4";
const SYMBOLS = ["T", "S", "H", "ZIM", "FTCP", "FARP"];

// AI corroboration verdicts from the targeted reasoner run. ADVISORY ONLY: the
// approval rests on the visually explicit current legend pair, not on these.
const AI_RELATION = {
  T: { boq: "SUPPORTS", spec: "SUPPORTS", confidence: 0.75 },
  S: { boq: "SUPPORTS", spec: "SUPPORTS", confidence: 0.75 },
  H: { boq: "SUPPORTS", spec: "SUPPORTS", confidence: 0.75 },
  ZIM: { boq: "RELATED_BUT_NON_AUTHORITATIVE", spec: "RELATED_BUT_NON_AUTHORITATIVE", confidence: 0.75 },
  FTCP: { boq: "RELATED_BUT_NON_AUTHORITATIVE", spec: "RELATED_BUT_NON_AUTHORITATIVE", confidence: 0.75 },
  FARP: { boq: "RELATED_BUT_NON_AUTHORITATIVE", spec: "RELATED_BUT_NON_AUTHORITATIVE", confidence: 0.75 },
};

const pairs = JSON.parse(readFileSync("out/benchmark/vision-bakeoff/omair-review/fa-legend-candidates.json", "utf8"));
const review = await (await fetch(`${BASE}/api/documents/${DOCUMENT_ID}/drawing-structure/review`)).json();

const post = async (path, body) => {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
};

const results = [];
for (const symbol of SYMBOLS) {
  const pair = pairs.find((entry) => entry.symbol === symbol && entry.descriptionAssetId);
  if (!pair) throw new Error(`NO_RECOVERED_PAIR_FOR_SYMBOL:${symbol}`);
  const description = pair.description.trim();
  // Match the recovered description to exactly one structural legend row. A
  // multi-column row (row 9 also holds two speaker descriptions) is matched by
  // prefix and corrected to the exact approved text.
  const candidates = review.cases.filter((entry) => {
    const current = String(entry.current_snapshot?.description || "").trim();
    return current === description || current.startsWith(`${description} `);
  });
  if (candidates.length !== 1) throw new Error(`LEGEND_ROW_MATCH_NOT_UNIQUE:${symbol}:${candidates.length}`);
  const reviewCase = candidates[0];
  const mergedOriginal = String(reviewCase.current_snapshot?.description || "");

  const notes = [
    `Omair human approval 2026-10-04 (governed legend definition).`,
    `Document ${DOCUMENT_ID}; documentVersion ${DOCUMENT_VERSION_ID}; drawingIntakeVersion ${INTAKE_VERSION_ID}; page 1.`,
    `Recovered pair: symbol "${symbol}" @(${Math.round(pair.symbolBbox.x)},${Math.round(pair.symbolBbox.y)}) -> description "${description}" @(${Math.round(pair.descriptionBbox.x)},${Math.round(pair.descriptionBbox.y)}).`,
    `sourceAssetIds: symbol=${pair.symbolAssetId}; description=${pair.descriptionAssetId}.`,
    `AI corroboration (ADVISORY, AI_PROPOSED, not authority): BOQ=${AI_RELATION[symbol].boq}; Specification=${AI_RELATION[symbol].spec}; contradictions=none; modelConfidence=${AI_RELATION[symbol].confidence}.`,
    `Basis: the symbol/description pair is visually explicit in the CURRENT Fire Alarm legend; cross-document corroboration is supporting metadata, not a prerequisite.`,
    mergedOriginal !== description
      ? `Structural row originally merged adjacent column text: "${mergedOriginal}". Approved text is the exact Fire Alarm legend description for symbol ${symbol}; the adjacent non-Fire-Alarm descriptions in that merged row remain ungoverned.`
      : `Structural row text already matched the recovered description exactly.`,
  ].join(" ");

  const reason = `Omair approved the explicit current Fire Alarm legend definition ${symbol} = ${description}.`;
  const edited = await post(`/api/structure-review-cases/${reviewCase.id}/edit`, {
    abbreviation: symbol,
    description,
    notes,
    reason,
  });
  if (edited.status !== 200) throw new Error(`EDIT_FAILED:${symbol}:${JSON.stringify(edited.payload)}`);

  const confirmed = await post(`/api/structure-review-cases/${reviewCase.id}/confirm`, { reason });
  if (confirmed.status !== 200 || confirmed.payload.status !== "Approved") {
    throw new Error(`CONFIRM_FAILED:${symbol}:${JSON.stringify(confirmed.payload)}`);
  }
  results.push({
    symbol,
    description,
    caseId: reviewCase.id,
    sourceRow: reviewCase.current_snapshot.sourceRow,
    structuralDescriptionBbox: reviewCase.current_snapshot.boundingBox,
    symbolAssetId: pair.symbolAssetId,
    descriptionAssetId: pair.descriptionAssetId,
    reviewedBy: confirmed.payload.reviewedBy,
    mergedOriginalCorrected: mergedOriginal !== description,
  });
  console.log(`APPROVED ${symbol} => ${description} | row ${reviewCase.current_snapshot.sourceRow} | reviewedBy ${confirmed.payload.reviewedBy}`);
}

const published = await post(`/api/documents/${DOCUMENT_ID}/drawing-structure/review/publish`, {
  reason: `Omair published the six approved Fire Alarm legend definitions (${SYMBOLS.join(", ")}) for documentVersion ${DOCUMENT_VERSION_ID}. AI corroboration retained as advisory metadata; no other legend row is promoted.`,
});
console.log("PUBLISH:", published.status, JSON.stringify(published.payload));
console.log(JSON.stringify(results, null, 1));
