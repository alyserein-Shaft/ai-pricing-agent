// Backend & Codebase Consolidation Sprint, item 2: relocated to
// app/domain/reason-governance.mjs (see that file for the full rationale
// and the constant's documentation) because two pure domain engines needed
// the same canonical rule and cannot import from worker/*.mjs. Re-exported
// here unchanged so every existing worker/*.mjs importer of this module
// keeps working without modification.
export { MIN_GOVERNED_REASON_LENGTH, MIN_SAFETY_OVERRIDE_REASON_LENGTH } from "../app/domain/reason-governance.mjs";
