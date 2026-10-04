// Knowledge IA: target section model + mapping onto existing section states.
//
// The target Knowledge workspace has nine sections:
//   Sources / Products / Facts / Review / Conflicts / Lifecycle /
//   System Packs / Learning / Diagnostics
// Existing UI state only knows a subset (Sources/Products/Review/Search +
// system-pack and case-study views). This module maps target sections onto
// existing states where they exist and marks the remainder as new views, so
// integration can land incrementally without renaming what works.
export const KNOWLEDGE_SECTIONS = Object.freeze([
  "Sources",
  "Products",
  "Facts",
  "Review",
  "Conflicts",
  "Lifecycle",
  "System Packs",
  "Learning",
  "Diagnostics",
]);

// Existing section identifiers observed in the current Knowledge UI.
const EXISTING = Object.freeze({
  Sources: "Sources",
  Products: "Products",
  Review: "Review",
  Search: "Search",
});

export function targetSectionFor(existingSection) {
  if (existingSection === EXISTING.Search) return "Products";
  return KNOWLEDGE_SECTIONS.includes(existingSection) ? existingSection : "Sources";
}

// Sections with no existing backing view yet (new components required).
export function newViewsRequired() {
  return Object.freeze(["Facts", "Conflicts", "Lifecycle", "Learning", "Diagnostics"]);
}

// Engineer-safe sections: visible in the project journey without admin controls.
export function engineerSafeSections() {
  return Object.freeze(["Products", "Facts", "Lifecycle"]);
}

export function isEngineerSafe(section) {
  return engineerSafeSections().includes(section);
}
