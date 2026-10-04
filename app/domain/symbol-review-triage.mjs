// Symbol Review triage helpers -- pure domain logic, no DOM, no fetch.
//
// Faceted UNKNOWN filtering is strictly a view concern: it narrows the
// displayed list ("SHOW/HIDE FROM CURRENT VIEW") and never writes review
// state, deletes candidates, or affects quantity evidence. Every facet
// derives from generic persisted occurrence fields (bbox geometry,
// nearby_text presence, free text) so it applies to arbitrary drawings --
// no fixture, benchmark, sheet-specific, or class-specific knowledge.
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

export const UNKNOWN_SIZE_BANDS = Object.freeze(["<4 pt", "4–12 pt", "12–40 pt", "Over 40 pt"]);

// Max bbox axis band. Null-safe: malformed geometry reports "Unknown size"
// (still filterable) rather than throwing inside the review UI.
export const unknownSizeBand = (box) => {
  const width = Number(box?.width);
  const height = Number(box?.height);
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) return "Unknown size";
  const axis = Math.max(width, height);
  if (axis < 4) return "<4 pt";
  if (axis < 12) return "4–12 pt";
  if (axis < 40) return "12–40 pt";
  return "Over 40 pt";
};

const matchesSearch = (item, search) => {
  const query = String(search || "").trim().toLowerCase();
  if (!query) return true;
  return [item?.nearby_text, item?.match_basis, item?.shape_signature]
    .some((value) => String(value || "").toLowerCase().includes(query));
};

// filters: { sizeBands: string[] (empty = all), nearbyTag: "any"|"with"|"without", search: string }.
// Returns a filtered VIEW of the same row objects -- rows are never cloned
// with altered review state.
export const filterUnknownSymbols = (items, filters = {}) => {
  const sizeBands = Array.isArray(filters?.sizeBands) ? filters.sizeBands : [];
  const nearbyTag = filters?.nearbyTag === "with" || filters?.nearbyTag === "without" ? filters.nearbyTag : "any";
  const search = String(filters?.search || "");
  return (items || []).filter((item) => {
    if (sizeBands.length && !sizeBands.includes(unknownSizeBand(item?.bounding_box))) return false;
    if (nearbyTag === "with" && !String(item?.nearby_text || "").trim()) return false;
    if (nearbyTag === "without" && String(item?.nearby_text || "").trim()) return false;
    if (!matchesSearch(item, search)) return false;
    return true;
  });
};

// Single mapping authority between a persisted symbol occurrence id and the
// overlay item id the drawing viewer renders for it (mirrors
// buildDrawingOverlayItems' `occurrence:${id}` convention).
export const locateOverlayItemId = (occurrenceId) =>
  typeof occurrenceId === "string" && occurrenceId ? `occurrence:${occurrenceId}` : null;
